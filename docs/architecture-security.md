# Commerce/POS Architecture and Security Design

## Goals

Build the Commerce/POS product as a separate service that can start small, stay inexpensive, and still be safe enough to handle money.

The design should support:

- School cafeteria POS
- Student wallets
- Uniforms, books, supplies, fees, and marketplace sales
- Future restaurant and retail use cases
- API integration back to the Spelling App
- Low operational cost during pilot
- A clean path to stricter production controls

## Recommended Architecture

Start with a modular monolith, not many microservices.

```text
commerce-pos
├── api
│   ├── routes
│   ├── modules
│   │   ├── organizations
│   │   ├── stores
│   │   ├── products
│   │   ├── inventory
│   │   ├── customers
│   │   ├── wallets
│   │   ├── orders
│   │   ├── payments
│   │   ├── receipts
│   │   ├── reports
│   │   └── integrations
│   ├── db
│   │   ├── client
│   │   └── migrations
│   └── app
├── web
├── docs
└── docker-compose.yml
```

This keeps deployment cheap and simple while still enforcing strong module boundaries in code. The payment and wallet logic can later be extracted if volume or compliance pressure requires it.

## Cloud Deployment Path

### Phase 1: Pilot / Low Cost

Use one API container, one web container, and managed Postgres.

```text
User browser
  -> HTTPS load balancer / platform router
  -> Web app
  -> API service
  -> Managed Postgres
  -> Payment provider
```

Recommended options:

- API/web: Render, Fly.io, Railway, Google Cloud Run, AWS App Runner, or a small VPS with Docker
- Database: managed Postgres with automated backups
- File/object storage: only if receipts or exports need durable files
- Email/SMS: external provider only when needed
- Payments: Stripe, Square, or another provider with hosted/card-tokenized flows

Avoid Kubernetes, service meshes, event buses, and multi-database complexity until there is real traffic or compliance need.

### Phase 2: Production Hardening

Add:

- Separate production database
- Read replica only if reports become expensive
- Background worker for webhooks, reports, exports, and retries
- Redis only if needed for rate limiting, job queues, or short-lived locks
- Central log aggregation
- Error tracking
- Uptime checks
- Point-in-time recovery

### Phase 3: Scale

Split only where the system earns it:

- API service
- Worker service
- Reporting/export service
- Payment webhook processor
- Optional read model for analytics

Do not split wallet/order/payment writes across services early. Money movement is safer when the transactional write path stays small and local.

## Database Strategy

Use Postgres as the source of truth. Keep all financial state changes inside database transactions.

Required rules:

- Use UUID primary keys.
- Store money as integer minor units, such as cents, instead of floating point or `NUMERIC` in application code.
- Keep currency on all money-bearing records.
- Use append-only ledger rows for wallet transactions.
- Never update historical order items, payment records, or wallet transaction records except for controlled status transitions.
- Use database constraints for invariants.
- Use row-level tenant scoping in every query, even if application auth already scoped the user.

Recommended money columns:

```sql
amount_cents BIGINT NOT NULL
currency TEXT NOT NULL DEFAULT 'USD'
```

This is safer than `NUMERIC(10,2)` in application logic because it avoids rounding ambiguity.

## Transaction Design for Money

The most important safeguard is atomicity. An order paid by wallet should be one transaction:

1. Lock the wallet account row with `SELECT ... FOR UPDATE`.
2. Confirm the wallet is active and belongs to the same organization.
3. Confirm the available balance is enough.
4. Insert the order.
5. Insert immutable order items with price/name snapshots.
6. Insert payment row.
7. Insert wallet transaction row.
8. Update wallet balance.
9. Mark order as paid.
10. Commit.

If any step fails, the whole transaction rolls back.

Required database constraints:

- Wallet balance cannot go below zero unless an explicit overdraft feature exists.
- Order totals must equal item totals plus tax minus discounts.
- Payment total cannot exceed payable order balance unless overpayment handling exists.
- A wallet transaction must have a resulting `balance_after`.
- Refunds must reference the original order or payment.
- Voids/refunds must be status transitions, not deletion.

## Idempotency

All money-moving endpoints must support idempotency keys.

Required for:

- Create order
- Pay order
- Wallet top-up
- Refund
- Void
- External payment webhook handling

Pattern:

```text
POST /orders
Idempotency-Key: client-generated-uuid
```

Store:

```text
organization_id
idempotency_key
request_hash
response_status
response_body
created_at
expires_at
```

Unique constraint:

```text
organization_id + idempotency_key
```

If the same key is reused with a different request body, return `409 Conflict`.

## Payment Provider Boundary

Keep PCI scope low.

Do not store:

- Raw card numbers
- CVV
- Magnetic stripe data
- Full payment credentials

Use hosted checkout, payment links, terminal SDKs, or tokenized payment methods from the provider. Store only:

- Provider name
- Provider payment intent/charge ID
- Last 4 digits if returned by provider
- Card brand if returned by provider
- Status
- Amount
- Currency
- Provider timestamps

Webhook handling must:

- Verify provider signatures.
- Be idempotent.
- Store raw event metadata in a restricted audit table.
- Never trust the client to mark a card payment as successful.

## Authentication and Authorization

Use role-based access with organization and store scoping.

Core roles:

```text
platform_admin
organization_owner
organization_admin
store_manager
cashier
accountant
parent
customer
service
```

Rules:

- Every request is scoped to an organization.
- Store-scoped users can only access assigned stores.
- Cashiers can create sales but cannot edit products, issue large refunds, or adjust wallet balances.
- Refunds, voids, and manual wallet adjustments require elevated permissions.
- Service-to-service integration uses dedicated service credentials, not human user sessions.
- Parent/customer access should only expose their own linked customers, wallets, orders, and marketplace visibility.

## Tenant Isolation

Every primary business table should include `organization_id` unless it is truly global.

Use query patterns that always include `organization_id`:

```sql
WHERE organization_id = $1 AND id = $2
```

Avoid looking up by `id` alone. UUIDs are not authorization.

For school integrations, keep external references nullable and scoped:

```text
external_school_id
external_student_id
external_parent_id
external_source
```

The POS service owns commerce data. The Spelling App owns education data.

## Audit and Compliance Controls

Add audit logs from the first implementation.

Audit events should record:

- Actor user/service ID
- Organization ID
- Store ID when relevant
- Action
- Target entity type and ID
- Before/after summary for sensitive changes
- IP address
- User agent
- Request ID
- Timestamp

Audit required for:

- Login/logout
- Permission changes
- Product price changes
- Inventory adjustments
- Cashier session open/close
- Orders
- Payments
- Refunds
- Voids
- Wallet top-ups
- Wallet adjustments
- Customer/student mapping changes

Do not allow hard deletes for financial records. Use `active`, `voided`, `refunded`, or archived states.

## Cashier Sessions

Cash payments need shift controls.

Add:

```text
commerce_cashier_sessions
commerce_cash_drawer_events
```

Session fields:

```text
id
organization_id
store_id
cashier_user_id
opened_at
closed_at
opening_cash_cents
expected_cash_cents
counted_cash_cents
variance_cents
status
```

This allows reconciliation between cash sales, refunds, paid-outs, and counted drawer cash.

## Inventory Safety

Inventory should be adjusted through ledger-style movements, not only a mutable count.

Add:

```text
commerce_inventory_movements
```

Movement types:

```text
sale
refund
restock
manual_adjustment
transfer_in
transfer_out
spoilage
correction
```

The current quantity can be stored for speed, but movement rows explain why it changed.

## Performance Design

Keep the hot POS path simple:

- Product search by organization/store/category/name/SKU
- Cart pricing from current product rows
- Order payment in one transaction
- Receipt response generated immediately from order snapshots

Indexes needed early:

```sql
commerce_stores (organization_id, active)
commerce_products (organization_id, store_id, active)
commerce_products (organization_id, sku)
commerce_customers (organization_id, external_student_id)
commerce_wallet_accounts (organization_id, customer_id)
commerce_orders (organization_id, store_id, created_at DESC)
commerce_orders (organization_id, customer_id, created_at DESC)
commerce_payments (order_id)
commerce_wallet_transactions (wallet_account_id, created_at DESC)
commerce_audit_events (organization_id, created_at DESC)
```

Cost controls:

- Use server-side pagination for all lists.
- Avoid expensive reports on live POS tables during checkout traffic.
- Build daily summary tables only after reporting needs are clear.
- Cache read-heavy product catalog responses only if database load shows it is needed.
- Keep images in object storage, not the database.

## API Design

Use consistent responses:

```json
{ "data": {} }
```

Errors:

```json
{ "error": "Message" }
```

Core route groups:

```text
/organizations
/stores
/users
/products
/categories
/inventory
/customers
/wallets
/orders
/payments
/refunds
/receipts
/cashier-sessions
/marketplace
/reports
/integrations/spelling-app
```

Money-moving commands should be explicit:

```text
POST /orders
POST /orders/:id/pay
POST /orders/:id/void
POST /orders/:id/refund
POST /wallets/:id/topups
POST /wallets/:id/adjustments
```

Avoid generic `PATCH` for financial state transitions.

## Security Baseline

Required before production:

- HTTPS only
- Secure, HTTP-only cookies if browser sessions are used
- CSRF protection for cookie-authenticated browser writes
- CORS allowlist
- Request size limits
- Rate limiting for login, payment, wallet, and webhook endpoints
- Password hashing with Argon2id or bcrypt if local passwords exist
- MFA for admins and financial roles
- Secrets stored in cloud secret manager or platform env secrets
- No secrets committed to git
- Structured logs without sensitive payment/customer data
- Dependency scanning in CI
- Database backups tested by restore
- Least-privilege database user for application runtime
- Separate service token for Spelling App integration

## Data Privacy

Student and parent-linked data should be treated as sensitive.

Rules:

- Store only commerce-needed student/customer fields.
- Do not duplicate education records into POS.
- Mask customer identifiers in logs.
- Restrict exports to admin/accountant roles.
- Add retention policy for inactive customers, logs, and webhook payloads.
- Keep audit logs longer than operational logs.

## Integration With Spelling App

Use service-to-service APIs and mapping tables.

Recommended flow:

1. Spelling App creates or updates a school.
2. Commerce/POS creates an organization and school stores.
3. Spelling App requests customer mapping for student/parent.
4. Commerce/POS returns wallet/order/marketplace data through scoped APIs.
5. Commerce/POS emits webhooks for balance changes and paid orders if the Spelling App needs notifications.

Do not let the Spelling App write directly to POS tables.

## First Implementation Slice

Build in this order:

1. App shell, env config, health check, request IDs, logging.
2. Postgres connection and migrations.
3. Organizations and stores.
4. Products and categories.
5. Customers.
6. Wallet accounts and ledger transactions.
7. Orders and immutable order items.
8. Wallet payment transaction.
9. Receipt response.
10. Audit logging.
11. Idempotency table.
12. Basic admin/cashier web UI.

The first sale flow should support:

```text
Create organization
Create cafeteria store
Create products
Create customer
Create wallet
Top up wallet
Create order
Pay with wallet
Return receipt
Show wallet balance
```

## Decisions

- Use a modular monolith first.
- Use Postgres as the financial source of truth.
- Use integer cents for money.
- Use append-only wallet ledger records.
- Use idempotency keys for money movement.
- Use payment provider tokenized/hosted flows.
- Add audit logging from the start.
- Keep the Spelling App integration API-based.
- Avoid microservices and Kubernetes during pilot.

## Follow-Up Reviews

The engineering software architecture and backend architecture agent findings are documented in:

```text
docs/agent-architecture-review.md
```
