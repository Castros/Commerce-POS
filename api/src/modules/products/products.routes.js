import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, parseZod } from "../../shared/http/errors.js";

export const productsRouter = Router();

const createProductSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  sku: z.string().min(1).nullable().optional(),
  imageUrl: z.string().min(1).nullable().optional(),
  priceCents: z.number().int().min(0),
  taxable: z.boolean().default(false)
});

const updateProductSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sku: z.string().min(1).nullable().optional(),
  imageUrl: z.string().min(1).nullable().optional(),
  priceCents: z.number().int().min(0).optional(),
  taxable: z.boolean().optional(),
  active: z.boolean().optional()
});

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        organizationId: z.string().uuid(),
        storeId: z.string().uuid().optional(),
        includeInactive: z
          .enum(["true", "false"])
          .optional()
          .default("false")
      })
      .parse(req.query);

    const values = [query.organizationId];
    let storeClause = "";
    if (query.storeId) {
      values.push(query.storeId);
      storeClause = "AND (store_id = $2 OR store_id IS NULL)";
    }

    const result = await pool.query(
      `
        SELECT id, organization_id AS "organizationId", store_id AS "storeId",
               name, description, sku, image_url AS "imageUrl", price_cents AS "priceCents",
               currency, taxable, active, created_at AS "createdAt"
        FROM commerce_products
        WHERE organization_id = $1
          AND ($${query.storeId ? 3 : 2}::boolean = TRUE OR active = TRUE)
          ${storeClause}
        ORDER BY name ASC
      `,
      [...values, query.includeInactive === "true"]
    );
    res.json({ data: result.rows });
  })
);

productsRouter.patch(
  "/:id",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateProductSchema, req.body);

    const result = await pool.query(
      `
        UPDATE commerce_products
        SET store_id = COALESCE($3, store_id),
            category_id = COALESCE($4, category_id),
            name = COALESCE($5, name),
            description = $6,
            sku = $7,
            image_url = $8,
            price_cents = COALESCE($9, price_cents),
            taxable = COALESCE($10, taxable),
            active = COALESCE($11, active)
        WHERE organization_id = $1
          AND id = $2
        RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                  name, description, sku, image_url AS "imageUrl", price_cents AS "priceCents",
                  currency, taxable, active, created_at AS "createdAt"
      `,
      [
        body.organizationId,
        id,
        body.storeId ?? null,
        body.categoryId ?? null,
        body.name ?? null,
        body.description ?? null,
        body.sku ?? null,
        body.imageUrl ?? null,
        body.priceCents ?? null,
        body.taxable ?? null,
        body.active ?? null
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    res.json({ data: result.rows[0] });
  })
);

productsRouter.post(
  "/",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createProductSchema, req.body);
    const result = await pool.query(
      `
        INSERT INTO commerce_products (
          organization_id,
          store_id,
          category_id,
          name,
          description,
          sku,
          image_url,
          price_cents,
          taxable
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                  name, description, sku, image_url AS "imageUrl", price_cents AS "priceCents",
                  currency, taxable, active, created_at AS "createdAt"
      `,
      [
        body.organizationId,
        body.storeId || null,
        body.categoryId || null,
        body.name,
        body.description || null,
        body.sku || null,
        body.imageUrl || null,
        body.priceCents,
        body.taxable
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);
