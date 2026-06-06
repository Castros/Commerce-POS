"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import { formatMoney } from "../lib/format";
import { loadCurrentOrganization } from "../lib/organizationContext";
import type { Organization } from "../lib/demoTypes";

type PayrollCycleItem = {
  id: string;
  customerId: string;
  employeeProfileId: string;
  employeeNumber: string | null;
  employeeName: string;
  department: string | null;
  balanceSnapshotCents: number;
  deductionCents: number;
  paidEarlyCents: number;
  status: "pending" | "paid_early" | "deducted" | "void";
  createdAt: string;
};

type PayrollCycle = {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  deductionCycle: "weekly" | "biweekly" | "monthly";
  status: "open" | "closed" | "deducted";
  totalDeductionCents: number | null;
  employeeCount: number | null;
  notes: string | null;
  closedByUserId: string | null;
  closedAt: string | null;
  deductedByUserId: string | null;
  deductedAt: string | null;
  createdAt: string;
  items?: PayrollCycleItem[];
};

const TODAY = new Date().toISOString().split("T")[0];

function twoWeeksLater(from: string) {
  const d = new Date(from);
  d.setDate(d.getDate() + 13);
  return d.toISOString().split("T")[0];
}

const cycleLabel: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly"
};

const statusColor: Record<string, string> = {
  open: "statusBadge statusBadge--info",
  closed: "statusBadge statusBadge--warning",
  deducted: "statusBadge statusBadge--success"
};

const itemStatusColor: Record<string, string> = {
  pending: "statusBadge statusBadge--warning",
  paid_early: "statusBadge statusBadge--info",
  deducted: "statusBadge statusBadge--success",
  void: "statusBadge statusBadge--muted"
};

export function PayrollClient() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [cycles, setCycles] = useState<PayrollCycle[]>([]);
  const [selected, setSelected] = useState<PayrollCycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    periodStart: TODAY,
    periodEnd: twoWeeksLater(TODAY),
    deductionCycle: "biweekly" as "weekly" | "biweekly" | "monthly",
    notes: ""
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load(org?: Organization) {
    try {
      setError(null);
      const currentOrg = org || organization || (await loadCurrentOrganization());
      if (!organization) setOrganization(currentOrg);
      const data = await apiGet<PayrollCycle[]>(`/payroll/cycles?organizationId=${currentOrg.id}&limit=50`);
      setCycles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payroll cycles");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(cycleId: string, org: Organization) {
    try {
      const data = await apiGet<PayrollCycle>(`/payroll/cycles/${cycleId}?organizationId=${org.id}`);
      setSelected(data);
      setCycles((prev) => prev.map((c) => (c.id === data.id ? { ...c, ...data } : c)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load cycle details");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (!organization) return;
    setCreating(true);
    setCreateError(null);
    try {
      await apiPost<PayrollCycle>("/payroll/cycles", {
        organizationId: organization.id,
        periodStart: createForm.periodStart,
        periodEnd: createForm.periodEnd,
        deductionCycle: createForm.deductionCycle,
        notes: createForm.notes || null
      });
      setShowCreate(false);
      await load(organization);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create cycle");
    } finally {
      setCreating(false);
    }
  }

  async function closeCycle() {
    if (!selected || !organization) return;
    if (!window.confirm("Close this payroll cycle? This will snapshot all employee balances.")) return;
    setActioning(true);
    setActionError(null);
    try {
      await apiPost(`/payroll/cycles/${selected.id}/close`, { organizationId: organization.id });
      await loadDetail(selected.id, organization);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to close cycle");
    } finally {
      setActioning(false);
    }
  }

  async function markDeducted() {
    if (!selected || !organization) return;
    if (
      !window.confirm(
        "Mark as deducted? This will credit each employee's wallet for the deduction amount and cannot be undone."
      )
    )
      return;
    setActioning(true);
    setActionError(null);
    try {
      await apiPost(`/payroll/cycles/${selected.id}/mark-deducted`, { organizationId: organization.id });
      await loadDetail(selected.id, organization);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to mark deducted");
    } finally {
      setActioning(false);
    }
  }

  function exportCsv() {
    if (!selected || !organization) return;
    const url = `/api/v1/payroll/cycles/${selected.id}/export?organizationId=${organization.id}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${selected.periodStart}-to-${selected.periodEnd}.csv`;
    a.click();
  }

  async function selectCycle(cycle: PayrollCycle) {
    setActionError(null);
    setSelected(cycle);
    if (organization) {
      await loadDetail(cycle.id, organization);
    }
  }

  return (
    <div className="pageContent">
      <PageHeader eyebrow="Workforce" title="Payroll Cycles">
        <button type="button" className="btn" onClick={() => setShowCreate(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            add
          </span>
          New Cycle
        </button>
      </PageHeader>

      {error && <p className="pageError">{error}</p>}

      <div className="payrollLayout">
        <div className="payrollList">
          {loading ? (
            <p className="empEmpty">Loading cycles…</p>
          ) : cycles.length === 0 ? (
            <p className="empEmpty">No payroll cycles yet. Create one to begin tracking employee tabs.</p>
          ) : (
            <div className="payrollCycles">
              {cycles.map((cycle) => (
                <button
                  key={cycle.id}
                  type="button"
                  className={`payrollCycleRow${selected?.id === cycle.id ? " payrollCycleRow--active" : ""}`}
                  onClick={() => void selectCycle(cycle)}
                >
                  <div className="payrollCycleTop">
                    <span className={statusColor[cycle.status]}>{cycle.status}</span>
                    <span className="payrollCycleType">{cycleLabel[cycle.deductionCycle]}</span>
                  </div>
                  <div className="payrollCycleDates">
                    {cycle.periodStart} → {cycle.periodEnd}
                  </div>
                  {cycle.totalDeductionCents !== null && (
                    <div className="payrollCycleAmount">
                      {formatMoney(cycle.totalDeductionCents)}{" "}
                      <small>· {cycle.employeeCount} employees</small>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          <div className="payrollDetail">
            <div className="payrollDetailHeader">
              <div>
                <h3>
                  {selected.periodStart} → {selected.periodEnd}
                </h3>
                <p>
                  {cycleLabel[selected.deductionCycle]} · <span className={statusColor[selected.status]}>{selected.status}</span>
                </p>
              </div>
              <div className="payrollDetailActions">
                {selected.status === "open" && (
                  <button type="button" className="btn" onClick={closeCycle} disabled={actioning}>
                    {actioning ? "Closing…" : "Close Cycle"}
                  </button>
                )}
                {selected.status === "closed" && (
                  <>
                    <button type="button" className="btn" onClick={markDeducted} disabled={actioning}>
                      {actioning ? "Processing…" : "Mark Deducted"}
                    </button>
                    <button type="button" className="btnGhost" onClick={exportCsv}>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        download
                      </span>
                      Export CSV
                    </button>
                  </>
                )}
                {selected.status === "deducted" && (
                  <button type="button" className="btnGhost" onClick={exportCsv}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      download
                    </span>
                    Export CSV
                  </button>
                )}
              </div>
            </div>

            {actionError && <p className="pageError">{actionError}</p>}

            {selected.totalDeductionCents !== null && (
              <div className="payrollSummaryCards">
                <div className="payrollSummaryCard">
                  <span>Total Deduction</span>
                  <strong>{formatMoney(selected.totalDeductionCents)}</strong>
                </div>
                <div className="payrollSummaryCard">
                  <span>Employees</span>
                  <strong>{selected.employeeCount ?? 0}</strong>
                </div>
                {selected.closedAt && (
                  <div className="payrollSummaryCard">
                    <span>Closed</span>
                    <strong>{new Date(selected.closedAt).toLocaleDateString()}</strong>
                  </div>
                )}
                {selected.deductedAt && (
                  <div className="payrollSummaryCard">
                    <span>Deducted</span>
                    <strong>{new Date(selected.deductedAt).toLocaleDateString()}</strong>
                  </div>
                )}
              </div>
            )}

            {selected.notes && <p className="payrollNotes">{selected.notes}</p>}

            {selected.items && selected.items.length > 0 ? (
              <div className="payrollItemsTable">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th className="textRight">Balance at Close</th>
                      <th className="textRight">Deduction</th>
                      <th className="textRight">Paid Early</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.employeeName}</strong>
                          {item.employeeNumber && (
                            <small className="empRowBadge"># {item.employeeNumber}</small>
                          )}
                        </td>
                        <td>{item.department || "—"}</td>
                        <td className="textRight">{formatMoney(item.balanceSnapshotCents)}</td>
                        <td className="textRight">{formatMoney(item.deductionCents)}</td>
                        <td className="textRight">{formatMoney(item.paidEarlyCents)}</td>
                        <td>
                          <span className={itemStatusColor[item.status]}>{item.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : selected.status === "open" ? (
              <p className="empEmpty">
                Items are created when you close the cycle. Close the cycle to snapshot employee balances.
              </p>
            ) : (
              <p className="empEmpty">No employees had negative balances during this period.</p>
            )}
          </div>
        ) : (
          <div className="empDetailEmpty">
            <span className="material-symbols-outlined" aria-hidden="true">
              payments
            </span>
            <p>Select a payroll cycle to view details</p>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="modalOverlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3>New Payroll Cycle</h3>
              <button type="button" onClick={() => setShowCreate(false)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            {createError && <p className="pageError">{createError}</p>}
            <div className="modalBody">
              <div className="formRow">
                <label>Deduction Cycle</label>
                <select
                  value={createForm.deductionCycle}
                  onChange={(e) => {
                    const val = e.target.value as "weekly" | "biweekly" | "monthly";
                    setCreateForm((f) => ({ ...f, deductionCycle: val }));
                  }}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="formRow2">
                <div className="formRow">
                  <label>Period Start</label>
                  <input
                    type="date"
                    value={createForm.periodStart}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        periodStart: e.target.value,
                        periodEnd: twoWeeksLater(e.target.value)
                      }))
                    }
                  />
                </div>
                <div className="formRow">
                  <label>Period End</label>
                  <input
                    type="date"
                    value={createForm.periodEnd}
                    onChange={(e) => setCreateForm((f) => ({ ...f, periodEnd: e.target.value }))}
                  />
                </div>
              </div>
              <div className="formRow">
                <label>Notes (optional)</label>
                <input
                  value={createForm.notes}
                  onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. First bi-weekly cycle of June"
                />
              </div>
            </div>
            <div className="modalFooter">
              <button
                type="button"
                className="btn"
                onClick={create}
                disabled={creating || !createForm.periodStart || !createForm.periodEnd}
              >
                {creating ? "Creating…" : "Create Cycle"}
              </button>
              <button type="button" className="btnGhost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
