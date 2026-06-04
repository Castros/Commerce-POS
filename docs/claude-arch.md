# Commerce POS — SaaS Cloud Architecture

> Generated 2026-06-03. Analysis by Backend Architect, Software Architect, and DevOps specialist agents based on current codebase state.

---

## What's Already Production-Quality

The financial core does not need to change before launch:

- `wallet-sale` transaction boundary: idempotency lock → product snapshots → order insert → `FOR UPDATE` wallet lock → ledger row → inventory decrement → audit event
- Integer cents throughout, immutable ledger rows, immutable order item snapshots
- Idempotency scoped to `(organization_id, idempotency_key)` — already tenant-aware
- Composite FK hardening on every financial table
- Audit events written inside the same transaction as financial writes

---

## Pre-Launch Blockers

These are security or correctness issues. Fix before the first school goes live.

### 1. Remove the dev actor fallback

The `x-actor-*` headers accepted when `NODE_ENV !== "production"` is a critical vulnerability. A misconfigured deployment variable exposes every tenant's data. Replace with a seeded test credential for local dev — do not use env-var-gated backdoors.

### 2. Lock `organizationId` resolution to session only

Several route handlers accept `organizationId` from the request body. A misconfigured or compromised session can probe other orgs' data by changing that value. Every non-super-admin actor must have `body.organizationId === actor.organizationId` asserted in shared middleware, or drop org ID from the body entirely and derive it only from the session.

### 3. Enforce store assignments

`commerce_user_store_assignments` exists but enforcement is incomplete. Every cashier and store-manager endpoint must gate on this table before any data access. This is a tenant isolation breach, not a UX gap.

### 4. Harden session config

HTTP-only cookie is correct. Add: `Secure`, `SameSite=Strict`, max 8-hour `Max-Age`, and server-side session invalidation on logout. Store sessions in the database or Redis so compromised sessions can be force-expired.

### 5. Rate-limit the login endpoint

PINs are low-entropy credentials. Add `express-rate-limit` at 10 attempts/min per IP on `POST /v1/auth/login`. Lock accounts after 5 failed attempts per user and log failures to the audit table.

### 6. Service token expiry enforcement

`commerce_service_tokens` exists but token expiry and revocation are not enforced on every request. Tokens must carry expiry timestamps checked at middleware time, not just at issuance.

---

## Architecture Decisions

### Stay a modular monolith through Phase 2

The module boundaries under `api/src/modules/` are clean, but splitting them into services would destroy the single-transaction guarantee spanning wallet + order + inventory + audit + cash drawer. That transaction is the most important correctness property in the system. Do not distribute it prematurely.

The only early extraction candidate is the Spelling App integration bridge (`modules/integrations/`). It already calls an external service and could become a thin sidecar without touching the financial core. This is optional at Phase 1.

Extract to a separate service only when a concrete scaling constraint appears — the most likely early candidate is the `/reports` module running heavy aggregation queries against the same pool as the cashier register.

### Multi-tenancy: shared schema is correct

Shared-schema with `organizationId` row-level isolation scales comfortably to hundreds of organizations with proper indexing. Schema-per-tenant adds migration fan-out and connection pooling complexity you do not need.

FERPA compliance does not require schema separation. It requires: role-scoped query enforcement (already close), a FERPA-compliant data-export endpoint per organization, and a data-retention policy.

**Upgrade path if physical isolation is ever needed:** logical replication to extract a specific org to a dedicated database — no rewrite required.

### Financial tenant isolation guarantees

- No cross-org join is possible without explicit `organization_id` matching in every query
- Idempotency keys are already scoped to `(organization_id, idempotency_key)`
- Audit log is scoped per org
- The gap to close: `organizationId` resolution from session, not request body (see Pre-Launch Blockers #2)

---

## Key Features to Build (In Priority Order)

### Tenant provisioning endpoint

An atomic `POST /v1/platform/organizations` that creates `(organization, store, admin user, service token)` in one transaction. The demo seed at `POST /v1/demo/school` shows the shape — strip the fake data, keep the provisioning logic.

Add `onboarding_status` column to `commerce_organizations`:

```
onboarding_status: 'provisioning' | 'active' | 'suspended'
```

### Org status + billing integration

Add table: `commerce_subscriptions(id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status, trial_ends_at, billing_email, created_at)`

A Stripe webhook handler at `POST /v1/platform/stripe/webhook` processes `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`. On suspension it sets the org status, and all org endpoints return 402.

Billing lives in a thin platform module and never touches the wallet ledger, order tables, or any financial transaction.

### Staff creation UI

The RBAC tables (`commerce_users`, `commerce_user_store_assignments`) exist. Org admins cannot self-serve staff accounts without a UI. This is a real-world launch blocker.

### Transactional email

Use Resend or Postmark. Fire-and-forget calls placed after committed transactions — if the email fails, the sale is still committed; log the failure to the audit table. No queue needed at Phase 1 volume.

Events to notify on at launch:
- Wallet top-up confirmation (to parent email on the customer record)
- Receipt after any sale (if customer has an email)
- Low balance alert (nightly cron query against wallets below a per-org threshold — avoids building a queue)

### Card terminal integration

`commerce_payments` already has `provider` and `provider_payment_id` columns. The integration fits cleanly:

1. POS calls `POST /v1/orders/payment-intent` — server calculates total server-side, creates a Stripe PaymentIntent, returns `client_secret` to the terminal UI
2. Terminal captures the payment. Stripe sends webhook `payment_intent.succeeded`
3. Webhook handler calls the existing `createPaidSale` logic using `payment_intent_id` as the idempotency key

**Critical:** order creation must happen in the webhook handler, not the POS UI click. The POS UI shows a "pending" state until the webhook arrives. This preserves all financial safety rules — totals are still calculated server-side, the `FOR UPDATE` wallet lock is not involved for card sales, and the audit event fires inside the same transaction as the order insert.

---

## Cloud Deployment

### Phase 1 — Railway (~$25/month)

| Resource | Cost |
|---|---|
| Railway API service (512 MB, always-on) | ~$10 |
| Railway Next.js service (512 MB) | ~$10 |
| Railway Postgres (shared, 1 GB) | ~$5 |
| Cloudflare free tier (CDN, DDoS, HTTPS) | $0 |
| Sentry free tier (error tracking) | $0 |
| Logtail free tier (log aggregation) | $0 |
| UptimeRobot free (uptime monitoring) | $0 |
| **Total** | **~$25/month** |

Railway consumes the existing Docker containers directly — health and readiness endpoints are already wired. No VPCs, IAM roles, or load balancers to manage.

- Cloudflare free tier in front of the Next.js frontend from day one
- Product image uploads should use Cloudflare R2 when added (S3-compatible, cheaper than S3, already behind Cloudflare)
- Railway private networking must be enabled so Postgres is not publicly accessible

### Phase 2 — AWS (~$236/month)

Migrate at ~20–30 schools or when Multi-AZ Postgres and finer backup control are required.

| Resource | Cost |
|---|---|
| ECS Fargate — 2 API tasks (0.5 vCPU, 1 GB) | ~$30 |
| ECS Fargate — 2 Next.js tasks | ~$30 |
| RDS PostgreSQL 16, db.t4g.small, Multi-AZ | ~$60 |
| Application Load Balancer | ~$20 |
| Cloudflare Pro (WAF, better DDoS) | $20 |
| Sentry Team plan | $26 |
| Datadog Infra (2 hosts) | ~$30 |
| Data transfer, NAT Gateway | ~$20 |
| **Total** | **~$236/month** |

At 50 schools this divides to under $5 per school per month.

There is no Railway-specific lock-in — migration is plain Docker containers plus a new `DATABASE_URL`.

### IaC Strategy

- **Phase 1:** `railway.toml` per service. Version-controlled and reproducible. Do not introduce Terraform before you have resources it manages better than a platform dashboard.
- **Phase 2:** Minimal Terraform root module defining: one VPC with public/private subnets, one RDS instance in a private subnet, one ECS Fargate cluster with task definitions for API and web, one ALB with HTTPS listener and ACM certificate, one Secrets Manager secret per environment.

---

## CI/CD Pipeline

GitHub Actions, two workflows. Start this week.

**PR workflow** (blocks merge on failure):
1. `npm audit --audit-level=high`
2. `node --check` loop across `api/src` and `api/test`
3. `npm test` against a Postgres service container
4. `cd web && npm run build`

**Deploy workflow** (triggers on push to `main`):
1. Run tests
2. Build Docker images tagged with commit SHA, push to GitHub Container Registry
3. Run `npm run migrate` as a Railway release command (runs before container swap, uses advisory lock already in `migrate.js`)
4. Deploy API and web services in parallel

The migration pre-deploy step is mandatory for a financial app. Never run migrations inside the application startup path in production.

---

## Environment Strategy

Three environments: local, staging, production. Staging and production share no credentials or databases.

| Tier | Variables | Storage |
|---|---|---|
| Build-time config | `NODE_ENV`, `API_PORT`, `CORS_ORIGINS`, `DISABLE_DEMO_SEED=true` | Railway service variables / ECS task definition |
| Runtime secrets | `DATABASE_URL`, `COMMERCE_API_TOKEN`, `SPELLING_APP_SERVICE_TOKEN` | Railway encrypted variables (Phase 1), AWS Secrets Manager (Phase 2) |
| Per-environment overrides | `SPELLING_APP_API_URL` | Per-environment service variable |

`DISABLE_DEMO_SEED=true` must be set in all non-local environments. Assert this in the deploy workflow. A pre-commit hook should reject any commit touching `.env` files.

---

## Database Operations

### Connection pooling

The default Node `pg` pool of 10 per API instance is sufficient at 5 schools. Add PgBouncer in transaction mode before Phase 2 — add it as a Railway service or AWS sidecar when concurrent connections exceed 20.

### Backups

- **Phase 1 (Railway):** daily automated backups with 7-day retention, included. Sufficient for 5 schools.
- **Phase 2 (RDS):** point-in-time recovery to any second within a 35-day window, automated snapshots before deployments, Multi-AZ standby with automatic failover under 60 seconds.

### Migration safety in production

The advisory lock in `migrate.js` handles concurrent startup races. Deploy order must be:

1. Run migration as a one-off job/release command
2. Wait for success
3. Roll out new container version

Every migration must be backward-compatible with the running app binary (add columns nullable, never drop columns in the same deploy). Validate migrations against a staging organization before promoting to production.

---

## Observability

Minimum viable for a financial app at launch:

| Tool | Purpose | Cost |
|---|---|---|
| Pino JSON → stdout | Structured logging (already in codebase) | $0 |
| Logtail (Better Stack) | Log aggregation, search, retention | $0 (free tier) |
| Sentry | Error tracking on Express error handler + Next.js | $0 (free tier) |
| UptimeRobot | `/health` and `/ready` monitoring with email alerts | $0 |

**Instrument first:** wallet-sale success/failure rate, refund invocations, and `/ready` latency as a DB health proxy. These three tell you if the financial core is working.

At Phase 2: move to Datadog or Grafana Cloud with a Postgres slow-query alert and p95 API latency alert.

---

## Security Hardening

- **HTTPS:** Railway and Cloudflare terminate TLS automatically. `Strict-Transport-Security` via helmet (already included).
- **Secrets:** audit Pino serializers to confirm `DATABASE_URL` and bearer tokens are never logged. Request IDs are safe to log; credentials are not.
- **Network:** Railway Postgres must use private networking — only the API service can reach the database. On AWS, RDS goes in a private subnet with a security group permitting only the ECS task security group on port 5432.
- **Rate limiting:** `express-rate-limit` on `/v1/auth/login` before staging launch.
- **DDoS:** Cloudflare free tier covers the browser attack surface. The API should only accept traffic from known CORS origins (already enforced) plus an IP allowlist for the Spelling App integration token in production.
- **Dependency scanning:** `npm audit --audit-level=high` as the first CI step.
- **Demo seed:** `DISABLE_DEMO_SEED=true` enforced as a deploy workflow assertion, not just documentation.

---

## Phased Roadmap

### Phase 1 — First paying school (1–3 months)

Target state: a single school can self-provision, staff can log in and run the register, parents can receive receipts, and billing is tracked.

- Close the 6 pre-launch auth/security blockers above
- Staff creation and management UI
- Tenant provisioning endpoint
- `commerce_subscriptions` table + Stripe webhook handler
- Transactional email for receipts and wallet top-ups
- Deploy to Railway with private Postgres
- GitHub Actions CI pipeline (PR + deploy workflows)
- `DISABLE_DEMO_SEED=true` in staging and production

Architecture: single API container, single web container, single managed Postgres.

### Phase 2 — 10 schools (6–12 months)

- Self-serve onboarding UI
- Card terminal integration (Stripe Terminal via webhook-driven order creation)
- Partial refunds and formal void workflows
- FERPA-compliant data-export endpoint per organization
- Per-org rate limiting on the API
- Read replica for `/reports` queries (prevent reporting load from impacting the cashier register pool)
- PgBouncer in transaction mode
- Migrate Postgres to AWS RDS Multi-AZ

Architecture: modular monolith + read replica + PgBouncer. The only new "process" is a nightly cron for low-balance alerts, which can run as a second process on the same host.

### Phase 3 — 100+ schools (18+ months)

At this scale expect: reporting queries needing dedicated compute, Spelling App integration receiving high fanout during lunch rushes, and potentially multi-region latency requirements.

Extract at Phase 3:
- Reporting module as a separate read-heavy service backed by a replica or data warehouse
- Notification service if email volume requires dedicated queuing
- Integration adapter service for the Spelling App bridge if that integration grows beyond cafeteria data

Do not extract at Phase 3: wallets, orders, inventory, or cash drawers. These share the same transaction boundary and must remain colocated with the database until a specific, measured constraint requires otherwise.

Revisit schema-per-tenant only if a regulatory audit or enterprise customer contractually requires it. The operational cost of 100+ schemas (migration fan-out, connection pooling complexity, backup strategy) is high. Row-level isolation with the current FK model satisfies FERPA and standard financial audit requirements.

---

## Decision Reference

| Concern | Decision | Revisit When |
|---|---|---|
| Shared schema vs. schema-per-tenant | Shared schema | Enterprise customer demands physical isolation |
| Monolith vs. microservices | Modular monolith through Phase 2 | Reporting queries measurably degrade cashier register latency |
| Railway vs. AWS | Railway for Phase 1 | ~20–30 schools or Multi-AZ Postgres required |
| In-transaction vs. async notifications | Fire-and-forget after commit | Email volume requires retry guarantees |
| Card payment sync vs. webhook flow | Webhook-driven order creation | N/A — this is the correct permanent design |
| Queue vs. synchronous email | Synchronous at Phase 1 | Phase 2 volume |
| IaC: railway.toml vs. Terraform | railway.toml for Phase 1 | AWS migration |
