"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { PageHeader } from "../../components/PageHeader";
import { DataTable } from "../../components/DataTable";
import { apiGet, apiPost } from "../../lib/api";
import type {
  AIDraft,
  AIDraftLine,
  AICorrection,
  InventoryInvoice,
  InventoryTransfer,
  Product,
  Store,
  Supplier,
} from "../../lib/demoTypes";
import { formatMoney } from "../../lib/format";
import { loadRegisterContext } from "../../lib/organizationContext";

// ── helpers ───────────────────────────────────────────────────────────────────

function toCents(value: string) {
  const n = Number.parseFloat(value || "0");
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function confidenceBadge(c: number) {
  if (c >= 0.9) return { label: `${Math.round(c * 100)}%`, color: "#22c55e" };
  if (c >= 0.7) return { label: `${Math.round(c * 100)}%`, color: "#f59e0b" };
  return { label: `${Math.round(c * 100)}%`, color: "#ef4444" };
}

type Tab = "upload" | "manual" | "transfers" | "corrections";

// ── editable draft line (local state during review) ───────────────────────────

type EditLine = AIDraftLine & {
  _skip: boolean;
};

// ── component ─────────────────────────────────────────────────────────────────

export function ReceivingClient() {
  // org context
  const [orgId, setOrgId] = useState<string | null>(null);
  const [defaultStoreId, setDefaultStoreId] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // history lists
  const [invoices, setInvoices] = useState<InventoryInvoice[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [aiDrafts, setAIDrafts] = useState<AIDraft[]>([]);
  const [corrections, setCorrections] = useState<AICorrection[]>([]);

  // corrections tab state
  const [corrNewText, setCorrNewText] = useState("");
  const [corrNewProductId, setCorrNewProductId] = useState("");
  const [corrFilter, setCorrFilter] = useState("");

  // ui state
  const [tab, setTab] = useState<Tab>("upload");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── AI upload state ───────────────────────────────────────────────────────
  type UploadPhase = "idle" | "uploading" | "reviewing" | "approving" | "done";
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [uploadStoreId, setUploadStoreId] = useState("");
  const [uploadSupplierId, setUploadSupplierId] = useState("");
  const [currentDraft, setCurrentDraft] = useState<AIDraft | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [updateCost, setUpdateCost] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── manual entry state ────────────────────────────────────────────────────
  const [manualStoreId, setManualStoreId] = useState("");
  const [manualSupplierId, setManualSupplierId] = useState("");
  const [manualInvoiceNo, setManualInvoiceNo] = useState("");
  const [manualProductId, setManualProductId] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const [manualCost, setManualCost] = useState("0.00");

  // ── transfer state ────────────────────────────────────────────────────────
  const [xferProductId, setXferProductId] = useState("");
  const [xferToStoreId, setXferToStoreId] = useState("");
  const [xferQty, setXferQty] = useState("1");
  const [xferNote, setXferNote] = useState("");

  // supplier creation
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");

  // ── data loading ──────────────────────────────────────────────────────────

  const loadHistory = useCallback(async (oid: string) => {
    const [nextInvoices, nextTransfers, nextDrafts, nextCorrections] = await Promise.all([
      apiGet<InventoryInvoice[]>(`/inventory/invoices?organizationId=${oid}`),
      apiGet<InventoryTransfer[]>(`/inventory/transfers?organizationId=${oid}`),
      apiGet<AIDraft[]>(`/inventory/ai/drafts?organizationId=${oid}`),
      apiGet<AICorrection[]>(`/inventory/ai/corrections?organizationId=${oid}`),
    ]);
    setInvoices(nextInvoices);
    setTransfers(nextTransfers);
    setAIDrafts(nextDrafts);
    setCorrections(nextCorrections);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const ctx = await loadRegisterContext();
        const oid = ctx.organization.id;
        setOrgId(oid);
        setDefaultStoreId(ctx.store.id);
        setUploadStoreId(ctx.store.id);
        setManualStoreId(ctx.store.id);

        const [nextStores, nextProducts, nextSuppliers] = await Promise.all([
          apiGet<Store[]>(`/stores?organizationId=${oid}`),
          apiGet<Product[]>(`/products?organizationId=${oid}`),
          apiGet<Supplier[]>(`/inventory/suppliers?organizationId=${oid}`),
        ]);
        setStores(nextStores);
        setProducts(nextProducts);
        setSuppliers(nextSuppliers);
        if (nextProducts[0]) { setManualProductId(nextProducts[0].id); setXferProductId(nextProducts[0].id); }
        const otherStore = nextStores.find((s) => s.id !== ctx.store.id);
        if (otherStore) setXferToStoreId(otherStore.id);

        await loadHistory(oid);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load receiving data");
      }
    })();
  }, [loadHistory]);

  // ── file handling ─────────────────────────────────────────────────────────

  async function processFile(file: File) {
    if (!orgId) return;
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setError("Only image files (JPG, PNG, WEBP) or text-based PDFs are accepted.");
      return;
    }

    setError(null);
    setSuccess(null);
    setUploadPhase("uploading");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("organizationId", orgId);
      if (uploadStoreId) form.append("storeId", uploadStoreId);
      if (uploadSupplierId) form.append("supplierId", uploadSupplierId);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100"}/v1/inventory/ai/extract`, {
        method: "POST",
        credentials: "include",
        body: form,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${response.status})`);
      }

      const json = await response.json() as { data: AIDraft };
      const draft = json.data;
      setCurrentDraft(draft);
      setEditLines(
        (draft.lines as AIDraftLine[]).map((l) => ({ ...l, _skip: l.match_status === "skipped" }))
      );
      setUploadPhase("reviewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      setUploadPhase("idle");
    }
  }

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  // ── edit lines ────────────────────────────────────────────────────────────

  function updateLine(idx: number, patch: Partial<EditLine>) {
    setEditLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function setLineProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    updateLine(idx, {
      product_id:   productId,
      product_name: product.name,
      sku:          product.sku,
      match_status: "manual",
    });
  }

  // ── approve draft ─────────────────────────────────────────────────────────

  async function approveDraft() {
    if (!currentDraft || !orgId) return;
    setUploadPhase("approving");
    setError(null);

    try {
      const lines = editLines.map((l) => ({
        raw_text:        l.raw_text,
        product_id:      l._skip ? null : l.product_id,
        product_name:    l.product_name,
        sku:             l.sku,
        quantity:        l.quantity,
        unit_cost_cents: l.unit_cost_cents,
        match_status:    l._skip ? "skipped" : l.match_status,
        confidence:      l.confidence,
      }));

      const result = await apiPost<{ invoiceId: string }>(`/inventory/ai/drafts/${currentDraft.id}/approve`, {
        organizationId:   orgId,
        storeId:          uploadStoreId || defaultStoreId,
        supplierId:       uploadSupplierId || null,
        updateProductCost: updateCost,
        lines,
      });

      setSuccess(`Stock updated. Invoice ID: ${result.invoiceId.slice(0, 8)}`);
      setUploadPhase("done");
      setCurrentDraft(null);
      await loadHistory(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
      setUploadPhase("reviewing");
    }
  }

  async function rejectDraft() {
    if (!currentDraft || !orgId) return;
    try {
      await apiPost(`/inventory/ai/drafts/${currentDraft.id}/reject`, { organizationId: orgId });
      setCurrentDraft(null);
      setEditLines([]);
      setUploadPhase("idle");
      await loadHistory(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject draft");
    }
  }

  function resetUpload() {
    setCurrentDraft(null);
    setEditLines([]);
    setUploadPhase("idle");
    setError(null);
    setSuccess(null);
  }

  // ── manual invoice ────────────────────────────────────────────────────────

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !manualProductId) return;
    const product = products.find((p) => p.id === manualProductId);
    if (!product) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiPost<{ invoice: InventoryInvoice }>("/inventory/invoices", {
        organizationId: orgId,
        storeId:        manualStoreId || defaultStoreId,
        supplierId:     manualSupplierId || null,
        invoiceNumber:  manualInvoiceNo || null,
        invoiceDate:    today(),
        receivedDate:   today(),
        taxCents:       0,
        source:         "manual",
        lines: [{
          productId:      product.id,
          productName:    product.name,
          sku:            product.sku,
          quantity:       Math.max(1, parseInt(manualQty, 10) || 1),
          unitCostCents:  toCents(manualCost),
          matchStatus:    "matched",
        }],
      });
      setSuccess(`Invoice ${result.invoice.invoiceNumber || result.invoice.id.slice(0, 8)} created — approve below to update stock.`);
      await loadHistory(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invoice");
    } finally {
      setBusy(false);
    }
  }

  // ── approve manual invoice ────────────────────────────────────────────────

  async function approveInvoice(invoiceId: string) {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/inventory/invoices/${invoiceId}/approve`, { organizationId: orgId });
      setSuccess("Invoice approved — inventory updated.");
      await loadHistory(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  // ── transfer ──────────────────────────────────────────────────────────────

  async function submitTransfer(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !xferProductId || !xferToStoreId || !defaultStoreId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/inventory/transfers", {
        organizationId: orgId,
        fromStoreId:    defaultStoreId,
        toStoreId:      xferToStoreId,
        productId:      xferProductId,
        quantity:       Math.max(1, parseInt(xferQty, 10) || 1),
        note:           xferNote || null,
      });
      setSuccess("Transfer completed — movement history updated for both locations.");
      await loadHistory(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  // ── supplier quick-create ─────────────────────────────────────────────────

  async function saveSupplier(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !newSupplierName.trim()) return;
    setBusy(true);
    try {
      const sup = await apiPost<Supplier>("/inventory/suppliers", {
        organizationId: orgId,
        name:           newSupplierName.trim(),
      });
      setSuppliers((prev) => [...prev, sup]);
      setUploadSupplierId(sup.id);
      setManualSupplierId(sup.id);
      setNewSupplierName("");
      setShowNewSupplier(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier");
    } finally {
      setBusy(false);
    }
  }

  // ── corrections ───────────────────────────────────────────────────────────

  async function deleteCorrection(id: string) {
    if (!orgId) return;
    if (!confirm("Remove this learned mapping? The AI will no longer use it.")) return;
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100"}/v1/inventory/ai/corrections/${id}?organizationId=${orgId}`,
        { method: "DELETE", credentials: "include" }
      );
      setCorrections((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete correction");
    }
  }

  async function addCorrection(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !corrNewText.trim() || !corrNewProductId) return;
    setBusy(true);
    setError(null);
    try {
      const added = await apiPost<AICorrection>("/inventory/ai/corrections", {
        organizationId: orgId,
        extractedText:  corrNewText.trim(),
        productId:      corrNewProductId,
      });
      setCorrections((prev) => [added, ...prev]);
      setCorrNewText("");
      setCorrNewProductId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add mapping");
    } finally {
      setBusy(false);
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const pendingInvoices = useMemo(() => invoices.filter((i) => i.status === "pending"), [invoices]);
  const approvedInvoices = useMemo(() => invoices.filter((i) => i.status !== "pending"), [invoices]);
  const activeLines = useMemo(() => editLines.filter((l) => !l._skip), [editLines]);
  const totalCents = useMemo(() => activeLines.reduce((s, l) => s + l.quantity * l.unit_cost_cents, 0), [activeLines]);
  const unmatchedCount = useMemo(() => activeLines.filter((l) => l.match_status === "unmatched" && !l.product_id).length, [activeLines]);
  const filteredCorrections = useMemo(() => {
    if (!corrFilter.trim()) return corrections;
    const f = corrFilter.toLowerCase();
    return corrections.filter(
      (c) => c.extractedText.includes(f) || c.productName.toLowerCase().includes(f)
    );
  }, [corrections, corrFilter]);

  const transferSources = stores.filter((s) => s.id !== xferToStoreId);

  // ── render ────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: "upload", label: "Upload Invoice (AI)" },
    { key: "manual", label: "Manual Entry" },
    { key: "transfers", label: "Transfers" },
    { key: "corrections", label: `AI Learning${corrections.length > 0 ? ` (${corrections.length})` : ""}` },
  ];

  return (
    <section className="module">
      <PageHeader eyebrow="Inventory" title="Receive Stock">
        <a href="/inventory" className="btnSecondary">← Back to Inventory</a>
      </PageHeader>

      {error  ? <p className="demoError">{error}</p> : null}
      {success ? <p className="buttonHelp success">{success}</p> : null}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "1px solid #e2e8f0" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setError(null); setSuccess(null); }}
            style={{
              padding: "8px 16px",
              fontWeight: tab === t.key ? 600 : 400,
              background: "none",
              border: "none",
              borderBottom: tab === t.key ? "2px solid #3b82f6" : "2px solid transparent",
              cursor: "pointer",
              color: tab === t.key ? "#1e40af" : "#64748b",
              fontSize: 14,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── UPLOAD TAB ─────────────────────────────────────────────────────── */}
      {tab === "upload" && (
        <div>
          {uploadPhase === "idle" || uploadPhase === "done" ? (
            <div style={{ maxWidth: 600 }}>
              {uploadPhase === "done" && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, padding: 16, background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac" }}>
                  <span style={{ fontSize: 20 }}>✓</span>
                  <div>
                    <strong style={{ color: "#166534" }}>Stock updated successfully</strong>
                    <p style={{ margin: 0, color: "#166534", fontSize: 13 }}>{success}</p>
                  </div>
                  <button type="button" onClick={resetUpload} style={{ marginLeft: "auto" }} className="btnSecondary">Upload another</button>
                </div>
              )}

              <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>
                  Store
                  <select value={uploadStoreId} onChange={(e) => setUploadStoreId(e.target.value)} style={{ marginLeft: 8 }}>
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, fontWeight: 500 }}>
                  Supplier
                  <select value={uploadSupplierId} onChange={(e) => setUploadSupplierId(e.target.value)} style={{ marginLeft: 8 }}>
                    <option value="">None / Unknown</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewSupplier(!showNewSupplier)} style={{ marginLeft: 8, fontSize: 12 }} className="btnSecondary">+ New</button>
                </label>
                {showNewSupplier && (
                  <form onSubmit={saveSupplier} style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <input placeholder="Supplier name" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} style={{ flex: 1 }} />
                    <button type="submit" disabled={busy || !newSupplierName.trim()}>Save</button>
                  </form>
                )}
              </div>

              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                style={{
                  border: `2px dashed ${dragOver ? "#3b82f6" : "#cbd5e1"}`,
                  borderRadius: 12,
                  padding: 48,
                  textAlign: "center",
                  cursor: "pointer",
                  background: dragOver ? "#eff6ff" : "#f8fafc",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                <strong style={{ fontSize: 15 }}>Drop your invoice here or click to browse</strong>
                <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 13 }}>
                  JPG · PNG · WEBP · PDF (text-based) · Max 20 MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: "none" }}
                  onChange={onFileInputChange}
                />
              </div>
            </div>
          ) : uploadPhase === "uploading" ? (
            <div style={{ padding: 64, textAlign: "center", color: "#64748b" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
              <strong style={{ display: "block", marginBottom: 6 }}>Extracting line items…</strong>
              <small>Claude is reading your invoice. This takes 5–15 seconds.</small>
            </div>
          ) : uploadPhase === "approving" ? (
            <div style={{ padding: 64, textAlign: "center", color: "#64748b" }}>
              <strong>Updating inventory…</strong>
            </div>
          ) : /* reviewing */ currentDraft ? (
            <div>
              {/* Header strip */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Overall confidence</span>
                  <span style={{ marginLeft: 8, fontWeight: 700, color: currentDraft.overallConfidence >= 0.9 ? "#166534" : currentDraft.overallConfidence >= 0.7 ? "#92400e" : "#991b1b" }}>
                    {Math.round(currentDraft.overallConfidence * 100)}%
                  </span>
                </div>
                {currentDraft.extractedMeta?.supplierName && (
                  <div><span style={{ fontSize: 12, color: "#64748b" }}>Supplier on doc:</span> <strong style={{ marginLeft: 6 }}>{currentDraft.extractedMeta.supplierName}</strong></div>
                )}
                {currentDraft.extractedMeta?.invoiceNumber && (
                  <div><span style={{ fontSize: 12, color: "#64748b" }}>Invoice #:</span> <strong style={{ marginLeft: 6 }}>{currentDraft.extractedMeta.invoiceNumber}</strong></div>
                )}
                {currentDraft.extractedMeta?.invoiceDate && (
                  <div><span style={{ fontSize: 12, color: "#64748b" }}>Date:</span> <strong style={{ marginLeft: 6 }}>{currentDraft.extractedMeta.invoiceDate}</strong></div>
                )}
                <div style={{ marginLeft: "auto", color: "#64748b", fontSize: 13 }}>
                  {activeLines.length} line{activeLines.length !== 1 ? "s" : ""} · {formatMoney(totalCents)}
                </div>
              </div>

              {unmatchedCount > 0 && (
                <p style={{ padding: "10px 14px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#92400e" }}>
                  ⚠️ {unmatchedCount} line{unmatchedCount !== 1 ? "s" : ""} could not be matched to a product. Select a product below or skip those lines.
                </p>
              )}

              {/* Lines table */}
              <div style={{ overflowX: "auto", marginBottom: 20 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                      <th style={thStyle}>Skip</th>
                      <th style={thStyle}>Extracted Text</th>
                      <th style={thStyle}>Product</th>
                      <th style={thStyle}>Qty</th>
                      <th style={thStyle}>Unit Cost</th>
                      <th style={thStyle}>Line Total</th>
                      <th style={thStyle}>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editLines.map((line, idx) => {
                      const badge = confidenceBadge(line.confidence);
                      const lineTotal = line.quantity * line.unit_cost_cents;
                      return (
                        <tr key={idx} style={{ opacity: line._skip ? 0.4 : 1, borderBottom: "1px solid #e2e8f0" }}>
                          <td style={tdStyle}>
                            <input
                              type="checkbox"
                              checked={line._skip}
                              onChange={(e) => updateLine(idx, { _skip: e.target.checked })}
                              title="Skip this line"
                            />
                          </td>
                          <td style={{ ...tdStyle, maxWidth: 180, color: "#64748b", fontSize: 11 }}>
                            {line.raw_text || "—"}
                          </td>
                          <td style={tdStyle}>
                            {line.match_status === "unmatched" || !line.product_id ? (
                              <select
                                value={line.product_id || ""}
                                onChange={(e) => setLineProduct(idx, e.target.value)}
                                disabled={line._skip}
                                style={{ width: "100%", minWidth: 140 }}
                              >
                                <option value="">— pick product —</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
                                ))}
                              </select>
                            ) : (
                              <div>
                                <div style={{ fontWeight: 500 }}>{line.product_name}</div>
                                {line.sku && <div style={{ fontSize: 11, color: "#94a3b8" }}>{line.sku}</div>}
                              </div>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              min={1}
                              value={line.quantity}
                              disabled={line._skip}
                              onChange={(e) => updateLine(idx, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                              style={{ width: 60 }}
                            />
                          </td>
                          <td style={tdStyle}>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={fromCents(line.unit_cost_cents)}
                              disabled={line._skip}
                              onChange={(e) => updateLine(idx, { unit_cost_cents: toCents(e.target.value) })}
                              style={{ width: 80 }}
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {line._skip ? "—" : formatMoney(lineTotal)}
                          </td>
                          <td style={tdStyle}>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 600,
                              background: badge.color + "22",
                              color: badge.color,
                            }}>
                              {badge.label}
                            </span>
                            {line.match_status === "unmatched" && !line.product_id && (
                              <span style={{ marginLeft: 4, fontSize: 10, color: "#ef4444" }}>needs match</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 20 }}>
                <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
                Update product unit cost from this invoice
              </label>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={approveDraft}
                  disabled={unmatchedCount > 0}
                  title={unmatchedCount > 0 ? "Match or skip all unmatched lines first" : ""}
                >
                  Approve & Update Stock ({formatMoney(totalCents)})
                </button>
                <button type="button" className="btnSecondary" onClick={rejectDraft}>
                  Discard
                </button>
              </div>
            </div>
          ) : null}

          {/* Past AI drafts */}
          {aiDrafts.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <h3 style={{ marginBottom: 12 }}>Past AI Extractions</h3>
              <DataTable
                headers={["Source", "Confidence", "Lines", "Status", "Date"]}
                rows={aiDrafts.map((d) => [
                  d.source === "ai_pdf" ? "PDF" : "Image",
                  `${Math.round(d.overallConfidence * 100)}%`,
                  String(Array.isArray(d.lines) ? d.lines.length : 0),
                  d.status,
                  new Date(d.createdAt).toLocaleDateString(),
                ])}
                statusIndex={3}
              />
            </div>
          )}
        </div>
      )}

      {/* ── MANUAL ENTRY TAB ────────────────────────────────────────────────── */}
      {tab === "manual" && (
        <div style={{ maxWidth: 520 }}>
          <form onSubmit={submitManual} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={labelStyle}>
              Store
              <select value={manualStoreId} onChange={(e) => setManualStoreId(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Supplier
              <select value={manualSupplierId} onChange={(e) => setManualSupplierId(e.target.value)}>
                <option value="">None</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Invoice #
              <input placeholder="Optional" value={manualInvoiceNo} onChange={(e) => setManualInvoiceNo(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Product
              <select value={manualProductId} onChange={(e) => setManualProductId(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Quantity
              <input type="number" min={1} value={manualQty} onChange={(e) => setManualQty(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Unit cost ($)
              <input type="number" min={0} step="0.01" value={manualCost} onChange={(e) => setManualCost(e.target.value)} />
            </label>
            <button type="submit" disabled={busy || !manualProductId}>Create invoice for approval</button>
          </form>

          {/* Pending approvals */}
          {pendingInvoices.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ marginBottom: 12 }}>Awaiting Approval</h3>
              <DataTable
                headers={["Invoice #", "Supplier", "Lines", "Total", "Action"]}
                rows={pendingInvoices.map((inv) => [
                  inv.invoiceNumber || inv.id.slice(0, 8),
                  inv.supplierName || "—",
                  String(inv.lineCount),
                  formatMoney(inv.totalCents),
                  "Approve →",
                ])}
                onRowClick={(idx) => {
                  const inv = pendingInvoices[idx];
                  if (inv) void approveInvoice(inv.id);
                }}
              />
            </div>
          )}

          {approvedInvoices.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ marginBottom: 12 }}>Invoice History</h3>
              <DataTable
                headers={["Invoice #", "Source", "Total", "Status", "Date"]}
                rows={approvedInvoices.map((inv) => [
                  inv.invoiceNumber || inv.id.slice(0, 8),
                  inv.source,
                  formatMoney(inv.totalCents),
                  inv.status,
                  new Date(inv.createdAt).toLocaleDateString(),
                ])}
                statusIndex={3}
              />
            </div>
          )}
        </div>
      )}

      {/* ── TRANSFERS TAB ────────────────────────────────────────────────────── */}
      {tab === "transfers" && (
        <div style={{ maxWidth: 480 }}>
          <form onSubmit={submitTransfer} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={labelStyle}>
              Product
              <select value={xferProductId} onChange={(e) => setXferProductId(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              From
              <strong style={{ marginLeft: 8 }}>{stores.find((s) => s.id === defaultStoreId)?.name ?? "Current store"}</strong>
            </label>
            <label style={labelStyle}>
              To location
              <select value={xferToStoreId} onChange={(e) => setXferToStoreId(e.target.value)}>
                {stores.filter((s) => s.id !== defaultStoreId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Quantity
              <input type="number" min={1} value={xferQty} onChange={(e) => setXferQty(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Note (optional)
              <input value={xferNote} onChange={(e) => setXferNote(e.target.value)} placeholder="Reason for transfer" />
            </label>
            <button type="submit" disabled={busy || !xferProductId || !xferToStoreId}>Transfer stock</button>
          </form>

          {transfers.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ marginBottom: 12 }}>Transfer History</h3>
              <DataTable
                headers={["Product", "From", "To", "Qty", "Date"]}
                rows={transfers.map((t) => [
                  t.productName,
                  t.fromStoreName,
                  t.toStoreName,
                  String(t.quantity),
                  new Date(t.createdAt).toLocaleDateString(),
                ])}
              />
            </div>
          )}
        </div>
      )}

      {/* ── AI LEARNING TAB ─────────────────────────────────────────────────── */}
      {tab === "corrections" && (
        <div>
          <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20, maxWidth: 600 }}>
            Every time you approve an AI extraction, the system learns which invoice text maps to which product.
            These mappings are injected as hints on the next upload, raising confidence over time.
            Remove incorrect mappings or add new ones manually below.
          </p>

          {/* Manual add */}
          <form onSubmit={addCorrection} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 28, flexWrap: "wrap" }}>
            <label style={{ ...labelStyle, flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#64748b" }}>Invoice text (as it appears on document)</span>
              <input
                value={corrNewText}
                onChange={(e) => setCorrNewText(e.target.value)}
                placeholder="e.g. AGUA NATURAL 600ML"
                style={{ width: 260 }}
              />
            </label>
            <label style={{ ...labelStyle, flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#64748b" }}>Maps to product</span>
              <select value={corrNewProductId} onChange={(e) => setCorrNewProductId(e.target.value)} style={{ width: 220 }}>
                <option value="">— select —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy || !corrNewText.trim() || !corrNewProductId}>
              Add mapping
            </button>
          </form>

          {/* Filter */}
          {corrections.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <input
                value={corrFilter}
                onChange={(e) => setCorrFilter(e.target.value)}
                placeholder="Filter mappings…"
                style={{ width: 280 }}
              />
              <span style={{ marginLeft: 12, fontSize: 12, color: "#94a3b8" }}>
                {filteredCorrections.length} of {corrections.length} mappings
              </span>
            </div>
          )}

          {corrections.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
              <strong style={{ display: "block" }}>No learned mappings yet</strong>
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>Upload and approve your first invoice to start building the learning database.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                    <th style={thStyle}>Invoice Text (extracted)</th>
                    <th style={thStyle}>Maps to Product</th>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>Times used</th>
                    <th style={thStyle}>Confirmed by</th>
                    <th style={thStyle}>Last updated</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCorrections.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12, color: "#475569", maxWidth: 220 }}>
                        {c.extractedText}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>
                        {c.currentProductName || c.productName}
                        {c.currentProductName && c.currentProductName !== c.productName && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8", textDecoration: "line-through" }}>{c.productName}</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: "#94a3b8" }}>{c.sku || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 600,
                          background: c.useCount >= 5 ? "#dcfce7" : "#f1f5f9",
                          color: c.useCount >= 5 ? "#166534" : "#475569",
                        }}>
                          {c.useCount}×
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{c.confirmedByName || "—"}</td>
                      <td style={{ ...tdStyle, color: "#94a3b8", fontSize: 11 }}>
                        {new Date(c.updatedAt).toLocaleDateString()}
                      </td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => void deleteCorrection(c.id)}
                          style={{ fontSize: 11, padding: "3px 8px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  color: "#475569",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  verticalAlign: "middle",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 13,
  fontWeight: 500,
};
