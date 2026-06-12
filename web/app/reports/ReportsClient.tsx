"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { Store } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { ReportSummary } from "./reportsTypes";

type AiSummaryOutput = {
  summaryText?: string;
  keyMetrics?: Record<string, string>;
  topProducts?: { name: string; unitsSold: number }[];
  flags?: { type: string; message: string }[];
  severity?: "low" | "medium" | "high";
};

type AiAlertOutput = {
  alertType: string;
  headline: string;
  body: string;
  severity: "low" | "medium" | "high";
};

type AiForecastOutput = {
  forecastText?: string;
  nextWeekEstimateCents?: number;
  trend?: "up" | "down" | "stable";
  confidence?: "low" | "medium" | "high";
  insights?: string[];
};

type AiReorderOutput = {
  summaryText?: string;
  recommendations?: {
    productName: string;
    storeName: string;
    currentStock: number;
    avgDailySales: number;
    daysOfStockRemaining: number | null;
    suggestedOrderQty: number;
    urgency: "critical" | "high" | "medium";
  }[];
};

type AiRecord = {
  id: string;
  organizationId: string;
  storeId: string | null;
  sourceType: "closeout_summary" | "anomaly_alert" | "inventory_reorder" | "sales_forecast" | "guardian_digest";
  sourceRecordId: string | null;
  modelName: string;
  status: "pending" | "draft" | "reviewed" | "dismissed" | "error";
  outputJson: AiSummaryOutput | AiAlertOutput[] | AiForecastOutput | AiReorderOutput | null;
  errorMessage?: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type DatePreset = "today" | "week" | "month" | "custom";
type AiSection = "alerts" | "forecast" | "reorder" | "summaries";

function dateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek() {
  const date = startOfToday();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function startOfMonth() {
  const date = startOfToday();
  date.setDate(1);
  return date;
}

function endOfSelectedDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function presetRange(preset: DatePreset) {
  const today = startOfToday();
  if (preset === "week")  return { from: dateInputValue(startOfWeek()),  to: dateInputValue(today) };
  if (preset === "month") return { from: dateInputValue(startOfMonth()), to: dateInputValue(today) };
  return { from: dateInputValue(today), to: dateInputValue(today) };
}

function methodLabel(method: string) {
  if (method === "wallet") return "Wallet";
  if (method === "cash")   return "Cash";
  if (method === "card")   return "Card";
  return method;
}

function percentOf(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function shortDate(value: string | null) {
  if (!value) return "Open";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(new Date(value));
}

export function ReportsClient() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [stores, setStores]     = useState<Store[]>([]);
  const [report, setReport]     = useState<ReportSummary | null>(null);
  const [preset, setPreset]     = useState<DatePreset>("today");
  const initialRange            = useMemo(() => presetRange("today"), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo]     = useState(initialRange.to);
  const [storeId, setStoreId]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // AI state
  const [summaries, setSummaries]     = useState<AiRecord[]>([]);
  const [alerts, setAlerts]           = useState<AiRecord[]>([]);
  const [forecast, setForecast]       = useState<AiRecord | null>(null);
  const [reorder, setReorder]         = useState<AiRecord | null>(null);
  const [aiLoading, setAiLoading]     = useState(false);
  const [scanning, setScanning]       = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [reordering, setReordering]   = useState(false);
  const [digestSending, setDigestSending] = useState(false);
  const [digestMessage, setDigestMessage] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{ type: "info" | "error"; text: string } | null>(null);

  // Tab + collapse state
  const [activeTab, setActiveTab] = useState<"financial" | "ai">("financial");
  const [expanded, setExpanded]   = useState<Set<AiSection>>(new Set(["alerts", "forecast", "reorder", "summaries"]));

  function toggleSection(id: AiSection) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function loadReport(orgId = organizationId) {
    setLoading(true);
    setError(null);
    try {
      let resolvedOrgId = orgId;
      if (!resolvedOrgId) {
        const org = await loadCurrentOrganization();
        resolvedOrgId = org.id;
        setOrganizationId(org.id);
        const storeList = await apiGet<Store[]>(`/stores?organizationId=${org.id}`);
        setStores(storeList);
        void loadAiData(org.id);
      }
      const params = new URLSearchParams({
        organizationId: resolvedOrgId,
        dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
        dateTo:   endOfSelectedDay(dateTo),
      });
      if (storeId) params.set("storeId", storeId);
      const data = await apiGet<ReportSummary>(`/reports/summary?${params}`);
      setReport(data);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reports");
    } finally {
      setLoading(false);
    }
  }

  async function loadAiData(orgId: string) {
    setAiLoading(true);
    try {
      const [summaryList, alertList, forecastList, reorderList] = await Promise.all([
        apiGet<AiRecord[]>(`/ai/summaries?organizationId=${orgId}&limit=5`),
        apiGet<AiRecord[]>(`/ai/alerts?organizationId=${orgId}&status=draft&limit=10`),
        apiGet<AiRecord[]>(`/ai/forecast?organizationId=${orgId}&limit=1`),
        apiGet<AiRecord[]>(`/ai/reorder?organizationId=${orgId}&limit=1`),
      ]);
      setSummaries(summaryList);
      setAlerts(alertList);
      setForecast(forecastList[0] ?? null);
      setReorder(reorderList[0] ?? null);
    } catch {
      // AI features are optional
    } finally {
      setAiLoading(false);
    }
  }

  async function runAnomalyScan() {
    if (!organizationId) return;
    setScanning(true);
    setScanMessage(null);
    try {
      const records = await apiPost<AiRecord[]>("/ai/alerts/scan", {
        organizationId,
        dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
        dateTo:   endOfSelectedDay(dateTo),
      });
      await loadAiData(organizationId);
      if (!records || records.length === 0) {
        setScanMessage({ type: "info", text: "Not enough data to detect anomalies. More transaction history is needed." });
      }
    } catch (err) {
      setScanMessage({ type: "error", text: err instanceof Error ? err.message : "Scan failed. Check that ANTHROPIC_API_KEY is set and valid." });
    } finally {
      setScanning(false);
    }
  }

  async function runForecast() {
    if (!organizationId) return;
    setForecasting(true);
    try {
      const record = await apiPost<AiRecord>("/ai/forecast", {
        organizationId,
        dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
        dateTo:   endOfSelectedDay(dateTo),
        ...(storeId ? { storeId } : {}),
      });
      setForecast(record);
    } catch (err) {
      setForecast({ id: "", organizationId: organizationId ?? "", storeId: null, sourceType: "sales_forecast", sourceRecordId: null, modelName: "", status: "error", outputJson: null, errorMessage: err instanceof Error ? err.message : "Failed", reviewedByUserId: null, reviewedAt: null, createdAt: new Date().toISOString() });
    } finally {
      setForecasting(false);
    }
  }

  async function runReorder() {
    if (!organizationId) return;
    setReordering(true);
    try {
      const record = await apiPost<AiRecord>("/ai/reorder", {
        organizationId,
        ...(storeId ? { storeId } : {}),
      });
      setReorder(record);
    } catch (err) {
      setReorder({ id: "", organizationId: organizationId ?? "", storeId: null, sourceType: "inventory_reorder", sourceRecordId: null, modelName: "", status: "error", outputJson: null, errorMessage: err instanceof Error ? err.message : "Failed", reviewedByUserId: null, reviewedAt: null, createdAt: new Date().toISOString() });
    } finally {
      setReordering(false);
    }
  }

  async function sendGuardianDigest() {
    if (!organizationId) return;
    setDigestSending(true);
    setDigestMessage(null);
    try {
      const result = await apiPost<{ sent: number; skipped: number }>("/ai/guardian-digest", {
        organizationId,
        dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
        dateTo:   endOfSelectedDay(dateTo),
      });
      setDigestMessage(`Sent ${result.sent} digest email${result.sent !== 1 ? "s" : ""}${result.skipped > 0 ? ` (${result.skipped} skipped)` : ""}.`);
    } catch (err) {
      setDigestMessage(err instanceof Error ? err.message : "Failed to send digests.");
    } finally {
      setDigestSending(false);
    }
  }

  async function reviewSummary(id: string) {
    if (!organizationId) return;
    await apiPatch(`/ai/summaries/${id}`, { organizationId, status: "reviewed" });
    setSummaries((prev) => prev.map((s) => (s.id === id ? { ...s, status: "reviewed" as const } : s)));
  }

  async function dismissSummary(id: string) {
    if (!organizationId) return;
    await apiPatch(`/ai/summaries/${id}`, { organizationId, status: "dismissed" });
    setSummaries((prev) => prev.filter((s) => s.id !== id));
  }

  async function reviewAlert(id: string) {
    if (!organizationId) return;
    await apiPatch(`/ai/alerts/${id}`, { organizationId, status: "reviewed" });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  async function dismissAlert(id: string) {
    if (!organizationId) return;
    await apiPatch(`/ai/alerts/${id}`, { organizationId, status: "dismissed" });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  useEffect(() => { void loadReport(); }, []);

  function applyPreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    if (nextPreset !== "custom") {
      const range = presetRange(nextPreset);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  }

  const grossSalesCents     = report?.totals.grossSalesCents || 0;
  const maxProductRevenue   = Math.max(...(report?.productSales || []).map((i) => i.revenueCents), 1);
  const netWalletMovement   = (report?.wallet.walletTopUpsCents || 0) + (report?.wallet.walletRefundsCents || 0) - (report?.wallet.walletSpendCents || 0);
  const totalDrawerVariance = (report?.cashDrawers || []).reduce((s, d) => s + d.overShortCents, 0);

  return (
    <section className="module">
      <PageHeader eyebrow="Analytics" title="Reports">
        <button type="button" onClick={() => void loadReport()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      {/* ── Filter bar — above tabs, affects both ─────────────────────────── */}
      <div className="toolbar reportFilters">
        <button type="button" className={preset === "today"  ? "active" : ""} onClick={() => applyPreset("today")}>Today</button>
        <button type="button" className={preset === "week"   ? "active" : ""} onClick={() => applyPreset("week")}>This week</button>
        <button type="button" className={preset === "month"  ? "active" : ""} onClick={() => applyPreset("month")}>This month</button>
        <label>
          From
          <input type="date" value={dateFrom} onChange={(e) => { setPreset("custom"); setDateFrom(e.target.value); }} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(e) => { setPreset("custom"); setDateTo(e.target.value); }} />
        </label>
        <label>
          Store
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void loadReport()} disabled={loading}>Apply filters</button>
      </div>

      {/* ── Tab strip ─────────────────────────────────────────────────────── */}
      <div className="reportsTabs" role="tablist">
        <button
          role="tab"
          type="button"
          className={`reportsTab${activeTab === "financial" ? " active" : ""}`}
          aria-selected={activeTab === "financial"}
          onClick={() => setActiveTab("financial")}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>bar_chart</span>
          Financial Reports
        </button>
        <button
          role="tab"
          type="button"
          className={`reportsTab${activeTab === "ai" ? " active" : ""}`}
          aria-selected={activeTab === "ai"}
          onClick={() => setActiveTab("ai")}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>auto_awesome</span>
          AI Insights
          {alerts.length > 0 && <span className="reportsTabBadge">{alerts.length}</span>}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          FINANCIAL REPORTS TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "financial" && (
        <>
          <div className="permissionStrip">
            <div>
              <span>Reporting scope</span>
              <strong>Sales, payments, wallets, and drawers</strong>
              <small>Filtered by store and date range.</small>
            </div>
            <div>
              <span>Last updated</span>
              <strong>{lastUpdated ? shortDate(lastUpdated) : "Not loaded"}</strong>
              <small>Refresh after live sales or refunds.</small>
            </div>
          </div>

          <div className="metricGrid">
            <div className="metricTile">
              <span>Gross sales</span>
              <strong>{formatMoney(report?.totals.grossSalesCents || 0)}</strong>
              <small>Paid sales before refunds.</small>
            </div>
            <div className="metricTile">
              <span>Net sales</span>
              <strong>{formatMoney(report?.totals.netSalesCents || 0)}</strong>
              <small>Gross less full-order refunds.</small>
            </div>
            <div className="metricTile">
              <span>Transactions</span>
              <strong>{report?.totals.paidOrderCount || 0}</strong>
              <small>{report?.totals.refundedOrderCount || 0} refunded.</small>
            </div>
            <div className="metricTile">
              <span>Average order</span>
              <strong>{formatMoney(report?.totals.averageOrderCents || 0)}</strong>
              <small>Paid order average.</small>
            </div>
            <div className="metricTile">
              <span>Wallet spend</span>
              <strong>{formatMoney(report?.wallet.walletSpendCents || 0)}</strong>
              <small>{report?.wallet.walletStudentCount || 0} student wallet{report?.wallet.walletStudentCount === 1 ? "" : "s"} used.</small>
            </div>
            <div className={`metricTile${totalDrawerVariance !== 0 ? " metricTile--warning" : ""}`}>
              <span>Drawer variance</span>
              <strong>{formatMoney(totalDrawerVariance)}</strong>
              <small>Closed drawer over/short total.</small>
            </div>
          </div>

          <div className="reportGrid">
            <div className="chartPanel">
              <h3>What is being sold</h3>
              {(report?.productSales || []).length === 0 ? (
                <p className="emptyState">No product sales for this filter range.</p>
              ) : (
                <div className="barChart compactBars" aria-label="Top products by revenue">
                  {(report?.productSales || []).slice(0, 8).map((item) => (
                    <span
                      key={item.productId}
                      style={{ height: `${Math.max(8, (item.revenueCents / maxProductRevenue) * 100)}%` }}
                      title={`${item.productName}: ${formatMoney(item.revenueCents)}`}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="chartPanel">
              <h3>Money collected</h3>
              <ul className="activityList">
                {(report?.paymentMethods || []).map((method) => (
                  <li key={method.method}>
                    {methodLabel(method.method)}: {formatMoney(method.amountCents)} ({percentOf(method.amountCents, grossSalesCents)})
                  </li>
                ))}
                {(report?.paymentMethods || []).length === 0 ? <li>No payments for this range.</li> : null}
              </ul>
            </div>

            <div className="chartPanel">
              <h3>Wallet &amp; credit activity</h3>
              <dl className="reportStats">
                <div><dt>Top-ups</dt><dd>{formatMoney(report?.wallet.walletTopUpsCents || 0)}</dd></div>
                <div><dt>Spend</dt><dd>{formatMoney(report?.wallet.walletSpendCents || 0)}</dd></div>
                <div><dt>Refunds</dt><dd>{formatMoney(report?.wallet.walletRefundsCents || 0)}</dd></div>
                <div><dt>Net movement</dt><dd>{formatMoney(netWalletMovement)}</dd></div>
              </dl>
            </div>

            <div className="chartPanel">
              <h3>Where it is being sold</h3>
              <DataTable
                headers={["Store", "Orders", "Sales"]}
                rows={(report?.storeSales || []).map((store) => [
                  store.storeName,
                  String(store.orderCount),
                  formatMoney(store.salesCents),
                ])}
              />
            </div>

            <div className="chartPanel full">
              <h3>Product performance</h3>
              <DataTable
                headers={["Product", "Units sold", "Revenue", "Share"]}
                rows={(report?.productSales || []).map((item) => [
                  item.productName,
                  String(item.unitsSold),
                  formatMoney(item.revenueCents),
                  percentOf(item.revenueCents, grossSalesCents),
                ])}
              />
            </div>

            <div className="chartPanel full">
              <h3>Cash drawer closeouts</h3>
              <DataTable
                headers={["Store", "Register", "Status", "Expected", "Counted", "Variance", "Opened", "Closed"]}
                rows={(report?.cashDrawers || []).map((drawer) => [
                  drawer.storeName,
                  drawer.registerName,
                  drawer.status,
                  formatMoney(drawer.expectedCashCents),
                  drawer.countedCashCents === null ? "Not counted" : formatMoney(drawer.countedCashCents),
                  formatMoney(drawer.overShortCents),
                  shortDate(drawer.openedAt),
                  shortDate(drawer.closedAt),
                ])}
                statusIndex={2}
              />
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          AI INSIGHTS TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "ai" && (
        <div className="aiInsightsPanel">

          {/* ── Anomaly Alerts ──────────────────────────────────────────── */}
          <div className="aiCollapsible">
            <div className="aiCollapsibleHeader">
              <span className="aiCollapsibleTitle">
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--amber)" }}>warning</span>
                Anomaly Alerts
                {alerts.length > 0 && <span className="reportsTabBadge">{alerts.length} active</span>}
              </span>
              <div className="aiCollapsibleActions">
                <button type="button" onClick={() => void runAnomalyScan()} disabled={scanning || !organizationId}>
                  {scanning ? "Scanning..." : "Scan now"}
                </button>
                <button
                  type="button"
                  className="aiCollapsibleToggle"
                  aria-expanded={expanded.has("alerts")}
                  onClick={() => toggleSection("alerts")}
                >
                  <span className="material-symbols-outlined">expand_more</span>
                </button>
              </div>
            </div>
            {expanded.has("alerts") && (
              <div className="aiCollapsibleBody">
                {aiLoading ? (
                  <p className="aiEmptyState">Loading...</p>
                ) : alerts.length === 0 ? (
                  <div className="aiEmptyState">
                    {scanMessage ? (
                      <p style={{ margin: 0, color: scanMessage.type === "error" ? "var(--red)" : "var(--muted)" }}>
                        {scanMessage.text}
                      </p>
                    ) : (
                      <>
                        <strong>No active alerts</strong>
                        Run a scan to check for unusual refund patterns, drawer variances, and inventory anomalies.
                      </>
                    )}
                  </div>
                ) : (
                  <div className="aiAlertCards">
                    {alerts.map((alert) => {
                      const items = Array.isArray(alert.outputJson) ? (alert.outputJson as AiAlertOutput[]) : [];
                      return items.map((item, i) => (
                        <div key={`${alert.id}-${i}`} className={`aiAlertCard aiAlertCard--${item.severity || "medium"}`}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <h4>{item.headline}</h4>
                            <span className={`aiSeverityBadge aiSeverityBadge--${item.severity || "medium"}`}>{item.severity || "medium"}</span>
                          </div>
                          <p>{item.body}</p>
                          <div className="aiAlertCardActions">
                            <button type="button" onClick={() => void reviewAlert(alert.id)}>Mark reviewed</button>
                            <button type="button" onClick={() => void dismissAlert(alert.id)}>Dismiss</button>
                          </div>
                        </div>
                      ));
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Sales Forecast ──────────────────────────────────────────── */}
          <div className="aiCollapsible">
            <div className="aiCollapsibleHeader">
              <span className="aiCollapsibleTitle">
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--primary)" }}>trending_up</span>
                Sales Forecast
              </span>
              <div className="aiCollapsibleActions">
                <button type="button" onClick={() => void runForecast()} disabled={forecasting || !organizationId}>
                  {forecasting ? "Generating..." : "Generate forecast"}
                </button>
                <button
                  type="button"
                  className="aiCollapsibleToggle"
                  aria-expanded={expanded.has("forecast")}
                  onClick={() => toggleSection("forecast")}
                >
                  <span className="material-symbols-outlined">expand_more</span>
                </button>
              </div>
            </div>
            {expanded.has("forecast") && (
              <div className="aiCollapsibleBody">
                {aiLoading ? (
                  <p className="aiEmptyState">Loading...</p>
                ) : forecast ? (
                  <div className="aiSummaryCard">
                    {forecast.status === "error" ? (
                      <p style={{ color: "var(--red)", margin: 0, fontSize: "0.88rem" }}>{forecast.errorMessage ?? "Forecast generation failed."}</p>
                    ) : (() => {
                      const out = forecast.outputJson as AiForecastOutput | null;
                      return (
                        <>
                          <div className="aiSummaryMeta">
                            <strong>{shortDate(forecast.createdAt)}</strong>
                            {out?.trend && <span className={`aiSeverityBadge aiSeverityBadge--${out.trend === "up" ? "low" : out.trend === "down" ? "high" : "medium"}`}>{out.trend}</span>}
                            {out?.confidence && <small>confidence: {out.confidence}</small>}
                          </div>
                          {out?.forecastText && <p className="aiSummaryText">{out.forecastText}</p>}
                          {out?.nextWeekEstimateCents !== undefined && (
                            <p style={{ margin: "4px 0 0", fontSize: "0.88rem", color: "var(--muted)" }}>
                              Next 7-day estimate: <strong>{formatMoney(out.nextWeekEstimateCents)}</strong>
                            </p>
                          )}
                          {(out?.insights ?? []).length > 0 && (
                            <ul style={{ margin: "8px 0 0", paddingLeft: "1.2rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                              {(out?.insights ?? []).map((insight, i) => <li key={i}>{insight}</li>)}
                            </ul>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="aiEmptyState">
                    <strong>No forecast yet</strong>
                    Generate a forecast based on the selected date range's sales history.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Reorder Recommendations ─────────────────────────────────── */}
          <div className="aiCollapsible">
            <div className="aiCollapsibleHeader">
              <span className="aiCollapsibleTitle">
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--amber)" }}>inventory_2</span>
                Reorder Recommendations
              </span>
              <div className="aiCollapsibleActions">
                <button type="button" onClick={() => void runReorder()} disabled={reordering || !organizationId}>
                  {reordering ? "Analyzing..." : "Analyze inventory"}
                </button>
                <button
                  type="button"
                  className="aiCollapsibleToggle"
                  aria-expanded={expanded.has("reorder")}
                  onClick={() => toggleSection("reorder")}
                >
                  <span className="material-symbols-outlined">expand_more</span>
                </button>
              </div>
            </div>
            {expanded.has("reorder") && (
              <div className="aiCollapsibleBody">
                {aiLoading ? (
                  <p className="aiEmptyState">Loading...</p>
                ) : reorder ? (
                  <div className="aiSummaryCard">
                    {reorder.status === "error" ? (
                      <p style={{ color: "var(--red)", margin: 0, fontSize: "0.88rem" }}>{reorder.errorMessage ?? "Reorder analysis failed."}</p>
                    ) : (() => {
                      const out = reorder.outputJson as AiReorderOutput | null;
                      const recs = out?.recommendations ?? [];
                      return (
                        <>
                          {out?.summaryText && <p className="aiSummaryText">{out.summaryText}</p>}
                          {recs.length > 0 && (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginTop: 8 }}>
                              <thead>
                                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                                  <th style={{ padding: "4px 8px" }}>Product</th>
                                  <th style={{ padding: "4px 8px" }}>Store</th>
                                  <th style={{ padding: "4px 8px" }}>In Stock</th>
                                  <th style={{ padding: "4px 8px" }}>Days Left</th>
                                  <th style={{ padding: "4px 8px" }}>Order Qty</th>
                                  <th style={{ padding: "4px 8px" }}>Urgency</th>
                                </tr>
                              </thead>
                              <tbody>
                                {recs.map((r, i) => (
                                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                                    <td style={{ padding: "4px 8px" }}>{r.productName}</td>
                                    <td style={{ padding: "4px 8px" }}>{r.storeName}</td>
                                    <td style={{ padding: "4px 8px" }}>{r.currentStock}</td>
                                    <td style={{ padding: "4px 8px" }}>{r.daysOfStockRemaining ?? "—"}</td>
                                    <td style={{ padding: "4px 8px" }}><strong>{r.suggestedOrderQty}</strong></td>
                                    <td style={{ padding: "4px 8px" }}>
                                      <span className={`aiSeverityBadge aiSeverityBadge--${r.urgency === "critical" ? "high" : r.urgency === "high" ? "medium" : "low"}`}>{r.urgency}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="aiEmptyState">
                    <strong>No reorder analysis yet</strong>
                    Analyze current inventory levels and sales velocity to get reorder suggestions.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Closeout Summaries ──────────────────────────────────────── */}
          <div className="aiCollapsible">
            <div className="aiCollapsibleHeader">
              <span className="aiCollapsibleTitle">
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--primary)" }}>auto_awesome</span>
                Closeout Summaries
              </span>
              <div className="aiCollapsibleActions">
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Auto-generated on drawer close</span>
                <button
                  type="button"
                  className="aiCollapsibleToggle"
                  aria-expanded={expanded.has("summaries")}
                  onClick={() => toggleSection("summaries")}
                >
                  <span className="material-symbols-outlined">expand_more</span>
                </button>
              </div>
            </div>
            {expanded.has("summaries") && (
              <div className="aiCollapsibleBody">
                {aiLoading ? (
                  <p className="aiEmptyState">Loading...</p>
                ) : summaries.length === 0 ? (
                  <div className="aiEmptyState">
                    <strong>No summaries yet</strong>
                    Summaries are generated automatically when a cashier closes their cash drawer.
                  </div>
                ) : (
                  summaries.map((summary) => {
                    const out = summary.outputJson as AiSummaryOutput | null;
                    return (
                      <div key={summary.id} className="aiSummaryCard">
                        <div className="aiSummaryMeta">
                          <strong>{shortDate(summary.createdAt)}</strong>
                          <span className={`aiStatusBadge aiStatusBadge--${summary.status}`}>{summary.status}</span>
                          {out?.severity && <span className={`aiSeverityBadge aiSeverityBadge--${out.severity}`}>{out.severity}</span>}
                        </div>
                        {summary.status === "error" ? (
                          <p style={{ color: "var(--red)", margin: 0, fontSize: "0.88rem" }}>Generation failed: {summary.errorMessage}</p>
                        ) : out?.summaryText ? (
                          <p className="aiSummaryText">{out.summaryText}</p>
                        ) : (
                          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.88rem" }}>Generating...</p>
                        )}
                        {(out?.flags || []).length > 0 && (
                          <div className="aiSummaryFlags">
                            {(out?.flags || []).map((flag, i) => <span key={i} className="aiFlag">{flag.message}</span>)}
                          </div>
                        )}
                        {summary.status === "draft" && (
                          <div className="aiSummaryActions">
                            <button type="button" onClick={() => void reviewSummary(summary.id)}>Mark reviewed</button>
                            <button type="button" onClick={() => void dismissSummary(summary.id)}>Dismiss</button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* ── Guardian Digest — action strip ──────────────────────────── */}
          <div className="aiActionStrip">
            <div className="aiActionStripInfo">
              <strong>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--primary)" }}>mail</span>
                Guardian Spending Digest
              </strong>
              <p>
                Sends an AI-written weekly spending summary to all guardians with email notifications enabled.
                Uses the selected date range. Each guardian receives one email per linked student.
              </p>
              {digestMessage && <p style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{digestMessage}</p>}
            </div>
            <button
              type="button"
              onClick={() => void sendGuardianDigest()}
              disabled={digestSending || !organizationId}
              style={{ flexShrink: 0 }}
            >
              {digestSending ? "Sending..." : "Send digest emails"}
            </button>
          </div>

        </div>
      )}
    </section>
  );
}
