# -----------------------------------------------------------------------------
# App Security Group — created at deploy level to break the circular
# dependency between the database module (needs to allow app ingress)
# and the compute module (needs a security group for the VPC connector).
# -----------------------------------------------------------------------------
resource "aws_security_group" "app" {
  name_prefix = "${var.project_name}-app-"
  description = "Security group for the application layer"
  vpc_id      = module.networking.vpc_id

  tags = {
    Name = "${var.project_name}-app"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Allow the app security group to reach the database on port 5432
resource "aws_security_group_rule" "app_to_db" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = module.database.db_security_group_id
  source_security_group_id = aws_security_group.app.id
  description              = "Allow app to connect to Aurora PostgreSQL"
}

# -----------------------------------------------------------------------------
# Modules
# -----------------------------------------------------------------------------

module "networking" {
  source = "../../modules/aws/networking"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region
}

module "registry" {
  source = "../../modules/aws/registry"

  repository_name = var.project_name
  project_name    = var.project_name
}

module "secrets" {
  source = "../../modules/aws/secrets"

  project_name      = var.project_name
  environment       = var.environment
  db_host           = module.database.cluster_endpoint
  db_port           = "5432"
  db_name           = var.db_name
  db_username       = var.db_username
  db_password       = var.db_password
  llm_api_key       = var.llm_api_key
}

module "database" {
  source = "../../modules/aws/database"

  project_name          = var.project_name
  environment           = var.environment
  vpc_id                = module.networking.vpc_id
  db_subnet_group_name  = module.networking.db_subnet_group_name
  app_security_group_id = aws_security_group.app.id
  db_name               = var.db_name
  db_username           = var.db_username
  db_password           = var.db_password
  skip_final_snapshot   = var.skip_final_snapshot
}

module "compute" {
  source = "../../modules/aws/compute"

  project_name              = var.project_name
  environment               = var.environment
  vpc_id                    = module.networking.vpc_id
  private_subnet_ids        = module.networking.private_subnet_ids
  ecr_repository_url        = module.registry.repository_url
  db_credentials_secret_arn = module.secrets.db_credentials_secret_arn
  llm_api_key_secret_arn    = module.secrets.llm_api_key_secret_arn
  secret_arns               = module.secrets.all_secret_arns
  llm_provider              = var.llm_provider
  llm_model                 = var.llm_model
}
