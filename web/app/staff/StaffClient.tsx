"use client";

import { useEffect, useRef, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import AvatarUpload from "../components/AvatarUpload";
import { apiGet, apiPatch, apiPost, apiPut } from "../lib/api";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { Category, Store } from "../lib/demoTypes";
import { useLanguage } from "../lib/i18n/LanguageContext";

type StaffMember = {
  id: string;
  organizationId: string;
  name: string | null;
  email: string | null;
  role: string;
  active: boolean;
  pinLast4: string | null;
  pinSetAt: string | null;
  createdAt: string;
  storeIds: string[];
  avatarPublicId?: string | null;
};

type FormState = {
  name: string;
  email: string;
  role: string;
  pin: string;
  storeIds: string[];
  categoryIds: string[];
  active: boolean;
};

const ROLES = [
  { value: "organization_admin", label: "Organization Admin" },
  { value: "store_manager", label: "Store Manager" },
  { value: "cashier", label: "Cashier" },
  { value: "accountant", label: "Accountant" }
];

const ROLE_COLORS: Record<string, string> = {
  organization_admin: "primary",
  store_manager: "warning",
  cashier: "success",
  accountant: "muted"
};

const CATEGORY_RESTRICTED_ROLES = new Set(["store_manager", "cashier", "accountant"]);

type StaffCsvPreviewRow = {
  row: number;
  name: string;
  email: string | null;
  role: string | null;
  status: "create" | "skip";
};

type StaffCsvPreview = {
  total: number;
  valid: number;
  errors: { row: number; error: string }[];
  preview: StaffCsvPreviewRow[];
};

type StaffCsvResult = { created: number; skipped: number; errors: { row: number; error: string }[] };

function blankForm(): FormState {
  return { name: "", email: "", role: "cashier", pin: "", storeIds: [], categoryIds: [], active: true };
}

function staffToForm(s: StaffMember): FormState {
  return {
    name: s.name || "",
    email: s.email || "",
    role: s.role,
    pin: "",
    storeIds: s.storeIds,
    categoryIds: [],
    active: s.active
  };
}

export function StaffClient() {
  const { t } = useLanguage();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [panel, setPanel] = useState<"none" | "create" | "edit" | "pin">("none");
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);

  // CSV import state
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<StaffCsvPreview | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importResult, setImportResult] = useState<StaffCsvResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setMessage(null);
    try {
      const org = await loadCurrentOrganization();
      setOrganizationId(org.id);
      const [staffData, storeData, catResult] = await Promise.all([
        apiGet<StaffMember[]>(`/staff?organizationId=${org.id}`),
        apiGet<Store[]>(`/stores?organizationId=${org.id}`),
        apiGet<Category[]>(`/product-categories?organizationId=${org.id}`).catch(() => [] as Category[])
      ]);
      setStaff(staffData);
      setStores(storeData);
      setCategories(catResult);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not load staff", type: "err" });
    } finally {
      setLoading(false);
    }
  }

  function downloadImportTemplate() {
    const csv = `name,email,role,pin,phone\nJohn Cashier,cashier@school.com,cashier,1234,\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "staff-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    if (!organizationId) return;
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("organizationId", organizationId);
      const res = await fetch("/api/v1/staff/import/preview", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: StaffCsvPreview; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setImportPreview(json.data!);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setImportPreviewing(false);
    }
  }

  async function applyStaffImport() {
    if (!organizationId || !importFile) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("organizationId", organizationId);
      const res = await fetch("/api/v1/staff/import/apply", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: StaffCsvResult; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setImportResult(json.data!);
      void loadAll();
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

  function openCreate() {
    setForm(blankForm());
    setEditTarget(null);
    setPanel("create");
    setMessage(null);
  }

  async function openEdit(member: StaffMember) {
    const base = staffToForm(member);
    setForm(base);
    setEditTarget(member);
    setPanel("edit");
    setMessage(null);

    try {
      const perms = await apiGet<{ id: string; categoryIds: string[] }>(
        `/staff/${member.id}/category-permissions`
      );
      setForm((f) => ({ ...f, categoryIds: perms.categoryIds }));
    } catch {
      // keep empty — will treat as unrestricted
    }
  }

  function openPin(member: StaffMember) {
    setForm({ ...staffToForm(member), pin: "" });
    setEditTarget(member);
    setPanel("pin");
    setMessage(null);
  }

  function closePanel() {
    setPanel("none");
    setEditTarget(null);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleStore(storeId: string) {
    setForm((f) => ({
      ...f,
      storeIds: f.storeIds.includes(storeId)
        ? f.storeIds.filter((id) => id !== storeId)
        : [...f.storeIds, storeId]
    }));
  }

  function toggleCategoryId(catId: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(catId)
        ? f.categoryIds.filter((id) => id !== catId)
        : [...f.categoryIds, catId]
    }));
  }

  async function handleCreate() {
    if (!organizationId) return;
    setSaving(true);
    setMessage(null);
    try {
      const created = await apiPost<StaffMember>("/staff", {
        organizationId,
        name: form.name.trim(),
        email: form.email.trim() || null,
        role: form.role,
        pin: form.pin,
        storeIds: form.storeIds
      });
      setStaff((s) => [...s, created]);
      closePanel();
      setMessage({ text: `${created.name || "Staff member"} added successfully.`, type: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not create staff", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiPatch<StaffMember>(`/staff/${editTarget.id}`, {
        name: form.name.trim(),
        email: form.email.trim() || null,
        role: form.role,
        active: form.active
      });

      await Promise.all([
        apiPut(`/staff/${editTarget.id}/stores`, { storeIds: form.storeIds }),
        apiPut(`/staff/${editTarget.id}/category-permissions`, { categoryIds: form.categoryIds })
      ]);

      setStaff((s) => s.map((m) => (m.id === updated.id ? { ...updated, storeIds: form.storeIds } : m)));
      closePanel();
      setMessage({ text: `${updated.name || "Staff member"} updated.`, type: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not update staff", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPin() {
    if (!editTarget) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiPost<StaffMember>(`/staff/${editTarget.id}/pin`, { pin: form.pin });
      setStaff((s) => s.map((m) => (m.id === updated.id ? { ...m, pinLast4: updated.pinLast4, pinSetAt: updated.pinSetAt } : m)));
      closePanel();
      setMessage({ text: `PIN updated for ${editTarget.name || "staff member"}.`, type: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not set PIN", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(member: StaffMember) {
    try {
      const updated = await apiPatch<StaffMember>(`/staff/${member.id}`, { active: !member.active });
      setStaff((s) => s.map((m) => (m.id === updated.id ? { ...m, active: updated.active } : m)));
      setMessage({ text: `${updated.name || "Staff member"} ${updated.active ? "reactivated" : "deactivated"}.`, type: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not update status", type: "err" });
    }
  }

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  const activeCount = staff.filter((s) => s.active).length;

  const showCategoryAccess =
    panel === "edit" && CATEGORY_RESTRICTED_ROLES.has(form.role);

  return (
    <section className="module">
      <PageHeader eyebrow="Admin" title="Staff & Permissions">
        <button type="button" onClick={loadAll} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button type="button" onClick={() => setShowImport(true)}>
          {t("common.importCsv")}
        </button>
        <button type="button" className="primaryAction" onClick={openCreate}>
          Add staff
        </button>
      </PageHeader>

      {message ? (
        <p className={`demoError${message.type === "ok" ? " success" : ""}`} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="statsRow">
        <div className="statCard">
          <span>{staff.length}</span>
          <small>Total staff</small>
        </div>
        <div className="statCard">
          <span>{activeCount}</span>
          <small>Active</small>
        </div>
        <div className="statCard">
          <span>{staff.filter((s) => s.pinLast4).length}</span>
          <small>PIN set</small>
        </div>
        <div className="statCard">
          <span>{stores.length}</span>
          <small>Locations</small>
        </div>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Locations</th>
              <th>PIN</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>Loading staff...</td>
              </tr>
            ) : staff.length === 0 ? (
              <tr>
                <td colSpan={6}>No staff members found. Add your first staff member above.</td>
              </tr>
            ) : (
              staff.map((member) => (
                <tr key={member.id} className={member.active ? "" : "rowMuted"}>
                  <td>
                    <strong>{member.name || "—"}</strong>
                    {member.email ? <small style={{ display: "block", color: "var(--muted)" }}>{member.email}</small> : null}
                  </td>
                  <td>
                    <span className={`badge ${ROLE_COLORS[member.role] ?? "muted"}`}>
                      {member.role.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>
                    {member.storeIds.length === 0 ? (
                      <span style={{ color: "var(--muted)" }}>All / unassigned</span>
                    ) : (
                      member.storeIds.map((id) => (
                        <span key={id} className="badge muted" style={{ marginRight: 4 }}>
                          {storeName(id)}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    {member.pinLast4 ? (
                      <span style={{ fontFamily: "monospace" }}>••••{member.pinLast4}</span>
                    ) : (
                      <span className="badge danger">Not set</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${member.active ? "success" : "muted"}`}>
                      {member.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="tableAction" onClick={() => void openEdit(member)}>
                        Edit
                      </button>
                      <button type="button" className="tableAction" onClick={() => openPin(member)}>
                        Set PIN
                      </button>
                      <button
                        type="button"
                        className="tableAction"
                        onClick={() => void toggleActive(member)}
                      >
                        {member.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── CSV Import overlay ── */}
      {showImport && (
        <div className="importOverlay">
          <div className="importPanel">
            <div className="importPanelHeader">
              <strong>{t("staff.import.title")}</strong>
              <button type="button" className="importPanelClose" onClick={closeImport}>✕</button>
            </div>

            {!importResult ? (
              <>
                <div className="importInstructions">
                  <p>
                    {t("staff.import.instructions")} <code>name</code>, <code>email</code>, <code>role</code>, <code>pin</code>.{" "}
                    {t("staff.import.optionalColumns")} <code>phone</code>.
                  </p>
                  <p className="importHint">{t("staff.import.roleNote")}</p>
                  <p className="importHint">{t("staff.import.pinNote")}</p>
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
                    <span>{t("staff.import.dropZone")}</span>
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

                {importPreviewing && <p className="importHint">{t("staff.import.parsing")}</p>}
                {importError && <p className="demoError">{importError}</p>}

                {importPreview && (
                  <>
                    <div className="importSummaryBar">
                      <span className="importSummaryItem importSummaryItem--ok">
                        {importPreview.preview.filter((r) => r.status === "create").length} {t("staff.import.toCreate")}
                      </span>
                      {importPreview.preview.filter((r) => r.status === "skip").length > 0 && (
                        <span className="importSummaryItem importSummaryItem--skip">
                          {importPreview.preview.filter((r) => r.status === "skip").length} {t("staff.import.skipped")}
                        </span>
                      )}
                      {importPreview.errors.length > 0 && (
                        <span className="importSummaryItem importSummaryItem--err">
                          {importPreview.errors.length} {t("staff.import.errorsFound")}
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
                            <th>{t("staff.import.colName")}</th>
                            <th>{t("staff.import.colEmail")}</th>
                            <th>{t("staff.import.colRole")}</th>
                            <th>{t("staff.import.colStatus")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.preview.map((row) => (
                            <tr key={row.row} className={row.status === "skip" ? "importRowSkip" : ""}>
                              <td>{row.name}</td>
                              <td>{row.email ?? "—"}</td>
                              <td>{row.role ?? "—"}</td>
                              <td>
                                <span className={`importStatusBadge importStatusBadge--${row.status}`}>
                                  {row.status === "skip" ? t("staff.import.skipLabel") : t("staff.import.createLabel")}
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
                        onClick={() => void applyStaffImport()}
                        disabled={importApplying || importPreview.preview.filter((r) => r.status === "create").length === 0}
                      >
                        {importApplying
                          ? t("staff.import.importing")
                          : `${t("staff.import.confirmBtn")} ${importPreview.preview.filter((r) => r.status === "create").length} ${t("staff.import.staffLabel")}`}
                      </button>
                      <button type="button" onClick={closeImport}>{t("common.cancel")}</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="importResultPanel">
                <span className="material-symbols-outlined importResultIcon">check_circle</span>
                <h3>{t("staff.import.doneTitle")}</h3>
                {importResult.created > 0 && <p><strong>{importResult.created}</strong> {t("staff.import.created")}</p>}
                {importResult.skipped > 0 && <p>{importResult.skipped} {t("staff.import.skipped")}</p>}
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

      {panel !== "none" ? (
        <div className="staffPanelOverlay" onClick={closePanel}>
          <div className="staffPanel" onClick={(e) => e.stopPropagation()}>
            <div className="staffPanelHeader">
              {panel === "edit" && editTarget && organizationId && (
                <AvatarUpload
                  publicId={editTarget.avatarPublicId}
                  entityType="staff"
                  entityId={editTarget.id}
                  organizationId={organizationId}
                  size={48}
                  onUploaded={(pid) => {
                    setStaff((prev) =>
                      prev.map((s) => s.id === editTarget.id ? { ...s, avatarPublicId: pid } : s)
                    );
                    setEditTarget((t) => t ? { ...t, avatarPublicId: pid } : t);
                  }}
                />
              )}
              <h2>
                {panel === "create" ? "Add staff member" : panel === "pin" ? "Set PIN" : `Edit — ${editTarget?.name || ""}`}
              </h2>
              <button type="button" className="staffPanelClose" onClick={closePanel} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {panel === "pin" ? (
              <div className="staffPanelBody">
                <p>Set a new PIN for <strong>{editTarget?.name || "this staff member"}</strong>. This will immediately invalidate their current session.</p>
                <label className="fieldStack">
                  <span>New PIN (4–8 digits)</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={form.pin}
                    onChange={(e) => setField("pin", e.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="Enter new PIN"
                    autoFocus
                  />
                </label>
                <div className="staffPanelActions">
                  <button type="button" onClick={closePanel}>Cancel</button>
                  <button
                    type="button"
                    className="primaryAction"
                    onClick={() => void handleSetPin()}
                    disabled={saving || form.pin.length < 4}
                  >
                    {saving ? "Saving..." : "Set PIN"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="staffPanelBody">
                <label className="fieldStack">
                  <span>Full name</span>
                  <input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="Jordan Lee"
                    autoFocus
                  />
                </label>
                <label className="fieldStack">
                  <span>Email (optional)</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    placeholder="jordan@school.edu"
                  />
                </label>
                <label className="fieldStack">
                  <span>Role</span>
                  <select value={form.role} onChange={(e) => setField("role", e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </label>

                {panel === "create" ? (
                  <label className="fieldStack">
                    <span>Initial PIN (4–8 digits)</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={form.pin}
                      onChange={(e) => setField("pin", e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="e.g. 1234"
                    />
                  </label>
                ) : (
                  <label className="fieldStack">
                    <span>Status</span>
                    <select
                      value={form.active ? "active" : "inactive"}
                      onChange={(e) => setField("active", e.target.value === "active")}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                )}

                {stores.length > 0 ? (
                  <div className="fieldStack">
                    <span>Store assignments</span>
                    <div className="storeCheckboxes">
                      {stores.map((store) => (
                        <label key={store.id} className="checkboxRow">
                          <input
                            type="checkbox"
                            checked={form.storeIds.includes(store.id)}
                            onChange={() => toggleStore(store.id)}
                          />
                          {store.name}
                        </label>
                      ))}
                    </div>
                    <small style={{ color: "var(--muted)" }}>Leave unselected to allow access to all stores.</small>
                  </div>
                ) : null}

                {showCategoryAccess ? (
                  <div className="fieldStack">
                    <span>Category access</span>
                    {categories.filter((c) => c.active).length === 0 ? (
                      <small style={{ color: "var(--muted)" }}>
                        No categories yet. Go to <strong>Products → Categories</strong> to create them, then return here to restrict access.
                      </small>
                    ) : (
                      <>
                        <div className="storeCheckboxes">
                          {categories.filter((c) => c.active).map((cat) => (
                            <label key={cat.id} className="checkboxRow">
                              <input
                                type="checkbox"
                                checked={form.categoryIds.includes(cat.id)}
                                onChange={() => toggleCategoryId(cat.id)}
                              />
                              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {cat.color && (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 10,
                                      height: 10,
                                      borderRadius: "50%",
                                      background: cat.color
                                    }}
                                  />
                                )}
                                {cat.name}
                              </span>
                            </label>
                          ))}
                        </div>
                        <small style={{ color: "var(--muted)" }}>
                          Leave all unchecked to allow all categories. Check specific categories to restrict this staff member's register view.
                        </small>
                      </>
                    )}
                  </div>
                ) : null}

                <div className="staffPanelActions">
                  <button type="button" onClick={closePanel}>Cancel</button>
                  <button
                    type="button"
                    className="primaryAction"
                    onClick={() => void (panel === "create" ? handleCreate() : handleEdit())}
                    disabled={saving || !form.name.trim() || (panel === "create" && form.pin.length < 4)}
                  >
                    {saving ? "Saving..." : panel === "create" ? "Add staff member" : "Save changes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
