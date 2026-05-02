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
- Web: `http://localhost:3100`
- Postgres: `localhost:5434`

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
receipt response
```

Architecture and security baseline: [docs/architecture-security.md](docs/architecture-security.md)

