# Deployment Runbook

Commerce POS runs on DigitalOcean App Platform with a managed Postgres database.
Every push to `main` triggers an automatic deploy via GitHub Actions.

> **Domain placeholder** — this doc uses `<YOUR_DOMAIN>` wherever the production
> domain appears. When you choose a real domain, replace every instance and update
> two files: `.do/app.yaml` (`CORS_ORIGINS`, `APP_URL`) and this doc.
> Current working domain: `jerrycastro.dev`

---

## Architecture

```
GitHub (main branch)
  └── GitHub Actions CI     →  syntax check + web build
  └── GitHub Actions Deploy →  doctl apps update + create-deployment

DigitalOcean App Platform
  ├── PRE_DEPLOY job: node src/db/migrate.js  (runs before new version starts)
  ├── Service: api   →  pos-api.<YOUR_DOMAIN>
  ├── Service: web   →  pos.<YOUR_DOMAIN>
  └── Database: Postgres 16 managed (daily backups, automatic failover)

Cloudflare
  └── DNS for <YOUR_DOMAIN>  (orange cloud proxy on pos and pos-api subdomains)
  └── SSL termination + DDoS protection
```

---

## Phase 1 — Accounts and secrets

### 1.1 Accounts required

| Service | Purpose | Cost |
|---|---|---|
| [digitalocean.com](https://digitalocean.com) | App hosting + managed Postgres | ~$25/mo |
| [cloudinary.com](https://cloudinary.com) | Product image uploads | Free tier |
| [resend.com](https://resend.com) | Transactional email | Free tier |
| [console.anthropic.com](https://console.anthropic.com) | AI closeout summaries + anomaly alerts | Pay-per-use (~$0/mo at school scale) |

### 1.2 Generate random secrets

Run these locally and save the output in a password manager:

```bash
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → COMMERCE_API_TOKEN
```

---

## Phase 2 — DO personal access token + GitHub secret

1. DO Dashboard → **API → Personal Access Tokens → Generate New Token**
   - Name: `github-actions-commerce-pos`
   - Scope: Write
   - Copy the token immediately (shown only once)

2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `DIGITALOCEAN_ACCESS_TOKEN`
   - Value: paste the token

`DIGITALOCEAN_APP_ID` is added in Phase 5 after the app is created.

---

## Phase 3 — First deploy

The CI/CD pipeline deploys from `main`. Merge your working branch and push:

```bash
git checkout main
git merge feature/your-branch
git push origin main
```

GitHub Actions runs CI (syntax check + web build) then creates the DO app automatically.
First build takes 5–10 minutes. Watch progress at:

```
GitHub repo → Actions → Deploy workflow
```

or via CLI once doctl is installed:

```bash
doctl apps list
doctl apps logs <APP_ID> --type=run --follow
```

---

## Phase 4 — Set secret environment variables in DO

After the first build starts, go to:
**DO Dashboard → Apps → commerce-pos → Settings → Environment Variables**

Add each of these as an **encrypted** variable:

| Variable | Where to get it |
|---|---|
| `SESSION_SECRET` | Generated in Phase 1 |
| `COMMERCE_API_TOKEN` | Generated in Phase 1 |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `RESEND_API_KEY` | resend.com → API Keys |
| `EMAIL_FROM` | `Commerce POS <noreply@mail.<YOUR_DOMAIN>>` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard → Settings → API Keys |
| `CLOUDINARY_API_KEY` | Cloudinary dashboard → Settings → API Keys |
| `CLOUDINARY_API_SECRET` | Cloudinary dashboard → Settings → API Keys |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Same value as `CLOUDINARY_CLOUD_NAME` |
| `SENTRY_DSN` | sentry.io project settings (optional) |

After setting all vars, trigger a new deploy so they take effect:

```bash
doctl apps create-deployment <APP_ID>
```

---

## Phase 5 — Capture App ID and finish GitHub setup

DO Dashboard → Apps → commerce-pos → Settings → copy the **App ID** at the top.

GitHub repo → Secrets → New repository secret:
- Name: `DIGITALOCEAN_APP_ID`
- Value: paste the App ID

After this, every push to `main` runs a full CI + deploy automatically with no manual steps.

---

## Phase 6 — Cloudflare DNS + DO custom domains

Once the app is live on its default `.ondigitalocean.app` URL, wire up your real domain.

### 6.1 Add DNS records in Cloudflare

In Cloudflare dashboard → `<YOUR_DOMAIN>` zone → DNS:

| Type | Name | Target | Proxy |
|---|---|---|---|
| `CNAME` | `pos` | `<web-service>.ondigitalocean.app` | Proxied (orange cloud) |
| `CNAME` | `pos-api` | `<api-service>.ondigitalocean.app` | Proxied (orange cloud) |

Get the `.ondigitalocean.app` hostnames from:
DO Dashboard → Apps → commerce-pos → Settings → Domains

### 6.2 Add custom domains in DO

DO Dashboard → Apps → commerce-pos → Settings → Domains → Add Domain:
- `pos.<YOUR_DOMAIN>` → web service
- `pos-api.<YOUR_DOMAIN>` → api service

DO verifies ownership via the Cloudflare CNAME and provisions SSL automatically.

### 6.3 Cloudflare SSL hardening

In Cloudflare dashboard → `<YOUR_DOMAIN>` → SSL/TLS:
- Mode: **Full (strict)** — encrypts both browser→Cloudflare and Cloudflare→DO legs
- Minimum TLS version: **TLS 1.2**

---

## Phase 7 — Verify

```bash
curl https://pos-api.<YOUR_DOMAIN>/health
# Expected: {"status":"ok"}

curl https://pos-api.<YOUR_DOMAIN>/ready
# Expected: {"status":"ready"}
```

Then open `https://pos.<YOUR_DOMAIN>` in a browser and do a full cashier login test.

---

## Email setup (Resend)

Transactional email (receipts, wallet confirmations, parent notifications) is sent via
[Resend](https://resend.com) from the subdomain `mail.<YOUR_DOMAIN>`.

### Step 1 — Add domain in Resend

1. resend.com → **Domains → Add Domain**
2. Enter `mail.<YOUR_DOMAIN>` and click Add
3. Resend shows 3 DNS records — copy the exact values from the dashboard

### Step 2 — Add DNS records in Cloudflare

In Cloudflare → `<YOUR_DOMAIN>` → DNS, add the 3 records Resend gave you:

| Type | Name | Notes |
|---|---|---|
| `TXT` | `mail` | SPF record |
| `CNAME` | `resend._domainkey.mail` | DKIM record |
| `MX` | `mail` | Bounce handling |

Set all 3 to **gray cloud (DNS only)** — do not proxy email records through Cloudflare.

DNS propagation takes 5–30 minutes. Back in Resend, click **Verify** — all 3 should go green.

### Step 3 — Get API key

Resend → **API Keys → Create API Key**
Name it `commerce-pos-production`. Copy the `re_...` value (shown only once).
Add it to DO as `RESEND_API_KEY` (Phase 4).

---

## Ongoing deploys

Every push to `main` auto-deploys. To deploy manually:

```bash
doctl apps create-deployment <APP_ID>
```

Watch logs:

```bash
doctl apps logs <APP_ID> --type=run --follow
```

---

## Running migrations manually

Migrations run automatically as a PRE_DEPLOY job before every deploy.
To run manually against production:

```bash
# Get DATABASE_URL from DO Dashboard → Apps → commerce-pos → Settings → db component
DATABASE_URL="postgres://..." node api/src/db/migrate.js
```

---

## Rollback

```bash
# List recent deployments
doctl apps list-deployments <APP_ID>

# Force rebuild of current spec
doctl apps create-deployment <APP_ID> --force-rebuild
```

Or revert the commit on `main` and push — CI/CD deploys the reverted version.

---

## Costs (early stage, < 10 schools)

| Component | Size | Monthly |
|---|---|---|
| API service | 1 vCPU / 512 MB | ~$5 |
| Web service | 1 vCPU / 512 MB | ~$5 |
| Postgres managed | dev database | ~$15 |
| **Total** | | **~$25/month** |

**Scale triggers:**
- 5+ schools → upgrade API + web to `apps-s-1vcpu-1gb` ($12/ea)
- 5+ schools → upgrade Postgres to `db-s-1vcpu-1gb` ($15/mo) for connection pooling
- 2+ API instances → sessions are safe to scale (stored in Postgres, not in-memory)

---

## Monitoring

- **Uptime**: DO App Platform → Alerts (configure service restart alerts)
- **Errors**: Sentry — set `SENTRY_DSN` env var
- **Logs**: `doctl apps logs <APP_ID> --type=run --follow`
- **DB**: DO Managed Postgres dashboard → connections, query performance, storage

---

## Backups

DO Managed Postgres dev tier includes **daily backups retained for 7 days**.
To restore: DO Dashboard → Databases → commerce-pos-db → Backups → Restore.

Upgrade to a paid Postgres tier for 30-day backup retention.

---

## Changing the domain

When you move from the working domain to a real product domain, update these:

| File | What to change |
|---|---|
| `.do/app.yaml` | `CORS_ORIGINS` value, `APP_URL` value |
| `docs/deployment.md` | Replace all `<YOUR_DOMAIN>` / current domain instances |
| Cloudflare | Remove old CNAME records, add new ones |
| DO Dashboard | Remove old custom domains, add new ones |
| Resend | Add new sending domain (`mail.<new-domain>`), update `EMAIL_FROM` in DO |

The app code itself has no hardcoded domain — it all comes from env vars.

---

## Environment differences

| Setting | Local | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `DISABLE_DEMO_SEED` | `false` | `true` |
| `DATABASE_URL` | local Docker Postgres | DO Managed Postgres |
| `API_URL` | `http://api:4100` | DO internal private URL |
| `CORS_ORIGINS` | `http://localhost:3100` | `https://pos.<YOUR_DOMAIN>` |
| Demo seed endpoint | enabled | disabled |
| Dev actor fallback | enabled | disabled |
