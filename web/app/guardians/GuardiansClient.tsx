"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import AvatarUpload from "../components/AvatarUpload";
import { apiGet, apiPost, apiPatch } from "../lib/api";
import { loadCurrentOrganization } from "../lib/organizationContext";
import { useLanguage } from "../lib/i18n/LanguageContext";

type Student = { studentId: string; name: string; relationship: string; isPrimary: boolean };

type Guardian = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string | null;
  familyCode: string | null;
  active: boolean;
  createdAt: string;
  students: Student[];
};

type CustomerOption = { id: string; name: string; email: string | null };

type Msg = { text: string; type: "ok" | "err" };

const RELATIONSHIP_LABELS: Record<string, string> = {
  mother: "Mother",
  father: "Father",
  guardian: "Guardian",
  other: "Other"
};

function blankCreate() {
  return { name: "", email: "", phone: "", familyCode: "", sendInvite: true };
}

type GuardianCsvPreviewRow = {
  row: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: "create" | "update";
};

type GuardianCsvPreview = {
  total: number;
  valid: number;
  errors: { row: number; error: string }[];
  preview: GuardianCsvPreviewRow[];
};

type GuardianCsvResult = { created: number; updated: number; skipped: number; errors: { row: number; error: string }[] };

export default function GuardiansClient() {
  const { t } = useLanguage();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [search, setSearch] = useState("");
  const [showPortalUrl, setShowPortalUrl] = useState(false);

  // Panels
  const [panel, setPanel] = useState<"none" | "create" | "detail">("none");
  const [detail, setDetail] = useState<Guardian | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form
  const [createForm, setCreateForm] = useState(blankCreate());

  // Link student
  const [linkStudentId, setLinkStudentId] = useState("");
  const [linkRelationship, setLinkRelationship] = useState("guardian");
  const [linking, setLinking] = useState(false);

  // Edit fields in detail panel
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editFamilyCode, setEditFamilyCode] = useState("");
  const [editDirty, setEditDirty] = useState(false);

  // CSV import state
  const importFileRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState<GuardianCsvPreview | null>(null);
  const [importApplying, setImportApplying] = useState(false);
  const [importResult, setImportResult] = useState<GuardianCsvResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => { void loadAll(); }, []);

  function downloadImportTemplate() {
    const csv = `name,email,phone\nMaria García,maria@example.com,555-1234\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "guardians-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    if (!orgId) return;
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("organizationId", orgId);
      const res = await fetch("/api/v1/guardians/import/preview", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: GuardianCsvPreview; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      setImportPreview(json.data!);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setImportPreviewing(false);
    }
  }

  async function applyGuardianImport() {
    if (!orgId || !importFile) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("organizationId", orgId);
      const res = await fetch("/api/v1/guardians/import/apply", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { data?: GuardianCsvResult; error?: string };
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

  async function loadAll() {
    setLoading(true);
    try {
      const org = await loadCurrentOrganization();
      setOrgId(org.id);
      const [gs, cs] = await Promise.all([
        apiGet<Guardian[]>(`/guardians?organizationId=${org.id}`),
        apiGet<CustomerOption[]>(`/customers?organizationId=${org.id}&customerType=student&limit=500`)
      ]);
      setGuardians(gs);
      setCustomers(cs);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to load", type: "err" });
    } finally {
      setLoading(false);
    }
  }

  function openDetail(g: Guardian) {
    setDetail(g);
    setEditName(g.name);
    setEditPhone(g.phone ?? "");
    setEditFamilyCode(g.familyCode ?? "");
    setEditDirty(false);
    setLinkStudentId("");
    setLinkRelationship("guardian");
    setPanel("detail");
    setMsg(null);
  }

  function closePanel() {
    setPanel("none");
    setDetail(null);
  }

  async function handleCreate() {
    if (!orgId) return;
    setSaving(true);
    setMsg(null);
    try {
      const created = await apiPost<Guardian>("/guardians", {
        organizationId: orgId,
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        phone: createForm.phone.trim() || null,
        familyCode: createForm.familyCode.trim() || null
      });
      setGuardians((g) => [...g, created]);

      if (createForm.sendInvite && createForm.email) {
        await apiPost(`/guardians/${created.id}/send-invite`, { organizationId: orgId }).catch(() => {});
      }

      closePanel();
      setCreateForm(blankCreate());
      setMsg({ text: `${created.name} added${createForm.sendInvite ? " — invite email sent" : ""}.`, type: "ok" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to create", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!orgId || !detail) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Guardian>(`/guardians/${detail.id}`, {
        organizationId: orgId,
        name: editName.trim(),
        phone: editPhone.trim() || null,
        familyCode: editFamilyCode.trim() || null
      });
      setGuardians((gs) => gs.map((g) => (g.id === updated.id ? updated : g)));
      setDetail(updated);
      setEditDirty(false);
      setMsg({ text: "Guardian updated.", type: "ok" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to update", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkStudent() {
    if (!orgId || !detail || !linkStudentId) return;
    setLinking(true);
    try {
      await apiPost(`/guardians/${detail.id}/students`, {
        organizationId: orgId,
        studentId: linkStudentId,
        relationship: linkRelationship,
        isPrimary: detail.students.length === 0
      });
      // Refresh guardian
      const refreshed = await apiGet<Guardian[]>(`/guardians?organizationId=${orgId}`);
      setGuardians(refreshed);
      const updated = refreshed.find((g) => g.id === detail.id);
      if (updated) setDetail(updated);
      setLinkStudentId("");
      setMsg({ text: "Student linked.", type: "ok" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to link", type: "err" });
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink(studentId: string, studentName: string) {
    if (!orgId || !detail) return;
    try {
      await fetch(`/api/v1/guardians/${detail.id}/students/${studentId}?organizationId=${orgId}`, {
        method: "DELETE",
        credentials: "include"
      });
      const refreshed = await apiGet<Guardian[]>(`/guardians?organizationId=${orgId}`);
      setGuardians(refreshed);
      const updated = refreshed.find((g) => g.id === detail.id);
      if (updated) setDetail(updated);
      setMsg({ text: `${studentName} unlinked.`, type: "ok" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to unlink", type: "err" });
    }
  }

  async function handleSendInvite(guardianId: string, guardianName: string) {
    if (!orgId) return;
    try {
      await apiPost(`/guardians/${guardianId}/send-invite`, { organizationId: orgId });
      setMsg({ text: `Invite sent to ${guardianName}.`, type: "ok" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to send invite", type: "err" });
    }
  }

  async function handleToggleActive(g: Guardian) {
    if (!orgId) return;
    try {
      const updated = await apiPatch<Guardian>(`/guardians/${g.id}`, {
        organizationId: orgId,
        active: !g.active
      });
      setGuardians((gs) => gs.map((x) => (x.id === updated.id ? updated : x)));
      if (detail?.id === g.id) setDetail(updated);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed", type: "err" });
    }
  }

  const visible = guardians.filter((g) =>
    !search ||
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    g.email.toLowerCase().includes(search.toLowerCase()) ||
    (g.familyCode ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const linkedStudentIds = new Set(guardians.flatMap((g) => g.students.map((s) => s.studentId)));
  const unlinkedCount = customers.filter((c) => !linkedStudentIds.has(c.id)).length;

  // Students already linked to THIS guardian (for the link dropdown — exclude them)
  const alreadyLinked = new Set(detail?.students.map((s) => s.studentId) ?? []);
  const linkableStudents = customers.filter((c) => !alreadyLinked.has(c.id));

  function copyPortalLink() {
    if (!orgId) return;
    setShowPortalUrl((v) => !v);
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Manager" title="Parents & Guardians">
        <button type="button" onClick={loadAll} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button type="button" onClick={copyPortalLink} disabled={!orgId} title="Copy the login link to share with parents">
          <span className="material-symbols-outlined" aria-hidden="true">link</span>
          Copy portal link
        </button>
        <button type="button" onClick={() => setShowImport(true)}>
          {t("common.importCsv")}
        </button>
        <button
          type="button"
          className="primaryAction"
          onClick={() => { setCreateForm(blankCreate()); setMsg(null); setPanel("create"); }}
        >
          Add guardian
        </button>
      </PageHeader>

      {showPortalUrl && orgId && (
        <div style={{ background: "var(--surface, #f9fafb)", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8, padding: "12px 16px", marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", whiteSpace: "nowrap" }}>Parent portal link:</span>
          <input
            readOnly
            value={`${window.location.origin}/parent/login?org=${orgId}`}
            onFocus={(e) => e.target.select()}
            style={{ flex: 1, minWidth: 260, fontFamily: "monospace", fontSize: "0.82rem", border: "1px solid var(--border, #e5e7eb)", borderRadius: 4, padding: "4px 8px", background: "#fff" }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              const url = `${window.location.origin}/parent/login?org=${orgId}`;
              if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => setMsg({ text: "Link copied!", type: "ok" }));
              } else {
                const el = document.querySelector<HTMLInputElement>('input[value*="parent/login"]');
                el?.select();
                document.execCommand("copy");
                setMsg({ text: "Link copied!", type: "ok" });
              }
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 16 }}>content_copy</span>
            Copy
          </button>
          <button type="button" className="btn" onClick={() => setShowPortalUrl(false)} title="Close">
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}

      {msg && (
        <p className={`demoError${msg.type === "ok" ? " success" : ""}`} role="status">
          {msg.text}
        </p>
      )}

      <div className="statsRow">
        <div className="statCard"><span>{guardians.filter((g) => g.active).length}</span><small>Active parents</small></div>
        <div className="statCard"><span>{guardians.reduce((n, g) => n + g.students.length, 0)}</span><small>Linked students</small></div>
        <div className="statCard"><span>{unlinkedCount}</span><small>No guardian yet</small></div>
        <div className="statCard"><span>{customers.length}</span><small>Total students</small></div>
      </div>

      <div className="toolbar">
        <input
          className="searchInput"
          placeholder="Search by name, email, or family code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Parent / Guardian</th>
              <th>Family code</th>
              <th>Linked students</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}>Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5}>No guardians found. Add your first parent above.</td></tr>
            ) : (
              visible.map((g) => (
                <tr key={g.id} className={g.active ? "" : "rowMuted"}>
                  <td>
                    <strong style={{ cursor: "pointer" }} onClick={() => openDetail(g)}>{g.name}</strong>
                    <small style={{ display: "block", color: "var(--muted)" }}>{g.email}</small>
                    {g.phone && <small style={{ display: "block", color: "var(--muted)" }}>{g.phone}</small>}
                  </td>
                  <td>
                    {g.familyCode
                      ? <span className="badge muted" style={{ fontFamily: "monospace" }}>{g.familyCode}</span>
                      : <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  <td>
                    {g.students.length === 0
                      ? <span className="badge danger">None linked</span>
                      : g.students.map((s) => (
                          <span key={s.studentId} className="badge success" style={{ marginRight: 4 }}>
                            {s.name}
                          </span>
                        ))}
                  </td>
                  <td>
                    <span className={`badge ${g.active ? "success" : "muted"}`}>
                      {g.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="tableAction" onClick={() => openDetail(g)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="tableAction"
                        onClick={() => void handleSendInvite(g.id, g.name)}
                        title="Send parent portal invite email"
                      >
                        Invite
                      </button>
                      <button
                        type="button"
                        className="tableAction"
                        onClick={() => void handleToggleActive(g)}
                      >
                        {g.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Create Panel ─────────────────────────────────────────── */}
      {panel === "create" && (
        <div className="staffPanelOverlay" onClick={closePanel}>
          <div className="staffPanel" onClick={(e) => e.stopPropagation()}>
            <div className="staffPanelHeader">
              <h2>Add parent / guardian</h2>
              <button type="button" className="staffPanelClose" onClick={closePanel} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="staffPanelBody">
              <label className="fieldStack">
                <span>Full name *</span>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Sarah Johnson"
                  autoFocus
                />
              </label>
              <label className="fieldStack">
                <span>Email *</span>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="sarah@example.com"
                />
              </label>
              <label className="fieldStack">
                <span>Phone (optional)</span>
                <input
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="555-0100"
                />
              </label>
              <label className="fieldStack">
                <span>Family code (optional)</span>
                <input
                  value={createForm.familyCode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, familyCode: e.target.value }))}
                  placeholder="e.g. GARCIA-001"
                />
                <small style={{ color: "var(--muted)" }}>
                  Students sharing this code are linked automatically.
                </small>
              </label>
              <label className="checkboxRow" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={createForm.sendInvite}
                  onChange={(e) => setCreateForm((f) => ({ ...f, sendInvite: e.target.checked }))}
                />
                Send portal invite email immediately
              </label>
              {msg && (
                <p className={`demoError${msg.type === "ok" ? " success" : ""}`}>{msg.text}</p>
              )}
              <div className="staffPanelActions">
                <button type="button" onClick={closePanel}>Cancel</button>
                <button
                  type="button"
                  className="primaryAction"
                  onClick={() => void handleCreate()}
                  disabled={saving || !createForm.name.trim() || !createForm.email.trim()}
                >
                  {saving ? "Adding…" : "Add guardian"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import overlay ── */}
      {showImport && (
        <div className="importOverlay">
          <div className="importPanel">
            <div className="importPanelHeader">
              <strong>{t("guardians.import.title")}</strong>
              <button type="button" className="importPanelClose" onClick={closeImport}>✕</button>
            </div>

            {!importResult ? (
              <>
                <div className="importInstructions">
                  <p>
                    {t("guardians.import.instructions")} <code>name</code>, <code>email</code>.{" "}
                    {t("guardians.import.optionalColumns")} <code>phone</code>.
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
                    <span>{t("guardians.import.dropZone")}</span>
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

                {importPreviewing && <p className="importHint">{t("guardians.import.parsing")}</p>}
                {importError && <p className="demoError">{importError}</p>}

                {importPreview && (
                  <>
                    <div className="importSummaryBar">
                      <span className="importSummaryItem importSummaryItem--ok">
                        {importPreview.preview.filter((r) => r.status === "create").length} {t("guardians.import.toCreate")}
                      </span>
                      {importPreview.preview.filter((r) => r.status === "update").length > 0 && (
                        <span className="importSummaryItem importSummaryItem--skip">
                          {importPreview.preview.filter((r) => r.status === "update").length} {t("guardians.import.toUpdate")}
                        </span>
                      )}
                      {importPreview.errors.length > 0 && (
                        <span className="importSummaryItem importSummaryItem--err">
                          {importPreview.errors.length} {t("guardians.import.errorsFound")}
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
                            <th>{t("guardians.import.colName")}</th>
                            <th>{t("guardians.import.colEmail")}</th>
                            <th>{t("guardians.import.colPhone")}</th>
                            <th>{t("guardians.import.colStatus")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.preview.map((row) => (
                            <tr key={row.row} className={row.status === "update" ? "importRowSkip" : ""}>
                              <td>{row.name}</td>
                              <td>{row.email ?? "—"}</td>
                              <td>{row.phone ?? "—"}</td>
                              <td>
                                <span className={`importStatusBadge importStatusBadge--${row.status}`}>
                                  {row.status === "update" ? t("guardians.import.updateLabel") : t("guardians.import.createLabel")}
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
                        onClick={() => void applyGuardianImport()}
                        disabled={importApplying || importPreview.valid === 0}
                      >
                        {importApplying
                          ? t("guardians.import.importing")
                          : `${t("guardians.import.confirmBtn")} ${importPreview.valid} ${t("guardians.import.guardiansLabel")}`}
                      </button>
                      <button type="button" onClick={closeImport}>{t("common.cancel")}</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="importResultPanel">
                <span className="material-symbols-outlined importResultIcon">check_circle</span>
                <h3>{t("guardians.import.doneTitle")}</h3>
                {importResult.created > 0 && <p><strong>{importResult.created}</strong> {t("guardians.import.created")}</p>}
                {importResult.updated > 0 && <p><strong>{importResult.updated}</strong> {t("guardians.import.updated")}</p>}
                {importResult.skipped > 0 && <p>{importResult.skipped} {t("guardians.import.skipped")}</p>}
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

      {/* ── Detail / Edit Panel ──────────────────────────────────── */}
      {panel === "detail" && detail && (
        <div className="staffPanelOverlay" onClick={closePanel}>
          <div className="staffPanel" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="staffPanelHeader">
              {orgId && (
                <AvatarUpload
                  publicId={(detail as { avatarPublicId?: string }).avatarPublicId}
                  entityType="guardian"
                  entityId={detail.id}
                  organizationId={orgId}
                  size={48}
                  onUploaded={(pid) => {
                    setGuardians((prev) =>
                      prev.map((g) => g.id === detail.id ? { ...g, avatarPublicId: pid } : g)
                    );
                  }}
                />
              )}
              <h2>{detail.name}</h2>
              <button type="button" className="staffPanelClose" onClick={closePanel} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="staffPanelBody">
              {msg && (
                <p className={`demoError${msg.type === "ok" ? " success" : ""}`}>{msg.text}</p>
              )}

              {/* Contact info */}
              <label className="fieldStack">
                <span>Full name</span>
                <input
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setEditDirty(true); }}
                />
              </label>
              <div className="fieldStack">
                <span>Email</span>
                <p style={{ margin: "4px 0", color: "var(--muted)", fontSize: "0.9rem" }}>{detail.email}</p>
              </div>
              <label className="fieldStack">
                <span>Phone</span>
                <input
                  value={editPhone}
                  onChange={(e) => { setEditPhone(e.target.value); setEditDirty(true); }}
                  placeholder="555-0100"
                />
              </label>
              <label className="fieldStack">
                <span>Family code</span>
                <input
                  value={editFamilyCode}
                  onChange={(e) => { setEditFamilyCode(e.target.value); setEditDirty(true); }}
                  placeholder="e.g. GARCIA-001"
                />
              </label>

              {editDirty && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button type="button" onClick={() => { setEditDirty(false); setEditName(detail.name); setEditPhone(detail.phone ?? ""); setEditFamilyCode(detail.familyCode ?? ""); }}>
                    Discard
                  </button>
                  <button type="button" className="primaryAction" onClick={() => void handleSaveEdit()} disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              )}

              {/* Send invite */}
              <div style={{ background: "#f0f7ff", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px", fontSize: "0.875rem", fontWeight: 600 }}>Parent portal access</p>
                <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#6b7280" }}>
                  Sends a login link to <strong>{detail.email}</strong>. Valid for 72 hours.
                </p>
                <button
                  type="button"
                  className="primaryAction"
                  style={{ fontSize: "0.85rem", padding: "8px 14px" }}
                  onClick={() => void handleSendInvite(detail.id, detail.name)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4 }}>send</span>
                  Send invite email
                </button>
              </div>

              {/* Linked students */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px" }}>
                  Linked students ({detail.students.length})
                </p>
                {detail.students.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No students linked yet.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {detail.students.map((s) => (
                      <div key={s.studentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8fafc", borderRadius: 8, padding: "8px 12px" }}>
                        <div>
                          <span style={{ fontWeight: 500 }}>{s.name}</span>
                          <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "var(--muted)" }}>
                            {RELATIONSHIP_LABELS[s.relationship] ?? s.relationship}
                            {s.isPrimary ? " · Primary" : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="tableAction"
                          style={{ color: "#dc2626" }}
                          onClick={() => void handleUnlink(s.studentId, s.name)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Link a student */}
              {linkableStudents.length > 0 && (
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px" }}>
                    Link a student
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select
                      className="toolbarSelect"
                      value={linkStudentId}
                      onChange={(e) => setLinkStudentId(e.target.value)}
                      style={{ flex: 1, minWidth: 160 }}
                    >
                      <option value="">Select student…</option>
                      {linkableStudents.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      className="toolbarSelect"
                      value={linkRelationship}
                      onChange={(e) => setLinkRelationship(e.target.value)}
                    >
                      <option value="guardian">Guardian</option>
                      <option value="mother">Mother</option>
                      <option value="father">Father</option>
                      <option value="other">Other</option>
                    </select>
                    <button
                      type="button"
                      className="primaryAction"
                      style={{ fontSize: "0.85rem", padding: "8px 14px" }}
                      onClick={() => void handleLinkStudent()}
                      disabled={!linkStudentId || linking}
                    >
                      {linking ? "Linking…" : "Link"}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14, marginTop: 8 }}>
                <button
                  type="button"
                  className="tableAction"
                  style={{ color: detail.active ? "#dc2626" : "#059669" }}
                  onClick={() => void handleToggleActive(detail)}
                >
                  {detail.active ? "Deactivate guardian" : "Reactivate guardian"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
