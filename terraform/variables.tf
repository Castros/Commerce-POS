variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "region" {
  description = "DigitalOcean region slug — match your managed database region"
  type        = string
  default     = "nyc1"
}

variable "droplet_size" {
  description = "Droplet size slug"
  type        = string
  default     = "s-1vcpu-2gb"
}

variable "ssh_key_fingerprint" {
  description = "SSH key fingerprint from DigitalOcean account (Settings → Security → SSH Keys)"
  type        = string
}

variable "do_project_id" {
  description = "DigitalOcean Project ID to assign resources to (find in DO dashboard URL or via API). Leave empty to skip."
  type        = string
  default     = ""
}
