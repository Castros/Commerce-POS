# Security Review Process

## Goal

Commerce POS is a multi-tenant financial application. Security review must focus on
preventing cross-tenant access, unauthorized store operations, duplicate money movement,
wallet/order/refund corruption, parent data exposure, unsafe AI usage, and accidental
production exposure of development shortcuts.

This document captures the current security review priorities and the testing process
needed to keep the app safe as features are added.

## Highest Priority Risks

### 1. Store-Level Authorization Gaps

The project has an `authorizeStore()` helper, but not every store-scoped route appears
to enforce it.

Risk:

- A cashier or manager assigned to one store may read or mutate data for another store
  inside the same organization.

Areas that need review and tests:

- Order list/detail.
- Refunds.
- Product reads/writes.
- Customer reads where home store matters.
- Guardian access from staff routes.
- Fee assignment create/pay.
- Inventory import/apply.
- Reports with store filters.
- AI endpoints with store filters.

Expected rule:

- Platform roles can cross tenants and stores.
- Organization admins can operate across stores in their tenant.
- Store managers and cashiers must be limited to assigned stores where the endpoint is
  store-scoped.

### 2. Wallet Top-Up Idempotency

Manual wallet top-up currently needs the same protection as sales and refunds.

Risk:

- Browser retry, mobile network retry, or malicious replay can duplicate stored value.

Expected rule:

- `POST /v1/wallets/:id/topups` should require `Idempotency-Key`.
- Replaying the same key and same body should return the original response.
- Replaying the same key with a different body should return conflict.

### 3. Staff PIN Login Hardening

Staff login currently allows PIN-based flows. PIN login is useful for cafeteria
operations, but it is high risk in production if not tightly scoped.

Risks:

- Shared or common PINs can authenticate the wrong user.
- Identifierless login can search across active users.
- IP-only rate limiting may not be enough for school networks.

Expected rules:

- Production login should require organization or identifier.
- PIN length and entropy requirements should match the deployment threat model.
- Repeated failures should be rate limited per IP and per account/identifier.
- Inactive users must not authenticate.
- PIN reset should revoke active sessions.
- Staff sessions should expire and be revocable.

### 4. Development Auth Bypass

Local development uses `x-actor-*` headers when production auth is disabled.

Risk:

- If `ALLOW_DEV_AUTH=true` or `NODE_ENV` is wrong in production, request headers can
  become a full service actor.

Expected deployment rule:

- Production must run with `NODE_ENV=production`.
- Production must not set `ALLOW_DEV_AUTH=true`.
- Deploy should fail if development auth is enabled.

## Medium Priority Risks

### Guardian Link Integrity

Guardian/student linking should be protected both in route code and database constraints.

Risks:

- A staff route may link a guardian to a student from another organization if raw IDs are
  accepted without composite tenant validation.
- Parent portal access checks may be correct, but bad links in the database can still
  create privacy problems.

Expected rules:

- Guardian and student must belong to the same organization.
- `commerce_guardian_students` should have composite tenant foreign keys where possible.
- Staff-side linking should explicitly validate both records by `organization_id`.

### Guardian OTP Rate Limiting

Parent magic-code endpoints are public.

Current positive behavior:

- Request endpoint should not reveal whether an email exists.

Risks:

- 6-digit OTP can be brute-forced without per-email and per-IP throttling.
- Repeated request attempts can spam parent email.

Expected rules:

- Rate limit OTP request by IP and normalized email.
- Rate limit OTP verify by IP and normalized email.
- Invalidate old unused codes when issuing a new one.
- Reject expired codes.
- Reject reused codes.
- Log suspicious repeated failures.

### AI Endpoint Abuse

AI endpoints use paid LLM calls and may process sensitive operational facts.

Risks:

- Managers or admins may repeatedly trigger expensive AI calls.
- Date windows may be too large.
- Cross-tenant usage data may be exposed if usage endpoints are not tenant-scoped or
  platform-restricted.

Expected rules:

- AI endpoints must authorize tenant access.
- AI usage endpoints must be platform-only or tenant-scoped.
- Add daily org/user quotas.
- Add max date windows.
- Add deduplication by input hash where possible.
- AI outputs must write only to `commerce_ai_records`.
- AI must never write to financial tables.

### Upload Public ID Validation

Image upload commit should validate the public ID returned from Cloudinary.

Risk:

- A user may attach an asset outside their organization folder if `newPublicId` is trusted.

Expected rule:

- `newPublicId` must start with the expected tenant path, such as:

```text
orgs/{organizationId}/...
```

It should also match the entity type being updated.

## Security Test Plan

### Tenant Isolation Tests

For each tenant-owned module, test that an actor from Organization A cannot read or write
Organization B data.

Cover:

- Organizations
- Stores
- Products
- Product categories
- Customers
- Wallets
- Orders
- Refunds
- Inventory
- Cash drawers
- Staff
- Guardians
- Fees
- Reports
- AI records
- Uploads

### Store Assignment Tests

Create a test organization with two stores and a cashier/manager assigned to one store.

Verify assigned users cannot access the other store through:

- Register sale endpoints.
- Orders list/detail.
- Refund endpoints.
- Inventory adjustment endpoints.
- Cash drawer endpoints.
- Product endpoints where store-scoped.
- Reports with store filters.
- AI endpoints with store filters.
- Fee assignment endpoints.

### Money Movement Replay Tests

Every money-moving endpoint should be protected against duplicate requests.

Test replay behavior for:

- Wallet sale.
- Cash sale.
- Card sale.
- Wallet top-up.
- Full refund.
- Partial refund.
- Fee payment.

Required assertions:

- Same key and same body returns the original response.
- Same key and different body returns conflict.
- No duplicate payment row.
- No duplicate wallet ledger row.
- No duplicate inventory movement.
- No duplicate cash drawer event.

### Concurrency Tests

Use simultaneous requests to prove row locks and constraints hold.

Test:

- Two wallet sales against the same wallet.
- Two sales against the same inventory item.
- Two refunds against the same order.
- Two partial refunds against the same order item.
- Two fee payments against the same assignment.
- Two cash drawer opens for the same register.

Expected outcome:

- One request succeeds and the other fails cleanly, or both return the same idempotent
  result when appropriate.
- Balances and inventory quantities remain correct.

### Auth And Session Tests

Cover:

- Production rejects unauthenticated writes.
- Production rejects `x-actor-*` development headers.
- Invalid bearer token is rejected.
- Browser session cookie is required for staff UI APIs.
- Session expires.
- Logout revokes session.
- Inactive staff cannot continue using a session.
- PIN reset revokes or invalidates existing sessions.
- Staff login requires enough context in production.
- Staff login rate limits repeated failures.

### Guardian Portal Tests

Cover:

- Magic-code request does not leak registered emails.
- Wrong code fails.
- Expired code fails.
- Reused code fails.
- Guardian can see only linked students.
- Guardian cannot see an unlinked student in same tenant.
- Guardian cannot see a student in another tenant.
- Notification preferences update only the logged-in guardian.
- Logout revokes guardian session.

### AI Safety Tests

Cover:

- AI endpoints require `reports:read` or stronger permission.
- AI endpoints authorize tenant access.
- Store filters respect store assignment.
- Date ranges are bounded.
- Usage endpoint is platform-only or tenant-scoped.
- AI records are written to `commerce_ai_records`.
- No AI endpoint writes to wallet, order, payment, inventory, or cash drawer tables.
- LLM prompts receive precomputed facts, not raw financial rows requiring calculation.

### Upload Tests

Cover:

- Upload signature requires authorization.
- Signature folder path includes organization ID.
- Commit rejects `newPublicId` outside the organization folder.
- Commit rejects mismatched entity type.
- User from another tenant cannot update another tenant's product/customer image.

## CI Security Gates

Add security gates in phases.

### Immediate

Run API integration tests with Postgres on every PR.

Run dependency audit:

```bash
cd api && npm audit --audit-level=high
cd web && npm audit --audit-level=high
```

### Near-Term

Add:

- Gitleaks or equivalent secret scanning.
- Semgrep OWASP/default JavaScript rules.
- GitHub dependency review on pull requests.
- Migration prefix guard.
- Deploy environment assertion script.

### Later

Add:

- Playwright smoke tests for auth boundaries.
- Scheduled dependency audits.
- Scheduled security test suite with concurrency cases.
- Basic rate-limit abuse tests.

## Deployment Security Checks

Deploy should fail if:

- `NODE_ENV` is not `production`.
- `DISABLE_DEMO_SEED` is not `true`.
- `ALLOW_DEV_AUTH` is set.
- `COMMERCE_API_TOKEN` is empty.
- `SESSION_SECRET` is empty.
- `CORS_ORIGINS` contains wildcard origins.
- `CORS_ORIGINS` contains localhost in production.
- `DATABASE_URL` is empty.
- `ANTHROPIC_API_KEY` is required for enabled AI features but missing.

Production should also avoid writing secrets to logs.

## Manual Review Checklist

Use this checklist before merging high-risk changes.

### Financial Changes

- All money values use integer cents.
- No floating point money.
- Writes happen inside one transaction.
- Wallet rows are locked before balance changes.
- Inventory rows are locked or protected from race conditions.
- Idempotency key is required.
- Audit event is written in the same transaction.
- Wallet ledger rows are inserted, never updated or deleted.
- Refunds cannot exceed paid/refundable quantity or amount.

### Tenant Changes

- Every tenant-owned query filters by `organization_id`.
- No tenant object is loaded by bare UUID alone.
- Composite foreign keys are used where possible.
- Platform-only endpoints are explicitly platform-only.
- Store-scoped endpoints enforce assigned-store access.

### Parent/Guardian Changes

- Parent sessions are separate from staff sessions.
- Guardian can only access linked students.
- Email/OTP flows do not leak registered account state.
- Public endpoints are rate-limited.
- Cross-org guardian/student links are rejected.

### AI Changes

- AI receives precomputed facts.
- AI does not calculate financial totals from raw rows.
- AI writes only to `commerce_ai_records`.
- AI is not called inside financial transactions.
- AI endpoints have tenant authorization and usage bounds.

### Deployment Changes

- Demo seed is disabled in production.
- Development auth is disabled in production.
- Secrets are supplied through environment/secrets manager.
- CORS is restricted.
- Migrations run before restart.
- Rollback path is documented.

## Recommended First Fixes

1. Add Postgres-backed API tests to CI.
2. Add authorization tests for cross-tenant and cross-store access.
3. Require idempotency for manual wallet top-ups.
4. Harden production staff PIN login by requiring organization or identifier.
5. Add guardian OTP rate limits.
6. Add deploy-time assertions for `NODE_ENV`, `DISABLE_DEMO_SEED`, and `ALLOW_DEV_AUTH`.
7. Restrict or tenant-scope AI usage reporting.
8. Validate upload public IDs on commit.
