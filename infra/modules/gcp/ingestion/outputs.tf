output "service_account_email" {
  description = "Email of the ingestion service account"
  value       = google_service_account.ingestion.email
}

output "cloud_run_job_names" {
  description = "Names of the ingestion Cloud Run Jobs"
  value = {
    for k, v in google_cloud_run_v2_job.ingestion : k => v.name
  }
}

output "post_process_job_name" {
  description = "Name of the post-processing Cloud Run Job"
  value       = google_cloud_run_v2_job.post_process.name
}

output "scheduler_job_names" {
  description = "Names of the Cloud Scheduler jobs"
  value = {
    for k, v in google_cloud_scheduler_job.ingestion : k => v.name
  }
}

output "database_url_secret_id" {
  description = "Secret Manager secret ID for DATABASE_URL"
  value       = google_secret_manager_secret.database_url.secret_id
}
