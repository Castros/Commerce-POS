# Codex Architecture Review - Commerce POS SaaS Deployment

Date: 2026-06-03

## Summary

Commerce POS should continue as a modular monolith for the next stage of work. The
right first cloud shape is one API container, one Next.js web container, and one
managed Postgres database serving multiple tenant organizations.

Do not split wallet, order, payment, inventory, refund, or drawer writes into
separate services yet. Those flows are safer while they stay in one API and one
database transaction.

The current financial foundation is directionally strong:

- Tenant-scoped database tables and composite tenant foreign keys exist.
- Money is stored in integer cents.
- Wallet/order/payment writes are transaction-oriented.
- Idempotency keys are implemented for money-moving order flows.
- Wallet ledger rows are protected by immutability triggers.
- Duplicate successful payments are constrained.
- Migrations use a Postgres advisory lock.
- Demo seeding can be disabled for stage and production.

The main remaining SaaS risk is not the monolith architecture. The main risk is
tenant and store authorization consistency across API routes.

## Target Product Shape

Commerce POS should be deployed as one hosted SaaS product serving many schools,
companies, cafeterias, restaurants, and stores.

Each tenant should have its own:

- Organization
- Store or cafeteria locations
- Registers/devices
- Staff users and roles
- Store assignments
- Products and menus
- Inventory
- Customers/students
- Wallets and credentials
- Integration settings
- Reports and audit history

The Student Educational app remains a separate product. Commerce POS owns commerce
data and exposes integration APIs back to the Student Educational app.

## Recommended Cloud Architecture

Start simple:

```text
Browser
  -> HTTPS web app
  -> API service
  -> Managed Postgres
```

Recommended first deployment targets:

- Render
- Fly.io
- Railway
- Google Cloud Run
- AWS App Runner

Use managed Postgres with automated backups from the beginning. Enable point-in-time
recovery before handling production money or real school financial records.

Avoid Kubernetes, Redis, queues, read replicas, service meshes, and microservices
until traffic or operational requirements justify them.

## Environment Model

Use isolated environments:

```text
local     developer Docker Compose
test      automated test database only
stage     real trial data, production mode, no demo seed
prod      real customers, PITR, alerts, restore drills
```

Stage must set:

```text
NODE_ENV=production
DISABLE_DEMO_SEED=true
ALLOW_DEV_AUTH=
CORS_ORIGINS=https://pos-stage.example.com
DATABASE_URL=<managed-postgres-url>
COMMERCE_API_TOKEN=<internal-bootstrap-token>
```

Do not run automated tests against stage or production databases.

## P0 SaaS Blockers

### 1. Tenant Authorization

Many routes currently scope SQL by request-supplied `organizationId`, but a hosted
SaaS API must also prove the authenticated actor can access that organization.

Add central helpers:

```text
authorizeTenant(req, organizationId)
authorizeStore(req, organizationId, storeId)
assertPlatformActor(req)
resolveActorOrganization(req, requestedOrganizationId)
```

Apply these helpers to every tenant-owned route:

- Organizations
- Stores
- Products
- Customers
- Wallets
- Orders
- Inventory
- Reports
- Cash drawers
- Student credentials
- Student app integrations

Platform and super-admin actors may cross tenant boundaries. Browser users and
organization-scoped service tokens may not.

### 2. Store Assignment Enforcement

Cashiers and managers must be limited to assigned stores on the backend. Frontend
filtering is not enough.

Backend reads and writes should reject access when a cashier or manager passes a
store they are not assigned to.

Critical paths:

- Register sale
- Wallet sale
- Cash/card sale
- Refund
- Cash drawer open/close
- Inventory adjustments
- Product management
- Reports
- Credential issuance and lookup

### 3. Service Token Scope

`COMMERCE_API_TOKEN` should be treated as an internal bootstrap/admin secret only.
It should not be used by tenant integrations.

Use database-backed service tokens scoped to one organization for:

- Student Educational app integration
- School-specific sync jobs
- Future partner integrations

### 4. PIN Login Hardening

PIN login needs tenant context before shared SaaS use. A user should sign into a
known organization, subdomain, school code, or equivalent tenant context.

Add:

- Login rate limiting
- Failed PIN attempt tracking
- Lockout or cooldown policy
- Session revocation
- Forced logout when role, PIN, or store assignment changes

### 5. Student App Integration Ownership

Integration endpoints should not implicitly create real organizations, stores,
customers, wallets, credit limits, or starting balances in stage or production.

Move to explicit setup:

- Admin creates or selects Commerce organization.
- Admin maps `external_school_id` to that organization.
- Integration requests resolve through that mapping.
- Integration tokens are organization-scoped.
- Integration actions write audit events.

### 6. Card Payment Boundary

The current `card` payment behavior is acceptable for demo/stage placeholders only.
It must not be used as real card acceptance.

Before real card payments:

- Use a payment provider or terminal SDK.
- Verify provider webhook signatures.
- Store provider payment IDs, status, card brand, and last four only.
- Never store raw card data, CVV, track data, or payment credentials.
- Reconcile card payment status server-side and idempotently.

## P1 Hardening Before Real School Stage

- Add CSRF protection for cookie-authenticated writes.
- Add rate limits for login, wallet, order, refund, credential, and integration
  endpoints.
- Split cashier permissions from manager/admin permissions more carefully.
- Decide whether cashiers can top up wallets; if allowed, make it an explicit school
  policy.
- Add backend tests for cross-tenant denial and store-assignment denial.
- Add tests for demo seed disabled behavior.
- Add tests for scoped service-token access.
- Make registers/devices first-class tenant-scoped records instead of free-text
  register names.
- Keep module extraction moving toward `routes.js`, `schemas.js`, `service.js`,
  `repo.js`, and `events.js`.

## Cloud Deployment Blockers

Before deploying real stage data:

- Add a production-ready web Docker image. The web container must not run Next dev
  server in cloud.
- Add CI/CD or a repeatable deploy manifest.
- Build immutable API and web images from CI.
- Run migrations as one release job before deploying/scaling app containers.
- Store secrets in the cloud provider secret manager.
- Use a managed Postgres database for stage.
- Prove daily backups and perform a restore drill.
- Add central logs, uptime checks, and error tracking.
- Add smoke checks for `/health`, `/ready`, and the web app.
- Clean local/demo/test records before trusting shared stage data.

## Recommended CI/CD Flow

Minimum release pipeline:

```text
install dependencies
run API syntax checks
run API tests against commerce_pos_test
run web build
build API image
build web image
scan images and dependencies
push immutable image tags
run migrations once
deploy API and web
smoke test API health, API readiness, and web response
```

## Phased Path Forward

### Phase 1: SaaS Safety

Goal: make the existing app safe for multiple tenant organizations in one hosted
environment.

Work:

- Implement tenant and store authorization helpers.
- Apply authorization helpers across all tenant-owned routes.
- Enforce store assignments on backend routes.
- Harden PIN login with tenant context and rate limits.
- Use organization-scoped service tokens for integrations.
- Disable implicit Student App tenant creation outside local/demo mode.
- Add cross-tenant and store-assignment denial tests.

### Phase 2: Stage Deployment

Goal: host one controlled stage environment with real trial data.

Work:

- Choose a managed cloud target.
- Add production Docker builds.
- Add CI/CD.
- Provision managed Postgres.
- Configure stage secrets.
- Run migrations as a release step.
- Enable HTTPS and strict CORS.
- Configure logs, error tracking, and uptime checks.
- Run a backup and restore drill.

### Phase 3: Tenant Onboarding

Goal: onboard schools without demo seed paths.

Work:

- Build admin onboarding for organizations, stores, registers, users, and roles.
- Add CSV import or sync for students/customers.
- Add product and inventory import.
- Add explicit Student Educational app integration setup.
- Add role-based navigation and permissions polish.
- Add first-class registers/devices and attach drawers/sales to register IDs.

### Phase 4: Production Hardening

Goal: handle real money and real customer operations.

Work:

- Enable PITR and monthly restore validation.
- Add production alerting.
- Add formal audit coverage for permission, wallet, refund, credential, and
  integration changes.
- Add payment provider integration for real card payments.
- Add webhook verification and idempotent reconciliation.
- Add printable receipts and parent notifications.
- Add production deployment and incident runbooks.

### Phase 5: Scale Only When Needed

Goal: scale without breaking the financial write path.

Possible additions when justified:

- Worker service for webhooks, reports, notifications, exports, and retries.
- Read replica for high-volume parent/student balance lookups.
- Reporting read model for analytics.
- Redis for rate limiting or job coordination if needed.

Do not split wallet/order/payment writes until there is a clear operational or
compliance reason.

## Immediate Next Sprint Recommendation

The next sprint should focus on SaaS safety before cloud mechanics:

1. Add `authorizeTenant` and `authorizeStore`.
2. Apply them to products, orders, wallets, inventory, cash drawers, reports, and
   student credentials.
3. Add cross-tenant denial tests.
4. Require organization context for PIN login.
5. Add rate limiting for login and money-moving endpoints.
6. Stop using global `COMMERCE_API_TOKEN` for tenant integrations.

After those are merged, start the stage deployment work: production Dockerfiles,
managed Postgres, CI/CD, secrets, migrations, and smoke checks.
