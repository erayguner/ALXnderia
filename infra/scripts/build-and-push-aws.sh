#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/../../app"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?Must set AWS_ACCOUNT_ID}"
REPO_NAME="${REPO_NAME:-alxderia}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ECR_URL="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME"

echo "Building Docker image..."
docker build -t "$REPO_NAME:$IMAGE_TAG" "$APP_DIR"

echo "Logging into ECR..."
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

echo "Tagging and pushing..."
docker tag "$REPO_NAME:$IMAGE_TAG" "$ECR_URL:$IMAGE_TAG"
docker push "$ECR_URL:$IMAGE_TAG"

echo "Done! Image pushed to $ECR_URL:$IMAGE_TAG"
