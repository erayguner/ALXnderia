locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_security_group" "aurora" {
  name_prefix = "${var.project_name}-${var.environment}-aurora-"
  description = "Security group for Aurora PostgreSQL cluster"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from application"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_security_group_id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-aurora-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${var.project_name}-${var.environment}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_rds_cluster" "main" {
  cluster_identifier = "${var.project_name}-${var.environment}"
  engine             = "aurora-postgresql"
  engine_version     = "16.4"
  database_name      = var.db_name
  master_username    = var.db_username
  master_password    = var.db_password

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [aws_security_group.aurora.id]

  storage_encrypted        = true
  deletion_protection      = var.environment == "production" ? true : false
  copy_tags_to_snapshot    = true
  skip_final_snapshot      = var.skip_final_snapshot
  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 16
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-aurora-cluster"
  })
}

resource "aws_rds_cluster_instance" "main" {
  identifier         = "${var.project_name}-${var.environment}-instance-1"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn
  monitoring_interval          = 60
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-aurora-instance-1"
  })
}

resource "null_resource" "schema_migration" {
  triggers = {
    schema_hash = sha256(join("", [
      for f in sort(fileset("${path.module}/../../../schema", "**/*.sql")) :
      filesha256("${path.module}/../../../schema/${f}")
    ]))
    cluster_endpoint = aws_rds_cluster.main.endpoint
  }

  provisioner "local-exec" {
    command = <<-EOT
      for sqlfile in $(find "${path.module}/../../../schema" -name '*.sql' | sort); do
        echo "Applying: $sqlfile"
        psql -h "${aws_rds_cluster.main.endpoint}" \
          -p "${aws_rds_cluster.main.port}" \
          -U "${var.db_username}" \
          -d "${var.db_name}" \
          --set ON_ERROR_STOP=1 \
          -f "$sqlfile"
      done
    EOT

    environment = {
      PGPASSWORD = var.db_password
    }
  }

  depends_on = [aws_rds_cluster_instance.main]
}
