# Frontend Working Model

This document captures the current Commerce POS frontend state and the intended next
steps. The current UI is a working product prototype, not the final component or route
architecture.

## Current State

The web app lives in:

```text
web/
```

It is a Next.js app running through Docker Compose:

```bash
docker compose up -d api web
```

Local URL:

```text
http://localhost:3100
```

The current frontend started as one large page. It has now been split into route-level
pages and shared components.

Current shared files:

```text
web/app/components/AppShell.tsx
web/app/components/PageHeader.tsx
web/app/components/DataTable.tsx
web/app/components/StatusBadge.tsx
web/app/lib/api.ts
web/app/lib/demoTypes.ts
web/app/lib/format.ts
web/app/styles.css
```

Current route pages:

```text
/dashboard
/register
/orders
/inventory
/products
/customers
/payments
/reports
/staff
/settings
/student-demo
```

Current register-specific files:

```text
web/app/register/RegisterClient.tsx
web/app/register/ProductCatalog.tsx
web/app/register/StudentSelector.tsx
web/app/register/CartPanel.tsx
web/app/register/ReceiptPreview.tsx
web/app/register/registerUtils.ts
web/app/register/types.ts
```

`/register` is the first working production-style cashier route. It loads the demo
school/store/product context and shows touch-friendly product image tiles with
cafeteria category filters, but it no longer preloads fake students into the cashier
flow. Cashiers add products to the cart, search the Student Educational app by
matricula, name, or email, select a student result, and complete cash, credit/card, or
wallet checkout. The selected student panel intentionally shows only the student and a
signed wallet balance: positive balance in green, amount owed in red. The credit limit
is enforced by the API and only appears in the UI when it blocks checkout. Product
tiles now show live stock state, and completed sales decrement tracked inventory.

`/student-demo` shows the student/parent side of the pitch: wallet balance and recent
POS wallet transactions from the same Commerce POS backend.

`/products` is now a live manager/admin catalog route. It loads the demo school
catalog through the Commerce POS API, supports search/category filters, and can create
or update product name, SKU, description, image URL, price, taxable state, and
active/inactive state. The catalog feeds the register product tiles.

## Current School Demo Script

Use this flow when pitching the pilot:

1. Open `/dashboard` and frame the product as a school cafeteria/campus store POS.
2. Open `/staff` and show employee roles:
   - Cashier can sell, select students, and print receipts.
   - Cashier cannot edit inventory, settings, roles, integrations, or reports.
   - Manager/admin can manage inventory, registers, staff, and settings.
3. Open `/inventory` and show live cafeteria/store inventory:
   - Lunch items.
   - Drinks.
   - Uniforms.
   - Books/workbooks.
   - Event tickets.
   - Low-stock alerts and reorder thresholds.
   - Stock levels changing after register sales.
   - Manager receiving/adjustment form for adding stock or correcting counts.
4. Open `/settings` and show admin-only school setup:
   - Registers.
   - Taxes/exemptions.
   - Receipt templates.
   - Student app integration.
   - Employee permissions.
5. Open `/register` as cashier Jordan:
   - Add cafeteria or school products.
   - Use image tiles and category filters for fast cafeteria checkout.
   - Complete a cash or credit sale without needing a student.
   - Note that inventory is decremented by the sale.
   - Search for a Student Educational app student by matricula, name, or email.
   - Select the student and show only the signed wallet balance.
   - Complete a wallet sale and show the receipt plus updated balance.
   - If the wallet sale would exceed the student's credit limit, show the block message.
6. Search for a real Student Educational app student by matricula, name, or email.
   Selecting the result links the Student app `students.id` to a POS customer/wallet.
7. Open `/orders`:
   - Click the completed order.
   - Show receipt line items, payment method, wallet balance-after, and inventory impact.
   - Use the reprint action as the cashier proof of sale.
   - Refund a paid order and show the wallet, inventory, and open cash drawer reversal.
8. Open `/payments`:
   - Open `Lunch Line 02` with starting cash.
   - Complete a cash sale in `/register`.
   - Return to `/payments` and show expected cash increased.
   - Close the drawer and show variance.
9. Open `/student-demo`:
   - Show the educational app view.
   - Confirm the student balance and POS purchase history updated from the same backend.

## Stitch Design Work

A Stitch project was created for the POS frontend:

```text
Title: Commerce POS Frontend
Project ID: 13326238815075879327
```

Generated desktop screens:

- Dashboard
- Register
- Inventory
- Orders
- Customers
- Reports
- Staff & Payments
- Settings

Design direction:

- Operational app shell, not a marketing page.
- Persistent sidebar navigation and top utility bar.
- Dense, readable tables.
- Fast cashier-first register flow.
- Light UI with white and light gray surfaces.
- Deep teal primary action color.
- 8px radius max.
- Cards only for repeated records, metrics, product tiles, and focused panels.

## Why Everything Is Currently On One Page

The single-page version was useful for early product shaping because it let us inspect
all major modules together:

- Navigation model.
- Register workflow.
- Inventory shape.
- Order/receipt lookup.
- Customer profile expectations.
- Reporting/admin needs.
- Settings categories.

This has now been split into routes. The individual pages are still early demo screens;
the next step is deeper component extraction and real data loading per module.

## Correct Next Architecture

Each major product area should become its own route-level page. Shared UI should move
into reusable components.

Expected route structure:

```text
web/app/
  layout.tsx
  page.tsx
  dashboard/page.tsx
  register/page.tsx
  orders/page.tsx
  inventory/page.tsx
  products/page.tsx
  customers/page.tsx
  payments/page.tsx
  reports/page.tsx
  staff/page.tsx
  settings/page.tsx
  student-demo/page.tsx
```

Expected component structure:

```text
web/app/components/
  AppShell.tsx
  SidebarNav.tsx
  TopBar.tsx
  PageHeader.tsx
  ActionToolbar.tsx
  DataTable.tsx
  StatusBadge.tsx
  MetricTile.tsx
  DrawerPanel.tsx
  ModalDialog.tsx
```

POS-specific components:

```text
web/app/register/
  BarcodeInput.tsx
  ProductTile.tsx
  ProductGrid.tsx
  CartLineItem.tsx
  CartSummary.tsx
  QuantityStepper.tsx
  PaymentMethodButton.tsx
  ReceiptPreview.tsx
```

Domain modules should follow the backend product boundary:

```text
organizations
stores
products
inventory
customers
wallets
orders
payments
receipts
reports
staff
settings
```

## Route Responsibilities

### `/dashboard`

Operational overview with today sales, transaction count, average order, low-stock
alerts, returns, open shifts, recent activity, and quick actions.

### `/register`

Primary cashier workflow. Product scan/search, product quick keys, cart, customer
attachment, discounts, tax, payment method, wallet payment, sale completion, and
receipt delivery.

This should be the first route connected to the real API.

### `/orders`

Receipt search, transaction filters, order detail, reprint receipt, email receipt,
refund, and void workflows.

### `/inventory`

Stock table, low-stock filters, adjustments, receiving, reorder thresholds, supplier
metadata, and stock audit trail.

### `/products`

Product catalog, product editor, SKU/barcode fields, categories, variants, pricing,
taxability, and active/inactive status. The current working slice supports product
create/update for the demo school catalog; true category records and variants are
still future work.

### `/customers`

Customer search, quick add, profile, purchase history, wallet balance, notes, and
receipt preferences.

### `/payments`

Payment methods, terminal/device status, transaction history, refund rules, and cash
drawer sessions.

### `/reports`

Sales, product/category performance, taxes, payment breakdown, inventory movement,
cash drawer variance, and staff activity.

### `/staff`

Employees, roles, permissions, PIN/login settings, store assignments, and activity log.

### `/settings`

Store profile, tax settings, receipt templates, registers/devices, inventory rules,
discounts, integrations, notifications, security, and audit log.

## API Integration Priority

The first frontend integration is now the cashier sale flow:

```text
POST /v1/orders/paid-sale
POST /v1/orders/wallet-sale
POST /v1/orders/:id/refund
GET  /v1/inventory?organizationId=...&storeId=...
GET  /v1/orders/:id?organizationId=...
GET  /v1/cash-drawers/current?organizationId=...&storeId=...&registerName=...
POST /v1/cash-drawers/open
POST /v1/cash-drawers/:id/close
```

The register route currently supports:

- Seeding and loading a demo organization/store context.
- Searching/selecting products.
- Searching the Student Educational app by matricula, name, or email through the POS API.
- Connecting or reusing a real Student Educational app student by selected `students.id`.
- Showing one signed wallet balance for the selected student.
- Submitting cash, credit/card, and wallet sales with an `Idempotency-Key`.
- Showing stock badges on product tiles and live inventory data on `/inventory`.
- Receiving or adjusting stock from `/inventory`.
- Showing receipt response.
- Showing clickable receipt detail from `/orders`.
- Refunding paid orders from `/orders`.
- Opening and closing cash drawer sessions from `/payments`.
- Recording cash sales into the open drawer for register closeout.
- Handling insufficient funds, insufficient stock, credit-limit blocks, HTML/proxy errors, and idempotency conflicts.

The products route currently supports:

- Loading live demo school products from `GET /v1/products`.
- Creating products through `POST /v1/products`.
- Updating products through `PATCH /v1/products/:id`.
- Editing price, SKU, description, image URL, taxable, and active state.

After that, add:

1. Customer list/search endpoints.
2. Wallet lookup by customer.
3. Richer inventory history, receiving references, and supplier metadata.
4. Printable receipt formatting.
5. Reports for daily sales, product sales, payment methods, and cash drawer variance.
6. Partial refunds, formal voids, and manager approval rules.
7. Cash drawer event history and paid-out/drop support.

## Development Workflow

Use Docker Compose as the default workflow:

```bash
docker compose up -d db api web
docker compose logs -f web
docker compose logs -f api
```

The web and API services use bind mounts. Local edits should update the running
containers.

Frontend verification:

```bash
cd web
npm run build
```

Container checks:

```bash
docker compose ps
curl -sS http://localhost:4100/health
curl -sS -I http://localhost:3100
```

## Design Rules

- Build actual POS screens, not a landing page.
- Keep register and orders one click away.
- Prioritize cashier speed, manager scanning, and admin clarity.
- Use dense but readable tables.
- Use clear primary actions per screen.
- Keep touch targets at least 44px.
- Do not use decorative gradients, oversized hero text, or illustration-heavy layouts.
- Avoid nested cards.
- Use stable dimensions for toolbars, tables, cart rows, tiles, and buttons.
- Use semantic status colors with text labels.

## Near-Term Frontend Plan

1. Extract register-specific cart, product, student, payment, inventory, and receipt components.
2. Replace remaining static demo arrays with typed API clients.
3. Add loading, empty, and error states across every route.
4. Add real auth/session UI after the backend auth flow is ready.
5. Add store assignment checks to hide admin-only actions from cashier accounts.
6. Add frontend tests around the sale and inventory display flow once components are split.

## Student App Bridge

The connected Student Educational app files are:

```text
/home/vmdad/projects/Student-educational/Spelling-Game/spelling-app/api/src/services/commercePos.js
/home/vmdad/projects/Student-educational/Spelling-Game/spelling-app/api/src/routes/student.js
/home/vmdad/projects/Student-educational/Spelling-Game/spelling-app/api/src/routes/parents.js
/home/vmdad/projects/Student-educational/Spelling-Game/docker-compose.yml
/home/vmdad/projects/Student-educational/Spelling-Game/.env.example
```

Student and parent cafeteria routes now try Commerce POS first and fall back to the
legacy Student app cafeteria tables only if Commerce POS is unavailable.

The Student app receives the POS wallet balance as a signed balance. A positive value
means parent-funded balance is available; a negative value means the student owes
money. Commerce POS also returns `credit_limit` and `amount_owed`, but the cashier UI
keeps the display simple and only warns when the next sale would exceed the limit.

The register search flow is:

```text
Cashier searches "A-1042" or "Juan"
POS API -> GET Student app /service/students with SPELLING_APP_SERVICE_TOKEN
Cashier selects result
POS API -> POST /v1/integrations/student-app/students
Sale proceeds against the linked POS wallet
```
