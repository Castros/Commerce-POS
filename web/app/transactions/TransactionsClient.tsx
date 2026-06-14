"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/api";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";

type TxType = "sale" | "refund" | "top_up";

type Transaction = {
  id: string;
  source: "order" | "wallet";
  type: TxType;
  createdAt: string;
  amountCents: number;
  currency: string;
  customerId: string | null;
  customerName: string;
  method: string | null;
  storeName: string | null;
  processedBy: string;
  note: string | null;
  balanceAfterCents: number | null;
  orderId: string | null;
};

const TYPE_LABELS: Record<TxType, string> = {
  sale: "Sale",
  refund: "Refund",
  top_up: "Top-up"
};

const TYPE_COLORS: Record<TxType, { bg: string; color: string }> = {
  sale:   { bg: "#dcfce7", color: "#166534" },
  refund: { bg: "#fee2e2", color: "#991b1b" },
  top_up: { bg: "#dbeafe", color: "#1e40af" }
};

function TypeBadge({ type }: { type: TxType }) {
  const style = TYPE_COLORS[type] ?? { bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 12,
      fontSize: "0.7rem",
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      background: style.bg,
      color: style.color
    }}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

function methodLabel(method: string | null) {
  if (!method) return "—";
  if (method === "wallet") return "Wallet";
  if (method === "cash")   return "Cash";
  if (method === "card")   return "Card";
  return method;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return {
    dateFrom: start.toISOString().slice(0, 16),
    dateTo: end.toISOString().slice(0, 16)
  };
}

export function TransactionsClient() {
  const today = todayRange();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(today.dateFrom);
  const [dateTo,   setDateTo]   = useState(today.dateTo);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    try {
      const org = await loadCurrentOrganization();
      setOrgId(org.id);
      await fetchData(org.id, dateFrom, dateTo, typeFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load");
      setLoading(false);
    }
  }

  async function fetchData(
    id: string,
    from: string,
    to: string,
    type: string
  ) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organizationId: id });
      if (from) params.set("dateFrom", from.includes("T") ? from + ":00.000Z" : from + "T00:00:00.000Z");
      if (to)   params.set("dateTo",   to.includes("T")   ? to   + ":00.000Z" : to   + "T23:59:59.999Z");
      if (type) params.set("type", type);
      const data = await apiGet<Transaction[]>(`/transactions?${params}`);
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    if (!orgId) return;
    void fetchData(orgId, dateFrom, dateTo, typeFilter);
  }

  const filtered = search.trim()
    ? transactions.filter((tx) => {
        const q = search.toLowerCase();
        return (
          tx.customerName.toLowerCase().includes(q) ||
          tx.processedBy.toLowerCase().includes(q) ||
          (tx.storeName ?? "").toLowerCase().includes(q) ||
          (tx.note ?? "").toLowerCase().includes(q)
        );
      })
    : transactions;

  const totalSales  = transactions.filter((t) => t.type === "sale").reduce((s, t) => s + t.amountCents, 0);
  const totalRefunds = transactions.filter((t) => t.type === "refund").reduce((s, t) => s + t.amountCents, 0);
  const totalTopUps = transactions.filter((t) => t.type === "top_up").reduce((s, t) => s + t.amountCents, 0);

  return (
    <section className="module">
      <PageHeader eyebrow="Activity Log" title="Transactions">
        <button type="button" onClick={applyFilters} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      {/* Summary tiles */}
      <div className="metricGrid" style={{ marginBottom: 24 }}>
        <article className="metricTile">
          <span>Sales</span>
          <strong>{loading ? "—" : formatMoney(totalSales)}</strong>
          <small>{transactions.filter((t) => t.type === "sale").length} transactions</small>
        </article>
        <article className="metricTile">
          <span>Refunds</span>
          <strong style={{ color: "#dc2626" }}>{loading ? "—" : formatMoney(totalRefunds)}</strong>
          <small>{transactions.filter((t) => t.type === "refund").length} transactions</small>
        </article>
        <article className="metricTile">
          <span>Wallet top-ups</span>
          <strong style={{ color: "#1d4ed8" }}>{loading ? "—" : formatMoney(totalTopUps)}</strong>
          <small>{transactions.filter((t) => t.type === "top_up").length} transactions</small>
        </article>
        <article className="metricTile">
          <span>Net activity</span>
          <strong>{loading ? "—" : formatMoney(totalSales - totalRefunds + totalTopUps)}</strong>
          <small>{transactions.length} total events</small>
        </article>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>From</span>
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.85rem" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>To</span>
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.85rem" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Type</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.85rem", background: "white" }}
          >
            <option value="">All types</option>
            <option value="sale">Sales</option>
            <option value="refund">Refunds</option>
            <option value="top_up">Top-ups</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Search</span>
          <input
            type="search"
            placeholder="Customer, staff, note..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.85rem", minWidth: 200 }}
          />
        </label>
        <button
          type="button"
          className="buttonLink primary"
          onClick={applyFilters}
          disabled={loading}
          style={{ alignSelf: "flex-end" }}
        >
          Apply
        </button>
      </div>

      {/* Table */}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {["Date & Time", "Type", "Customer", "Amount", "Method", "Store", "Processed By", "Note"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#6b7280", padding: "32px 0" }}>
                  {loading ? "Loading..." : "No transactions found for the selected period."}
                </td>
              </tr>
            ) : filtered.map((tx) => (
              <tr key={tx.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(tx.createdAt)}</td>
                <td><TypeBadge type={tx.type} /></td>
                <td>{tx.customerName}</td>
                <td style={{ fontWeight: 600, color: tx.type === "refund" ? "#dc2626" : tx.type === "top_up" ? "#1d4ed8" : "#166534" }}>
                  {tx.type === "refund" ? `−${formatMoney(tx.amountCents)}` : formatMoney(tx.amountCents)}
                </td>
                <td>{methodLabel(tx.method)}</td>
                <td>{tx.storeName ?? "—"}</td>
                <td>{tx.processedBy}</td>
                <td style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                  {tx.type === "top_up" && tx.balanceAfterCents !== null
                    ? `Bal after: ${formatMoney(tx.balanceAfterCents)}${tx.note ? ` · ${tx.note}` : ""}`
                    : (tx.note ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
