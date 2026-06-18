"use client";

import { useState, useRef } from "react";
import type { Product, MenuItem } from "./menuTypes";
import { toDateStr, formatDayLabel, fmt } from "./menuTypes";

type AiDayResult = {
  date: string;
  items: Array<{
    rawName: string;
    productId: string | null;
    name: string;
    priceCents: number;
    score: number;
    matched: boolean;
  }>;
};

type ApplyUpdate = { date: string; mealPeriod: string; items: MenuItem[] };

type Props = {
  weekStart: Date;
  orgId: string;
  products: Product[];
  onApply: (updates: ApplyUpdate[]) => void;
  onClose: () => void;
};

export default function MenuAiTab({ weekStart, orgId, products, onApply, onClose }: Props) {
  const [aiFile, setAiFile]       = useState<File | null>(null);
  const [aiText, setAiText]       = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<AiDayResult[] | null>(null);
  const [aiError, setAiError]     = useState("");
  const [aiOverrides, setAiOverrides] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function runAiExtract() {
    if (!aiFile && !aiText.trim()) { setAiError("Sube una imagen o escribe el texto"); return; }
    setAiLoading(true); setAiError(""); setAiResults(null); setAiOverrides({});
    try {
      const form = new FormData();
      form.append("organizationId", orgId);
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

  function handleApply() {
    if (!aiResults) return;
    const updates: ApplyUpdate[] = aiResults.map((aiDay) => {
      const items: MenuItem[] = aiDay.items
        .filter((it) => it.productId || aiOverrides[`${aiDay.date}:${it.rawName}`])
        .map((it) => {
          const pid = aiOverrides[`${aiDay.date}:${it.rawName}`] ?? it.productId ?? "";
          const prod = products.find((p) => p.id === pid);
          return { productId: pid, name: prod?.name ?? it.name, priceCents: prod?.priceCents ?? it.priceCents };
        });
      return { date: aiDay.date, mealPeriod: "comida", items };
    });
    onApply(updates);
  }

  return (
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
                {aiResults.flatMap((d) =>
                  d.items.map((it, i) => {
                    const key = `${d.date}:${it.rawName}`;
                    const score = it.score;
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
            <button className="mpaBtn mpaBtn--ghost" onClick={onClose}>Cancelar</button>
            <button className="mpaBtn mpaBtn--primary" onClick={handleApply}>
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
  );
}
