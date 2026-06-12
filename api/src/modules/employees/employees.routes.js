import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { parse as parseCsv } from "csv-parse/sync";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { authorizeTenant, getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const employeesRouter = Router();

const createEmployeeSchema = z.object({
  organizationId: z.string().uuid(),
  homeStoreId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  employeeNumber: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  payrollDeductionEnabled: z.boolean().default(true),
  deductionCycle: z.enum(["weekly", "biweekly", "monthly"]).default("biweekly"),
  maxCreditCents: z.number().int().min(0).default(50000)
});

const updateEmployeeSchema = z.object({
  organizationId: z.string().uuid(),
  homeStoreId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  employeeNumber: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  payrollDeductionEnabled: z.boolean().optional(),
  deductionCycle: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  maxCreditCents: z.number().int().min(0).optional(),
  active: z.boolean().optional()
});

function mapEmployee(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerType: row.customerType,
    name: row.name,
    email: row.email,
    phone: row.phone,
    active: row.active,
    homeStoreId: row.homeStoreId || null,
    createdAt: row.createdAt,
    profile: row.profileId
      ? {
          id: row.profileId,
          employeeNumber: row.employeeNumber,
          department: row.department,
          jobTitle: row.jobTitle,
          payrollDeductionEnabled: row.payrollDeductionEnabled,
          deductionCycle: row.deductionCycle,
          maxCreditCents: Number(row.maxCreditCents),
          active: row.profileActive,
          updatedAt: row.profileUpdatedAt
        }
      : null,
    wallet: row.walletId
      ? {
          id: row.walletId,
          balanceCents: Number(row.balanceCents),
          creditLimitCents: Number(row.creditLimitCents),
          currency: row.currency
        }
      : null
  };
}

const EMPLOYEE_SELECT = `
  SELECT c.id,
         c.organization_id AS "organizationId",
         c.customer_type AS "customerType",
         c.name,
         c.email,
         c.phone,
         c.active,
         c.home_store_id AS "homeStoreId",
         c.created_at AS "createdAt",
         ep.id AS "profileId",
         ep.employee_number AS "employeeNumber",
         ep.department,
         ep.job_title AS "jobTitle",
         ep.payroll_deduction_enabled AS "payrollDeductionEnabled",
         ep.deduction_cycle AS "deductionCycle",
         ep.max_credit_cents AS "maxCreditCents",
         ep.active AS "profileActive",
         ep.updated_at AS "profileUpdatedAt",
         wa.id AS "walletId",
         wa.balance_cents AS "balanceCents",
         wa.credit_limit_cents AS "creditLimitCents",
         wa.currency
  FROM commerce_customers c
  LEFT JOIN commerce_employee_profiles ep
    ON ep.organization_id = c.organization_id AND ep.customer_id = c.id
  LEFT JOIN commerce_wallet_accounts wa
    ON wa.organization_id = c.organization_id AND wa.customer_id = c.id
`;

employeesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        active: z.enum(["true", "false"]).optional(),
        department: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100)
      }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId];
    const clauses = ["c.organization_id = $1", "c.customer_type = 'employee'"];

    if (query.active !== undefined) {
      values.push(query.active === "true");
      clauses.push(`c.active = $${values.length}`);
    }
    if (query.department) {
      values.push(`%${query.department}%`);
      clauses.push(`ep.department ILIKE $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      const n = values.length;
      clauses.push(
        `(c.name ILIKE $${n} OR c.email ILIKE $${n} OR ep.employee_number ILIKE $${n} OR ep.department ILIKE $${n})`
      );
    }

    values.push(query.limit);
    const result = await pool.query(
      `${EMPLOYEE_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY c.name ASC LIMIT $${values.length}`,
      values
    );

    res.json({ data: result.rows.map(mapEmployee) });
  })
);

employeesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `${EMPLOYEE_SELECT} WHERE c.organization_id = $1 AND c.id = $2 AND c.customer_type = 'employee'`,
      [organizationId, employeeId]
    );
    if (result.rowCount === 0) throw notFound("Employee not found");

    res.json({ data: mapEmployee(result.rows[0]) });
  })
);

employeesRouter.post(
  "/",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createEmployeeSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    if (body.employeeNumber) {
      const dup = await pool.query(
        `SELECT id FROM commerce_employee_profiles
         WHERE organization_id = $1 AND employee_number = $2`,
        [body.organizationId, body.employeeNumber]
      );
      if (dup.rowCount > 0) throw badRequest("Employee number already in use");
    }

    const result = await withTransaction(async (client) => {
      const customer = (
        await client.query(
          `INSERT INTO commerce_customers
             (organization_id, name, email, phone, home_store_id, customer_type)
           VALUES ($1, $2, $3, $4, $5, 'employee')
           RETURNING id, organization_id AS "organizationId", customer_type AS "customerType",
                     name, email, phone, active, home_store_id AS "homeStoreId",
                     created_at AS "createdAt"`,
          [body.organizationId, body.name, body.email || null, body.phone || null, body.homeStoreId || null]
        )
      ).rows[0];

      const profile = (
        await client.query(
          `INSERT INTO commerce_employee_profiles
             (organization_id, customer_id, employee_number, department, job_title,
              payroll_deduction_enabled, deduction_cycle, max_credit_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, employee_number AS "employeeNumber", department, job_title AS "jobTitle",
                     payroll_deduction_enabled AS "payrollDeductionEnabled",
                     deduction_cycle AS "deductionCycle", max_credit_cents AS "maxCreditCents",
                     active, updated_at AS "updatedAt"`,
          [
            body.organizationId,
            customer.id,
            body.employeeNumber || null,
            body.department || null,
            body.jobTitle || null,
            body.payrollDeductionEnabled,
            body.deductionCycle,
            body.maxCreditCents
          ]
        )
      ).rows[0];

      // Create wallet with credit limit equal to their max credit
      const wallet = (
        await client.query(
          `INSERT INTO commerce_wallet_accounts
             (organization_id, customer_id, balance_cents, credit_limit_cents, currency)
           VALUES ($1, $2, 0, $3, 'USD')
           RETURNING id, balance_cents AS "balanceCents",
                     credit_limit_cents AS "creditLimitCents", currency`,
          [body.organizationId, customer.id, body.maxCreditCents]
        )
      ).rows[0];

      return { ...customer, profile, wallet };
    });

    res.status(201).json({ data: result });
  })
);

employeesRouter.patch(
  "/:id",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateEmployeeSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const existing = await pool.query(
      `SELECT c.id, ep.id AS profile_id, ep.max_credit_cents, wa.id AS wallet_id
       FROM commerce_customers c
       JOIN commerce_employee_profiles ep
         ON ep.organization_id = c.organization_id AND ep.customer_id = c.id
       LEFT JOIN commerce_wallet_accounts wa
         ON wa.organization_id = c.organization_id AND wa.customer_id = c.id
       WHERE c.organization_id = $1 AND c.id = $2 AND c.customer_type = 'employee'`,
      [body.organizationId, employeeId]
    );
    if (existing.rowCount === 0) throw notFound("Employee not found");
    const current = existing.rows[0];

    await withTransaction(async (client) => {
      if (body.name !== undefined || body.email !== undefined || body.phone !== undefined || body.active !== undefined || body.homeStoreId !== undefined) {
        const setClauses = [];
        const vals = [body.organizationId, employeeId];
        if (body.name        !== undefined) { vals.push(body.name);        setClauses.push(`name = $${vals.length}`); }
        if (body.email       !== undefined) { vals.push(body.email);       setClauses.push(`email = $${vals.length}`); }
        if (body.phone       !== undefined) { vals.push(body.phone);       setClauses.push(`phone = $${vals.length}`); }
        if (body.active      !== undefined) { vals.push(body.active);      setClauses.push(`active = $${vals.length}`); }
        if (body.homeStoreId !== undefined) { vals.push(body.homeStoreId); setClauses.push(`home_store_id = $${vals.length}`); }
        if (setClauses.length > 0) {
          await client.query(
            `UPDATE commerce_customers SET ${setClauses.join(", ")} WHERE organization_id = $1 AND id = $2`,
            vals
          );
        }
      }

      const profileSets = [];
      const profileVals = [body.organizationId, current.profile_id];
      if (body.employeeNumber !== undefined) { profileVals.push(body.employeeNumber); profileSets.push(`employee_number = $${profileVals.length}`); }
      if (body.department !== undefined) { profileVals.push(body.department); profileSets.push(`department = $${profileVals.length}`); }
      if (body.jobTitle !== undefined) { profileVals.push(body.jobTitle); profileSets.push(`job_title = $${profileVals.length}`); }
      if (body.payrollDeductionEnabled !== undefined) { profileVals.push(body.payrollDeductionEnabled); profileSets.push(`payroll_deduction_enabled = $${profileVals.length}`); }
      if (body.deductionCycle !== undefined) { profileVals.push(body.deductionCycle); profileSets.push(`deduction_cycle = $${profileVals.length}`); }
      if (body.maxCreditCents !== undefined) { profileVals.push(body.maxCreditCents); profileSets.push(`max_credit_cents = $${profileVals.length}`); }
      if (profileSets.length > 0) {
        profileVals.push(new Date());
        profileSets.push(`updated_at = $${profileVals.length}`);
        await client.query(
          `UPDATE commerce_employee_profiles SET ${profileSets.join(", ")} WHERE organization_id = $1 AND id = $2`,
          profileVals
        );
      }

      // Sync wallet credit limit if maxCreditCents changed
      if (body.maxCreditCents !== undefined && current.wallet_id) {
        await client.query(
          `UPDATE commerce_wallet_accounts
           SET credit_limit_cents = $3
           WHERE organization_id = $1 AND id = $2`,
          [body.organizationId, current.wallet_id, body.maxCreditCents]
        );
      }
    });

    const updated = await pool.query(
      `${EMPLOYEE_SELECT} WHERE c.organization_id = $1 AND c.id = $2`,
      [body.organizationId, employeeId]
    );
    res.json({ data: mapEmployee(updated.rows[0]) });
  })
);

// ── Bulk CSV import ───────────────────────────────────────────────────────────

const importEmployeeRowSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  homeStoreId: z.string().uuid().nullable().optional(),
  employeeNumber: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  payrollDeductionEnabled: z.boolean().default(true),
  deductionCycle: z.enum(["weekly", "biweekly", "monthly"]).default("biweekly"),
  maxCreditCents: z.number().int().min(0).default(50000)
});

employeesRouter.post(
  "/import",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        rows: z.array(importEmployeeRowSchema).min(1).max(500)
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    let imported = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      try {
        await withTransaction(async (client) => {
          // Check if employee exists by employee number
          let existingCustomerId = null;
          if (row.employeeNumber) {
            const existing = (
              await client.query(
                `SELECT c.id FROM commerce_customers c
                 JOIN commerce_employee_profiles ep
                   ON ep.organization_id = c.organization_id AND ep.customer_id = c.id
                 WHERE c.organization_id = $1 AND ep.employee_number = $2`,
                [body.organizationId, row.employeeNumber]
              )
            ).rows[0];
            if (existing) existingCustomerId = existing.id;
          }

          if (existingCustomerId) {
            // Update existing employee
            await client.query(
              `UPDATE commerce_customers
               SET name          = $3,
                   email         = COALESCE($4, email),
                   phone         = COALESCE($5, phone),
                   home_store_id = COALESCE($6, home_store_id)
               WHERE organization_id = $1 AND id = $2`,
              [body.organizationId, existingCustomerId, row.name, row.email || null, row.phone || null, row.homeStoreId || null]
            );
            await client.query(
              `UPDATE commerce_employee_profiles
               SET department = COALESCE($3, department),
                   job_title = COALESCE($4, job_title),
                   payroll_deduction_enabled = $5,
                   deduction_cycle = $6,
                   max_credit_cents = $7,
                   updated_at = NOW()
               WHERE organization_id = $1 AND customer_id = $2`,
              [
                body.organizationId, existingCustomerId,
                row.department || null, row.jobTitle || null,
                row.payrollDeductionEnabled, row.deductionCycle, row.maxCreditCents
              ]
            );
            updated++;
          } else {
            // Create new employee
            const customer = (
              await client.query(
                `INSERT INTO commerce_customers (organization_id, name, email, phone, home_store_id, customer_type)
                 VALUES ($1, $2, $3, $4, $5, 'employee')
                 RETURNING id`,
                [body.organizationId, row.name, row.email || null, row.phone || null, row.homeStoreId || null]
              )
            ).rows[0];

            await client.query(
              `INSERT INTO commerce_employee_profiles
                 (organization_id, customer_id, employee_number, department, job_title,
                  payroll_deduction_enabled, deduction_cycle, max_credit_cents)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                body.organizationId, customer.id,
                row.employeeNumber || null, row.department || null, row.jobTitle || null,
                row.payrollDeductionEnabled, row.deductionCycle, row.maxCreditCents
              ]
            );

            await client.query(
              `INSERT INTO commerce_wallet_accounts
                 (organization_id, customer_id, balance_cents, credit_limit_cents, currency)
               VALUES ($1, $2, 0, $3, 'USD')`,
              [body.organizationId, customer.id, row.maxCreditCents]
            );

            imported++;
          }
        });
      } catch (err) {
        errors.push({ row: i + 1, name: row.name, error: err.message });
      }
    }

    res.json({ data: { imported, updated, errors } });
  })
);

// ── CSV import (preview + apply, multipart) ───────────────────────────────────

const csvEmpRowSchema = z.object({
  name:             z.string().min(1),
  email:            z.string().email().optional().or(z.literal("")),
  department:       z.string().optional(),
  job_title:        z.string().optional(),
  employee_number:  z.string().optional(),
  deduction_cycle:  z.enum(["weekly", "biweekly", "monthly"]).optional().default("biweekly"),
});

function parseCsvRows(buffer) {
  return parseCsv(buffer.toString("utf8"), { columns: true, skip_empty_lines: true, trim: true });
}

employeesRouter.post(
  "/import/preview",
  requirePermission("customers:write"),
  csvUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    const rows = parseCsvRows(req.file.buffer);
    if (rows.length > 500) throw badRequest("Maximum 500 rows per import");

    const preview = [];
    const errors = [];

    // Bulk-fetch existing employee numbers
    const empNumbers = rows.map((r) => r.employee_number).filter(Boolean);
    const existing = empNumbers.length
      ? (await pool.query(
          `SELECT ep.employee_number FROM commerce_employee_profiles ep
           JOIN commerce_customers c ON c.id = ep.customer_id AND c.organization_id = ep.organization_id
           WHERE ep.organization_id = $1 AND ep.employee_number = ANY($2)`,
          [organizationId, empNumbers]
        )).rows.map((r) => r.employee_number)
      : [];
    const existingSet = new Set(existing);

    for (let i = 0; i < rows.length; i++) {
      const parsed = csvEmpRowSchema.safeParse(rows[i]);
      if (!parsed.success) {
        errors.push({ row: i + 2, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      const r = parsed.data;
      const action = r.employee_number && existingSet.has(r.employee_number) ? "update" : "create";
      preview.push({
        row: i + 2,
        name: r.name,
        email: r.email || null,
        department: r.department || null,
        jobTitle: r.job_title || null,
        employeeNumber: r.employee_number || null,
        deductionCycle: r.deduction_cycle,
        action,
      });
    }

    res.json({ data: { total: rows.length, valid: preview.length, errors, preview } });
  })
);

employeesRouter.post(
  "/import/apply",
  requirePermission("customers:write"),
  csvUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    const rows = parseCsvRows(req.file.buffer);
    if (rows.length > 500) throw badRequest("Maximum 500 rows per import");

    let created = 0, updated = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const parsed = csvEmpRowSchema.safeParse(rows[i]);
      if (!parsed.success) { errors.push({ row: i + 2, error: parsed.error.issues[0]?.message ?? "Invalid row" }); continue; }
      const r = parsed.data;
      try {
        await withTransaction(async (client) => {
          let customerId = null;
          if (r.employee_number) {
            const existing = (await client.query(
              `SELECT c.id FROM commerce_customers c
               JOIN commerce_employee_profiles ep ON ep.customer_id = c.id AND ep.organization_id = c.organization_id
               WHERE c.organization_id = $1 AND ep.employee_number = $2`,
              [organizationId, r.employee_number]
            )).rows[0];
            if (existing) customerId = existing.id;
          }

          if (customerId) {
            await client.query(
              `UPDATE commerce_customers SET name = $2, email = COALESCE($3, email) WHERE id = $1`,
              [customerId, r.name, r.email || null]
            );
            await client.query(
              `UPDATE commerce_employee_profiles SET department = COALESCE($2, department), job_title = COALESCE($3, job_title), deduction_cycle = $4 WHERE customer_id = $1`,
              [customerId, r.department || null, r.job_title || null, r.deduction_cycle]
            );
            updated++;
          } else {
            const ins = await client.query(
              `INSERT INTO commerce_customers (organization_id, name, email, customer_type) VALUES ($1, $2, $3, 'employee') RETURNING id`,
              [organizationId, r.name, r.email || null]
            );
            customerId = ins.rows[0].id;
            await client.query(
              `INSERT INTO commerce_employee_profiles (organization_id, customer_id, employee_number, department, job_title, deduction_cycle, payroll_deduction_enabled, max_credit_cents)
               VALUES ($1, $2, $3, $4, $5, $6, true, 50000)`,
              [organizationId, customerId, r.employee_number || null, r.department || null, r.job_title || null, r.deduction_cycle]
            );
            created++;
          }
        });
      } catch (err) {
        errors.push({ row: i + 2, name: r.name, error: err.message });
      }
    }

    res.json({ data: { created, updated, errors } });
  })
);
