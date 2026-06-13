"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPatch, apiPost, apiPut } from "../lib/api";
import type { OrgFeatures, Organization } from "../lib/demoTypes";

const ORG_TYPES = ["school", "restaurant", "retail_business", "nonprofit", "other"] as const;

const FEATURE_DEFS = [
  { key: "ai",                  label: "AI Features",              desc: "Closeout summaries, anomaly alerts, sales forecasts, reorder suggestions, guardian digest" },
  { key: "guardians",           label: "Guardian Portal",          desc: "Parent-facing portal with wallet balances, purchase history, and notification preferences" },
  { key: "fee_assignments",     label: "Fee Assignments",          desc: "Pre-assigned charges (field trips, fees) collectible at the register" },
  { key: "student_integration", label: "Student App Integration",  desc: "Student lookup and balance sync with the linked Student app" },
  { key: "payroll",             label: "Payroll Module",           desc: "Employee payroll management and pay run processing" },
] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"];

type OrgForm = {
  name: string;
  type: string;
  currency: string;
  taxEnabled: boolean;
  taxRateBps: string;
  active: boolean;
};

type OrgStaffMember = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  active: boolean;
  pinLast4: string | null;
};

type StaffForm = {
  name: string;
  email: string;
  role: string;
  pin: string;
};

const STAFF_ROLES = [
  { value: "organization_admin", label: "Organization Admin" },
  { value: "store_manager", label: "Store Manager" },
  { value: "cashier", label: "Cashier" },
  { value: "accountant", label: "Accountant" }
];

function emptyForm(): OrgForm {
  return { name: "", type: "school", currency: "USD", taxEnabled: false, taxRateBps: "0", active: true };
}

function emptyStaffForm(): StaffForm {
  return { name: "", email: "", role: "organization_admin", pin: "" };
}

function orgToForm(org: Organization): OrgForm {
  return {
    name: org.name,
    type: org.type,
    currency: org.currency ?? "USD",
    taxEnabled: org.taxEnabled ?? false,
    taxRateBps: String(org.taxRateBps ?? 0),
    active: org.active ?? true
  };
}

export function OrganizationsClient() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<OrgForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Staff management for selected org
  const [orgStaff, setOrgStaff] = useState<OrgStaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [staffForm, setStaffForm] = useState<StaffForm>(emptyStaffForm());
  const [savingStaff, setSavingStaff] = useState(false);
  const [staffMessage, setStaffMessage] = useState<string | null>(null);

  // Feature flags for selected org
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [featureMessage, setFeatureMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Organization[]>("/organizations");
      setOrgs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load organizations");
    } finally {
      setLoading(false);
    }
  }

  async function loadOrgStaff(orgId: string) {
    setStaffLoading(true);
    setOrgStaff([]);
    try {
      const data = await apiGet<OrgStaffMember[]>(`/staff?organizationId=${orgId}`);
      setOrgStaff(data);
    } catch {
      setOrgStaff([]);
    } finally {
      setStaffLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm());
    setCreating(true);
    setMessage(null);
    setError(null);
    setOrgStaff([]);
    setShowStaffForm(false);
    setStaffMessage(null);
  }

  function startEdit(org: Organization) {
    setCreating(false);
    setEditing(org);
    setForm(orgToForm(org));
    setMessage(null);
    setError(null);
    setShowStaffForm(false);
    setStaffMessage(null);
    void loadOrgStaff(org.id);
  }

  function cancelForm() {
    setCreating(false);
    setEditing(null);
    setOrgStaff([]);
    setShowStaffForm(false);
    setFeatureMessage(null);
  }

  function setField<K extends keyof OrgForm>(key: K, value: OrgForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const taxRateBps = parseInt(form.taxRateBps, 10) || 0;
      if (creating) {
        const created = await apiPost<Organization>("/organizations", {
          name: form.name.trim(),
          type: form.type
        });
        setMessage(`Created "${created.name}"`);
        setCreating(false);
        setEditing(created);
        setForm(orgToForm(created));
        void loadOrgStaff(created.id);
      } else if (editing) {
        const updated = await apiPatch<Organization>(`/organizations/${editing.id}`, {
          name: form.name.trim(),
          type: form.type,
          currency: form.currency,
          taxEnabled: form.taxEnabled,
          taxRateBps,
          active: form.active
        });
        setMessage(`Saved "${updated.name}"`);
        setEditing(updated);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save organization");
    } finally {
      setSaving(false);
    }
  }

  async function saveStaff() {
    if (!editing) return;
    if (!staffForm.name.trim() || staffForm.pin.length < 4) return;
    setSavingStaff(true);
    setStaffMessage(null);
    try {
      await apiPost("/staff", {
        organizationId: editing.id,
        name: staffForm.name.trim(),
        email: staffForm.email.trim() || null,
        role: staffForm.role,
        pin: staffForm.pin,
        storeIds: []
      });
      setStaffMessage(`${staffForm.name} added as ${staffForm.role.replace(/_/g, " ")}.`);
      setShowStaffForm(false);
      setStaffForm(emptyStaffForm());
      void loadOrgStaff(editing.id);
    } catch (err) {
      setStaffMessage(err instanceof Error ? err.message : "Could not create staff member");
    } finally {
      setSavingStaff(false);
    }
  }

  async function toggleFeature(featureKey: string, enabled: boolean) {
    if (!editing) return;
    setSavingFeature(featureKey);
    setFeatureMessage(null);
    try {
      const updated = await apiPut<Organization>(`/organizations/${editing.id}/features`, {
        [featureKey]: enabled
      });
      setEditing(updated);
      setOrgs((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setFeatureMessage(`${FEATURE_DEFS.find((f) => f.key === featureKey)?.label ?? featureKey} ${enabled ? "enabled" : "disabled"}`);
      setTimeout(() => setFeatureMessage(null), 3000);
    } catch (err) {
      setFeatureMessage(err instanceof Error ? err.message : "Could not update feature");
    } finally {
      setSavingFeature(null);
    }
  }

  const panelOpen = creating || !!editing;

  return (
    <section className="module">
      <PageHeader eyebrow="Platform admin" title="Organizations">
        <button type="button" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button type="button" className="primary" onClick={startCreate}>
          New organization
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}
      {message ? <p className="buttonHelp success">{message}</p> : null}

      <div className={panelOpen ? "splitPanel" : undefined}>
        <div>
          {loading ? (
            <p className="emptyState">Loading...</p>
          ) : orgs.length === 0 ? (
            <p className="emptyState">No organizations yet.</p>
          ) : (
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Currency</th>
                  <th>Tax</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr
                    key={org.id}
                    className={editing?.id === org.id ? "active" : ""}
                    onClick={() => startEdit(org)}
                    style={{ cursor: "pointer" }}
                  >
                    <td><strong>{org.name}</strong></td>
                    <td>{org.type}</td>
                    <td>{org.currency ?? "USD"}</td>
                    <td>
                      {org.taxEnabled
                        ? `${((org.taxRateBps ?? 0) / 100).toFixed(2)}%`
                        : "Off"}
                    </td>
                    <td><StatusBadge value={org.active === false ? "inactive" : "active"} /></td>
                    <td>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startEdit(org); }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {panelOpen ? (
          <aside className="detailPanel">
            <span>{creating ? "New organization" : "Edit organization"}</span>
            <h3>{creating ? "Create" : (editing?.name ?? "")}</h3>

            <div className="formGrid">
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="School or business name"
                  required
                />
              </label>

              <label>
                <span>Type</span>
                <select value={form.type} onChange={(e) => setField("type", e.target.value)}>
                  {ORG_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace("_", " ")}</option>
                  ))}
                </select>
              </label>

              {!creating ? (
                <>
                  <label>
                    <span>Currency</span>
                    <select value={form.currency} onChange={(e) => setField("currency", e.target.value)}>
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>

                  <label className="checkboxLabel">
                    <input
                      type="checkbox"
                      checked={form.taxEnabled}
                      onChange={(e) => setField("taxEnabled", e.target.checked)}
                    />
                    <span>Tax enabled</span>
                  </label>

                  {form.taxEnabled ? (
                    <label>
                      <span>Tax rate (basis points — 825 = 8.25%)</span>
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={form.taxRateBps}
                        onChange={(e) => setField("taxRateBps", e.target.value)}
                      />
                    </label>
                  ) : null}

                  <label className="checkboxLabel">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setField("active", e.target.checked)}
                    />
                    <span>Active</span>
                  </label>
                </>
              ) : null}
            </div>

            <div className="receiptActions">
              <button type="button" className="primaryAction" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? "Saving..." : creating ? "Create organization" : "Save changes"}
              </button>
              <button type="button" onClick={cancelForm} disabled={saving}>
                Cancel
              </button>
            </div>

            {/* Feature flags — only shown when editing an existing org */}
            {editing && (
              <div className="orgStaffSection">
                <div className="orgStaffHeader">
                  <strong>Features</strong>
                </div>

                {featureMessage && (
                  <p className={`buttonHelp${featureMessage.includes("Could not") ? "" : " success"}`}>
                    {featureMessage}
                  </p>
                )}

                <div className="featureList">
                  {FEATURE_DEFS.map(({ key, label, desc }) => {
                    const enabled = editing.features?.[key as keyof typeof editing.features] ?? true;
                    const busy = savingFeature === key;
                    return (
                      <div key={key} className="featureRow">
                        <div className="featureInfo">
                          <span className="featureLabel">{label}</span>
                          <span className="featureDesc">{desc}</span>
                        </div>
                        <button
                          type="button"
                          className={`featureToggle${enabled ? " featureOn" : " featureOff"}`}
                          disabled={busy}
                          onClick={() => void toggleFeature(key, !enabled)}
                          title={enabled ? `Disable ${label}` : `Enable ${label}`}
                        >
                          {busy ? "..." : enabled ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Staff section — only shown when editing an existing org */}
            {editing && (
              <div className="orgStaffSection">
                <div className="orgStaffHeader">
                  <strong>Staff accounts</strong>
                  <button
                    type="button"
                    className="btnSmall"
                    onClick={() => { setShowStaffForm((v) => !v); setStaffMessage(null); setStaffForm(emptyStaffForm()); }}
                  >
                    {showStaffForm ? "Cancel" : "+ Add staff"}
                  </button>
                </div>

                {staffMessage && (
                  <p className={`buttonHelp${staffMessage.includes("Could not") ? "" : " success"}`}>
                    {staffMessage}
                  </p>
                )}

                {showStaffForm && (
                  <div className="orgStaffForm">
                    <label className="fieldStack">
                      <span>Full name</span>
                      <input
                        autoFocus
                        value={staffForm.name}
                        onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Jordan Lee"
                      />
                    </label>
                    <label className="fieldStack">
                      <span>Email (optional)</span>
                      <input
                        type="email"
                        value={staffForm.email}
                        onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="jordan@school.edu"
                      />
                    </label>
                    <label className="fieldStack">
                      <span>Role</span>
                      <select
                        value={staffForm.role}
                        onChange={(e) => setStaffForm((f) => ({ ...f, role: e.target.value }))}
                      >
                        {STAFF_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="fieldStack">
                      <span>PIN (4–8 digits)</span>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={staffForm.pin}
                        onChange={(e) => setStaffForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                        placeholder="e.g. 1234"
                      />
                    </label>
                    <button
                      type="button"
                      className="primaryAction"
                      onClick={() => void saveStaff()}
                      disabled={savingStaff || !staffForm.name.trim() || staffForm.pin.length < 4}
                    >
                      {savingStaff ? "Adding..." : "Add staff member"}
                    </button>
                  </div>
                )}

                {staffLoading ? (
                  <p className="emptyState" style={{ fontSize: "0.85rem" }}>Loading staff...</p>
                ) : orgStaff.length === 0 ? (
                  <p className="emptyState" style={{ fontSize: "0.85rem" }}>No staff yet. Add the first admin above.</p>
                ) : (
                  <div className="orgStaffList">
                    {orgStaff.map((member) => (
                      <div key={member.id} className="orgStaffRow">
                        <div>
                          <span className="orgStaffName">{member.name || "—"}</span>
                          {member.email && <span className="orgStaffEmail">{member.email}</span>}
                        </div>
                        <div className="orgStaffRight">
                          <span className="badge muted" style={{ fontSize: "0.72rem" }}>
                            {member.role.replace(/_/g, " ")}
                          </span>
                          {!member.pinLast4 && (
                            <span className="badge danger" style={{ fontSize: "0.72rem" }}>No PIN</span>
                          )}
                          <StatusBadge value={member.active ? "Active" : "Inactive"} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
