-- ============================================================
-- 99-seed . Mock Data for New Multi-Tenant Schema
-- Seed: 42 (deterministic)
--
-- IMPORTANT: This script TRUNCATES all tables before inserting.
-- Use schema/02_seed_and_queries.sql for a small demo dataset.
-- Use this file for a large-scale test dataset.
--
-- Dataset shape (single tenant: 11111111-1111-1111-1111-111111111111):
--   - 700 canonical users
--   - ~700 canonical emails
--   - ~370 Google Workspace users, ~110 groups, ~3,500 memberships
--   - ~410 AWS Identity Center users, ~120 groups, ~4,500 memberships
--   - 2 GitHub organisations, ~280 GitHub users
--   - 20 GitHub teams, ~800 team memberships, ~280 org memberships
--   - 50 GitHub repositories
--   - ~100 repo team permissions, ~150 repo collaborator permissions
--   - ~1,060 canonical_user_provider_links
--   - ~20 identity reconciliation queue entries
--   - Edge cases: 15 suspended Google users, 20 archived Google users,
--     30 inactive AWS IDC users, 20 GitHub noreply users
-- ============================================================

BEGIN;

-- 0. Seed randomness
SELECT setseed(0.42);

-- ============================================================
-- 0b. Truncate all tables (reverse dependency order)
-- ============================================================
TRUNCATE identity_reconciliation_queue CASCADE;
TRUNCATE canonical_user_provider_links CASCADE;
TRUNCATE canonical_emails CASCADE;
TRUNCATE canonical_users CASCADE;
TRUNCATE github_repo_collaborator_permissions CASCADE;
TRUNCATE github_repo_team_permissions CASCADE;
TRUNCATE github_repositories CASCADE;
TRUNCATE github_team_memberships CASCADE;
TRUNCATE github_org_memberships CASCADE;
TRUNCATE github_teams CASCADE;
TRUNCATE github_users CASCADE;
TRUNCATE github_organisations CASCADE;
TRUNCATE aws_identity_center_memberships CASCADE;
TRUNCATE aws_identity_center_groups CASCADE;
TRUNCATE aws_identity_center_users CASCADE;
TRUNCATE google_workspace_memberships CASCADE;
TRUNCATE google_workspace_groups CASCADE;
TRUNCATE google_workspace_users CASCADE;

-- ============================================================
-- 1. Canonical Users (700)
-- ============================================================

WITH first_names AS (
  SELECT ARRAY[
    'Oliver','Amelia','Liam','Sofia','Noah','Ava','Lucas','Mia','Ethan','Emily',
    'Mateo','Isabella','Leo','Aria','Daniel','Layla','Alexander','Zara','James',
    'Chloe','Henry','Ella','Samuel','Nina','David','Anaya','Gabriel','Aisha',
    'Joseph','Fatima','Omar','Maya','Adam','Leila','Ravi','Priya','Hugo',
    'Lucia','Kenji','Yuki','Wei','Mei','Carlos','Elena','Diego','Camila',
    'Ahmed','Hana','Luca','Giulia','Theo','Iris','Kai','Lina'
  ] AS arr
),
surnames AS (
  SELECT ARRAY[
    'Smith','Jones','Williams','Taylor','Brown','Davies','Evans','Wilson','Thomas',
    'Roberts','Johnson','Lewis','Walker','Robinson','Wood','Thompson','White','Watson',
    'Jackson','Wright','Green','Harris','Cooper','King','Lee','Martin','Clarke','James',
    'Morgan','Hughes','Edwards','Hill','Moore','Clark','Harrison','Scott','Young',
    'Morris','Hall','Ward','Turner','Carter','Phillips','Mitchell','Patel','Adams',
    'Campbell','Anderson','Allen','Cook',
    'Garcia','Martinez','Rodriguez','Lopez','Hernandez','Gonzalez','Perez','Sanchez',
    'Ramirez','Torres','Flores','Rivera','Gomez','Diaz','Castro','Vargas','Mendoza',
    'Silva','Santos','Oliveira','Pereira','Costa','Ribeiro','Almeida','Fernandes',
    'Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci',
    'Muller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker',
    'Dubois','Moreau','Laurent','Simon','Michel','Lefebvre',
    'Novak','Kovacs','Horvath','Nagy','Popescu','Ionescu','Petrov','Ivanov',
    'Yilmaz','Kaya','Demir','Sahin','Celik','Aydin',
    'Khan','Ahmed','Ali','Hussain','Rahman','Sheikh','Malik','Chowdhury',
    'Patel','Sharma','Gupta','Singh','Kumar','Das','Banerjee','Iyer','Reddy',
    'Nguyen','Tran','Le','Pham','Hoang','Huynh',
    'Wang','Li','Zhang','Liu','Chen','Yang','Huang','Zhao','Wu','Zhou',
    'Tanaka','Suzuki','Sato','Takahashi','Ito','Yamamoto','Nakamura',
    'Kim','Park','Choi','Jung','Kang',
    'Okafor','Adeyemi','Mensah','Diallo','Abdullahi','Ndlovu','Moyo','Kamau',
    'Haddad','Nasser','Farah','Khalil','Salem','Barakat',
    'Smithson','Johnston','Peterson','Andersen','Johansson','Nilsson'
  ] AS arr
)
INSERT INTO canonical_users (id, tenant_id, full_name, primary_email, created_at, updated_at, deleted_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  fn.arr[1 + abs(hashint4(i + 42)) % array_length(fn.arr, 1)] || ' ' ||
    sn.arr[1 + abs(hashint4(i * 7 + 42)) % array_length(sn.arr, 1)],
  lower(fn.arr[1 + abs(hashint4(i + 42)) % array_length(fn.arr, 1)]) || '.' ||
    lower(sn.arr[1 + abs(hashint4(i * 7 + 42)) % array_length(sn.arr, 1)]) ||
    i::text || '@demo-example.co.uk',
  '2025-01-01T00:00:00Z'::timestamptz + (i % 365) * interval '1 day',
  '2026-01-15T00:00:00Z'::timestamptz + (i % 30) * interval '1 day',
  NULL
FROM generate_series(1, 700) AS i,
     first_names fn,
     surnames sn;

-- ============================================================
-- 2. Canonical Emails (one per user)
-- ============================================================

INSERT INTO canonical_emails (id, tenant_id, canonical_user_id, email, is_primary, verified_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  cu.tenant_id,
  cu.id,
  cu.primary_email,
  TRUE,
  cu.created_at + interval '1 hour',
  cu.created_at,
  cu.updated_at
FROM canonical_users cu
WHERE cu.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

-- ============================================================
-- 3. Google Workspace Users (~370, from canonical users rn 1-370)
-- ============================================================

WITH ordered_cu AS (
  SELECT id, tenant_id, full_name, primary_email, created_at,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
)
INSERT INTO google_workspace_users (id, tenant_id, google_id, primary_email, name_full, suspended, archived, is_admin, is_delegated_admin, is_enrolled_in_2sv, is_enforced_in_2sv, customer_id, creation_time, last_login_time, org_unit_path, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  'gw-' || md5(p.id::text || 'gw'),
  p.primary_email,
  p.full_name,
  FALSE,
  FALSE,
  CASE WHEN p.rn <= 5 THEN TRUE ELSE FALSE END,
  CASE WHEN p.rn BETWEEN 6 AND 10 THEN TRUE ELSE FALSE END,
  CASE WHEN p.rn <= 300 THEN TRUE ELSE FALSE END,
  CASE WHEN p.rn <= 200 THEN TRUE ELSE FALSE END,
  'C01demo',
  p.created_at,
  '2026-02-10T00:00:00Z'::timestamptz + (p.rn % 14) * interval '1 day',
  '/employees/' || (ARRAY['engineering','finance','marketing','operations','legal','hr','sales','support','product','data'])[1 + abs(hashint4(p.rn::int * 13)) % 10],
  jsonb_build_object('kind', 'admin#directory#user', 'etag', md5(p.id::text)),
  p.created_at,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM ordered_cu p
WHERE p.rn <= 370;

-- ============================================================
-- 4. Google Workspace Groups (110)
-- ============================================================

INSERT INTO google_workspace_groups (id, tenant_id, google_id, email, name, description, admin_created, direct_members_count, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'gw-grp-' || lpad(i::text, 4, '0'),
  (ARRAY['eng','platform','sec','data','devops','sre','frontend','backend','qa','analytics',
         'ml','infra','network','dba','compliance','arch','mobile','cloud','support','product'])[1 + (i - 1) % 20]
    || '-' || (ARRAY['team','admins','viewers','ops','leads','contrib','all','reviewers'])[1 + ((i - 1) / 20) % 8]
    || '@demo-example.co.uk',
  (ARRAY['Engineering','Platform','Security','Data','DevOps','SRE','Frontend','Backend','QA','Analytics',
         'ML','Infra','Networking','Database','Compliance','Architecture','Mobile','Cloud','Support','Product'])[1 + (i - 1) % 20]
    || ' ' || (ARRAY['Team','Admins','Viewers','Operators','Leads','Contributors','All','Reviewers'])[1 + ((i - 1) / 20) % 8],
  'Google Workspace group ' || i,
  TRUE,
  5 + abs(hashint4(i * 23)) % 50,
  jsonb_build_object('kind', 'admin#directory#group'),
  '2025-06-01T00:00:00Z'::timestamptz + (i * interval '1 day'),
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM generate_series(1, 110) AS i;

-- ============================================================
-- 5. Google Workspace Memberships (~3,500)
-- ============================================================

WITH gw_users_numbered AS (
  SELECT id, tenant_id, google_id,
         ROW_NUMBER() OVER (ORDER BY id) AS user_rn,
         COUNT(*) OVER () AS user_cnt
  FROM google_workspace_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
gw_groups_numbered AS (
  SELECT id, tenant_id, google_id,
         ROW_NUMBER() OVER (ORDER BY id) AS group_rn,
         COUNT(*) OVER () AS group_cnt
  FROM google_workspace_groups
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
memberships AS (
  SELECT DISTINCT ON (g.google_id, u.google_id)
    u.tenant_id,
    g.google_id AS group_google_id,
    u.google_id AS member_google_id
  FROM gw_users_numbered u
  CROSS JOIN generate_series(0, 11) AS slot(s)
  JOIN gw_groups_numbered g
    ON g.group_rn = 1 + ((u.user_rn * 11 + slot.s * 17 + abs(hashint4(u.user_rn::int * 37 + slot.s))) % g.group_cnt)
  WHERE slot.s < (7 + abs(hashint4(u.user_rn::int + 99)) % 5)
)
INSERT INTO google_workspace_memberships (id, tenant_id, group_id, member_id, member_type, role, status, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  m.tenant_id,
  m.group_google_id,
  m.member_google_id,
  'USER',
  CASE WHEN abs(hashint4(hashtext(m.group_google_id || m.member_google_id))) % 20 = 0 THEN 'OWNER'
       WHEN abs(hashint4(hashtext(m.group_google_id || m.member_google_id))) % 10 = 0 THEN 'MANAGER'
       ELSE 'MEMBER'
  END,
  'ACTIVE',
  '{}'::jsonb,
  '2025-06-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM memberships m;

-- ============================================================
-- 6. AWS Identity Center Users (~410, from canonical users rn 1-410)
-- ============================================================

WITH ordered_cu AS (
  SELECT id, tenant_id, full_name, primary_email, created_at,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
)
INSERT INTO aws_identity_center_users (id, tenant_id, identity_store_id, user_id, user_name, display_name, active, user_status, email, given_name, family_name, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  'd-demo0001',
  'idc-user-' || md5(p.id::text || 'idc'),
  p.primary_email,
  p.full_name,
  TRUE,
  'ENABLED',
  p.primary_email,
  split_part(p.full_name, ' ', 1),
  split_part(p.full_name, ' ', 2),
  jsonb_build_object('IdentityStoreId', 'd-demo0001', 'UserName', p.primary_email),
  p.created_at,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM ordered_cu p
WHERE p.rn <= 410;

-- ============================================================
-- 7. AWS Identity Center Groups (120)
-- ============================================================

INSERT INTO aws_identity_center_groups (id, tenant_id, identity_store_id, group_id, display_name, description, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'd-demo0001',
  'idc-grp-' || lpad(i::text, 4, '0'),
  (ARRAY['Engineering','Platform','Security','Data','DevOps','SRE','Frontend','Backend','QA','Analytics',
         'ML','Infra','Networking','Database','Compliance','Architecture','Mobile','Cloud','Support','Product'])[1 + (i - 1) % 20]
    || '-' || (ARRAY['Admins','Developers','Viewers','Operators','Analysts','Leads'])[1 + ((i - 1) / 20) % 6],
  'AWS IDC group ' || i,
  jsonb_build_object('IdentityStoreId', 'd-demo0001'),
  '2025-06-01T00:00:00Z'::timestamptz + (i * interval '1 day'),
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM generate_series(1, 120) AS i;

-- ============================================================
-- 8. AWS Identity Center Memberships (~4,500)
-- ============================================================

WITH idc_users_numbered AS (
  SELECT id, tenant_id, user_id AS idc_user_id, identity_store_id,
         ROW_NUMBER() OVER (ORDER BY id) AS user_rn,
         COUNT(*) OVER () AS user_cnt
  FROM aws_identity_center_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
idc_groups_numbered AS (
  SELECT id, tenant_id, group_id AS idc_group_id, identity_store_id,
         ROW_NUMBER() OVER (ORDER BY id) AS group_rn,
         COUNT(*) OVER () AS group_cnt
  FROM aws_identity_center_groups
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
memberships AS (
  SELECT DISTINCT ON (g.idc_group_id, u.idc_user_id)
    u.tenant_id,
    'mem-' || md5(g.idc_group_id || u.idc_user_id) AS membership_id,
    u.identity_store_id,
    g.idc_group_id,
    u.idc_user_id
  FROM idc_users_numbered u
  CROSS JOIN generate_series(0, 11) AS slot(s)
  JOIN idc_groups_numbered g
    ON g.group_rn = 1 + ((u.user_rn * 7 + slot.s * 13 + abs(hashint4(u.user_rn::int * 31 + slot.s))) % g.group_cnt)
  WHERE slot.s < (8 + abs(hashint4(u.user_rn::int)) % 5)
)
INSERT INTO aws_identity_center_memberships (id, tenant_id, membership_id, identity_store_id, group_id, member_user_id, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  m.tenant_id,
  m.membership_id,
  m.identity_store_id,
  m.idc_group_id,
  m.idc_user_id,
  '{}'::jsonb,
  '2025-06-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM memberships m;

-- ============================================================
-- 9. GitHub Organisations (2)
-- ============================================================

INSERT INTO github_organisations (id, tenant_id, github_id, node_id, login, name, email, raw_response, created_at, updated_at, last_synced_at)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   10001, 'O_kgDOAAAncQ', 'demo-eng', 'Demo Engineering', 'eng@demo-example.co.uk',
   '{"type": "Organization", "plan": {"name": "enterprise"}}'::jsonb,
   '2025-01-15T09:00:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid,
   10002, 'O_kgDOAAAncR', 'demo-labs', 'Demo Labs', 'labs@demo-example.co.uk',
   '{"type": "Organization", "plan": {"name": "team"}}'::jsonb,
   '2025-03-01T10:30:00Z', '2026-02-14T00:00:00Z', '2026-02-14T00:00:00Z');

-- ============================================================
-- 10. GitHub Users (~280, from canonical users rn 1-280)
-- ============================================================
-- Users rn 261-280 get noreply email (unmatched)

WITH ordered_cu AS (
  SELECT id, tenant_id, full_name, primary_email, created_at,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
)
INSERT INTO github_users (id, tenant_id, github_id, node_id, login, name, email, type, site_admin, avatar_url, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  20000 + p.rn,
  'MDQ6VXNlcj' || md5(p.id::text || 'gh'),
  lower(split_part(p.full_name, ' ', 1)) || '-' || lower(split_part(p.full_name, ' ', 2)) || p.rn::text,
  p.full_name,
  CASE WHEN p.rn BETWEEN 261 AND 280
    THEN (20000 + p.rn)::text || '+' || lower(split_part(p.full_name, ' ', 1)) || '@users.noreply.github.com'
    ELSE p.primary_email
  END,
  'User',
  FALSE,
  'https://avatars.githubusercontent.com/u/' || (20000 + p.rn)::text,
  jsonb_build_object('type', 'User', 'site_admin', FALSE, 'hireable', abs(hashint4(p.rn::int)) % 3 = 0),
  p.created_at,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM ordered_cu p
WHERE p.rn <= 280;

-- ============================================================
-- 11. GitHub Teams (20)
-- ============================================================

WITH org AS (
  SELECT node_id FROM github_organisations
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND login = 'demo-eng'
  LIMIT 1
)
INSERT INTO github_teams (id, tenant_id, github_id, node_id, org_node_id, name, slug, description, privacy, permission, parent_team_id, parent_team_node_id, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  30000 + i,
  'T_kgDOAAA' || lpad(i::text, 3, '0'),
  org.node_id,
  (ARRAY['Platform','Backend','Frontend','Data','SRE','Security','Mobile','ML','DevOps','QA',
         'Infra','API','Core','Cloud','Analytics','Docs','Design','Release','Testing','OnCall'])[i],
  lower((ARRAY['platform','backend','frontend','data','sre','security','mobile','ml','devops','qa',
               'infra','api','core','cloud','analytics','docs','design','release','testing','oncall'])[i]),
  'GitHub team for ' || lower((ARRAY['platform engineering','backend services','frontend development','data engineering',
    'site reliability','security operations','mobile development','machine learning','DevOps automation','quality assurance',
    'infrastructure','API development','core systems','cloud architecture','analytics','documentation','design systems',
    'release management','test automation','on-call rotation'])[i]),
  CASE WHEN i % 3 = 0 THEN 'secret' ELSE 'closed' END,
  (ARRAY['pull','push','push','admin','push'])[1 + (i - 1) % 5],
  NULL,
  NULL,
  '{}'::jsonb,
  '2025-06-01T00:00:00Z'::timestamptz + (i * interval '1 day'),
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM generate_series(1, 20) AS i,
     org;

-- ============================================================
-- 12. GitHub Org Memberships (~280, one per GitHub user)
-- ============================================================

WITH org AS (
  SELECT node_id FROM github_organisations
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND login = 'demo-eng'
  LIMIT 1
)
INSERT INTO github_org_memberships (id, tenant_id, org_node_id, user_node_id, role, state, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  gu.tenant_id,
  org.node_id,
  gu.node_id,
  CASE WHEN abs(hashint4(hashtext(gu.node_id))) % 15 = 0 THEN 'admin' ELSE 'member' END,
  'active',
  '{}'::jsonb,
  gu.created_at,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM github_users gu, org
WHERE gu.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

-- ============================================================
-- 13. GitHub Team Memberships (~800)
-- ============================================================

WITH gh_users_numbered AS (
  SELECT id, tenant_id, node_id,
         ROW_NUMBER() OVER (ORDER BY id) AS user_rn,
         COUNT(*) OVER () AS user_cnt
  FROM github_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
gh_teams_numbered AS (
  SELECT id, tenant_id, node_id,
         ROW_NUMBER() OVER (ORDER BY id) AS team_rn,
         COUNT(*) OVER () AS team_cnt
  FROM github_teams
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
memberships AS (
  SELECT DISTINCT ON (t.node_id, u.node_id)
    u.tenant_id,
    t.node_id AS team_node_id,
    u.node_id AS user_node_id
  FROM gh_users_numbered u
  CROSS JOIN generate_series(0, 3) AS slot(s)
  JOIN gh_teams_numbered t
    ON t.team_rn = 1 + ((u.user_rn * 7 + slot.s * 11 + abs(hashint4(u.user_rn::int * 29 + slot.s))) % t.team_cnt)
  WHERE slot.s < (2 + abs(hashint4(u.user_rn::int + 77)) % 3)
)
INSERT INTO github_team_memberships (id, tenant_id, team_node_id, user_node_id, role, state, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  m.tenant_id,
  m.team_node_id,
  m.user_node_id,
  CASE WHEN abs(hashint4(hashtext(m.team_node_id || m.user_node_id))) % 8 = 0 THEN 'maintainer'
       ELSE 'member'
  END,
  CASE WHEN abs(hashint4(hashtext(m.team_node_id || m.user_node_id))) % 20 = 0 THEN 'pending'
       ELSE 'active'
  END,
  '{}'::jsonb,
  '2025-06-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM memberships m;

-- ============================================================
-- 14. GitHub Repositories (50)
-- ============================================================

WITH org AS (
  SELECT node_id, login FROM github_organisations
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND login = 'demo-eng'
  LIMIT 1
)
INSERT INTO github_repositories (id, tenant_id, github_id, node_id, org_node_id, name, full_name, private, visibility, archived, default_branch, description, fork, language, pushed_at, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  40000 + i,
  'R_kgDOAAA' || lpad(i::text, 3, '0'),
  org.node_id,
  (ARRAY['infra-core','api-gateway','auth-service','user-service','billing-service',
         'notification-service','search-service','analytics-engine','data-pipeline','ml-platform',
         'frontend-app','admin-dashboard','mobile-ios','mobile-android','docs-site',
         'terraform-modules','helm-charts','ci-templates','monitoring-stack','logging-stack',
         'shared-libs','sdk-python','sdk-node','sdk-go','test-harness',
         'load-tester','chaos-monkey','config-service','feature-flags','cache-layer',
         'queue-worker','scheduler','webhook-relay','identity-provider','sso-proxy',
         'compliance-scanner','audit-service','backup-tool','migration-runner','schema-registry',
         'event-bus','graph-api','file-storage','cdn-manager','dns-manager',
         'cert-manager','secret-rotator','cost-optimizer','resource-tagger','policy-engine'])[i],
  org.login || '/' || (ARRAY['infra-core','api-gateway','auth-service','user-service','billing-service',
         'notification-service','search-service','analytics-engine','data-pipeline','ml-platform',
         'frontend-app','admin-dashboard','mobile-ios','mobile-android','docs-site',
         'terraform-modules','helm-charts','ci-templates','monitoring-stack','logging-stack',
         'shared-libs','sdk-python','sdk-node','sdk-go','test-harness',
         'load-tester','chaos-monkey','config-service','feature-flags','cache-layer',
         'queue-worker','scheduler','webhook-relay','identity-provider','sso-proxy',
         'compliance-scanner','audit-service','backup-tool','migration-runner','schema-registry',
         'event-bus','graph-api','file-storage','cdn-manager','dns-manager',
         'cert-manager','secret-rotator','cost-optimizer','resource-tagger','policy-engine'])[i],
  CASE WHEN i <= 45 THEN TRUE ELSE FALSE END,
  CASE WHEN i <= 45 THEN 'private' ELSE 'public' END,
  CASE WHEN i IN (25, 26) THEN TRUE ELSE FALSE END,
  'main',
  'Repository for ' || (ARRAY['infra-core','api-gateway','auth-service','user-service','billing-service',
         'notification-service','search-service','analytics-engine','data-pipeline','ml-platform',
         'frontend-app','admin-dashboard','mobile-ios','mobile-android','docs-site',
         'terraform-modules','helm-charts','ci-templates','monitoring-stack','logging-stack',
         'shared-libs','sdk-python','sdk-node','sdk-go','test-harness',
         'load-tester','chaos-monkey','config-service','feature-flags','cache-layer',
         'queue-worker','scheduler','webhook-relay','identity-provider','sso-proxy',
         'compliance-scanner','audit-service','backup-tool','migration-runner','schema-registry',
         'event-bus','graph-api','file-storage','cdn-manager','dns-manager',
         'cert-manager','secret-rotator','cost-optimizer','resource-tagger','policy-engine'])[i],
  CASE WHEN i IN (22, 23, 24) THEN TRUE ELSE FALSE END,
  (ARRAY['TypeScript','Python','Go','Rust','Java','HCL','Shell','Kotlin','Swift','Dockerfile'])[1 + (i - 1) % 10],
  '2026-02-01T00:00:00Z'::timestamptz + (i % 20) * interval '1 day',
  jsonb_build_object('language', (ARRAY['TypeScript','Python','Go','Rust','Java','HCL','Shell','Kotlin','Swift','Dockerfile'])[1 + (i - 1) % 10]),
  '2025-01-01T00:00:00Z'::timestamptz + (i * interval '7 days'),
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM generate_series(1, 50) AS i,
     org;

-- ============================================================
-- 15. GitHub Repo Team Permissions (~100)
-- ============================================================

WITH repos_numbered AS (
  SELECT node_id,
         ROW_NUMBER() OVER (ORDER BY id) AS repo_rn,
         COUNT(*) OVER () AS repo_cnt
  FROM github_repositories
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
teams_numbered AS (
  SELECT node_id,
         ROW_NUMBER() OVER (ORDER BY id) AS team_rn,
         COUNT(*) OVER () AS team_cnt
  FROM github_teams
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
perms AS (
  SELECT DISTINCT ON (r.node_id, t.node_id)
    r.node_id AS repo_node_id,
    t.node_id AS team_node_id,
    (ARRAY['pull','push','admin','maintain','triage'])[1 + abs(hashint4(r.repo_rn::int * 41 + t.team_rn::int)) % 5] AS permission
  FROM repos_numbered r
  CROSS JOIN generate_series(1, 2) AS slot(s)
  JOIN teams_numbered t
    ON t.team_rn = 1 + ((r.repo_rn * 3 + slot.s * 7) % t.team_cnt)
)
INSERT INTO github_repo_team_permissions (id, tenant_id, repo_node_id, team_node_id, permission, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  p.repo_node_id,
  p.team_node_id,
  p.permission,
  '{}'::jsonb,
  '2025-06-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM perms p;

-- ============================================================
-- 16. GitHub Repo Collaborator Permissions (~150)
-- ============================================================
-- Mix of org members and outside collaborators

WITH repos_numbered AS (
  SELECT node_id,
         ROW_NUMBER() OVER (ORDER BY id) AS repo_rn,
         COUNT(*) OVER () AS repo_cnt
  FROM github_repositories
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
users_numbered AS (
  SELECT node_id,
         ROW_NUMBER() OVER (ORDER BY id) AS user_rn,
         COUNT(*) OVER () AS user_cnt
  FROM github_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
collabs AS (
  SELECT DISTINCT ON (r.node_id, u.node_id)
    r.node_id AS repo_node_id,
    u.node_id AS user_node_id,
    (ARRAY['pull','push','admin','maintain','triage'])[1 + abs(hashint4(r.repo_rn::int * 53 + u.user_rn::int)) % 5] AS permission,
    CASE WHEN u.user_rn > 260 THEN TRUE ELSE FALSE END AS is_outside
  FROM repos_numbered r
  CROSS JOIN generate_series(1, 3) AS slot(s)
  JOIN users_numbered u
    ON u.user_rn = 1 + ((r.repo_rn * 11 + slot.s * 37 + abs(hashint4(r.repo_rn::int * 19 + slot.s))) % u.user_cnt)
  LIMIT 150
)
INSERT INTO github_repo_collaborator_permissions (id, tenant_id, repo_node_id, user_node_id, permission, is_outside_collaborator, raw_response, created_at, updated_at, last_synced_at)
SELECT
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  c.repo_node_id,
  c.user_node_id,
  c.permission,
  c.is_outside,
  '{}'::jsonb,
  '2025-06-01T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM collabs c;

-- ============================================================
-- 17. Canonical User Provider Links (~1,060)
-- ============================================================

-- Google Workspace links (~370)
WITH ordered_cu AS (
  SELECT id, tenant_id,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
gw_users AS (
  SELECT google_id, tenant_id, primary_email
  FROM google_workspace_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
)
INSERT INTO canonical_user_provider_links (id, tenant_id, canonical_user_id, provider_type, provider_user_id, confidence_score, match_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  cu.tenant_id,
  cu.id,
  'GOOGLE_WORKSPACE'::provider_type_enum,
  gw.google_id,
  CASE WHEN abs(hashint4(cu.rn::int)) % 5 = 0 THEN 85 ELSE 100 END,
  CASE WHEN abs(hashint4(cu.rn::int)) % 5 = 0 THEN 'fuzzy_email' ELSE 'email_exact' END,
  '2026-01-20T10:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM ordered_cu cu
JOIN gw_users gw ON gw.primary_email = (
  SELECT primary_email FROM canonical_users WHERE id = cu.id
)
WHERE cu.rn <= 370;

-- AWS Identity Center links (~410)
WITH ordered_cu AS (
  SELECT id, tenant_id, primary_email,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
idc_users AS (
  SELECT user_id, tenant_id, user_name
  FROM aws_identity_center_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
)
INSERT INTO canonical_user_provider_links (id, tenant_id, canonical_user_id, provider_type, provider_user_id, confidence_score, match_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  cu.tenant_id,
  cu.id,
  'AWS_IDENTITY_CENTER'::provider_type_enum,
  idc.user_id,
  CASE WHEN abs(hashint4(cu.rn::int + 100)) % 5 = 0 THEN 90 ELSE 100 END,
  CASE WHEN abs(hashint4(cu.rn::int + 100)) % 5 = 0 THEN 'hr_correlation' ELSE 'email_exact' END,
  '2026-01-20T10:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM ordered_cu cu
JOIN idc_users idc ON idc.user_name = cu.primary_email
WHERE cu.rn <= 410;

-- GitHub links (~260, excluding noreply users rn 261-280)
WITH ordered_cu AS (
  SELECT id, tenant_id, primary_email,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
),
gh_users AS (
  SELECT node_id, tenant_id, email
  FROM github_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND email NOT LIKE '%@users.noreply.github.com'
)
INSERT INTO canonical_user_provider_links (id, tenant_id, canonical_user_id, provider_type, provider_user_id, confidence_score, match_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  cu.tenant_id,
  cu.id,
  'GITHUB'::provider_type_enum,
  gh.node_id,
  100,
  'email_exact',
  '2026-02-05T10:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM ordered_cu cu
JOIN gh_users gh ON gh.email = cu.primary_email
WHERE cu.rn <= 260;

-- ============================================================
-- 18. Identity Reconciliation Queue (~20 noreply GitHub users)
-- ============================================================

INSERT INTO identity_reconciliation_queue (id, tenant_id, provider_type, provider_user_id, suggested_canonical_user_id, conflict_reason, status, created_at, updated_at)
SELECT
  gen_random_uuid(),
  gu.tenant_id,
  'GITHUB'::provider_type_enum,
  gu.node_id,
  NULL,
  'noreply_email: ' || gu.email,
  'PENDING',
  '2026-02-05T10:00:00Z'::timestamptz,
  '2026-02-14T00:00:00Z'::timestamptz
FROM github_users gu
WHERE gu.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND gu.email LIKE '%@users.noreply.github.com';

-- ============================================================
-- 19. Edge Cases
-- ============================================================

-- 19a. 15 suspended Google Workspace users
UPDATE google_workspace_users
SET suspended = TRUE,
    suspension_reason = 'ADMIN',
    raw_response = raw_response || '{"suspensionReason": "ADMIN"}'::jsonb
WHERE id IN (
  SELECT id FROM google_workspace_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  ORDER BY created_at, id
  LIMIT 15
);

-- 19b. 20 archived Google Workspace users
UPDATE google_workspace_users
SET archived = TRUE,
    raw_response = raw_response || '{"archived": true}'::jsonb
WHERE id IN (
  SELECT id FROM google_workspace_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND suspended = FALSE
  ORDER BY created_at, id
  OFFSET 330
  LIMIT 20
);

-- 19c. 30 inactive AWS Identity Center users
UPDATE aws_identity_center_users
SET active = FALSE,
    user_status = 'DISABLED',
    last_synced_at = '2025-11-01T00:00:00Z'::timestamptz,
    raw_response = raw_response || '{"stale_flag": true}'::jsonb
WHERE id IN (
  SELECT id FROM aws_identity_center_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  ORDER BY id
  OFFSET 380
  LIMIT 30
);

-- 19d. 20 deleted (soft) canonical users (departed employees)
UPDATE canonical_users
SET deleted_at = '2026-02-10T17:00:00Z'::timestamptz
WHERE id IN (
  SELECT id FROM canonical_users
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  ORDER BY created_at, id
  OFFSET 680
  LIMIT 20
);

COMMIT;

-- ============================================================
-- 20. Verification queries (outside transaction)
-- ============================================================

SELECT '-- V1: Canonical user counts' AS verification;
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE deleted_at IS NULL) AS active,
       COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
FROM canonical_users
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

SELECT '-- V2: Provider identity counts' AS verification;
SELECT 'google_workspace_users' AS provider, COUNT(*) AS cnt FROM google_workspace_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'aws_identity_center_users', COUNT(*) FROM aws_identity_center_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_users', COUNT(*) FROM github_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
ORDER BY provider;

SELECT '-- V3: Group and membership counts' AS verification;
SELECT 'google_workspace_groups' AS entity, COUNT(*) AS cnt FROM google_workspace_groups WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'google_workspace_memberships', COUNT(*) FROM google_workspace_memberships WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'aws_identity_center_groups', COUNT(*) FROM aws_identity_center_groups WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'aws_identity_center_memberships', COUNT(*) FROM aws_identity_center_memberships WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_teams', COUNT(*) FROM github_teams WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_team_memberships', COUNT(*) FROM github_team_memberships WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_org_memberships', COUNT(*) FROM github_org_memberships WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_repositories', COUNT(*) FROM github_repositories WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_repo_team_permissions', COUNT(*) FROM github_repo_team_permissions WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'github_repo_collaborator_permissions', COUNT(*) FROM github_repo_collaborator_permissions WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
ORDER BY entity;

SELECT '-- V4: Canonical provider links by type' AS verification;
SELECT provider_type, COUNT(*) AS cnt
FROM canonical_user_provider_links
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
GROUP BY provider_type
ORDER BY provider_type;

SELECT '-- V5: Edge cases' AS verification;
SELECT 'suspended_google_users' AS edge_case, COUNT(*) AS cnt FROM google_workspace_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND suspended = TRUE
UNION ALL
SELECT 'archived_google_users', COUNT(*) FROM google_workspace_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND archived = TRUE
UNION ALL
SELECT 'inactive_aws_idc_users', COUNT(*) FROM aws_identity_center_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND active = FALSE
UNION ALL
SELECT 'deleted_canonical_users', COUNT(*) FROM canonical_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND deleted_at IS NOT NULL
UNION ALL
SELECT 'github_noreply_users', COUNT(*) FROM github_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND email LIKE '%@users.noreply.github.com'
UNION ALL
SELECT 'reconciliation_queue_pending', COUNT(*) FROM identity_reconciliation_queue WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid AND status = 'PENDING'
ORDER BY edge_case;

SELECT '-- V6: Users with multiple provider links' AS verification;
SELECT COUNT(*) AS users_with_multiple_providers
FROM (
  SELECT canonical_user_id
  FROM canonical_user_provider_links
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  GROUP BY canonical_user_id
  HAVING COUNT(DISTINCT provider_type) > 1
) sub;
