import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import multer from "multer";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { asyncHandler, badRequest } from "../../shared/http/errors.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";

export const productImportRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === "text/csv"
      || file.mimetype === "application/vnd.ms-excel"
      || file.originalname.toLowerCase().endsWith(".csv");
    if (!ok) return cb(new Error("Only .csv files are accepted"));
    cb(null, true);
  },
});

const CSV_ROW_SCHEMA = z.object({
  name:        z.string().min(1, "name is required"),
  sku:         z.string().optional(),
  description: z.string().optional(),
  price:       z.string().min(1, "price is required"),
  category:    z.string().optional(),
  taxable:     z.string().optional(),
  active:      z.string().optional(),
});

function parseBool(value, defaultVal = true) {
  if (!value) return defaultVal;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1";
}

function parsePriceCents(value) {
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function parseRows(buffer) {
  const text = buffer.toString("utf8").replace(/^﻿/, ""); // strip BOM
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

// ── POST /v1/products/import/preview ─────────────────────────────────────────

productImportRouter.post(
  "/preview",
  requirePermission("products:write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    authorizeTenant(req.actor, organizationId);

    let rawRows;
    try {
      rawRows = parseRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV — check the file format");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 500) throw badRequest("Max 500 rows per import");

    // Load categories for this org so we can match by name
    const catResult = await pool.query(
      `SELECT id, name FROM commerce_product_categories WHERE organization_id = $1 AND active = TRUE`,
      [organizationId]
    );
    const categoryMap = new Map(catResult.rows.map((c) => [c.name.toLowerCase().trim(), c.id]));

    const preview = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2;
      const parsed = CSV_ROW_SCHEMA.safeParse(rawRows[i]);

      if (!parsed.success) {
        errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }

      const r = parsed.data;
      const priceCents = parsePriceCents(r.price);

      if (priceCents === null) {
        errors.push({ row: rowNum, error: `Invalid price: "${r.price}"` });
        continue;
      }

      const catName = r.category?.trim() || null;
      const categoryId = catName ? (categoryMap.get(catName.toLowerCase()) ?? null) : null;
      const categoryMatched = catName ? categoryId !== null : null;

      // Check if SKU already exists in this org
      let skuConflict = false;
      if (r.sku?.trim()) {
        const existing = await pool.query(
          `SELECT id FROM commerce_products WHERE organization_id = $1 AND sku = $2 LIMIT 1`,
          [organizationId, r.sku.trim()]
        );
        skuConflict = existing.rowCount > 0;
      }

      preview.push({
        row: rowNum,
        name: r.name.trim(),
        sku: r.sku?.trim() || null,
        description: r.description?.trim() || null,
        priceCents,
        categoryName: catName,
        categoryId,
        categoryMatched,
        taxable: parseBool(r.taxable, false),
        active: parseBool(r.active, true),
        skuConflict,
        status: skuConflict ? "skip" : "create",
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

// ── POST /v1/products/import/apply ────────────────────────────────────────────

productImportRouter.post(
  "/apply",
  requirePermission("products:write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const body = z.object({
      organizationId: z.string().uuid(),
      storeId: z.string().uuid().nullable().optional(),
    }).parse(req.body);
    authorizeTenant(req.actor, body.organizationId);

    let rawRows;
    try {
      rawRows = parseRows(req.file.buffer);
    } catch {
      throw badRequest("Could not parse CSV");
    }

    if (rawRows.length === 0) throw badRequest("CSV has no data rows");
    if (rawRows.length > 500) throw badRequest("Max 500 rows per import");

    const catResult = await pool.query(
      `SELECT id, name FROM commerce_product_categories WHERE organization_id = $1 AND active = TRUE`,
      [body.organizationId]
    );
    const categoryMap = new Map(catResult.rows.map((c) => [c.name.toLowerCase().trim(), c.id]));

    const results = { created: 0, skipped: 0, errors: [] };

    await withTransaction(async (client) => {
      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        const parsed = CSV_ROW_SCHEMA.safeParse(rawRows[i]);
        if (!parsed.success) {
          results.errors.push({ row: rowNum, error: parsed.error.issues[0]?.message ?? "Invalid row" });
          continue;
        }

        const r = parsed.data;
        const priceCents = parsePriceCents(r.price);
        if (priceCents === null) {
          results.errors.push({ row: rowNum, error: `Invalid price: "${r.price}"` });
          continue;
        }

        const sku = r.sku?.trim() || null;
        if (sku) {
          const exists = await client.query(
            `SELECT id FROM commerce_products WHERE organization_id = $1 AND sku = $2 LIMIT 1`,
            [body.organizationId, sku]
          );
          if (exists.rowCount > 0) { results.skipped++; continue; }
        }

        const catName = r.category?.trim() || null;
        const categoryId = catName ? (categoryMap.get(catName.toLowerCase()) ?? null) : null;

        try {
          await client.query(
            `INSERT INTO commerce_products
               (organization_id, store_id, category_id, name, description, sku, price_cents, taxable, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              body.organizationId,
              body.storeId || null,
              categoryId,
              r.name.trim(),
              r.description?.trim() || null,
              sku,
              priceCents,
              parseBool(r.taxable, false),
              parseBool(r.active, true),
            ]
          );
          results.created++;
        } catch (err) {
          results.errors.push({ row: rowNum, name: r.name, error: err.message });
        }
      }
    });

    res.json({ data: results });
  })
);
