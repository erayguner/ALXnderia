variable "project_name" {
  description = "Project name prefix"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, stage, prod)"
  type        = string
}

variable "tenant_id" {
  description = "Tenant UUID for multi-tenant scoping"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Lambda functions"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Lambda VPC access"
  type        = list(string)
}

variable "db_security_group_id" {
  description = "Security group ID of the Aurora cluster"
  type        = string
}

variable "database_secret_arn" {
  description = "ARN of the Secrets Manager secret containing DATABASE_URL"
  type        = string
}

variable "ingestion_image_uri" {
  description = "ECR image URI for the ingestion Lambda container"
  type        = string
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

variable "aws_idc_interval_minutes" {
  description = "Sync interval for AWS Identity Center (minutes)"
  type        = number
  default     = 60
}

variable "aws_orgs_interval_hours" {
  description = "Sync interval for AWS Organizations (hours)"
  type        = number
  default     = 6
}

variable "post_process_interval_minutes" {
  description = "Interval for identity resolution + grants backfill (minutes)"
  type        = number
  default     = 15
}

variable "scheduler_enabled" {
  description = "Whether to enable EventBridge schedule rules"
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

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
