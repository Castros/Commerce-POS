"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import type { DemoSchoolData, InventoryItem } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadRegisterContext } from "../lib/organizationContext";
import { useLanguage } from "../lib/i18n/LanguageContext";

function toNumber(value: number | string) {
  return typeof value === "string" ? Number(value) : value;
}

type InvCsvPreviewRow = {
  row: number;
  sku: string | null;
  productName: string | null;
  quantity: number | null;
  reorderThreshold: number | null;
  storeName: string | null;
  status: "set" | "skip";
};

type InvCsvPreview = {
  total: number;
  valid: number;
  errors: { row: number; error: string }[];
  preview: InvCsvPreviewRow[];
};

type InvCsvResult = { updated: number; skipped: number; errors: { row: number; error: string }[] };

function displayStatus(item: InventoryItem) {
  if (item.status === "out") return "Out";
  if (item.status === "low") return "Low";
  if (item.status === "not_tracked") return "Not tracked";
  return "In stock";
}

export function InventoryClient() {
  const { t } = useLanguage();
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantityDelta, setQuantityDelta] = useState("10");
  const [adjustmentNote, setAdjustmentNote] = useState("Received stock");
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // CSV import state
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<InvCsvPreview | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importResult, setImportResult] = useState<InvCsvResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function loadInventory(nextLowStockOnly = lowStockOnly) {
    try {
      setError(null);
      const data = demo || { ...(await loadRegisterContext()), students: [] };
      setDemo(data);
      const params = new URLSearchParams({
        organizationId: data.organization.id,
        storeId: data.store.id
      });
      if (nextLowStockOnly) {
        params.set("lowStock", "true");
      }
      const items = await apiGet<InventoryItem[]>(`/inventory?${params}`);
      setInventory(items);
      if (!selectedProductId && items[0]) {
        setSelectedProductId(items[0].productId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inventory");
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  function downloadImportTemplate() {
    const csv = `sku,quantity,reorder_threshold,store_name\nLUNCH-01,50,10,Main Store\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory-template.csv";
    a.click();
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
      const res = await fetch("/api/v1/inventory/import/preview", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: InvCsvPreview; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setImportPreview(json.data!);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setImportPreviewing(false);
    }
  }

  async function applyInventoryImport() {
    if (!demo || !importFile) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("organizationId", demo.organization.id);
      if (demo.store?.id) fd.append("storeId", demo.store.id);
      const res = await fetch("/api/v1/inventory/import/apply", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: InvCsvResult; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setImportResult(json.data!);
      void loadInventory(lowStockOnly);
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

  const filteredInventory = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return inventory;
    return inventory.filter((item) =>
      [item.name, item.sku || "", item.location || ""].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [inventory, search]);

  const lowStockCount = inventory.filter((item) => item.status === "low" || item.status === "out").length;
  const selectedInventory = inventory.find((item) => item.productId === selectedProductId) || null;
  const activeRowIndex = filteredInventory.findIndex((item) => item.productId === selectedProductId);

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demo || !selectedInventory) {
      setError("Select an inventory item before saving.");
      return;
    }

    const parsedDelta = Number.parseInt(quantityDelta, 10);
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setError("Enter a whole number adjustment that is not zero.");
      return;
    }

    setSavingAdjustment(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost(`/inventory/${selectedInventory.productId}/adjustments`, {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        quantityDelta: parsedDelta,
        note: adjustmentNote.trim() || "Inventory adjustment"
      });
      setMessage(
        `${selectedInventory.name} stock ${parsedDelta > 0 ? "increased" : "decreased"} by ${Math.abs(parsedDelta)}.`
      );
      await loadInventory(lowStockOnly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save inventory adjustment");
    } finally {
      setSavingAdjustment(false);
    }
  }

  const totalItems = inventory.length;
  const inStockCount = inventory.filter(
    (item) => item.status !== "low" && item.status !== "out" && item.status !== "not_tracked"
  ).length;
  const lowCount = inventory.filter((item) => item.status === "low").length;
  const outCount = inventory.filter((item) => item.status === "out").length;

  const eyebrow = demo?.store?.name ?? demo?.organization?.name ?? "Inventory";

  return (
    <section className="module">
      <PageHeader eyebrow={eyebrow} title="Stock Management">
        <button type="button" onClick={() => loadInventory()}>
          Refresh
        </button>
        <button type="button" onClick={() => setShowImport(true)}>
          {t("common.importCsv")}
        </button>
      </PageHeader>
      {error ? <p className="demoError">{error}</p> : null}

      <div className="metricGrid" style={{ marginBottom: "16px" }}>
        <div className="metricTile">
          <span>Total Items</span>
          <strong>{totalItems}</strong>
          <small>SKUs tracked</small>
        </div>
        <div className="metricTile">
          <span>In Stock</span>
          <strong>{inStockCount}</strong>
          <small>Above reorder threshold</small>
        </div>
        <div className="metricTile metricTile--warning">
          <span>Low Stock</span>
          <strong>{lowCount}</strong>
          <small>Below reorder threshold</small>
        </div>
        <div className="metricTile metricTile--danger">
          <span>Out of Stock</span>
          <strong>{outCount}</strong>
          <small>Zero units on hand</small>
        </div>
      </div>

      <form className="adjustPanel" onSubmit={submitAdjustment}>
        <div className="adjustPanelHeader">
          <span>Adjust Stock</span>
          <strong>{selectedInventory?.name || "Select a product below"}</strong>
        </div>
        <div className="adjustPanelBody">
          <div className="adjustPanelLeft">
            <label>
              Product
              <select
                value={selectedProductId}
                onChange={(event) => setSelectedProductId(event.target.value)}
              >
                {inventory.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.name} ({item.sku || "No SKU"})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input
                value={adjustmentNote}
                onChange={(event) => setAdjustmentNote(event.target.value)}
              />
            </label>
          </div>
          <div className="adjustPanelRight">
            <label>
              Quantity
              <input
                inputMode="numeric"
                value={quantityDelta}
                onChange={(event) => setQuantityDelta(event.target.value)}
              />
            </label>
            <small>Positive to receive stock. Negative to correct.</small>
            <button type="submit" disabled={savingAdjustment || !selectedInventory}>
              {savingAdjustment ? "Saving..." : "Save stock"}
            </button>
          </div>
        </div>
      </form>
      {message ? <p className="buttonHelp success">{message}</p> : null}
      <div className="toolbar">
        <input
          placeholder="Search SKU, barcode, product, supplier"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          className={lowStockOnly ? "active" : ""}
          onClick={() => {
            const next = !lowStockOnly;
            setLowStockOnly(next);
            void loadInventory(next);
          }}
        >
          Low stock
        </button>
        <button
          type="button"
          onClick={() => {
            if (filteredInventory[0]) {
              setSelectedProductId(filteredInventory[0].productId);
            }
          }}
        >
          Adjust selected
        </button>
      </div>
      <DataTable
        headers={["Product", "SKU", "Stock", "Reorder", "Location", "Price", "Status"]}
        rows={filteredInventory.map((item) => [
          item.name,
          item.sku || "No SKU",
          String(toNumber(item.quantityOnHand)),
          String(toNumber(item.reorderThreshold)),
          item.location || "Unassigned",
          formatMoney(item.priceCents),
          displayStatus(item)
        ])}
        statusIndex={6}
        onRowClick={(index) => setSelectedProductId(filteredInventory[index].productId)}
        activeRowIndex={activeRowIndex >= 0 ? activeRowIndex : undefined}
      />

      {/* ── CSV Import overlay ── */}
      {showImport && (
        <div className="importOverlay">
          <div className="importPanel">
            <div className="importPanelHeader">
              <strong>{t("inventory.import.title")}</strong>
              <button type="button" className="importPanelClose" onClick={closeImport}>✕</button>
            </div>

            {!importResult ? (
              <>
                <div className="importInstructions">
                  <p>
                    {t("inventory.import.instructions")} <code>sku</code>, <code>quantity</code>.{" "}
                    {t("inventory.import.optionalColumns")} <code>reorder_threshold</code>, <code>store_name</code>.
                  </p>
                  <button type="button" className="importTemplateBtn" onClick={downloadImportTemplate}>
                    <span className="material-symbols-outlined">download</span>
                    {t("common.downloadTemplate")}
                  </button>
                </div>

                <div
                  className="importDropZone"
                  onClick={() => importFileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) void handleImportFile(file);
                  }}
                >
                  <span className="material-symbols-outlined">upload_file</span>
                  {importFile ? (
                    <span>{importFile.name}</span>
                  ) : (
                    <span>{t("inventory.import.dropZone")}</span>
                  )}
                </div>

                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImportFile(file);
                    e.target.value = "";
                  }}
                />

                {importPreviewing && <p className="importHint">{t("inventory.import.parsing")}</p>}
                {importError && <p className="demoError">{importError}</p>}

                {importPreview && (
                  <>
                    <div className="importSummaryBar">
                      <span className="importSummaryItem importSummaryItem--ok">
                        {importPreview.preview.filter((r) => r.status === "set").length} {t("inventory.import.toSet")}
                      </span>
                      {importPreview.preview.filter((r) => r.status === "skip").length > 0 && (
                        <span className="importSummaryItem importSummaryItem--skip">
                          {importPreview.preview.filter((r) => r.status === "skip").length} {t("inventory.import.skipped")}
                        </span>
                      )}
                      {importPreview.errors.length > 0 && (
                        <span className="importSummaryItem importSummaryItem--err">
                          {importPreview.errors.length} {t("inventory.import.errorsFound")}
                        </span>
                      )}
                    </div>

                    {importPreview.errors.length > 0 && (
                      <div className="importErrorList">
                        {importPreview.errors.map((e) => (
                          <p key={e.row} className="importErrorRow">Row {e.row}: {e.error}</p>
                        ))}
                      </div>
                    )}

                    <div className="importTableWrap">
                      <table className="importTable">
                        <thead>
                          <tr>
                            <th>{t("inventory.import.colSku")}</th>
                            <th>{t("inventory.import.colProduct")}</th>
                            <th>{t("inventory.import.colQty")}</th>
                            <th>{t("inventory.import.colThreshold")}</th>
                            <th>{t("inventory.import.colStore")}</th>
                            <th>{t("inventory.import.colStatus")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.preview.map((row) => (
                            <tr key={row.row} className={row.status === "skip" ? "importRowSkip" : ""}>
                              <td>{row.sku ?? "—"}</td>
                              <td>{row.productName ?? "—"}</td>
                              <td>{row.quantity ?? "—"}</td>
                              <td>{row.reorderThreshold ?? "—"}</td>
                              <td>{row.storeName ?? "—"}</td>
                              <td>
                                <span className={`importStatusBadge importStatusBadge--${row.status === "set" ? "create" : "skip"}`}>
                                  {row.status === "skip" ? t("inventory.import.skipLabel") : t("inventory.import.setLabel")}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="importActions">
                      <button
                        type="button"
                        className="btnPrimary"
                        onClick={() => void applyInventoryImport()}
                        disabled={importApplying || importPreview.preview.filter((r) => r.status === "set").length === 0}
                      >
                        {importApplying
                          ? t("inventory.import.importing")
                          : `${t("inventory.import.confirmBtn")} ${importPreview.preview.filter((r) => r.status === "set").length} ${t("inventory.import.itemsLabel")}`}
                      </button>
                      <button type="button" onClick={closeImport}>{t("common.cancel")}</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="importResultPanel">
                <span className="material-symbols-outlined importResultIcon">check_circle</span>
                <h3>{t("inventory.import.doneTitle")}</h3>
                {importResult.updated > 0 && <p><strong>{importResult.updated}</strong> {t("inventory.import.updated")}</p>}
                {importResult.skipped > 0 && <p>{importResult.skipped} {t("inventory.import.skipped")}</p>}
                {importResult.errors.length > 0 && (
                  <div className="importErrorList">
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="importErrorRow">Row {e.row}: {e.error}</p>
                    ))}
                  </div>
                )}
                <button type="button" className="btnPrimary" onClick={closeImport}>{t("common.done")}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
