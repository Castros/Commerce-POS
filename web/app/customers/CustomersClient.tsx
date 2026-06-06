"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import AvatarUpload from "../components/AvatarUpload";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { DemoStudent, Organization, Store } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { avatarUrl } from "../lib/imageUrl";
import { loadCurrentOrganization } from "../lib/organizationContext";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveStoreId(raw: string, stores: Store[]): string | null {
  if (!raw) return null;
  if (UUID_RE.test(raw)) return stores.some((s) => s.id === raw) ? raw : null;
  return stores.find((s) => s.name.toLowerCase() === raw.toLowerCase())?.id ?? null;
}

function buildStudentTemplate(stores: Store[]): string {
  const locationExample = stores[0]?.name ?? "Main Cafeteria";
  const location2 = stores[1]?.name ?? locationExample;
  return `name,email,phone,external_id,home_location\nAna García,ana.garcia@school.mx,5551234567,2024-0001,${locationExample}\nCarlos López,,5559876543,2024-0002,${location2}\nMaría Pérez,maria@example.com,,2024-0003,\n`;
}

type StudentImportRow = {
  name: string;
  email: string;
  phone: string;
  externalId: string;
  location: string;
  _error?: string;
};

function parseStudentCsv(text: string): StudentImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (col: string) => header.indexOf(col);
  const get = (cells: string[], col: string) => (cells[idx(col)] || "").replace(/^"|"$/g, "").trim();

  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const name = get(cells, "name");
    return {
      name,
      email: get(cells, "email"),
      phone: get(cells, "phone"),
      externalId: get(cells, "external_id"),
      location: get(cells, "home_location") || get(cells, "home_store_id"),
      _error: !name ? "Name is required" : undefined
    };
  }).filter((r) => r.name || r.email || r.externalId);
}

function StudentImportModal({
  organization,
  stores,
  onClose,
  onDone
}: {
  organization: Organization;
  stores: Store[];
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<StudentImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: { row: number; name: string; error: string }[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      setPreview(parseStudentCsv(text));
      setResult(null);
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(buildStudentTemplate(stores));
    a.download = "students-template.csv";
    a.click();
  }

  async function runImport() {
    if (!preview.length) return;
    const valid = preview.filter((r) => !r._error);
    if (!valid.length) return;
    setImporting(true);
    setImportError(null);
    try {
      const data = await apiPost<{ imported: number; errors: { row: number; name: string; error: string }[] }>(
        "/customers/import",
        {
          organizationId: organization.id,
          rows: valid.map((r) => ({
            name: r.name,
            email: r.email || null,
            phone: r.phone || null,
            externalId: r.externalId || null,
            homeStoreId: resolveStoreId(r.location, stores)
          }))
        }
      );
      setResult(data);
      if (data.errors.length === 0) onDone();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const validCount = preview.filter((r) => !r._error).length;
  const errorCount = preview.filter((r) => r._error).length;

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal csvModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>Import Students via CSV</h3>
          <button type="button" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="modalBody">
          {result ? (
            <div className="importResult">
              <p className="importResultSuccess">
                <span className="material-symbols-outlined fill" aria-hidden="true">check_circle</span>
                {result.imported} student{result.imported !== 1 ? "s" : ""} imported successfully.
              </p>
              {result.errors.length > 0 && (
                <div className="importErrors">
                  <strong>{result.errors.length} row{result.errors.length !== 1 ? "s" : ""} failed:</strong>
                  {result.errors.map((e) => (
                    <p key={e.row} className="importErrorRow">Row {e.row} ({e.name}): {e.error}</p>
                  ))}
                </div>
              )}
              <button type="button" className="btn" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
            </div>
          ) : (
            <>
              <div className="csvUploadArea">
                <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={handleFile} />
                <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                  <span className="material-symbols-outlined" aria-hidden="true">upload_file</span>
                  Choose CSV File
                </button>
                <span className="csvUploadOr">or</span>
                <button type="button" className="btnGhost" onClick={downloadTemplate}>
                  <span className="material-symbols-outlined" aria-hidden="true">download</span>
                  Download Template
                </button>
              </div>

              <div className="csvColumns">
                <strong>Required:</strong>
                <code>name</code>
                <strong>Optional:</strong>
                <code>email</code>
                <code>phone</code>
                <code>external_id</code>
                <code>home_location</code>
                <span className="csvColumnNote">(matricula used for upsert; home_location accepts store name or ID)</span>
              </div>

              {stores.length > 0 && (
                <div className="csvLocationRef">
                  <strong>Available locations for <code>home_location</code> column:</strong>
                  <table className="csvLocationTable">
                    <thead><tr><th>Store name (use in CSV)</th><th>ID</th></tr></thead>
                    <tbody>
                      {stores.map((s) => (
                        <tr key={s.id}>
                          <td><strong>{s.name}</strong></td>
                          <td className="csvLocationId">{s.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <textarea
                className="csvPasteArea"
                placeholder="Or paste CSV content here…"
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setPreview(parseStudentCsv(e.target.value)); setResult(null); }}
                rows={5}
              />

              {importError && <p className="pageError">{importError}</p>}

              {preview.length > 0 && (
                <div className="csvPreview">
                  <div className="csvPreviewHeader">
                    <span>Preview — {preview.length} row{preview.length !== 1 ? "s" : ""}</span>
                    {errorCount > 0 && <span className="statusBadge statusBadge--warning">{errorCount} invalid</span>}
                    {validCount > 0 && <span className="statusBadge statusBadge--success">{validCount} valid</span>}
                  </div>
                  <div className="csvPreviewTable">
                    <table>
                      <thead>
                        <tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Ext. ID</th><th>Location</th><th></th></tr>
                      </thead>
                      <tbody>
                        {preview.slice(0, 20).map((row, i) => {
                          const resolvedId = resolveStoreId(row.location, stores);
                          const resolvedName = resolvedId ? stores.find((s) => s.id === resolvedId)?.name : null;
                          const locationBad = row.location && !resolvedId;
                          return (
                            <tr key={i} className={row._error ? "csvRowError" : ""}>
                              <td>{i + 1}</td>
                              <td>{row.name}</td>
                              <td>{row.email || "—"}</td>
                              <td>{row.phone || "—"}</td>
                              <td>{row.externalId || "—"}</td>
                              <td>
                                {resolvedName
                                  ? <span className="csvLocationOk">{resolvedName}</span>
                                  : locationBad
                                  ? <span className="csvErrorMsg">"{row.location}" not found</span>
                                  : <span className="csvMuted">—</span>}
                              </td>
                              <td>{row._error ? <span className="csvErrorMsg">{row._error}</span> : null}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {preview.length > 20 && <p className="csvPreviewMore">…and {preview.length - 20} more rows</p>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!result && (
          <div className="modalFooter">
            <button type="button" className="btn" onClick={runImport} disabled={importing || validCount === 0}>
              {importing ? "Importing…" : `Import ${validCount} Student${validCount !== 1 ? "s" : ""}`}
            </button>
            <button type="button" className="btnGhost" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

type BulkPreviewRow = {
  row: number;
  name: string;
  email: string | null;
  externalId: string | null;
  action: "create" | "update";
  imageFilename: string | null;
  imageFound: boolean | null;
};

type BulkPreviewResult = {
  total: number;
  valid: number;
  parseErrors: { row: number; error: string }[];
  preview: BulkPreviewRow[];
};

type BulkApplyResult = {
  created: number;
  updated: number;
  images: number;
  errors: { row?: number; customerId?: string; phase: string; error: string }[];
};

function BulkImportModal({
  organization,
  onClose,
  onDone,
}: {
  organization: Organization;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkPreviewResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applyResult, setApplyResult] = useState<BulkApplyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(null);
    setApplyResult(null);
    setErr(null);
  }

  async function runPreview() {
    if (!file) return;
    setPreviewing(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("organizationId", organization.id);
      const res = await fetch("/api/v1/customers/bulk-import/preview", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setPreview(json.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function runApply() {
    if (!file) return;
    setApplying(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("organizationId", organization.id);
      const res = await fetch("/api/v1/customers/bulk-import/apply", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setApplyResult(json.data);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal csvModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>Bulk Import — ZIP with CSV + Images</h3>
          <button type="button" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="modalBody">
          {applyResult ? (
            <div className="importResult">
              <p className="importResultSuccess">
                <span className="material-symbols-outlined fill" aria-hidden="true">check_circle</span>
                {applyResult.created} created, {applyResult.updated} updated, {applyResult.images} image{applyResult.images !== 1 ? "s" : ""} uploaded.
              </p>
              {applyResult.errors.length > 0 && (
                <div className="importErrors">
                  <strong>{applyResult.errors.length} error{applyResult.errors.length !== 1 ? "s" : ""}:</strong>
                  {applyResult.errors.map((e, i) => (
                    <p key={i} className="importErrorRow">[{e.phase}] {e.error}</p>
                  ))}
                </div>
              )}
              <button type="button" className="btn" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
            </div>
          ) : (
            <>
              <div className="csvColumns" style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px" }}>Upload a <strong>.zip</strong> containing:</p>
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                  <li><code>customers.csv</code> — one row per student with columns: <code>name</code>, <code>email</code>, <code>phone</code>, <code>external_id</code>, <code>image_filename</code></li>
                  <li><code>images/</code> folder — image files whose names match the <code>image_filename</code> column (e.g. <code>cristian.jpg</code>)</li>
                </ul>
                <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: "0.85em" }}>Images are optional — customers without a matching image are still imported.</p>
              </div>

              <div className="csvUploadArea">
                <input ref={fileRef} type="file" accept=".zip,application/zip" style={{ display: "none" }} onChange={handleFile} />
                <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                  <span className="material-symbols-outlined" aria-hidden="true">folder_zip</span>
                  {file ? file.name : "Choose ZIP File"}
                </button>
                {file && !preview && (
                  <button type="button" className="btn" onClick={() => void runPreview()} disabled={previewing}>
                    {previewing ? "Previewing…" : "Preview"}
                  </button>
                )}
              </div>

              {err && <p className="pageError" style={{ marginTop: 12 }}>{err}</p>}

              {preview && (
                <div className="csvPreview" style={{ marginTop: 16 }}>
                  <div className="csvPreviewHeader">
                    <span>{preview.valid} valid row{preview.valid !== 1 ? "s" : ""} of {preview.total}</span>
                    {preview.parseErrors.length > 0 && (
                      <span className="statusBadge statusBadge--warning">{preview.parseErrors.length} parse errors</span>
                    )}
                  </div>
                  <div className="csvPreviewTable">
                    <table>
                      <thead>
                        <tr><th>#</th><th>Name</th><th>Ext. ID</th><th>Action</th><th>Image</th></tr>
                      </thead>
                      <tbody>
                        {preview.preview.slice(0, 25).map((row) => (
                          <tr key={row.row}>
                            <td>{row.row}</td>
                            <td>{row.name}</td>
                            <td>{row.externalId || "—"}</td>
                            <td>
                              <span className={`statusBadge statusBadge--${row.action === "create" ? "success" : "warning"}`}>
                                {row.action}
                              </span>
                            </td>
                            <td>
                              {row.imageFilename === null ? (
                                <span className="csvMuted">—</span>
                              ) : row.imageFound ? (
                                <span className="csvLocationOk">{row.imageFilename}</span>
                              ) : (
                                <span className="csvErrorMsg">not found in ZIP</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.preview.length > 25 && (
                      <p className="csvPreviewMore">…and {preview.preview.length - 25} more rows</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!applyResult && preview && (
          <div className="modalFooter">
            <button type="button" className="btn" onClick={() => void runApply()} disabled={applying || preview.valid === 0}>
              {applying ? "Importing…" : `Import ${preview.valid} Student${preview.valid !== 1 ? "s" : ""}`}
            </button>
            <button type="button" className="btnGhost" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

type AddForm = {
  name: string;
  externalId: string;
  email: string;
  phone: string;
  homeStoreId: string;
};

const emptyForm: AddForm = { name: "", externalId: "", email: "", phone: "", homeStoreId: "" };

type CustomerWithLocation = DemoStudent & { homeStoreId?: string | null };

export function CustomersClient() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [students, setStudents] = useState<CustomerWithLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStore, setFilterStore] = useState<string>("");
  const [showImport, setShowImport] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  async function loadStudents(existingOrg?: Organization) {
    try {
      setError(null);
      const org = existingOrg || organization || (await loadCurrentOrganization());
      if (!existingOrg && !organization) setOrganization(org);

      const [customers, wallets, storeList] = await Promise.all([
        apiGet<CustomerWithLocation[]>(`/customers?organizationId=${org.id}`),
        apiGet<DemoStudent["wallet"][]>(`/wallets?organizationId=${org.id}`),
        stores.length === 0
          ? apiGet<Store[]>(`/stores?organizationId=${org.id}`)
          : Promise.resolve(stores)
      ]);

      if (stores.length === 0) setStores(storeList);

      const merged: CustomerWithLocation[] = customers.map((c) => ({
        ...c,
        wallet:
          wallets.find((w) => w.customerId === c.id) ||
          { id: "", organizationId: "", customerId: c.id, balanceCents: 0, currency: "USD", active: true }
      }));
      setStudents(merged);
      if (!selectedId && merged.length > 0) setSelectedId(merged[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load customers");
    }
  }

  useEffect(() => {
    void loadStudents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => students.find((s) => s.id === selectedId) || null, [students, selectedId]);

  const filtered = useMemo(() => {
    let list = students;
    if (filterStore) list = list.filter((s) => s.homeStoreId === filterStore);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.externalId?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.phone?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, search, filterStore]);

  const storeName = (id?: string | null) =>
    id ? (stores.find((s) => s.id === id)?.name ?? "Unknown location") : null;

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) { setAddError("Name is required"); return; }
    const org = organization || (await loadCurrentOrganization());
    if (!organization) setOrganization(org);
    setSaving(true);
    setAddError(null);
    try {
      await apiPost("/customers", {
        organizationId: org.id,
        name: form.name.trim(),
        externalId: form.externalId.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        homeStoreId: form.homeStoreId || null
      });
      setForm(emptyForm);
      setShowAdd(false);
      await loadStudents(org);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add customer");
    } finally {
      setSaving(false);
    }
  }

  async function handleLocationChange(customerId: string, homeStoreId: string | null) {
    if (!organization) return;
    try {
      await apiPatch(`/customers/${customerId}`, { organizationId: organization.id, homeStoreId });
      setStudents((prev) => prev.map((s) => s.id === customerId ? { ...s, homeStoreId } : s));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not update location");
    }
  }

  function field(key: keyof AddForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Student accounts" title="Customers">
        <button type="button" onClick={() => void loadStudents()}>Refresh</button>
        <button type="button" className="btnGhost" onClick={() => setShowImport(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">upload_file</span>
          Import CSV
        </button>
        <button type="button" className="btnGhost" onClick={() => setShowBulkImport(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">folder_zip</span>
          Bulk Import (ZIP)
        </button>
        <button type="button" onClick={() => { setShowAdd(true); setAddError(null); }}>
          + Add Customer
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      {showAdd && (
        <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="modal">
            <div className="modalHeader">
              <h3>Add Customer</h3>
              <button type="button" onClick={() => setShowAdd(false)}>
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="modalBody">
              {addError ? <p className="pageError">{addError}</p> : null}
              <form id="addCustomerForm" onSubmit={(e) => void handleAdd(e)} className="formGrid">
                <label className="formField">
                  Name <span className="required">*</span>
                  <input value={form.name} onChange={field("name")} placeholder="Full name" required />
                </label>
                <label className="formField">
                  Matricula / Student ID
                  <input value={form.externalId} onChange={field("externalId")} placeholder="e.g. 2024-0042" />
                </label>
                <label className="formField">
                  Home location
                  <select value={form.homeStoreId} onChange={field("homeStoreId")}>
                    <option value="">— No specific location —</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label className="formField">
                  Email
                  <input type="email" value={form.email} onChange={field("email")} placeholder="parent@email.com" />
                </label>
                <label className="formField">
                  Phone
                  <input type="tel" value={form.phone} onChange={field("phone")} placeholder="+1 555 000 0000" />
                </label>
              </form>
            </div>
            <div className="modalFooter">
              <button type="submit" form="addCustomerForm" className="btn" disabled={saving}>
                {saving ? "Saving…" : "Add Customer"}
              </button>
              <button type="button" className="btnGhost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="splitPanel">
        <div>
          <div className="toolbar">
            <input
              placeholder="Search name, matricula, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {stores.length > 1 && (
              <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="toolbarSelect">
                <option value="">All locations</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>
          <DataTable
            headers={["Student", "Matricula", "Location", "Wallet", "Status"]}
            rows={filtered.map((s) => [
              s.name || "Unnamed",
              s.externalId || "-",
              storeName(s.homeStoreId) || "—",
              formatMoney(s.wallet.balanceCents),
              s.active ? "Active" : "Inactive"
            ])}
            statusIndex={4}
            onRowClick={(index) => setSelectedId(filtered[index]?.id || "")}
            activeRowIndex={filtered.findIndex((s) => s.id === selectedId)}
          />
        </div>

        <aside className="detailPanel">
          <span>Customer profile</span>
          {selected && organization && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "8px 0" }}>
              <AvatarUpload
                publicId={(selected as { avatarPublicId?: string }).avatarPublicId}
                entityType="student"
                entityId={selected.id}
                organizationId={organization.id}
                size={56}
                onUploaded={(pid) => {
                  setStudents((prev) =>
                    prev.map((c) => c.id === selected.id ? { ...c, avatarPublicId: pid } : c)
                  );
                }}
              />
              <h3 style={{ margin: 0 }}>{selected.name || "Unnamed"}</h3>
            </div>
          )}
          {!selected && <h3>Select a customer</h3>}
          {selected ? (
            <>
              <StatusBadge value={selected.externalStudentId ? "Linked to Spelling App" : "Standalone"} />
              <dl style={{ marginTop: "1rem" }}>
                <div><dt>Wallet balance</dt><dd>{formatMoney(selected.wallet.balanceCents)}</dd></div>
                <div><dt>Matricula</dt><dd>{selected.externalId || "-"}</dd></div>
                <div><dt>Email</dt><dd>{selected.email || "-"}</dd></div>
                <div><dt>Phone</dt><dd>{selected.phone || "-"}</dd></div>
                <div>
                  <dt>Home location</dt>
                  <dd>
                    <select
                      value={selected.homeStoreId || ""}
                      onChange={(e) => void handleLocationChange(selected.id, e.target.value || null)}
                      style={{ fontSize: "0.9rem" }}
                    >
                      <option value="">— No location —</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </dd>
                </div>
                {selected.externalStudentId && (
                  <div>
                    <dt>Spelling App ID</dt>
                    <dd style={{ fontFamily: "monospace", fontSize: 12 }}>{selected.externalStudentId.slice(0, 8)}…</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p>Select a customer from the list to view their profile.</p>
          )}
        </aside>
      </div>

      {showImport && organization && (
        <StudentImportModal
          organization={organization}
          stores={stores}
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); void loadStudents(); }}
        />
      )}
      {showBulkImport && organization && (
        <BulkImportModal
          organization={organization}
          onClose={() => setShowBulkImport(false)}
          onDone={() => { setShowBulkImport(false); void loadStudents(); }}
        />
      )}
    </section>
  );
}
