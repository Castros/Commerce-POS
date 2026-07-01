"use client";

import { useEffect, useRef, useState } from "react";
import type { ControlsData, SpendingControls } from "./dashboardTypes";

export function SpendingControlsPanel({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ControlsData | null>(null);
  const [limitEnabled, setLimitEnabled] = useState(false);
  const [limitCents, setLimitCents] = useState(5000);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || data) return;
    fetch(`/api/v1/guardian-portal/students/${studentId}/spending-controls`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((p) => {
        if (!p?.data) return;
        setData(p.data);
        const sc: SpendingControls = p.data.spendingControls;
        setLimitEnabled(sc.daily_limit_cents != null);
        setLimitCents(sc.daily_limit_cents ?? 5000);
        setBlockedIds(sc.blocked_category_ids ?? []);
      })
      .catch(() => {});
  }, [open, studentId, data]);

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      const r = await fetch(`/api/v1/guardian-portal/students/${studentId}/spending-controls`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimitCents: limitEnabled ? limitCents : null, blockedCategoryIds: blockedIds }),
      });
      if (r.ok) {
        setSaved(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setSaved(false), 3000);
      }
    } finally { setSaving(false); }
  }

  const categories = data?.availableCategories ?? [];
  const hasActive = limitEnabled || blockedIds.length > 0;

  return (
    <>
      <button className={`ppControlsToggle${open ? " ppControlsToggle--open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <div className="ppControlsToggleLeft">
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--pp-primary)" }}>shield</span>
          <span>Controles de gasto</span>
          {hasActive && <span className="ppControlsBadge">Activo</span>}
        </div>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--pp-muted)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}>
          expand_more
        </span>
      </button>

      {open && (
        <div className="ppControlsBody">
          {!data ? (
            <p style={{ fontSize: "0.82rem", color: "var(--pp-muted)", textAlign: "center", padding: "8px 0" }}>Cargando…</p>
          ) : (
            <>
              <div className="ppControlsRow">
                <div className="ppControlsRowInfo">
                  <p className="ppControlsRowLabel">Límite diario</p>
                  <p className="ppControlsRowSub">Máximo de gasto por día</p>
                </div>
                <button className={`ppToggle${limitEnabled ? " ppToggle--on" : ""}`} onClick={() => setLimitEnabled((v) => !v)}>
                  <span className="ppToggleKnob" />
                </button>
              </div>
              {limitEnabled && (
                <div className="ppAmountInput">
                  <span>$</span>
                  <input type="number" min={0} step={1}
                    value={(limitCents / 100).toFixed(0)}
                    onChange={(e) => setLimitCents(Math.max(0, Math.round(Number(e.target.value) * 100)))}
                  />
                  <span>/ día</span>
                </div>
              )}
              {categories.length > 0 && (
                <div>
                  <p className="ppControlsRowLabel" style={{ marginBottom: 4 }}>Categorías bloqueadas</p>
                  <p className="ppControlsRowSub" style={{ marginBottom: 8 }}>Tu hijo(a) no podrá comprar de estas categorías</p>
                  <div className="ppCategoryChips">
                    {categories.map((cat) => {
                      const blocked = blockedIds.includes(cat.id);
                      return (
                        <button key={cat.id}
                          className={`ppCategoryChip${blocked ? " ppCategoryChip--blocked" : ""}`}
                          onClick={() => setBlockedIds((prev) => blocked ? prev.filter((x) => x !== cat.id) : [...prev, cat.id])}
                        >
                          <span className="material-symbols-outlined">{blocked ? "block" : "add"}</span>
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <button className="ppSaveBtn" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {saved && <p style={{ fontSize: "0.78rem", color: "#059669", textAlign: "center", margin: 0 }}>✓ Guardado</p>}
            </>
          )}
        </div>
      )}
    </>
  );
}
