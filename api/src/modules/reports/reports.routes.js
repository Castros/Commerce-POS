import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, parseZod } from "../../shared/http/errors.js";

export const reportsRouter = Router();

const summaryQuerySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional()
});

function toInt(value) {
  return Number(value || 0);
}

function buildOrderFilter(query) {
  const values = [query.organizationId];
  const clauses = ["o.organization_id = $1"];

  if (query.storeId) {
    values.push(query.storeId);
    clauses.push(`o.store_id = $${values.length}`);
  }

  if (query.dateFrom) {
    values.push(query.dateFrom);
    clauses.push(`o.created_at >= $${values.length}`);
  }

  if (query.dateTo) {
    values.push(query.dateTo);
    clauses.push(`o.created_at <= $${values.length}`);
  }

  return {
    clauses,
    values
  };
}

function buildDrawerFilter(query) {
  const values = [query.organizationId];
  const clauses = ["s.organization_id = $1"];

  if (query.storeId) {
    values.push(query.storeId);
    clauses.push(`s.store_id = $${values.length}`);
  }

  if (query.dateFrom) {
    values.push(query.dateFrom);
    clauses.push(`s.opened_at >= $${values.length}`);
  }

  if (query.dateTo) {
    values.push(query.dateTo);
    clauses.push(`s.opened_at <= $${values.length}`);
  }

  return {
    clauses,
    values
  };
}

reportsRouter.get(
  "/summary",
  requirePermission("reports:read"),
  asyncHandler(async (req, res) => {
    const query = parseZod(summaryQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);
    const orderFilter = buildOrderFilter(query);
    const drawerFilter = buildDrawerFilter(query);

    const totalsResult = await pool.query(
      `
        SELECT COUNT(*) FILTER (WHERE o.status = 'paid') AS "paidOrderCount",
               COUNT(*) FILTER (WHERE o.status = 'refunded') AS "refundedOrderCount",
               COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0) AS "grossSalesCents",
               COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'refunded'), 0) AS "refundedSalesCents",
               COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid' AND p.method = 'wallet'), 0) AS "walletSalesCents",
               COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid' AND p.method = 'cash'), 0) AS "cashSalesCents",
               COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid' AND p.method = 'card'), 0) AS "cardSalesCents",
               COALESCE(AVG(o.total_cents) FILTER (WHERE o.status = 'paid'), 0) AS "averageOrderCents"
        FROM commerce_orders o
        LEFT JOIN commerce_payments p
          ON p.organization_id = o.organization_id
         AND p.order_id = o.id
        WHERE ${orderFilter.clauses.join(" AND ")}
      `,
      orderFilter.values
    );

    const productResult = await pool.query(
      `
        SELECT oi.product_id AS "productId",
               oi.name_snapshot AS "productName",
               COALESCE(SUM(oi.quantity), 0) AS "unitsSold",
               COALESCE(SUM(oi.line_total_cents), 0) AS "revenueCents",
               CASE
                 WHEN COUNT(oi.unit_cost_cents) = COUNT(*) THEN
                   COALESCE(SUM(oi.unit_cost_cents * oi.quantity), 0)
                 ELSE NULL
               END AS "cogsCents"
        FROM commerce_order_items oi
        JOIN commerce_orders o
          ON o.organization_id = oi.organization_id
         AND o.id = oi.order_id
        WHERE ${orderFilter.clauses.join(" AND ")}
          AND o.status = 'paid'
        GROUP BY oi.product_id, oi.name_snapshot
        ORDER BY "revenueCents" DESC, "unitsSold" DESC
        LIMIT 10
      `,
      orderFilter.values
    );

    const storeResult = await pool.query(
      `
        SELECT s.id AS "storeId",
               s.name AS "storeName",
               COUNT(*) FILTER (WHERE o.status = 'paid') AS "orderCount",
               COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0) AS "salesCents"
        FROM commerce_orders o
        JOIN commerce_stores s
          ON s.organization_id = o.organization_id
         AND s.id = o.store_id
        WHERE ${orderFilter.clauses.join(" AND ")}
        GROUP BY s.id, s.name
        ORDER BY "salesCents" DESC
      `,
      orderFilter.values
    );

    const paymentResult = await pool.query(
      `
        SELECT p.method,
               COUNT(*) FILTER (WHERE o.status = 'paid') AS "orderCount",
               COALESCE(SUM(p.amount_cents) FILTER (WHERE o.status = 'paid' AND p.status = 'succeeded'), 0) AS "amountCents"
        FROM commerce_orders o
        JOIN commerce_payments p
          ON p.organization_id = o.organization_id
         AND p.order_id = o.id
        WHERE ${orderFilter.clauses.join(" AND ")}
        GROUP BY p.method
        ORDER BY "amountCents" DESC
      `,
      orderFilter.values
    );

    const walletResult = await pool.query(
      `
        SELECT COALESCE(SUM(ABS(t.amount_cents)) FILTER (WHERE t.type = 'purchase'), 0) AS "walletSpendCents",
               COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'top_up'), 0) AS "walletTopUpsCents",
               COALESCE(SUM(t.amount_cents) FILTER (WHERE t.type = 'refund'), 0) AS "walletRefundsCents",
               COUNT(DISTINCT t.wallet_account_id) FILTER (WHERE t.type = 'purchase') AS "walletStudentCount"
        FROM commerce_wallet_transactions t
        LEFT JOIN commerce_orders o
          ON o.organization_id = t.organization_id
         AND o.id = t.order_id
        WHERE t.organization_id = $1
          AND ($2::uuid IS NULL OR o.store_id = $2)
          AND ($3::timestamptz IS NULL OR t.created_at >= $3)
          AND ($4::timestamptz IS NULL OR t.created_at <= $4)
      `,
      [
        query.organizationId,
        query.storeId || null,
        query.dateFrom || null,
        query.dateTo || null
      ]
    );

    const drawerResult = await pool.query(
      `
        SELECT s.id,
               st.name AS "storeName",
               s.register_name AS "registerName",
               s.status,
               s.opening_cash_cents AS "openingCashCents",
               s.expected_cash_cents AS "expectedCashCents",
               s.counted_cash_cents AS "countedCashCents",
               COALESCE(s.over_short_cents, 0) AS "overShortCents",
               s.opened_at AS "openedAt",
               s.closed_at AS "closedAt"
        FROM commerce_cash_drawer_sessions s
        JOIN commerce_stores st
          ON st.organization_id = s.organization_id
         AND st.id = s.store_id
        WHERE ${drawerFilter.clauses.join(" AND ")}
        ORDER BY s.opened_at DESC
        LIMIT 10
      `,
      drawerFilter.values
    );

    const totals = totalsResult.rows[0] || {};
    const wallet = walletResult.rows[0] || {};

    res.json({
      data: {
        filters: {
          organizationId: query.organizationId,
          storeId: query.storeId || null,
          dateFrom: query.dateFrom || null,
          dateTo: query.dateTo || null
        },
        totals: {
          paidOrderCount: toInt(totals.paidOrderCount),
          refundedOrderCount: toInt(totals.refundedOrderCount),
          grossSalesCents: toInt(totals.grossSalesCents),
          refundedSalesCents: toInt(totals.refundedSalesCents),
          netSalesCents: toInt(totals.grossSalesCents) - toInt(totals.refundedSalesCents),
          walletSalesCents: toInt(totals.walletSalesCents),
          cashSalesCents: toInt(totals.cashSalesCents),
          cardSalesCents: toInt(totals.cardSalesCents),
          averageOrderCents: Math.round(toInt(totals.averageOrderCents))
        },
        wallet: {
          walletSpendCents: toInt(wallet.walletSpendCents),
          walletTopUpsCents: toInt(wallet.walletTopUpsCents),
          walletRefundsCents: toInt(wallet.walletRefundsCents),
          walletStudentCount: toInt(wallet.walletStudentCount)
        },
        productSales: productResult.rows.map((row) => {
          const revenue = toInt(row.revenueCents);
          const cogs = row.cogsCents !== null ? toInt(row.cogsCents) : null;
          const grossProfit = cogs !== null ? revenue - cogs : null;
          const marginPct = cogs !== null && revenue > 0
            ? Math.round((grossProfit / revenue) * 1000) / 10
            : null;
          return {
            productId: row.productId,
            productName: row.productName,
            unitsSold: toInt(row.unitsSold),
            revenueCents: revenue,
            cogsCents: cogs,
            grossProfitCents: grossProfit,
            marginPct
          };
        }),
        storeSales: storeResult.rows.map((row) => ({
          storeId: row.storeId,
          storeName: row.storeName,
          orderCount: toInt(row.orderCount),
          salesCents: toInt(row.salesCents)
        })),
        paymentMethods: paymentResult.rows.map((row) => ({
          method: row.method,
          orderCount: toInt(row.orderCount),
          amountCents: toInt(row.amountCents)
        })),
        cashDrawers: drawerResult.rows.map((row) => ({
          id: row.id,
          storeName: row.storeName,
          registerName: row.registerName,
          status: row.status,
          openingCashCents: toInt(row.openingCashCents),
          expectedCashCents: toInt(row.expectedCashCents),
          countedCashCents: row.countedCashCents === null ? null : toInt(row.countedCashCents),
          overShortCents: toInt(row.overShortCents),
          openedAt: row.openedAt,
          closedAt: row.closedAt
        }))
      }
    });
  })
);
