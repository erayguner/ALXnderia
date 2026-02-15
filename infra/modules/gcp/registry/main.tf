locals {
  labels = {
    project     = var.project_name
    environment = "shared"
    managed_by  = "terraform"
  }
}

resource "google_artifact_registry_repository" "main" {
  location      = var.region
  project       = var.gcp_project_id
  repository_id = var.repository_name
  format        = "DOCKER"
  labels        = local.labels

  cleanup_policies {
    id     = "keep-last-10"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }
}
