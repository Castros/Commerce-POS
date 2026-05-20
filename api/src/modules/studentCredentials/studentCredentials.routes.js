import crypto from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requirePermission } from "../../shared/auth/auth.js";
import {
  asyncHandler,
  badRequest,
  conflict,
  notFound,
  parseZod
} from "../../shared/http/errors.js";
import { getOrganizationSettings } from "../../shared/organizationSettings.js";

export const studentCredentialsRouter = Router();

const credentialTypes = z.enum([
  "nfc_card",
  "nfc_wristband",
  "barcode",
  "qr_code",
  "manual_pin"
]);

const listSchema = z.object({
  organizationId: z.string().uuid(),
  customerId: z.string().uuid().optional()
});

const issueSchema = z.object({
  organizationId: z.string().uuid(),
  customerId: z.string().uuid(),
  walletAccountId: z.string().uuid().optional(),
  credentialType: credentialTypes.default("nfc_wristband"),
  credentialLabel: z.string().trim().min(1).optional(),
  credentialToken: z.string().trim().min(4).optional(),
  metadata: z.record(z.unknown()).optional()
});

const resolveSchema = z.object({
  organizationId: z.string().uuid(),
  credentialToken: z.string().trim().min(4)
});

const revokeSchema = z.object({
  organizationId: z.string().uuid()
});

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken() {
  return `cred_${crypto.randomBytes(16).toString("hex")}`;
}

function serializeCredential(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerId: row.customerId,
    walletAccountId: row.walletAccountId,
    credentialType: row.credentialType,
    credentialLabel: row.credentialLabel,
    active: row.active,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    metadata: row.metadata || {}
  };
}

async function loadCustomerWallet(client, organizationId, customerId, walletAccountId) {
  const customerResult = await client.query(
    `
      SELECT id, organization_id AS "organizationId", name, email, phone,
             external_student_id AS "externalStudentId",
             external_parent_id AS "externalParentId",
             external_id AS "externalId"
      FROM commerce_customers
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    [organizationId, customerId]
  );

  const customer = customerResult.rows[0];
  if (!customer) {
    throw notFound("Customer not found");
  }

  if (walletAccountId) {
    const walletResult = await client.query(
      `
        SELECT id, organization_id AS "organizationId", customer_id AS "customerId",
               balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents",
               currency, active, updated_at AS "updatedAt"
        FROM commerce_wallet_accounts
        WHERE organization_id = $1
          AND id = $2
          AND customer_id = $3
        LIMIT 1
      `,
      [organizationId, walletAccountId, customerId]
    );

    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw badRequest("Wallet account does not belong to the selected customer");
    }

    return { customer, wallet };
  }

  const walletResult = await client.query(
    `
      INSERT INTO commerce_wallet_accounts (organization_id, customer_id, currency)
      VALUES ($1, $2, $3)
      ON CONFLICT (organization_id, customer_id, currency)
      DO UPDATE SET active = commerce_wallet_accounts.active
      RETURNING id, organization_id AS "organizationId", customer_id AS "customerId",
                balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents",
                currency, active, updated_at AS "updatedAt"
    `,
    [organizationId, customerId, (await getOrganizationSettings(client, organizationId)).currency]
  );

  return { customer, wallet: walletResult.rows[0] };
}

studentCredentialsRouter.get(
  "/",
  requirePermission("credentials:write"),
  asyncHandler(async (req, res) => {
    const query = parseZod(listSchema, req.query);

    const result = await pool.query(
      `
        SELECT sc.id,
               sc.organization_id AS "organizationId",
               sc.customer_id AS "customerId",
               sc.wallet_account_id AS "walletAccountId",
               sc.credential_type AS "credentialType",
               sc.credential_label AS "credentialLabel",
               sc.active,
               sc.issued_at AS "issuedAt",
               sc.revoked_at AS "revokedAt",
               sc.last_used_at AS "lastUsedAt",
               sc.metadata,
               c.name AS "customerName",
               c.external_student_id AS "externalStudentId",
               c.external_id AS "externalId",
               w.balance_cents AS "walletBalanceCents",
               w.credit_limit_cents AS "walletCreditLimitCents"
        FROM commerce_student_credentials sc
        JOIN commerce_customers c
          ON c.organization_id = sc.organization_id
         AND c.id = sc.customer_id
        LEFT JOIN commerce_wallet_accounts w
          ON w.organization_id = sc.organization_id
         AND w.id = sc.wallet_account_id
        WHERE sc.organization_id = $1
          AND ($2::uuid IS NULL OR sc.customer_id = $2)
        ORDER BY sc.issued_at DESC
      `,
      [query.organizationId, query.customerId || null]
    );

    res.json({
      data: result.rows.map((row) => ({
        ...serializeCredential(row),
        customerName: row.customerName,
        externalStudentId: row.externalStudentId,
        externalId: row.externalId,
        walletBalanceCents: row.walletBalanceCents,
        walletCreditLimitCents: row.walletCreditLimitCents
      }))
    });
  })
);

studentCredentialsRouter.post(
  "/issue",
  requirePermission("credentials:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(issueSchema, req.body);

    const data = await withTransaction(async (client) => {
      const { customer, wallet } = await loadCustomerWallet(
        client,
        body.organizationId,
        body.customerId,
        body.walletAccountId
      );

      const credentialToken = body.credentialToken || generateToken();
      const credentialTokenHash = hashToken(credentialToken);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await client.query(
            `
              INSERT INTO commerce_student_credentials (
                organization_id,
                customer_id,
                wallet_account_id,
                credential_type,
                credential_token_hash,
                credential_label,
                metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
              RETURNING id,
                        organization_id AS "organizationId",
                        customer_id AS "customerId",
                        wallet_account_id AS "walletAccountId",
                        credential_type AS "credentialType",
                        credential_label AS "credentialLabel",
                        active,
                        issued_at AS "issuedAt",
                        revoked_at AS "revokedAt",
                        last_used_at AS "lastUsedAt",
                        metadata
            `,
            [
              body.organizationId,
              customer.id,
              wallet.id,
              body.credentialType,
              credentialTokenHash,
              body.credentialLabel || null,
              JSON.stringify(body.metadata || {})
            ]
          );

          const credential = result.rows[0];
          return {
            credential: serializeCredential(credential),
            credentialToken,
            customer,
            wallet
          };
        } catch (err) {
          if (err?.code === "23505" && !body.credentialToken && attempt < 2) {
            continue;
          }
          if (err?.code === "23505") {
            throw conflict("Credential token already exists");
          }
          throw err;
        }
      }

      throw conflict("Could not issue credential");
    });

    res.status(201).json({ data });
  })
);

studentCredentialsRouter.post(
  "/resolve",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(resolveSchema, req.body);
    const credentialTokenHash = hashToken(body.credentialToken);

    const data = await withTransaction(async (client) => {
      const credentialResult = await client.query(
        `
          SELECT id,
                 organization_id AS "organizationId",
                 customer_id AS "customerId",
                 wallet_account_id AS "walletAccountId",
                 credential_type AS "credentialType",
                 credential_label AS "credentialLabel",
                 active,
                 issued_at AS "issuedAt",
                 revoked_at AS "revokedAt",
                 last_used_at AS "lastUsedAt",
                 metadata
          FROM commerce_student_credentials
          WHERE organization_id = $1
            AND credential_token_hash = $2
            AND active = TRUE
          LIMIT 1
          FOR UPDATE
        `,
        [body.organizationId, credentialTokenHash]
      );

      const credential = credentialResult.rows[0];
      if (!credential) {
        throw notFound("Credential not found");
      }

      await client.query(
        `
          UPDATE commerce_student_credentials
          SET last_used_at = NOW()
          WHERE id = $1
        `,
        [credential.id]
      );

      const linkedResult = await client.query(
        `
          SELECT c.id, c.organization_id AS "organizationId", c.name, c.email, c.phone,
                 c.external_student_id AS "externalStudentId",
                 c.external_parent_id AS "externalParentId",
                 c.external_id AS "externalId",
                 w.id AS "walletId",
                 w.balance_cents AS "balanceCents",
                 w.credit_limit_cents AS "creditLimitCents",
                 w.currency,
                 w.active AS "walletActive"
          FROM commerce_customers c
          JOIN commerce_wallet_accounts w
            ON w.organization_id = c.organization_id
           AND w.customer_id = c.id
          WHERE c.organization_id = $1
            AND c.id = $2
          LIMIT 1
        `,
        [body.organizationId, credential.customerId]
      );

      const linked = linkedResult.rows[0];
      if (!linked) {
        throw notFound("Linked customer not found");
      }

      return {
        credential: serializeCredential(credential),
        customer: {
          id: linked.id,
          organizationId: linked.organizationId,
          name: linked.name,
          email: linked.email,
          phone: linked.phone,
          externalStudentId: linked.externalStudentId,
          externalParentId: linked.externalParentId,
          externalId: linked.externalId
        },
        wallet: {
          id: linked.walletId,
          balanceCents: Number(linked.balanceCents),
          creditLimitCents: Number(linked.creditLimitCents || 0),
          currency: linked.currency,
          active: linked.walletActive
        }
      };
    });

    res.json({ data });
  })
);

studentCredentialsRouter.post(
  "/:credentialId/revoke",
  requirePermission("credentials:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(revokeSchema, req.body);
    const credentialId = z.string().uuid().parse(req.params.credentialId);

    const data = await withTransaction(async (client) => {
      const result = await client.query(
        `
          UPDATE commerce_student_credentials
          SET active = FALSE,
              revoked_at = COALESCE(revoked_at, NOW())
          WHERE organization_id = $1
            AND id = $2
          RETURNING id,
                    organization_id AS "organizationId",
                    customer_id AS "customerId",
                    wallet_account_id AS "walletAccountId",
                    credential_type AS "credentialType",
                    credential_label AS "credentialLabel",
                    active,
                    issued_at AS "issuedAt",
                    revoked_at AS "revokedAt",
                    last_used_at AS "lastUsedAt",
                    metadata
        `,
        [body.organizationId, credentialId]
      );

      const credential = result.rows[0];
      if (!credential) {
        throw notFound("Credential not found");
      }

      return serializeCredential(credential);
    });

    res.json({ data });
  })
);
