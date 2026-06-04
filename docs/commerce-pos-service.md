# Commerce / POS Service

## Status

Now scaffolded as the separate Commerce POS product in this repository. Do not continue
expanding the Student Educational app's existing `cafeteria_*` module as the long-term
POS architecture.

The Student Educational app still has basic cafeteria tables and routes for legacy
pilot support. New wallet balances and cafeteria purchase history should come from
Commerce POS through the integration API.

## Why This Should Be Separate

The cafeteria idea has grown beyond a school lunch feature. The target product now includes:

- Cafeteria POS
- Student wallets
- Uniform sales
- Books and workbooks
- School supplies
- Marketplace listings
- Potential sales to restaurants or non-school businesses

That is a different product surface from the spelling/phonics learning app. Keeping it separate avoids mixing education workflows with retail/POS workflows and makes it possible to sell the POS independently.

## Repository Strategy

The Commerce/POS product now lives in the separate `commerce_pos` repository. The
Student Educational app integrates through APIs instead of owning the POS domain
directly.

## Product Boundary

### Spelling App SaaS Owns

```text
districts
schools
admins
teachers
students
parents
classes
learning content
practice progress
school events
```

### Commerce/POS Owns

```text
organizations
stores
products
categories
inventory
orders
order items
payments
refunds
wallet accounts
wallet transactions
marketplace listings
receipts
cashier sessions
```

## Deployment Approach

Start as a separate repo, but keep the integration simple.

Phase 1:

```text
Separate repo
Separate Docker service
Separate API
Can share the same Postgres instance during development
```

Phase 2:

```text
Separate database/schema
Service-to-service auth
Webhook/event integration
```

Phase 3:

```text
Standalone commercial product
Can be sold to schools, restaurants, small shops, and other businesses
```

## Core Concept

Everything starts with an organization and one or more stores.

```text
Organization
└── Store
    ├── Products
    ├── Inventory
    ├── Orders
    ├── Payments
    └── Wallets
```

Examples:

```text
School organization
├── Cafeteria store
├── Uniform store
└── Bookstore

Restaurant organization
└── Restaurant POS store

Retail business organization
└── Shop store
```

## Store Types

Use a generic store model instead of cafeteria-specific tables.

```text
cafeteria
uniform_shop
bookstore
school_supplies
restaurant
retail
event_sales
other
```

## Suggested Database Model

Use generic commerce names, not `cafeteria_*`.

### `commerce_organizations`

```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
type TEXT NOT NULL
external_school_id UUID NULL
active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT NOW()
```

Organization type examples:

```text
school
restaurant
retail_business
nonprofit
other
```

`external_school_id` can point back to the Spelling App `schools.id` when the customer is a school.

### `commerce_stores`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
name TEXT NOT NULL
type TEXT NOT NULL
external_school_id UUID NULL
active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `commerce_products`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
store_id UUID NULL
name TEXT NOT NULL
description TEXT NULL
sku TEXT NULL
category_id UUID NULL
price NUMERIC(10,2) NOT NULL
taxable BOOLEAN DEFAULT FALSE
active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `commerce_product_categories`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
name TEXT NOT NULL
parent_id UUID NULL
active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `commerce_inventory`

```sql
id UUID PRIMARY KEY
store_id UUID NOT NULL
product_id UUID NOT NULL
quantity_on_hand INT NULL
low_stock_threshold INT NULL
updated_at TIMESTAMPTZ DEFAULT NOW()
```

`quantity_on_hand` can be nullable for non-inventory products like fees, services, or made-to-order food.

### `commerce_customers`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
external_student_id UUID NULL
external_parent_id UUID NULL
name TEXT NULL
email TEXT NULL
phone TEXT NULL
active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT NOW()
```

For school use cases, customers can map back to students and parents from the Spelling App.

For restaurant or retail use cases, customers can be standalone.

### `commerce_wallet_accounts`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
customer_id UUID NOT NULL
balance NUMERIC(10,2) NOT NULL DEFAULT 0
currency TEXT NOT NULL DEFAULT 'USD'
active BOOLEAN DEFAULT TRUE
updated_at TIMESTAMPTZ DEFAULT NOW()
```

### `commerce_wallet_transactions`

```sql
id UUID PRIMARY KEY
wallet_account_id UUID NOT NULL
order_id UUID NULL
type TEXT NOT NULL
amount NUMERIC(10,2) NOT NULL
balance_after NUMERIC(10,2) NOT NULL
source TEXT NULL
note TEXT NULL
created_by_user_id UUID NULL
created_at TIMESTAMPTZ DEFAULT NOW()
```

Transaction types:

```text
purchase
topup
refund
adjustment
transfer
```

### `commerce_orders`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
store_id UUID NOT NULL
customer_id UUID NULL
status TEXT NOT NULL
subtotal NUMERIC(10,2) NOT NULL
tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0
discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0
total_amount NUMERIC(10,2) NOT NULL
payment_status TEXT NOT NULL
created_by_user_id UUID NULL
created_at TIMESTAMPTZ DEFAULT NOW()
```

Order statuses:

```text
draft
paid
voided
refunded
partially_refunded
```

Payment statuses:

```text
unpaid
paid
partially_paid
refunded
failed
```

### `commerce_order_items`

```sql
id UUID PRIMARY KEY
order_id UUID NOT NULL
product_id UUID NOT NULL
name_snapshot TEXT NOT NULL
unit_price NUMERIC(10,2) NOT NULL
quantity INT NOT NULL
line_total NUMERIC(10,2) NOT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
```

Use snapshots so receipts stay accurate even if the product name or price changes later.

### `commerce_payments`

```sql
id UUID PRIMARY KEY
order_id UUID NOT NULL
method TEXT NOT NULL
amount NUMERIC(10,2) NOT NULL
status TEXT NOT NULL
provider TEXT NULL
provider_payment_id TEXT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
```

Payment methods:

```text
cash
card
wallet
stripe
admin_credit
other
```

### `commerce_marketplace_listings`

```sql
id UUID PRIMARY KEY
organization_id UUID NOT NULL
store_id UUID NOT NULL
product_id UUID NOT NULL
title TEXT NOT NULL
description TEXT NULL
price NUMERIC(10,2) NOT NULL
visibility TEXT NOT NULL
active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT NOW()
```

Visibility options:

```text
school_only
district_only
organization_only
public
private
```

## Marketplace Examples

```text
Uniform shirt
PE uniform
Workbook
Library replacement fee
Field trip payment
Lunch combo
Snack
Restaurant meal
Event ticket
School supplies bundle
```

## API Design

Keep it API-first from day one.

Example route groups:

```text
/organizations
/stores
/products
/categories
/inventory
/customers
/wallets
/orders
/payments
/marketplace
/reports
```

Current school integration routes:

```text
POST /v1/integrations/student-app/students
GET  /v1/integrations/student-app/students/:externalStudentId/cafeteria
```

## Integration With Spelling App

The Spelling App should not directly own the POS data long term.

Integration should happen through:

```text
school_id mapping
student_id mapping
parent_id mapping
service-to-service API token
webhooks for balance/order updates
```

Parent visibility in the Spelling App can be powered by Commerce/POS APIs:

```text
GET /v1/integrations/student-app/students/:externalStudentId/cafeteria
```

The current Student app implementation calls Commerce POS from:

```text
spelling-app/api/src/services/commercePos.js
spelling-app/api/src/routes/student.js
spelling-app/api/src/routes/parents.js
```

It falls back to legacy `cafeteria_accounts` and `cafeteria_transactions` only when
Commerce POS is unavailable.

## Migration From Existing Cafeteria Module

Current pilot tables:

```text
cafeteria_accounts
cafeteria_items
cafeteria_transactions
```

Do not delete them immediately.

Migration path:

1. Build Commerce/POS service with generic tables.
2. Create a school organization and cafeteria store.
3. Copy `cafeteria_items` into `commerce_products`.
4. Copy `cafeteria_accounts` into `commerce_wallet_accounts`.
5. Copy `cafeteria_transactions` into `commerce_wallet_transactions`.
6. Point new cafeteria/POS UI to Commerce/POS APIs.
7. Keep old cafeteria endpoints read-only for a transition period.
8. Remove or archive old cafeteria module after the new service is stable.

## What Not To Do

- Do not keep expanding `cafeteria_*` as the long-term POS model.
- Do not make cafeteria the root concept. Use stores/products/orders.
- Do not couple the POS database directly to spelling or phonics concepts.
- Do not build restaurant support as a special case. It should naturally fit through `organization` and `store`.
- Do not start with microservice complexity unless there is a deployment need. A separate repo plus clean API boundary is enough at first.

## Recommended Next Step

The first vertical slice and Student app bridge are in place. The next work is to
harden the integration for production:

```text
service-token authentication
real school/student mapping configuration
inventory movements
cash drawer sessions
refunds and voids
production deployment and backup docs
```
