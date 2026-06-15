import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import multer from "multer";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { authorizeTenant, authorizeStore, requirePermission, getActor } from "../../shared/auth/auth.js";
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

// ── Movement history for a product ───────────────────────────────────────────

inventoryRouter.get(
  "/:productId/history",
  asyncHandler(async (req, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        storeId: z.string().uuid().optional()
      }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId, productId];
    const storeClause = query.storeId
      ? (values.push(query.storeId), `AND m.store_id = $${values.length}`)
      : "";

    const result = await pool.query(
      `SELECT m.id,
              m.type,
              m.quantity_delta  AS "quantityDelta",
              m.quantity_after  AS "quantityAfter",
              m.note,
              m.created_at      AS "createdAt",
              u.name            AS "createdBy"
       FROM commerce_inventory_movements m
       LEFT JOIN commerce_users u ON u.id = m.created_by_user_id
       WHERE m.organization_id = $1
         AND m.product_id      = $2
         ${storeClause}
       ORDER BY m.created_at DESC
       LIMIT 20`,
      values
    );

    res.json({ data: result.rows });
  })
);

// ── Update inventory item settings (reorder threshold, location) ──────────────

inventoryRouter.patch(
  "/:productId/settings",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const productId = z.string().uuid().parse(req.params.productId);
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        storeId: z.string().uuid(),
        reorderThreshold: z.number().int().min(0).optional(),
        location: z.string().max(200).nullable().optional()
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const setClauses = [];
    const values = [body.organizationId, body.storeId, productId];

    if (body.reorderThreshold !== undefined) {
      values.push(body.reorderThreshold);
      setClauses.push(`reorder_threshold = $${values.length}`);
    }
    if (body.location !== undefined) {
      values.push(body.location);
      setClauses.push(`location = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return res.json({ data: null });
    }

    setClauses.push("updated_at = NOW()");

    const result = await pool.query(
      `UPDATE commerce_inventory_items
       SET ${setClauses.join(", ")}
       WHERE organization_id = $1
         AND store_id        = $2
         AND product_id      = $3
       RETURNING product_id AS "productId",
                 reorder_threshold AS "reorderThreshold",
                 location,
                 updated_at AS "updatedAt"`,
      values
    );

    if (result.rowCount === 0) {
      // Row may not exist yet — upsert with defaults
      const upsert = await pool.query(
        `INSERT INTO commerce_inventory_items
           (organization_id, store_id, product_id, quantity_on_hand,
            reorder_threshold, location, track_inventory)
         VALUES ($1, $2, $3, 0,
            ${body.reorderThreshold !== undefined ? body.reorderThreshold : 0},
            ${body.location !== undefined ? "$4" : "NULL"},
            TRUE)
         ON CONFLICT (organization_id, store_id, product_id) DO UPDATE
           SET ${setClauses.join(", ")}
         RETURNING product_id AS "productId",
                   reorder_threshold AS "reorderThreshold",
                   location,
                   updated_at AS "updatedAt"`,
        body.location !== undefined
          ? [body.organizationId, body.storeId, productId, body.location]
          : [body.organizationId, body.storeId, productId]
      );
      return res.json({ data: upsert.rows[0] });
    }

    res.json({ data: result.rows[0] });
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

// ════════════════════════════════════════════════════════════════════════════
// SUPPLIERS
// ════════════════════════════════════════════════════════════════════════════

const supplierSchema = z.object({
  organizationId: z.string().uuid(),
  name:           z.string().min(1).max(200),
  vendorNumber:   z.string().max(100).optional().nullable(),
  email:          z.string().email().optional().nullable(),
  phone:          z.string().max(50).optional().nullable(),
  addressLine1:   z.string().max(200).optional().nullable(),
  city:           z.string().max(100).optional().nullable(),
  region:         z.string().max(100).optional().nullable(),
  postalCode:     z.string().max(20).optional().nullable(),
  notes:          z.string().max(1000).optional().nullable()
});

inventoryRouter.get(
  "/suppliers",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({ organizationId: z.string().uuid() }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const result = await pool.query(
      `SELECT id, name, vendor_number AS "vendorNumber", email, phone,
              address_line1 AS "addressLine1", city, region, postal_code AS "postalCode",
              notes, active, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM commerce_inventory_suppliers
       WHERE organization_id = $1
       ORDER BY name ASC`,
      [query.organizationId]
    );
    res.json({ data: result.rows });
  })
);

inventoryRouter.post(
  "/suppliers",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(supplierSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);

    const result = await pool.query(
      `INSERT INTO commerce_inventory_suppliers
         (organization_id, name, vendor_number, email, phone,
          address_line1, city, region, postal_code, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, vendor_number AS "vendorNumber", email, phone,
                 address_line1 AS "addressLine1", city, region,
                 postal_code AS "postalCode", notes, active,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        body.organizationId, body.name, body.vendorNumber ?? null,
        body.email ?? null, body.phone ?? null, body.addressLine1 ?? null,
        body.city ?? null, body.region ?? null, body.postalCode ?? null,
        body.notes ?? null
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);

inventoryRouter.patch(
  "/suppliers/:id",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const supplierId = z.string().uuid().parse(req.params.id);
    const body = parseZod(supplierSchema.partial().extend({
      organizationId: z.string().uuid(),
      active: z.boolean().optional()
    }), req.body);
    authorizeTenant(req.actor, body.organizationId);

    const fields = ["updated_at = NOW()"];
    const values = [body.organizationId, supplierId];
    const optional = {
      name: body.name, vendor_number: body.vendorNumber, email: body.email,
      phone: body.phone, address_line1: body.addressLine1, city: body.city,
      region: body.region, postal_code: body.postalCode,
      notes: body.notes, active: body.active
    };
    for (const [col, val] of Object.entries(optional)) {
      if (val !== undefined) {
        values.push(val);
        fields.push(`${col} = $${values.length}`);
      }
    }

    const result = await pool.query(
      `UPDATE commerce_inventory_suppliers
       SET ${fields.join(", ")}
       WHERE organization_id = $1 AND id = $2
       RETURNING id, name, vendor_number AS "vendorNumber", email, phone,
                 address_line1 AS "addressLine1", city, region,
                 postal_code AS "postalCode", notes, active,
                 updated_at AS "updatedAt"`,
      values
    );
    if (result.rowCount === 0) throw notFound("Supplier not found");
    res.json({ data: result.rows[0] });
  })
);

// ════════════════════════════════════════════════════════════════════════════
// INVOICES
// ════════════════════════════════════════════════════════════════════════════

const invoiceLineSchema = z.object({
  productId:      z.string().uuid().optional().nullable(),
  productName:    z.string().min(1).max(300),
  sku:            z.string().max(100).optional().nullable(),
  quantity:       z.number().int().positive(),
  unitCostCents:  z.number().int().min(0),
  matchStatus:    z.enum(["matched", "manual", "skipped", "unmatched"]).default("matched"),
  confidence:     z.number().min(0).max(1).optional().nullable(),
  aiExtractedText: z.string().optional().nullable()
});

const invoiceCreateSchema = z.object({
  organizationId: z.string().uuid(),
  storeId:        z.string().uuid().optional().nullable(),
  supplierId:     z.string().uuid().optional().nullable(),
  invoiceNumber:  z.string().max(100).optional().nullable(),
  invoiceDate:    z.string().optional().nullable(),
  receivedDate:   z.string().optional().nullable(),
  source:         z.enum(["manual", "ai_image", "ai_pdf", "csv"]).default("manual"),
  notes:          z.string().max(2000).optional().nullable(),
  rawFileUrl:     z.string().url().optional().nullable(),
  lines:          z.array(invoiceLineSchema).min(1)
});

inventoryRouter.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        status: z.string().optional(),
        storeId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50)
      }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const values = [query.organizationId];
    const clauses = ["i.organization_id = $1"];
    if (query.status) { values.push(query.status); clauses.push(`i.status = $${values.length}`); }
    if (query.storeId) { values.push(query.storeId); clauses.push(`i.store_id = $${values.length}`); }
    values.push(query.limit);

    const result = await pool.query(
      `SELECT i.id, i.invoice_number AS "invoiceNumber", i.invoice_date AS "invoiceDate",
              i.received_date AS "receivedDate", i.source, i.status,
              i.total_cents AS "totalCents", i.tax_cents AS "taxCents",
              i.notes, i.attachment_url AS "rawFileUrl",
              i.approved_at AS "approvedAt", i.created_at AS "createdAt",
              s.name AS "supplierName", st.name AS "storeName",
              u.name AS "approvedBy", cu.name AS "createdByName",
              COUNT(l.id)::int AS "lineCount"
       FROM commerce_inventory_invoices i
       LEFT JOIN commerce_inventory_suppliers s  ON s.id = i.supplier_id
       LEFT JOIN commerce_stores            st  ON st.id = i.store_id
       LEFT JOIN commerce_users              u  ON u.id = i.approved_by_user_id
       LEFT JOIN commerce_users             cu  ON cu.id = i.created_by
       LEFT JOIN commerce_inventory_invoice_lines l ON l.invoice_id = i.id
       WHERE ${clauses.join(" AND ")}
       GROUP BY i.id, s.name, st.name, u.name, cu.name
       ORDER BY i.created_at DESC
       LIMIT $${values.length}`,
      values
    );
    res.json({ data: result.rows });
  })
);

inventoryRouter.get(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    const invoiceId = z.string().uuid().parse(req.params.id);
    const query = parseZod(z.object({ organizationId: z.string().uuid() }), req.query);
    authorizeTenant(req.actor, query.organizationId);

    const [invoiceResult, linesResult] = await Promise.all([
      pool.query(
        `SELECT i.id, i.invoice_number AS "invoiceNumber", i.invoice_date AS "invoiceDate",
                i.received_date AS "receivedDate", i.source, i.status,
                i.total_cents AS "totalCents", i.tax_cents AS "taxCents",
                i.notes, i.attachment_url AS "rawFileUrl",
                i.approved_at AS "approvedAt", i.created_at AS "createdAt",
                s.name AS "supplierName", s.id AS "supplierId",
                st.name AS "storeName", st.id AS "storeId",
                u.name AS "approvedBy", cu.name AS "createdByName"
         FROM commerce_inventory_invoices i
         LEFT JOIN commerce_inventory_suppliers s  ON s.id = i.supplier_id
         LEFT JOIN commerce_stores            st  ON st.id = i.store_id
         LEFT JOIN commerce_users              u  ON u.id = i.approved_by_user_id
         LEFT JOIN commerce_users             cu  ON cu.id = i.created_by
         WHERE i.organization_id = $1 AND i.id = $2`,
        [query.organizationId, invoiceId]
      ),
      pool.query(
        `SELECT l.id, l.product_id AS "productId", l.product_name AS "productName",
                l.sku, l.quantity, l.unit_cost_cents AS "unitCostCents",
                l.line_total_cents AS "lineTotalCents", l.match_status AS "matchStatus",
                l.confidence, l.ai_extracted_text AS "aiExtractedText",
                p.name AS "currentProductName"
         FROM commerce_inventory_invoice_lines l
         LEFT JOIN commerce_products p ON p.id = l.product_id
         WHERE l.invoice_id = $1 AND l.organization_id = $2
         ORDER BY l.created_at ASC`,
        [invoiceId, query.organizationId]
      )
    ]);

    if (invoiceResult.rowCount === 0) throw notFound("Invoice not found");
    res.json({ data: { ...invoiceResult.rows[0], lines: linesResult.rows } });
  })
);

inventoryRouter.post(
  "/invoices",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(invoiceCreateSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const invoice = await withTransaction(async (client) => {
      // Calculate totals from lines
      const totalCents = body.lines.reduce(
        (sum, l) => sum + l.quantity * l.unitCostCents, 0
      );

      const invResult = await client.query(
        `INSERT INTO commerce_inventory_invoices
           (organization_id, store_id, supplier_id, invoice_number, invoice_date,
            received_date, source, total_cents, notes, attachment_url, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, invoice_number AS "invoiceNumber", status,
                   total_cents AS "totalCents", created_at AS "createdAt"`,
        [
          body.organizationId, body.storeId ?? null, body.supplierId ?? null,
          body.invoiceNumber ?? null, body.invoiceDate ?? null,
          body.receivedDate ?? null, body.source, totalCents,
          body.notes ?? null, body.rawFileUrl ?? null,
          actor.actorUserId ?? null
        ]
      );

      const invoiceId = invResult.rows[0].id;

      // Insert all lines
      for (const line of body.lines) {
        await client.query(
          `INSERT INTO commerce_inventory_invoice_lines
             (organization_id, invoice_id, product_id, ai_extracted_text,
              product_name, sku, quantity, unit_cost_cents, match_status, confidence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            body.organizationId, invoiceId, line.productId ?? null,
            line.aiExtractedText ?? null, line.productName,
            line.sku ?? null, line.quantity, line.unitCostCents,
            line.matchStatus, line.confidence ?? null
          ]
        );
      }

      return invResult.rows[0];
    });

    res.status(201).json({ data: invoice });
  })
);

inventoryRouter.post(
  "/invoices/:id/approve",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const invoiceId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        updateProductCost: z.boolean().default(true)
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const result = await withTransaction(async (client) => {
      // Lock and load invoice
      const invResult = await client.query(
        `SELECT id, status, store_id AS "storeId", organization_id AS "organizationId"
         FROM commerce_inventory_invoices
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE`,
        [body.organizationId, invoiceId]
      );
      const invoice = invResult.rows[0];
      if (!invoice) throw notFound("Invoice not found");
      if (invoice.status !== "pending") {
        throw badRequest(`Invoice is already ${invoice.status}`);
      }

      // Load lines where a product is matched and not skipped
      const linesResult = await client.query(
        `SELECT id, product_id AS "productId", product_name AS "productName",
                quantity, unit_cost_cents AS "unitCostCents", match_status AS "matchStatus"
         FROM commerce_inventory_invoice_lines
         WHERE invoice_id = $1
           AND organization_id = $2
           AND match_status != 'skipped'
           AND product_id IS NOT NULL`,
        [invoiceId, body.organizationId]
      );

      const storeId = invoice.storeId;
      if (!storeId) throw badRequest("Invoice has no store — set a store before approving");

      let appliedLines = 0;

      for (const line of linesResult.rows) {
        // Upsert inventory item and increment stock
        const itemResult = await client.query(
          `INSERT INTO commerce_inventory_items
             (organization_id, store_id, product_id, quantity_on_hand, track_inventory)
           VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT (organization_id, store_id, product_id) DO UPDATE
             SET quantity_on_hand = commerce_inventory_items.quantity_on_hand + $4,
                 track_inventory  = TRUE,
                 updated_at       = NOW()
           RETURNING quantity_on_hand AS "quantityOnHand"`,
          [body.organizationId, storeId, line.productId, line.quantity]
        );

        const qtyAfter = Number(itemResult.rows[0].quantityOnHand);

        // Write receive movement
        await client.query(
          `INSERT INTO commerce_inventory_movements
             (organization_id, store_id, product_id, type,
              quantity_delta, quantity_after, note, created_by_user_id)
           VALUES ($1, $2, $3, 'receive', $4, $5, $6, $7)`,
          [
            body.organizationId, storeId, line.productId,
            line.quantity, qtyAfter,
            `Invoice approved — ${line.productName}`,
            actor.actorUserId ?? null
          ]
        );

        // Optionally update product cost_cents to latest received cost
        if (body.updateProductCost && line.unitCostCents > 0) {
          await client.query(
            `UPDATE commerce_products
             SET cost_cents = $2, updated_at = NOW()
             WHERE organization_id = $1 AND id = $3`,
            [body.organizationId, line.unitCostCents, line.productId]
          );
        }

        appliedLines++;
      }

      // Mark invoice approved
      await client.query(
        `UPDATE commerce_inventory_invoices
         SET status = 'approved', approved_by_user_id = $2, approved_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $3`,
        [invoiceId, actor.actorUserId ?? null, body.organizationId]
      );

      return { invoiceId, appliedLines };
    });

    res.json({ data: result });
  })
);

inventoryRouter.post(
  "/invoices/:id/reject",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const invoiceId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({ organizationId: z.string().uuid() }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const result = await pool.query(
      `UPDATE commerce_inventory_invoices
       SET status = 'rejected', updated_at = NOW()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending'
       RETURNING id, status`,
      [body.organizationId, invoiceId]
    );
    if (result.rowCount === 0) throw notFound("Invoice not found or already processed");
    res.json({ data: result.rows[0] });
  })
);

// ════════════════════════════════════════════════════════════════════════════
// TRANSFERS
// ════════════════════════════════════════════════════════════════════════════

const transferSchema = z.object({
  organizationId: z.string().uuid(),
  fromStoreId:    z.string().uuid(),
  toStoreId:      z.string().uuid(),
  productId:      z.string().uuid(),
  quantity:       z.number().int().positive(),
  note:           z.string().max(500).optional().nullable()
});

inventoryRouter.get(
  "/transfers",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.coerce.number().int().min(1).max(200).default(50)
      }),
      req.query
    );
    authorizeTenant(req.actor, query.organizationId);

    const result = await pool.query(
      `SELECT t.id, t.quantity, t.note, t.status,
              t.created_at AS "createdAt", t.completed_at AS "completedAt",
              p.name AS "productName", p.sku,
              fs.name AS "fromStoreName", ts.name AS "toStoreName",
              u.name AS "createdBy"
       FROM commerce_inventory_transfers t
       JOIN commerce_products p  ON p.id = t.product_id
       JOIN commerce_stores   fs ON fs.id = t.from_store_id
       JOIN commerce_stores   ts ON ts.id = t.to_store_id
       LEFT JOIN commerce_users u ON u.id = t.created_by_user_id
       WHERE t.organization_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [query.organizationId, query.limit]
    );
    res.json({ data: result.rows });
  })
);

inventoryRouter.post(
  "/transfers",
  requirePermission("products:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(transferSchema, req.body);
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    if (body.fromStoreId === body.toStoreId) {
      throw badRequest("Source and destination store must be different");
    }

    const transfer = await withTransaction(async (client) => {
      // Verify product exists
      const prodResult = await client.query(
        `SELECT id, name FROM commerce_products
         WHERE organization_id = $1 AND id = $2 AND active = TRUE`,
        [body.organizationId, body.productId]
      );
      if (prodResult.rowCount === 0) throw notFound("Product not found");
      const product = prodResult.rows[0];

      // Check source stock (FOR UPDATE prevents concurrent transfers)
      const srcResult = await client.query(
        `SELECT quantity_on_hand AS qty
         FROM commerce_inventory_items
         WHERE organization_id = $1 AND store_id = $2 AND product_id = $3
         FOR UPDATE`,
        [body.organizationId, body.fromStoreId, body.productId]
      );
      const srcQty = srcResult.rowCount > 0 ? Number(srcResult.rows[0].qty) : 0;
      if (srcQty < body.quantity) {
        throw badRequest(`Not enough stock — ${srcQty} available, ${body.quantity} requested`);
      }

      const srcAfter = srcQty - body.quantity;

      // Decrement source
      await client.query(
        `UPDATE commerce_inventory_items
         SET quantity_on_hand = $4, updated_at = NOW()
         WHERE organization_id = $1 AND store_id = $2 AND product_id = $3`,
        [body.organizationId, body.fromStoreId, body.productId, srcAfter]
      );

      // Increment destination (upsert)
      const dstResult = await client.query(
        `INSERT INTO commerce_inventory_items
           (organization_id, store_id, product_id, quantity_on_hand, track_inventory)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (organization_id, store_id, product_id) DO UPDATE
           SET quantity_on_hand = commerce_inventory_items.quantity_on_hand + $4,
               track_inventory  = TRUE,
               updated_at       = NOW()
         RETURNING quantity_on_hand AS qty`,
        [body.organizationId, body.toStoreId, body.productId, body.quantity]
      );
      const dstAfter = Number(dstResult.rows[0].qty);

      const noteText = body.note || `Transfer: ${product.name}`;

      // Write movements for both sides
      await client.query(
        `INSERT INTO commerce_inventory_movements
           (organization_id, store_id, product_id, type,
            quantity_delta, quantity_after, note, created_by_user_id)
         VALUES
           ($1, $2, $3, 'adjustment', $4, $5, $6, $7),
           ($1, $8, $3, 'adjustment', $9, $10, $11, $7)`,
        [
          body.organizationId,
          body.fromStoreId, body.productId, -body.quantity, srcAfter,
          `${noteText} (out → ${body.toStoreId})`, actor.actorUserId ?? null,
          body.toStoreId, body.quantity, dstAfter,
          `${noteText} (in ← ${body.fromStoreId})`
        ]
      );

      // Create transfer record
      const txResult = await client.query(
        `INSERT INTO commerce_inventory_transfers
           (organization_id, from_store_id, to_store_id, product_id,
            quantity, note, status, created_by_user_id, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,NOW())
         RETURNING id, status, created_at AS "createdAt", completed_at AS "completedAt"`,
        [
          body.organizationId, body.fromStoreId, body.toStoreId,
          body.productId, body.quantity, body.note ?? null,
          actor.actorUserId ?? null
        ]
      );

      return {
        ...txResult.rows[0],
        productName: product.name,
        quantity: body.quantity,
        srcAfter,
        dstAfter
      };
    });

    res.status(201).json({ data: transfer });
  })
);
