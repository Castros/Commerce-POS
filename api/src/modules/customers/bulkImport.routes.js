import { Router } from "express";
import { z } from "zod";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { v2 as cloudinary } from "cloudinary";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { asyncHandler, badRequest } from "../../shared/http/errors.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import multer from "multer";

export const bulkImportRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB ZIP
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === "application/zip"
      || file.mimetype === "application/x-zip-compressed"
      || file.originalname.endsWith(".zip");
    if (!ok) return cb(new Error("Only .zip files are accepted"));
    cb(null, true);
  },
});

function getCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw badRequest("Cloudinary is not configured");
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET });
  return cloudinary;
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function isImage(filename) {
  const dot = filename.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTS.has(filename.slice(dot).toLowerCase());
}

function parseZip(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  let csvEntry = null;
  const imageMap = new Map(); // basename (no ext, lowercase) → buffer

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.name;
    if (!name || name.startsWith(".")) continue;

    if (name.toLowerCase().endsWith(".csv")) {
      csvEntry = entry;
    } else if (isImage(name)) {
      const dot = name.lastIndexOf(".");
      const key = name.slice(0, dot).toLowerCase();
      imageMap.set(key, entry.getData());
    }
  }

  if (!csvEntry) throw badRequest("ZIP must contain a .csv file");

  const csvText = csvEntry.getData().toString("utf8");
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return { rows, imageMap };
}

const CSV_ROW_SCHEMA = z.object({
  name:          z.string().min(1),
  email:         z.string().email().optional().or(z.literal("")),
  phone:         z.string().optional(),
  external_id:   z.string().optional(),
  image_filename: z.string().optional(),
});

// ── POST /v1/customers/bulk-import/preview ────────────────────────────────────
// Parse the ZIP without writing anything. Returns what would be created/updated.

bulkImportRouter.post(
  "/preview",
  requirePermission("customers:write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    const { rows, imageMap } = parseZip(req.file.buffer);

    const preview = [];
    const parseErrors = [];

    for (let i = 0; i < rows.length; i++) {
      const parsed = CSV_ROW_SCHEMA.safeParse(rows[i]);
      if (!parsed.success) {
        parseErrors.push({ row: i + 2, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }

      const r = parsed.data;
      const imageFilename = r.image_filename?.trim() || null;
      const dot = imageFilename ? imageFilename.lastIndexOf(".") : -1;
      const imageKey = imageFilename
        ? (dot !== -1 ? imageFilename.slice(0, dot) : imageFilename).toLowerCase()
        : null;
      const hasImage = imageKey ? imageMap.has(imageKey) : false;

      // Check if customer already exists
      let existingId = null;
      if (r.external_id) {
        const found = await pool.query(
          `SELECT id FROM commerce_customers WHERE organization_id = $1 AND external_id = $2`,
          [organizationId, r.external_id]
        );
        if (found.rowCount > 0) existingId = found.rows[0].id;
      }

      preview.push({
        row: i + 2,
        name: r.name,
        email: r.email || null,
        externalId: r.external_id || null,
        action: existingId ? "update" : "create",
        imageFilename: imageFilename,
        imageFound: imageFilename ? hasImage : null,
      });
    }

    res.json({
      data: {
        total: rows.length,
        valid: preview.length,
        parseErrors,
        preview,
      },
    });
  })
);

// ── POST /v1/customers/bulk-import/apply ─────────────────────────────────────
// Apply the import: upsert customers then upload images to Cloudinary.

bulkImportRouter.post(
  "/apply",
  requirePermission("customers:write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    const { rows, imageMap } = parseZip(req.file.buffer);

    const results = { created: 0, updated: 0, images: 0, errors: [] };

    // Phase 1: upsert all customer rows in one transaction
    const customerIds = new Map(); // index → id

    await withTransaction(async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const parsed = CSV_ROW_SCHEMA.safeParse(rows[i]);
        if (!parsed.success) {
          results.errors.push({ row: i + 2, phase: "csv", error: parsed.error.issues[0]?.message ?? "Invalid row" });
          continue;
        }
        const r = parsed.data;

        try {
          const upsert = await client.query(
            `INSERT INTO commerce_customers
               (organization_id, name, email, phone, external_id, customer_type)
             VALUES ($1, $2, $3, $4, $5, 'student')
             ON CONFLICT (organization_id, external_id)
               WHERE external_id IS NOT NULL
               DO UPDATE SET name  = EXCLUDED.name,
                             email = COALESCE(EXCLUDED.email, commerce_customers.email),
                             phone = COALESCE(EXCLUDED.phone, commerce_customers.phone)
             RETURNING id, (xmax = 0) AS inserted`,
            [organizationId, r.name, r.email || null, r.phone || null, r.external_id || null]
          );
          const { id, inserted } = upsert.rows[0];
          customerIds.set(i, { id, imageFilename: r.image_filename?.trim() || null });
          if (inserted) results.created++;
          else results.updated++;
        } catch (err) {
          results.errors.push({ row: i + 2, name: r.name, phase: "db", error: err.message });
        }
      }
    });

    // Phase 2: upload images to Cloudinary (outside transaction — non-blocking per row)
    const cld = imageMap.size > 0 ? getCloudinary() : null;
    const folder = `orgs/${organizationId}/students`;

    for (const [, { id, imageFilename }] of customerIds) {
      if (!imageFilename) continue;
      const dot = imageFilename.lastIndexOf(".");
      const imageKey = (dot !== -1 ? imageFilename.slice(0, dot) : imageFilename).toLowerCase();
      const imageBuffer = imageMap.get(imageKey);
      if (!imageBuffer) continue;

      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cld.uploader.upload_stream(
            { folder, resource_type: "image", public_id: `${id}` },
            (err, result) => err ? reject(err) : resolve(result)
          );
          stream.end(imageBuffer);
        });

        await pool.query(
          `UPDATE commerce_customers SET avatar_public_id = $1 WHERE id = $2`,
          [uploadResult.public_id, id]
        );
        results.images++;
      } catch (err) {
        results.errors.push({ customerId: id, phase: "image", error: err.message });
      }
    }

    res.json({ data: results });
  })
);
