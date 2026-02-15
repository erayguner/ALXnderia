output "network_id" {
  description = "The ID of the VPC network"
  value       = google_compute_network.main.id
}

output "network_name" {
  description = "The name of the VPC network"
  value       = google_compute_network.main.name
}

output "subnet_id" {
  description = "The ID of the subnetwork"
  value       = google_compute_subnetwork.main.id
}

output "vpc_connector_id" {
  description = "The ID of the VPC access connector"
  value       = google_vpc_access_connector.main.id
}

output "private_services_connection_id" {
  description = "The ID of the private services connection"
  value       = google_service_networking_connection.private_services.id
}
