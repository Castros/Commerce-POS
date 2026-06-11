import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, forbidden, parseZod } from "../../shared/http/errors.js";

const PLATFORM_ROLES = new Set(["platform_admin", "super_admin", "service"]);

export const organizationsRouter = Router();

const ORG_TYPES = ["school", "restaurant", "retail_business", "nonprofit", "other"];

const createOrganizationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(ORG_TYPES).default("school"),
  externalSchoolId: z.string().uuid().nullable().optional()
});

const updateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(ORG_TYPES).optional(),
  currency: z.string().min(1).max(3).optional(),
  taxEnabled: z.boolean().optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  contactEmail: z.string().email().nullable().optional(),
  active: z.boolean().optional()
});

const ORG_COLUMNS = `
  id, name, type, external_school_id AS "externalSchoolId",
  active, currency, tax_enabled AS "taxEnabled",
  tax_rate_bps AS "taxRateBps", contact_email AS "contactEmail",
  created_at AS "createdAt"
`;

organizationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const scope = req.query.scope || "all";
    const shouldScopeToActor =
      scope === "mine" || !["platform_admin", "super_admin", "service"].includes(actor.role);

    if (shouldScopeToActor && !actor.organizationId) {
      res.json({ data: [] });
      return;
    }

    const whereClause = shouldScopeToActor ? "WHERE id = $1" : "";
    const values = shouldScopeToActor ? [actor.organizationId] : [];
    const result = await pool.query(
      `SELECT ${ORG_COLUMNS} FROM commerce_organizations ${whereClause} ORDER BY created_at DESC`,
      values
    );
    res.json({ data: result.rows });
  })
);

organizationsRouter.post(
  "/",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    if (!PLATFORM_ROLES.has(actor.role)) {
      throw forbidden("Only platform administrators can create organizations");
    }
    const body = parseZod(createOrganizationSchema, req.body);
    const result = await pool.query(
      `INSERT INTO commerce_organizations (name, type, external_school_id)
       VALUES ($1, $2, $3)
       RETURNING ${ORG_COLUMNS}`,
      [body.name, body.type, body.externalSchoolId || null]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);

organizationsRouter.patch(
  "/:id",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateOrganizationSchema, req.body);
    const actor = getActor(req);
    authorizeTenant(actor, id);

    const result = await pool.query(
      `UPDATE commerce_organizations
       SET name          = COALESCE($2, name),
           type          = COALESCE($3, type),
           currency      = COALESCE($4, currency),
           tax_enabled   = COALESCE($5, tax_enabled),
           tax_rate_bps  = COALESCE($6, tax_rate_bps),
           active        = COALESCE($7, active),
           contact_email = COALESCE($8, contact_email)
       WHERE id = $1
       RETURNING ${ORG_COLUMNS}`,
      [
        id,
        body.name ?? null,
        body.type ?? null,
        body.currency ?? null,
        body.taxEnabled ?? null,
        body.taxRateBps ?? null,
        body.active ?? null,
        body.contactEmail ?? null
      ]
    );

    if (!result.rows[0]) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    res.json({ data: result.rows[0] });
  })
);
