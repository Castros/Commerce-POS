import {
  AI_MODEL,
  estimateCostMicrodollars,
  generateAnomalyAlerts,
  generateCloseoutSummary,
  generateGuardianDigest,
  generateReorderRecommendations,
  generateSalesForecast,
  hashInputSnapshot
} from "../../shared/ai/aiClient.js";
import * as aiRepo from "./ai.repo.js";

// ── Closeout summary ──────────────────────────────────────────────────────────

export async function enqueueCloseoutSummary({ sessionId, organizationId, storeId }) {
  // Fire-and-forget after drawer close response is sent.
  // Errors are captured in the ai_records table with status='error'.
  setImmediate(async () => {
    try {
      await generateAndStoreCloseoutSummary({ sessionId, organizationId, storeId });
    } catch (err) {
      console.error("[AI] Closeout summary generation failed", {
        sessionId,
        organizationId,
        error: err.message
      });
    }
  });
}

export async function generateAndStoreCloseoutSummary({ sessionId, organizationId, storeId }) {
  // Return existing non-error record for this session without calling the LLM.
  const existing = await aiRepo.findExistingRecord(organizationId, "closeout_summary", sessionId);
  if (existing) return existing;

  const recordId = await aiRepo.insertPendingRecord({
    organizationId,
    storeId,
    sourceType: "closeout_summary",
    sourceRecordId: sessionId,
    modelName: AI_MODEL
  });

  try {
    const inputSnapshot = await aiRepo.buildCloseoutInputSnapshot(organizationId, sessionId);
    const inputHash = hashInputSnapshot(inputSnapshot);

    // Dedup by input hash — handles double-triggers on same session
    const dedupCheck = await aiRepo.findByInputHash(organizationId, "closeout_summary", sessionId, inputHash);
    if (dedupCheck) {
      await aiRepo.deletePendingRecord(organizationId, recordId);
      return dedupCheck;
    }

    await aiRepo.updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash);

    const { outputJson, promptTokens, completionTokens } = await generateCloseoutSummary(inputSnapshot);
    const costMicrodollars = estimateCostMicrodollars(AI_MODEL, promptTokens, completionTokens);

    await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens, costMicrodollars });

    return aiRepo.findById(organizationId, recordId);
  } catch (err) {
    await aiRepo.markError(organizationId, recordId, err.message);
    throw err;
  }
}

// ── Anomaly alerts ────────────────────────────────────────────────────────────

export async function generateAndStoreAnomalyAlerts(organizationId, dateFrom, dateTo) {
  const flaggedPatterns = await aiRepo.runAnomalyRules(organizationId, dateFrom, dateTo);
  if (flaggedPatterns.length === 0) return [];

  const recordId = await aiRepo.insertPendingRecord({
    organizationId,
    storeId: null,
    sourceType: "anomaly_alert",
    sourceRecordId: null,
    modelName: AI_MODEL
  });

  try {
    const inputSnapshot = { organizationId, dateFrom, dateTo, flaggedPatterns, generatedAt: new Date().toISOString() };
    const inputHash = hashInputSnapshot(inputSnapshot);

    await aiRepo.updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash);

    const { outputJson, promptTokens, completionTokens } = await generateAnomalyAlerts(flaggedPatterns);
    const costMicrodollars = estimateCostMicrodollars(AI_MODEL, promptTokens, completionTokens);

    await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens, costMicrodollars });

    return [await aiRepo.findById(organizationId, recordId)];
  } catch (err) {
    await aiRepo.markError(organizationId, recordId, err.message);
    throw err;
  }
}

// ── Review actions ────────────────────────────────────────────────────────────

export async function reviewRecord(organizationId, recordId, userId) {
  return aiRepo.markReviewed(organizationId, recordId, userId);
}

export async function dismissRecord(organizationId, recordId, userId) {
  return aiRepo.markDismissed(organizationId, recordId, userId);
}

// ── Inventory Reorder Assistant ───────────────────────────────────────────────

export async function generateAndStoreReorderRecommendations(organizationId, storeId) {
  const inputSnapshot = await aiRepo.buildReorderInputSnapshot(organizationId, storeId);

  const recordId = await aiRepo.insertPendingRecord({
    organizationId,
    storeId: storeId ?? null,
    sourceType: "inventory_reorder",
    sourceRecordId: null,
    modelName: AI_MODEL
  });

  try {
    const inputHash = hashInputSnapshot(inputSnapshot);
    await aiRepo.updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash);

    const { outputJson, promptTokens, completionTokens } = await generateReorderRecommendations(inputSnapshot);
    const costMicrodollars = estimateCostMicrodollars(AI_MODEL, promptTokens, completionTokens);

    await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens, costMicrodollars });
    return aiRepo.findById(organizationId, recordId);
  } catch (err) {
    await aiRepo.markError(organizationId, recordId, err.message);
    throw err;
  }
}

// ── Sales Forecast ────────────────────────────────────────────────────────────

export async function generateAndStoreSalesForecast(organizationId, storeId, dateFrom, dateTo) {
  const inputSnapshot = await aiRepo.buildForecastInputSnapshot(organizationId, storeId, dateFrom, dateTo);

  const recordId = await aiRepo.insertPendingRecord({
    organizationId,
    storeId: storeId ?? null,
    sourceType: "sales_forecast",
    sourceRecordId: null,
    modelName: AI_MODEL
  });

  try {
    const inputHash = hashInputSnapshot(inputSnapshot);
    await aiRepo.updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash);

    const { outputJson, promptTokens, completionTokens } = await generateSalesForecast(inputSnapshot);
    const costMicrodollars = estimateCostMicrodollars(AI_MODEL, promptTokens, completionTokens);

    await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens, costMicrodollars });
    return aiRepo.findById(organizationId, recordId);
  } catch (err) {
    await aiRepo.markError(organizationId, recordId, err.message);
    throw err;
  }
}

// ── Guardian Spending Digest ──────────────────────────────────────────────────

export async function generateAndSendGuardianDigests(organizationId, orgName, orgContactEmail, dateFrom, dateTo) {
  const guardians = await aiRepo.getGuardiansForDigest(organizationId);
  if (guardians.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0;
  let skipped = 0;

  for (const guardian of guardians) {
    try {
      const inputSnapshot = await aiRepo.buildGuardianDigestSnapshot(
        organizationId, guardian.id, guardian.name, orgName, dateFrom, dateTo
      );

      if (inputSnapshot.students.length === 0) { skipped++; continue; }

      const recordId = await aiRepo.insertPendingRecord({
        organizationId,
        storeId: null,
        sourceType: "guardian_digest",
        sourceRecordId: guardian.id,
        modelName: AI_MODEL
      });

      const inputHash = hashInputSnapshot(inputSnapshot);
      await aiRepo.updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash);

      const { outputJson, promptTokens, completionTokens } = await generateGuardianDigest(inputSnapshot);
      const costMicrodollars = estimateCostMicrodollars(AI_MODEL, promptTokens, completionTokens);

      await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens, costMicrodollars });

      // Send the email
      const { sendEmail } = await import("../../shared/email/emailClient.js");
      await sendEmail({
        to: guardian.email,
        subject: outputJson.subject,
        html: outputJson.bodyHtml,
        replyTo: orgContactEmail ?? undefined,
      });

      sent++;
    } catch (err) {
      console.error(`[AI] Guardian digest failed for ${guardian.id}:`, err.message);
      skipped++;
    }
  }

  return { sent, skipped };
}
