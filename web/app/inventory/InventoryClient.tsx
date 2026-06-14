"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { DemoSchoolData, InventoryItem, InventoryMovement } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadRegisterContext } from "../lib/organizationContext";
import { useLanguage } from "../lib/i18n/LanguageContext";

// ── helpers ──────────────────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined) {
  return typeof v === "string" ? Number(v) : (v ?? 0);
}

function formatRelative(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 2)   return "Just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function movementLabel(type: string) {
  if (type === "receive")    return "Received";
  if (type === "sale")       return "Sold";
  if (type === "adjustment") return "Adjusted";
  return type;
}

const STATUS_ORDER = { out: 0, low: 1, not_tracked: 2, in_stock: 3 } as const;

const STATUS_COLOR = {
  out:         { dot: "#ef4444", bar: "#fca5a5", label: "Out of stock",  bg: "#fef2f2" },
  low:         { dot: "#f59e0b", bar: "#fcd34d", label: "Low stock",     bg: "#fffbeb" },
  in_stock:    { dot: "#22c55e", bar: "#86efac", label: "In stock",      bg: "#f0fdf4" },
  not_tracked: { dot: "#94a3b8", bar: "#cbd5e1", label: "Not tracked",   bg: "#f8fafc" },
};

// ── sub-components ────────────────────────────────────────────────────────────

function StockBar({ qty, threshold }: { qty: number; threshold: number }) {
  const pct = threshold > 0 ? Math.min((qty / threshold) * 100, 100) : (qty > 0 ? 100 : 0);
  const color = qty === 0 ? "#fca5a5" : pct < 40 ? "#fcd34d" : "#86efac";
  return (
    <div style={{ width: 64, height: 6, borderRadius: 3, background: "#e2e8f0", flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.2s" }} />
    </div>
  );
}

function SectionDivider({ label, count }: { label: string; count: number }) {
  return (
    <div style={{
      padding: "6px 16px",
      background: "#f8fafc",
      borderBottom: "1px solid #e2e8f0",
      fontSize: "0.65rem",
      fontWeight: 700,
      letterSpacing: "0.08em",
      color: "#64748b",
      textTransform: "uppercase" as const,
      display: "flex",
      alignItems: "center",
      gap: 8
    }}>
      {label}
      <span style={{ fontWeight: 400, color: "#94a3b8" }}>{count}</span>
    </div>
  );
}

function InventoryRow({
  item,
  selected,
  onClick
}: {
  item: InventoryItem;
  selected: boolean;
  onClick: () => void;
}) {
  const qty       = toNum(item.quantityOnHand);
  const threshold = toNum(item.reorderThreshold);
  const sc        = STATUS_COLOR[item.status] ?? STATUS_COLOR.not_tracked;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "11px 16px",
        gap: 12,
        cursor: "pointer",
        borderBottom: "1px solid #f1f5f9",
        background: selected ? "#f0fdf4" : "white",
        borderLeft: selected ? "3px solid #16a34a" : "3px solid transparent",
        transition: "background 0.1s",
      }}
    >
      {/* Status dot */}
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: sc.dot, flexShrink: 0
      }} />

      {/* Name + SKU */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0f172a",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 1 }}>
          {item.sku ?? "No SKU"}{item.location ? ` · ${item.location}` : ""}
        </div>
      </div>

      {/* Qty / threshold */}
      <div style={{ textAlign: "right", flexShrink: 0, fontSize: "0.8rem" }}>
        <span style={{ fontWeight: 700, color: sc.dot }}>{qty}</span>
        <span style={{ color: "#94a3b8" }}> / {threshold}</span>
      </div>

      {/* Mini bar */}
      <StockBar qty={qty} threshold={threshold} />
    </div>
  );
}

// ── CSV import types ──────────────────────────────────────────────────────────

type InvCsvPreviewRow = {
  row: number; sku: string | null; productName: string | null;
  quantity: number | null; reorderThreshold: number | null;
  storeName: string | null; status: "set" | "skip";
};
type InvCsvPreview = {
  total: number; valid: number;
  errors: { row: number; error: string }[];
  preview: InvCsvPreviewRow[];
};
type InvCsvResult = { updated: number; skipped: number; errors: { row: number; error: string }[] };

// ── main component ────────────────────────────────────────────────────────────

export function InventoryClient() {
  const { t } = useLanguage();
  const [demo, setDemo]           = useState<DemoSchoolData | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [search, setSearch]       = useState("");
  const [lowOnly, setLowOnly]     = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  // detail panel state
  const [history, setHistory]     = useState<InventoryMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [adjustInput, setAdjustInput]       = useState("");
  const [adjustNote, setAdjustNote]         = useState("Received stock");
  const [adjustSaving, setAdjustSaving]     = useState(false);
  const [adjustMsg, setAdjustMsg]           = useState<string | null>(null);
  const [reorderEdit, setReorderEdit]       = useState("");
  const [reorderSaving, setReorderSaving]   = useState(false);

  // CSV import state
  const importFileRef  = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport]           = useState(false);
  const [importFile, setImportFile]           = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview]     = useState<InvCsvPreview | null>(null);
  const [importApplying, setImportApplying]   = useState(false);
  const [importResult, setImportResult]       = useState<InvCsvResult | null>(null);
  const [importError, setImportError]         = useState<string | null>(null);

  // ── data loading ────────────────────────────────────────────────────────────

  async function loadInventory(nextLowOnly = lowOnly) {
    try {
      setError(null);
      const data = demo ?? { ...(await loadRegisterContext()), students: [] };
      setDemo(data);
      const params = new URLSearchParams({
        organizationId: data.organization.id,
        storeId: data.store.id
      });
      if (nextLowOnly) params.set("lowStock", "true");
      const items = await apiGet<InventoryItem[]>(`/inventory?${params}`);
      setInventory(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inventory");
    }
  }

  async function loadHistory(productId: string) {
    if (!demo) return;
    setHistoryLoading(true);
    setHistory([]);
    try {
      const params = new URLSearchParams({
        organizationId: demo.organization.id,
        storeId: demo.store.id
      });
      const rows = await apiGet<InventoryMovement[]>(`/inventory/${productId}/history?${params}`);
      setHistory(rows);
    } catch {
      // history is non-critical — fail silently
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void loadInventory(); }, []);

  // when selection changes, load history and reset adjust form
  useEffect(() => {
    if (!selectedId) return;
    const item = inventory.find(i => i.productId === selectedId);
    if (item) {
      setReorderEdit(String(toNum(item.reorderThreshold)));
      setAdjustInput("");
      setAdjustMsg(null);
    }
    void loadHistory(selectedId);
  }, [selectedId]);

  // ── derived data ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? inventory.filter(i =>
          [i.name, i.sku ?? "", i.location ?? ""].some(v => v.toLowerCase().includes(q))
        )
      : inventory;
    return [...base].sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)
    );
  }, [inventory, search]);

  const grouped = useMemo(() => ({
    out:         filtered.filter(i => i.status === "out"),
    low:         filtered.filter(i => i.status === "low"),
    in_stock:    filtered.filter(i => i.status === "in_stock"),
    not_tracked: filtered.filter(i => i.status === "not_tracked"),
  }), [filtered]);

  const selected = inventory.find(i => i.productId === selectedId) ?? null;

  const totalItems  = inventory.length;
  const inStockCount = inventory.filter(i => i.status === "in_stock").length;
  const lowCount     = inventory.filter(i => i.status === "low").length;
  const outCount     = inventory.filter(i => i.status === "out").length;

  // ── actions ─────────────────────────────────────────────────────────────────

  async function applyAdjust(delta: number) {
    if (!demo || !selected) return;
    const parsed = Number.isInteger(delta) ? delta : Number.parseInt(adjustInput, 10);
    if (!Number.isInteger(parsed) || parsed === 0) {
      setAdjustMsg("Enter a whole number that is not zero.");
      return;
    }
    setAdjustSaving(true);
    setAdjustMsg(null);
    try {
      await apiPost(`/inventory/${selected.productId}/adjustments`, {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        quantityDelta: parsed,
        note: adjustNote.trim() || "Inventory adjustment"
      });
      setAdjustInput("");
      setAdjustMsg(`Stock ${parsed > 0 ? "increased" : "decreased"} by ${Math.abs(parsed)}.`);
      await loadInventory(lowOnly);
      await loadHistory(selected.productId);
    } catch (err) {
      setAdjustMsg(err instanceof Error ? err.message : "Could not save adjustment");
    } finally {
      setAdjustSaving(false);
    }
  }

  async function saveReorderThreshold() {
    if (!demo || !selected) return;
    const val = Number.parseInt(reorderEdit, 10);
    if (!Number.isInteger(val) || val < 0) return;
    setReorderSaving(true);
    try {
      await apiPatch(`/inventory/${selected.productId}/settings`, {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        reorderThreshold: val
      });
      await loadInventory(lowOnly);
    } catch {
      // non-critical
    } finally {
      setReorderSaving(false);
    }
  }

  // ── CSV import ───────────────────────────────────────────────────────────────

  function downloadTemplate() {
    const csv = `sku,quantity,reorder_threshold,store_name\nLUNCH-01,50,10,Main Store\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "inventory-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    if (!demo) return;
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("organizationId", demo.organization.id);
      const res  = await fetch("/api/v1/inventory/import/preview", { method: "POST", credentials: "include", body: fd });
      const json = await res.json() as { data?: InvCsvPreview; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setImportPreview(json.data!);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setImportPreviewing(false);
    }
  }

  async function applyImport() {
    if (!demo || !importFile) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("organizationId", demo.organization.id);
      if (demo.store?.id) fd.append("storeId", demo.store.id);
      const res  = await fetch("/api/v1/inventory/import/apply", { method: "POST", credentials: "include", body: fd });
      const json = await res.json() as { data?: InvCsvResult; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setImportResult(json.data!);
      void loadInventory(lowOnly);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportApplying(false);
    }
  }

  function closeImport() {
    setShowImport(false);
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const eyebrow = demo?.store?.name ?? demo?.organization?.name ?? "Inventory";

  return (
    <section className="module">
      <PageHeader eyebrow={eyebrow} title="Stock Management">
        <button type="button" onClick={() => loadInventory()}>Refresh</button>
        <button type="button" onClick={() => setShowImport(true)}>{t("common.importCsv")}</button>
        <Link className="buttonLink primary" href="/inventory/receiving">+ Receive stock</Link>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      {/* ── Metric tiles ── */}
      <div className="metricGrid" style={{ marginBottom: 16 }}>
        <div className="metricTile">
          <span>Total SKUs</span>
          <strong>{totalItems}</strong>
          <small>Products tracked</small>
        </div>
        <div className="metricTile">
          <span>In Stock</span>
          <strong style={{ color: "#16a34a" }}>{inStockCount}</strong>
          <small>Above reorder level</small>
        </div>
        <div className="metricTile metricTile--warning">
          <span>Low Stock</span>
          <strong>{lowCount}</strong>
          <small>Below reorder level</small>
        </div>
        <div className="metricTile metricTile--danger">
          <span>Out of Stock</span>
          <strong>{outCount}</strong>
          <small>Zero units</small>
        </div>
      </div>

      {/* ── Search + filter bar ── */}
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input
          placeholder="Search product, SKU, location…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={lowOnly ? "active" : ""}
          onClick={() => { const next = !lowOnly; setLowOnly(next); void loadInventory(next); }}
        >
          Low stock only
        </button>
      </div>

      {/* ── Two-panel body ── */}
      <div style={{
        display: "flex",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        overflow: "hidden",
        minHeight: 480,
        marginTop: 12,
        background: "white"
      }}>

        {/* Left — inventory list */}
        <div style={{ flex: 1, overflowY: "auto", borderRight: "1px solid #e2e8f0" }}>
          {filtered.length === 0 ? (
            <p style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
              No items match your filter.
            </p>
          ) : (
            <>
              {grouped.out.length > 0 && (
                <>
                  <SectionDivider label="Out of stock" count={grouped.out.length} />
                  {grouped.out.map(item => (
                    <InventoryRow key={item.productId} item={item}
                      selected={selectedId === item.productId}
                      onClick={() => setSelectedId(item.productId)} />
                  ))}
                </>
              )}
              {grouped.low.length > 0 && (
                <>
                  <SectionDivider label="Low stock" count={grouped.low.length} />
                  {grouped.low.map(item => (
                    <InventoryRow key={item.productId} item={item}
                      selected={selectedId === item.productId}
                      onClick={() => setSelectedId(item.productId)} />
                  ))}
                </>
              )}
              {grouped.in_stock.length > 0 && (
                <>
                  <SectionDivider label="In stock" count={grouped.in_stock.length} />
                  {grouped.in_stock.map(item => (
                    <InventoryRow key={item.productId} item={item}
                      selected={selectedId === item.productId}
                      onClick={() => setSelectedId(item.productId)} />
                  ))}
                </>
              )}
              {grouped.not_tracked.length > 0 && (
                <>
                  <SectionDivider label="Not tracked" count={grouped.not_tracked.length} />
                  {grouped.not_tracked.map(item => (
                    <InventoryRow key={item.productId} item={item}
                      selected={selectedId === item.productId}
                      onClick={() => setSelectedId(item.productId)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Right — detail panel */}
        {selected ? (
          <DetailPanel
            item={selected}
            history={history}
            historyLoading={historyLoading}
            adjustInput={adjustInput}
            setAdjustInput={setAdjustInput}
            adjustNote={adjustNote}
            setAdjustNote={setAdjustNote}
            adjustSaving={adjustSaving}
            adjustMsg={adjustMsg}
            onAdjust={applyAdjust}
            reorderEdit={reorderEdit}
            setReorderEdit={setReorderEdit}
            reorderSaving={reorderSaving}
            onSaveReorder={saveReorderThreshold}
          />
        ) : (
          <div style={{
            width: 320, flexShrink: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            color: "#94a3b8", fontSize: "0.85rem", padding: 32,
            background: "#f8fafc", textAlign: "center"
          }}>
            Select a product to<br />view details and adjust stock
          </div>
        )}
      </div>

      {/* ── CSV Import overlay ── */}
      {showImport && (
        <CsvImportPanel
          importFile={importFile}
          importFileRef={importFileRef}
          importPreviewing={importPreviewing}
          importPreview={importPreview}
          importApplying={importApplying}
          importResult={importResult}
          importError={importError}
          onFileSelected={handleImportFile}
          onApply={applyImport}
          onClose={closeImport}
          onDownloadTemplate={downloadTemplate}
        />
      )}
    </section>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  item, history, historyLoading,
  adjustInput, setAdjustInput,
  adjustNote, setAdjustNote,
  adjustSaving, adjustMsg, onAdjust,
  reorderEdit, setReorderEdit,
  reorderSaving, onSaveReorder
}: {
  item: InventoryItem;
  history: InventoryMovement[];
  historyLoading: boolean;
  adjustInput: string;
  setAdjustInput: (v: string) => void;
  adjustNote: string;
  setAdjustNote: (v: string) => void;
  adjustSaving: boolean;
  adjustMsg: string | null;
  onAdjust: (delta: number) => void;
  reorderEdit: string;
  setReorderEdit: (v: string) => void;
  reorderSaving: boolean;
  onSaveReorder: () => void;
}) {
  const qty       = toNum(item.quantityOnHand);
  const threshold = toNum(item.reorderThreshold);
  const price     = toNum(item.priceCents);
  const cost      = toNum(item.costCents ?? null);
  const margin    = cost > 0 && price > 0
    ? Math.round(((price - cost) / price) * 1000) / 10
    : null;
  const sc        = STATUS_COLOR[item.status] ?? STATUS_COLOR.not_tracked;

  const labelStyle: React.CSSProperties = {
    fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
    color: "#94a3b8", textTransform: "uppercase", marginBottom: 2
  };
  const valStyle: React.CSSProperties = {
    fontSize: "0.875rem", fontWeight: 600, color: "#0f172a"
  };

  function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
      <div style={{
        background: "white", border: "1px solid #e2e8f0",
        borderRadius: 8, padding: 14, ...style
      }}>
        {children}
      </div>
    );
  }

  return (
    <div style={{
      width: 320, flexShrink: 0, overflowY: "auto",
      background: "#f8fafc", padding: 14,
      display: "flex", flexDirection: "column", gap: 12
    }}>

      {/* Header card */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a", marginBottom: 2 }}>
          {item.name}
        </div>
        <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
          {item.sku ? `SKU: ${item.sku}` : "No SKU"}
        </div>
        <div style={{
          marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
          background: sc.bg, borderRadius: 20, padding: "3px 10px"
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc.dot }} />
          <span style={{ fontSize: "0.7rem", fontWeight: 600, color: sc.dot }}>{sc.label}</span>
        </div>
      </Card>

      {/* Stock stats */}
      <Card>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
          color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>
          Stock levels
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 0" }}>
          <div>
            <div style={labelStyle}>On hand</div>
            <div style={{ ...valStyle, fontSize: "1.4rem", color: sc.dot }}>{qty}</div>
          </div>
          <div>
            <div style={labelStyle}>Reorder at</div>
            <div style={{ ...valStyle, fontSize: "1.4rem" }}>{threshold}</div>
          </div>
          <div>
            <div style={labelStyle}>Location</div>
            <div style={valStyle}>{item.location ?? "—"}</div>
          </div>
          <div>
            <div style={labelStyle}>Last updated</div>
            <div style={valStyle}>{formatRelative(item.updatedAt)}</div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <StockBar qty={qty} threshold={threshold} />
        </div>
      </Card>

      {/* Quick adjust */}
      <Card>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
          color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>
          Adjust stock
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {[-10, -1].map(d => (
            <button key={d} type="button" disabled={adjustSaving}
              onClick={() => onAdjust(d)}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 6, border: "1px solid #fca5a5",
                background: "#fef2f2", color: "#dc2626", fontWeight: 700,
                cursor: "pointer", fontSize: "0.85rem"
              }}>
              {d}
            </button>
          ))}
          <input
            type="number"
            value={adjustInput}
            onChange={e => setAdjustInput(e.target.value)}
            placeholder="qty"
            onKeyDown={e => { if (e.key === "Enter") onAdjust(Number.parseInt(adjustInput, 10)); }}
            style={{
              width: 64, padding: "6px 8px", border: "1px solid #d1d5db",
              borderRadius: 6, textAlign: "center", fontSize: "0.875rem"
            }}
          />
          {[1, 10].map(d => (
            <button key={d} type="button" disabled={adjustSaving}
              onClick={() => onAdjust(d)}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 6, border: "1px solid #86efac",
                background: "#f0fdf4", color: "#16a34a", fontWeight: 700,
                cursor: "pointer", fontSize: "0.85rem"
              }}>
              +{d}
            </button>
          ))}
        </div>
        <input
          value={adjustNote}
          onChange={e => setAdjustNote(e.target.value)}
          placeholder="Note (optional)"
          style={{
            width: "100%", padding: "6px 10px", border: "1px solid #d1d5db",
            borderRadius: 6, fontSize: "0.8rem", boxSizing: "border-box", marginBottom: 8
          }}
        />
        <button
          type="button"
          disabled={adjustSaving || !adjustInput}
          onClick={() => onAdjust(Number.parseInt(adjustInput, 10))}
          style={{
            width: "100%", padding: "8px 0", borderRadius: 6,
            background: adjustSaving || !adjustInput ? "#e2e8f0" : "#0f172a",
            color: adjustSaving || !adjustInput ? "#94a3b8" : "white",
            border: "none", fontWeight: 600, cursor: adjustInput ? "pointer" : "default",
            fontSize: "0.85rem"
          }}
        >
          {adjustSaving ? "Saving…" : "Save adjustment"}
        </button>
        {adjustMsg && (
          <p style={{ marginTop: 6, fontSize: "0.75rem",
            color: adjustMsg.includes("Could not") ? "#dc2626" : "#16a34a" }}>
            {adjustMsg}
          </p>
        )}
      </Card>

      {/* Reorder threshold */}
      <Card>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
          color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>
          Reorder threshold
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            min={0}
            value={reorderEdit}
            onChange={e => setReorderEdit(e.target.value)}
            style={{
              flex: 1, padding: "6px 10px", border: "1px solid #d1d5db",
              borderRadius: 6, fontSize: "0.875rem"
            }}
          />
          <button
            type="button"
            disabled={reorderSaving}
            onClick={onSaveReorder}
            style={{
              padding: "6px 14px", borderRadius: 6,
              background: "#0f172a", color: "white",
              border: "none", fontWeight: 600, cursor: "pointer", fontSize: "0.8rem"
            }}
          >
            {reorderSaving ? "…" : "Save"}
          </button>
        </div>
        <p style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 6, marginBottom: 0 }}>
          Alert triggers when stock falls to or below this number.
        </p>
      </Card>

      {/* Price / cost / margin */}
      <Card>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
          color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>
          Financials
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={labelStyle}>Sale price</div>
            <div style={valStyle}>{formatMoney(price)}</div>
          </div>
          {cost > 0 && (
            <>
              <div>
                <div style={labelStyle}>Unit cost</div>
                <div style={valStyle}>{formatMoney(cost)}</div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={labelStyle}>Gross margin</div>
                <div style={{ ...valStyle, color: margin && margin > 0 ? "#16a34a" : "#dc2626" }}>
                  {margin !== null ? `${margin}%` : "—"}
                </div>
              </div>
            </>
          )}
          {(!cost || cost === 0) && (
            <div>
              <div style={labelStyle}>Unit cost</div>
              <div style={{ ...valStyle, color: "#94a3b8" }}>Not set</div>
            </div>
          )}
        </div>
      </Card>

      {/* Movement history */}
      <Card>
        <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
          color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>
          Recent movements
        </div>
        {historyLoading ? (
          <p style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Loading…</p>
        ) : history.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "#94a3b8" }}>No movements recorded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.slice(0, 8).map(m => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>
                    {movementLabel(m.type)}
                    {m.note ? <span style={{ fontWeight: 400, color: "#9ca3af" }}> · {m.note}</span> : null}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                    {formatRelative(m.createdAt)}
                    {m.createdBy ? ` · ${m.createdBy}` : ""}
                  </div>
                </div>
                <div style={{
                  fontWeight: 700, fontSize: "0.85rem", flexShrink: 0,
                  color: m.quantityDelta > 0 ? "#16a34a" : "#dc2626"
                }}>
                  {m.quantityDelta > 0 ? "+" : ""}{m.quantityDelta}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── CSV Import Panel ──────────────────────────────────────────────────────────

function CsvImportPanel({
  importFile, importFileRef, importPreviewing, importPreview,
  importApplying, importResult, importError,
  onFileSelected, onApply, onClose, onDownloadTemplate
}: {
  importFile: File | null;
  importFileRef: React.RefObject<HTMLInputElement | null>;
  importPreviewing: boolean;
  importPreview: InvCsvPreview | null;
  importApplying: boolean;
  importResult: InvCsvResult | null;
  importError: string | null;
  onFileSelected: (f: File) => void;
  onApply: () => void;
  onClose: () => void;
  onDownloadTemplate: () => void;
}) {
  return (
    <div className="importOverlay">
      <div className="importPanel">
        <div className="importPanelHeader">
          <strong>Import inventory from CSV</strong>
          <button type="button" className="importPanelClose" onClick={onClose}>✕</button>
        </div>

        {!importResult ? (
          <>
            <div className="importInstructions">
              <p>Required: <code>sku</code>, <code>quantity</code>. Optional: <code>reorder_threshold</code>, <code>store_name</code>.</p>
              <button type="button" className="importTemplateBtn" onClick={onDownloadTemplate}>
                <span className="material-symbols-outlined">download</span>
                Download template
              </button>
            </div>

            <div
              className="importDropZone"
              onClick={() => importFileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFileSelected(f); }}
            >
              <span className="material-symbols-outlined">upload_file</span>
              {importFile ? <span>{importFile.name}</span> : <span>Drop a CSV file here or click to browse</span>}
            </div>

            <input ref={importFileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.target.value = ""; }} />

            {importPreviewing && <p className="importHint">Parsing…</p>}
            {importError    && <p className="demoError">{importError}</p>}

            {importPreview && (
              <>
                <div className="importSummaryBar">
                  <span className="importSummaryItem importSummaryItem--ok">
                    {importPreview.preview.filter(r => r.status === "set").length} to set
                  </span>
                  {importPreview.preview.filter(r => r.status === "skip").length > 0 && (
                    <span className="importSummaryItem importSummaryItem--skip">
                      {importPreview.preview.filter(r => r.status === "skip").length} skipped
                    </span>
                  )}
                  {importPreview.errors.length > 0 && (
                    <span className="importSummaryItem importSummaryItem--err">
                      {importPreview.errors.length} errors
                    </span>
                  )}
                </div>
                {importPreview.errors.length > 0 && (
                  <div className="importErrorList">
                    {importPreview.errors.map(e => (
                      <p key={e.row} className="importErrorRow">Row {e.row}: {e.error}</p>
                    ))}
                  </div>
                )}
                <div className="importTableWrap">
                  <table className="importTable">
                    <thead>
                      <tr>
                        <th>SKU</th><th>Product</th><th>Qty</th><th>Reorder</th><th>Store</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.preview.map(row => (
                        <tr key={row.row} className={row.status === "skip" ? "importRowSkip" : ""}>
                          <td>{row.sku ?? "—"}</td>
                          <td>{row.productName ?? "—"}</td>
                          <td>{row.quantity ?? "—"}</td>
                          <td>{row.reorderThreshold ?? "—"}</td>
                          <td>{row.storeName ?? "—"}</td>
                          <td>
                            <span className={`importStatusBadge importStatusBadge--${row.status === "set" ? "create" : "skip"}`}>
                              {row.status === "skip" ? "Skip" : "Set"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="importActions">
                  <button type="button" className="btnPrimary" onClick={onApply}
                    disabled={importApplying || importPreview.preview.filter(r => r.status === "set").length === 0}>
                    {importApplying
                      ? "Importing…"
                      : `Import ${importPreview.preview.filter(r => r.status === "set").length} items`}
                  </button>
                  <button type="button" onClick={onClose}>Cancel</button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="importResultPanel">
            <span className="material-symbols-outlined importResultIcon">check_circle</span>
            <h3>Import complete</h3>
            {importResult.updated > 0 && <p><strong>{importResult.updated}</strong> items updated</p>}
            {importResult.skipped > 0  && <p>{importResult.skipped} skipped (no SKU match)</p>}
            {importResult.errors.length > 0 && (
              <div className="importErrorList">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="importErrorRow">Row {e.row}: {e.error}</p>
                ))}
              </div>
            )}
            <button type="button" className="btnPrimary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
