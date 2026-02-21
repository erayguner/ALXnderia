# =============================================================================
# AWS Ingestion Deployment
# =============================================================================
# Wires the ingestion module into the existing AWS deployment.
# Depends on: networking, database, registry, secrets modules.
# =============================================================================

# ECR repository for ingestion container images
module "ingestion_registry" {
  source = "../../modules/aws/registry"

  project_name    = var.project_name
  repository_name = "ingestion"
}

module "ingestion" {
  source = "../../modules/aws/ingestion"

  project_name = var.project_name
  environment  = var.environment

  tenant_id = var.tenant_id

  vpc_id               = module.networking.vpc_id
  private_subnet_ids   = module.networking.private_subnet_ids
  db_security_group_id = module.database.security_group_id

  database_secret_arn = module.secrets.database_secret_arn
  ingestion_image_uri = "${module.ingestion_registry.repository_url}:${var.ingestion_image_tag}"

  aws_identity_store_id = var.aws_identity_store_id
  aws_sso_instance_arn  = var.aws_sso_instance_arn

  aws_idc_interval_minutes      = var.aws_idc_interval_minutes
  aws_orgs_interval_hours       = var.aws_orgs_interval_hours
  post_process_interval_minutes = var.post_process_interval_minutes

  scheduler_enabled = var.ingestion_scheduler_enabled
  log_level         = var.ingestion_log_level
  batch_size        = var.ingestion_batch_size

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Component   = "ingestion"
  }
}

# Allow ingestion Lambda SG to reach Aurora SG
resource "aws_security_group_rule" "aurora_from_ingestion" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = module.ingestion.security_group_id
  security_group_id        = module.database.security_group_id
  description              = "Ingestion Lambda -> Aurora"
}
