"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { DemoSchoolData, Product } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadRegisterContext } from "../lib/organizationContext";
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

function productInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase() || "PR";
}

function productColorClass(name: string) {
  const colors = [
    "productInitials--blue",
    "productInitials--green",
    "productInitials--amber",
    "productInitials--purple",
    "productInitials--teal"
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return colors[hash % colors.length];
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
      const schoolData = existingDemo || { ...(await loadRegisterContext()), students: [] };
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

  const previewPrice = formatMoney(toCents(form.price));
  const previewInitials = productInitials(form.name || "Product");
  const previewColorClass = productColorClass(form.name || "Product");

  return (
    <section className="module">
      <PageHeader eyebrow="Catalog" title="Products">
        <button type="button" onClick={newProduct} className="btnPrimary">
          Add product
        </button>
        <button type="button" onClick={() => loadProducts()}>
          Refresh
        </button>
      </PageHeader>

      <p className="productContextLine">
        Manager area — catalog controls register tiles.{" "}
        <strong>{activeCount} active</strong>
        {inactiveCount > 0 && (
          <>, {inactiveCount} inactive hidden from sales</>
        )}
        .
      </p>

      {error ? <p className="demoError">{error}</p> : null}

      <div className="productAdminGrid">
        {/* Left: product list */}
        <div className="productListPane">
          <div className="toolbar productToolbar">
            <input
              placeholder="Search name, SKU, description"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="productCategoryChips">
              {categories.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={category === item ? "chipActive" : "chip"}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="productList">
            {filteredProducts.length === 0 && (
              <p className="productListEmpty">No products match this filter.</p>
            )}
            {filteredProducts.map((product) => {
              const isSelected = product.id === selectedProductId;
              const initials = productInitials(product.name);
              const colorClass = productColorClass(product.name);
              return (
                <button
                  type="button"
                  key={product.id}
                  className={`productListRow${isSelected ? " productListRow--selected" : ""}`}
                  onClick={() => selectProduct(product)}
                >
                  <div className={`productListThumb ${colorClass}`}>
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>
                  <div className="productListMeta">
                    <strong className="productListName">{product.name}</strong>
                    <span className="productListSub">
                      {product.sku ? product.sku : productCategory(product)}
                    </span>
                  </div>
                  <div className="productListRight">
                    <span className="productListPrice">{formatMoney(product.priceCents)}</span>
                    <StatusBadge value={product.active ? "Active" : "Inactive"} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: editor panel */}
        <div className="productEditorPane">
          {!selectedProduct && (
            <button
              type="button"
              className="btnPrimary productNewHint"
              onClick={newProduct}
            >
              + New product
            </button>
          )}

          <form className="productEditor" onSubmit={submitProduct}>
            <div className="productEditorHeader">
              <div>
                <span className="productEditorEyebrow">
                  {selectedProduct ? "Edit product" : "New product"}
                </span>
                <strong className="productEditorTitle">
                  {selectedProduct?.name || "Catalog item"}
                </strong>
              </div>
            </div>

            {/* Section: Core */}
            <div className="productFormSection">
              <h3 className="productFormSectionTitle">Core</h3>

              <label className="productFormLabel">
                <span>Product name</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="e.g. Lunch Combo A"
                />
              </label>

              <label className="productFormLabel productFormLabel--secondary">
                <span>SKU <em className="productFormOptional">(optional)</em></span>
                <input
                  value={form.sku}
                  onChange={(event) => setForm({ ...form, sku: event.target.value })}
                  placeholder="e.g. LUNCH-001"
                />
              </label>

              <label className="productFormLabel productFormLabel--secondary">
                <span>Description <em className="productFormOptional">(optional)</em></span>
                <textarea
                  className="productFormTextarea"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  rows={2}
                  placeholder="Short description for staff reference"
                />
              </label>
            </div>

            {/* Section: Pricing */}
            <div className="productFormSection">
              <h3 className="productFormSectionTitle">Pricing</h3>

              <label className="productFormLabel">
                <span>Price (USD)</span>
                <input
                  className="productFormPriceInput"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) => setForm({ ...form, price: event.target.value })}
                  placeholder="0.00"
                />
              </label>

              <div className="productToggleRow">
                <label className="productToggle">
                  <input
                    type="checkbox"
                    checked={form.taxable}
                    onChange={(event) => setForm({ ...form, taxable: event.target.checked })}
                  />
                  <span className="productToggleTrack" />
                  <span className="productToggleLabel">Taxable</span>
                </label>
              </div>
            </div>

            {/* Section: Catalog options */}
            <div className="productFormSection">
              <h3 className="productFormSectionTitle">Catalog options</h3>

              <div className="productImageRow">
                <label className="productFormLabel productFormLabel--grow">
                  <span>Image URL <em className="productFormOptional">(optional)</em></span>
                  <input
                    value={form.imageUrl}
                    onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
                    placeholder="/product-images/lunch-combo.svg"
                  />
                </label>
                {form.imageUrl && (
                  <div className="productImageThumbPreview">
                    <img src={form.imageUrl} alt="Preview" />
                  </div>
                )}
              </div>

              <div className="productToggleRow">
                <label className="productToggle">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  <span className="productToggleTrack" />
                  <span className="productToggleLabel">Active — visible in register</span>
                </label>
              </div>
            </div>

            {/* Register tile preview */}
            <div className="productPreviewSection">
              <h3 className="productFormSectionTitle">Register preview</h3>
              <p className="productPreviewHint">This is how cashiers see the tile.</p>
              <div className="productPreviewTile">
                <div className={`productPreviewImage ${previewColorClass}`}>
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="" />
                  ) : (
                    <span>{previewInitials}</span>
                  )}
                </div>
                <div className="productPreviewBody">
                  <span className="productPreviewName">
                    {form.name || "Product name"}
                  </span>
                  <span className="productPreviewPrice">{previewPrice}</span>
                </div>
              </div>
            </div>

            <div className="productFormActions">
              <button type="submit" className="btnPrimary" disabled={saving}>
                {saving ? "Saving..." : selectedProduct ? "Save product" : "Create product"}
              </button>
              {selectedProduct && (
                <button type="button" onClick={newProduct}>
                  Cancel
                </button>
              )}
            </div>

            {message ? <p className="buttonHelp success">{message}</p> : null}
          </form>
        </div>
      </div>
    </section>
  );
}
