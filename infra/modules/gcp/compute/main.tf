locals {
  labels = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_service_account" "cloud_run" {
  account_id   = "${var.project_name}-run"
  project      = var.gcp_project_id
  display_name = "${var.project_name} Cloud Run Service Account"
}

resource "google_secret_manager_secret_iam_member" "db_credentials" {
  secret_id = var.db_credentials_secret_id
  project   = var.gcp_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "llm_api_key" {
  secret_id = var.llm_api_key_secret_id
  project   = var.gcp_project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_cloud_run_v2_service" "main" {
  name     = var.project_name
  project  = var.gcp_project_id
  location = var.region
  labels   = local.labels

  template {
    service_account = google_service_account.cloud_run.email
    labels          = local.labels

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.image_url

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "PORT"
        value = "3000"
      }

      env {
        name  = "LLM_PROVIDER"
        value = var.llm_provider
      }

      dynamic "env" {
        for_each = var.llm_model != "" ? [var.llm_model] : []
        content {
          name  = "LLM_MODEL"
          value = env.value
        }
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.db_credentials_secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LLM_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.llm_api_key_secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 3000
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 3000
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.db_credentials,
    google_secret_manager_secret_iam_member.llm_api_key,
  ]
}

resource "google_cloud_run_service_iam_member" "public" {
  project  = var.gcp_project_id
  location = var.region
  service  = google_cloud_run_v2_service.main.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
