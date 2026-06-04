# CLAUDE.md - Commerce POS

This file is for AI agents and developers picking up the Commerce POS codebase. Read it before writing code.

## Product Summary

Commerce POS is a standalone commerce and point-of-sale product. It began as a school cafeteria/student wallet idea connected to the educational spelling app, but it is now its own service.

It should support:

- Cafeteria POS
- Student wallets
- Uniform/book/supply sales
- School marketplace listings
- Fees and event sales
- Future restaurant and retail customers

The Spelling App owns education data. Commerce POS owns commerce data. Integration should happen through APIs, service tokens, and external ID mappings.

## Repository Layout

```text
.
├── api/
│   ├── src/
│   │   ├── app.js
│   │   ├── server.js
│   │   ├── routes.js
│   │   ├── db/
│   │   │   ├── client.js
│   │   │   ├── migrate.js
│   │   │   ├── transaction.js
│   │   │   └── migrations/
│   │   ├── modules/
│   │   │   ├── organizations/
│   │   │   ├── stores/
│   │   │   ├── products/
│   │   │   ├── customers/
│   │   │   ├── wallets/
│   │   │   ├── orders/
│   │   │   ├── demo/
│   │   │   └── integrations/
│   │   └── shared/
│   │       ├── audit/
│   │       ├── auth/
│   │       ├── http/
│   │       └── idempotency/
│   └── test/
├── web/
│   └── app/
├── docs/
├── commerce-pos-service.md
└── docker-compose.yml
```

## Current Status

The first working backend model exists.

Implemented:

- Express API scaffold
- Next.js web scaffold
- Postgres migrations
- Migration advisory lock
- Request IDs
- Health and readiness endpoints
- Core commerce schema
- Financial schema hardening
- Browser PIN login/session flow with role-based actors
- Organization, store, product, customer, wallet endpoints
- Product image URL field for register/catalog display
- Wallet top-up endpoint
- Atomic wallet-sale endpoint
- Paid cash/card sale endpoint
- Wallet credit-line support with negative balances allowed only up to the configured limit
- Inventory table, adjustment endpoint, low-stock API state, and sale-driven stock decrement
- Cash drawer sessions with open/current/list/close endpoints and cash-sale tracking
- Order list/detail endpoints
- Demo school seed endpoint for local-only setup
- Student Educational app integration endpoints
- Idempotency helper
- Audit helper
- Immutable wallet transaction trigger
- API integration tests
- Docker-first dev workflow for API and web
- Route-level modular POS frontend
- Cashier register with live product image tiles, category filters, stock badges, POS customer search, Student app search, NFC reader selection, cash/card/wallet checkout, receipt, and signed student wallet balance
- Register UI split into POS-specific components under `web/app/register/`
- Live Products admin route for creating/updating catalog items used by the register
- Live inventory route backed by the Commerce POS API, including manager stock receiving/adjustments
- Orders route with clickable receipt detail, line items, wallet impact, and inventory impact
- Full-order refund endpoint and Orders UI action, reversing wallet balance, sale inventory movements, and open cash drawer expected cash
- Payments route with cash drawer open/close and expected-vs-counted variance
- Student app preview route for balance and POS transaction history
- Student Educational app API bridge for `/student/cafeteria` and `/parents/students/:studentId/cafeteria`
- Stitch design project for POS frontend exploration

Current live local URLs:

```text
API: http://localhost:4100
Web: http://localhost:3100
```

## Running Locally

```bash
cp .env.example .env
docker compose up --build
```

This project is currently Docker-first. The Compose file runs:

```text
api: npm run dev
web: npm run dev -- -H 0.0.0.0
```

Both services use bind mounts for local development, so edits under `api/` and `web/`
are reflected in the running containers.

Apply migrations manually when needed:

```bash
cd api
DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos npm run migrate
```

Run tests:

```bash
cd api
npm test
```

Build web:

```bash
cd web
npm run build
```

## API Patterns

Success:

```json
{ "data": {} }
```

Error:

```json
{ "error": "Message" }
```

Money-moving requests must use:

```text
Idempotency-Key: unique-client-key
```

The current wallet sale endpoint:

```text
POST /v1/orders/wallet-sale
```

It creates the order, item snapshots, wallet payment, wallet ledger row, wallet balance update, and audit event in one transaction.
Wallet balances can go negative only up to the wallet credit limit.

The current paid sale endpoint:

```text
POST /v1/orders/paid-sale
```

It creates a paid order for cash or card transactions without using a wallet. The
`card` method is only a recorded payment method in the current prototype; it is not
yet integrated with a real card provider or terminal.

The current full-order refund endpoint:

```text
POST /v1/orders/:id/refund
```

It requires an idempotency key, marks the paid order/payment as refunded, restores
sale-decremented inventory, refunds wallet payments back to the student wallet, and
reverses open cash drawer expected cash for cash sales. Cash refunds are rejected
after the drawer is closed.

Current demo and integration endpoints:

```text
POST /v1/demo/school   # local only; disabled in stage/prod
GET  /v1/demo/school   # local only; disabled in stage/prod
GET  /v1/auth/me
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/cash-drawers?organizationId=...
GET  /v1/cash-drawers/current?organizationId=...&storeId=...&registerName=...
POST /v1/cash-drawers/open
POST /v1/cash-drawers/:id/close
GET  /v1/inventory?organizationId=...&storeId=...
POST /v1/inventory/:productId/adjustments
GET  /v1/products?organizationId=...&storeId=...&includeInactive=true
POST /v1/products
PATCH /v1/products/:id
POST /v1/orders/paid-sale
POST /v1/orders/:id/refund
GET  /v1/student-credentials?organizationId=...
POST /v1/student-credentials/issue
POST /v1/student-credentials/resolve
POST /v1/student-credentials/:credentialId/revoke
GET  /v1/integrations/student-app/students/search?q=...
POST /v1/integrations/student-app/students
GET  /v1/integrations/student-app/students/:externalStudentId/cafeteria
GET  /v1/orders?organizationId=...
GET  /v1/orders/:id?organizationId=...
```

The Student Educational app now calls the integration route from its cafeteria views.
Keep the POS as the source of truth for new wallet balances and cafeteria
transactions, with the Student app's legacy `cafeteria_*` tables as fallback only.
Student lookup from the POS register is server-side only: Commerce POS uses
`SPELLING_APP_SERVICE_TOKEN`, which must match the Student app `INGESTION_SECRET`, to
call `/service/students`.

## Auth Model

Current auth supports staff PIN login with browser sessions.

Local development:

- Uses a dev actor fallback when `NODE_ENV !== "production"`.
- Optional headers: `x-actor-user-id`, `x-actor-service`, `x-actor-role`, `x-organization-id`.

Production/stage:

- Requires `Authorization: Bearer $COMMERCE_API_TOKEN`.
- Environment token is treated as a `service` actor.
- Browser UI users sign in through `/v1/auth/login` and receive an HTTP-only session
  cookie. Normal UI routes resolve actor organization, role, and store assignments from
  that session.

Database auth tables:

```text
commerce_users
commerce_user_store_assignments
commerce_service_tokens
```

Next auth work should add staff creation/update screens and stricter store-assignment
enforcement at every cashier/manager endpoint.

## Financial Safety Rules

Follow these exactly:

- Store all money in integer cents.
- Keep currency explicit. Current supported currency is `USD`.
- Use transactions for every money-moving flow.
- Use `SELECT ... FOR UPDATE` when changing wallet balances.
- Calculate totals server-side from product snapshots.
- Insert immutable order item snapshots.
- Insert wallet ledger rows; never mutate them later.
- Enforce `balance_cents + credit_limit_cents >= 0` for wallet sales.
- Write audit events inside the same transaction as financial writes.
- Use idempotency keys and request body hashes.
- Return replayed idempotent responses without repeating side effects.
- Reject reused idempotency keys with changed request bodies.

## Database Notes

Migrations:

```text
001_core_schema.sql
002_harden_financial_schema.sql
003_auth_rbac_foundation.sql
004_wallet_credit_lines.sql
006_inventory_foundation.sql
007_cash_drawer_sessions.sql
008_product_image_url.sql
```

The database now includes:

- Core commerce tables
- Composite tenant foreign key hardening
- Status/type/currency checks
- One successful payment per order protection
- Immutable wallet transaction triggers
- Auth/RBAC foundation tables
- Wallet credit limits and negative-balance checks
- Inventory items and immutable inventory movement history
- Cash drawer sessions/events for register closeout
- Product image URLs for POS tile/catalog display
- Audit metadata

Do not edit already-applied migrations casually. Add a new numbered migration for schema changes.

## Frontend Direction

The current web app has been split into route-level modules with a shared app shell,
headers, data table, status badge, API helpers, demo types, format helpers, and
register-specific components.

```text
/dashboard
/register
/orders
/inventory
/products
/customers
/payments
/reports
/staff
/settings
/student-demo
```

Register-specific frontend files:

```text
web/app/register/RegisterClient.tsx
web/app/register/ProductCatalog.tsx
web/app/register/StudentSelector.tsx
web/app/register/CartPanel.tsx
web/app/register/ReceiptPreview.tsx
web/app/register/registerUtils.ts
web/app/register/types.ts
```

`/register` loads the signed-in staff member's organization, assigned/first store, and
that store's product catalog. It does not auto-create demo data. Cashiers can search
POS customers, search the Student Educational app by matricula/name/email, or connect a
Web Serial NFC reader and tap a card/bracelet. The selected student display
intentionally shows only the student and a signed wallet balance: green for positive
balance, red for amount owed. Cash, credit/card, and wallet checkout are supported;
wallet checkout blocks when the sale would exceed the student's credit limit. Register
product tiles show images, category filters, and stock state. Completed sales decrement
tracked inventory in the same transaction as the order/payment.

Tenant-first stage rule:

- Normal UI routes must load data through the current staff organization, not
  `/demo/school`.
- Every school trial gets a separate organization, locations/stores, staff accounts,
  products/menus, inventory, students/customers, wallets, credentials, and settings.
- Super admin can configure all locations; admins/managers/cashiers are scoped by role
  and store assignment.
- Stage/prod must set `DISABLE_DEMO_SEED=true`.

Prioritize a working cashier flow over a marketing page.

Stitch frontend project:

```text
Commerce POS Frontend
Project ID: 13326238815075879327
Generated screens: Dashboard, Register, Inventory, Orders, Customers, Reports, Staff & Payments, Settings
```

## Verification Expectations

Before finalizing backend work:

```bash
git diff --check
for f in $(find api/src api/test -name '*.js' -print); do node --check "$f" || exit 1; done
cd api && npm test
```

Before finalizing frontend work:

```bash
cd web && npm run build
```

## Known Gaps

- No real user login/session UI yet.
- Register subcomponents exist; next extraction should split smaller tile/cart line/payment controls when behavior grows.
- Most non-register pages still use demo/static data, but Products, Inventory, Orders, Payments, Customers, Student Demo, and Register have live API-backed slices.
- Store assignment enforcement is not complete.
- Inventory receiving/manager UI is basic but functional; it can adjust stock and sales decrement stock.
- Cash drawer sessions are basic but functional.
- Partial refunds are implemented; formal void workflows and manager-approval rules are not yet implemented.
- Card checkout/refund is recorded as a payment method only; no card provider or terminal integration yet.
- Student app integration exists, but still needs service-token hardening and production webhook/event design.
- No production deployment/runbook docs yet.
- No CI pipeline yet.
- No parental controls layer (spending limits, product blocking, allergen flags, purchase notifications).
- No parent-facing wallet top-up flow (parents currently cannot add funds without staff involvement).
- No pre-ordering (parents reserving meals in advance for pickup).
- No meal subscription / recurring wallet top-up plans.
- No full-school payments beyond cafeteria (tuition, transport, events, marketplace).
- No loyalty or gamification mechanics for students.
- No offline-mode POS capability for unreliable WiFi environments.
- No nutrition compliance tools (USDA meal patterns, calorie tracking, allergen disclosure for operators).

## Competitive Context

Primary competitor in the Latin American private school market is **Paymon** (paymon.io).
Full intelligence report at `docs/competitive-paymon.md`.

Key pricing data point: Paymon charges ~$6,700 MXN/month (~$370 USD) per school on a
full school-year contract, plus a 2.9% transaction fee on card/transfer payments that
schools can pass to parents. Hardware (Android POS terminal) is $2,800 MXN one-time.

Paymon's deepest moats: parental control depth (allergen blocking, product blocking,
day-of-week spending limits, pre-ordering, real-time notifications) and hardware
diversity (QR + NFC wristband + NFC card + fingerprint). Their largest gaps: no US
market, no SIS integrations, cashless-only, annual contracts only, no partial refunds,
no multi-school group management, 2.9% passthrough fees to parents.

Positioning opportunity: transparent flat-rate or school-absorbs-fee model, month-to-month
or semester commitments for pilot schools, cash + card + wallet mixed payments, and a
parental controls layer that matches or exceeds Paymon's.

## Build Priority

Immediate next steps (operator foundation):

1. Add real auth/session flow with staff creation UI.
2. Enforce store assignments for cashier/store-manager roles.
3. Add formal void workflow and manager approval rules.
4. Harden Student Educational app service-token integration.
5. Add production deployment and backup/restore docs.

Parental platform (next major product surface — competes directly with Paymon's parent app):

6. Parent wallet top-up flow: parent-facing endpoint to add funds via card or bank transfer.
7. Real-time purchase notifications: email/webhook to parent when wallet is charged.
8. Parental spending controls: per-day spending limits, per-product/category blocking.
9. Allergen registration: flag allergens per student; block matching products at POS sale time.
10. Purchase history view for parents: what the child bought, when, how much spent.
11. Pre-ordering: parent reserves a specific meal for a future date; cashier marks pickup.
12. Meal subscriptions: recurring wallet top-up or pre-paid lunch plan for a period.

Full-school payments (expansion — same wedge Paymon is running):

13. Event ticketing and fee collection (field trips, school events, activity fees).
14. Marketplace module for uniforms, books, and supplies.
15. Transport/extracurricular fee billing.

Compliance and nutrition:

16. Operator-side allergen tagging on products (links to parental allergen blocks in #9).
17. Dietary restriction enforcement at POS: warn or block sale to flagged student.

Positioning features (against Paymon specifically):

18. Fee model configuration: organization chooses to absorb processing cost or disclose
    it explicitly to parents — never silently pass through.
19. Multi-school group dashboard for school chains and operators managing multiple campuses.
20. Hardware agnosticism docs: NFC wristband, NFC card, QR, fingerprint, username — all
    documented as supported input methods without requiring proprietary terminals.

Keep the system simple, transaction-safe, and cheap to deploy until real scale requires more infrastructure.
