# Stage Readiness Plan

This plan moves Commerce POS from local demo mode into a controlled stage environment
where schools can try the product with their own data.

## Current Stage Goal

Stage should support:

- One or more real school organizations.
- Real school locations/cafeterias and registers.
- Real products, inventory, suppliers, and receiving records.
- Real students/customers with wallets, balances, credit limits, and NFC credentials.
- Cash, card/credit placeholder, and wallet sales.
- Refunds, cash drawer activity, and financial logs.
- Student Educational app integration where the School App remains the source of truth
  for students when connected.

Stage is not production. It can use test payment behavior, but it must not mix automated
test records with school trial data.

## No Untied Data Rule

For stage, nothing should be created unless it is tied to a real organization, store,
customer/student, product, supplier, register, or integration setup action.

Applied guardrails:

- Operator pages no longer create demo school data when they load.
- Register, inventory, receiving, payments, orders, customers, staff, and student
  preview flows load the current staff organization instead of calling `/demo/school`.
- Demo seed endpoints can be disabled with `DISABLE_DEMO_SEED=true`.
- Automated tests now refuse to run against a non-test database by default.
- Settings uses `GET /v1/organizations?scope=mine` instead of listing every
  organization in the database.

Stage configuration must set:

```text
DISABLE_DEMO_SEED=true
ALLOW_DEV_AUTH=
NODE_ENV=production
```

## Immediate Blockers Found

### Test Data Pollution

The local database had many `Test School-*` organizations. These were created by the API
test suite, not by normal cashier usage. The test suite creates unique organizations for
sale/idempotency/refund scenarios.

Fix applied:

- API tests now refuse to run unless `DATABASE_URL` points to a database name containing
  `test`, unless `ALLOW_TESTS_ON_NON_TEST_DB=true` is explicitly set.
- `.env.example` now documents `TEST_DATABASE_URL`.

Required next step:

- Create a dedicated `commerce_pos_test` database for automated tests.
- Clean existing `Test School-*` rows from local/stage data after confirming backup.

### Organization Scope

The Settings page was loading all organizations. In a stage trial, a school user should
see only their assigned organization unless they are using a platform-level admin flow.

Fix applied:

- `GET /v1/organizations?scope=mine` returns the logged-in actor's organization.
- Settings now uses `scope=mine`.
- Normal frontend pages use `web/app/lib/organizationContext.ts` to resolve the
  current organization/store context.
- Login no longer creates demo accounts when no staff accounts exist.

## Stage Environment Checklist

### Infrastructure

- Stage domain over HTTPS, for example `https://pos-stage.example.com`.
- Traefik/Caddy/Nginx reverse proxy with valid TLS.
- API and web containers pinned to image tags or release branches.
- Postgres stage database separated from local dev and test.
- Daily database backup job and restore drill.
- Central logs shipped to Loki/S3.

### Environment Variables

Required stage values:

```text
NODE_ENV=production
DATABASE_URL=postgres://...
COMMERCE_API_TOKEN=<long-random-token>
CORS_ORIGINS=https://pos-stage.example.com
SPELLING_APP_API_URL=https://...
SPELLING_APP_SERVICE_TOKEN=<shared-service-token>
DISABLE_DEMO_SEED=true
```

Do not enable `ALLOW_DEV_AUTH` in stage.

### Data Model Setup

For each school trial:

- Create organization.
- Create one or more stores/locations.
- Create registers per location.
- Create manager/cashier users with PINs.
- Import or sync students from the Student Educational app.
- Create wallets for students who can spend.
- Set wallet credit limits according to school policy.
- Import products and inventory.
- Configure currency and tax settings.

### Register Demo Flow

The target school demo flow is:

1. Cashier signs in with PIN.
2. Cashier opens/registers cash drawer.
3. Cashier taps/scans student NFC credential or searches by name/matricula.
4. Register shows exactly one selected student and wallet balance.
5. Cashier adds cafeteria items.
6. Cashier completes sale by wallet/cash/card.
7. Inventory decrements.
8. Student wallet ledger updates.
9. Student/parent view can show the transaction.
10. Register clears student and cart for the next sale.

## Trial Safety Rules

- Never run automated tests against stage or shared demo databases.
- Never delete financial records.
- Keep wallet/order/payment writes in one database transaction.
- Keep audit/business logs for all money and inventory movements.
- Keep raw NFC tokens out of the database; store token hashes only.
- Do not store card data. Stage card payment remains placeholder until a provider is
  integrated with signature verification and idempotency.

## Next Build Priorities

1. Add a real stage onboarding/import flow instead of using demo seed endpoints.
2. Add an admin onboarding screen for organization, locations, registers, and users.
3. Add CSV import for students/customers and products.
4. Add cleanup script for local test data only.
5. Add test database creation docs and CI-style test command.
6. Add role-based navigation hiding for cashier/manager/admin.
7. Add full stage backup/restore runbook.
8. Add printable receipt and parent notification settings.
