# Agent Architecture Review

Date: 2026-05-02

This document captures the findings from two architecture review agents:

- `engineering_software_architect`: overall application architecture, deployment, operations, and phases.
- `engineering_backend_architect`: API, database, financial safety, tenant isolation, and first backend slice.

## Executive Summary

The current direction is correct: build Commerce POS as a modular monolith with one API, one Next.js web app, and one Postgres database.

This is the best fit for the pilot because it keeps cloud cost low, reduces operational complexity, and keeps wallet, order, and payment writes inside one transactional boundary.

Do not split wallet, order, and payment logic into separate services yet. Those flows need one source of truth and one safe write path.

## Recommended Application Shape

```text
api/
  src/
    modules/
      organizations/
      stores/
      products/
      customers/
      wallets/
      orders/
      payments/
      receipts/
      inventory/
      audit/
      auth/
      integrations/
    shared/
      db/
      http/
      auth/
      validation/
      idempotency/
      transactions/
web/
  app/
    admin/
    cashier/
    customers/
    reports/
    integrations/
```

Each backend module should follow this internal shape:

```text
routes.js        HTTP parsing and response shape only
schemas.js       zod validation
service.js       business rules and transaction orchestration
repo.js          SQL only, always tenant-scoped
events.js        audit/webhook event creation where needed
```

## Service Boundaries

Keep these as hard module boundaries inside the monolith:

- `organizations`: tenants, organization settings, business identity.
- `stores`: physical or virtual selling locations.
- `products`: catalog, categories, SKU, and pricing.
- `customers`: parent, student, and standalone customer mapping.
- `wallets`: wallet accounts and append-only ledger.
- `orders`: order lifecycle and immutable order item snapshots.
- `payments`: wallet, cash, card payment records, refunds, and voids.
- `receipts`: receipt projection from order snapshots.
- `inventory`: stock counts and inventory movement ledger.
- `audit`: append-only audit events.
- `auth`: users, roles, service credentials, store assignments.
- `integrations`: Spelling App sync, service tokens, and webhooks.

## Deployment Recommendation

Use a simple low-cost cloud topology first:

```text
Browser
  -> HTTPS platform router / CDN
  -> Next.js web container
  -> Express API container
  -> Managed Postgres
  -> Payment provider hosted/tokenized flow
```

Recommended first deployment targets:

- Render
- Fly.io
- Railway
- Google Cloud Run
- AWS App Runner

Production minimums:

- Managed Postgres with automated backups and point-in-time recovery.
- Separate local, staging, and production environments.
- HTTPS only.
- Cloud/platform secret storage.
- Centralized logs.
- Error tracking.
- Uptime checks.
- Backup restore test.

Avoid Kubernetes, Redis, queues, read replicas, and service splitting until usage proves they are needed.

## Backend Findings

### 1. Cross-Tenant Foreign Keys Need Hardening

Current schema references related rows by bare `id`. This can allow cross-tenant data mistakes, such as a product with `organization_id` A referencing a store from organization B.

Required change before money endpoints:

```sql
UNIQUE (organization_id, id)
```

Then use composite foreign keys:

```sql
FOREIGN KEY (organization_id, store_id)
  REFERENCES commerce_stores (organization_id, id)
```

Apply this pattern across tenant-owned tables:

- stores
- categories
- products
- customers
- wallet accounts
- orders
- order items
- payments
- wallet transactions
- audit events

### 2. Status and Type Columns Need Constraints

Current schema uses unconstrained `TEXT` for statuses and types.

Add `CHECK` constraints for:

- organization type
- store type
- order status
- payment status
- payment method
- wallet transaction type
- currency
- marketplace visibility when marketplace tables are added

Prefer `CHECK` constraints over Postgres enums at this stage because they are easier to evolve during early product design.

### 3. Wallet Ledger Must Be Append-Only

Wallet transactions should not be updateable or deleteable.

Add database triggers that reject:

- `UPDATE` on `commerce_wallet_transactions`
- `DELETE` on `commerce_wallet_transactions`
- mutation of paid order items
- unsafe mutation of terminal payment records

Application discipline is not enough for money records.

### 4. Payment Duplication Protection Is Missing

The current schema allows multiple successful payments for one order.

For the first slice, support a simple rule:

```sql
CREATE UNIQUE INDEX ... ON commerce_payments(order_id)
WHERE status = 'succeeded';
```

If split payments are needed later, replace this with an explicit payment allocation model and transaction-time checks.

### 5. Idempotency Must Be Transactional

The idempotency table exists, but the semantics need to be implemented.

Required flow for money-moving requests:

1. `BEGIN`
2. Insert or lock the idempotency row with `FOR UPDATE`.
3. Compare request hash.
4. Execute the money operation.
5. Store response status and response body.
6. `COMMIT`

If the same idempotency key is reused with a different request body, return `409 Conflict`.

### 6. Audit Events Need Stronger Metadata

Audit logging exists, but financial events need stronger correlation fields.

Add:

```text
request_id NOT NULL
idempotency_key
metadata JSONB
```

Audit events should be written in the same transaction as:

- order creation
- wallet debit
- wallet top-up
- wallet adjustment
- payment
- refund
- void
- product price change
- permission change
- customer/student mapping change

### 7. Migration Runner Needs Production Guardrails

The migration runner currently checks `schema_migrations`, then applies files. If multiple production API instances start at the same time, they can race.

Recommended changes:

- Use `pg_advisory_lock` around migration execution.
- In production, prefer running migrations as a separate deploy step instead of automatically on every API boot.

## First Safe Backend Slice

Build one atomic wallet sale endpoint first:

```text
POST /v1/orders/wallet-sale
```

Required behavior:

- Authenticated actor scoped to `organization_id` and `store_id`.
- Requires `Idempotency-Key`.
- Validates all products belong to the same organization and store.
- Locks wallet with `SELECT ... FOR UPDATE`.
- Calculates totals server-side from product snapshots.
- Inserts order.
- Inserts immutable order items.
- Inserts payment.
- Inserts wallet transaction.
- Updates wallet balance.
- Inserts audit event.
- Returns receipt payload.
- Commits all writes together or rolls all writes back.

Do not start with separate `create unpaid order` and `pay order` endpoints unless the full order state machine is implemented at the same time.

## Implementation Plan

### Phase 1: Backend Foundation

1. Add module/shared folder structure.
2. Add request ID middleware.
3. Add structured error helpers.
4. Add DB transaction helper.
5. Add tenant/auth placeholder middleware.
6. Add idempotency helper.
7. Add audit helper.
8. Add migration advisory lock.

### Phase 2: Schema Hardening

1. Add composite tenant foreign keys.
2. Add status/type/currency checks.
3. Add immutable ledger triggers.
4. Add duplicate successful payment protection.
5. Add stronger audit fields.
6. Add `updated_at` to mutable operational tables.
7. Add users, roles, store assignments, and service credentials.

### Phase 3: Core Admin APIs

1. Organizations.
2. Stores.
3. Product categories.
4. Products.
5. Customers.
6. Wallet accounts.
7. Wallet top-ups and adjustments.

### Phase 4: Atomic Sale Flow

1. Implement `POST /v1/orders/wallet-sale`.
2. Add receipt projection.
3. Add tests for insufficient funds.
4. Add tests for duplicate idempotency key.
5. Add tests for cross-tenant IDs.
6. Add tests for duplicate payment.
7. Add rollback tests.

### Phase 5: Cashier UI

1. Product search.
2. Cart.
3. Customer lookup.
4. Wallet balance.
5. Pay with wallet.
6. Receipt view.

### Phase 6: Production Safeguards

1. Real auth and RBAC.
2. CSRF protection for cookie-authenticated browser writes.
3. Rate limiting on login, wallet, payment, refund, and webhook routes.
4. CI checks.
5. Deployment docs.
6. Backup and restore runbook.
7. Incident runbooks for duplicate charge, failed webhook, wallet mismatch, and refund correction.

## Build Priority

The next implementation should not start with more UI or cloud infrastructure.

The next implementation should harden the backend foundation:

```text
module structure
request IDs
transaction helper
idempotency helper
tenant-safe schema
immutable ledger
audit helper
wallet-sale endpoint
```

That gives the project a safe base before real payment, wallet, cashier, and parent-facing flows are added.
