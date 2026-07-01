"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { SpendingControlsPanel } from "./SpendingControlsPanel";
import { StudentCard, TodayMenuChips } from "./StudentCard";
import { StudentMenuView } from "./StudentMenuView";
import {
  avatarUrl, formatMoney, formatTime, getWeekDates, groupDateLabel, initials, todayStr,
  type GuardianMe, type MenuByStore, type MenuDay, type Student, type Tab,
} from "./dashboardTypes";

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
  const [menuStudentId, setMenuStudentId] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => { setWeekDates(getWeekDates(weekOffset)); }, [weekOffset]);

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

  // organizationId comes from data — no second /me fetch needed
  const loadMenusForWeek = useCallback(async (students: Student[], dates: string[], organizationId: string) => {
    const storeIds = [...new Set(students.map((s) => s.homeStoreId).filter(Boolean))] as string[];
    if (!storeIds.length || !organizationId) return;
    const from = dates[0];
    const to = dates[4];
    if (!from || !to) return;

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
    void loadMenusForWeek(data.students, weekDates, data.organizationId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, weekDates]);

  useEffect(() => {
    if (tab === "menu" && data?.students.length === 1) setMenuStudentId(data.students[0].id);
    if (tab !== "menu" && data && data.students.length > 1) setMenuStudentId(null);
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

  type ActivityItem = { studentName: string; studentId: string } & GuardianMe["students"][0]["recentTransactions"][0];
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

  return (
    <div className="ppRoot">
      <header className="ppHeader">
        <div className="ppHeaderBrand">
          <div className="ppHeaderAvatar">{guardianInitials}</div>
          <span className="ppHeaderOrg">{data.organizationName}</span>
        </div>
        <button className="ppHeaderNotif" aria-label="Notificaciones">
          <span className="material-symbols-outlined">notifications</span>
        </button>
      </header>

      <main className="ppMain">

        {/* ── HOME ── */}
        {tab === "home" && (
          <>
            {data.students.map((student) => (
              <StudentCard
                key={student.id}
                student={student}
                today={today}
                menuByStore={menuByStore}
                onTapActivity={() => setTab("historial")}
              />
            ))}

            {data.students.some((s) => s.homeStoreId) && (
              <section className="ppSection">
                <div className="ppSectionHead">
                  <span style={{ fontSize: 18 }}>🍽</span>
                  <h3 className="ppSectionTitle">Menú de hoy</h3>
                </div>
                <div className="ppTodayMenuCard">
                  {data.students.filter((s) => s.homeStoreId).map((student, idx, arr) => (
                    <div key={student.id}>
                      {arr.length > 1 && <p className="ppTodayMenuStudent">{student.name}</p>}
                      <div className="ppTodayMenuChips">
                        <TodayMenuChips student={student} today={today} menuByStore={menuByStore} />
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
