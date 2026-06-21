"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import type { Store } from "../lib/demoTypes";
import type { PeriodEntry } from "./menuTypes";
import { formatDayLabel } from "./menuTypes";

type CoverageStatus = "published" | "draft" | "empty";

type StoreWeekData = {
  storeId: string;
  loading: boolean;
  periods: PeriodEntry[];
};

type Props = {
  orgId: string;
  stores: Store[];
  weekDates: string[];
  today: string;
  activeStoreId: string;
  onEditStore: (storeId: string) => void;
  refreshKey?: number;
};

function getCellInfo(periods: PeriodEntry[], date: string): { count: number; status: CoverageStatus } {
  const dayPeriods = periods.filter((p) => p.date === date && p.items.length > 0);
  if (dayPeriods.length === 0) return { count: 0, status: "empty" };
  return { count: dayPeriods.length, status: dayPeriods.some((p) => p.published) ? "published" : "draft" };
}

export default function MenuCoverageSection({ orgId, stores, weekDates, today, activeStoreId, onEditStore, refreshKey }: Props) {
  const [storeData, setStoreData] = useState<StoreWeekData[]>([]);

  useEffect(() => {
    if (!orgId || stores.length === 0 || weekDates.length === 0) return;
    const from = weekDates[0];
    const to = weekDates[weekDates.length - 1];
    setStoreData(stores.map((s) => ({ storeId: s.id, loading: true, periods: [] })));
    for (const store of stores) {
      apiGet<PeriodEntry[]>(`/menu?organizationId=${orgId}&storeId=${store.id}&from=${from}&to=${to}`)
        .then((rows) => setStoreData((prev) => prev.map((d) => d.storeId === store.id ? { ...d, loading: false, periods: rows } : d)))
        .catch(() => setStoreData((prev) => prev.map((d) => d.storeId === store.id ? { ...d, loading: false } : d)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, weekDates[0], refreshKey]);

  return (
    <section className="mpaCoverageSection">
      <div className="mpaCoverageSectionHeader">
        <span className="mpaLabel">Cobertura de cafeterías</span>
        <div className="mpaCoverageLegend">
          <span className="mpaCoverageLegendItem"><span className="mpaCovDot mpaCovDot--published" />Publicado</span>
          <span className="mpaCoverageLegendItem"><span className="mpaCovDot mpaCovDot--draft" />Borrador</span>
          <span className="mpaCoverageLegendItem"><span className="mpaCovDot mpaCovDot--empty" />Vacío</span>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--mpa-border)" }}>
              <th style={{ padding: "6px 12px", textAlign: "left", fontSize: "0.78rem", color: "var(--mpa-muted)", fontWeight: 400 }}>
                Cafetería
              </th>
              {weekDates.map((date) => {
                const { short } = formatDayLabel(date);
                return (
                  <th key={date} style={{ padding: "6px 12px", textAlign: "center", fontSize: "0.78rem", fontWeight: 400, color: date === today ? "var(--mpa-primary)" : "var(--mpa-muted)" }}>
                    {short}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => {
              const data = storeData.find((d) => d.storeId === store.id);
              const isActive = store.id === activeStoreId;
              return (
                <tr key={store.id} style={{ borderBottom: "1px solid rgba(189,201,198,0.35)" }}>
                  <td style={{ padding: "10px 12px", fontSize: "0.82rem", fontWeight: isActive ? 600 : 400, color: isActive ? "var(--mpa-primary)" : "var(--mpa-text)", whiteSpace: "nowrap" }}>
                    {store.name}
                  </td>
                  {weekDates.map((date) => {
                    if (!data || data.loading) {
                      return (
                        <td key={date} style={{ padding: "6px 10px", minWidth: 80 }}>
                          <button className="mpaCovPill mpaCovPill--empty" style={{ opacity: 0.4 }} onClick={() => onEditStore(store.id)}>…</button>
                        </td>
                      );
                    }
                    const { count, status } = getCellInfo(data.periods, date);
                    return (
                      <td key={date} style={{ padding: "6px 10px", minWidth: 80 }}>
                        <button className={`mpaCovPill mpaCovPill--${status}`} onClick={() => onEditStore(store.id)}>
                          {status === "empty" ? "—" : `${count} ${count === 1 ? "turno" : "turnos"}`}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
