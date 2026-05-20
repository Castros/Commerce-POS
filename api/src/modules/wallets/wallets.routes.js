import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { insertAuditEvent } from "../../shared/audit/audit.js";
import { getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, notFound, parseZod } from "../../shared/http/errors.js";

export const walletsRouter = Router();

const createWalletSchema = z.object({
  organizationId: z.string().uuid(),
  customerId: z.string().uuid(),
  creditLimitCents: z.number().int().min(0).default(0)
});

const topUpSchema = z.object({
  organizationId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  note: z.string().nullable().optional()
});

walletsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid(),
        customerId: z.string().uuid().optional()
      }),
      req.query
    );

    const values = [query.organizationId];
    let customerClause = "";
    if (query.customerId) {
      values.push(query.customerId);
      customerClause = "AND customer_id = $2";
    }

    const result = await pool.query(
      `
        SELECT id, organization_id AS "organizationId", customer_id AS "customerId",
               balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents",
               currency, active, updated_at AS "updatedAt"
        FROM commerce_wallet_accounts
        WHERE organization_id = $1
          ${customerClause}
        ORDER BY updated_at DESC
      `,
      values
    );

    res.json({ data: result.rows });
  })
);

walletsRouter.post(
  "/",
  requirePermission("wallets:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(createWalletSchema, req.body);
    const result = await pool.query(
      `
        INSERT INTO commerce_wallet_accounts (organization_id, customer_id)
        VALUES ($1, $2)
        ON CONFLICT (organization_id, customer_id, currency)
        DO UPDATE SET
          active = commerce_wallet_accounts.active,
          credit_limit_cents = GREATEST(
            commerce_wallet_accounts.credit_limit_cents,
            $3
          )
        RETURNING id, organization_id AS "organizationId", customer_id AS "customerId",
                  balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents",
                  currency, active, updated_at AS "updatedAt"
      `,
      [body.organizationId, body.customerId, body.creditLimitCents]
    );
    res.status(201).json({ data: result.rows[0] });
  })
);

walletsRouter.get(
  "/:id/transactions",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        organizationId: z.string().uuid()
      }),
      req.query
    );

    const result = await pool.query(
      `
        SELECT id, organization_id AS "organizationId",
               wallet_account_id AS "walletAccountId",
               order_id AS "orderId",
               type,
               amount_cents AS "amountCents",
               balance_after_cents AS "balanceAfterCents",
               currency,
               source,
               note,
               created_at AS "createdAt"
        FROM commerce_wallet_transactions
        WHERE organization_id = $1
          AND wallet_account_id = $2
        ORDER BY created_at DESC
      `,
      [query.organizationId, req.params.id]
    );

    res.json({ data: result.rows });
  })
);

walletsRouter.post(
  "/:id/topups",
  requirePermission("wallets:topup"),
  asyncHandler(async (req, res) => {
    const body = parseZod(topUpSchema, req.body);
    const actor = getActor(req);

    const data = await withTransaction(async (client) => {
      const walletResult = await client.query(
        `
          SELECT id, balance_cents, currency
          FROM commerce_wallet_accounts
          WHERE organization_id = $1
            AND id = $2
            AND active = TRUE
          FOR UPDATE
        `,
        [body.organizationId, req.params.id]
      );

      const wallet = walletResult.rows[0];
      if (!wallet) {
        throw notFound("Wallet not found");
      }

      const balanceAfter = Number(wallet.balance_cents) + body.amountCents;

      await client.query(
        `
          UPDATE commerce_wallet_accounts
          SET balance_cents = $3,
              updated_at = NOW()
          WHERE organization_id = $1
            AND id = $2
        `,
        [body.organizationId, req.params.id, balanceAfter]
      );

      const transactionResult = await client.query(
        `
          INSERT INTO commerce_wallet_transactions (
            organization_id,
            wallet_account_id,
            type,
            amount_cents,
            balance_after_cents,
            source,
            note,
            created_by_user_id
          )
          VALUES ($1, $2, 'top_up', $3, $4, 'manual', $5, $6)
          RETURNING id, type, amount_cents AS "amountCents",
                    balance_after_cents AS "balanceAfterCents",
                    created_at AS "createdAt"
        `,
        [
          body.organizationId,
          req.params.id,
          body.amountCents,
          balanceAfter,
          body.note || null,
          actor.actorUserId
        ]
      );

      await insertAuditEvent(client, {
        organizationId: body.organizationId,
        actorUserId: actor.actorUserId,
        actorService: actor.actorService,
        action: "wallet.top_up",
        targetType: "wallet_account",
        targetId: req.params.id,
        summary: {
          amountCents: body.amountCents,
          balanceAfterCents: balanceAfter
        },
        requestId: req.requestId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null
      });

      return {
        wallet: {
          id: req.params.id,
          organizationId: body.organizationId,
          balanceCents: balanceAfter,
          currency: wallet.currency
        },
        transaction: transactionResult.rows[0]
      };
    });

    res.status(201).json({ data });
  })
);
