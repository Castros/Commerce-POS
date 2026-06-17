import { pool } from "../../db/client.js";
import { sendEmail } from "./emailClient.js";

function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function buildReceiptHtml({ orgName, storeName, customerName, items, subtotalCents, taxCents, totalCents, paymentMethod, createdAt, balanceCents }) {
  const rows = items.map((item) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;">${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ""}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;">${formatMoney(item.lineTotalCents)}</td>
    </tr>`).join("");

  const balanceRow = balanceCents !== null ? `
    <tr>
      <td colspan="2" style="padding:12px 0 0;color:#6b7280;font-size:13px;">
        Wallet balance after purchase: <strong style="color:${balanceCents < 0 ? "#dc2626" : "#16a34a"}">${formatMoney(balanceCents)}</strong>
      </td>
    </tr>` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#1e40af;padding:24px 28px;">
      <p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${orgName}</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">Purchase Receipt</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">${storeName} · ${formatDate(createdAt)}</p>
      ${customerName ? `<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#111827;">For: ${customerName}</p>` : "<div style='margin-bottom:20px'></div>"}

      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
        <tbody>${rows}</tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
        <tbody>
          ${taxCents > 0 ? `
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Subtotal</td>
            <td style="padding:4px 0;text-align:right;color:#6b7280;">${formatMoney(subtotalCents)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#6b7280;">Tax</td>
            <td style="padding:4px 0;text-align:right;color:#6b7280;">${formatMoney(taxCents)}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:8px 0 4px;font-weight:700;font-size:15px;color:#111827;">Total</td>
            <td style="padding:8px 0 4px;text-align:right;font-weight:700;font-size:15px;color:#111827;">${formatMoney(totalCents)}</td>
          </tr>
          <tr>
            <td style="padding:2px 0;color:#6b7280;font-size:13px;">Paid via</td>
            <td style="padding:2px 0;text-align:right;color:#6b7280;font-size:13px;">${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</td>
          </tr>
          ${balanceRow}
        </tbody>
      </table>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        Questions? Reply to this email and we'll get back to you.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildTopUpHtml({ orgName, customerName, amountCents, balanceAfterCents }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#0f766e;padding:24px 28px;">
      <p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${orgName}</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">Wallet Funded</h1>
    </div>
    <div style="padding:24px 28px;">
      ${customerName ? `<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#111827;">For: ${customerName}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
        <tbody>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">Amount added</td>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#0f766e;font-size:20px;">${formatMoney(amountCents)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:13px;">New balance</td>
            <td style="padding:8px 0;text-align:right;font-weight:600;color:${balanceAfterCents < 0 ? "#dc2626" : "#16a34a"};font-size:15px;">${formatMoney(balanceAfterCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Questions? Reply to this email and we'll get back to you.</p>
    </div>
  </div>
</body>
</html>`;
}

function buildLowBalanceHtml({ orgName, customerName, balanceCents, thresholdCents }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#dc2626;padding:24px 28px;">
      <p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${orgName}</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:22px;font-weight:700;">Saldo Bajo</h1>
    </div>
    <div style="padding:24px 28px;">
      ${customerName ? `<p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#111827;">Alumno: ${customerName}</p>` : ""}
      <p style="margin:0 0 20px;color:#374151;font-size:14px;">
        El saldo de la cuenta de tu hijo(a) ha bajado por debajo del límite de alerta configurado.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#6b7280;">Saldo actual</td>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#dc2626;font-size:18px;">${formatMoney(balanceCents)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:13px;">Límite de alerta</td>
            <td style="padding:8px 0;text-align:right;color:#6b7280;font-size:13px;">${formatMoney(thresholdCents)}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Recarga el monedero para que tu hijo(a) pueda continuar comprando en la cafetería.</p>
    </div>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">¿Preguntas? Responde a este correo y te atenderemos.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send a low-balance alert to guardians when the wallet drops below their threshold.
 * Only fires when balance crosses the threshold (before >= threshold, after < threshold).
 * Fires and forgets — never throws.
 */
export async function sendLowBalanceAlert({ organizationId, customerId, balanceBeforeCents, balanceAfterCents }) {
  try {
    const [orgResult, customerResult, guardianResult] = await Promise.all([
      pool.query(
        `SELECT name AS "orgName", contact_email AS "contactEmail" FROM commerce_organizations WHERE id = $1`,
        [organizationId]
      ),
      pool.query(
        `SELECT name FROM commerce_customers WHERE id = $1 AND organization_id = $2`,
        [customerId, organizationId]
      ),
      pool.query(
        `SELECT g.name, g.email,
                (g.notification_prefs->>'low_balance_threshold_cents')::int AS threshold
         FROM commerce_guardian_students gs
         JOIN commerce_guardians g ON g.id = gs.guardian_id
         WHERE gs.student_id = $1 AND gs.organization_id = $2
           AND g.active = TRUE
           AND (g.notification_prefs->>'low_balance_threshold_cents')::int > 0`,
        [customerId, organizationId]
      )
    ]);

    const org = orgResult.rows[0];
    const customer = customerResult.rows[0];
    if (!customer || guardianResult.rows.length === 0) return;

    const toAlert = guardianResult.rows.filter(
      (g) => balanceAfterCents < g.threshold && balanceBeforeCents >= g.threshold
    );
    if (toAlert.length === 0) return;

    await Promise.all(
      toAlert.map((g) => {
        const html = buildLowBalanceHtml({
          orgName: org?.orgName || "Store",
          customerName: customer.name,
          balanceCents: balanceAfterCents,
          thresholdCents: g.threshold
        });
        return sendEmail({
          to: g.email,
          subject: `Saldo bajo — ${customer.name}`,
          replyTo: org?.contactEmail || undefined,
          html
        });
      })
    );
  } catch (err) {
    console.error("[email] sendLowBalanceAlert failed:", err.message);
  }
}

/**
 * Send a wallet top-up confirmation email.
 * Routes to linked guardians with email_on_purchase enabled, falls back to customer email.
 * Fires and forgets — never throws.
 */
export async function sendTopUpEmail({ organizationId, customerId, amountCents, balanceAfterCents }) {
  try {
    const [orgResult, customerResult] = await Promise.all([
      pool.query(
        `SELECT name AS "orgName", contact_email AS "contactEmail" FROM commerce_organizations WHERE id = $1`,
        [organizationId]
      ),
      pool.query(
        `SELECT name, email FROM commerce_customers WHERE id = $1 AND organization_id = $2`,
        [customerId, organizationId]
      )
    ]);

    const org = orgResult.rows[0];
    const customer = customerResult.rows[0];
    if (!customer) return;

    const guardianResult = await pool.query(
      `SELECT g.name, g.email
       FROM commerce_guardian_students gs
       JOIN commerce_guardians g ON g.id = gs.guardian_id
       WHERE gs.student_id = $1 AND gs.organization_id = $2
         AND g.active = TRUE
         AND (g.notification_prefs->>'email_on_purchase')::boolean = TRUE`,
      [customerId, organizationId]
    );

    const recipients = guardianResult.rows.length > 0
      ? guardianResult.rows
      : customer.email ? [{ name: customer.name, email: customer.email }] : [];

    if (recipients.length === 0) return;

    const html = buildTopUpHtml({
      orgName: org?.orgName || "Store",
      customerName: customer.name,
      amountCents,
      balanceAfterCents,
    });

    await Promise.all(
      recipients.map((r) =>
        sendEmail({
          to: r.email,
          subject: `Wallet funded — ${formatMoney(amountCents)} added`,
          replyTo: org?.contactEmail || undefined,
          html,
        })
      )
    );
  } catch (err) {
    console.error("[email] sendTopUpEmail failed:", err.message);
  }
}

/**
 * Send a purchase receipt email after a completed order.
 * Sends to all linked guardians who have email_on_purchase enabled.
 * Falls back to the customer's own email if no guardians are linked.
 * Fires and forgets — never throws.
 */
export async function sendReceiptEmail({ organizationId, order, items, payment, wallet }) {
  try {
    const [orgResult, customerResult] = await Promise.all([
      pool.query(
        `SELECT o.name AS "orgName", o.contact_email AS "contactEmail",
                s.name AS "storeName"
         FROM commerce_organizations o
         JOIN commerce_stores s ON s.organization_id = o.id AND s.id = $2
         WHERE o.id = $1`,
        [organizationId, order.storeId]
      ),
      order.customerId
        ? pool.query(
            `SELECT name, email FROM commerce_customers WHERE id = $1 AND organization_id = $2`,
            [order.customerId, organizationId]
          )
        : Promise.resolve({ rows: [] })
    ]);

    const org = orgResult.rows[0];
    const customer = customerResult.rows[0];
    if (!customer) return;

    // Find guardians opted in to purchase notifications
    const guardianResult = order.customerId
      ? await pool.query(
          `SELECT g.name, g.email
           FROM commerce_guardian_students gs
           JOIN commerce_guardians g ON g.id = gs.guardian_id
           WHERE gs.student_id      = $1
             AND gs.organization_id = $2
             AND g.active           = TRUE
             AND (g.notification_prefs->>'email_on_purchase')::boolean = TRUE`,
          [order.customerId, organizationId]
        )
      : { rows: [] };

    // Use guardian emails if any; otherwise fall back to the customer's own email
    const recipients = guardianResult.rows.length > 0
      ? guardianResult.rows
      : customer.email ? [{ name: customer.name, email: customer.email }] : [];

    if (recipients.length === 0) return;

    const receiptHtml = buildReceiptHtml({
      orgName: org?.orgName || "Store",
      storeName: org?.storeName || "Store",
      customerName: customer.name,
      items,
      subtotalCents: Number(order.subtotalCents),
      taxCents: Number(order.taxCents),
      totalCents: Number(order.totalCents),
      paymentMethod: payment.method,
      createdAt: order.createdAt,
      balanceCents: wallet ? Number(wallet.balanceCents) : null
    });

    await Promise.all(
      recipients.map((r) =>
        sendEmail({
          to: r.email,
          subject: `Receipt from ${org?.orgName || "the store"}`,
          replyTo: org?.contactEmail || undefined,
          html: receiptHtml
        })
      )
    );
  } catch (err) {
    console.error("[email] sendReceiptEmail failed:", err.message);
  }
}
