"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { DataTable } from "../../components/DataTable";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPost } from "../../lib/api";
import type {
  DemoSchoolData,
  InventoryImportBatch,
  InventoryInvoice,
  InventoryTransfer,
  Product,
  ReceiptExtractionDraft,
  Store,
  Supplier
} from "../../lib/demoTypes";
import { formatMoney } from "../../lib/format";
import { loadRegisterContext } from "../../lib/organizationContext";

function toCents(value: string) {
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseCsvPreview(csvText: string, demo: DemoSchoolData | null) {
  const rows = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((value) => value.trim()))
    .filter((row) => row.some(Boolean));

  const [headers = [], ...dataRows] = rows;
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  const read = (row: string[], key: string) => row[normalizedHeaders.indexOf(key)] || "";

  return dataRows.map((row) => {
    const sku = read(row, "sku");
    const product = demo?.products.find((item) => item.sku === sku);
    const quantity = Number.parseInt(read(row, "quantity_on_hand"), 10);
    const reorder = Number.parseInt(read(row, "reorder_threshold"), 10);
    return {
      storeId: demo?.store.id || null,
      productId: product?.id || null,
      sku,
      barcode: read(row, "barcode") || null,
      productName: read(row, "name") || product?.name || null,
      category: read(row, "category") || null,
      supplierName: read(row, "supplier") || null,
      quantityOnHand: Number.isInteger(quantity) ? quantity : null,
      reorderThreshold: Number.isInteger(reorder) ? reorder : null,
      unitCostCents: toCents(read(row, "unit_cost")),
      status: product ? "valid" : "needs_review",
      errorMessage: product ? null : "Product/SKU needs review before approval"
    };
  });
}

const csvSample = `location,sku,barcode,name,category,quantity_on_hand,reorder_threshold,supplier,unit_cost
Main Cafeteria,DEMO-WATER,012345678901,Water Bottle,Drinks,140,60,Fresh Foods Co,0.42
Main Cafeteria,DEMO-LUNCH-COMBO,098765432109,Lunch Combo,Meals,220,25,Fresh Foods Co,2.10`;

export function ReceivingClient() {
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InventoryInvoice[]>([]);
  const [imports, setImports] = useState<InventoryImportBatch[]>([]);
  const [drafts, setDrafts] = useState<ReceiptExtractionDraft[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [supplierName, setSupplierName] = useState("Fresh Foods Co");
  const [supplierPhone, setSupplierPhone] = useState("555-0199");
  const [supplierAddress, setSupplierAddress] = useState("1200 Market Street");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("INV-10042");
  const [quantity, setQuantity] = useState("24");
  const [unitCost, setUnitCost] = useState("2.10");
  const [transferQuantity, setTransferQuantity] = useState("4");
  const [toStoreId, setToStoreId] = useState("");
  const [csvText, setCsvText] = useState(csvSample);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedProduct = useMemo(
    () => demo?.products.find((product) => product.id === selectedProductId) || demo?.products[0] || null,
    [demo?.products, selectedProductId]
  );
  const csvPreview = useMemo(() => parseCsvPreview(csvText, demo), [csvText, demo]);
  const transferTargetStores = stores.filter((store) => store.id !== demo?.store.id);

  async function loadStores(schoolData: DemoSchoolData) {
    return apiGet<Store[]>(`/stores?organizationId=${schoolData.organization.id}`);
  }

  async function loadData() {
    try {
      setError(null);
      const schoolData = demo || { ...(await loadRegisterContext()), students: [] };
      setDemo(schoolData);
      if (!selectedProductId && schoolData.products[0]) setSelectedProductId(schoolData.products[0].id);

      const nextStores = await loadStores(schoolData);
      const [nextSuppliers, nextInvoices, nextImports, nextDrafts, nextTransfers] = await Promise.all([
        apiGet<Supplier[]>(`/inventory/suppliers?organizationId=${schoolData.organization.id}`),
        apiGet<InventoryInvoice[]>(`/inventory/invoices?organizationId=${schoolData.organization.id}`),
        apiGet<InventoryImportBatch[]>(`/inventory/imports?organizationId=${schoolData.organization.id}`),
        apiGet<ReceiptExtractionDraft[]>(`/inventory/receipt-drafts?organizationId=${schoolData.organization.id}`),
        apiGet<InventoryTransfer[]>(`/inventory/transfers?organizationId=${schoolData.organization.id}`)
      ]);

      setStores(nextStores);
      setSuppliers(nextSuppliers);
      setInvoices(nextInvoices);
      setImports(nextImports);
      setDrafts(nextDrafts);
      setTransfers(nextTransfers);
      if (!selectedSupplierId && nextSuppliers[0]) setSelectedSupplierId(nextSuppliers[0].id);
      if (!toStoreId) {
        const target = nextStores.find((store) => store.id !== schoolData.store.id);
        if (target) setToStoreId(target.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load receiving workspace");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demo) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const supplier = await apiPost<Supplier>("/inventory/suppliers", {
        organizationId: demo.organization.id,
        name: supplierName,
        phone: supplierPhone,
        addressLine1: supplierAddress,
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        vendorNumber: "SUP-1001"
      });
      setSelectedSupplierId(supplier.id);
      setMessage(`${supplier.name} saved as a supplier.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier");
    } finally {
      setSaving(false);
    }
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demo || !selectedProduct) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const created = await apiPost<{ invoice: InventoryInvoice }>("/inventory/invoices", {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        supplierId: selectedSupplierId || null,
        invoiceNumber,
        invoiceDate: today(),
        receivedDate: today(),
        taxCents: 0,
        source: "manual",
        notes: "Manager-entered receiving invoice",
        lines: [
          {
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            sku: selectedProduct.sku,
            quantity: Number.parseInt(quantity, 10),
            unitCostCents: toCents(unitCost),
            matchStatus: "matched"
          }
        ]
      });
      setMessage(`Invoice ${created.invoice.invoiceNumber || created.invoice.id} is pending approval.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invoice");
    } finally {
      setSaving(false);
    }
  }

  async function approveInvoice(invoiceId: string) {
    if (!demo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost(`/inventory/invoices/${invoiceId}/approve`, {
        organizationId: demo.organization.id
      });
      setMessage("Invoice approved. Inventory stock has been updated.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve invoice");
    } finally {
      setSaving(false);
    }
  }

  async function createCsvBatch() {
    if (!demo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost("/inventory/imports", {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        filename: "cafeteria-inventory.csv",
        rows: csvPreview
      });
      setMessage("CSV import preview saved for approval. No stock was changed.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save CSV import preview");
    } finally {
      setSaving(false);
    }
  }

  async function applyCsvBatch(batchId: string) {
    if (!demo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiPost<{ appliedRows: number }>(`/inventory/imports/${batchId}/apply`, {
        organizationId: demo.organization.id
      });
      setMessage(`CSV import applied. ${result.appliedRows} row${result.appliedRows === 1 ? "" : "s"} updated inventory.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply CSV import");
    } finally {
      setSaving(false);
    }
  }

  async function createReceiptDraft() {
    if (!demo || !selectedProduct) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost("/inventory/receipt-drafts", {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        supplierId: selectedSupplierId || null,
        imageUrl: "/demo-receipts/fresh-foods-invoice.jpg",
        confidence: 0.87,
        reviewNotes: "AI draft requires manager approval before receiving stock.",
        extractedPayload: {
          supplierName: suppliers.find((supplier) => supplier.id === selectedSupplierId)?.name || supplierName,
          invoiceNumber: `AI-${Date.now()}`,
          lines: [
            {
              productName: selectedProduct.name,
              sku: selectedProduct.sku,
              quantity: 12,
              unitCostCents: toCents(unitCost),
              confidence: 0.87
            }
          ]
        }
      });
      setMessage("AI receipt draft created for review. No stock was changed.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create AI receipt draft");
    } finally {
      setSaving(false);
    }
  }

  async function approveReceiptDraft(draftId: string) {
    if (!demo) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost(`/inventory/receipt-drafts/${draftId}/approve`, {
        organizationId: demo.organization.id
      });
      setMessage("AI receipt draft approved into a pending invoice. Approve the invoice to update stock.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve AI receipt draft");
    } finally {
      setSaving(false);
    }
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demo || !selectedProduct || !toStoreId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiPost("/inventory/transfers", {
        organizationId: demo.organization.id,
        fromStoreId: demo.store.id,
        toStoreId,
        productId: selectedProduct.id,
        quantity: Number.parseInt(transferQuantity, 10),
        note: "Demo cafeteria stock transfer"
      });
      setMessage("Inventory transfer completed and movement history was written for both locations.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete transfer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Inventory receiving" title="Suppliers, Invoices, CSV & AI Review">
        <button type="button" onClick={loadData}>Refresh</button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}
      {message ? <p className="buttonHelp success">{message}</p> : null}

      <div className="permissionStrip">
        <div>
          <span>Approval rule</span>
          <strong>Human approval required</strong>
          <small>Invoices, CSV imports, and AI receipt drafts do not change stock until approved.</small>
        </div>
        <div>
          <span>Multi-location</span>
          <strong>{demo?.store.name || "Cafeteria"}</strong>
          <small>Each location has its own stock quantities and receiving history.</small>
        </div>
        <div>
          <span>Audit trail</span>
          <strong>Inventory movement ledger</strong>
          <small>Approved invoices write receive movements against each product/location.</small>
        </div>
      </div>

      <div className="receivingGrid">
        <form className="panelWide receivingForm" onSubmit={saveSupplier}>
          <h3>Supplier</h3>
          <label>Name<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
          <label>Phone<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} /></label>
          <label>Address<input value={supplierAddress} onChange={(event) => setSupplierAddress(event.target.value)} /></label>
          <button type="submit" disabled={saving || !supplierName.trim()}>Save supplier</button>
        </form>

        <form className="panelWide receivingForm" onSubmit={createInvoice}>
          <h3>Receiving invoice</h3>
          <label>
            Supplier
            <select value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
              <option value="">No supplier selected</option>
              {suppliers.map((supplier) => (
                <option value={supplier.id} key={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </label>
          <label>Invoice #<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
          <label>
            Product
            <select value={selectedProduct?.id || ""} onChange={(event) => setSelectedProductId(event.target.value)}>
              {(demo?.products || []).map((product: Product) => (
                <option value={product.id} key={product.id}>{product.name} ({product.sku || "No SKU"})</option>
              ))}
            </select>
          </label>
          <label>Quantity<input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label>Unit cost<input inputMode="decimal" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></label>
          <button type="submit" disabled={saving || !selectedProduct}>Create invoice for approval</button>
        </form>

        <div className="panelWide receivingForm">
          <h3>CSV upload preview</h3>
          <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} rows={8} />
          <small>{csvPreview.length} rows parsed. Rows without a product match stay in review.</small>
          <button type="button" onClick={createCsvBatch} disabled={saving || csvPreview.length === 0}>
            Save CSV preview
          </button>
        </div>

        <div className="panelWide receivingForm">
          <h3>AI receipt capture</h3>
          <p className="panelCopy">
            The demo creates an AI extraction draft from a receipt image placeholder. The draft must be reviewed before it becomes an invoice.
          </p>
          <button type="button" onClick={createReceiptDraft} disabled={saving || !selectedProduct}>
            Create AI review draft
          </button>
        </div>

        <form className="panelWide receivingForm" onSubmit={createTransfer}>
          <h3>Location transfer</h3>
          <label>
            Product
            <select value={selectedProduct?.id || ""} onChange={(event) => setSelectedProductId(event.target.value)}>
              {(demo?.products || []).map((product: Product) => (
                <option value={product.id} key={product.id}>{product.name} ({product.sku || "No SKU"})</option>
              ))}
            </select>
          </label>
          <label>
            To location
            <select value={toStoreId} onChange={(event) => setToStoreId(event.target.value)}>
              {transferTargetStores.map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label>Quantity<input inputMode="numeric" value={transferQuantity} onChange={(event) => setTransferQuantity(event.target.value)} /></label>
          <button type="submit" disabled={saving || !selectedProduct || !toStoreId}>
            Transfer stock
          </button>
        </form>
      </div>

      <div className="dashboardGrid">
        <div className="panelWide fullWidth">
          <h3>Invoices waiting for approval</h3>
          <DataTable
            headers={["Invoice", "Supplier", "Location", "Lines", "Total", "Status", "Action"]}
            rows={invoices.map((invoice) => [
              invoice.invoiceNumber || invoice.id.slice(0, 8),
              invoice.supplierName || "No supplier",
              invoice.storeName,
              String(invoice.lineCount),
              formatMoney(invoice.totalCents),
              invoice.status,
              invoice.status === "approved" ? "Applied" : "Approve"
            ])}
            statusIndex={5}
            onRowClick={(index) => {
              const invoice = invoices[index];
              if (invoice && invoice.status !== "approved") void approveInvoice(invoice.id);
            }}
          />
        </div>

        <div className="panelWide">
          <h3>CSV import batches</h3>
          <DataTable
            headers={["File", "Rows", "Valid", "Errors", "Status", "Action"]}
            rows={imports.map((batch) => [
              batch.filename || batch.id.slice(0, 8),
              String(batch.totalRows),
              String(batch.validRows),
              String(batch.errorRows),
              batch.status,
              batch.status === "applied" ? "Applied" : "Apply"
            ])}
            statusIndex={4}
            onRowClick={(index) => {
              const batch = imports[index];
              if (batch && batch.status !== "applied") void applyCsvBatch(batch.id);
            }}
          />
        </div>

        <div className="panelWide">
          <h3>AI receipt drafts</h3>
          <DataTable
            headers={["Supplier", "Location", "Confidence", "Status", "Action"]}
            rows={drafts.map((draft) => [
              draft.supplierName || "Needs supplier",
              draft.storeName || "No location",
              draft.confidence === null ? "N/A" : `${Math.round(Number(draft.confidence) * 100)}%`,
              draft.status,
              draft.status === "approved" ? "Invoice created" : "Create invoice"
            ])}
            statusIndex={3}
            onRowClick={(index) => {
              const draft = drafts[index];
              if (draft && draft.status !== "approved") void approveReceiptDraft(draft.id);
            }}
          />
        </div>

        <div className="panelWide fullWidth">
          <h3>Location transfers</h3>
          <DataTable
            headers={["Product", "From", "To", "Qty", "Status", "Completed"]}
            rows={transfers.map((transfer) => [
              transfer.productName,
              transfer.fromStoreName,
              transfer.toStoreName,
              String(transfer.quantity),
              transfer.status,
              transfer.completedAt ? new Date(transfer.completedAt).toLocaleString() : "Pending"
            ])}
            statusIndex={4}
          />
        </div>
      </div>
    </section>
  );
}
