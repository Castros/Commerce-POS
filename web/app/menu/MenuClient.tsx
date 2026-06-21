"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPut, apiPatch } from "../lib/api";
import type { Store } from "../lib/demoTypes";
import type { Product, MenuItem, PeriodEntry } from "./menuTypes";
import { getWeekStart, addDays, toDateStr, formatWeekRange } from "./menuTypes";
import MenuWeekGrid from "./MenuWeekGrid";
import MenuAiTab from "./MenuAiTab";
import MenuCoverageSection from "./MenuCoverageSection";

type OrgInfo = { id: string; name: string };

export default function MenuClient() {
  const [org, setOrg]       = useState<OrgInfo | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string>("");
  const [saveToStoreIds, setSaveToStoreIds] = useState<Set<string>>(new Set());
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [periods, setPeriods]     = useState<PeriodEntry[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);

  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [mode, setMode]             = useState<"manual" | "ai">("manual");
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [coverageKey, setCoverageKey] = useState(0);
  const [savedDates, setSavedDates]   = useState<Set<string>>(new Set());
  const copyMenuRef = useRef<HTMLDivElement>(null);

  const today     = toDateStr(new Date());
  const weekDates = Array.from({ length: 5 }, (_, i) => toDateStr(addDays(weekStart, i)));
  const multiStore = stores.length > 1;

  // Close copy-to popup on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    }
    if (showCopyMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCopyMenu]);

  useEffect(() => {
    apiGet<any>("/auth/me").then((s) => {
      const id = s.user.organizationId as string;
      setOrg({ id, name: s.user.organizationName as string });
      return apiGet<Store[]>(`/stores?organizationId=${id}`);
    }).then((list) => {
      setStores(list);
      if (list.length > 0) {
        setActiveStoreId(list[0].id);
        setSaveToStoreIds(new Set(list.map((s) => s.id)));
      }
    }).catch(() => setError("No se pudo cargar la información"));
  }, []);

  useEffect(() => {
    if (!org) return;
    apiGet<Product[]>(`/products?organizationId=${org.id}`).then(setProducts).catch(() => {});
  }, [org]);

  const loadMenu = useCallback(async (signal: AbortSignal) => {
    if (!org || !activeStoreId) return;
    setLoading(true); setError("");
    try {
      const from = toDateStr(weekStart);
      const to   = toDateStr(addDays(weekStart, 4));
      const rows = await apiGet<PeriodEntry[]>(
        `/menu?organizationId=${org.id}&storeId=${activeStoreId}&from=${from}&to=${to}`,
        { signal }
      );
      if (signal.aborted) return;
      const defaults: PeriodEntry[] = weekDates.map((date) => ({
        date, mealPeriod: "comida", items: [], published: false, notes: null,
      }));
      for (const row of rows) {
        const idx = defaults.findIndex((p) => p.date === row.date && p.mealPeriod === row.mealPeriod);
        if (idx >= 0) defaults[idx] = row;
        else defaults.push(row);
      }
      defaults.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.mealPeriod.localeCompare(b.mealPeriod)
      );
      setPeriods(defaults);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("No se pudo cargar el menú");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, activeStoreId, weekStart]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMenu(controller.signal);
    return () => controller.abort();
  }, [loadMenu]);

  function updatePeriod(date: string, mealPeriod: string, patch: Partial<PeriodEntry>) {
    setPeriods((prev) =>
      prev.map((p) => p.date === date && p.mealPeriod === mealPeriod ? { ...p, ...patch } : p)
    );
  }

  function handleAddItem(date: string, mealPeriod: string, product: Product) {
    const period = periods.find((p) => p.date === date && p.mealPeriod === mealPeriod);
    if (!period || period.items.find((i) => i.productId === product.id)) return;
    updatePeriod(date, mealPeriod, {
      items: [...period.items, { productId: product.id, name: product.name, priceCents: product.priceCents }],
    });
  }

  function handleRemoveItem(date: string, mealPeriod: string, productId: string) {
    const period = periods.find((p) => p.date === date && p.mealPeriod === mealPeriod);
    if (!period) return;
    updatePeriod(date, mealPeriod, { items: period.items.filter((i) => i.productId !== productId) });
  }

  function handleAddPeriod(date: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (periods.find((p) => p.date === date && p.mealPeriod.toLowerCase() === trimmed.toLowerCase())) return;
    setPeriods((prev) => {
      const next = [...prev, { date, mealPeriod: trimmed, items: [], published: false, notes: null }];
      return next.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.mealPeriod.localeCompare(b.mealPeriod)
      );
    });
  }

  function handleRemovePeriod(date: string, mealPeriod: string) {
    const p = periods.find((e) => e.date === date && e.mealPeriod === mealPeriod);
    if (p?.items.length) {
      if (!confirm(`¿Eliminar el turno "${mealPeriod}" y sus ${p.items.length} platillo(s)?`)) return;
    }
    setPeriods((prev) => prev.filter((e) => !(e.date === date && e.mealPeriod === mealPeriod)));
  }

  async function handleToggleDayPublish(date: string) {
    if (!org) return;
    const dayPeriods = periods.filter((p) => p.date === date && p.items.length > 0);
    const unsaved = dayPeriods.filter((p) => !p.id);
    if (unsaved.length > 0) { setError("Guarda el menú primero antes de publicar"); return; }
    const target = !dayPeriods.some((p) => p.published);
    // Optimistic update
    dayPeriods.forEach((p) => updatePeriod(date, p.mealPeriod, { published: target }));
    for (const p of dayPeriods) {
      try {
        await apiPatch<{ published: boolean }>(`/menu/${p.id}/publish`, {
          organizationId: org.id, published: target,
        });
      } catch { setError("Error al cambiar el estado de publicación"); }
    }
  }

  function handleApplyAi(updates: Array<{ date: string; mealPeriod: string; items: MenuItem[] }>) {
    setPeriods((prev) => {
      let next = [...prev];
      for (const upd of updates) {
        const idx = next.findIndex((p) => p.date === upd.date && p.mealPeriod === upd.mealPeriod);
        if (idx >= 0) {
          next[idx] = { ...next[idx], items: upd.items };
        } else {
          next.push({ date: upd.date, mealPeriod: upd.mealPeriod, items: upd.items, published: false, notes: null });
        }
      }
      return next.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.mealPeriod.localeCompare(b.mealPeriod)
      );
    });
    setMode("manual");
  }

  function handleEditFromCoverage(storeId: string) {
    setActiveStoreId(storeId);
    setSaveToStoreIds((prev) => {
      const next = new Set(prev);
      next.add(storeId);
      return next;
    });
  }

  async function saveWeek() {
    if (!org || saveToStoreIds.size === 0) return;
    setSaving(true); setError(""); setSuccessMsg("");
    try {
      const saved = await apiPut<PeriodEntry[]>("/menu/week", {
        organizationId: org.id,
        storeIds: [...saveToStoreIds],
        days: periods.map((p) => ({
          date: p.date, mealPeriod: p.mealPeriod,
          items: p.items, published: p.published, notes: p.notes,
        })),
      });
      const byKey = Object.fromEntries(
        (saved as PeriodEntry[]).map((r) => [`${r.date}:${r.mealPeriod}`, r])
      );
      setPeriods((prev) => prev.map((p) => byKey[`${p.date}:${p.mealPeriod}`] ?? p));
      setCoverageKey((k) => k + 1);
      setSavedDates(new Set(weekDates));
      setSuccessMsg(`Guardado en ${saveToStoreIds.size} cafetería${saveToStoreIds.size > 1 ? "s" : ""}`);
      setTimeout(() => { setSuccessMsg(""); setSavedDates(new Set()); }, 3500);
    } catch { setError("Error al guardar"); } finally { setSaving(false); }
  }

  function toggleSaveTo(id: string) {
    setSaveToStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mpaRoot">
      <div className="mpaContent">

        {/* Page header */}
        <div className="mpaPageHeader">
          <div>
            <h1 className="mpaPageTitle">Menú Semanal</h1>
            <div className="mpaWeekNav">
              <button className="mpaWeekNavBtn" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <span className="mpaWeekRange">{formatWeekRange(weekStart)}</span>
              <button className="mpaWeekNavBtn" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              {toDateStr(getWeekStart(new Date())) !== toDateStr(weekStart) && (
                <button className="mpaWeekToday" onClick={() => setWeekStart(getWeekStart(new Date()))}>
                  Esta semana
                </button>
              )}
            </div>
          </div>
          <button className="mpaBtn mpaBtn--ghost">
            <span className="material-symbols-outlined">print</span>
            Imprimir
          </button>
        </div>

        {/* Coverage heatmap + cafeteria tabs — grouped when multi-store */}
        {org && multiStore && (
          <div className="mpaCoverageBlock">
            <MenuCoverageSection
              orgId={org.id}
              stores={stores}
              weekDates={weekDates}
              today={today}
              activeStoreId={activeStoreId}
              onEditStore={handleEditFromCoverage}
              refreshKey={coverageKey}
            />
            <div className="mpaCafeTabs">
              {stores.map((s) => {
                const count = periods.filter((p) => p.date && p.items.length > 0 && activeStoreId === s.id).length;
                return (
                  <button
                    key={s.id}
                    className={`mpaCafeTab${activeStoreId === s.id ? " mpaCafeTab--active" : ""}`}
                    onClick={() => setActiveStoreId(s.id)}
                  >
                    {s.name}
                    {activeStoreId === s.id && count > 0 && (
                      <span style={{ marginLeft: 6, fontSize: "0.75rem", opacity: 0.7 }}>
                        ({count} {count === 1 ? "período" : "períodos"})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="mpaActionRow">
          <div className="mpaActionLeft">
            <button
              className={`mpaModeBtn${mode === "manual" ? " mpaModeBtn--active" : ""}`}
              onClick={() => setMode("manual")}
            >
              Manual
            </button>
            <button
              className={`mpaModeBtn${mode === "ai" ? " mpaModeBtn--active" : ""}`}
              onClick={() => setMode("ai")}
            >
              Importar con IA
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>temp_preferences_custom</span>
            </button>
          </div>

          {multiStore && (
            <div style={{ position: "relative" }} ref={copyMenuRef}>
              <button className="mpaCopyBtn" onClick={() => setShowCopyMenu((v) => !v)}>
                Guardar en
                <span className="mpaSaveToBadge">{saveToStoreIds.size}</span>
                {saveToStoreIds.size === stores.length ? "cafeterías" : `de ${stores.length}`}
                <span className="material-symbols-outlined">arrow_drop_down</span>
              </button>
              {showCopyMenu && (
                <div className="mpaCopyPopup">
                  <span className="mpaLabel" style={{ marginBottom: 4 }}>Guardar en:</span>
                  {stores.map((s) => (
                    <label key={s.id} className="mpaStoreCheck">
                      <input
                        type="checkbox"
                        checked={saveToStoreIds.has(s.id)}
                        onChange={() => toggleSaveTo(s.id)}
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <div className="mpaAlert mpaAlert--error">{error}</div>}

        {/* Content area */}
        {mode === "manual" && (
          <MenuWeekGrid
            weekDates={weekDates}
            today={today}
            loading={loading}
            periods={periods}
            products={products}
            savedDates={savedDates}
            onAddItem={handleAddItem}
            onRemoveItem={handleRemoveItem}
            onRemovePeriod={handleRemovePeriod}
            onAddPeriod={handleAddPeriod}
            onToggleDayPublish={handleToggleDayPublish}
          />
        )}

        {mode === "ai" && org && (
          <MenuAiTab
            weekStart={weekStart}
            orgId={org.id}
            products={products}
            onApply={handleApplyAi}
            onClose={() => setMode("manual")}
          />
        )}

      </div>

      <footer className="mpaFooter">
        <span className="mpaFooterMsg" style={{ color: successMsg ? "#15803d" : "#9ca3af", display: "flex", alignItems: "center", gap: 6 }}>
          {successMsg ? (
            <><span className="material-symbols-outlined" style={{ fontSize: 16 }}>cloud_done</span>{successMsg}</>
          ) : saving ? "Guardando…" : (
            <><span className="material-symbols-outlined" style={{ fontSize: 16 }}>cloud_done</span>Cambios sin guardar</>
          )}
        </span>
        <button
          className="mpaBtn mpaBtn--primary"
          onClick={() => void saveWeek()}
          disabled={saving || saveToStoreIds.size === 0}
        >
          {saving ? "Guardando…" : "Guardar Semana"}
        </button>
      </footer>
    </div>
  );
}
