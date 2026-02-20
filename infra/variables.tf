variable "project_name" {
  description = "Prefix for Docker resources"
  type        = string
  default     = "cloud-intel"
}

variable "pg_version" {
  description = "PostgreSQL major version tag"
  type        = string
  default     = "16"
}

variable "pg_port" {
  description = "Host port to expose PostgreSQL on (5433 avoids conflicts with local PostgreSQL installs)"
  type        = number
  default     = 5433
}

variable "pg_superuser" {
  description = "PostgreSQL superuser name"
  type        = string
  default     = "cloudintel"
}

variable "pg_superuser_password" {
  description = "PostgreSQL superuser password"
  type        = string
  sensitive   = true
}

variable "pg_database" {
  description = "Application database name"
  type        = string
  default     = "cloud_identity_intel"
}
