import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { createPaidSale, createWalletSale, refundOrder } from "./orders.service.js";
import { getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, parseZod } from "../../shared/http/errors.js";

export const ordersRouter = Router();

const walletSaleSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
  walletAccountId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive()
      })
    )
    .min(1)
});

const paidSaleSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(["cash", "card"]),
  registerName: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive()
      })
    )
    .min(1)
});

const refundOrderSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().max(500).optional()
});

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        storeId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25)
      }),
      req.query
    );

    const values = [query.organizationId];
    const clauses = ["o.organization_id = $1"];

    if (query.storeId) {
      values.push(query.storeId);
      clauses.push(`o.store_id = $${values.length}`);
    }

    if (query.customerId) {
      values.push(query.customerId);
      clauses.push(`o.customer_id = $${values.length}`);
    }

    values.push(query.limit);

    const result = await pool.query(
      `
        SELECT o.id,
               o.organization_id AS "organizationId",
               o.store_id AS "storeId",
               s.name AS "storeName",
               o.customer_id AS "customerId",
               c.name AS "customerName",
               o.status,
               o.payment_status AS "paymentStatus",
               o.subtotal_cents AS "subtotalCents",
               o.tax_cents AS "taxCents",
               o.discount_cents AS "discountCents",
               o.total_cents AS "totalCents",
               o.currency,
               p.method AS "paymentMethod",
               o.created_at AS "createdAt"
        FROM commerce_orders o
        JOIN commerce_stores s
          ON s.organization_id = o.organization_id
         AND s.id = o.store_id
        LEFT JOIN commerce_customers c
          ON c.organization_id = o.organization_id
         AND c.id = o.customer_id
        LEFT JOIN commerce_payments p
          ON p.organization_id = o.organization_id
         AND p.order_id = o.id
        WHERE ${clauses.join(" AND ")}
        ORDER BY o.created_at DESC
        LIMIT $${values.length}
      `,
      values
    );

    res.json({ data: result.rows });
  })
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid()
      }),
      req.query
    );

    const orderResult = await pool.query(
      `
        SELECT o.id,
               o.organization_id AS "organizationId",
               o.store_id AS "storeId",
               s.name AS "storeName",
               o.customer_id AS "customerId",
               c.name AS "customerName",
               o.status,
               o.payment_status AS "paymentStatus",
               o.subtotal_cents AS "subtotalCents",
               o.tax_cents AS "taxCents",
               o.discount_cents AS "discountCents",
               o.total_cents AS "totalCents",
               o.currency,
               p.id AS "paymentId",
               p.method AS "paymentMethod",
               p.status AS "paymentStatusDetail",
               o.created_at AS "createdAt"
        FROM commerce_orders o
        JOIN commerce_stores s
          ON s.organization_id = o.organization_id
         AND s.id = o.store_id
        LEFT JOIN commerce_customers c
          ON c.organization_id = o.organization_id
         AND c.id = o.customer_id
        LEFT JOIN commerce_payments p
          ON p.organization_id = o.organization_id
         AND p.order_id = o.id
        WHERE o.organization_id = $1
          AND o.id = $2
        LIMIT 1
      `,
      [query.organizationId, req.params.id]
    );

    if (!orderResult.rows[0]) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const itemsResult = await pool.query(
      `
        SELECT id,
               product_id AS "productId",
               name_snapshot AS "name",
               unit_price_cents AS "unitPriceCents",
               quantity,
               line_total_cents AS "lineTotalCents",
               currency,
               created_at AS "createdAt"
        FROM commerce_order_items
        WHERE organization_id = $1
          AND order_id = $2
        ORDER BY created_at ASC
      `,
      [query.organizationId, req.params.id]
    );

    const walletResult = await pool.query(
      `
        SELECT wallet_account_id AS "walletAccountId",
               balance_after_cents AS "balanceAfterCents",
               amount_cents AS "amountCents",
               created_at AS "createdAt"
        FROM commerce_wallet_transactions
        WHERE organization_id = $1
          AND order_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [query.organizationId, req.params.id]
    );

    const inventoryResult = await pool.query(
      `
        SELECT m.product_id AS "productId",
               p.name AS "productName",
               m.quantity_delta AS "quantityDelta",
               m.quantity_after AS "quantityAfter",
               m.created_at AS "createdAt"
        FROM commerce_inventory_movements m
        JOIN commerce_products p
          ON p.organization_id = m.organization_id
         AND p.id = m.product_id
        WHERE m.organization_id = $1
          AND m.order_id = $2
        ORDER BY m.created_at ASC
      `,
      [query.organizationId, req.params.id]
    );

    res.json({
      data: {
        order: orderResult.rows[0],
        items: itemsResult.rows,
        wallet: walletResult.rows[0] || null,
        inventory: inventoryResult.rows
      }
    });
  })
);

ordersRouter.post(
  "/:id/refund",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey) {
      throw badRequest("Idempotency-Key header is required");
    }

    const body = parseZod(refundOrderSchema, req.body);
    const actor = getActor(req);
    const result = await refundOrder({
      body: {
        ...body,
        orderId: req.params.id
      },
      idempotencyKey,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
      actorUserId: actor.actorUserId,
      actorService: actor.actorService
    });

    res.status(result.status).json(result.body);
  })
);

ordersRouter.post(
  "/paid-sale",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey) {
      throw badRequest("Idempotency-Key header is required");
    }

    const body = parseZod(paidSaleSchema, req.body);
    const actor = getActor(req);
    const result = await createPaidSale({
      body,
      idempotencyKey,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
      actorUserId: actor.actorUserId,
      actorService: actor.actorService
    });

    res.status(result.status).json(result.body);
  })
);

ordersRouter.post(
  "/wallet-sale",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey) {
      throw badRequest("Idempotency-Key header is required");
    }

    const body = parseZod(walletSaleSchema, req.body);
    const actor = getActor(req);
    const result = await createWalletSale({
      body,
      idempotencyKey,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
      actorUserId: actor.actorUserId,
      actorService: actor.actorService
    });

    res.status(result.status).json(result.body);
  })
);
