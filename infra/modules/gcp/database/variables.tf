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

variable "network_id" {
  description = "The ID of the VPC network"
  type        = string
}

variable "private_services_connection_id" {
  description = "The ID of the private services connection"
  type        = string
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "cloud_identity_intel"
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "cloudintel"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection on the database instance"
  type        = bool
  default     = true
}
