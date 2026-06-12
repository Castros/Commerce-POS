"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { Organization, Store } from "../lib/demoTypes";
import { useLanguage } from "../lib/i18n/LanguageContext";


type EmpCsvPreviewRow = {
  row: number;
  name: string;
  email: string | null;
  department: string | null;
  jobTitle: string | null;
  employeeNumber: string | null;
  status: "create" | "update";
};

type EmpCsvPreview = {
  total: number;
  valid: number;
  errors: { row: number; error: string }[];
  preview: EmpCsvPreviewRow[];
};

type EmpCsvResult = { created: number; updated: number; skipped: number; errors: { row: number; error: string }[] };

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
  const { t } = useLanguage();
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

  // CSV import state
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<EmpCsvPreview | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importResult, setImportResult] = useState<EmpCsvResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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

  function downloadImportTemplate() {
    const csv = `name,email,department,job_title,employee_number,deduction_cycle\nJane Doe,jane@example.com,Kitchen,Cook,EMP-001,monthly\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    if (!organization) return;
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("organizationId", organization.id);
      const res = await fetch("/api/v1/employees/import/preview", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: EmpCsvPreview; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setImportPreview(json.data!);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setImportPreviewing(false);
    }
  }

  async function applyEmployeeImport() {
    if (!organization || !importFile) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("organizationId", organization.id);
      const res = await fetch("/api/v1/employees/import/apply", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: EmpCsvResult; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setImportResult(json.data!);
      void load(organization);
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
        <button type="button" onClick={() => setShowImport(true)}>
          {t("common.importCsv")}
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

      {/* ── CSV Import overlay ── */}
      {showImport && (
        <div className="importOverlay">
          <div className="importPanel">
            <div className="importPanelHeader">
              <strong>{t("employees.import.title")}</strong>
              <button type="button" className="importPanelClose" onClick={closeImport}>✕</button>
            </div>

            {!importResult ? (
              <>
                <div className="importInstructions">
                  <p>
                    {t("employees.import.instructions")} <code>name</code>.{" "}
                    {t("employees.import.optionalColumns")} <code>email</code>, <code>department</code>, <code>job_title</code>, <code>employee_number</code>, <code>deduction_cycle</code>.
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
                    <span>{t("employees.import.dropZone")}</span>
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

                {importPreviewing && <p className="importHint">{t("employees.import.parsing")}</p>}
                {importError && <p className="demoError">{importError}</p>}

                {importPreview && (
                  <>
                    <div className="importSummaryBar">
                      <span className="importSummaryItem importSummaryItem--ok">
                        {importPreview.preview.filter((r) => r.status === "create").length} {t("employees.import.toCreate")}
                      </span>
                      {importPreview.preview.filter((r) => r.status === "update").length > 0 && (
                        <span className="importSummaryItem importSummaryItem--skip">
                          {importPreview.preview.filter((r) => r.status === "update").length} {t("employees.import.toUpdate")}
                        </span>
                      )}
                      {importPreview.errors.length > 0 && (
                        <span className="importSummaryItem importSummaryItem--err">
                          {importPreview.errors.length} {t("employees.import.errorsFound")}
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
                            <th>{t("employees.import.colName")}</th>
                            <th>{t("employees.import.colEmail")}</th>
                            <th>{t("employees.import.colDepartment")}</th>
                            <th>{t("employees.import.colJobTitle")}</th>
                            <th>{t("employees.import.colNumber")}</th>
                            <th>{t("employees.import.colStatus")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.preview.map((row) => (
                            <tr key={row.row} className={row.status === "update" ? "importRowSkip" : ""}>
                              <td>{row.name}</td>
                              <td>{row.email ?? "—"}</td>
                              <td>{row.department ?? "—"}</td>
                              <td>{row.jobTitle ?? "—"}</td>
                              <td>{row.employeeNumber ?? "—"}</td>
                              <td>
                                <span className={`importStatusBadge importStatusBadge--${row.status}`}>
                                  {row.status === "update" ? t("employees.import.updateLabel") : t("employees.import.createLabel")}
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
                        onClick={() => void applyEmployeeImport()}
                        disabled={importApplying || importPreview.valid === 0}
                      >
                        {importApplying
                          ? t("employees.import.importing")
                          : `${t("employees.import.confirmBtn")} ${importPreview.valid} ${t("employees.import.employeesLabel")}`}
                      </button>
                      <button type="button" onClick={closeImport}>{t("common.cancel")}</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="importResultPanel">
                <span className="material-symbols-outlined importResultIcon">check_circle</span>
                <h3>{t("employees.import.doneTitle")}</h3>
                {importResult.created > 0 && <p><strong>{importResult.created}</strong> {t("employees.import.created")}</p>}
                {importResult.updated > 0 && <p><strong>{importResult.updated}</strong> {t("employees.import.updated")}</p>}
                {importResult.skipped > 0 && <p>{importResult.skipped} {t("employees.import.skipped")}</p>}
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
    </div>
  );
}
