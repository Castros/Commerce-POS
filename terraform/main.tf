terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

# DNS is managed in Cloudflare. Traffic enters via Cloudflare Tunnel (cloudflared).
# No inbound 80/443 needed — the Droplet only accepts SSH.

resource "digitalocean_droplet" "commerce_pos" {
  name     = "commerce-pos-${var.environment}"
  region   = var.region
  size     = var.droplet_size
  image    = "ubuntu-22-04-x64"
  ssh_keys = [var.ssh_key_fingerprint]
  tags     = ["commerce-pos", var.environment]

  user_data = <<-EOF
    #!/bin/bash
    set -e
    exec > /var/log/user-data.log 2>&1

    # ── Swap (2 GB) ────────────────────────────────────────────────────────────
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl vm.swappiness=10
    echo 'vm.swappiness=10' >> /etc/sysctl.conf

    # ── Docker (official apt repo) ─────────────────────────────────────────────
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker

    # ── cloudflared (Cloudflare Tunnel) ────────────────────────────────────────
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
      | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
      https://pkg.cloudflare.com/cloudflared focal main" \
      | tee /etc/apt/sources.list.d/cloudflared.list
    apt-get update -y
    apt-get install -y cloudflared

    # ── Sentinel ───────────────────────────────────────────────────────────────
    touch /var/lib/cloud/instance/boot-finished
    echo "user-data complete"
  EOF
}

# Only SSH open inbound — Cloudflare Tunnel handles all app traffic
resource "digitalocean_firewall" "commerce_pos" {
  name        = "commerce-pos-${var.environment}-fw"
  droplet_ids = [digitalocean_droplet.commerce_pos.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Assign to the Commerce POS DO project (optional — set do_project_id in tfvars)
resource "digitalocean_project_resources" "commerce_pos" {
  count   = var.do_project_id != "" ? 1 : 0
  project = var.do_project_id
  resources = [
    digitalocean_droplet.commerce_pos.urn
  ]
}
