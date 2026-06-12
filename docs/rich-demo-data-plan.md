# Rich Demo Data Plan

## Goal

Create a realistic demo environment for Commerce POS that feels like an active school
has been using the product for at least six months.

The demo should support sales conversations, product walkthroughs, screenshots,
reports, and AI closeout/anomaly demos without requiring manual setup through the UI.

This document is a plan only. It does not implement the seed script.

## Recommendation

Build a dedicated rich demo seed script:

```bash
api/scripts/seed-rich-demo.js
```

Expose it through an npm script:

```json
"seed:demo": "node scripts/seed-rich-demo.js"
```

The script should create or refresh one dedicated demo tenant with realistic school
commerce data. It should be safe to run locally and on a disposable demo database, but
it should not run automatically from normal UI routes.

Do not rely only on the existing `/v1/demo/school` endpoint for this. That endpoint is
useful for smoke testing, but it is too small for a full sales demo and does not create
six months of historical activity.

## Demo Tenant

Use one stable organization as the primary demo school:

- Name: Demo Academy
- Type: school
- External school ID: `11111111-1111-4111-8111-111111111111`

This stable identifier makes the script idempotent and lets the app consistently find
the same demo tenant.

## Data Scope

The target dataset should include:

- 1 school organization
- 2-3 stores
- 8-12 staff users
- 60-150 student customers
- 40-100 guardians/parents
- Wallet accounts for students
- Student credentials for register lookup
- 30-60 products
- Product categories
- Inventory records
- Inventory receiving and adjustment movements
- Six months of orders
- Cash, card, and wallet sales
- Wallet top-ups
- Full refunds
- Partial refunds
- Cash drawer open/close sessions
- Drawer variances
- Low-stock and out-of-stock examples
- Reportable trends and anomalies

## Suggested Stores

Create multiple school commerce locations so the demo can show that the product is more
than a cafeteria register:

- Cafeteria
- Uniform Shop
- Bookstore / Supplies

Each store should have its own product mix and inventory records.

## Suggested Staff

Create staff across the active roles:

- Super admin or platform admin for product demos
- Organization admin for school-wide configuration
- Store managers assigned to each store
- Cashiers assigned to one or more stores

Use memorable demo credentials and document them separately in a local-only note or
demo runbook. Do not commit real production credentials.

Example staff shape:

- Demo Admin
- Cafeteria Manager
- Bookstore Manager
- Uniform Shop Manager
- Morning Cashier
- Lunch Cashier
- Afternoon Cashier
- Accountant

## Suggested Products

Seed products across several categories:

- Breakfast
- Lunch
- Snacks
- Drinks
- Uniforms
- Books
- School supplies
- Events / tickets

Include a mix of:

- High-volume low-price cafeteria items
- Medium-price supplies
- Higher-price uniforms and workbook bundles
- Taxable and non-taxable products
- Products with healthy stock
- Products below reorder threshold
- Products out of stock

Example products:

- Lunch Combo
- Breakfast Plate
- Chicken Tacos
- Veggie Bowl
- Fruit Cup
- Yogurt Parfait
- Water Bottle
- Juice Box
- Uniform Polo
- Uniform Sweater
- PE Shorts
- Workbook Pack
- Math Notebook
- Pencil Set
- Field Trip Ticket

## Suggested Students And Parents

Create enough students and guardians to make search, reports, and parent views feel real.

Recommended first version:

- 100 students
- 75 guardians
- 1-3 students per family
- Family codes linking students and guardians
- Mixed wallet balances:
  - Healthy positive balances
  - Low balances
  - Zero balances
  - A few negative balances within credit limit

Each student should have:

- Customer record
- Wallet account
- Guardian link
- Optional student credential
- Home store where useful

Each guardian should have:

- Name
- Email
- Phone
- Family code
- Notification preferences
- Linked students

## Six-Month Activity

Generate historical data across the last six months.

Recommended volume:

- 1,500-3,000 total orders
- 8-30 cafeteria orders per school day
- Lower volume for uniform/bookstore purchases
- Higher sales on selected event or back-to-school days
- 80-150 refunds or partial refunds
- Daily cash drawer sessions on school days
- Weekly or biweekly wallet top-ups
- Monthly receiving events for inventory

Avoid perfectly uniform data. The demo should show normal operational variance:

- Weekday sales patterns
- Lower activity on weekends
- Occasional high-volume days
- Some students purchasing frequently
- Some students rarely purchasing
- A few refund-heavy days
- A few drawer variance days
- Seasonal spikes for uniforms, books, and event tickets

## Financial Integrity Rules

The seed must preserve the same invariants as production behavior.

Required rules:

- Use integer cents for all money.
- Never use floating point money.
- Order totals must equal item totals plus tax minus discounts.
- Payment amount must match the order total for successful sales.
- Wallet purchases must update wallet balance and insert wallet ledger rows.
- Wallet ledger rows must not be updated or deleted after insertion.
- Refunds must update order status, payment/refund state, wallet ledger, and inventory.
- Partial refunds must update refunded item quantities.
- Inventory sales must decrement stock.
- Refunds should return stock when applicable.
- Cash sales must update the active drawer session.
- Drawer close variance must match expected vs counted cash.
- Audit events should be created for meaningful financial operations.

The script may write directly to the database so it can backdate records, but it should
mirror the business rules in the order and wallet services.

## Timestamp Strategy

Backdate records intentionally.

The script should set historical timestamps for:

- Orders
- Order items
- Payments
- Wallet transactions
- Inventory movements
- Cash drawer sessions
- Cash drawer events
- Audit events
- Refunds

Do not create six months of demo history through normal API endpoints if those endpoints
only use `NOW()`. The reporting and AI views need real historical dates.

## Reset Strategy

The script should support two modes:

1. Create/update demo records without deleting history.
2. Reset and rebuild only the dedicated demo tenant.

Reset mode should be explicit and guarded:

```bash
ENABLE_RICH_DEMO_SEED=true DEMO_SEED_RESET=true npm run seed:demo
```

The script must never delete non-demo organizations or shared stage/prod records.

## Safety Guards

Require an explicit environment variable:

```bash
ENABLE_RICH_DEMO_SEED=true
```

Recommended safeguards:

- Refuse to run when `NODE_ENV=production` unless a separate explicit override exists.
- Refuse reset mode unless the organization matches the known demo external school ID.
- Print the target database host/name before making changes.
- Print counts before and after seeding.
- Keep `DISABLE_DEMO_SEED=true` in stage/prod unless a controlled demo database is used.

## Demo Scenarios To Support

The dataset should make these walkthroughs work well:

### Register Demo

- Search/select a student.
- Show signed wallet balance.
- Sell cafeteria products by wallet.
- Block a wallet sale when balance/credit is insufficient.
- Complete cash and card sales.
- Print or preview a receipt.

### Parent Demo

- Parent sees linked students.
- Parent sees wallet balances.
- Parent sees purchase history.
- Parent sees recent cafeteria transactions.

### Reports Demo

- Show six-month sales trends.
- Compare payment methods.
- Show top products.
- Show refunds.
- Show drawer variance.
- Show wallet spend and low-balance students.

### Inventory Demo

- Show current stock.
- Show low-stock products.
- Show receiving history.
- Show sale and refund movements.

### Orders Demo

- Show receipt detail.
- Show full refund workflow.
- Show partial refund workflow.
- Show historical orders across stores.

### Payments Demo

- Show open/closed drawer sessions.
- Show cash sales.
- Show close variance.

### AI Demo

- Generate closeout summary from real-looking facts.
- Generate anomaly alerts for:
  - Refund spikes
  - Drawer variance
  - Inventory shrinkage
  - Wallet top-up outliers
  - Negative wallet balances

AI must only write to `commerce_ai_records`. It must not write to financial tables.

## Suggested Build Sequence

1. Inventory the current schema and existing demo endpoint.
2. Add the seed script skeleton with safety guards.
3. Seed organization, stores, products, inventory, staff, students, wallets, guardians.
4. Add deterministic random data generation.
5. Generate six months of orders and payments.
6. Add wallet top-ups and wallet sale ledger entries.
7. Add inventory receiving, sale, adjustment, and refund movements.
8. Add full and partial refunds.
9. Add cash drawer sessions and events.
10. Add audit events.
11. Verify reports and UI pages against the seeded data.
12. Document demo login credentials and demo scenarios.

## Verification Checklist

After seeding, verify:

- Dashboard loads with real totals.
- Register loads products and students.
- Products page shows a useful catalog.
- Inventory page shows stock and low-stock states.
- Orders page has historical paid, refunded, and partially refunded orders.
- Payments page has drawer sessions and variances.
- Customers page has realistic student volume.
- Guardians/parent pages show linked families.
- Staff page shows staff roles and store assignments.
- Reports page shows six months of trends.
- AI closeout/anomaly features have enough data to produce useful output.

Recommended commands:

```bash
cd api
DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos npm run migrate
ENABLE_RICH_DEMO_SEED=true DATABASE_URL=postgres://commerce_pos:commerce_pos_dev_password@localhost:5434/commerce_pos npm run seed:demo
npm test
```

```bash
cd web
npm run build
```

```bash
docker compose ps
curl -sS http://localhost:4100/health
curl -sS -I http://localhost:3100
```

## Open Decisions

Before implementation, decide:

- Exact student count for the first demo version.
- Whether the demo should use one store or three stores by default.
- Whether reset mode should hard-delete demo tenant data or rebuild into a fresh demo org.
- Whether parent portal credentials should be seeded and documented.
- Whether demo data should include allergen/spending-control examples now or later.
- Whether demo images should use existing local product images or generated assets.

## Recommended First Version

The first useful version should target:

- 1 organization
- 3 stores
- 10 staff
- 100 students
- 75 guardians
- 45 products
- 6 months of historical records
- 2,000 orders
- 100 refunds or partial refunds
- Daily drawer sessions for school days
- Weekly inventory receiving
- Wallet balances with healthy, low, zero, and negative examples

This is enough to make the app feel alive without making the seed script too complex.
