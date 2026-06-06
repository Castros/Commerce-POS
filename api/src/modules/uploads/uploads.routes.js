import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

import { pool } from "../../db/client.js";
import { asyncHandler, badRequest, notFound } from "../../shared/http/errors.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";

export const uploadsRouter = Router();

// Cloudinary is configured lazily so missing env vars don't break startup
function getCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw badRequest("Cloudinary is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key:    CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

const ENTITY_SUBFOLDERS = {
  staff:    "staff",
  student:  "students",
  guardian: "guardians",
  store:    "stores",
};

function orgFolder(organizationId, entityType) {
  return `orgs/${organizationId}/${ENTITY_SUBFOLDERS[entityType]}`;
}

const ENTITY_TABLES = {
  staff:    { table: "commerce_users",     col: "avatar_public_id", orgCol: "organization_id" },
  student:  { table: "commerce_customers", col: "avatar_public_id", orgCol: "organization_id" },
  guardian: { table: "commerce_guardians", col: "avatar_public_id", orgCol: "organization_id" },
  store:    { table: "commerce_stores",    col: "image_public_id",  orgCol: "organization_id" },
};

// Multer: memory storage, 10 MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// ── GET /v1/uploads/signature ─────────────────────────────────────────────────
// Returns a signed timestamp so the browser can upload directly to Cloudinary.
// The browser never sees your API secret.

uploadsRouter.get(
  "/signature",
  asyncHandler(async (req, res) => {
    const entityType = z.enum(["staff", "student", "guardian", "store"])
      .parse(req.query.folder ?? req.query.entityType ?? "student");

    const actor = req.actor;
    if (!actor?.organizationId) {
      throw badRequest("Cannot determine organization from session");
    }

    const folder = orgFolder(actor.organizationId, entityType);
    const cld = getCloudinary();
    const timestamp = Math.round(Date.now() / 1000);
    const params = { folder, timestamp, upload_preset: "commerce_pos_avatars" };
    const signature = cld.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);

    res.json({
      data: {
        signature,
        timestamp,
        api_key:       process.env.CLOUDINARY_API_KEY,
        cloud_name:    process.env.CLOUDINARY_CLOUD_NAME,
        folder,
        upload_preset: "commerce_pos_avatars",
      },
    });
  })
);

// ── PATCH /v1/uploads/commit ──────────────────────────────────────────────────
// Called by the browser after a direct Cloudinary upload.
// Fetches the existing public_id, deletes the old image from Cloudinary,
// then persists the new public_id to the DB — all in one round-trip.

uploadsRouter.patch(
  "/commit",
  asyncHandler(async (req, res) => {
    const body = z.object({
      entityType:     z.enum(["staff", "student", "guardian", "store"]),
      entityId:       z.string().uuid(),
      organizationId: z.string().uuid(),
      newPublicId:    z.string().min(1),
    }).parse(req.body);

    authorizeTenant(req.actor, body.organizationId);

    const meta = ENTITY_TABLES[body.entityType];

    const existing = await pool.query(
      `SELECT ${meta.col} FROM ${meta.table} WHERE id = $1 AND ${meta.orgCol} = $2`,
      [body.entityId, body.organizationId]
    );
    if (existing.rowCount === 0) throw notFound(`${body.entityType} not found`);

    const oldPublicId = existing.rows[0][meta.col];

    if (oldPublicId && oldPublicId !== body.newPublicId) {
      const cld = getCloudinary();
      await cld.uploader.destroy(oldPublicId).catch(() => {});
    }

    await pool.query(
      `UPDATE ${meta.table} SET ${meta.col} = $1 WHERE id = $2`,
      [body.newPublicId, body.entityId]
    );

    res.json({ data: { ok: true, publicId: body.newPublicId } });
  })
);

// ── POST /v1/uploads/entity-image ─────────────────────────────────────────────
// Programmatic / bulk upload — used for school system sync or admin scripts.
// Accepts multipart/form-data with: file, entity_type, entity_id, organization_id
// Rate-limited via existing express-rate-limit on the API; callers should stay
// under 60 req/min per org token to avoid Cloudinary free-tier rate limits.

uploadsRouter.post(
  "/entity-image",
  requirePermission("organizations:write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");

    const body = z.object({
      entity_type:     z.enum(["staff", "student", "guardian", "store"]),
      entity_id:       z.string().uuid(),
      organization_id: z.string().uuid(),
    }).parse(req.body);

    authorizeTenant(req.actor, body.organization_id);

    const meta = ENTITY_TABLES[body.entity_type];

    // Verify entity belongs to this org before uploading
    const check = await pool.query(
      `SELECT id FROM ${meta.table} WHERE id = $1 AND ${meta.orgCol} = $2`,
      [body.entity_id, body.organization_id]
    );
    if (check.rowCount === 0) throw notFound(`${body.entity_type} not found`);

    const cld = getCloudinary();
    const folder = orgFolder(body.organization_id, body.entity_type);

    // Stream buffer to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cld.uploader.upload_stream(
        {
          folder,
          upload_preset: "commerce_pos_avatars",
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    const publicId = uploadResult.public_id;

    // Delete old image from Cloudinary if one existed
    const existing = await pool.query(
      `SELECT ${meta.col} FROM ${meta.table} WHERE id = $1`,
      [body.entity_id]
    );
    const oldPublicId = existing.rows[0]?.[meta.col];
    if (oldPublicId && oldPublicId !== publicId) {
      await cld.uploader.destroy(oldPublicId).catch(() => {});
    }

    await pool.query(
      `UPDATE ${meta.table} SET ${meta.col} = $1 WHERE id = $2`,
      [publicId, body.entity_id]
    );

    const url = cld.url(publicId, { secure: true, fetch_format: "auto", quality: "auto" });

    res.json({
      data: {
        entity_id:   body.entity_id,
        entity_type: body.entity_type,
        public_id:   publicId,
        url,
      },
    });
  })
);

// ── DELETE /v1/uploads/entity-image ──────────────────────────────────────────
// Remove an entity's image — deletes from Cloudinary and clears the DB column.

uploadsRouter.delete(
  "/entity-image",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      entity_type:     z.enum(["staff", "student", "guardian", "store"]),
      entity_id:       z.string().uuid(),
      organization_id: z.string().uuid(),
    }).parse(req.body);

    authorizeTenant(req.actor, body.organization_id);

    const meta = ENTITY_TABLES[body.entity_type];

    const row = await pool.query(
      `SELECT ${meta.col} FROM ${meta.table} WHERE id = $1 AND ${meta.orgCol} = $2`,
      [body.entity_id, body.organization_id]
    );
    if (row.rowCount === 0) throw notFound(`${body.entity_type} not found`);

    const publicId = row.rows[0][meta.col];
    if (publicId) {
      const cld = getCloudinary();
      await cld.uploader.destroy(publicId).catch(() => {});
    }

    await pool.query(
      `UPDATE ${meta.table} SET ${meta.col} = NULL WHERE id = $1`,
      [body.entity_id]
    );

    res.json({ data: { ok: true } });
  })
);
