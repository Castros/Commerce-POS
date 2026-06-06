import { Router } from "express";
import { z } from "zod";

import { pool } from "../../db/client.js";
import { withTransaction } from "../../db/transaction.js";
import { requirePermission } from "../../shared/auth/auth.js";
import { badRequest, asyncHandler, parseZod } from "../../shared/http/errors.js";

export const studentAppRouter = Router();

const defaultExternalSchoolId = "11111111-1111-4111-8111-111111111111";

const studentSearchSchema = z.object({
  q: z.string().trim().min(1),
  externalSchoolId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional()
});

const linkedStudentSchema = z.object({
  externalSchoolId: z.string().uuid().default(defaultExternalSchoolId),
  externalStudentId: z.string().uuid(),
  externalParentId: z.string().uuid().nullable().optional(),
  externalId: z.string().nullable().optional(),
  name: z.string().min(1).default("Linked Student"),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  startingBalanceCents: z.number().int().min(0).default(0),
  creditLimitCents: z.number().int().min(0).default(2500)
});

function centsToAmount(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function spellingAppBaseUrl() {
  return (process.env.SPELLING_APP_API_URL || "http://host.docker.internal:4000").replace(/\/$/, "");
}

function spellingAppServiceToken() {
  return process.env.SPELLING_APP_SERVICE_TOKEN || "";
}

async function searchSpellingAppStudents(query) {
  const token = spellingAppServiceToken();
  if (!token) {
    throw badRequest("SPELLING_APP_SERVICE_TOKEN is not configured");
  }

  const params = new URLSearchParams({ q: query.q });
  const schoolId = query.schoolId || query.externalSchoolId;
  if (schoolId) {
    params.set("school_id", schoolId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${spellingAppBaseUrl()}/service/students?${params}`, {
      headers: {
        authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch (_err) {
      payload = {};
    }

    if (!response.ok) {
      throw badRequest(payload.error || "Student app search failed");
    }

    return (payload.data || []).map((student) => ({
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      name: [student.first_name, student.last_name].filter(Boolean).join(" "),
      externalId: student.external_id,
      preferredGrade: student.preferred_grade,
      schoolEmail: student.school_email,
      schoolId: student.school_id,
      classroom: student.classroom
    }));
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureLinkedStudent(client, body) {
  const organization =
    (
      await client.query(
        `
          SELECT id, name, type, external_school_id AS "externalSchoolId"
          FROM commerce_organizations
          WHERE external_school_id = $1
          LIMIT 1
        `,
        [body.externalSchoolId]
      )
    ).rows[0] ||
    (
    await client.query(
      `
        INSERT INTO commerce_organizations (name, type, external_school_id)
        VALUES ('Connected School', 'school', $1)
        RETURNING id, name, type, external_school_id AS "externalSchoolId"
      `,
      [body.externalSchoolId]
    )
    ).rows[0];

  const store = (
    await client.query(
      `
        SELECT id, organization_id AS "organizationId", name, type
        FROM commerce_stores
        WHERE organization_id = $1
          AND type = 'cafeteria'
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [organization.id]
    )
  ).rows[0] ||
    (
      await client.query(
        `
          INSERT INTO commerce_stores (organization_id, name, type, external_school_id)
          VALUES ($1, 'Cafeteria', 'cafeteria', $2)
          RETURNING id, organization_id AS "organizationId", name, type
        `,
        [organization.id, body.externalSchoolId]
      )
    ).rows[0];

  // 1. Try exact UUID match (returning customer or already-linked record)
  let customer = (
    await client.query(
      `SELECT id, organization_id AS "organizationId",
              external_student_id AS "externalStudentId",
              external_parent_id AS "externalParentId",
              external_id AS "externalId",
              name, email, phone, active, created_at AS "createdAt"
         FROM commerce_customers
        WHERE organization_id = $1 AND external_student_id = $2
        LIMIT 1`,
      [organization.id, body.externalStudentId]
    )
  ).rows[0];

  // 2. If not found by UUID, try matching by matricula (external_id).
  //    This links a standalone POS customer to the Spelling App student automatically.
  if (!customer && body.externalId) {
    const byMatricula = (
      await client.query(
        `SELECT id, organization_id AS "organizationId",
                external_student_id AS "externalStudentId",
                external_parent_id AS "externalParentId",
                external_id AS "externalId",
                name, email, phone, active, created_at AS "createdAt"
           FROM commerce_customers
          WHERE organization_id = $1 AND external_id = $2
          LIMIT 1`,
        [organization.id, body.externalId]
      )
    ).rows[0];

    if (byMatricula) {
      // Found a standalone customer — stamp the Spelling App UUID onto them
      customer = (
        await client.query(
          `UPDATE commerce_customers
              SET external_student_id = $3,
                  name = COALESCE(NULLIF(name, ''), $4)
            WHERE id = $1 AND organization_id = $2
            RETURNING id, organization_id AS "organizationId",
                      external_student_id AS "externalStudentId",
                      external_parent_id AS "externalParentId",
                      external_id AS "externalId",
                      name, email, phone, active, created_at AS "createdAt"`,
          [byMatricula.id, organization.id, body.externalStudentId, body.name]
        )
      ).rows[0];
    }
  }

  // 3. Create new customer with both UUIDs and matricula
  if (!customer) {
    customer = (
      await client.query(
        `INSERT INTO commerce_customers (
            organization_id, external_student_id, external_parent_id,
            external_id, name, email, phone
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, organization_id AS "organizationId",
                    external_student_id AS "externalStudentId",
                    external_parent_id AS "externalParentId",
                    external_id AS "externalId",
                    name, email, phone, active, created_at AS "createdAt"`,
        [
          organization.id,
          body.externalStudentId,
          body.externalParentId || null,
          body.externalId || null,
          body.name,
          body.email || null,
          body.phone || null
        ]
      )
    ).rows[0];
  }

  const wallet = (
    await client.query(
      `
        INSERT INTO commerce_wallet_accounts (organization_id, customer_id)
        VALUES ($1, $2)
        ON CONFLICT (organization_id, customer_id, currency)
        DO UPDATE SET active = commerce_wallet_accounts.active
        RETURNING id, organization_id AS "organizationId", customer_id AS "customerId",
                  balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents",
                  currency, active, updated_at AS "updatedAt"
      `,
      [organization.id, customer.id]
    )
  ).rows[0];

  if (body.creditLimitCents > Number(wallet.creditLimitCents || 0)) {
    const updatedWallet = (
      await client.query(
        `
          UPDATE commerce_wallet_accounts
          SET credit_limit_cents = $3,
              updated_at = NOW()
          WHERE organization_id = $1
            AND id = $2
          RETURNING id, organization_id AS "organizationId", customer_id AS "customerId",
                    balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents",
                    currency, active, updated_at AS "updatedAt"
        `,
        [organization.id, wallet.id, body.creditLimitCents]
      )
    ).rows[0];

    Object.assign(wallet, updatedWallet);
  }

  if (body.startingBalanceCents > 0 && Number(wallet.balanceCents) === 0) {
    await client.query(
      `
        UPDATE commerce_wallet_accounts
        SET balance_cents = $3,
            updated_at = NOW()
        WHERE organization_id = $1
          AND id = $2
      `,
      [organization.id, wallet.id, body.startingBalanceCents]
    );

    await client.query(
      `
        INSERT INTO commerce_wallet_transactions (
          organization_id,
          wallet_account_id,
          type,
          amount_cents,
          balance_after_cents,
          source,
          note
        )
        VALUES ($1, $2, 'top_up', $3, $3, 'student_app_sync', 'Starting balance from student app link')
      `,
      [organization.id, wallet.id, body.startingBalanceCents]
    );

    wallet.balanceCents = body.startingBalanceCents;
  }

  return { organization, store, customer, wallet };
}

async function loadTransactions(client, organizationId, walletId) {
  const result = await client.query(
    `
      SELECT t.id,
             t.order_id AS "orderId",
             t.type,
             t.amount_cents AS "amountCents",
             t.balance_after_cents AS "balanceAfterCents",
             t.source,
             t.note,
             t.created_at AS "createdAt",
             oi.name_snapshot AS "itemName"
      FROM commerce_wallet_transactions t
      LEFT JOIN commerce_order_items oi
        ON oi.organization_id = t.organization_id
       AND oi.order_id = t.order_id
      WHERE t.organization_id = $1
        AND t.wallet_account_id = $2
      ORDER BY t.created_at DESC
      LIMIT 20
    `,
    [organizationId, walletId]
  );

  return result.rows;
}

studentAppRouter.get(
  "/students/search",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const query = parseZod(studentSearchSchema, req.query);
    const students = await searchSpellingAppStudents(query);
    res.json({ data: students });
  })
);

studentAppRouter.post(
  "/students",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const body = parseZod(linkedStudentSchema, req.body);

    const data = await withTransaction(async (client) => {
      const linked = await ensureLinkedStudent(client, body);
      const transactions = await loadTransactions(
        client,
        linked.organization.id,
        linked.wallet.id
      );

      return {
        ...linked,
        cafeteria: {
          balance: centsToAmount(linked.wallet.balanceCents),
          recent_transactions: transactions.map((transaction) => ({
            type: transaction.type,
            amount: centsToAmount(Math.abs(Number(transaction.amountCents))),
            item_name: transaction.itemName || transaction.note,
            item_emoji: transaction.type === "purchase" ? "🍽️" : "💳",
            created_at: transaction.createdAt
          }))
        }
      };
    });

    res.status(201).json({ data });
  })
);

// POST /integrations/student-app/reconcile
// Bulk-links standalone POS customers to Spelling App students by matching matricula (external_id).
// Call this once after a school connects the Spelling App to an existing POS setup.
studentAppRouter.post(
  "/reconcile",
  requirePermission("customers:write"),
  asyncHandler(async (req, res) => {
    const { externalSchoolId = defaultExternalSchoolId } = req.body;

    // Find all POS customers for this school that have a matricula but no Spelling App link yet
    const unlinked = (
      await pool.query(
        `SELECT c.id, c.external_id AS "externalId"
           FROM commerce_customers c
           JOIN commerce_organizations o ON o.id = c.organization_id
          WHERE o.external_school_id = $1
            AND c.external_id IS NOT NULL
            AND c.external_student_id IS NULL`,
        [externalSchoolId]
      )
    ).rows;

    const results = { linked: 0, notFound: 0, errors: 0 };

    for (const customer of unlinked) {
      try {
        const students = await searchSpellingAppStudents({ q: customer.externalId });
        // Only link if we get an exact matricula match
        const match = students.find((s) => s.externalId === customer.externalId);
        if (match) {
          await pool.query(
            `UPDATE commerce_customers
                SET external_student_id = $2
              WHERE id = $1 AND external_student_id IS NULL`,
            [customer.id, match.id]
          );
          results.linked++;
        } else {
          results.notFound++;
        }
      } catch {
        results.errors++;
      }
    }

    res.json({ data: { ...results, total: unlinked.length } });
  })
);

studentAppRouter.get(
  "/students/:externalStudentId/cafeteria",
  asyncHandler(async (req, res) => {
    const query = parseZod(
      z.object({
        externalSchoolId: z.string().uuid().default(defaultExternalSchoolId)
      }),
      req.query
    );

    const result = await pool.query(
      `
        SELECT o.id AS "organizationId",
               c.id AS "customerId",
               c.avatar_public_id AS "avatarPublicId",
               w.id AS "walletId",
               w.balance_cents AS "balanceCents",
               w.credit_limit_cents AS "creditLimitCents"
        FROM commerce_organizations o
        JOIN commerce_customers c
          ON c.organization_id = o.id
         AND c.external_student_id = $2
        JOIN commerce_wallet_accounts w
          ON w.organization_id = o.id
         AND w.customer_id = c.id
        WHERE o.external_school_id = $1
        LIMIT 1
      `,
      [query.externalSchoolId, req.params.externalStudentId]
    );

    const row = result.rows[0];
    if (!row) {
      res.json({ data: { balance: "0.00", recent_transactions: [] } });
      return;
    }

    const transactions = await loadTransactions(pool, row.organizationId, row.walletId);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const avatarUrl = row.avatarPublicId && cloudName
      ? `https://res.cloudinary.com/${cloudName}/image/upload/w_120,h_120,c_fill,r_max,f_auto,q_auto/${row.avatarPublicId}`
      : null;

    res.json({
      data: {
        balance: centsToAmount(row.balanceCents),
        credit_limit: centsToAmount(row.creditLimitCents),
        amount_owed: centsToAmount(Math.max(0, -Number(row.balanceCents))),
        avatar_url: avatarUrl,
        recent_transactions: transactions.map((transaction) => ({
          type: transaction.type,
          amount: centsToAmount(Math.abs(Number(transaction.amountCents))),
          item_name: transaction.itemName || transaction.note,
          item_emoji: transaction.type === "purchase" ? "🍽️" : "💳",
          created_at: transaction.createdAt
        }))
      }
    });
  })
);
