import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";

export const customersRouter = Router();

const CUSTOMER_SELECT = `
  SELECT id,
         organization_id    AS "organizationId",
         customer_type      AS "customerType",
         external_student_id AS "externalStudentId",
         external_parent_id  AS "externalParentId",
         external_id         AS "externalId",
         home_store_id       AS "homeStoreId",
         name, email, phone, active,
         avatar_public_id    AS "avatarPublicId",
         created_at          AS "createdAt"
  FROM commerce_customers
`;

const createCustomerSchema = z.object({
  organizationId: z.string().uuid(),
  externalStudentId: z.string().uuid().nullable().optional(),
  externalParentId: z.string().uuid().nullable().optional(),
  externalId: z.string().nullable().optional(),
  homeStoreId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional()
});

const updateCustomerSchema = z.object({
  organizationId:  z.string().uuid(),
  homeStoreId:     z.string().uuid().nullable().optional(),
  name:            z.string().min(1).optional(),
  email:           z.string().email().nullable().optional(),
  phone:           z.string().nullable().optional(),
  active:          z.boolean().optional(),
  avatarPublicId:  z.string().nullable().optional(),
});

// ── List ─────────────────────────────────────────────────────────────────────

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        homeStoreId: z.string().uuid().optional(),
        customerType: z.string().optional(),
        active: z.enum(["true", "false"]).optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200)
      }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId];
    const clauses = ["organization_id = $1"];

    if (query.homeStoreId) {
      values.push(query.homeStoreId);
      clauses.push(`home_store_id = $${values.length}`);
    }
    if (query.customerType) {
      values.push(query.customerType);
      clauses.push(`customer_type = $${values.length}`);
    }
    if (query.active !== undefined) {
      values.push(query.active === "true");
      clauses.push(`active = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      const n = values.length;
      clauses.push(`(name ILIKE $${n} OR email ILIKE $${n})`);
    }

    values.push(query.limit);
    const result = await pool.query(
      `${CUSTOMER_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY name ASC LIMIT $${values.length}`,
      values
    );
    res.json({ data: result.rows });
  })
);

// ── Get one ──────────────────────────────────────────────────────────────────

customersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customerId = z.string().uuid().parse(req.params.id);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `${CUSTOMER_SELECT} WHERE organization_id = $1 AND id = $2`,
      [organizationId, customerId]
    );
    if (result.rowCount === 0) throw notFound("Customer not found");
    res.json({ data: result.rows[0] });
  })
);

// ── Create ───────────────────────────────────────────────────────────────────

customersRouter.post(
  "/",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createCustomerSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    const result = await pool.query(
      `INSERT INTO commerce_customers
         (organization_id, external_student_id, external_parent_id, external_id,
          home_store_id, name, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, external_id)
         WHERE external_id IS NOT NULL
         DO UPDATE SET name          = EXCLUDED.name,
                       email         = COALESCE(EXCLUDED.email, commerce_customers.email),
                       phone         = COALESCE(EXCLUDED.phone, commerce_customers.phone),
                       home_store_id = COALESCE(EXCLUDED.home_store_id, commerce_customers.home_store_id)
       RETURNING id, organization_id AS "organizationId",
                 customer_type AS "customerType",
                 external_student_id AS "externalStudentId",
                 external_parent_id  AS "externalParentId",
                 external_id         AS "externalId",
                 home_store_id       AS "homeStoreId",
                 name, email, phone, active, created_at AS "createdAt"`,
      [
        body.organizationId,
        body.externalStudentId || null,
        body.externalParentId  || null,
        body.externalId        || null,
        body.homeStoreId       || null,
        body.name,
        body.email || null,
        body.phone || null
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);

// ── Update ───────────────────────────────────────────────────────────────────

customersRouter.patch(
  "/:id",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const customerId = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateCustomerSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    const sets = [];
    const vals = [body.organizationId, customerId];

    if (body.name            !== undefined) { vals.push(body.name);            sets.push(`name = $${vals.length}`); }
    if (body.email           !== undefined) { vals.push(body.email);           sets.push(`email = $${vals.length}`); }
    if (body.phone           !== undefined) { vals.push(body.phone);           sets.push(`phone = $${vals.length}`); }
    if (body.active          !== undefined) { vals.push(body.active);          sets.push(`active = $${vals.length}`); }
    if (body.homeStoreId     !== undefined) { vals.push(body.homeStoreId);     sets.push(`home_store_id = $${vals.length}`); }
    if (body.avatarPublicId  !== undefined) { vals.push(body.avatarPublicId);  sets.push(`avatar_public_id = $${vals.length}`); }

    if (sets.length === 0) throw badRequest("No fields to update");

    const result = await pool.query(
      `UPDATE commerce_customers SET ${sets.join(", ")}
       WHERE organization_id = $1 AND id = $2
       RETURNING id, organization_id AS "organizationId",
                 customer_type AS "customerType",
                 external_student_id AS "externalStudentId",
                 external_parent_id  AS "externalParentId",
                 external_id         AS "externalId",
                 home_store_id       AS "homeStoreId",
                 avatar_public_id    AS "avatarPublicId",
                 name, email, phone, active, created_at AS "createdAt"`,
      vals
    );
    if (result.rowCount === 0) throw notFound("Customer not found");
    res.json({ data: result.rows[0] });
  })
);

// ── Bulk CSV import ───────────────────────────────────────────────────────────

const importRowSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  homeStoreId: z.string().uuid().nullable().optional()
});

customersRouter.post(
  "/import",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        rows: z.array(importRowSchema).min(1).max(1000)
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    let imported = 0;
    const errors = [];

    await withTransaction(async (client) => {
      for (let i = 0; i < body.rows.length; i++) {
        const row = body.rows[i];
        try {
          await client.query(
            `INSERT INTO commerce_customers
               (organization_id, name, email, phone, external_id, home_store_id, customer_type)
             VALUES ($1, $2, $3, $4, $5, $6, 'student')
             ON CONFLICT (organization_id, external_id)
               WHERE external_id IS NOT NULL
               DO UPDATE SET name          = EXCLUDED.name,
                             email         = COALESCE(EXCLUDED.email, commerce_customers.email),
                             phone         = COALESCE(EXCLUDED.phone, commerce_customers.phone),
                             home_store_id = COALESCE(EXCLUDED.home_store_id, commerce_customers.home_store_id)`,
            [
              body.organizationId,
              row.name,
              row.email    || null,
              row.phone    || null,
              row.externalId   || null,
              row.homeStoreId  || null
            ]
          );
          imported++;
        } catch (err) {
          errors.push({ row: i + 1, name: row.name, error: err.message });
        }
      }
    });

    res.json({ data: { imported, errors } });
  })
);
