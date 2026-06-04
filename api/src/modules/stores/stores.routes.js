import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, parseZod } from "../../shared/http/errors.js";

export const storesRouter = Router();

const storeTypes = [
  "cafeteria",
  "uniform_shop",
  "bookstore",
  "school_supplies",
  "restaurant",
  "retail",
  "event_sales",
  "other"
];

const createStoreSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(storeTypes).default("cafeteria"),
  externalSchoolId: z.string().uuid().nullable().optional()
});

storesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);
    const result = await pool.query(
      `
        SELECT id, organization_id AS "organizationId", name, type, active, created_at AS "createdAt"
        FROM commerce_stores
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `,
      [organizationId]
    );
    res.json({ data: result.rows });
  })
);

storesRouter.post(
  "/",
  requirePermission("stores:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createStoreSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);
    const result = await pool.query(
      `
        INSERT INTO commerce_stores (organization_id, name, type, external_school_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, organization_id AS "organizationId", name, type, active, created_at AS "createdAt"
      `,
      [body.organizationId, body.name, body.type, body.externalSchoolId || null]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);
