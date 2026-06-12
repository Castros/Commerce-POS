import { pool } from "../../db/client.js";

// ── Closeout summary aggregation ─────────────────────────────────────────────

export async function buildCloseoutInputSnapshot(organizationId, sessionId) {
  // 1. Drawer session + store name
  const sessionResult = await pool.query(
    `SELECT s.id,
            s.store_id,
            s.register_name,
            s.opened_at,
            s.closed_at,
            s.opening_cash_cents,
            s.expected_cash_cents,
            s.counted_cash_cents,
            s.over_short_cents,
            st.name AS store_name
     FROM commerce_cash_drawer_sessions s
     JOIN commerce_stores st
       ON st.organization_id = s.organization_id AND st.id = s.store_id
     WHERE s.organization_id = $1 AND s.id = $2`,
    [organizationId, sessionId]
  );
  if (sessionResult.rowCount === 0) throw new Error(`Drawer session ${sessionId} not found`);
  const session = sessionResult.rows[0];

  // 2. Sales totals for the session window
  const salesResult = await pool.query(
    `SELECT COUNT(DISTINCT o.id)                                          AS total_orders,
            COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'refunded')    AS refunded_orders,
            COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0) AS gross_sales_cents,
            COALESCE(SUM(p.amount_cents)
              FILTER (WHERE p.method = 'cash'   AND p.status = 'succeeded'), 0) AS cash_sales_cents,
            COALESCE(SUM(p.amount_cents)
              FILTER (WHERE p.method = 'card'   AND p.status = 'succeeded'), 0) AS card_sales_cents,
            COALESCE(SUM(p.amount_cents)
              FILTER (WHERE p.method = 'wallet' AND p.status = 'succeeded'), 0) AS wallet_sales_cents,
            COALESCE(SUM(p.amount_cents)
              FILTER (WHERE p.status = 'refunded'), 0)                    AS refunded_amount_cents
     FROM commerce_orders o
     LEFT JOIN commerce_payments p
       ON p.organization_id = o.organization_id AND p.order_id = o.id
     WHERE o.organization_id = $1
       AND o.store_id = $2
       AND o.created_at >= $3
       AND o.created_at <= $4
       AND o.status NOT IN ('void', 'cancelled')`,
    [organizationId, session.store_id, session.opened_at, session.closed_at]
  );
  const sales = salesResult.rows[0];

  // 3. Top products
  const topProductsResult = await pool.query(
    `SELECT oi.name_snapshot                AS name,
            SUM(oi.quantity)               AS units_sold,
            SUM(oi.line_total_cents)       AS revenue_cents
     FROM commerce_order_items oi
     JOIN commerce_orders o
       ON o.organization_id = oi.organization_id AND o.id = oi.order_id
     WHERE oi.organization_id = $1
       AND o.store_id = $2
       AND o.created_at >= $3
       AND o.created_at <= $4
       AND o.status = 'paid'
     GROUP BY oi.product_id, oi.name_snapshot
     ORDER BY units_sold DESC
     LIMIT 10`,
    [organizationId, session.store_id, session.opened_at, session.closed_at]
  );

  // 4. Low stock items
  const lowStockResult = await pool.query(
    `SELECT p.name,
            ii.quantity_on_hand,
            ii.reorder_threshold
     FROM commerce_inventory_items ii
     JOIN commerce_products p
       ON p.organization_id = ii.organization_id AND p.id = ii.product_id
     WHERE ii.organization_id = $1
       AND ii.store_id = $2
       AND ii.track_inventory = TRUE
       AND ii.quantity_on_hand <= ii.reorder_threshold
     ORDER BY (ii.quantity_on_hand::float / NULLIF(ii.reorder_threshold, 0)) ASC NULLS LAST
     LIMIT 15`,
    [organizationId, session.store_id]
  );

  // 5. Wallet balance snapshot
  const walletResult = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE balance_cents < 0)    AS negative_balance_count,
            COALESCE(SUM(balance_cents) FILTER (WHERE balance_cents < 0), 0) AS total_negative_cents
     FROM commerce_wallet_accounts
     WHERE organization_id = $1 AND active = TRUE`,
    [organizationId]
  );
  const wallets = walletResult.rows[0];

  return {
    sessionId,
    storeName: session.store_name,
    registerName: session.register_name,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    drawerCents: {
      opening: Number(session.opening_cash_cents),
      expected: Number(session.expected_cash_cents),
      counted: Number(session.counted_cash_cents),
      overShort: Number(session.over_short_cents)
    },
    salesSummary: {
      totalOrders: Number(sales.total_orders),
      refundedOrders: Number(sales.refunded_orders),
      grossSalesCents: Number(sales.gross_sales_cents),
      cashSalesCents: Number(sales.cash_sales_cents),
      cardSalesCents: Number(sales.card_sales_cents),
      walletSalesCents: Number(sales.wallet_sales_cents),
      refundedAmountCents: Number(sales.refunded_amount_cents)
    },
    topProducts: topProductsResult.rows.map((r) => ({
      name: r.name,
      unitsSold: Number(r.units_sold),
      revenueCents: Number(r.revenue_cents)
    })),
    lowStockItems: lowStockResult.rows.map((r) => ({
      name: r.name,
      quantityOnHand: Number(r.quantity_on_hand),
      reorderThreshold: Number(r.reorder_threshold)
    })),
    walletSnapshot: {
      negativeBalanceCount: Number(wallets.negative_balance_count),
      totalNegativeCents: Number(wallets.total_negative_cents)
    }
  };
}

// ── Anomaly detection queries ─────────────────────────────────────────────────

export async function runAnomalyRules(organizationId, dateFrom, dateTo) {
  const flagged = [];

  // Anomaly 1: cashiers with refund rate significantly above org average
  const refundResult = await pool.query(
    `WITH refund_counts AS (
       SELECT o.created_by_user_id,
              COUNT(*) AS refund_count,
              SUM(p.amount_cents) AS refunded_cents
       FROM commerce_orders o
       JOIN commerce_payments p
         ON p.organization_id = o.organization_id AND p.order_id = o.id
         AND p.status = 'refunded'
       WHERE o.organization_id = $1
         AND o.created_at >= $2 AND o.created_at < $3
         AND o.status IN ('refunded', 'partially_refunded')
       GROUP BY o.created_by_user_id
     ),
     stats AS (
       SELECT AVG(refund_count) AS avg_count,
              STDDEV(refund_count) AS stddev_count
       FROM refund_counts
     )
     SELECT rc.created_by_user_id,
            rc.refund_count,
            rc.refunded_cents,
            s.avg_count,
            s.stddev_count
     FROM refund_counts rc
     CROSS JOIN stats s
     WHERE s.stddev_count > 0
       AND rc.refund_count > GREATEST(s.avg_count + 2 * s.stddev_count, 2)
     ORDER BY rc.refund_count DESC`,
    [organizationId, dateFrom, dateTo]
  );
  for (const row of refundResult.rows) {
    flagged.push({
      type: "high_refund_rate_by_cashier",
      details: "A cashier processed significantly more refunds than the organization average in the selected period.",
      observedValue: `${row.refund_count} refunds`,
      baselineValue: `Organization average: ${Number(row.avg_count).toFixed(1)} refunds`
    });
  }

  // Anomaly 2: drawer variance above threshold ($10.00)
  const varianceResult = await pool.query(
    `SELECT id, register_name, over_short_cents, opened_at, closed_at
     FROM commerce_cash_drawer_sessions
     WHERE organization_id = $1
       AND status = 'closed'
       AND closed_at >= $2 AND closed_at < $3
       AND ABS(over_short_cents) > 1000
     ORDER BY ABS(over_short_cents) DESC
     LIMIT 5`,
    [organizationId, dateFrom, dateTo]
  );
  for (const row of varianceResult.rows) {
    const sign = row.over_short_cents < 0 ? "short" : "over";
    flagged.push({
      type: "drawer_variance_exceeded",
      details: `Cash drawer for register "${row.register_name}" had a notable variance at close.`,
      observedValue: `$${(Math.abs(Number(row.over_short_cents)) / 100).toFixed(2)} ${sign}`,
      baselineValue: "Threshold: $10.00"
    });
  }

  // Anomaly 3: wallet top-ups significantly above org average (baseline uses full history)
  const topupResult = await pool.query(
    `WITH topup_stats AS (
       SELECT AVG(amount_cents) AS avg_topup,
              STDDEV(amount_cents) AS stddev_topup
       FROM commerce_wallet_transactions
       WHERE organization_id = $1
         AND type = 'top_up'
     )
     SELECT wt.amount_cents,
            wt.created_at,
            ts.avg_topup,
            ts.stddev_topup
     FROM commerce_wallet_transactions wt
     CROSS JOIN topup_stats ts
     WHERE wt.organization_id = $1
       AND wt.type = 'top_up'
       AND wt.created_at >= $2 AND wt.created_at < $3
       AND ts.stddev_topup > 0
       AND (wt.amount_cents - ts.avg_topup) > 2 * ts.stddev_topup
     ORDER BY wt.created_at DESC
     LIMIT 5`,
    [organizationId, dateFrom, dateTo]
  );
  if (topupResult.rowCount > 0) {
    flagged.push({
      type: "wallet_topup_outlier",
      details: `${topupResult.rowCount} wallet top-up(s) in the selected period were significantly above the organization's typical top-up amount.`,
      observedValue: `${topupResult.rowCount} outlier top-up(s)`,
      baselineValue: `Historical average: $${(Number(topupResult.rows[0].avg_topup) / 100).toFixed(2)}`
    });
  }

  // Anomaly 4: inventory drops not tied to sales
  const shrinkageResult = await pool.query(
    `SELECT p.name,
            SUM(m.quantity_delta) AS net_delta,
            COUNT(*) AS adjustment_count
     FROM commerce_inventory_movements m
     JOIN commerce_products p
       ON p.organization_id = m.organization_id AND p.id = m.product_id
     WHERE m.organization_id = $1
       AND m.created_at >= $2 AND m.created_at < $3
       AND m.type = 'adjustment'
       AND m.order_id IS NULL
       AND m.quantity_delta < 0
     GROUP BY m.product_id, p.name
     HAVING SUM(m.quantity_delta) < -10
     ORDER BY SUM(m.quantity_delta) ASC`,
    [organizationId, dateFrom, dateTo]
  );
  for (const row of shrinkageResult.rows) {
    flagged.push({
      type: "inventory_shrinkage",
      details: `Product "${row.name}" had manual inventory reductions not tied to any sale in the selected period.`,
      observedValue: `${Math.abs(Number(row.net_delta))} units removed (${row.adjustment_count} adjustment(s))`,
      baselineValue: "Not tied to any order"
    });
  }

  return flagged;
}

// ── Record CRUD ───────────────────────────────────────────────────────────────

export async function findExistingRecord(organizationId, sourceType, sourceRecordId) {
  const result = await pool.query(
    `SELECT id, status, output_json AS "outputJson"
     FROM commerce_ai_records
     WHERE organization_id = $1
       AND source_type = $2
       AND source_record_id = $3
       AND status NOT IN ('error', 'dismissed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, sourceType, sourceRecordId]
  );
  return result.rows[0] || null;
}

export async function findByInputHash(organizationId, sourceType, sourceRecordId, inputHash) {
  const result = await pool.query(
    `SELECT id, status, output_json AS "outputJson"
     FROM commerce_ai_records
     WHERE organization_id = $1
       AND source_type = $2
       AND source_record_id = $3
       AND input_hash = $4
       AND status NOT IN ('error', 'dismissed')
     LIMIT 1`,
    [organizationId, sourceType, sourceRecordId, inputHash]
  );
  return result.rows[0] || null;
}

export async function insertPendingRecord({ organizationId, storeId, sourceType, sourceRecordId, modelName }) {
  const result = await pool.query(
    `INSERT INTO commerce_ai_records
       (organization_id, store_id, source_type, source_record_id, model_name, input_hash, status)
     VALUES ($1, $2, $3, $4, $5, '', 'pending')
     RETURNING id`,
    [organizationId, storeId || null, sourceType, sourceRecordId || null, modelName]
  );
  return result.rows[0].id;
}

export async function updateInputSnapshot(organizationId, recordId, inputSnapshot, inputHash) {
  await pool.query(
    `UPDATE commerce_ai_records
     SET input_snapshot = $3, input_hash = $4, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, recordId, JSON.stringify(inputSnapshot), inputHash]
  );
}

export async function markDraft(organizationId, recordId, { outputJson, promptTokens, completionTokens, costMicrodollars }) {
  await pool.query(
    `UPDATE commerce_ai_records
     SET status = 'draft',
         output_json = $3,
         prompt_tokens = $4,
         completion_tokens = $5,
         cost_microdollars = $6,
         updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, recordId, JSON.stringify(outputJson), promptTokens, completionTokens, costMicrodollars ?? null]
  );
}

export async function markError(organizationId, recordId, errorMessage) {
  await pool.query(
    `UPDATE commerce_ai_records
     SET status = 'error', error_message = $3, updated_at = NOW()
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, recordId, errorMessage]
  );
}

export async function deletePendingRecord(organizationId, recordId) {
  await pool.query(
    `DELETE FROM commerce_ai_records
     WHERE organization_id = $1 AND id = $2 AND status = 'pending'`,
    [organizationId, recordId]
  );
}

export async function findById(organizationId, recordId) {
  const result = await pool.query(
    `SELECT id,
            organization_id AS "organizationId",
            store_id AS "storeId",
            source_type AS "sourceType",
            source_record_id AS "sourceRecordId",
            model_name AS "modelName",
            input_hash AS "inputHash",
            input_snapshot AS "inputSnapshot",
            output_json AS "outputJson",
            status,
            error_message AS "errorMessage",
            reviewed_by_user_id AS "reviewedByUserId",
            reviewed_at AS "reviewedAt",
            applied_at AS "appliedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM commerce_ai_records
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, recordId]
  );
  return result.rows[0] || null;
}

export async function listRecords({ organizationId, storeId, sourceType, status, limit = 25 }) {
  const values = [organizationId, sourceType];
  const clauses = ["organization_id = $1", "source_type = $2"];

  if (storeId) {
    values.push(storeId);
    clauses.push(`store_id = $${values.length}`);
  }
  if (status) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  values.push(limit);

  const result = await pool.query(
    `SELECT id,
            organization_id AS "organizationId",
            store_id AS "storeId",
            source_type AS "sourceType",
            source_record_id AS "sourceRecordId",
            model_name AS "modelName",
            status,
            output_json AS "outputJson",
            error_message AS "errorMessage",
            reviewed_by_user_id AS "reviewedByUserId",
            reviewed_at AS "reviewedAt",
            created_at AS "createdAt"
     FROM commerce_ai_records
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

export async function markReviewed(organizationId, recordId, reviewedByUserId) {
  const result = await pool.query(
    `UPDATE commerce_ai_records
     SET status = 'reviewed',
         reviewed_by_user_id = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
       AND status = 'draft'
     RETURNING id, status, reviewed_at AS "reviewedAt"`,
    [organizationId, recordId, reviewedByUserId]
  );
  return result.rows[0] || null;
}

export async function markDismissed(organizationId, recordId, reviewedByUserId) {
  const result = await pool.query(
    `UPDATE commerce_ai_records
     SET status = 'dismissed',
         reviewed_by_user_id = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
       AND status IN ('draft', 'pending')
     RETURNING id, status, reviewed_at AS "reviewedAt"`,
    [organizationId, recordId, reviewedByUserId]
  );
  return result.rows[0] || null;
}

// ── Usage summary ─────────────────────────────────────────────────────────────

export async function getUsageSummary({ organizationId, dateFrom, dateTo }) {
  const conditions = ["status = 'draft'"];
  const params = [];

  if (organizationId) {
    params.push(organizationId);
    conditions.push(`r.organization_id = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`r.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`r.created_at < $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT
       r.organization_id                              AS "organizationId",
       o.name                                         AS "organizationName",
       r.model_name                                   AS "modelName",
       r.source_type                                  AS "sourceType",
       COUNT(*)                                       AS "callCount",
       SUM(r.prompt_tokens)                           AS "promptTokens",
       SUM(r.completion_tokens)                       AS "completionTokens",
       SUM(r.cost_microdollars)                       AS "costMicrodollars",
       MIN(r.created_at)                              AS "firstCallAt",
       MAX(r.created_at)                              AS "lastCallAt"
     FROM commerce_ai_records r
     JOIN commerce_organizations o ON o.id = r.organization_id
     ${where}
     GROUP BY r.organization_id, o.name, r.model_name, r.source_type
     ORDER BY SUM(r.cost_microdollars) DESC NULLS LAST`,
    params
  );

  return result.rows;
}

// ── Reorder snapshot ──────────────────────────────────────────────────────────

export async function buildReorderInputSnapshot(organizationId, storeId) {
  const orgRow = await pool.query(
    `SELECT name FROM commerce_organizations WHERE id = $1`,
    [organizationId]
  );

  const params = [organizationId];
  const storeClause = storeId ? `AND ii.store_id = $${params.push(storeId)}` : "";

  const result = await pool.query(
    `WITH velocity AS (
       SELECT
         ii.organization_id,
         ii.store_id,
         ii.product_id,
         ii.quantity_on_hand,
         ii.reorder_threshold,
         COALESCE(
           ABS(SUM(im.quantity_delta) FILTER (
             WHERE im.type = 'sale' AND im.created_at >= NOW() - INTERVAL '30 days'
           )), 0
         ) AS units_sold_30d
       FROM commerce_inventory_items ii
       LEFT JOIN commerce_inventory_movements im
         ON im.product_id = ii.product_id
         AND im.organization_id = ii.organization_id
         AND im.store_id = ii.store_id
       WHERE ii.organization_id = $1
         AND ii.track_inventory = true
         ${storeClause}
       GROUP BY ii.organization_id, ii.store_id, ii.product_id,
                ii.quantity_on_hand, ii.reorder_threshold
     )
     SELECT
       v.product_id                              AS "productId",
       p.name                                    AS "productName",
       s.name                                    AS "storeName",
       v.quantity_on_hand                        AS "quantityOnHand",
       v.reorder_threshold                       AS "reorderThreshold",
       v.units_sold_30d                          AS "unitsSold30d",
       ROUND(v.units_sold_30d / 30.0, 2)         AS "avgDailySales",
       CASE
         WHEN v.units_sold_30d > 0
         THEN ROUND(v.quantity_on_hand / (v.units_sold_30d / 30.0))
         ELSE NULL
       END                                       AS "daysOfStockRemaining"
     FROM velocity v
     JOIN commerce_products p
       ON p.id = v.product_id AND p.organization_id = v.organization_id
     JOIN commerce_stores s
       ON s.id = v.store_id AND s.organization_id = v.organization_id
     WHERE p.active = true
       AND (
         v.quantity_on_hand <= v.reorder_threshold
         OR (
           v.units_sold_30d > 0
           AND v.quantity_on_hand / (v.units_sold_30d / 30.0) < 7
         )
       )
     ORDER BY
       CASE WHEN v.units_sold_30d > 0
         THEN v.quantity_on_hand / (v.units_sold_30d / 30.0)
         ELSE 999
       END ASC
     LIMIT 20`,
    params
  );

  return {
    organizationId,
    organizationName: orgRow.rows[0]?.name ?? organizationId,
    storeId: storeId ?? null,
    generatedAt: new Date().toISOString(),
    items: result.rows,
  };
}

// ── Forecast snapshot ─────────────────────────────────────────────────────────

export async function buildForecastInputSnapshot(organizationId, storeId, dateFrom, dateTo) {
  const params = [organizationId, dateFrom, dateTo];
  const storeClause = storeId ? `AND o.store_id = $${params.push(storeId)}` : "";

  const [orgRow, salesRows, storeRow] = await Promise.all([
    pool.query(`SELECT name FROM commerce_organizations WHERE id = $1`, [organizationId]),
    pool.query(
      `SELECT
         DATE(o.created_at)    AS date,
         COUNT(o.id)           AS "orderCount",
         SUM(o.total_cents)    AS "salesCents"
       FROM commerce_orders o
       WHERE o.organization_id = $1
         AND o.status = 'paid'
         AND o.created_at >= $2 AND o.created_at < $3
         ${storeClause}
       GROUP BY DATE(o.created_at)
       ORDER BY date`,
      params
    ),
    storeId
      ? pool.query(`SELECT name FROM commerce_stores WHERE id = $1`, [storeId])
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    organizationId,
    organizationName: orgRow.rows[0]?.name ?? organizationId,
    storeName: storeRow.rows[0]?.name ?? null,
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    dailySales: salesRows.rows.map((r) => ({
      date: String(r.date).slice(0, 10),
      orderCount: Number(r.orderCount),
      salesCents: Number(r.salesCents),
    })),
  };
}

// ── Guardian digest snapshot ──────────────────────────────────────────────────

export async function getGuardiansForDigest(organizationId) {
  const result = await pool.query(
    `SELECT id, name, email,
            notification_prefs->>'email_on_purchase' AS email_on_purchase
     FROM commerce_guardians
     WHERE organization_id = $1
       AND active = true
       AND (notification_prefs->>'email_on_purchase')::boolean = true`,
    [organizationId]
  );
  return result.rows;
}

export async function buildGuardianDigestSnapshot(organizationId, guardianId, guardianName, orgName, dateFrom, dateTo) {
  const studentsResult = await pool.query(
    `SELECT
       c.id                              AS "studentId",
       c.name                            AS "studentName",
       wa.balance_cents                  AS "balanceCents",
       COALESCE(
         SUM(wt.amount_cents) FILTER (
           WHERE wt.type = 'sale'
             AND wt.created_at >= $3 AND wt.created_at < $4
         ), 0
       )                                 AS "spentCents",
       COUNT(DISTINCT o.id) FILTER (
         WHERE wt.type = 'sale'
           AND wt.created_at >= $3 AND wt.created_at < $4
       )                                 AS "transactionCount"
     FROM commerce_guardian_students gs
     JOIN commerce_customers c
       ON c.id = gs.student_id
     JOIN commerce_wallet_accounts wa
       ON wa.customer_id = c.id AND wa.organization_id = c.organization_id
     LEFT JOIN commerce_wallet_transactions wt
       ON wt.wallet_account_id = wa.id
       AND wt.organization_id = wa.organization_id
     LEFT JOIN commerce_orders o
       ON o.id = wt.order_id
     WHERE gs.guardian_id = $1
       AND gs.organization_id = $2
     GROUP BY c.id, c.name, wa.balance_cents`,
    [guardianId, organizationId, dateFrom, dateTo]
  );

  const students = await Promise.all(
    studentsResult.rows.map(async (s) => {
      const topItems = await pool.query(
        `SELECT oi.name_snapshot AS name, SUM(oi.quantity) AS qty
         FROM commerce_order_items oi
         JOIN commerce_orders o ON o.id = oi.order_id
         JOIN commerce_wallet_transactions wt ON wt.order_id = o.id
         JOIN commerce_wallet_accounts wa ON wa.id = wt.wallet_account_id
         WHERE wa.customer_id = $1
           AND wa.organization_id = $2
           AND wt.type = 'sale'
           AND wt.created_at >= $3 AND wt.created_at < $4
         GROUP BY oi.name_snapshot
         ORDER BY SUM(oi.quantity) DESC
         LIMIT 3`,
        [s.studentId, organizationId, dateFrom, dateTo]
      );
      return {
        ...s,
        spentCents: Number(s.spentCents),
        balanceCents: Number(s.balanceCents),
        transactionCount: Number(s.transactionCount),
        topItems: topItems.rows.map((r) => ({ name: r.name, qty: Number(r.qty) })),
      };
    })
  );

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const weekLabel = `${from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return { guardianId, guardianName, orgName, dateFrom, dateTo, weekLabel, students };
}
