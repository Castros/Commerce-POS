"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import type { CashDrawerSession, DemoSchoolData } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadRegisterContext } from "../lib/organizationContext";

const registerName = "Lunch Line 02";

function varianceLabel(value: number | null) {
  if (value === null) return "-";
  if (value === 0) return "$0.00";
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

export function PaymentsClient() {
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [currentDrawer, setCurrentDrawer] = useState<CashDrawerSession | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<CashDrawerSession[]>([]);
  const [openingCash, setOpeningCash] = useState("100.00");
  const [countedCash, setCountedCash] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function dollarsToCents(value: string) {
    return Math.round(Number(value || "0") * 100);
  }

  async function loadDrawers(existingDemo = demo) {
    try {
      setError(null);
      const data = existingDemo || { ...(await loadRegisterContext()), students: [] };
      if (!existingDemo) setDemo(data);
      const params = new URLSearchParams({
        organizationId: data.organization.id,
        storeId: data.store.id,
        registerName
      });
      const current = await apiGet<CashDrawerSession | null>(`/cash-drawers/current?${params}`);
      const history = await apiGet<CashDrawerSession[]>(
        `/cash-drawers?organizationId=${data.organization.id}&storeId=${data.store.id}&limit=20`
      );
      setCurrentDrawer(current);
      setDrawerHistory(history);
      if (current) setCountedCash((current.expectedCashCents / 100).toFixed(2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cash drawer");
    }
  }

  useEffect(() => {
    void loadDrawers();
  }, []);

  async function openDrawer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = demo || { ...(await loadRegisterContext()), students: [] };
    if (!demo) setDemo(data);
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost("/cash-drawers/open", {
        organizationId: data.organization.id,
        storeId: data.store.id,
        registerName,
        openingCashCents: dollarsToCents(openingCash),
        note: "Opening cafeteria register"
      });
      setMessage(`${registerName} opened with ${formatMoney(dollarsToCents(openingCash))}.`);
      await loadDrawers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open cash drawer");
    } finally {
      setSaving(false);
    }
  }

  async function closeDrawer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentDrawer || !demo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const countedCashCents = dollarsToCents(countedCash);
      const closed = await apiPost<CashDrawerSession>(`/cash-drawers/${currentDrawer.id}/close`, {
        organizationId: demo.organization.id,
        countedCashCents,
        note: "Manager closeout count"
      });
      setMessage(
        `${registerName} closed. Variance ${varianceLabel(closed.overShortCents)}.`
      );
      await loadDrawers(demo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close cash drawer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Payment operations" title="Payments & Cash Drawer">
        <button type="button" onClick={() => loadDrawers()}>
          Refresh
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}
      {message ? <p className="buttonHelp success">{message}</p> : null}

      <div className="permissionStrip">
        <div>
          <span>Register</span>
          <strong>{registerName}</strong>
          <small>Cash sales from the register attach to the open drawer.</small>
        </div>
        <div>
          <span>Status</span>
          <strong>{currentDrawer ? "Open" : "Closed"}</strong>
          <small>{currentDrawer ? `Opened ${new Date(currentDrawer.openedAt).toLocaleString()}` : "Open a drawer before cash sales."}</small>
        </div>
        <div>
          <span>Expected cash</span>
          <strong>{formatMoney(currentDrawer?.expectedCashCents || 0)}</strong>
          <small>Opening cash plus recorded cash sales.</small>
        </div>
      </div>

      <div className="cashDrawerGrid">
        <form className="inventoryPanel" onSubmit={openDrawer}>
          <div>
            <span>Open drawer</span>
            <strong>Start cashier shift</strong>
            <small>Only one open drawer is allowed per register.</small>
          </div>
          <label>
            Opening cash
            <input
              inputMode="decimal"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
              disabled={Boolean(currentDrawer)}
            />
          </label>
          <button type="submit" disabled={saving || Boolean(currentDrawer)}>
            Open drawer
          </button>
        </form>

        <form className="inventoryPanel" onSubmit={closeDrawer}>
          <div>
            <span>Close drawer</span>
            <strong>Manager count</strong>
            <small>Variance is counted cash minus expected cash.</small>
          </div>
          <label>
            Counted cash
            <input
              inputMode="decimal"
              value={countedCash}
              onChange={(event) => setCountedCash(event.target.value)}
              disabled={!currentDrawer}
            />
          </label>
          <button type="submit" disabled={saving || !currentDrawer}>
            Close drawer
          </button>
        </form>
      </div>

      <DataTable
        headers={["Register", "Status", "Opening", "Expected", "Counted", "Variance", "Opened", "Closed"]}
        rows={drawerHistory.map((drawer) => [
          drawer.registerName,
          drawer.status,
          formatMoney(drawer.openingCashCents),
          formatMoney(drawer.expectedCashCents),
          drawer.countedCashCents === null ? "-" : formatMoney(drawer.countedCashCents),
          varianceLabel(drawer.overShortCents),
          new Date(drawer.openedAt).toLocaleString(),
          drawer.closedAt ? new Date(drawer.closedAt).toLocaleString() : "-"
        ])}
        statusIndex={1}
      />
    </section>
  );
}
