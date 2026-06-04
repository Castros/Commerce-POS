import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { pool } from "../../db/client.js";
import {
  clearBrowserSessionCookie,
  createBrowserSession,
  parseCookies,
  resolveBrowserSessionFromRequest,
  revokeBrowserSession,
  serializeBrowserSessionCookie,
  SESSION_TTL_SECONDS,
  verifyPin,
  BROWSER_SESSION_COOKIE
} from "../../shared/auth/browserAuth.js";
import { asyncHandler, unauthorized } from "../../shared/http/errors.js";

export const authRouter = Router();

const loginRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Please wait a minute and try again." },
  standardHeaders: true,
  legacyHeaders: false
});

const loginSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  identifier: z.string().min(1).nullable().optional(),
  pin: z.string().min(3)
});

function buildSessionCookie(token) {
  const secure = process.env.NODE_ENV === "production";
  return serializeBrowserSessionCookie(token, {
    secure,
    sameSite: "Strict",
    maxAge: SESSION_TTL_SECONDS
  });
}

async function resolveUserForLogin({ organizationId, identifier, pin }) {
  const normalizedIdentifier = identifier?.trim().toLowerCase() || null;

  const rows = (
    await pool.query(
      `
        SELECT id, organization_id AS "organizationId", email, name, role, active,
               pin_hash AS "pinHash", pin_salt AS "pinSalt"
        FROM commerce_users
        WHERE active = TRUE
          AND ($1::uuid IS NULL OR organization_id = $1)
          AND (
            $2::text IS NULL
            OR lower(coalesce(email, '')) = $2
            OR lower(coalesce(name, '')) = $2
          )
        ORDER BY created_at DESC
      `,
      [organizationId || null, normalizedIdentifier]
    )
  ).rows;

  for (const user of rows) {
    if (!user.pinHash || !user.pinSalt) {
      continue;
    }

    if (await verifyPin(pin, user.pinSalt, user.pinHash)) {
      return user;
    }
  }

  if (identifier || organizationId) {
    return null;
  }

  const fallbackRows = (
    await pool.query(
      `
        SELECT id, organization_id AS "organizationId", email, name, role, active,
               pin_hash AS "pinHash", pin_salt AS "pinSalt"
        FROM commerce_users
        WHERE active = TRUE
        ORDER BY created_at DESC
      `
    )
  ).rows;

  for (const user of fallbackRows) {
    if (!user.pinHash || !user.pinSalt) {
      continue;
    }

    if (await verifyPin(pin, user.pinSalt, user.pinHash)) {
      return user;
    }
  }

  return null;
}

authRouter.get(
  "/orgs",
  asyncHandler(async (req, res) => {
    const q = z.string().min(1).max(100).optional().parse(req.query.q);
    if (!q) {
      res.json({ data: [] });
      return;
    }
    const result = await pool.query(
      `
        SELECT id, name, type
        FROM commerce_organizations
        WHERE active = TRUE
          AND name ILIKE $1
        ORDER BY name ASC
        LIMIT 10
      `,
      [`%${q}%`]
    );
    res.json({ data: result.rows });
  })
);

authRouter.post(
  "/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await resolveUserForLogin(body);

    if (!user) {
      throw unauthorized("Invalid staff PIN or identifier");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const created = await createBrowserSession(client, {
        organizationId: user.organizationId,
        userId: user.id
      });

      const assignments = await client.query(
        `
          SELECT store_id AS "storeId"
          FROM commerce_user_store_assignments
          WHERE organization_id = $1
            AND user_id = $2
          ORDER BY created_at ASC
        `,
        [user.organizationId, user.id]
      );

      await client.query("COMMIT");
      res.setHeader("Set-Cookie", buildSessionCookie(created.token));

      res.json({
        data: {
          user: {
            id: user.id,
            organizationId: user.organizationId,
            email: user.email,
            name: user.name,
            role: user.role,
            active: user.active,
            storeIds: assignments.rows.map((row) => row.storeId)
          },
          session: {
            expiresAt: created.session.expiresAt
          }
        }
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => null);
      throw err;
    } finally {
      client.release();
    }
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.get("cookie") || "");
    const token = cookies[BROWSER_SESSION_COOKIE];

    if (token) {
      await revokeBrowserSession(token);
    }

    res.setHeader("Set-Cookie", clearBrowserSessionCookie());
    res.json({ data: { loggedOut: true } });
  })
);

authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const browserSession = await resolveBrowserSessionFromRequest(req);
    if (!browserSession) {
      throw unauthorized("Login required");
    }

    const result = await pool.query(
      `
        SELECT u.id, u.organization_id AS "organizationId", u.email, u.name, u.role, u.active,
               u.pin_last4 AS "pinLast4", u.pin_set_at AS "pinSetAt",
               o.name AS "organizationName"
        FROM commerce_users u
        JOIN commerce_organizations o ON o.id = u.organization_id
        WHERE u.id = $1
          AND u.organization_id = $2
          AND u.active = TRUE
        LIMIT 1
      `,
      [browserSession.userId, browserSession.organizationId]
    );

    const user = result.rows[0];
    if (!user) {
      throw unauthorized("Login required");
    }

    const assignments = await pool.query(
      `
        SELECT store_id AS "storeId"
        FROM commerce_user_store_assignments
        WHERE organization_id = $1
          AND user_id = $2
        ORDER BY created_at ASC
      `,
      [user.organizationId, user.id]
    );

    res.json({
      data: {
        user: {
          id: user.id,
          organizationId: user.organizationId,
          organizationName: user.organizationName,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
          pinLast4: user.pinLast4,
          pinSetAt: user.pinSetAt,
          storeIds: assignments.rows.map((row) => row.storeId)
        },
        authMode: browserSession.authMode
      }
    });
  })
);

authRouter.get(
  "/options",
  asyncHandler(async (req, res) => {
    const browserSession = await resolveBrowserSessionFromRequest(req);
    const organizationId = z.string().uuid().optional().parse(req.query.organizationId);

    if (process.env.NODE_ENV === "production" && !browserSession && !organizationId) {
      throw unauthorized("Organization context required");
    }

    const effectiveOrgId = browserSession?.organizationId || organizationId || null;

    if (!effectiveOrgId) {
      res.json({ data: [] });
      return;
    }

    const result = await pool.query(
      `
        SELECT id, organization_id AS "organizationId", email, name, role, active, pin_last4 AS "pinLast4"
        FROM commerce_users
        WHERE active = TRUE
          AND ($1::uuid IS NULL OR organization_id = $1)
        ORDER BY created_at ASC
      `,
      [effectiveOrgId]
    );

    res.json({
      data: result.rows.map((user) => ({
        ...user,
        displayName: user.name || user.email || user.id
      }))
    });
  })
);
