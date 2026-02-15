output "db_credentials_secret_arn" {
  description = "ARN of the database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "llm_api_key_secret_arn" {
  description = "ARN of the LLM API key secret"
  value       = aws_secretsmanager_secret.llm_api_key.arn
}

output "all_secret_arns" {
  description = "List of all secret ARNs"
  value = [
    aws_secretsmanager_secret.db_credentials.arn,
    aws_secretsmanager_secret.llm_api_key.arn,
  ]
}
