import { Router } from "express";

import { withTransaction } from "../../db/transaction.js";
import { requirePermission } from "../../shared/auth/auth.js";
import { asyncHandler, forbidden } from "../../shared/http/errors.js";
import { hashPin } from "../../shared/auth/browserAuth.js";

export const demoRouter = Router();

const demoExternalSchoolId = "11111111-1111-4111-8111-111111111111";

const demoProducts = [
  {
    name: "Lunch Combo",
    sku: "DEMO-LUNCH-COMBO",
    description: "Entree, fruit, and milk",
    priceCents: 550,
    taxable: false,
    imageUrl: "/product-images/lunch-combo.svg",
    quantityOnHand: 148,
    reorderThreshold: 25,
    location: "Walk-in cooler"
  },
  {
    name: "Breakfast Plate",
    sku: "DEMO-BREAKFAST",
    description: "Morning meal service",
    priceCents: 325,
    taxable: false,
    imageUrl: "/product-images/breakfast-plate.svg",
    quantityOnHand: 81,
    reorderThreshold: 20,
    location: "Serving line"
  },
  {
    name: "Water Bottle",
    sku: "DEMO-WATER",
    description: "Campus store bottled water",
    priceCents: 150,
    taxable: false,
    imageUrl: "/product-images/water-bottle.svg",
    quantityOnHand: 34,
    reorderThreshold: 60,
    location: "Cold case"
  },
  {
    name: "Uniform Polo",
    sku: "DEMO-UNIFORM-POLO",
    description: "Short sleeve school uniform polo",
    priceCents: 1800,
    taxable: true,
    imageUrl: "/product-images/uniform-polo.svg",
    quantityOnHand: 9,
    reorderThreshold: 20,
    location: "Campus store"
  },
  {
    name: "Workbook Pack",
    sku: "DEMO-WORKBOOK-PACK",
    description: "Grade-level workbook bundle",
    priceCents: 1275,
    taxable: false,
    imageUrl: "/product-images/workbook-pack.svg",
    quantityOnHand: 64,
    reorderThreshold: 15,
    location: "Book room"
  },
  {
    name: "Field Trip Ticket",
    sku: "DEMO-FIELD-TRIP",
    description: "Student event admission",
    priceCents: 800,
    taxable: false,
    imageUrl: "/product-images/field-trip-ticket.svg",
    quantityOnHand: 18,
    reorderThreshold: 25,
    location: "Digital"
  }
];

const demoStudents = [
  {
    externalStudentId: "22222222-2222-4222-8222-222222222221",
    externalParentId: "33333333-3333-4333-8333-333333333331",
    name: "Maya Johnson",
    email: "parent.maya@example.test",
    phone: "555-0101",
    familyCode: "FAM-001",
    targetBalanceCents: 2500
  },
  {
    externalStudentId: "22222222-2222-4222-8222-222222222222",
    externalParentId: "33333333-3333-4333-8333-333333333332",
    name: "Ethan Smith",
    email: "parent.ethan@example.test",
    phone: "555-0102",
    familyCode: "FAM-002",
    targetBalanceCents: 1500
  },
  {
    externalStudentId: "22222222-2222-4222-8222-222222222223",
    externalParentId: "33333333-3333-4333-8333-333333333333",
    name: "Sophia Chen",
    email: "parent.sophia@example.test",
    phone: "555-0103",
    familyCode: "FAM-003",
    targetBalanceCents: 3000
  }
];

const demoStaff = [
  { name: "Demo Admin",     email: "admin@demo.test",   role: "organization_admin", pin: "0000" },
  { name: "Maria Lopez",    email: "manager@demo.test", role: "store_manager",      pin: "1111" },
  { name: "Carlos Rivera",  email: "cashier@demo.test", role: "cashier",            pin: "2222" }
];

const demoGuardians = [
  { name: "Sarah Johnson",   email: "parent.maya@example.test",   phone: "555-0101", familyCode: "FAM-001" },
  { name: "David Smith",     email: "parent.ethan@example.test",  phone: "555-0102", familyCode: "FAM-002" },
  { name: "Mei-Ling Chen",   email: "parent.sophia@example.test", phone: "555-0103", familyCode: "FAM-003" }
];

async function findOrCreateOrganization(client) {
  const existing = await client.query(
    `
      SELECT id, name, type, external_school_id AS "externalSchoolId", active, created_at AS "createdAt"
      FROM commerce_organizations
      WHERE external_school_id = $1
      LIMIT 1
    `,
    [demoExternalSchoolId]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await client.query(
    `
      INSERT INTO commerce_organizations (name, type, external_school_id)
      VALUES ('Demo Academy', 'school', $1)
      RETURNING id, name, type, external_school_id AS "externalSchoolId", active, created_at AS "createdAt"
    `,
    [demoExternalSchoolId]
  );

  return created.rows[0];
}

async function findOrCreateStore(client, organizationId) {
  const existing = await client.query(
    `
      SELECT id, organization_id AS "organizationId", name, type, active, created_at AS "createdAt"
      FROM commerce_stores
      WHERE organization_id = $1
        AND name = 'Cafeteria'
      LIMIT 1
    `,
    [organizationId]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await client.query(
    `
      INSERT INTO commerce_stores (organization_id, name, type, external_school_id)
      VALUES ($1, 'Cafeteria', 'cafeteria', $2)
      RETURNING id, organization_id AS "organizationId", name, type, active, created_at AS "createdAt"
    `,
    [organizationId, demoExternalSchoolId]
  );

  return created.rows[0];
}

async function findOrCreateProducts(client, organizationId, storeId) {
  const products = [];

  for (const product of demoProducts) {
    const existing = await client.query(
      `
        SELECT p.id, p.organization_id AS "organizationId", p.store_id AS "storeId",
               p.name, p.description, p.sku, p.image_url AS "imageUrl",
               p.price_cents AS "priceCents",
               p.currency, p.taxable, p.active, p.created_at AS "createdAt",
               COALESCE(i.quantity_on_hand, 0) AS "quantityOnHand",
               COALESCE(i.reorder_threshold, 0) AS "reorderThreshold",
               i.location,
               CASE
                 WHEN i.id IS NULL THEN 'not_tracked'
                 WHEN i.quantity_on_hand = 0 THEN 'out'
                 WHEN i.quantity_on_hand <= i.reorder_threshold THEN 'low'
                 ELSE 'in_stock'
               END AS "inventoryStatus"
        FROM commerce_products p
        LEFT JOIN commerce_inventory_items i
          ON i.organization_id = p.organization_id
         AND i.store_id = $3
         AND i.product_id = p.id
        WHERE p.organization_id = $1
          AND p.sku = $2
        LIMIT 1
      `,
      [organizationId, product.sku, storeId]
    );

    if (existing.rows[0]) {
      const updated = await client.query(
        `
          UPDATE commerce_products
          SET image_url = $3
          WHERE organization_id = $1
            AND id = $2
          RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                    name, description, sku, image_url AS "imageUrl",
                    price_cents AS "priceCents", currency, taxable, active, created_at AS "createdAt"
        `,
        [organizationId, existing.rows[0].id, product.imageUrl]
      );
      products.push({ ...existing.rows[0], ...updated.rows[0] });
      continue;
    }

    const created = await client.query(
      `
        INSERT INTO commerce_products (
          organization_id,
          store_id,
          name,
          description,
          sku,
          image_url,
          price_cents,
          taxable
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, organization_id AS "organizationId", store_id AS "storeId",
                  name, description, sku, image_url AS "imageUrl", price_cents AS "priceCents",
                  currency, taxable, active, created_at AS "createdAt"
      `,
      [
        organizationId,
        storeId,
        product.name,
        product.description,
        product.sku,
        product.imageUrl,
        product.priceCents,
        product.taxable
      ]
    );
    products.push(created.rows[0]);
  }

  return seedProductInventory(client, organizationId, storeId, products);
}

async function seedProductInventory(client, organizationId, storeId, products) {
  const productsBySku = new Map(products.map((product) => [product.sku, product]));
  const seeded = [];

  for (const demoProduct of demoProducts) {
    const product = productsBySku.get(demoProduct.sku);
    if (!product) continue;

    const inventory = (
      await client.query(
        `
          INSERT INTO commerce_inventory_items (
            organization_id,
            store_id,
            product_id,
            quantity_on_hand,
            reorder_threshold,
            location
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (organization_id, store_id, product_id)
          DO UPDATE SET reorder_threshold = EXCLUDED.reorder_threshold,
                        location = EXCLUDED.location
          RETURNING quantity_on_hand AS "quantityOnHand",
                    reorder_threshold AS "reorderThreshold",
                    location,
                    CASE
                      WHEN quantity_on_hand = 0 THEN 'out'
                      WHEN quantity_on_hand <= reorder_threshold THEN 'low'
                      ELSE 'in_stock'
                    END AS "inventoryStatus"
        `,
        [
          organizationId,
          storeId,
          product.id,
          demoProduct.quantityOnHand,
          demoProduct.reorderThreshold,
          demoProduct.location
        ]
      )
    ).rows[0];

    seeded.push({
      ...product,
      ...inventory
    });
  }

  return seeded;
}

async function findOrCreateStaff(client, organizationId, storeId) {
  const created = [];
  for (const member of demoStaff) {
    const existing = await client.query(
      `SELECT id FROM commerce_users WHERE organization_id = $1 AND email = $2 LIMIT 1`,
      [organizationId, member.email]
    );
    if (existing.rows[0]) { created.push(existing.rows[0]); continue; }

    const { salt, hash } = await hashPin(member.pin);
    const pinLast4 = member.pin.slice(-4);
    const user = await client.query(
      `INSERT INTO commerce_users
         (organization_id, name, email, role, pin_hash, pin_salt, pin_last4, pin_set_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [organizationId, member.name, member.email, member.role, hash, salt, pinLast4]
    );
    if (storeId && member.role !== "organization_admin") {
      await client.query(
        `INSERT INTO commerce_user_store_assignments (organization_id, user_id, store_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [organizationId, user.rows[0].id, storeId]
      );
    }
    created.push(user.rows[0]);
  }
  return created;
}

async function findOrCreateGuardians(client, organizationId) {
  for (const guardian of demoGuardians) {
    const g = await client.query(
      `INSERT INTO commerce_guardians (organization_id, name, email, phone, family_code)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, email) DO UPDATE
         SET family_code = COALESCE(EXCLUDED.family_code, commerce_guardians.family_code)
       RETURNING id`,
      [organizationId, guardian.name, guardian.email, guardian.phone, guardian.familyCode]
    );
    // Link students sharing the same family_code
    await client.query(
      `INSERT INTO commerce_guardian_students (guardian_id, student_id, organization_id, relationship)
       SELECT $1, c.id, $2, 'guardian'
       FROM commerce_customers c
       WHERE c.organization_id = $2 AND c.family_code = $3
       ON CONFLICT (guardian_id, student_id) DO NOTHING`,
      [g.rows[0].id, organizationId, guardian.familyCode]
    );
  }
}

async function findOrCreateStudents(client, organizationId) {
  const students = [];

  for (const student of demoStudents) {
    const existingCustomer = await client.query(
      `
        SELECT id, organization_id AS "organizationId",
               external_student_id AS "externalStudentId",
               external_parent_id AS "externalParentId",
               name, email, phone, active, created_at AS "createdAt"
        FROM commerce_customers
        WHERE organization_id = $1
          AND external_student_id = $2
        LIMIT 1
      `,
      [organizationId, student.externalStudentId]
    );

    const customer =
      existingCustomer.rows[0] ||
      (
        await client.query(
          `
            INSERT INTO commerce_customers (
              organization_id,
              external_student_id,
              external_parent_id,
              name,
              email,
              phone,
              family_code
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, organization_id AS "organizationId",
                      external_student_id AS "externalStudentId",
                      external_parent_id AS "externalParentId",
                      name, email, phone, active, created_at AS "createdAt"
          `,
          [
            organizationId,
            student.externalStudentId,
            student.externalParentId,
            student.name,
            student.email,
            student.phone,
            student.familyCode
          ]
        )
      ).rows[0];

    // Ensure family_code is set on existing rows
    if (existingCustomer.rows[0] && student.familyCode) {
      await client.query(
        `UPDATE commerce_customers SET family_code = $1
         WHERE id = $2 AND family_code IS NULL`,
        [student.familyCode, customer.id]
      );
    }

    const wallet = (
      await client.query(
        `
          INSERT INTO commerce_wallet_accounts (organization_id, customer_id)
          VALUES ($1, $2)
          ON CONFLICT (organization_id, customer_id, currency)
          DO UPDATE SET active = commerce_wallet_accounts.active
          RETURNING id, organization_id AS "organizationId", customer_id AS "customerId",
                    balance_cents AS "balanceCents", currency, active, updated_at AS "updatedAt"
        `,
        [organizationId, customer.id]
      )
    ).rows[0];

    if (Number(wallet.balanceCents) < student.targetBalanceCents) {
      const topUpAmount = student.targetBalanceCents - Number(wallet.balanceCents);
      const balanceAfter = student.targetBalanceCents;

      await client.query(
        `
          UPDATE commerce_wallet_accounts
          SET balance_cents = $3,
              updated_at = NOW()
          WHERE organization_id = $1
            AND id = $2
        `,
        [organizationId, wallet.id, balanceAfter]
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
          VALUES ($1, $2, 'top_up', $3, $4, 'demo_seed', 'Demo starting balance')
        `,
        [organizationId, wallet.id, topUpAmount, balanceAfter]
      );

      wallet.balanceCents = balanceAfter;
    }

    students.push({
      ...customer,
      wallet: {
        ...wallet,
        balanceCents: Number(wallet.balanceCents)
      }
    });
  }

  return students;
}

async function loadDemoData() {
  if (process.env.DISABLE_DEMO_SEED === "true") {
    throw forbidden("Demo seed endpoints are disabled in this environment");
  }

  return withTransaction(async (client) => {
    const organization = await findOrCreateOrganization(client);
    const store = await findOrCreateStore(client, organization.id);
    const products = await findOrCreateProducts(client, organization.id, store.id);
    const students = await findOrCreateStudents(client, organization.id);
    const staff = await findOrCreateStaff(client, organization.id, store.id);
    await findOrCreateGuardians(client, organization.id);

    return {
      organization,
      store,
      products,
      students,
      staffCount: staff.length
    };
  });
}

demoRouter.get(
  "/school",
  asyncHandler(async (_req, res) => {
    const data = await loadDemoData();
    res.json({ data });
  })
);

demoRouter.post(
  "/school",
  requirePermission("organizations:write"),
  asyncHandler(async (_req, res) => {
    const data = await loadDemoData();
    res.status(201).json({ data });
  })
);
