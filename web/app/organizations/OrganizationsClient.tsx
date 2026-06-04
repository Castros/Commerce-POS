"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { Organization } from "../lib/demoTypes";

const ORG_TYPES = ["school", "restaurant", "retail_business", "nonprofit", "other"] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"];

type OrgForm = {
  name: string;
  type: string;
  currency: string;
  taxEnabled: boolean;
  taxRateBps: string;
  active: boolean;
};

function emptyForm(): OrgForm {
  return { name: "", type: "school", currency: "USD", taxEnabled: false, taxRateBps: "0", active: true };
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

  useEffect(() => {
    void load();
  }, []);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm());
    setCreating(true);
    setMessage(null);
    setError(null);
  }

  function startEdit(org: Organization) {
    setCreating(false);
    setEditing(org);
    setForm(orgToForm(org));
    setMessage(null);
    setError(null);
  }

  function cancelForm() {
    setCreating(false);
    setEditing(null);
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
        setEditing(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save organization");
    } finally {
      setSaving(false);
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
          </aside>
        ) : null}
      </div>
    </section>
  );
}
