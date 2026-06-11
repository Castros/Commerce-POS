import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, conflict, notFound, parseZod } from "../../shared/http/errors.js";

export const productCategoriesRouter = Router();

const CATEGORY_SELECT = `
  SELECT id, organization_id AS "organizationId", name, description,
         sort_order AS "sortOrder", color, is_system AS "isSystem",
         active, created_at AS "createdAt"
  FROM commerce_product_categories
`;

const createCategorySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
  color: z.string().nullable().optional()
});

const updateCategorySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  color: z.string().nullable().optional(),
  active: z.boolean().optional()
});

productCategoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = z.object({
      organizationId: z.string().uuid(),
      includeInactive: z.enum(["true", "false"]).optional().default("false")
    }).parse(req.query);

    authorizeTenant(req.actor, query.organizationId);

    const result = await pool.query(
      `${CATEGORY_SELECT}
       WHERE organization_id = $1
         AND ($2::boolean = TRUE OR active = TRUE)
       ORDER BY sort_order ASC, name ASC`,
      [query.organizationId, query.includeInactive === "true"]
    );

    res.json({ data: result.rows });
  })
);

productCategoriesRouter.post(
  "/",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createCategorySchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    try {
      const result = await pool.query(
        `INSERT INTO commerce_product_categories
           (organization_id, name, description, sort_order, color)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id AS "organizationId", name, description,
                   sort_order AS "sortOrder", color, is_system AS "isSystem",
                   active, created_at AS "createdAt"`,
        [body.organizationId, body.name, body.description ?? null, body.sortOrder, body.color ?? null]
      );
      res.status(201).json({ data: result.rows[0] });
    } catch (err) {
      if (err.code === "23505") throw conflict("A category with this name already exists");
      throw err;
    }
  })
);

productCategoriesRouter.patch(
  "/:id",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = parseZod(updateCategorySchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    const cols = [];
    const vals = [];
    let i = 1;

    if (body.name        !== undefined) { cols.push(`name = $${i++}`);        vals.push(body.name); }
    if (body.description !== undefined) { cols.push(`description = $${i++}`); vals.push(body.description); }
    if (body.sortOrder   !== undefined) { cols.push(`sort_order = $${i++}`);  vals.push(body.sortOrder); }
    if (body.color       !== undefined) { cols.push(`color = $${i++}`);       vals.push(body.color); }
    if (body.active      !== undefined) { cols.push(`active = $${i++}`);      vals.push(body.active); }

    if (cols.length === 0) {
      const existing = await pool.query(
        `${CATEGORY_SELECT} WHERE organization_id = $1 AND id = $2`,
        [body.organizationId, id]
      );
      if (existing.rowCount === 0) throw notFound("Category not found");
      return res.json({ data: existing.rows[0] });
    }

    vals.push(body.organizationId, id);

    try {
      const result = await pool.query(
        `UPDATE commerce_product_categories SET ${cols.join(", ")}
         WHERE organization_id = $${i} AND id = $${i + 1}
         RETURNING id, organization_id AS "organizationId", name, description,
                   sort_order AS "sortOrder", color, is_system AS "isSystem",
                   active, created_at AS "createdAt"`,
        vals
      );
      if (result.rowCount === 0) throw notFound("Category not found");
      res.json({ data: result.rows[0] });
    } catch (err) {
      if (err.code === "23505") throw conflict("A category with this name already exists");
      throw err;
    }
  })
);
