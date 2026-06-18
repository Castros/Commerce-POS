"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiGet, apiPut, apiPatch } from "../lib/api";
import type { Store } from "../lib/demoTypes";

// ── Types ────────────────────────────────────────────────────────
type Product = { id: string; name: string; priceCents: number };
type MenuItem = { productId: string; name: string; priceCents: number };

type PeriodEntry = {
  id?: string;
  date: string;
  mealPeriod: string;   // free text: "Almuerzo", "Comida", "Cena", anything
  items: MenuItem[];
  published: boolean;
  notes: string | null;
};

type OrgInfo = { id: string; name: string };

// ── Constants ────────────────────────────────────────────────────
const PERIOD_SUGGESTIONS = ["Almuerzo", "Comida", "Cena", "Merienda", "Desayuno"];

// ── Helpers ──────────────────────────────────────────────────────
function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

function formatWeekRange(start: Date): string {
  const end = addDays(start, 4);
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString("es-MX", o)} – ${end.toLocaleDateString("es-MX", { ...o, year: "numeric" })}`;
}

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return {
    short: d.toLocaleDateString("es-MX", { month: "short", day: "numeric" }).toUpperCase(),
    weekday: d.toLocaleDateString("es-MX", { weekday: "long" }),
  };
}

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

// ── Toggle switch component ───────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
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

// ── Main component ───────────────────────────────────────────────
export default function MenuClient() {
  const [org, setOrg]       = useState<OrgInfo | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [periods, setPeriods]     = useState<PeriodEntry[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);

  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [activeTab, setActiveTab] = useState<"manual" | "ai">("manual");

  // Which day+period has the inline "Add Item" input open
  const [addingItem, setAddingItem] = useState<{ date: string; mealPeriod: string } | null>(null);
  const [productSearch, setProductSearch] = useState("");

  // Which day is showing the "Add period" form
  const [addingPeriodDate, setAddingPeriodDate] = useState<string | null>(null);
  const [newPeriodName, setNewPeriodName] = useState("");
  const addPeriodInputRef = useRef<HTMLInputElement>(null);

  // AI import state
  const [aiFile, setAiFile]       = useState<File | null>(null);
  const [aiText, setAiText]       = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<any[] | null>(null);
  const [aiError, setAiError]     = useState("");
  const [aiOverrides, setAiOverrides] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const today = toDateStr(new Date());
  const weekDates = Array.from({ length: 5 }, (_, i) => toDateStr(addDays(weekStart, i)));

  // ── Load org + stores ──────────────────────────────────────────
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

  // ── Load products ──────────────────────────────────────────────
  useEffect(() => {
    if (!org) return;
    apiGet<Product[]>(`/products?organizationId=${org.id}`).then(setProducts).catch(() => {});
  }, [org]);

  // ── Load menu ──────────────────────────────────────────────────
  const loadMenu = useCallback(async () => {
    if (!org || selectedStoreIds.size === 0) return;
    setLoading(true); setError("");
    try {
      const storeId = [...selectedStoreIds][0];
      const from = toDateStr(weekStart);
      const to   = toDateStr(addDays(weekStart, 4));
      const rows  = await apiGet<PeriodEntry[]>(
        `/menu?organizationId=${org.id}&storeId=${storeId}&from=${from}&to=${to}`
      );
      // Start with one default "Comida" per day
      const defaults: PeriodEntry[] = weekDates.map((date) => ({
        date, mealPeriod: "comida", items: [], published: false, notes: null
      }));
      // Merge DB rows on top of defaults
      for (const row of rows) {
        const idx = defaults.findIndex(
          (p) => p.date === row.date && p.mealPeriod === row.mealPeriod
        );
        if (idx >= 0) defaults[idx] = row;
        else defaults.push(row);
      }
      // Sort: by date then alphabetically by period name
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

  // ── Period helpers ─────────────────────────────────────────────
  function getDayPeriods(date: string) {
    return periods.filter((p) => p.date === date);
  }

  function updatePeriod(date: string, mealPeriod: string, patch: Partial<PeriodEntry>) {
    setPeriods((prev) =>
      prev.map((p) => p.date === date && p.mealPeriod === mealPeriod ? { ...p, ...patch } : p)
    );
  }

  function addItemToPeriod(date: string, mealPeriod: string, product: Product) {
    const period = periods.find((p) => p.date === date && p.mealPeriod === mealPeriod);
    if (!period || period.items.find((i) => i.productId === product.id)) return;
    updatePeriod(date, mealPeriod, {
      items: [...period.items, { productId: product.id, name: product.name, priceCents: product.priceCents }]
    });
    setAddingItem(null);
    setProductSearch("");
  }

  function removeItemFromPeriod(date: string, mealPeriod: string, productId: string) {
    const period = periods.find((p) => p.date === date && p.mealPeriod === mealPeriod);
    if (!period) return;
    updatePeriod(date, mealPeriod, { items: period.items.filter((i) => i.productId !== productId) });
  }

  function addPeriodToDay(date: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (periods.find((p) => p.date === date && p.mealPeriod.toLowerCase() === key)) return;
    setPeriods((prev) => {
      const next = [...prev, { date, mealPeriod: trimmed, items: [], published: false, notes: null }];
      return next.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.mealPeriod.localeCompare(b.mealPeriod)
      );
    });
    setAddingPeriodDate(null);
    setNewPeriodName("");
  }

  function removePeriod(date: string, mealPeriod: string) {
    const p = periods.find((e) => e.date === date && e.mealPeriod === mealPeriod);
    if (p?.items.length) {
      if (!confirm(`¿Eliminar el turno "${mealPeriod}" y sus ${p.items.length} platillo(s)?`)) return;
    }
    setPeriods((prev) => prev.filter((e) => !(e.date === date && e.mealPeriod === mealPeriod)));
  }

  // ── Toggle publish ─────────────────────────────────────────────
  async function togglePublish(date: string, mealPeriod: string) {
    if (!org) return;
    const p = periods.find((e) => e.date === date && e.mealPeriod === mealPeriod);
    if (!p) return;
    if (!p.id) { setError("Guarda el menú primero antes de publicar"); return; }
    try {
      const updated = await apiPatch<{ published: boolean }>(`/menu/${p.id}/publish`, {
        organizationId: org.id, published: !p.published
      });
      updatePeriod(date, mealPeriod, { published: updated.published });
    } catch { setError("Error al cambiar el estado de publicación"); }
  }

  // ── Save week ─────────────────────────────────────────────────
  async function saveWeek() {
    if (!org || selectedStoreIds.size === 0) return;
    setSaving(true); setError(""); setSuccessMsg("");
    try {
      const saved = await apiPut<PeriodEntry[]>("/menu/week", {
        organizationId: org.id,
        storeIds: [...selectedStoreIds],
        days: periods.map((p) => ({
          date: p.date, mealPeriod: p.mealPeriod,
          items: p.items, published: p.published, notes: p.notes
        }))
      });
      // Update ids from response
      const byKey = Object.fromEntries(
        (saved as PeriodEntry[]).map((r) => [`${r.date}:${r.mealPeriod}`, r])
      );
      setPeriods((prev) => prev.map((p) => byKey[`${p.date}:${p.mealPeriod}`] ?? p));
      setSuccessMsg(`Guardado en ${selectedStoreIds.size} cafetería${selectedStoreIds.size > 1 ? "s" : ""}`);
      setTimeout(() => setSuccessMsg(""), 3500);
    } catch { setError("Error al guardar"); } finally { setSaving(false); }
  }

  // ── AI extract ─────────────────────────────────────────────────
  async function runAiExtract() {
    if (!org) return;
    if (!aiFile && !aiText.trim()) { setAiError("Sube una imagen o escribe el texto"); return; }
    setAiLoading(true); setAiError(""); setAiResults(null); setAiOverrides({});
    try {
      const form = new FormData();
      form.append("organizationId", org.id);
      form.append("weekStart", toDateStr(weekStart));
      if (aiFile) form.append("image", aiFile);
      else form.append("text", aiText);
      const res = await fetch("/api/v1/menu/ai-extract", { method: "POST", credentials: "include", body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Error al extraer");
      setAiResults(payload.data.days ?? []);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Error al procesar");
    } finally { setAiLoading(false); }
  }

  function applyAiResults() {
    if (!aiResults) return;
    const additions: PeriodEntry[] = [];
    for (const aiDay of aiResults) {
      const targetPeriod = "comida"; // AI always maps to comida by default
      const key = `${aiDay.date}:${targetPeriod}`;
      const existing = periods.find((p) => p.date === aiDay.date && p.mealPeriod === targetPeriod);
      const items: MenuItem[] = aiDay.items
        .filter((it: any) => it.productId || aiOverrides[`${aiDay.date}:${it.rawName}`])
        .map((it: any) => {
          const pid = aiOverrides[`${aiDay.date}:${it.rawName}`] ?? it.productId;
          const prod = products.find((p) => p.id === pid);
          return { productId: prod?.id ?? it.productId ?? "", name: prod?.name ?? it.name, priceCents: prod?.priceCents ?? it.priceCents };
        });
      if (existing) {
        updatePeriod(aiDay.date, targetPeriod, { items });
      } else {
        additions.push({ date: aiDay.date, mealPeriod: targetPeriod, items, published: false, notes: null });
      }
    }
    if (additions.length) setPeriods((prev) => [...prev, ...additions]);
    setAiResults(null); setActiveTab("manual");
  }

  // ── Store toggle ───────────────────────────────────────────────
  function toggleStore(id: string) {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  }

  const filteredProducts = productSearch.length >= 1
    ? products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8)
    : [];

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="mpaRoot">
      {/* ── Main content ── */}
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="mpaBtn mpaBtn--ghost">
              <span className="material-symbols-outlined">print</span>
              Imprimir
            </button>
          </div>
        </div>

        {/* Store filter */}
        {stores.length > 0 && (
          <div className="mpaStoreBar">
            <span className="mpaStoreBarLabel">Aplicar a:</span>
            {stores.map((s) => (
              <label key={s.id} className="mpaStoreCheck">
                <input
                  type="checkbox" checked={selectedStoreIds.has(s.id)}
                  onChange={() => toggleStore(s.id)}
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="mpaTabBar">
          <button className={`mpaTab${activeTab === "manual" ? " mpaTab--active" : ""}`} onClick={() => setActiveTab("manual")}>
            Manual
          </button>
          <button className={`mpaTab${activeTab === "ai" ? " mpaTab--active" : ""}`} onClick={() => setActiveTab("ai")}>
            Importar con IA <span style={{ fontSize: 10, marginLeft: 2 }}>✦</span>
          </button>
        </div>

        {error      && <div className="mpaAlert mpaAlert--error">{error}</div>}

        {/* ══ MANUAL TAB ══ */}
        {activeTab === "manual" && (
          <div className="mpaDayList">
            {loading ? (
              <div className="mpaEmpty">Cargando menú…</div>
            ) : (
              weekDates.map((date) => {
                const dayPeriods = getDayPeriods(date);
                const { short, weekday } = formatDayLabel(date);
                const isToday = date === today;

                return (
                  <div key={date} className={`mpaDayCard${isToday ? " mpaDayCard--today" : ""}`}>
                    {/* Date column */}
                    <div className="mpaDayDate">
                      <span className="mpaDayDateShort">{short}</span>
                      <span className="mpaDayDateWeekday">{weekday}</span>
                    </div>

                    {/* Periods column */}
                    <div className="mpaDayPeriods">
                      {dayPeriods.map((period) => {
                        const isAdding = addingItem?.date === date && addingItem?.mealPeriod === period.mealPeriod;
                        const canRemove = dayPeriods.length > 1; // always keep at least one period

                        return (
                          <div key={period.mealPeriod} className="mpaPeriodRow">
                            {/* Period label */}
                            <span className="mpaPeriodLabel">
                              {period.mealPeriod}
                              {canRemove && (
                                <button
                                  className="mpaPeriodRemove"
                                  title={`Eliminar turno ${period.mealPeriod}`}
                                  onClick={() => removePeriod(date, period.mealPeriod)}
                                >
                                  <span className="material-symbols-outlined">close</span>
                                </button>
                              )}
                            </span>

                            {/* Items + add item */}
                            <div className="mpaPeriodChips">
                              {period.items.length === 0 && !isAdding && (
                                <span className="mpaChipsEmpty">Sin platillos…</span>
                              )}

                              {period.items.map((item) => (
                                <span key={item.productId} className="mpaChip">
                                  {item.name}
                                  <span className="mpaChipPrice">{fmt(item.priceCents)}</span>
                                  <button
                                    className="mpaChipRemove"
                                    onClick={() => removeItemFromPeriod(date, period.mealPeriod, item.productId)}
                                  >
                                    <span className="material-symbols-outlined">close</span>
                                  </button>
                                </span>
                              ))}

                              {/* Inline add-item input */}
                              {isAdding ? (
                                <div className="mpaAddItemWrap">
                                  <input
                                    autoFocus
                                    className="mpaAddItemInput"
                                    placeholder="Buscar platillo…"
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    onKeyDown={(e) => e.key === "Escape" && (setAddingItem(null), setProductSearch(""))}
                                    onBlur={(e) => {
                                      const wrap = e.currentTarget.closest(".mpaAddItemWrap");
                                      setTimeout(() => {
                                        if (!wrap?.contains(document.activeElement)) {
                                          setAddingItem(null); setProductSearch("");
                                        }
                                      }, 150);
                                    }}
                                  />
                                  {filteredProducts.length > 0 && (
                                    <div className="mpaProductDrop">
                                      {filteredProducts.map((p) => (
                                        <button
                                          key={p.id} className="mpaProductOpt"
                                          onMouseDown={() => addItemToPeriod(date, period.mealPeriod, p)}
                                        >
                                          <span>{p.name}</span>
                                          <span className="mpaProductOptPrice">{fmt(p.priceCents)}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <button
                                  className="mpaAddItemBtn"
                                  onClick={() => { setAddingItem({ date, mealPeriod: period.mealPeriod }); setProductSearch(""); }}
                                >
                                  <span className="material-symbols-outlined">add</span>
                                  Agregar
                                </button>
                              )}
                            </div>

                            {/* Publish toggle */}
                            <div className="mpaPeriodRight">
                              <span className={`mpaPublishLabel${period.published ? " mpaPublishLabel--on" : ""}`}>
                                {period.published ? "PUBLICADO" : "BORRADOR"}
                              </span>
                              <Toggle
                                on={period.published}
                                onChange={() => void togglePublish(date, period.mealPeriod)}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* Add period row */}
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
                              if (e.key === "Enter") addPeriodToDay(date, newPeriodName);
                              if (e.key === "Escape") { setAddingPeriodDate(null); setNewPeriodName(""); }
                            }}
                          />
                          <div className="mpaPeriodSuggestions">
                            {PERIOD_SUGGESTIONS
                              .filter((s) => !getDayPeriods(date).find((p) => p.mealPeriod.toLowerCase() === s.toLowerCase()))
                              .map((s) => (
                                <button key={s} className="mpaSuggestionChip" onClick={() => addPeriodToDay(date, s)}>
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
              })
            )}
          </div>
        )}

        {/* ══ AI IMPORT TAB ══ */}
        {activeTab === "ai" && (
          <div className="mpaAiPanel">
            <div
              className={`mpaAiZone${aiFile ? " mpaAiZone--hasFile" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setAiFile(f); setAiText(""); } }}
            >
              <input
                ref={fileInputRef} type="file" accept="image/*,.pdf" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setAiFile(f); setAiText(""); } }}
              />
              {aiFile ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 32, color: "var(--primary, #005c55)" }}>image</span>
                  <div>
                    <strong>{aiFile.name}</strong>
                    <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#6b7280" }}>{(aiFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button className="mpaBtn mpaBtn--ghost mpaBtn--sm" style={{ marginLeft: "auto" }}
                    onClick={(e) => { e.stopPropagation(); setAiFile(null); }}>Quitar</button>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 36, color: "#9ca3af" }}>cloud_upload</span>
                  <div>
                    <strong>Arrastra la imagen o PDF del menú</strong>
                    <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#6b7280" }}>o haz clic para seleccionar</p>
                  </div>
                </>
              )}
            </div>

            <div className="mpaAiSep"><span>o escribe el menú</span></div>
            <textarea
              className="mpaAiTextarea"
              placeholder={"Lunes: Arroz con Pollo, Ensalada César\nMartes: Tacos, Agua de Jamaica\n..."}
              rows={5} value={aiText} disabled={!!aiFile}
              onChange={(e) => setAiText(e.target.value)}
            />
            {aiError && <div className="mpaAlert mpaAlert--error" style={{ marginTop: 12 }}>{aiError}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button className="mpaBtn mpaBtn--primary" onClick={() => void runAiExtract()}
                disabled={aiLoading || (!aiFile && !aiText.trim())}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
                {aiLoading ? "Extrayendo…" : "Extraer con IA"}
              </button>
            </div>

            {aiResults && aiResults.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p className="mpaLabel" style={{ marginBottom: 12 }}>Revisa los resultados antes de aplicar</p>
                <div className="tableWrapper">
                  <table className="dataTable">
                    <thead>
                      <tr><th>Día</th><th>Texto extraído</th><th>Producto</th><th>Precio</th><th>Match</th></tr>
                    </thead>
                    <tbody>
                      {aiResults.flatMap((d: any) =>
                        d.items.map((it: any, i: number) => {
                          const key = `${d.date}:${it.rawName}`;
                          const score = it.score as number;
                          const badge = score >= 90 ? "aiScoreBadge--green" : score >= 70 ? "aiScoreBadge--amber" : "aiScoreBadge--red";
                          return (
                            <tr key={`${d.date}-${i}`}>
                              <td><strong style={{ textTransform: "capitalize" }}>{formatDayLabel(d.date).weekday}</strong></td>
                              <td style={{ fontSize: "0.875rem", color: "#6b7280" }}>{it.rawName}</td>
                              <td>
                                <select className="formSelect" style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                                  value={aiOverrides[key] ?? it.productId ?? ""}
                                  onChange={(e) => setAiOverrides((prev) => ({ ...prev, [key]: e.target.value }))}>
                                  <option value="">— Sin match —</option>
                                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              </td>
                              <td style={{ whiteSpace: "nowrap", fontSize: "0.875rem" }}>{fmt(it.priceCents)}</td>
                              <td><span className={`aiScoreBadge ${badge}`}>{it.matched ? `${score}%` : "Sin match"}</span></td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                  <button className="mpaBtn mpaBtn--ghost" onClick={() => setAiResults(null)}>Cancelar</button>
                  <button className="mpaBtn mpaBtn--primary" onClick={applyAiResults}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                    Aplicar al menú
                  </button>
                </div>
              </div>
            )}
            {aiResults?.length === 0 && (
              <div className="mpaEmpty" style={{ marginTop: 24 }}>
                <span className="material-symbols-outlined">search_off</span>
                No se encontraron platillos.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky footer ── */}
      <footer className="mpaFooter">
        {successMsg && <span className="mpaFooterMsg">{successMsg}</span>}
        {!successMsg && <span className="mpaFooterMsg" style={{ color: "#9ca3af" }}>
          {saving ? "Guardando…" : ""}
        </span>}
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
