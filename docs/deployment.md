# Deployment Runbook

Commerce POS runs on DigitalOcean App Platform with a managed Postgres database.
Every push to `main` triggers an automatic deploy via GitHub Actions.

---

## Architecture

```
GitHub (main branch)
  └── GitHub Actions CI  →  syntax check + web build
  └── GitHub Actions Deploy  →  doctl apps update + create-deployment

DigitalOcean App Platform
  ├── PRE_DEPLOY job: node src/db/migrate.js  (runs migrations before new version starts)
  ├── Service: api        (pos-api.fransolution.net → api.fransolution.net)
  ├── Service: web        (pos.fransolution.net)
  └── Database: Postgres 16 managed (daily backups, automatic failover)

Cloudflare
  └── DNS for fransolution.net
  └── SSL termination (proxied)
```

---

## One-time setup

### 1. Install doctl

```bash
brew install doctl                     # macOS
# or: https://docs.digitalocean.com/reference/doctl/how-to/install/

doctl auth init                        # paste your DO personal access token
```

### 2. Create the app

```bash
doctl apps create --spec .do/app.yaml
```

Copy the App ID from the output. You'll need it in step 4.

### 3. Set secret environment variables

In the DO dashboard → Apps → commerce-pos → Settings → Environment Variables,
set these as **encrypted** values:

| Variable | How to generate |
|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `COMMERCE_API_TOKEN` | `openssl rand -hex 32` |
| `SENTRY_DSN` | From sentry.io project settings |
| `STRIPE_SECRET_KEY` | From dashboard.stripe.com (use test key until ready) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhook settings |
| `RESEND_API_KEY` | From resend.com |

### 4. Add GitHub Actions secrets

In GitHub → repo → Settings → Secrets → Actions, add:

| Secret | Value |
|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | Your DO personal access token |
| `DIGITALOCEAN_APP_ID` | The App ID from step 2 |

### 5. Point your domain

In Cloudflare DNS for `fransolution.net`:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `pos` | `<web-service>.ondigitalocean.app` | Proxied (orange cloud) |
| CNAME | `api` | `<api-service>.ondigitalocean.app` | Proxied (orange cloud) |

Get the `.ondigitalocean.app` hostnames from:
DO Dashboard → Apps → commerce-pos → Settings → Domains

Then in DO dashboard, add the custom domains:
- `pos.fransolution.net` → web service
- `api.fransolution.net` → api service

DO will verify the domain via Cloudflare and provision SSL automatically.

### 6. Verify it's working

```bash
curl https://api.fransolution.net/health
# Expected: {"status":"ok"}

curl https://api.fransolution.net/ready
# Expected: {"status":"ready"}
```

---

## Deploying

Every push to `main` auto-deploys. To deploy manually:

```bash
APP_ID=your-app-id
doctl apps create-deployment $APP_ID
```

Watch logs:

```bash
doctl apps logs $APP_ID --type=run --follow
```

---

## Running migrations manually

Migrations run automatically as a PRE_DEPLOY job before every deploy.
To run manually against production:

```bash
# Get the DATABASE_URL from DO dashboard → Apps → commerce-pos → Settings → Components → db
DATABASE_URL="postgres://..." node api/src/db/migrate.js
```

---

## Costs (early stage, < 10 schools)

| Component | Size | Monthly |
|---|---|---|
| API service | 1 vCPU / 512MB | ~$5 |
| Web service | 1 vCPU / 512MB | ~$5 |
| Postgres managed | dev database | ~$15 |
| **Total** | | **~$25/month** |

Upgrade API + web to `apps-s-1vcpu-1gb` ($12/ea) when you hit the first 5 paying schools.
Upgrade Postgres to `db-s-1vcpu-1gb` ($15/month) when you need connection pooling or >5GB data.

---

## Monitoring

- **Uptime**: DO App Platform sends alerts on service restarts (configure in DO dashboard → Alerts)
- **Errors**: Sentry at sentry.io — set `SENTRY_DSN` env var in DO dashboard
- **Logs**: `doctl apps logs $APP_ID --type=run --follow`
- **DB**: DO Managed Postgres dashboard shows connections, query performance, storage

---

## Backups

DO Managed Postgres (`db-s-dev-database` tier) includes **daily backups retained for 7 days**.
To restore: DO Dashboard → Databases → commerce-pos-db → Backups → Restore.

When you upgrade to a paid Postgres tier, backups extend to 30 days.

---

## Rollback

To redeploy a previous version:

```bash
# List recent deployments
doctl apps list-deployments $APP_ID

# Redeploy a specific deployment
doctl apps create-deployment $APP_ID --force-rebuild
```

Or just revert the commit on `main` and push — the CI/CD pipeline will deploy the reverted version.

---

## Environment differences

| Setting | Local | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `DISABLE_DEMO_SEED` | `false` | `true` |
| `DATABASE_URL` | local Docker Postgres | DO Managed Postgres |
| `API_URL` | `http://api:4100` | DO internal private URL |
| `CORS_ORIGINS` | `http://localhost:3100` | `https://pos.fransolution.net` |
| Demo seed endpoint | enabled | disabled |
| Dev actor fallback | enabled | disabled |
