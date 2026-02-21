variable "project_name" {
  description = "Project name prefix"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, stage, prod)"
  type        = string
}

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region for Cloud Run Jobs and Scheduler"
  type        = string
  default     = "us-central1"
}

variable "tenant_id" {
  description = "Tenant UUID for multi-tenant scoping"
  type        = string
}

variable "database_url" {
  description = "PostgreSQL connection URL (stored in Secret Manager)"
  type        = string
  sensitive   = true
}

variable "ingestion_image_uri" {
  description = "Artifact Registry image URI for the ingestion container"
  type        = string
}

variable "vpc_connector_id" {
  description = "VPC access connector ID for Cloud SQL connectivity"
  type        = string
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
  description = "GitHub personal access token (stored in Secret Manager)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_org_logins" {
  description = "Comma-separated GitHub organisation logins"
  type        = string
  default     = ""
}

variable "google_workspace_interval_minutes" {
  description = "Sync interval for Google Workspace (minutes)"
  type        = number
  default     = 60
}

variable "gcp_crm_interval_hours" {
  description = "Sync interval for GCP Resource Manager (hours)"
  type        = number
  default     = 2
}

variable "github_interval_minutes" {
  description = "Sync interval for GitHub (minutes)"
  type        = number
  default     = 30
}

variable "post_process_interval_minutes" {
  description = "Interval for identity resolution + grants backfill (minutes)"
  type        = number
  default     = 15
}

variable "scheduler_enabled" {
  description = "Whether to enable Cloud Scheduler jobs"
  type        = bool
  default     = true
}

variable "log_level" {
  description = "Python logging level"
  type        = string
  default     = "INFO"
}

variable "batch_size" {
  description = "Upsert batch size"
  type        = number
  default     = 500
}
