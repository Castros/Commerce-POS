import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { authorizeTenant, getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, conflict, notFound, parseZod } from "../../shared/http/errors.js";

export const payrollRouter = Router();

const cycleQuerySchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(["open", "closed", "deducted"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

function mapCycle(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    deductionCycle: row.deductionCycle,
    status: row.status,
    totalDeductionCents: row.totalDeductionCents === null ? null : Number(row.totalDeductionCents),
    employeeCount: row.employeeCount,
    notes: row.notes,
    closedByUserId: row.closedByUserId,
    closedAt: row.closedAt,
    deductedByUserId: row.deductedByUserId,
    deductedAt: row.deductedAt,
    createdAt: row.createdAt
  };
}

// ── List cycles ───────────────────────────────────────────────────────────────

payrollRouter.get(
  "/cycles",
  asyncHandler(async (req, res) => {
    const query = parseZod(cycleQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId];
    const clauses = ["organization_id = $1"];
    if (query.status) {
      values.push(query.status);
      clauses.push(`status = $${values.length}`);
    }
    values.push(query.limit);

    const result = await pool.query(
      `SELECT id, organization_id AS "organizationId", period_start AS "periodStart",
              period_end AS "periodEnd", deduction_cycle AS "deductionCycle",
              status, total_deduction_cents AS "totalDeductionCents",
              employee_count AS "employeeCount", notes,
              closed_by_user_id AS "closedByUserId", closed_at AS "closedAt",
              deducted_by_user_id AS "deductedByUserId", deducted_at AS "deductedAt",
              created_at AS "createdAt"
       FROM commerce_payroll_cycles
       WHERE ${clauses.join(" AND ")}
       ORDER BY period_end DESC
       LIMIT $${values.length}`,
      values
    );
    res.json({ data: result.rows.map(mapCycle) });
  })
);

// ── Get single cycle with items ───────────────────────────────────────────────

payrollRouter.get(
  "/cycles/:id",
  asyncHandler(async (req, res) => {
    const cycleId = z.string().uuid().parse(req.params.id);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);

    const cycleResult = await pool.query(
      `SELECT id, organization_id AS "organizationId", period_start AS "periodStart",
              period_end AS "periodEnd", deduction_cycle AS "deductionCycle",
              status, total_deduction_cents AS "totalDeductionCents",
              employee_count AS "employeeCount", notes,
              closed_by_user_id AS "closedByUserId", closed_at AS "closedAt",
              deducted_by_user_id AS "deductedByUserId", deducted_at AS "deductedAt",
              created_at AS "createdAt"
       FROM commerce_payroll_cycles
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, cycleId]
    );
    if (cycleResult.rowCount === 0) throw notFound("Payroll cycle not found");

    const itemsResult = await pool.query(
      `SELECT id, customer_id AS "customerId", employee_profile_id AS "employeeProfileId",
              employee_number AS "employeeNumber", employee_name AS "employeeName",
              department, balance_snapshot_cents AS "balanceSnapshotCents",
              deduction_cents AS "deductionCents", paid_early_cents AS "paidEarlyCents",
              status, created_at AS "createdAt"
       FROM commerce_payroll_cycle_items
       WHERE organization_id = $1 AND cycle_id = $2
       ORDER BY employee_name ASC`,
      [organizationId, cycleId]
    );

    res.json({
      data: {
        ...mapCycle(cycleResult.rows[0]),
        items: itemsResult.rows.map((r) => ({
          ...r,
          balanceSnapshotCents: Number(r.balanceSnapshotCents),
          deductionCents: Number(r.deductionCents),
          paidEarlyCents: Number(r.paidEarlyCents)
        }))
      }
    });
  })
);

// ── Create cycle ──────────────────────────────────────────────────────────────

payrollRouter.post(
  "/cycles",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        deductionCycle: z.enum(["weekly", "biweekly", "monthly"]).default("biweekly"),
        notes: z.string().nullable().optional()
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    if (body.periodEnd < body.periodStart) throw badRequest("periodEnd must be on or after periodStart");

    const existing = await pool.query(
      `SELECT id FROM commerce_payroll_cycles
       WHERE organization_id = $1 AND status = 'open' AND deduction_cycle = $2`,
      [body.organizationId, body.deductionCycle]
    );
    if (existing.rowCount > 0) {
      throw conflict(`An open ${body.deductionCycle} payroll cycle already exists. Close it before creating a new one.`);
    }

    const result = await pool.query(
      `INSERT INTO commerce_payroll_cycles
         (organization_id, period_start, period_end, deduction_cycle, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, organization_id AS "organizationId", period_start AS "periodStart",
                 period_end AS "periodEnd", deduction_cycle AS "deductionCycle",
                 status, total_deduction_cents AS "totalDeductionCents",
                 employee_count AS "employeeCount", notes, created_at AS "createdAt"`,
      [body.organizationId, body.periodStart, body.periodEnd, body.deductionCycle, body.notes || null]
    );

    res.status(201).json({ data: mapCycle(result.rows[0]) });
  })
);

// ── Close cycle — snapshot all employee balances ──────────────────────────────

payrollRouter.post(
  "/cycles/:id/close",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const cycleId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({ organizationId: z.string().uuid(), notes: z.string().nullable().optional() }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const result = await withTransaction(async (client) => {
      const cycle = (
        await client.query(
          `SELECT * FROM commerce_payroll_cycles
           WHERE organization_id = $1 AND id = $2 AND status = 'open' FOR UPDATE`,
          [body.organizationId, cycleId]
        )
      ).rows[0];
      if (!cycle) throw notFound("Open payroll cycle not found");

      // Snapshot all employees who have payroll deduction enabled
      const employees = (
        await client.query(
          `SELECT c.id AS customer_id,
                  c.name AS employee_name,
                  ep.id AS employee_profile_id,
                  ep.employee_number,
                  ep.department,
                  COALESCE(wa.balance_cents, 0) AS balance_cents
           FROM commerce_customers c
           JOIN commerce_employee_profiles ep
             ON ep.organization_id = c.organization_id AND ep.customer_id = c.id
           LEFT JOIN commerce_wallet_accounts wa
             ON wa.organization_id = c.organization_id AND wa.customer_id = c.id
           WHERE c.organization_id = $1
             AND c.customer_type = 'employee'
             AND c.active = TRUE
             AND ep.payroll_deduction_enabled = TRUE
             AND ep.deduction_cycle = $2
             AND COALESCE(wa.balance_cents, 0) < 0`,
          [body.organizationId, cycle.deduction_cycle]
        )
      ).rows;

      let totalDeduction = 0;
      for (const emp of employees) {
        const balance = Number(emp.balance_cents);
        const deductionCents = Math.abs(balance); // balance is negative
        totalDeduction += deductionCents;

        await client.query(
          `INSERT INTO commerce_payroll_cycle_items
             (organization_id, cycle_id, customer_id, employee_profile_id,
              employee_number, employee_name, department,
              balance_snapshot_cents, deduction_cents, paid_early_cents, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'pending')
           ON CONFLICT (cycle_id, customer_id) DO NOTHING`,
          [
            body.organizationId,
            cycleId,
            emp.customer_id,
            emp.employee_profile_id,
            emp.employee_number,
            emp.employee_name,
            emp.department,
            balance,
            deductionCents
          ]
        );
      }

      const updated = (
        await client.query(
          `UPDATE commerce_payroll_cycles
           SET status = 'closed',
               total_deduction_cents = $3,
               employee_count = $4,
               closed_by_user_id = $5,
               closed_at = NOW(),
               notes = COALESCE($6, notes),
               updated_at = NOW()
           WHERE organization_id = $1 AND id = $2
           RETURNING id, organization_id AS "organizationId", period_start AS "periodStart",
                     period_end AS "periodEnd", deduction_cycle AS "deductionCycle",
                     status, total_deduction_cents AS "totalDeductionCents",
                     employee_count AS "employeeCount", notes,
                     closed_by_user_id AS "closedByUserId", closed_at AS "closedAt",
                     created_at AS "createdAt"`,
          [body.organizationId, cycleId, totalDeduction, employees.length, actor.actorUserId, body.notes || null]
        )
      ).rows[0];

      return updated;
    });

    res.json({ data: mapCycle(result) });
  })
);

// ── Mark cycle as deducted — zero out employee balances via wallet transactions

payrollRouter.post(
  "/cycles/:id/mark-deducted",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const cycleId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({ organizationId: z.string().uuid(), notes: z.string().nullable().optional() }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const result = await withTransaction(async (client) => {
      const cycle = (
        await client.query(
          `SELECT * FROM commerce_payroll_cycles
           WHERE organization_id = $1 AND id = $2 AND status = 'closed' FOR UPDATE`,
          [body.organizationId, cycleId]
        )
      ).rows[0];
      if (!cycle) throw notFound("Closed payroll cycle not found");

      const items = (
        await client.query(
          `SELECT pci.*, wa.id AS wallet_id
           FROM commerce_payroll_cycle_items pci
           JOIN commerce_wallet_accounts wa
             ON wa.organization_id = pci.organization_id AND wa.customer_id = pci.customer_id
           WHERE pci.organization_id = $1 AND pci.cycle_id = $2 AND pci.status = 'pending'
           FOR UPDATE OF wa`,
          [body.organizationId, cycleId]
        )
      ).rows;

      for (const item of items) {
        const topUpCents = item.deduction_cents;
        if (topUpCents <= 0) continue;

        // Create a wallet transaction to zero out the employee's balance
        await client.query(
          `INSERT INTO commerce_wallet_transactions
             (organization_id, wallet_account_id, type, amount_cents,
              balance_before_cents, balance_after_cents, note, created_by_user_id)
           SELECT $1, wa.id, 'payroll_deduction', $2,
                  wa.balance_cents, wa.balance_cents + $2, $3, $4
           FROM commerce_wallet_accounts wa
           WHERE wa.organization_id = $1 AND wa.customer_id = $5`,
          [
            body.organizationId,
            topUpCents,
            `Payroll deduction — cycle ${cycle.period_start} to ${cycle.period_end}`,
            actor.actorUserId,
            item.customer_id
          ]
        );

        await client.query(
          `UPDATE commerce_wallet_accounts
           SET balance_cents = balance_cents + $2, updated_at = NOW()
           WHERE organization_id = $1 AND customer_id = $3`,
          [body.organizationId, topUpCents, item.customer_id]
        );

        await client.query(
          `UPDATE commerce_payroll_cycle_items
           SET status = 'deducted'
           WHERE organization_id = $1 AND id = $2`,
          [body.organizationId, item.id]
        );
      }

      const updated = (
        await client.query(
          `UPDATE commerce_payroll_cycles
           SET status = 'deducted',
               deducted_by_user_id = $3,
               deducted_at = NOW(),
               notes = COALESCE($4, notes),
               updated_at = NOW()
           WHERE organization_id = $1 AND id = $2
           RETURNING id, organization_id AS "organizationId", period_start AS "periodStart",
                     period_end AS "periodEnd", deduction_cycle AS "deductionCycle",
                     status, total_deduction_cents AS "totalDeductionCents",
                     employee_count AS "employeeCount", notes,
                     deducted_by_user_id AS "deductedByUserId", deducted_at AS "deductedAt",
                     created_at AS "createdAt"`,
          [body.organizationId, cycleId, actor.actorUserId, body.notes || null]
        )
      ).rows[0];

      return updated;
    });

    res.json({ data: mapCycle(result) });
  })
);

// ── CSV export for HR ─────────────────────────────────────────────────────────

payrollRouter.get(
  "/cycles/:id/export",
  asyncHandler(async (req, res) => {
    const cycleId = z.string().uuid().parse(req.params.id);
    const organizationId = z.string().uuid().parse(req.query.organizationId);
    authorizeTenant(req.actor, organizationId);

    const cycle = (
      await pool.query(
        `SELECT * FROM commerce_payroll_cycles WHERE organization_id = $1 AND id = $2`,
        [organizationId, cycleId]
      )
    ).rows[0];
    if (!cycle) throw notFound("Payroll cycle not found");

    const items = (
      await pool.query(
        `SELECT employee_number, employee_name, department,
                balance_snapshot_cents, deduction_cents, paid_early_cents, status
         FROM commerce_payroll_cycle_items
         WHERE organization_id = $1 AND cycle_id = $2
         ORDER BY employee_name ASC`,
        [organizationId, cycleId]
      )
    ).rows;

    const header = "Employee Number,Name,Department,Balance at Close,Deduction Amount,Paid Early,Status\n";
    const rows = items
      .map((r) =>
        [
          r.employee_number || "",
          `"${(r.employee_name || "").replace(/"/g, '""')}"`,
          `"${(r.department || "").replace(/"/g, '""')}"`,
          (Number(r.balance_snapshot_cents) / 100).toFixed(2),
          (Number(r.deduction_cents) / 100).toFixed(2),
          (Number(r.paid_early_cents) / 100).toFixed(2),
          r.status
        ].join(",")
      )
      .join("\n");

    const filename = `payroll-${cycle.period_start}-to-${cycle.period_end}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(header + rows);
  })
);
