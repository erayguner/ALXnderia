"""GitHub organisation provider: orgs, users, teams, repos, permissions."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

import requests

from scripts.ingestion.base_provider import BaseProvider
from scripts.ingestion.config import IngestionConfig
from scripts.ingestion.db import Database

logger = logging.getLogger("ingestion.github")


class GitHubOrgProvider(BaseProvider):
    PROVIDER_NAME = "github"

    def __init__(self, config: IngestionConfig, db: Database) -> None:
        super().__init__(config, db)
        gh = config.github
        if not gh:
            raise ValueError("GitHub config not set")
        self._token = gh.token
        self._org_logins = gh.org_logins
        self._base = gh.api_base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"token {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })

    def _get_paginated(self, url: str, params: Optional[dict] = None) -> list[dict]:
        """Fetch all pages from a GitHub REST API endpoint."""
        results: list[dict] = []
        params = dict(params or {})
        params.setdefault("per_page", "100")
        attempt = 0

        while url:
            resp = self._session.get(url, params=params)
            if resp.status_code == 403 and "rate limit" in resp.text.lower():
                reset = int(resp.headers.get("X-RateLimit-Reset", "0"))
                wait = max(reset - int(time.time()), 1)
                logger.warning("GitHub rate limit hit, waiting %ds", wait)
                time.sleep(min(wait, 300))
                attempt += 1
                if attempt > 5:
                    raise RuntimeError("GitHub rate limit exceeded after retries")
                continue
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                results.extend(data)
            else:
                results.append(data)

            # Follow Link header for pagination
            url = ""
            params = {}
            link = resp.headers.get("Link", "")
            for part in link.split(","):
                if 'rel="next"' in part:
                    url = part.split(";")[0].strip().strip("<>")
                    break
            attempt = 0
        return results

    def sync(self) -> dict[str, int]:
        results: dict[str, int] = {}
        for org_login in self._org_logins:
            org_results = self._sync_org(org_login)
            for k, v in org_results.items():
                results[f"{org_login}/{k}"] = v
        return results

    def _sync_org(self, org_login: str) -> dict[str, int]:
        counts: dict[str, int] = {}

        # 1. Organisation itself
        org_data = self._get_paginated(f"{self._base}/orgs/{org_login}")
        org = org_data[0] if org_data else {}
        org_node_id = org.get("node_id", "")
        counts["org"] = self._upsert_org(org)

        # 2. Members
        members = self._get_paginated(f"{self._base}/orgs/{org_login}/members")
        counts["users"] = self._upsert_users(members)
        counts["org_memberships"] = self._upsert_org_memberships(org_node_id, members)

        # 3. Teams
        teams = self._get_paginated(f"{self._base}/orgs/{org_login}/teams")
        counts["teams"] = self._upsert_teams(org_node_id, teams)

        # 4. Team memberships
        tm_total = 0
        for team in teams:
            slug = team.get("slug", "")
            team_node_id = team.get("node_id", "")
            team_members = self._get_paginated(
                f"{self._base}/orgs/{org_login}/teams/{slug}/members"
            )
            tm_total += self._upsert_team_memberships(team_node_id, team_members)
        counts["team_memberships"] = tm_total

        # 5. Repositories
        repos = self._get_paginated(f"{self._base}/orgs/{org_login}/repos")
        counts["repos"] = self._upsert_repos(org_node_id, repos)

        # 6. Repo team permissions + collaborator permissions
        rtp_total = 0
        rcp_total = 0
        for repo in repos:
            full_name = repo.get("full_name", "")
            repo_node_id = repo.get("node_id", "")

            repo_teams = self._get_paginated(
                f"{self._base}/repos/{full_name}/teams"
            )
            rtp_total += self._upsert_repo_team_perms(repo_node_id, repo_teams)

            collabs = self._get_paginated(
                f"{self._base}/repos/{full_name}/collaborators",
                params={"affiliation": "all"},
            )
            rcp_total += self._upsert_repo_collab_perms(repo_node_id, collabs)
        counts["repo_team_permissions"] = rtp_total
        counts["repo_collaborator_permissions"] = rcp_total

        return counts

    def _upsert_org(self, org: dict) -> int:
        if not org:
            return 0
        columns = [
            "tenant_id", "github_id", "node_id", "login", "name",
            "email", "raw_response", "last_synced_at",
        ]
        rows = [(
            self.tenant_id,
            org["id"],
            org["node_id"],
            org["login"],
            org.get("name"),
            org.get("email"),
            json.dumps(org),
            "NOW()",
        )]
        with self.db.transaction() as cur:
            return self.db.upsert_batch(
                cur, "github_organisations", columns, rows,
                ["tenant_id", "node_id"],
                ["login", "name", "email", "raw_response"],
            )

    def _upsert_users(self, users: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "github_id", "node_id", "login", "name",
            "email", "type", "site_admin", "avatar_url",
            "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "node_id"]
        update = [
            "login", "name", "email", "type", "site_admin",
            "avatar_url", "raw_response",
        ]
        for batch in self._batch_rows(users):
            rows = []
            for u in batch:
                # Fetch full user to get name/email
                rows.append((
                    self.tenant_id,
                    u["id"],
                    u["node_id"],
                    u["login"],
                    u.get("name"),
                    u.get("email"),
                    u.get("type", "User"),
                    u.get("site_admin", False),
                    u.get("avatar_url"),
                    json.dumps(u),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_users", columns, rows, conflict, update
                )
        return total

    def _upsert_org_memberships(self, org_node_id: str, members: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "org_node_id", "user_node_id", "role",
            "state", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "org_node_id", "user_node_id"]
        update = ["role", "state", "raw_response"]
        for batch in self._batch_rows(members):
            rows = []
            for m in batch:
                rows.append((
                    self.tenant_id,
                    org_node_id,
                    m["node_id"],
                    m.get("role", "member"),
                    "active",
                    json.dumps(m),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_org_memberships", columns, rows, conflict, update
                )
        return total

    def _upsert_teams(self, org_node_id: str, teams: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "github_id", "node_id", "org_node_id",
            "name", "slug", "description", "privacy", "permission",
            "parent_team_id", "parent_team_node_id",
            "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "node_id"]
        update = [
            "org_node_id", "name", "slug", "description", "privacy",
            "permission", "parent_team_id", "parent_team_node_id", "raw_response",
        ]
        for batch in self._batch_rows(teams):
            rows = []
            for t in batch:
                parent = t.get("parent") or {}
                rows.append((
                    self.tenant_id,
                    t["id"],
                    t["node_id"],
                    org_node_id,
                    t["name"],
                    t["slug"],
                    t.get("description"),
                    t.get("privacy"),
                    t.get("permission"),
                    parent.get("id"),
                    parent.get("node_id"),
                    json.dumps(t),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_teams", columns, rows, conflict, update
                )
        return total

    def _upsert_team_memberships(self, team_node_id: str, members: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "team_node_id", "user_node_id", "role",
            "state", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "team_node_id", "user_node_id"]
        update = ["role", "state", "raw_response"]
        for batch in self._batch_rows(members):
            rows = []
            for m in batch:
                rows.append((
                    self.tenant_id,
                    team_node_id,
                    m["node_id"],
                    m.get("role", "member"),
                    "active",
                    json.dumps(m),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_team_memberships", columns, rows, conflict, update
                )
        return total

    def _upsert_repos(self, org_node_id: str, repos: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "github_id", "node_id", "org_node_id",
            "name", "full_name", "private", "visibility", "archived",
            "default_branch", "description", "fork", "language",
            "pushed_at", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "node_id"]
        update = [
            "org_node_id", "name", "full_name", "private", "visibility",
            "archived", "default_branch", "description", "fork",
            "language", "pushed_at", "raw_response",
        ]
        for batch in self._batch_rows(repos):
            rows = []
            for r in batch:
                rows.append((
                    self.tenant_id,
                    r["id"],
                    r["node_id"],
                    org_node_id,
                    r["name"],
                    r["full_name"],
                    r.get("private", False),
                    r.get("visibility"),
                    r.get("archived", False),
                    r.get("default_branch"),
                    r.get("description"),
                    r.get("fork", False),
                    r.get("language"),
                    r.get("pushed_at"),
                    json.dumps(r),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_repositories", columns, rows, conflict, update
                )
        return total

    def _upsert_repo_team_perms(self, repo_node_id: str, teams: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "repo_node_id", "team_node_id", "permission",
            "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "repo_node_id", "team_node_id"]
        update = ["permission", "raw_response"]
        for batch in self._batch_rows(teams):
            rows = []
            for t in batch:
                rows.append((
                    self.tenant_id,
                    repo_node_id,
                    t["node_id"],
                    t.get("permission", "pull"),
                    json.dumps(t),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_repo_team_permissions", columns, rows,
                    conflict, update,
                )
        return total

    def _upsert_repo_collab_perms(self, repo_node_id: str, collabs: list[dict]) -> int:
        total = 0
        columns = [
            "tenant_id", "repo_node_id", "user_node_id", "permission",
            "is_outside_collaborator", "raw_response", "last_synced_at",
        ]
        conflict = ["tenant_id", "repo_node_id", "user_node_id"]
        update = ["permission", "is_outside_collaborator", "raw_response"]
        for batch in self._batch_rows(collabs):
            rows = []
            for c in batch:
                # GitHub returns permissions as an object; pick the highest
                perms = c.get("permissions", {})
                permission = "read"
                for level in ("admin", "maintain", "push", "triage", "pull"):
                    if perms.get(level):
                        permission = level
                        break
                rows.append((
                    self.tenant_id,
                    repo_node_id,
                    c["node_id"],
                    permission,
                    c.get("permissions", {}).get("admin", False) is False
                    and c.get("type") != "User",
                    json.dumps(c),
                    "NOW()",
                ))
            with self.db.transaction() as cur:
                total += self.db.upsert_batch(
                    cur, "github_repo_collaborator_permissions", columns, rows,
                    conflict, update,
                )
        return total
