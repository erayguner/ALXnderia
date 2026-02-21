variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "alxderia"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region for deployment"
  type        = string
  default     = "us-central1"
}

variable "db_password" {
  description = "Password for the database"
  type        = string
  sensitive   = true
}

variable "llm_api_key" {
  description = "API key for the configured LLM provider"
  type        = string
  sensitive   = true
}

variable "llm_provider" {
  description = "LLM provider: anthropic, openai, or gemini"
  type        = string
  default     = "anthropic"
}

variable "llm_model" {
  description = "LLM model identifier (provider-specific). Leave empty for provider default."
  type        = string
  default     = ""
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "cloud_identity_intel"
}

variable "db_username" {
  description = "Database user name"
  type        = string
  default     = "cloudintel"
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection on the database"
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Ingestion service variables
# ---------------------------------------------------------------------------

variable "tenant_id" {
  description = "Tenant UUID for identity ingestion"
  type        = string
  default     = ""
}

variable "pg_password" {
  description = "PostgreSQL password (for ingestion DATABASE_URL construction)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "pg_database" {
  description = "PostgreSQL database name"
  type        = string
  default     = "cloud_identity_intel"
}

variable "gcp_org_id" {
  description = "GCP Organisation ID (e.g. 'organizations/123456789')"
  type        = string
  default     = ""
}

variable "google_admin_email" {
  description = "Google Workspace admin email for domain-wide delegation"
  type        = string
  default     = ""
}

variable "google_customer_id" {
  description = "Google Workspace customer ID"
  type        = string
  default     = ""
}

variable "github_token" {
  description = "GitHub personal access token"
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_org_logins" {
  description = "Comma-separated GitHub organisation logins"
  type        = string
  default     = ""
}

variable "ingestion_image_tag" {
  description = "Docker image tag for ingestion Cloud Run Jobs"
  type        = string
  default     = "latest"
}

variable "ingestion_scheduler_enabled" {
  description = "Whether to enable Cloud Scheduler for ingestion"
  type        = bool
  default     = true
}

variable "ingestion_log_level" {
  description = "Log level for ingestion services"
  type        = string
  default     = "INFO"
}

variable "ingestion_batch_size" {
  description = "Upsert batch size for ingestion"
  type        = number
  default     = 500
}

variable "google_workspace_interval_minutes" {
  description = "Google Workspace sync interval (minutes)"
  type        = number
  default     = 60
}

variable "gcp_crm_interval_hours" {
  description = "GCP Resource Manager sync interval (hours)"
  type        = number
  default     = 2
}

variable "github_interval_minutes" {
  description = "GitHub sync interval (minutes)"
  type        = number
  default     = 30
}

variable "post_process_interval_minutes" {
  description = "Post-processing interval (minutes)"
  type        = number
  default     = 15
}
