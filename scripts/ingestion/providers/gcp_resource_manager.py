"""GCP Cloud Resource Manager provider: organizations, projects, IAM bindings."""

from __future__ import annotations

import json
import logging

from google.cloud import resourcemanager_v3
from google.iam.v1 import iam_policy_pb2
from google.oauth2 import service_account

from scripts.ingestion.base_provider import BaseProvider
from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.gcp_resource_manager")


class GcpResourceManagerProvider(BaseProvider):
    PROVIDER_NAME = "gcp_resource_manager"

    def __init__(self, config: IngestionConfig, db: Database) -> None:
        super().__init__(config, db)
        gcp = config.gcp
        if not gcp:
            raise ValueError("GCP config not set")
        self._org_id = gcp.org_id

        if gcp.sa_key_file:
            # Local dev / explicit service account key file
            creds = service_account.Credentials.from_service_account_file(
                gcp.sa_key_file
            )
        else:
            # Cloud Run / Workload Identity: use Application Default Credentials
            creds = None  # Client libraries auto-discover ADC when creds=None

        self._org_client = resourcemanager_v3.OrganizationsClient(credentials=creds)
        self._proj_client = resourcemanager_v3.ProjectsClient(credentials=creds)

    def sync(self) -> dict[str, int]:
        results: dict[str, int] = {}
        results["organisations"] = self._sync_org()
        results["projects"] = self._sync_projects()
        results["iam_bindings"] = self._sync_iam_bindings()
        return results

    def _sync_org(self) -> int:
        logger.info("Syncing GCP organisation")
        org_name = self._org_id
        if not org_name.startswith("organizations/"):
            org_name = f"organizations/{org_name}"

        try:
            org = self._org_client.get_organization(name=org_name)
        except Exception:
            logger.warning("Could not fetch org %s, trying search", org_name)
            orgs = list(self._org_client.search_organizations())
            if not orgs:
                return 0
            org = orgs[0]

        columns = [
            "tenant_id", "org_id", "display_name", "domain",
            "lifecycle_state", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "org_id"]
        update = ["display_name", "domain", "lifecycle_state", "raw_response"]

        raw = {
            "name": org.name,
            "displayName": org.display_name,
            "state": org.state.name if org.state else "ACTIVE",
        }
        rows = [(
            self.tenant_id,
            org.name,
            org.display_name,
            getattr(org, "directory_customer_id", None),
            org.state.name if org.state else "ACTIVE",
            json.dumps(raw),
            "NOW()",
        )]

        with self.db.transaction() as cur:
            return self.db.upsert_batch(
                cur, "gcp_organisations", columns, rows, conflict, update
            )

    def _sync_projects(self) -> int:
        logger.info("Syncing GCP projects")
        org_name = self._org_id
        if not org_name.startswith("organizations/"):
            org_name = f"organizations/{org_name}"

        all_projects: list = []
        request = resourcemanager_v3.SearchProjectsRequest(
            query=f"parent:{org_name}"
        )
        for project in self._proj_client.search_projects(request=request):
            all_projects.append(project)

        total = 0
        columns = [
            "tenant_id", "project_id", "project_number", "display_name",
            "lifecycle_state", "org_id", "folder_id", "labels",
            "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "project_id"]
        update = [
            "project_number", "display_name", "lifecycle_state",
            "org_id", "folder_id", "labels", "raw_response",
        ]

        for batch in self._batch_rows(all_projects):
            rows = []
            for p in batch:
                parent = p.parent or ""
                org_id_val = parent if parent.startswith("organizations/") else None
                folder_id_val = parent if parent.startswith("folders/") else None
                labels = dict(p.labels) if p.labels else {}

                raw = {
                    "projectId": p.project_id,
                    "name": p.name,
                    "displayName": p.display_name,
                    "state": p.state.name if p.state else "ACTIVE",
                    "parent": parent,
                }
                rows.append((
                    self.tenant_id,
                    p.project_id,
                    p.name.split("/")[-1] if p.name else "",
                    p.display_name,
                    p.state.name if p.state else "ACTIVE",
                    org_id_val,
                    folder_id_val,
                    json.dumps(labels),
                    json.dumps(raw),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "gcp_projects", columns, rows, conflict, update
                )
        logger.info("Synced %d GCP projects", total)
        return total

    def _sync_iam_bindings(self) -> int:
        logger.info("Syncing GCP project IAM bindings")
        # Get all project IDs
        with self.db.transaction() as cur:
            cur.execute(
                """SELECT project_id FROM gcp_projects
                   WHERE tenant_id = %s AND lifecycle_state = 'ACTIVE' AND deleted_at IS NULL""",
                (self.tenant_id,),
            )
            project_ids = [row[0] for row in cur.fetchall()]

        total = 0
        columns = [
            "tenant_id", "project_id", "role", "member_type",
            "member_id", "condition_expression", "condition_title",
            "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "project_id", "role", "member_type", "member_id"]
        update = [
            "condition_expression", "condition_title", "raw_response",
        ]

        for pid in project_ids:
            try:
                request = iam_policy_pb2.GetIamPolicyRequest(
                    resource=f"projects/{pid}"
                )
                policy = self._proj_client.get_iam_policy(request=request)
            except Exception as e:
                logger.warning("Could not get IAM policy for project %s: %s", pid, e)
                continue

            bindings_rows: list[tuple] = []
            for binding in policy.bindings:
                role = binding.role
                condition = binding.condition if binding.condition else None
                cond_expr = condition.expression if condition else None
                cond_title = condition.title if condition else None

                for member in binding.members:
                    # Parse member type prefix
                    if ":" in member:
                        member_type, member_id = member.split(":", 1)
                    else:
                        member_type = member
                        member_id = member

                    raw = {"role": role, "member": member}
                    bindings_rows.append((
                        self.tenant_id,
                        pid,
                        role,
                        member_type,
                        member_id,
                        cond_expr,
                        cond_title,
                        json.dumps(raw),
                        "NOW()",
                    ))

            for batch in self._batch_rows(bindings_rows):
                with self.db.transaction() as cur:
                    total += self.db.upsert_batch(
                        cur, "gcp_project_iam_bindings", columns, batch,
                        conflict, update,
                    )
        logger.info("Synced %d GCP IAM bindings", total)
        return total
