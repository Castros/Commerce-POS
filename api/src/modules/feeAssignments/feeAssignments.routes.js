import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { insertAuditEvent } from "../../shared/audit/audit.js";
import { authorizeTenant, getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, conflict, notFound, parseZod, paymentRequired } from "../../shared/http/errors.js";
import { hashRequestBody, lockIdempotencyKey, storeIdempotentResponse } from "../../shared/idempotency/idempotency.js";

export const feeAssignmentsRouter = Router();

function toInt(value) {
  return Number.parseInt(value, 10);
}

const FEE_SELECT = `
  SELECT fa.id, fa.organization_id AS "organizationId", fa.store_id AS "storeId",
         fa.customer_id AS "customerId", fa.category_id AS "categoryId",
         pc.name AS "categoryName",
         fa.amount_cents AS "amountCents", fa.currency, fa.description,
         fa.due_date AS "dueDate", fa.status,
         fa.paid_order_id AS "paidOrderId", fa.paid_at AS "paidAt",
         fa.created_by_user_id AS "createdByUserId",
         fa.created_at AS "createdAt", fa.updated_at AS "updatedAt"
  FROM commerce_fee_assignments fa
  LEFT JOIN commerce_product_categories pc ON pc.id = fa.category_id
`;

const createFeeSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int().min(1),
  description: z.string().min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
});

const updateFeeSchema = z.object({
  organizationId: z.string().uuid(),
  description: z.string().min(1).max(500).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.literal("cancelled").optional(),
  cancelReason: z.string().optional()
});

const payFeeSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "card", "wallet"]),
  walletAccountId: z.string().uuid().optional(),
  registerName: z.string().optional()
});

feeAssignmentsRouter.get(
  "/",
  requirePermission("orders:read"),
  asyncHandler(async (req, res) => {
    const query = z.object({
      organizationId: z.string().uuid(),
      customerId: z.string().uuid().optional(),
      storeId: z.string().uuid().optional(),
      status: z.enum(["pending", "paid", "cancelled"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    }).parse(req.query);

    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId];
    const clauses = ["fa.organization_id = $1"];

    if (query.customerId) {
      values.push(query.customerId);
      clauses.push(`fa.customer_id = $${values.length}`);
    }
    if (query.storeId) {
      values.push(query.storeId);
      clauses.push(`fa.store_id = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      clauses.push(`fa.status = $${values.length}`);
    }

    values.push(query.limit);
    const result = await pool.query(
      `${FEE_SELECT}
       WHERE ${clauses.join(" AND ")}
       ORDER BY fa.due_date ASC NULLS LAST, fa.created_at DESC
       LIMIT $${values.length}`,
      values
    );

    res.json({ data: result.rows });
  })
);

feeAssignmentsRouter.post(
  "/",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const body = parseZod(createFeeSchema, req.body);
    authorizeTenant(actor, body.organizationId);

    const result = await pool.query(
      `INSERT INTO commerce_fee_assignments
         (organization_id, store_id, customer_id, category_id,
          amount_cents, description, due_date, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                 customer_id AS "customerId", category_id AS "categoryId",
                 amount_cents AS "amountCents", currency, description,
                 due_date AS "dueDate", status,
                 paid_order_id AS "paidOrderId", paid_at AS "paidAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        body.organizationId, body.storeId, body.customerId, body.categoryId ?? null,
        body.amountCents, body.description, body.dueDate ?? null, actor.actorUserId
      ]
    );

    res.status(201).json({ data: result.rows[0] });
  })
);

feeAssignmentsRouter.patch(
  "/:id",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const id = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateFeeSchema, req.body);
    authorizeTenant(actor, body.organizationId);

    const existing = (
      await pool.query(
        `SELECT id, status FROM commerce_fee_assignments
         WHERE organization_id = $1 AND id = $2`,
        [body.organizationId, id]
      )
    ).rows[0];
    if (!existing) throw notFound("Fee assignment not found");
    if (existing.status === "paid") {
      if (body.status === "cancelled") throw conflict("Cannot cancel a paid fee");
    }

    const cols = [];
    const vals = [];
    let i = 1;

    if (body.description !== undefined) { cols.push(`description = $${i++}`);  vals.push(body.description); }
    if (body.dueDate     !== undefined) { cols.push(`due_date = $${i++}`);      vals.push(body.dueDate); }
    if (body.status      === "cancelled") {
      cols.push(`status = $${i++}`, `cancelled_at = $${i++}`, `cancelled_by_user_id = $${i++}`);
      vals.push("cancelled", new Date(), actor.actorUserId);
      if (body.cancelReason) {
        cols.push(`cancel_reason = $${i++}`);
        vals.push(body.cancelReason);
      }
    }

    cols.push(`updated_at = $${i++}`);
    vals.push(new Date());
    vals.push(body.organizationId, id);

    const result = await pool.query(
      `UPDATE commerce_fee_assignments SET ${cols.join(", ")}
       WHERE organization_id = $${i} AND id = $${i + 1}
       RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                 customer_id AS "customerId", category_id AS "categoryId",
                 amount_cents AS "amountCents", currency, description,
                 due_date AS "dueDate", status,
                 paid_order_id AS "paidOrderId", paid_at AS "paidAt",
                 cancel_reason AS "cancelReason",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      vals
    );

    res.json({ data: result.rows[0] });
  })
);

feeAssignmentsRouter.post(
  "/:id/pay",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const actor = getActor(req);
    const feeId = z.string().uuid().parse(req.params.id);
    const body = parseZod(payFeeSchema, req.body);
    authorizeTenant(actor, body.organizationId);

    const idempotencyKey = req.get("idempotency-key");
    if (!idempotencyKey) throw conflict("Idempotency-Key header is required");

    const requestHash = hashRequestBody({ feeId, ...body });

    const result = await withTransaction(async (client) => {
      const idempotency = await lockIdempotencyKey(client, {
        organizationId: body.organizationId,
        idempotencyKey,
        requestHash
      });
      if (idempotency.replay) return { status: idempotency.status, body: idempotency.body };

      // Lock fee assignment row
      const fee = (
        await client.query(
          `SELECT * FROM commerce_fee_assignments
           WHERE organization_id = $1 AND id = $2
           FOR UPDATE`,
          [body.organizationId, feeId]
        )
      ).rows[0];
      if (!fee) throw notFound("Fee assignment not found");
      if (fee.status !== "pending") throw conflict("Fee has already been paid or cancelled");

      // Validate store
      const store = (
        await client.query(
          `SELECT id FROM commerce_stores WHERE organization_id = $1 AND id = $2 AND active = TRUE`,
          [body.organizationId, body.storeId]
        )
      ).rows[0];
      if (!store) throw notFound("Store not found");

      const amountCents = toInt(fee.amount_cents);

      // Wallet: lock account and validate balance
      let wallet = null;
      if (body.paymentMethod === "wallet") {
        if (!body.walletAccountId) throw conflict("walletAccountId is required for wallet payments");
        wallet = (
          await client.query(
            `SELECT id, customer_id, balance_cents, credit_limit_cents, currency
             FROM commerce_wallet_accounts
             WHERE organization_id = $1 AND id = $2 AND customer_id = $3 AND active = TRUE
             FOR UPDATE`,
            [body.organizationId, body.walletAccountId, fee.customer_id]
          )
        ).rows[0];
        if (!wallet) throw notFound("Wallet not found");
        const currentBalance = toInt(wallet.balance_cents);
        const creditLimit = toInt(wallet.credit_limit_cents || 0);
        if (currentBalance + creditLimit < amountCents) {
          throw paymentRequired("Insufficient wallet balance");
        }
      }

      // Get the virtual fee product for this org
      const virtualProduct = (
        await client.query(
          `SELECT id FROM commerce_products
           WHERE organization_id = $1 AND is_virtual = TRUE AND name = '__virtual_fee__'
           LIMIT 1`,
          [body.organizationId]
        )
      ).rows[0];
      if (!virtualProduct) throw conflict("Fee system not configured for this organization");

      // Create order
      const order = (
        await client.query(
          `INSERT INTO commerce_orders
             (organization_id, store_id, customer_id, status,
              subtotal_cents, tax_cents, discount_cents, total_cents,
              payment_status, created_by_user_id)
           VALUES ($1, $2, $3, 'paid', $4, 0, 0, $4, 'paid', $5)
           RETURNING *`,
          [body.organizationId, body.storeId, fee.customer_id, amountCents, actor.actorUserId]
        )
      ).rows[0];

      // Create order item linked to fee assignment
      const orderItem = (
        await client.query(
          `INSERT INTO commerce_order_items
             (organization_id, order_id, product_id, name_snapshot,
              unit_price_cents, quantity, line_total_cents, currency, fee_assignment_id)
           VALUES ($1, $2, $3, $4, $5, 1, $5, $6, $7)
           RETURNING *`,
          [
            body.organizationId, order.id, virtualProduct.id,
            fee.description, amountCents, fee.currency, feeId
          ]
        )
      ).rows[0];

      // Create payment record
      const payment = (
        await client.query(
          `INSERT INTO commerce_payments
             (organization_id, order_id, method, amount_cents, status)
           VALUES ($1, $2, $3, $4, 'succeeded')
           RETURNING *`,
          [body.organizationId, order.id, body.paymentMethod, amountCents]
        )
      ).rows[0];

      let walletResult = null;
      if (body.paymentMethod === "wallet") {
        const balanceAfter = toInt(wallet.balance_cents) - amountCents;
        await client.query(
          `UPDATE commerce_wallet_accounts SET balance_cents = $3, updated_at = NOW()
           WHERE organization_id = $1 AND id = $2`,
          [body.organizationId, wallet.id, balanceAfter]
        );
        await client.query(
          `INSERT INTO commerce_wallet_transactions
             (organization_id, wallet_account_id, order_id, type,
              amount_cents, balance_after_cents, source, note, created_by_user_id)
           VALUES ($1, $2, $3, 'purchase', $4, $5, 'fee_payment', $6, $7)`,
          [
            body.organizationId, wallet.id, order.id,
            -amountCents, balanceAfter, `Fee payment: ${fee.description}`, actor.actorUserId
          ]
        );
        walletResult = {
          id: wallet.id,
          balanceCents: balanceAfter,
          creditLimitCents: toInt(wallet.credit_limit_cents || 0),
          currency: wallet.currency
        };
      }

      let cashDrawer = null;
      if (body.paymentMethod === "cash") {
        const registerName = body.registerName || "Register";
        const drawer = (
          await client.query(
            `SELECT id, expected_cash_cents FROM commerce_cash_drawer_sessions
             WHERE organization_id = $1 AND store_id = $2 AND register_name = $3 AND status = 'open'
             FOR UPDATE`,
            [body.organizationId, body.storeId, registerName]
          )
        ).rows[0];
        if (drawer) {
          const expectedAfter = toInt(drawer.expected_cash_cents) + amountCents;
          await client.query(
            `UPDATE commerce_cash_drawer_sessions SET expected_cash_cents = $3
             WHERE organization_id = $1 AND id = $2`,
            [body.organizationId, drawer.id, expectedAfter]
          );
          await client.query(
            `INSERT INTO commerce_cash_drawer_events
               (organization_id, store_id, session_id, order_id, type,
                amount_cents, cash_balance_after_cents, note, created_by_user_id)
             VALUES ($1, $2, $3, $4, 'cash_sale', $5, $6, 'Fee payment (cash)', $7)`,
            [body.organizationId, body.storeId, drawer.id, order.id, amountCents, expectedAfter, actor.actorUserId]
          );
          cashDrawer = { id: drawer.id, registerName, expectedCashCents: expectedAfter };
        }
      }

      // Mark fee as paid — optimistic concurrency: AND status = 'pending' guards concurrent payment
      const feeUpdate = await client.query(
        `UPDATE commerce_fee_assignments
         SET status = 'paid', paid_order_id = $3, paid_at = NOW(), updated_at = NOW()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'`,
        [body.organizationId, feeId, order.id]
      );
      if (feeUpdate.rowCount === 0) throw conflict("Fee was already collected by another transaction");

      await insertAuditEvent(client, {
        organizationId: body.organizationId,
        storeId: body.storeId,
        actorUserId: actor.actorUserId,
        actorService: actor.actorService,
        action: "fee_assignment.paid",
        targetType: "fee_assignment",
        targetId: feeId,
        summary: { amountCents, paymentMethod: body.paymentMethod, orderId: order.id },
        metadata: {},
        requestId: req.get("x-request-id"),
        idempotencyKey,
        ipAddress: req.ip,
        userAgent: req.get("user-agent")
      });

      const responseBody = {
        data: {
          feeAssignment: {
            id: feeId, status: "paid", paidOrderId: order.id,
            amountCents, description: fee.description
          },
          receipt: {
            order: {
              id: order.id, organizationId: order.organization_id,
              storeId: order.store_id, customerId: order.customer_id,
              status: order.status, totalCents: amountCents
            },
            items: [{
              id: orderItem.id, name: fee.description,
              unitPriceCents: amountCents, quantity: 1, lineTotalCents: amountCents
            }],
            payment: { id: payment.id, method: payment.method, amountCents },
            wallet: walletResult,
            cashDrawer
          }
        }
      };

      await storeIdempotentResponse(client, {
        organizationId: body.organizationId, idempotencyKey, status: 201, body: responseBody
      });

      return { status: 201, body: responseBody };
    }).catch((err) => {
      if (err.code === "23505") throw conflict("Duplicate payment or idempotency conflict");
      throw err;
    });

    res.status(result.status).json(result.body);
  })
);
