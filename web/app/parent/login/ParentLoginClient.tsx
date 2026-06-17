"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type OrgInfo = { id: string; name: string };
type Step = "login" | "codeRequest" | "code" | "setPassword";

export default function ParentLoginClient() {
  const router    = useRouter();
  const params    = useSearchParams();
  const orgId     = params.get("org") ?? "";
  const inviteToken = params.get("invite") ?? "";

  const [org, setOrg]           = useState<OrgInfo | null>(null);
  const [orgError, setOrgError] = useState(false);
  const [step, setStep]         = useState<Step>("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword]           = useState("");
  const [confirmPassword, setConfirmPassword]   = useState("");
  const [code, setCode]         = useState(["", "", "", "", "", ""]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-login via invite token
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
          setStep("setPassword");
          setLoading(false);
        } else {
          setError(payload.error || "Enlace inválido o expirado");
          setLoading(false);
        }
      })
      .catch(() => { setError("Error de conexión"); setLoading(false); });
  }, [orgId, inviteToken]);

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/v1/guardian-portal/org/${orgId}`)
      .then((r) => r.json())
      .then((r) => { if (r.data) setOrg(r.data); else setOrgError(true); })
      .catch(() => setOrgError(true));
  }, [orgId]);

  // ── Password login ──────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/v1/guardian-portal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organizationId: orgId, email: email.trim(), password })
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error || "Correo o contraseña incorrectos");
      router.replace(`/parent/dashboard?org=${orgId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  // ── OTP request ─────────────────────────────────────────────────────────────
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

  // ── OTP verify ──────────────────────────────────────────────────────────────
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
      // After OTP, send to set-password
      setStep("setPassword");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Código inválido");
      setCode(["", "", "", "", "", ""]);
      codeRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  function passwordRules(pw: string) {
    return {
      length:    pw.length >= 8,
      uppercase: /[A-Z]/.test(pw),
      number:    /[0-9]/.test(pw),
    };
  }

  // ── Set password ────────────────────────────────────────────────────────────
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    const rules = passwordRules(newPassword);
    if (!rules.length)    { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (!rules.uppercase) { setError("Debe incluir al menos una letra mayúscula"); return; }
    if (!rules.number)    { setError("Debe incluir al menos un número"); return; }
    if (newPassword !== confirmPassword) { setError("Las contraseñas no coinciden"); return; }
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/v1/guardian-portal/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: newPassword })
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error || "Error al guardar contraseña");
      router.replace(`/parent/dashboard?org=${orgId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar contraseña");
    } finally {
      setLoading(false);
    }
  }

  function skipSetPassword() {
    router.replace(`/parent/dashboard?org=${orgId}`);
  }

  // ── OTP digit helpers ───────────────────────────────────────────────────────
  function onCodeInput(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next  = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < 5) codeRefs.current[index + 1]?.focus();
  }

  function onCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[index] && index > 0) codeRefs.current[index - 1]?.focus();
  }

  function onCodePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      e.preventDefault();
      setCode(pasted.split(""));
      codeRefs.current[5]?.focus();
    }
  }

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
          <div className="logo"><span className="material-symbols-outlined fill">local_cafe</span></div>
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
        <div className="logo"><span className="material-symbols-outlined fill">local_cafe</span></div>

        {/* ── Email + password (primary login) ── */}
        {step === "login" && (
          <>
            <h1>Portal para Padres</h1>
            <p className="subtitle">{org ? org.name : "Cargando…"}</p>
            <form onSubmit={handleLogin}>
              <label className="parentFieldLabel">Correo electrónico</label>
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
              <label className="parentFieldLabel" style={{ marginTop: 12 }}>Contraseña</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="parentEmailInput"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#9ca3af" }}
                  tabIndex={-1}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
              {error && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "8px 0 0" }}>{error}</p>}
              <button type="submit" className="parentSubmitBtn" disabled={loading || !org}>
                {loading ? "Verificando…" : "Iniciar sesión"}
              </button>
            </form>
            <button
              type="button"
              className="parentBackLink"
              onClick={() => { setStep("codeRequest"); setError(""); }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>email</span>
              ¿Primera vez o contraseña olvidada? Envíame un código
            </button>
          </>
        )}

        {/* ── Email entry for OTP ── */}
        {step === "codeRequest" && (
          <>
            <h1>Código de acceso</h1>
            <p className="subtitle">Te enviamos un código de 6 dígitos a tu correo.</p>
            <form onSubmit={requestCode}>
              <label className="parentFieldLabel">Correo electrónico</label>
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
                {loading ? "Enviando…" : "Enviar código"}
              </button>
            </form>
            <button type="button" className="parentBackLink" onClick={() => { setStep("login"); setError(""); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
              Volver al inicio de sesión
            </button>
          </>
        )}

        {/* ── OTP digit entry ── */}
        {step === "code" && (
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
            <button type="button" className="parentBackLink" onClick={() => { setStep("codeRequest"); setCode(["", "", "", "", "", ""]); setError(""); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
              Cambiar correo
            </button>
          </>
        )}

        {/* ── Set / reset password ── */}
        {step === "setPassword" && (
          <>
            <h1>Crea tu contraseña</h1>
            <p className="subtitle">Elige una contraseña para acceder la próxima vez sin código.</p>
            <form onSubmit={handleSetPassword}>
              <label className="parentFieldLabel">Nueva contraseña</label>
              <input
                type="password"
                className="parentEmailInput"
                placeholder="Mínimo 8 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
              />
              {newPassword.length > 0 && (() => {
                const r = passwordRules(newPassword);
                return (
                  <ul className="parentPasswordRules">
                    <li className={r.length    ? "met" : ""}>Mínimo 8 caracteres</li>
                    <li className={r.uppercase ? "met" : ""}>Una letra mayúscula</li>
                    <li className={r.number    ? "met" : ""}>Un número</li>
                  </ul>
                );
              })()}
              <label className="parentFieldLabel" style={{ marginTop: 12 }}>Confirmar contraseña</label>
              <input
                type="password"
                className="parentEmailInput"
                placeholder="Repite la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              {error && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "8px 0 0" }}>{error}</p>}
              <button type="submit" className="parentSubmitBtn" disabled={loading}>
                {loading ? "Guardando…" : "Guardar contraseña"}
              </button>
            </form>
            <button type="button" className="parentBackLink" onClick={skipSetPassword}>
              Ahora no, acceder sin contraseña
            </button>
          </>
        )}
      </div>
    </div>
  );
}
