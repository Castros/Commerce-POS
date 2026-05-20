import crypto from "node:crypto";
import { promisify } from "node:util";

import { pool } from "../../db/client.js";

const pbkdf2Async = promisify(crypto.pbkdf2);

export const BROWSER_SESSION_COOKIE = "commerce_pos_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_ITERATIONS = 120000;
const PIN_KEY_LENGTH = 32;
const PIN_DIGEST = "sha256";

export function parseCookies(header = "") {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        return cookies;
      }

      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateBrowserSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function createPinSalt() {
  return crypto.randomBytes(16).toString("hex");
}

export async function hashPin(pin, salt = createPinSalt()) {
  const hash = await pbkdf2Async(pin, salt, PIN_ITERATIONS, PIN_KEY_LENGTH, PIN_DIGEST);
  return {
    salt,
    hash: hash.toString("hex")
  };
}

export async function verifyPin(pin, salt, hash) {
  const next = await hashPin(pin, salt);
  return crypto.timingSafeEqual(Buffer.from(next.hash, "hex"), Buffer.from(hash, "hex"));
}

function cookieSuffix(options = {}) {
  const parts = [];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts;
}

export function serializeBrowserSessionCookie(token, options = {}) {
  const parts = [`${BROWSER_SESSION_COOKIE}=${encodeURIComponent(token)}`];
  parts.push(...cookieSuffix({ path: "/", httpOnly: true, sameSite: "Lax", ...options }));
  return parts.join("; ");
}

export function clearBrowserSessionCookie() {
  return serializeBrowserSessionCookie("", {
    maxAge: 0,
    expires: new Date(0)
  });
}

export async function createBrowserSession(client, { organizationId, userId }) {
  const sessionToken = generateBrowserSessionToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await client.query(
    `
      UPDATE commerce_browser_sessions
      SET active = FALSE
      WHERE organization_id = $1
        AND user_id = $2
        AND active = TRUE
    `,
    [organizationId, userId]
  );

  const session = await client.query(
    `
      INSERT INTO commerce_browser_sessions (
        organization_id,
        user_id,
        session_token_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, organization_id AS "organizationId", user_id AS "userId", expires_at AS "expiresAt"
    `,
    [organizationId, userId, sessionTokenHash, expiresAt]
  );

  return {
    token: sessionToken,
    session: session.rows[0]
  };
}

export async function resolveBrowserSessionFromRequest(req) {
  const cookies = parseCookies(req.get("cookie") || "");
  const token = cookies[BROWSER_SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const result = await pool.query(
    `
      UPDATE commerce_browser_sessions s
      SET last_used_at = NOW()
      FROM commerce_users u
      WHERE s.session_token_hash = $1
        AND s.active = TRUE
        AND s.expires_at > NOW()
        AND u.organization_id = s.organization_id
        AND u.id = s.user_id
        AND u.active = TRUE
      RETURNING s.id, s.organization_id AS "organizationId", s.user_id AS "userId",
                s.expires_at AS "expiresAt",
                u.name AS "userName", u.email AS "userEmail", u.role
    `,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    expiresAt: row.expiresAt,
    userName: row.userName,
    userEmail: row.userEmail,
    role: row.role,
    authMode: "browser_session"
  };
}

export async function revokeBrowserSession(token) {
  const tokenHash = hashToken(token);
  await pool.query(
    `
      UPDATE commerce_browser_sessions
      SET active = FALSE
      WHERE session_token_hash = $1
    `,
    [tokenHash]
  );
}

