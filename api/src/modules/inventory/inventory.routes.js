import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import multer from "multer";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
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

// ── CSV Import ────────────────────────────────────────────────────────────────

const inventoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (!ok) return cb(new Error("Only .csv files are accepted"));
    cb(null, true);
  },
});

const INVENTORY_CSV_ROW_SCHEMA = z.object({
  sku:               z.string().min(1, "sku is required"),
  quantity:          z.string().min(1, "quantity is required"),
  reorder_threshold: z.string().optional(),
  store_name:        z.string().optional(),
});

function parseInventoryCsvRows(buffer) {
  const text = buffer.toString("utf8").replace(/^﻿/, ""); // strip BOM
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

// POST /v1/inventory/import/preview
inventoryRouter.post(
  "/import/preview",
  requirePermission("products:write"),
  inventoryUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    let rawRows;
    try {
      rawRows = parseInventoryCsvRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV — check the file format");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 500) throw badRequest("Max 500 rows per import");

    // Load all active products for this org (keyed by SKU)
    const productsResult = await pool.query(
      `SELECT id, name, sku FROM commerce_products
       WHERE organization_id = $1 AND active = TRUE AND sku IS NOT NULL`,
      [organizationId]
    );
    const productBySku = new Map(
      productsResult.rows.map((p) => [p.sku.toLowerCase().trim(), p])
    );

    // Load all stores for this org (keyed by name, case-insensitive)
    const storesResult = await pool.query(
      `SELECT id, name FROM commerce_stores WHERE organization_id = $1`,
      [organizationId]
    );
    const storeByName = new Map(
      storesResult.rows.map((s) => [s.name.toLowerCase().trim(), s])
    );

    const preview = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2;
      const parsed = INVENTORY_CSV_ROW_SCHEMA.safeParse(rawRows[i]);

      if (!parsed.success) {
        errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }

      const r = parsed.data;
      const quantity = parseNonNegativeInt(r.quantity);
      if (quantity === null) {
        errors.push({ row: rowNum, error: `Invalid quantity: "${r.quantity}" — must be a non-negative integer` });
        continue;
      }

      const reorderThreshold = r.reorder_threshold?.trim()
        ? parseNonNegativeInt(r.reorder_threshold)
        : null;
      if (r.reorder_threshold?.trim() && reorderThreshold === null) {
        errors.push({ row: rowNum, error: `Invalid reorder_threshold: "${r.reorder_threshold}" — must be a non-negative integer` });
        continue;
      }

      const skuKey = r.sku.toLowerCase().trim();
      const product = productBySku.get(skuKey);
      const productFound = product !== undefined;

      const storeNameRaw = r.store_name?.trim() || null;
      let storeFound = null;
      let storeId = null;
      if (storeNameRaw) {
        const store = storeByName.get(storeNameRaw.toLowerCase());
        storeFound = store !== undefined;
        storeId = store?.id ?? null;
      }

      preview.push({
        row: rowNum,
        sku: r.sku.trim(),
        productName: product?.name ?? null,
        storeName: storeNameRaw,
        quantity,
        reorderThreshold,
        productFound,
        storeFound,
        action: productFound ? "set" : "skip",
      });
    }

    res.json({
      data: {
        total: rawRows.length,
        valid: preview.length,
        errors,
        preview,
      },
    });
  })
);

// POST /v1/inventory/import/apply
inventoryRouter.post(
  "/import/apply",
  requirePermission("products:write"),
  inventoryUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    let rawRows;
    try {
      rawRows = parseInventoryCsvRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 500) throw badRequest("Max 500 rows per import");

    const results = { set: 0, skipped: 0, errors: [] };

    await withTransaction(async (client) => {
      // Load all active products for this org (keyed by SKU)
      const productsResult = await client.query(
        `SELECT id, name, sku, store_id AS "storeId"
         FROM commerce_products
         WHERE organization_id = $1 AND active = TRUE AND sku IS NOT NULL`,
        [organizationId]
      );
      const productBySku = new Map(
        productsResult.rows.map((p) => [p.sku.toLowerCase().trim(), p])
      );

      // Load all stores for this org (keyed by name, case-insensitive)
      const storesResult = await client.query(
        `SELECT id, name FROM commerce_stores WHERE organization_id = $1`,
        [organizationId]
      );
      const storeByName = new Map(
        storesResult.rows.map((s) => [s.name.toLowerCase().trim(), s])
      );
      const allStoreIds = storesResult.rows.map((s) => s.id);

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const parsed = INVENTORY_CSV_ROW_SCHEMA.safeParse(rawRows[i]);

        if (!parsed.success) {
          results.errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
          continue;
        }

        const r = parsed.data;
        const quantity = parseNonNegativeInt(r.quantity);
        if (quantity === null) {
          results.errors.push({ row: rowNum, error: `Invalid quantity: "${r.quantity}"` });
          continue;
        }

        const reorderThreshold = r.reorder_threshold?.trim()
          ? parseNonNegativeInt(r.reorder_threshold)
          : null;
        if (r.reorder_threshold?.trim() && reorderThreshold === null) {
          results.errors.push({ row: rowNum, error: `Invalid reorder_threshold: "${r.reorder_threshold}"` });
          continue;
        }

        const skuKey = r.sku.toLowerCase().trim();
        const product = productBySku.get(skuKey);

        if (!product) {
          results.skipped++;
          continue;
        }

        // Determine target stores
        const storeNameRaw = r.store_name?.trim() || null;
        let targetStoreIds;
        if (storeNameRaw) {
          const store = storeByName.get(storeNameRaw.toLowerCase());
          if (!store) {
            results.errors.push({ row: rowNum, error: `Store not found: "${storeNameRaw}"` });
            continue;
          }
          targetStoreIds = [store.id];
        } else {
          // Apply to all stores for the org (or to the product's store if set)
          targetStoreIds = product.storeId ? [product.storeId] : allStoreIds;
          // If no stores exist, skip with an informational note
          if (targetStoreIds.length === 0) {
            results.errors.push({ row: rowNum, error: `No stores found for org; specify store_name or create a store first` });
            continue;
          }
        }

        try {
          for (const storeId of targetStoreIds) {
            // Get current quantity_on_hand (0 if no row yet)
            const currentResult = await client.query(
              `SELECT COALESCE(quantity_on_hand, 0) AS qty
               FROM commerce_inventory_items
               WHERE organization_id = $1 AND store_id = $2 AND product_id = $3`,
              [organizationId, storeId, product.id]
            );
            const oldQty = currentResult.rowCount > 0 ? Number(currentResult.rows[0].qty) : 0;
            const delta = quantity - oldQty;

            // Upsert inventory item
            await client.query(
              `INSERT INTO commerce_inventory_items
                 (organization_id, store_id, product_id, quantity_on_hand, track_inventory
                  ${reorderThreshold !== null ? ", reorder_threshold" : ""})
               VALUES ($1, $2, $3, $4, TRUE
                  ${reorderThreshold !== null ? ", $5" : ""})
               ON CONFLICT (organization_id, store_id, product_id) DO UPDATE
                 SET quantity_on_hand = EXCLUDED.quantity_on_hand,
                     track_inventory  = TRUE,
                     updated_at       = NOW()
                     ${reorderThreshold !== null ? ", reorder_threshold = EXCLUDED.reorder_threshold" : ""}`,
              reorderThreshold !== null
                ? [organizationId, storeId, product.id, quantity, reorderThreshold]
                : [organizationId, storeId, product.id, quantity]
            );

            // Record adjustment movement
            await client.query(
              `INSERT INTO commerce_inventory_movements
                 (organization_id, store_id, product_id, type, quantity_delta, quantity_after, note)
               VALUES ($1, $2, $3, 'adjustment', $4, $5, 'CSV import')`,
              [organizationId, storeId, product.id, delta, quantity]
            );
          }
          results.set++;
        } catch (err) {
          results.errors.push({ row: rowNum, sku: r.sku, error: err.message });
        }
      }
    });

    res.json({ data: results });
  })
);
