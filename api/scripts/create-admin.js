/**
 * One-time script to create a platform admin account.
 *
 * Usage:
 *   ADMIN_EMAIL=castrostech@gmail.com ADMIN_NAME="Cristian Castro" ADMIN_PIN=<yourpin> \
 *   DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos \
 *   node scripts/create-admin.js
 *
 * - Creates a "Commerce POS" organization if it doesn't exist
 * - Creates a super_admin user with the given email and PIN
 * - Safe to re-run — skips if the email already exists
 */

import { pool } from "../src/db/client.js";
import { hashPin } from "../src/shared/auth/browserAuth.js";

const ORG_NAME  = process.env.ADMIN_ORG   || "Commerce POS";
const email     = process.env.ADMIN_EMAIL;
const name      = process.env.ADMIN_NAME  || "Platform Admin";
const pin       = process.env.ADMIN_PIN;

if (!email || !pin) {
  console.error("Usage: ADMIN_EMAIL=you@example.com ADMIN_PIN=1234 ADMIN_NAME='Your Name' node scripts/create-admin.js");
  process.exit(1);
}

if (!/^\d{4,8}$/.test(pin)) {
  console.error("PIN must be 4–8 digits.");
  process.exit(1);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // 1. Find or create the platform org
  let orgResult = await client.query(
    `SELECT id, name FROM commerce_organizations WHERE name = $1 LIMIT 1`,
    [ORG_NAME]
  );

  let orgId;
  if (orgResult.rows.length > 0) {
    orgId = orgResult.rows[0].id;
    console.log(`Found existing org: ${orgResult.rows[0].name} (${orgId})`);
  } else {
    orgResult = await client.query(
      `INSERT INTO commerce_organizations (name, type) VALUES ($1, 'other') RETURNING id, name`,
      [ORG_NAME]
    );
    orgId = orgResult.rows[0].id;
    console.log(`Created org: ${orgResult.rows[0].name} (${orgId})`);
  }

  // 2. Check if email already exists
  const existing = await client.query(
    `SELECT id, email, role FROM commerce_users WHERE email = $1 LIMIT 1`,
    [email]
  );

  if (existing.rows.length > 0) {
    const u = existing.rows[0];
    console.log(`Account already exists: ${u.email} (${u.role}) — no changes made.`);
    console.log("To update the PIN, use the Staff page or run the script with a different email.");
    await client.query("ROLLBACK");
    process.exit(0);
  }

  // 3. Hash PIN and create user
  const { salt, hash } = await hashPin(pin);
  const pinLast4 = pin.slice(-4);

  const userResult = await client.query(
    `INSERT INTO commerce_users
       (organization_id, name, email, role, pin_hash, pin_salt, pin_last4, pin_set_at)
     VALUES ($1, $2, $3, 'super_admin', $4, $5, $6, NOW())
     RETURNING id, name, email, role`,
    [orgId, name, email, hash, salt, pinLast4]
  );

  const user = userResult.rows[0];
  await client.query("COMMIT");

  console.log("");
  console.log("✓ Platform admin created successfully");
  console.log(`  Name:  ${user.name}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Role:  ${user.role}`);
  console.log(`  Org:   ${ORG_NAME}`);
  console.log(`  PIN:   ****${pinLast4}`);
  console.log("");
  console.log("Login at /login with your email and PIN.");

} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
