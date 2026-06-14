import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, parseZod } from "../../shared/http/errors.js";

export const transactionsRouter = Router();

const querySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  type: z.enum(["sale", "refund", "top_up"]).optional(),
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

function toInt(value) {
  return Number(value || 0);
}

transactionsRouter.get(
  "/",
  requirePermission("reports:read"),
  asyncHandler(async (req, res) => {
    const query = parseZod(querySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);

    const params = [query.organizationId];
    const whereClauses = [];

    // Build dynamic filter indices
    let storeIdx = null, dateFromIdx = null, dateToIdx = null, customerIdx = null;

    if (query.storeId) {
      params.push(query.storeId);
      storeIdx = params.length;
    }
    if (query.dateFrom) {
      params.push(query.dateFrom);
      dateFromIdx = params.length;
    }
    if (query.dateTo) {
      params.push(query.dateTo);
      dateToIdx = params.length;
    }
    if (query.customerId) {
      params.push(query.customerId);
      customerIdx = params.length;
    }

    const storeFilter = storeIdx ? `AND o.store_id = $${storeIdx}` : "";
    const dateFromFilterOrders = dateFromIdx ? `AND o.created_at >= $${dateFromIdx}` : "";
    const dateToFilterOrders = dateToIdx ? `AND o.created_at <= $${dateToIdx}` : "";
    const customerFilterOrders = customerIdx ? `AND o.customer_id = $${customerIdx}` : "";
    const dateFromFilterWallet = dateFromIdx ? `AND t.created_at >= $${dateFromIdx}` : "";
    const dateToFilterWallet = dateToIdx ? `AND t.created_at <= $${dateToIdx}` : "";
    const customerFilterWallet = customerIdx ? `AND c.id = $${customerIdx}` : "";
    const storeFilterWallet = storeIdx ? `AND ($${storeIdx}::uuid IS NULL OR o2.store_id = $${storeIdx})` : "";

    params.push(query.limit);
    const limitIdx = params.length;

    // UNION of sales/refunds from orders + top_ups from wallet transactions
    const sql = `
      SELECT *
      FROM (
        -- Sales and refunds from orders
        SELECT
          o.id                          AS id,
          'order'                       AS source,
          CASE o.status
            WHEN 'paid'     THEN 'sale'
            WHEN 'refunded' THEN 'refund'
            ELSE o.status
          END                           AS type,
          o.created_at                  AS "createdAt",
          o.total_cents                 AS "amountCents",
          o.currency,
          c.id                          AS "customerId",
          c.name                        AS "customerName",
          p.method                      AS method,
          st.name                       AS "storeName",
          u.name                        AS "processedBy",
          NULL::text                    AS note,
          NULL::numeric                 AS "balanceAfterCents",
          o.id                          AS "orderId"
        FROM commerce_orders o
        LEFT JOIN commerce_customers c  ON c.id  = o.customer_id
        LEFT JOIN commerce_payments  p  ON p.organization_id = o.organization_id
                                       AND p.order_id = o.id
        LEFT JOIN commerce_stores   st  ON st.id = o.store_id
        LEFT JOIN commerce_users     u  ON u.id  = o.created_by_user_id
        WHERE o.organization_id = $1
          AND o.status IN ('paid', 'refunded')
          ${storeFilter}
          ${dateFromFilterOrders}
          ${dateToFilterOrders}
          ${customerFilterOrders}

        UNION ALL

        -- Wallet top-ups
        SELECT
          t.id                          AS id,
          'wallet'                      AS source,
          'top_up'                      AS type,
          t.created_at                  AS "createdAt",
          t.amount_cents                AS "amountCents",
          t.currency,
          c.id                          AS "customerId",
          c.name                        AS "customerName",
          'wallet'                      AS method,
          st2.name                      AS "storeName",
          u.name                        AS "processedBy",
          t.note                        AS note,
          t.balance_after_cents         AS "balanceAfterCents",
          t.order_id                    AS "orderId"
        FROM commerce_wallet_transactions t
        JOIN  commerce_wallet_accounts wa ON wa.id = t.wallet_account_id
        JOIN  commerce_customers        c  ON c.id  = wa.customer_id
        LEFT JOIN commerce_orders       o2 ON o2.id = t.order_id
                                          AND o2.organization_id = t.organization_id
        LEFT JOIN commerce_stores      st2 ON st2.id = o2.store_id
        LEFT JOIN commerce_users         u ON u.id  = t.created_by_user_id
        WHERE t.organization_id = $1
          AND t.type = 'top_up'
          ${dateFromFilterWallet}
          ${dateToFilterWallet}
          ${customerFilterWallet}
          ${storeFilterWallet}
      ) combined
      ORDER BY "createdAt" DESC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query(sql, params);

    const rows = result.rows
      .filter((r) => !query.type || r.type === query.type)
      .map((r) => ({
        id: r.id,
        source: r.source,
        type: r.type,
        createdAt: r.createdAt,
        amountCents: toInt(r.amountCents),
        currency: r.currency || "USD",
        customerId: r.customerId,
        customerName: r.customerName || "—",
        method: r.method || null,
        storeName: r.storeName || null,
        processedBy: r.processedBy || "Unknown",
        note: r.note || null,
        balanceAfterCents: r.balanceAfterCents !== null ? toInt(r.balanceAfterCents) : null,
        orderId: r.orderId || null
      }));

    res.json({ data: rows });
  })
);
