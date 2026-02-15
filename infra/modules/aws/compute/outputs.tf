output "service_url" {
  description = "URL of the App Runner service"
  value       = aws_apprunner_service.main.service_url
}

output "service_arn" {
  description = "ARN of the App Runner service"
  value       = aws_apprunner_service.main.arn
}

output "app_security_group_id" {
  description = "ID of the App Runner VPC connector security group"
  value       = aws_security_group.vpc_connector.id
}
