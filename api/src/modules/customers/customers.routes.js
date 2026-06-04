import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, parseZod } from "../../shared/http/errors.js";

export const customersRouter = Router();

const createCustomerSchema = z.object({
  organizationId: z.string().uuid(),
  externalStudentId: z.string().uuid().nullable().optional(),
  externalParentId: z.string().uuid().nullable().optional(),
  externalId: z.string().nullable().optional(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional()
});

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);
    const result = await pool.query(
      `
        SELECT id, organization_id AS "organizationId",
               external_student_id AS "externalStudentId",
               external_parent_id AS "externalParentId",
               external_id AS "externalId",
               name, email, phone, active, created_at AS "createdAt"
        FROM commerce_customers
        WHERE organization_id = $1
        ORDER BY created_at DESC
      `,
      [organizationId]
    );
    res.json({ data: result.rows });
  })
);

customersRouter.post(
  "/",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createCustomerSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);
    const result = await pool.query(
      `
        INSERT INTO commerce_customers (
          organization_id,
          external_student_id,
          external_parent_id,
          external_id,
          name,
          email,
          phone
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (organization_id, external_id)
          WHERE external_id IS NOT NULL
          DO UPDATE SET name = EXCLUDED.name,
                        email = COALESCE(EXCLUDED.email, commerce_customers.email),
                        phone = COALESCE(EXCLUDED.phone, commerce_customers.phone)
        RETURNING id, organization_id AS "organizationId",
                  external_student_id AS "externalStudentId",
                  external_parent_id AS "externalParentId",
                  external_id AS "externalId",
                  name, email, phone, active, created_at AS "createdAt"
      `,
      [
        body.organizationId,
        body.externalStudentId || null,
        body.externalParentId || null,
        body.externalId || null,
        body.name,
        body.email || null,
        body.phone || null
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);
