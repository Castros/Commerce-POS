# SSO Strategy and Permission Model

Date: 2026-06-04

## Summary

Commerce POS can support SSO, but SSO should not replace the application's internal
authorization model.

SSO should answer:

```text
Who is this person?
```

Commerce POS should still answer:

```text
Which organization can they access?
Which stores can they access?
What role do they have?
What actions are they allowed to perform?
```

For early stage trials, SSO is not the first blocker. Tenant and store authorization
inside the API is more urgent. For production SaaS, SSO becomes important because
schools and companies often want centralized staff access control through Google
Workspace, Microsoft Entra ID, Clever, ClassLink, or another identity provider.

## Recommendation

Support SSO in phases:

1. Keep PIN/browser session login for cashier terminals.
2. Harden tenant-scoped login and backend store assignment enforcement.
3. Add SSO for organization admins, managers, accountants, and platform admins.
4. Later support provider-specific school integrations such as Google Workspace,
   Microsoft Entra ID, Clever, and ClassLink.

Cashier PIN login can still exist after SSO. Cafeteria registers often need fast
shared-terminal workflows, while admins and managers benefit from SSO.

## Target Login Model

All login methods should resolve to the same internal Commerce POS session shape:

```text
userId
organizationId
role
assignedStores
authMode
```

The rest of the application should not need to care whether the user logged in with:

- PIN
- Password
- Magic link
- Google SSO
- Microsoft SSO
- Clever/ClassLink

## Internal Authorization Remains Source of Truth

SSO provider claims should not directly grant broad POS permissions.

Recommended flow:

```text
SSO provider identity
  -> commerce_user_identities
  -> commerce_users
  -> role
  -> store assignments
  -> permissions
```

This keeps Commerce POS in control of sensitive actions such as:

- Refunds
- Wallet top-ups
- Wallet credit-limit changes
- Product edits
- Inventory adjustments
- Credential issuance
- Cash drawer closeout
- Financial reports
- Staff and permission changes

## Suggested Tables

### `commerce_identity_providers`

Stores configured SSO providers per organization.

```text
id
organization_id
provider_type
issuer_url
client_id
client_secret_ref
domain_hint
active
created_at
updated_at
```

Example `provider_type` values:

```text
google_workspace
microsoft_entra
clever
classlink
oidc
saml
```

### `commerce_user_identities`

Links external identities to Commerce POS users.

```text
id
organization_id
user_id
provider_id
provider_subject
email
email_verified
created_at
last_login_at
```

Use `provider_subject` as the stable identity key. Do not rely on email alone because
emails can change.

### Optional `commerce_sso_group_mappings`

Later, support mapping IdP groups to POS roles and store assignments.

```text
id
organization_id
provider_id
external_group_id
external_group_name
role
store_id
active
created_at
updated_at
```

Group mapping should be tenant-scoped and auditable.

## Provisioning Policy

Start conservative.

### Stage and Early Production

Use explicit user linking:

1. Organization admin creates or imports staff in Commerce POS.
2. Admin enables SSO provider for the organization.
3. On first SSO login, Commerce POS matches by provider subject or verified email.
4. If no matching user exists, block login or create a pending user.
5. Admin assigns role and store access inside Commerce POS.

This avoids accidental admin access from a broad IdP group.

### Later Production

Add controlled auto-provisioning:

- Only for configured domains or groups.
- Only into low-risk default roles.
- Require admin review for elevated roles.
- Log every provisioned user and role/store assignment.

## Permission Handling

SSO should integrate with existing RBAC, not bypass it.

Recommended permission sources:

```text
commerce_users.role
commerce_user_store_assignments
rolePermissions in API authorization layer
```

Rules:

- `platform_admin` and `super_admin` can operate across tenants only through explicit
  platform-admin flows.
- `organization_owner` and `organization_admin` are scoped to one organization.
- `store_manager` is scoped to assigned stores.
- `cashier` is scoped to assigned stores and cashier-safe actions.
- `accountant` can read financial reports but should not operate the register.
- Parent/customer roles should only access their own linked records.
- Service tokens should be scoped separately from human SSO users.

## Required Backend Work Before SSO

Before adding SSO, complete the core SaaS authorization work:

- Add `authorizeTenant(req, organizationId)`.
- Add `authorizeStore(req, organizationId, storeId)`.
- Enforce store assignments on backend routes.
- Require tenant context for PIN login.
- Add login rate limiting and failed attempt tracking.
- Add session revocation.
- Add CSRF protection for cookie-authenticated writes.

Without this, SSO would improve identity but still leave authorization gaps.

## SSO Endpoint Shape

Initial OIDC endpoint design:

```text
GET  /v1/auth/sso/:providerId/start
GET  /v1/auth/sso/:providerId/callback
POST /v1/auth/sso/logout
```

The callback should:

1. Validate OIDC state and nonce.
2. Validate issuer, audience, signature, and token expiry.
3. Read stable subject and verified email.
4. Resolve `commerce_user_identities`.
5. Resolve `commerce_users`.
6. Confirm organization and user are active.
7. Load store assignments.
8. Create a browser session.
9. Write an audit event.

## Security Requirements

- Store provider secrets in cloud secret manager.
- Never store raw SSO tokens unless there is a clear reason.
- Validate issuer and audience on every callback.
- Use state and nonce protections.
- Use short-lived browser sessions.
- Revoke sessions when roles or store assignments change.
- Audit login success, login failure, new identity links, and group-mapping changes.
- Rate limit SSO callback failures.

## What Not To Do

- Do not let SSO claims directly assign `platform_admin`.
- Do not trust email domain alone for admin access.
- Do not auto-create high-privilege users.
- Do not let a user choose an arbitrary `organizationId` after SSO.
- Do not use the global `COMMERCE_API_TOKEN` as a tenant SSO integration credential.

## Recommended First SSO Milestone

The first useful SSO milestone should be:

```text
Google Workspace or Microsoft Entra ID login for organization admins/managers,
mapped to existing Commerce POS users, with Commerce POS roles and store assignments
remaining authoritative.
```

This is enough to sell centralized staff login without increasing financial or
tenant-isolation risk.
