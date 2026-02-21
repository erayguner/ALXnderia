output "lambda_function_arns" {
  description = "ARNs of the ingestion Lambda functions"
  value = {
    for k, v in aws_lambda_function.ingestion : k => v.arn
  }
}

output "lambda_function_names" {
  description = "Names of the ingestion Lambda functions"
  value = {
    for k, v in aws_lambda_function.ingestion : k => v.function_name
  }
}

output "post_process_lambda_arn" {
  description = "ARN of the post-processing Lambda"
  value       = aws_lambda_function.post_process.arn
}

output "ingestion_role_arn" {
  description = "ARN of the shared Lambda execution role"
  value       = aws_iam_role.ingestion_lambda.arn
}

output "security_group_id" {
  description = "Security group ID for ingestion Lambdas"
  value       = aws_security_group.ingestion_lambda.id
}

output "eventbridge_rule_arns" {
  description = "ARNs of the EventBridge schedule rules"
  value = {
    for k, v in aws_cloudwatch_event_rule.ingestion : k => v.arn
  }
}
