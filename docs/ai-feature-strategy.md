# AI Feature Strategy

Date: 2026-06-04

## Summary

Commerce POS should position AI as practical operational assistance, not as an
autonomous cashier or financial decision maker.

Recommended positioning:

```text
AI-assisted POS for school cafeterias, student wallets, and campus commerce.
```

The best AI features for traction are the ones that save school operators time,
reduce waste, surface financial issues, and make parent wallet management easier.

AI should:

- Summarize
- Draft
- Recommend
- Alert
- Explain trends

AI should not directly:

- Move money
- Refund orders
- Change wallet balances
- Approve credit limits
- Delete financial records
- Issue student credentials without review
- Modify immutable ledgers

Human approval must remain required for financial, identity, and permission changes.

## Must-Have AI Features For Traction

These are the AI features most likely to help the app get attention, demos, and
customer interest.

### 1. AI Daily Closeout Summary

Generate a daily operating summary for each store/cafeteria.

The summary should include:

- Total sales
- Wallet sales
- Cash sales
- Card/demo-card sales
- Drawer expected cash
- Drawer counted cash
- Drawer variance
- Refunds
- Top-selling products
- Low-stock products
- Inventory items with unusual movement
- Students/customers with negative wallet balances
- Notable cashier or register events

Example output:

```text
Lunch Line 02 closed with $842.50 in total sales. Wallet payments represented 72%
of sales. Cash drawer variance was -$6.25. Chicken Bowl and Juice Box were the top
items. Three products are projected to run out before Friday.
```

Why this helps traction:

- Easy to demo.
- Easy for school operators to understand.
- Gives managers useful information immediately.
- Does not require autonomous financial actions.
- Creates a daily habit inside the product.

Implementation shape:

- Use existing orders, payments, drawer sessions, inventory, refunds, and wallet data.
- Generate the summary after drawer closeout or at end of day.
- Store summaries as tenant-scoped report records.
- Allow manager/admin review.
- Never let the AI edit financial records.

Marketing message:

```text
Every cafeteria manager gets an automatic daily operating summary.
```

### 2. AI Receipt and Invoice Extraction

Let managers upload or photograph supplier receipts and invoices. AI creates a draft
receiving record for review.

Extract:

- Supplier name
- Invoice number
- Invoice date
- Product names
- Quantities
- Unit costs
- Totals
- Possible SKU/product matches
- New products that may need review

Why this helps traction:

- Strong time-saving demo.
- Directly supports existing inventory/receiving workflows.
- Reduces manual data entry.
- Helps non-technical cafeteria staff.
- Creates a clear before/after sales story.

Implementation shape:

- Upload image/PDF.
- Extract structured fields.
- Match extracted line items to existing products.
- Show confidence and mismatch warnings.
- Save only a draft until a manager applies it.
- Applying the draft uses existing inventory receiving transactions.

Marketing message:

```text
Turn supplier receipts into inventory updates in seconds.
```

### 3. AI Inventory and Reorder Assistant

Use sales and inventory movement data to suggest what needs attention.

Assistant should answer:

- What should we reorder this week?
- Which items may run out before Friday?
- Which products are slow moving?
- Which products are overstocked?
- Which products had unusual shrinkage?
- What changed compared with last week?

Why this helps traction:

- Schools care about waste and stockouts.
- Inventory problems are visible operational pain.
- It turns POS data into decisions.
- It creates value beyond checkout.

Implementation shape:

- Start with deterministic calculations.
- Use AI to explain and prioritize findings in plain language.
- Require manager approval for any receiving, transfer, or adjustment action.
- Keep reorder suggestions as recommendations only.

Marketing message:

```text
Reduce cafeteria waste and stockouts with AI-assisted inventory planning.
```

### 4. AI Risk and Anomaly Alerts

Surface unusual operational behavior for managers and administrators.

Detect:

- Repeated refunds by one cashier
- Cash drawer variance patterns
- Wallet top-ups outside normal amounts
- Manual wallet adjustments
- Sudden negative wallet spikes
- Inventory drops not tied to sales
- Repeated credential lookup failures
- Unusually high void/refund activity

Why this helps traction:

- Schools and companies care about accountability.
- It creates a clear management value proposition.
- It helps catch mistakes early.
- It differentiates the product from simple register software.

Implementation shape:

- Start with rules and thresholds.
- Use AI to summarize and explain why an alert matters.
- Store alerts as tenant-scoped audit/report records.
- Avoid accusing staff; use neutral operational language.

Marketing message:

```text
AI-powered alerts help schools catch mistakes, abuse, and cash variance early.
```

## Recommended First AI Build

Build in this order:

1. AI Daily Closeout Summary
2. AI Receipt and Invoice Extraction Drafts
3. AI Inventory and Reorder Assistant
4. AI Risk and Anomaly Alerts

This sequence gives the strongest demo value while keeping risk controlled.

## Nice-To-Have AI Features

These are useful, but should come after the must-have features.

### Natural Language Reports

Allow admins to ask tenant-scoped questions:

- Show sales by payment method this month.
- Which products sold most last week?
- Which stores had drawer variance?
- Which students have negative wallet balances?
- Compare cafeteria sales across stores.

Implementation caution:

- Do not let the model write arbitrary SQL directly.
- Use approved report tools or predefined query builders.
- Always enforce tenant and store authorization.

### Parent Wallet Insights

Help parents avoid surprise low balances.

Examples:

- Balance may run out in 3 school days.
- Typical weekly cafeteria spend is $18.
- Suggested top-up amount is $25.

Implementation caution:

- Keep language factual.
- Avoid judgment about food choices.
- Only expose the parent's own linked students.

### AI Onboarding and Import Cleanup

Help admins clean messy imports.

Use cases:

- Normalize product names.
- Detect duplicate students/customers.
- Match Student Educational app students to POS customers.
- Clean category names.
- Suggest missing SKU values.

Implementation caution:

- All import changes should be reviewed before applying.
- Never merge student/customer identities without human approval.

### Product and Menu Planning

Suggest product/menu decisions:

- Products to discontinue.
- Menu rotation ideas based on popularity.
- Products with low margins.
- Day-of-week demand trends.

Implementation caution:

- Avoid presenting recommendations as guaranteed forecasts.
- Use transparent inputs and confidence levels.

### Multi-School Benchmarking

For platform admins only, aggregate anonymized trends:

- Average cafeteria sales by school size.
- Common low-stock products.
- Popular product categories.
- Payment method adoption.

Implementation caution:

- Do not expose one school's private data to another school.
- Aggregate and anonymize.
- Make this opt-in if used for external benchmarking.

## AI Architecture Guidelines

### Keep AI Outside Financial Writes

AI should produce drafts, reports, recommendations, and alerts. Existing services
should remain responsible for actual writes.

Safe pattern:

```text
Data query
  -> deterministic aggregation
  -> AI summary/recommendation
  -> human review
  -> existing API transaction if approved
```

Unsafe pattern:

```text
AI decides
  -> AI writes wallet/order/payment/inventory directly
```

### Use Tenant-Scoped Data Access

Every AI feature must enforce:

- `organization_id`
- store assignment when relevant
- user role permissions
- parent/customer ownership for parent-facing features

AI tools must never query across tenants unless running in an explicit platform-admin
analytics context.

### Store AI Outputs As Drafts

For receipt extraction, reorder suggestions, onboarding cleanup, and alerts, store AI
outputs as draft records with metadata:

```text
organization_id
store_id
source_type
source_record_id
model_name
input_hash
output_json
confidence
status
reviewed_by_user_id
applied_at
created_at
```

This supports auditability and repeatable review.

### Prefer Deterministic Calculations First

For anything involving totals, balances, stock counts, or variance:

1. Calculate exact values in SQL/application code.
2. Pass the calculated facts to AI.
3. Ask AI to summarize, explain, or prioritize.

Do not ask AI to calculate financial totals from raw records.

## Data Privacy and Safety

AI features may touch student, parent, purchase, and financial data. Treat that data
as sensitive.

Requirements:

- Do not train external models on tenant data unless explicitly approved.
- Redact unnecessary personal data from AI prompts.
- Keep prompts and outputs tenant-scoped.
- Log AI actions for audit.
- Allow admins to disable AI features per organization.
- Do not expose AI-generated cross-tenant comparisons without aggregation and
  anonymization.

## Packaging and Marketing Position

Primary AI message:

```text
Commerce POS helps schools run cafeteria and campus commerce with AI-assisted
closeout, inventory planning, receipt capture, and risk alerts.
```

Shorter message:

```text
AI-assisted school commerce, from lunch line to ledger.
```

Feature bullets:

- Daily AI closeout summaries for cafeteria managers.
- Receipt-to-inventory drafts from supplier invoices.
- AI-assisted reorder suggestions to reduce waste and stockouts.
- Operational alerts for refunds, drawer variance, and unusual wallet activity.

The strongest sales story is operational clarity, not AI novelty.

---

## Pitch Strategy (Marketing Analysis — June 2026)

This section documents the go-to-market pitch strategy for the summer 2026 school
sales cycle (June–August), targeting private K-12 school directors and principals
in Mexico and Latin America.

### The decision-maker

The person signing the contract is a school director or principal personally
accountable to a board or ownership group. They do not experience the pain of
typing in supplier invoices — that is a staff problem. They experience the pain of
*not knowing*: not knowing if a cashier is skimming, not knowing if the drawer is
consistently short, not knowing what happened in the cafeteria yesterday without
chasing someone.

Features that protect their accountability and remove their administrative burden
close deals. Features that help back-office staff are mentioned as supporting
proof points, not headlines.

### Competitive framing against Paymon

```text
Paymon records what happened.
Commerce POS tells you what you need to know — and flags what you need to investigate.
```

Paymon has audit logs. Audit logs require someone to know what to look for and go
looking. AI alerts require nothing from the administrator except reviewing a
notification. That is the entire gap, and it is the core of the pitch.

### Ranked features to lead with

#### 1. AI Risk and Anomaly Alerts — lead with this

The decision-maker's deepest fear is money going missing and finding out months
too late. This is a personal professional failure for the director, not just a
financial loss.

**Why it wins the room:** It turns the director from someone who *discovers*
problems into someone who *prevents* them. That shift in identity is what closes
deals.

**Before/after:**
- Before: "We noticed something was off after the end-of-year audit and found six
  months of drawer variance we couldn't explain."
- After: "The system flagged a pattern on day three. We reviewed it that afternoon."

**Demo play:** Show a fabricated anomaly output — "Cashier #2 processed 4 refunds
in one shift. No other cashier has done more than 1 in a week. Here is what the
system generated." The director will feel that without needing it explained.

**Core marketing message:**
```text
Catch cash variance, unusual refunds, and manual adjustments before they become
a real problem — not after.
```

**Differentiation:** Paymon has audit logs. We have alerts. You do not have to
go looking — the system comes to you.

---

#### 2. AI Daily Closeout Summary — lead with this second, immediately after

After establishing that the system protects the school's money, show that it also
eliminates administrative burden. This is the feature that makes a director say
"I actually want to look at my cafeteria numbers" instead of dreading the
conversation.

**Why it wins the room:** Every director has tried to get a daily cafeteria
summary and given up, or receives a partial WhatsApp message from a manager.
Replacing that with an automatic structured report in plain language — every day,
without anyone compiling it — is immediately legible as valuable.

**Before/after:**
- Before: "I only really know what happened in the cafeteria if I go ask. Usually
  I ask when something seems wrong."
- After: "Every morning I have a two-paragraph summary of yesterday: what sold,
  what the drawer looked like, who has a negative balance, what is low on stock."

**Demo play:** Show a sample summary output on screen. Format matters — it should
read like a capable employee wrote a paragraph, not a dashboard or a table.
"Here is what the director at your school would have received this morning."

**Core marketing message:**
```text
Every cafeteria manager gets an automatic daily operating summary —
no spreadsheets, no chasing staff for numbers.
```

**Why these two together:** The anomaly alert catches the problem. The daily
summary provides the baseline that makes the anomaly meaningful. Together they
tell one story: *the system watches your cafeteria for you and tells you what
happened every day.*

---

#### 3. AI Inventory and Reorder Assistant — use when waste/budget is the pain

This is a swing feature. If the director opens by talking about food waste, cost
overruns, or over-ordering, swap this into the second slot.

**When to use it:** Some schools, particularly those running a full cafeteria with
perishables, worry more about spoilage than fraud. Know which director you are
talking to before the meeting.

**Core marketing message:**
```text
Reduce cafeteria waste and avoid stockouts with AI that tells you what to
reorder before you run out.
```

**Demo play:** "Based on this week's sales, you will run out of [product] by
Thursday. Here are the three items you should order this weekend." A director
responsible for a food budget immediately calculates what that is worth.

---

### What not to lead with: AI Receipt Extraction

Receipt and invoice extraction is a real feature with real time savings — but it
solves a problem for the staff member doing receiving, not the director signing
the contract. Pitching it in the first 20 minutes makes the product sound like
a back-office tool, not a strategic decision-support system.

**How to use it:** Mention it after you have closed the strategic value.
"The person who manages receiving can photograph supplier invoices directly into
the system instead of typing them in manually." Thirty seconds, not a headline.
Build it second (it is a great demo moment for staff) but pitch it third.

---

### Pitch sequence in the room

1. Open with **Risk and Anomaly Alerts** — establish this as a money-protection
   system, not just a POS.
2. Follow immediately with **Daily Closeout Summary** — show the protection comes
   with zero administrative overhead.
3. Close with **Inventory/Reorder** if food budget was a stated pain point.
   Otherwise save it for the follow-up email as a bonus for the operations manager.
4. Mention **Receipt Extraction** as a staff time-saver in the last five minutes.

---

## Initial Implementation Milestone

First AI milestone:

```text
Generate a manager-reviewed daily closeout summary after cash drawer closeout,
using existing orders, payments, refunds, drawer, inventory, and wallet data.
```

Acceptance criteria:

- Summary is scoped to one organization and store.
- Summary includes sales, payment mix, drawer variance, top products, refunds, low
  stock, and negative wallet balances.
- Summary is stored as a report record.
- Summary can be regenerated by a manager/admin.
- AI does not modify financial records.
- Tests cover tenant isolation and permission checks.

This is the best first AI feature because it is useful, safe, easy to demonstrate,
and directly aligned with school cafeteria operations.
