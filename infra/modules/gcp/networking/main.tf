locals {
  labels = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_compute_network" "main" {
  name                    = "${var.project_name}-network"
  project                 = var.gcp_project_id
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  name                     = "${var.project_name}-subnet"
  project                  = var.gcp_project_id
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.1.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_services" {
  name          = "${var.project_name}-private-ip"
  project       = var.gcp_project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_vpc_access_connector" "main" {
  name           = "${var.project_name}-connector"
  project        = var.gcp_project_id
  region         = var.region
  network        = google_compute_network.main.name
  ip_cidr_range  = "10.2.0.0/28"
  min_throughput = 200
  max_throughput = 300
}
