"""Configuration via environment variables with cloud-native secret support.

Supports:
  - Environment variables (local dev)
  - AWS Secrets Manager (aws-secret://name#key)
  - GCP Secret Manager (gcp-secret://name)
  - Workload Identity / IAM roles (no key files needed in cloud)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

from dotenv import load_dotenv

from scripts.ingestion.secrets import resolve_database_url, resolve_secret


@dataclass(frozen=True)
class DatabaseConfig:
    url: str
    min_connections: int = 2
    max_connections: int = 10


@dataclass(frozen=True)
class GoogleWorkspaceConfig:
    admin_email: str
    customer_id: str
    sa_key_file: Optional[str] = None  # None = use Workload Identity / ADC


@dataclass(frozen=True)
class AwsIdentityCenterConfig:
    identity_store_id: str
    sso_instance_arn: str
    region: str = "us-east-1"
    # No explicit creds -- uses IAM role attached to Lambda/ECS


@dataclass(frozen=True)
class AwsOrganizationsConfig:
    region: str = "us-east-1"


@dataclass(frozen=True)
class GitHubConfig:
    token: str
    org_logins: list[str] = field(default_factory=list)
    api_base_url: str = "https://api.github.com"


@dataclass(frozen=True)
class GcpConfig:
    org_id: str
    sa_key_file: Optional[str] = None  # None = use Workload Identity / ADC


@dataclass(frozen=True)
class SchedulerConfig:
    google_workspace_interval_min: int = 60
    aws_identity_center_interval_min: int = 60
    github_interval_min: int = 30
    aws_organizations_interval_hours: int = 6
    gcp_resource_manager_interval_hours: int = 2
    post_process_interval_min: int = 15
    misfire_grace_time: int = 300
    max_retries: int = 3


@dataclass(frozen=True)
class IngestionConfig:
    tenant_id: str
    database: DatabaseConfig
    scheduler: SchedulerConfig = field(default_factory=SchedulerConfig)
    google_workspace: Optional[GoogleWorkspaceConfig] = None
    aws_identity_center: Optional[AwsIdentityCenterConfig] = None
    aws_organizations: Optional[AwsOrganizationsConfig] = None
    github: Optional[GitHubConfig] = None
    gcp: Optional[GcpConfig] = None
    batch_size: int = 500


def load_config() -> IngestionConfig:
    """Load configuration from environment variables. Unconfigured providers are skipped.

    In cloud environments, secrets are resolved via AWS Secrets Manager or
    GCP Secret Manager. Locally, plain env vars or .env files are used.
    """
    load_dotenv()

    tenant_id = os.environ.get("TENANT_ID", "")
    if not tenant_id:
        raise ValueError("TENANT_ID environment variable is required")

    db_url = resolve_database_url()

    database = DatabaseConfig(
        url=db_url,
        min_connections=int(os.environ.get("DB_MIN_CONNECTIONS", "2")),
        max_connections=int(os.environ.get("DB_MAX_CONNECTIONS", "10")),
    )

    # Google Workspace (optional)
    # In GCP Cloud Run: sa_key_file=None -> uses Workload Identity / ADC
    google_workspace = None
    gw_admin = os.environ.get("GOOGLE_ADMIN_EMAIL")
    gw_customer = os.environ.get("GOOGLE_CUSTOMER_ID")
    if gw_admin and gw_customer:
        google_workspace = GoogleWorkspaceConfig(
            admin_email=gw_admin,
            customer_id=gw_customer,
            sa_key_file=os.environ.get("GOOGLE_SA_KEY_FILE"),  # optional
        )

    # AWS Identity Center (optional)
    # In AWS Lambda/ECS: IAM role provides credentials automatically
    aws_idc = None
    idc_store = os.environ.get("AWS_IDENTITY_STORE_ID")
    idc_arn = os.environ.get("AWS_SSO_INSTANCE_ARN")
    if idc_store and idc_arn:
        aws_idc = AwsIdentityCenterConfig(
            identity_store_id=idc_store,
            sso_instance_arn=idc_arn,
            region=os.environ.get("AWS_REGION", "us-east-1"),
        )

    # AWS Organizations (optional)
    # Enabled when explicit creds, IAM role, or config flag is present
    aws_orgs = None
    if (
        os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_PROFILE")
        or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")  # running in Lambda
        or os.environ.get("AWS_ORGANIZATIONS_ENABLED", "").lower() == "true"
    ):
        aws_orgs = AwsOrganizationsConfig(
            region=os.environ.get("AWS_REGION", "us-east-1"),
        )

    # GitHub (optional) -- token may come from a secret manager
    github = None
    gh_token_raw = os.environ.get("GITHUB_TOKEN", "")
    if gh_token_raw:
        gh_token = resolve_secret(gh_token_raw)
        logins_raw = os.environ.get("GITHUB_ORG_LOGINS", "")
        logins = [s.strip() for s in logins_raw.split(",") if s.strip()]
        github = GitHubConfig(
            token=gh_token,
            org_logins=logins,
            api_base_url=os.environ.get("GITHUB_API_BASE_URL", "https://api.github.com"),
        )

    # GCP (optional)
    # In GCP Cloud Run: sa_key_file=None -> uses Workload Identity / ADC
    gcp = None
    gcp_org = os.environ.get("GCP_ORG_ID")
    if gcp_org:
        gcp = GcpConfig(
            org_id=gcp_org,
            sa_key_file=os.environ.get("GCP_SA_KEY_FILE"),  # optional
        )

    return IngestionConfig(
        tenant_id=tenant_id,
        database=database,
        google_workspace=google_workspace,
        aws_identity_center=aws_idc,
        aws_organizations=aws_orgs,
        github=github,
        gcp=gcp,
        batch_size=int(os.environ.get("INGESTION_BATCH_SIZE", "500")),
    )
