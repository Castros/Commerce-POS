output "droplet_ip" {
  description = "Public IP — used for SSH only. App traffic goes through Cloudflare Tunnel."
  value       = digitalocean_droplet.commerce_pos.ipv4_address
}

output "ssh_command" {
  description = "SSH into the droplet"
  value       = "ssh root@${digitalocean_droplet.commerce_pos.ipv4_address}"
}

output "next_steps" {
  description = "What to do after apply"
  value       = <<-EOT
    1. SSH in:  ssh root@${digitalocean_droplet.commerce_pos.ipv4_address}
    2. Wait ~3 min for user_data:  tail -f /var/log/user-data.log
    3. Create .env.prod:  cp /opt/commerce-pos/.env.example /opt/commerce-pos/.env.prod && nano /opt/commerce-pos/.env.prod
    4. Get Cloudflare Tunnel token from Zero Trust → Networks → Tunnels → Create Tunnel
    5. Run provision script:  CLOUDFLARE_TUNNEL_TOKEN=<token> bash /opt/commerce-pos/deploy/provision.sh
  EOT
}
