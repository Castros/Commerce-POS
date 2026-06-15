# Testing Process

## Goal

Commerce POS handles tenant data, wallet balances, paid orders, refunds, inventory, cash
drawers, parent access, and AI-generated operational summaries. Testing must prove that
financial data remains correct, tenant boundaries hold, and the operator UI still works.

The release bar should be:

- Migrations apply cleanly.
- API financial invariants hold.
- Tenant, role, store, and parent boundaries hold.
- The web app builds.
- Critical register and reporting workflows work in Docker.

## Current State

The project has one database-backed API test file:

```text
api/test/wallet-sale.test.js
```

It already covers important behavior:

- Production auth rejects unauthenticated writes.
- Wallet sale creates paid order, payment, wallet debit, and inventory movement.
- Idempotency replay does not charge twice.
- Cash sale decrements inventory and updates drawer expected cash.
- Tracked inventory blocks overselling.
- Full wallet refund restores wallet balance and inventory.
- Full cash refund reduces expected drawer cash and restores inventory.
- Insufficient wallet funds are rejected.

Current CI only:

- Syntax-checks API JavaScript.
- Builds the Next.js web app.

CI does not currently run the API test suite against Postgres. That should be the first
testing infrastructure fix.

## Testing Layers

### 1. API Integration Tests

Use Node's built-in test runner under:

```text
api/test/
```

These should be real database-backed tests that run migrations, boot the Express app,
call HTTP endpoints, and verify database-backed behavior.

API integration tests are the most important tests in this project because the API owns:

- Money movement
- Wallet ledger writes
- Order/refund state
- Inventory movements
- Cash drawer accounting
- Tenant authorization
- Staff authorization
- Parent portal access

### 2. Database And Migration Tests

Every meaningful backend change should prove:

- Migrations run from an empty database.
- Running migrations a second time is a no-op.
- Wallet ledger immutability trigger exists.
- Core foreign keys and check constraints exist.
- Migration numeric prefixes are unique.

There are currently two migration files with the `013_` prefix:

```text
013_browser_auth_sessions.sql
013_currency_and_tax_settings.sql
```

The current lexical order may work, but future migrations should use unique numeric
prefixes and CI should guard this.

### 3. Web Build And UI Tests

The current useful web gate is:

```bash
cd web
npm run build
```

Add focused UI tests after the API test foundation is stronger.

Recommended first web test targets:

- `web/app/lib/format.ts`
- `web/app/lib/organizationContext.ts`
- `web/app/lib/imageUrl.ts`
- `web/app/register/registerUtils.ts`
- `web/app/register/CartPanel.tsx`
- `web/app/register/ProductCatalog.tsx`
- `web/app/register/StudentSelector.tsx`

These should cover:

- Money formatting.
- Cart totals.
- Disabled checkout states.
- Student wallet balance display.
- Stock badges.
- Pending fee display.
- Credit-limit warning behavior.

### 4. End-To-End Smoke Tests

Use Playwright only for a small number of high-value flows. These tests are slower and
more brittle than API tests, so they should focus on confidence rather than exhaustive
coverage.

Recommended smoke flows:

- Staff login.
- Register loads products and students.
- Add item to cart.
- Complete wallet checkout.
- Receipt appears.
- Inventory count changes.
- Orders page shows the new order.
- Parent portal session shows linked students.
- Reports page loads seeded six-month data.

Run these against Docker, not a host-only Next.js dev server.

### 5. Docker And Deployment Smoke

Container checks should verify:

- `docker compose up --build` starts Postgres, API, and web.
- API `/health` returns OK.
- API `/ready` can reach Postgres.
- Web responds on port 3100.
- Production Dockerfiles build.

## Recommended Test Layout

```text
api/test/helpers/
  server.js
  fixtures.js
  assertions.js

api/test/
  financial-sale.test.js
  refunds.test.js
  fees.test.js
  authz.test.js
  guardian-portal.test.js
  migrations.test.js
  cash-drawers.test.js
  inventory.test.js
  inventory-ai.test.js         ← AI extraction draft lifecycle, learning loop
  ai-isolation.test.js         ← cross-org AI draft access, cross-org corrections access

web/test/
  unit/
  components/
  e2e/
```

## Priority Test Coverage

### Priority 1: Financial Flows

Add API integration coverage for:

- Wallet sale with idempotency.
- Paid cash sale with active drawer.
- Paid card sale.
- Missing `Idempotency-Key` on money-moving endpoints.
- Same idempotency key with different body returns conflict.
- Wallet credit limit allows exact boundary.
- Wallet credit limit rejects one cent beyond boundary.
- Server-side product price is authoritative.
- Inventory cannot oversell.
- Inventory decrements on sale.
- Inventory restores on refund.
- Full wallet refund.
- Full cash refund.
- Full card refund.
- Partial wallet refund.
- Partial cash refund.
- Partial card refund.
- Duplicate full refund is rejected.
- Duplicate partial refund is rejected or idempotently replayed.
- Cash refund is rejected after drawer close where business rules require it.

Money-moving endpoints that need replay tests:

- `POST /v1/orders/wallet-sale`
- `POST /v1/orders/paid-sale`
- `POST /v1/orders/:id/refund`
- `POST /v1/orders/:id/partial-refund`
- `POST /v1/wallets/:id/topups`
- `POST /v1/fee-assignments/:id/pay`

### Priority 2: Tenant, Role, Store, And Category Authorization

Create:

```text
api/test/authz.test.js
```

Cover:

- Non-platform users cannot read another organization.
- Non-platform users cannot write another organization.
- Cashier cannot create organizations.
- Cashier cannot create staff.
- Cashier cannot create products unless explicitly allowed.
- Store manager assigned to Store A cannot operate Store B.
- Cashier assigned to Store A cannot operate Store B.
- Platform/super admin can cross tenants.
- Organization admin can operate inside their own tenant.
- Category-restricted cashier can only sell permitted product categories.
- Zero category-permission rows means unrestricted, if that behavior remains intended.

Store-scoped checks should cover:

- Orders list/detail.
- Refunds.
- Paid sale.
- Wallet sale.
- Inventory adjustments.
- Cash drawer open/current/close.
- Fee assignment create/pay.
- Reports with store filters.
- AI report endpoints with store filters.

### Priority 3: Parent And Guardian Access

Create:

```text
api/test/guardian-portal.test.js
```

Cover:

- Magic-code request returns the same response for existing and missing emails.
- Wrong code fails.
- Expired code fails.
- Reused code fails.
- Guardian session cookie is required for parent endpoints.
- Guardian can see linked students.
- Guardian cannot see an unlinked student in the same organization.
- Guardian cannot see a student from another organization.
- Notification preference updates only the logged-in guardian.
- Staff-side guardian/student link rejects cross-organization links.

### Priority 4: Concurrency

Add tests that use simultaneous HTTP requests or direct service calls to verify locks and
idempotency under race conditions:

- Two wallet sales against the same wallet cannot overspend.
- Two sales against the same inventory item cannot oversell.
- Two refunds against the same order cannot double-credit.
- Two partial refunds against the same order item cannot exceed purchased quantity.
- Two fee payments cannot double-pay the same fee assignment.
- Two cash drawer opens for the same register cannot both succeed.

### Priority 5: Reporting And AI Inputs

Reports and AI should be tested mostly at the data aggregation boundary.

Cover:

- Reports are tenant-scoped.
- Reports honor store filters.
- Date ranges include and exclude expected records.
- Refund counts and amounts are correct.
- Payment method totals are correct.
- Wallet spend totals are correct.
- AI facts are precomputed by SQL, not calculated by the LLM.
- AI records write only to `commerce_ai_records`.
- AI endpoints never write to financial tables.

### Priority 6: AI Inventory Extraction

Create:

```text
api/test/inventory-ai.test.js
```

Cover (mock Claude and Cloudinary — test the pipeline logic):

- `POST /inventory/ai/extract` with a mock image creates a draft with `status: pending`.
- Draft `lines` JSONB contains extracted lines after matching.
- 3-stage matching: exact SKU hit sets `match_status: matched`; corrections table hit sets `match_status: matched`; pg_trgm hit sets `match_status: fuzzy`; no match sets `match_status: unmatched`.
- `POST /drafts/:id/approve` creates an invoice row.
- Approve increments `quantity_on_hand` for each non-skipped line.
- Approve writes a `commerce_inventory_movements` row for each line.
- Approve upserts `commerce_ai_inventory_corrections` for matched lines.
- `use_count` increments on second approval of same extracted_text.
- Approve sets draft `status: approved` and `invoice_id`.
- Reject sets draft `status: rejected` without creating an invoice.
- Cannot approve an already-approved draft.
- Cannot approve if any line has `product_id: null` and `skip: false`.

### Priority 7: Multi-Tenant Isolation

Create:

```text
api/test/ai-isolation.test.js
```

This test file should verify every cross-org vulnerability identified in the 2026-06-14 security audit.

Cover:

**Guardian isolation:**
- `POST /guardians/:id/students` rejects link when guardian belongs to a different organization than the request `organizationId`.
- `POST /guardians/:id/students` rejects link when student belongs to a different organization than the request `organizationId`.
- Guardian cannot view students from another organization.

**Staff isolation:**
- `PATCH /staff/:id` cannot update a staff member from another organization.
- `POST /staff/:id/pin` cannot reset PIN for staff from another organization.

**Inventory invoice isolation:**
- `GET /inventory/invoices/:id/lines` returns 404 for an invoice belonging to another organization.
- `POST /inventory/invoices/:id/approve` rejects approval of another org's invoice.

**AI extraction isolation:**
- `GET /inventory/ai/drafts/:id` returns 404 for a draft belonging to another organization.
- `POST /inventory/ai/drafts/:id/approve` rejects approval of another org's draft.
- `DELETE /inventory/ai/corrections/:id` rejects deletion of another org's correction.

**AI usage isolation:**
- Non-platform roles (`organization_admin`, `store_manager`) can only see their own org's AI usage.
- Platform roles (`platform_admin`, `super_admin`) can see cross-org usage.

**Defense-in-depth verification:**
- All of the above must fail even when the `organizationId` body/query param is *changed* to the attacker's own org — proving SQL-level `AND organization_id = $N` independently blocks the attack.

## CI Gates

Update `.github/workflows/ci.yml` in stages.

### Stage 1: Immediate

Keep:

```bash
for f in $(find src test -name '*.js'); do node --check "$f" || exit 1; done
```

Add a Postgres service and run:

```bash
cd api
DATABASE_URL=postgres://postgres:postgres@localhost:5432/commerce_pos_test npm run migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/commerce_pos_test npm test
```

Keep:

```bash
cd web
npm run build
```

### Stage 2: Near-Term

Add:

```bash
git diff --check
```

Add migration prefix guard:

```bash
find api/src/db/migrations -name '*.sql' -printf '%f\n' | cut -d_ -f1 | sort | uniq -d
```

The command should fail if duplicate prefixes are found.

Add dependency checks:

```bash
cd api && npm audit --audit-level=high
cd web && npm audit --audit-level=high
```

### Stage 3: Later

Add:

- Docker build smoke.
- Playwright smoke.
- Semgrep security scan.
- Gitleaks secret scan.
- Dependency review for pull requests.

## Local Verification Commands

Backend:

```bash
cd api
DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos_test npm run migrate
DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos_test npm test
```

Frontend:

```bash
cd web
npm run build
```

Container smoke:

```bash
docker compose ps
curl -sS http://localhost:4100/health
curl -sS http://localhost:4100/ready
curl -sS -I http://localhost:3100
```

## Test Database Rule

Automated tests must run against a dedicated test database. Never run tests against the
shared stage database or a production database.

Database names should include `test`, for example:

```text
commerce_pos_test
```

The existing API test guard already refuses non-test database names unless explicitly
overridden. Keep that behavior.

## Release Checklist

Before merging meaningful backend changes:

- API syntax check passes.
- Migrations apply from scratch.
- Migrations are idempotent.
- API tests pass against a test database.
- Financial flow tests cover changed behavior.
- Tenant and role authorization tests cover changed behavior.
- Web build passes if UI code changed.
- Docker smoke passes for deployment-related changes.

Before demoing:

- Docker stack is healthy.
- Rich demo data is seeded into a disposable demo database.
- Register, orders, payments, inventory, customers, guardians, staff, and reports load.
- AI features are tested only against demo data and write only to `commerce_ai_records`.
- AI inventory extraction tested with a real supplier invoice image or PDF in Docker.
- AI corrections visible in the "AI Learning" tab after approving an extraction draft.

## Multi-Tenant Security Rules

These rules must never regress. Any backend change touching the modules below must re-verify isolation:

| Module | Files | What to verify |
| --- | --- | --- |
| Guardians | `guardians.routes.js` | Guardian and student both verified in org before link INSERT |
| Staff | `staff.routes.js` | PATCH and PIN reset include `AND organization_id` in WHERE |
| Inventory invoices | `inventory.routes.js` | Lines query and approve query include `AND organization_id` |
| AI drafts | `inventoryAI.routes.js` | Draft approve final UPDATE includes `AND organization_id` |
| AI usage | `ai.routes.js` | Non-platform roles forced into own org; `authorizeTenant` called |
| All list endpoints | any `.routes.js` | `WHERE organization_id = $N` in every query — never rely on `authorizeTenant` alone |

**Defense-in-depth rule:** `authorizeTenant(actor, orgId)` at the handler level is Layer 1. `AND organization_id = $N` in the SQL query is Layer 2. Both must exist independently. An attacker who manipulates the `organizationId` parameter after passing Layer 1 must still fail at Layer 2.

See full audit: `docs/multi-tenant-isolation-audit-2026-06-14.md`
