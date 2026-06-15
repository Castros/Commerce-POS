# Multi-Tenant Isolation Audit — Security Review
**Date:** June 14, 2026
**Audited by:** Automated security agent + manual review
**Status:** All issues resolved

---

## What This Document Is

Commerce POS serves multiple organizations (schools, stores, restaurants) from a single shared database. Every table that holds business data has an `organization_id` column that scopes it to one tenant. This is the fundamental contract: Organization A can never read, write, or modify data that belongs to Organization B.

This document records every isolation gap found during a full audit of the API codebase, why it existed, what an attacker or misbehaving client could have done with it, and exactly what was changed to close it.

---

## Background: How Isolation Is Supposed to Work

Every authenticated API request goes through this chain:

1. **`authenticateRequest`** — reads the session cookie or bearer token, sets `req.actor` with the caller's `organizationId` and `role`.
2. **`authorizeTenant(actor, organizationId)`** — called at the top of each route handler. Throws `403 Forbidden` if the actor's organization doesn't match the one being requested. Platform roles (`platform_admin`, `super_admin`, `service`) bypass this check intentionally — they manage the whole platform.
3. **SQL queries** — every `SELECT`, `INSERT`, `UPDATE`, and `DELETE` should include `WHERE organization_id = $X` to enforce isolation at the database layer as a second line of defense.

The audit found places where step 3 was missing or incomplete. Step 2 was mostly correct, but step 3 is critical because it prevents bugs in step 2 from becoming data breaches.

---

## Issues Found and Fixed

---

### Issue 1 — HIGH RISK
**Location:** `api/src/modules/ai/ai.routes.js` — `GET /v1/ai/usage`

#### What the code did before
The usage endpoint returned AI token consumption and cost data. It required the `organizations:write` permission to access. The `organization_owner` role has wildcard (`*`) permissions, which includes `organizations:write`. If an org owner called this endpoint without providing an `organizationId` query parameter, the endpoint returned cost and usage data for **every organization on the platform**.

#### What an attacker could have done
Any school principal or store owner (anyone with the `organization_owner` role) could open their browser console and call:
```
GET /v1/ai/usage
```
with no parameters and receive a breakdown of how much every other school on the platform spends on AI features — including their usage volumes, which indirectly reveals how busy those schools are and how much activity they have. This is a competitive intelligence leak between customers.

#### What was changed
Non-platform users are now always scoped to their own organization. If they call the endpoint without specifying an `organizationId`, the server substitutes their own org's ID and enforces it through `authorizeTenant`. Only users with the roles `platform_admin`, `super_admin`, or `service` can see cross-org usage data.

```js
// Before — no org enforcement for org owners:
const rows = await aiRepo.getUsageSummary(query); // could be all orgs

// After — non-platform callers forced into their own org:
if (!PLATFORM_ROLES.has(actor.role)) {
  const orgId = req.query.organizationId || actor.organizationId;
  authorizeTenant(actor, orgId); // throws 403 if wrong org
  const rows = await aiRepo.getUsageSummary({ ...req.query, organizationId: orgId });
  return res.json({ data: rows });
}
```

---

### Issue 2 — HIGH RISK
**Location:** `api/src/modules/guardians/guardians.routes.js` — `POST /v1/guardians/:id/students`

#### What the code did before
This endpoint links a guardian (parent) to a student. The guardian's ID comes from the URL parameter (`:id`). The code verified that the requesting actor belonged to the organization in the request body — but it never verified that the guardian UUID in the URL actually belonged to that same organization.

#### What an attacker could have done
Imagine School A and School B are both on the platform. A manager at School A knows (or guesses) the UUID of a guardian that belongs to School B. They could send:
```
POST /v1/guardians/{school-b-guardian-uuid}/students
Body: { organizationId: "{school-a-org-id}", studentId: "{school-a-student-id}" }
```
The server would pass the `authorizeTenant` check (School A's actor is accessing School A's org). It would then insert a row in `commerce_guardian_students` linking School B's guardian to School A's student.

The result: School B's parent now appears linked to School A's student in the database. If School B ever queries that guardian's linked students, they would see a student from a completely different school. The guardian's portal login would show them purchase history that isn't theirs. Notification emails meant for School A's student could be sent to School B's parent.

This is a cross-tenant data corruption issue, not just a read exposure.

#### What was changed
Before the INSERT, the server now verifies that the guardian UUID belongs to the requesting organization:
```js
// Added — verify guardian belongs to this org:
const gCheck = await pool.query(
  `SELECT id FROM commerce_guardians WHERE id = $1 AND organization_id = $2 AND active = TRUE`,
  [guardianId, body.organizationId]
);
if (gCheck.rowCount === 0) throw notFound("Guardian not found");
```
If the guardian doesn't belong to the org, the request fails with `404 Not Found` — which also prevents UUID enumeration (an attacker can't tell whether the UUID exists or just doesn't belong to them).

---

### Issue 3 — HIGH RISK
**Location:** `api/src/modules/guardians/guardians.routes.js` — `POST /v1/guardians/:id/students`

#### What the code did before
Same endpoint as Issue 2. The `studentId` in the request body was also not verified to belong to the organization.

#### What an attacker could have done
A manager at School A could link one of School B's students to their own guardian:
```
POST /v1/guardians/{school-a-guardian-uuid}/students
Body: { organizationId: "{school-a-org-id}", studentId: "{school-b-student-id}" }
```
This would cause School B's student to appear in School A's guardian portal, exposing their purchase history, wallet balance, and personal information (name, spending patterns) to someone from another organization entirely.

In a school context, this is a FERPA/COPPA-class privacy violation — student data exposed to unauthorized parties.

#### What was changed
The student is now verified to belong to the organization before linking:
```js
// Added — verify student belongs to this org:
const sCheck = await pool.query(
  `SELECT id FROM commerce_customers WHERE id = $1 AND organization_id = $2`,
  [body.studentId, body.organizationId]
);
if (sCheck.rowCount === 0) throw notFound("Student not found");
```

---

### Issue 4 — HIGH RISK (Operational)
**Location:** `api/src/shared/auth/auth.js` and `api/src/modules/inventory/inventoryAI.routes.js`

#### What the code did before
Every route in the new AI inventory extraction module used `requirePermission("inventory:read")` or `requirePermission("inventory:write")`. However, neither `inventory:read` nor `inventory:write` existed anywhere in the `rolePermissions` map. The permission check works by looking up the role's permission list and checking for the exact string — if the string isn't in the list, access is denied.

The roles `organization_admin` and `store_manager` — the exact roles that manage inventory — did not have these permissions. The only roles that could access the inventory AI endpoints were those with wildcard (`*`) permissions: `platform_admin`, `super_admin`, and `organization_owner`. Regular staff, even managers, were silently blocked with a `403 Forbidden`.

#### What could have happened
The AI invoice upload feature would appear broken for all normal staff. Store managers would be unable to upload invoices, review AI extractions, or approve stock updates — the core workflow of the new feature. This would only be discovered in production when real users reported the feature doesn't work, with no error message explaining why.

Additionally, if the permission strings had been added naively without this audit (e.g., added only to `organization_admin` but not `store_manager`), the actual data isolation fixes in Issues 2 and 3 might never have been noticed.

#### What was changed
The following permissions were added to the `rolePermissions` map:

| Role | Added Permissions |
|---|---|
| `organization_admin` | `inventory:read`, `inventory:write` |
| `store_manager` | `inventory:read`, `inventory:write` |
| `cashier` | `inventory:read` (view only — needed for stock badges at register) |
| `accountant` | `inventory:read` (needed for cost/margin reports) |
| `service` | `inventory:read`, `inventory:write` |

---

### Issue 5 — MEDIUM RISK
**Location:** `api/src/modules/guardians/guardians.routes.js` — `POST /v1/guardians/` (create)

#### What the code did before
After creating a guardian, the server fetched the newly-created record to return in the response. The fetch query was:
```sql
SELECT ... FROM commerce_guardians g
LEFT JOIN commerce_guardian_students gs ON gs.guardian_id = g.id
LEFT JOIN commerce_customers c ON c.id = gs.student_id
WHERE g.id = $1
GROUP BY g.id
```
No `organization_id` filter on the WHERE clause. The `g.id` is the UUID that was just inserted, so this is almost always safe — but the LEFT JOIN to `commerce_guardian_students` had no org filter either. If cross-org links had been created via Issues 2 and 3, this response would have included student names from other organizations in the `students` array returned to the caller.

#### What could have happened
An attacker who first exploited Issues 2 or 3 to create cross-org guardian-student links could then trigger this endpoint to receive student names from other organizations in the API response. Even without active exploitation, the lack of an org filter on the final SELECT is a pattern that could cause subtle data leaks as the codebase evolves.

#### What was changed
```sql
-- Before:
WHERE g.id = $1

-- After:
WHERE g.id = $1 AND g.organization_id = $2
```
The organization ID (already validated earlier in the same handler) is now passed as a second parameter.

---

### Issue 6 — LOW RISK
**Location:** `api/src/modules/inventory/inventory.routes.js` — `GET /v1/inventory/invoices/:id`

#### What the code did before
The invoice detail endpoint fetched the invoice itself with an org check (`WHERE i.organization_id = $1 AND i.id = $2`), then fetched the invoice's line items with only:
```sql
WHERE l.invoice_id = $1
```
No org filter on the line items query.

#### Why this was low risk, not high
Because the code throws `404 Not Found` if the invoice doesn't belong to the org, and only proceeds to the line items query after that check passes. An attacker can't reach the lines query for an invoice that isn't theirs.

#### Why it was still fixed
Defense in depth. If the order of operations ever changed (e.g., the invoice check was refactored, or the queries were parallelized), the lines query would have no protection of its own. Database-level isolation should not depend on application-level query ordering.

#### What was changed
```sql
-- Before:
WHERE l.invoice_id = $1

-- After:
WHERE l.invoice_id = $1 AND l.organization_id = $2
```

---

### Issue 7 — LOW RISK
**Location:** `api/src/modules/inventory/inventory.routes.js` — `POST /v1/inventory/invoices/:id/approve`

#### What the code did before
Two queries inside the approval transaction lacked org scoping:

1. The lines query that loads what to apply to inventory:
   ```sql
   WHERE invoice_id = $1 AND match_status != 'skipped' AND product_id IS NOT NULL
   ```
2. The final UPDATE marking the invoice approved:
   ```sql
   UPDATE commerce_inventory_invoices SET status = 'approved' ... WHERE id = $1
   ```

Both were protected by the earlier org-verified `SELECT ... FOR UPDATE` lock at the start of the transaction.

#### What could have happened
The same defense-in-depth argument applies. Within the transaction, the org was already verified. But the UPDATE with no org filter means a future refactor that breaks the transaction boundary (e.g., extracting the UPDATE into a helper function called outside the transaction) would silently lose the org check. The lines query relying on invoice ID alone means UUID collisions or future schema changes could cause lines from one org to be applied to another org's inventory.

#### What was changed
```sql
-- Lines query:
WHERE invoice_id = $1 AND organization_id = $2 AND match_status != 'skipped' ...

-- Final UPDATE:
WHERE id = $1 AND organization_id = $3
```

---

### Issue 8 — LOW RISK
**Location:** `api/src/modules/inventory/inventoryAI.routes.js` — `POST /v1/inventory/ai/drafts/:id/approve`

#### What the code did before
The final UPDATE that marks a draft as approved:
```sql
UPDATE commerce_inventory_ai_drafts
SET status = 'approved', invoice_id = $1, reviewed_by = $2, reviewed_at = NOW()
WHERE id = $3
```
No `organization_id` in the WHERE clause. The draft was loaded and locked with an org check earlier in the same transaction.

#### What could have happened
Identical to Issue 7 — safe within the current transaction structure, non-defensive for future refactors. A bug or refactor that changes the transaction boundary would allow one org to approve (and thereby modify the status of) a draft that belongs to another org.

#### What was changed
```sql
WHERE id = $3 AND organization_id = $4
```

---

### Issue 9 — LOW RISK
**Location:** `api/src/modules/guardians/guardians.routes.js` — `POST /v1/guardians/:id/send-invite`

#### What the code did before
When sending a guardian invite email, the server fetched student names to include in the email body:
```sql
SELECT c.name FROM commerce_guardian_students gs
JOIN commerce_customers c ON c.id = gs.student_id
WHERE gs.guardian_id = $1
```
No org filter. The guardian itself was verified to belong to the org in the query immediately before this one — but the student name lookup had no org boundary.

#### What could have happened
This was a dependent risk. On its own (with no cross-org links in the database), this query is safe because the guardian's students are always in the same org. However, if Issues 2 or 3 had been exploited to create cross-org guardian-student links, a guardian invite email could include the names of students from a completely different school. A parent at School B would receive an email saying "You have been invited to School A's portal. Your linked students are: [Student from School B's name]." This exposes a student's name to an unaffiliated school.

#### What was changed
```sql
-- Before:
WHERE gs.guardian_id = $1

-- After:
WHERE gs.guardian_id = $1 AND gs.organization_id = $2
-- Also scoped the JOIN:
JOIN commerce_customers c ON c.id = gs.student_id AND c.organization_id = $2
```

---

### Issue 10 — LOW RISK
**Location:** `api/src/modules/staff/staff.routes.js` — `PATCH /:id` and `POST /:id/pin`

#### What the code did before
Both staff update endpoints used `assertSameOrg(actor, existing.organizationId)` to verify the actor has rights to modify this staff member. Then the UPDATE queries were:
```sql
-- Profile update:
UPDATE commerce_users SET name = $1, ... WHERE id = $4

-- PIN update:
UPDATE commerce_users SET pin_hash = $1 ... WHERE id = $4
```
No `organization_id` in the WHERE clause of either UPDATE.

#### What could have happened
The application-level check (`assertSameOrg`) was correct and would prevent unauthorized updates under normal conditions. The risk is in the gap between the check and the UPDATE: if a Time-of-Check/Time-of-Use (TOCTOU) race condition were possible — e.g., a staff member is transferred between orgs between the `fetchStaffRow` call and the UPDATE — the UPDATE would apply to whatever org the user was in at UPDATE time, not at check time. More practically, this is a maintenance risk: if a future developer removed or moved the `assertSameOrg` call while refactoring, the UPDATE would have no org protection at the database layer.

#### What was changed
The already-verified `existing.organizationId` is now passed as an additional parameter:
```sql
-- Profile update:
WHERE id = $4 AND organization_id = $5

-- PIN update:
WHERE id = $4 AND organization_id = $5
```

---

### Issue 11 — LOW RISK
**Location:** `api/src/modules/inventory/inventoryAI.routes.js` — `GET /v1/inventory/ai/drafts` and `GET /v1/inventory/ai/drafts/:id`

#### What the code did before
Both endpoints JOIN `commerce_stores` and `commerce_inventory_suppliers` to include the store name and supplier name in the response. The JOINs were:
```sql
LEFT JOIN commerce_stores s ON s.id = d.store_id
LEFT JOIN commerce_inventory_suppliers sup ON sup.id = d.supplier_id
```
No org scoping on the JOIN conditions. Since UUIDs are globally unique, a collision is cosmetically impossible — but the pattern still violates the isolation principle.

#### What could have happened
In the extremely unlikely event that two different orgs shared a store UUID or supplier UUID (practically impossible with UUIDs, but possible with a crafted attack or database migration error), the store or supplier name from the wrong org would appear in the draft response. More importantly, this is the kind of pattern that gets copied and evolves into actual cross-org leaks.

#### What was changed
```sql
-- Before:
LEFT JOIN commerce_stores s ON s.id = d.store_id
LEFT JOIN commerce_inventory_suppliers sup ON sup.id = d.supplier_id

-- After:
LEFT JOIN commerce_stores s ON s.id = d.store_id AND s.organization_id = d.organization_id
LEFT JOIN commerce_inventory_suppliers sup ON sup.id = d.supplier_id AND sup.organization_id = d.organization_id
```

---

## Summary Table

| # | Severity | Endpoint | Root Cause | Potential Impact |
|---|---|---|---|---|
| 1 | **HIGH** | `GET /ai/usage` | Permission check too broad — org owners had wildcard access | Org owners could see AI cost data for all other schools |
| 2 | **HIGH** | `POST /guardians/:id/students` | Guardian UUID not verified to belong to org | Cross-org guardian-student links; privacy data corruption |
| 3 | **HIGH** | `POST /guardians/:id/students` | Student UUID not verified to belong to org | Student data exposed to unaffiliated organizations |
| 4 | **HIGH** | All `/inventory/ai/*` routes | `inventory:read/write` missing from `rolePermissions` | Store managers locked out of the entire AI invoice feature |
| 5 | **MEDIUM** | `POST /guardians/` | Final SELECT had no org filter | Student names from other orgs in API response if links were corrupted |
| 6 | **LOW** | `GET /invoices/:id` | Invoice lines query had no org filter | Non-defensive; safe only due to sequential query ordering |
| 7 | **LOW** | `POST /invoices/:id/approve` | Lines query + final UPDATE had no org filter | Non-defensive; safe only within transaction boundary |
| 8 | **LOW** | `POST /ai/drafts/:id/approve` | Final draft UPDATE had no org filter | Non-defensive; safe only within transaction boundary |
| 9 | **LOW** | `POST /guardians/:id/send-invite` | Student name lookup had no org filter | Student names from wrong org in invite emails |
| 10 | **LOW** | `PATCH /staff/:id`, `POST /staff/:id/pin` | UPDATE WHERE clause had no org | Non-defensive; TOCTOU window in theory |
| 11 | **LOW** | `GET /ai/drafts`, `GET /ai/drafts/:id` | JOINs not scoped to draft's org | Store/supplier names could theoretically bleed across orgs |

---

## What "Defense in Depth" Means Here

Several LOW-risk issues were described as "safe today, non-defensive." This deserves explanation.

A two-layer isolation model looks like this:

```
Layer 1 (Application):  authorizeTenant() + assertSameOrg()
Layer 2 (Database):     WHERE organization_id = $X on every query
```

When only Layer 1 exists, the system works correctly — until it doesn't. Real-world failures that break Layer 1 alone include:

- A developer refactors a handler and moves or removes the `authorizeTenant` call
- A new endpoint is added that reuses an existing SQL query but forgets to add the auth check
- A middleware is bypassed due to a route ordering bug in Express
- A bug in the session system returns the wrong actor

In all of these cases, Layer 2 (org scoping in SQL) is the last line of defense that prevents a bug from becoming a breach. This is standard practice for any multi-tenant SaaS. Both layers must always exist independently.

---

## Files Changed

| File | Changes |
|---|---|
| `api/src/shared/auth/auth.js` | Added `inventory:read` and `inventory:write` to role permission maps |
| `api/src/modules/ai/ai.routes.js` | Scoped `/usage` endpoint to caller's org for non-platform roles |
| `api/src/modules/guardians/guardians.routes.js` | Added guardian + student org verification before linking; org filter on guardian create response; org filter on student name lookup for invite emails |
| `api/src/modules/inventory/inventory.routes.js` | Added org filter to invoice lines query; added org filter to lines query and final UPDATE in approve endpoint |
| `api/src/modules/inventory/inventoryAI.routes.js` | Added org filter to final draft approve UPDATE; scoped store and supplier JOINs to draft's org |
| `api/src/modules/staff/staff.routes.js` | Added org filter to UPDATE WHERE clauses in PATCH and PIN endpoints |

---

## Recommendations Going Forward

1. **Code review checklist** — every new route that touches org-scoped data should be reviewed against two questions: (a) is `authorizeTenant` called before any DB access? and (b) does every SQL query include `AND organization_id = $X`?

2. **Integration tests** — add a test fixture that creates two organizations with overlapping data, then verifies that API calls authenticated as Org A cannot access or modify Org B's data, even when the correct Org B UUIDs are supplied.

3. **Service role scope** — the `service` role (API bearer token) currently bypasses all org checks. This is intentional for internal automation, but any external system receiving this token can access all orgs. The token should be treated as highly sensitive and rotated regularly.

4. **Future endpoints** — the pattern for new routes should be:
   ```js
   authorizeTenant(req.actor, body.organizationId);  // Layer 1
   // ...
   await pool.query(`... WHERE id = $1 AND organization_id = $2`, [id, body.organizationId]); // Layer 2
   ```
   Both lines are required. Neither is optional.
