"""Cloud-native secret resolution.

Resolves secrets from AWS Secrets Manager or GCP Secret Manager based on
the runtime environment, falling back to environment variables for local
development.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger("ingestion.secrets")

# Prefixes that indicate a cloud secret reference
_AWS_PREFIX = "aws-secret://"
_GCP_PREFIX = "gcp-secret://"


def resolve_secret(value: str) -> str:
    """Resolve a secret reference to its plaintext value.

    Supported formats:
      - "aws-secret://secret-name"         -> AWS Secrets Manager
      - "aws-secret://secret-name#key"     -> AWS Secrets Manager (JSON key)
      - "gcp-secret://project/secret/ver"  -> GCP Secret Manager
      - anything else                      -> returned as-is (env var / literal)
    """
    if value.startswith(_AWS_PREFIX):
        return _resolve_aws_secret(value[len(_AWS_PREFIX):])
    if value.startswith(_GCP_PREFIX):
        return _resolve_gcp_secret(value[len(_GCP_PREFIX):])
    return value


def _resolve_aws_secret(ref: str) -> str:
    """Fetch a secret from AWS Secrets Manager.

    ref format: "secret-name" or "secret-name#json_key"
    """
    import boto3

    parts = ref.split("#", 1)
    secret_name = parts[0]
    json_key = parts[1] if len(parts) > 1 else None

    region = os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client("secretsmanager", region_name=region)

    resp = client.get_secret_value(SecretId=secret_name)
    secret_string = resp["SecretString"]

    if json_key:
        data = json.loads(secret_string)
        return str(data[json_key])
    return secret_string


def _resolve_gcp_secret(ref: str) -> str:
    """Fetch a secret from GCP Secret Manager.

    ref format: "projects/PROJECT/secrets/NAME/versions/VERSION"
             or "NAME" (auto-resolves project from metadata + latest version)
    """
    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()

    if ref.startswith("projects/"):
        name = ref
    else:
        project = os.environ.get("GCP_PROJECT_ID", "")
        if not project:
            # Attempt to fetch from metadata server
            project = _gcp_project_from_metadata()
        name = f"projects/{project}/secrets/{ref}/versions/latest"

    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("UTF-8")


def _gcp_project_from_metadata() -> str:
    """Fetch GCP project ID from the metadata server (available in Cloud Run/GCE)."""
    import requests
    try:
        resp = requests.get(
            "http://metadata.google.internal/computeMetadata/v1/project/project-id",
            headers={"Metadata-Flavor": "Google"},
            timeout=2,
        )
        resp.raise_for_status()
        return resp.text
    except Exception:
        raise RuntimeError(
            "Cannot determine GCP project ID. Set GCP_PROJECT_ID env var."
        )


def resolve_database_url() -> str:
    """Resolve DATABASE_URL from env, with cloud secret support."""
    url = os.environ.get("DATABASE_URL", "")
    if url:
        return resolve_secret(url)

    # Fall back to PG_* variables
    host = os.environ.get("PG_HOST", "localhost")
    port = os.environ.get("PG_PORT", "5432")
    user = os.environ.get("PG_USER", "cloudintel")
    password = os.environ.get("PG_PASSWORD", "localdev-change-me")
    database = os.environ.get("PG_DATABASE", "cloud_identity_intel")

    # Password might be a secret reference
    password = resolve_secret(password)

    return f"postgresql://{user}:{password}@{host}:{port}/{database}"
