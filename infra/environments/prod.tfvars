# =============================================================================
# Production Environment
# =============================================================================

environment = "prod"

# Ingestion scheduling -- production intervals
ingestion_scheduler_enabled = true
ingestion_log_level         = "INFO"
ingestion_batch_size        = 500
ingestion_image_tag         = "latest"

aws_idc_interval_minutes      = 60
aws_orgs_interval_hours       = 6
google_workspace_interval_minutes = 60
gcp_crm_interval_hours            = 2
github_interval_minutes           = 30
post_process_interval_minutes     = 15
