import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
export const FROM_EMAIL = process.env.EMAIL_FROM || "Commerce POS <noreply@notify.fransolution.net>";

let client = null;

function getClient() {
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

/**
 * Send an email. Silently skips if RESEND_API_KEY is not configured.
 * @param {{ to: string, subject: string, html: string, replyTo?: string }} opts
 */
/**
 * Builds the subject + html for a parent portal invite email.
 * Returns { subject, html } — spread into sendEmail().
 */
export function buildInviteEmail({ guardianName, orgName, inviteUrl, studentNames }) {
  const firstName = guardianName?.split(" ")[0] || "there";
  const studentList = studentNames?.length
    ? studentNames.map((n) => `<li>${n}</li>`).join("")
    : "<li>your student</li>";

  return {
    subject: `You're invited to the ${orgName} parent portal`,
    html: `
      <p>Hi ${firstName},</p>
      <p>${orgName} has invited you to the Commerce POS parent portal so you can manage wallet funds and view purchase history for:</p>
      <ul>${studentList}</ul>
      <p><a href="${inviteUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:12px 0">Accept invitation</a></p>
      <p style="color:#6b7280;font-size:12px">This link expires in 48 hours. If you did not expect this email, you can ignore it.</p>
    `
  };
}

/**
 * Builds the subject + html for a parent magic-link / OTP email.
 * Returns { subject, html } — spread into sendEmail().
 */
export function buildMagicLinkEmail({ guardianName, code, orgName }) {
  const firstName = guardianName?.split(" ")[0] || "there";
  return {
    subject: `Your ${orgName} login code`,
    html: `
      <p>Hi ${firstName},</p>
      <p>Use the code below to sign in to the ${orgName} parent portal. It expires in 15 minutes.</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">${code}</p>
      <p style="color:#6b7280;font-size:12px">If you did not request this code, you can safely ignore this email.</p>
    `
  };
}

export async function sendEmail({ to, subject, html, replyTo }) {
  const resend = getClient();
  if (!resend) {
    console.warn(`[email] Skipped (no RESEND_API_KEY): ${subject} → ${to}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    });
    if (error) console.error(`[email] Resend error:`, error);
    else console.info(`[email] Sent: ${subject} → ${to}`);
  } catch (err) {
    console.error(`[email] Failed to send:`, err.message);
  }
}
