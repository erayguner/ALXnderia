"""AWS IAM Identity Center provider: users, groups, memberships, account assignments."""

from __future__ import annotations

import json
import logging

import boto3

from scripts.ingestion.base_provider import BaseProvider
from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.aws_identity_center")


class AwsIdentityCenterProvider(BaseProvider):
    PROVIDER_NAME = "aws_identity_center"

    def __init__(self, config: IngestionConfig, db: Database) -> None:
        super().__init__(config, db)
        idc = config.aws_identity_center
        if not idc:
            raise ValueError("AWS Identity Center config not set")
        self._identity_store_id = idc.identity_store_id
        self._sso_instance_arn = idc.sso_instance_arn
        self._ids_client = boto3.client("identitystore", region_name=idc.region)
        self._sso_client = boto3.client("sso-admin", region_name=idc.region)

    def sync(self) -> dict[str, int]:
        results: dict[str, int] = {}
        results["users"] = self._sync_users()
        results["groups"] = self._sync_groups()
        results["memberships"] = self._sync_memberships()
        results["account_assignments"] = self._sync_account_assignments()
        return results

    def _paginate(self, client, method: str, key: str, **kwargs) -> list[dict]:
        """Generic paginator for boto3 APIs."""
        items: list[dict] = []
        paginator = client.get_paginator(method)
        for page in paginator.paginate(**kwargs):
            items.extend(page.get(key, []))
        return items

    def _sync_users(self) -> int:
        logger.info("Syncing AWS Identity Center users")
        all_users = self._paginate(
            self._ids_client, "list_users", "Users",
            IdentityStoreId=self._identity_store_id,
        )

        total = 0
        columns = [
            "tenant_id", "identity_store_id", "user_id", "user_name",
            "display_name", "active", "user_status", "email",
            "given_name", "family_name", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "identity_store_id", "user_id"]
        update = [
            "user_name", "display_name", "active", "user_status",
            "email", "given_name", "family_name", "raw_response",
        ]

        for batch in self._batch_rows(all_users):
            rows = []
            for u in batch:
                emails = u.get("Emails", [])
                primary_email = None
                for e in emails:
                    if e.get("Primary"):
                        primary_email = e.get("Value")
                        break
                if not primary_email and emails:
                    primary_email = emails[0].get("Value")

                name = u.get("Name", {})
                rows.append((
                    self.tenant_id,
                    self._identity_store_id,
                    u["UserId"],
                    u.get("UserName", ""),
                    u.get("DisplayName"),
                    u.get("Active", True),
                    u.get("UserStatus"),
                    primary_email,
                    name.get("GivenName"),
                    name.get("FamilyName"),
                    json.dumps(u, default=str),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "aws_identity_center_users", columns, rows, conflict, update
                )
        logger.info("Synced %d AWS Identity Center users", total)
        return total

    def _sync_groups(self) -> int:
        logger.info("Syncing AWS Identity Center groups")
        all_groups = self._paginate(
            self._ids_client, "list_groups", "Groups",
            IdentityStoreId=self._identity_store_id,
        )

        total = 0
        columns = [
            "tenant_id", "identity_store_id", "group_id", "display_name",
            "description", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "identity_store_id", "group_id"]
        update = ["display_name", "description", "raw_response"]

        for batch in self._batch_rows(all_groups):
            rows = []
            for g in batch:
                rows.append((
                    self.tenant_id,
                    self._identity_store_id,
                    g["GroupId"],
                    g.get("DisplayName", ""),
                    g.get("Description"),
                    json.dumps(g, default=str),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "aws_identity_center_groups", columns, rows, conflict, update
                )
        logger.info("Synced %d AWS Identity Center groups", total)
        return total

    def _sync_memberships(self) -> int:
        logger.info("Syncing AWS Identity Center memberships")
        # Get all group IDs
        with self.db.transaction() as cur:
            cur.execute(
                """SELECT group_id FROM aws_identity_center_groups
                   WHERE tenant_id = %s AND identity_store_id = %s AND deleted_at IS NULL""",
                (self.tenant_id, self._identity_store_id),
            )
            group_ids = [row[0] for row in cur.fetchall()]

        total = 0
        columns = [
            "tenant_id", "membership_id", "identity_store_id",
            "group_id", "member_user_id", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "identity_store_id", "membership_id"]
        update = ["group_id", "member_user_id", "raw_response"]

        for gid in group_ids:
            members = self._paginate(
                self._ids_client, "list_group_memberships", "GroupMemberships",
                IdentityStoreId=self._identity_store_id,
                GroupId=gid,
            )
            for batch in self._batch_rows(members):
                rows = []
                for m in batch:
                    member_id_obj = m.get("MemberId", {})
                    user_id = member_id_obj.get("UserId", "")
                    rows.append((
                        self.tenant_id,
                        m["MembershipId"],
                        self._identity_store_id,
                        gid,
                        user_id,
                        json.dumps(m, default=str),
                        "NOW()",
                    ))
                with self.db.transaction() as cur:
                    total += self.db.upsert_batch(
                        cur, "aws_identity_center_memberships", columns, rows,
                        conflict, update,
                    )
        logger.info("Synced %d AWS Identity Center memberships", total)
        return total

    def _sync_account_assignments(self) -> int:
        logger.info("Syncing AWS account assignments")
        # Get permission sets
        ps_arns: list[str] = []
        paginator = self._sso_client.get_paginator("list_permission_sets")
        for page in paginator.paginate(InstanceArn=self._sso_instance_arn):
            ps_arns.extend(page.get("PermissionSets", []))

        # Resolve permission set names
        ps_names: dict[str, str] = {}
        for arn in ps_arns:
            try:
                desc = self._sso_client.describe_permission_set(
                    InstanceArn=self._sso_instance_arn,
                    PermissionSetArn=arn,
                )
                ps_names[arn] = desc["PermissionSet"].get("Name", arn)
            except Exception:
                ps_names[arn] = arn

        # Get provisioned accounts per permission set
        total = 0
        columns = [
            "tenant_id", "identity_store_id", "account_id",
            "permission_set_arn", "permission_set_name",
            "principal_type", "principal_id", "raw_response", "last_synced_at",
        ]
        conflict = [
            "tenant_id", "account_id", "permission_set_arn",
            "principal_type", "principal_id",
        ]
        update = [
            "identity_store_id", "permission_set_name", "raw_response",
        ]

        for ps_arn in ps_arns:
            # List accounts provisioned to this permission set
            acct_paginator = self._sso_client.get_paginator(
                "list_accounts_for_provisioned_permission_set"
            )
            account_ids: list[str] = []
            for page in acct_paginator.paginate(
                InstanceArn=self._sso_instance_arn,
                PermissionSetArn=ps_arn,
            ):
                account_ids.extend(page.get("AccountIds", []))

            for account_id in account_ids:
                assignments = self._paginate(
                    self._sso_client,
                    "list_account_assignments",
                    "AccountAssignments",
                    InstanceArn=self._sso_instance_arn,
                    AccountId=account_id,
                    PermissionSetArn=ps_arn,
                )
                for batch in self._batch_rows(assignments):
                    rows = []
                    for a in batch:
                        rows.append((
                            self.tenant_id,
                            self._identity_store_id,
                            a["AccountId"],
                            a["PermissionSetArn"],
                            ps_names.get(a["PermissionSetArn"], ""),
                            a["PrincipalType"],
                            a["PrincipalId"],
                            json.dumps(a, default=str),
                            "NOW()",
                        ))
                    with self.db.transaction() as cur:
                        total += self.db.upsert_batch(
                            cur, "aws_account_assignments", columns, rows,
                            conflict, update,
                        )
        logger.info("Synced %d AWS account assignments", total)
        return total
