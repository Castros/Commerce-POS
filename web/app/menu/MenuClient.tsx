"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPut, apiPatch } from "../lib/api";
import type { Store } from "../lib/demoTypes";
import type { Product, MenuItem, PeriodEntry } from "./menuTypes";
import { getWeekStart, addDays, toDateStr, formatWeekRange } from "./menuTypes";
import MenuDayList from "./MenuDayList";
import MenuAiTab from "./MenuAiTab";

type OrgInfo = { id: string; name: string };

export default function MenuClient() {
  const [org, setOrg]       = useState<OrgInfo | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [periods, setPeriods]     = useState<PeriodEntry[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);

  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [activeTab, setActiveTab]   = useState<"manual" | "ai">("manual");

  const today     = toDateStr(new Date());
  const weekDates = Array.from({ length: 5 }, (_, i) => toDateStr(addDays(weekStart, i)));

  useEffect(() => {
    apiGet<any>("/auth/me").then((s) => {
      const id = s.user.organizationId as string;
      setOrg({ id, name: s.user.organizationName as string });
      return apiGet<Store[]>(`/stores?organizationId=${id}`);
    }).then((list) => {
      setStores(list);
      setSelectedStoreIds(new Set(list.map((s) => s.id)));
    }).catch(() => setError("No se pudo cargar la información"));
  }, []);

  useEffect(() => {
    if (!org) return;
    apiGet<Product[]>(`/products?organizationId=${org.id}`).then(setProducts).catch(() => {});
  }, [org]);

  const loadMenu = useCallback(async () => {
    if (!org || selectedStoreIds.size === 0) return;
    setLoading(true); setError("");
    try {
      const storeId = [...selectedStoreIds][0];
      const from = toDateStr(weekStart);
      const to   = toDateStr(addDays(weekStart, 4));
      const rows = await apiGet<PeriodEntry[]>(
        `/menu?organizationId=${org.id}&storeId=${storeId}&from=${from}&to=${to}`
      );
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
    } catch {
      setError("No se pudo cargar el menú");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, selectedStoreIds, weekStart]);

  useEffect(() => { void loadMenu(); }, [loadMenu]);

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

  async function handleTogglePublish(date: string, mealPeriod: string) {
    if (!org) return;
    const p = periods.find((e) => e.date === date && e.mealPeriod === mealPeriod);
    if (!p) return;
    if (!p.id) { setError("Guarda el menú primero antes de publicar"); return; }
    try {
      const updated = await apiPatch<{ published: boolean }>(`/menu/${p.id}/publish`, {
        organizationId: org.id, published: !p.published,
      });
      updatePeriod(date, mealPeriod, { published: updated.published });
    } catch { setError("Error al cambiar el estado de publicación"); }
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
    setActiveTab("manual");
  }

  async function saveWeek() {
    if (!org || selectedStoreIds.size === 0) return;
    setSaving(true); setError(""); setSuccessMsg("");
    try {
      const saved = await apiPut<PeriodEntry[]>("/menu/week", {
        organizationId: org.id,
        storeIds: [...selectedStoreIds],
        days: periods.map((p) => ({
          date: p.date, mealPeriod: p.mealPeriod,
          items: p.items, published: p.published, notes: p.notes,
        })),
      });
      const byKey = Object.fromEntries(
        (saved as PeriodEntry[]).map((r) => [`${r.date}:${r.mealPeriod}`, r])
      );
      setPeriods((prev) => prev.map((p) => byKey[`${p.date}:${p.mealPeriod}`] ?? p));
      setSuccessMsg(`Guardado en ${selectedStoreIds.size} cafetería${selectedStoreIds.size > 1 ? "s" : ""}`);
      setTimeout(() => setSuccessMsg(""), 3500);
    } catch { setError("Error al guardar"); } finally { setSaving(false); }
  }

  function toggleStore(id: string) {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mpaRoot">
      <div className="mpaContent">
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="mpaBtn mpaBtn--ghost">
              <span className="material-symbols-outlined">print</span>
              Imprimir
            </button>
          </div>
        </div>

        {stores.length > 0 && (
          <div className="mpaStoreBar">
            <span className="mpaStoreBarLabel">Aplicar a:</span>
            {stores.map((s) => (
              <label key={s.id} className="mpaStoreCheck">
                <input type="checkbox" checked={selectedStoreIds.has(s.id)} onChange={() => toggleStore(s.id)} />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        )}

        <div className="mpaTabBar">
          <button className={`mpaTab${activeTab === "manual" ? " mpaTab--active" : ""}`} onClick={() => setActiveTab("manual")}>
            Manual
          </button>
          <button className={`mpaTab${activeTab === "ai" ? " mpaTab--active" : ""}`} onClick={() => setActiveTab("ai")}>
            Importar con IA <span style={{ fontSize: 10, marginLeft: 2 }}>✦</span>
          </button>
        </div>

        {error && <div className="mpaAlert mpaAlert--error">{error}</div>}

        {activeTab === "manual" && (
          <MenuDayList
            weekDates={weekDates}
            today={today}
            loading={loading}
            periods={periods}
            products={products}
            onAddItem={handleAddItem}
            onRemoveItem={handleRemoveItem}
            onRemovePeriod={handleRemovePeriod}
            onAddPeriod={handleAddPeriod}
            onTogglePublish={handleTogglePublish}
          />
        )}

        {activeTab === "ai" && org && (
          <MenuAiTab
            weekStart={weekStart}
            orgId={org.id}
            products={products}
            onApply={handleApplyAi}
            onClose={() => setActiveTab("manual")}
          />
        )}
      </div>

      <footer className="mpaFooter">
        {successMsg
          ? <span className="mpaFooterMsg">{successMsg}</span>
          : <span className="mpaFooterMsg" style={{ color: "#9ca3af" }}>{saving ? "Guardando…" : ""}</span>
        }
        <button
          className="mpaBtn mpaBtn--primary"
          onClick={() => void saveWeek()}
          disabled={saving || selectedStoreIds.size === 0}
        >
          {saving ? "Guardando…" : "Guardar Semana"}
        </button>
      </footer>
    </div>
  );
}
