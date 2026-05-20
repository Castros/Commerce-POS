"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import type { DemoSchoolData, InventoryItem } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";

function toNumber(value: number | string) {
  return typeof value === "string" ? Number(value) : value;
}

function displayStatus(item: InventoryItem) {
  if (item.status === "out") return "Out";
  if (item.status === "low") return "Low";
  if (item.status === "not_tracked") return "Not tracked";
  return "In stock";
}

export function InventoryClient() {
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

  async function loadInventory(nextLowStockOnly = lowStockOnly) {
    try {
      setError(null);
      const data = demo || (await apiPost<DemoSchoolData>("/demo/school", {}));
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

  return (
    <section className="module">
      <PageHeader eyebrow="School inventory control" title="Cafeteria & Campus Store Inventory">
        <button type="button" onClick={() => loadInventory()}>
          Refresh
        </button>
      </PageHeader>
      {error ? <p className="demoError">{error}</p> : null}
      <div className="permissionStrip">
        <div>
          <span>Manager/admin area</span>
          <strong>Cashiers cannot edit this page</strong>
          <small>Stock adjustments and reorder rules require inventory permissions.</small>
        </div>
        <div>
          <span>Low stock alert</span>
          <strong>{lowStockCount} item{lowStockCount === 1 ? "" : "s"}</strong>
          <small>Sales now decrement stock from the POS transaction.</small>
        </div>
      </div>
      <form className="inventoryPanel" onSubmit={submitAdjustment}>
        <div>
          <span>Receive / adjust stock</span>
          <strong>{selectedInventory?.name || "Select product"}</strong>
          <small>
            Use positive numbers for receiving. Use negative numbers for corrections.
          </small>
        </div>
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
          Quantity
          <input
            inputMode="numeric"
            value={quantityDelta}
            onChange={(event) => setQuantityDelta(event.target.value)}
          />
        </label>
        <label>
          Note
          <input
            value={adjustmentNote}
            onChange={(event) => setAdjustmentNote(event.target.value)}
          />
        </label>
        <button type="submit" disabled={savingAdjustment || !selectedInventory}>
          {savingAdjustment ? "Saving..." : "Save stock"}
        </button>
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
    </section>
  );
}
