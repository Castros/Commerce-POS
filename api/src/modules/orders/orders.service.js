import { withTransaction } from "../../db/transaction.js";
import { insertAuditEvent } from "../../shared/audit/audit.js";
import { badRequest, conflict, notFound, paymentRequired } from "../../shared/http/errors.js";
import {
  hashRequestBody,
  lockIdempotencyKey,
  storeIdempotentResponse
} from "../../shared/idempotency/idempotency.js";

function toInt(value) {
  return Number.parseInt(value, 10);
}

function buildReceipt({ order, items, payment, wallet, inventoryMovements = [], cashDrawer = null }) {
  const receipt = {
    order: {
      id: order.id,
      organizationId: order.organization_id,
      storeId: order.store_id,
      customerId: order.customer_id,
      status: order.status,
      paymentStatus: order.payment_status,
      subtotalCents: toInt(order.subtotal_cents),
      taxCents: toInt(order.tax_cents),
      discountCents: toInt(order.discount_cents),
      totalCents: toInt(order.total_cents),
      currency: order.currency,
      createdAt: order.created_at
    },
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.name_snapshot,
      unitPriceCents: toInt(item.unit_price_cents),
      quantity: item.quantity,
      lineTotalCents: toInt(item.line_total_cents),
      currency: item.currency
    })),
    payment: {
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amountCents: toInt(payment.amount_cents),
      currency: payment.currency
    },
    inventory: inventoryMovements.map((movement) => ({
      productId: movement.product_id,
      quantityDelta: movement.quantity_delta,
      quantityAfter: movement.quantity_after
    })),
    cashDrawer
  };

  if (wallet) {
    receipt.wallet = {
      id: wallet.id,
      balanceCents: wallet.balanceCents,
      creditLimitCents: wallet.creditLimitCents,
      currency: wallet.currency
    };
  }

  return receipt;
}

async function loadStoreAndItems(client, body) {
  const storeResult = await client.query(
    `
      SELECT id
      FROM commerce_stores
      WHERE organization_id = $1
        AND id = $2
        AND active = TRUE
    `,
    [body.organizationId, body.storeId]
  );

  if (storeResult.rowCount === 0) {
    throw notFound("Store not found");
  }

  if (body.customerId) {
    const customerResult = await client.query(
      `
        SELECT id
        FROM commerce_customers
        WHERE organization_id = $1
          AND id = $2
          AND active = TRUE
      `,
      [body.organizationId, body.customerId]
    );

    if (customerResult.rowCount === 0) {
      throw notFound("Customer not found");
    }
  }

  const productIds = body.items.map((item) => item.productId);
  const productResult = await client.query(
    `
      SELECT id, name, price_cents, currency
      FROM commerce_products
      WHERE organization_id = $1
        AND id = ANY($2::uuid[])
        AND active = TRUE
        AND (store_id = $3 OR store_id IS NULL)
    `,
    [body.organizationId, productIds, body.storeId]
  );

  if (productResult.rowCount !== productIds.length) {
    throw notFound("One or more products were not found for this store");
  }

  const productsById = new Map(productResult.rows.map((row) => [row.id, row]));
  const items = body.items.map((item) => {
    const product = productsById.get(item.productId);
    const unitPriceCents = toInt(product.price_cents);
    return {
      product,
      quantity: item.quantity,
      unitPriceCents,
      lineTotalCents: unitPriceCents * item.quantity
    };
  });

  return {
    items,
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0)
  };
}

async function decrementInventoryForSale(client, { organizationId, storeId, orderId, items, actorUserId }) {
  const productIds = items.map((item) => item.product.id);
  const inventoryResult = await client.query(
    `
      SELECT product_id, quantity_on_hand, track_inventory
      FROM commerce_inventory_items
      WHERE organization_id = $1
        AND store_id = $2
        AND product_id = ANY($3::uuid[])
      FOR UPDATE
    `,
    [organizationId, storeId, productIds]
  );

  const inventoryByProductId = new Map(
    inventoryResult.rows.map((row) => [row.product_id, row])
  );
  const movements = [];

  for (const item of items) {
    const inventory = inventoryByProductId.get(item.product.id);
    if (!inventory || inventory.track_inventory === false) {
      continue;
    }

    const currentQuantity = toInt(inventory.quantity_on_hand);
    if (currentQuantity < item.quantity) {
      throw conflict(`Insufficient inventory for ${item.product.name}`);
    }

    const quantityAfter = currentQuantity - item.quantity;
    await client.query(
      `
        UPDATE commerce_inventory_items
        SET quantity_on_hand = $4,
            updated_at = NOW()
        WHERE organization_id = $1
          AND store_id = $2
          AND product_id = $3
      `,
      [organizationId, storeId, item.product.id, quantityAfter]
    );

    const movement = (
      await client.query(
        `
          INSERT INTO commerce_inventory_movements (
            organization_id,
            store_id,
            product_id,
            order_id,
            type,
            quantity_delta,
            quantity_after,
            note,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4, 'sale', $5, $6, 'POS sale decrement', $7)
          RETURNING product_id, quantity_delta, quantity_after
        `,
        [
          organizationId,
          storeId,
          item.product.id,
          orderId,
          -item.quantity,
          quantityAfter,
          actorUserId
        ]
      )
    ).rows[0];

    movements.push(movement);
  }

  return movements;
}

async function recordCashDrawerSale(client, { body, orderId, totalCents, actorUserId }) {
  if (body.paymentMethod !== "cash") {
    return null;
  }

  const registerName = body.registerName || "Lunch Line 02";
  const drawer = (
    await client.query(
      `
        SELECT id, expected_cash_cents
        FROM commerce_cash_drawer_sessions
        WHERE organization_id = $1
          AND store_id = $2
          AND register_name = $3
          AND status = 'open'
        FOR UPDATE
      `,
      [body.organizationId, body.storeId, registerName]
    )
  ).rows[0];

  if (!drawer) {
    return null;
  }

  const expectedAfter = toInt(drawer.expected_cash_cents) + totalCents;
  await client.query(
    `
      UPDATE commerce_cash_drawer_sessions
      SET expected_cash_cents = $3
      WHERE organization_id = $1
        AND id = $2
    `,
    [body.organizationId, drawer.id, expectedAfter]
  );

  await client.query(
    `
      INSERT INTO commerce_cash_drawer_events (
        organization_id,
        store_id,
        session_id,
        order_id,
        type,
        amount_cents,
        cash_balance_after_cents,
        note,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, 'cash_sale', $5, $6, 'Cash sale', $7)
    `,
    [
      body.organizationId,
      body.storeId,
      drawer.id,
      orderId,
      totalCents,
      expectedAfter,
      actorUserId
    ]
  );

  return {
    id: drawer.id,
    registerName,
    expectedCashCents: expectedAfter
  };
}

async function insertPaidOrder(client, { body, items, subtotalCents, actorUserId }) {
  const taxCents = 0;
  const discountCents = 0;
  const totalCents = subtotalCents + taxCents - discountCents;

  const orderResult = await client.query(
    `
      INSERT INTO commerce_orders (
        organization_id,
        store_id,
        customer_id,
        status,
        subtotal_cents,
        tax_cents,
        discount_cents,
        total_cents,
        payment_status,
        created_by_user_id
      )
      VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7, 'paid', $8)
      RETURNING *
    `,
    [
      body.organizationId,
      body.storeId,
      body.customerId || null,
      subtotalCents,
      taxCents,
      discountCents,
      totalCents,
      actorUserId
    ]
  );
  const order = orderResult.rows[0];

  const createdItems = [];
  for (const item of items) {
    const itemResult = await client.query(
      `
        INSERT INTO commerce_order_items (
          organization_id,
          order_id,
          product_id,
          name_snapshot,
          unit_price_cents,
          quantity,
          line_total_cents,
          currency
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD')
        RETURNING *
      `,
      [
        body.organizationId,
        order.id,
        item.product.id,
        item.product.name,
        item.unitPriceCents,
        item.quantity,
        item.lineTotalCents
      ]
    );
    createdItems.push(itemResult.rows[0]);
  }

  const paymentResult = await client.query(
    `
      INSERT INTO commerce_payments (
        organization_id,
        order_id,
        method,
        amount_cents,
        status
      )
      VALUES ($1, $2, $3, $4, 'succeeded')
      RETURNING *
    `,
    [body.organizationId, order.id, body.paymentMethod, totalCents]
  );

  return {
    order,
    createdItems,
    payment: paymentResult.rows[0],
    totalCents
  };
}

export async function createPaidSale({
  body,
  idempotencyKey,
  requestId,
  ipAddress,
  userAgent,
  actorUserId,
  actorService
}) {
  const requestHash = hashRequestBody(body);

  return withTransaction(async (client) => {
    const idempotency = await lockIdempotencyKey(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      requestHash
    });

    if (idempotency.replay) {
      return {
        status: idempotency.status,
        body: idempotency.body
      };
    }

    const { items, subtotalCents } = await loadStoreAndItems(client, body);
    const { order, createdItems, payment, totalCents } = await insertPaidOrder(client, {
      body,
      items,
      subtotalCents,
      actorUserId
    });
    const inventoryMovements = await decrementInventoryForSale(client, {
      organizationId: body.organizationId,
      storeId: body.storeId,
      orderId: order.id,
      items,
      actorUserId
    });
    const cashDrawer = await recordCashDrawerSale(client, {
      body,
      orderId: order.id,
      totalCents,
      actorUserId
    });

    await insertAuditEvent(client, {
      organizationId: body.organizationId,
      storeId: body.storeId,
      actorUserId,
      actorService,
      action: `order.${body.paymentMethod}_sale`,
      targetType: "order",
      targetId: order.id,
      summary: {
        totalCents,
        paymentMethod: body.paymentMethod
      },
      metadata: {
        itemCount: createdItems.length
      },
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent
    });

    const responseBody = {
      data: buildReceipt({
        order,
        items: createdItems,
        payment,
        inventoryMovements,
        cashDrawer
      })
    };

    await storeIdempotentResponse(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      status: 201,
      body: responseBody
    });

    return {
      status: 201,
      body: responseBody
    };
  }).catch((err) => {
    if (err.code === "23505") {
      throw conflict("Duplicate payment or idempotency conflict");
    }
    throw err;
  });
}

export async function createWalletSale({
  body,
  idempotencyKey,
  requestId,
  ipAddress,
  userAgent,
  actorUserId,
  actorService
}) {
  const requestHash = hashRequestBody(body);

  return withTransaction(async (client) => {
    const idempotency = await lockIdempotencyKey(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      requestHash
    });

    if (idempotency.replay) {
      return {
        status: idempotency.status,
        body: idempotency.body
      };
    }

    const walletResult = await client.query(
      `
        SELECT id, customer_id, balance_cents, credit_limit_cents, currency
        FROM commerce_wallet_accounts
        WHERE organization_id = $1
          AND id = $2
          AND customer_id = $3
          AND active = TRUE
        FOR UPDATE
      `,
      [body.organizationId, body.walletAccountId, body.customerId]
    );

    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw notFound("Wallet not found");
    }

    const storeResult = await client.query(
      `
        SELECT id
        FROM commerce_stores
        WHERE organization_id = $1
          AND id = $2
          AND active = TRUE
      `,
      [body.organizationId, body.storeId]
    );

    if (storeResult.rowCount === 0) {
      throw notFound("Store not found");
    }

    const productIds = body.items.map((item) => item.productId);
    const productResult = await client.query(
      `
        SELECT id, name, price_cents, currency
        FROM commerce_products
        WHERE organization_id = $1
          AND id = ANY($2::uuid[])
          AND active = TRUE
          AND (store_id = $3 OR store_id IS NULL)
      `,
      [body.organizationId, productIds, body.storeId]
    );

    if (productResult.rowCount !== productIds.length) {
      throw notFound("One or more products were not found for this store");
    }

    const productsById = new Map(productResult.rows.map((row) => [row.id, row]));
    const items = body.items.map((item) => {
      const product = productsById.get(item.productId);
      const unitPriceCents = toInt(product.price_cents);
      return {
        product,
        quantity: item.quantity,
        unitPriceCents,
        lineTotalCents: unitPriceCents * item.quantity
      };
    });

    const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const taxCents = 0;
    const discountCents = 0;
    const totalCents = subtotalCents + taxCents - discountCents;
    const currentBalance = toInt(wallet.balance_cents);
    const creditLimit = toInt(wallet.credit_limit_cents || 0);

    if (currentBalance + creditLimit < totalCents) {
      throw paymentRequired("Insufficient wallet balance");
    }

    const balanceAfter = currentBalance - totalCents;

    const orderResult = await client.query(
      `
        INSERT INTO commerce_orders (
          organization_id,
          store_id,
          customer_id,
          status,
          subtotal_cents,
          tax_cents,
          discount_cents,
          total_cents,
          payment_status,
          created_by_user_id
        )
        VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7, 'paid', $8)
        RETURNING *
      `,
      [
        body.organizationId,
        body.storeId,
        body.customerId,
        subtotalCents,
        taxCents,
        discountCents,
        totalCents,
        actorUserId
      ]
    );
    const order = orderResult.rows[0];

    const createdItems = [];
    for (const item of items) {
      const itemResult = await client.query(
        `
          INSERT INTO commerce_order_items (
            organization_id,
            order_id,
            product_id,
            name_snapshot,
            unit_price_cents,
            quantity,
            line_total_cents,
            currency
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD')
          RETURNING *
        `,
        [
          body.organizationId,
          order.id,
          item.product.id,
          item.product.name,
          item.unitPriceCents,
          item.quantity,
          item.lineTotalCents
        ]
      );
      createdItems.push(itemResult.rows[0]);
    }

    const paymentResult = await client.query(
      `
        INSERT INTO commerce_payments (
          organization_id,
          order_id,
          method,
          amount_cents,
          status
        )
        VALUES ($1, $2, 'wallet', $3, 'succeeded')
        RETURNING *
      `,
      [body.organizationId, order.id, totalCents]
    );
    const payment = paymentResult.rows[0];
    const inventoryMovements = await decrementInventoryForSale(client, {
      organizationId: body.organizationId,
      storeId: body.storeId,
      orderId: order.id,
      items,
      actorUserId
    });

    await client.query(
      `
        UPDATE commerce_wallet_accounts
        SET balance_cents = $3,
            updated_at = NOW()
        WHERE organization_id = $1
          AND id = $2
      `,
      [body.organizationId, body.walletAccountId, balanceAfter]
    );

    await client.query(
      `
        INSERT INTO commerce_wallet_transactions (
          organization_id,
          wallet_account_id,
          order_id,
          type,
          amount_cents,
          balance_after_cents,
          source,
          note,
          created_by_user_id
        )
        VALUES ($1, $2, $3, 'purchase', $4, $5, 'wallet_sale', 'Wallet sale payment', $6)
      `,
      [
        body.organizationId,
        body.walletAccountId,
        order.id,
        -totalCents,
        balanceAfter,
        actorUserId
      ]
    );

    await insertAuditEvent(client, {
      organizationId: body.organizationId,
      storeId: body.storeId,
      actorUserId,
      actorService,
      action: "order.wallet_sale",
      targetType: "order",
      targetId: order.id,
      summary: {
        totalCents,
        walletAccountId: body.walletAccountId,
        balanceAfterCents: balanceAfter
      },
      metadata: {
        itemCount: createdItems.length
      },
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent
    });

    const receipt = buildReceipt({
      order,
      items: createdItems,
      payment,
      inventoryMovements,
      wallet: {
        id: body.walletAccountId,
        balanceCents: balanceAfter,
        creditLimitCents: creditLimit,
        currency: wallet.currency
      }
    });

    const responseBody = { data: receipt };
    await storeIdempotentResponse(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      status: 201,
      body: responseBody
    });

    return {
      status: 201,
      body: responseBody
    };
  }).catch((err) => {
    if (err.code === "23505") {
      throw conflict("Duplicate payment or idempotency conflict");
    }
    throw err;
  });
}

async function reverseInventoryForRefund(client, { organizationId, storeId, orderId, actorUserId }) {
  const saleMovements = (
    await client.query(
      `
        SELECT product_id, quantity_delta
        FROM commerce_inventory_movements
        WHERE organization_id = $1
          AND store_id = $2
          AND order_id = $3
          AND type = 'sale'
        ORDER BY created_at ASC
      `,
      [organizationId, storeId, orderId]
    )
  ).rows;

  const refundMovements = [];
  for (const movement of saleMovements) {
    const returnQuantity = Math.abs(toInt(movement.quantity_delta));
    const inventory = (
      await client.query(
        `
          SELECT quantity_on_hand
          FROM commerce_inventory_items
          WHERE organization_id = $1
            AND store_id = $2
            AND product_id = $3
          FOR UPDATE
        `,
        [organizationId, storeId, movement.product_id]
      )
    ).rows[0];

    if (!inventory) continue;

    const quantityAfter = toInt(inventory.quantity_on_hand) + returnQuantity;
    await client.query(
      `
        UPDATE commerce_inventory_items
        SET quantity_on_hand = $4,
            updated_at = NOW()
        WHERE organization_id = $1
          AND store_id = $2
          AND product_id = $3
      `,
      [organizationId, storeId, movement.product_id, quantityAfter]
    );

    const refundMovement = (
      await client.query(
        `
          INSERT INTO commerce_inventory_movements (
            organization_id,
            store_id,
            product_id,
            order_id,
            type,
            quantity_delta,
            quantity_after,
            note,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, 'Refund stock return', $7)
          RETURNING product_id, quantity_delta, quantity_after
        `,
        [
          organizationId,
          storeId,
          movement.product_id,
          orderId,
          returnQuantity,
          quantityAfter,
          actorUserId
        ]
      )
    ).rows[0];
    refundMovements.push(refundMovement);
  }

  return refundMovements;
}

async function refundWalletPayment(client, { organizationId, orderId, payment, actorUserId }) {
  if (payment.method !== "wallet") return null;

  const purchase = (
    await client.query(
      `
        SELECT wallet_account_id
        FROM commerce_wallet_transactions
        WHERE organization_id = $1
          AND order_id = $2
          AND type = 'purchase'
        LIMIT 1
      `,
      [organizationId, orderId]
    )
  ).rows[0];

  if (!purchase) return null;

  const wallet = (
    await client.query(
      `
        SELECT id, balance_cents, credit_limit_cents, currency
        FROM commerce_wallet_accounts
        WHERE organization_id = $1
          AND id = $2
        FOR UPDATE
      `,
      [organizationId, purchase.wallet_account_id]
    )
  ).rows[0];

  if (!wallet) return null;

  const balanceAfter = toInt(wallet.balance_cents) + toInt(payment.amount_cents);
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
        order_id,
        type,
        amount_cents,
        balance_after_cents,
        source,
        note,
        created_by_user_id
      )
      VALUES ($1, $2, $3, 'refund', $4, $5, 'order_refund', 'Order refund', $6)
    `,
    [
      organizationId,
      wallet.id,
      orderId,
      toInt(payment.amount_cents),
      balanceAfter,
      actorUserId
    ]
  );

  return {
    id: wallet.id,
    balanceCents: balanceAfter,
    creditLimitCents: toInt(wallet.credit_limit_cents || 0),
    currency: wallet.currency
  };
}

async function refundCashDrawerPayment(client, { organizationId, orderId, payment, actorUserId }) {
  if (payment.method !== "cash") return null;

  const cashSale = (
    await client.query(
      `
        SELECT e.session_id, e.store_id, s.expected_cash_cents, s.register_name, s.status
        FROM commerce_cash_drawer_events e
        JOIN commerce_cash_drawer_sessions s
          ON s.organization_id = e.organization_id
         AND s.id = e.session_id
        WHERE e.organization_id = $1
          AND e.order_id = $2
          AND e.type = 'cash_sale'
        LIMIT 1
        FOR UPDATE OF s
      `,
      [organizationId, orderId]
    )
  ).rows[0];

  if (!cashSale) return null;
  if (cashSale.status !== "open") {
    throw conflict("Cannot refund cash sale after drawer is closed");
  }

  const expectedAfter = toInt(cashSale.expected_cash_cents) - toInt(payment.amount_cents);
  if (expectedAfter < 0) {
    throw conflict("Cash drawer expected balance cannot go negative");
  }

  await client.query(
    `
      UPDATE commerce_cash_drawer_sessions
      SET expected_cash_cents = $3
      WHERE organization_id = $1
        AND id = $2
    `,
    [organizationId, cashSale.session_id, expectedAfter]
  );

  await client.query(
    `
      INSERT INTO commerce_cash_drawer_events (
        organization_id,
        store_id,
        session_id,
        order_id,
        type,
        amount_cents,
        cash_balance_after_cents,
        note,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, 'Cash sale refund', $7)
    `,
    [
      organizationId,
      cashSale.store_id,
      cashSale.session_id,
      orderId,
      -toInt(payment.amount_cents),
      expectedAfter,
      actorUserId
    ]
  );

  return {
    id: cashSale.session_id,
    registerName: cashSale.register_name,
    expectedCashCents: expectedAfter
  };
}

export async function refundOrder({
  body,
  idempotencyKey,
  requestId,
  ipAddress,
  userAgent,
  actorUserId,
  actorService
}) {
  const requestHash = hashRequestBody(body);

  return withTransaction(async (client) => {
    const idempotency = await lockIdempotencyKey(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      requestHash
    });

    if (idempotency.replay) {
      return {
        status: idempotency.status,
        body: idempotency.body
      };
    }

    const order = (
      await client.query(
        `
          SELECT *
          FROM commerce_orders
          WHERE organization_id = $1
            AND id = $2
          FOR UPDATE
        `,
        [body.organizationId, body.orderId]
      )
    ).rows[0];

    if (!order) throw notFound("Order not found");
    if (order.status !== "paid" || order.payment_status !== "paid") {
      throw conflict("Only paid orders can be refunded");
    }

    const payment = (
      await client.query(
        `
          SELECT *
          FROM commerce_payments
          WHERE organization_id = $1
            AND order_id = $2
            AND status = 'succeeded'
          FOR UPDATE
        `,
        [body.organizationId, body.orderId]
      )
    ).rows[0];

    if (!payment) throw conflict("Order has no refundable payment");

    const inventoryMovements = await reverseInventoryForRefund(client, {
      organizationId: body.organizationId,
      storeId: order.store_id,
      orderId: order.id,
      actorUserId
    });
    const wallet = await refundWalletPayment(client, {
      organizationId: body.organizationId,
      orderId: order.id,
      payment,
      actorUserId
    });
    const cashDrawer = await refundCashDrawerPayment(client, {
      organizationId: body.organizationId,
      orderId: order.id,
      payment,
      actorUserId
    });

    await client.query(
      `
        UPDATE commerce_payments
        SET status = 'refunded'
        WHERE organization_id = $1
          AND id = $2
      `,
      [body.organizationId, payment.id]
    );

    const refundedOrder = (
      await client.query(
        `
          UPDATE commerce_orders
          SET status = 'refunded',
              payment_status = 'refunded'
          WHERE organization_id = $1
            AND id = $2
          RETURNING *
        `,
        [body.organizationId, order.id]
      )
    ).rows[0];

    await insertAuditEvent(client, {
      organizationId: body.organizationId,
      storeId: order.store_id,
      actorUserId,
      actorService,
      action: "order.refund",
      targetType: "order",
      targetId: order.id,
      summary: {
        amountCents: toInt(payment.amount_cents),
        paymentMethod: payment.method,
        reason: body.reason || null
      },
      metadata: {
        reversedInventoryCount: inventoryMovements.length
      },
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent
    });

    const responseBody = {
      data: {
        order: {
          id: refundedOrder.id,
          organizationId: refundedOrder.organization_id,
          storeId: refundedOrder.store_id,
          customerId: refundedOrder.customer_id,
          status: refundedOrder.status,
          paymentStatus: refundedOrder.payment_status,
          totalCents: toInt(refundedOrder.total_cents),
          currency: refundedOrder.currency
        },
        payment: {
          id: payment.id,
          method: payment.method,
          status: "refunded",
          amountCents: toInt(payment.amount_cents),
          currency: payment.currency
        },
        wallet,
        cashDrawer,
        inventory: inventoryMovements.map((movement) => ({
          productId: movement.product_id,
          quantityDelta: movement.quantity_delta,
          quantityAfter: movement.quantity_after
        }))
      }
    };

    await storeIdempotentResponse(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      status: 200,
      body: responseBody
    });

    return {
      status: 200,
      body: responseBody
    };
  }).catch((err) => {
    if (err.code === "23505") {
      throw conflict("Duplicate refund or idempotency conflict");
    }
    throw err;
  });
}

export async function partialRefundOrder({
  body,
  idempotencyKey,
  requestId,
  ipAddress,
  userAgent,
  actorUserId,
  actorService
}) {
  const requestHash = hashRequestBody(body);

  return withTransaction(async (client) => {
    const idempotency = await lockIdempotencyKey(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      requestHash
    });

    if (idempotency.replay) {
      return { status: idempotency.status, body: idempotency.body };
    }

    const order = (
      await client.query(
        `SELECT * FROM commerce_orders
         WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [body.organizationId, body.orderId]
      )
    ).rows[0];

    if (!order) throw notFound("Order not found");
    if (!["paid", "partially_refunded"].includes(order.status)) {
      throw conflict("Only paid or partially refunded orders can be partially refunded");
    }

    const payment = (
      await client.query(
        `SELECT * FROM commerce_payments
         WHERE organization_id = $1 AND order_id = $2 AND status = 'succeeded'`,
        [body.organizationId, body.orderId]
      )
    ).rows[0];

    if (!payment) throw conflict("No refundable payment found");

    const orderItemsResult = await client.query(
      `SELECT * FROM commerce_order_items
       WHERE organization_id = $1 AND order_id = $2`,
      [body.organizationId, body.orderId]
    );
    const itemsById = new Map(orderItemsResult.rows.map((r) => [r.id, r]));

    let refundAmountCents = 0;
    const refundItems = [];

    for (const refundItem of body.items) {
      const item = itemsById.get(refundItem.itemId);
      if (!item) throw notFound(`Order item not found: ${refundItem.itemId}`);
      const available = toInt(item.quantity) - toInt(item.refunded_quantity);
      if (refundItem.quantity > available) {
        throw conflict(`Cannot refund more than available quantity for "${item.name_snapshot}"`);
      }
      if (refundItem.quantity <= 0) throw badRequest("Refund quantity must be positive");
      const lineCents = toInt(item.unit_price_cents) * refundItem.quantity;
      refundAmountCents += lineCents;
      refundItems.push({ item, refundQuantity: refundItem.quantity, lineCents });
    }

    for (const { item, refundQuantity } of refundItems) {
      await client.query(
        `UPDATE commerce_order_items
         SET refunded_quantity = refunded_quantity + $3
         WHERE organization_id = $1 AND id = $2`,
        [body.organizationId, item.id, refundQuantity]
      );
    }

    const updatedItems = (
      await client.query(
        `SELECT quantity, refunded_quantity FROM commerce_order_items
         WHERE organization_id = $1 AND order_id = $2`,
        [body.organizationId, body.orderId]
      )
    ).rows;

    const allRefunded = updatedItems.every(
      (r) => toInt(r.refunded_quantity) === toInt(r.quantity)
    );
    const newOrderStatus = allRefunded ? "refunded" : "partially_refunded";

    const inventoryMovements = [];
    for (const { item, refundQuantity } of refundItems) {
      const inventory = (
        await client.query(
          `SELECT quantity_on_hand FROM commerce_inventory_items
           WHERE organization_id = $1 AND store_id = $2 AND product_id = $3 FOR UPDATE`,
          [body.organizationId, order.store_id, item.product_id]
        )
      ).rows[0];

      if (!inventory) continue;

      const quantityAfter = toInt(inventory.quantity_on_hand) + refundQuantity;
      await client.query(
        `UPDATE commerce_inventory_items
         SET quantity_on_hand = $4, updated_at = NOW()
         WHERE organization_id = $1 AND store_id = $2 AND product_id = $3`,
        [body.organizationId, order.store_id, item.product_id, quantityAfter]
      );

      const movement = (
        await client.query(
          `INSERT INTO commerce_inventory_movements (
             organization_id, store_id, product_id, order_id, type,
             quantity_delta, quantity_after, note, created_by_user_id
           )
           VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, 'Partial refund stock return', $7)
           RETURNING product_id, quantity_delta, quantity_after`,
          [
            body.organizationId, order.store_id, item.product_id, order.id,
            refundQuantity, quantityAfter, actorUserId
          ]
        )
      ).rows[0];
      inventoryMovements.push(movement);
    }

    let wallet = null;
    if (payment.method === "wallet") {
      const purchase = (
        await client.query(
          `SELECT wallet_account_id FROM commerce_wallet_transactions
           WHERE organization_id = $1 AND order_id = $2 AND type = 'purchase' LIMIT 1`,
          [body.organizationId, body.orderId]
        )
      ).rows[0];

      if (purchase) {
        const walletAcc = (
          await client.query(
            `SELECT id, balance_cents, credit_limit_cents, currency
             FROM commerce_wallet_accounts
             WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
            [body.organizationId, purchase.wallet_account_id]
          )
        ).rows[0];

        if (walletAcc) {
          const balanceAfter = toInt(walletAcc.balance_cents) + refundAmountCents;
          await client.query(
            `UPDATE commerce_wallet_accounts
             SET balance_cents = $3, updated_at = NOW()
             WHERE organization_id = $1 AND id = $2`,
            [body.organizationId, walletAcc.id, balanceAfter]
          );
          await client.query(
            `INSERT INTO commerce_wallet_transactions (
               organization_id, wallet_account_id, order_id, type,
               amount_cents, balance_after_cents, source, note, created_by_user_id
             )
             VALUES ($1, $2, $3, 'refund', $4, $5, 'order_partial_refund', 'Partial refund', $6)`,
            [body.organizationId, walletAcc.id, order.id, refundAmountCents, balanceAfter, actorUserId]
          );
          wallet = {
            id: walletAcc.id,
            balanceCents: balanceAfter,
            creditLimitCents: toInt(walletAcc.credit_limit_cents || 0),
            currency: walletAcc.currency
          };
        }
      }
    }

    let cashDrawer = null;
    if (payment.method === "cash") {
      const cashSale = (
        await client.query(
          `SELECT e.session_id, e.store_id, s.expected_cash_cents, s.register_name, s.status
           FROM commerce_cash_drawer_events e
           JOIN commerce_cash_drawer_sessions s
             ON s.organization_id = e.organization_id AND s.id = e.session_id
           WHERE e.organization_id = $1 AND e.order_id = $2 AND e.type = 'cash_sale'
           LIMIT 1 FOR UPDATE OF s`,
          [body.organizationId, body.orderId]
        )
      ).rows[0];

      if (cashSale) {
        if (cashSale.status !== "open") {
          throw conflict("Cannot refund cash sale after drawer is closed");
        }
        const expectedAfter = toInt(cashSale.expected_cash_cents) - refundAmountCents;
        await client.query(
          `UPDATE commerce_cash_drawer_sessions SET expected_cash_cents = $3
           WHERE organization_id = $1 AND id = $2`,
          [body.organizationId, cashSale.session_id, expectedAfter]
        );
        await client.query(
          `INSERT INTO commerce_cash_drawer_events (
             organization_id, store_id, session_id, order_id, type,
             amount_cents, cash_balance_after_cents, note, created_by_user_id
           )
           VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, 'Partial cash refund', $7)`,
          [
            body.organizationId, cashSale.store_id, cashSale.session_id, order.id,
            -refundAmountCents, expectedAfter, actorUserId
          ]
        );
        cashDrawer = {
          id: cashSale.session_id,
          registerName: cashSale.register_name,
          expectedCashCents: expectedAfter
        };
      }
    }

    const updatedOrder = (
      await client.query(
        `UPDATE commerce_orders
         SET status = $3,
             payment_status = CASE WHEN $3 = 'refunded' THEN 'refunded' ELSE payment_status END
         WHERE organization_id = $1 AND id = $2
         RETURNING *`,
        [body.organizationId, body.orderId, newOrderStatus]
      )
    ).rows[0];

    await insertAuditEvent(client, {
      organizationId: body.organizationId,
      storeId: order.store_id,
      actorUserId,
      actorService,
      action: "order.partial_refund",
      targetType: "order",
      targetId: order.id,
      summary: {
        refundAmountCents,
        paymentMethod: payment.method,
        itemCount: refundItems.length,
        reason: body.reason || null
      },
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent
    });

    const responseBody = {
      data: {
        order: {
          id: updatedOrder.id,
          organizationId: updatedOrder.organization_id,
          status: updatedOrder.status,
          paymentStatus: updatedOrder.payment_status,
          totalCents: toInt(updatedOrder.total_cents),
          currency: updatedOrder.currency
        },
        refundAmountCents,
        itemCount: refundItems.length,
        wallet,
        cashDrawer,
        inventory: inventoryMovements.map((m) => ({
          productId: m.product_id,
          quantityDelta: m.quantity_delta,
          quantityAfter: m.quantity_after
        }))
      }
    };

    await storeIdempotentResponse(client, {
      organizationId: body.organizationId,
      idempotencyKey,
      status: 200,
      body: responseBody
    });

    return { status: 200, body: responseBody };
  }).catch((err) => {
    if (err.code === "23505") throw conflict("Duplicate refund or idempotency conflict");
    throw err;
  });
}
