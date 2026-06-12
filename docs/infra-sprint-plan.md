# Infrastructure Sprint Plan — Blue/Green, Monitoring, Alerts, Logs

Date: 2026-06-12
Author: Engineering
Status: Planning

---

## Current State

| Resource | Value |
|---|---|
| Host | DigitalOcean Droplet, `pos.jerrycastro.dev` |
| IP | `204.48.25.3` |
| vCPU | 1 |
| RAM | 2 GB total / ~1.3 GB available |
| Disk | 49 GB / 12 GB used |
| Ingress | Cloudflare Tunnel (no open inbound ports) |
| Containers | `commerce-pos-api-1` (40 MB) + `commerce-pos-web-1` (82 MB) |
| Database | External (not in Docker stack) |
| CI/CD | GitHub Actions → push to `Main` → auto-deploy |

**Critical gap:** No memory limits on containers. One OOM event kills both services silently.
**Critical gap:** No external uptime monitoring. Downtime is invisible until a user reports it.
**Critical gap:** No application error tracking. Exceptions are swallowed or buried in logs.

---

## Sprint Goals

1. Blue/green zero-downtime deploys
2. Resource guardrails (container limits)
3. Uptime monitoring + alert routing
4. Application error tracking (Sentry)
5. Structured logging with rotation
6. Clear scaling path documented for when volume arrives

Ordered by risk reduction per hour of effort. Do them in order.

---

## Item 1 — Resource Limits (Day 1, 30 minutes)

**Do this first.** It costs nothing and prevents a silent OOM cascade from taking down the whole box.

Add `deploy.resources.limits` to `docker-compose.prod.yml`:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "0.7"
        reservations:
          memory: 64M

  web:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "0.5"
        reservations:
          memory: 96M
```

**Why these numbers:**
- API is currently using 40 MB. 512 MB gives 12× headroom for traffic spikes, AI calls, and CSV imports.
- Web (Next.js) uses 82 MB idle but can spike during SSR. 512 MB is safe.
- Together they cap at 1 GB, leaving 1 GB for the OS, Cloudflare tunnel, and the monitoring stack.
- CPU limits prevent a runaway AI call from starving the web process.

Apply with: `docker compose -f docker-compose.prod.yml up -d --force-recreate`

---

## Item 2 — Uptime Kuma (Day 1, 1 hour)

Self-hosted uptime monitor. Docker image, ~50 MB RAM, free forever.
Sends alerts via email, Slack, Telegram, Discord, or webhooks.

**Deploy alongside the main stack:**

```yaml
# docker-compose.monitoring.yml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    restart: unless-stopped
    volumes:
      - uptime-kuma-data:/app/data
    ports:
      - "127.0.0.1:3001:3001"   # only localhost — expose via Cloudflare Tunnel
    deploy:
      resources:
        limits:
          memory: 128M

volumes:
  uptime-kuma-data:
```

Expose via a second Cloudflare Tunnel route: `status.pos.jerrycastro.dev → localhost:3001`

**Monitors to configure:**

| Check | URL | Interval | Alert after |
|---|---|---|---|
| API health | `https://pos.jerrycastro.dev/api/health` | 60s | 2 failures |
| Web home | `https://pos.jerrycastro.dev/` | 60s | 2 failures |
| Login page | `https://pos.jerrycastro.dev/login` | 5 min | 2 failures |
| Guardian portal | `https://pos.jerrycastro.dev/parent` | 5 min | 2 failures |
| AI endpoint | `https://pos.jerrycastro.dev/api/v1/ai/summaries?organizationId=...` | 10 min | 3 failures |

**Alert routing:**
- Email to `castrostech@gmail.com` (always)
- Slack or Telegram channel for on-call (add when team grows)
- Status page URL to share with clients: `status.pos.jerrycastro.dev`

---

## Item 3 — Sentry Error Tracking (Day 2, 2 hours)

**Use Sentry's free tier (5,000 errors/month)** — enough for current volume.

### API (Node.js)

```bash
npm install @sentry/node --save
```

`api/src/app.js` — add at the very top before any other import:

```js
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,   // 10% of requests traced — keeps quota low
  });
}
```

Add Sentry error handler middleware after all routes (Express):

```js
app.use(Sentry.Handlers.errorHandler());
```

### Web (Next.js)

```bash
npx @sentry/wizard@latest -i nextjs
```

This auto-generates `sentry.client.config.ts`, `sentry.server.config.ts`, and `instrumentation.ts`.

Set env var `NEXT_PUBLIC_SENTRY_DSN` in `.env.prod`.

### Alert rules to configure in Sentry:

| Rule | Threshold | Action |
|---|---|---|
| New issue seen | First occurrence | Email + Slack |
| Issue frequency spike | >10 events/hour on one issue | Email |
| Any `500` on `/api/v1/orders` or `/api/v1/wallets` | Any | Immediate email (financial endpoints) |
| Unhandled promise rejection in AI module | Any | Email |
| `ANTHROPIC_API_KEY` error | Any | Email |

### New env vars needed:

```
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=your-org
SENTRY_PROJECT=commerce-pos-api
```

---

## Item 4 — Structured Logging + Rotation (Day 2, 1 hour)

### Log rotation on the host

Docker writes JSON logs to `/var/lib/docker/containers/`. Without rotation they grow unbounded.

Add to `/etc/docker/daemon.json` on the Droplet:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
```

Restart Docker: `systemctl restart docker`
This keeps a maximum of 5 × 20 MB = 100 MB of logs per container. Older entries rotate out automatically.

### Viewing logs

```bash
# Live tail
ssh root@204.48.25.3 "docker compose -f /opt/commerce-pos/docker-compose.prod.yml logs -f --tail=100"

# Last 500 lines of API
ssh root@204.48.25.3 "docker logs commerce-pos-api-1 --tail=500"

# Filter for errors only
ssh root@204.48.25.3 "docker logs commerce-pos-api-1 2>&1 | grep -i error"
```

### Application-level structured logging (future, not this sprint)

When log volume justifies it, replace `console.log` with `pino` (structured JSON logs) and pipe to a Loki + Grafana stack on a separate Droplet or cloud log sink. Not needed yet — `docker logs` is sufficient for current scale.

---

## Item 5 — Blue/Green Deployment (Day 3–4, 4 hours)

**Prerequisite: Upgrade the Droplet to 4 GB RAM first** (see Scaling Path below).
On the current 2 GB box, running two full stacks simultaneously would leave only ~200 MB headroom — too tight. On 4 GB it is comfortable.

### Architecture

```
Cloudflare Tunnel
       │
       ▼
   nginx (on host, port 80)
       │
   ┌───┴───┐
   │       │
  blue   green
 (3100)  (3200)   ← Next.js web
 (4100)  (4200)   ← Express API
       │
  shared Postgres (external)
```

Nginx acts as the flip point. A single line change in its config switches traffic from blue to green. No DNS propagation, no Cloudflare change required.

### File layout

```
/opt/commerce-pos/
├── docker-compose.blue.yml    ← blue stack (ports 3100/4100)
├── docker-compose.green.yml   ← green stack (ports 3200/4200)
├── docker-compose.monitoring.yml
├── nginx/
│   ├── nginx.conf
│   └── active                 ← symlink → blue or green
└── scripts/
    └── deploy.sh              ← the flip script
```

### `nginx.conf`

```nginx
upstream active_web {
  server 127.0.0.1:3100;   # blue — change to 3200 for green
}

upstream active_api {
  server 127.0.0.1:4100;   # blue — change to 4200 for green
}

server {
  listen 80;

  location /api/ {
    proxy_pass http://active_api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    proxy_pass http://active_web;
    proxy_set_header Host $host;
  }
}
```

### `scripts/deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET=${1:-green}   # pass 'blue' or 'green'
CURRENT=$(cat /opt/commerce-pos/active-color 2>/dev/null || echo "blue")

if [ "$TARGET" = "$CURRENT" ]; then
  echo "Already on $TARGET. Nothing to do."
  exit 0
fi

echo "▶  Deploying to $TARGET stack..."
docker compose -f /opt/commerce-pos/docker-compose.${TARGET}.yml pull
docker compose -f /opt/commerce-pos/docker-compose.${TARGET}.yml up -d --build

echo "▶  Waiting for health check..."
for i in {1..12}; do
  sleep 5
  STATUS=$(curl -sf http://127.0.0.1:$([ "$TARGET" = "blue" ] && echo 4100 || echo 4200)/health | jq -r '.status' 2>/dev/null || echo "")
  if [ "$STATUS" = "ok" ]; then
    echo "✓  Health check passed (attempt $i)"
    break
  fi
  echo "   Still waiting... ($i/12)"
  if [ $i -eq 12 ]; then
    echo "✗  Health check failed. Aborting flip."
    exit 1
  fi
done

echo "▶  Flipping nginx to $TARGET..."
if [ "$TARGET" = "blue" ]; then
  sed -i 's/127.0.0.1:3200/127.0.0.1:3100/; s/127.0.0.1:4200/127.0.0.1:4100/' /opt/commerce-pos/nginx/nginx.conf
else
  sed -i 's/127.0.0.1:3100/127.0.0.1:3200/; s/127.0.0.1:4100/127.0.0.1:4200/' /opt/commerce-pos/nginx/nginx.conf
fi
nginx -s reload

echo "$TARGET" > /opt/commerce-pos/active-color

echo "▶  Stopping old $CURRENT stack..."
docker compose -f /opt/commerce-pos/docker-compose.${CURRENT}.yml down

echo "✓  Deploy complete. Active: $TARGET"
```

### GitHub Actions integration

Update `deploy.yml` to call the script over SSH:

```yaml
- name: Deploy
  run: |
    CURRENT=$(ssh deploy@${{ secrets.DROPLET_IP }} cat /opt/commerce-pos/active-color 2>/dev/null || echo blue)
    TARGET=$([ "$CURRENT" = "blue" ] && echo green || echo blue)
    ssh deploy@${{ secrets.DROPLET_IP }} "/opt/commerce-pos/scripts/deploy.sh $TARGET"
```

### Rollback

If anything goes wrong after a flip:

```bash
ssh root@204.48.25.3 "/opt/commerce-pos/scripts/deploy.sh blue"
```

The old stack is still running until the script explicitly stops it, so rollback takes ~5 seconds.

---

## Item 6 — DigitalOcean Native Monitoring (Day 1, 10 minutes)

Enable the DO Monitoring agent — it's free and adds CPU, RAM, disk, and bandwidth graphs to the DO console. Also enables threshold alerts via email.

```bash
ssh root@204.48.25.3 "curl -sSL https://repos.insights.digitalocean.com/install.sh | sudo bash"
```

Configure alerts in DO console → Monitoring → Alert Policies:

| Metric | Threshold | Window | Action |
|---|---|---|---|
| CPU usage | > 85% | 5 min | Email |
| Memory usage | > 85% | 5 min | Email |
| Disk usage | > 80% | 5 min | Email |
| Disk read I/O | > 50 MB/s | 5 min | Email |

These are free and require no additional infrastructure.

---

## Scaling Path

Work through these steps in order. Do not skip steps.

### Step 1 — Droplet resize: 2 GB → 4 GB (when: before blue/green)

| | Current | After |
|---|---|---|
| vCPU | 1 | 2 |
| RAM | 2 GB | 4 GB |
| Cost | ~$18/mo | ~$36/mo |

Required for blue/green. Both stacks + monitoring fit comfortably on 4 GB.
DO allows live resize (with a brief reboot). No data loss. Takes ~3 minutes.

### Step 2 — Managed Postgres (when: first paying school goes live)

Move Postgres to DigitalOcean Managed Database ($15/month, smallest tier).

Benefits:
- Automated daily backups with point-in-time recovery (PITR)
- Removes DB from Droplet RAM contention
- Connection pooling via PgBouncer built in
- Failover replica available on paid tiers

Migration: `pg_dump` → restore to managed DB → update `DATABASE_URL` → restart.

### Step 3 — Separate API Droplet (when: >5 concurrent schools or >500 req/min)

Split API and web onto separate 2 GB Droplets. The database becomes the only shared resource.

```
Cloudflare Tunnel
       │
  Load Balancer ($12/mo)
     /         \
  Web           API
  Droplet       Droplet
  (Next.js)     (Express)
                    │
              Managed Postgres
```

DO Load Balancer handles health checks and distributes traffic. Add a second API Droplet for true horizontal scale.

### Step 4 — DO App Platform migration (when: operational overhead outweighs cost)

At sufficient scale (~3+ schools, >$500/mo revenue), migrate back to DO App Platform.
It eliminates server management entirely: auto-scaling, managed TLS, built-in deploy previews.
Cost scales with usage rather than being a fixed monthly commitment.

---

## Summary — What to Build This Sprint

| # | Item | Effort | Risk reduced |
|---|---|---|---|
| 1 | Container memory + CPU limits | 30 min | OOM cascade, resource starvation |
| 2 | DO Monitoring agent + alerts | 10 min | Invisible CPU/RAM/disk exhaustion |
| 3 | Uptime Kuma | 1 hour | Silent downtime, no SLA awareness |
| 4 | Sentry (API + Web) | 2 hours | Undetected application errors, financial endpoint failures |
| 5 | Docker log rotation | 30 min | Disk exhaustion from unbounded logs |
| 6 | Droplet resize 2→4 GB | 10 min | Prerequisite for blue/green |
| 7 | Blue/green deploy script + nginx | 4 hours | Downtime on every deploy |

**Do not start blue/green until items 1–6 are done.** A well-monitored single deployment is safer than an unmonitored blue/green setup.

---

## Open Questions for Next Planning Session

1. **Alert routing** — where do on-call alerts go? Slack workspace, Telegram channel, or PagerDuty?
2. **Sentry project** — one project for API + web, or separate? Separate is cleaner for noise filtering.
3. **Status page** — should `status.pos.jerrycastro.dev` be public (visible to school clients) or internal only?
4. **Log retention** — 100 MB / 5 rotations is about 1–2 weeks of logs at current volume. Is that enough, or do we need to ship logs to S3?
5. **Database backups** — are we relying on Postgres for production right now? If so, confirm backup strategy before first school goes live.
6. **Deploy key** — current deploy runs as `root`. Before production, create a `deploy` user with limited sudo rights (only `docker compose` commands).
