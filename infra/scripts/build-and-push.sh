#!/usr/bin/env bash
set -euo pipefail

# Unified build-and-push script for ALXnderia containers
# Usage: ./build-and-push.sh --platform aws|gcp --target app|ingestion
#
# Environment variables:
#   AWS: AWS_ACCOUNT_ID (required), AWS_REGION (default: us-east-1)
#   GCP: GCP_PROJECT_ID (required), GCP_REGION (default: us-central1)
#   IMAGE_TAG (default: latest)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PLATFORM=""
TARGET=""
IMAGE_TAG="${IMAGE_TAG:-latest}"

usage() {
  echo "Usage: $0 --platform aws|gcp --target app|ingestion"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --target)   TARGET="$2";   shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$PLATFORM" || -z "$TARGET" ]] && usage
[[ "$PLATFORM" != "aws" && "$PLATFORM" != "gcp" ]] && usage
[[ "$TARGET" != "app" && "$TARGET" != "ingestion" ]] && usage

# --- Resolve build context and Dockerfile ---
if [[ "$TARGET" == "app" ]]; then
  BUILD_CONTEXT="$PROJECT_ROOT/app"
  DOCKER_FILE_ARGS=()
else
  BUILD_CONTEXT="$PROJECT_ROOT"
  DOCKER_FILE_ARGS=(-f "$PROJECT_ROOT/scripts/ingestion/Dockerfile")
fi

# --- Resolve registry URL and auth ---
if [[ "$PLATFORM" == "aws" ]]; then
  : "${AWS_ACCOUNT_ID:?Must set AWS_ACCOUNT_ID}"
  AWS_REGION="${AWS_REGION:-us-east-1}"

  if [[ "$TARGET" == "app" ]]; then
    REPO_NAME="${REPO_NAME:-alxderia}"
  else
    REPO_NAME="alxderia/ingestion"
  fi

  REGISTRY_URL="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"

  echo "Authenticating with ECR..."
  aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

else
  : "${GCP_PROJECT_ID:?Must set GCP_PROJECT_ID}"
  GCP_REGION="${GCP_REGION:-us-central1}"
  REPO_NAME="${REPO_NAME:-alxderia}"

  if [[ "$TARGET" == "app" ]]; then
    IMAGE_NAME="$REPO_NAME"
  else
    IMAGE_NAME="alxderia-ingestion"
  fi

  REGISTRY_URL="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}"

  echo "Configuring Docker for Artifact Registry..."
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
fi

# --- Build, tag, push ---
echo "Building ${TARGET} image..."
docker build "${DOCKER_FILE_ARGS[@]}" -t "${REGISTRY_URL}:${IMAGE_TAG}" "$BUILD_CONTEXT"

echo "Pushing ${REGISTRY_URL}:${IMAGE_TAG}..."
docker push "${REGISTRY_URL}:${IMAGE_TAG}"

echo "Done! Image pushed to ${REGISTRY_URL}:${IMAGE_TAG}"
