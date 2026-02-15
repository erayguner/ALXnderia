variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
}

variable "vpc_connector_id" {
  description = "The ID of the VPC access connector"
  type        = string
}

variable "image_url" {
  description = "Container image URL for Cloud Run"
  type        = string
}

variable "db_credentials_secret_id" {
  description = "Secret Manager secret ID for database credentials"
  type        = string
}

variable "llm_api_key_secret_id" {
  description = "Secret Manager secret ID for the LLM API key"
  type        = string
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
