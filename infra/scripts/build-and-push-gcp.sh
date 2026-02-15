#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/../../app"
GCP_REGION="${GCP_REGION:-us-central1}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:?Must set GCP_PROJECT_ID}"
REPO_NAME="${REPO_NAME:-alxderia}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
AR_URL="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$REPO_NAME/$REPO_NAME"

echo "Configuring Docker for Artifact Registry..."
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet

echo "Building Docker image..."
docker build -t "$REPO_NAME:$IMAGE_TAG" "$APP_DIR"

echo "Tagging and pushing..."
docker tag "$REPO_NAME:$IMAGE_TAG" "$AR_URL:$IMAGE_TAG"
docker push "$AR_URL:$IMAGE_TAG"

echo "Done! Image pushed to $AR_URL:$IMAGE_TAG"
