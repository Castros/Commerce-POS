"use client";

import Image from "next/image";
import { avatarUrl, formatMoney, initials, type MenuByStore, type Student } from "./dashboardTypes";

const LOW_BALANCE_THRESHOLD = 500;

export function TodayMenuChips({ student, today, menuByStore }: { student: Student; today: string; menuByStore: MenuByStore }) {
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

export function StudentCard({
  student, today, menuByStore, onTapActivity,
}: {
  student: Student;
  today: string;
  menuByStore: MenuByStore;
  onTapActivity: () => void;
}) {
  const isLow = student.balanceCents <= LOW_BALANCE_THRESHOLD;
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

        <div className="ppStudentCardBalance">
          <p className={`ppStudentCardAmount${isVeryLow ? " ppStudentCardAmount--low" : isLow ? " ppStudentCardAmount--warn" : ""}`}>
            {formatMoney(student.balanceCents, student.currency)}
          </p>
          <p className="ppStudentCardBalanceLabel">saldo</p>
        </div>
      </div>

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
