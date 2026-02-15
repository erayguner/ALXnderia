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
