"""ALXnderia identity ingestion system.

Connects to provider APIs (Google Workspace, AWS IAM Identity Center,
GitHub, AWS Organizations, GCP Resource Manager), retrieves data with
pagination and rate limiting, and upserts into the PostgreSQL schema.
"""
