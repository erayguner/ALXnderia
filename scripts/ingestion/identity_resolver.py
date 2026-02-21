"""Cross-provider canonical identity resolution.

Matches provider users to canonical_users via email. Follows the exact
patterns from schema/99-seed/010_mock_data.sql lines 630-734.
"""

from __future__ import annotations

import logging

from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.identity_resolver")


class IdentityResolver:
    def __init__(self, config: IngestionConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self.tenant_id = config.tenant_id

    def resolve(self) -> dict[str, int]:
        """Run identity resolution across all providers. Returns counts per step."""
        results: dict[str, int] = {}
        results["google_workspace_links"] = self._resolve_google_workspace()
        results["aws_identity_center_links"] = self._resolve_aws_identity_center()
        results["github_links"] = self._resolve_github()
        results["reconciliation_queue"] = self._queue_unresolvable()
        return results

    def _resolve_google_workspace(self) -> int:
        """Link Google Workspace users to canonical users via email match."""
        sql = """
        WITH provider_users AS (
            SELECT google_id AS provider_user_id, primary_email
            FROM google_workspace_users
            WHERE tenant_id = %(tid)s AND deleted_at IS NULL
        ),
        existing_links AS (
            SELECT provider_user_id
            FROM canonical_user_provider_links
            WHERE tenant_id = %(tid)s AND provider_type = 'GOOGLE_WORKSPACE'
        ),
        new_matches AS (
            SELECT
                pu.provider_user_id,
                pu.primary_email,
                ce.canonical_user_id
            FROM provider_users pu
            JOIN canonical_emails ce ON ce.email = pu.primary_email AND ce.tenant_id = %(tid)s
            WHERE pu.provider_user_id NOT IN (SELECT provider_user_id FROM existing_links)
        )
        INSERT INTO canonical_user_provider_links
            (tenant_id, canonical_user_id, provider_type, provider_user_id,
             confidence_score, match_method)
        SELECT
            %(tid)s,
            nm.canonical_user_id,
            'GOOGLE_WORKSPACE',
            nm.provider_user_id,
            100,
            'email_exact'
        FROM new_matches nm
        ON CONFLICT (tenant_id, provider_type, provider_user_id)
        DO UPDATE SET
            canonical_user_id = EXCLUDED.canonical_user_id,
            confidence_score = EXCLUDED.confidence_score,
            match_method = EXCLUDED.match_method,
            updated_at = NOW()
        """
        with self.db.transaction() as cur:
            cur.execute(sql, {"tid": self.tenant_id})
            count = cur.rowcount
        logger.info("Resolved %d Google Workspace identity links", count)
        return count

    def _resolve_aws_identity_center(self) -> int:
        """Link AWS Identity Center users to canonical users via email match."""
        sql = """
        WITH provider_users AS (
            SELECT user_id AS provider_user_id, email
            FROM aws_identity_center_users
            WHERE tenant_id = %(tid)s AND deleted_at IS NULL AND email IS NOT NULL
        ),
        existing_links AS (
            SELECT provider_user_id
            FROM canonical_user_provider_links
            WHERE tenant_id = %(tid)s AND provider_type = 'AWS_IDENTITY_CENTER'
        ),
        new_matches AS (
            SELECT
                pu.provider_user_id,
                ce.canonical_user_id
            FROM provider_users pu
            JOIN canonical_emails ce ON ce.email = pu.email AND ce.tenant_id = %(tid)s
            WHERE pu.provider_user_id NOT IN (SELECT provider_user_id FROM existing_links)
        )
        INSERT INTO canonical_user_provider_links
            (tenant_id, canonical_user_id, provider_type, provider_user_id,
             confidence_score, match_method)
        SELECT
            %(tid)s,
            nm.canonical_user_id,
            'AWS_IDENTITY_CENTER',
            nm.provider_user_id,
            100,
            'email_exact'
        FROM new_matches nm
        ON CONFLICT (tenant_id, provider_type, provider_user_id)
        DO UPDATE SET
            canonical_user_id = EXCLUDED.canonical_user_id,
            confidence_score = EXCLUDED.confidence_score,
            match_method = EXCLUDED.match_method,
            updated_at = NOW()
        """
        with self.db.transaction() as cur:
            cur.execute(sql, {"tid": self.tenant_id})
            count = cur.rowcount
        logger.info("Resolved %d AWS Identity Center identity links", count)
        return count

    def _resolve_github(self) -> int:
        """Link GitHub users to canonical users via email match (excluding noreply)."""
        sql = """
        WITH provider_users AS (
            SELECT node_id AS provider_user_id, email
            FROM github_users
            WHERE tenant_id = %(tid)s
              AND deleted_at IS NULL
              AND email IS NOT NULL
              AND email NOT LIKE '%%@users.noreply.github.com'
        ),
        existing_links AS (
            SELECT provider_user_id
            FROM canonical_user_provider_links
            WHERE tenant_id = %(tid)s AND provider_type = 'GITHUB'
        ),
        new_matches AS (
            SELECT
                pu.provider_user_id,
                ce.canonical_user_id
            FROM provider_users pu
            JOIN canonical_emails ce ON ce.email = pu.email AND ce.tenant_id = %(tid)s
            WHERE pu.provider_user_id NOT IN (SELECT provider_user_id FROM existing_links)
        )
        INSERT INTO canonical_user_provider_links
            (tenant_id, canonical_user_id, provider_type, provider_user_id,
             confidence_score, match_method)
        SELECT
            %(tid)s,
            nm.canonical_user_id,
            'GITHUB',
            nm.provider_user_id,
            100,
            'email_exact'
        FROM new_matches nm
        ON CONFLICT (tenant_id, provider_type, provider_user_id)
        DO UPDATE SET
            canonical_user_id = EXCLUDED.canonical_user_id,
            confidence_score = EXCLUDED.confidence_score,
            match_method = EXCLUDED.match_method,
            updated_at = NOW()
        """
        with self.db.transaction() as cur:
            cur.execute(sql, {"tid": self.tenant_id})
            count = cur.rowcount
        logger.info("Resolved %d GitHub identity links", count)
        return count

    def _queue_unresolvable(self) -> int:
        """Add GitHub users with noreply emails to the reconciliation queue."""
        sql = """
        INSERT INTO identity_reconciliation_queue
            (tenant_id, provider_type, provider_user_id, conflict_reason, status)
        SELECT
            %(tid)s,
            'GITHUB',
            gu.node_id,
            'noreply_email: ' || gu.email,
            'PENDING'
        FROM github_users gu
        WHERE gu.tenant_id = %(tid)s
          AND gu.deleted_at IS NULL
          AND gu.email LIKE '%%@users.noreply.github.com'
          AND NOT EXISTS (
              SELECT 1 FROM identity_reconciliation_queue irq
              WHERE irq.tenant_id = %(tid)s
                AND irq.provider_type = 'GITHUB'
                AND irq.provider_user_id = gu.node_id
          )
        """
        with self.db.transaction() as cur:
            cur.execute(sql, {"tid": self.tenant_id})
            count = cur.rowcount
        logger.info("Queued %d unresolvable GitHub users", count)
        return count
