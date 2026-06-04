"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPost } from "../lib/api";
import type { DemoStudent, Organization } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";

type AddForm = {
  name: string;
  externalId: string;
  email: string;
  phone: string;
};

const emptyForm: AddForm = { name: "", externalId: "", email: "", phone: "" };

export function CustomersClient() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [students, setStudents] = useState<DemoStudent[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function loadStudents(existingOrganization?: Organization) {
    try {
      setError(null);
      const currentOrganization = existingOrganization || organization || (await loadCurrentOrganization());
      if (!existingOrganization && !organization) setOrganization(currentOrganization);
      const customers = await apiGet<Omit<DemoStudent, "wallet">[]>(
        `/customers?organizationId=${currentOrganization.id}`
      );
      const wallets = await apiGet<DemoStudent["wallet"][]>(
        `/wallets?organizationId=${currentOrganization.id}`
      );
      const merged: DemoStudent[] = customers.map((customer) => ({
        ...customer,
        wallet:
          wallets.find((w) => w.customerId === customer.id) ||
          { id: "", organizationId: "", customerId: customer.id, balanceCents: 0, currency: "USD", active: true }
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

  const selected = useMemo(
    () => students.find((s) => s.id === selectedId) || null,
    [students, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.trim().toLowerCase();
    return students.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.externalId?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q)
    );
  }, [students, search]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setAddError("Name is required");
      return;
    }
    const currentOrganization = organization || (await loadCurrentOrganization());
    if (!organization) setOrganization(currentOrganization);
    setSaving(true);
    setAddError(null);
    try {
      await apiPost("/customers", {
        organizationId: currentOrganization.id,
        name: form.name.trim(),
        externalId: form.externalId.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null
      });
      setForm(emptyForm);
      setShowAdd(false);
      await loadStudents(currentOrganization);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add customer");
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof AddForm) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Student accounts" title="Customers">
        <button type="button" onClick={() => void loadStudents()}>Refresh</button>
        <button type="button" onClick={() => { setShowAdd(true); setAddError(null); }}>
          + Add Customer
        </button>
      </PageHeader>

      {error ? <p className="demoError">{error}</p> : null}

      {showAdd && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}
        >
          <div style={{
            background: "var(--surface, #fff)", borderRadius: 12, padding: "2rem",
            width: "100%", maxWidth: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)"
          }}>
            <h2 style={{ margin: "0 0 1.25rem" }}>Add Customer</h2>
            {addError ? <p className="demoError">{addError}</p> : null}
            <form onSubmit={(e) => void handleAdd(e)} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Name *
                <input value={form.name} onChange={field("name")} placeholder="Full name" required />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Matricula / Student ID
                <input value={form.externalId} onChange={field("externalId")} placeholder="e.g. 2024-0042" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Email
                <input type="email" value={form.email} onChange={field("email")} placeholder="parent@email.com" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Phone
                <input type="tel" value={form.phone} onChange={field("phone")} placeholder="+1 555 000 0000" />
              </label>
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? "Saving…" : "Add Customer"}
                </button>
              </div>
            </form>
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
          </div>
          <DataTable
            headers={["Student", "Matricula", "Email", "Wallet", "Status", "Link"]}
            rows={filtered.map((s) => [
              s.name || "Unnamed",
              s.externalId || "-",
              s.email || "-",
              formatMoney(s.wallet.balanceCents),
              s.active ? "Active" : "Inactive",
              s.externalStudentId ? "Linked" : "Standalone"
            ])}
            statusIndex={4}
            onRowClick={(index) => setSelectedId(filtered[index]?.id || "")}
            activeRowIndex={filtered.findIndex((s) => s.id === selectedId)}
          />
        </div>
        <aside className="detailPanel">
          <span>Customer profile</span>
          <h3>{selected?.name || "Select a customer"}</h3>
          {selected ? (
            <>
              <StatusBadge value={selected.externalStudentId ? "Linked to Spelling App" : "Standalone"} />
              <dl style={{ marginTop: "1rem" }}>
                <div><dt>Wallet balance</dt><dd>{formatMoney(selected.wallet.balanceCents)}</dd></div>
                <div><dt>Matricula</dt><dd>{selected.externalId || "-"}</dd></div>
                <div><dt>Email</dt><dd>{selected.email || "-"}</dd></div>
                <div><dt>Phone</dt><dd>{selected.phone || "-"}</dd></div>
                {selected.externalStudentId && (
                  <div><dt>Spelling App ID</dt><dd style={{ fontFamily: "monospace", fontSize: 12 }}>{selected.externalStudentId.slice(0, 8)}…</dd></div>
                )}
              </dl>
              {!selected.externalStudentId && (
                <p style={{ marginTop: "1rem", fontSize: 13, color: "var(--text-muted, #666)" }}>
                  This customer was added directly to POS. If the Spelling App is connected, it will link automatically when a parent logs in or via the reconcile tool.
                </p>
              )}
            </>
          ) : (
            <p>Select a customer from the list to view their profile.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
