locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name = "${var.project_name}/${var.environment}/db-credentials"

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-db-credentials"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    host     = var.db_host
    port     = var.db_port
    username = var.db_username
    password = var.db_password
    database = var.db_name
    url      = "postgresql://${var.db_username}:${var.db_password}@${var.db_host}:${var.db_port}/${var.db_name}"
  })
}

resource "aws_secretsmanager_secret" "llm_api_key" {
  name = "${var.project_name}/${var.environment}/llm-api-key"

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-llm-api-key"
  })
}

resource "aws_secretsmanager_secret_version" "llm_api_key" {
  secret_id = aws_secretsmanager_secret.llm_api_key.id

  secret_string = jsonencode({
    LLM_API_KEY = var.llm_api_key
  })
}
