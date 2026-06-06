import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

const AI_MODEL = "claude-haiku-3-5-20241022";

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export { AI_MODEL };

export function hashInputSnapshot(snapshot) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot, Object.keys(snapshot).sort()))
    .digest("hex");
}

function centsToDollars(cents) {
  return (Number(cents) / 100).toFixed(2);
}

const CLOSEOUT_SYSTEM_PROMPT = `You are an operations analyst assistant for a school cafeteria POS system.

Generate a concise plain-language daily closeout summary for the cafeteria manager.

Rules:
- Write in clear, professional English.
- Keep the summaryText to 2-4 sentences that a manager can read in 30 seconds.
- Use dollar amounts (not cents) with two decimal places.
- Reference the store name and date.
- Mention drawer variance only if non-zero. Under $5.00 is minor; over $20.00 should be flagged clearly.
- List top-selling products by name and units sold.
- Mention low-stock items by name only — do not include specific unit counts.
- Mention students with negative balances by count only, never by name.
- Use neutral, factual language. Do not assign blame or make accusations.
- Do not invent facts not present in the input.
- Return a valid JSON object — nothing else, no markdown fences.

JSON shape:
{
  "summaryText": "string (the narrative paragraph)",
  "keyMetrics": {
    "grossSalesDollars": "string",
    "cashSalesDollars": "string",
    "walletSalesDollars": "string",
    "cardSalesDollars": "string",
    "drawerVarianceDollars": "string"
  },
  "topProducts": [{ "name": "string", "unitsSold": number }],
  "flags": [{ "type": "string", "message": "string" }],
  "severity": "low" | "medium" | "high"
}`;

const ANOMALY_SYSTEM_PROMPT = `You are an operations analyst assistant for a school cafeteria POS system.

Write brief, neutral, factual operational alerts for a cafeteria administrator to review.

Rules:
- Use professional, neutral language. Do not accuse or imply intent.
- State what the system observed, not what it morally means.
- Suggest what the manager should review, not what action to take.
- Keep each alert's body to 1-2 sentences maximum.
- Never assign blame to a specific employee by name unless that name is explicitly provided in the input.
- Do not invent or infer facts not in the input.
- Return a valid JSON array — nothing else, no markdown fences.

JSON shape:
[
  {
    "alertType": "string (matches the pattern type from input)",
    "headline": "string (10 words max)",
    "body": "string (1-2 sentences)",
    "severity": "low" | "medium" | "high"
  }
]`;

export async function generateCloseoutSummary(inputSnapshot) {
  const client = getClient();

  // Build human-readable facts block to pass as the user message
  const s = inputSnapshot;
  const drawerVarianceSign = s.drawerCents.overShort < 0 ? "-" : "+";
  const userContent = `Generate a daily closeout summary for this shift data:

Store: ${s.storeName}
Register: ${s.registerName}
Date: ${new Date(s.closedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
Session: ${s.sessionId}

SALES:
- Total: $${centsToDollars(s.salesSummary.grossSalesCents)} (${s.salesSummary.totalOrders} orders)
- Wallet: $${centsToDollars(s.salesSummary.walletSalesCents)}
- Cash: $${centsToDollars(s.salesSummary.cashSalesCents)}
- Card: $${centsToDollars(s.salesSummary.cardSalesCents)}
- Refunds: ${s.salesSummary.refundedOrders} orders, $${centsToDollars(s.salesSummary.refundedAmountCents)}

DRAWER:
- Opening: $${centsToDollars(s.drawerCents.opening)}
- Expected: $${centsToDollars(s.drawerCents.expected)}
- Counted: $${centsToDollars(s.drawerCents.counted)}
- Variance: ${drawerVarianceSign}$${centsToDollars(Math.abs(s.drawerCents.overShort))}

TOP PRODUCTS:
${s.topProducts.length > 0 ? s.topProducts.map((p) => `- ${p.name}: ${p.unitsSold} sold ($${centsToDollars(p.revenueCents)})`).join("\n") : "- None"}

LOW STOCK ITEMS:
${s.lowStockItems.length > 0 ? s.lowStockItems.map((i) => `- ${i.name}: below threshold`).join("\n") : "- None"}

WALLET BALANCES:
- Students with negative balance: ${s.walletSnapshot.negativeBalanceCount}`;

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: CLOSEOUT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }]
  });

  const rawText = message.content[0].text.trim();

  let outputJson;
  try {
    outputJson = JSON.parse(rawText);
  } catch {
    throw new Error(`AI returned unparseable JSON: ${rawText.slice(0, 300)}`);
  }

  return {
    outputJson,
    promptTokens: message.usage.input_tokens,
    completionTokens: message.usage.output_tokens
  };
}

export async function generateAnomalyAlerts(flaggedPatterns) {
  if (!flaggedPatterns || flaggedPatterns.length === 0) return { outputJson: [], promptTokens: 0, completionTokens: 0 };

  const client = getClient();

  const userContent = `Generate operational alerts for the following flagged patterns:\n\n${flaggedPatterns
    .map(
      (p, i) => `Pattern ${i + 1}:
Type: ${p.type}
Details: ${p.details}
Observed: ${p.observedValue}
Baseline: ${p.baselineValue}`
    )
    .join("\n\n")}`;

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: ANOMALY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }]
  });

  const rawText = message.content[0].text.trim();

  let outputJson;
  try {
    outputJson = JSON.parse(rawText);
    if (!Array.isArray(outputJson)) throw new Error("Expected JSON array");
  } catch {
    throw new Error(`AI returned unparseable JSON: ${rawText.slice(0, 300)}`);
  }

  return {
    outputJson,
    promptTokens: message.usage.input_tokens,
    completionTokens: message.usage.output_tokens
  };
}
