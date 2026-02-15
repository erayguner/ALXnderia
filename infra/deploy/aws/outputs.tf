output "app_url" {
  description = "URL of the deployed application"
  value       = module.compute.service_url
}

output "db_endpoint" {
  description = "Aurora cluster endpoint"
  value       = module.database.cluster_endpoint
}

output "ecr_repository_url" {
  description = "ECR repository URL for container images"
  value       = module.registry.repository_url
}
