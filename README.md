# Commerce POS

Commerce/POS service for school cafeterias, student wallets, uniforms, books, supplies, marketplace listings, and future restaurant/retail use cases.

This repo starts as a modular monolith with:

- `api/` - Node.js/Express API and SQL migrations
- `web/` - Next.js operator/admin UI
- `docs/` - architecture, security, and product planning
- `docker-compose.yml` - local development stack

## Local Development

```bash
cp .env.example .env
docker compose up --build
```

Services:

- API: `http://localhost:4100`
- Web: `http://localhost:3100` includes the route-level POS frontend prototype.
- Postgres: `localhost:5434`

Local API calls use a development actor fallback. Production requires `Authorization: Bearer $COMMERCE_API_TOKEN`.

## Current Build Target

First vertical slice:

```text
organization
store
product
customer
wallet account
order
wallet payment
cash/card payment
wallet credit limit
inventory decrement
inventory receiving/adjustment UI
supplier invoice receiving approval
CSV inventory import preview
AI receipt draft review
inventory transfers between locations
product image tiles
receipt response
receipt detail/reprint view
cash drawer open/close workflow
full-order refunds
multi-location super admin overview
student app cafeteria bridge
```

Useful demo routes:

- `http://localhost:3100/dashboard`
- `http://localhost:3100/locations`
- `http://localhost:3100/register`
- `http://localhost:3100/inventory/receiving`
- `http://localhost:3100/student-demo`

Useful demo endpoints:

- `POST /v1/demo/school`
- `GET /v1/inventory?organizationId=...&storeId=...`
- `POST /v1/inventory/:productId/adjustments`
- `POST /v1/inventory/suppliers`
- `POST /v1/inventory/invoices`
- `POST /v1/inventory/invoices/:invoiceId/approve`
- `POST /v1/inventory/imports`
- `POST /v1/inventory/imports/:batchId/apply`
- `POST /v1/inventory/receipt-drafts`
- `POST /v1/inventory/receipt-drafts/:draftId/approve`
- `POST /v1/inventory/transfers`
- `POST /v1/cash-drawers/open`
- `POST /v1/cash-drawers/:id/close`
- `POST /v1/orders/paid-sale`
- `POST /v1/orders/wallet-sale`
- `POST /v1/orders/:id/refund`
- `GET /v1/integrations/student-app/students/search?q=A-1042`
- `POST /v1/integrations/student-app/students`
- `GET /v1/integrations/student-app/students/:externalStudentId/cafeteria`

Architecture docs:

- [Agent instructions](AGENTS.md)
- [Claude/developer handoff](CLAUDE.md)
- [Architecture and security baseline](docs/architecture-security.md)
- [Agent architecture review findings](docs/agent-architecture-review.md)
- [Current API working model](docs/api-working-model.md)
- [Frontend working model](docs/frontend-working-model.md)
