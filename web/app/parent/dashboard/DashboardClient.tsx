"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
function studentAvatarUrl(publicId: string | null | undefined) {
  if (!publicId || !CLOUD_NAME) return null;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_72,h_72,c_fill,r_max,f_auto,q_auto/${publicId}`;
}

type Transaction = {
  id: string;
  createdAt: string;
  totalCents: number;
  paymentMethod: string;
  storeName: string | null;
  items: string[];
};

type Student = {
  id: string;
  name: string;
  avatarPublicId: string | null;
  homeStoreId: string | null;
  balanceCents: number;
  currency: string;
  creditLimitCents: number;
  relationship: string;
  isPrimary: boolean;
  recentTransactions: Transaction[];
};

type MenuDay = {
  date: string;
  mealPeriod: string;
  items: { productId: string; name: string; priceCents: number }[];
  notes: string | null;
};

type NotificationPrefs = {
  email_on_purchase: boolean;
  low_balance_threshold_cents: number;
};

type GuardianMe = {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  organizationName: string;
  notificationPrefs: NotificationPrefs;
  students: Student[];
};

function formatMoney(cents: number, currency = "USD") {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = currency === "MXN" ? "$" : "$";
  return cents < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
}

function balanceClass(cents: number) {
  if (cents > 500) return "positive";
  if (cents >= 0) return "warning";
  return "negative";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function ParentHeader({ name, orgName, orgId }: { name: string; orgName: string; orgId: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/v1/guardian-portal/auth/logout", {
      method: "POST",
      credentials: "include"
    }).catch(() => {});
    router.replace(`/parent/login?org=${orgId}`);
  }

  return (
    <header className="parentHeader">
      <div className="parentHeaderBrand">
        <span className="material-symbols-outlined fill">local_cafe</span>
        <span>{orgName}</span>
      </div>
      <div className="parentHeaderUser">
        <span>{name}</span>
        <button type="button" onClick={logout} title="Cerrar sesión">
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>
    </header>
  );
}

export default function DashboardClient() {
  const router = useRouter();
  const params = useSearchParams();
  const orgId = params.get("org") ?? "";

  const [data, setData] = useState<GuardianMe | null>(null);
  const [error, setError] = useState("");
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [menuDays, setMenuDays] = useState<MenuDay[]>([]);
  const [menuWeekOffset, setMenuWeekOffset] = useState(0);

  function getWeekBounds(offset: number) {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff + offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 4);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { from: fmt(monday), to: fmt(sunday), label: fmt(monday) };
  }

  useEffect(() => {
    fetch("/api/v1/guardian-portal/me", { credentials: "include" })
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
  }, [orgId, router]);

  // Fetch menu when data or week changes
  useEffect(() => {
    if (!data) return;
    const storeId = data.students.find((s) => s.homeStoreId)?.homeStoreId;
    if (!storeId) return;
    const { from, to } = getWeekBounds(menuWeekOffset);
    fetch(`/api/v1/guardian-portal/menu?organizationId=${data.organizationId}&storeId=${storeId}&from=${from}&to=${to}`, { credentials: "include" })
      .then((r) => r.json())
      .then((p) => { if (p.data) setMenuDays(p.data); })
      .catch(() => {});
  }, [data, menuWeekOffset]);

  async function toggleEmailOnPurchase() {
    if (!data) return;
    const newVal = !data.notificationPrefs.email_on_purchase;
    setData((d) => d ? { ...d, notificationPrefs: { ...d.notificationPrefs, email_on_purchase: newVal } } : d);
    setSavingPrefs(true);
    try {
      await fetch("/api/v1/guardian-portal/me/notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOnPurchase: newVal })
      });
    } catch {
      // revert on failure
      setData((d) => d ? { ...d, notificationPrefs: { ...d.notificationPrefs, email_on_purchase: !newVal } } : d);
    } finally {
      setSavingPrefs(false);
    }
  }

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

  // Build a combined recent-activity feed across all students
  type ActivityItem = Transaction & { studentName: string; studentId: string };
  const allActivity: ActivityItem[] = data.students
    .flatMap((s) => s.recentTransactions.map((t) => ({ ...t, studentName: s.name, studentId: s.id })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return (
    <>
      <ParentHeader name={data.name} orgName={data.organizationName} orgId={data.organizationId} />

      <main className="parentMain">
        {data.students.length === 0 ? (
          <div className="parentEmptyState">
            <span className="material-symbols-outlined">school</span>
            No hay alumnos vinculados a tu cuenta.
            <br />
            <small>Contacta a la administración de la escuela.</small>
          </div>
        ) : (
          <>
            <p className="parentSectionTitle">
              {data.students.length === 1 ? "Alumno" : "Alumnos"} ({data.students.length})
            </p>

            {data.students.map((student) => (
              <Link
                key={student.id}
                href={`/parent/student/${student.id}?org=${data.organizationId}`}
                className="parentBalanceCard"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  {studentAvatarUrl(student.avatarPublicId) ? (
                    <Image
                      src={studentAvatarUrl(student.avatarPublicId)!}
                      alt={student.name}
                      width={48}
                      height={48}
                      style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{
                      width: 48, height: 48, borderRadius: "50%", background: "var(--surface2, #e5e7eb)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 24, color: "var(--muted, #9ca3af)" }}>person</span>
                    </div>
                  )}
                  <h3 style={{ margin: 0 }}>{student.name}</h3>
                </div>
                <span className={`amount ${balanceClass(student.balanceCents)}`}>
                  {formatMoney(student.balanceCents, student.currency)}
                </span>
                <div className="balanceMeta">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                    {student.balanceCents >= 0 ? "check_circle" : "warning"}
                  </span>
                  {student.balanceCents >= 0 ? "Saldo disponible" : "Saldo pendiente"}
                  {student.creditLimitCents > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      · Límite crédito: {formatMoney(student.creditLimitCents, student.currency)}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className="parentTopUpBtn"
                    disabled
                    title="Próximamente"
                    onClick={(e) => e.preventDefault()}
                  >
                    <span className="material-symbols-outlined">add</span>
                    Recargar
                  </button>
                  <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>Ver historial →</span>
                </div>
              </Link>
            ))}

            {allActivity.length > 0 && (
              <>
                <p className="parentSectionTitle">Actividad reciente</p>
                {allActivity.map((tx) => (
                  <div key={tx.id} className="parentActivityItem">
                    <div className="parentActivityLeft">
                      <div className="items">{tx.items.join(", ")}</div>
                      <div className="meta">
                        {formatDate(tx.createdAt)}
                        {tx.storeName ? ` · ${tx.storeName}` : ""}
                      </div>
                    </div>
                    <div className="parentActivityRight">
                      <div className="amount">−{formatMoney(tx.totalCents)}</div>
                      <div className="student">{tx.studentName}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* ── Weekly menu ── */}
            {data.students.some((s) => s.homeStoreId) && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 8 }}>
                  <p className="parentSectionTitle" style={{ margin: 0 }}>Menú de la semana</p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="parentWeekNav" onClick={() => setMenuWeekOffset((o) => o - 1)}>‹</button>
                    {menuWeekOffset !== 0 && (
                      <button type="button" className="parentWeekNav" onClick={() => setMenuWeekOffset(0)}>Hoy</button>
                    )}
                    <button type="button" className="parentWeekNav" onClick={() => setMenuWeekOffset((o) => o + 1)}>›</button>
                  </div>
                </div>
                {menuDays.length === 0 ? (
                  <div className="parentMenuEmpty">Sin menú publicado para esta semana</div>
                ) : (
                  <div className="parentMenuGrid">
                    {/* Group rows by date */}
                    {Array.from(new Set(menuDays.map((r) => r.date))).map((date) => {
                      const d = new Date(date + "T12:00:00");
                      const dayLabel = d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" });
                      const dayRows = menuDays.filter((r) => r.date === date);
                      return (
                        <div key={date} className="parentMenuDay">
                          <div className="parentMenuDayLabel">{dayLabel}</div>
                          {dayRows.map((row) => (
                            <div key={row.mealPeriod}>
                              {dayRows.length > 1 && (
                                <div className="parentMenuNote" style={{ fontWeight: 600, fontStyle: "normal", marginTop: 6 }}>
                                  {row.mealPeriod}
                                </div>
                              )}
                              {row.notes && <div className="parentMenuNote">{row.notes}</div>}
                              {row.items.map((item) => (
                                <div key={item.productId} className="parentMenuItem">
                                  <span>{item.name}</span>
                                  <span>${(item.priceCents / 100).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <p className="parentSectionTitle">Notificaciones</p>
            <div className="parentNotifCard">
              <div className="parentNotifRow">
                <div className="parentNotifInfo">
                  <span className="material-symbols-outlined">receipt_long</span>
                  <div>
                    <strong>Recibir comprobante por compra</strong>
                    <p>Te enviamos un correo cada vez que se realice una compra con el saldo de tu hijo.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`parentToggle${data.notificationPrefs.email_on_purchase ? " parentToggle--on" : ""}`}
                  onClick={toggleEmailOnPurchase}
                  disabled={savingPrefs}
                  aria-pressed={data.notificationPrefs.email_on_purchase}
                >
                  <span className="parentToggleThumb" />
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
