output "connection_string" {
  description = "psql connection string"
  value       = "postgresql://${var.pg_superuser}@localhost:${var.pg_port}/${var.pg_database}"
  sensitive   = true
}

output "container_name" {
  description = "Docker container name"
  value       = docker_container.postgres.name
}

output "pg_port" {
  description = "Exposed PostgreSQL port"
  value       = var.pg_port
}
