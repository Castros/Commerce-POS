# AGENTS.md - Commerce POS

Read this before changing code in this repository.

## What This Project Is

Commerce POS is a separate product/service for:

- School cafeteria POS
- Student wallets
- Uniforms, books, supplies, fees, and marketplace sales
- Future restaurant and retail POS use cases
- API-based integration back to the Spelling App

This is intentionally separate from the educational spelling app. Do not move POS ownership back into the spelling app or expand legacy `cafeteria_*` concepts there.

## Current Architecture

The project is a modular monolith:

```text
api/                 Express API, raw SQL, migrations
web/                 Next.js operator/admin UI
docs/                Product, architecture, security, and API docs
docker-compose.yml   Local Postgres/API/web stack
```

Keep wallet, order, and payment writes inside one API/database transaction. Do not split those into separate services yet.

## Current Working Model

The backend already supports:

- Create organization
- Create store
- Create product
- Product image URL support for register/catalog tiles
- Product create/update admin flow for register catalog items
- Create customer
- Create wallet
- Top up wallet
- Atomic wallet sale through `POST /v1/orders/wallet-sale`
- Paid cash/card sale through `POST /v1/orders/paid-sale`
- Wallet credit-line support, including negative balances up to the configured limit
- Inventory records, low-stock state, adjustments, and sale-driven stock decrement
- Idempotency replay without double charging
- Insufficient funds/credit-limit rejection
- Immutable wallet ledger trigger
- Basic auth/RBAC foundation
- Demo school seed endpoint for cafeteria/student-wallet demos
- Order list/detail reads
- Order receipt detail with line items, wallet impact, and inventory impact
- Full-order refunds that reverse wallet payments, sale inventory movements, and open cash drawer expected cash
- Cash drawer sessions for opening, recording cash sales, and closeout variance
- Student Educational app integration endpoints for student wallet lookup

The web app now has route-level POS modules on `http://localhost:3100`.
`/register` is the first working cashier demo route. It server-loads the demo
school/store/product context, shows touch-friendly product image tiles with cafeteria
category filters, does not preload fake students into the cashier flow, searches the
Student Educational app by matricula/name/email through the POS API, and supports
cash, credit/card, and wallet checkout. When a student is selected, the
cashier UI shows only the student and a signed wallet balance: positive balances are
shown green, negative balances are shown red, and credit-limit blocking is surfaced
only when the sale would exceed the configured limit.
`/student-demo` shows the student/parent-facing balance and recent cafeteria
transactions from the same Commerce POS backend.
`/inventory` reads live inventory from the API, supports manager stock
receiving/adjustments, and shows stock levels that change when the register completes
paid or wallet sales.
`/products` reads and edits live catalog data for the demo school, including product
name, SKU, description, image URL, price, taxable state, and active/inactive state.
`/orders` supports clickable receipt lookup with line items, payment details, wallet
balance-after, inventory decrement details, receipt reprint, and full-order refund.
`/payments` now includes the cash drawer workflow for `Lunch Line 02`: open drawer,
cash sales attach automatically, and closeout shows counted-vs-expected variance.

## Local Development

```bash
cp .env.example .env
docker compose up --build
```

Useful ports:

```text
API:      http://localhost:4100
Web:      http://localhost:3100
Postgres: localhost:5434
```

Local API calls use a development actor fallback when `NODE_ENV !== "production"`.

The Docker Compose setup is the default development workflow. The `api` and `web`
services use bind mounts, so local code edits are reflected in running containers.
Use `docker compose up -d api web` after the database is healthy. Do not start the
Next dev server directly on the host unless the user explicitly asks for a non-Docker
workflow.

Production writes require:

```text
Authorization: Bearer $COMMERCE_API_TOKEN
```

## Verification Commands

Run these before handing off meaningful backend changes:

```bash
cd api
DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos npm run migrate
npm test
```

For frontend changes:

```bash
cd web
npm run build
```

Container verification:

```bash
docker compose ps
curl -sS http://localhost:4100/health
curl -sS -I http://localhost:3100
```

Repo-wide quick checks:

```bash
git diff --check
for f in $(find api/src api/test -name '*.js' -print); do node --check "$f" || exit 1; done
```

## Backend Conventions

- No ORM.
- Use raw SQL through `pg`.
- Use UUID primary keys.
- Use integer cents for money, never floating point money.
- Use `{ data: ... }` for success responses.
- Use `{ error: "message" }` for error responses.
- Keep all money-moving work inside `withTransaction`.
- Use `Idempotency-Key` for money-moving endpoints.
- Wallet balances may be negative only within the wallet `credit_limit_cents`.
- Always scope tenant-owned queries by `organization_id`.
- Do not look up tenant data by bare UUID alone.
- Write audit events in the same transaction as financial changes.
- Do not mutate wallet ledger rows.

## Module Pattern

Backend modules should follow this shape:

```text
routes.js        HTTP parsing and response shape only
schemas.js       zod validation when the module grows
service.js       business rules and transaction orchestration
repo.js          SQL only, always tenant-scoped
events.js        audit/webhook event creation when needed
```

Current modules:

```text
organizations
stores
products
customers
wallets
orders
demo
integrations/student-app
```

Expected next modules:

```text
auth
inventory
payments
receipts
reports
integrations
cashDrawers
```

## Database Rules

Migrations live in:

```text
api/src/db/migrations/
```

Migrations must be safe to run once in order through `schema_migrations`.

Financial schema expectations:

- Composite tenant foreign keys where possible.
- `CHECK` constraints for statuses, types, and currency.
- Immutable wallet transaction trigger.
- Duplicate successful payment protection.
- Audit metadata for financial operations.
- Advisory lock around migrations.

## Current Docs

Read these before architecture or money-flow changes:

- `docs/architecture-security.md`
- `docs/agent-architecture-review.md`
- `docs/api-working-model.md`
- `docs/frontend-working-model.md`
- `commerce-pos-service.md`

## What Not To Do

- Do not store raw card data, CVV, or payment credentials.
- Do not use floats for money.
- Do not add a payment/card flow without provider signature verification and idempotency.
- Do not bypass `organization_id` scoping.
- Do not hard-delete financial records.
- Do not update or delete wallet ledger records.
- Do not show detailed credit math in the cashier UI; show the selected student's signed balance and only warn when blocked.
- Do not create unpaid-order plus pay-order flows until the full order state machine is designed.
- Do not split into microservices or add queues/Redis/Kubernetes until there is real need.
- Do not put SQL directly into large route handlers for money flows.

## Near-Term Direction

The next build direction is:

1. Continue extracting register-specific components from `/register`.
2. Add reports for daily sales, product sales, payment methods, and drawer variance.
3. Add real user login/session flow.
4. Add stronger store assignment enforcement for cashiers and managers.
5. Add richer inventory history, receiving references, and supplier metadata.
6. Add partial refunds, formal voids, and manager approval rules.
7. Add printable receipt formatting.
8. Harden Student Educational app service-token integration.
9. Add production deployment docs and backup/restore runbook.
