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

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
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
  description = "Database master username"
  type        = string
  default     = "cloudintel"
}

variable "skip_final_snapshot" {
  description = "Whether to skip final DB snapshot on destroy"
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Ingestion service variables
# ---------------------------------------------------------------------------

variable "tenant_id" {
  description = "Tenant UUID for identity ingestion"
  type        = string
  default     = ""
}

variable "aws_identity_store_id" {
  description = "IAM Identity Center Identity Store ID"
  type        = string
  default     = ""
}

variable "aws_sso_instance_arn" {
  description = "IAM Identity Center SSO Instance ARN"
  type        = string
  default     = ""
}

variable "ingestion_image_tag" {
  description = "Docker image tag for ingestion Lambda container"
  type        = string
  default     = "latest"
}

variable "ingestion_scheduler_enabled" {
  description = "Whether to enable EventBridge scheduling for ingestion"
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

variable "aws_idc_interval_minutes" {
  description = "AWS Identity Center sync interval (minutes)"
  type        = number
  default     = 60
}

variable "aws_orgs_interval_hours" {
  description = "AWS Organizations sync interval (hours)"
  type        = number
  default     = 6
}

variable "post_process_interval_minutes" {
  description = "Post-processing interval (minutes)"
  type        = number
  default     = 15
}
