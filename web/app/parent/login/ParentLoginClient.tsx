"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type OrgInfo = { id: string; name: string };

type Step = "email" | "code";

export default function ParentLoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const orgId = params.get("org") ?? "";

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [orgError, setOrgError] = useState(false);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  const inviteToken = params.get("invite") ?? "";

  // Auto-login when an invite token is in the URL (admin sent direct link)
  useEffect(() => {
    if (!orgId || !inviteToken) return;
    setLoading(true);
    fetch("/api/v1/guardian-portal/auth/accept-invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ organizationId: orgId, token: inviteToken })
    })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.data) {
          router.replace(`/parent/dashboard?org=${orgId}`);
        } else {
          setError(payload.error || "Enlace inválido o expirado");
          setLoading(false);
        }
      })
      .catch(() => { setError("Error de conexión"); setLoading(false); });
  }, [orgId, inviteToken, router]);

  // Load org info so we can show the school name
  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/v1/guardian-portal/org/${orgId}`)
      .then((r) => r.json())
      .then((r) => {
        if (r.data) setOrg(r.data);
        else setOrgError(true);
      })
      .catch(() => setOrgError(true));
  }, [orgId]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/v1/guardian-portal/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId: orgId, email: email.trim() })
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error || "Error al enviar código");
      setStep("code");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al enviar código");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const fullCode = code.join("");
    if (fullCode.length < 6) { setError("Ingresa el código completo"); return; }
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/v1/guardian-portal/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId: orgId, email: email.trim(), code: fullCode })
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error || "Código inválido");
      router.replace(`/parent/dashboard?org=${orgId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Código inválido");
      setCode(["", "", "", "", "", ""]);
      codeRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  function onCodeInput(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < 5) {
      codeRefs.current[index + 1]?.focus();
    }
  }

  function onCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
  }

  function onCodePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      e.preventDefault();
      setCode(pasted.split(""));
      codeRefs.current[5]?.focus();
    }
  }

  // Show loading state while auto-processing an invite token
  if (inviteToken && loading) {
    return (
      <div className="parentLoginWrap">
        <div className="parentLoginCard" style={{ textAlign: "center" }}>
          <div className="logo" style={{ margin: "0 auto 16px" }}>
            <span className="material-symbols-outlined fill">local_cafe</span>
          </div>
          <h1>Accediendo…</h1>
          <p className="subtitle">Verificando tu invitación</p>
        </div>
      </div>
    );
  }

  if (!orgId || orgError) {
    return (
      <div className="parentLoginWrap">
        <div className="parentLoginCard">
          <div className="logo">
            <span className="material-symbols-outlined fill">local_cafe</span>
          </div>
          <h1>Portal para Padres</h1>
          <p className="subtitle" style={{ color: "#ef4444" }}>
            Enlace inválido. Solicita el enlace correcto a tu escuela.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="parentLoginWrap">
      <div className="parentLoginCard">
        <div className="logo">
          <span className="material-symbols-outlined fill">local_cafe</span>
        </div>

        {step === "email" ? (
          <>
            <h1>Portal para Padres</h1>
            <p className="subtitle">{org ? org.name : "Cargando…"}</p>

            <form onSubmit={requestCode}>
              <label style={{ display: "block", fontSize: "0.875rem", color: "#374151", marginBottom: 6 }}>
                Correo electrónico
              </label>
              <input
                type="email"
                className="parentEmailInput"
                placeholder="nombre@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
              {error && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "8px 0 0" }}>{error}</p>}
              <button type="submit" className="parentSubmitBtn" disabled={loading || !org}>
                {loading ? "Enviando…" : "Enviar código de acceso"}
              </button>
            </form>

            <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 20, textAlign: "center" }}>
              Te enviaremos un código de 6 dígitos al correo que tenemos registrado.
            </p>
          </>
        ) : (
          <>
            <h1>Ingresa tu código</h1>
            <p className="subtitle">Enviamos un código a <strong>{email}</strong></p>

            <form onSubmit={verifyCode}>
              <div className="otpRow" onPaste={onCodePaste}>
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { codeRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="otpDigit"
                    value={digit}
                    onChange={(e) => onCodeInput(i, e.target.value)}
                    onKeyDown={(e) => onCodeKeyDown(i, e)}
                    autoFocus={i === 0}
                  />
                ))}
              </div>
              {error && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "0 0 8px", textAlign: "center" }}>{error}</p>}
              <button type="submit" className="parentSubmitBtn" disabled={loading || code.join("").length < 6}>
                {loading ? "Verificando…" : "Acceder"}
              </button>
            </form>

            <button
              type="button"
              className="parentBackLink"
              onClick={() => { setStep("email"); setCode(["", "", "", "", "", ""]); setError(""); }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
              Cambiar correo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
