"""Google Workspace provider: users, groups, memberships via Admin SDK."""

from __future__ import annotations

import json
import logging

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from scripts.ingestion.base_provider import BaseProvider
from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.google_workspace")

SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
]


class GoogleWorkspaceProvider(BaseProvider):
    PROVIDER_NAME = "google_workspace"

    def __init__(self, config: IngestionConfig, db: Database) -> None:
        super().__init__(config, db)
        gw = config.google_workspace
        if not gw:
            raise ValueError("Google Workspace config not set")

        if gw.sa_key_file:
            # Local dev / explicit service account key file
            creds = service_account.Credentials.from_service_account_file(
                gw.sa_key_file, scopes=SCOPES
            )
        else:
            # Cloud Run / Workload Identity: use Application Default Credentials
            import google.auth
            creds, _ = google.auth.default(scopes=SCOPES)

        self._creds = creds.with_subject(gw.admin_email)
        self._customer_id = gw.customer_id
        self._service = build("admin", "directory_v1", credentials=self._creds)

    def sync(self) -> dict[str, int]:
        results: dict[str, int] = {}
        results["users"] = self._sync_users()
        results["groups"] = self._sync_groups()
        results["memberships"] = self._sync_memberships()
        return results

    def _sync_users(self) -> int:
        logger.info("Syncing Google Workspace users")
        all_users: list[dict] = []
        request = self._service.users().list(
            customer=self._customer_id,
            maxResults=500,
            orderBy="email",
            projection="full",
        )
        while request is not None:
            try:
                response = request.execute()
            except HttpError as e:
                if e.resp.status == 429:
                    self._rate_limit_sleep(0)
                    continue
                raise
            all_users.extend(response.get("users", []))
            request = self._service.users().list_next(request, response)

        total = 0
        columns = [
            "tenant_id", "google_id", "primary_email", "name_full",
            "suspended", "archived", "is_admin", "is_delegated_admin",
            "is_enrolled_in_2sv", "is_enforced_in_2sv", "customer_id",
            "suspension_reason", "creation_time", "last_login_time",
            "org_unit_path", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "google_id"]
        update = [
            "primary_email", "name_full", "suspended", "archived",
            "is_admin", "is_delegated_admin", "is_enrolled_in_2sv",
            "is_enforced_in_2sv", "customer_id", "suspension_reason",
            "creation_time", "last_login_time", "org_unit_path", "raw_response",
        ]

        for batch in self._batch_rows(all_users):
            rows = []
            for u in batch:
                name = u.get("name", {})
                rows.append((
                    self.tenant_id,
                    u["id"],
                    u["primaryEmail"],
                    name.get("fullName"),
                    u.get("suspended", False),
                    u.get("archived", False),
                    u.get("isAdmin", False),
                    u.get("isDelegatedAdmin", False),
                    u.get("isEnrolledIn2Sv", False),
                    u.get("isEnforcedIn2Sv", False),
                    u.get("customerId"),
                    u.get("suspensionReason"),
                    u.get("creationTime"),
                    u.get("lastLoginTime"),
                    u.get("orgUnitPath"),
                    json.dumps(u),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "google_workspace_users", columns, rows, conflict, update
                )
        logger.info("Synced %d Google Workspace users", total)
        return total

    def _sync_groups(self) -> int:
        logger.info("Syncing Google Workspace groups")
        all_groups: list[dict] = []
        request = self._service.groups().list(
            customer=self._customer_id, maxResults=200
        )
        while request is not None:
            try:
                response = request.execute()
            except HttpError as e:
                if e.resp.status == 429:
                    self._rate_limit_sleep(0)
                    continue
                raise
            all_groups.extend(response.get("groups", []))
            request = self._service.groups().list_next(request, response)

        total = 0
        columns = [
            "tenant_id", "google_id", "email", "name", "description",
            "admin_created", "direct_members_count", "raw_response",
            "last_synced_at",
        ]
        conflict = ["tenant_id", "google_id"]
        update = [
            "email", "name", "description", "admin_created",
            "direct_members_count", "raw_response",
        ]

        for batch in self._batch_rows(all_groups):
            rows = []
            for g in batch:
                rows.append((
                    self.tenant_id,
                    g["id"],
                    g["email"],
                    g.get("name"),
                    g.get("description"),
                    g.get("adminCreated", True),
                    g.get("directMembersCount"),
                    json.dumps(g),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "google_workspace_groups", columns, rows, conflict, update
                )
        logger.info("Synced %d Google Workspace groups", total)
        return total

    def _sync_memberships(self) -> int:
        logger.info("Syncing Google Workspace memberships")
        # Fetch all group IDs first
        with self.db.transaction() as cur:
            cur.execute(
                "SELECT google_id FROM google_workspace_groups WHERE tenant_id = %s AND deleted_at IS NULL",
                (self.tenant_id,),
            )
            group_ids = [row[0] for row in cur.fetchall()]

        total = 0
        columns = [
            "tenant_id", "group_id", "member_id", "member_type",
            "member_email", "role", "status", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "group_id", "member_id"]
        update = [
            "member_type", "member_email", "role", "status", "raw_response",
        ]

        for gid in group_ids:
            members: list[dict] = []
            request = self._service.members().list(groupKey=gid, maxResults=200)
            while request is not None:
                try:
                    response = request.execute()
                except HttpError as e:
                    if e.resp.status == 429:
                        self._rate_limit_sleep(0)
                        continue
                    if e.resp.status == 404:
                        break
                    raise
                members.extend(response.get("members", []))
                request = self._service.members().list_next(request, response)

            for batch in self._batch_rows(members):
                rows = []
                for m in batch:
                    rows.append((
                        self.tenant_id,
                        gid,
                        m["id"],
                        m.get("type", "USER"),
                        m.get("email"),
                        m.get("role", "MEMBER"),
                        m.get("status", "ACTIVE"),
                        json.dumps(m),
                        "NOW()",
                    ))
                with self.db.transaction() as cur:
                    total += self.db.upsert_batch(
                        cur, "google_workspace_memberships", columns, rows,
                        conflict, update,
                    )
        logger.info("Synced %d Google Workspace memberships", total)
        return total
