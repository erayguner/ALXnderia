-- ============================================================
-- Example Queries for Cloud Account & Identity Intelligence
-- Replace {{PERSON_UUID}} / {{GROUP_UUID}} with real UUIDs.
-- ============================================================

-- Q1: All cloud accounts/projects a person can access (effective)
SELECT cloud_provider, account_or_project_id, account_or_project_name,
       role_or_permission_set, access_path, via_group_name
FROM mv_effective_access
WHERE person_id = '{{PERSON_UUID}}'
ORDER BY cloud_provider, account_or_project_id;

-- Q2: Who can access a specific AWS account?
SELECT p.display_name, p.primary_email,
       ea.role_or_permission_set, ea.access_path, ea.via_group_name
FROM mv_effective_access ea
JOIN person p ON p.id = ea.person_id
WHERE ea.cloud_provider = 'aws'
  AND ea.account_or_project_id = '123456789012'
ORDER BY p.display_name;

-- Q3: Who can access a specific GCP project?
SELECT p.display_name, p.primary_email,
       ea.role_or_permission_set, ea.access_path, ea.via_group_name
FROM mv_effective_access ea
JOIN person p ON p.id = ea.person_id
WHERE ea.cloud_provider = 'gcp'
  AND ea.account_or_project_id = 'my-production-project'
ORDER BY p.display_name;

-- Q4: All identities for a person across providers (no mat-view)
SELECT p.display_name, 'aws_iam' AS identity_type,
       iau.iam_user_name AS identifier, iau.arn, aa.account_id AS scope
FROM person p
JOIN aws_iam_user iau ON iau.person_id = p.id
JOIN aws_account  aa  ON aa.id = iau.aws_account_id
WHERE p.id = '{{PERSON_UUID}}'
UNION ALL
SELECT p.display_name, 'aws_idc', icu.user_name, NULL, icu.identity_store_id
FROM person p
JOIN aws_idc_user icu ON icu.person_id = p.id
WHERE p.id = '{{PERSON_UUID}}'
UNION ALL
SELECT p.display_name, 'gcp_workspace', wu.primary_email, NULL, wu.customer_id
FROM person p
JOIN gcp_workspace_user wu ON wu.person_id = p.id
WHERE p.id = '{{PERSON_UUID}}';

-- Q5: Group memberships for a person across providers
SELECT 'aws_idc_group' AS group_type, ig.display_name, gm.ingested_at
FROM person p
JOIN aws_idc_user             iu ON iu.person_id = p.id
JOIN aws_idc_group_membership gm ON gm.user_id   = iu.id AND gm.deleted_at IS NULL
JOIN aws_idc_group            ig ON ig.id         = gm.group_id
WHERE p.id = '{{PERSON_UUID}}'
UNION ALL
SELECT 'gcp_workspace_group', wg.display_name, wgm.ingested_at
FROM person p
JOIN gcp_workspace_user             wu  ON wu.person_id = p.id
JOIN gcp_workspace_group_membership wgm ON wgm.user_id  = wu.id AND wgm.deleted_at IS NULL
JOIN gcp_workspace_group            wg  ON wg.id        = wgm.group_id
WHERE p.id = '{{PERSON_UUID}}';

-- Q6: Expand an AWS IDC group to all member persons + entitlements
SELECT ig.display_name AS group_name, p.display_name AS person_name,
       p.primary_email, ps.permission_set_name,
       aa.account_id, aa.account_name
FROM aws_idc_group ig
JOIN aws_idc_account_assignment asgn ON asgn.principal_group_id = ig.id
                                     AND asgn.principal_type = 'GROUP'
                                     AND asgn.deleted_at IS NULL
JOIN aws_idc_permission_set     ps   ON ps.id  = asgn.permission_set_id
JOIN aws_account                aa   ON aa.id  = asgn.aws_account_id
JOIN aws_idc_group_membership   gm   ON gm.group_id = ig.id AND gm.deleted_at IS NULL
JOIN aws_idc_user               iu   ON iu.id  = gm.user_id AND iu.disabled_at IS NULL
JOIN person                     p    ON p.id   = iu.person_id
WHERE ig.id = '{{GROUP_UUID}}'
ORDER BY ps.permission_set_name, aa.account_id, p.display_name;

-- Q7 (bonus): Stale identities not seen in 30 days
SELECT 'aws_iam_user' AS type, iam_user_name AS name, last_seen_at
FROM aws_iam_user
WHERE last_seen_at < now() - INTERVAL '30 days' AND deleted_at IS NULL
UNION ALL
SELECT 'aws_idc_user', user_name, last_seen_at
FROM aws_idc_user
WHERE last_seen_at < now() - INTERVAL '30 days' AND disabled_at IS NULL
UNION ALL
SELECT 'gcp_workspace_user', primary_email, last_seen_at
FROM gcp_workspace_user
WHERE last_seen_at < now() - INTERVAL '30 days' AND deleted_at IS NULL
ORDER BY last_seen_at;
