import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import multer from "multer";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";
import { sendEmail, buildInviteEmail } from "../../shared/email/emailClient.js";
import { generateSessionToken, hashCode } from "./guardianAuth.js";

export const guardiansRouter = Router();

const GUARDIAN_SELECT = `
  SELECT g.id, g.organization_id AS "organizationId",
         g.name, g.email, g.phone,
         g.family_code          AS "familyCode",
         g.notification_prefs   AS "notificationPrefs",
         g.active, g.created_at AS "createdAt",
         COALESCE(
           json_agg(
             json_build_object(
               'studentId',    gs.student_id,
               'name',         c.name,
               'relationship', gs.relationship,
               'isPrimary',    gs.is_primary
             ) ORDER BY gs.is_primary DESC, c.name ASC
           ) FILTER (WHERE gs.student_id IS NOT NULL),
           '[]'
         ) AS students
  FROM commerce_guardians g
  LEFT JOIN commerce_guardian_students gs ON gs.guardian_id = g.id
  LEFT JOIN commerce_customers c ON c.id = gs.student_id
`;

// ── List ─────────────────────────────────────────────────────────────────────

guardiansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        q: z.string().optional(),
        active: z.enum(["true", "false"]).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200)
      }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId];
    const wheres = ["g.organization_id = $1"];

    if (query.active !== undefined) {
      values.push(query.active === "true");
      wheres.push(`g.active = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      const n = values.length;
      wheres.push(`(g.name ILIKE $${n} OR g.email ILIKE $${n})`);
    }
    values.push(query.limit);

    const result = await pool.query(
      `${GUARDIAN_SELECT}
       WHERE ${wheres.join(" AND ")}
       GROUP BY g.id
       ORDER BY g.name ASC
       LIMIT $${values.length}`,
      values
    );
    res.json({ data: result.rows });
  })
);

// ── Get one ──────────────────────────────────────────────────────────────────

guardiansRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const guardianId = z.string().uuid().parse(req.params.id);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `${GUARDIAN_SELECT}
       WHERE g.id = $1 AND g.organization_id = $2
       GROUP BY g.id`,
      [guardianId, organizationId]
    );
    if (result.rowCount === 0) throw notFound("Guardian not found");
    res.json({ data: result.rows[0] });
  })
);

// ── Create ───────────────────────────────────────────────────────────────────

guardiansRouter.post(
  "/",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().min(1),
        email: z.string().email().transform((e) => e.toLowerCase().trim()),
        phone: z.string().nullable().optional(),
        familyCode: z.string().nullable().optional(),
        notificationPrefs: z.object({
          email_on_purchase: z.boolean().optional(),
          low_balance_threshold_cents: z.number().int().min(0).optional()
        }).optional()
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const guardianRow = await withTransaction(async (client) => {
      const g = await client.query(
        `INSERT INTO commerce_guardians
           (organization_id, name, email, phone, family_code, notification_prefs)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::jsonb,
           '{"email_on_purchase":true,"low_balance_threshold_cents":500}'))
         ON CONFLICT (organization_id, email) DO UPDATE
           SET name        = EXCLUDED.name,
               phone       = COALESCE(EXCLUDED.phone,        commerce_guardians.phone),
               family_code = COALESCE(EXCLUDED.family_code,  commerce_guardians.family_code),
               updated_at  = NOW()
         RETURNING id`,
        [
          body.organizationId,
          body.name,
          body.email,
          body.phone || null,
          body.familyCode || null,
          body.notificationPrefs ? JSON.stringify(body.notificationPrefs) : null
        ]
      );
      const { id } = g.rows[0];

      // Auto-link any students in the org that share the same family_code
      if (body.familyCode) {
        await client.query(
          `INSERT INTO commerce_guardian_students
             (guardian_id, student_id, organization_id, relationship)
           SELECT $1, c.id, $2, 'guardian'
           FROM commerce_customers c
           WHERE c.organization_id = $2
             AND c.family_code     = $3
             AND c.customer_type   = 'student'
           ON CONFLICT (guardian_id, student_id) DO NOTHING`,
          [id, body.organizationId, body.familyCode]
        );
      }

      return id;
    });

    const full = await pool.query(
      `${GUARDIAN_SELECT} WHERE g.id = $1 AND g.organization_id = $2 GROUP BY g.id`,
      [guardianRow, body.organizationId]
    );
    res.status(201).json({ data: full.rows[0] });
  })
);

// ── Update ───────────────────────────────────────────────────────────────────

guardiansRouter.patch(
  "/:id",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const guardianId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({
        organizationId:    z.string().uuid(),
        name:              z.string().min(1).optional(),
        phone:             z.string().nullable().optional(),
        familyCode:        z.string().nullable().optional(),
        active:            z.boolean().optional(),
        avatarPublicId:    z.string().nullable().optional(),
        notificationPrefs: z.object({
          email_on_purchase: z.boolean().optional(),
          low_balance_threshold_cents: z.number().int().min(0).optional()
        }).optional()
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const sets = ["updated_at = NOW()"];
    const vals = [body.organizationId, guardianId];

    if (body.name              !== undefined) { vals.push(body.name);                          sets.push(`name = $${vals.length}`); }
    if (body.phone             !== undefined) { vals.push(body.phone);                         sets.push(`phone = $${vals.length}`); }
    if (body.familyCode        !== undefined) { vals.push(body.familyCode);                    sets.push(`family_code = $${vals.length}`); }
    if (body.active            !== undefined) { vals.push(body.active);                        sets.push(`active = $${vals.length}`); }
    if (body.avatarPublicId    !== undefined) { vals.push(body.avatarPublicId);                sets.push(`avatar_public_id = $${vals.length}`); }
    if (body.notificationPrefs !== undefined) { vals.push(JSON.stringify(body.notificationPrefs)); sets.push(`notification_prefs = $${vals.length}::jsonb`); }

    await pool.query(
      `UPDATE commerce_guardians SET ${sets.join(", ")}
       WHERE organization_id = $1 AND id = $2`,
      vals
    );

    // Auto-link students that share the new family_code
    if (body.familyCode) {
      await pool.query(
        `INSERT INTO commerce_guardian_students
           (guardian_id, student_id, organization_id, relationship)
         SELECT $1, c.id, $2, 'guardian'
         FROM commerce_customers c
         WHERE c.organization_id = $2
           AND c.family_code     = $3
           AND c.customer_type   = 'student'
           AND c.active          = TRUE
         ON CONFLICT (guardian_id, student_id) DO NOTHING`,
        [guardianId, body.organizationId, body.familyCode]
      );
    }

    const full = await pool.query(
      `${GUARDIAN_SELECT} WHERE g.id = $2 AND g.organization_id = $1 GROUP BY g.id`,
      [body.organizationId, guardianId]
    );
    if (full.rowCount === 0) throw notFound("Guardian not found");
    res.json({ data: full.rows[0] });
  })
);

// ── Link student ─────────────────────────────────────────────────────────────

guardiansRouter.post(
  "/:id/students",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const guardianId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        studentId: z.string().uuid(),
        relationship: z.enum(["mother", "father", "guardian", "other"]).default("guardian"),
        isPrimary: z.boolean().default(false)
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    // Verify both guardian and student belong to this org before linking
    const [gCheck, sCheck] = await Promise.all([
      pool.query(
        `SELECT id FROM commerce_guardians WHERE id = $1 AND organization_id = $2 AND active = TRUE`,
        [guardianId, body.organizationId]
      ),
      pool.query(
        `SELECT id FROM commerce_customers WHERE id = $1 AND organization_id = $2`,
        [body.studentId, body.organizationId]
      ),
    ]);
    if (gCheck.rowCount === 0) throw notFound("Guardian not found");
    if (sCheck.rowCount === 0) throw notFound("Student not found");

    await pool.query(
      `INSERT INTO commerce_guardian_students
         (guardian_id, student_id, organization_id, relationship, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guardian_id, student_id) DO UPDATE
         SET relationship = EXCLUDED.relationship,
             is_primary   = EXCLUDED.is_primary`,
      [guardianId, body.studentId, body.organizationId, body.relationship, body.isPrimary]
    );
    res.json({ data: { ok: true } });
  })
);

// ── Send invite email ─────────────────────────────────────────────────────────

guardiansRouter.post(
  "/:id/send-invite",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const guardianId = z.string().uuid().parse(req.params.id);
    const { organizationId } = parseZod(z.object({ organizationId: z.string().uuid() }), req.body);
    authorizeTenant(req.actor, organizationId);

    const gResult = await pool.query(
      `SELECT id, name, email FROM commerce_guardians
       WHERE id = $1 AND organization_id = $2 AND active = TRUE`,
      [guardianId, organizationId]
    );
    if (gResult.rowCount === 0) throw notFound("Guardian not found");
    const g = gResult.rows[0];

    const token = generateSessionToken(); // 32-byte hex = distinct from 6-digit OTP
    const tokenHash = hashCode(token);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE commerce_guardian_magic_links SET used_at = NOW()
       WHERE guardian_id = $1 AND used_at IS NULL`,
      [guardianId]
    );
    await pool.query(
      `INSERT INTO commerce_guardian_magic_links
         (guardian_id, organization_id, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [guardianId, organizationId, tokenHash, expiresAt]
    );

    const orgResult = await pool.query(
      `SELECT name FROM commerce_organizations WHERE id = $1`,
      [organizationId]
    );
    const orgName = orgResult.rows[0]?.name ?? "Commerce POS";

    const students = await pool.query(
      `SELECT c.name FROM commerce_guardian_students gs
       JOIN commerce_customers c ON c.id = gs.student_id AND c.organization_id = $2
       WHERE gs.guardian_id = $1 AND gs.organization_id = $2`,
      [guardianId, organizationId]
    );
    const studentNames = students.rows.map((r) => r.name);

    const appUrl = process.env.APP_URL || "http://localhost:3100";
    const inviteUrl = `${appUrl}/parent/login?org=${organizationId}&invite=${token}`;

    const result = await sendEmail({
      to: g.email,
      ...buildInviteEmail({ guardianName: g.name, orgName, inviteUrl, studentNames })
    });

    if (!result.ok) {
      res.status(502).json({ error: `Invite link created but email failed to send: ${result.reason}` });
      return;
    }

    res.json({ data: { sent: true, to: g.email } });
  })
);

// ── Unlink student ────────────────────────────────────────────────────────────

guardiansRouter.delete(
  "/:id/students/:studentId",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const guardianId = z.string().uuid().parse(req.params.id);
    const studentId = z.string().uuid().parse(req.params.studentId);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);

    await pool.query(
      `DELETE FROM commerce_guardian_students
       WHERE guardian_id = $1 AND student_id = $2 AND organization_id = $3`,
      [guardianId, studentId, organizationId]
    );
    res.json({ data: { ok: true } });
  })
);

// ── CSV Import ────────────────────────────────────────────────────────────────

const guardianUpload = multer({
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

const GUARDIAN_CSV_ROW_SCHEMA = z.object({
  name:        z.string().min(1, "name is required"),
  email:       z.string().email("email must be a valid email address"),
  phone:       z.string().optional(),
  family_code: z.string().optional(),
});

function parseGuardianCsvRows(buffer) {
  const text = buffer.toString("utf8").replace(/^﻿/, ""); // strip BOM
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

// POST /v1/guardians/import/preview
guardiansRouter.post(
  "/import/preview",
  requirePermission("customers:write"),
  guardianUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    let rawRows;
    try {
      rawRows = parseGuardianCsvRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV — check the file format");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 500) throw badRequest("Max 500 rows per import");

    // Load existing guardian emails for this org
    const existing = await pool.query(
      `SELECT email FROM commerce_guardians WHERE organization_id = $1`,
      [organizationId]
    );
    const existingEmails = new Set(existing.rows.map((r) => r.email.toLowerCase()));

    // Bulk-fetch student counts per family_code for this org
    const familyCodes = rawRows.map((r) => r.family_code).filter(Boolean);
    let studentCountByCode = {};
    if (familyCodes.length > 0) {
      const counts = await pool.query(
        `SELECT family_code, COUNT(*) AS student_count
         FROM commerce_customers
         WHERE organization_id = $1 AND family_code = ANY($2) AND active = TRUE
         GROUP BY family_code`,
        [organizationId, familyCodes]
      );
      counts.rows.forEach((r) => { studentCountByCode[r.family_code] = Number(r.student_count); });
    }

    const preview = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2;
      const parsed = GUARDIAN_CSV_ROW_SCHEMA.safeParse(rawRows[i]);

      if (!parsed.success) {
        errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }

      const r = parsed.data;
      const normalizedEmail = r.email.toLowerCase().trim();
      const familyCode = r.family_code?.trim() || null;
      const action = existingEmails.has(normalizedEmail) ? "update" : "create";

      preview.push({
        row: rowNum,
        name: r.name.trim(),
        email: normalizedEmail,
        phone: r.phone?.trim() || null,
        familyCode,
        studentsLinked: familyCode ? (studentCountByCode[familyCode] || 0) : null,
        action,
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

// POST /v1/guardians/import/apply
guardiansRouter.post(
  "/import/apply",
  requirePermission("customers:write"),
  guardianUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    let rawRows;
    try {
      rawRows = parseGuardianCsvRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 500) throw badRequest("Max 500 rows per import");

    const results = { created: 0, updated: 0, errors: [] };

    await withTransaction(async (client) => {
      // Load existing emails inside the transaction
      const existing = await client.query(
        `SELECT email FROM commerce_guardians WHERE organization_id = $1`,
        [organizationId]
      );
      const existingEmails = new Set(existing.rows.map((r) => r.email.toLowerCase()));

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const parsed = GUARDIAN_CSV_ROW_SCHEMA.safeParse(rawRows[i]);

        if (!parsed.success) {
          results.errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
          continue;
        }

        const r = parsed.data;
        const normalizedEmail = r.email.toLowerCase().trim();
        const familyCode = r.family_code?.trim() || null;
        const isUpdate = existingEmails.has(normalizedEmail);

        try {
          const guardianResult = await client.query(
            `INSERT INTO commerce_guardians
               (organization_id, name, email, phone, family_code, active)
             VALUES ($1, $2, $3, $4, $5, TRUE)
             ON CONFLICT (organization_id, email) DO UPDATE
               SET name        = EXCLUDED.name,
                   phone       = COALESCE(EXCLUDED.phone, commerce_guardians.phone),
                   family_code = COALESCE(EXCLUDED.family_code, commerce_guardians.family_code),
                   updated_at  = NOW()
             RETURNING id`,
            [organizationId, r.name.trim(), normalizedEmail, r.phone?.trim() || null, familyCode]
          );

          const guardianId = guardianResult.rows[0].id;

          // Auto-link to all students sharing the same family_code
          if (familyCode) {
            await client.query(
              `INSERT INTO commerce_guardian_students (guardian_id, student_id, organization_id)
               SELECT $1, c.id, $2
               FROM commerce_customers c
               WHERE c.organization_id = $2
                 AND c.family_code     = $3
                 AND c.active          = TRUE
               ON CONFLICT (guardian_id, student_id) DO NOTHING`,
              [guardianId, organizationId, familyCode]
            );
          }

          if (isUpdate) {
            results.updated++;
          } else {
            results.created++;
            existingEmails.add(normalizedEmail);
          }
        } catch (err) {
          results.errors.push({ row: rowNum, name: r.name, error: err.message });
        }
      }
    });

    res.json({ data: results });
  })
);
