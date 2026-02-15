terraform {
  backend "gcs" {
    bucket = "alxderia-terraform-state"
    prefix = "deploy/gcp"
  }
}
