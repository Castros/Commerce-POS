import { Router } from "express";
import { z } from "zod";

import { authorizeTenant, getActor, requirePermission } from "../../shared/auth/auth.js";
import { requireFeature } from "../../shared/auth/featureGate.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";
import * as aiRepo from "./ai.repo.js";
import {
  dismissRecord,
  generateAndSendGuardianDigests,
  generateAndStoreAnomalyAlerts,
  generateAndStoreCloseoutSummary,
  generateAndStoreReorderRecommendations,
  generateAndStoreSalesForecast,
  reviewRecord,
} from "./ai.service.js";

export const aiRouter = Router();
aiRouter.use(requireFeature("ai"));

const listQuerySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  status: z.enum(["pending", "draft", "reviewed", "dismissed", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

// ── Closeout summaries ────────────────────────────────────────────────────────

aiRouter.get(
  "/summaries",
  asyncHandler(async (req, res) => {
    const query = parseZod(listQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);

    const records = await aiRepo.listRecords({
      organizationId: query.organizationId,
      storeId: query.storeId,
      sourceType: "closeout_summary",
      status: query.status,
      limit: query.limit
    });

    res.json({ data: records });
  })
);

aiRouter.get(
  "/summaries/:id",
  asyncHandler(async (req, res) => {
    const recordId = z.string().uuid().parse(req.params.id);
    const query = parseZod(z.object({ organizationId: z.string().uuid() }), req.query);
    authorizeTenant(req.actor, query.organizationId);

    const record = await aiRepo.findById(query.organizationId, recordId);
    if (!record) throw notFound("Summary not found");

    res.json({ data: record });
  })
);

// Trigger or retrieve closeout summary for a drawer session
aiRouter.post(
  "/summaries",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        storeId: z.string().uuid(),
        sourceRecordId: z.string().uuid()
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const record = await generateAndStoreCloseoutSummary({
      sessionId: body.sourceRecordId,
      organizationId: body.organizationId,
      storeId: body.storeId
    });

    res.status(record?.status === "draft" ? 201 : 200).json({ data: record });
  })
);

aiRouter.patch(
  "/summaries/:id",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const recordId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        status: z.enum(["reviewed", "dismissed"])
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const updated =
      body.status === "reviewed"
        ? await reviewRecord(body.organizationId, recordId, actor.actorUserId)
        : await dismissRecord(body.organizationId, recordId, actor.actorUserId);

    if (!updated) throw badRequest("Record not found or not in a reviewable state");

    res.json({ data: updated });
  })
);

// ── Anomaly alerts ────────────────────────────────────────────────────────────

aiRouter.get(
  "/alerts",
  asyncHandler(async (req, res) => {
    const query = parseZod(listQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);

    const records = await aiRepo.listRecords({
      organizationId: query.organizationId,
      storeId: query.storeId,
      sourceType: "anomaly_alert",
      status: query.status || "draft",
      limit: query.limit
    });

    res.json({ data: records });
  })
);

aiRouter.get(
  "/alerts/:id",
  asyncHandler(async (req, res) => {
    const recordId = z.string().uuid().parse(req.params.id);
    const query = parseZod(z.object({ organizationId: z.string().uuid() }), req.query);
    authorizeTenant(req.actor, query.organizationId);

    const record = await aiRepo.findById(query.organizationId, recordId);
    if (!record || record.sourceType !== "anomaly_alert") throw notFound("Alert not found");

    res.json({ data: record });
  })
);

// Manually trigger an anomaly scan for an organization (admin/manager only)
aiRouter.post(
  "/alerts/scan",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        dateFrom: z.string().datetime().optional(),
        dateTo:   z.string().datetime().optional(),
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const dateFrom = body.dateFrom ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dateTo   = body.dateTo   ?? new Date().toISOString();

    const records = await generateAndStoreAnomalyAlerts(body.organizationId, dateFrom, dateTo);

    res.status(201).json({ data: records });
  })
);

aiRouter.patch(
  "/alerts/:id",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const recordId = z.string().uuid().parse(req.params.id);
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        status: z.enum(["reviewed", "dismissed"])
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);
    const actor = getActor(req);

    const updated =
      body.status === "reviewed"
        ? await reviewRecord(body.organizationId, recordId, actor.actorUserId)
        : await dismissRecord(body.organizationId, recordId, actor.actorUserId);

    if (!updated) throw badRequest("Alert not found or not in a reviewable state");

    res.json({ data: updated });
  })
);

// ── Usage summary (platform admin) ───────────────────────────────────────────

aiRouter.get(
  "/usage",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid().optional(),
        dateFrom:       z.string().datetime().optional(),
        dateTo:         z.string().datetime().optional(),
      }),
      req.query
    );

    const rows = await aiRepo.getUsageSummary(query);
    res.json({ data: rows });
  })
);

// ── Inventory Reorder Recommendations ────────────────────────────────────────

aiRouter.post(
  "/reorder",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        storeId:        z.string().uuid().optional(),
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const record = await generateAndStoreReorderRecommendations(body.organizationId, body.storeId);
    res.status(201).json({ data: record });
  })
);

aiRouter.get(
  "/reorder",
  asyncHandler(async (req, res) => {
    const query = parseZod(listQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);

    const records = await aiRepo.listRecords({
      organizationId: query.organizationId,
      storeId: query.storeId,
      sourceType: "inventory_reorder",
      status: query.status,
      limit: query.limit,
    });
    res.json({ data: records });
  })
);

// ── Sales Forecast ────────────────────────────────────────────────────────────

aiRouter.post(
  "/forecast",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        storeId:        z.string().uuid().optional(),
        dateFrom:       z.string().datetime().optional(),
        dateTo:         z.string().datetime().optional(),
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    const dateFrom = body.dateFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const dateTo   = body.dateTo   ?? new Date().toISOString();

    const record = await generateAndStoreSalesForecast(body.organizationId, body.storeId, dateFrom, dateTo);
    res.status(201).json({ data: record });
  })
);

aiRouter.get(
  "/forecast",
  asyncHandler(async (req, res) => {
    const query = parseZod(listQuerySchema, req.query);
    authorizeTenant(req.actor, query.organizationId);

    const records = await aiRepo.listRecords({
      organizationId: query.organizationId,
      storeId: query.storeId,
      sourceType: "sales_forecast",
      status: query.status,
      limit: query.limit,
    });
    res.json({ data: records });
  })
);

// ── Guardian Spending Digest ──────────────────────────────────────────────────

aiRouter.post(
  "/guardian-digest",
  requirePermission("organizations:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        dateFrom:       z.string().datetime().optional(),
        dateTo:         z.string().datetime().optional(),
      }),
      req.body
    );
    authorizeTenant(req.actor, body.organizationId);

    // Fetch org name + contact email for the email sender
    const orgRow = await import("../../db/client.js").then(({ pool }) =>
      pool.query(
        `SELECT name, contact_email FROM commerce_organizations WHERE id = $1`,
        [body.organizationId]
      )
    );
    const org = orgRow.rows[0];
    if (!org) throw notFound("Organization not found");

    // Default to current week Mon–Sun
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const dateFrom = body.dateFrom ?? monday.toISOString();
    const dateTo   = body.dateTo   ?? new Date().toISOString();

    const result = await generateAndSendGuardianDigests(
      body.organizationId,
      org.name,
      org.contact_email,
      dateFrom,
      dateTo
    );

    res.json({ data: result });
  })
);
