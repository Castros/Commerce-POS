import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { pool } from "../../db/client.js";
import { asyncHandler, badRequest, notFound } from "../../shared/http/errors.js";
import { authorizeTenant, requirePermission } from "../../shared/auth/auth.js";
import { AI_MODEL, estimateCostMicrodollars } from "../../shared/ai/aiClient.js";
import Anthropic from "@anthropic-ai/sdk";

export const menuRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function trackUsage(organizationId, inputTokens, outputTokens) {
  setImmediate(() => {
    const cost = estimateCostMicrodollars(AI_MODEL, inputTokens, outputTokens);
    pool.query(
      `INSERT INTO commerce_ai_records
         (organization_id, source_type, model_name, status, prompt_tokens, completion_tokens, cost_microdollars)
       VALUES ($1, 'menu_suggestion', $2, 'reviewed', $3, $4, $5)`,
      [organizationId, AI_MODEL, inputTokens, outputTokens, cost]
    ).catch(() => {});
  });
}

// ── GET menu for a date range (single store) ─────────────────────────────────

menuRouter.get(
  "/",
  requirePermission("inventory:read"),
  asyncHandler(async (req, res) => {
    const { organizationId, storeId, from, to } = z.object({
      organizationId: z.string().uuid(),
      storeId:        z.string().uuid(),
      from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }).parse(req.query);

    authorizeTenant(req.actor, organizationId);

    const result = await pool.query(
      `SELECT id, date::text, meal_period AS "mealPeriod", items, published, notes, updated_at AS "updatedAt"
       FROM commerce_menu_calendar
       WHERE organization_id = $1 AND store_id = $2
         AND date BETWEEN $3 AND $4
       ORDER BY date ASC, meal_period ASC`,
      [organizationId, storeId, from, to]
    );

    res.json({ data: result.rows });
  })
);

// ── Save a full week to one or more stores ───────────────────────────────────

menuRouter.put(
  "/week",
  requirePermission("inventory:write"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      organizationId: z.string().uuid(),
      storeIds:       z.array(z.string().uuid()).min(1),
      days: z.array(z.object({
        date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mealPeriod: z.string().min(1).max(50).default("comida"),
        items:      z.array(z.object({
          productId:  z.string().uuid(),
          name:       z.string(),
          priceCents: z.union([z.number(), z.string()]).transform((v) => Number(v))
        })).default([]),
        published:  z.boolean().default(false),
        notes:      z.string().nullable().optional()
      })).min(1)
    }).parse(req.body);

    authorizeTenant(req.actor, body.organizationId);

    const saved = [];
    for (const storeId of body.storeIds) {
      for (const day of body.days) {
        const r = await pool.query(
          `INSERT INTO commerce_menu_calendar
             (organization_id, store_id, date, meal_period, items, published, notes, created_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
           ON CONFLICT (organization_id, store_id, date, meal_period) DO UPDATE
             SET items      = EXCLUDED.items,
                 published  = EXCLUDED.published,
                 notes      = EXCLUDED.notes,
                 updated_at = NOW()
           RETURNING id, store_id AS "storeId", date::text, meal_period AS "mealPeriod", items, published, notes`,
          [
            body.organizationId, storeId, day.date, day.mealPeriod,
            JSON.stringify(day.items),
            day.published,
            day.notes ?? null,
            req.actor?.userId ?? null
          ]
        );
        saved.push(r.rows[0]);
      }
    }

    res.json({ data: saved });
  })
);

// ── Toggle publish for a single day ─────────────────────────────────────────

menuRouter.patch(
  "/:id/publish",
  requirePermission("inventory:write"),
  asyncHandler(async (req, res) => {
    const id   = z.string().uuid().parse(req.params.id);
    const body = z.object({
      organizationId: z.string().uuid(),
      published:      z.boolean()
    }).parse(req.body);

    authorizeTenant(req.actor, body.organizationId);

    const result = await pool.query(
      `UPDATE commerce_menu_calendar
       SET published = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING id, date::text, published`,
      [body.published, id, body.organizationId]
    );
    if (result.rowCount === 0) throw notFound("Menu day not found");

    res.json({ data: result.rows[0] });
  })
);

// ── AI: extract menu from image or text + fuzzy-match to products ─────────────

menuRouter.post(
  "/ai-extract",
  requirePermission("inventory:write"),
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const organizationId = z.string().uuid().parse(req.body.organizationId);
    const weekStart      = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.body.weekStart);
    const inputText      = req.body.text ?? null;

    authorizeTenant(req.actor, organizationId);

    if (!req.file && !inputText) throw badRequest("Provide an image or text");

    // Load products for matching
    const productsResult = await pool.query(
      `SELECT id, name, price_cents AS "priceCents"
       FROM commerce_products
       WHERE organization_id = $1 AND active = TRUE
       ORDER BY name`,
      [organizationId]
    );
    const products = productsResult.rows;

    const weekDates = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(weekStart + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });

    const systemPrompt = `You extract weekly cafeteria menus. Given menu content (image or text), identify what food items are offered each day (Monday–Friday).
Return ONLY valid JSON:
{
  "days": [
    { "dayOfWeek": "Monday", "rawItems": ["item name 1", "item name 2"] }
  ]
}
Use English day names. Only include days that have items. rawItems are the exact item names as written.`;

    // Build message content
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let messageContent;

    if (req.file) {
      const b64 = req.file.buffer.toString("base64");
      const mediaType = req.file.mimetype || "image/jpeg";
      messageContent = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
        { type: "text", text: `Extract the weekly menu. Week starts ${weekStart}.` }
      ];
    } else {
      messageContent = [{ type: "text", text: `Extract the weekly menu from this text. Week starts ${weekStart}.\n\n${inputText}` }];
    }

    let message;
    try {
      message = await client.messages.create({
        model:      AI_MODEL,
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   [{ role: "user", content: messageContent }]
      });
    } catch {
      throw badRequest("AI service unavailable");
    }

    trackUsage(organizationId, message.usage.input_tokens, message.usage.output_tokens);

    const raw  = message.content[0]?.type === "text" ? message.content[0].text : "";
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw badRequest("AI could not parse the menu");

    const extracted = JSON.parse(json);

    // Map day names to dates
    const dayMap = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };

    // Fuzzy-match each raw item to a product using pg_trgm
    const days = await Promise.all(
      (extracted.days ?? []).map(async (d) => {
        const idx = dayMap[d.dayOfWeek?.toLowerCase()];
        const date = idx !== undefined ? weekDates[idx] : null;
        if (!date) return null;

        const items = await Promise.all(
          (d.rawItems ?? []).map(async (rawName) => {
            const match = await pool.query(
              `SELECT id, name, price_cents AS "priceCents",
                      similarity(name, $1) AS score
               FROM commerce_products
               WHERE organization_id = $2
                 AND active = TRUE
                 AND similarity(name, $1) > 0.2
               ORDER BY score DESC
               LIMIT 1`,
              [rawName, organizationId]
            );
            const best = match.rows[0];
            return {
              rawName,
              productId:  best?.id ?? null,
              name:       best?.name ?? rawName,
              priceCents: best?.priceCents ?? 0,
              matched:    !!best,
              score:      best ? Math.round(best.score * 100) : 0
            };
          })
        );

        return { date, dayOfWeek: d.dayOfWeek, items };
      })
    );

    res.json({ data: { days: days.filter(Boolean), products } });
  })
);

// ── Guardian portal: published menu for a date range ─────────────────────────
// (also lives on guardianPortalRouter — this is the staff-accessible version)

menuRouter.get(
  "/public",
  asyncHandler(async (req, res) => {
    const { organizationId, storeId, from, to } = z.object({
      organizationId: z.string().uuid(),
      storeId:        z.string().uuid(),
      from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }).parse(req.query);

    const result = await pool.query(
      `SELECT date::text, meal_period AS "mealPeriod", items, notes
       FROM commerce_menu_calendar
       WHERE organization_id = $1 AND store_id = $2
         AND date BETWEEN $3 AND $4
         AND published = TRUE
       ORDER BY date ASC, meal_period ASC`,
      [organizationId, storeId, from, to]
    );

    res.json({ data: result.rows });
  })
);
