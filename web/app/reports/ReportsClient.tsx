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

type AiRecord = {
  id: string;
  organizationId: string;
  storeId: string | null;
  sourceType: "closeout_summary" | "anomaly_alert";
  sourceRecordId: string | null;
  modelName: string;
  status: "pending" | "draft" | "reviewed" | "dismissed" | "error";
  outputJson: AiSummaryOutput | AiAlertOutput[] | null;
  errorMessage?: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type DatePreset = "today" | "week" | "month" | "custom";

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
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date;
}

function startOfMonth() {
  const date = startOfToday();
  date.setDate(1);
  return date;
}

function endOfSelectedDay(value: string) {
  // Parse as local midnight so the range end respects the user's timezone
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function presetRange(preset: DatePreset) {
  const today = startOfToday();

  if (preset === "week") {
    return { from: dateInputValue(startOfWeek()), to: dateInputValue(today) };
  }
  if (preset === "month") {
    return { from: dateInputValue(startOfMonth()), to: dateInputValue(today) };
  }
  return { from: dateInputValue(today), to: dateInputValue(today) };
}

function methodLabel(method: string) {
  if (method === "wallet") return "Wallet";
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  return method;
}

function percentOf(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function shortDate(value: string | null) {
  if (!value) return "Open";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ReportsClient() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [preset, setPreset] = useState<DatePreset>("today");
  const initialRange = useMemo(() => presetRange("today"), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [storeId, setStoreId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [summaries, setSummaries] = useState<AiRecord[]>([]);
  const [alerts, setAlerts] = useState<AiRecord[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

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
        dateTo: endOfSelectedDay(dateTo)
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
      const [summaryList, alertList] = await Promise.all([
        apiGet<AiRecord[]>(`/ai/summaries?organizationId=${orgId}&limit=5`),
        apiGet<AiRecord[]>(`/ai/alerts?organizationId=${orgId}&status=draft&limit=10`)
      ]);
      setSummaries(summaryList);
      setAlerts(alertList);
    } catch {
      // AI features are optional — don't block the main reports view
    } finally {
      setAiLoading(false);
    }
  }

  async function runAnomalyScan() {
    if (!organizationId) return;
    setScanning(true);
    try {
      await apiPost("/ai/alerts/scan", { organizationId });
      await loadAiData(organizationId);
    } finally {
      setScanning(false);
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

  useEffect(() => {
    void loadReport();
  }, []);

  function applyPreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    if (nextPreset !== "custom") {
      const range = presetRange(nextPreset);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  }

  const grossSalesCents = report?.totals.grossSalesCents || 0;
  const maxProductRevenue = Math.max(...(report?.productSales || []).map((item) => item.revenueCents), 1);
  const netWalletMovement =
    (report?.wallet.walletTopUpsCents || 0) +
    (report?.wallet.walletRefundsCents || 0) -
    (report?.wallet.walletSpendCents || 0);
  const totalDrawerVariance = (report?.cashDrawers || []).reduce(
    (sum, drawer) => sum + drawer.overShortCents,
    0
  );

  return (
    <section className="module">
      <PageHeader eyebrow="Analytics" title="Reports">
        <button type="button" onClick={() => void loadReport()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      {/* ── AI Anomaly Alerts ─────────────────────────────────────────── */}
      <div className="aiSection">
        <div className="aiSectionHeader">
          <h3>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--amber)" }}>warning</span>
            AI Anomaly Alerts
          </h3>
          <div className="aiScanRow">
            {alerts.length > 0 && (
              <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                {alerts.length} active alert{alerts.length !== 1 ? "s" : ""}
              </span>
            )}
            <button type="button" onClick={() => void runAnomalyScan()} disabled={scanning || !organizationId}>
              {scanning ? "Scanning..." : "Scan now"}
            </button>
          </div>
        </div>

        {aiLoading ? (
          <p className="aiEmptyState">Loading AI data...</p>
        ) : alerts.length === 0 ? (
          <div className="aiEmptyState">
            <strong>No active alerts</strong>
            Run a scan to check for unusual refund patterns, drawer variances, and inventory anomalies.
          </div>
        ) : (
          <div className="aiAlertCards">
            {alerts.map((alert) => {
              const items = Array.isArray(alert.outputJson) ? (alert.outputJson as AiAlertOutput[]) : [];
              return items.map((item, i) => (
                <div key={`${alert.id}-${i}`} className={`aiAlertCard aiAlertCard--${item.severity || "medium"}`}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <h4>{item.headline}</h4>
                    <span className={`aiSeverityBadge aiSeverityBadge--${item.severity || "medium"}`}>
                      {item.severity || "medium"}
                    </span>
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

      {/* ── AI Closeout Summaries ─────────────────────────────────────── */}
      <div className="aiSection">
        <div className="aiSectionHeader">
          <h3>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--primary)" }}>auto_awesome</span>
            AI Closeout Summaries
          </h3>
          <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
            Generated automatically after each drawer close
          </span>
        </div>

        {aiLoading ? (
          <p className="aiEmptyState">Loading AI data...</p>
        ) : summaries.length === 0 ? (
          <div className="aiEmptyState">
            <strong>No summaries yet</strong>
            Summaries are generated automatically when a cashier closes their cash drawer. Add your{" "}
            <code>ANTHROPIC_API_KEY</code> to enable this feature.
          </div>
        ) : (
          summaries.map((summary) => {
            const out = summary.outputJson as AiSummaryOutput | null;
            return (
              <div key={summary.id} className="aiSummaryCard">
                <div className="aiSummaryMeta">
                  <strong>{shortDate(summary.createdAt)}</strong>
                  <span className={`aiStatusBadge aiStatusBadge--${summary.status}`}>{summary.status}</span>
                  {out?.severity && (
                    <span className={`aiSeverityBadge aiSeverityBadge--${out.severity}`}>{out.severity}</span>
                  )}
                  <small>{summary.modelName}</small>
                </div>

                {summary.status === "error" ? (
                  <p style={{ color: "var(--red)", margin: 0, fontSize: "0.88rem" }}>
                    Generation failed: {summary.errorMessage}
                  </p>
                ) : out?.summaryText ? (
                  <p className="aiSummaryText">{out.summaryText}</p>
                ) : (
                  <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.88rem" }}>Generating...</p>
                )}

                {(out?.flags || []).length > 0 && (
                  <div className="aiSummaryFlags">
                    {(out?.flags || []).map((flag, i) => (
                      <span key={i} className="aiFlag">{flag.message}</span>
                    ))}
                  </div>
                )}

                {summary.status === "draft" && (
                  <div className="aiSummaryActions">
                    <button type="button" onClick={() => void reviewSummary(summary.id)}>
                      Mark reviewed
                    </button>
                    <button type="button" onClick={() => void dismissSummary(summary.id)}>
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="toolbar reportFilters">
        <button type="button" className={preset === "today" ? "active" : ""} onClick={() => applyPreset("today")}>
          Today
        </button>
        <button type="button" className={preset === "week" ? "active" : ""} onClick={() => applyPreset("week")}>
          This week
        </button>
        <button type="button" className={preset === "month" ? "active" : ""} onClick={() => applyPreset("month")}>
          This month
        </button>
        <label>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPreset("custom");
              setDateFrom(event.target.value);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPreset("custom");
              setDateTo(event.target.value);
            }}
          />
        </label>
        <label>
          Store
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void loadReport()} disabled={loading}>
          Apply filters
        </button>
      </div>

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
        <div className="metricTile">
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
            <div>
              <dt>Top-ups</dt>
              <dd>{formatMoney(report?.wallet.walletTopUpsCents || 0)}</dd>
            </div>
            <div>
              <dt>Spend</dt>
              <dd>{formatMoney(report?.wallet.walletSpendCents || 0)}</dd>
            </div>
            <div>
              <dt>Refunds</dt>
              <dd>{formatMoney(report?.wallet.walletRefundsCents || 0)}</dd>
            </div>
            <div>
              <dt>Net movement</dt>
              <dd>{formatMoney(netWalletMovement)}</dd>
            </div>
          </dl>
        </div>

        <div className="chartPanel">
          <h3>Where it is being sold</h3>
          <DataTable
            headers={["Store", "Orders", "Sales"]}
            rows={(report?.storeSales || []).map((store) => [
              store.storeName,
              String(store.orderCount),
              formatMoney(store.salesCents)
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
              percentOf(item.revenueCents, grossSalesCents)
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
              shortDate(drawer.closedAt)
            ])}
            statusIndex={2}
          />
        </div>
      </div>
    </section>
  );
}
