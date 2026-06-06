import { createRequire } from "node:module";

// Uses Resend (https://resend.com) if RESEND_API_KEY is set.
// Falls back to console logging in dev so you can test without email setup.

export async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[DEV EMAIL] ──────────────────────────────────────`);
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`\n${text || "(html only)"}`);
    console.log(`──────────────────────────────────────────────────\n`);
    return { ok: true, dev: true };
  }

  const from = process.env.EMAIL_FROM || "Commerce POS <noreply@commerce-pos.app>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to, subject, html, text })
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "unknown error");
    throw new Error(`Email send failed (${response.status}): ${err}`);
  }

  return response.json();
}

export function buildInviteEmail({ guardianName, orgName, inviteUrl, studentNames = [] }) {
  const studentLine = studentNames.length > 0
    ? `Puedes consultar el saldo y las compras de: <strong>${studentNames.join(", ")}</strong>.`
    : "";

  const subject = `Invitación al Portal para Padres — ${orgName}`;

  const text = `
Hola ${guardianName},

${orgName} te invita a acceder al Portal para Padres para consultar el saldo y actividad de tu hijo/a.
${studentNames.length > 0 ? `Alumnos vinculados: ${studentNames.join(", ")}.` : ""}

Haz clic aquí para acceder (enlace válido por 72 horas):
${inviteUrl}

— ${orgName}
`.trim();

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;margin:0;padding:24px;">
  <div style="max-width:420px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:24px 28px;">
      <div style="display:inline-flex;align-items:center;gap:8px;">
        <span style="background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 10px;font-size:20px;">☕</span>
        <span style="color:white;font-size:1.1rem;font-weight:600;">Portal para Padres</span>
      </div>
      <p style="color:rgba(255,255,255,0.75);margin:8px 0 0;font-size:0.875rem;">${orgName}</p>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 12px;color:#374151;">Hola <strong>${guardianName}</strong>,</p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:0.9rem;">
        Te invitamos a acceder al Portal para Padres de <strong>${orgName}</strong> para consultar el saldo y actividad de tu alumno/a.
      </p>
      ${studentLine ? `<p style="margin:0 0 20px;color:#374151;font-size:0.875rem;">${studentLine}</p>` : ""}
      <a href="${inviteUrl}"
         style="display:block;background:#1d4ed8;color:white;text-decoration:none;border-radius:10px;padding:14px;text-align:center;font-weight:600;font-size:1rem;margin:0 0 20px;">
        Acceder al portal →
      </a>
      <p style="color:#9ca3af;font-size:0.8rem;margin:0 0 4px;">⏱ Este enlace expira en <strong>72 horas</strong>.</p>
      <p style="color:#d1d5db;font-size:0.75rem;margin:0;word-break:break-all;">${inviteUrl}</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function buildMagicLinkEmail({ guardianName, code, orgName }) {
  const subject = `${code} — Tu código de acceso a ${orgName}`;

  const text = `
Hola ${guardianName},

Tu código de acceso al Portal para Padres de ${orgName} es:

    ${code}

Este código expira en 15 minutos. Si no solicitaste este código, ignora este mensaje.

— ${orgName}
`.trim();

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;margin:0;padding:24px;">
  <div style="max-width:420px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:24px 28px;">
      <div style="display:inline-flex;align-items:center;gap:8px;">
        <span style="background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 10px;font-size:20px;">☕</span>
        <span style="color:white;font-size:1.1rem;font-weight:600;">Portal para Padres</span>
      </div>
      <p style="color:rgba(255,255,255,0.75);margin:8px 0 0;font-size:0.875rem;">${orgName}</p>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 12px;color:#374151;">Hola <strong>${guardianName}</strong>,</p>
      <p style="margin:0 0 20px;color:#6b7280;font-size:0.9rem;">Tu código de acceso de un solo uso:</p>
      <div style="background:#f0f7ff;border:2px dashed #93c5fd;border-radius:12px;padding:24px;text-align:center;margin:0 0 20px;">
        <span style="font-size:2.4rem;font-weight:800;letter-spacing:0.35em;color:#1e40af;font-variant-numeric:tabular-nums;">${code}</span>
      </div>
      <p style="color:#9ca3af;font-size:0.8rem;margin:0 0 4px;">⏱ Expira en <strong>15 minutos</strong>.</p>
      <p style="color:#d1d5db;font-size:0.75rem;margin:0;">Si no solicitaste este código, ignora este mensaje.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
