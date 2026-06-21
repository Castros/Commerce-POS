"use client";

import { useState, useRef } from "react";
import type { Product, PeriodEntry } from "./menuTypes";
import { formatDayLabel, fmt, PERIOD_SUGGESTIONS } from "./menuTypes";

type Props = {
  weekDates: string[];
  today: string;
  loading: boolean;
  periods: PeriodEntry[];
  products: Product[];
  savedDates?: Set<string>;
  onAddItem: (date: string, mealPeriod: string, product: Product) => void;
  onRemoveItem: (date: string, mealPeriod: string, productId: string) => void;
  onRemovePeriod: (date: string, mealPeriod: string) => void;
  onAddPeriod: (date: string, name: string) => void;
  onToggleDayPublish: (date: string) => void;
};

function DayToggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={onChange}
      className={`mpaToggle${on ? " mpaToggle--on" : ""}`}
      title={on ? "Publicado" : "Borrador"}
    >
      <span className="mpaToggleKnob" />
    </button>
  );
}

export default function MenuWeekGrid({
  weekDates, today, loading, periods, products, savedDates,
  onAddItem, onRemoveItem, onRemovePeriod, onAddPeriod, onToggleDayPublish,
}: Props) {
  const [addingItem, setAddingItem] = useState<{ date: string; mealPeriod: string } | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [addingPeriodDate, setAddingPeriodDate] = useState<string | null>(null);
  const [newPeriodName, setNewPeriodName] = useState("");
  const [pendingRemove, setPendingRemove] = useState<{ date: string; mealPeriod: string } | null>(null);
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
    <div className="mpaWeekGridWrap">
      <div className="mpaWeekGrid">
        {weekDates.map((date) => {
          const dayPeriods = getDayPeriods(date);
          const { short } = formatDayLabel(date);
          const isToday = date === today;
          const isSaved = savedDates?.has(date) ?? false;
          const hasAnyItems = dayPeriods.some((p) => p.items.length > 0);
          const isPublished = dayPeriods.some((p) => p.published);

          let colClass = "mpaDayCol";
          if (isToday) colClass += " mpaDayCol--today";
          if (isSaved) colClass += " mpaDayCol--saved";

          return (
            <div key={date} className={colClass}>
              {isToday && <span className="mpaDayColBadge">HOY</span>}

              <div className="mpaDayColHeader">
                <span className="mpaDayColDate">{short}</span>
                <DayToggle on={isPublished} onChange={() => onToggleDayPublish(date)} />
              </div>

              {!hasAnyItems ? (
                <>
                  <div className="mpaEmptyDay">
                    <span className="material-symbols-outlined">restaurant_menu</span>
                    <span className="mpaEmptyDayText">Sin planificar</span>
                  </div>
                  {addingItem?.date === date ? (
                    <div className="mpaAddItemWrap">
                      <input
                        autoFocus
                        className="mpaAddItemInput"
                        style={{ width: "100%" }}
                        placeholder="Buscar platillo…"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && stopAdding()}
                        onBlur={(e) => {
                          const wrap = e.currentTarget.closest(".mpaAddItemWrap");
                          setTimeout(() => { if (!wrap?.contains(document.activeElement)) stopAdding(); }, 150);
                        }}
                      />
                      {filteredProducts.length > 0 && (
                        <div className="mpaProductDrop">
                          {filteredProducts.map((p) => (
                            <button key={p.id} className="mpaProductOpt" onMouseDown={() => {
                              const firstPeriod = dayPeriods[0];
                              if (firstPeriod) { onAddItem(date, firstPeriod.mealPeriod, p); stopAdding(); }
                            }}>
                              <span>{p.name}</span>
                              <span className="mpaProductOptPrice">{fmt(p.priceCents)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      className="mpaAddDashed"
                      style={{ padding: "4px 12px", width: "auto", alignSelf: "center" }}
                      onClick={() => {
                        const firstPeriod = dayPeriods[0];
                        if (firstPeriod) { setAddingItem({ date, mealPeriod: firstPeriod.mealPeriod }); setProductSearch(""); }
                      }}
                    >
                      <span className="material-symbols-outlined">add</span>
                      Agregar
                    </button>
                  )}
                </>
              ) : (
                dayPeriods.map((period) => {
                  const isPendingRemove = pendingRemove?.date === date && pendingRemove?.mealPeriod === period.mealPeriod;
                  return (
                    <div key={period.mealPeriod} className="mpaPeriodSection">
                      <div className="mpaPeriodSectionLabel">
                        {isPendingRemove ? (
                          <div className="mpaRemoveConfirm">
                            <span className="mpaRemoveConfirmLabel">¿Eliminar?</span>
                            <button className="mpaRemoveConfirmYes" onClick={() => { onRemovePeriod(date, period.mealPeriod); setPendingRemove(null); }}>Sí</button>
                            <button className="mpaRemoveConfirmNo" onClick={() => setPendingRemove(null)}>No</button>
                          </div>
                        ) : (
                          <>
                            <span>{period.mealPeriod}</span>
                            {dayPeriods.length > 1 && (
                              <button
                                className="mpaPeriodSectionRemove"
                                onClick={() => setPendingRemove({ date, mealPeriod: period.mealPeriod })}
                                title={`Eliminar turno ${period.mealPeriod}`}
                              >
                                <span className="material-symbols-outlined">close</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      {period.items.map((item) => (
                        <div key={item.productId} className="mpaItemRow">
                          <span className="mpaItemName">{item.name}</span>
                          <span className="mpaItemPrice">{fmt(item.priceCents)}</span>
                          <button className="mpaItemRemove" onClick={() => onRemoveItem(date, period.mealPeriod, item.productId)}>
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>
                      ))}

                      {addingItem?.date === date && addingItem?.mealPeriod === period.mealPeriod ? (
                        <div className="mpaAddItemWrap">
                          <input
                            autoFocus
                            className="mpaAddItemInput"
                            style={{ width: "100%" }}
                            placeholder="Buscar platillo…"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            onKeyDown={(e) => e.key === "Escape" && stopAdding()}
                            onBlur={(e) => {
                              const wrap = e.currentTarget.closest(".mpaAddItemWrap");
                              setTimeout(() => { if (!wrap?.contains(document.activeElement)) stopAdding(); }, 150);
                            }}
                          />
                          {filteredProducts.length > 0 && (
                            <div className="mpaProductDrop">
                              {filteredProducts.map((p) => (
                                <button key={p.id} className="mpaProductOpt" onMouseDown={() => {
                                  onAddItem(date, period.mealPeriod, p); stopAdding();
                                }}>
                                  <span>{p.name}</span>
                                  <span className="mpaProductOptPrice">{fmt(p.priceCents)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          className="mpaAddDashed"
                          onClick={() => { setAddingItem({ date, mealPeriod: period.mealPeriod }); setProductSearch(""); }}
                        >
                          <span className="material-symbols-outlined">add</span>
                          Agregar
                        </button>
                      )}
                    </div>
                  );
                })
              )}

              {addingPeriodDate === date ? (
                <div className="mpaAddPeriodForm" style={{ margin: 0, marginTop: 4 }}>
                  <input
                    ref={addPeriodInputRef}
                    autoFocus
                    className="mpaAddItemInput"
                    style={{ width: "100%" }}
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
                <button className="mpaAddPeriodBtnGrid" onClick={() => setAddingPeriodDate(date)}>
                  <span className="material-symbols-outlined">add</span>
                  Turno
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
