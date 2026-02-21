"""Rebuild resource_access_grants denormalised table.

Uses the same CTE logic as scripts/seed_cloud_resources.py lines 284-391,
but with soft-delete (SET deleted_at) then re-insert to avoid empty results
during rebuild.
"""

from __future__ import annotations

import logging

from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.grants_backfill")


class GrantsBackfill:
    def __init__(self, config: IngestionConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self.tenant_id = config.tenant_id

    def rebuild(self) -> dict[str, int]:
        """Soft-delete existing grants, then re-insert from all provider sources."""
        with self.db.transaction() as cur:
            # Step 1: Soft-delete existing grants
            cur.execute(
                """UPDATE resource_access_grants
                   SET deleted_at = NOW()
                   WHERE tenant_id = %s AND deleted_at IS NULL""",
                (self.tenant_id,),
            )
            deleted = cur.rowcount
            logger.info("Soft-deleted %d existing grants", deleted)

            # Step 2: Re-insert from all provider sources
            cur.execute(self._backfill_sql(), {"tid": self.tenant_id})
            inserted = cur.rowcount
            logger.info("Inserted %d grants from provider sources", inserted)

        return {"deleted": deleted, "inserted": inserted}

    def _backfill_sql(self) -> str:
        return """
WITH
tid AS (SELECT %(tid)s::uuid AS v),

-- AWS: group-level account assignments
aws_grp AS (
  SELECT 'aws' AS provider, 'account' AS resource_type,
    aa.account_id AS resource_id, acct.name AS resource_display_name,
    'group' AS subject_type, aa.principal_id AS subject_provider_id,
    grp.display_name AS subject_display_name, NULL::uuid AS canonical_user_id,
    aa.permission_set_name AS role_or_permission, 'direct' AS access_path,
    NULL::text AS via_group_id, NULL::text AS via_group_display_name
  FROM aws_account_assignments aa
  JOIN aws_accounts acct ON acct.account_id = aa.account_id AND acct.tenant_id = aa.tenant_id
  JOIN aws_identity_center_groups grp ON grp.group_id = aa.principal_id AND grp.tenant_id = aa.tenant_id
  WHERE aa.tenant_id = (SELECT v FROM tid) AND aa.principal_type = 'GROUP' AND aa.deleted_at IS NULL
),

-- AWS: expand groups to member users
aws_usr AS (
  SELECT 'aws' AS provider, 'account' AS resource_type,
    aa.account_id, acct.name, 'user', mem.member_user_id, usr.display_name,
    (SELECT cupl.canonical_user_id FROM canonical_user_provider_links cupl
     WHERE cupl.tenant_id = (SELECT v FROM tid) AND cupl.provider_type = 'AWS_IDENTITY_CENTER'
       AND cupl.provider_user_id = mem.member_user_id LIMIT 1),
    aa.permission_set_name, 'group', aa.principal_id, grp.display_name
  FROM aws_account_assignments aa
  JOIN aws_accounts acct ON acct.account_id = aa.account_id AND acct.tenant_id = aa.tenant_id
  JOIN aws_identity_center_groups grp ON grp.group_id = aa.principal_id AND grp.tenant_id = aa.tenant_id
  JOIN aws_identity_center_memberships mem ON mem.group_id = aa.principal_id AND mem.tenant_id = aa.tenant_id
  JOIN aws_identity_center_users usr ON usr.user_id = mem.member_user_id AND usr.tenant_id = aa.tenant_id
  WHERE aa.tenant_id = (SELECT v FROM tid) AND aa.principal_type = 'GROUP' AND aa.deleted_at IS NULL
),

-- GCP: user bindings
gcp_usr AS (
  SELECT 'gcp', 'project', ib.project_id, proj.display_name,
    'user', ib.member_id, gw.name_full,
    (SELECT cupl.canonical_user_id FROM canonical_user_provider_links cupl
     JOIN google_workspace_users gwu ON gwu.google_id = cupl.provider_user_id AND gwu.tenant_id = cupl.tenant_id
     WHERE cupl.tenant_id = (SELECT v FROM tid) AND cupl.provider_type = 'GOOGLE_WORKSPACE'
       AND gwu.primary_email = ib.member_id LIMIT 1),
    ib.role, 'direct', NULL, NULL
  FROM gcp_project_iam_bindings ib
  JOIN gcp_projects proj ON proj.project_id = ib.project_id AND proj.tenant_id = ib.tenant_id
  LEFT JOIN google_workspace_users gw ON gw.primary_email = ib.member_id AND gw.tenant_id = ib.tenant_id
  WHERE ib.tenant_id = (SELECT v FROM tid) AND ib.member_type = 'user' AND ib.deleted_at IS NULL
),

-- GCP: group bindings
gcp_grp AS (
  SELECT 'gcp', 'project', ib.project_id, proj.display_name,
    'group', ib.member_id, gwg.name, NULL::uuid,
    ib.role, 'direct', NULL, NULL
  FROM gcp_project_iam_bindings ib
  JOIN gcp_projects proj ON proj.project_id = ib.project_id AND proj.tenant_id = ib.tenant_id
  LEFT JOIN google_workspace_groups gwg ON gwg.email = ib.member_id AND gwg.tenant_id = ib.tenant_id
  WHERE ib.tenant_id = (SELECT v FROM tid) AND ib.member_type = 'group' AND ib.deleted_at IS NULL
),

-- GitHub: team repo permissions
gh_team AS (
  SELECT 'github', 'repository', rtp.repo_node_id, repo.full_name,
    'team', rtp.team_node_id, tm.name, NULL::uuid,
    rtp.permission, 'direct', NULL, NULL
  FROM github_repo_team_permissions rtp
  JOIN github_repositories repo ON repo.node_id = rtp.repo_node_id AND repo.tenant_id = rtp.tenant_id
  JOIN github_teams tm ON tm.node_id = rtp.team_node_id AND tm.tenant_id = rtp.tenant_id
  WHERE rtp.tenant_id = (SELECT v FROM tid) AND rtp.deleted_at IS NULL
),

-- GitHub: collaborator repo permissions
gh_collab AS (
  SELECT 'github', 'repository', rcp.repo_node_id, repo.full_name,
    'user', rcp.user_node_id, gu.name,
    (SELECT cupl.canonical_user_id FROM canonical_user_provider_links cupl
     WHERE cupl.tenant_id = (SELECT v FROM tid) AND cupl.provider_type = 'GITHUB'
       AND cupl.provider_user_id = rcp.user_node_id LIMIT 1),
    rcp.permission, 'direct', NULL, NULL
  FROM github_repo_collaborator_permissions rcp
  JOIN github_repositories repo ON repo.node_id = rcp.repo_node_id AND repo.tenant_id = rcp.tenant_id
  JOIN github_users gu ON gu.node_id = rcp.user_node_id AND gu.tenant_id = rcp.tenant_id
  WHERE rcp.tenant_id = (SELECT v FROM tid) AND rcp.deleted_at IS NULL
),

combined AS (
  SELECT * FROM aws_grp UNION ALL SELECT * FROM aws_usr UNION ALL
  SELECT * FROM gcp_usr UNION ALL SELECT * FROM gcp_grp UNION ALL
  SELECT * FROM gh_team UNION ALL SELECT * FROM gh_collab
)
INSERT INTO resource_access_grants
  (tenant_id, provider, resource_type, resource_id, resource_display_name,
   subject_type, subject_provider_id, subject_display_name, canonical_user_id,
   role_or_permission, access_path, via_group_id, via_group_display_name,
   raw_response, last_synced_at)
SELECT DISTINCT ON (provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission)
  (SELECT v FROM tid),
  provider, resource_type, resource_id, resource_display_name,
  subject_type, subject_provider_id, subject_display_name, canonical_user_id,
  role_or_permission, access_path, via_group_id, via_group_display_name,
  '{}'::jsonb, NOW()
FROM combined
ORDER BY provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission
ON CONFLICT (tenant_id, provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission)
DO UPDATE SET
  resource_display_name = EXCLUDED.resource_display_name,
  subject_display_name = EXCLUDED.subject_display_name,
  canonical_user_id = EXCLUDED.canonical_user_id,
  access_path = EXCLUDED.access_path,
  via_group_id = EXCLUDED.via_group_id,
  via_group_display_name = EXCLUDED.via_group_display_name,
  updated_at = NOW(),
  last_synced_at = NOW(),
  deleted_at = NULL
"""
