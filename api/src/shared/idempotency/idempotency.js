import crypto from "node:crypto";

import { conflict } from "../http/errors.js";

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function hashRequestBody(body) {
  return crypto.createHash("sha256").update(stableStringify(body)).digest("hex");
}

export async function lockIdempotencyKey(client, {
  organizationId,
  idempotencyKey,
  requestHash
}) {
  await client.query(
    `
      INSERT INTO commerce_idempotency_keys (
        organization_id,
        idempotency_key,
        request_hash,
        expires_at
      )
      VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    `,
    [organizationId, idempotencyKey, requestHash]
  );

  const result = await client.query(
    `
      SELECT request_hash, response_status, response_body
      FROM commerce_idempotency_keys
      WHERE organization_id = $1
        AND idempotency_key = $2
      FOR UPDATE
    `,
    [organizationId, idempotencyKey]
  );

  const row = result.rows[0];
  if (row.request_hash !== requestHash) {
    throw conflict("Idempotency key was already used with a different request body");
  }

  if (row.response_body) {
    return {
      replay: true,
      status: row.response_status || 200,
      body: row.response_body
    };
  }

  return { replay: false };
}

export async function storeIdempotentResponse(client, {
  organizationId,
  idempotencyKey,
  status,
  body
}) {
  await client.query(
    `
      UPDATE commerce_idempotency_keys
      SET response_status = $3,
          response_body = $4
      WHERE organization_id = $1
        AND idempotency_key = $2
    `,
    [organizationId, idempotencyKey, status, body]
  );
}

