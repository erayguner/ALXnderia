output "db_credentials_secret_id" {
  description = "The ID of the database credentials secret"
  value       = google_secret_manager_secret.db_credentials.secret_id
}

output "llm_api_key_secret_id" {
  description = "The ID of the LLM API key secret"
  value       = google_secret_manager_secret.llm_api_key.secret_id
}
