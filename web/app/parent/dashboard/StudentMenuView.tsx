"use client";

import { useEffect, useState } from "react";
import { DAY_SHORT, formatDayFull, type MenuByStore, type Student } from "./dashboardTypes";

export function StudentMenuView({
  student, weekDates, menuByStore, selectedDayIdx, onDaySelect, weekOffset, onWeekOffsetChange,
}: {
  student: Student;
  weekDates: string[];
  menuByStore: MenuByStore;
  selectedDayIdx: number;
  onDaySelect: (i: number) => void;
  weekOffset: number;
  onWeekOffsetChange: (d: number) => void;
}) {
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());
  const storeId = student.homeStoreId ?? "";
  const days = storeId ? (menuByStore[storeId] ?? []) : [];
  const selectedDate = weekDates[selectedDayIdx] ?? "";
  const dayPeriods = days.filter((m) => m.date === selectedDate && m.items.length > 0);

  useEffect(() => {
    const firstPeriod = dayPeriods[0];
    setExpandedPeriods(firstPeriod ? new Set([firstPeriod.mealPeriod]) : new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, storeId]);

  function togglePeriod(p: string) {
    setExpandedPeriods((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  return (
    <div className="ppMenuCard">
      <div className="ppDayPills">
        {DAY_SHORT.map((label, i) => (
          <button key={i} className={`ppDayPill${selectedDayIdx === i ? " ppDayPill--active" : ""}`} onClick={() => onDaySelect(i)}>
            {label}
          </button>
        ))}
      </div>

      <div className="ppMenuDayContent">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <p className="ppMenuDayFull" style={{ margin: 0 }}>{formatDayFull(selectedDate)}</p>
          <div className="ppWeekNav" style={{ margin: 0 }}>
            <button onClick={() => onWeekOffsetChange(weekOffset - 1)}>‹</button>
            {weekOffset !== 0 && <button onClick={() => onWeekOffsetChange(0)}>Hoy</button>}
            <button onClick={() => onWeekOffsetChange(weekOffset + 1)}>›</button>
          </div>
        </div>

        {!student.homeStoreId ? (
          <p className="ppMenuEmpty">Este estudiante no tiene cafetería asignada</p>
        ) : dayPeriods.length === 0 ? (
          <p className="ppMenuEmpty">Sin menú publicado para este día</p>
        ) : (
          dayPeriods.map((period, idx) => {
            const expanded = expandedPeriods.has(period.mealPeriod);
            return (
              <div key={period.mealPeriod}>
                {idx > 0 && <div className="ppMenuDivider" />}
                <button className="ppAccordionBtn" onClick={() => togglePeriod(period.mealPeriod)}>
                  <span className="ppAccordionLabel">{period.mealPeriod}</span>
                  <span className="material-symbols-outlined ppAccordionChevron">
                    {expanded ? "expand_less" : "chevron_right"}
                  </span>
                </button>
                {expanded && (
                  <div className="ppItemChips">
                    {period.items.map((item) => (
                      <span key={item.productId} className="ppItemChip">
                        {item.name} ${(item.priceCents / 100).toFixed(0)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
