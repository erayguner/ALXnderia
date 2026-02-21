#!/usr/bin/env python3
"""
Repeatable seed script for cloud resources and relationship matrix.

Populates:
  - aws_accounts (12 accounts)
  - aws_account_assignments (~240 group→account mappings)
  - gcp_organisations (1 org)
  - gcp_projects (15 projects)
  - gcp_project_iam_bindings (~180 user/group bindings)
  - resource_access_grants (denormalised cross-provider matrix)

Prerequisites:
  - PostgreSQL with schema from 01_schema.sql + 02_cloud_resources.sql
  - Identity data from 010_mock_data.sql already loaded
  - pip install psycopg2-binary  (or psycopg[binary] for psycopg3)

Usage:
  python scripts/seed_cloud_resources.py                         # uses DATABASE_URL env var
  python scripts/seed_cloud_resources.py --dsn "postgresql://..." # explicit DSN
  python scripts/seed_cloud_resources.py --dry-run                # print SQL, don't execute
"""

import argparse
import hashlib
import os
import sys
import uuid
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TENANT_ID = "11111111-1111-1111-1111-111111111111"
ORG_ID_AWS = "o-demo0org001"
ORG_ID_GCP = "organizations/901234567890"
IDC_STORE = "d-demo0001"
SYNC_TS = "2026-02-14T00:00:00+00:00"
NOW = datetime.now(timezone.utc).isoformat()

# Deterministic UUID from a seed string
def duuid(seed: str) -> str:
    return str(uuid.UUID(hashlib.md5(seed.encode()).hexdigest()))


# ---------------------------------------------------------------------------
# AWS Accounts
# ---------------------------------------------------------------------------
AWS_ACCOUNTS = [
    ("111222333001", "demo-management",     "aws-mgmt@demo-example.co.uk",     "ACTIVE",    "CREATED", "r-root001"),
    ("111222333002", "demo-security",       "aws-security@demo-example.co.uk", "ACTIVE",    "CREATED", "ou-security"),
    ("111222333003", "demo-log-archive",    "aws-logs@demo-example.co.uk",     "ACTIVE",    "CREATED", "ou-security"),
    ("111222333004", "demo-networking",     "aws-network@demo-example.co.uk",  "ACTIVE",    "CREATED", "ou-infrastructure"),
    ("111222333005", "demo-shared-services","aws-shared@demo-example.co.uk",   "ACTIVE",    "CREATED", "ou-infrastructure"),
    ("111222333006", "demo-dev",            "aws-dev@demo-example.co.uk",      "ACTIVE",    "CREATED", "ou-workloads-dev"),
    ("111222333007", "demo-staging",        "aws-staging@demo-example.co.uk",  "ACTIVE",    "CREATED", "ou-workloads-staging"),
    ("111222333008", "demo-production",     "aws-prod@demo-example.co.uk",     "ACTIVE",    "CREATED", "ou-workloads-prod"),
    ("111222333009", "demo-data-dev",       "aws-data-dev@demo-example.co.uk", "ACTIVE",    "CREATED", "ou-workloads-dev"),
    ("111222333010", "demo-data-prod",      "aws-data-prod@demo-example.co.uk","ACTIVE",    "CREATED", "ou-workloads-prod"),
    ("111222333011", "demo-ml-sandbox",     "aws-ml@demo-example.co.uk",       "ACTIVE",    "INVITED", "ou-sandbox"),
    ("111222333012", "demo-deprecated",     "aws-old@demo-example.co.uk",      "SUSPENDED", "CREATED", "ou-suspended"),
]

# ---------------------------------------------------------------------------
# Permission Sets
# ---------------------------------------------------------------------------
PERMISSION_SETS = [
    ("AdministratorAccess",   "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-admin"),
    ("PowerUserAccess",       "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-poweruser"),
    ("ReadOnlyAccess",        "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-readonly"),
    ("ViewOnlyAccess",        "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-viewonly"),
    ("DatabaseAdminAccess",   "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-dba"),
    ("NetworkAdminAccess",    "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-netadmin"),
    ("SecurityAuditAccess",   "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-secaudit"),
    ("BillingAccess",         "arn:aws:sso:::permissionSet/ssoins-demo0001/ps-billing"),
]

# ---------------------------------------------------------------------------
# GCP Projects
# ---------------------------------------------------------------------------
GCP_PROJECTS = [
    ("demo-platform-prod",    "100000000001", "Platform Production",       "ACTIVE",           "folders/prod"),
    ("demo-platform-dev",     "100000000002", "Platform Development",      "ACTIVE",           "folders/dev"),
    ("demo-data-analytics",   "100000000003", "Data Analytics",            "ACTIVE",           "folders/prod"),
    ("demo-data-warehouse",   "100000000004", "Data Warehouse",            "ACTIVE",           "folders/prod"),
    ("demo-ml-training",      "100000000005", "ML Training",               "ACTIVE",           "folders/prod"),
    ("demo-ml-sandbox",       "100000000006", "ML Sandbox",                "ACTIVE",           "folders/sandbox"),
    ("demo-security-ops",     "100000000007", "Security Operations",       "ACTIVE",           "folders/security"),
    ("demo-networking-hub",   "100000000008", "Networking Hub",            "ACTIVE",           "folders/infrastructure"),
    ("demo-frontend-prod",    "100000000009", "Frontend Production",       "ACTIVE",           "folders/prod"),
    ("demo-frontend-dev",     "100000000010", "Frontend Development",      "ACTIVE",           "folders/dev"),
    ("demo-billing-prod",     "100000000011", "Billing Production",        "ACTIVE",           "folders/prod"),
    ("demo-ci-cd",            "100000000012", "CI/CD Pipelines",           "ACTIVE",           "folders/infrastructure"),
    ("demo-monitoring",       "100000000013", "Monitoring & Observability","ACTIVE",           "folders/infrastructure"),
    ("demo-api-gateway-prod", "100000000014", "API Gateway Production",    "ACTIVE",           "folders/prod"),
    ("demo-decommissioned",   "100000000015", "Decommissioned Project",    "DELETE_REQUESTED", None),
]

GCP_ROLES = [
    "roles/viewer", "roles/editor", "roles/owner",
    "roles/bigquery.dataViewer", "roles/bigquery.dataEditor",
    "roles/storage.objectViewer", "roles/storage.admin",
    "roles/compute.viewer", "roles/compute.admin",
    "roles/iam.securityReviewer", "roles/logging.viewer", "roles/monitoring.viewer",
]


# ---------------------------------------------------------------------------
# SQL generation helpers
# ---------------------------------------------------------------------------

def sql_truncate() -> str:
    return """
TRUNCATE aws_accounts CASCADE;
TRUNCATE aws_account_assignments CASCADE;
TRUNCATE gcp_organisations CASCADE;
TRUNCATE gcp_projects CASCADE;
TRUNCATE gcp_project_iam_bindings CASCADE;
TRUNCATE resource_access_grants CASCADE;
"""


def sql_aws_accounts() -> str:
    rows = []
    for acct_id, name, email, status, method, parent in AWS_ACCOUNTS:
        uid = duuid(f"aws-acct-{acct_id}")
        rows.append(
            f"  ('{uid}', '{TENANT_ID}', '{acct_id}', '{name}', '{email}', "
            f"'{status}', '{method}', '2024-03-01T09:00:00+00:00', '{ORG_ID_AWS}', '{parent}', "
            f"'{{}}'::jsonb, '{SYNC_TS}', '{SYNC_TS}', '{SYNC_TS}')"
        )
    return (
        "INSERT INTO aws_accounts\n"
        "  (id, tenant_id, account_id, name, email, status, joined_method, joined_at,\n"
        "   org_id, parent_id, raw_response, created_at, updated_at, last_synced_at)\n"
        "VALUES\n" + ",\n".join(rows) + "\n"
        "ON CONFLICT (tenant_id, account_id) DO NOTHING;\n"
    )


def sql_gcp_org() -> str:
    uid = duuid("gcp-org-demo")
    return (
        "INSERT INTO gcp_organisations\n"
        "  (id, tenant_id, org_id, display_name, domain, lifecycle_state,\n"
        "   raw_response, created_at, updated_at, last_synced_at)\n"
        f"VALUES ('{uid}', '{TENANT_ID}', '{ORG_ID_GCP}', 'Demo Engineering Org',\n"
        f"  'demo-example.co.uk', 'ACTIVE', '{{}}'::jsonb, '{SYNC_TS}', '{SYNC_TS}', '{SYNC_TS}')\n"
        "ON CONFLICT (tenant_id, org_id) DO NOTHING;\n"
    )


def sql_gcp_projects() -> str:
    rows = []
    for pid, pnum, name, state, folder in GCP_PROJECTS:
        uid = duuid(f"gcp-proj-{pid}")
        folder_val = f"'{folder}'" if folder else "NULL"
        labels = '{"env":"seed"}'
        rows.append(
            f"  ('{uid}', '{TENANT_ID}', '{pid}', '{pnum}', '{name}', '{state}',\n"
            f"   '{ORG_ID_GCP}', {folder_val}, '{labels}'::jsonb,\n"
            f"   '{{}}'::jsonb, '{SYNC_TS}', '{SYNC_TS}', '{SYNC_TS}')"
        )
    return (
        "INSERT INTO gcp_projects\n"
        "  (id, tenant_id, project_id, project_number, display_name, lifecycle_state,\n"
        "   org_id, folder_id, labels, raw_response, created_at, updated_at, last_synced_at)\n"
        "VALUES\n" + ",\n".join(rows) + "\n"
        "ON CONFLICT (tenant_id, project_id) DO NOTHING;\n"
    )


def sql_aws_account_assignments() -> str:
    """Generate deterministic assignments: cycle IDC groups × permission sets across accounts."""
    return """
-- AWS account assignments: IDC groups → accounts via permission sets
INSERT INTO aws_account_assignments
  (id, tenant_id, identity_store_id, account_id, permission_set_arn, permission_set_name,
   principal_type, principal_id, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '%(tid)s',
  g.identity_store_id,
  a.account_id,
  ps.pset_arn,
  ps.pset_name,
  'GROUP',
  g.group_id,
  jsonb_build_object('AccountId', a.account_id, 'PermissionSetName', ps.pset_name),
  '%(sync)s'::timestamptz, '%(sync)s'::timestamptz, '%(sync)s'::timestamptz
FROM (
  SELECT account_id, ROW_NUMBER() OVER (ORDER BY account_id) AS rn
  FROM aws_accounts
  WHERE tenant_id = '%(tid)s' AND status = 'ACTIVE'
) a
CROSS JOIN generate_series(0, 21) AS slot(s)
JOIN (
  SELECT group_id, identity_store_id, display_name,
         ROW_NUMBER() OVER (ORDER BY id) AS grn,
         COUNT(*) OVER () AS gcnt
  FROM aws_identity_center_groups
  WHERE tenant_id = '%(tid)s'
) g ON g.grn = 1 + ((a.rn * 7 + slot.s * 13 + abs(hashint4(a.rn::int * 41 + slot.s))) %% g.gcnt)
CROSS JOIN LATERAL (VALUES
  ('AdministratorAccess','arn:aws:sso:::permissionSet/ssoins-demo0001/ps-admin'),
  ('PowerUserAccess',    'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-poweruser'),
  ('ReadOnlyAccess',     'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-readonly'),
  ('ViewOnlyAccess',     'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-viewonly'),
  ('DatabaseAdminAccess','arn:aws:sso:::permissionSet/ssoins-demo0001/ps-dba'),
  ('NetworkAdminAccess', 'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-netadmin'),
  ('SecurityAuditAccess','arn:aws:sso:::permissionSet/ssoins-demo0001/ps-secaudit'),
  ('BillingAccess',      'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-billing')
) ps(pset_name, pset_arn)
WHERE slot.s < (15 + abs(hashint4(a.rn::int * 19)) %% 8)
  AND abs(hashint4(a.rn::int * 3 + slot.s * 5)) %% 8 + 1 =
      (ROW_NUMBER() OVER (PARTITION BY a.account_id, g.group_id ORDER BY ps.pset_name))
ON CONFLICT (tenant_id, account_id, permission_set_arn, principal_type, principal_id) DO NOTHING;
""" % {"tid": TENANT_ID, "sync": SYNC_TS}


def sql_gcp_iam_bindings() -> str:
    """Generate GCP IAM bindings using existing Google Workspace users and groups."""
    return """
-- GCP project IAM bindings: user + group
WITH
projects AS (
  SELECT project_id, ROW_NUMBER() OVER (ORDER BY project_id) AS rn
  FROM gcp_projects
  WHERE tenant_id = '%(tid)s' AND lifecycle_state = 'ACTIVE'
),
gw_users AS (
  SELECT primary_email,
         ROW_NUMBER() OVER (ORDER BY id) AS rn,
         COUNT(*) OVER () AS cnt
  FROM google_workspace_users WHERE tenant_id = '%(tid)s'
),
gw_groups AS (
  SELECT email,
         ROW_NUMBER() OVER (ORDER BY id) AS rn,
         COUNT(*) OVER () AS cnt
  FROM google_workspace_groups WHERE tenant_id = '%(tid)s'
),
roles(role_name, role_rn) AS (
  SELECT r, ROW_NUMBER() OVER (ORDER BY r)
  FROM unnest(ARRAY[
    'roles/viewer','roles/editor','roles/owner',
    'roles/bigquery.dataViewer','roles/bigquery.dataEditor',
    'roles/storage.objectViewer','roles/storage.admin',
    'roles/compute.viewer','roles/compute.admin',
    'roles/iam.securityReviewer','roles/logging.viewer','roles/monitoring.viewer'
  ]) r
),
role_cnt AS (SELECT COUNT(*) AS cnt FROM roles),
user_bindings AS (
  SELECT DISTINCT ON (p.project_id, u.primary_email, r.role_name)
    p.project_id, r.role_name, 'user' AS mtype, u.primary_email AS mid
  FROM projects p
  CROSS JOIN generate_series(0, 9) AS s(i)
  JOIN gw_users u ON u.rn = 1 + ((p.rn * 11 + s.i * 23 + abs(hashint4(p.rn::int * 37 + s.i))) %% u.cnt)
  JOIN roles r ON r.role_rn = 1 + ((p.rn * 3 + s.i * 7) %% (SELECT cnt FROM role_cnt))
  WHERE s.i < (6 + abs(hashint4(p.rn::int * 53)) %% 4)
),
group_bindings AS (
  SELECT DISTINCT ON (p.project_id, g.email, r.role_name)
    p.project_id, r.role_name, 'group' AS mtype, g.email AS mid
  FROM projects p
  CROSS JOIN generate_series(0, 5) AS s(i)
  JOIN gw_groups g ON g.rn = 1 + ((p.rn * 5 + s.i * 11 + abs(hashint4(p.rn::int * 29 + s.i))) %% g.cnt)
  JOIN roles r ON r.role_rn = 1 + ((p.rn * 2 + s.i * 3) %% (SELECT cnt FROM role_cnt))
  WHERE s.i < (3 + abs(hashint4(p.rn::int * 41)) %% 3)
),
all_b AS (SELECT * FROM user_bindings UNION ALL SELECT * FROM group_bindings)
INSERT INTO gcp_project_iam_bindings
  (id, tenant_id, project_id, role, member_type, member_id,
   raw_response, created_at, updated_at, last_synced_at)
SELECT gen_random_uuid(), '%(tid)s', project_id, role_name, mtype, mid,
  jsonb_build_object('role', role_name, 'member', mtype || ':' || mid),
  '%(sync)s'::timestamptz, '%(sync)s'::timestamptz, '%(sync)s'::timestamptz
FROM all_b
ON CONFLICT (tenant_id, project_id, role, member_type, member_id) DO NOTHING;
""" % {"tid": TENANT_ID, "sync": SYNC_TS}


def sql_backfill_grants() -> str:
    """Backfill the denormalised resource_access_grants table."""
    return """
-- Backfill resource_access_grants from all provider sources
WITH
tid AS (SELECT '%(tid)s'::uuid AS v),

-- AWS: group-level account assignments
aws_grp AS (
  SELECT 'aws' AS provider, 'account' AS resource_type,
    aa.account_id AS resource_id, acct.name AS resource_display_name,
    'group' AS subject_type, aa.principal_id AS subject_provider_id,
    grp.display_name AS subject_display_name, NULL::uuid AS canonical_user_id,
    aa.permission_set_name AS role_or_permission, 'direct' AS access_path,
    NULL AS via_group_id, NULL AS via_group_display_name
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
  (id, tenant_id, provider, resource_type, resource_id, resource_display_name,
   subject_type, subject_provider_id, subject_display_name, canonical_user_id,
   role_or_permission, access_path, via_group_id, via_group_display_name,
   raw_response, created_at, updated_at, last_synced_at)
SELECT DISTINCT ON (provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission)
  gen_random_uuid(), (SELECT v FROM tid),
  provider, resource_type, resource_id, resource_display_name,
  subject_type, subject_provider_id, subject_display_name, canonical_user_id,
  role_or_permission, access_path, via_group_id, via_group_display_name,
  '{}'::jsonb, '%(sync)s'::timestamptz, '%(sync)s'::timestamptz, '%(sync)s'::timestamptz
FROM combined
ORDER BY provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission
ON CONFLICT (tenant_id, provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission) DO NOTHING;
""" % {"tid": TENANT_ID, "sync": SYNC_TS}


def generate_full_sql() -> str:
    parts = [
        "-- Auto-generated by scripts/seed_cloud_resources.py",
        "-- Repeatable: safe to run multiple times (uses ON CONFLICT DO NOTHING + TRUNCATE)",
        "",
        "BEGIN;",
        "SELECT setseed(0.42);",
        "",
        "-- Truncate target tables",
        sql_truncate(),
        "-- 1. AWS Accounts",
        sql_aws_accounts(),
        "-- 2. GCP Organisation",
        sql_gcp_org(),
        "-- 3. GCP Projects",
        sql_gcp_projects(),
        "-- 4. AWS Account Assignments",
        sql_aws_account_assignments(),
        "-- 5. GCP IAM Bindings",
        sql_gcp_iam_bindings(),
        "-- 6. Backfill resource_access_grants",
        sql_backfill_grants(),
        "COMMIT;",
        "",
        "-- Verification counts",
        "SELECT 'aws_accounts' AS tbl, COUNT(*) FROM aws_accounts WHERE tenant_id = '%s'" % TENANT_ID,
        "UNION ALL SELECT 'aws_account_assignments', COUNT(*) FROM aws_account_assignments WHERE tenant_id = '%s'" % TENANT_ID,
        "UNION ALL SELECT 'gcp_organisations', COUNT(*) FROM gcp_organisations WHERE tenant_id = '%s'" % TENANT_ID,
        "UNION ALL SELECT 'gcp_projects', COUNT(*) FROM gcp_projects WHERE tenant_id = '%s'" % TENANT_ID,
        "UNION ALL SELECT 'gcp_project_iam_bindings', COUNT(*) FROM gcp_project_iam_bindings WHERE tenant_id = '%s'" % TENANT_ID,
        "UNION ALL SELECT 'resource_access_grants', COUNT(*) FROM resource_access_grants WHERE tenant_id = '%s'" % TENANT_ID,
        "ORDER BY tbl;",
    ]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Seed cloud resources into PostgreSQL")
    parser.add_argument("--dsn", default=os.environ.get("DATABASE_URL", ""),
                        help="PostgreSQL DSN (default: $DATABASE_URL)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print generated SQL instead of executing")
    parser.add_argument("--output", "-o", default=None,
                        help="Write SQL to file instead of executing")
    args = parser.parse_args()

    sql = generate_full_sql()

    if args.dry_run or args.output:
        if args.output:
            with open(args.output, "w") as f:
                f.write(sql)
            print(f"SQL written to {args.output}")
        else:
            print(sql)
        return

    if not args.dsn:
        print("ERROR: No database connection. Set DATABASE_URL or use --dsn.", file=sys.stderr)
        print("       Use --dry-run to print SQL without executing.", file=sys.stderr)
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(args.dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            # Fetch verification results
            cur.execute("""
                SELECT 'aws_accounts', COUNT(*) FROM aws_accounts WHERE tenant_id = %s
                UNION ALL SELECT 'aws_account_assignments', COUNT(*) FROM aws_account_assignments WHERE tenant_id = %s
                UNION ALL SELECT 'gcp_organisations', COUNT(*) FROM gcp_organisations WHERE tenant_id = %s
                UNION ALL SELECT 'gcp_projects', COUNT(*) FROM gcp_projects WHERE tenant_id = %s
                UNION ALL SELECT 'gcp_project_iam_bindings', COUNT(*) FROM gcp_project_iam_bindings WHERE tenant_id = %s
                UNION ALL SELECT 'resource_access_grants', COUNT(*) FROM resource_access_grants WHERE tenant_id = %s
                ORDER BY 1
            """, (TENANT_ID,) * 6)
            print("Seed complete. Row counts:")
            for table, count in cur.fetchall():
                print(f"  {table:40s} {count:>6}")
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
