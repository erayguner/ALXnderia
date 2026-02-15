# -----------------------------------------------------------------------------
# Enable required GCP APIs
# -----------------------------------------------------------------------------
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
  ])

  project                    = var.gcp_project_id
  service                    = each.value
  disable_dependent_services = false
}

# -----------------------------------------------------------------------------
# Modules
# -----------------------------------------------------------------------------

module "networking" {
  source = "../../modules/gcp/networking"

  project_name   = var.project_name
  environment    = var.environment
  region         = var.gcp_region
  gcp_project_id = var.gcp_project_id

  depends_on = [google_project_service.apis]
}

module "registry" {
  source = "../../modules/gcp/registry"

  repository_name = var.project_name
  project_name    = var.project_name
  region          = var.gcp_region
  gcp_project_id  = var.gcp_project_id

  depends_on = [google_project_service.apis]
}

module "secrets" {
  source = "../../modules/gcp/secrets"

  project_name      = var.project_name
  environment       = var.environment
  gcp_project_id    = var.gcp_project_id
  db_host           = module.database.private_ip_address
  db_port           = "5432"
  db_name           = var.db_name
  db_username       = var.db_username
  db_password       = var.db_password
  llm_api_key       = var.llm_api_key

  depends_on = [google_project_service.apis]
}

module "database" {
  source = "../../modules/gcp/database"

  project_name                   = var.project_name
  environment                    = var.environment
  region                         = var.gcp_region
  gcp_project_id                 = var.gcp_project_id
  network_id                     = module.networking.network_id
  private_services_connection_id = module.networking.private_services_connection_id
  db_name                        = var.db_name
  db_username                    = var.db_username
  db_password                    = var.db_password
  deletion_protection            = var.deletion_protection

  depends_on = [google_project_service.apis]
}

module "compute" {
  source = "../../modules/gcp/compute"

  project_name             = var.project_name
  environment              = var.environment
  region                   = var.gcp_region
  gcp_project_id           = var.gcp_project_id
  vpc_connector_id         = module.networking.vpc_connector_id
  image_url                = "${module.registry.repository_url}/${var.project_name}:latest"
  db_credentials_secret_id = module.secrets.db_credentials_secret_id
  llm_api_key_secret_id    = module.secrets.llm_api_key_secret_id
  llm_provider             = var.llm_provider
  llm_model                = var.llm_model

  depends_on = [google_project_service.apis]
}
