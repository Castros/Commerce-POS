# API Working Model

This document shows the current working Commerce POS API slice.

Base URL:

```text
http://localhost:4100/v1
```

## Authentication

Local development uses a dev actor fallback when `NODE_ENV !== "production"`, so the curl examples below work without auth headers.

Production disables the dev fallback. Set:

```text
COMMERCE_API_TOKEN=long-random-token
```

Then call protected routes with:

```text
Authorization: Bearer long-random-token
```

Current route permissions are role-based internally. The environment token is treated as a `service` actor. Later UI login will map real users to `commerce_users`, roles, and store assignments.

## Current Capabilities

- Create organizations.
- Create stores.
- Create products.
- Store product image URLs for POS register/catalog display.
- Create customers.
- Create wallet accounts.
- Top up wallet accounts.
- Complete an atomic wallet sale.
- Complete a paid cash/card sale.
- Enforce wallet credit limits, allowing negative balances only up to the configured limit.
- Track inventory quantities, low-stock state, and inventory movements.
- Decrement tracked inventory in the same transaction as paid and wallet sales.
- Read receipt details with line items, wallet impact, and inventory impact.
- Refund paid orders, reversing wallet balance, sale inventory movements, and open cash drawer expected cash.
- Open and close cash drawer sessions and attach cash sales to the open register drawer.
- List orders and read order details.
- Seed a school cafeteria demo.
- Link Student Educational app students to Commerce POS customers and wallets.
- Return cafeteria balance and recent POS wallet transactions for Student Educational app views.
- Replay a wallet sale safely with the same `Idempotency-Key`.
- Reject insufficient funds or credit-limit violations.
- Reject sales that would make tracked inventory negative.

## Start Locally

```bash
docker compose up -d db api web
```

The API container runs migrations on startup and listens on:

```text
http://localhost:4100
```

The web container listens on:

```text
http://localhost:3100
```

## Create Test Data

For the current school demo, the fastest path is the demo seed endpoint:

```bash
curl -s -X POST http://localhost:4100/v1/demo/school
```

It creates or reuses Demo Academy, a Cafeteria store, demo products, demo students,
wallets, and top-up transactions. The frontend `/register` and `/student-demo` routes
use this data.

Manual setup is still supported:

Create an organization:

```bash
curl -s -X POST http://localhost:4100/v1/organizations \
  -H "Content-Type: application/json" \
  -d '{"name":"Pilot School","type":"school"}'
```

Create a store:

```bash
curl -s -X POST http://localhost:4100/v1/stores \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"ORG_ID","name":"Cafeteria","type":"cafeteria"}'
```

Create a product:

```bash
curl -s -X POST http://localhost:4100/v1/products \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"ORG_ID","storeId":"STORE_ID","name":"Lunch Combo","sku":"LUNCH-1","imageUrl":"/product-images/lunch-combo.svg","priceCents":550}'
```

Create a customer:

```bash
curl -s -X POST http://localhost:4100/v1/customers \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"ORG_ID","name":"Test Student"}'
```

Create a wallet:

```bash
curl -s -X POST http://localhost:4100/v1/wallets \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"ORG_ID","customerId":"CUSTOMER_ID","creditLimitCents":2500}'
```

Top up the wallet:

```bash
curl -s -X POST http://localhost:4100/v1/wallets/WALLET_ID/topups \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"ORG_ID","amountCents":1000,"note":"Initial test balance"}'
```

## Complete Wallet Sale

```bash
curl -s -X POST http://localhost:4100/v1/orders/wallet-sale \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-sale-001" \
  -d '{
    "organizationId":"ORG_ID",
    "storeId":"STORE_ID",
    "customerId":"CUSTOMER_ID",
    "walletAccountId":"WALLET_ID",
    "items":[
      { "productId":"PRODUCT_ID", "quantity":1 }
    ]
  }'
```

The endpoint returns a receipt-style response:

```json
{
  "data": {
    "order": {
      "id": "ORDER_ID",
      "status": "paid",
      "paymentStatus": "paid",
      "totalCents": 550,
      "currency": "USD"
    },
    "items": [],
    "payment": {
      "method": "wallet",
      "status": "succeeded",
      "amountCents": 550
    },
    "wallet": {
      "balanceCents": 450,
      "creditLimitCents": 2500
    }
  }
}
```

`balanceCents` may be negative when the student used cafeteria credit. A negative
balance means the student owes that amount. The sale is rejected when
`balanceCents - saleTotalCents` would be lower than `-creditLimitCents`.

## Complete Cash Or Credit Sale

```bash
curl -s -X POST http://localhost:4100/v1/orders/paid-sale \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-cash-sale-001" \
  -d '{
    "organizationId":"ORG_ID",
    "storeId":"STORE_ID",
    "customerId":"CUSTOMER_ID",
    "paymentMethod":"cash",
    "items":[
      { "productId":"PRODUCT_ID", "quantity":1 }
    ]
  }'
```

Supported `paymentMethod` values are `cash` and `card`. The current `card` flow is a
recorded payment method for demo purposes only; it is not connected to a real card
provider or terminal yet.

## Refund An Order

```bash
curl -s -X POST http://localhost:4100/v1/orders/ORDER_ID/refund \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-refund-001" \
  -d '{
    "organizationId":"ORG_ID",
    "reason":"Cashier demo refund"
  }'
```

Refunds are full-order refunds in the current working model. The endpoint marks the
order and payment as refunded, restores inventory decremented by the sale, and writes
the reversal inside one database transaction. Wallet refunds add the payment amount
back to the student wallet through a new immutable ledger row. Cash refunds reduce the
open drawer's expected cash; cash refunds are rejected after that drawer has closed.
Card refunds are recorded only and are not connected to a real provider yet.

## Inventory

List live inventory for a store:

```bash
curl -s "http://localhost:4100/v1/inventory?organizationId=ORG_ID&storeId=STORE_ID"
```

Filter to low/out-of-stock items:

```bash
curl -s "http://localhost:4100/v1/inventory?organizationId=ORG_ID&storeId=STORE_ID&lowStock=true"
```

Adjust stock:

```bash
curl -s -X POST http://localhost:4100/v1/inventory/PRODUCT_ID/adjustments \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId":"ORG_ID",
    "storeId":"STORE_ID",
    "quantityDelta":25,
    "note":"Received cafeteria stock"
  }'
```

Paid and wallet sales lock tracked inventory rows, reject oversells, decrement
`quantity_on_hand`, and write `commerce_inventory_movements` rows inside the same
database transaction as the order/payment.

## Cash Drawers

Open the cafeteria register drawer:

```bash
curl -s -X POST http://localhost:4100/v1/cash-drawers/open \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId":"ORG_ID",
    "storeId":"STORE_ID",
    "registerName":"Lunch Line 02",
    "openingCashCents":10000
  }'
```

Read the open drawer:

```bash
curl -s "http://localhost:4100/v1/cash-drawers/current?organizationId=ORG_ID&storeId=STORE_ID&registerName=Lunch%20Line%2002"
```

Close the drawer:

```bash
curl -s -X POST http://localhost:4100/v1/cash-drawers/DRAWER_ID/close \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId":"ORG_ID",
    "countedCashCents":11200
  }'
```

Cash sales from `POST /v1/orders/paid-sale` attach to the open drawer when
`paymentMethod` is `cash` and `registerName` matches the open session. The drawer
tracks opening cash, expected cash, counted cash, and over/short variance.

## Safety Behavior

The sale endpoint:

- Requires an authenticated actor outside local development.
- Requires `Idempotency-Key`.
- Locks the wallet row with `SELECT ... FOR UPDATE`.
- Calculates product totals server-side.
- Inserts order, items, payment, wallet transaction, wallet balance update, and audit event in one transaction.
- Allows wallet balances to go negative only within the wallet credit limit.
- Decrements tracked inventory and rejects the sale if stock is insufficient.
- Full-order refunds restore sale-decremented inventory and reverse wallet/open cash drawer impact.
- Returns the same response if the same idempotency key and body are replayed.
- Returns `409 Conflict` if the same idempotency key is reused with a different body.
- Returns `402` if the wallet balance is insufficient.

## Orders

```bash
curl -s "http://localhost:4100/v1/orders?organizationId=ORG_ID"
curl -s "http://localhost:4100/v1/orders/ORDER_ID?organizationId=ORG_ID"
```

Order reads are tenant-scoped by `organizationId`. Detail reads include line items and,
when present, the wallet transaction balance-after and inventory movements created by
the sale or refund.

## Student Educational App Integration

The Student Educational app calls Commerce POS for cafeteria balances instead of
expanding its legacy `cafeteria_*` tables.

Commerce POS can also search Student Educational app students server-side. The browser
does not receive the Student app service token.

Required local token pairing:

```text
Student Educational app .env:
INGESTION_SECRET=some-long-random-secret

Commerce POS .env:
SPELLING_APP_SERVICE_TOKEN=some-long-random-secret
SPELLING_APP_API_URL=http://host.docker.internal:4000
```

Search Student Educational app students from Commerce POS:

```bash
curl -s "http://localhost:4100/v1/integrations/student-app/students/search?q=A-1042"
```

Under the hood, Commerce POS calls:

```text
GET /service/students?q=A-1042&school_id=<uuid>
Authorization: Bearer $SPELLING_APP_SERVICE_TOKEN
```

Create or look up the Commerce POS customer and wallet for a Student app student:

```bash
curl -s -X POST http://localhost:4100/v1/integrations/student-app/students \
  -H "Content-Type: application/json" \
  -d '{
    "externalStudentId":"STUDENT_APP_STUDENT_ID",
    "externalParentId":"PARENT_ID",
    "name":"Student Name",
    "email":"student@example.com",
    "startingBalanceCents":1500,
    "creditLimitCents":2500
  }'
```

Read the cafeteria shape used by the Student app:

```bash
curl -s "http://localhost:4100/v1/integrations/student-app/students/STUDENT_APP_STUDENT_ID/cafeteria"
```

The response includes the current signed `balance`, `credit_limit`, `amount_owed`, and
recent wallet transactions. Positive `balance` means money is available. Negative
`balance` means the student owes money. The default demo school mapping is:

```text
11111111-1111-4111-8111-111111111111
```
