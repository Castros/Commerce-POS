import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import multer from "multer";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { hashPin } from "../../shared/auth/browserAuth.js";
import { getActor, requirePermission } from "../../shared/auth/auth.js";
import {
  asyncHandler,
  badRequest,
  forbidden,
  notFound,
  parseZod
} from "../../shared/http/errors.js";

export const staffRouter = Router();

const ALLOWED_ROLES = [
  "organization_owner",
  "organization_admin",
  "store_manager",
  "cashier",
  "accountant"
];

const PLATFORM_ROLES = new Set(["platform_admin", "super_admin", "service"]);

function assertSameOrg(actor, organizationId) {
  if (!PLATFORM_ROLES.has(actor.role) && actor.organizationId !== organizationId) {
    throw forbidden("Access denied");
  }
}

const createStaffSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  role: z.enum(["organization_admin", "store_manager", "cashier", "accountant"]),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits"),
  storeIds: z.array(z.string().uuid()).default([])
});

const updateStaffSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  email:            z.string().email().nullable().optional(),
  role:             z.enum(["organization_admin", "store_manager", "cashier", "accountant"]).optional(),
  active:           z.boolean().optional(),
  avatarPublicId:   z.string().nullable().optional(),
});

const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits")
});

const updateStoresSchema = z.object({
  storeIds: z.array(z.string().uuid())
});

const updateCategoryPermissionsSchema = z.object({
  categoryIds: z.array(z.string().uuid())
});

async function fetchStaffRow(id) {
  const result = await pool.query(
    `SELECT id, organization_id AS "organizationId" FROM commerce_users WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw notFound("Staff member not found");
  return row;
}

staffRouter.get(
  "/",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    assertSameOrg(actor, organizationId);

    const result = await pool.query(
      `
        SELECT u.id, u.organization_id AS "organizationId", u.name, u.email, u.role,
               u.active, u.pin_last4 AS "pinLast4", u.pin_set_at AS "pinSetAt",
               u.created_at AS "createdAt",
               coalesce(
                 array_agg(sa.store_id ORDER BY sa.created_at)
                 FILTER (WHERE sa.store_id IS NOT NULL),
                 '{}'
               ) AS "storeIds"
        FROM commerce_users u
        LEFT JOIN commerce_user_store_assignments sa
          ON sa.organization_id = u.organization_id AND sa.user_id = u.id
        WHERE u.organization_id = $1
          AND u.role = ANY($2)
        GROUP BY u.id
        ORDER BY u.created_at ASC
      `,
      [organizationId, ALLOWED_ROLES]
    );

    res.json({ data: result.rows });
  })
);

staffRouter.post(
  "/",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const body = parseZod(createStaffSchema, req.body);
    assertSameOrg(actor, body.organizationId);

    const { salt, hash } = await hashPin(body.pin);
    const pinLast4 = body.pin.slice(-4);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `
          INSERT INTO commerce_users
            (organization_id, name, email, role, pin_hash, pin_salt, pin_last4, pin_set_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING id, organization_id AS "organizationId", name, email, role, active,
                    pin_last4 AS "pinLast4", pin_set_at AS "pinSetAt", created_at AS "createdAt"
        `,
        [body.organizationId, body.name, body.email || null, body.role, hash, salt, pinLast4]
      );

      const user = userResult.rows[0];

      for (const storeId of body.storeIds) {
        await client.query(
          `
            INSERT INTO commerce_user_store_assignments (organization_id, user_id, store_id)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `,
          [body.organizationId, user.id, storeId]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({ data: { ...user, storeIds: body.storeIds } });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => null);
      throw err;
    } finally {
      client.release();
    }
  })
);

staffRouter.patch(
  "/:id",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const body = parseZod(updateStaffSchema, req.body);
    const existing = await fetchStaffRow(req.params.id);
    assertSameOrg(actor, existing.organizationId);

    const cols = [];
    const vals = [];
    let i = 1;

    if (body.name           !== undefined) { cols.push(`name = $${i++}`);             vals.push(body.name); }
    if (body.email          !== undefined) { cols.push(`email = $${i++}`);            vals.push(body.email); }
    if (body.role           !== undefined) { cols.push(`role = $${i++}`);             vals.push(body.role); }
    if (body.active         !== undefined) { cols.push(`active = $${i++}`);           vals.push(body.active); }
    if (body.avatarPublicId !== undefined) { cols.push(`avatar_public_id = $${i++}`); vals.push(body.avatarPublicId); }

    if (cols.length === 0) {
      return res.json({ data: existing });
    }

    vals.push(req.params.id);
    const result = await pool.query(
      `
        UPDATE commerce_users SET ${cols.join(", ")}
        WHERE id = $${i}
        RETURNING id, organization_id AS "organizationId", name, email, role, active,
                  pin_last4 AS "pinLast4", pin_set_at AS "pinSetAt", created_at AS "createdAt",
                  avatar_public_id AS "avatarPublicId"
      `,
      vals
    );

    res.json({ data: result.rows[0] });
  })
);

staffRouter.post(
  "/:id/pin",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const body = parseZod(setPinSchema, req.body);
    const existing = await fetchStaffRow(req.params.id);
    assertSameOrg(actor, existing.organizationId);

    const { salt, hash } = await hashPin(body.pin);
    const pinLast4 = body.pin.slice(-4);

    const result = await pool.query(
      `
        UPDATE commerce_users
        SET pin_hash = $1, pin_salt = $2, pin_last4 = $3, pin_set_at = NOW()
        WHERE id = $4
        RETURNING id, organization_id AS "organizationId", name, email, role, active,
                  pin_last4 AS "pinLast4", pin_set_at AS "pinSetAt"
      `,
      [hash, salt, pinLast4, req.params.id]
    );

    await pool.query(
      `UPDATE commerce_browser_sessions SET active = FALSE WHERE user_id = $1`,
      [req.params.id]
    );

    res.json({ data: result.rows[0] });
  })
);

staffRouter.put(
  "/:id/stores",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const body = parseZod(updateStoresSchema, req.body);
    const existing = await fetchStaffRow(req.params.id);
    assertSameOrg(actor, existing.organizationId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM commerce_user_store_assignments
         WHERE organization_id = $1 AND user_id = $2`,
        [existing.organizationId, req.params.id]
      );

      for (const storeId of body.storeIds) {
        await client.query(
          `INSERT INTO commerce_user_store_assignments (organization_id, user_id, store_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [existing.organizationId, req.params.id, storeId]
        );
      }

      await client.query("COMMIT");
      res.json({ data: { id: req.params.id, storeIds: body.storeIds } });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => null);
      throw err;
    } finally {
      client.release();
    }
  })
);

staffRouter.get(
  "/:id/category-permissions",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const existing = await fetchStaffRow(req.params.id);
    assertSameOrg(actor, existing.organizationId);

    const result = await pool.query(
      `SELECT category_id AS "categoryId"
       FROM commerce_user_category_permissions
       WHERE organization_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [existing.organizationId, req.params.id]
    );

    res.json({ data: { id: req.params.id, categoryIds: result.rows.map((r) => r.categoryId) } });
  })
);

staffRouter.put(
  "/:id/category-permissions",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const body = parseZod(updateCategoryPermissionsSchema, req.body);
    const existing = await fetchStaffRow(req.params.id);
    assertSameOrg(actor, existing.organizationId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM commerce_user_category_permissions
         WHERE organization_id = $1 AND user_id = $2`,
        [existing.organizationId, req.params.id]
      );

      for (const categoryId of body.categoryIds) {
        await client.query(
          `INSERT INTO commerce_user_category_permissions (organization_id, user_id, category_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [existing.organizationId, req.params.id, categoryId]
        );
      }

      await client.query("COMMIT");
      res.json({ data: { id: req.params.id, categoryIds: body.categoryIds } });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => null);
      throw err;
    } finally {
      client.release();
    }
  })
);

// ── CSV Import ────────────────────────────────────────────────────────────────

const staffUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (!ok) return cb(new Error("Only .csv files are accepted"));
    cb(null, true);
  },
});

const STAFF_IMPORT_ROLES = ["cashier", "store_manager", "organization_admin"];

const STAFF_CSV_ROW_SCHEMA = z.object({
  name:  z.string().min(1, "name is required"),
  email: z.string().email("email must be a valid email address"),
  role:  z.enum(["cashier", "store_manager", "organization_admin"], {
    errorMap: () => ({ message: `role must be one of: ${STAFF_IMPORT_ROLES.join(", ")}` }),
  }),
  pin:   z.string().regex(/^\d{4,8}$/, "pin must be 4–8 digits"),
  phone: z.string().optional(),
});

function parseStaffCsvRows(buffer) {
  const text = buffer.toString("utf8").replace(/^﻿/, ""); // strip BOM
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

// POST /v1/staff/import/preview
staffRouter.post(
  "/import/preview",
  requirePermission("organizations:write"),
  staffUpload.single("file"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    assertSameOrg(actor, organizationId);

    let rawRows;
    try {
      rawRows = parseStaffCsvRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV — check the file format");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 200) throw badRequest("Max 200 rows per import");

    // Load existing staff emails for this org
    const existing = await pool.query(
      `SELECT email FROM commerce_users WHERE organization_id = $1`,
      [organizationId]
    );
    const existingEmails = new Set(
      existing.rows.map((r) => r.email?.toLowerCase()).filter(Boolean)
    );

    const preview = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2;
      const parsed = STAFF_CSV_ROW_SCHEMA.safeParse(rawRows[i]);

      if (!parsed.success) {
        errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }

      const r = parsed.data;
      const normalizedEmail = r.email.toLowerCase().trim();
      const emailExists = existingEmails.has(normalizedEmail);

      preview.push({
        row: rowNum,
        name: r.name.trim(),
        email: normalizedEmail,
        role: r.role,
        phone: r.phone?.trim() || null,
        action: emailExists ? "skip" : "create",
        ...(emailExists ? { skipReason: "email already exists" } : {}),
      });
    }

    res.json({
      data: {
        total: rawRows.length,
        valid: preview.length,
        errors,
        preview,
      },
    });
  })
);

// POST /v1/staff/import/apply
staffRouter.post(
  "/import/apply",
  requirePermission("organizations:write"),
  staffUpload.single("file"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    assertSameOrg(actor, organizationId);

    let rawRows;
    try {
      rawRows = parseStaffCsvRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 200) throw badRequest("Max 200 rows per import");

    const results = { created: 0, skipped: 0, errors: [] };

    await withTransaction(async (client) => {
      // Load existing emails inside the transaction
      const existing = await client.query(
        `SELECT email FROM commerce_users WHERE organization_id = $1`,
        [organizationId]
      );
      const existingEmails = new Set(
        existing.rows.map((r) => r.email?.toLowerCase()).filter(Boolean)
      );

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const parsed = STAFF_CSV_ROW_SCHEMA.safeParse(rawRows[i]);

        if (!parsed.success) {
          results.errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
          continue;
        }

        const r = parsed.data;
        const normalizedEmail = r.email.toLowerCase().trim();

        if (existingEmails.has(normalizedEmail)) {
          results.skipped++;
          continue;
        }

        try {
          const { salt, hash } = await hashPin(r.pin);
          const pinLast4 = r.pin.slice(-4);

          await client.query(
            `INSERT INTO commerce_users
               (organization_id, name, email, role, pin_hash, pin_salt, pin_last4, pin_set_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [organizationId, r.name.trim(), normalizedEmail, r.role, hash, salt, pinLast4]
          );
          results.created++;
          existingEmails.add(normalizedEmail);
        } catch (err) {
          results.errors.push({ row: rowNum, name: r.name, error: err.message });
        }
      }
    });

    res.json({ data: results });
  })
);
