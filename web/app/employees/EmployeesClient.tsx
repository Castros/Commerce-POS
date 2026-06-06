"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { Organization, Store } from "../lib/demoTypes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveStoreId(raw: string, stores: Store[]): string | null {
  if (!raw) return null;
  if (UUID_RE.test(raw)) return stores.some((s) => s.id === raw) ? raw : null;
  return stores.find((s) => s.name.toLowerCase() === raw.toLowerCase())?.id ?? null;
}

function buildEmployeeTemplate(stores: Store[]): string {
  const loc1 = stores[0]?.name ?? "Main Cafeteria";
  const loc2 = stores[1]?.name ?? loc1;
  return (
    `name,email,phone,employee_number,department,job_title,payroll_deduction_enabled,deduction_cycle,credit_limit,home_location\n` +
    `María González,maria@school.mx,5551234567,EMP-001,Teaching,3rd Grade Teacher,true,biweekly,500,${loc1}\n` +
    `Roberto Díaz,,5559876543,EMP-002,Administration,Principal,true,monthly,500,${loc2}\n` +
    `Ana Torres,ana@school.mx,,EMP-003,Support,Custodian,true,biweekly,200,\n`
  );
}

type EmpImportRow = {
  name: string;
  email: string;
  phone: string;
  location: string;
  employeeNumber: string;
  department: string;
  jobTitle: string;
  payrollDeductionEnabled: boolean;
  deductionCycle: "weekly" | "biweekly" | "monthly";
  maxCreditCents: number;
  _error?: string;
};

function parseEmployeeCsv(text: string): EmpImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (col: string) => header.indexOf(col);
  const get = (cells: string[], col: string) => (cells[idx(col)] || "").replace(/^"|"$/g, "").trim();

  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const name = get(cells, "name");
    const cycleRaw = get(cells, "deduction_cycle").toLowerCase();
    const cycle = ["weekly", "biweekly", "monthly"].includes(cycleRaw)
      ? (cycleRaw as "weekly" | "biweekly" | "monthly")
      : "biweekly";
    const creditRaw = parseFloat(get(cells, "credit_limit") || "500");
    const maxCreditCents = isFinite(creditRaw) ? Math.round(creditRaw * 100) : 50000;
    const dedRaw = get(cells, "payroll_deduction_enabled").toLowerCase();
    const payrollDeductionEnabled = dedRaw !== "false" && dedRaw !== "0";
    return {
      name,
      email: get(cells, "email"),
      phone: get(cells, "phone"),
      location: get(cells, "home_location") || get(cells, "home_store_id"),
      employeeNumber: get(cells, "employee_number"),
      department: get(cells, "department"),
      jobTitle: get(cells, "job_title"),
      payrollDeductionEnabled,
      deductionCycle: cycle,
      maxCreditCents,
      _error: !name ? "Name is required" : undefined
    };
  }).filter((r) => r.name || r.employeeNumber || r.email);
}

function EmployeeImportModal({
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
  const [preview, setPreview] = useState<EmpImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    updated: number;
    errors: { row: number; name: string; error: string }[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      setPreview(parseEmployeeCsv(text));
      setResult(null);
    };
    reader.readAsText(file);
  }

  function handlePaste(text: string) {
    setCsvText(text);
    setPreview(parseEmployeeCsv(text));
    setResult(null);
  }

  function downloadTemplate() {
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(buildEmployeeTemplate(stores));
    a.download = "employees-template.csv";
    a.click();
  }

  async function runImport() {
    if (!preview.length) return;
    const valid = preview.filter((r) => !r._error);
    if (!valid.length) return;
    setImporting(true);
    setImportError(null);
    try {
      const data = await apiPost<{ imported: number; updated: number; errors: { row: number; name: string; error: string }[] }>(
        "/employees/import",
        {
          organizationId: organization.id,
          rows: valid.map((r) => ({
            name: r.name,
            email: r.email || null,
            phone: r.phone || null,
            homeStoreId: resolveStoreId(r.location, stores),
            employeeNumber: r.employeeNumber || null,
            department: r.department || null,
            jobTitle: r.jobTitle || null,
            payrollDeductionEnabled: r.payrollDeductionEnabled,
            deductionCycle: r.deductionCycle,
            maxCreditCents: r.maxCreditCents
          }))
        }
      );
      setResult(data);
      if (data.errors.length === 0) {
        onDone();
      }
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
          <h3>Import Employees via CSV</h3>
          <button type="button" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="modalBody">
          {result ? (
            <div className="importResult">
              <p className="importResultSuccess">
                <span className="material-symbols-outlined fill" aria-hidden="true">check_circle</span>
                {result.imported} created, {result.updated} updated.
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
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={handleFile}
                />
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
                <code>employee_number</code>
                <code>department</code>
                <code>job_title</code>
                <code>payroll_deduction_enabled</code>
                <code>deduction_cycle</code>
                <code>credit_limit</code>
                <code>home_location</code>
                <span className="csvColumnNote">(employee_number used to match existing records; home_location accepts store name or ID)</span>
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
                onChange={(e) => handlePaste(e.target.value)}
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
                        <tr>
                          <th>#</th>
                          <th>Name</th>
                          <th>Emp #</th>
                          <th>Department</th>
                          <th>Location</th>
                          <th>Cycle</th>
                          <th>Limit</th>
                          <th></th>
                        </tr>
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
                              <td>{row.employeeNumber || "—"}</td>
                              <td>{row.department || "—"}</td>
                              <td>
                                {resolvedName
                                  ? <span className="csvLocationOk">{resolvedName}</span>
                                  : locationBad
                                  ? <span className="csvErrorMsg">"{row.location}" not found</span>
                                  : <span className="csvMuted">—</span>}
                              </td>
                              <td>{row.deductionCycle}</td>
                              <td>${(row.maxCreditCents / 100).toFixed(0)}</td>
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
            <button
              type="button"
              className="btn"
              onClick={runImport}
              disabled={importing || validCount === 0}
            >
              {importing ? "Importing…" : `Import ${validCount} Employee${validCount !== 1 ? "s" : ""}`}
            </button>
            <button type="button" className="btnGhost" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

type EmployeeProfile = {
  id: string;
  employeeNumber: string | null;
  department: string | null;
  jobTitle: string | null;
  payrollDeductionEnabled: boolean;
  deductionCycle: "weekly" | "biweekly" | "monthly";
  maxCreditCents: number;
  active: boolean;
  updatedAt: string;
};

type EmployeeWallet = {
  id: string;
  balanceCents: number;
  creditLimitCents: number;
  currency: string;
};

type Employee = {
  id: string;
  organizationId: string;
  customerType: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  homeStoreId: string | null;
  createdAt: string;
  profile: EmployeeProfile | null;
  wallet: EmployeeWallet | null;
};

type CreateForm = {
  name: string;
  email: string;
  phone: string;
  homeStoreId: string;
  employeeNumber: string;
  department: string;
  jobTitle: string;
  payrollDeductionEnabled: boolean;
  deductionCycle: "weekly" | "biweekly" | "monthly";
  maxCreditCents: number;
};

const emptyCreate: CreateForm = {
  name: "",
  email: "",
  phone: "",
  homeStoreId: "",
  employeeNumber: "",
  department: "",
  jobTitle: "",
  payrollDeductionEnabled: true,
  deductionCycle: "biweekly",
  maxCreditCents: 50000
};

export function EmployeesClient() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreate);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [editForm, setEditForm] = useState<{
    name?: string;
    email?: string;
    phone?: string;
    homeStoreId?: string;
    employeeNumber?: string;
    department?: string;
    jobTitle?: string;
    payrollDeductionEnabled?: boolean;
    deductionCycle?: "weekly" | "biweekly" | "monthly";
    maxCreditCents?: number;
    active?: boolean;
  }>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function load(org?: Organization) {
    try {
      setError(null);
      const currentOrg = org || organization || (await loadCurrentOrganization());
      if (!organization) setOrganization(currentOrg);

      const params = new URLSearchParams({ organizationId: currentOrg.id });
      if (search) params.set("q", search);
      if (filterDept) params.set("department", filterDept);

      const [data, storeList] = await Promise.all([
        apiGet<Employee[]>(`/employees?${params}`),
        stores.length === 0 ? apiGet<Store[]>(`/stores?organizationId=${currentOrg.id}`) : Promise.resolve(stores)
      ]);

      setEmployees(data);
      if (stores.length === 0) setStores(storeList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load employees");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (organization) void load(organization);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterDept]);

  const departments = Array.from(
    new Set(employees.map((e) => e.profile?.department).filter(Boolean) as string[])
  ).sort();

  const storeName = (id?: string | null) =>
    id ? (stores.find((s) => s.id === id)?.name ?? "Unknown location") : null;

  const visibleEmployees = filterStore
    ? employees.filter((e) => e.homeStoreId === filterStore)
    : employees;

  async function create() {
    if (!organization) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiPost<Employee>("/employees", {
        organizationId: organization.id,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        homeStoreId: form.homeStoreId || null,
        employeeNumber: form.employeeNumber || null,
        department: form.department || null,
        jobTitle: form.jobTitle || null,
        payrollDeductionEnabled: form.payrollDeductionEnabled,
        deductionCycle: form.deductionCycle,
        maxCreditCents: form.maxCreditCents
      });
      setForm(emptyCreate);
      setShowCreate(false);
      await load(organization);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(emp: Employee) {
    setSelected(emp);
    setEditForm({
      name: emp.name,
      email: emp.email || "",
      phone: emp.phone || "",
      homeStoreId: emp.homeStoreId || "",
      employeeNumber: emp.profile?.employeeNumber || "",
      department: emp.profile?.department || "",
      jobTitle: emp.profile?.jobTitle || "",
      payrollDeductionEnabled: emp.profile?.payrollDeductionEnabled ?? true,
      deductionCycle: emp.profile?.deductionCycle ?? "biweekly",
      maxCreditCents: emp.profile?.maxCreditCents ?? 50000,
      active: emp.active
    });
    setEditError(null);
  }

  async function saveEdit() {
    if (!selected || !organization) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await apiPatch<Employee>(`/employees/${selected.id}`, {
        organizationId: organization.id,
        ...editForm,
        email: editForm.email || null,
        phone: editForm.phone || null,
        homeStoreId: editForm.homeStoreId || null,
        employeeNumber: (editForm.employeeNumber as string) || null,
        department: (editForm.department as string) || null,
        jobTitle: (editForm.jobTitle as string) || null
      });
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setSelected(updated);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  const cycleLabel: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Bi-weekly",
    monthly: "Monthly"
  };

  return (
    <div className="pageContent">
      <PageHeader eyebrow="Workforce" title="Employees">
        <button type="button" className="btnGhost" onClick={() => setShowImport(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">upload_file</span>
          Import CSV
        </button>
        <button type="button" className="btn" onClick={() => setShowCreate(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            person_add
          </span>
          Add Employee
        </button>
      </PageHeader>

      {error && <p className="pageError">{error}</p>}

      <div className="empLayout">
        <div className="empList">
          <div className="empFilters">
            <label className="empSearchLabel">
              <span className="material-symbols-outlined" aria-hidden="true">
                search
              </span>
              <input
                placeholder="Name, email, employee #, department"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="empSearchInput"
              />
            </label>
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="empSelect">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {stores.length > 1 && (
              <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)} className="empSelect">
                <option value="">All locations</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <p className="empEmpty">Loading employees…</p>
          ) : visibleEmployees.length === 0 ? (
            <p className="empEmpty">No employees found. Add your first employee to get started.</p>
          ) : (
            <div className="empRows">
              {visibleEmployees.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  className={`empRow${selected?.id === emp.id ? " empRow--active" : ""}${!emp.active ? " empRow--inactive" : ""}`}
                  onClick={() => openEdit(emp)}
                >
                  <div className="empRowAvatar">
                    {emp.name
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="empRowInfo">
                    <strong>{emp.name}</strong>
                    <span>{emp.profile?.department || "—"}</span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {emp.profile?.employeeNumber && (
                        <span className="empRowBadge"># {emp.profile.employeeNumber}</span>
                      )}
                      {emp.homeStoreId && (
                        <span className="empRowBadge empRowBadge--location">
                          <span className="material-symbols-outlined" style={{ fontSize: 12 }} aria-hidden="true">location_on</span>
                          {storeName(emp.homeStoreId)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="empRowRight">
                    <span
                      className={`empBalance${emp.wallet && emp.wallet.balanceCents < 0 ? " empBalance--negative" : ""}`}
                    >
                      {emp.wallet ? formatMoney(emp.wallet.balanceCents) : "—"}
                    </span>
                    {!emp.active && <span className="empInactivePill">Inactive</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          <div className="empDetail">
            <div className="empDetailHeader">
              <div className="empDetailAvatar">
                {selected.name
                  .split(" ")
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()}
              </div>
              <div>
                <h3>{selected.name}</h3>
                <p>{selected.profile?.jobTitle || selected.profile?.department || "Employee"}</p>
              </div>
            </div>

            {selected.wallet && (
              <div className="empWalletCard">
                <div className="empWalletRow">
                  <span>Current Balance</span>
                  <strong
                    className={selected.wallet.balanceCents < 0 ? "empBalance--negative" : "empBalance--positive"}
                  >
                    {formatMoney(selected.wallet.balanceCents)}
                  </strong>
                </div>
                <div className="empWalletRow">
                  <span>Credit Limit</span>
                  <span>{formatMoney(selected.wallet.creditLimitCents)}</span>
                </div>
                {selected.wallet.balanceCents < 0 && (
                  <p className="empWalletNote">
                    Owed: {formatMoney(Math.abs(selected.wallet.balanceCents))} — will appear on next payroll cycle
                  </p>
                )}
              </div>
            )}

            <div className="empDetailForm">
              {editError && <p className="pageError">{editError}</p>}

              <div className="formRow">
                <label>Full Name</label>
                <input
                  value={editForm.name || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Email</label>
                  <input
                    type="email"
                    value={editForm.email || ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="formRow">
                  <label>Phone</label>
                  <input
                    value={editForm.phone || ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="formRow">
                <label>Home Location</label>
                <select
                  value={editForm.homeStoreId || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, homeStoreId: e.target.value }))}
                >
                  <option value="">— No specific location —</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Employee #</label>
                  <input
                    value={editForm.employeeNumber || ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, employeeNumber: e.target.value }))}
                  />
                </div>
                <div className="formRow">
                  <label>Department</label>
                  <input
                    value={editForm.department || ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                  />
                </div>
              </div>
              <div className="formRow">
                <label>Job Title</label>
                <input
                  value={editForm.jobTitle || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, jobTitle: e.target.value }))}
                />
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Deduction Cycle</label>
                  <select
                    value={editForm.deductionCycle || "biweekly"}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        deductionCycle: e.target.value as "weekly" | "biweekly" | "monthly"
                      }))
                    }
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="formRow">
                  <label>Credit Limit ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={(editForm.maxCreditCents ?? 50000) / 100}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, maxCreditCents: Math.round(Number(e.target.value) * 100) }))
                    }
                  />
                </div>
              </div>
              <div className="formRow formRow--check">
                <label>
                  <input
                    type="checkbox"
                    checked={editForm.payrollDeductionEnabled ?? true}
                    onChange={(e) => setEditForm((f) => ({ ...f, payrollDeductionEnabled: e.target.checked }))}
                  />
                  Payroll deduction enabled
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editForm.active ?? true}
                    onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                  />
                  Active
                </label>
              </div>

              <div className="empDetailActions">
                <button type="button" className="btn" onClick={saveEdit} disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </button>
                <button type="button" className="btnGhost" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="empDetailEmpty">
            <span className="material-symbols-outlined" aria-hidden="true">
              badge
            </span>
            <p>Select an employee to view or edit their profile</p>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="modalOverlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3>Add Employee</h3>
              <button type="button" onClick={() => setShowCreate(false)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            {formError && <p className="pageError">{formError}</p>}
            <div className="modalBody">
              <div className="formRow">
                <label>Full Name *</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="formRow">
                  <label>Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="formRow">
                <label>Home Location</label>
                <select
                  value={form.homeStoreId}
                  onChange={(e) => setForm((f) => ({ ...f, homeStoreId: e.target.value }))}
                >
                  <option value="">— No specific location —</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Employee #</label>
                  <input
                    value={form.employeeNumber}
                    onChange={(e) => setForm((f) => ({ ...f, employeeNumber: e.target.value }))}
                  />
                </div>
                <div className="formRow">
                  <label>Department</label>
                  <input
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  />
                </div>
              </div>
              <div className="formRow">
                <label>Job Title</label>
                <input
                  value={form.jobTitle}
                  onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
                />
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Deduction Cycle</label>
                  <select
                    value={form.deductionCycle}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        deductionCycle: e.target.value as "weekly" | "biweekly" | "monthly"
                      }))
                    }
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="formRow">
                  <label>Credit Limit ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={form.maxCreditCents / 100}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, maxCreditCents: Math.round(Number(e.target.value) * 100) }))
                    }
                  />
                </div>
              </div>
              <div className="formRow formRow--check">
                <label>
                  <input
                    type="checkbox"
                    checked={form.payrollDeductionEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, payrollDeductionEnabled: e.target.checked }))}
                  />
                  Enable payroll deduction
                </label>
              </div>
            </div>
            <div className="modalFooter">
              <button type="button" className="btn" onClick={create} disabled={saving || !form.name}>
                {saving ? "Creating…" : "Create Employee"}
              </button>
              <button type="button" className="btnGhost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && organization && (
        <EmployeeImportModal
          organization={organization}
          stores={stores}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            void load(organization);
          }}
        />
      )}
    </div>
  );
}
