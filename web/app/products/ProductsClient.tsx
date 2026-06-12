"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRef } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import ProductImageUpload from "../components/ProductImageUpload";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { Category, DemoSchoolData, Product } from "../lib/demoTypes";
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
  categoryId: string;
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  description: "",
  imageUrl: "",
  price: "0.00",
  taxable: false,
  active: true,
  categoryId: ""
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
    active: product.active,
    categoryId: product.categoryId || ""
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

type CategoryForm = {
  name: string;
  description: string;
  color: string;
};

const emptyCategoryForm: CategoryForm = { name: "", description: "", color: "" };

type ImportPreviewRow = {
  row: number;
  name: string;
  sku: string | null;
  description: string | null;
  priceCents: number;
  categoryName: string | null;
  categoryId: string | null;
  categoryMatched: boolean | null;
  taxable: boolean;
  active: boolean;
  skuConflict: boolean;
  status: "create" | "skip";
};

type ImportPreview = {
  total: number;
  valid: number;
  errors: { row: number; error: string }[];
  preview: ImportPreviewRow[];
};

type ImportResult = { created: number; skipped: number; errors: { row: number; error: string }[] };

export function ProductsClient() {
  const [demo, setDemo] = useState<DemoSchoolData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<"products" | "categories">("products");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null);

  // CSV import
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function loadProducts(existingDemo = demo) {
    try {
      setError(null);
      const schoolData = existingDemo || { ...(await loadRegisterContext()), students: [] };
      setDemo(schoolData);
      const [rows, cats] = await Promise.all([
        apiGet<Product[]>(`/products?${new URLSearchParams({
          organizationId: schoolData.organization.id,
          storeId: schoolData.store.id,
          includeInactive: "true"
        })}`),
        apiGet<Category[]>(`/product-categories?organizationId=${schoolData.organization.id}&includeInactive=true`)
      ]);
      setProducts(rows);
      setCategories(cats);

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

  function downloadTemplate() {
    const header = "name,sku,description,price,category,taxable,active";
    const example = "Lunch Special,LUNCH-01,Daily lunch combo,4.50,Cafeteria,false,true";
    const blob = new Blob([header + "\n" + example + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-template.csv";
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
      const res = await fetch("/api/v1/products/import/preview", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: ImportPreview; error?: string };
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
      const res = await fetch("/api/v1/products/import/apply", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: ImportResult; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setImportResult(json.data!);
      void loadProducts(demo);
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

  async function saveCategory() {
    if (!demo || !categoryForm.name.trim()) return;
    setSavingCategory(true);
    setCategoryMessage(null);
    try {
      if (editingCategory) {
        await apiPatch<Category>(`/product-categories/${editingCategory.id}`, {
          organizationId: demo.organization.id,
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
          color: categoryForm.color.trim() || null
        });
      } else {
        await apiPost<Category>("/product-categories", {
          organizationId: demo.organization.id,
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
          color: categoryForm.color.trim() || null
        });
      }
      setCategoryMessage(`Category ${editingCategory ? "updated" : "created"}.`);
      setShowCategoryForm(false);
      setEditingCategory(null);
      setCategoryForm(emptyCategoryForm);
      await loadProducts(demo);
    } catch (err) {
      setCategoryMessage(err instanceof Error ? err.message : "Could not save category");
    } finally {
      setSavingCategory(false);
    }
  }

  async function toggleCategoryActive(cat: Category) {
    if (!demo) return;
    try {
      await apiPatch<Category>(`/product-categories/${cat.id}`, {
        organizationId: demo.organization.id,
        active: !cat.active
      });
      await loadProducts(demo);
    } catch (err) {
      setCategoryMessage(err instanceof Error ? err.message : "Could not update category");
    }
  }

  function openEditCategory(cat: Category) {
    setEditingCategory(cat);
    setCategoryForm({ name: cat.name, description: cat.description || "", color: cat.color || "" });
    setCategoryMessage(null);
    setShowCategoryForm(true);
  }

  function openNewCategory() {
    setEditingCategory(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryMessage(null);
    setShowCategoryForm(true);
  }

  function closeCategoryForm() {
    setShowCategoryForm(false);
    setEditingCategory(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryMessage(null);
  }

  const categoryFilterLabels = useMemo(() => {
    const unique = new Set(products.map(productCategory));
    return ["All", ...Array.from(unique)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = categoryFilter === "All" || productCategory(product) === categoryFilter;
      const matchesSearch =
        !query ||
        [product.name, product.sku || "", product.description || ""].some((value) =>
          value.toLowerCase().includes(query)
        );
      return matchesCategory && matchesSearch;
    });
  }, [products, search, categoryFilter]);

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
        active: form.active,
        categoryId: form.categoryId || null
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
        {activeTab === "products" ? (
          <>
            <button type="button" onClick={newProduct} className="btnPrimary">
              Add product
            </button>
            <button type="button" onClick={() => setShowImport(true)}>
              Import CSV
            </button>
          </>
        ) : (
          <button type="button" onClick={openNewCategory} className="btnPrimary">
            New category
          </button>
        )}
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

      {/* Tab switcher */}
      <div className="productTabBar">
        <button
          type="button"
          className={activeTab === "products" ? "productTab productTab--active" : "productTab"}
          onClick={() => setActiveTab("products")}
        >
          Products
        </button>
        <button
          type="button"
          className={activeTab === "categories" ? "productTab productTab--active" : "productTab"}
          onClick={() => setActiveTab("categories")}
        >
          Categories
          {categories.length > 0 && (
            <span className="productTabCount">{categories.length}</span>
          )}
        </button>
      </div>

      {/* ── Products tab ── */}
      {activeTab === "products" && (
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
                {categoryFilterLabels.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={categoryFilter === item ? "chipActive" : "chip"}
                    onClick={() => setCategoryFilter(item)}
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

                <label className="productFormLabel">
                  <span>Category <em className="productFormOptional">(optional)</em></span>
                  <select
                    value={form.categoryId}
                    onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                  >
                    <option value="">— No category —</option>
                    {categories.filter((c) => c.active).map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </label>

                <div className="productFormLabel">
                  <span>Product image <em className="productFormOptional">(optional)</em></span>
                  {demo ? (
                    <ProductImageUpload
                      currentUrl={form.imageUrl || null}
                      organizationId={demo.organization.id}
                      onUploaded={(url) => setForm({ ...form, imageUrl: url })}
                    />
                  ) : null}
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
      )}

      {/* ── Categories tab ── */}
      {activeTab === "categories" && (
        <div className="categoryAdminLayout">
          {categoryMessage && (
            <p className="buttonHelp success" style={{ marginBottom: "1rem" }}>{categoryMessage}</p>
          )}

          {/* Slide-in form */}
          {showCategoryForm && (
            <div className="categoryFormPanel">
              <div className="categoryFormPanelHeader">
                <strong>{editingCategory ? "Edit category" : "New category"}</strong>
                <button type="button" className="categoryFormClose" onClick={closeCategoryForm}>
                  ✕
                </button>
              </div>

              <label className="productFormLabel">
                <span>Name</span>
                <input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="e.g. Cafeteria"
                  autoFocus
                />
              </label>

              <label className="productFormLabel productFormLabel--secondary">
                <span>Description <em className="productFormOptional">(optional)</em></span>
                <input
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  placeholder="Short description"
                />
              </label>

              <label className="productFormLabel productFormLabel--secondary">
                <span>Color <em className="productFormOptional">(optional, hex)</em></span>
                <div className="categoryColorRow">
                  <input
                    value={categoryForm.color}
                    onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })}
                    placeholder="#4f46e5"
                    style={{ flex: 1 }}
                  />
                  {categoryForm.color && (
                    <span
                      className="categoryColorSwatch"
                      style={{ background: categoryForm.color }}
                    />
                  )}
                </div>
              </label>

              <div className="productFormActions">
                <button
                  type="button"
                  className="btnPrimary"
                  onClick={saveCategory}
                  disabled={savingCategory || !categoryForm.name.trim()}
                >
                  {savingCategory ? "Saving..." : editingCategory ? "Save changes" : "Create category"}
                </button>
                <button type="button" onClick={closeCategoryForm}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Category list */}
          {categories.length === 0 ? (
            <p className="productListEmpty">No categories yet. Create one above.</p>
          ) : (
            <div className="categoryList">
              {categories.map((cat) => (
                <div key={cat.id} className={`categoryListRow${cat.active ? "" : " categoryListRow--inactive"}`}>
                  <div className="categoryListLeft">
                    {cat.color ? (
                      <span className="categoryColorDot" style={{ background: cat.color }} />
                    ) : (
                      <span className="categoryColorDot categoryColorDot--empty" />
                    )}
                    <div className="categoryListMeta">
                      <strong className="categoryListName">{cat.name}</strong>
                      {cat.description && (
                        <span className="categoryListDesc">{cat.description}</span>
                      )}
                    </div>
                  </div>
                  <div className="categoryListRight">
                    {cat.isSystem && (
                      <span className="chip" style={{ fontSize: "0.7rem" }}>system</span>
                    )}
                    <StatusBadge value={cat.active ? "Active" : "Inactive"} />
                    <button
                      type="button"
                      className="btnSmall"
                      onClick={() => openEditCategory(cat)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btnSmall"
                      onClick={() => toggleCategoryActive(cat)}
                    >
                      {cat.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CSV Import overlay ── */}
      {showImport && (
        <div className="importOverlay">
          <div className="importPanel">
            <div className="importPanelHeader">
              <strong>Import products from CSV</strong>
              <button type="button" className="importPanelClose" onClick={closeImport}>✕</button>
            </div>

            {!importResult ? (
              <>
                <div className="importInstructions">
                  <p>Upload a CSV file with your products. Required columns: <code>name</code>, <code>price</code>. Optional: <code>sku</code>, <code>description</code>, <code>category</code>, <code>taxable</code>, <code>active</code>.</p>
                  <button type="button" className="importTemplateBtn" onClick={downloadTemplate}>
                    <span className="material-symbols-outlined">download</span>
                    Download template
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
                    <span>Click or drag a .csv file here</span>
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

                {importPreviewing && <p className="importHint">Parsing file…</p>}
                {importError && <p className="demoError">{importError}</p>}

                {importPreview && (
                  <>
                    <div className="importSummaryBar">
                      <span className="importSummaryItem importSummaryItem--ok">
                        {importPreview.preview.filter((r) => r.status === "create").length} to create
                      </span>
                      {importPreview.preview.filter((r) => r.status === "skip").length > 0 && (
                        <span className="importSummaryItem importSummaryItem--skip">
                          {importPreview.preview.filter((r) => r.status === "skip").length} skipped (SKU exists)
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
                        {importPreview.errors.map((e) => (
                          <p key={e.row} className="importErrorRow">Row {e.row}: {e.error}</p>
                        ))}
                      </div>
                    )}

                    <div className="importTableWrap">
                      <table className="importTable">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>SKU</th>
                            <th>Price</th>
                            <th>Category</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.preview.map((row) => (
                            <tr key={row.row} className={row.status === "skip" ? "importRowSkip" : ""}>
                              <td>{row.name}</td>
                              <td>{row.sku ?? "—"}</td>
                              <td>${(row.priceCents / 100).toFixed(2)}</td>
                              <td>
                                {row.categoryName ? (
                                  <span className={row.categoryMatched ? "importCatMatch" : "importCatMiss"}>
                                    {row.categoryName}{!row.categoryMatched && " (not found)"}
                                  </span>
                                ) : "—"}
                              </td>
                              <td>
                                <span className={`importStatusBadge importStatusBadge--${row.status}`}>
                                  {row.status === "skip" ? "Skip" : "Create"}
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
                        onClick={() => void applyImport()}
                        disabled={importApplying || importPreview.preview.filter((r) => r.status === "create").length === 0}
                      >
                        {importApplying ? "Importing…" : `Import ${importPreview.preview.filter((r) => r.status === "create").length} products`}
                      </button>
                      <button type="button" onClick={closeImport}>Cancel</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="importResultPanel">
                <span className="material-symbols-outlined importResultIcon">check_circle</span>
                <h3>Import complete</h3>
                <p><strong>{importResult.created}</strong> products created</p>
                {importResult.skipped > 0 && <p>{importResult.skipped} skipped (SKU already exists)</p>}
                {importResult.errors.length > 0 && (
                  <div className="importErrorList">
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="importErrorRow">Row {e.row}: {e.error}</p>
                    ))}
                  </div>
                )}
                <button type="button" className="btnPrimary" onClick={closeImport}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
