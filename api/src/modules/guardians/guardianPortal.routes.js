import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { asyncHandler, badRequest, notFound } from "../../shared/http/errors.js";
import { sendEmail, buildMagicLinkEmail } from "../../shared/email/emailClient.js";
import {
  generateSessionToken,
  generateOtpCode,
  hashCode,
  hashToken,
  serializeGuardianSessionCookie,
  clearGuardianSessionCookie,
  requireGuardianSession,
  GUARDIAN_SESSION_TTL_SECONDS
} from "./guardianAuth.js";

export const guardianPortalRouter = Router();

// ── Public: org info for the login page ─────────────────────────────────────

guardianPortalRouter.get(
  "/org/:orgId",
  asyncHandler(async (req, res) => {
    const orgId = z.string().uuid().parse(req.params.orgId);
    const result = await pool.query(
      `SELECT id, name, type FROM commerce_organizations WHERE id = $1 AND active = TRUE`,
      [orgId]
    );
    if (result.rowCount === 0) throw notFound("Organization not found");
    const { id, name, type } = result.rows[0];
    res.json({ data: { id, name, type } });
  })
);

// ── Auth: send magic code ────────────────────────────────────────────────────

guardianPortalRouter.post(
  "/auth/request",
  asyncHandler(async (req, res) => {
    const body = z.object({
      organizationId: z.string().uuid(),
      email: z.string().email().transform((e) => e.toLowerCase().trim())
    }).parse(req.body);

    const guardian = await pool.query(
      `SELECT id, name FROM commerce_guardians
       WHERE organization_id = $1 AND email = $2 AND active = TRUE`,
      [body.organizationId, body.email]
    );

    // Always return success — never leak whether an email is registered
    if (guardian.rowCount === 0) {
      res.json({ data: { sent: true } });
      return;
    }

    const g = guardian.rows[0];
    const code = generateOtpCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Invalidate any existing unused codes for this guardian
    await pool.query(
      `UPDATE commerce_guardian_magic_links
       SET used_at = NOW()
       WHERE guardian_id = $1 AND used_at IS NULL`,
      [g.id]
    );

    await pool.query(
      `INSERT INTO commerce_guardian_magic_links
         (guardian_id, organization_id, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [g.id, body.organizationId, codeHash, expiresAt]
    );

    const orgResult = await pool.query(
      `SELECT name FROM commerce_organizations WHERE id = $1`,
      [body.organizationId]
    );
    const orgName = orgResult.rows[0]?.name ?? "Commerce POS";

    const emailPayload = buildMagicLinkEmail({ guardianName: g.name, code, orgName });
    await sendEmail({ to: body.email, ...emailPayload });

    res.json({ data: { sent: true } });
  })
);

// ── Auth: verify code → issue session ────────────────────────────────────────

guardianPortalRouter.post(
  "/auth/verify",
  asyncHandler(async (req, res) => {
    const body = z.object({
      organizationId: z.string().uuid(),
      email: z.string().email().transform((e) => e.toLowerCase().trim()),
      code: z.string().length(6)
    }).parse(req.body);

    const codeHash = hashCode(body.code);

    const result = await pool.query(
      `UPDATE commerce_guardian_magic_links ml
       SET used_at = NOW()
       FROM commerce_guardians g
       WHERE ml.code_hash        = $1
         AND ml.organization_id  = $2
         AND ml.used_at         IS NULL
         AND ml.expires_at       > NOW()
         AND g.id                = ml.guardian_id
         AND g.email             = $3
         AND g.active            = TRUE
       RETURNING g.id AS "guardianId", g.name, g.email,
                 ml.organization_id AS "organizationId"`,
      [codeHash, body.organizationId, body.email]
    );

    if (result.rowCount === 0) throw badRequest("Código inválido o expirado");

    const row = result.rows[0];
    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + GUARDIAN_SESSION_TTL_SECONDS * 1000);

    await pool.query(
      `INSERT INTO commerce_guardian_sessions
         (guardian_id, organization_id, session_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [row.guardianId, row.organizationId, sessionTokenHash, expiresAt]
    );

    res.setHeader("Set-Cookie", serializeGuardianSessionCookie(sessionToken, {
      maxAge: GUARDIAN_SESSION_TTL_SECONDS
    }));

    res.json({
      data: {
        id: row.guardianId,
        name: row.name,
        email: row.email,
        organizationId: row.organizationId
      }
    });
  })
);

// ── Auth: accept invite link (direct URL token, no code entry) ───────────────

guardianPortalRouter.post(
  "/auth/accept-invite",
  asyncHandler(async (req, res) => {
    const body = z.object({
      organizationId: z.string().uuid(),
      token: z.string().min(1)
    }).parse(req.body);

    const tokenHash = hashCode(body.token);

    const result = await pool.query(
      `UPDATE commerce_guardian_magic_links ml
       SET used_at = NOW()
       FROM commerce_guardians g
       WHERE ml.code_hash        = $1
         AND ml.organization_id  = $2
         AND ml.used_at         IS NULL
         AND ml.expires_at       > NOW()
         AND g.id                = ml.guardian_id
         AND g.active            = TRUE
       RETURNING g.id AS "guardianId", g.name, g.email,
                 ml.organization_id AS "organizationId"`,
      [tokenHash, body.organizationId]
    );

    if (result.rowCount === 0) throw badRequest("Enlace inválido o expirado");

    const row = result.rows[0];
    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + GUARDIAN_SESSION_TTL_SECONDS * 1000);

    await pool.query(
      `INSERT INTO commerce_guardian_sessions
         (guardian_id, organization_id, session_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [row.guardianId, row.organizationId, sessionTokenHash, expiresAt]
    );

    res.setHeader("Set-Cookie", serializeGuardianSessionCookie(sessionToken, {
      maxAge: GUARDIAN_SESSION_TTL_SECONDS
    }));

    res.json({
      data: {
        id: row.guardianId,
        name: row.name,
        email: row.email,
        organizationId: row.organizationId
      }
    });
  })
);

// ── Auth: logout ─────────────────────────────────────────────────────────────

guardianPortalRouter.post(
  "/auth/logout",
  requireGuardianSession,
  asyncHandler(async (req, res) => {
    const cookieHeader = req.get("cookie") || "";
    const match = cookieHeader.match(/guardian_portal_session=([^;]+)/);
    if (match) {
      const tokenHash = hashToken(decodeURIComponent(match[1]));
      await pool.query(
        `DELETE FROM commerce_guardian_sessions WHERE session_token_hash = $1`,
        [tokenHash]
      );
    }
    res.setHeader("Set-Cookie", clearGuardianSessionCookie());
    res.json({ data: { ok: true } });
  })
);

// ── Me: guardian + all linked students + balances ────────────────────────────

guardianPortalRouter.get(
  "/me",
  requireGuardianSession,
  asyncHandler(async (req, res) => {
    const { guardianId, organizationId, name, email } = req.guardian;

    const [orgResult, prefsResult] = await Promise.all([
      pool.query(
        `SELECT name FROM commerce_organizations WHERE id = $1`,
        [organizationId]
      ),
      pool.query(
        `SELECT notification_prefs AS "notificationPrefs" FROM commerce_guardians WHERE id = $1`,
        [guardianId]
      )
    ]);

    const studentsResult = await pool.query(
      `SELECT c.id, c.name, c.active,
              c.avatar_public_id                 AS "avatarPublicId",
              gs.relationship,
              gs.is_primary                      AS "isPrimary",
              COALESCE(w.balance_cents, 0)        AS "balanceCents",
              COALESCE(w.currency, 'USD')         AS currency,
              COALESCE(w.credit_limit_cents, 0)   AS "creditLimitCents"
       FROM commerce_guardian_students gs
       JOIN commerce_customers c
         ON c.id = gs.student_id
       LEFT JOIN LATERAL (
         SELECT balance_cents, currency, credit_limit_cents
         FROM commerce_wallet_accounts
         WHERE customer_id = c.id AND organization_id = $2
         ORDER BY updated_at DESC
         LIMIT 1
       ) w ON true
       WHERE gs.guardian_id    = $1
         AND gs.organization_id = $2
         AND c.active           = TRUE
       ORDER BY gs.is_primary DESC, c.name ASC`,
      [guardianId, organizationId]
    );

    const students = await Promise.all(
      studentsResult.rows.map(async (student) => {
        const txResult = await pool.query(
          `SELECT o.id,
                  o.created_at     AS "createdAt",
                  o.total_cents    AS "totalCents",
                  p.method         AS "paymentMethod",
                  s.name           AS "storeName",
                  array_agg(
                    oi.name_snapshot ||
                    CASE WHEN oi.quantity > 1 THEN ' x' || oi.quantity ELSE '' END
                    ORDER BY oi.id
                  ) AS items
           FROM commerce_orders o
           JOIN commerce_order_items oi ON oi.order_id = o.id
           LEFT JOIN commerce_stores s  ON s.id = o.store_id
           LEFT JOIN commerce_payments p ON p.order_id = o.id AND p.organization_id = o.organization_id
           WHERE o.customer_id     = $1
             AND o.organization_id = $2
             AND o.status NOT IN ('voided', 'refunded')
           GROUP BY o.id, s.name, p.method
           ORDER BY o.created_at DESC
           LIMIT 5`,
          [student.id, organizationId]
        );
        return { ...student, recentTransactions: txResult.rows };
      })
    );

    res.json({
      data: {
        id: guardianId,
        name,
        email,
        organizationId,
        organizationName: orgResult.rows[0]?.name ?? "",
        notificationPrefs: prefsResult.rows[0]?.notificationPrefs ?? { email_on_purchase: true, low_balance_threshold_cents: 500 },
        students
      }
    });
  })
);

// ── Notification preferences ─────────────────────────────────────────────────

guardianPortalRouter.patch(
  "/me/notifications",
  requireGuardianSession,
  asyncHandler(async (req, res) => {
    const body = z.object({
      emailOnPurchase: z.boolean().optional(),
      lowBalanceThresholdCents: z.number().int().min(0).optional()
    }).parse(req.body);

    const { guardianId } = req.guardian;

    const updates = {};
    if (body.emailOnPurchase !== undefined) updates.email_on_purchase = body.emailOnPurchase;
    if (body.lowBalanceThresholdCents !== undefined) updates.low_balance_threshold_cents = body.lowBalanceThresholdCents;

    if (Object.keys(updates).length === 0) {
      res.json({ data: { ok: true } });
      return;
    }

    // Merge patch into existing JSONB — only update provided keys
    const setClauses = Object.keys(updates)
      .map((k, i) => `jsonb_build_object('${k}', $${i + 2}::jsonb)`)
      .join(" || ");
    const values = [guardianId, ...Object.values(updates).map((v) => JSON.stringify(v))];

    const result = await pool.query(
      `UPDATE commerce_guardians
       SET notification_prefs = notification_prefs || (${setClauses}),
           updated_at = NOW()
       WHERE id = $1
       RETURNING notification_prefs AS "notificationPrefs"`,
      values
    );

    res.json({ data: { notificationPrefs: result.rows[0]?.notificationPrefs } });
  })
);

// ── Student spending controls ─────────────────────────────────────────────────

guardianPortalRouter.get(
  "/students/:studentId/spending-controls",
  requireGuardianSession,
  asyncHandler(async (req, res) => {
    const studentId = z.string().uuid().parse(req.params.studentId);
    const { guardianId, organizationId } = req.guardian;

    const gsResult = await pool.query(
      `SELECT spending_controls AS "spendingControls"
       FROM commerce_guardian_students
       WHERE guardian_id = $1 AND student_id = $2 AND organization_id = $3`,
      [guardianId, studentId, organizationId]
    );
    if (gsResult.rowCount === 0) throw notFound("Student not found");

    const categoriesResult = await pool.query(
      `SELECT id, name FROM commerce_product_categories
       WHERE organization_id = $1 AND active = TRUE
       ORDER BY name ASC`,
      [organizationId]
    );

    res.json({
      data: {
        spendingControls: gsResult.rows[0].spendingControls,
        availableCategories: categoriesResult.rows
      }
    });
  })
);

guardianPortalRouter.patch(
  "/students/:studentId/spending-controls",
  requireGuardianSession,
  asyncHandler(async (req, res) => {
    const studentId = z.string().uuid().parse(req.params.studentId);
    const { guardianId, organizationId } = req.guardian;

    const body = z.object({
      dailyLimitCents: z.number().int().min(0).nullable().optional(),
      blockedCategoryIds: z.array(z.string().uuid()).optional()
    }).parse(req.body);

    const gsCheck = await pool.query(
      `SELECT id FROM commerce_guardian_students
       WHERE guardian_id = $1 AND student_id = $2 AND organization_id = $3`,
      [guardianId, studentId, organizationId]
    );
    if (gsCheck.rowCount === 0) throw notFound("Student not found");

    const current = (await pool.query(
      `SELECT spending_controls FROM commerce_guardian_students WHERE id = $1`,
      [gsCheck.rows[0].id]
    )).rows[0].spending_controls;

    const updated = {
      daily_limit_cents: body.dailyLimitCents !== undefined ? body.dailyLimitCents : current.daily_limit_cents,
      blocked_category_ids: body.blockedCategoryIds !== undefined ? body.blockedCategoryIds : current.blocked_category_ids
    };

    const result = await pool.query(
      `UPDATE commerce_guardian_students
       SET spending_controls = $2
       WHERE id = $1
       RETURNING spending_controls AS "spendingControls"`,
      [gsCheck.rows[0].id, JSON.stringify(updated)]
    );

    res.json({ data: { spendingControls: result.rows[0].spendingControls } });
  })
);

// ── Student transaction history ───────────────────────────────────────────────

guardianPortalRouter.get(
  "/students/:studentId/transactions",
  requireGuardianSession,
  asyncHandler(async (req, res) => {
    const studentId = z.string().uuid().parse(req.params.studentId);
    const { guardianId, organizationId } = req.guardian;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const access = await pool.query(
      `SELECT spending_controls AS "spendingControls"
       FROM commerce_guardian_students
       WHERE guardian_id = $1 AND student_id = $2 AND organization_id = $3`,
      [guardianId, studentId, organizationId]
    );
    if (access.rowCount === 0) throw notFound("Student not found");

    const studentResult = await pool.query(
      `SELECT c.id, c.name,
              c.avatar_public_id            AS "avatarPublicId",
              COALESCE(w.balance_cents, 0)  AS "balanceCents",
              COALESCE(w.currency, 'USD')   AS currency
       FROM commerce_customers c
       LEFT JOIN LATERAL (
         SELECT balance_cents, currency
         FROM commerce_wallet_accounts
         WHERE customer_id = c.id AND organization_id = $2
         ORDER BY updated_at DESC
         LIMIT 1
       ) w ON true
       WHERE c.id = $1 AND c.organization_id = $2`,
      [studentId, organizationId]
    );
    if (studentResult.rowCount === 0) throw notFound("Student not found");

    const txResult = await pool.query(
      `SELECT o.id,
              o.created_at     AS "createdAt",
              o.total_cents    AS "totalCents",
              p.method         AS "paymentMethod",
              o.status,
              s.name           AS "storeName",
              array_agg(
                oi.name_snapshot ||
                CASE WHEN oi.quantity > 1 THEN ' x' || oi.quantity ELSE '' END
                ORDER BY oi.id
              ) AS items
       FROM commerce_orders o
       JOIN commerce_order_items oi ON oi.order_id = o.id
       LEFT JOIN commerce_stores s  ON s.id = o.store_id
       LEFT JOIN commerce_payments p ON p.order_id = o.id AND p.organization_id = o.organization_id
       WHERE o.customer_id     = $1
         AND o.organization_id = $2
       GROUP BY o.id, s.name, p.method
       ORDER BY o.created_at DESC
       LIMIT $3`,
      [studentId, organizationId, limit]
    );

    res.json({
      data: {
        student: studentResult.rows[0],
        transactions: txResult.rows,
        spendingControls: access.rows[0].spendingControls
      }
    });
  })
);
