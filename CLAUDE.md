# CLAUDE.md - Commerce POS

This file is for AI agents and developers picking up the Commerce POS codebase. Read it before writing code.

## Product Summary

Commerce POS is a standalone commerce and point-of-sale SaaS product. It began as a school cafeteria/student wallet idea but is now its own service, sold to schools, restaurants, and retail businesses.

It supports:

- Cafeteria POS with wallet, cash, and card checkout
- Student wallets with credit limits and guardian top-up
- Uniform/book/supply sales
- School marketplace listings
- Fee and event sales
- Guardian (parent) portal with purchase notifications
- Future restaurant and retail customers

The Spelling App owns education data. Commerce POS owns commerce data. Integration happens through APIs, service tokens, and external ID mappings.

---

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
│   │   │   ├── ai/              ← closeout summaries, anomaly alerts, forecasts, reorder, guardian digest
│   │   │   ├── cashDrawers/
│   │   │   ├── customers/
│   │   │   ├── demo/
│   │   │   ├── fees/            ← fee assignment CRUD + register pay flow
│   │   │   ├── guardians/       ← guardian CRUD + guardian portal auth + notification prefs
│   │   │   ├── integrations/
│   │   │   ├── inventory/       ← inventory.routes.js (stock, suppliers, invoices, transfers)
│   │   │   │                       inventoryAI.routes.js (AI extraction, drafts, corrections)
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
│   │       ├── email/           ← Resend client, receipt email, invite/magic-link builders
│   │       ├── http/
│   │       └── idempotency/
│   ├── scripts/
│   │   └── create-admin.js      ← one-time super_admin seed script
│   └── test/
├── web/
│   └── app/
│       ├── parent/              ← guardian portal (magic-link auth, balance, history, notif prefs)
│       └── fees/                ← fee assignment management (manager+)
├── docs/
│   ├── ai-feature-strategy.md
│   ├── api-endpoint-reference.md ← full curl/Postman reference for all endpoints
│   ├── competitive-paymon.md
│   ├── deployment.md            ← infrastructure runbook (DO, DNS, Resend email setup)
│   ├── multi-tenant-isolation-audit-2026-06-14.md ← security audit + all fixes applied
│   ├── sso-strategy.md
│   ├── student-credential-model.md
│   ├── testing-process.md       ← test strategy, coverage priorities, CI gates
│   └── student-pos-integration-diagrams.md
├── .do/app.yaml                 ← DigitalOcean App Platform spec
├── .github/workflows/
│   ├── ci.yml                   ← syntax check + web build on all branches
│   └── deploy.yml               ← auto-deploy to DO on main push
└── docker-compose.yml
```

---

## Current Status

### Backend

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
- **Inventory receiving v2** — supplier directory CRUD, invoice lifecycle (draft→approved), invoice line items with product snapshots, location transfers, receiving history; pg_trgm fuzzy product matching (migration 030/031)
- **Customer name split** — `first_name`, `middle_name`, `last_name_1`, `last_name_2` columns with backfill (migrations 028/029); Spanish naming convention support
- **AI inventory extraction** — Claude vision + PDF extraction for supplier invoices; 3-stage product matching (exact SKU → corrections table → pg_trgm fuzzy); draft review UI; approve creates invoice + updates stock; learning loop via `commerce_ai_inventory_corrections` (migration 032)
- Cash drawer sessions with open/current/list/close endpoints and cash-sale tracking
- Order list/detail endpoints
- Full-order refund and partial refund endpoints
- Student Educational app integration endpoints
- Student credential issuance, resolution, and revocation
- Idempotency helper, audit helper, immutable wallet transaction trigger
- API integration tests
- **AI module** — Closeout Summary, Anomaly Alerts, Sales Forecast, Inventory Reorder, Guardian Spending Digest, Usage tracking (see AI section below)
- **Email module** — Resend-powered transactional email; receipt emails route to linked guardians; fire-and-forget via `setImmediate`
- **Guardian module** — guardian CRUD, guardian-student links, guardian portal with magic-link OTP auth, notification preferences (`email_on_purchase`, `low_balance_threshold_cents`)
- **Fee assignments module** — pre-assigned charges (field trips, fees), collectible at register via wallet/cash/card
- **Category permissions** — staff can be restricted to specific product categories; zero rows = unrestricted
- **Platform admin guard** — only `platform_admin`, `super_admin`, `service` roles can create new organizations
- **Organization contact email** — `contact_email` field on each org; used as `Reply-To` on receipt emails so parents reply directly to the school
- **Organization feature toggles** — `features` JSONB column on `commerce_organizations`; enforced by `featureGate.js` middleware; platform admins always bypass; toggled via `PATCH /v1/organizations/:id/features`
- **Cost-of-goods (COGS) tracking** — nullable `cost_cents` on products; snapshotted as `unit_cost_cents` on order items at sale time; reports surface `cogsCents`, `grossProfitCents`, and `marginPct` per product
- **Family code system** — `family_code` string on both `commerce_customers` (students) and `commerce_guardians`; CSV import of guardians auto-links to matching students via `commerce_guardian_students`; schools assign codes during student enrollment and include them in CSV imports (no parent action required)
- **Multi-tenant security hardening** — dual-layer enforcement (application `authorizeTenant()` + SQL `AND organization_id = $N`); fixed cross-org vulnerabilities in guardians, staff, inventory invoices, and AI usage; see `docs/multi-tenant-isolation-audit-2026-06-14.md`
- **Role permission strings** — `inventory:read` and `inventory:write` added to `rolePermissions` map for `organization_admin`, `store_manager`, `cashier` (read-only), `accountant` (read-only), and `service`

### Infrastructure

- Docker-first dev workflow (api + web + postgres)
- Multi-stage production Dockerfiles for api and web
- DigitalOcean App Platform spec at `.do/app.yaml` (~$25/month)
- GitHub Actions CI (`ci.yml`) — syntax check + web build on all branches
- GitHub Actions deploy (`deploy.yml`) — auto-deploy to DO on push to main
- Production + email (Resend + notify.fransolution.net) runbook at `docs/deployment.md`
- DNS records for `notify.fransolution.net` live in AWS Route 53

### Frontend

- Route-level modular POS frontend with role-filtered navigation (numeric `ROLE_LEVEL` map)
- Cashier register with live product tiles, category filters, stock badges, POS customer search, Student app search, NFC reader, cash/card/wallet checkout, receipt, signed student wallet balance, pending fees panel
- Register UI split into POS-specific components under `web/app/register/`
- Live Products admin route — products tab + categories tab (create/edit categories, assign products); product form includes optional cost price field for COGS tracking
- Live inventory route with manager stock receiving/adjustments; 4-tab Receive Stock wizard (AI Invoice Upload, Manual Entry, Transfers, AI Learning/Corrections)
- Orders route with receipt detail, line items, wallet impact, inventory impact, full and partial refunds
- Payments route with cash drawer open/close and expected-vs-counted variance
- Settings route — org profile (name, type, currency, tax, contact email) + stores list
- Organizations route — platform-level org CRUD (super_admin only for creation)
- Staff route — create/edit staff with role, store assignments, and category access restrictions
- Fees route (`/fees`) — create fee assignments, assign to students, cancel fees (manager+)
- Reports route — tabbed layout: "Financial Reports" (summary metrics, payment breakdown, product sales with COGS/margin columns) and "AI Insights" (Anomaly Alerts, Sales Forecast, Reorder Recommendations, Closeout Summaries, Guardian Digest trigger)
- **Guardian portal** (`/parent`) — mobile-optimized parent view with magic-link login, wallet balances, purchase history per student, notification preferences toggle
- Student app preview route for balance and POS transaction history
- Print CSS for 72mm receipt printing

Current live local URLs:

```text
API: http://localhost:4100
Web: http://localhost:3100
```

The web app is also exposed via a Traefik reverse proxy (running on a local edge VM) at:

```text
https://pos.home.jerrycastro.dev  →  http://192.168.1.30:3100
```

Traefik is a plain pass-through (no caching). Both URLs hit the same Next.js dev server.

**Browser cache gotcha:** HTTPS sites cache JS bundles more aggressively than direct IP access. If a code change appears on `192.168.1.30:3100` but not on `pos.home.jerrycastro.dev`, the fix is a hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) or clearing site cache on the FQDN — not a code or server issue.

---

## Running Locally

```bash
cp .env.example .env
# fill in RESEND_API_KEY, ANTHROPIC_API_KEY, CLOUDINARY_* if needed
docker compose up --build
```

Docker Compose runs:

```text
api: npm run dev   (node --watch)
web: npm run dev -- -H 0.0.0.0
```

Both services use bind mounts — edits under `api/` and `web/` are reflected immediately.

Apply migrations when needed:

```bash
docker compose exec api npm run migrate
```

Run tests:

```bash
cd api && npm test
```

Build web:

```bash
cd web && npm run build
```

Create the platform super_admin (one-time):

```bash
docker compose exec api node scripts/create-admin.js
# uses ADMIN_EMAIL, ADMIN_NAME, ADMIN_PIN env vars
```

---

## API Patterns

Success: `{ "data": {} }`
Error: `{ "error": "Message" }`

Money-moving requests require: `Idempotency-Key: unique-client-key`

## Endpoints

```text
# Auth (staff)
POST  /v1/auth/login
POST  /v1/auth/logout
GET   /v1/auth/me

# Guardian portal (parent-facing, separate session cookie)
GET   /v1/guardian-portal/org/:orgId          ← public, org info for login page
POST  /v1/guardian-portal/auth/request        ← send OTP magic-link email
POST  /v1/guardian-portal/auth/verify         ← verify OTP → session cookie
POST  /v1/guardian-portal/auth/accept-invite  ← accept invite token → session cookie
POST  /v1/guardian-portal/auth/logout
GET   /v1/guardian-portal/me                  ← guardian + linked students + notif prefs
PATCH /v1/guardian-portal/me/notifications    ← update emailOnPurchase, lowBalanceThreshold
GET   /v1/guardian-portal/students/:id/transactions

# Demo (local only)
POST  /v1/demo/school
GET   /v1/demo/school

# Organizations
GET   /v1/organizations
POST  /v1/organizations                       ← platform_admin / super_admin only
PATCH /v1/organizations/:id                   ← includes contact_email
PATCH /v1/organizations/:id/features         ← toggle feature flags (platform_admin / super_admin only)

# Stores
GET   /v1/stores?organizationId=...
POST  /v1/stores

# Products
GET   /v1/products?organizationId=...&storeId=...&includeInactive=true
POST  /v1/products
PATCH /v1/products/:id

# Product categories
GET   /v1/product-categories?organizationId=...
POST  /v1/product-categories
PATCH /v1/product-categories/:id

# Customers & Wallets
GET   /v1/customers?organizationId=...
POST  /v1/customers
POST  /v1/customers/import/preview            ← CSV preview (multipart, includes family_code col)
POST  /v1/customers/import/apply              ← CSV apply (multipart, upserts on external_id)
GET   /v1/wallets/:id?organizationId=...
POST  /v1/wallets/:id/top-up

# Guardians
GET   /v1/guardians?organizationId=...
POST  /v1/guardians
PATCH /v1/guardians/:id
POST  /v1/guardians/:id/invite                ← sends invite email to guardian
GET   /v1/guardians/:id/students
POST  /v1/guardians/:id/students              ← link student to guardian
DELETE /v1/guardians/:id/students/:studentId
POST  /v1/guardians/import/preview            ← CSV preview (multipart, shows studentsLinked count)
POST  /v1/guardians/import/apply              ← CSV apply (upserts guardians + auto-links via family_code)

# Fee assignments
GET   /v1/fee-assignments?organizationId=...&customerId=...&status=...
POST  /v1/fee-assignments
PATCH /v1/fee-assignments/:id                 ← cancel
POST  /v1/fee-assignments/:id/pay             ← collect at register (wallet/cash/card)

# Orders
POST  /v1/orders/wallet-sale
POST  /v1/orders/paid-sale
POST  /v1/orders/:id/refund
POST  /v1/orders/:id/partial-refund
GET   /v1/orders?organizationId=...
GET   /v1/orders/:id?organizationId=...

# Cash Drawers
GET   /v1/cash-drawers?organizationId=...
GET   /v1/cash-drawers/current?organizationId=...&storeId=...&registerName=...
POST  /v1/cash-drawers/open
POST  /v1/cash-drawers/:id/close              ← triggers AI closeout summary async

# Inventory — stock
GET   /v1/inventory?organizationId=...&storeId=...
POST  /v1/inventory/:productId/adjustments

# Inventory — suppliers
GET   /v1/inventory/suppliers?organizationId=...
POST  /v1/inventory/suppliers
PATCH /v1/inventory/suppliers/:id

# Inventory — invoices (receiving)
GET   /v1/inventory/invoices?organizationId=...&storeId=...&status=...
POST  /v1/inventory/invoices                        ← create draft invoice
GET   /v1/inventory/invoices/:id
PATCH /v1/inventory/invoices/:id
POST  /v1/inventory/invoices/:id/approve            ← approve → updates stock + writes movements
GET   /v1/inventory/invoices/:id/lines

# Inventory — transfers
GET   /v1/inventory/transfers?organizationId=...
POST  /v1/inventory/transfers
GET   /v1/inventory/transfers/:id

# Inventory — history
GET   /v1/inventory/history?organizationId=...&storeId=...&productId=...

# Inventory — settings
GET   /v1/inventory/settings?organizationId=...
PATCH /v1/inventory/settings

# Inventory — AI extraction (route prefix: /inventory/ai, registered BEFORE /inventory)
POST  /v1/inventory/ai/extract                      ← multipart: image or PDF, storeId, supplierId
GET   /v1/inventory/ai/drafts?organizationId=...&status=...
GET   /v1/inventory/ai/drafts/:id
POST  /v1/inventory/ai/drafts/:id/approve           ← creates invoice, updates stock, saves corrections
POST  /v1/inventory/ai/drafts/:id/reject
GET   /v1/inventory/ai/corrections?organizationId=...
POST  /v1/inventory/ai/corrections                  ← manual correction add
DELETE /v1/inventory/ai/corrections/:id

# Wallets — transactions
GET   /v1/wallets/:id/transactions?organizationId=...

# Staff
GET   /v1/staff?organizationId=...
POST  /v1/staff
PATCH /v1/staff/:id
PUT   /v1/staff/:id/stores                    ← set store assignments
GET   /v1/staff/:id/category-permissions
PUT   /v1/staff/:id/category-permissions      ← set allowed categories (empty = unrestricted)

# Student Credentials
GET   /v1/student-credentials?organizationId=...
POST  /v1/student-credentials/issue
POST  /v1/student-credentials/resolve
POST  /v1/student-credentials/:credentialId/revoke

# Student App Integration
GET   /v1/integrations/student-app/students/search?q=...
POST  /v1/integrations/student-app/students
GET   /v1/integrations/student-app/students/:externalStudentId/cafeteria

# AI Features
GET   /v1/ai/summaries?organizationId=...&storeId=...&status=...
GET   /v1/ai/summaries/:id?organizationId=...
POST  /v1/ai/summaries
PATCH /v1/ai/summaries/:id
GET   /v1/ai/alerts?organizationId=...&status=...
GET   /v1/ai/alerts/:id?organizationId=...
POST  /v1/ai/alerts/scan                ← accepts dateFrom/dateTo
PATCH /v1/ai/alerts/:id
GET   /v1/ai/forecast?organizationId=...
POST  /v1/ai/forecast                   ← 7-day forecast from date range history
GET   /v1/ai/reorder?organizationId=...
POST  /v1/ai/reorder                    ← reorder suggestions from inventory + sales velocity
POST  /v1/ai/guardian-digest            ← sends AI-written digest emails to guardians (admin+)
GET   /v1/ai/usage                      ← token/cost breakdown, platform admin only

# Reports
GET   /v1/reports/summary?organizationId=...&dateFrom=...&dateTo=...
```

---

## Auth Model

### Staff auth

PIN login with browser sessions (`commerce_browser_sessions`). PBKDF2 hash of PIN stored in `commerce_users`.

Roles (numeric level for nav filtering):

| Role | Level | Access |
|---|---|---|
| `cashier` | 1 | Register, own orders |
| `accountant` | 1 | Read-only finance |
| `store_manager` | 2 | + Inventory, fees, staff view |
| `organization_admin` | 3 | + Settings, products, customers |
| `organization_owner` | 3 | Same as admin |
| `super_admin` | 4 | All orgs, platform config |
| `platform_admin` | 4 | Same as super_admin |
| `service` | 4 | Service-to-service token |

Local development uses a dev actor fallback when `NODE_ENV !== "production"`. Optional headers: `x-actor-user-id`, `x-actor-service`, `x-actor-role`, `x-organization-id`.

Database auth tables: `commerce_users`, `commerce_user_store_assignments`, `commerce_service_tokens`, `commerce_browser_sessions`.

### Guardian (parent) auth

Separate magic-link OTP flow. No PIN. Issues its own HTTP-only session cookie (`guardian_portal_session`). Middleware: `requireGuardianSession` in `guardianAuth.js`. Tables: `commerce_guardians`, `commerce_guardian_magic_links`, `commerce_guardian_sessions`.

---

## Email System

Transactional email via **Resend** from `notify.fransolution.net` (subdomain — does not affect Google Workspace MX on root domain).

Shared helpers in `api/src/shared/email/`:

| File | Purpose |
|---|---|
| `emailClient.js` | Resend SDK wrapper; `sendEmail()`, `buildInviteEmail()`, `buildMagicLinkEmail()` |
| `receiptEmail.js` | `sendReceiptEmail()` — routes to linked guardians with `email_on_purchase: true`; falls back to customer email if no guardians |

Rules:
- Silently skips (logs warning) if `RESEND_API_KEY` is not set — never throws.
- Always fires via `setImmediate` after the transaction commits — never blocks a sale.
- Guardian `notification_prefs.email_on_purchase` (JSONB, default `true`) controls opt-in/out.
- Organization `contact_email` is set as `Reply-To` so parents reply to the school.

Required env vars:

```text
RESEND_API_KEY=re_...
EMAIL_FROM=Commerce POS <noreply@notify.fransolution.net>
```

---

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

---

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
015_ai_records.sql
016_employees_and_payroll.sql
017_customer_home_location.sql
018_guardians.sql                   ← commerce_guardians, guardian_students, magic_links, sessions
019_avatar_public_ids.sql
020_product_category_enhancements.sql
021_category_permissions.sql        ← commerce_user_category_permissions
022_fee_assignments.sql             ← commerce_fee_assignments
023_organization_contact_email.sql  ← contact_email column on commerce_organizations
024_ai_cost_tracking.sql            ← cost_microdollars BIGINT on commerce_ai_records
025_ai_new_features.sql             ← adds guardian_digest, sales_forecast to source_type check
026_org_features.sql                ← features JSONB column on commerce_organizations
027_cost_tracking.sql               ← cost_cents on products, unit_cost_cents on order items
028_customer_name_split.sql         ← first_name, middle_name, last_name_1, last_name_2 on commerce_customers
029_backfill_customer_name_split.sql ← best-effort backfill from legacy `name` column (Mexican convention)
030_inventory_receiving.sql         ← pg_trgm extension; commerce_inventory_suppliers; suppliers UNIQUE index
031_inventory_receiving_enhancements.sql ← created_by/updated_at on invoices; ai_extracted_text/confidence/match_status on invoice lines; transfers updated_at
032_inventory_ai.sql                ← commerce_inventory_ai_drafts; commerce_ai_inventory_corrections
```

Do not edit already-applied migrations. Add a new numbered migration for schema changes.

---

## Frontend Direction

Route-level modular Next.js app. Navigation is filtered by numeric role level — only routes the current user's role can reach are rendered.

```text
/dashboard          — all staff
/register           — cashier+
/orders             — cashier+
/inventory          — manager+
/products           — admin+  (products tab + categories tab)
/customers          — manager+
/payments           — manager+  (cash drawer)
/fees               — manager+  (fee assignment management)
/reports            — manager+  (AI summaries + anomaly alerts)
/staff              — admin+    (create/edit staff, store assignments, category access)
/settings           — admin+    (org profile, contact email, tax, stores)
/organizations      — super_admin only

/parent             — guardian portal (separate auth, magic-link)
/parent/login
/parent/dashboard
/parent/student/[id]

/student-demo       — demo/preview
/register-login     — cashier PIN login screen
```

Register-specific frontend files:

```text
web/app/register/RegisterClient.tsx
web/app/register/ProductCatalog.tsx
web/app/register/StudentSelector.tsx
web/app/register/CartPanel.tsx       ← includes pending fees panel
web/app/register/ReceiptPreview.tsx
web/app/register/registerUtils.ts
web/app/register/types.ts
```

Inventory receiving wizard (`/inventory` → Receive Stock tab):

```text
web/app/inventory/receiving/ReceivingClient.tsx   ← 4-tab wizard: AI Upload | Manual | Transfers | AI Learning
```

Tabs:
- **AI Invoice Upload** — drag-and-drop image/PDF, sends multipart to `POST /inventory/ai/extract`, shows editable review table with confidence badges (green ≥90%, amber ≥70%, red <70%), product picker for unmatched lines, approve/reject buttons
- **Manual Entry** — traditional manual stock receiving
- **Transfers** — inter-location inventory transfer
- **AI Learning (N)** — view/delete/add `commerce_ai_inventory_corrections`; shows use count badges; corrections teach the AI which extracted text maps to which product

Shared types for AI inventory:

```text
web/app/lib/demoTypes.ts   ← AIDraft, AIDraftLine, AICorrection types added
```

Tenant-first rule:
- All routes load data scoped to the signed-in staff member's organization.
- Super admin can see/manage all organizations.
- Stage/prod must set `DISABLE_DEMO_SEED=true`.

---

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

---

## Known Gaps

**Auth / Access**
- Store assignment enforcement is incomplete — cashier/manager endpoints don't yet reject cross-store requests.
- No formal order void workflow or manager approval rules.
- Dev actor fallback (`x-actor-*` headers) must be removed before first live school goes on prod — replace with a seeded test credential.
- Production GitHub Secret `DATABASE_URL` has a typo (`ostgresql://` instead of `postgresql://`) — `pg` library tolerates it but `psql` CLI rejects it; needs to be fixed in GitHub Secrets before switching to CLI-based migrations.

**Register / POS**
- Card checkout is recorded as a payment method only; no card provider or terminal integration yet.
- Demo seed creates products but no stores — register shows empty catalog for Demo Academy until a store is created.

**Payments / Finance**
- Stripe wallet top-up not yet integrated (Stripe Mexico supports MXN, OXXO, SPEI).
- No parent-facing wallet top-up flow from the guardian portal.

**Guardian / Parent platform**
- No spending controls, allergen blocking, or product category blocking at POS.
- No pre-ordering or meal subscriptions.
- Low-balance alert email not yet triggered (threshold is stored, but the alert send logic is not wired).
- Guardian invite flow sends email; guardian must click link to activate portal access. Family code linking happens at CSV import time — no retroactive re-linking after import.

**AI Features**
- Anomaly detection runs on-demand only — no scheduled cron wired yet.
- Requires `ANTHROPIC_API_KEY` in `.env`; without it endpoints return empty results gracefully.
- AI inventory extraction requires `CLOUDINARY_*` env vars; upload silently skipped if missing.
- AI extraction `pdf-parse` v2.4.5 must be imported as `await import("pdf-parse/lib/pdf-parse.js")` to avoid test-detection code in the library.

**Multi-tenant security**
- Store assignment enforcement is incomplete at the API layer — cashier/manager endpoints don't yet reject requests for stores they're not assigned to (tracked in Build Priority).
- All cross-org object access vulnerabilities identified in the 2026-06-14 audit have been patched.

**Full-school payments**
- No event ticketing, marketplace module, or transport/fee billing beyond the basic fee assignments module.

---

## AI Features

The AI system is live. Read `docs/ai-feature-strategy.md` for product strategy and `docs/api-endpoint-reference.md` for full endpoint reference.

**Model:** `claude-haiku-4-5` (replaces retired `claude-haiku-3-5-20241022`). Cost ~$0.001 per call.
**Cost tracking:** `cost_microdollars` stored on every `commerce_ai_records` row. Visible only to platform admins via `GET /v1/ai/usage`.

### Operational AI (reports module)

- **Daily Closeout Summary** — fires automatically (fire-and-forget via `setImmediate`) when `POST /v1/cash-drawers/:id/close` commits. Aggregates 6 SQL queries, hashes the facts, calls AI, stores in `commerce_ai_records`.
- **Anomaly Alerts** — on-demand scan via `POST /v1/ai/alerts/scan`. Accepts `dateFrom`/`dateTo`. Runs 4 SQL rules; LLM only called when a rule fires. Returns "not enough data" message to UI when rules produce no hits.
- **Sales Forecast** — on-demand via `POST /v1/ai/forecast`. Analyzes daily sales history for the selected date range; projects next 7 days with trend, confidence, and key insights.
- **Inventory Reorder Assistant** — on-demand via `POST /v1/ai/reorder`. Finds products below reorder threshold or with <7 days of stock based on 30-day sales velocity; returns prioritized reorder list with suggested quantities.
- **Guardian Spending Digest** — admin-triggered via `POST /v1/ai/guardian-digest`. Generates and emails a personalized weekly spending summary to each guardian with notifications enabled. Uses Resend.
- **Reports UI** — `/reports` shows all five AI sections: Anomaly Alerts, Forecast, Reorder, Guardian Digest trigger, and Closeout Summaries.

### AI Inventory Extraction (inventory/ai module)

- **Invoice Extraction** — `POST /v1/inventory/ai/extract` accepts multipart image (JPEG/PNG — Claude vision base64) or PDF (pdf-parse text extraction). Uploads original file to Cloudinary (`orgs/{orgId}/invoices/`, `resource_type: raw` for PDFs). Calls Claude to extract supplier name, invoice number, date, and line items. Each line goes through 3-stage product matching: exact SKU → org corrections table → pg_trgm fuzzy similarity. Returns a draft.
- **Draft Review** — manager reviews extracted lines in UI, edits quantities/costs, selects correct product for unmatched lines, can skip lines. Approve blocked until all lines matched or skipped.
- **Draft Approval** — `POST /v1/inventory/ai/drafts/:id/approve` runs inside `withTransaction`: creates invoice + lines, locks inventory rows `FOR UPDATE`, increments stock quantities, optionally updates product `cost_cents` from invoice unit cost, saves corrections via UPSERT.
- **Learning Loop** — each approved match upserts a row in `commerce_ai_inventory_corrections` (org-scoped). Future extractions load corrections first and inject them as few-shot hints in Claude's system prompt. `use_count` increments on each reuse.
- **Corrections Management** — `GET/POST/DELETE /v1/inventory/ai/corrections` for manager CRUD. "AI Learning" tab in UI shows all corrections with use counts; high-use corrections badge green.

Architecture rules:
- AI outputs live only in `commerce_ai_records` (operational AI) or `commerce_inventory_ai_drafts` (extraction AI). AI never writes directly to financial or inventory tables.
- Aggregation is always deterministic SQL first. AI summarizes or extracts; SQL computes totals and updates stock.
- Every AI record and draft is scoped by `organization_id`. Never query across tenants.
- Operational AI status lifecycle: `pending → draft → reviewed` or `dismissed`.
- Extraction draft lifecycle: `pending → approved` or `rejected`.
- Cloudinary env vars required for AI extraction: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

---

## Competitive Context

Primary competitor in the Latin American private school market is **Paymon** (paymon.io).
Full intelligence report at `docs/competitive-paymon.md`.

Key data: Paymon charges ~$6,700 MXN/month (~$370 USD) per school on annual contracts + 2.9% transaction fee. Hardware (Android POS terminal) is $2,800 MXN one-time.

Paymon moats: parental control depth (allergen blocking, category blocking, day-of-week limits, pre-ordering, real-time notifications) and hardware diversity (QR + NFC wristband + NFC card + fingerprint).
Paymon gaps: no US market, no SIS integrations, cashless-only, annual contracts only, no partial refunds, no multi-school group management.

Our positioning: transparent flat-rate or school-absorbs-fee model, month-to-month pilot commitments, cash + card + wallet mixed payments, guardian notification prefs already live.

---

## Build Priority

**Immediate (operator hardening):**
1. ~~Staff creation/management UI~~ **Done**
2. ~~Multi-tenant security audit + fixes~~ **Done** — `docs/multi-tenant-isolation-audit-2026-06-14.md`
3. Enforce store assignments for cashier/store-manager at every endpoint
4. Add formal void workflow and manager approval rules
5. Remove dev actor fallback (`x-actor-*` headers) before first live school
6. ~~Production deployment runbook~~ **Done** — `docs/deployment.md`
7. Fix `DATABASE_URL` typo in GitHub Secrets (`ostgresql://` → `postgresql://`)

**AI Inventory:**
8. ~~AI invoice extraction (image + PDF) with draft review wizard~~ **Done**
9. ~~Learning loop corrections table + UI~~ **Done**
10. Wire AI inventory extraction feature flag (`ai_inventory_extraction`) via `featureGate.js`

**Guardian platform (compete with Paymon):**
7. Parent wallet top-up from guardian portal (Stripe MXN / OXXO / SPEI)
8. Low-balance alert email (threshold already stored in `notification_prefs`)
9. Per-day spending limits and product/category blocking at POS
10. Allergen registration per student + block at POS sale time
11. Pre-ordering: parent reserves a meal for a future date

**Full-school payments:**
11. Event ticketing and fee collection beyond basic fee assignments
12. Marketplace module for uniforms, books, supplies
13. Transport/extracurricular fee billing

**Compliance and nutrition:**
14. Operator-side allergen tagging on products
15. Dietary restriction enforcement at POS

**Positioning vs. Paymon:**
16. Fee model configuration: org chooses to absorb or disclose processing cost
17. Multi-school group dashboard for school chains
18. Hardware agnosticism docs: NFC, QR, fingerprint, username — no proprietary terminal required

Keep the system simple, transaction-safe, and cheap to deploy until real scale requires more infrastructure.
