import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.js";
import { runMigrations } from "../src/db/migrate.js";
import { pool } from "../src/db/client.js";

let server;
let baseUrl;

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request(path, {
  method = "GET",
  body,
  headers = {}
} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json();
  return { response, payload };
}

async function post(path, body, headers = {}) {
  const { response, payload } = await request(path, {
    method: "POST",
    body,
    headers
  });

  assert.ok(response.ok, `${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload.data;
}

async function createSaleFixture() {
  const org = await post("/v1/organizations", {
    name: unique("Test School"),
    type: "school"
  });
  const store = await post("/v1/stores", {
    organizationId: org.id,
    name: "Cafeteria",
    type: "cafeteria"
  });
  const product = await post("/v1/products", {
    organizationId: org.id,
    storeId: store.id,
    name: "Lunch Combo",
    sku: unique("LUNCH"),
    priceCents: 550
  });
  const customer = await post("/v1/customers", {
    organizationId: org.id,
    name: "Test Student"
  });
  const wallet = await post("/v1/wallets", {
    organizationId: org.id,
    customerId: customer.id
  });

  return { org, store, product, customer, wallet };
}

async function stockProduct({ org, store, product, quantity }) {
  return post(`/v1/inventory/${product.id}/adjustments`, {
    organizationId: org.id,
    storeId: store.id,
    quantityDelta: quantity,
    note: "Test stock"
  });
}

async function openDrawer({ org, store, openingCashCents = 10000 }) {
  return post("/v1/cash-drawers/open", {
    organizationId: org.id,
    storeId: store.id,
    registerName: "Lunch Line 02",
    openingCashCents,
    note: "Test open"
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  await runMigrations();
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

describe("wallet sale", () => {
  it("rejects unauthenticated writes when dev auth is disabled", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowDevAuth = process.env.ALLOW_DEV_AUTH;
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DEV_AUTH;

    try {
      const { response, payload } = await request("/v1/organizations", {
        method: "POST",
        body: { name: "No Auth", type: "school" }
      });

      assert.equal(response.status, 401);
      assert.equal(payload.error, "Authentication required");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalAllowDevAuth) {
        process.env.ALLOW_DEV_AUTH = originalAllowDevAuth;
      }
    }
  });

  it("creates an atomic wallet sale and receipt", async () => {
    const { org, store, product, customer, wallet } = await createSaleFixture();
    await stockProduct({ org, store, product, quantity: 5 });
    await post(`/v1/wallets/${wallet.id}/topups`, {
      organizationId: org.id,
      amountCents: 1000,
      note: "Test top up"
    });

    const sale = await post(
      "/v1/orders/wallet-sale",
      {
        organizationId: org.id,
        storeId: store.id,
        customerId: customer.id,
        walletAccountId: wallet.id,
        items: [{ productId: product.id, quantity: 1 }]
      },
      { "Idempotency-Key": unique("sale") }
    );

    assert.equal(sale.order.totalCents, 550);
    assert.equal(sale.order.status, "paid");
    assert.equal(sale.payment.status, "succeeded");
    assert.equal(sale.wallet.balanceCents, 450);
    assert.equal(sale.inventory[0].quantityAfter, 4);
  });

  it("replays the same idempotency response without charging twice", async () => {
    const { org, store, product, customer, wallet } = await createSaleFixture();
    await stockProduct({ org, store, product, quantity: 5 });
    await post(`/v1/wallets/${wallet.id}/topups`, {
      organizationId: org.id,
      amountCents: 1000,
      note: "Test top up"
    });

    const body = {
      organizationId: org.id,
      storeId: store.id,
      customerId: customer.id,
      walletAccountId: wallet.id,
      items: [{ productId: product.id, quantity: 1 }]
    };
    const key = unique("idempotent-sale");

    const first = await post("/v1/orders/wallet-sale", body, {
      "Idempotency-Key": key
    });
    const second = await post("/v1/orders/wallet-sale", body, {
      "Idempotency-Key": key
    });

    assert.equal(second.order.id, first.order.id);
    assert.equal(second.wallet.balanceCents, first.wallet.balanceCents);

    const inventory = await request(`/v1/inventory?organizationId=${org.id}&storeId=${store.id}`);
    assert.equal(inventory.payload.data[0].quantityOnHand, 4);
  });

  it("decrements inventory for a paid cash sale", async () => {
    const { org, store, product } = await createSaleFixture();
    await stockProduct({ org, store, product, quantity: 3 });
    const drawer = await openDrawer({ org, store });

    const sale = await post(
      "/v1/orders/paid-sale",
      {
        organizationId: org.id,
        storeId: store.id,
        paymentMethod: "cash",
        registerName: "Lunch Line 02",
        items: [{ productId: product.id, quantity: 2 }]
      },
      { "Idempotency-Key": unique("cash-sale") }
    );

    assert.equal(sale.payment.method, "cash");
    assert.equal(sale.inventory[0].quantityDelta, -2);
    assert.equal(sale.inventory[0].quantityAfter, 1);
    assert.equal(sale.cashDrawer.id, drawer.id);
    assert.equal(sale.cashDrawer.expectedCashCents, 11100);
  });

  it("rejects sales that exceed tracked inventory", async () => {
    const { org, store, product } = await createSaleFixture();
    await stockProduct({ org, store, product, quantity: 1 });

    const { response, payload } = await request("/v1/orders/paid-sale", {
      method: "POST",
      headers: { "Idempotency-Key": unique("stock-short") },
      body: {
        organizationId: org.id,
        storeId: store.id,
        paymentMethod: "cash",
        items: [{ productId: product.id, quantity: 2 }]
      }
    });

    assert.equal(response.status, 409);
    assert.equal(payload.error, "Insufficient inventory for Lunch Combo");
  });

  it("refunds a wallet sale by restoring wallet balance and inventory", async () => {
    const { org, store, product, customer, wallet } = await createSaleFixture();
    await stockProduct({ org, store, product, quantity: 5 });
    await post(`/v1/wallets/${wallet.id}/topups`, {
      organizationId: org.id,
      amountCents: 1000,
      note: "Test top up"
    });

    const sale = await post(
      "/v1/orders/wallet-sale",
      {
        organizationId: org.id,
        storeId: store.id,
        customerId: customer.id,
        walletAccountId: wallet.id,
        items: [{ productId: product.id, quantity: 1 }]
      },
      { "Idempotency-Key": unique("wallet-refund-sale") }
    );

    const refund = await post(
      `/v1/orders/${sale.order.id}/refund`,
      {
        organizationId: org.id,
        reason: "Test refund"
      },
      { "Idempotency-Key": unique("wallet-refund") }
    );

    assert.equal(refund.order.status, "refunded");
    assert.equal(refund.payment.status, "refunded");
    assert.equal(refund.wallet.balanceCents, 1000);
    assert.equal(refund.inventory[0].quantityAfter, 5);
  });

  it("refunds an open-drawer cash sale by reducing expected cash and restoring inventory", async () => {
    const { org, store, product } = await createSaleFixture();
    await stockProduct({ org, store, product, quantity: 3 });
    const drawer = await openDrawer({ org, store });

    const sale = await post(
      "/v1/orders/paid-sale",
      {
        organizationId: org.id,
        storeId: store.id,
        paymentMethod: "cash",
        registerName: "Lunch Line 02",
        items: [{ productId: product.id, quantity: 1 }]
      },
      { "Idempotency-Key": unique("cash-refund-sale") }
    );

    assert.equal(sale.cashDrawer.expectedCashCents, 10550);

    const refund = await post(
      `/v1/orders/${sale.order.id}/refund`,
      {
        organizationId: org.id,
        reason: "Cash refund"
      },
      { "Idempotency-Key": unique("cash-refund") }
    );

    assert.equal(refund.order.status, "refunded");
    assert.equal(refund.cashDrawer.id, drawer.id);
    assert.equal(refund.cashDrawer.expectedCashCents, 10000);
    assert.equal(refund.inventory[0].quantityAfter, 3);
  });

  it("rejects insufficient wallet funds", async () => {
    const { org, store, product, customer, wallet } = await createSaleFixture();
    const { response, payload } = await request("/v1/orders/wallet-sale", {
      method: "POST",
      headers: { "Idempotency-Key": unique("insufficient") },
      body: {
        organizationId: org.id,
        storeId: store.id,
        customerId: customer.id,
        walletAccountId: wallet.id,
        items: [{ productId: product.id, quantity: 1 }]
      }
    });

    assert.equal(response.status, 402);
    assert.equal(payload.error, "Insufficient wallet balance");
  });
});

after(async () => {
  server?.close();
  await pool.end();
});
