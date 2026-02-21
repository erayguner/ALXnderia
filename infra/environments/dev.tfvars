# =============================================================================
# Development Environment
# =============================================================================

environment = "dev"

# Ingestion scheduling -- relaxed intervals for dev
ingestion_scheduler_enabled = false
ingestion_log_level         = "DEBUG"
ingestion_batch_size        = 100
ingestion_image_tag         = "dev-latest"

aws_idc_interval_minutes      = 120
aws_orgs_interval_hours       = 12
google_workspace_interval_minutes = 120
gcp_crm_interval_hours            = 6
github_interval_minutes           = 60
post_process_interval_minutes     = 30
