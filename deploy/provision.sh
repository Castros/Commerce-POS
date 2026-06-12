#!/bin/bash
# One-time server provisioning script.
# Run after Terraform apply, once the Droplet is up.
#
# Usage:
#   ssh root@<droplet-ip>
#   CLOUDFLARE_TUNNEL_TOKEN=<token> bash /opt/commerce-pos/deploy/provision.sh
#
# Get your tunnel token from:
#   Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared
#   Copy the token from the install command shown in the dashboard.

set -e

APP_DIR="/opt/commerce-pos"
REPO="https://github.com/Castros/Commerce-POS.git"

# ── Validate ──────────────────────────────────────────────────────────────────
if [ -z "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  echo "ERROR: CLOUDFLARE_TUNNEL_TOKEN is not set."
  echo "  Get it from Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel."
  echo "  Run: CLOUDFLARE_TUNNEL_TOKEN=<token> bash provision.sh"
  exit 1
fi

# ── Wait for user-data (Docker + cloudflared install) to complete ─────────────
echo "Waiting for user-data to complete..."
while [ ! -f /var/lib/cloud/instance/boot-finished ]; do sleep 2; done
while ! docker info &>/dev/null; do sleep 2; done
echo "Docker is ready."

# ── Clone repo ────────────────────────────────────────────────────────────────
if [ ! -d "$APP_DIR" ]; then
  git clone --branch Main "$REPO" "$APP_DIR"
else
  echo "Directory $APP_DIR already exists — skipping clone."
fi

# ── Environment file ──────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env.prod" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env.prod"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ACTION REQUIRED: Edit $APP_DIR/.env.prod before continuing."
  echo ""
  echo "  Minimum required values:"
  echo "    DATABASE_URL       — doadmin connection string from DO managed DB"
  echo "    SESSION_SECRET     — openssl rand -hex 32"
  echo "    COMMERCE_API_TOKEN — openssl rand -hex 32"
  echo "    CORS_ORIGINS       — https://pos.jerrycastro.dev"
  echo "    APP_URL            — https://pos.jerrycastro.dev"
  echo "    EMAIL_FROM         — Commerce POS <noreply@notify.fransolution.net>"
  echo ""
  echo "  Re-run with CLOUDFLARE_TUNNEL_TOKEN set once the file is saved."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# ── Build containers ──────────────────────────────────────────────────────────
cd "$APP_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod build

# ── Run database migrations ───────────────────────────────────────────────────
echo "Running migrations..."
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api node src/db/migrate.js

# ── Start containers ──────────────────────────────────────────────────────────
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# ── Cloudflare Tunnel ─────────────────────────────────────────────────────────
echo "Installing Cloudflare Tunnel service..."
cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN"
systemctl enable cloudflared
systemctl start cloudflared

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done. Verify tunnel status with: systemctl status cloudflared"
echo ""
echo "  In Cloudflare Zero Trust → Networks → Tunnels, configure the route:"
echo "    Public hostname: pos.jerrycastro.dev"
echo "    Service:         http://localhost:3100"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
