import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";

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
        SELECT id, organization_id AS "organizationId", name, type, active,
               image_public_id AS "imagePublicId", created_at AS "createdAt"
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
        RETURNING id, organization_id AS "organizationId", name, type, active,
                  image_public_id AS "imagePublicId", created_at AS "createdAt"
      `,
      [body.organizationId, body.name, body.type, body.externalSchoolId || null]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);

const updateStoreSchema = z.object({
  organizationId:  z.string().uuid(),
  name:            z.string().min(1).optional(),
  type:            z.enum(storeTypes).optional(),
  active:          z.boolean().optional(),
  imagePublicId:   z.string().nullable().optional(),
});

storesRouter.patch(
  "/:id",
  requirePermission("stores:write"),
  asyncHandler(async (req, res) => {
    const storeId = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateStoreSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    const sets = [];
    const vals = [body.organizationId, storeId];

    if (body.name           !== undefined) { vals.push(body.name);           sets.push(`name = $${vals.length}`); }
    if (body.type           !== undefined) { vals.push(body.type);           sets.push(`type = $${vals.length}`); }
    if (body.active         !== undefined) { vals.push(body.active);         sets.push(`active = $${vals.length}`); }
    if (body.imagePublicId  !== undefined) { vals.push(body.imagePublicId);  sets.push(`image_public_id = $${vals.length}`); }

    if (sets.length === 0) throw badRequest("No fields to update");

    const result = await pool.query(
      `UPDATE commerce_stores SET ${sets.join(", ")}
       WHERE organization_id = $1 AND id = $2
       RETURNING id, organization_id AS "organizationId", name, type, active,
                 image_public_id AS "imagePublicId", created_at AS "createdAt"`,
      vals
    );
    if (result.rowCount === 0) throw notFound("Store not found");
    res.json({ data: result.rows[0] });
  })
);
