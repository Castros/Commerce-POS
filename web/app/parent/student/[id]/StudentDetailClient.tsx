"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
function studentAvatarUrl(publicId: string | null | undefined) {
  if (!publicId || !CLOUD_NAME) return null;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_80,h_80,c_fill,r_max,f_auto,q_auto/${publicId}`;
}

type Transaction = {
  id: string;
  createdAt: string;
  totalCents: number;
  paymentMethod: string;
  status: string;
  storeName: string | null;
  items: string[];
};

type StudentDetail = {
  id: string;
  name: string;
  avatarPublicId: string | null;
  balanceCents: number;
  currency: string;
};

type SpendingControls = {
  daily_limit_cents: number | null;
  blocked_category_ids: string[];
};

type Category = { id: string; name: string };

type ControlsData = {
  spendingControls: SpendingControls;
  availableCategories: Category[];
};

type StudentData = {
  student: StudentDetail;
  transactions: Transaction[];
  spendingControls?: SpendingControls;
};

function formatMoney(cents: number, currency = "USD") {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

function balanceClass(cents: number) {
  if (cents > 500) return "positive";
  if (cents >= 0) return "warning";
  return "negative";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit"
  });
}

const STATUS_LABELS: Record<string, string> = {
  completed: "",
  refunded: "Reembolsado",
  voided: "Cancelado"
};

const PAYMENT_LABELS: Record<string, string> = {
  wallet: "Monedero",
  cash: "Efectivo",
  card: "Tarjeta"
};

function SpendingControlsPanel({ studentId, initialControls }: { studentId: string; initialControls?: SpendingControls }) {
  const [controlsData, setControlsData] = useState<ControlsData | null>(null);
  const [open, setOpen] = useState(false);
  const [limitEnabled, setLimitEnabled] = useState(false);
  const [limitCents, setLimitCents] = useState(5000);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/v1/guardian-portal/students/${studentId}/spending-controls`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((payload) => {
        if (!payload?.data) return;
        setControlsData(payload.data);
        const sc: SpendingControls = payload.data.spendingControls;
        setLimitEnabled(sc.daily_limit_cents != null);
        setLimitCents(sc.daily_limit_cents ?? 5000);
        setBlockedIds(sc.blocked_category_ids ?? []);
      })
      .catch(() => {});
  }, [studentId]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch(`/api/v1/guardian-portal/students/${studentId}/spending-controls`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyLimitCents: limitEnabled ? limitCents : null,
          blockedCategoryIds: blockedIds
        })
      });
      if (r.ok) {
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(id: string) {
    setBlockedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const categories = controlsData?.availableCategories ?? [];
  const hasChanges = controlsData !== null;

  return (
    <div className="parentControlsCard">
      <div className="parentControlsHeader" onClick={() => setOpen((o) => !o)}>
        <span className="material-symbols-outlined">shield</span>
        <h3>Controles de Gasto</h3>
        {(limitEnabled || blockedIds.length > 0) && (
          <span style={{ fontSize: "0.7rem", background: "#fef3c7", color: "#92400e", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>
            Activo
          </span>
        )}
        <span className={`material-symbols-outlined chevron${open ? " open" : ""}`}>expand_more</span>
      </div>

      {open && (
        <div className="parentControlsBody">
          {!controlsData ? (
            <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>Cargando…</p>
          ) : (
            <>
              <div className="parentControlsRow">
                <div>
                  <label htmlFor={`limit-toggle-${studentId}`}>Límite diario</label>
                  <p>Máximo de gasto por día</p>
                </div>
                <label className="parentToggle">
                  <input
                    id={`limit-toggle-${studentId}`}
                    type="checkbox"
                    checked={limitEnabled}
                    onChange={(e) => setLimitEnabled(e.target.checked)}
                  />
                  <span className="parentToggleSlider" />
                </label>
              </div>

              {limitEnabled && (
                <div className="parentAmountInput">
                  <span>$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={(limitCents / 100).toFixed(0)}
                    onChange={(e) => setLimitCents(Math.max(0, Math.round(Number(e.target.value) * 100)))}
                  />
                  <span>MXN / día</span>
                </div>
              )}

              {categories.length > 0 && (
                <div className="parentControlsRow" style={{ flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
                  <label style={{ paddingBottom: 4 }}>Categorías bloqueadas</label>
                  <p style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "#9ca3af" }}>Tu hijo(a) no podrá comprar productos de estas categorías</p>
                  <div className="parentCategoryList">
                    {categories.map((cat) => {
                      const isBlocked = blockedIds.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={`parentCategoryChip${isBlocked ? " blocked" : ""}`}
                          onClick={() => toggleCategory(cat.id)}
                        >
                          <span className="material-symbols-outlined">
                            {isBlocked ? "block" : "add"}
                          </span>
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="parentSaveBtn"
                onClick={handleSave}
                disabled={saving || !hasChanges}
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {saved && <p className="parentSaveSuccess">✓ Controles actualizados</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function StudentDetailClient() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = params.id as string;
  const orgId = searchParams.get("org") ?? "";

  const [data, setData] = useState<StudentData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/v1/guardian-portal/students/${studentId}/transactions`, {
      credentials: "include"
    })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          router.replace(`/parent/login?org=${orgId}`);
          return null;
        }
        return r.json();
      })
      .then((payload) => {
        if (payload?.data) setData(payload.data);
        else if (payload) setError(payload.error || "Error al cargar");
      })
      .catch(() => setError("Error de conexión"));
  }, [studentId, orgId, router]);

  if (error) {
    return (
      <div className="parentEmptyState" style={{ paddingTop: 80 }}>
        <span className="material-symbols-outlined">error</span>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="parentEmptyState" style={{ paddingTop: 80 }}>
        <span className="material-symbols-outlined">hourglass_empty</span>
        Cargando…
      </div>
    );
  }

  const { student, transactions } = data;

  return (
    <>
      <header className="parentHeader">
        <div className="parentHeaderBrand">
          <span className="material-symbols-outlined fill">local_cafe</span>
          <span>Portal para Padres</span>
        </div>
        <div className="parentHeaderUser">
          <Link
            href={`/parent/dashboard?org=${orgId}`}
            style={{ color: "#6b7280", display: "flex", alignItems: "center", gap: 4, textDecoration: "none", fontSize: "0.875rem" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
            Regresar
          </Link>
        </div>
      </header>

      <main className="parentMain">
        <div className="parentStudentHeader">
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
            {studentAvatarUrl(student.avatarPublicId) ? (
              <Image
                src={studentAvatarUrl(student.avatarPublicId)!}
                alt={student.name}
                width={64}
                height={64}
                style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div style={{
                width: 64, height: 64, borderRadius: "50%", background: "#e5e7eb",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32, color: "#9ca3af" }}>person</span>
              </div>
            )}
            <div>
              <p style={{ margin: "0 0 2px", fontSize: "0.8rem", color: "#6b7280", fontWeight: 500 }}>Alumno</p>
              <h2 style={{ margin: 0, fontSize: "1.2rem" }}>{student.name}</h2>
            </div>
          </div>
          <p style={{ margin: "0 0 4px", fontSize: "0.8rem", color: "#6b7280", fontWeight: 500 }}>Saldo actual</p>
          <span className={`balance ${balanceClass(student.balanceCents)}`}>
            {formatMoney(student.balanceCents, student.currency)}
          </span>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="parentTopUpBtn" disabled title="Próximamente">
              <span className="material-symbols-outlined">add</span>
              Recargar saldo
            </button>
            <span style={{ marginLeft: 10, fontSize: "0.72rem", color: "#9ca3af" }}>Próximamente</span>
          </div>
        </div>

        <SpendingControlsPanel
          studentId={student.id}
          initialControls={data.spendingControls}
        />

        <p className="parentSectionTitle">Historial de compras ({transactions.length})</p>

        {transactions.length === 0 ? (
          <div className="parentEmptyState">
            <span className="material-symbols-outlined">receipt_long</span>
            Sin transacciones registradas
          </div>
        ) : (
          transactions.map((tx) => (
            <div key={tx.id} className="parentTxItem">
              <div className="parentTxLeft">
                <div className="txItems">{tx.items.join(", ")}</div>
                <div className="txMeta">
                  {formatDate(tx.createdAt)}
                  {tx.storeName ? ` · ${tx.storeName}` : ""}
                  {tx.paymentMethod ? ` · ${PAYMENT_LABELS[tx.paymentMethod] ?? tx.paymentMethod}` : ""}
                </div>
              </div>
              <div className="parentTxRight">
                <div className="txAmount">
                  {tx.status === "refunded" ? "" : "−"}{formatMoney(tx.totalCents)}
                </div>
                {STATUS_LABELS[tx.status] && (
                  <div className="txStatus">{STATUS_LABELS[tx.status]}</div>
                )}
              </div>
            </div>
          ))
        )}
      </main>
    </>
  );
}
