output "app_url" {
  description = "URL of the deployed Cloud Run service"
  value       = module.compute.service_url
}

output "db_private_ip" {
  description = "Private IP address of the Cloud SQL instance"
  value       = module.database.private_ip_address
}

output "registry_url" {
  description = "Artifact Registry repository URL"
  value       = module.registry.repository_url
}
