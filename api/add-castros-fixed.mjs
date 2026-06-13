import { pool } from "./src/db/client.js";
import { pbkdf2Sync, randomBytes } from "crypto";

const ORG_ID = "5a025783-ab24-4023-9cbd-9c0185ccf02e"; // Demo Academy
const NAME   = "Cristian Castro";
const EMAIL  = "castrostech@gmail.com";
const PIN    = "4882";
const ROLE   = "super_admin";

// Must match browserAuth.js: 120000 iterations, 32 bytes, sha256
function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pin, salt, 120000, 32, "sha256").toString("hex");
  return { hash, salt, last4: pin.slice(-4) };
}

const { hash, salt, last4 } = hashPin(PIN);

const existing = await pool.query(
  `SELECT id FROM commerce_users WHERE organization_id = $1 AND email = $2`,
  [ORG_ID, EMAIL]
);

if (existing.rowCount > 0) {
  await pool.query(
    `UPDATE commerce_users SET pin_hash=$1, pin_salt=$2, pin_last4=$3, role=$4, pin_set_at=NOW(), active=TRUE
     WHERE organization_id=$5 AND email=$6`,
    [hash, salt, last4, ROLE, ORG_ID, EMAIL]
  );
  console.log("Updated:", EMAIL, "→", ROLE, "(hash corrected to sha256/32)");
} else {
  await pool.query(
    `INSERT INTO commerce_users (organization_id, name, email, role, pin_hash, pin_salt, pin_last4, pin_set_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
    [ORG_ID, NAME, EMAIL, ROLE, hash, salt, last4]
  );
  console.log("Created:", EMAIL, "role:", ROLE, "— Demo Academy");
}

process.exit(0);
