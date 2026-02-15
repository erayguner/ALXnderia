-- 05-views · Materialised View: Effective Access
-- Unions direct + group-derived access across both providers.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_effective_access AS

-- AWS Identity Center: direct user assignments
SELECT
    p.id                            AS person_id,
    p.tenant_id,
    'aws'::TEXT                     AS cloud_provider,
    aa.account_id                   AS account_or_project_id,
    aa.account_name                 AS account_or_project_name,
    ps.permission_set_name          AS role_or_permission_set,
    'direct'::TEXT                  AS access_path,
    NULL::TEXT                      AS via_group_name,
    asgn.last_seen_at
FROM aws_idc_account_assignment asgn
JOIN aws_idc_user           iu  ON iu.id  = asgn.principal_user_id
JOIN person                 p   ON p.id   = iu.person_id
JOIN aws_account            aa  ON aa.id  = asgn.aws_account_id
JOIN aws_idc_permission_set ps  ON ps.id  = asgn.permission_set_id
WHERE asgn.principal_type = 'USER'
  AND asgn.deleted_at IS NULL
  AND iu.disabled_at IS NULL

UNION ALL

-- AWS Identity Center: group-derived assignments
SELECT
    p.id,
    p.tenant_id,
    'aws',
    aa.account_id,
    aa.account_name,
    ps.permission_set_name,
    'group',
    ig.display_name,
    asgn.last_seen_at
FROM aws_idc_account_assignment asgn
JOIN aws_idc_group              ig  ON ig.id  = asgn.principal_group_id
JOIN aws_idc_group_membership   gm  ON gm.group_id = ig.id AND gm.deleted_at IS NULL
JOIN aws_idc_user               iu  ON iu.id  = gm.user_id
JOIN person                     p   ON p.id   = iu.person_id
JOIN aws_account                aa  ON aa.id  = asgn.aws_account_id
JOIN aws_idc_permission_set     ps  ON ps.id  = asgn.permission_set_id
WHERE asgn.principal_type = 'GROUP'
  AND asgn.deleted_at IS NULL
  AND iu.disabled_at IS NULL

UNION ALL

-- GCP: direct user bindings
SELECT
    p.id,
    p.tenant_id,
    'gcp',
    gp.project_id,
    gp.project_name,
    b.role,
    'direct',
    NULL,
    b.last_seen_at
FROM gcp_iam_binding b
JOIN gcp_workspace_user wu ON wu.id = b.workspace_user_id
JOIN person             p  ON p.id  = wu.person_id
JOIN gcp_project        gp ON gp.id = b.gcp_project_id
WHERE b.principal_type = 'user'
  AND b.deleted_at IS NULL

UNION ALL

-- GCP: group-derived bindings
SELECT
    p.id,
    p.tenant_id,
    'gcp',
    gp.project_id,
    gp.project_name,
    b.role,
    'group',
    wg.display_name,
    b.last_seen_at
FROM gcp_iam_binding b
JOIN gcp_workspace_group            wg  ON wg.id = b.workspace_group_id
JOIN gcp_workspace_group_membership gm  ON gm.group_id = wg.id AND gm.deleted_at IS NULL
JOIN gcp_workspace_user             wu  ON wu.id = gm.user_id
JOIN person                         p   ON p.id  = wu.person_id
JOIN gcp_project                    gp  ON gp.id = b.gcp_project_id
WHERE b.principal_type = 'group'
  AND b.deleted_at IS NULL

WITH NO DATA;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
-- Uses NULLS NOT DISTINCT (PG 15+) so NULL via_group_name is treated as equal
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ea_unique ON mv_effective_access (
    person_id, cloud_provider, account_or_project_id,
    role_or_permission_set, access_path, via_group_name
) NULLS NOT DISTINCT;
