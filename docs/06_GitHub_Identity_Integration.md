# GitHub Identity Integration — Design Document

## Overview

This document describes how GitHub organisation members are modelled in Alxderia's identity schema and linked to the existing cross-provider `person` graph. The design follows the same patterns established for AWS and GCP providers.

## Entity-Relationship Diagram

```
┌──────────────────────┐
│       tenant         │
└──────────┬───────────┘
           │ 1:N
           ▼
┌──────────────────────┐       ┌──────────────────────┐
│ github_organisation  │       │       person         │
│──────────────────────│       │──────────────────────│
│ github_org_id BIGINT │       │ primary_email TEXT    │
│ login TEXT           │       │ display_name TEXT     │
│ plan TEXT            │       └──────────┬───────────┘
└──────────┬───────────┘                  │
           │ 1:N                          │ 1:N
    ┌──────┴──────┐            ┌──────────┴───────────┐
    ▼             ▼            │     person_link      │
┌──────────┐  ┌──────────────┐│──────────────────────│
│  github  │  │github_org    ││ identity_type TEXT    │
│  team    │  │membership    ││ provider_code TEXT FK │
│──────────│  │──────────────││ confidence NUMERIC    │
│ slug     │  │ role         │└──────────────────────┘
│ privacy  │  │ state        │
│ parent_  │  └──────┬───────┘
│ team_id  │         │
└────┬─────┘         │
     │ 1:N           │ N:1
     ▼               ▼
┌──────────────┐  ┌──────────────────┐
│github_team   │  │  github_user     │
│membership    │  │──────────────────│
│──────────────│  │ github_user_id   │
│ membership   │  │ login TEXT       │
│ _role TEXT   │  │ email TEXT       │
└──────────────┘  │ person_id UUID FK│
                  └──────────────────┘
```

### Key relationships

| From | To | Cardinality | FK |
|------|----|-------------|-----|
| `github_organisation` | `tenant` | N:1 | `tenant_id` |
| `github_user` | `tenant` | N:1 | `tenant_id` |
| `github_user` | `person` | N:1 | `person_id` (nullable, deferred) |
| `github_team` | `github_organisation` | N:1 | `org_id` |
| `github_team` | `github_team` | N:1 (self) | `parent_team_id` (nullable) |
| `github_team_membership` | `github_team` | N:1 | `team_id` |
| `github_team_membership` | `github_user` | N:1 | `user_id` |
| `github_org_membership` | `github_organisation` | N:1 | `org_id` |
| `github_org_membership` | `github_user` | N:1 | `user_id` |
| `person_link` | `person` | N:1 | `person_id` |
| `person_link` | `cloud_provider` | N:1 | `provider_code = 'github'` |

## Email Matching Logic

The sync pipeline maps GitHub users to persons using verified email addresses:

```
FOR EACH github_user WITH email NOT LIKE '%@users.noreply.github.com':
    match = SELECT id FROM person
            WHERE tenant_id = $tenant AND lower(primary_email) = lower($email)

    IF match FOUND:
        SET github_user.person_id = match.id
        INSERT INTO person_link (
            provider_code    = 'github',
            identity_type    = 'github_user',
            confidence       = 1.00,
            linkage_strategy = 'email_match'
        )
    ELSE:
        CREATE new person record from GitHub profile
        Link as above

FOR EACH github_user WITH noreply email:
    SET github_user.person_id = NULL
    -- Flagged for manual review; no person_link created
```

### Noreply email handling

GitHub noreply addresses (`*@users.noreply.github.com`) cannot be matched to corporate identities. These users are ingested with `person_id = NULL` and are excluded from automatic linkage. Operators resolve them via manual review in the admin UI.

## person_link Extensibility

The `person_link.identity_type` CHECK constraint was changed from a hardcoded enum:

```sql
-- Before (closed)
CHECK (identity_type IN ('aws_iam_user', 'aws_idc_user', 'gcp_workspace_user'))

-- After (open-ended)
CHECK (identity_type ~ '^[a-z][a-z0-9_]+$')
```

This allows any future provider (e.g. `azure_ad_user`, `okta_user`) to be added without a schema migration.

## Example Queries

### All identities for a given email

```sql
SELECT p.display_name, pl.identity_type, pl.provider_code, pl.confidence
FROM person p
JOIN person_link pl ON pl.person_id = p.id
WHERE lower(p.primary_email) = lower($1);
```

### GitHub users linked to AWS accounts

```sql
SELECT gu.login, gu.email, p.display_name
FROM github_user gu
JOIN person p ON p.id = gu.person_id
JOIN person_link pl ON pl.person_id = p.id AND pl.provider_code = 'aws'
WHERE pl.identity_type = 'aws_idc_user';
```

### Orphan users (not linked across all three providers)

```sql
SELECT p.id, p.display_name, p.primary_email,
       array_agg(DISTINCT pl.provider_code) AS linked_providers
FROM person p
LEFT JOIN person_link pl ON pl.person_id = p.id
GROUP BY p.id
HAVING COUNT(DISTINCT pl.provider_code) < 3;
```

### GitHub org admins

```sql
SELECT gu.login, gu.email, go.login AS org_login
FROM github_org_membership gom
JOIN github_user gu ON gu.id = gom.user_id
JOIN github_organisation go ON go.id = gom.org_id
WHERE gom.role = 'admin';
```

### Team members for a given team slug

```sql
SELECT gu.login, gu.display_name, gtm.membership_role
FROM github_team_membership gtm
JOIN github_user gu ON gu.id = gtm.user_id
JOIN github_team gt ON gt.id = gtm.team_id
WHERE gt.slug = $1;
```

## Migration Strategy

### Ordering

The schema files are numbered to ensure correct dependency order. Because the migration script uses `find | sort`, files in `11-github/` execute after `07-indexes/`, `08-security/`, and `10-dlp/`. The `060_github_post_setup.sql` file handles GitHub-specific indexes, RLS, views, and grants that cannot be applied before the tables exist:

1. `01-reference/010_cloud_provider.sql` — `github` added to `cloud_provider`
2. `04-identity/020_person_link.sql` — CHECK constraint updated (open-ended regex)
3. `07-indexes/010_indexes.sql` — GitHub indexes declared (applied later by post-setup)
4. `08-security/010_roles.sql` — GitHub tables in grant arrays (applied later by post-setup)
5. `08-security/020_rls_policies.sql` — GitHub tables in RLS arrays (applied later by post-setup)
6. `10-dlp/030_pii_redaction_views.sql` — `v_github_user_redacted` declared (applied later by post-setup)
7. `11-github/010_github_organisation.sql` — depends on `tenant`
8. `11-github/020_github_user.sql` — depends on `tenant`
9. `11-github/030_github_team.sql` — depends on `github_organisation`
10. `11-github/040_github_team_membership.sql` — depends on `github_team`, `github_user`
11. `11-github/050_github_org_membership.sql` — depends on `github_organisation`, `github_user`
12. `11-github/060_github_post_setup.sql` — applies indexes, RLS, redaction view, grants, and deferred FK
13. `99-seed/010_mock_data.sql` — GitHub seed data

### Rollback

To remove GitHub support:

```sql
DROP TABLE IF EXISTS github_org_membership CASCADE;
DROP TABLE IF EXISTS github_team_membership CASCADE;
DROP TABLE IF EXISTS github_team CASCADE;
DROP TABLE IF EXISTS github_user CASCADE;
DROP TABLE IF EXISTS github_organisation CASCADE;
DROP VIEW IF EXISTS v_github_user_redacted;
DELETE FROM person_link WHERE identity_type = 'github_user';
DELETE FROM cloud_provider WHERE provider_code = 'github';
ALTER TABLE person_link DROP CONSTRAINT ck_identity_type;
ALTER TABLE person_link ADD CONSTRAINT ck_identity_type
  CHECK (identity_type IN ('aws_iam_user', 'aws_idc_user', 'gcp_workspace_user'));
```

## Security Considerations

- **PII**: `github_user.email` and `display_name` are PII. The `v_github_user_redacted` view redacts these fields using the existing `_redact_email` / `_redact_name` functions.
- **RLS**: Row-level security policies on `tenant_id` are applied to all five GitHub tables via `060_github_post_setup.sql` (same pattern as AWS/GCP tables). RLS is both enabled and forced on each table.
- **Readonly role**: `cloudintel_readonly` is granted SELECT on `v_github_user_redacted` only — not on the base table.
- **Two-factor audit**: `github_user.two_factor_enabled` and `github_organisation.two_factor_requirement_enabled` support compliance reporting.

## Seed Data Summary

| Entity | Count |
|--------|-------|
| `github_organisation` | 2 |
| `github_user` | ~400 (280 northwind, 120 southbank) |
| `github_team` | 30 (20 northwind, 10 southbank) |
| `github_team_membership` | ~1,200 |
| `github_org_membership` | ~400 |
| `person_link` (github_user) | ~380 (20 noreply users excluded) |

### Edge cases in seed data

- 20 GitHub users with `@users.noreply.github.com` email — `person_id = NULL`, no `person_link`
- ~27 GitHub org admins (~1 in 15 users)
- ~12.5% of team members are maintainers
- All GitHub users have org membership (active state)
