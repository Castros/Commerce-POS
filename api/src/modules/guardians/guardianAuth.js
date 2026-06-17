import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "../../db/client.js";
import { parseCookies } from "../../shared/auth/browserAuth.js";
import { unauthorized } from "../../shared/http/errors.js";

const pbkdf2Async = promisify(crypto.pbkdf2);
const PASS_ITERATIONS = 100000;
const PASS_KEY_LENGTH = 32;
const PASS_DIGEST    = "sha256";
const PASS_SALT_LEN  = 16;

export async function hashGuardianPassword(password) {
  const salt = crypto.randomBytes(PASS_SALT_LEN).toString("hex");
  const key  = await pbkdf2Async(password, salt, PASS_ITERATIONS, PASS_KEY_LENGTH, PASS_DIGEST);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyGuardianPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const key = await pbkdf2Async(password, salt, PASS_ITERATIONS, PASS_KEY_LENGTH, PASS_DIGEST);
  const keyHex      = key.toString("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf   = Buffer.from(keyHex,   "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export const GUARDIAN_SESSION_COOKIE = "guardian_portal_session";
export const GUARDIAN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function serializeGuardianSessionCookie(token, options = {}) {
  const parts = [`${GUARDIAN_SESSION_COOKIE}=${encodeURIComponent(token)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  parts.push("HttpOnly");
  parts.push("SameSite=Strict");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearGuardianSessionCookie() {
  return serializeGuardianSessionCookie("", { maxAge: 0 });
}

export async function resolveGuardianSession(req) {
  const cookies = parseCookies(req.get("cookie") || "");
  const token = cookies[GUARDIAN_SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const result = await pool.query(
    `UPDATE commerce_guardian_sessions s
     SET last_used_at = NOW()
     FROM commerce_guardians g
     WHERE s.session_token_hash = $1
       AND s.expires_at > NOW()
       AND g.id = s.guardian_id
       AND g.active = TRUE
     RETURNING s.id, s.guardian_id AS "guardianId",
               s.organization_id  AS "organizationId",
               g.name, g.email, g.family_code AS "familyCode"`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export function requireGuardianSession(req, _res, next) {
  resolveGuardianSession(req)
    .then((session) => {
      if (!session) {
        next(unauthorized("Guardian authentication required"));
        return;
      }
      req.guardian = session;
      next();
    })
    .catch(next);
}
