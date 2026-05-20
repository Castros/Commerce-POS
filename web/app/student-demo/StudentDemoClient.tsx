"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost } from "../lib/api";
import type { DemoSchoolData, DemoStudent } from "../lib/demoTypes";
import { formatMoney, shortId } from "../lib/format";

type WalletTransaction = {
  id: string;
  orderId: string | null;
  type: string;
  amountCents: number | string;
  balanceAfterCents: number | string;
  source: string | null;
  note: string | null;
  createdAt: string;
};

export function StudentDemoClient({ initialDemo }: { initialDemo: DemoSchoolData | null }) {
  const [demo, setDemo] = useState<DemoSchoolData | null>(initialDemo);
  const [selectedId, setSelectedId] = useState<string>(initialDemo?.students[0]?.id || "");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => demo?.students.find((student) => student.id === selectedId) || null,
    [demo, selectedId]
  );
  const purchaseCount = transactions.filter((transaction) => transaction.type === "purchase").length;
  const owedCents = Math.max(0, -Number(selected?.wallet.balanceCents || 0));

  async function loadDemo() {
    try {
      setError(null);
      const data = await apiPost<DemoSchoolData>("/demo/school", {});
      const wallets = await apiGet<DemoStudent["wallet"][]>(
        `/wallets?organizationId=${data.organization.id}`
      );
      const students = data.students.map((student) => ({
        ...student,
        wallet: wallets.find((wallet) => wallet.customerId === student.id) || student.wallet
      }));
      setDemo({ ...data, students });
      setSelectedId(students[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load student app preview");
    }
  }

  async function loadTransactions(student: DemoStudent | null) {
    if (!student || !demo) {
      setTransactions([]);
      return;
    }

    try {
      const data = await apiGet<WalletTransaction[]>(
        `/wallets/${student.wallet.id}/transactions?organizationId=${demo.organization.id}`
      );
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load wallet transactions");
    }
  }

  useEffect(() => {
    if (!initialDemo) {
      void loadDemo();
    }
  }, [initialDemo]);

  useEffect(() => {
    void loadTransactions(selected);
  }, [selected?.id]);

  return (
    <section className="module studentAppShell">
      <PageHeader eyebrow="Student educational app" title="Synced Wallet & Purchase History">
        <button type="button" onClick={loadDemo}>Refresh</button>
      </PageHeader>
      {error ? <p className="demoError">{error}</p> : null}

      <div className="studentPreviewGrid">
        <aside className="studentPhone">
          <div className="studentPhoneTop">
            <span>Demo Academy</span>
            <strong>{selected?.name || "Student"}</strong>
          </div>
          <div className="walletHero">
            <span>Meal & store balance</span>
            <strong>{formatMoney(selected?.wallet.balanceCents)}</strong>
            <small>Updated from the cafeteria POS after each purchase</small>
          </div>
          <div className="studentAppStats">
            <span>
              Credit owed
              <strong>{formatMoney(owedCents)}</strong>
            </span>
            <span>
              POS purchases
              <strong>{purchaseCount}</strong>
            </span>
            <span>
              Sync status
              <strong>Current</strong>
            </span>
          </div>
          <label className="fieldStack">
            <span>Switch student</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {(demo?.students || []).map((student) => (
                <option value={student.id} key={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <div className="panelWide">
          <h3>What the student app shows after POS checkout</h3>
          <p className="panelCopy">
            This panel represents the connected educational app. When a cashier completes
            a purchase in Commerce POS, the student wallet balance and purchase activity
            below update from the same backend records.
          </p>
          <ul className="transactionList">
            {transactions.map((transaction) => (
              <li key={transaction.id}>
                <div>
                  <strong>
                    {transaction.type === "purchase" ? "POS purchase" : "Wallet top-up"}
                  </strong>
                  <span>
                    {transaction.orderId ? `Receipt ${shortId(transaction.orderId)}` : transaction.note || transaction.source}
                  </span>
                </div>
                <div>
                  <strong>{formatMoney(transaction.amountCents)}</strong>
                  <span>{new Date(transaction.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
