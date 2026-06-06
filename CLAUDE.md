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
│   │   │   ├── ai/              ← closeout summaries + anomaly alerts
│   │   │   ├── cashDrawers/
│   │   │   ├── customers/
│   │   │   ├── demo/
│   │   │   ├── integrations/
│   │   │   ├── inventory/
│   │   │   ├── orders/
│   │   │   ├── organizations/
│   │   │   ├── products/
│   │   │   ├── reports/
│   │   │   ├── staff/
│   │   │   ├── stores/
│   │   │   ├── studentCredentials/
│   │   │   └── wallets/
│   │   └── shared/
│   │       ├── ai/              ← Anthropic SDK client, prompt builders
│   │       ├── audit/
│   │       ├── auth/
│   │       ├── http/
│   │       └── idempotency/
│   └── test/
├── web/
│   └── app/
├── docs/
│   ├── ai-feature-strategy.md
│   ├── competitive-paymon.md
│   ├── deployment.md
│   └── sso-strategy.md
├── .do/app.yaml                 ← DigitalOcean App Platform spec
├── .github/workflows/
│   ├── ci.yml                   ← syntax check + web build on all branches
│   └── deploy.yml               ← auto-deploy to DO on main push
├── commerce-pos-service.md
└── docker-compose.yml
```

## Current Status

Implemented:

**Backend**
- Express API scaffold with health/readiness endpoints, request IDs, rate limiting
- Postgres migrations with advisory lock
- Core commerce schema + financial schema hardening
- Browser PIN login/session flow with cashier, manager, admin, super-admin roles
- Organization, store, product, customer, wallet endpoints
- Product image URL field for register/catalog display
- Wallet top-up endpoint
- Atomic wallet-sale endpoint
- Paid cash/card sale endpoint
- Wallet credit-line support with negative balances allowed only up to the configured limit
- Inventory table, adjustment endpoint, low-stock API state, sale-driven stock decrement
- Inventory receiving workflows, CSV import review, location transfers
- Cash drawer sessions with open/current/list/close endpoints and cash-sale tracking
- Order list/detail endpoints
- Full-order refund and partial refund endpoints
- Student Educational app integration endpoints
- Student credential issuance, resolution, and revocation
- Idempotency helper, audit helper, immutable wallet transaction trigger
- API integration tests
- **AI module** — Daily Closeout Summary + Anomaly Alerts (see AI section below)

**Infrastructure**
- Docker-first dev workflow (api + web + postgres)
- Multi-stage production Dockerfiles for api and web
- DigitalOcean App Platform spec at `.do/app.yaml` (~$25/month)
- GitHub Actions CI (`ci.yml`) — syntax check + web build on all branches
- GitHub Actions deploy (`deploy.yml`) — auto-deploy to DO on push to main
- Production deployment runbook at `docs/deployment.md`

**Frontend**
- Route-level modular POS frontend
- Cashier register with live product tiles, category filters, stock badges, POS customer search, Student app search, NFC reader, cash/card/wallet checkout, receipt, signed student wallet balance
- Register UI split into POS-specific components under `web/app/register/`
- Live Products admin route (create/update catalog items)
- Live inventory route with manager stock receiving/adjustments
- Orders route with receipt detail, line items, wallet impact, inventory impact, full and partial refunds
- Payments route with cash drawer open/close and expected-vs-counted variance
- Settings route — live org profile form (name, type, currency, tax settings) + stores list
- Organizations route — full CRUD for platform-level org management
- Reports route with AI Closeout Summaries and AI Anomaly Alerts sections
- Student app preview route for balance and POS transaction history
- Print CSS for 72mm receipt printing

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

Current endpoints:

```text
# Auth
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/me

# Demo (local only)
POST /v1/demo/school
GET  /v1/demo/school

# Organizations
GET  /v1/organizations
POST /v1/organizations
PATCH /v1/organizations/:id

# Stores
GET  /v1/stores?organizationId=...
POST /v1/stores

# Products
GET  /v1/products?organizationId=...&storeId=...&includeInactive=true
POST /v1/products
PATCH /v1/products/:id

# Customers & Wallets
GET  /v1/customers?organizationId=...
POST /v1/customers
GET  /v1/wallets/:id?organizationId=...
POST /v1/wallets/:id/top-up

# Orders
POST /v1/orders/wallet-sale
POST /v1/orders/paid-sale
POST /v1/orders/:id/refund
POST /v1/orders/:id/partial-refund
GET  /v1/orders?organizationId=...
GET  /v1/orders/:id?organizationId=...

# Cash Drawers
GET  /v1/cash-drawers?organizationId=...
GET  /v1/cash-drawers/current?organizationId=...&storeId=...&registerName=...
POST /v1/cash-drawers/open
POST /v1/cash-drawers/:id/close   ← also triggers AI closeout summary async

# Inventory
GET  /v1/inventory?organizationId=...&storeId=...
POST /v1/inventory/:productId/adjustments

# Student Credentials
GET  /v1/student-credentials?organizationId=...
POST /v1/student-credentials/issue
POST /v1/student-credentials/resolve
POST /v1/student-credentials/:credentialId/revoke

# Student App Integration
GET  /v1/integrations/student-app/students/search?q=...
POST /v1/integrations/student-app/students
GET  /v1/integrations/student-app/students/:externalStudentId/cafeteria

# AI Features
GET  /v1/ai/summaries?organizationId=...&storeId=...&status=...
GET  /v1/ai/summaries/:id?organizationId=...
POST /v1/ai/summaries                         ← manually trigger for a drawer session
PATCH /v1/ai/summaries/:id                    ← mark reviewed / dismissed
GET  /v1/ai/alerts?organizationId=...&status=...
GET  /v1/ai/alerts/:id?organizationId=...
POST /v1/ai/alerts/scan                       ← run anomaly rules + generate alerts
PATCH /v1/ai/alerts/:id                       ← mark reviewed / dismissed

# Reports
GET  /v1/reports/summary?organizationId=...&dateFrom=...&dateTo=...
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

Migrations applied in order:

```text
001_core_schema.sql
002_harden_financial_schema.sql
003_auth_rbac_foundation.sql
004_wallet_credit_lines.sql
005_customer_external_id.sql
006_inventory_foundation.sql
007_cash_drawer_sessions.sql
008_product_image_url.sql
009_super_admin_role.sql
010_inventory_receiving_workflows.sql
011_inventory_transfers_and_import_apply.sql
012_student_credentials.sql
013_browser_auth_sessions.sql
013_currency_and_tax_settings.sql   ← same prefix as above, applied after
014_partial_refunds.sql
015_ai_records.sql                   ← commerce_ai_records table for AI drafts/alerts
```

The database now includes:

- Core commerce tables
- Composite tenant foreign key hardening
- Status/type/currency checks
- One successful payment per order protection
- Immutable wallet transaction triggers
- Auth/RBAC foundation tables
- Wallet credit limits and negative-balance checks
- Inventory items, movements, receiving, and transfers
- Cash drawer sessions/events for register closeout
- Product image URLs for POS tile/catalog display
- Student credentials (NFC, QR, PIN issuance and resolution)
- Browser session auth
- Currency and tax settings per organization
- Partial refund tracking on order items
- AI draft/alert records (tenant-scoped, never touched by financial writes)

Do not edit already-applied migrations. Add a new numbered migration for schema changes.

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

**Auth / Access**
- No staff creation/management UI yet (staff must be created via API or demo seed).
- Store assignment enforcement is incomplete — cashier/manager endpoints don't yet reject cross-store requests.
- No formal order void workflow or manager approval rules.

**AI Features**
- AI features require `ANTHROPIC_API_KEY` in `.env` — without it, the API will log a startup warning but the endpoints return empty results gracefully.
- Anomaly detection runs on-demand (`POST /v1/ai/alerts/scan`) or must be scheduled externally. No pg-boss cron wired yet.
- When installing `@anthropic-ai/sdk` on a fresh dev container, run `docker compose exec api npm install @anthropic-ai/sdk` after rebuilding the image, since the anonymous volume preserves the old node_modules.

**Register / POS**
- Demo seed (`GET /v1/demo/school`) creates products but currently no stores — register will show an empty catalog for the demo org until a store is created and products are assigned to it.
- Card checkout is recorded as a payment method only; no card provider or terminal integration yet.

**Payments / Finance**
- Stripe wallet top-up not yet integrated (Stripe Mexico supports MXN, OXXO, SPEI).
- No parent-facing wallet top-up flow.

**Parental platform** (next major product surface)
- No spending controls, allergen blocking, or product category blocking at POS.
- No parent purchase notifications (email/webhook).
- No pre-ordering or meal subscriptions.

**Full-school payments**
- No event ticketing, marketplace module, or transport/fee billing.

**Other**
- No offline-mode POS capability.
- No nutrition/allergen compliance tools.
- No multi-school group dashboard.

## AI Features

The AI system is implemented and live. Read `docs/ai-feature-strategy.md` for the full
product strategy, pitch sequence, and marketing rationale.

### What is built

- **Daily Closeout Summary** — triggered automatically (fire-and-forget) when
  `POST /v1/cash-drawers/:id/close` commits. Aggregates 6 SQL queries into a facts
  object, hashes it, calls Claude Haiku 3.5, stores the result in `commerce_ai_records`.
  Cost: ~$0.00073 per summary.

- **Anomaly Alerts** — on-demand scan via `POST /v1/ai/alerts/scan`. Runs 4 SQL rules
  (high refund rate per cashier, drawer variance >$10, outlier wallet top-ups, unaccounted
  inventory drops). LLM is only called when at least one rule fires. Results stored in
  `commerce_ai_records`.

- **Reports UI** — `/reports` page shows both sections: AI Anomaly Alerts (with severity
  badges and dismiss/review actions) and AI Closeout Summaries (prose paragraph with flags).

### Architecture rules (follow exactly)

- AI outputs are stored in `commerce_ai_records` only. AI never writes to financial tables.
- Aggregation is always deterministic SQL first. AI only summarizes pre-computed facts.
- The drawer close transaction must not be blocked by AI generation. Use `setImmediate`.
- Dedup by `input_hash` — if the same drawer session is summarized twice with unchanged
  facts, return the cached record without calling the API again.
- Every AI record is scoped by `organization_id`. Never query across tenants.
- Status lifecycle: `pending → draft → reviewed` or `dismissed`. Managers review; they
  never auto-apply AI output to financial records.

### Required environment variable

```text
ANTHROPIC_API_KEY=sk-ant-...   # from console.anthropic.com
```

Add to `.env` locally and set as a secret in the DO dashboard for production.

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

1. Add staff creation/management UI (name, PIN, role, store assignments).
2. Enforce store assignments for cashier/store-manager roles at every endpoint.
3. Add formal void workflow and manager approval rules.
4. Harden Student Educational app service-token integration.
5. ~~Add production deployment and backup/restore docs.~~ **Done** — see `docs/deployment.md`.
6. Fix demo seed to create stores so the register works for the Demo Academy org.

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
