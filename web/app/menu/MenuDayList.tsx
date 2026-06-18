"use client";

import { useState, useRef } from "react";
import type { Product, PeriodEntry } from "./menuTypes";
import { formatDayLabel, PERIOD_SUGGESTIONS } from "./menuTypes";
import MenuPeriodRow from "./MenuPeriodRow";

type Props = {
  weekDates: string[];
  today: string;
  loading: boolean;
  periods: PeriodEntry[];
  products: Product[];
  onAddItem: (date: string, mealPeriod: string, product: Product) => void;
  onRemoveItem: (date: string, mealPeriod: string, productId: string) => void;
  onRemovePeriod: (date: string, mealPeriod: string) => void;
  onAddPeriod: (date: string, name: string) => void;
  onTogglePublish: (date: string, mealPeriod: string) => void;
};

export default function MenuDayList({
  weekDates, today, loading, periods, products,
  onAddItem, onRemoveItem, onRemovePeriod, onAddPeriod, onTogglePublish,
}: Props) {
  const [addingItem, setAddingItem] = useState<{ date: string; mealPeriod: string } | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [addingPeriodDate, setAddingPeriodDate] = useState<string | null>(null);
  const [newPeriodName, setNewPeriodName] = useState("");
  const addPeriodInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = productSearch.length >= 1
    ? products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8)
    : [];

  function getDayPeriods(date: string) {
    return periods.filter((p) => p.date === date);
  }

  function stopAdding() {
    setAddingItem(null);
    setProductSearch("");
  }

  function handleAddPeriod(date: string, name: string) {
    if (!name.trim()) return;
    onAddPeriod(date, name);
    setAddingPeriodDate(null);
    setNewPeriodName("");
  }

  if (loading) return <div className="mpaEmpty">Cargando menú…</div>;

  return (
    <div className="mpaDayList">
      {weekDates.map((date) => {
        const dayPeriods = getDayPeriods(date);
        const { short, weekday } = formatDayLabel(date);

        return (
          <div key={date} className={`mpaDayCard${date === today ? " mpaDayCard--today" : ""}`}>
            <div className="mpaDayDate">
              <span className="mpaDayDateShort">{short}</span>
              <span className="mpaDayDateWeekday">{weekday}</span>
            </div>

            <div className="mpaDayPeriods">
              {dayPeriods.map((period) => (
                <MenuPeriodRow
                  key={period.mealPeriod}
                  period={period}
                  canRemove={dayPeriods.length > 1}
                  isAdding={addingItem?.date === date && addingItem?.mealPeriod === period.mealPeriod}
                  productSearch={productSearch}
                  filteredProducts={filteredProducts}
                  onRemovePeriod={() => onRemovePeriod(date, period.mealPeriod)}
                  onRemoveItem={(pid) => onRemoveItem(date, period.mealPeriod, pid)}
                  onStartAdding={() => { setAddingItem({ date, mealPeriod: period.mealPeriod }); setProductSearch(""); }}
                  onStopAdding={stopAdding}
                  onSearchChange={setProductSearch}
                  onAddItem={(product) => { onAddItem(date, period.mealPeriod, product); stopAdding(); }}
                  onTogglePublish={() => onTogglePublish(date, period.mealPeriod)}
                />
              ))}

              {addingPeriodDate === date ? (
                <div className="mpaAddPeriodForm">
                  <input
                    ref={addPeriodInputRef}
                    autoFocus
                    className="mpaAddItemInput"
                    placeholder="Nombre del turno…"
                    value={newPeriodName}
                    onChange={(e) => setNewPeriodName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddPeriod(date, newPeriodName);
                      if (e.key === "Escape") { setAddingPeriodDate(null); setNewPeriodName(""); }
                    }}
                  />
                  <div className="mpaPeriodSuggestions">
                    {PERIOD_SUGGESTIONS
                      .filter((s) => !getDayPeriods(date).find((p) => p.mealPeriod.toLowerCase() === s.toLowerCase()))
                      .map((s) => (
                        <button key={s} className="mpaSuggestionChip" onClick={() => handleAddPeriod(date, s)}>
                          {s}
                        </button>
                      ))}
                  </div>
                  <button className="mpaCancelBtn" onClick={() => { setAddingPeriodDate(null); setNewPeriodName(""); }}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button className="mpaAddPeriodBtn" onClick={() => setAddingPeriodDate(date)}>
                  <span className="material-symbols-outlined">add</span>
                  Agregar turno
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
