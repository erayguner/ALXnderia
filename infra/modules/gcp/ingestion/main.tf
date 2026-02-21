# =============================================================================
# GCP Ingestion Module
# =============================================================================
# Deploys Cloud Run Jobs for GCP-native and centralised provider syncs:
#   - google_workspace (Admin SDK via domain-wide delegation)
#   - gcp_resource_manager (CRM: orgs, projects, IAM bindings)
#   - github (centralised from GCP, token-based auth)
#   - post-process (identity resolution + grants backfill)
# Includes service accounts with least-privilege, Cloud Scheduler triggers,
# Secret Manager integration, and VPC connector for Cloud SQL access.
# =============================================================================

locals {
  job_prefix = "${var.project_name}-${var.environment}-ingestion"
  providers = {
    google_workspace = {
      description = "Sync Google Workspace users, groups, and memberships"
      schedule    = "*/${var.google_workspace_interval_minutes} * * * *"
      timeout     = "300s"
      memory      = "512Mi"
      cpu         = "1"
    }
    gcp_resource_manager = {
      description = "Sync GCP organisations, projects, and IAM bindings"
      schedule    = "0 */${var.gcp_crm_interval_hours} * * *"
      timeout     = "300s"
      memory      = "512Mi"
      cpu         = "1"
    }
    github = {
      description = "Sync GitHub organisations, users, teams, repos, and permissions"
      schedule    = "*/${var.github_interval_minutes} * * * *"
      timeout     = "600s"
      memory      = "1Gi"
      cpu         = "1"
    }
  }
}

# ---------------------------------------------------------------------------
# Service account for ingestion jobs (with Workload Identity)
# ---------------------------------------------------------------------------

resource "google_service_account" "ingestion" {
  account_id   = "${var.project_name}-ingestion"
  display_name = "Identity Ingestion Service"
  description  = "Service account for identity data ingestion Cloud Run Jobs"
  project      = var.gcp_project_id
}

# Google Workspace Admin SDK (domain-wide delegation configured separately)
# The service account needs to be granted domain-wide delegation in Google Admin
# and added as a delegated admin for the required scopes.

# GCP Resource Manager read access
resource "google_organization_iam_member" "org_viewer" {
  count  = var.gcp_org_id != "" ? 1 : 0
  org_id = replace(var.gcp_org_id, "organizations/", "")
  role   = "roles/resourcemanager.organizationViewer"
  member = "serviceAccount:${google_service_account.ingestion.email}"
}

resource "google_organization_iam_member" "folder_viewer" {
  count  = var.gcp_org_id != "" ? 1 : 0
  org_id = replace(var.gcp_org_id, "organizations/", "")
  role   = "roles/resourcemanager.folderViewer"
  member = "serviceAccount:${google_service_account.ingestion.email}"
}

resource "google_organization_iam_member" "project_viewer" {
  count  = var.gcp_org_id != "" ? 1 : 0
  org_id = replace(var.gcp_org_id, "organizations/", "")
  role   = "roles/browser"
  member = "serviceAccount:${google_service_account.ingestion.email}"
}

resource "google_organization_iam_member" "iam_reviewer" {
  count  = var.gcp_org_id != "" ? 1 : 0
  org_id = replace(var.gcp_org_id, "organizations/", "")
  role   = "roles/iam.securityReviewer"
  member = "serviceAccount:${google_service_account.ingestion.email}"
}

# Secret Manager access
resource "google_project_iam_member" "secret_accessor" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.ingestion.email}"
}

# Cloud SQL client access
resource "google_project_iam_member" "cloudsql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.ingestion.email}"
}

# ---------------------------------------------------------------------------
# Secret Manager -- ingestion secrets
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.project_name}-${var.environment}-ingestion-database-url"
  project   = var.gcp_project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = var.database_url
}

resource "google_secret_manager_secret" "github_token" {
  count     = var.github_token != "" ? 1 : 0
  secret_id = "${var.project_name}-${var.environment}-ingestion-github-token"
  project   = var.gcp_project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "github_token" {
  count       = var.github_token != "" ? 1 : 0
  secret      = google_secret_manager_secret.github_token[0].id
  secret_data = var.github_token
}

# ---------------------------------------------------------------------------
# Cloud Run Jobs (one per provider)
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "ingestion" {
  for_each = local.providers

  name     = "${local.job_prefix}-${replace(each.key, "_", "-")}"
  location = var.gcp_region
  project  = var.gcp_project_id

  template {
    task_count = 1

    template {
      service_account = google_service_account.ingestion.email
      timeout         = each.value.timeout
      max_retries     = 3

      containers {
        image = var.ingestion_image_uri

        resources {
          limits = {
            cpu    = each.value.cpu
            memory = each.value.memory
          }
        }

        env {
          name  = "INGESTION_PROVIDER"
          value = each.key
        }

        env {
          name  = "TENANT_ID"
          value = var.tenant_id
        }

        env {
          name  = "GCP_ORG_ID"
          value = var.gcp_org_id
        }

        env {
          name  = "GOOGLE_ADMIN_EMAIL"
          value = var.google_admin_email
        }

        env {
          name  = "GOOGLE_CUSTOMER_ID"
          value = var.google_customer_id
        }

        env {
          name  = "GITHUB_ORG_LOGINS"
          value = var.github_org_logins
        }

        env {
          name  = "LOG_LEVEL"
          value = var.log_level
        }

        env {
          name  = "INGESTION_BATCH_SIZE"
          value = tostring(var.batch_size)
        }

        # DATABASE_URL from Secret Manager
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        # GITHUB_TOKEN from Secret Manager (only for github job)
        dynamic "env" {
          for_each = each.key == "github" && var.github_token != "" ? [1] : []
          content {
            name = "GITHUB_TOKEN"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.github_token[0].secret_id
                version = "latest"
              }
            }
          }
        }
      }

      vpc_access {
        connector = var.vpc_connector_id
        egress    = "PRIVATE_RANGES_ONLY"
      }
    }
  }

  lifecycle {
    ignore_changes = [
      launch_stage,
    ]
  }
}

# ---------------------------------------------------------------------------
# Post-processing Cloud Run Job
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "post_process" {
  name     = "${local.job_prefix}-post-process"
  location = var.gcp_region
  project  = var.gcp_project_id

  template {
    task_count = 1

    template {
      service_account = google_service_account.ingestion.email
      timeout         = "600s"
      max_retries     = 2

      containers {
        image = var.ingestion_image_uri

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        env {
          name  = "INGESTION_PROVIDER"
          value = "post-process"
        }

        env {
          name  = "TENANT_ID"
          value = var.tenant_id
        }

        env {
          name  = "LOG_LEVEL"
          value = var.log_level
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
      }

      vpc_access {
        connector = var.vpc_connector_id
        egress    = "PRIVATE_RANGES_ONLY"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Cloud Scheduler triggers
# ---------------------------------------------------------------------------

resource "google_cloud_scheduler_job" "ingestion" {
  for_each = local.providers

  name      = "${local.job_prefix}-${replace(each.key, "_", "-")}"
  region    = var.gcp_region
  project   = var.gcp_project_id
  schedule  = each.value.schedule
  time_zone = "Etc/UTC"
  paused    = !var.scheduler_enabled

  http_target {
    http_method = "POST"
    uri         = "https://${var.gcp_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project_id}/jobs/${google_cloud_run_v2_job.ingestion[each.key].name}:run"

    oauth_token {
      service_account_email = google_service_account.ingestion.email
    }
  }
}

resource "google_cloud_scheduler_job" "post_process" {
  name      = "${local.job_prefix}-post-process"
  region    = var.gcp_region
  project   = var.gcp_project_id
  schedule  = "*/${var.post_process_interval_minutes} * * * *"
  time_zone = "Etc/UTC"
  paused    = !var.scheduler_enabled

  http_target {
    http_method = "POST"
    uri         = "https://${var.gcp_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project_id}/jobs/${google_cloud_run_v2_job.post_process.name}:run"

    oauth_token {
      service_account_email = google_service_account.ingestion.email
    }
  }
}

# Cloud Scheduler needs permission to invoke Cloud Run Jobs
resource "google_project_iam_member" "scheduler_run_invoker" {
  project = var.gcp_project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.ingestion.email}"
}
