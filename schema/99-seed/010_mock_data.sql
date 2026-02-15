-- ============================================================
-- 99-seed . Mock Data (1,000 persons, ~1,100 identities)
-- Seed: 42 (deterministic)
--
-- Dataset shape:
--   - 2 tenants: "Northwind Holdings" (northwind), "Southbank Digital" (southbank)
--   - 1,000 persons total: 700 northwind, 300 southbank
--   - 100 AWS accounts (70 northwind, 30 southbank)
--   - 120 GCP projects (80 northwind, 40 southbank)
--   - ~580 AWS IDC users, ~520 GCP Workspace users, ~150 AWS IAM users
--   - 2 GitHub organisations, ~400 GitHub users (280 northwind, 120 southbank)
--   - 30 GitHub teams, ~1,200 GitHub team memberships, ~400 GitHub org memberships
--   - 180 AWS IDC groups, 160 GCP Workspace groups
--   - ~6,800 AWS IDC group memberships, ~5,200 GCP Workspace group memberships
--   - 12 AWS IDC permission sets
--   - ~800 AWS IDC account assignments (mix of USER and GROUP)
--   - ~700 GCP IAM bindings (mix of user and group)
--   - ~1,400 person_link rows (incl. ~380 github_user links)
--   - Entity history rows for ~50 persons (Jan-Feb 2026)
--   - Edge cases: 15 suspended GCP users, 20 departed persons,
--     30 stale accounts, 5 mismatched display_name users, 20 noreply GitHub users
-- ============================================================

BEGIN;

-- 0. Seed randomness
SELECT setseed(0.42);

-- ============================================================
-- Helper arrays for deterministic name generation
-- ============================================================
DO $$
BEGIN
  -- We use these in the INSERT CTEs below via array indexing
  -- Declared here as documentation; actual arrays are inline
  NULL;
END;
$$;

-- ============================================================
-- 1. Tenants
-- ============================================================

INSERT INTO tenant (id, tenant_name, slug, created_at, deleted_at, raw_payload)
VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'Northwind Holdings', 'northwind',
   '2025-01-15T09:00:00Z', NULL, '{"industry": "financial_services", "tier": "enterprise"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000001'::uuid, 'Southbank Digital', 'southbank',
   '2025-03-01T10:30:00Z', NULL, '{"industry": "technology", "tier": "growth"}'::jsonb);

-- ============================================================
-- 2. Persons (1,000 total: 700 northwind, 300 southbank)
-- ============================================================

WITH first_names AS (
  SELECT ARRAY[
    'Oliver','Amelia','George','Isla','Harry','Ava','Jack','Mia','Jacob','Emily',
    'Charlie','Lily','Thomas','Sophia','Oscar','Grace','William','Freya','James',
    'Charlotte','Henry','Ella','Alexander','Poppy','Edward','Daisy','Samuel','Rosie',
    'Daniel','Alice','Joseph','Florence','David','Matilda','Arthur','Ruby','Noah',
    'Evie','Leo','Sienna','Freddie','Phoebe','Archie','Willow','Ethan','Ivy',
    'Sebastian','Elsie','Adam','Jessica'
  ] AS arr
),
surnames AS (
  SELECT ARRAY[
    'Smith','Jones','Williams','Taylor','Brown','Davies','Evans','Wilson','Thomas',
    'Roberts','Johnson','Lewis','Walker','Robinson','Wood','Thompson','White','Watson',
    'Jackson','Wright','Green','Harris','Cooper','King','Lee','Martin','Clarke','James',
    'Morgan','Hughes','Edwards','Hill','Moore','Clark','Harrison','Scott','Young',
    'Morris','Hall','Ward','Turner','Carter','Phillips','Mitchell','Patel','Adams',
    'Campbell','Anderson','Allen','Cook'
  ] AS arr
)
INSERT INTO person (id, tenant_id, display_name, primary_email, hr_employee_id, status, created_at, updated_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  CASE WHEN i <= 700
    THEN 'a0000000-0000-0000-0000-000000000001'::uuid
    ELSE 'b0000000-0000-0000-0000-000000000001'::uuid
  END,
  fn.arr[1 + abs(hashint4(i + 42)) % 50] || ' ' || sn.arr[1 + abs(hashint4(i * 7 + 42)) % 50],
  lower(fn.arr[1 + abs(hashint4(i + 42)) % 50]) || '.' ||
    lower(sn.arr[1 + abs(hashint4(i * 7 + 42)) % 50]) || i::text || '@demo-example.co.uk',
  'EMP' || lpad(i::text, 5, '0'),
  'active',
  '2025-01-01T00:00:00Z'::timestamptz + (i % 365) * interval '1 day',
  '2026-01-15T00:00:00Z'::timestamptz + (i % 30) * interval '1 day',
  NULL,
  jsonb_build_object('department', (ARRAY['Engineering','Finance','Marketing','Operations','Legal','HR','Sales','Support','Product','Data'])[1 + abs(hashint4(i * 13)) % 10],
                     'location', (ARRAY['London','Manchester','Edinburgh','Bristol','Birmingham','Leeds','Glasgow','Cardiff','Belfast','Cambridge'])[1 + abs(hashint4(i * 17)) % 10])
FROM generate_series(1, 1000) AS i,
     first_names fn,
     surnames sn;

-- ============================================================
-- 3. AWS Accounts (100: 70 northwind, 30 southbank)
-- ============================================================

INSERT INTO aws_account (id, tenant_id, account_id, account_name, org_id, status, tags, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  CASE WHEN i <= 70
    THEN 'a0000000-0000-0000-0000-000000000001'::uuid
    ELSE 'b0000000-0000-0000-0000-000000000001'::uuid
  END,
  lpad((100000000000 + i)::text, 12, '0'),
  CASE WHEN i <= 70
    THEN 'nw-' || (ARRAY['prod','staging','dev','sandbox','shared','security','logging','network','data','ml'])[1 + (i - 1) % 10] || '-' || lpad(((i - 1) / 10 + 1)::text, 2, '0')
    ELSE 'sb-' || (ARRAY['prod','staging','dev','sandbox','shared','security','logging','network','data','ml'])[1 + (i - 71) % 10] || '-' || lpad(((i - 71) / 10 + 1)::text, 2, '0')
  END,
  CASE WHEN i <= 70 THEN 'o-northwind001' ELSE 'o-southbank01' END,
  'ACTIVE',
  jsonb_build_object('environment', (ARRAY['production','staging','development','sandbox'])[1 + (i - 1) % 4],
                     'cost_centre', 'CC' || lpad((i * 100)::text, 6, '0')),
  'organizations_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM generate_series(1, 100) AS i;

-- ============================================================
-- 4. GCP Projects (120: 80 northwind, 40 southbank)
-- ============================================================

INSERT INTO gcp_project (id, tenant_id, project_id, project_number, project_name, org_id, folder_id, lifecycle_state, labels, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  CASE WHEN i <= 80
    THEN 'a0000000-0000-0000-0000-000000000001'::uuid
    ELSE 'b0000000-0000-0000-0000-000000000001'::uuid
  END,
  CASE WHEN i <= 80
    THEN 'prj-northwind-' || lpad(i::text, 3, '0')
    ELSE 'prj-southbank-' || lpad((i - 80)::text, 3, '0')
  END,
  100000000 + i,
  CASE WHEN i <= 80
    THEN 'Northwind ' || (ARRAY['Platform','Analytics','Frontend','Backend','Data','ML','Infra','Security','Mobile','API'])[1 + (i - 1) % 10] || ' ' || ((i - 1) / 10 + 1)::text
    ELSE 'Southbank ' || (ARRAY['Platform','Analytics','Frontend','Backend','Data','ML','Infra','Security','Mobile','API'])[1 + (i - 81) % 10] || ' ' || ((i - 81) / 10 + 1)::text
  END,
  CASE WHEN i <= 80 THEN '123456789010' ELSE '987654321010' END,
  CASE WHEN i <= 80
    THEN 'folders/' || (1000 + (i - 1) / 10)::text
    ELSE 'folders/' || (2000 + (i - 81) / 10)::text
  END,
  'ACTIVE',
  jsonb_build_object('env', (ARRAY['prod','staging','dev','sandbox'])[1 + (i - 1) % 4],
                     'team', (ARRAY['platform','data','security','frontend','backend'])[1 + (i - 1) % 5]),
  'resource_manager_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM generate_series(1, 120) AS i;

-- ============================================================
-- 5. AWS IDC Users (~580: ~410 northwind, ~170 southbank)
-- ============================================================
-- We pick the first 580 persons and assign them IDC identities.
-- Persons 1-410 are northwind IDC users, persons 701-870 are southbank IDC users.

WITH first_names AS (
  SELECT ARRAY[
    'Oliver','Amelia','George','Isla','Harry','Ava','Jack','Mia','Jacob','Emily',
    'Charlie','Lily','Thomas','Sophia','Oscar','Grace','William','Freya','James',
    'Charlotte','Henry','Ella','Alexander','Poppy','Edward','Daisy','Samuel','Rosie',
    'Daniel','Alice','Joseph','Florence','David','Matilda','Arthur','Ruby','Noah',
    'Evie','Leo','Sienna','Freddie','Phoebe','Archie','Willow','Ethan','Ivy',
    'Sebastian','Elsie','Adam','Jessica'
  ] AS arr
),
surnames AS (
  SELECT ARRAY[
    'Smith','Jones','Williams','Taylor','Brown','Davies','Evans','Wilson','Thomas',
    'Roberts','Johnson','Lewis','Walker','Robinson','Wood','Thompson','White','Watson',
    'Jackson','Wright','Green','Harris','Cooper','King','Lee','Martin','Clarke','James',
    'Morgan','Hughes','Edwards','Hill','Moore','Clark','Harrison','Scott','Young',
    'Morris','Hall','Ward','Turner','Carter','Phillips','Mitchell','Patel','Adams',
    'Campbell','Anderson','Allen','Cook'
  ] AS arr
),
ordered_persons AS (
  SELECT id, tenant_id, display_name, primary_email,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM person
)
INSERT INTO aws_idc_user (id, tenant_id, person_id, identity_store_user_id, identity_store_id, user_name, display_name, email, source_of_truth, ingested_at, last_seen_at, disabled_at, raw_payload)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  p.id,
  'idc-user-' || md5(p.id::text || 'idc'),
  CASE WHEN p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
    THEN 'd-northwind0001' ELSE 'd-southbank001' END,
  p.primary_email,
  p.display_name,
  p.primary_email,
  'identity_store_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM ordered_persons p
WHERE (p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND p.rn <= 410)
   OR (p.tenant_id = 'b0000000-0000-0000-0000-000000000001'::uuid AND p.rn <= 170);

-- ============================================================
-- 6. AWS IAM Users (~150: ~105 northwind, ~45 southbank)
-- ============================================================
-- We pick persons who may or may not already have IDC identities.
-- Use persons with rn 300-404 in northwind (105) and rn 130-174 in southbank (45).

WITH ordered_persons AS (
  SELECT id, tenant_id, display_name, primary_email,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM person
),
ordered_accounts AS (
  SELECT id AS acct_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY account_id) AS acct_rn
  FROM aws_account
)
INSERT INTO aws_iam_user (id, tenant_id, aws_account_id, person_id, iam_user_name, iam_user_id, arn, path, status, created_at, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  a.acct_id,
  p.id,
  split_part(p.primary_email, '@', 1),
  'AIDA' || upper(substr(md5(p.id::text), 1, 17)),
  'arn:aws:iam::' ||
    CASE WHEN p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
      THEN lpad((100000000000 + a.acct_rn)::text, 12, '0')
      ELSE lpad((100000000070 + a.acct_rn)::text, 12, '0')
    END
    || ':user/' || split_part(p.primary_email, '@', 1),
  '/',
  'active',
  '2025-06-01T00:00:00Z'::timestamptz + (p.rn % 180) * interval '1 day',
  'iam_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM ordered_persons p
JOIN ordered_accounts a ON a.tenant_id = p.tenant_id
  AND a.acct_rn = 1 + (p.rn % (CASE WHEN p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid THEN 70 ELSE 30 END))
WHERE (p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND p.rn BETWEEN 300 AND 404)
   OR (p.tenant_id = 'b0000000-0000-0000-0000-000000000001'::uuid AND p.rn BETWEEN 130 AND 174);

-- ============================================================
-- 7. GCP Workspace Users (~520: ~370 northwind, ~150 southbank)
-- ============================================================
-- Use persons with rn 1-370 in northwind and rn 1-150 in southbank.
-- Many of these overlap with IDC users (persons 1-370 in northwind have both).

WITH ordered_persons AS (
  SELECT id, tenant_id, display_name, primary_email,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM person
)
INSERT INTO gcp_workspace_user (id, tenant_id, person_id, gw_user_id, primary_email, customer_id, display_name, suspended, org_unit_path, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  p.id,
  'gw-' || md5(p.id::text || 'gw'),
  p.primary_email,
  CASE WHEN p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
    THEN 'C01northwind' ELSE 'C02southbank' END,
  p.display_name,
  FALSE,
  '/employees/' || (ARRAY['engineering','finance','marketing','operations','legal','hr','sales','support','product','data'])[1 + abs(hashint4(p.rn::int * 13)) % 10],
  'directory_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM ordered_persons p
WHERE (p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND p.rn <= 370)
   OR (p.tenant_id = 'b0000000-0000-0000-0000-000000000001'::uuid AND p.rn <= 150);

-- ============================================================
-- 8. AWS IDC Groups (180: 120 northwind, 60 southbank)
-- ============================================================

INSERT INTO aws_idc_group (id, tenant_id, identity_store_group_id, identity_store_id, display_name, description, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  CASE WHEN i <= 120
    THEN 'a0000000-0000-0000-0000-000000000001'::uuid
    ELSE 'b0000000-0000-0000-0000-000000000001'::uuid
  END,
  'idc-grp-' || lpad(i::text, 4, '0'),
  CASE WHEN i <= 120 THEN 'd-northwind0001' ELSE 'd-southbank001' END,
  (ARRAY['Engineering','Platform','Security','Data','DevOps','SRE','Frontend','Backend','QA','Analytics',
         'ML','Infra','Networking','Database','Compliance','Architecture','Mobile','Cloud','Support','Product'])[1 + (i - 1) % 20]
    || '-' || (ARRAY['Admins','Developers','Viewers','Operators','Analysts','Leads','Contributors','Readers','Writers','Managers'])[1 + ((i - 1) / 20) % 10],
  'AWS IDC group for access management - group ' || i,
  'identity_store_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM generate_series(1, 180) AS i;

-- ============================================================
-- 9. GCP Workspace Groups (160: 110 northwind, 50 southbank)
-- ============================================================

INSERT INTO gcp_workspace_group (id, tenant_id, gw_group_id, group_email, display_name, description, customer_id, admin_created, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  CASE WHEN i <= 110
    THEN 'a0000000-0000-0000-0000-000000000001'::uuid
    ELSE 'b0000000-0000-0000-0000-000000000001'::uuid
  END,
  'gw-grp-' || lpad(i::text, 4, '0'),
  (ARRAY['eng','platform','sec','data','devops','sre','frontend','backend','qa','analytics',
         'ml','infra','network','dba','compliance','arch','mobile','cloud','support','product'])[1 + (i - 1) % 20]
    || '-' || (ARRAY['team','admins','viewers','ops','leads','contrib','all','reviewers'])[1 + ((i - 1) / 20) % 8]
    || '@demo-example.co.uk',
  (ARRAY['Engineering','Platform','Security','Data','DevOps','SRE','Frontend','Backend','QA','Analytics',
         'ML','Infra','Networking','Database','Compliance','Architecture','Mobile','Cloud','Support','Product'])[1 + (i - 1) % 20]
    || ' ' || (ARRAY['Team','Admins','Viewers','Operators','Leads','Contributors','All','Reviewers'])[1 + ((i - 1) / 20) % 8],
  'GCP Workspace group ' || i,
  CASE WHEN i <= 110 THEN 'C01northwind' ELSE 'C02southbank' END,
  TRUE,
  'directory_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM generate_series(1, 160) AS i;

-- ============================================================
-- 10. AWS IDC Group Memberships (~6,800)
-- ============================================================
-- Each IDC user is placed in ~10-12 groups on average (within their tenant).
-- We use a cross-join approach with modular arithmetic to assign deterministically.

WITH idc_users_numbered AS (
  SELECT id AS user_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS user_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS user_cnt
  FROM aws_idc_user
),
idc_groups_numbered AS (
  SELECT id AS group_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS group_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS group_cnt
  FROM aws_idc_group
),
-- Generate multiple membership slots per user: each user gets assigned to multiple groups
memberships AS (
  SELECT DISTINCT ON (g.group_id, u.user_id)
    u.tenant_id,
    g.group_id,
    u.user_id
  FROM idc_users_numbered u
  CROSS JOIN generate_series(0, 11) AS slot(s)
  JOIN idc_groups_numbered g
    ON g.tenant_id = u.tenant_id
    AND g.group_rn = 1 + ((u.user_rn * 7 + slot.s * 13 + abs(hashint4(u.user_rn::int * 31 + slot.s))) % g.group_cnt)
  WHERE slot.s < (8 + abs(hashint4(u.user_rn::int)) % 5)  -- 8-12 groups per user
)
INSERT INTO aws_idc_group_membership (id, tenant_id, group_id, user_id, membership_id, source_of_truth, ingested_at, last_seen_at, deleted_at)
SELECT
  gen_random_uuid(),
  m.tenant_id,
  m.group_id,
  m.user_id,
  'mem-' || md5(m.group_id::text || m.user_id::text),
  'identity_store_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL
FROM memberships m;

-- ============================================================
-- 11. GCP Workspace Group Memberships (~5,200)
-- ============================================================

WITH gw_users_numbered AS (
  SELECT id AS user_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS user_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS user_cnt
  FROM gcp_workspace_user
),
gw_groups_numbered AS (
  SELECT id AS group_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS group_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS group_cnt
  FROM gcp_workspace_group
),
memberships AS (
  SELECT DISTINCT ON (g.group_id, u.user_id)
    u.tenant_id,
    g.group_id,
    u.user_id
  FROM gw_users_numbered u
  CROSS JOIN generate_series(0, 11) AS slot(s)
  JOIN gw_groups_numbered g
    ON g.tenant_id = u.tenant_id
    AND g.group_rn = 1 + ((u.user_rn * 11 + slot.s * 17 + abs(hashint4(u.user_rn::int * 37 + slot.s))) % g.group_cnt)
  WHERE slot.s < (7 + abs(hashint4(u.user_rn::int + 99)) % 5)  -- 7-11 groups per user
)
INSERT INTO gcp_workspace_group_membership (id, tenant_id, group_id, user_id, membership_role, membership_type, source_of_truth, ingested_at, last_seen_at, deleted_at)
SELECT
  gen_random_uuid(),
  m.tenant_id,
  m.group_id,
  m.user_id,
  CASE WHEN abs(hashint4(hashtext(m.group_id::text || m.user_id::text))) % 20 = 0 THEN 'OWNER'
       WHEN abs(hashint4(hashtext(m.group_id::text || m.user_id::text))) % 10 = 0 THEN 'MANAGER'
       ELSE 'MEMBER'
  END,
  'USER',
  'directory_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL
FROM memberships m;

-- ============================================================
-- 12. AWS IDC Permission Sets (12)
-- ============================================================

INSERT INTO aws_idc_permission_set (id, tenant_id, permission_set_arn, permission_set_name, description, session_duration, identity_store_id, instance_arn, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  t.tenant_id,
  'arn:aws:sso:::permissionSet/' || t.instance_id || '/ps-' || lpad(ps.idx::text, 16, '0'),
  ps.ps_name,
  ps.ps_desc,
  ps.session_dur,
  t.ids_id,
  'arn:aws:sso:::instance/' || t.instance_id,
  'sso_admin_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM (
  VALUES
    (1,  'AdministratorAccess',   'Full administrative access',                         'PT12H'),
    (2,  'PowerUserAccess',       'Full access except IAM and Organisations management','PT8H'),
    (3,  'ViewOnlyAccess',        'View-only access to all AWS services',               'PT4H'),
    (4,  'DatabaseAdministrator', 'Full access to database services',                   'PT8H'),
    (5,  'NetworkAdministrator',  'Full access to networking services',                  'PT8H'),
    (6,  'SecurityAudit',         'Read-only access for security auditing',              'PT4H'),
    (7,  'Billing',               'Access to billing and cost management',               'PT4H'),
    (8,  'ReadOnlyAccess',        'Read-only access to AWS services',                    'PT4H'),
    (9,  'DeveloperAccess',       'Developer-level access to compute and storage',       'PT8H'),
    (10, 'DataScientist',         'Access to ML, analytics, and data services',          'PT8H'),
    (11, 'SupportUser',           'Access to AWS Support centre',                        'PT4H'),
    (12, 'CustomRestricted',      'Custom restricted access for compliance',             'PT2H')
) AS ps(idx, ps_name, ps_desc, session_dur)
CROSS JOIN (
  VALUES
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'ssoins-northwind01', 'd-northwind0001'),
    ('b0000000-0000-0000-0000-000000000001'::uuid, 'ssoins-southbank01', 'd-southbank001')
) AS t(tenant_id, instance_id, ids_id);

-- ============================================================
-- 13. AWS IDC Account Assignments (~800: mix of USER and GROUP)
-- ============================================================
-- ~60% GROUP assignments (~480), ~40% USER assignments (~320)
-- Privilege distribution: ~2% admin, ~12% elevated, ~86% standard

-- USER assignments (~320)
WITH idc_users_numbered AS (
  SELECT id AS user_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS user_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS user_cnt
  FROM aws_idc_user
),
ps_numbered AS (
  SELECT id AS ps_id, tenant_id, permission_set_name,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY permission_set_name) AS ps_rn
  FROM aws_idc_permission_set
),
accts_numbered AS (
  SELECT id AS acct_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY account_id) AS acct_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS acct_cnt
  FROM aws_account
),
user_assignments AS (
  SELECT DISTINCT ON (u.user_id, ps.ps_id, a.acct_id)
    u.tenant_id,
    u.user_id,
    ps.ps_id,
    a.acct_id
  FROM idc_users_numbered u
  CROSS JOIN generate_series(1, 2) AS slot(s)  -- 1-2 assignments per user subset
  JOIN ps_numbered ps
    ON ps.tenant_id = u.tenant_id
    AND ps.ps_rn = CASE
      -- ~2% get AdministratorAccess (ps_rn=1)
      WHEN abs(hashint4(u.user_rn::int * 41 + slot.s)) % 50 = 0 THEN 1
      -- ~12% get elevated (ps_rn 2,4,5 = PowerUser, DBAdmin, NetworkAdmin)
      WHEN abs(hashint4(u.user_rn::int * 41 + slot.s)) % 8 = 0 THEN 2 + abs(hashint4(u.user_rn::int + slot.s * 3)) % 3
      -- Rest get standard (ps_rn 3,6,7,8 = ViewOnly, SecurityAudit, Billing, ReadOnly)
      ELSE (ARRAY[3,6,7,8,9,11])[1 + abs(hashint4(u.user_rn::int * 53 + slot.s)) % 6]
    END
  JOIN accts_numbered a
    ON a.tenant_id = u.tenant_id
    AND a.acct_rn = 1 + abs(hashint4(u.user_rn::int * 67 + slot.s * 19)) % a.acct_cnt
  WHERE u.user_rn <= CASE WHEN u.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid THEN 220 ELSE 100 END
  LIMIT 320
)
INSERT INTO aws_idc_account_assignment (id, tenant_id, principal_type, principal_user_id, principal_group_id, permission_set_id, aws_account_id, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  ua.tenant_id,
  'USER',
  ua.user_id,
  NULL,
  ua.ps_id,
  ua.acct_id,
  'sso_admin_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM user_assignments ua;

-- GROUP assignments (~480)
WITH idc_groups_numbered AS (
  SELECT id AS group_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS group_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS group_cnt
  FROM aws_idc_group
),
ps_numbered AS (
  SELECT id AS ps_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY permission_set_name) AS ps_rn
  FROM aws_idc_permission_set
),
accts_numbered AS (
  SELECT id AS acct_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY account_id) AS acct_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS acct_cnt
  FROM aws_account
),
group_assignments AS (
  SELECT DISTINCT ON (g.group_id, ps.ps_id, a.acct_id)
    g.tenant_id,
    g.group_id,
    ps.ps_id,
    a.acct_id
  FROM idc_groups_numbered g
  CROSS JOIN generate_series(1, 3) AS slot(s)
  JOIN ps_numbered ps
    ON ps.tenant_id = g.tenant_id
    AND ps.ps_rn = CASE
      WHEN abs(hashint4(g.group_rn::int * 43 + slot.s)) % 50 = 0 THEN 1
      WHEN abs(hashint4(g.group_rn::int * 43 + slot.s)) % 8 = 0 THEN 2 + abs(hashint4(g.group_rn::int + slot.s * 5)) % 3
      ELSE (ARRAY[3,6,7,8,9,11])[1 + abs(hashint4(g.group_rn::int * 59 + slot.s)) % 6]
    END
  JOIN accts_numbered a
    ON a.tenant_id = g.tenant_id
    AND a.acct_rn = 1 + abs(hashint4(g.group_rn::int * 71 + slot.s * 23)) % a.acct_cnt
  LIMIT 480
)
INSERT INTO aws_idc_account_assignment (id, tenant_id, principal_type, principal_user_id, principal_group_id, permission_set_id, aws_account_id, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  ga.tenant_id,
  'GROUP',
  NULL,
  ga.group_id,
  ga.ps_id,
  ga.acct_id,
  'sso_admin_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM group_assignments ga;

-- ============================================================
-- 14. GCP IAM Bindings (~700: mix of user and group)
-- ============================================================
-- ~60% user bindings (~420), ~40% group bindings (~280)
-- Privilege distribution: ~2% owner, ~12% editor, ~86% viewer/reader

-- User bindings (~420)
WITH gw_users_numbered AS (
  SELECT id AS ws_user_id, tenant_id, primary_email,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS user_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS user_cnt
  FROM gcp_workspace_user
),
projects_numbered AS (
  SELECT id AS proj_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY project_id) AS proj_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS proj_cnt
  FROM gcp_project
),
user_bindings AS (
  SELECT DISTINCT ON (u.ws_user_id, p.proj_id, role_val)
    u.tenant_id,
    p.proj_id,
    u.ws_user_id,
    u.primary_email,
    CASE
      WHEN abs(hashint4(u.user_rn::int * 47 + slot.s)) % 50 = 0 THEN 'roles/owner'
      WHEN abs(hashint4(u.user_rn::int * 47 + slot.s)) % 8 = 0 THEN
        (ARRAY['roles/editor','roles/compute.admin','roles/storage.admin','roles/bigquery.admin'])[1 + abs(hashint4(u.user_rn::int + slot.s * 7)) % 4]
      ELSE
        (ARRAY['roles/viewer','roles/browser','roles/monitoring.viewer','roles/logging.viewer',
               'roles/bigquery.dataViewer','roles/storage.objectViewer'])[1 + abs(hashint4(u.user_rn::int * 61 + slot.s)) % 6]
    END AS role_val
  FROM gw_users_numbered u
  CROSS JOIN generate_series(1, 2) AS slot(s)
  JOIN projects_numbered p
    ON p.tenant_id = u.tenant_id
    AND p.proj_rn = 1 + abs(hashint4(u.user_rn::int * 73 + slot.s * 29)) % p.proj_cnt
  WHERE u.user_rn <= CASE WHEN u.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid THEN 280 ELSE 120 END
  LIMIT 420
)
INSERT INTO gcp_iam_binding (id, tenant_id, resource_type, gcp_project_id, principal_type, principal_email, workspace_user_id, workspace_group_id, role, condition_title, condition_expression, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  ub.tenant_id,
  'project',
  ub.proj_id,
  'user',
  ub.primary_email,
  ub.ws_user_id,
  NULL,
  ub.role_val,
  NULL,
  NULL,
  'resource_manager_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM user_bindings ub;

-- Group bindings (~280)
WITH gw_groups_numbered AS (
  SELECT id AS ws_group_id, tenant_id, group_email,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS group_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS group_cnt
  FROM gcp_workspace_group
),
projects_numbered AS (
  SELECT id AS proj_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY project_id) AS proj_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS proj_cnt
  FROM gcp_project
),
group_bindings AS (
  SELECT DISTINCT ON (g.ws_group_id, p.proj_id, role_val)
    g.tenant_id,
    p.proj_id,
    g.ws_group_id,
    g.group_email,
    CASE
      WHEN abs(hashint4(g.group_rn::int * 53 + slot.s)) % 50 = 0 THEN 'roles/owner'
      WHEN abs(hashint4(g.group_rn::int * 53 + slot.s)) % 8 = 0 THEN
        (ARRAY['roles/editor','roles/compute.admin','roles/storage.admin','roles/bigquery.admin'])[1 + abs(hashint4(g.group_rn::int + slot.s * 11)) % 4]
      ELSE
        (ARRAY['roles/viewer','roles/browser','roles/monitoring.viewer','roles/logging.viewer',
               'roles/bigquery.dataViewer','roles/storage.objectViewer'])[1 + abs(hashint4(g.group_rn::int * 67 + slot.s)) % 6]
    END AS role_val
  FROM gw_groups_numbered g
  CROSS JOIN generate_series(1, 2) AS slot(s)
  JOIN projects_numbered p
    ON p.tenant_id = g.tenant_id
    AND p.proj_rn = 1 + abs(hashint4(g.group_rn::int * 79 + slot.s * 31)) % p.proj_cnt
  LIMIT 280
)
INSERT INTO gcp_iam_binding (id, tenant_id, resource_type, gcp_project_id, principal_type, principal_email, workspace_user_id, workspace_group_id, role, condition_title, condition_expression, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  gb.tenant_id,
  'project',
  gb.proj_id,
  'group',
  gb.group_email,
  NULL,
  gb.ws_group_id,
  gb.role_val,
  NULL,
  NULL,
  'resource_manager_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM group_bindings gb;

-- ============================================================
-- 15. Person Links (~1,100)
-- ============================================================
-- Link all provider identities back to their persons.
-- aws_idc_user links (~580), gcp_workspace_user links (~520), aws_iam_user links (~150) -- but we target ~1,000 total

-- IDC user links
INSERT INTO person_link (id, tenant_id, person_id, provider_code, provider_identity_id, identity_type, linkage_strategy, confidence, linked_by, linked_at, notes)
SELECT
  gen_random_uuid(),
  u.tenant_id,
  u.person_id,
  'aws',
  u.id,
  'aws_idc_user',
  CASE WHEN abs(hashint4(hashtext(u.id::text))) % 3 = 0 THEN 'email_match'
       WHEN abs(hashint4(hashtext(u.id::text))) % 3 = 1 THEN 'hr_correlation'
       ELSE 'manual_review'
  END,
  CASE WHEN abs(hashint4(hashtext(u.id::text))) % 5 = 0 THEN 0.85
       WHEN abs(hashint4(hashtext(u.id::text))) % 5 = 1 THEN 0.90
       ELSE 0.95
  END,
  'sync_pipeline',
  '2026-01-20T10:00:00Z'::timestamptz,
  NULL
FROM aws_idc_user u
WHERE u.person_id IS NOT NULL;

-- GCP Workspace user links
INSERT INTO person_link (id, tenant_id, person_id, provider_code, provider_identity_id, identity_type, linkage_strategy, confidence, linked_by, linked_at, notes)
SELECT
  gen_random_uuid(),
  u.tenant_id,
  u.person_id,
  'gcp',
  u.id,
  'gcp_workspace_user',
  CASE WHEN abs(hashint4(hashtext(u.id::text))) % 3 = 0 THEN 'email_match'
       WHEN abs(hashint4(hashtext(u.id::text))) % 3 = 1 THEN 'hr_correlation'
       ELSE 'manual_review'
  END,
  CASE WHEN abs(hashint4(hashtext(u.id::text))) % 5 = 0 THEN 0.88
       WHEN abs(hashint4(hashtext(u.id::text))) % 5 = 1 THEN 0.92
       ELSE 0.97
  END,
  'sync_pipeline',
  '2026-01-20T10:00:00Z'::timestamptz,
  NULL
FROM gcp_workspace_user u
WHERE u.person_id IS NOT NULL;

-- IAM user links
INSERT INTO person_link (id, tenant_id, person_id, provider_code, provider_identity_id, identity_type, linkage_strategy, confidence, linked_by, linked_at, notes)
SELECT
  gen_random_uuid(),
  u.tenant_id,
  u.person_id,
  'aws',
  u.id,
  'aws_iam_user',
  CASE WHEN abs(hashint4(hashtext(u.id::text))) % 3 = 0 THEN 'email_match'
       WHEN abs(hashint4(hashtext(u.id::text))) % 3 = 1 THEN 'arn_pattern'
       ELSE 'manual_review'
  END,
  CASE WHEN abs(hashint4(hashtext(u.id::text))) % 5 = 0 THEN 0.80
       WHEN abs(hashint4(hashtext(u.id::text))) % 5 = 1 THEN 0.88
       ELSE 0.95
  END,
  'sync_pipeline',
  '2026-01-22T14:00:00Z'::timestamptz,
  NULL
FROM aws_iam_user u
WHERE u.person_id IS NOT NULL;

-- ============================================================
-- 16. AWS IAM User Policy Attachments
-- ============================================================
-- Attach 1-3 policies to each IAM user

WITH iam_users_numbered AS (
  SELECT id AS iam_id, tenant_id,
         ROW_NUMBER() OVER (ORDER BY id) AS user_rn
  FROM aws_iam_user
),
policy_defs AS (
  SELECT * FROM (
    VALUES
      (1,  'arn:aws:iam::aws:policy/AdministratorAccess',         'AdministratorAccess'),
      (2,  'arn:aws:iam::aws:policy/PowerUserAccess',             'PowerUserAccess'),
      (3,  'arn:aws:iam::aws:policy/ReadOnlyAccess',              'ReadOnlyAccess'),
      (4,  'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',      'AmazonS3ReadOnlyAccess'),
      (5,  'arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess',     'AmazonEC2ReadOnlyAccess'),
      (6,  'arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess',    'CloudWatchReadOnlyAccess'),
      (7,  'arn:aws:iam::aws:policy/IAMUserChangePassword',       'IAMUserChangePassword'),
      (8,  'arn:aws:iam::aws:policy/AWSCodeCommitReadOnly',       'AWSCodeCommitReadOnly'),
      (9,  'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess','AmazonDynamoDBReadOnlyAccess'),
      (10, 'arn:aws:iam::aws:policy/SecurityAudit',               'SecurityAudit')
  ) AS t(idx, p_arn, p_name)
),
attachments AS (
  SELECT DISTINCT ON (u.iam_id, pd.p_arn)
    u.tenant_id,
    u.iam_id,
    pd.p_arn,
    pd.p_name
  FROM iam_users_numbered u
  CROSS JOIN generate_series(1, 2) AS slot(s)
  JOIN policy_defs pd ON pd.idx = CASE
    WHEN abs(hashint4(u.user_rn::int * 37 + slot.s)) % 50 = 0 THEN 1  -- ~2% admin
    WHEN abs(hashint4(u.user_rn::int * 37 + slot.s)) % 8 = 0 THEN 2   -- ~12% power user
    ELSE (ARRAY[3,4,5,6,7,8,9,10])[1 + abs(hashint4(u.user_rn::int * 43 + slot.s)) % 8]
  END
)
INSERT INTO aws_iam_user_policy_attachment (id, tenant_id, iam_user_id, policy_arn, policy_name, is_inline, source_of_truth, ingested_at, last_seen_at, deleted_at)
SELECT
  gen_random_uuid(),
  a.tenant_id,
  a.iam_id,
  a.p_arn,
  a.p_name,
  FALSE,
  'iam_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL
FROM attachments a;

-- ============================================================
-- 17. Entity History (50 persons subset)
-- ============================================================
-- Demonstrate SNAPSHOT, CREATED, UPDATED, DELETED events across Jan-Feb 2026

WITH history_persons AS (
  SELECT id, tenant_id, display_name, primary_email, status,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM person
  LIMIT 50
)
INSERT INTO entity_history (event_time, tenant_id, entity_type, entity_id, provider_code, event_action, state_payload, delta_payload, source_system, sync_run_id, ingested_at, previous_hash, integrity_hash)
-- CREATED events (all 50 persons)
SELECT
  '2026-01-05T08:00:00Z'::timestamptz + (hp.rn * interval '1 hour'),
  hp.tenant_id,
  'person',
  hp.id,
  'aws',
  'CREATED',
  jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active'),
  NULL::JSONB,
  'sync_pipeline',
  'run-20260105-' || lpad(hp.rn::text, 3, '0'),
  '2026-01-05T08:00:00Z'::timestamptz + (hp.rn * interval '1 hour'),
  NULL,
  encode(digest('GENESIS' || jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active')::text, 'sha256'), 'hex')
FROM history_persons hp

UNION ALL

-- SNAPSHOT events (all 50 persons, mid-January)
SELECT
  '2026-01-15T12:00:00Z'::timestamptz + (hp.rn * interval '30 minutes'),
  hp.tenant_id,
  'person',
  hp.id,
  'aws',
  'SNAPSHOT',
  jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active', 'snapshot_reason', 'scheduled_sync'),
  NULL::JSONB,
  'sync_pipeline',
  'run-20260115-snap',
  '2026-01-15T12:00:00Z'::timestamptz + (hp.rn * interval '30 minutes'),
  encode(digest('GENESIS' || jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active')::text, 'sha256'), 'hex'),
  encode(digest(
    encode(digest('GENESIS' || jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active')::text, 'sha256'), 'hex')
    || jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active', 'snapshot_reason', 'scheduled_sync')::text,
    'sha256'), 'hex')
FROM history_persons hp

UNION ALL

-- UPDATED events (first 30 persons, early February - department change)
SELECT
  '2026-02-03T09:00:00Z'::timestamptz + (hp.rn * interval '45 minutes'),
  hp.tenant_id,
  'person',
  hp.id,
  'aws',
  'UPDATED',
  jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active', 'department', 'Engineering'),
  jsonb_build_object('department', jsonb_build_object('old', 'Finance', 'new', 'Engineering')),
  'sync_pipeline',
  'run-20260203-upd',
  '2026-02-03T09:00:00Z'::timestamptz + (hp.rn * interval '45 minutes'),
  -- previous_hash is the snapshot hash (simplified - using a deterministic value)
  encode(digest('prev-' || hp.id::text, 'sha256'), 'hex'),
  encode(digest(
    encode(digest('prev-' || hp.id::text, 'sha256'), 'hex')
    || jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'active', 'department', 'Engineering')::text,
    'sha256'), 'hex')
FROM history_persons hp
WHERE hp.rn <= 30

UNION ALL

-- DELETED events (persons 41-50, late February - departed employees)
SELECT
  '2026-02-20T16:00:00Z'::timestamptz + ((hp.rn - 40) * interval '1 hour'),
  hp.tenant_id,
  'person',
  hp.id,
  'aws',
  'DELETED',
  jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'departed', 'departed_reason', 'resignation'),
  jsonb_build_object('status', jsonb_build_object('old', 'active', 'new', 'departed')),
  'sync_pipeline',
  'run-20260220-dep',
  '2026-02-20T16:00:00Z'::timestamptz + ((hp.rn - 40) * interval '1 hour'),
  encode(digest('prev-del-' || hp.id::text, 'sha256'), 'hex'),
  encode(digest(
    encode(digest('prev-del-' || hp.id::text, 'sha256'), 'hex')
    || jsonb_build_object('display_name', hp.display_name, 'primary_email', hp.primary_email, 'status', 'departed', 'departed_reason', 'resignation')::text,
    'sha256'), 'hex')
FROM history_persons hp
WHERE hp.rn BETWEEN 41 AND 50;

-- ============================================================
-- 17b. GitHub Organisations (2: one per tenant)
-- ============================================================

INSERT INTO github_organisation (id, tenant_id, github_org_id, login, display_name, email, billing_email, plan, two_factor_requirement_enabled, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
VALUES
  ('c1000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid,
   10001, 'northwind-eng', 'Northwind Engineering', 'eng@northwind-holdings.co.uk', 'billing@northwind-holdings.co.uk',
   'enterprise', TRUE, 'github_api', '2026-02-01T00:00:00Z', '2026-02-14T00:00:00Z', NULL,
   '{"type": "Organization", "blog": "https://eng.northwind-holdings.co.uk"}'::jsonb),
  ('c1000000-0000-0000-0000-000000000002'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid,
   10002, 'southbank-digital', 'Southbank Digital', 'eng@southbank.digital', 'billing@southbank.digital',
   'team', TRUE, 'github_api', '2026-02-01T00:00:00Z', '2026-02-14T00:00:00Z', NULL,
   '{"type": "Organization", "blog": "https://eng.southbank.digital"}'::jsonb);

-- ============================================================
-- 17c. GitHub Users (~400: ~280 northwind, ~120 southbank)
-- ============================================================
-- Map to persons rn 1-280 (northwind) and rn 1-120 (southbank).
-- ~20 users get noreply email (treated as no-email, person_id = NULL).

WITH ordered_persons AS (
  SELECT id, tenant_id, display_name, primary_email,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM person
)
INSERT INTO github_user (id, tenant_id, person_id, github_user_id, login, node_id, display_name, email, avatar_url, two_factor_enabled, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  -- 20 users (rn 261-280 in northwind) get NULL person_id to simulate noreply/unmatched
  CASE WHEN p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND p.rn BETWEEN 261 AND 280
    THEN NULL
    ELSE p.id
  END,
  20000 + ROW_NUMBER() OVER (ORDER BY p.tenant_id, p.rn),
  lower(split_part(p.display_name, ' ', 1)) || '-' || lower(split_part(p.display_name, ' ', 2)) || p.rn::text,
  'MDQ6VXNlcj' || md5(p.id::text || 'gh')::text,
  p.display_name,
  -- noreply users get GitHub noreply email
  CASE WHEN p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND p.rn BETWEEN 261 AND 280
    THEN (20000 + p.rn)::text || '+' || lower(split_part(p.display_name, ' ', 1)) || '@users.noreply.github.com'
    ELSE p.primary_email
  END,
  'https://avatars.githubusercontent.com/u/' || (20000 + p.rn)::text,
  CASE WHEN abs(hashint4(p.rn::int * 23)) % 5 = 0 THEN FALSE ELSE TRUE END,
  'github_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  jsonb_build_object('type', 'User', 'site_admin', FALSE, 'hireable', abs(hashint4(p.rn::int)) % 3 = 0)
FROM ordered_persons p
WHERE (p.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND p.rn <= 280)
   OR (p.tenant_id = 'b0000000-0000-0000-0000-000000000001'::uuid AND p.rn <= 120);

-- ============================================================
-- 17d. GitHub Teams (30: 20 northwind, 10 southbank)
-- ============================================================

INSERT INTO github_team (id, tenant_id, org_id, github_team_id, slug, display_name, description, privacy, parent_team_id, source_of_truth, ingested_at, last_seen_at, deleted_at, raw_payload)
SELECT
  gen_random_uuid(),
  CASE WHEN i <= 20
    THEN 'a0000000-0000-0000-0000-000000000001'::uuid
    ELSE 'b0000000-0000-0000-0000-000000000001'::uuid
  END,
  CASE WHEN i <= 20
    THEN 'c1000000-0000-0000-0000-000000000001'::uuid
    ELSE 'c1000000-0000-0000-0000-000000000002'::uuid
  END,
  30000 + i,
  lower((ARRAY['platform','backend','frontend','data','sre','security','mobile','ml','devops','qa',
               'infra','api','core','cloud','analytics','docs','design','release','testing','oncall'])[1 + (i - 1) % 20]),
  (ARRAY['Platform','Backend','Frontend','Data','SRE','Security','Mobile','ML','DevOps','QA',
         'Infra','API','Core','Cloud','Analytics','Docs','Design','Release','Testing','OnCall'])[1 + (i - 1) % 20],
  'GitHub team for ' || (ARRAY['platform engineering','backend services','frontend development','data engineering',
    'site reliability','security operations','mobile development','machine learning','DevOps automation','quality assurance',
    'infrastructure','API development','core systems','cloud architecture','analytics','documentation','design systems',
    'release management','test automation','on-call rotation'])[1 + (i - 1) % 20],
  CASE WHEN i % 3 = 0 THEN 'secret' ELSE 'closed' END,
  NULL,
  'github_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL,
  '{}'::jsonb
FROM generate_series(1, 30) AS i;

-- ============================================================
-- 17e. GitHub Team Memberships (~1,200)
-- ============================================================
-- Each GitHub user is placed in ~3 teams on average (within their tenant).

WITH gh_users_numbered AS (
  SELECT id AS user_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS user_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS user_cnt
  FROM github_user
),
gh_teams_numbered AS (
  SELECT id AS team_id, tenant_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS team_rn,
         COUNT(*) OVER (PARTITION BY tenant_id) AS team_cnt
  FROM github_team
),
memberships AS (
  SELECT DISTINCT ON (t.team_id, u.user_id)
    u.tenant_id,
    t.team_id,
    u.user_id
  FROM gh_users_numbered u
  CROSS JOIN generate_series(0, 3) AS slot(s)
  JOIN gh_teams_numbered t
    ON t.tenant_id = u.tenant_id
    AND t.team_rn = 1 + ((u.user_rn * 7 + slot.s * 11 + abs(hashint4(u.user_rn::int * 29 + slot.s))) % t.team_cnt)
  WHERE slot.s < (2 + abs(hashint4(u.user_rn::int + 77)) % 3)  -- 2-4 teams per user
)
INSERT INTO github_team_membership (id, tenant_id, team_id, user_id, membership_role, source_of_truth, ingested_at, last_seen_at, deleted_at)
SELECT
  gen_random_uuid(),
  m.tenant_id,
  m.team_id,
  m.user_id,
  CASE WHEN abs(hashint4(hashtext(m.team_id::text || m.user_id::text))) % 8 = 0 THEN 'maintainer'
       ELSE 'member'
  END,
  'github_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL
FROM memberships m;

-- ============================================================
-- 17f. GitHub Org Memberships (~400, one per GitHub user)
-- ============================================================

INSERT INTO github_org_membership (id, tenant_id, org_id, user_id, role, state, source_of_truth, ingested_at, last_seen_at, deleted_at)
SELECT
  gen_random_uuid(),
  gu.tenant_id,
  CASE WHEN gu.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
    THEN 'c1000000-0000-0000-0000-000000000001'::uuid
    ELSE 'c1000000-0000-0000-0000-000000000002'::uuid
  END,
  gu.id,
  CASE WHEN abs(hashint4(hashtext(gu.id::text))) % 15 = 0 THEN 'admin' ELSE 'member' END,
  'active',
  'github_api',
  '2026-02-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  NULL
FROM github_user gu;

-- ============================================================
-- 17g. GitHub Person Links (~400)
-- ============================================================
-- Link GitHub users with person_id back to person_link.

INSERT INTO person_link (id, tenant_id, person_id, provider_code, provider_identity_id, identity_type, linkage_strategy, confidence, linked_by, linked_at, notes)
SELECT
  gen_random_uuid(),
  gu.tenant_id,
  gu.person_id,
  'github',
  gu.id,
  'github_user',
  CASE WHEN gu.email LIKE '%@users.noreply.github.com' THEN 'pending_review'
       ELSE 'email_match'
  END,
  CASE WHEN gu.email LIKE '%@users.noreply.github.com' THEN 0.00
       ELSE 1.00
  END,
  'sync_pipeline',
  '2026-02-05T10:00:00Z'::timestamptz,
  CASE WHEN gu.email LIKE '%@users.noreply.github.com'
    THEN 'noreply email — requires manual identity resolution'
    ELSE NULL
  END
FROM github_user gu
WHERE gu.person_id IS NOT NULL;

-- ============================================================
-- 18. Edge Cases
-- ============================================================

-- 18a. 15 suspended GCP Workspace users
-- Suspend 15 users (persons with rn 50-64 in northwind)
UPDATE gcp_workspace_user
SET suspended = TRUE,
    raw_payload = raw_payload || '{"suspension_reason": "security_review"}'::jsonb
WHERE id IN (
  SELECT gw.id
  FROM gcp_workspace_user gw
  JOIN person p ON gw.person_id = p.id
  WHERE gw.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
  ORDER BY p.created_at, gw.id
  LIMIT 15
);

-- 18b. 20 departed persons (status='departed', deleted_at set)
-- Mark persons 681-700 in northwind as departed
UPDATE person
SET status = 'departed',
    deleted_at = '2026-02-10T17:00:00Z'::timestamptz,
    raw_payload = raw_payload || '{"departure_reason": "voluntary", "last_working_day": "2026-02-10"}'::jsonb
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
    FROM person
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
  ) sub
  WHERE rn BETWEEN 681 AND 700
);

-- 18c. 30 stale accounts not seen in 90+ days
-- Update last_seen_at to >90 days ago for 30 IDC users
UPDATE aws_idc_user
SET last_seen_at = '2025-11-01T00:00:00Z'::timestamptz,
    raw_payload = COALESCE(raw_payload, '{}'::jsonb) || '{"stale_flag": true}'::jsonb
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
    FROM aws_idc_user
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
  ) sub
  WHERE rn BETWEEN 380 AND 409
);

-- 18d. 5 users with mismatched display_name but same email across providers
-- Update display_name in IDC to differ from GCP Workspace for 5 users
UPDATE aws_idc_user
SET display_name = 'Dr. ' || display_name || ' (Preferred)',
    raw_payload = COALESCE(raw_payload, '{}'::jsonb) || '{"display_name_override": true}'::jsonb
WHERE id IN (
  SELECT idc.id
  FROM aws_idc_user idc
  JOIN gcp_workspace_user gw
    ON idc.person_id = gw.person_id
    AND idc.tenant_id = gw.tenant_id
  WHERE idc.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
  ORDER BY idc.id
  LIMIT 5
);

-- ============================================================
-- 19. Refresh materialised view
-- ============================================================

REFRESH MATERIALIZED VIEW mv_effective_access;

-- ============================================================
-- 20. Verification queries
-- ============================================================

COMMIT;

-- Verification queries (run outside transaction for visibility)

-- V1: Tenant and person counts
SELECT '-- V1: Person counts by tenant' AS verification;
SELECT t.slug, COUNT(p.id) AS person_count
FROM tenant t
LEFT JOIN person p ON p.tenant_id = t.id
GROUP BY t.slug
ORDER BY t.slug;

-- V2: Provider identity counts
SELECT '-- V2: Provider identity counts' AS verification;
SELECT 'aws_idc_user' AS provider, COUNT(*) AS cnt FROM aws_idc_user
UNION ALL
SELECT 'aws_iam_user', COUNT(*) FROM aws_iam_user
UNION ALL
SELECT 'gcp_workspace_user', COUNT(*) FROM gcp_workspace_user
UNION ALL
SELECT 'github_user', COUNT(*) FROM github_user
ORDER BY provider;

-- V3: Group and membership counts
SELECT '-- V3: Group and membership counts' AS verification;
SELECT 'aws_idc_group' AS entity, COUNT(*) AS cnt FROM aws_idc_group
UNION ALL
SELECT 'aws_idc_group_membership', COUNT(*) FROM aws_idc_group_membership
UNION ALL
SELECT 'gcp_workspace_group', COUNT(*) FROM gcp_workspace_group
UNION ALL
SELECT 'gcp_workspace_group_membership', COUNT(*) FROM gcp_workspace_group_membership
UNION ALL
SELECT 'github_organisation', COUNT(*) FROM github_organisation
UNION ALL
SELECT 'github_team', COUNT(*) FROM github_team
UNION ALL
SELECT 'github_team_membership', COUNT(*) FROM github_team_membership
UNION ALL
SELECT 'github_org_membership', COUNT(*) FROM github_org_membership
ORDER BY entity;

-- V4: Assignment and binding counts with privilege distribution
SELECT '-- V4: AWS IDC account assignments by principal_type' AS verification;
SELECT principal_type, COUNT(*) AS cnt
FROM aws_idc_account_assignment
GROUP BY principal_type;

SELECT '-- V4b: GCP IAM bindings by principal_type' AS verification;
SELECT principal_type, COUNT(*) AS cnt
FROM gcp_iam_binding
GROUP BY principal_type;

-- V5: Edge case verification
SELECT '-- V5: Edge cases' AS verification;
SELECT 'suspended_gcp_users' AS edge_case, COUNT(*) AS cnt FROM gcp_workspace_user WHERE suspended = TRUE
UNION ALL
SELECT 'departed_persons', COUNT(*) FROM person WHERE status = 'departed'
UNION ALL
SELECT 'stale_idc_users', COUNT(*) FROM aws_idc_user WHERE last_seen_at < NOW() - interval '90 days'
UNION ALL
SELECT 'mismatched_display_names', COUNT(*) FROM aws_idc_user WHERE display_name LIKE 'Dr. %'
UNION ALL
SELECT 'github_noreply_users', COUNT(*) FROM github_user WHERE email LIKE '%@users.noreply.github.com'
ORDER BY edge_case;

-- V6: Person link coverage and entity history
SELECT '-- V6: Person links and entity history' AS verification;
SELECT 'person_links' AS metric, COUNT(*) AS cnt FROM person_link
UNION ALL
SELECT 'entity_history_events', COUNT(*) FROM entity_history
UNION ALL
SELECT 'persons_with_multiple_identities', COUNT(*) FROM (
  SELECT person_id FROM person_link GROUP BY person_id HAVING COUNT(*) > 1
) sub
ORDER BY metric;
