import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

const AI_MODEL = "claude-haiku-4-5";

// Pricing in microdollars per token (1 USD = 1,000,000 microdollars)
const MODEL_PRICING = {
  "claude-haiku-4-5":        { input: 1,  output: 5  },  // $1/1M in, $5/1M out
  "claude-sonnet-4-6":       { input: 3,  output: 15 },
  "claude-opus-4-8":         { input: 5,  output: 25 },
};

export function estimateCostMicrodollars(modelName, promptTokens, completionTokens) {
  const pricing = MODEL_PRICING[modelName] ?? MODEL_PRICING["claude-haiku-4-5"];
  return Math.round(
    (promptTokens * pricing.input + completionTokens * pricing.output)
  );
}

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

// Extract JSON from model output that may include markdown fences or preamble text
function extractJson(raw) {
  // Find the first { or [ and the last matching } or ]
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  let start = -1;
  let endChar = "";

  if (firstBrace === -1 && firstBracket === -1) return raw.trim();
  if (firstBrace === -1) { start = firstBracket; endChar = "]"; }
  else if (firstBracket === -1) { start = firstBrace; endChar = "}"; }
  else if (firstBrace < firstBracket) { start = firstBrace; endChar = "}"; }
  else { start = firstBracket; endChar = "]"; }

  const end = raw.lastIndexOf(endChar);
  if (end === -1 || end < start) return raw.trim();
  return raw.slice(start, end + 1);
}

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
    outputJson = JSON.parse(extractJson(rawText));
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
    outputJson = JSON.parse(extractJson(rawText));
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

// ── Inventory Reorder Assistant ───────────────────────────────────────────────

const REORDER_SYSTEM_PROMPT = `You are an inventory planning assistant for a school cafeteria or campus store.

Analyze the provided inventory and sales velocity data and produce a concise reorder recommendation report.

Rules:
- Write a 2-3 sentence summaryText a manager can act on immediately.
- Sort recommendations by urgency: critical first (≤2 days stock), then high (≤5 days), then medium.
- suggestedOrderQty should be 14 days of supply minus current stock, rounded up to nearest 5.
- Use neutral, factual language. Do not invent data not in the input.
- Return valid JSON only — no markdown fences.

JSON shape:
{
  "summaryText": "string",
  "recommendations": [
    {
      "productName": "string",
      "storeName": "string",
      "currentStock": number,
      "avgDailySales": number,
      "daysOfStockRemaining": number | null,
      "suggestedOrderQty": number,
      "urgency": "critical" | "high" | "medium"
    }
  ]
}`;

export async function generateReorderRecommendations(inputSnapshot) {
  const client = getClient();

  const items = inputSnapshot.items;
  if (!items || items.length === 0) return { outputJson: { summaryText: "No items require reordering at this time.", recommendations: [] }, promptTokens: 0, completionTokens: 0 };

  const userContent = `Generate inventory reorder recommendations for ${inputSnapshot.organizationName}:\n\n${
    items.map((i) =>
      `Product: ${i.productName} | Store: ${i.storeName} | In stock: ${i.quantityOnHand} | Reorder threshold: ${i.reorderThreshold} | Sold last 30d: ${i.unitsSold30d} | Avg daily: ${Number(i.avgDailySales).toFixed(1)} | Days remaining: ${i.daysOfStockRemaining ?? "N/A"}`
    ).join("\n")
  }`;

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: REORDER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }]
  });

  const rawText = message.content[0].text.trim();
  let outputJson;
  try {
    outputJson = JSON.parse(extractJson(rawText));
  } catch {
    throw new Error(`AI returned unparseable JSON: ${rawText.slice(0, 300)}`);
  }

  return { outputJson, promptTokens: message.usage.input_tokens, completionTokens: message.usage.output_tokens };
}

// ── Sales Forecast ────────────────────────────────────────────────────────────

const FORECAST_SYSTEM_PROMPT = `You are a sales analyst for a school cafeteria or campus store.

Analyze the provided daily sales history and generate a plain-language forecast for the next 7 days.

Rules:
- Write a 2-4 sentence forecastText a school director can read in 30 seconds.
- nextWeekEstimateCents should be your best point estimate in integer cents.
- trend is the direction of the past 30 days vs the previous 30 days if data allows, otherwise based on the last 7 vs prior 7.
- confidence is low if fewer than 14 data points, medium if 14-25, high if 26+.
- insights should be 1-3 specific observations (e.g. "Fridays are consistently 30% lower").
- Use dollar amounts in the forecastText (not cents). Do not invent facts.
- Return valid JSON only — no markdown fences.

JSON shape:
{
  "forecastText": "string",
  "nextWeekEstimateCents": number,
  "trend": "up" | "down" | "stable",
  "confidence": "low" | "medium" | "high",
  "insights": ["string"]
}`;

export async function generateSalesForecast(inputSnapshot) {
  const client = getClient();

  const days = inputSnapshot.dailySales;
  const userContent = `Generate a 7-day sales forecast for ${inputSnapshot.organizationName}${inputSnapshot.storeName ? ` — ${inputSnapshot.storeName}` : ""}.

Historical daily sales (${days.length} days):
${days.map((d) => `${d.date}: $${(Number(d.salesCents) / 100).toFixed(2)} (${d.orderCount} orders)`).join("\n")}`;

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: FORECAST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }]
  });

  const rawText = message.content[0].text.trim();
  let outputJson;
  try {
    outputJson = JSON.parse(extractJson(rawText));
  } catch {
    throw new Error(`AI returned unparseable JSON: ${rawText.slice(0, 300)}`);
  }

  return { outputJson, promptTokens: message.usage.input_tokens, completionTokens: message.usage.output_tokens };
}

// ── Guardian Spending Digest ──────────────────────────────────────────────────

const GUARDIAN_DIGEST_SYSTEM_PROMPT = `You are writing a friendly, concise weekly spending digest for a parent or guardian of a school student.

Rules:
- Tone: warm, informative, never alarming. This is a school, not a debt collector.
- subject should be 8 words or fewer.
- bodyHtml should be a complete HTML email body using simple inline styles. No <html>/<head>/<body> wrapper — just the inner content.
- bodyText should be the plain-text version of the same content.
- Include each student's name, amount spent, number of transactions, and current balance.
- Mention top products if provided.
- If balance is below $5.00, include a gentle reminder to top up.
- Never invent data not in the input.
- Return valid JSON only — no markdown fences.

JSON shape:
{
  "subject": "string",
  "bodyHtml": "string",
  "bodyText": "string"
}`;

export async function generateGuardianDigest(inputSnapshot) {
  const client = getClient();

  const { guardianName, orgName, students, weekLabel } = inputSnapshot;

  const studentBlocks = students.map((s) =>
    `Student: ${s.studentName}
  Spent this week: $${(Number(s.spentCents) / 100).toFixed(2)} across ${s.transactionCount} purchase(s)
  Current balance: $${(Number(s.balanceCents) / 100).toFixed(2)}
  Top items: ${s.topItems.length > 0 ? s.topItems.map((i) => `${i.name} (×${i.qty})`).join(", ") : "none recorded"}`
  ).join("\n\n");

  const userContent = `Write a weekly spending digest email for ${guardianName} from ${orgName}.
Week: ${weekLabel}

${studentBlocks}`;

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: GUARDIAN_DIGEST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }]
  });

  const rawText = message.content[0].text.trim();
  let outputJson;
  try {
    outputJson = JSON.parse(extractJson(rawText));
  } catch {
    throw new Error(`AI returned unparseable JSON: ${rawText.slice(0, 300)}`);
  }

  return { outputJson, promptTokens: message.usage.input_tokens, completionTokens: message.usage.output_tokens };
}
