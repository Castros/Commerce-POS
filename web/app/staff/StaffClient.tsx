"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { Store } from "../lib/demoTypes";

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
};

type FormState = {
  name: string;
  email: string;
  role: string;
  pin: string;
  storeIds: string[];
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

function blankForm(): FormState {
  return { name: "", email: "", role: "cashier", pin: "", storeIds: [], active: true };
}

function staffToForm(s: StaffMember): FormState {
  return {
    name: s.name || "",
    email: s.email || "",
    role: s.role,
    pin: "",
    storeIds: s.storeIds,
    active: s.active
  };
}

export function StaffClient() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [panel, setPanel] = useState<"none" | "create" | "edit" | "pin">("none");
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setMessage(null);
    try {
      const org = await loadCurrentOrganization();
      setOrganizationId(org.id);
      const [staffData, storeData] = await Promise.all([
        apiGet<StaffMember[]>(`/staff?organizationId=${org.id}`),
        apiGet<Store[]>(`/stores?organizationId=${org.id}`)
      ]);
      setStaff(staffData);
      setStores(storeData);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not load staff", type: "err" });
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm(blankForm());
    setEditTarget(null);
    setPanel("create");
    setMessage(null);
  }

  function openEdit(member: StaffMember) {
    setForm(staffToForm(member));
    setEditTarget(member);
    setPanel("edit");
    setMessage(null);
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

      await apiPost(`/staff/${editTarget.id}/stores`, { storeIds: form.storeIds });

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

  return (
    <section className="module">
      <PageHeader eyebrow="Admin" title="Staff & Permissions">
        <button type="button" onClick={loadAll} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
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
                      <button type="button" className="tableAction" onClick={() => openEdit(member)}>
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

      {panel !== "none" ? (
        <div className="staffPanelOverlay" onClick={closePanel}>
          <div className="staffPanel" onClick={(e) => e.stopPropagation()}>
            <div className="staffPanelHeader">
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
