# =============================================================================
# GCP Ingestion Deployment
# =============================================================================
# Wires the ingestion module into the existing GCP deployment.
# Depends on: networking, database, registry modules.
# =============================================================================

# Enable Cloud Scheduler API
resource "google_project_service" "cloudscheduler" {
  project = var.gcp_project_id
  service = "cloudscheduler.googleapis.com"

  disable_dependent_services = false
  disable_on_destroy         = false
}

module "ingestion" {
  source = "../../modules/gcp/ingestion"

  depends_on = [google_project_service.cloudscheduler]

  project_name   = var.project_name
  environment    = var.environment
  gcp_project_id = var.gcp_project_id
  gcp_region     = var.gcp_region

  tenant_id = var.tenant_id

  database_url        = "postgresql://${module.database.db_username}:${var.pg_password}@${module.database.private_ip}:5432/${var.pg_database}"
  ingestion_image_uri = "${module.registry.repository_url}/${var.project_name}-ingestion:${var.ingestion_image_tag}"
  vpc_connector_id    = module.networking.vpc_connector_id

  gcp_org_id         = var.gcp_org_id
  google_admin_email = var.google_admin_email
  google_customer_id = var.google_customer_id
  github_token       = var.github_token
  github_org_logins  = var.github_org_logins

  google_workspace_interval_minutes = var.google_workspace_interval_minutes
  gcp_crm_interval_hours            = var.gcp_crm_interval_hours
  github_interval_minutes           = var.github_interval_minutes
  post_process_interval_minutes     = var.post_process_interval_minutes

  scheduler_enabled = var.ingestion_scheduler_enabled
  log_level         = var.ingestion_log_level
  batch_size        = var.ingestion_batch_size
}
