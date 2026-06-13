import { pool } from "../../db/client.js";
import { asyncHandler } from "../http/errors.js";
import { getActor } from "./auth.js";

const PLATFORM_ROLES = new Set(["platform_admin", "super_admin", "service"]);

/**
 * Middleware that checks whether the actor's organization has a feature enabled.
 * Platform admins always pass. Missing feature key defaults to enabled (backwards compat).
 */
export function requireFeature(featureName) {
  return asyncHandler(async (req, res, next) => {
    const actor = getActor(req);
    if (PLATFORM_ROLES.has(actor.role)) return next();

    if (!actor.organizationId) {
      res.status(403).json({ error: "No organization context" });
      return;
    }

    const result = await pool.query(
      "SELECT features FROM commerce_organizations WHERE id = $1",
      [actor.organizationId]
    );

    const org = result.rows[0];
    if (!org) {
      res.status(403).json({ error: "Organization not found" });
      return;
    }

    const enabled = org.features?.[featureName] ?? true;
    if (!enabled) {
      res.status(403).json({ error: `Feature "${featureName}" is not enabled for this organization` });
      return;
    }

    next();
  });
}
