"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import type { DemoSchoolData } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import type { ReportSummary } from "./reportsTypes";

type DatePreset = "today" | "week" | "month" | "custom";

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfToday() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfWeek() {
  const date = startOfToday();
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date;
}

function startOfMonth() {
  const date = startOfToday();
  date.setUTCDate(1);
  return date;
}

function endOfSelectedDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function presetRange(preset: DatePreset) {
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  if (preset === "week") {
    return {
      from: dateInputValue(startOfWeek()),
      to: dateInputValue(today)
    };
  }

  if (preset === "month") {
    return {
      from: dateInputValue(startOfMonth()),
      to: dateInputValue(today)
    };
  }

  return {
    from: dateInputValue(today),
    to: dateInputValue(today)
  };
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
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [preset, setPreset] = useState<DatePreset>("today");
  const initialRange = useMemo(() => presetRange("today"), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [storeId, setStoreId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  async function loadReport(existingDemo = demo) {
    setLoading(true);
    setError(null);
    try {
      const schoolData = existingDemo || (await apiPost<DemoSchoolData>("/demo/school", {}));
      setDemo(schoolData);

      const params = new URLSearchParams({
        organizationId: schoolData.organization.id,
        dateFrom: new Date(`${dateFrom}T00:00:00.000Z`).toISOString(),
        dateTo: endOfSelectedDay(dateTo)
      });
      if (storeId) {
        params.set("storeId", storeId);
      }

      const data = await apiGet<ReportSummary>(`/reports/summary?${params}`);
      setReport(data);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reports");
    } finally {
      setLoading(false);
    }
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
        <button type="button" onClick={() => loadReport()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button type="button" disabled>Export CSV later</button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

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
            {demo?.store ? <option value={demo.store.id}>{demo.store.name}</option> : null}
          </select>
        </label>
        <button type="button" onClick={() => loadReport()} disabled={loading}>
          Apply filters
        </button>
      </div>

      <div className="permissionStrip">
        <div>
          <span>Admin reporting</span>
          <strong>Sales, payments, wallets, and drawers</strong>
          <small>Filtered by school, store, and date range. Register-level sales need register metadata on all order types later.</small>
        </div>
        <div>
          <span>Last updated</span>
          <strong>{lastUpdated ? shortDate(lastUpdated) : "Not loaded"}</strong>
          <small>Use Refresh after live register sales or refunds.</small>
        </div>
      </div>

      <div className="metricGrid">
        <div className="metricTile">
          <span>Gross sales</span>
          <strong>{formatMoney(report?.totals.grossSalesCents || 0)}</strong>
          <small>Paid sales before refunded order total.</small>
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
          <h3>Wallet & credit activity</h3>
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

