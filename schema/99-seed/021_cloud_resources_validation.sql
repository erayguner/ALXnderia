-- ============================================================
-- Validation Queries for 020_cloud_resources_seed.sql
-- Run after seeding to verify data integrity and relationships.
-- ============================================================

-- ── V1: Cloud resource counts ──
SELECT '-- V1: Cloud resource counts' AS validation;
SELECT 'aws_accounts' AS entity, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active,
       COUNT(*) FILTER (WHERE status = 'SUSPENDED') AS suspended
FROM aws_accounts
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;

SELECT 'gcp_projects' AS entity, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE lifecycle_state = 'ACTIVE') AS active,
       COUNT(*) FILTER (WHERE lifecycle_state = 'DELETE_REQUESTED') AS decommissioned
FROM gcp_projects
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid;


-- ── V2: Assignment and binding counts ──
SELECT '-- V2: Assignment and binding counts' AS validation;
SELECT 'aws_account_assignments' AS entity, COUNT(*) AS cnt
FROM aws_account_assignments WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'gcp_project_iam_bindings', COUNT(*)
FROM gcp_project_iam_bindings WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
UNION ALL
SELECT 'resource_access_grants', COUNT(*)
FROM resource_access_grants WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
ORDER BY entity;


-- ── V3: resource_access_grants breakdown by provider ──
SELECT '-- V3: Grants by provider and resource type' AS validation;
SELECT provider, resource_type, subject_type, COUNT(*) AS grants
FROM resource_access_grants
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND deleted_at IS NULL
GROUP BY provider, resource_type, subject_type
ORDER BY provider, resource_type, subject_type;


-- ── V4: AWS accounts with assignment counts ──
SELECT '-- V4: AWS accounts with assignment counts' AS validation;
SELECT a.account_id, a.name, a.status,
       COUNT(aa.id) AS assignment_count
FROM aws_accounts a
LEFT JOIN aws_account_assignments aa
  ON aa.account_id = a.account_id AND aa.tenant_id = a.tenant_id AND aa.deleted_at IS NULL
WHERE a.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
GROUP BY a.account_id, a.name, a.status
ORDER BY a.account_id;


-- ── V5: GCP projects with binding counts ──
SELECT '-- V5: GCP projects with binding counts' AS validation;
SELECT p.project_id, p.display_name, p.lifecycle_state,
       COUNT(ib.id) FILTER (WHERE ib.member_type = 'user') AS user_bindings,
       COUNT(ib.id) FILTER (WHERE ib.member_type = 'group') AS group_bindings,
       COUNT(ib.id) AS total_bindings
FROM gcp_projects p
LEFT JOIN gcp_project_iam_bindings ib
  ON ib.project_id = p.project_id AND ib.tenant_id = p.tenant_id AND ib.deleted_at IS NULL
WHERE p.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
GROUP BY p.project_id, p.display_name, p.lifecycle_state
ORDER BY p.project_id;


-- ── V6: Canonical users with cross-provider access (shows a user's full access map) ──
SELECT '-- V6: Sample cross-provider access for first 5 canonical users with grants' AS validation;
SELECT cu.full_name, cu.primary_email,
       rag.provider, rag.resource_type, rag.resource_id,
       rag.resource_display_name, rag.role_or_permission, rag.access_path
FROM resource_access_grants rag
JOIN canonical_users cu ON cu.id = rag.canonical_user_id AND cu.tenant_id = rag.tenant_id
WHERE rag.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND rag.canonical_user_id IS NOT NULL
  AND rag.deleted_at IS NULL
ORDER BY cu.full_name, rag.provider, rag.resource_type
LIMIT 30;


-- ── V7: Permission sets distribution across accounts ──
SELECT '-- V7: Permission set usage' AS validation;
SELECT permission_set_name, COUNT(DISTINCT account_id) AS accounts, COUNT(*) AS assignments
FROM aws_account_assignments
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND deleted_at IS NULL
GROUP BY permission_set_name
ORDER BY assignments DESC;


-- ── V8: GCP role distribution ──
SELECT '-- V8: GCP role distribution' AS validation;
SELECT role, member_type, COUNT(*) AS bindings
FROM gcp_project_iam_bindings
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND deleted_at IS NULL
GROUP BY role, member_type
ORDER BY role, member_type;


-- ── V9: Users with access to BOTH AWS and GCP (cross-cloud identities) ──
SELECT '-- V9: Users with access in both AWS and GCP' AS validation;
SELECT cu.full_name, cu.primary_email,
       COUNT(DISTINCT rag.resource_id) FILTER (WHERE rag.provider = 'aws') AS aws_resources,
       COUNT(DISTINCT rag.resource_id) FILTER (WHERE rag.provider = 'gcp') AS gcp_resources,
       COUNT(DISTINCT rag.resource_id) FILTER (WHERE rag.provider = 'github') AS github_resources
FROM resource_access_grants rag
JOIN canonical_users cu ON cu.id = rag.canonical_user_id AND cu.tenant_id = rag.tenant_id
WHERE rag.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND rag.canonical_user_id IS NOT NULL
  AND rag.deleted_at IS NULL
GROUP BY cu.id, cu.full_name, cu.primary_email
HAVING COUNT(DISTINCT rag.provider) >= 2
ORDER BY (COUNT(DISTINCT rag.resource_id)) DESC
LIMIT 20;


-- ── V10: Referential integrity checks ──
SELECT '-- V10: Referential integrity checks' AS validation;

-- Orphan account assignments (account_id not in aws_accounts)
SELECT 'orphan_aws_assignments' AS check_name, COUNT(*) AS violations
FROM aws_account_assignments aa
WHERE aa.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM aws_accounts a
    WHERE a.account_id = aa.account_id AND a.tenant_id = aa.tenant_id
  )

UNION ALL

-- Orphan GCP bindings (project_id not in gcp_projects)
SELECT 'orphan_gcp_bindings', COUNT(*)
FROM gcp_project_iam_bindings ib
WHERE ib.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM gcp_projects p
    WHERE p.project_id = ib.project_id AND p.tenant_id = ib.tenant_id
  )

UNION ALL

-- Grants with invalid canonical_user_id
SELECT 'orphan_grant_canonical_user', COUNT(*)
FROM resource_access_grants rag
WHERE rag.tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND rag.canonical_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM canonical_users cu
    WHERE cu.id = rag.canonical_user_id AND cu.tenant_id = rag.tenant_id
  )

ORDER BY check_name;
