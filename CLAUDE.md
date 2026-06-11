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
│   │   │   ├── ai/              ← closeout summaries + anomaly alerts
│   │   │   ├── cashDrawers/
│   │   │   ├── customers/
│   │   │   ├── demo/
│   │   │   ├── fees/            ← fee assignment CRUD + register pay flow
│   │   │   ├── guardians/       ← guardian CRUD + guardian portal auth + notification prefs
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
│   ├── competitive-paymon.md
│   ├── deployment.md            ← infrastructure runbook (DO, DNS, Resend email setup)
│   ├── sso-strategy.md
│   ├── student-credential-model.md
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
- Cash drawer sessions with open/current/list/close endpoints and cash-sale tracking
- Order list/detail endpoints
- Full-order refund and partial refund endpoints
- Student Educational app integration endpoints
- Student credential issuance, resolution, and revocation
- Idempotency helper, audit helper, immutable wallet transaction trigger
- API integration tests
- **AI module** — Daily Closeout Summary + Anomaly Alerts (see AI section below)
- **Email module** — Resend-powered transactional email; receipt emails route to linked guardians; fire-and-forget via `setImmediate`
- **Guardian module** — guardian CRUD, guardian-student links, guardian portal with magic-link OTP auth, notification preferences (`email_on_purchase`, `low_balance_threshold_cents`)
- **Fee assignments module** — pre-assigned charges (field trips, fees), collectible at register via wallet/cash/card
- **Category permissions** — staff can be restricted to specific product categories; zero rows = unrestricted
- **Platform admin guard** — only `platform_admin`, `super_admin`, `service` roles can create new organizations
- **Organization contact email** — `contact_email` field on each org; used as `Reply-To` on receipt emails so parents reply directly to the school

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
- Live Products admin route — products tab + categories tab (create/edit categories, assign products)
- Live inventory route with manager stock receiving/adjustments
- Orders route with receipt detail, line items, wallet impact, inventory impact, full and partial refunds
- Payments route with cash drawer open/close and expected-vs-counted variance
- Settings route — org profile (name, type, currency, tax, contact email) + stores list
- Organizations route — platform-level org CRUD (super_admin only for creation)
- Staff route — create/edit staff with role, store assignments, and category access restrictions
- Fees route (`/fees`) — create fee assignments, assign to students, cancel fees (manager+)
- Reports route with AI Closeout Summaries and AI Anomaly Alerts sections
- **Guardian portal** (`/parent`) — mobile-optimized parent view with magic-link login, wallet balances, purchase history per student, notification preferences toggle
- Student app preview route for balance and POS transaction history
- Print CSS for 72mm receipt printing

Current live local URLs:

```text
API: http://localhost:4100
Web: http://localhost:3100
```

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

# Inventory
GET   /v1/inventory?organizationId=...&storeId=...
POST  /v1/inventory/:productId/adjustments

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
POST  /v1/ai/alerts/scan
PATCH /v1/ai/alerts/:id

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

**AI Features**
- Anomaly detection runs on-demand only — no scheduled cron wired yet.
- Requires `ANTHROPIC_API_KEY` in `.env`; without it endpoints return empty results gracefully.

**Full-school payments**
- No event ticketing, marketplace module, or transport/fee billing beyond the basic fee assignments module.

---

## AI Features

The AI system is live. Read `docs/ai-feature-strategy.md` for product strategy and marketing rationale.

- **Daily Closeout Summary** — fires automatically (fire-and-forget via `setImmediate`) when `POST /v1/cash-drawers/:id/close` commits. Aggregates 6 SQL queries, hashes the facts, calls Claude Haiku 3.5, stores result in `commerce_ai_records`. Cost: ~$0.00073 per summary.
- **Anomaly Alerts** — on-demand scan via `POST /v1/ai/alerts/scan`. Runs 4 SQL rules; LLM only called when a rule fires.
- **Reports UI** — `/reports` shows both: AI Anomaly Alerts (severity badges, dismiss/review) and AI Closeout Summaries.

Architecture rules:
- AI outputs live only in `commerce_ai_records`. AI never writes to financial tables.
- Aggregation is always deterministic SQL first. AI summarizes pre-computed facts.
- Every AI record is scoped by `organization_id`. Never query across tenants.
- Status lifecycle: `pending → draft → reviewed` or `dismissed`.

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
2. Enforce store assignments for cashier/store-manager at every endpoint
3. Add formal void workflow and manager approval rules
4. Remove dev actor fallback (`x-actor-*` headers) before first live school
5. ~~Production deployment runbook~~ **Done** — `docs/deployment.md`

**Guardian platform (compete with Paymon):**
6. Parent wallet top-up from guardian portal (Stripe MXN / OXXO / SPEI)
7. Low-balance alert email (threshold already stored in `notification_prefs`)
8. Per-day spending limits and product/category blocking at POS
9. Allergen registration per student + block at POS sale time
10. Pre-ordering: parent reserves a meal for a future date

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
