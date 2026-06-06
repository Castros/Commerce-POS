import {
  AI_MODEL,
  generateAnomalyAlerts,
  generateCloseoutSummary,
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

    await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens });

    return aiRepo.findById(organizationId, recordId);
  } catch (err) {
    await aiRepo.markError(organizationId, recordId, err.message);
    throw err;
  }
}

// ── Anomaly alerts ────────────────────────────────────────────────────────────

export async function generateAndStoreAnomalyAlerts(organizationId) {
  const flaggedPatterns = await aiRepo.runAnomalyRules(organizationId);
  if (flaggedPatterns.length === 0) return [];

  const recordId = await aiRepo.insertPendingRecord({
    organizationId,
    storeId: null,
    sourceType: "anomaly_alert",
    sourceRecordId: null,
    modelName: AI_MODEL
  });

  try {
    const inputSnapshot = { organizationId, flaggedPatterns, generatedAt: new Date().toISOString() };
    const inputHash = hashInputSnapshot(inputSnapshot);

    await aiRepo.updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash);

    const { outputJson, promptTokens, completionTokens } = await generateAnomalyAlerts(flaggedPatterns);

    await aiRepo.markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens });

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
