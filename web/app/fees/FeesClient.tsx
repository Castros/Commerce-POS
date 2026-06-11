"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { DemoStudent, FeeAssignment } from "../lib/demoTypes";
import { formatMoney } from "../lib/format";
import { loadRegisterContext } from "../lib/organizationContext";

type AssignForm = {
  customerQuery: string;
  selectedStudent: DemoStudent | null;
  amountDollars: string;
  description: string;
  dueDate: string;
};

const emptyForm: AssignForm = {
  customerQuery: "",
  selectedStudent: null,
  amountDollars: "",
  description: "",
  dueDate: ""
};

function toCents(dollars: string) {
  const n = Number.parseFloat(dollars.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function FeesClient() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [fees, setFees] = useState<FeeAssignment[]>([]);
  const [students, setStudents] = useState<DemoStudent[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid" | "cancelled">("pending");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [form, setForm] = useState<AssignForm>(emptyForm);
  const [studentMatches, setStudentMatches] = useState<DemoStudent[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "err" } | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setMessage(null);
    try {
      const ctx = await loadRegisterContext();
      setOrganizationId(ctx.organization.id);
      setStoreId(ctx.store.id);
      const [feeData, studentData] = await Promise.all([
        apiGet<FeeAssignment[]>(`/fee-assignments?organizationId=${ctx.organization.id}&storeId=${ctx.store.id}`),
        apiGet<DemoStudent[]>(`/customers?organizationId=${ctx.organization.id}`)
      ]);
      setFees(feeData);
      setStudents(studentData);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not load fees", type: "err" });
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fees.filter((f) => {
      const matchStatus = statusFilter === "all" || f.status === statusFilter;
      const matchSearch = !q || f.description.toLowerCase().includes(q) || f.customerId.includes(q);
      return matchStatus && matchSearch;
    });
  }, [fees, statusFilter, search]);

  const pendingCount = fees.filter((f) => f.status === "pending").length;
  const paidCount = fees.filter((f) => f.status === "paid").length;
  const pendingTotal = fees.filter((f) => f.status === "pending").reduce((sum, f) => sum + f.amountCents, 0);

  function openPanel() {
    setForm(emptyForm);
    setStudentMatches([]);
    setMessage(null);
    setShowPanel(true);
  }

  function closePanel() {
    setShowPanel(false);
  }

  function handleStudentQuery(q: string) {
    setForm((f) => ({ ...f, customerQuery: q, selectedStudent: null }));
    if (!q.trim()) {
      setStudentMatches([]);
      return;
    }
    const lower = q.toLowerCase();
    setStudentMatches(
      students.filter((s) =>
        (s.name || "").toLowerCase().includes(lower) ||
        (s.externalStudentId || "").toLowerCase().includes(lower) ||
        (s.email || "").toLowerCase().includes(lower)
      ).slice(0, 8)
    );
  }

  function selectStudent(student: DemoStudent) {
    setForm((f) => ({ ...f, selectedStudent: student, customerQuery: student.name || student.id, }));
    setStudentMatches([]);
  }

  async function handleAssign() {
    if (!organizationId || !storeId || !form.selectedStudent) return;
    const amountCents = toCents(form.amountDollars);
    if (amountCents <= 0) {
      setMessage({ text: "Amount must be greater than $0.00", type: "err" });
      return;
    }
    if (!form.description.trim()) {
      setMessage({ text: "Description is required", type: "err" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await apiPost<FeeAssignment>("/fee-assignments", {
        organizationId,
        storeId,
        customerId: form.selectedStudent.id,
        amountCents,
        currency: "USD",
        description: form.description.trim(),
        dueDate: form.dueDate || null
      });
      setMessage({ text: `Fee assigned to ${form.selectedStudent.name || "student"}.`, type: "ok" });
      closePanel();
      await loadAll();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not assign fee", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function cancelFee(fee: FeeAssignment) {
    if (!organizationId) return;
    try {
      await apiPatch<FeeAssignment>(`/fee-assignments/${fee.id}`, {
        organizationId,
        cancel: true
      });
      await loadAll();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Could not cancel fee", type: "err" });
    }
  }

  function studentName(customerId: string) {
    return students.find((s) => s.id === customerId)?.name || customerId.slice(0, 8);
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString();
  }

  return (
    <section className="module">
      <PageHeader eyebrow="Finance" title="Fee Assignments">
        <button type="button" onClick={() => void loadAll()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button type="button" className="btnPrimary" onClick={openPanel}>
          Assign fee
        </button>
      </PageHeader>

      {message ? (
        <p className={`demoError${message.type === "ok" ? " success" : ""}`} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="statsRow">
        <div className="statCard">
          <span>{pendingCount}</span>
          <small>Pending</small>
        </div>
        <div className="statCard">
          <span>{formatMoney(pendingTotal)}</span>
          <small>Pending total</small>
        </div>
        <div className="statCard">
          <span>{paidCount}</span>
          <small>Collected</small>
        </div>
        <div className="statCard">
          <span>{fees.length}</span>
          <small>All time</small>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: "1rem" }}>
        <input
          placeholder="Search by description or student"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <div className="productCategoryChips">
          {(["pending", "paid", "cancelled", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={statusFilter === s ? "chipActive" : "chip"}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Loading fees...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7}>No fee assignments match this filter.</td></tr>
            ) : (
              filtered.map((fee) => (
                <tr key={fee.id} className={fee.status === "cancelled" ? "rowMuted" : ""}>
                  <td><strong>{studentName(fee.customerId)}</strong></td>
                  <td>{fee.description}</td>
                  <td><strong>{formatMoney(fee.amountCents)}</strong></td>
                  <td>{formatDate(fee.dueDate)}</td>
                  <td><StatusBadge value={fee.status.charAt(0).toUpperCase() + fee.status.slice(1)} /></td>
                  <td><span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{formatDate(fee.createdAt)}</span></td>
                  <td>
                    {fee.status === "pending" && (
                      <button
                        type="button"
                        className="tableAction"
                        onClick={() => void cancelFee(fee)}
                      >
                        Cancel
                      </button>
                    )}
                    {fee.status === "paid" && fee.paidOrderId && (
                      <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                        Collected at register
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Assign fee panel */}
      {showPanel && (
        <div className="staffPanelOverlay" onClick={closePanel}>
          <div className="staffPanel" onClick={(e) => e.stopPropagation()}>
            <div className="staffPanelHeader">
              <h2>Assign fee</h2>
              <button type="button" className="staffPanelClose" onClick={closePanel} aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="staffPanelBody">
              <div className="fieldStack" style={{ position: "relative" }}>
                <span>Student</span>
                <input
                  placeholder="Search by name or ID"
                  value={form.customerQuery}
                  onChange={(e) => handleStudentQuery(e.target.value)}
                  autoFocus
                />
                {studentMatches.length > 0 && (
                  <div className="feeStudentDropdown">
                    {studentMatches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="feeStudentOption"
                        onClick={() => selectStudent(s)}
                      >
                        <strong>{s.name || "—"}</strong>
                        {s.externalStudentId && (
                          <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: "0.82rem" }}>
                            #{s.externalStudentId}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {form.selectedStudent && (
                  <small style={{ color: "var(--primary)", marginTop: 2 }}>
                    Selected: {form.selectedStudent.name}
                  </small>
                )}
              </div>

              <label className="fieldStack">
                <span>Description</span>
                <input
                  placeholder="e.g. Field trip deposit, Library fine"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>

              <label className="fieldStack">
                <span>Amount (USD)</span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.amountDollars}
                  onChange={(e) => setForm((f) => ({ ...f, amountDollars: e.target.value }))}
                />
              </label>

              <label className="fieldStack">
                <span>Due date <em style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</em></span>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </label>

              <div className="staffPanelActions">
                <button type="button" onClick={closePanel}>Cancel</button>
                <button
                  type="button"
                  className="primaryAction"
                  onClick={() => void handleAssign()}
                  disabled={saving || !form.selectedStudent || !form.description.trim() || toCents(form.amountDollars) <= 0}
                >
                  {saving ? "Assigning..." : "Assign fee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
