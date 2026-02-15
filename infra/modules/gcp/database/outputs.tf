output "instance_connection_name" {
  description = "The connection name of the Cloud SQL instance"
  value       = google_sql_database_instance.main.connection_name
}

output "private_ip_address" {
  description = "The private IP address of the Cloud SQL instance"
  value       = google_sql_database_instance.main.private_ip_address
}

output "db_name" {
  description = "The name of the database"
  value       = google_sql_database.main.name
}

output "db_username" {
  description = "The database username"
  value       = google_sql_user.main.name
}
