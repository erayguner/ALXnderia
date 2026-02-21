"""AWS Organizations provider: accounts."""

from __future__ import annotations

import json
import logging

import boto3

from scripts.ingestion.base_provider import BaseProvider
from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.aws_organizations")


class AwsOrganizationsProvider(BaseProvider):
    PROVIDER_NAME = "aws_organizations"

    def __init__(self, config: IngestionConfig, db: Database) -> None:
        super().__init__(config, db)
        aws_orgs = config.aws_organizations
        if not aws_orgs:
            raise ValueError("AWS Organizations config not set")
        self._client = boto3.client("organizations", region_name=aws_orgs.region)

    def sync(self) -> dict[str, int]:
        return {"accounts": self._sync_accounts()}

    def _sync_accounts(self) -> int:
        logger.info("Syncing AWS Organization accounts")

        # Get organization info
        try:
            org_resp = self._client.describe_organization()
            org_id = org_resp["Organization"]["Id"]
        except Exception:
            org_id = None

        # List all accounts
        all_accounts: list[dict] = []
        paginator = self._client.get_paginator("list_accounts")
        for page in paginator.paginate():
            all_accounts.extend(page.get("Accounts", []))

        # Resolve parent for each account
        for acct in all_accounts:
            acct["_org_id"] = org_id
            try:
                parents = self._client.list_parents(ChildId=acct["Id"])
                parent_list = parents.get("Parents", [])
                acct["_parent_id"] = parent_list[0]["Id"] if parent_list else None
            except Exception:
                acct["_parent_id"] = None

        total = 0
        columns = [
            "tenant_id", "account_id", "name", "email", "status",
            "joined_method", "joined_at", "org_id", "parent_id",
            "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "account_id"]
        update = [
            "name", "email", "status", "joined_method", "joined_at",
            "org_id", "parent_id", "raw_response",
        ]

        for batch in self._batch_rows(all_accounts):
            rows = []
            for a in batch:
                joined_at = a.get("JoinedTimestamp")
                if joined_at:
                    joined_at = joined_at.isoformat() if hasattr(joined_at, "isoformat") else str(joined_at)
                rows.append((
                    self.tenant_id,
                    a["Id"],
                    a.get("Name", ""),
                    a.get("Email"),
                    a.get("Status", "ACTIVE"),
                    a.get("JoinedMethod"),
                    joined_at,
                    a.get("_org_id"),
                    a.get("_parent_id"),
                    json.dumps(a, default=str),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "aws_accounts", columns, rows, conflict, update
                )
        logger.info("Synced %d AWS accounts", total)
        return total
