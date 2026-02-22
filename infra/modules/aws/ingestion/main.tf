# =============================================================================
# AWS Ingestion Module
# =============================================================================
# Deploys Lambda functions for AWS-native provider syncs:
#   - aws_identity_center (identitystore + sso-admin)
#   - aws_organizations
# Includes IAM roles with least-privilege, EventBridge scheduling,
# Secrets Manager integration, and VPC access for Aurora connectivity.
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  function_prefix = "${var.project_name}-${var.environment}-ingestion"
  providers = {
    aws_identity_center = {
      description = "Sync AWS IAM Identity Center users, groups, memberships, and account assignments"
      schedule    = "rate(${var.aws_idc_interval_minutes} minutes)"
      timeout     = 300
      memory      = 512
    }
    aws_organizations = {
      description = "Sync AWS Organization accounts"
      schedule    = "rate(${var.aws_orgs_interval_hours} hours)"
      timeout     = 120
      memory      = 256
    }
  }
}

# ---------------------------------------------------------------------------
# Lambda execution role (shared)
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ingestion_lambda" {
  name = "${local.function_prefix}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

# CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.ingestion_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# VPC access for Lambda -> Aurora
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.ingestion_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# IAM Identity Center (identitystore + sso-admin) -- least privilege
resource "aws_iam_role_policy" "identity_center" {
  name = "${local.function_prefix}-identity-center"
  role = aws_iam_role.ingestion_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "IdentityStoreReadOnly"
        Effect = "Allow"
        Action = [
          "identitystore:ListUsers",
          "identitystore:ListGroups",
          "identitystore:ListGroupMemberships",
          "identitystore:DescribeUser",
          "identitystore:DescribeGroup",
          "identitystore:DescribeGroupMembership",
        ]
        Resource = "*"
      },
      {
        Sid    = "SSOAdminReadOnly"
        Effect = "Allow"
        Action = [
          "sso:ListPermissionSets",
          "sso:DescribePermissionSet",
          "sso:ListAccountsForProvisionedPermissionSet",
          "sso:ListAccountAssignments",
        ]
        Resource = "*"
      },
    ]
  })
}

# AWS Organizations -- least privilege
resource "aws_iam_role_policy" "organizations" {
  name = "${local.function_prefix}-organizations"
  role = aws_iam_role.ingestion_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "OrganizationsReadOnly"
      Effect = "Allow"
      Action = [
        "organizations:ListAccounts",
        "organizations:DescribeOrganization",
        "organizations:DescribeAccount",
        "organizations:ListParents",
      ]
      Resource = "*"
    }]
  })
}

# Secrets Manager access
resource "aws_iam_role_policy" "secrets" {
  name = "${local.function_prefix}-secrets"
  role = aws_iam_role.ingestion_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
      ]
      Resource = [
        var.database_secret_arn,
      ]
    }]
  })
}

# ---------------------------------------------------------------------------
# Secrets Manager -- ingestion-specific secrets
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "ingestion_config" {
  name        = "${var.project_name}/${var.environment}/ingestion-config"
  description = "Ingestion service configuration"
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "ingestion_config" {
  secret_id = aws_secretsmanager_secret.ingestion_config.id
  secret_string = jsonencode({
    TENANT_ID             = var.tenant_id
    AWS_IDENTITY_STORE_ID = var.aws_identity_store_id
    AWS_SSO_INSTANCE_ARN  = var.aws_sso_instance_arn
  })
}

# ---------------------------------------------------------------------------
# Dead-letter queue for Lambda failures
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "ingestion_dlq" {
  name                      = "${local.function_prefix}-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

# Allow Lambda role to send messages to the DLQ
resource "aws_iam_role_policy" "lambda_dlq" {
  name = "${local.function_prefix}-dlq"
  role = aws_iam_role.ingestion_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.ingestion_dlq.arn
    }]
  })
}

# Allow Lambda role to write X-Ray traces
resource "aws_iam_role_policy_attachment" "lambda_xray" {
  role       = aws_iam_role.ingestion_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# ---------------------------------------------------------------------------
# Lambda security group (outbound to Aurora + internet for AWS APIs)
# ---------------------------------------------------------------------------

resource "aws_security_group" "ingestion_lambda" {
  name_prefix = "${local.function_prefix}-"
  vpc_id      = var.vpc_id
  description = "Ingestion Lambda functions"

  egress {
    description     = "PostgreSQL to Aurora"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.db_security_group_id]
  }

  egress {
    description = "HTTPS for AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${local.function_prefix}-sg" })
}

# ---------------------------------------------------------------------------
# Lambda functions
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "ingestion" {
  for_each = local.providers

  function_name = "${local.function_prefix}-${replace(each.key, "_", "-")}"
  description   = each.value.description
  role          = aws_iam_role.ingestion_lambda.arn
  handler       = "scripts.ingestion.entrypoints.aws_lambda.handler"
  runtime       = "python3.12"
  timeout       = each.value.timeout
  memory_size   = each.value.memory

  # Container image from ECR
  package_type = "Image"
  image_uri    = var.ingestion_image_uri

  # Concurrency limit prevents runaway invocations
  reserved_concurrent_executions = 1

  tracing_config {
    mode = "Active"
  }

  dead_letter_config {
    target_arn = aws_sqs_queue.ingestion_dlq.arn
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.ingestion_lambda.id]
  }

  environment {
    variables = {
      DATABASE_URL              = "aws-secret://${var.database_secret_arn}#url"
      TENANT_ID                 = var.tenant_id
      AWS_IDENTITY_STORE_ID     = var.aws_identity_store_id
      AWS_SSO_INSTANCE_ARN      = var.aws_sso_instance_arn
      AWS_ORGANIZATIONS_ENABLED = "true"
      LOG_LEVEL                 = var.log_level
      INGESTION_BATCH_SIZE      = tostring(var.batch_size)
    }
  }

  tags = merge(var.tags, {
    Provider = each.key
  })
}

# ---------------------------------------------------------------------------
# EventBridge scheduling rules
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "ingestion" {
  for_each = local.providers

  name                = "${local.function_prefix}-${replace(each.key, "_", "-")}"
  description         = "Schedule for ${each.value.description}"
  schedule_expression = each.value.schedule
  state               = var.scheduler_enabled ? "ENABLED" : "DISABLED"

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "ingestion" {
  for_each = local.providers

  rule = aws_cloudwatch_event_rule.ingestion[each.key].name
  arn  = aws_lambda_function.ingestion[each.key].arn

  input = jsonencode({
    provider = each.key
  })
}

resource "aws_lambda_permission" "eventbridge" {
  for_each = local.providers

  statement_id  = "AllowEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingestion[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ingestion[each.key].arn
}

# ---------------------------------------------------------------------------
# Post-processing Lambda (identity resolution + grants backfill)
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "post_process" {
  function_name = "${local.function_prefix}-post-process"
  description   = "Identity resolution and grants backfill"
  role          = aws_iam_role.ingestion_lambda.arn
  handler       = "scripts.ingestion.entrypoints.aws_lambda.handler"
  runtime       = "python3.12"
  timeout       = 600
  memory_size   = 512
  package_type  = "Image"
  image_uri     = var.ingestion_image_uri

  reserved_concurrent_executions = 1

  tracing_config {
    mode = "Active"
  }

  dead_letter_config {
    target_arn = aws_sqs_queue.ingestion_dlq.arn
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.ingestion_lambda.id]
  }

  environment {
    variables = {
      DATABASE_URL         = "aws-secret://${var.database_secret_arn}#url"
      TENANT_ID            = var.tenant_id
      LOG_LEVEL            = var.log_level
      INGESTION_BATCH_SIZE = tostring(var.batch_size)
    }
  }

  tags = merge(var.tags, { Provider = "post-process" })
}

resource "aws_cloudwatch_event_rule" "post_process" {
  name                = "${local.function_prefix}-post-process"
  description         = "Identity resolution and grants backfill"
  schedule_expression = "rate(${var.post_process_interval_minutes} minutes)"
  state               = var.scheduler_enabled ? "ENABLED" : "DISABLED"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "post_process" {
  rule  = aws_cloudwatch_event_rule.post_process.name
  arn   = aws_lambda_function.post_process.arn
  input = jsonencode({ provider = "post-process" })
}

resource "aws_lambda_permission" "post_process_eventbridge" {
  statement_id  = "AllowEventBridge-postprocess"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_process.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.post_process.arn
}
