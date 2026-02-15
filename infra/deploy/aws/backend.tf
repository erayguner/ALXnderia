terraform {
  backend "s3" {
    bucket         = "alxderia-terraform-state"
    key            = "deploy/aws/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "alxderia-terraform-locks"
    encrypt        = true
  }
}
