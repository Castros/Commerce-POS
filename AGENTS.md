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
- Supplier records, receiving invoices, CSV inventory import review, receipt extraction drafts, and location transfers
- Idempotency replay without double charging
- Insufficient funds/credit-limit rejection
- Immutable wallet ledger trigger
- Browser PIN login/session flow with cashier, manager, admin, and super-admin roles
- Student NFC/card/bracelet credential issuance and register credential resolution
- Demo school seed endpoint for local-only cafeteria/student-wallet demos, disabled in stage/prod
- Order list/detail reads
- Order receipt detail with line items, wallet impact, and inventory impact
- Full-order refunds that reverse wallet payments, sale inventory movements, and open cash drawer expected cash
- Cash drawer sessions for opening, recording cash sales, and closeout variance
- Student Educational app integration endpoints for student wallet lookup

The web app now has route-level POS modules on `http://localhost:3100`.
`/register` is the first working cashier route. It loads the signed-in staff
organization, assigned/first store, and that store's product catalog. It does not
create demo data or preload fake students. Cashiers search POS customers, search the
Student Educational app by matricula/name/email through the POS API, or connect a Web
Serial NFC reader and tap a card/bracelet. Cash, credit/card, and wallet checkout are
supported. When a student is selected, the cashier UI shows only the student and a
signed wallet balance: positive balances are shown green, negative balances are shown
red, and credit-limit blocking is surfaced only when the sale would exceed the
configured limit.
`/student-demo` shows the student/parent-facing balance and recent cafeteria
transactions from the same Commerce POS backend.
`/inventory` reads live inventory from the API, supports manager stock
receiving/adjustments, and shows stock levels that change when the register completes
paid or wallet sales.
`/products` reads and edits live catalog data for the current organization/store,
including product name, SKU, description, image URL, price, taxable state, and
active/inactive state.
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

## Tenant-First Stage Rule

Build and demo the system as one hosted POS serving multiple school organizations.
Every school trial gets its own organization, one or more cafeteria/store locations,
staff accounts, products/menus, inventory, students/customers, wallets, credentials,
and settings.

- Do not auto-create demo, seed, test, or placeholder records from normal UI routes.
- Use `GET /v1/organizations?scope=mine` and the helpers in
  `web/app/lib/organizationContext.ts` for normal staff/admin pages.
- Use assigned stores for cashiers/managers where available.
- Keep `/v1/demo/school` local-only and set `DISABLE_DEMO_SEED=true` in stage/prod.
- Super admin can configure the organization and all stores; admins/managers/cashiers
  must be scoped by role and store assignment.
- Automated tests must run against a dedicated test database, never the shared stage DB.

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

## Competitive Context

The primary competitor in the Latin American private school market is **Paymon** (paymon.io).
Read `docs/competitive-paymon.md` before designing new features — it contains confirmed
pricing, feature inventory, and gap analysis from a real sales proposal (March 2026).

**Pricing reference:** Paymon charges ~$6,700 MXN/month per school on a full school-year
contract + 2.9% on card/transfer payments (passable to parents) + $2,800 MXN for a
proprietary Android POS terminal. They are pre-breakeven at 110 schools.

**Their moats to match:** parental controls (allergen blocking, product blocking, spending
limits, pre-ordering, notifications), hardware diversity (NFC + QR + fingerprint).

**Their gaps to exploit:** no US market, cashless-only, annual lock-in, no SIS
integrations, no partial refunds, no multi-school group management, 2.9% passed to parents.

## Near-Term Direction

### Operator foundation (do first)

1. Add real user login/session flow with staff creation UI.
2. Enforce store assignment scoping for cashiers and managers at every endpoint.
3. Add formal order void workflow and manager approval rules.
4. Harden Student Educational app service-token integration.
5. Add production deployment docs and backup/restore runbook.

### Parental platform (next major product surface)

These features are Paymon's deepest competitive moat. Build them as a dedicated
`parents` module with its own auth layer (parents are not staff — separate credential
and session model).

6. **Parent wallet top-up** — parent-facing endpoint to add funds via card or bank
   transfer. Idempotent, audited, emits wallet ledger row. Fee model is organization-
   configured: school absorbs, or explicit disclosed fee — never silently passed through.
7. **Purchase notifications** — email or webhook fired inside the same transaction as a
   wallet sale. Parent receives: student name, item(s) bought, amount charged, balance after.
8. **Spending controls** — `commerce_wallet_spending_rules` table: per-wallet rules for
   daily max spend, per-day-of-week max, blocked product IDs, blocked category names.
   POS enforces rules at sale time before charging wallet — same transaction, same
   FOR UPDATE lock on wallet row.
9. **Allergen registration** — `commerce_customer_allergens` table linking customer to
   allergen codes. Products tagged with matching allergen codes are blocked at wallet
   sale time; cashier sees a clear warning. Does not block cash/card sales (parent
   consent model — wallet is the controlled payment method).
10. **Parent purchase history** — read endpoint scoped to a parent credential, returning
    wallet transactions with item snapshots. No new data — already in
    `commerce_wallet_transactions` + `commerce_order_items`.
11. **Pre-ordering** — `commerce_pre_orders` table: customer, store, date, items,
    status (pending → fulfilled → cancelled). Cashier marks pickup at register.
    Pre-orders decrement inventory at fulfilment, not at creation.
12. **Meal subscriptions** — recurring wallet top-up schedule: amount, frequency
    (weekly/monthly), active flag. Background job or cron fires top-up and emails parent.

### Full-school payments (expansion wedge — same strategy Paymon is executing)

13. Event ticketing and fee collection.
14. Marketplace module (uniforms, books, supplies).
15. Transport and extracurricular fee billing.

### Compliance features

16. **Operator allergen tagging** — `allergens` array on `commerce_products`. Linked to
    parental allergen blocks in #9. Visible in register tile tooltip.
17. **Dietary restriction enforcement** — warn or block at POS when student has a
    restriction that matches a cart item. Manager-override PIN to bypass.

### Positioning features (directly against Paymon)

18. **Fee transparency config** — `fee_model` on organization: `school_absorbs` or
    `disclosed_to_parent`. When `disclosed_to_parent`, top-up endpoint returns the fee
    amount explicitly and requires client acknowledgement before charging.
19. **Multi-school group dashboard** — super admin view aggregating revenue, active
    students, and drawer status across all organizations. School chains need this.
20. **Hardware integration docs** — document NFC wristband, NFC card, QR code, fingerprint,
    and username/PIN as supported student identification methods. None require proprietary
    terminals; all use the existing `student-credentials` resolution endpoint.

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
parents          ← new: parental controls, top-ups, notifications, pre-orders
subscriptions    ← new: recurring wallet top-up plans
events           ← new: ticketing, fees, marketplace
```
