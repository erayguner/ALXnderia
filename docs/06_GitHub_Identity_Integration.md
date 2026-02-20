# GitHub Identity Integration — Design Document

## Overview

This document describes how GitHub organisation members, teams, repositories, and permissions are modelled in Alxderia's multi-tenant identity schema and linked to the canonical identity layer. GitHub data is one of three provider types alongside Google Workspace and AWS Identity Center.

## Entity-Relationship Diagram

```
┌──────────────────────────┐
│   github_organisations   │
│──────────────────────────│
│ github_id BIGINT         │
│ node_id TEXT (UK)        │
│ login TEXT (UK)          │
│ name TEXT                │
│ tenant_id UUID           │
└──────────┬───────────────┘
           │ 1:N (org_node_id)
    ┌──────┼──────────────────────┐
    ▼      ▼                      ▼
┌────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ github_teams   │  │github_org        │  │ github_repositories  │
│────────────────│  │memberships       │  │──────────────────────│
│ node_id TEXT   │  │──────────────────│  │ node_id TEXT         │
│ slug TEXT      │  │ org_node_id TEXT  │  │ full_name TEXT       │
│ privacy TEXT   │  │ user_node_id TEXT │  │ visibility TEXT      │
│ permission TEXT│  │ role TEXT         │  │ org_node_id TEXT     │
│ parent_team_id │  │ state TEXT       │  │ description TEXT     │
│ parent_team_   │  └──────┬───────────┘  │ fork BOOLEAN        │
│  node_id TEXT  │         │ N:1          │ language TEXT        │
└────┬───────────┘         │              │ pushed_at TIMESTAMPTZ│
     │ 1:N                 │              └──────┬──────────────┘
     ▼                     ▼                     │ 1:N
┌──────────────────┐  ┌──────────────────┐       ├──────────────┐
│github_team       │  │  github_users    │       ▼              ▼
│memberships       │  │──────────────────│  ┌──────────┐  ┌──────────────┐
│──────────────────│  │ github_id BIGINT │  │repo_team │  │repo_collabor │
│ team_node_id     │  │ node_id TEXT     │  │permissions│  │permissions   │
│ user_node_id     │  │ login TEXT       │  │──────────│  │──────────────│
│ role TEXT        │  │ email TEXT       │  │repo_     │  │repo_node_id  │
│ state TEXT       │  │ type TEXT        │  │node_id   │  │user_node_id  │
└──────────────────┘  │ avatar_url TEXT  │  │team_     │  │permission    │
                      └──────────────────┘  │node_id   │  │is_outside_   │
                                            │permission│  │collaborator  │
                                            └──────────┘  └──────────────┘
```

### Cross-provider linkage via canonical identity layer

```
┌──────────────────────┐
│   canonical_users    │
│──────────────────────│
│ full_name TEXT       │
│ primary_email TEXT   │
│ tenant_id UUID       │
└──────────┬───────────┘
           │ 1:N
           ▼
┌────────────────────────────────┐
│ canonical_user_provider_links  │
│────────────────────────────────│
│ canonical_user_id UUID         │
│ provider_type provider_type_   │
│   enum (GITHUB)                │
│ provider_user_id TEXT          │  ──> github_users.node_id
│ confidence_score INTEGER       │
│ match_method TEXT              │
└────────────────────────────────┘
```

### Key relationships

| From | To | Cardinality | Join Key |
|------|----|-------------|----------|
| `github_organisations` | — | scoped by | `tenant_id` |
| `github_users` | — | scoped by | `tenant_id` |
| `github_teams` | `github_organisations` | N:1 | `org_node_id` = org `node_id` |
| `github_repositories` | `github_organisations` | N:1 | `org_node_id` = org `node_id` |
| `github_org_memberships` | `github_organisations` | N:1 | `org_node_id` = org `node_id` |
| `github_org_memberships` | `github_users` | N:1 | `user_node_id` = user `node_id` |
| `github_team_memberships` | `github_teams` | N:1 | `team_node_id` = team `node_id` |
| `github_team_memberships` | `github_users` | N:1 | `user_node_id` = user `node_id` |
| `github_repo_team_permissions` | `github_repositories` | N:1 | `repo_node_id` = repo `node_id` |
| `github_repo_team_permissions` | `github_teams` | N:1 | `team_node_id` = team `node_id` |
| `github_repo_collaborator_permissions` | `github_repositories` | N:1 | `repo_node_id` = repo `node_id` |
| `github_repo_collaborator_permissions` | `github_users` | N:1 | `user_node_id` = user `node_id` |
| `canonical_user_provider_links` | `canonical_users` | N:1 | `canonical_user_id` FK |
| `canonical_user_provider_links` | `github_users` | logical | `provider_user_id` = user `node_id` (where `provider_type = 'GITHUB'`) |

**Important**: GitHub tables use `node_id` (TEXT) as the cross-reference key, not UUID foreign keys. All joins between GitHub tables are based on `node_id` matching, scoped within a tenant.

## Email Matching Logic

The sync pipeline maps GitHub users to canonical users using verified email addresses:

```
FOR EACH github_user WITH email NOT LIKE '%@users.noreply.github.com':
    match = SELECT id FROM canonical_users
            WHERE tenant_id = $tenant AND lower(primary_email) = lower($email)

    IF match FOUND:
        INSERT INTO canonical_user_provider_links (
            provider_type     = 'GITHUB',
            provider_user_id  = github_user.node_id,
            confidence_score  = 100,
            match_method      = 'email_exact'
        )
    ELSE:
        CREATE new canonical_users record from GitHub profile
        Link as above

FOR EACH github_user WITH noreply email:
    INSERT INTO identity_reconciliation_queue (
        provider_type         = 'GITHUB',
        provider_user_id      = github_user.node_id,
        conflict_reason       = 'noreply_email',
        status                = 'PENDING'
    )
    -- Flagged for manual review; no provider link created
```

### Noreply email handling

GitHub noreply addresses (`*@users.noreply.github.com`) cannot be matched to corporate identities. These users are queued in `identity_reconciliation_queue` with status `PENDING` and are excluded from automatic linkage. Operators resolve them via manual review.

## Example Queries

### All identities for a given email (cross-provider)

```sql
SELECT cu.full_name, cupl.provider_type, cupl.provider_user_id, cupl.confidence_score
FROM canonical_users cu
JOIN canonical_user_provider_links cupl ON cupl.canonical_user_id = cu.id
  AND cupl.tenant_id = cu.tenant_id
WHERE lower(cu.primary_email) = lower($1)
  AND cu.tenant_id = '11111111-1111-1111-1111-111111111111';
```

### GitHub users linked to AWS Identity Center accounts

```sql
SELECT gu.login, gu.email, cu.full_name
FROM github_users gu
JOIN canonical_user_provider_links gh_link
  ON gh_link.provider_type = 'GITHUB'
  AND gh_link.provider_user_id = gu.node_id
  AND gh_link.tenant_id = gu.tenant_id
JOIN canonical_user_provider_links aws_link
  ON aws_link.canonical_user_id = gh_link.canonical_user_id
  AND aws_link.provider_type = 'AWS_IDENTITY_CENTER'
  AND aws_link.tenant_id = gh_link.tenant_id
JOIN canonical_users cu ON cu.id = gh_link.canonical_user_id
  AND cu.tenant_id = gh_link.tenant_id
WHERE gu.tenant_id = '11111111-1111-1111-1111-111111111111';
```

### Unmapped users (not linked across all three providers)

```sql
SELECT cu.id, cu.full_name, cu.primary_email,
       array_agg(DISTINCT cupl.provider_type) AS linked_providers
FROM canonical_users cu
LEFT JOIN canonical_user_provider_links cupl
  ON cupl.canonical_user_id = cu.id AND cupl.tenant_id = cu.tenant_id
WHERE cu.tenant_id = '11111111-1111-1111-1111-111111111111'
GROUP BY cu.id, cu.full_name, cu.primary_email
HAVING COUNT(DISTINCT cupl.provider_type) < 3;
```

### GitHub org admins

```sql
SELECT gu.login, gu.email, go.login AS org_login
FROM github_org_memberships gom
JOIN github_users gu ON gu.node_id = gom.user_node_id AND gu.tenant_id = gom.tenant_id
JOIN github_organisations go ON go.node_id = gom.org_node_id AND go.tenant_id = gom.tenant_id
WHERE gom.role = 'admin'
  AND gom.tenant_id = '11111111-1111-1111-1111-111111111111';
```

### Team members for a given team slug

```sql
SELECT gu.login, gu.name, gtm.role
FROM github_team_memberships gtm
JOIN github_users gu ON gu.node_id = gtm.user_node_id AND gu.tenant_id = gtm.tenant_id
JOIN github_teams gt ON gt.node_id = gtm.team_node_id AND gt.tenant_id = gtm.tenant_id
WHERE gt.slug = $1
  AND gtm.tenant_id = '11111111-1111-1111-1111-111111111111';
```

### Repository collaborators with permissions

```sql
SELECT gu.login, gu.email, gr.full_name AS repo, grcp.permission, grcp.is_outside_collaborator
FROM github_repo_collaborator_permissions grcp
JOIN github_users gu ON gu.node_id = grcp.user_node_id AND gu.tenant_id = grcp.tenant_id
JOIN github_repositories gr ON gr.node_id = grcp.repo_node_id AND gr.tenant_id = grcp.tenant_id
WHERE grcp.tenant_id = '11111111-1111-1111-1111-111111111111';
```

### External collaborators across all repositories

```sql
SELECT gu.login, gu.email, gr.full_name AS repo, grcp.permission
FROM github_repo_collaborator_permissions grcp
JOIN github_users gu ON gu.node_id = grcp.user_node_id AND gu.tenant_id = grcp.tenant_id
JOIN github_repositories gr ON gr.node_id = grcp.repo_node_id AND gr.tenant_id = grcp.tenant_id
WHERE grcp.is_outside_collaborator = TRUE
  AND grcp.tenant_id = '11111111-1111-1111-1111-111111111111';
```

## Schema Design Principles

### Node ID-based joins

All GitHub tables use `node_id` (TEXT) as the cross-reference key rather than UUID foreign keys. This mirrors the GitHub GraphQL API's node ID system and avoids the need for a separate ID mapping layer. Joins between GitHub tables are always based on `node_id` matching within the same tenant.

### Composite primary keys

All tables use `(id, tenant_id)` as the primary key, making them partition-friendly for future horizontal scaling.

### Raw response storage

Every table includes a `raw_response JSONB` column to store the full API response from GitHub, enabling future data extraction without re-fetching.

### Soft deletes

All tables include a `deleted_at` column for soft-delete support, allowing historical queries and audit trails.

## Seed Data Summary

| Entity | Count |
|--------|-------|
| `github_organisations` | 1 (techco) |
| `github_users` | 3 (alice, bob, carol) |
| `github_teams` | 0 (created in extended mock data) |
| `github_org_memberships` | 0 (created in extended mock data) |
| `github_team_memberships` | 0 (created in extended mock data) |
| `github_repositories` | 1 (techco/backend) |
| `github_repo_team_permissions` | 0 (created in extended mock data) |
| `github_repo_collaborator_permissions` | 1 (carol, external) |

### Edge cases in seed data

- Bob is a GitHub-only user with no canonical identity link (unmapped)
- Carol is an external collaborator (`is_outside_collaborator = TRUE`) with no org membership
- Alice is linked across all three providers (Google Workspace, AWS Identity Center, GitHub)
- Dave exists only in Google Workspace (no GitHub presence)

## Security Considerations

- **PII**: `github_users.email` and `name` are PII. These tables are listed in the application's `PII_TABLES` configuration. PII redaction views are planned for a future iteration.
- **Tenant isolation**: All tables include `tenant_id` in the primary key and unique constraints. The application sets `app.current_tenant_id` per transaction for forward-compatible RLS.
- **Repository permissions**: `github_repo_collaborator_permissions.is_outside_collaborator` flags external access, enabling compliance queries for outside collaborator auditing.
