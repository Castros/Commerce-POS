import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { parse as parseCsv } from "csv-parse/sync";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const customersRouter = Router();

const CUSTOMER_SELECT = `
  SELECT id,
         organization_id    AS "organizationId",
         customer_type      AS "customerType",
         external_student_id AS "externalStudentId",
         external_parent_id  AS "externalParentId",
         external_id         AS "externalId",
         home_store_id       AS "homeStoreId",
         family_code         AS "familyCode",
         first_name          AS "firstName",
         middle_name         AS "middleName",
         last_name_1         AS "lastName1",
         last_name_2         AS "lastName2",
         name, email, phone, active,
         avatar_public_id    AS "avatarPublicId",
         created_at          AS "createdAt"
  FROM commerce_customers
`;

function buildFullName({ firstName, middleName, lastName1, lastName2, name }) {
  const parts = [firstName, middleName, lastName1, lastName2].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : (name || "");
}

const createCustomerSchema = z.object({
  organizationId:    z.string().uuid(),
  externalStudentId: z.string().uuid().nullable().optional(),
  externalParentId:  z.string().uuid().nullable().optional(),
  externalId:        z.string().nullable().optional(),
  homeStoreId:       z.string().uuid().nullable().optional(),
  // Structured name fields (preferred for manual entry)
  firstName:         z.string().min(1).optional(),
  middleName:        z.string().nullable().optional(),
  lastName1:         z.string().min(1).optional(),
  lastName2:         z.string().nullable().optional(),
  // Legacy full-name field (CSV imports, integrations)
  name:              z.string().min(1).optional(),
  email:             z.string().email().nullable().optional(),
  phone:             z.string().nullable().optional()
}).refine((d) => d.name || d.firstName, { message: "Either name or firstName is required" });

const updateCustomerSchema = z.object({
  organizationId: z.string().uuid(),
  homeStoreId:    z.string().uuid().nullable().optional(),
  firstName:      z.string().min(1).optional(),
  middleName:     z.string().nullable().optional(),
  lastName1:      z.string().min(1).optional(),
  lastName2:      z.string().nullable().optional(),
  name:           z.string().min(1).optional(),
  email:          z.string().email().nullable().optional(),
  phone:          z.string().nullable().optional(),
  active:         z.boolean().optional(),
  avatarPublicId: z.string().nullable().optional(),
  familyCode:     z.string().nullable().optional(),
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

    const fullName = buildFullName({ firstName: body.firstName, middleName: body.middleName, lastName1: body.lastName1, lastName2: body.lastName2, name: body.name });

    const result = await pool.query(
      `INSERT INTO commerce_customers
         (organization_id, external_student_id, external_parent_id, external_id,
          home_store_id, name, first_name, middle_name, last_name_1, last_name_2,
          email, phone, family_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (organization_id, external_id)
         WHERE external_id IS NOT NULL
         DO UPDATE SET name          = EXCLUDED.name,
                       first_name    = COALESCE(EXCLUDED.first_name, commerce_customers.first_name),
                       middle_name   = COALESCE(EXCLUDED.middle_name, commerce_customers.middle_name),
                       last_name_1   = COALESCE(EXCLUDED.last_name_1, commerce_customers.last_name_1),
                       last_name_2   = COALESCE(EXCLUDED.last_name_2, commerce_customers.last_name_2),
                       email         = COALESCE(EXCLUDED.email, commerce_customers.email),
                       phone         = COALESCE(EXCLUDED.phone, commerce_customers.phone),
                       home_store_id = COALESCE(EXCLUDED.home_store_id, commerce_customers.home_store_id),
                       family_code   = COALESCE(EXCLUDED.family_code, commerce_customers.family_code)
       RETURNING id, organization_id AS "organizationId",
                 customer_type AS "customerType",
                 external_student_id AS "externalStudentId",
                 external_parent_id  AS "externalParentId",
                 external_id         AS "externalId",
                 home_store_id       AS "homeStoreId",
                 family_code         AS "familyCode",
                 first_name AS "firstName", middle_name AS "middleName",
                 last_name_1 AS "lastName1", last_name_2 AS "lastName2",
                 name, email, phone, active, created_at AS "createdAt"`,
      [
        body.organizationId,
        body.externalStudentId || null,
        body.externalParentId  || null,
        body.externalId        || null,
        body.homeStoreId       || null,
        fullName,
        body.firstName  || null,
        body.middleName || null,
        body.lastName1  || null,
        body.lastName2  || null,
        body.email      || null,
        body.phone      || null,
        body.familyCode || null
      ]
    );

    const customer = result.rows[0];
    // Auto-link any guardians that share the new family_code
    if (customer.familyCode && customer.customerType === "student") {
      await pool.query(
        `INSERT INTO commerce_guardian_students
           (guardian_id, student_id, organization_id, relationship)
         SELECT g.id, $1, $2, 'guardian'
         FROM commerce_guardians g
         WHERE g.organization_id = $2
           AND g.family_code     = $3
           AND g.active          = TRUE
         ON CONFLICT (guardian_id, student_id) DO NOTHING`,
        [customer.id, body.organizationId, customer.familyCode]
      );
    }

    res.status(201).json({ data: customer });
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

    // If any name part is provided, recompute the full name
    const hasNameParts = body.firstName !== undefined || body.middleName !== undefined ||
                         body.lastName1 !== undefined || body.lastName2 !== undefined;
    if (hasNameParts || body.name !== undefined) {
      // We need the current record to merge unchanged parts
      const current = await pool.query(
        `SELECT first_name, middle_name, last_name_1, last_name_2, name FROM commerce_customers WHERE id = $1 AND organization_id = $2`,
        [customerId, body.organizationId]
      );
      if (current.rowCount === 0) throw notFound("Customer not found");
      const cur = current.rows[0];
      const fn = body.firstName  !== undefined ? body.firstName  : cur.first_name;
      const mn = body.middleName !== undefined ? body.middleName : cur.middle_name;
      const l1 = body.lastName1  !== undefined ? body.lastName1  : cur.last_name_1;
      const l2 = body.lastName2  !== undefined ? body.lastName2  : cur.last_name_2;
      const computedName = buildFullName({ firstName: fn, middleName: mn, lastName1: l1, lastName2: l2, name: body.name || cur.name });
      vals.push(computedName); sets.push(`name = $${vals.length}`);
      vals.push(fn || null);   sets.push(`first_name = $${vals.length}`);
      vals.push(mn || null);   sets.push(`middle_name = $${vals.length}`);
      vals.push(l1 || null);   sets.push(`last_name_1 = $${vals.length}`);
      vals.push(l2 || null);   sets.push(`last_name_2 = $${vals.length}`);
    }
    if (body.email           !== undefined) { vals.push(body.email);           sets.push(`email = $${vals.length}`); }
    if (body.phone           !== undefined) { vals.push(body.phone);           sets.push(`phone = $${vals.length}`); }
    if (body.active          !== undefined) { vals.push(body.active);          sets.push(`active = $${vals.length}`); }
    if (body.homeStoreId     !== undefined) { vals.push(body.homeStoreId);     sets.push(`home_store_id = $${vals.length}`); }
    if (body.avatarPublicId  !== undefined) { vals.push(body.avatarPublicId);  sets.push(`avatar_public_id = $${vals.length}`); }
    if (body.familyCode      !== undefined) { vals.push(body.familyCode);      sets.push(`family_code = $${vals.length}`); }

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
                 family_code         AS "familyCode",
                 first_name AS "firstName", middle_name AS "middleName",
                 last_name_1 AS "lastName1", last_name_2 AS "lastName2",
                 avatar_public_id    AS "avatarPublicId",
                 name, email, phone, active, created_at AS "createdAt"`,
      vals
    );
    if (result.rowCount === 0) throw notFound("Customer not found");

    // Auto-link any guardians that share the new family_code
    const customer = result.rows[0];
    if (body.familyCode && customer.customerType === "student") {
      await pool.query(
        `INSERT INTO commerce_guardian_students
           (guardian_id, student_id, organization_id, relationship)
         SELECT g.id, $1, $2, 'guardian'
         FROM commerce_guardians g
         WHERE g.organization_id = $2
           AND g.family_code     = $3
           AND g.active          = TRUE
         ON CONFLICT (guardian_id, student_id) DO NOTHING`,
        [customerId, body.organizationId, body.familyCode]
      );
    }

    res.json({ data: customer });
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

// ── CSV import (preview + apply, multipart) ───────────────────────────────────

const csvRowSchema = z.object({
  // Split name fields (preferred)
  first_name:  z.string().optional(),
  middle_name: z.string().optional(),
  last_name_1: z.string().optional(),
  last_name_2: z.string().optional(),
  // Legacy single-name field (backward compat with SIS exports)
  name:        z.string().optional(),
  email:       z.string().email().optional().or(z.literal("")),
  phone:       z.string().optional(),
  external_id: z.string().optional(),
  family_code: z.string().optional(),
}).refine((d) => d.name || d.first_name, { message: "Either name or first_name is required" });

function parseCsvRows(buffer) {
  return parseCsv(buffer.toString("utf8"), { columns: true, skip_empty_lines: true, trim: true });
}

customersRouter.post(
  "/import/preview",
  requirePermission("customers:write"),
  csvUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    const rows = parseCsvRows(req.file.buffer);
    if (rows.length > 1000) throw badRequest("Maximum 1000 rows per import");

    const preview = [];
    const errors = [];

    // Bulk-fetch existing emails for this org
    const emails = rows.map((r) => (r.email || "").toLowerCase()).filter(Boolean);
    const existing = emails.length
      ? (await pool.query(
          `SELECT LOWER(email) AS email FROM commerce_customers WHERE organization_id = $1 AND email = ANY($2)`,
          [organizationId, emails]
        )).rows.map((r) => r.email)
      : [];
    const existingSet = new Set(existing);

    for (let i = 0; i < rows.length; i++) {
      const parsed = csvRowSchema.safeParse(rows[i]);
      if (!parsed.success) {
        errors.push({ row: i + 2, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      const r = parsed.data;
      const fullName = buildFullName({ firstName: r.first_name, middleName: r.middle_name, lastName1: r.last_name_1, lastName2: r.last_name_2, name: r.name });
      const emailLower = (r.email || "").toLowerCase();
      const action = emailLower && existingSet.has(emailLower) ? "update" : "create";
      preview.push({ row: i + 2, firstName: r.first_name || null, middleName: r.middle_name || null, lastName1: r.last_name_1 || null, lastName2: r.last_name_2 || null, name: fullName, email: r.email || null, phone: r.phone || null, externalId: r.external_id || null, familyCode: r.family_code || null, action });
    }

    res.json({ data: { total: rows.length, valid: preview.length, errors, preview } });
  })
);

customersRouter.post(
  "/import/apply",
  requirePermission("customers:write"),
  csvUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    const rows = parseCsvRows(req.file.buffer);
    if (rows.length > 1000) throw badRequest("Maximum 1000 rows per import");

    let created = 0, updated = 0;
    const errors = [];

    await withTransaction(async (client) => {
      for (let i = 0; i < rows.length; i++) {
        const parsed = csvRowSchema.safeParse(rows[i]);
        if (!parsed.success) { errors.push({ row: i + 2, error: parsed.error.issues[0]?.message ?? "Invalid row" }); continue; }
        const r = parsed.data;
        const fullName = buildFullName({ firstName: r.first_name, middleName: r.middle_name, lastName1: r.last_name_1, lastName2: r.last_name_2, name: r.name });
        try {
          const result = await client.query(
            `INSERT INTO commerce_customers
               (organization_id, name, first_name, middle_name, last_name_1, last_name_2,
                email, phone, external_id, family_code, customer_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'student')
             ON CONFLICT (organization_id, external_id) WHERE external_id IS NOT NULL
             DO UPDATE SET name        = EXCLUDED.name,
                           first_name  = COALESCE(EXCLUDED.first_name,  commerce_customers.first_name),
                           middle_name = COALESCE(EXCLUDED.middle_name, commerce_customers.middle_name),
                           last_name_1 = COALESCE(EXCLUDED.last_name_1, commerce_customers.last_name_1),
                           last_name_2 = COALESCE(EXCLUDED.last_name_2, commerce_customers.last_name_2),
                           email       = COALESCE(EXCLUDED.email,       commerce_customers.email),
                           phone       = COALESCE(EXCLUDED.phone,       commerce_customers.phone),
                           family_code = COALESCE(EXCLUDED.family_code, commerce_customers.family_code)
             RETURNING id, (xmax = 0) AS inserted`,
            [
              organizationId, fullName,
              r.first_name || null, r.middle_name || null, r.last_name_1 || null, r.last_name_2 || null,
              r.email || null, r.phone || null, r.external_id || null, r.family_code || null
            ]
          );
          const customerId = result.rows[0]?.id;
          if (result.rows[0]?.inserted) created++; else updated++;

          // Auto-link any guardians that share the same family_code
          if (customerId && r.family_code) {
            await client.query(
              `INSERT INTO commerce_guardian_students
                 (guardian_id, student_id, organization_id, relationship)
               SELECT g.id, $1, $2, 'guardian'
               FROM commerce_guardians g
               WHERE g.organization_id = $2
                 AND g.family_code     = $3
                 AND g.active          = TRUE
               ON CONFLICT (guardian_id, student_id) DO NOTHING`,
              [customerId, organizationId, r.family_code]
            );
          }
        } catch (err) {
          errors.push({ row: i + 2, name: fullName, error: err.message });
        }
      }
    });

    res.json({ data: { created, updated, errors } });
  })
);
