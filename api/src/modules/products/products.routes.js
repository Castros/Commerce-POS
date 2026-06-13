import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, loadActorCategoryRestrictions, requirePermission } from "../../shared/auth/auth.js";
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
  costCents: z.number().int().min(0).nullable().optional(),
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
  costCents: z.number().int().min(0).nullable().optional(),
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

    authorizeTenant(req.actor, query.organizationId);

    const allowedCategoryIds = await loadActorCategoryRestrictions(
      query.organizationId,
      req.actor.actorUserId,
      req.actor.role
    );

    const values = [query.organizationId];
    let storeClause = "";
    if (query.storeId) {
      values.push(query.storeId);
      storeClause = "AND (p.store_id = $2 OR p.store_id IS NULL)";
    }

    let categoryClause = "";
    if (allowedCategoryIds !== null) {
      values.push(allowedCategoryIds);
      categoryClause = `AND (p.category_id IS NULL OR p.category_id = ANY($${values.length}::uuid[]))`;
    }

    const includeParam = values.length + 1;
    values.push(query.includeInactive === "true");

    const result = await pool.query(
      `
        SELECT p.id, p.organization_id AS "organizationId", p.store_id AS "storeId",
               p.category_id AS "categoryId", pc.name AS "categoryName",
               p.name, p.description, p.sku, p.image_url AS "imageUrl",
               p.price_cents AS "priceCents", p.cost_cents AS "costCents",
               p.currency, p.taxable,
               p.active, p.created_at AS "createdAt"
        FROM commerce_products p
        LEFT JOIN commerce_product_categories pc ON pc.id = p.category_id
        WHERE p.organization_id = $1
          AND p.is_virtual = FALSE
          AND ($${includeParam}::boolean = TRUE OR p.active = TRUE)
          ${storeClause}
          ${categoryClause}
        ORDER BY p.name ASC
      `,
      values
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
    authorizeTenant(req.actor, body.organizationId);

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
            cost_cents = CASE WHEN $10::boolean THEN $11::integer ELSE cost_cents END,
            taxable = COALESCE($12, taxable),
            active = COALESCE($13, active)
        WHERE organization_id = $1
          AND id = $2
        RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                  name, description, sku, image_url AS "imageUrl", price_cents AS "priceCents",
                  cost_cents AS "costCents", currency, taxable, active, created_at AS "createdAt"
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
        "costCents" in body,
        body.costCents ?? null,
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
    authorizeTenant(req.actor, body.organizationId);
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
          cost_cents,
          taxable
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                  name, description, sku, image_url AS "imageUrl", price_cents AS "priceCents",
                  cost_cents AS "costCents", currency, taxable, active, created_at AS "createdAt"
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
        body.costCents ?? null,
        body.taxable
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);
