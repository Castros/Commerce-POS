import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import Anthropic from "@anthropic-ai/sdk";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { asyncHandler, badRequest, notFound } from "../../shared/http/errors.js";
import { authorizeTenant, requirePermission, getActor } from "../../shared/auth/auth.js";
import { AI_MODEL, estimateCostMicrodollars } from "../../shared/ai/aiClient.js";

export const inventoryAIRouter = Router();

// ── Lazy init helpers ─────────────────────────────────────────────────────────

function getCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw badRequest("Cloudinary is not configured");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key:    CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

let _aiClient = null;
function getAIClient() {
  if (!_aiClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw badRequest("ANTHROPIC_API_KEY is not set");
    _aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _aiClient;
}

// ── Multer: accept images + PDFs up to 20 MB ─────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = file.mimetype.startsWith("image/") || file.mimetype === "application/pdf";
    if (!ok) return cb(new Error("Only image or PDF files are accepted"));
    cb(null, true);
  },
});

// ── Extraction prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt(corrections) {
  let prompt = `You are an inventory receiving assistant for a retail or school store POS system.

Analyze the provided invoice or receipt and extract ALL line items.

Return ONLY valid JSON — no markdown fences, no preamble:
{
  "supplier_name": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "line_items": [
    {
      "raw_text": "exact text from document for this line",
      "product_name": "cleaned product name",
      "sku": "SKU or item code if visible, null otherwise",
      "quantity": number (positive integer — round up if fractional),
      "unit_cost_cents": number (integer cents; $5.99 → 599),
      "confidence": number 0–1
    }
  ],
  "total_cents": number or null,
  "tax_cents": number or null,
  "notes": "any observations about document quality or extraction challenges"
}

Confidence guide:
- 0.95–1.0: text is clear and unambiguous
- 0.75–0.94: minor uncertainty (blurry, abbreviations, etc.)
- 0.50–0.74: significant uncertainty
- below 0.50: text was barely readable

Rules:
- Extract EVERY line item visible
- unit_cost_cents must be in integer cents (multiply dollars × 100)
- quantity must be a positive integer
- If you cannot determine a value, use null — never guess
- raw_text captures the exact text from the document for that line`;

  if (corrections && corrections.length > 0) {
    prompt += `\n\nKNOWN PRODUCT MAPPINGS (confirmed by managers — use these to raise your confidence):
${corrections.map((c) => `- "${c.extracted_text}" → "${c.product_name}"${c.sku ? ` (SKU: ${c.sku})` : ""}`).join("\n")}`;
  }

  return prompt;
}

// ── Product matching ──────────────────────────────────────────────────────────

async function matchLineToProduct(client, orgId, line, corrections) {
  const rawNorm = (line.raw_text || line.product_name || "").toLowerCase().trim();
  const skuNorm = (line.sku || "").trim();

  // 1. Exact SKU match
  if (skuNorm) {
    const r = await client.query(
      `SELECT id, name, sku FROM commerce_products
       WHERE organization_id = $1 AND sku = $2 AND active = TRUE LIMIT 1`,
      [orgId, skuNorm]
    );
    if (r.rowCount > 0) {
      return { product_id: r.rows[0].id, product_name: r.rows[0].name, match_status: "matched", confidence: Math.max(line.confidence ?? 0.9, 0.9) };
    }
  }

  // 2. Correction table lookup (normalized text)
  const correctionMatch = corrections.find(
    (c) => c.extracted_text === rawNorm
  );
  if (correctionMatch) {
    return {
      product_id:   correctionMatch.product_id,
      product_name: correctionMatch.product_name,
      match_status: "matched",
      confidence:   Math.max(line.confidence ?? 0.9, 0.92),
    };
  }

  // 3. pg_trgm fuzzy match on product name or SKU
  const searchTerm = line.product_name || line.raw_text || "";
  if (searchTerm) {
    const r = await client.query(
      `SELECT id, name, sku,
              GREATEST(
                similarity(name, $2),
                CASE WHEN sku IS NOT NULL THEN similarity(sku, $3) ELSE 0 END
              ) AS sim
       FROM commerce_products
       WHERE organization_id = $1 AND active = TRUE
         AND GREATEST(
               similarity(name, $2),
               CASE WHEN sku IS NOT NULL THEN similarity(sku, $3) ELSE 0 END
             ) > 0.25
       ORDER BY sim DESC
       LIMIT 1`,
      [orgId, searchTerm, skuNorm || searchTerm]
    );
    if (r.rowCount > 0 && parseFloat(r.rows[0].sim) >= 0.3) {
      const sim = parseFloat(r.rows[0].sim);
      return {
        product_id:   r.rows[0].id,
        product_name: r.rows[0].name,
        match_status: sim >= 0.7 ? "matched" : "manual",
        confidence:   Math.min((line.confidence ?? 0.7) * sim, 0.95),
      };
    }
  }

  // 4. No match
  return { product_id: null, product_name: line.product_name || rawNorm, match_status: "unmatched", confidence: line.confidence ?? 0 };
}

// ── Upload invoice file to Cloudinary ────────────────────────────────────────

function uploadToCloudinary(buffer, organizationId, mimeType) {
  const cld = getCloudinary();
  const folder = `orgs/${organizationId}/invoices`;
  const resourceType = mimeType === "application/pdf" ? "raw" : "image";

  return new Promise((resolve, reject) => {
    const stream = cld.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ── POST /v1/inventory/ai/extract ─────────────────────────────────────────────
// Accepts multipart: file + organizationId + optional storeId / supplierId

inventoryAIRouter.post(
  "/extract",
  requirePermission("inventory:write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");

    const { organizationId, storeId, supplierId } = z.object({
      organizationId: z.string().uuid(),
      storeId:        z.string().uuid().optional(),
      supplierId:     z.string().uuid().optional(),
    }).parse(req.body);

    authorizeTenant(req.actor, organizationId);

    const actor = getActor(req);
    const isPdf = req.file.mimetype === "application/pdf";
    const source = isPdf ? "ai_pdf" : "ai_image";

    // 1. Upload file to Cloudinary
    let fileUrl = null;
    try {
      const uploaded = await uploadToCloudinary(req.file.buffer, organizationId, req.file.mimetype);
      fileUrl = uploaded.secure_url;
    } catch (err) {
      throw badRequest(`File upload failed: ${err.message}`);
    }

    // 2. Load corrections for this org (few-shot hints)
    const correctionsRes = await pool.query(
      `SELECT extracted_text, product_id, product_name, sku
       FROM commerce_ai_inventory_corrections
       WHERE organization_id = $1
       ORDER BY use_count DESC
       LIMIT 100`,
      [organizationId]
    );
    const corrections = correctionsRes.rows;

    // 3. Call Claude
    const client = getAIClient();
    const systemPrompt = buildSystemPrompt(corrections);
    let rawPayload = null;
    let promptTokens = 0;
    let completionTokens = 0;

    let messageContent;
    if (isPdf) {
      // Extract text from PDF using buffer
      let pdfText = "";
      try {
        const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
        const data = await pdfParse(req.file.buffer);
        pdfText = data.text;
      } catch {
        throw badRequest("Could not parse PDF — make sure it contains readable text (not a scanned image)");
      }
      messageContent = `Extract all line items from this invoice text:\n\n${pdfText}`;
    } else {
      // Image: send as base64 vision
      const base64 = req.file.buffer.toString("base64");
      const mediaType = req.file.mimetype;
      messageContent = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        },
        {
          type: "text",
          text: "Extract all line items from this invoice or receipt image. Return the JSON as instructed.",
        },
      ];
    }

    const message = await client.messages.create({
      model:      AI_MODEL,
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: "user", content: messageContent }],
    });

    promptTokens     = message.usage.input_tokens;
    completionTokens = message.usage.output_tokens;

    const rawText = message.content[0].text.trim();

    // Strip markdown fences if present
    const jsonStart = rawText.indexOf("{");
    const jsonEnd   = rawText.lastIndexOf("}");
    let parsed;
    try {
      parsed = JSON.parse(jsonStart !== -1 ? rawText.slice(jsonStart, jsonEnd + 1) : rawText);
    } catch {
      throw badRequest(`AI returned unparseable response: ${rawText.slice(0, 200)}`);
    }
    rawPayload = parsed;

    // 4. Match each line to products
    const lineItems = Array.isArray(parsed.line_items) ? parsed.line_items : [];
    const enrichedLines = await Promise.all(
      lineItems.map(async (line) => {
        const match = await matchLineToProduct(pool, organizationId, line, corrections);
        return {
          raw_text:        line.raw_text || "",
          product_name:    match.product_name,
          product_id:      match.product_id,
          sku:             line.sku || null,
          quantity:        Math.max(1, Math.round(line.quantity || 1)),
          unit_cost_cents: Math.max(0, Math.round(line.unit_cost_cents || 0)),
          match_status:    match.match_status,
          confidence:      Math.min(1, Math.max(0, match.confidence ?? line.confidence ?? 0)),
        };
      })
    );

    // Overall confidence = average of line confidences (or 0 if no lines)
    const overallConfidence = enrichedLines.length > 0
      ? enrichedLines.reduce((sum, l) => sum + l.confidence, 0) / enrichedLines.length
      : 0;

    // 5. Save draft
    const draftRes = await pool.query(
      `INSERT INTO commerce_inventory_ai_drafts
         (organization_id, store_id, supplier_id, status, source, file_url, raw_payload, lines, overall_confidence, created_by)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        organizationId,
        storeId || null,
        supplierId || null,
        source,
        fileUrl,
        JSON.stringify(rawPayload),
        JSON.stringify(enrichedLines),
        overallConfidence.toFixed(3),
        actor?.userId || null,
      ]
    );

    // 6. Track AI cost (fire-and-forget)
    const costMicrodollars = estimateCostMicrodollars(AI_MODEL, promptTokens, completionTokens);
    pool.query(
      `INSERT INTO commerce_ai_records
         (organization_id, source_type, status, input_snapshot, output_json, prompt_tokens, completion_tokens, cost_microdollars)
       VALUES ($1, 'invoice_extraction', 'reviewed', $2, $3, $4, $5, $6)`,
      [organizationId, JSON.stringify({ file: fileUrl, lineCount: lineItems.length }), JSON.stringify(rawPayload), promptTokens, completionTokens, costMicrodollars]
    ).catch(() => {});

    const draft = draftRes.rows[0];
    res.status(201).json({
      data: {
        id:                draft.id,
        organizationId:    draft.organization_id,
        storeId:           draft.store_id,
        supplierId:        draft.supplier_id,
        status:            draft.status,
        source:            draft.source,
        fileUrl:           draft.file_url,
        overallConfidence: parseFloat(draft.overall_confidence ?? 0),
        lines:             enrichedLines,
        extractedMeta: {
          supplierName:  rawPayload.supplier_name || null,
          invoiceNumber: rawPayload.invoice_number || null,
          invoiceDate:   rawPayload.invoice_date || null,
          totalCents:    rawPayload.total_cents || null,
          taxCents:      rawPayload.tax_cents || null,
          notes:         rawPayload.notes || null,
        },
        createdAt: draft.created_at,
      },
    });
  })
);

// ── GET /v1/inventory/ai/drafts ───────────────────────────────────────────────

inventoryAIRouter.get(
  "/drafts",
  requirePermission("inventory:read"),
  asyncHandler(async (req, res) => {
    const { organizationId, status } = z.object({
      organizationId: z.string().uuid(),
      status:         z.enum(["pending", "approved", "rejected"]).optional(),
    }).parse(req.query);

    authorizeTenant(req.actor, organizationId);

    const conditions = ["d.organization_id = $1"];
    const params = [organizationId];
    if (status) {
      params.push(status);
      conditions.push(`d.status = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT d.*,
              s.name AS store_name,
              sup.name AS supplier_name,
              u.name AS created_by_name
       FROM commerce_inventory_ai_drafts d
       LEFT JOIN commerce_stores s ON s.id = d.store_id AND s.organization_id = d.organization_id
       LEFT JOIN commerce_inventory_suppliers sup ON sup.id = d.supplier_id AND sup.organization_id = d.organization_id
       LEFT JOIN commerce_users u ON u.id = d.created_by
       WHERE ${conditions.join(" AND ")}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      params
    );

    res.json({
      data: result.rows.map((d) => ({
        id:                d.id,
        organizationId:    d.organization_id,
        storeId:           d.store_id,
        storeName:         d.store_name,
        supplierId:        d.supplier_id,
        supplierName:      d.supplier_name,
        status:            d.status,
        source:            d.source,
        fileUrl:           d.file_url,
        overallConfidence: parseFloat(d.overall_confidence ?? 0),
        lineCount:         Array.isArray(d.lines) ? d.lines.length : (d.lines?.length ?? 0),
        invoiceId:         d.invoice_id,
        createdByName:     d.created_by_name,
        createdAt:         d.created_at,
        reviewedAt:        d.reviewed_at,
      })),
    });
  })
);

// ── GET /v1/inventory/ai/drafts/:id ──────────────────────────────────────────

inventoryAIRouter.get(
  "/drafts/:id",
  requirePermission("inventory:read"),
  asyncHandler(async (req, res) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.query);
    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `SELECT d.*,
              s.name AS store_name,
              sup.name AS supplier_name
       FROM commerce_inventory_ai_drafts d
       LEFT JOIN commerce_stores s ON s.id = d.store_id AND s.organization_id = d.organization_id
       LEFT JOIN commerce_inventory_suppliers sup ON sup.id = d.supplier_id AND sup.organization_id = d.organization_id
       WHERE d.id = $1 AND d.organization_id = $2`,
      [req.params.id, organizationId]
    );
    if (result.rowCount === 0) throw notFound("Draft not found");

    const d = result.rows[0];
    res.json({
      data: {
        id:                d.id,
        organizationId:    d.organization_id,
        storeId:           d.store_id,
        storeName:         d.store_name,
        supplierId:        d.supplier_id,
        supplierName:      d.supplier_name,
        status:            d.status,
        source:            d.source,
        fileUrl:           d.file_url,
        overallConfidence: parseFloat(d.overall_confidence ?? 0),
        lines:             d.lines,
        rawPayload:        d.raw_payload,
        invoiceId:         d.invoice_id,
        createdAt:         d.created_at,
        reviewedAt:        d.reviewed_at,
      },
    });
  })
);

// ── POST /v1/inventory/ai/drafts/:id/approve ─────────────────────────────────
// Creates an invoice from the draft, increments stock, saves corrections

inventoryAIRouter.post(
  "/drafts/:id/approve",
  requirePermission("inventory:write"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      organizationId: z.string().uuid(),
      storeId:        z.string().uuid().optional(),
      supplierId:     z.string().uuid().optional(),
      invoiceNumber:  z.string().optional(),
      invoiceDate:    z.string().optional(),
      notes:          z.string().optional(),
      updateProductCost: z.boolean().optional().default(false),
      // Manager-reviewed lines (may include manual corrections)
      lines: z.array(z.object({
        raw_text:        z.string().optional(),
        product_id:      z.string().uuid().nullable(),
        product_name:    z.string(),
        sku:             z.string().nullable().optional(),
        quantity:        z.number().int().positive(),
        unit_cost_cents: z.number().int().min(0),
        match_status:    z.enum(["matched", "manual", "skipped", "unmatched"]),
        confidence:      z.number().min(0).max(1).optional(),
      })),
    }).parse(req.body);

    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    await withTransaction(async (client) => {
      // Load and lock the draft
      const draftRes = await client.query(
        `SELECT * FROM commerce_inventory_ai_drafts WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [req.params.id, body.organizationId]
      );
      if (draftRes.rowCount === 0) throw notFound("Draft not found");
      const draft = draftRes.rows[0];
      if (draft.status !== "pending") throw badRequest(`Draft is already ${draft.status}`);

      // Calculate totals from approved lines (skip skipped/unmatched without product_id)
      const activeLines = body.lines.filter((l) => l.match_status !== "skipped" && l.product_id);
      const totalCents = activeLines.reduce((sum, l) => sum + l.quantity * l.unit_cost_cents, 0);

      // Determine store_id: body override → draft value
      const storeId = body.storeId || draft.store_id;
      const supplierId = body.supplierId || draft.supplier_id;

      // Create invoice
      const invoiceRes = await client.query(
        `INSERT INTO commerce_inventory_invoices
           (organization_id, store_id, supplier_id, invoice_number, invoice_date,
            received_date, source, status, total_cents, notes, raw_file_url, created_by, approved_by, approved_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'approved', $7, $8, $9, $10, $11, NOW())
         RETURNING id`,
        [
          body.organizationId,
          storeId || null,
          supplierId || null,
          body.invoiceNumber || null,
          body.invoiceDate || null,
          draft.source,
          totalCents,
          body.notes || null,
          draft.file_url,
          actor?.userId || null,
          actor?.userId || null,
        ]
      );
      const invoiceId = invoiceRes.rows[0].id;

      // Insert invoice lines and apply stock adjustments
      for (const line of body.lines) {
        await client.query(
          `INSERT INTO commerce_inventory_invoice_lines
             (organization_id, invoice_id, product_id, ai_extracted_text, product_name,
              sku, quantity, unit_cost_cents, match_status, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            body.organizationId,
            invoiceId,
            line.product_id || null,
            line.raw_text || null,
            line.product_name,
            line.sku || null,
            line.quantity,
            line.unit_cost_cents,
            line.match_status,
            line.confidence ?? null,
          ]
        );

        if (line.product_id && line.match_status !== "skipped") {
          // Lock inventory row
          const invRes = await client.query(
            `SELECT id, quantity_on_hand FROM commerce_inventory
             WHERE product_id = $1 AND organization_id = $2 FOR UPDATE`,
            [line.product_id, body.organizationId]
          );

          if (invRes.rowCount > 0) {
            const before = parseInt(invRes.rows[0].quantity_on_hand, 10);
            const after  = before + line.quantity;
            await client.query(
              `UPDATE commerce_inventory
               SET quantity_on_hand = $1, updated_at = NOW()
               WHERE product_id = $2 AND organization_id = $3`,
              [after, line.product_id, body.organizationId]
            );
            await client.query(
              `INSERT INTO commerce_inventory_movements
                 (organization_id, product_id, type, quantity_delta, quantity_after, note, created_by)
               VALUES ($1, $2, 'receive', $3, $4, $5, $6)`,
              [body.organizationId, line.product_id, line.quantity, after, `Invoice ${invoiceId}`, actor?.userId || null]
            );
          }

          // Optionally update product unit cost
          if (body.updateProductCost && line.unit_cost_cents > 0) {
            await client.query(
              `UPDATE commerce_products SET cost_cents = $1 WHERE id = $2 AND organization_id = $3`,
              [line.unit_cost_cents, line.product_id, body.organizationId]
            );
          }
        }
      }

      // Save corrections: any line with a product_id that was manually set or had raw_text
      for (const line of body.lines) {
        if (!line.product_id || !line.raw_text) continue;
        const normText = line.raw_text.toLowerCase().trim();
        if (!normText) continue;

        await client.query(
          `INSERT INTO commerce_ai_inventory_corrections
             (organization_id, extracted_text, product_id, product_name, sku, confirmed_by, use_count)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (organization_id, extracted_text) DO UPDATE
             SET product_id   = EXCLUDED.product_id,
                 product_name = EXCLUDED.product_name,
                 sku          = EXCLUDED.sku,
                 confirmed_by = EXCLUDED.confirmed_by,
                 use_count    = commerce_ai_inventory_corrections.use_count + 1,
                 updated_at   = NOW()`,
          [body.organizationId, normText, line.product_id, line.product_name, line.sku || null, actor?.userId || null]
        );
      }

      // Mark draft as approved
      await client.query(
        `UPDATE commerce_inventory_ai_drafts
         SET status = 'approved', invoice_id = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3 AND organization_id = $4`,
        [invoiceId, actor?.userId || null, req.params.id, body.organizationId]
      );

      res.json({ data: { invoiceId, draftId: req.params.id, lineCount: body.lines.length } });
    });
  })
);

// ── POST /v1/inventory/ai/drafts/:id/reject ───────────────────────────────────

inventoryAIRouter.post(
  "/drafts/:id/reject",
  requirePermission("inventory:write"),
  asyncHandler(async (req, res) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.body);
    authorizeTenant(req.actor, organizationId);
    const actor = getActor(req);

    const result = await pool.query(
      `UPDATE commerce_inventory_ai_drafts
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND organization_id = $3 AND status = 'pending'
       RETURNING id`,
      [actor?.userId || null, req.params.id, organizationId]
    );
    if (result.rowCount === 0) throw notFound("Draft not found or already reviewed");

    res.json({ data: { ok: true } });
  })
);

// ── GET /v1/inventory/ai/corrections ─────────────────────────────────────────

inventoryAIRouter.get(
  "/corrections",
  requirePermission("inventory:read"),
  asyncHandler(async (req, res) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.query);
    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `SELECT c.*, p.name AS current_product_name, u.name AS confirmed_by_name
       FROM commerce_ai_inventory_corrections c
       LEFT JOIN commerce_products p ON p.id = c.product_id
       LEFT JOIN commerce_users u ON u.id = c.confirmed_by
       WHERE c.organization_id = $1
       ORDER BY c.use_count DESC, c.updated_at DESC`,
      [organizationId]
    );

    res.json({
      data: result.rows.map((c) => ({
        id:                 c.id,
        extractedText:      c.extracted_text,
        productId:          c.product_id,
        productName:        c.product_name,
        currentProductName: c.current_product_name,
        sku:                c.sku,
        useCount:           c.use_count,
        confirmedByName:    c.confirmed_by_name,
        createdAt:          c.created_at,
        updatedAt:          c.updated_at,
      })),
    });
  })
);

// ── POST /v1/inventory/ai/corrections ────────────────────────────────────────
// Manually add or update a correction

inventoryAIRouter.post(
  "/corrections",
  requirePermission("inventory:write"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      organizationId: z.string().uuid(),
      extractedText:  z.string().min(1),
      productId:      z.string().uuid(),
    }).parse(req.body);

    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    // Look up product details
    const prodRes = await pool.query(
      `SELECT name, sku FROM commerce_products WHERE id = $1 AND organization_id = $2`,
      [body.productId, body.organizationId]
    );
    if (prodRes.rowCount === 0) throw notFound("Product not found");

    const normText = body.extractedText.toLowerCase().trim();
    const result = await pool.query(
      `INSERT INTO commerce_ai_inventory_corrections
         (organization_id, extracted_text, product_id, product_name, sku, confirmed_by, use_count)
       VALUES ($1, $2, $3, $4, $5, $6, 1)
       ON CONFLICT (organization_id, extracted_text) DO UPDATE
         SET product_id   = EXCLUDED.product_id,
             product_name = EXCLUDED.product_name,
             sku          = EXCLUDED.sku,
             confirmed_by = EXCLUDED.confirmed_by,
             use_count    = commerce_ai_inventory_corrections.use_count + 1,
             updated_at   = NOW()
       RETURNING *`,
      [body.organizationId, normText, body.productId, prodRes.rows[0].name, prodRes.rows[0].sku || null, actor?.userId || null]
    );

    res.status(201).json({ data: result.rows[0] });
  })
);

// ── DELETE /v1/inventory/ai/corrections/:id ───────────────────────────────────

inventoryAIRouter.delete(
  "/corrections/:id",
  requirePermission("inventory:write"),
  asyncHandler(async (req, res) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.query);
    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `DELETE FROM commerce_ai_inventory_corrections
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [req.params.id, organizationId]
    );
    if (result.rowCount === 0) throw notFound("Correction not found");

    res.json({ data: { ok: true } });
  })
);
