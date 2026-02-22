locals {
  labels = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_sql_database_instance" "main" {
  name                = "${var.project_name}-${var.environment}-db"
  project             = var.gcp_project_id
  region              = var.region
  database_version    = "POSTGRES_18"
  deletion_protection = var.deletion_protection

  settings {
    tier              = "db-custom-2-7680"
    availability_type = "REGIONAL"
    user_labels       = local.labels

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      require_ssl                                   = true
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    insights_config {
      query_insights_enabled  = true
      record_client_address   = true
    }

    database_flags {
      name  = "log_connections"
      value = "on"
    }

    database_flags {
      name  = "log_disconnections"
      value = "on"
    }

    database_flags {
      name  = "log_hostname"
      value = "on"
    }

    database_flags {
      name  = "log_min_error_statement"
      value = "error"
    }

    database_flags {
      name  = "log_checkpoints"
      value = "on"
    }

    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }

    database_flags {
      name  = "log_statement"
      value = "ddl"
    }

    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "on"
    }

    database_flags {
      name  = "pgaudit.log"
      value = "all"
    }
  }

}

# Note: The dependency on the private services connection is handled at the
# deploy level via module.networking.private_services_connection_id reference.

resource "google_sql_database" "main" {
  name     = var.db_name
  project  = var.gcp_project_id
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "main" {
  name     = var.db_username
  project  = var.gcp_project_id
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

resource "null_resource" "schema_migration" {
  triggers = {
    schema_hash = sha256(join("", [
      for f in sort(fileset("${path.module}/../../schema", "**/*.sql")) :
      filesha256("${path.module}/../../schema/${f}")
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      for dir in $(ls -d ${path.module}/../../schema/*/); do
        for sql_file in $(ls "$dir"*.sql 2>/dev/null | sort); do
          echo "Applying: $sql_file"
          PGPASSWORD="${var.db_password}" psql \
            -h "${google_sql_database_instance.main.private_ip_address}" \
            -U "${var.db_username}" \
            -d "${var.db_name}" \
            -f "$sql_file"
        done
      done
    EOT
  }

  depends_on = [
    google_sql_database.main,
    google_sql_user.main,
  ]
}
