import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, authorizeStore, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";

export const inventoryRouter = Router();

const inventoryQuerySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  lowStock: z.coerce.boolean().optional()
});

const adjustmentSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  quantityDelta: z.number().int().refine((value) => value !== 0, {
    message: "quantityDelta cannot be zero"
  }),
  note: z.string().max(500).optional()
});

inventoryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(inventoryQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);
    const values = [query.organizationId];
    const clauses = ["p.organization_id = $1", "p.active = TRUE"];

    if (query.storeId) {
      values.push(query.storeId);
      clauses.push(`(p.store_id = $${values.length} OR p.store_id IS NULL)`);
    }

    const lowStockClause = query.lowStock
      ? "AND COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_threshold, 0)"
      : "";

    const result = await pool.query(
      `
        SELECT p.id AS "productId",
               p.organization_id AS "organizationId",
               COALESCE(i.store_id, p.store_id) AS "storeId",
               p.name,
               p.sku,
               p.description,
               p.price_cents AS "priceCents",
               p.currency,
               p.taxable,
               COALESCE(i.quantity_on_hand, 0) AS "quantityOnHand",
               COALESCE(i.reorder_threshold, 0) AS "reorderThreshold",
               i.location,
               COALESCE(i.track_inventory, FALSE) AS "trackInventory",
               CASE
                 WHEN i.id IS NULL THEN 'not_tracked'
                 WHEN i.quantity_on_hand = 0 THEN 'out'
                 WHEN i.quantity_on_hand <= i.reorder_threshold THEN 'low'
                 ELSE 'in_stock'
               END AS "status",
               i.updated_at AS "updatedAt"
        FROM commerce_products p
        LEFT JOIN commerce_inventory_items i
          ON i.organization_id = p.organization_id
         AND i.product_id = p.id
         AND (p.store_id IS NULL OR i.store_id = p.store_id)
        WHERE ${clauses.join(" AND ")}
          ${lowStockClause}
        ORDER BY p.name ASC
      `,
      values
    );

    res.json({ data: result.rows });
  })
);

inventoryRouter.post(
  "/:productId/adjustments",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const body = parseZod(adjustmentSchema, req.body);
    await authorizeStore(req.actor, body.organizationId, body.storeId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const productResult = await client.query(
        `
          SELECT id
          FROM commerce_products
          WHERE organization_id = $1
            AND id = $2
            AND active = TRUE
            AND (store_id = $3 OR store_id IS NULL)
        `,
        [body.organizationId, productId, body.storeId]
      );

      if (productResult.rowCount === 0) {
        throw notFound("Product not found");
      }

      const inventoryResult = await client.query(
        `
          INSERT INTO commerce_inventory_items (
            organization_id,
            store_id,
            product_id,
            quantity_on_hand
          )
          VALUES ($1, $2, $3, 0)
          ON CONFLICT (organization_id, store_id, product_id)
          DO UPDATE SET updated_at = commerce_inventory_items.updated_at
          RETURNING *
        `,
        [body.organizationId, body.storeId, productId]
      );

      const current = inventoryResult.rows[0];
      const quantityAfter = Number(current.quantity_on_hand) + body.quantityDelta;
      if (quantityAfter < 0) {
        throw badRequest("Adjustment would make inventory negative");
      }

      const updated = await client.query(
        `
          UPDATE commerce_inventory_items
          SET quantity_on_hand = $4,
              updated_at = NOW()
          WHERE organization_id = $1
            AND store_id = $2
            AND product_id = $3
          RETURNING product_id AS "productId",
                    organization_id AS "organizationId",
                    store_id AS "storeId",
                    quantity_on_hand AS "quantityOnHand",
                    reorder_threshold AS "reorderThreshold",
                    location,
                    track_inventory AS "trackInventory",
                    updated_at AS "updatedAt"
        `,
        [body.organizationId, body.storeId, productId, quantityAfter]
      );

      await client.query(
        `
          INSERT INTO commerce_inventory_movements (
            organization_id,
            store_id,
            product_id,
            type,
            quantity_delta,
            quantity_after,
            note
          )
          VALUES ($1, $2, $3, 'adjustment', $4, $5, $6)
        `,
        [body.organizationId, body.storeId, productId, body.quantityDelta, quantityAfter, body.note || null]
      );

      await client.query("COMMIT");
      res.status(201).json({ data: updated.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);
