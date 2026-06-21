"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
function avatarUrl(publicId: string | null | undefined, size = 40) {
  if (!publicId || !CLOUD_NAME) return null;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_${size},h_${size},c_fill,r_max,f_auto,q_auto/${publicId}`;
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
  homeStoreName: string | null;
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

type Category = { id: string; name: string };
type SpendingControls = { daily_limit_cents: number | null; blocked_category_ids: string[] };
type ControlsData = { spendingControls: SpendingControls; availableCategories: Category[] };

type Tab = "home" | "menu" | "historial" | "ajustes";
type MenuByStore = Record<string, MenuDay[]>;

const DAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie"];

function getWeekDates(offset = 0): string[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offset * 7);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(cents: number, currency = "USD") {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatDayFull(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function groupDateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

// ── Spending controls (collapsible, lazy-loaded) ──────────────────────────
function SpendingControlsPanel({ studentId }: { studentId: string }) {
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

// ── Per-student menu section ───────────────────────────────────────────────
function StudentMenuView({
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
      {/* Day pills */}
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

// ── Student card (home tab) ────────────────────────────────────────────────
function StudentCard({
  student, today, menuByStore, onTapActivity,
}: {
  student: Student;
  today: string;
  menuByStore: MenuByStore;
  onTapActivity: () => void;
}) {
  const threshold = 500; // default low balance threshold cents
  const isLow = student.balanceCents <= threshold;
  const isVeryLow = student.balanceCents <= 0;
  const todayTxs = student.recentTransactions.filter((t) => t.createdAt.slice(0, 10) === today);

  return (
    <div className={`ppStudentCard${isLow ? " ppStudentCard--low" : ""}`}>
      {isLow && (
        <div className="ppStudentCardAlert">
          <span className="material-symbols-outlined">warning</span>
          {isVeryLow ? "Sin saldo suficiente para comprar" : "Saldo bajo — considera recargar"}
        </div>
      )}

      <div className="ppStudentCardMain">
        {/* Avatar + name */}
        <div className="ppStudentCardLeft">
          {avatarUrl(student.avatarPublicId, 48) ? (
            <Image src={avatarUrl(student.avatarPublicId, 48)!} alt={student.name} width={48} height={48} style={{ borderRadius: "50%", objectFit: "cover" }} />
          ) : (
            <div className="ppStudentCardAvatar">{initials(student.name)}</div>
          )}
          <div>
            <p className="ppStudentCardName">{student.name}</p>
            {student.homeStoreName && (
              <p className="ppStudentCardCampus">
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>location_on</span>
                {student.homeStoreName}
              </p>
            )}
          </div>
        </div>

        {/* Balance */}
        <div className="ppStudentCardBalance">
          <p className={`ppStudentCardAmount${isVeryLow ? " ppStudentCardAmount--low" : isLow ? " ppStudentCardAmount--warn" : ""}`}>
            {formatMoney(student.balanceCents, student.currency)}
          </p>
          <p className="ppStudentCardBalanceLabel">saldo</p>
        </div>
      </div>

      {/* Today's activity */}
      <button className="ppStudentCardActivity" onClick={onTapActivity}>
        {todayTxs.length === 0 ? (
          <span style={{ color: "var(--pp-muted)", fontStyle: "italic" }}>Sin compras hoy</span>
        ) : (
          <span>
            Hoy: {todayTxs.map((t) => t.items.join(", ")).join(" · ")}
            {" "}<span style={{ color: "var(--pp-muted)" }}>−{formatMoney(todayTxs.reduce((s, t) => s + t.totalCents, 0))}</span>
          </span>
        )}
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--pp-muted)", flexShrink: 0 }}>chevron_right</span>
      </button>

      <button className="ppWalletRecharge ppStudentCardRecharge" disabled title="Próximamente">
        Recargar
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function DashboardClient() {
  const router = useRouter();
  const params = useSearchParams();
  const orgId = params.get("org") ?? "";

  const [tab, setTab] = useState<Tab>("home");
  const [data, setData] = useState<GuardianMe | null>(null);
  const [error, setError] = useState("");
  const [menuByStore, setMenuByStore] = useState<MenuByStore>({});
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekDates, setWeekDates] = useState(() => getWeekDates(0));
  const [selectedDayIdx, setSelectedDayIdx] = useState(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d - 1 : 0;
  });
  // Which student is shown in Menú tab (null = picker)
  const [menuStudentId, setMenuStudentId] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Recompute week dates when offset changes
  useEffect(() => { setWeekDates(getWeekDates(weekOffset)); }, [weekOffset]);

  // Load guardian /me
  useEffect(() => {
    fetch("/api/v1/guardian-portal/me", { credentials: "include" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) { router.replace(`/parent/login?org=${orgId}`); return null; }
        return r.json();
      })
      .then((p) => {
        if (p?.data) setData(p.data);
        else if (p) setError(p.error || "Error al cargar");
      })
      .catch(() => setError("Error de conexión"));
  }, [orgId, router]);

  // Load menus for all unique store IDs in the current week
  const loadMenusForWeek = useCallback(async (students: Student[], dates: string[]) => {
    const storeIds = [...new Set(students.map((s) => s.homeStoreId).filter(Boolean))] as string[];
    if (!storeIds.length || !students[0]) return;
    const orgId = students[0] ? undefined : "";
    const from = dates[0];
    const to = dates[4];
    if (!from || !to) return;

    // Need organizationId — get it from data or try a parallel call
    const meResp = await fetch("/api/v1/guardian-portal/me", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const organizationId: string = meResp?.data?.organizationId ?? "";
    if (!organizationId) return;

    const results = await Promise.all(
      storeIds.map((storeId) =>
        fetch(`/api/v1/guardian-portal/menu?organizationId=${organizationId}&storeId=${storeId}&from=${from}&to=${to}`, { credentials: "include" })
          .then((r) => r.json())
          .then((p) => ({ storeId, days: (p.data ?? []) as MenuDay[] }))
          .catch(() => ({ storeId, days: [] as MenuDay[] }))
      )
    );

    setMenuByStore((prev) => {
      const next = { ...prev };
      for (const { storeId, days } of results) next[storeId] = days;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    void loadMenusForWeek(data.students, weekDates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, weekDates]);

  // When switching to menu tab with a single student, auto-select them
  useEffect(() => {
    if (tab === "menu" && data?.students.length === 1) {
      setMenuStudentId(data.students[0].id);
    }
    if (tab !== "menu") {
      // Reset to picker when leaving menu tab (only if multi-student)
      if (data && data.students.length > 1) setMenuStudentId(null);
    }
  }, [tab, data]);

  async function toggleEmailOnPurchase() {
    if (!data) return;
    const newVal = !data.notificationPrefs.email_on_purchase;
    setData((d) => d ? { ...d, notificationPrefs: { ...d.notificationPrefs, email_on_purchase: newVal } } : d);
    setSavingPrefs(true);
    try {
      await fetch("/api/v1/guardian-portal/me/notifications", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOnPurchase: newVal }),
      });
    } catch {
      setData((d) => d ? { ...d, notificationPrefs: { ...d.notificationPrefs, email_on_purchase: !newVal } } : d);
    } finally { setSavingPrefs(false); }
  }

  async function logout() {
    await fetch("/api/v1/guardian-portal/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    router.replace(`/parent/login?org=${orgId}`);
  }

  if (error) return (
    <div className="ppRoot">
      <div className="ppEmptyState"><span className="material-symbols-outlined">error</span>{error}</div>
    </div>
  );

  if (!data) return (
    <div className="ppRoot">
      <div className="ppEmptyState"><span className="material-symbols-outlined">hourglass_empty</span>Cargando…</div>
    </div>
  );

  const today = todayStr();
  const guardianInitials = initials(data.name);
  const multiStudent = data.students.length > 1;
  const selectedMenuStudent = data.students.find((s) => s.id === menuStudentId) ?? null;

  // Build combined, date-grouped history
  type ActivityItem = Transaction & { studentName: string; studentId: string };
  const allActivity: ActivityItem[] = data.students
    .flatMap((s) => s.recentTransactions.map((t) => ({ ...t, studentName: s.name, studentId: s.id })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const grouped = new Map<string, ActivityItem[]>();
  for (const tx of allActivity) {
    const key = groupDateLabel(tx.createdAt);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(tx);
  }

  const navItems: { id: Tab; icon: string; label: string }[] = [
    { id: "home",      icon: "home",           label: "Home"      },
    { id: "menu",      icon: "restaurant_menu", label: "Menú"      },
    { id: "historial", icon: "history",         label: "Historial" },
    { id: "ajustes",   icon: "settings",        label: "Ajustes"   },
  ];

  // Today's menu chips per student (for home tab)
  function TodayMenuChips({ student }: { student: Student }) {
    if (!student.homeStoreId) return null;
    const days = menuByStore[student.homeStoreId] ?? [];
    const todayPeriods = days.filter((m) => m.date === today && m.items.length > 0);
    if (todayPeriods.length === 0) return <span className="ppTodayMenuEmpty">Sin menú publicado hoy</span>;
    return (
      <>
        {todayPeriods.flatMap((p) => p.items).slice(0, 4).map((item) => (
          <span key={item.productId} className="ppItemChip ppItemChip--sm">{item.name}</span>
        ))}
      </>
    );
  }

  return (
    <div className="ppRoot">

      {/* Header */}
      <header className="ppHeader">
        <div className="ppHeaderBrand">
          <div className="ppHeaderAvatar">{guardianInitials}</div>
          <span className="ppHeaderOrg">{data.organizationName}</span>
        </div>
        <button className="ppHeaderNotif" aria-label="Notificaciones">
          <span className="material-symbols-outlined">notifications</span>
        </button>
      </header>

      {/* Tab content */}
      <main className="ppMain">

        {/* ── HOME ── */}
        {tab === "home" && (
          <>
            {/* Student cards */}
            {data.students.map((student) => (
              <StudentCard
                key={student.id}
                student={student}
                today={today}
                menuByStore={menuByStore}
                onTapActivity={() => setTab("historial")}
              />
            ))}

            {/* Today's menu — per student, per campus */}
            {data.students.some((s) => s.homeStoreId) && (
              <section className="ppSection">
                <div className="ppSectionHead">
                  <span style={{ fontSize: 18 }}>🍽</span>
                  <h3 className="ppSectionTitle">Menú de hoy</h3>
                </div>
                <div className="ppTodayMenuCard">
                  {data.students.filter((s) => s.homeStoreId).map((student, idx, arr) => (
                    <div key={student.id}>
                      {arr.length > 1 && (
                        <p className="ppTodayMenuStudent">{student.name}</p>
                      )}
                      <div className="ppTodayMenuChips">
                        <TodayMenuChips student={student} />
                      </div>
                      {idx < arr.length - 1 && <div className="ppPurchasesDivider" style={{ margin: "10px 0" }} />}
                    </div>
                  ))}
                </div>
                <button className="ppSeeAll" onClick={() => setTab("menu")}>Ver menú semanal ›</button>
              </section>
            )}
          </>
        )}

        {/* ── MENÚ ── */}
        {tab === "menu" && (
          <>
            {/* Multi-student picker */}
            {multiStudent && !selectedMenuStudent && (
              <section className="ppSection">
                <h3 className="ppSectionTitle">Menú semanal</h3>
                <p style={{ fontSize: "0.82rem", color: "var(--pp-muted)", margin: "0 0 4px" }}>¿De quién quieres ver el menú?</p>
                <div className="ppStudentPicker">
                  {data.students.map((student) => (
                    <button key={student.id} className="ppStudentPickerCard" onClick={() => setMenuStudentId(student.id)}>
                      {avatarUrl(student.avatarPublicId, 40) ? (
                        <Image src={avatarUrl(student.avatarPublicId, 40)!} alt={student.name} width={40} height={40} style={{ borderRadius: "50%" }} />
                      ) : (
                        <div className="ppStudentPickerAvatar">{initials(student.name)}</div>
                      )}
                      <p className="ppStudentPickerName">{student.name}</p>
                      {student.homeStoreName && <p className="ppStudentPickerCampus">{student.homeStoreName}</p>}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Selected student's menu */}
            {selectedMenuStudent && (
              <section className="ppSection">
                <div className="ppSectionHead">
                  {multiStudent && (
                    <button className="ppBackBtn" onClick={() => setMenuStudentId(null)}>
                      <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                  )}
                  <div>
                    <h3 className="ppSectionTitle">{selectedMenuStudent.name}</h3>
                    {selectedMenuStudent.homeStoreName && (
                      <p style={{ fontSize: "0.72rem", color: "var(--pp-muted)", margin: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: "middle" }}>location_on</span>
                        {selectedMenuStudent.homeStoreName}
                      </p>
                    )}
                  </div>
                </div>
                <StudentMenuView
                  student={selectedMenuStudent}
                  weekDates={weekDates}
                  menuByStore={menuByStore}
                  selectedDayIdx={selectedDayIdx}
                  onDaySelect={setSelectedDayIdx}
                  weekOffset={weekOffset}
                  onWeekOffsetChange={(d) => { setWeekOffset(d); setWeekDates(getWeekDates(d)); }}
                />
              </section>
            )}
          </>
        )}

        {/* ── HISTORIAL ── */}
        {tab === "historial" && (
          <>
            {allActivity.length === 0 ? (
              <div className="ppEmptyState">
                <span className="material-symbols-outlined">receipt_long</span>
                Sin transacciones registradas
              </div>
            ) : (
              Array.from(grouped.entries()).map(([dateLabel, txs]) => (
                <section key={dateLabel} className="ppSection">
                  <p className="ppGroupDate">{dateLabel}</p>
                  <div className="ppPurchasesCard">
                    {txs.map((tx, idx) => (
                      <div key={tx.id}>
                        {idx > 0 && <div className="ppPurchasesDivider" />}
                        <div className="ppTxItem">
                          <div className="ppTxIcon"><span className="material-symbols-outlined">restaurant</span></div>
                          <div className="ppTxInfo">
                            <p className="ppTxName">{tx.items.join(", ")}</p>
                            <p className="ppTxMeta">
                              {formatTime(tx.createdAt)}
                              {tx.storeName ? ` · ${tx.storeName}` : ""}
                              {multiStudent ? ` · ${tx.studentName}` : ""}
                            </p>
                          </div>
                          <span className="ppTxAmount">-{formatMoney(tx.totalCents)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}

        {/* ── AJUSTES ── */}
        {tab === "ajustes" && (
          <>
            <section className="ppSettingsCard ppSection">
              <div className="ppSettingsRow ppSettingsRow--profile">
                <div className="ppSettingsAvatar">{guardianInitials}</div>
                <div>
                  <p className="ppSettingsName">{data.name}</p>
                  <p className="ppSettingsEmail">{data.email}</p>
                </div>
              </div>
            </section>

            <section className="ppSection">
              <h3 className="ppSectionTitle">Notificaciones</h3>
              <div className="ppSettingsCard">
                <div className="ppSettingsRow">
                  <div className="ppSettingsRowIcon">
                    <span className="material-symbols-outlined">receipt_long</span>
                  </div>
                  <div className="ppSettingsRowInfo">
                    <p className="ppSettingsRowLabel">Comprobante por compra</p>
                    <p className="ppSettingsRowSub">Correo en cada compra con el saldo actualizado</p>
                  </div>
                  <button
                    className={`ppToggle${data.notificationPrefs.email_on_purchase ? " ppToggle--on" : ""}`}
                    onClick={toggleEmailOnPurchase}
                    disabled={savingPrefs}
                  >
                    <span className="ppToggleKnob" />
                  </button>
                </div>
              </div>
            </section>

            {data.students.map((student) => (
              <section key={student.id} className="ppSection">
                <div className="ppSectionHead">
                  {avatarUrl(student.avatarPublicId, 28) ? (
                    <Image src={avatarUrl(student.avatarPublicId, 28)!} alt={student.name} width={28} height={28} style={{ borderRadius: "50%" }} />
                  ) : (
                    <div className="ppStudentThumb"><span className="material-symbols-outlined">person</span></div>
                  )}
                  <h3 className="ppSectionTitle">{student.name}</h3>
                  {student.homeStoreName && <span style={{ fontSize: "0.72rem", color: "var(--pp-muted)" }}>· {student.homeStoreName}</span>}
                </div>
                <SpendingControlsPanel studentId={student.id} />
              </section>
            ))}

            <section className="ppSection">
              <button className="ppLogoutBtn" onClick={() => void logout()}>
                <span className="material-symbols-outlined">logout</span>
                Cerrar sesión
              </button>
            </section>
          </>
        )}

      </main>

      {/* Bottom nav */}
      <nav className="ppBottomNav">
        {navItems.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`ppNavItem${tab === id ? " ppNavItem--active" : ""}`}
            onClick={() => setTab(id)}
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: tab === id ? "'FILL' 1" : "'FILL' 0" }}>
              {icon}
            </span>
            <span className="ppNavLabel">{label}</span>
          </button>
        ))}
      </nav>

    </div>
  );
}
