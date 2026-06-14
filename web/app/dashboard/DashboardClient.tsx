"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/api";
import type { Organization } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { ReportSummary } from "../reports/reportsTypes";

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

function methodLabel(method: string) {
  if (method === "wallet") return "Wallet";
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  return method;
}

export function DashboardClient() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const organization = await loadCurrentOrganization();
      setOrg(organization);
      const { dateFrom, dateTo } = todayRange();
      const params = new URLSearchParams({
        organizationId: organization.id,
        dateFrom,
        dateTo
      });
      const data = await apiGet<ReportSummary>(`/reports/summary?${params}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }

  const hasSales = (report?.totals.paidOrderCount ?? 0) > 0;

  return (
    <section className="module">
      <PageHeader eyebrow={org?.name ?? "Loading..."} title="Dashboard">
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <Link className="buttonLink primary" href="/register">Open register</Link>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      <div className="metricGrid">
        <article className="metricTile">
          <span>Today's sales</span>
          <strong>{loading ? "—" : formatMoney(report?.totals.grossSalesCents ?? 0)}</strong>
          <small>{loading ? "" : `${report?.totals.paidOrderCount ?? 0} orders`}</small>
        </article>
        <article className="metricTile">
          <span>Net revenue</span>
          <strong>{loading ? "—" : formatMoney(report?.totals.netSalesCents ?? 0)}</strong>
          <small>{loading ? "" : `${report?.totals.refundedOrderCount ?? 0} refunds`}</small>
        </article>
        <article className="metricTile">
          <span>Avg. order</span>
          <strong>{loading ? "—" : formatMoney(report?.totals.averageOrderCents ?? 0)}</strong>
          <small>per transaction</small>
        </article>
        <article className="metricTile">
          <span>Wallet spend</span>
          <strong>{loading ? "—" : formatMoney(report?.wallet.walletSpendCents ?? 0)}</strong>
          <small>{loading ? "" : `${report?.wallet.walletStudentCount ?? 0} student${report?.wallet.walletStudentCount === 1 ? "" : "s"}`}</small>
        </article>
        <article className="metricTile">
          <span>Top-ups today</span>
          <strong>{loading ? "—" : formatMoney(report?.wallet.walletTopUpsCents ?? 0)}</strong>
          <small>Cash credited to wallets</small>
        </article>
      </div>

      <div className="dashboardGrid">
        <div className="panelWide">
          <h3>Today's top products</h3>
          {loading ? (
            <p className="emptyState">Loading...</p>
          ) : !hasSales ? (
            <p className="emptyState">No sales recorded yet today.</p>
          ) : (
            <ul className="activityList">
              {(report?.productSales ?? []).slice(0, 6).map((item) => (
                <li key={item.productId}>
                  {item.productName} — {item.unitsSold} sold · {formatMoney(item.revenueCents)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panelWide">
          <h3>Payment methods today</h3>
          {loading ? (
            <p className="emptyState">Loading...</p>
          ) : !hasSales ? (
            <p className="emptyState">No payments recorded yet today.</p>
          ) : (
            <ul className="activityList">
              {(report?.paymentMethods ?? []).map((pm) => (
                <li key={pm.method}>
                  {methodLabel(pm.method)}: {pm.orderCount} orders · {formatMoney(pm.amountCents)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panelWide">
          <h3>Quick links</h3>
          <div className="actionGrid">
            <Link className="buttonLink" href="/register">Cashier register</Link>
            <Link className="buttonLink" href="/orders">Orders &amp; receipts</Link>
            <Link className="buttonLink" href="/payments">Cash drawers</Link>
            <Link className="buttonLink" href="/inventory">Inventory</Link>
            <Link className="buttonLink" href="/products">Products</Link>
            <Link className="buttonLink" href="/customers">Customers</Link>
            <Link className="buttonLink" href="/staff">Staff</Link>
            <Link className="buttonLink" href="/reports">Full reports</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
