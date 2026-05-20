import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, parseZod } from "../../shared/http/errors.js";

export const organizationsRouter = Router();

const createOrganizationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["school", "restaurant", "retail_business", "nonprofit", "other"]).default("school"),
  externalSchoolId: z.string().uuid().nullable().optional()
});

organizationsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `
        SELECT id, name, type, external_school_id AS "externalSchoolId", active, created_at AS "createdAt"
        FROM commerce_organizations
        ORDER BY created_at DESC
      `
    );
    res.json({ data: result.rows });
  })
);

organizationsRouter.post(
  "/",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createOrganizationSchema, req.body);
    const result = await pool.query(
      `
        INSERT INTO commerce_organizations (name, type, external_school_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, type, external_school_id AS "externalSchoolId", active, created_at AS "createdAt"
      `,
      [body.name, body.type, body.externalSchoolId || null]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);
