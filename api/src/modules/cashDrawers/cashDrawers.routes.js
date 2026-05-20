import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { getActor, requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, badRequest, conflict, notFound, parseZod } from "../../shared/http/errors.js";

export const cashDrawersRouter = Router();

const drawerQuerySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  status: z.enum(["open", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const currentQuerySchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  registerName: z.string().min(1)
});

const openDrawerSchema = z.object({
  organizationId: z.string().uuid(),
  storeId: z.string().uuid(),
  registerName: z.string().min(1),
  openingCashCents: z.number().int().min(0).default(0),
  note: z.string().max(500).optional()
});

const closeDrawerSchema = z.object({
  organizationId: z.string().uuid(),
  countedCashCents: z.number().int().min(0),
  note: z.string().max(500).optional()
});

function mapSession(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    registerName: row.registerName,
    status: row.status,
    openingCashCents: Number(row.openingCashCents),
    expectedCashCents: Number(row.expectedCashCents),
    countedCashCents: row.countedCashCents === null ? null : Number(row.countedCashCents),
    overShortCents: row.overShortCents === null ? null : Number(row.overShortCents),
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    note: row.note
  };
}

cashDrawersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseZod(drawerQuerySchema, req.query);
    const values = [query.organizationId];
    const clauses = ["organization_id = $1"];

    if (query.storeId) {
      values.push(query.storeId);
      clauses.push(`store_id = $${values.length}`);
    }

    if (query.status) {
      values.push(query.status);
      clauses.push(`status = $${values.length}`);
    }

    values.push(query.limit);

    const result = await pool.query(
      `
        SELECT id,
               organization_id AS "organizationId",
               store_id AS "storeId",
               register_name AS "registerName",
               status,
               opening_cash_cents AS "openingCashCents",
               expected_cash_cents AS "expectedCashCents",
               counted_cash_cents AS "countedCashCents",
               over_short_cents AS "overShortCents",
               opened_at AS "openedAt",
               closed_at AS "closedAt",
               note
        FROM commerce_cash_drawer_sessions
        WHERE ${clauses.join(" AND ")}
        ORDER BY opened_at DESC
        LIMIT $${values.length}
      `,
      values
    );

    res.json({ data: result.rows.map(mapSession) });
  })
);

cashDrawersRouter.get(
  "/current",
  asyncHandler(async (req, res) => {
    const query = parseZod(currentQuerySchema, req.query);
    const result = await pool.query(
      `
        SELECT id,
               organization_id AS "organizationId",
               store_id AS "storeId",
               register_name AS "registerName",
               status,
               opening_cash_cents AS "openingCashCents",
               expected_cash_cents AS "expectedCashCents",
               counted_cash_cents AS "countedCashCents",
               over_short_cents AS "overShortCents",
               opened_at AS "openedAt",
               closed_at AS "closedAt",
               note
        FROM commerce_cash_drawer_sessions
        WHERE organization_id = $1
          AND store_id = $2
          AND register_name = $3
          AND status = 'open'
        LIMIT 1
      `,
      [query.organizationId, query.storeId, query.registerName]
    );

    res.json({ data: result.rows[0] ? mapSession(result.rows[0]) : null });
  })
);

cashDrawersRouter.post(
  "/open",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(openDrawerSchema, req.body);
    const actor = getActor(req);

    const result = await withTransaction(async (client) => {
      const store = await client.query(
        `
          SELECT id
          FROM commerce_stores
          WHERE organization_id = $1
            AND id = $2
            AND active = TRUE
        `,
        [body.organizationId, body.storeId]
      );
      if (store.rowCount === 0) throw notFound("Store not found");

      const session = (
        await client.query(
          `
            INSERT INTO commerce_cash_drawer_sessions (
              organization_id,
              store_id,
              register_name,
              opening_cash_cents,
              expected_cash_cents,
              opened_by_user_id,
              note
            )
            VALUES ($1, $2, $3, $4, $4, $5, $6)
            RETURNING id,
                      organization_id AS "organizationId",
                      store_id AS "storeId",
                      register_name AS "registerName",
                      status,
                      opening_cash_cents AS "openingCashCents",
                      expected_cash_cents AS "expectedCashCents",
                      counted_cash_cents AS "countedCashCents",
                      over_short_cents AS "overShortCents",
                      opened_at AS "openedAt",
                      closed_at AS "closedAt",
                      note
          `,
          [
            body.organizationId,
            body.storeId,
            body.registerName,
            body.openingCashCents,
            actor.actorUserId,
            body.note || null
          ]
        )
      ).rows[0];

      await client.query(
        `
          INSERT INTO commerce_cash_drawer_events (
            organization_id,
            store_id,
            session_id,
            type,
            amount_cents,
            cash_balance_after_cents,
            note,
            created_by_user_id
          )
          VALUES ($1, $2, $3, 'open', $4, $4, $5, $6)
        `,
        [
          body.organizationId,
          body.storeId,
          session.id,
          body.openingCashCents,
          body.note || "Drawer opened",
          actor.actorUserId
        ]
      );

      return mapSession(session);
    }).catch((err) => {
      if (err.code === "23505") {
        throw conflict("Cash drawer is already open for this register");
      }
      throw err;
    });

    res.status(201).json({ data: result });
  })
);

cashDrawersRouter.post(
  "/:id/close",
  requirePermission("orders:write"),
  asyncHandler(async (req, res) => {
    const sessionId = z.string().uuid().parse(req.params.id);
    const body = parseZod(closeDrawerSchema, req.body);
    const actor = getActor(req);

    const result = await withTransaction(async (client) => {
      const current = (
        await client.query(
          `
            SELECT *
            FROM commerce_cash_drawer_sessions
            WHERE organization_id = $1
              AND id = $2
              AND status = 'open'
            FOR UPDATE
          `,
          [body.organizationId, sessionId]
        )
      ).rows[0];

      if (!current) throw notFound("Open cash drawer not found");

      const expected = Number(current.expected_cash_cents);
      const overShort = body.countedCashCents - expected;
      if (body.countedCashCents < 0) throw badRequest("countedCashCents must be positive");

      const closed = (
        await client.query(
          `
            UPDATE commerce_cash_drawer_sessions
            SET status = 'closed',
                counted_cash_cents = $3,
                over_short_cents = $4,
                closed_by_user_id = $5,
                closed_at = NOW(),
                note = COALESCE($6, note)
            WHERE organization_id = $1
              AND id = $2
            RETURNING id,
                      organization_id AS "organizationId",
                      store_id AS "storeId",
                      register_name AS "registerName",
                      status,
                      opening_cash_cents AS "openingCashCents",
                      expected_cash_cents AS "expectedCashCents",
                      counted_cash_cents AS "countedCashCents",
                      over_short_cents AS "overShortCents",
                      opened_at AS "openedAt",
                      closed_at AS "closedAt",
                      note
          `,
          [
            body.organizationId,
            sessionId,
            body.countedCashCents,
            overShort,
            actor.actorUserId,
            body.note || null
          ]
        )
      ).rows[0];

      await client.query(
        `
          INSERT INTO commerce_cash_drawer_events (
            organization_id,
            store_id,
            session_id,
            type,
            amount_cents,
            cash_balance_after_cents,
            note,
            created_by_user_id
          )
          VALUES ($1, $2, $3, 'close', $4, $5, $6, $7)
        `,
        [
          body.organizationId,
          current.store_id,
          sessionId,
          body.countedCashCents,
          body.countedCashCents,
          body.note || "Drawer closed",
          actor.actorUserId
        ]
      );

      return mapSession(closed);
    });

    res.json({ data: result });
  })
);
