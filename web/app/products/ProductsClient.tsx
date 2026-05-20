"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { DemoSchoolData, Product } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { productCategory } from "../lib/productUtils";

type ProductForm = {
  name: string;
  sku: string;
  description: string;
  imageUrl: string;
  price: string;
  taxable: boolean;
  active: boolean;
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  description: "",
  imageUrl: "",
  price: "0.00",
  taxable: false,
  active: true
};

function toCents(price: string) {
  const normalized = Number.parseFloat(price.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(normalized)) return 0;
  return Math.round(normalized * 100);
}

function centsToPrice(cents: number | string) {
  const value = typeof cents === "string" ? Number(cents) : cents;
  return (value / 100).toFixed(2);
}

function formFromProduct(product: Product): ProductForm {
  return {
    name: product.name,
    sku: product.sku || "",
    description: product.description || "",
    imageUrl: product.imageUrl || "",
    price: centsToPrice(product.priceCents),
    taxable: product.taxable,
    active: product.active
  };
}

export function ProductsClient() {
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProducts(existingDemo = demo) {
    try {
      setError(null);
      const schoolData = existingDemo || (await apiPost<DemoSchoolData>("/demo/school", {}));
      setDemo(schoolData);
      const params = new URLSearchParams({
        organizationId: schoolData.organization.id,
        storeId: schoolData.store.id,
        includeInactive: "true"
      });
      const rows = await apiGet<Product[]>(`/products?${params}`);
      setProducts(rows);

      const nextSelected =
        rows.find((product) => product.id === selectedProductId) || rows[0] || null;
      if (nextSelected) {
        setSelectedProductId(nextSelected.id);
        setForm(formFromProduct(nextSelected));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products");
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  const categories = useMemo(() => {
    const unique = new Set(products.map(productCategory));
    return ["All", ...Array.from(unique)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || productCategory(product) === category;
      const matchesSearch =
        !query ||
        [product.name, product.sku || "", product.description || ""].some((value) =>
          value.toLowerCase().includes(query)
        );
      return matchesCategory && matchesSearch;
    });
  }, [products, search, category]);

  const selectedProduct = products.find((product) => product.id === selectedProductId) || null;
  const activeRowIndex = filteredProducts.findIndex((product) => product.id === selectedProductId);

  function selectProduct(product: Product) {
    setSelectedProductId(product.id);
    setForm(formFromProduct(product));
    setMessage(null);
    setError(null);
  }

  function newProduct() {
    setSelectedProductId("");
    setForm(emptyForm);
    setMessage(null);
    setError(null);
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demo) {
      setError("Product data is still loading.");
      return;
    }
    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }

    const priceCents = toCents(form.price);
    if (priceCents < 0) {
      setError("Price cannot be negative.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        organizationId: demo.organization.id,
        storeId: demo.store.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        sku: form.sku.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
        priceCents,
        taxable: form.taxable,
        active: form.active
      };

      const saved = selectedProductId
        ? await apiPatch<Product>(`/products/${selectedProductId}`, body)
        : await apiPost<Product>("/products", body);

      setSelectedProductId(saved.id);
      setForm(formFromProduct(saved));
      setMessage(`${saved.name} ${selectedProductId ? "updated" : "created"}.`);
      await loadProducts(demo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = products.filter((product) => product.active).length;
  const inactiveCount = products.length - activeCount;

  return (
    <section className="module">
      <PageHeader eyebrow="Catalog" title="Products">
        <button type="button" onClick={newProduct}>Add product</button>
        <button type="button" onClick={() => loadProducts()}>Refresh</button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      <div className="permissionStrip">
        <div>
          <span>Manager/admin area</span>
          <strong>Catalog controls register tiles</strong>
          <small>Cashiers sell these products, but cannot edit price, SKU, image, or active state.</small>
        </div>
        <div>
          <span>Active products</span>
          <strong>{activeCount}</strong>
          <small>{inactiveCount} inactive product{inactiveCount === 1 ? "" : "s"} hidden from sales.</small>
        </div>
      </div>

      <div className="toolbar">
        <input
          placeholder="Search product name, SKU, description"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="productAdminGrid">
        <div>
          <DataTable
            headers={["Product", "SKU", "Category", "Price", "Taxable", "Status"]}
            rows={filteredProducts.map((product) => [
              product.name,
              product.sku || "No SKU",
              productCategory(product),
              formatMoney(product.priceCents),
              product.taxable ? "Yes" : "No",
              product.active ? "Active" : "Inactive"
            ])}
            statusIndex={5}
            activeRowIndex={activeRowIndex}
            onRowClick={(index) => selectProduct(filteredProducts[index])}
          />
        </div>

        <form className="productEditor" onSubmit={submitProduct}>
          <div>
            <span>{selectedProduct ? "Edit product" : "New product"}</span>
            <strong>{selectedProduct?.name || "Catalog item"}</strong>
            <small>Changes update the API catalog used by the cafeteria register.</small>
          </div>

          <label>
            Name
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>

          <label>
            SKU
            <input
              value={form.sku}
              onChange={(event) => setForm({ ...form, sku: event.target.value })}
            />
          </label>

          <label>
            Price
            <input
              inputMode="decimal"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
          </label>

          <label>
            Image URL
            <input
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              placeholder="/product-images/lunch-combo.svg"
            />
          </label>

          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              rows={3}
            />
          </label>

          <div className="toggleRow">
            <label>
              <input
                type="checkbox"
                checked={form.taxable}
                onChange={(event) => setForm({ ...form, taxable: event.target.checked })}
              />
              Taxable
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              Active
            </label>
          </div>

          <div className="productPreview">
            <span>Register preview</span>
            <div>
              {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <strong>{form.name.slice(0, 2).toUpperCase() || "PR"}</strong>}
            </div>
            <small>{formatMoney(toCents(form.price))}</small>
          </div>

          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : selectedProduct ? "Save product" : "Create product"}
          </button>
          {message ? <p className="buttonHelp success">{message}</p> : null}
        </form>
      </div>
    </section>
  );
}

