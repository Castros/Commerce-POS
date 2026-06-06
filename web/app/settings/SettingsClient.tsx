"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import AvatarUpload from "../components/AvatarUpload";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { Organization, Store } from "../lib/demoTypes";
import { loadCurrentOrganization } from "../lib/organizationContext";

const ORG_TYPES = ["school", "restaurant", "retail_business", "nonprofit", "other"] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "MXN"];

type StoreForm = { name: string; type: string };

function emptyStoreForm(): StoreForm {
  return { name: "", type: "cafeteria" };
}

export function SettingsClient() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("school");
  const [currency, setCurrency] = useState("USD");
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRateBps, setTaxRateBps] = useState("0");

  const [addingStore, setAddingStore] = useState(false);
  const [storeForm, setStoreForm] = useState<StoreForm>(emptyStoreForm());
  const [savingStore, setSavingStore] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const organization = await loadCurrentOrganization();
      setOrg(organization);
      setName(organization.name);
      setType(organization.type);
      setCurrency(organization.currency ?? "USD");
      setTaxEnabled(organization.taxEnabled ?? false);
      setTaxRateBps(String(organization.taxRateBps ?? 0));

      const storeData = await apiGet<Store[]>(`/stores?organizationId=${organization.id}`);
      setStores(storeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveProfile() {
    if (!org) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await apiPatch<Organization>(`/organizations/${org.id}`, {
        name: name.trim(),
        type,
        currency,
        taxEnabled,
        taxRateBps: parseInt(taxRateBps, 10) || 0
      });
      setOrg(updated);
      setMessage("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function addStore() {
    if (!org) return;
    setSavingStore(true);
    setError(null);
    try {
      await apiPost("/stores", {
        organizationId: org.id,
        name: storeForm.name.trim(),
        type: storeForm.type
      });
      setAddingStore(false);
      setStoreForm(emptyStoreForm());
      const storeData = await apiGet<Store[]>(`/stores?organizationId=${org.id}`);
      setStores(storeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add store");
    } finally {
      setSavingStore(false);
    }
  }

  if (loading) {
    return (
      <section className="module">
        <PageHeader eyebrow="Admin configuration" title="Settings" />
        <p className="emptyState">Loading...</p>
      </section>
    );
  }

  return (
    <section className="module">
      <PageHeader eyebrow={org?.name ?? "Organization"} title="Settings" />

      {error ? <p className="demoError">{error}</p> : null}
      {message ? <p className="buttonHelp success">{message}</p> : null}

      <div className="adminGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="settingsSection">
          <h3>Organization profile</h3>

          <div className="formGrid">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label>
              <span>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          <h3>Tax settings</h3>
          <div className="formGrid">
            <label className="checkboxLabel">
              <input
                type="checkbox"
                checked={taxEnabled}
                onChange={(e) => setTaxEnabled(e.target.checked)}
              />
              <span>Tax enabled on taxable products</span>
            </label>

            {taxEnabled ? (
              <label>
                <span>Tax rate in basis points (825 = 8.25%)</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={taxRateBps}
                  onChange={(e) => setTaxRateBps(e.target.value)}
                />
                <small className="buttonHelp">
                  Current rate: {((parseInt(taxRateBps, 10) || 0) / 100).toFixed(2)}%
                </small>
              </label>
            ) : null}
          </div>

          <div className="toolbar" style={{ justifyContent: "flex-start", paddingTop: 0 }}>
            <button
              type="button"
              className="primary"
              onClick={saveProfile}
              disabled={saving || !name.trim()}
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </div>

        <div className="settingsSection">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3>Locations / Stores</h3>
            <button type="button" onClick={() => setAddingStore((v) => !v)}>
              {addingStore ? "Cancel" : "Add store"}
            </button>
          </div>

          {addingStore ? (
            <div className="formGrid" style={{ marginBottom: 16 }}>
              <label>
                <span>Store name</span>
                <input
                  type="text"
                  value={storeForm.name}
                  onChange={(e) => setStoreForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Main Cafeteria"
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  value={storeForm.type}
                  onChange={(e) => setStoreForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="cafeteria">Cafeteria</option>
                  <option value="bookstore">Bookstore</option>
                  <option value="vending">Vending</option>
                  <option value="online">Online</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <button
                type="button"
                className="primary"
                onClick={addStore}
                disabled={savingStore || !storeForm.name.trim()}
              >
                {savingStore ? "Adding..." : "Add store"}
              </button>
            </div>
          ) : null}

          {stores.length === 0 ? (
            <p className="emptyState">No stores yet.</p>
          ) : (
            <ul className="activityList">
              {stores.map((store) => (
                <li key={store.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {org && (
                    <AvatarUpload
                      publicId={(store as Store & { imagePublicId?: string }).imagePublicId}
                      entityType="store"
                      entityId={store.id}
                      organizationId={org.id}
                      size={40}
                      shape="square"
                      onUploaded={(pid) =>
                        setStores((prev) =>
                          prev.map((s) => s.id === store.id ? { ...s, imagePublicId: pid } : s)
                        )
                      }
                    />
                  )}
                  <div>
                    <strong>{store.name}</strong>
                    <small style={{ marginLeft: 8, color: "var(--muted)" }}>{store.type}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
