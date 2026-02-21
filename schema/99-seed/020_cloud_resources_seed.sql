-- ============================================================
-- 99-seed . Cloud Resources & Relationship Matrix
-- Seed: 0.42 (deterministic, matches 010_mock_data.sql)
--
-- Requires: 010_mock_data.sql loaded first.
--
-- Dataset shape (same tenant: 11111111-1111-1111-1111-111111111111):
--   - 12 AWS accounts (1 management + 11 workload)
--   - ~240 AWS account assignments (IDC groups → accounts via permission sets)
--   - 1 GCP organisation
--   - 15 GCP projects
--   - ~180 GCP project IAM bindings (users + groups)
--   - ~800+ resource_access_grants (denormalised cross-provider matrix)
-- ============================================================

BEGIN;

SELECT setseed(0.42);

-- ============================================================
-- 1. AWS Accounts (12)
-- ============================================================
-- Realistic multi-account structure: management + workload accounts

TRUNCATE aws_accounts CASCADE;
TRUNCATE aws_account_assignments CASCADE;
TRUNCATE gcp_organisations CASCADE;
TRUNCATE gcp_projects CASCADE;
TRUNCATE gcp_project_iam_bindings CASCADE;
TRUNCATE resource_access_grants CASCADE;

INSERT INTO aws_accounts (id, tenant_id, account_id, name, email, status, joined_method, joined_at, org_id, parent_id, raw_response, created_at, updated_at, last_synced_at)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333001', 'demo-management', 'aws-mgmt@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-01-15T09:00:00Z', 'o-demo0org001', 'r-root001',
   '{"AccountType": "management"}'::jsonb,
   '2024-01-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333002', 'demo-security', 'aws-security@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-02-01T10:00:00Z', 'o-demo0org001', 'ou-security',
   '{"AccountType": "security"}'::jsonb,
   '2024-02-01T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333003', 'demo-log-archive', 'aws-logs@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-02-01T10:30:00Z', 'o-demo0org001', 'ou-security',
   '{"AccountType": "log-archive"}'::jsonb,
   '2024-02-01T10:30:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333004', 'demo-networking', 'aws-network@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-03-01T09:00:00Z', 'o-demo0org001', 'ou-infrastructure',
   '{"AccountType": "shared-services"}'::jsonb,
   '2024-03-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333005', 'demo-shared-services', 'aws-shared@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-03-15T09:00:00Z', 'o-demo0org001', 'ou-infrastructure',
   '{"AccountType": "shared-services"}'::jsonb,
   '2024-03-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333006', 'demo-dev', 'aws-dev@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-04-01T09:00:00Z', 'o-demo0org001', 'ou-workloads-dev',
   '{"AccountType": "workload", "Environment": "development"}'::jsonb,
   '2024-04-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333007', 'demo-staging', 'aws-staging@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-04-01T10:00:00Z', 'o-demo0org001', 'ou-workloads-staging',
   '{"AccountType": "workload", "Environment": "staging"}'::jsonb,
   '2024-04-01T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333008', 'demo-production', 'aws-prod@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-04-15T09:00:00Z', 'o-demo0org001', 'ou-workloads-prod',
   '{"AccountType": "workload", "Environment": "production"}'::jsonb,
   '2024-04-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333009', 'demo-data-dev', 'aws-data-dev@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-05-01T09:00:00Z', 'o-demo0org001', 'ou-workloads-dev',
   '{"AccountType": "workload", "Environment": "development", "Team": "data"}'::jsonb,
   '2024-05-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333010', 'demo-data-prod', 'aws-data-prod@demo-example.co.uk', 'ACTIVE', 'CREATED',
   '2024-05-01T10:00:00Z', 'o-demo0org001', 'ou-workloads-prod',
   '{"AccountType": "workload", "Environment": "production", "Team": "data"}'::jsonb,
   '2024-05-01T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333011', 'demo-ml-sandbox', 'aws-ml@demo-example.co.uk', 'ACTIVE', 'INVITED',
   '2024-06-01T09:00:00Z', 'o-demo0org001', 'ou-sandbox',
   '{"AccountType": "sandbox", "Team": "ml"}'::jsonb,
   '2024-06-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   '111222333012', 'demo-deprecated', 'aws-old@demo-example.co.uk', 'SUSPENDED', 'CREATED',
   '2024-01-20T09:00:00Z', 'o-demo0org001', 'ou-suspended',
   '{"AccountType": "deprecated", "SuspendReason": "migration_complete"}'::jsonb,
   '2024-01-20T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z');


-- ============================================================
-- 2. AWS Account Assignments (~240)
-- ============================================================
-- Maps IDC groups to accounts via permission sets.
-- Pattern: each account gets 2-4 groups with different permission sets.

WITH
tenant AS (SELECT '11111111-1111-1111-1111-111111111111'::uuid AS tid),
accounts AS (
  SELECT account_id, name,
         ROW_NUMBER() OVER (ORDER BY account_id) AS acct_rn
  FROM aws_accounts
  WHERE tenant_id = (SELECT tid FROM tenant)
    AND status = 'ACTIVE'  -- skip suspended account
),
idc_groups_numbered AS (
  SELECT group_id, display_name, identity_store_id,
         ROW_NUMBER() OVER (ORDER BY id) AS grp_rn,
         COUNT(*) OVER () AS grp_cnt
  FROM aws_identity_center_groups
  WHERE tenant_id = (SELECT tid FROM tenant)
),
-- Permission sets (realistic names + ARNs)
psets(pset_name, pset_arn) AS (VALUES
  ('AdministratorAccess',   'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-admin'),
  ('PowerUserAccess',       'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-poweruser'),
  ('ReadOnlyAccess',        'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-readonly'),
  ('ViewOnlyAccess',        'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-viewonly'),
  ('DatabaseAdminAccess',   'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-dba'),
  ('NetworkAdminAccess',    'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-netadmin'),
  ('SecurityAuditAccess',   'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-secaudit'),
  ('BillingAccess',         'arn:aws:sso:::permissionSet/ssoins-demo0001/ps-billing')
),
psets_numbered AS (
  SELECT pset_name, pset_arn,
         ROW_NUMBER() OVER (ORDER BY pset_name) AS ps_rn,
         COUNT(*) OVER () AS ps_cnt
  FROM psets
),
-- Generate assignments: each account × multiple (group, permission_set) combos
-- ~20 assignments per active account ≈ 220 total
assignments AS (
  SELECT DISTINCT ON (a.account_id, g.group_id, ps.pset_arn)
    a.account_id,
    g.group_id,
    g.identity_store_id,
    g.display_name AS group_display_name,
    ps.pset_name,
    ps.pset_arn
  FROM accounts a
  CROSS JOIN generate_series(0, 21) AS slot(s)
  JOIN idc_groups_numbered g
    ON g.grp_rn = 1 + ((a.acct_rn * 7 + slot.s * 13 + abs(hashint4(a.acct_rn::int * 41 + slot.s))) % g.grp_cnt)
  JOIN psets_numbered ps
    ON ps.ps_rn = 1 + ((a.acct_rn * 3 + slot.s * 5) % ps.ps_cnt)
  WHERE slot.s < (15 + abs(hashint4(a.acct_rn::int * 19)) % 8)
)
INSERT INTO aws_account_assignments
  (id, tenant_id, identity_store_id, account_id, permission_set_arn, permission_set_name, principal_type, principal_id, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  (SELECT tid FROM tenant),
  asg.identity_store_id,
  asg.account_id,
  asg.pset_arn,
  asg.pset_name,
  'GROUP',
  asg.group_id,
  jsonb_build_object('AccountId', asg.account_id, 'PermissionSetName', asg.pset_name, 'GroupName', asg.group_display_name),
  '2024-06-15T10:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM assignments asg;


-- ============================================================
-- 3. GCP Organisation (1)
-- ============================================================

INSERT INTO gcp_organisations (id, tenant_id, org_id, display_name, domain, lifecycle_state, raw_response, created_at, updated_at, last_synced_at)
VALUES (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'organizations/901234567890',
  'Demo Engineering Org',
  'demo-example.co.uk',
  'ACTIVE',
  '{"creationTime": "2024-01-10T08:00:00Z", "orgPolicy": []}'::jsonb,
  '2024-01-10T08:00:00Z',
  '2026-02-14T00:00:00Z',
  '2026-02-14T00:00:00Z'
);


-- ============================================================
-- 4. GCP Projects (15)
-- ============================================================

INSERT INTO gcp_projects (id, tenant_id, project_id, project_number, display_name, lifecycle_state, org_id, folder_id, labels, raw_response, created_at, updated_at, last_synced_at)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-platform-prod', '100000000001', 'Platform Production', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "platform"}'::jsonb,
   '{}'::jsonb, '2024-03-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-platform-dev', '100000000002', 'Platform Development', 'ACTIVE',
   'organizations/901234567890', 'folders/dev',
   '{"env": "development", "team": "platform"}'::jsonb,
   '{}'::jsonb, '2024-03-01T09:30:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-data-analytics', '100000000003', 'Data Analytics', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "data"}'::jsonb,
   '{}'::jsonb, '2024-04-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-data-warehouse', '100000000004', 'Data Warehouse', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "data"}'::jsonb,
   '{}'::jsonb, '2024-04-01T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-ml-training', '100000000005', 'ML Training', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "ml"}'::jsonb,
   '{}'::jsonb, '2024-05-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-ml-sandbox', '100000000006', 'ML Sandbox', 'ACTIVE',
   'organizations/901234567890', 'folders/sandbox',
   '{"env": "sandbox", "team": "ml"}'::jsonb,
   '{}'::jsonb, '2024-05-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-security-ops', '100000000007', 'Security Operations', 'ACTIVE',
   'organizations/901234567890', 'folders/security',
   '{"env": "production", "team": "security"}'::jsonb,
   '{}'::jsonb, '2024-03-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-networking-hub', '100000000008', 'Networking Hub', 'ACTIVE',
   'organizations/901234567890', 'folders/infrastructure',
   '{"env": "production", "team": "infrastructure"}'::jsonb,
   '{}'::jsonb, '2024-03-15T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-frontend-prod', '100000000009', 'Frontend Production', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "frontend"}'::jsonb,
   '{}'::jsonb, '2024-06-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-frontend-dev', '100000000010', 'Frontend Development', 'ACTIVE',
   'organizations/901234567890', 'folders/dev',
   '{"env": "development", "team": "frontend"}'::jsonb,
   '{}'::jsonb, '2024-06-01T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-billing-prod', '100000000011', 'Billing Production', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "billing"}'::jsonb,
   '{}'::jsonb, '2024-07-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-ci-cd', '100000000012', 'CI/CD Pipelines', 'ACTIVE',
   'organizations/901234567890', 'folders/infrastructure',
   '{"env": "production", "team": "devops"}'::jsonb,
   '{}'::jsonb, '2024-04-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-monitoring', '100000000013', 'Monitoring & Observability', 'ACTIVE',
   'organizations/901234567890', 'folders/infrastructure',
   '{"env": "production", "team": "sre"}'::jsonb,
   '{}'::jsonb, '2024-04-15T10:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-api-gateway-prod', '100000000014', 'API Gateway Production', 'ACTIVE',
   'organizations/901234567890', 'folders/prod',
   '{"env": "production", "team": "backend"}'::jsonb,
   '{}'::jsonb, '2024-08-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   'demo-decommissioned', '100000000015', 'Decommissioned Project', 'DELETE_REQUESTED',
   'organizations/901234567890', NULL,
   '{"env": "deprecated"}'::jsonb,
   '{}'::jsonb, '2024-02-01T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z');


-- ============================================================
-- 5. GCP Project IAM Bindings (~180)
-- ============================================================
-- Mix of user: and group: bindings across projects.

WITH
tenant AS (SELECT '11111111-1111-1111-1111-111111111111'::uuid AS tid),
projects AS (
  SELECT project_id, display_name,
         ROW_NUMBER() OVER (ORDER BY project_id) AS proj_rn
  FROM gcp_projects
  WHERE tenant_id = (SELECT tid FROM tenant)
    AND lifecycle_state = 'ACTIVE'
),
-- Google Workspace users (use email as member_id)
gw_users_numbered AS (
  SELECT primary_email,
         ROW_NUMBER() OVER (ORDER BY id) AS user_rn,
         COUNT(*) OVER () AS user_cnt
  FROM google_workspace_users
  WHERE tenant_id = (SELECT tid FROM tenant)
),
-- Google Workspace groups (use email as member_id)
gw_groups_numbered AS (
  SELECT email,
         ROW_NUMBER() OVER (ORDER BY id) AS grp_rn,
         COUNT(*) OVER () AS grp_cnt
  FROM google_workspace_groups
  WHERE tenant_id = (SELECT tid FROM tenant)
),
-- GCP roles
roles(role_name) AS (VALUES
  ('roles/viewer'),
  ('roles/editor'),
  ('roles/owner'),
  ('roles/bigquery.dataViewer'),
  ('roles/bigquery.dataEditor'),
  ('roles/storage.objectViewer'),
  ('roles/storage.admin'),
  ('roles/compute.viewer'),
  ('roles/compute.admin'),
  ('roles/iam.securityReviewer'),
  ('roles/logging.viewer'),
  ('roles/monitoring.viewer')
),
roles_numbered AS (
  SELECT role_name,
         ROW_NUMBER() OVER (ORDER BY role_name) AS role_rn,
         COUNT(*) OVER () AS role_cnt
  FROM roles
),
-- User bindings: each project gets ~8 direct user bindings
user_bindings AS (
  SELECT DISTINCT ON (p.project_id, u.primary_email, r.role_name)
    p.project_id,
    r.role_name,
    'user' AS member_type,
    u.primary_email AS member_id
  FROM projects p
  CROSS JOIN generate_series(0, 9) AS slot(s)
  JOIN gw_users_numbered u
    ON u.user_rn = 1 + ((p.proj_rn * 11 + slot.s * 23 + abs(hashint4(p.proj_rn::int * 37 + slot.s))) % u.user_cnt)
  JOIN roles_numbered r
    ON r.role_rn = 1 + ((p.proj_rn * 3 + slot.s * 7) % r.role_cnt)
  WHERE slot.s < (6 + abs(hashint4(p.proj_rn::int * 53)) % 4)
),
-- Group bindings: each project gets ~4 group bindings
group_bindings AS (
  SELECT DISTINCT ON (p.project_id, g.email, r.role_name)
    p.project_id,
    r.role_name,
    'group' AS member_type,
    g.email AS member_id
  FROM projects p
  CROSS JOIN generate_series(0, 5) AS slot(s)
  JOIN gw_groups_numbered g
    ON g.grp_rn = 1 + ((p.proj_rn * 5 + slot.s * 11 + abs(hashint4(p.proj_rn::int * 29 + slot.s))) % g.grp_cnt)
  JOIN roles_numbered r
    ON r.role_rn = 1 + ((p.proj_rn * 2 + slot.s * 3) % r.role_cnt)
  WHERE slot.s < (3 + abs(hashint4(p.proj_rn::int * 41)) % 3)
),
all_bindings AS (
  SELECT * FROM user_bindings
  UNION ALL
  SELECT * FROM group_bindings
)
INSERT INTO gcp_project_iam_bindings
  (id, tenant_id, project_id, role, member_type, member_id, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  (SELECT tid FROM tenant),
  b.project_id,
  b.role_name,
  b.member_type,
  b.member_id,
  jsonb_build_object('role', b.role_name, 'member', b.member_type || ':' || b.member_id),
  '2024-06-15T10:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM all_bindings b;


-- ============================================================
-- 6. Backfill resource_access_grants (cross-provider matrix)
-- ============================================================
-- This denormalised table combines:
--   A) AWS account assignments (group-level, expanded to member users)
--   B) GCP project IAM bindings (user + group)
--   C) GitHub repo permissions (team + collaborator)

WITH
tenant AS (SELECT '11111111-1111-1111-1111-111111111111'::uuid AS tid),

-- ── A. AWS: expand group assignments to individual users ──
aws_group_grants AS (
  SELECT
    aa.account_id       AS resource_id,
    acct.name           AS resource_display_name,
    'GROUP'             AS subject_type_raw,
    aa.principal_id     AS subject_provider_id,
    grp.display_name    AS subject_display_name,
    NULL::uuid          AS canonical_user_id,
    aa.permission_set_name AS role_or_permission,
    'direct'            AS access_path,
    NULL                AS via_group_id,
    NULL                AS via_group_display_name
  FROM aws_account_assignments aa
  JOIN aws_accounts acct ON acct.account_id = aa.account_id AND acct.tenant_id = aa.tenant_id
  JOIN aws_identity_center_groups grp ON grp.group_id = aa.principal_id AND grp.tenant_id = aa.tenant_id
  WHERE aa.tenant_id = (SELECT tid FROM tenant)
    AND aa.principal_type = 'GROUP'
    AND aa.deleted_at IS NULL
),
aws_user_grants AS (
  SELECT
    aa.account_id         AS resource_id,
    acct.name             AS resource_display_name,
    'user'                AS subject_type_raw,
    mem.member_user_id    AS subject_provider_id,
    usr.display_name      AS subject_display_name,
    (SELECT cupl.canonical_user_id
     FROM canonical_user_provider_links cupl
     WHERE cupl.tenant_id = (SELECT tid FROM tenant)
       AND cupl.provider_type = 'AWS_IDENTITY_CENTER'
       AND cupl.provider_user_id = mem.member_user_id
     LIMIT 1)             AS canonical_user_id,
    aa.permission_set_name AS role_or_permission,
    'group'               AS access_path,
    aa.principal_id       AS via_group_id,
    grp.display_name      AS via_group_display_name
  FROM aws_account_assignments aa
  JOIN aws_accounts acct ON acct.account_id = aa.account_id AND acct.tenant_id = aa.tenant_id
  JOIN aws_identity_center_groups grp ON grp.group_id = aa.principal_id AND grp.tenant_id = aa.tenant_id
  JOIN aws_identity_center_memberships mem
    ON mem.group_id = aa.principal_id AND mem.tenant_id = aa.tenant_id AND mem.deleted_at IS NULL
  JOIN aws_identity_center_users usr
    ON usr.user_id = mem.member_user_id AND usr.tenant_id = aa.tenant_id
  WHERE aa.tenant_id = (SELECT tid FROM tenant)
    AND aa.principal_type = 'GROUP'
    AND aa.deleted_at IS NULL
),

-- ── B. GCP: user and group bindings ──
gcp_user_grants AS (
  SELECT
    ib.project_id       AS resource_id,
    proj.display_name   AS resource_display_name,
    'user'              AS subject_type_raw,
    ib.member_id        AS subject_provider_id,
    gw.name_full        AS subject_display_name,
    (SELECT cupl.canonical_user_id
     FROM canonical_user_provider_links cupl
     JOIN google_workspace_users gwu ON gwu.google_id = cupl.provider_user_id AND gwu.tenant_id = cupl.tenant_id
     WHERE cupl.tenant_id = (SELECT tid FROM tenant)
       AND cupl.provider_type = 'GOOGLE_WORKSPACE'
       AND gwu.primary_email = ib.member_id
     LIMIT 1)           AS canonical_user_id,
    ib.role             AS role_or_permission,
    'direct'            AS access_path,
    NULL                AS via_group_id,
    NULL                AS via_group_display_name
  FROM gcp_project_iam_bindings ib
  JOIN gcp_projects proj ON proj.project_id = ib.project_id AND proj.tenant_id = ib.tenant_id
  LEFT JOIN google_workspace_users gw ON gw.primary_email = ib.member_id AND gw.tenant_id = ib.tenant_id
  WHERE ib.tenant_id = (SELECT tid FROM tenant)
    AND ib.member_type = 'user'
    AND ib.deleted_at IS NULL
),
gcp_group_grants AS (
  SELECT
    ib.project_id       AS resource_id,
    proj.display_name   AS resource_display_name,
    'group'             AS subject_type_raw,
    ib.member_id        AS subject_provider_id,
    gwg.name            AS subject_display_name,
    NULL::uuid          AS canonical_user_id,
    ib.role             AS role_or_permission,
    'direct'            AS access_path,
    NULL                AS via_group_id,
    NULL                AS via_group_display_name
  FROM gcp_project_iam_bindings ib
  JOIN gcp_projects proj ON proj.project_id = ib.project_id AND proj.tenant_id = ib.tenant_id
  LEFT JOIN google_workspace_groups gwg ON gwg.email = ib.member_id AND gwg.tenant_id = ib.tenant_id
  WHERE ib.tenant_id = (SELECT tid FROM tenant)
    AND ib.member_type = 'group'
    AND ib.deleted_at IS NULL
),

-- ── C. GitHub: team + collaborator repo permissions ──
gh_team_grants AS (
  SELECT
    rtp.repo_node_id    AS resource_id,
    repo.full_name      AS resource_display_name,
    'team'              AS subject_type_raw,
    rtp.team_node_id    AS subject_provider_id,
    tm.name             AS subject_display_name,
    NULL::uuid          AS canonical_user_id,
    rtp.permission      AS role_or_permission,
    'direct'            AS access_path,
    NULL                AS via_group_id,
    NULL                AS via_group_display_name
  FROM github_repo_team_permissions rtp
  JOIN github_repositories repo ON repo.node_id = rtp.repo_node_id AND repo.tenant_id = rtp.tenant_id
  JOIN github_teams tm ON tm.node_id = rtp.team_node_id AND tm.tenant_id = rtp.tenant_id
  WHERE rtp.tenant_id = (SELECT tid FROM tenant)
    AND rtp.deleted_at IS NULL
),
gh_collab_grants AS (
  SELECT
    rcp.repo_node_id    AS resource_id,
    repo.full_name      AS resource_display_name,
    'user'              AS subject_type_raw,
    rcp.user_node_id    AS subject_provider_id,
    gu.name             AS subject_display_name,
    (SELECT cupl.canonical_user_id
     FROM canonical_user_provider_links cupl
     WHERE cupl.tenant_id = (SELECT tid FROM tenant)
       AND cupl.provider_type = 'GITHUB'
       AND cupl.provider_user_id = rcp.user_node_id
     LIMIT 1)           AS canonical_user_id,
    rcp.permission      AS role_or_permission,
    CASE WHEN rcp.is_outside_collaborator THEN 'direct' ELSE 'direct' END AS access_path,
    NULL                AS via_group_id,
    NULL                AS via_group_display_name
  FROM github_repo_collaborator_permissions rcp
  JOIN github_repositories repo ON repo.node_id = rcp.repo_node_id AND repo.tenant_id = rcp.tenant_id
  JOIN github_users gu ON gu.node_id = rcp.user_node_id AND gu.tenant_id = rcp.tenant_id
  WHERE rcp.tenant_id = (SELECT tid FROM tenant)
    AND rcp.deleted_at IS NULL
),

-- ── Combine all grants ──
all_grants AS (
  -- AWS group-level
  SELECT 'aws' AS provider, 'account' AS resource_type, * FROM aws_group_grants
  UNION ALL
  -- AWS user-level (expanded from groups) — limit to avoid explosion
  SELECT 'aws', 'account', * FROM aws_user_grants
  UNION ALL
  -- GCP user
  SELECT 'gcp', 'project', * FROM gcp_user_grants
  UNION ALL
  -- GCP group
  SELECT 'gcp', 'project', * FROM gcp_group_grants
  UNION ALL
  -- GitHub team
  SELECT 'github', 'repository', * FROM gh_team_grants
  UNION ALL
  -- GitHub collaborator
  SELECT 'github', 'repository', * FROM gh_collab_grants
)
INSERT INTO resource_access_grants
  (id, tenant_id, provider, resource_type, resource_id, resource_display_name,
   subject_type, subject_provider_id, subject_display_name, canonical_user_id,
   role_or_permission, access_path, via_group_id, via_group_display_name,
   raw_response, created_at, updated_at, last_synced_at)
SELECT DISTINCT ON (provider, resource_type, resource_id, subject_type_raw, subject_provider_id, role_or_permission)
  gen_random_uuid(),
  (SELECT tid FROM tenant),
  provider,
  resource_type,
  resource_id,
  resource_display_name,
  subject_type_raw,
  subject_provider_id,
  subject_display_name,
  canonical_user_id,
  role_or_permission,
  access_path,
  via_group_id,
  via_group_display_name,
  '{}'::jsonb,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM all_grants
ORDER BY provider, resource_type, resource_id, subject_type_raw, subject_provider_id, role_or_permission;

COMMIT;
