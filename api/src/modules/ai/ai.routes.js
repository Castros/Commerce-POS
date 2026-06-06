import { Router } from "express";
import { z } from "zod";

import { authorizeTenant, getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, notFound, parseZod } from "../../shared/http/errors.js";
import * as aiRepo from "./ai.repo.js";
import { dismissRecord, generateAndStoreAnomalyAlerts, generateAndStoreCloseoutSummary, reviewRecord } from "./ai.service.js";

export const aiRouter = Router();

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
    const body = parseZod(z.object({ organizationId: z.string().uuid() }), req.body);
    authorizeTenant(req.actor, body.organizationId);

    const records = await generateAndStoreAnomalyAlerts(body.organizationId);

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
