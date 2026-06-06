"use client";

import { useEffect, useState } from "react";
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

type StudentData = {
  student: StudentDetail;
  transactions: Transaction[];
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
