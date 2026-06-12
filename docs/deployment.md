# Deployment Runbook

Commerce POS runs on a DigitalOcean Droplet with a managed Postgres database.
All public traffic enters through a Cloudflare Tunnel — no inbound ports on the server.
Every push to `Main` triggers an automatic deploy via GitHub Actions.

**Production URL:** `https://pos.jerrycastro.dev`

---

## Architecture

```
GitHub (Main branch)
  └── GitHub Actions CI      →  syntax check + web build
  └── GitHub Actions Deploy  →  SSH into Droplet, migrate, docker compose up --build

Cloudflare Tunnel (cloudflared)
  └── pos.jerrycastro.dev → Droplet:3100 (web container, internal only)

DigitalOcean Droplet (commerce-pos-production, nyc1, s-1vcpu-2gb)
  ├── web container  (Next.js, port 3100)  — serves frontend + proxies /api/* to api
  └── api container  (Express, port 4100)  — internal only, not exposed publicly

DigitalOcean Managed Postgres (commerce-pos-db, nyc1, db-s-1vcpu-1gb)
  └── database: commerce_pos
  └── VPC private hostname (not public internet)
```

---

## Infrastructure (Terraform)

Droplet and firewall are managed via Terraform in `terraform/`.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# fill in do_token, ssh_key_fingerprint, do_project_id
terraform init
terraform apply
```

Firewall allows **SSH only** (port 22). All app traffic enters via Cloudflare Tunnel.

---

## Required GitHub Secrets

Go to repo → Settings → Secrets and variables → Actions:

| Secret | Description |
|---|---|
| `DROPLET_HOST` | Droplet public IP (from `terraform output droplet_ip`) |
| `DROPLET_SSH_KEY` | SSH private key content (`cat ~/.ssh/id_rsa`) |
| `DATABASE_URL` | DO Managed Postgres VPC URL (doadmin, `commerce_pos` database) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `COMMERCE_API_TOKEN` | `openssl rand -hex 32` |
| `CLOUDFLARE_TUNNEL_TOKEN` | From Zero Trust → Networks → Tunnels → your tunnel |
| `RESEND_API_KEY` | From resend.com |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `CLOUDINARY_CLOUD_NAME` | From cloudinary.com |
| `CLOUDINARY_API_KEY` | From cloudinary.com |
| `CLOUDINARY_API_SECRET` | From cloudinary.com |
| `SENTRY_DSN` | From sentry.io (optional) |

---

## First-time server provisioning

After `terraform apply` and all GitHub Secrets are set:

1. Go to GitHub → Actions → **Provision Droplet** → Run workflow

This will:
- Wait for user-data (Docker + cloudflared install) to finish
- Clone the repo to `/opt/commerce-pos`
- Write `.env.prod` from GitHub Secrets
- Build Docker containers
- Run database migrations
- Start containers
- Install Cloudflare Tunnel as a systemd service

Then in Cloudflare Zero Trust → Networks → Tunnels → your tunnel → Configure:
- Public hostname: `pos.jerrycastro.dev`
- Service: `http://localhost:3100`

---

## Ongoing deploys

Every push to `Main` auto-deploys:
1. CI runs (syntax check + web build)
2. SSH into Droplet
3. `git pull` latest code
4. Refresh `.env.prod` from current GitHub Secrets
5. Run migrations
6. `docker compose up -d --build`
7. Prune old images

To rotate a secret: update the GitHub Secret → push any commit → deploy picks it up automatically.

---

## Manual operations

**SSH into Droplet:**
```bash
ssh root@204.48.25.3
```

**View container logs:**
```bash
cd /opt/commerce-pos
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
docker compose -f docker-compose.prod.yml --env-file .env.prod logs api -f
```

**Restart containers:**
```bash
cd /opt/commerce-pos
docker compose -f docker-compose.prod.yml --env-file .env.prod restart
```

**Run migrations manually:**
```bash
cd /opt/commerce-pos
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api node src/db/migrate.js
```

**Rebuild and restart:**
```bash
cd /opt/commerce-pos
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

---

## Database

**Connection:** VPC private hostname — only accessible from within nyc1 VPC.

**Backup local data to production:**
```bash
# Dump local
docker compose exec -T db pg_dump -U commerce_pos -d commerce_pos --no-owner --no-acl -Fc -f /tmp/commerce_pos.dump
docker compose cp db:/tmp/commerce_pos.dump /tmp/commerce_pos.dump

# Restore to production (fresh database)
doctl databases db delete <cluster-id> commerce_pos --force
doctl databases db create <cluster-id> commerce_pos
docker run --rm -v /tmp/commerce_pos.dump:/tmp/commerce_pos.dump postgres:16-alpine \
  pg_restore --no-owner --no-acl \
  -d "postgresql://doadmin:<password>@private-<host>:25060/commerce_pos?sslmode=require" \
  /tmp/commerce_pos.dump
```

**Backups:** DO Managed Postgres includes daily backups retained for 7 days.
To restore: DO Dashboard → Databases → commerce-pos-db → Backups → Restore.

---

## Email setup (Resend + notify.fransolution.net)

Transactional email sends from `noreply@notify.fransolution.net`.
DNS records live in **AWS Route 53** (not Cloudflare — different domain).

Required DNS records in Route 53 for `notify.fransolution.net`:
- SPF TXT record
- DKIM CNAME record
- MX record for bounce handling

After adding records, click **Verify** in Resend dashboard.

`EMAIL_FROM` value: `Commerce POS <noreply@notify.fransolution.net>`

---

## Cloudflare Tunnel

The tunnel runs as a systemd service (`cloudflared`) on the Droplet.

```bash
# Check tunnel status
ssh root@204.48.25.3 systemctl status cloudflared

# Restart tunnel
ssh root@204.48.25.3 systemctl restart cloudflared
```

If the tunnel token needs to be rotated:
1. Cloudflare Zero Trust → Networks → Tunnels → your tunnel → delete connector
2. Create a new connector → copy new token
3. Update `CLOUDFLARE_TUNNEL_TOKEN` GitHub Secret
4. SSH in: `cloudflared service install <new-token> && systemctl restart cloudflared`

---

## Costs (current)

| Component | Size | Monthly |
|---|---|---|
| Droplet | 1 vCPU / 2GB RAM (s-1vcpu-2gb) | ~$12 |
| Managed Postgres | db-s-1vcpu-1gb | ~$15 |
| Cloudflare Tunnel | Zero Trust free tier | $0 |
| **Total** | | **~$27/month** |

**Scale triggers:**
- 5+ schools → upgrade Droplet to `s-2vcpu-4gb` (~$24/mo)
- High traffic → add DO Load Balancer + second Droplet
- Multi-region → AWS (no code changes needed, just env vars and infra)

---

## Monitoring

- **Uptime**: Cloudflare Zero Trust → Tunnels → your tunnel (shows connector status)
- **Errors**: Sentry — `SENTRY_DSN` env var
- **Container logs**: `docker compose logs -f` on the Droplet
- **DB**: DO Dashboard → Databases → commerce-pos-db

---

## Rollback

Revert the commit on `Main` and push — CI/CD deploys the reverted version automatically.

Or manually on the Droplet:
```bash
cd /opt/commerce-pos
git log --oneline -5          # find the commit to roll back to
git reset --hard <commit>
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
