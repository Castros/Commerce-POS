import crypto from "node:crypto";

import { pool } from "../../db/client.js";
import { resolveBrowserSessionFromRequest } from "./browserAuth.js";
import { forbidden, unauthorized } from "../http/errors.js";

const rolePermissions = {
  platform_admin: ["*"],
  super_admin: ["*"],
  organization_owner: ["*"],
  organization_admin: [
    "organizations:write",
    "stores:write",
    "products:write",
    "customers:write",
    "wallets:write",
    "orders:write",
    "reports:read",
    "credentials:write"
  ],
  store_manager: [
    "products:write",
    "customers:write",
    "wallets:write",
    "orders:write",
    "reports:read",
    "credentials:write"
  ],
  cashier: ["customers:write", "wallets:topup", "orders:write"],
  accountant: ["wallets:write", "orders:read", "reports:read"],
  parent: ["orders:read"],
  customer: ["orders:read"],
  service: [
    "organizations:write",
    "stores:write",
    "products:write",
    "customers:write",
    "wallets:write",
    "wallets:topup",
    "orders:write",
    "reports:read",
    "credentials:write"
  ]
};

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hasPermission(role, permission) {
  const permissions = rolePermissions[role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

async function resolveBearerActor(token) {
  if (process.env.COMMERCE_API_TOKEN && token === process.env.COMMERCE_API_TOKEN) {
    return {
      actorUserId: null,
      actorService: "env-api-token",
      role: "service",
      organizationId: null,
      authMode: "env_token"
    };
  }

  const tokenHash = hashToken(token);
  const result = await pool.query(
    `
      UPDATE commerce_service_tokens
      SET last_used_at = NOW()
      WHERE token_hash = $1
        AND active = TRUE
      RETURNING id, organization_id AS "organizationId", name, role
    `,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    actorUserId: null,
    actorService: row.name,
    role: row.role,
    organizationId: row.organizationId,
    authMode: "service_token"
  };
}

function resolveDevActor(req) {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEV_AUTH) {
    return null;
  }

  return {
    actorUserId: req.get("x-actor-user-id") || null,
    actorService: req.get("x-actor-service") || "dev-api",
    role: req.get("x-actor-role") || "service",
    organizationId: req.get("x-organization-id") || null,
    authMode: "dev"
  };
}

export async function authenticateRequest(req, _res, next) {
  try {
    const browserSession = await resolveBrowserSessionFromRequest(req);
    if (browserSession) {
      req.actor = {
        actorUserId: browserSession.userId,
        actorService: null,
        role: browserSession.role,
        organizationId: browserSession.organizationId,
        authMode: browserSession.authMode
      };
      next();
      return;
    }

    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (match) {
      const actor = await resolveBearerActor(match[1]);
      if (!actor) {
        throw unauthorized("Invalid bearer token");
      }
      req.actor = actor;
      next();
      return;
    }

    const devActor = resolveDevActor(req);
    if (!devActor) {
      throw unauthorized("Authentication required");
    }

    req.actor = devActor;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    const actor = req.actor;
    if (!actor) {
      next(unauthorized("Authentication required"));
      return;
    }

    if (!hasPermission(actor.role, permission)) {
      next(forbidden("Permission denied"));
      return;
    }

    next();
  };
}

export function getActor(req) {
  return req.actor || {
    actorUserId: null,
    actorService: "unknown",
    role: "service",
    organizationId: null,
    authMode: "unknown"
  };
}

const PLATFORM_ROLES = new Set(["platform_admin", "super_admin", "service"]);
const STORE_UNRESTRICTED_ROLES = new Set([
  "platform_admin", "super_admin", "organization_owner", "organization_admin", "service"
]);

export function authorizeTenant(actor, organizationId) {
  if (!actor) throw forbidden("Access denied");
  if (PLATFORM_ROLES.has(actor.role)) return;
  if (!actor.organizationId || actor.organizationId !== organizationId) {
    throw forbidden("Access denied");
  }
}

export async function authorizeStore(actor, organizationId, storeId) {
  authorizeTenant(actor, organizationId);
  if (!storeId || STORE_UNRESTRICTED_ROLES.has(actor.role)) return;
  if (!actor.actorUserId) return;
  const result = await pool.query(
    `SELECT 1 FROM commerce_user_store_assignments
     WHERE organization_id = $1 AND user_id = $2 AND store_id = $3`,
    [organizationId, actor.actorUserId, storeId]
  );
  if (result.rowCount === 0) throw forbidden("Not assigned to this store");
}

const CATEGORY_UNRESTRICTED_ROLES = new Set([
  "platform_admin", "super_admin", "organization_owner", "organization_admin", "service"
]);

// Returns null (unrestricted) or an array of permitted category UUIDs.
// Zero rows in the permissions table = unrestricted (same as current behavior).
export async function loadActorCategoryRestrictions(organizationId, actorUserId, actorRole) {
  if (!actorUserId || CATEGORY_UNRESTRICTED_ROLES.has(actorRole)) return null;
  const result = await pool.query(
    `SELECT category_id AS "categoryId"
     FROM commerce_user_category_permissions
     WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, actorUserId]
  );
  if (result.rowCount === 0) return null;
  return result.rows.map((r) => r.categoryId);
}
