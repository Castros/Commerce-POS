import { Router } from "express";
import { z } from "zod";

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
      `${GUARDIAN_SELECT} WHERE g.id = $1 GROUP BY g.id`,
      [guardianRow]
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
       JOIN commerce_customers c ON c.id = gs.student_id
       WHERE gs.guardian_id = $1`,
      [guardianId]
    );
    const studentNames = students.rows.map((r) => r.name);

    const appUrl = process.env.APP_URL || "http://localhost:3100";
    const inviteUrl = `${appUrl}/parent/login?org=${organizationId}&invite=${token}`;

    await sendEmail({
      to: g.email,
      ...buildInviteEmail({ guardianName: g.name, orgName, inviteUrl, studentNames })
    });

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
