variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "db_subnet_group_name" {
  description = "Name of the database subnet group"
  type        = string
}

variable "app_security_group_id" {
  description = "Security group ID of the application for ingress rules"
  type        = string
}

variable "db_name" {
  description = "Name of the database"
  type        = string
  default     = "cloud_identity_intel"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "cloudintel"
}

variable "db_password" {
  description = "Master password for the database"
  type        = string
  sensitive   = true
}

variable "skip_final_snapshot" {
  description = "Whether to skip the final snapshot when destroying the cluster"
  type        = bool
  default     = true
}
