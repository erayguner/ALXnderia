-- ============================================================
-- 05-views · Effective Access "as-of" Function
-- ============================================================
-- Reconstructs effective access at a given point in time by querying
-- the entity_history table. This is slower than the materialised view
-- (which reflects current state) but enables temporal investigations.
--
-- Usage:
--   SELECT * FROM fn_effective_access_as_of(
--       '{{TENANT_UUID}}', '2026-01-15 12:00:00+00'
--   );
-- ============================================================

CREATE OR REPLACE FUNCTION fn_effective_access_as_of(
    p_tenant_id UUID,
    p_as_of     TIMESTAMPTZ
)
RETURNS TABLE (
    person_entity_id        UUID,
    cloud_provider          TEXT,
    account_or_project_id   TEXT,
    account_or_project_name TEXT,
    role_or_permission_set  TEXT,
    access_path             TEXT,
    via_group_name          TEXT
) AS $$
BEGIN
    RETURN QUERY

    -- Helper CTEs: reconstruct entity state at p_as_of
    -- by taking the latest history row for each entity before that timestamp.
    WITH RECURSIVE

    latest_state AS (
        SELECT DISTINCT ON (eh.entity_type, eh.entity_id)
            eh.entity_type,
            eh.entity_id,
            eh.state_payload,
            eh.event_action
        FROM entity_history eh
        WHERE eh.tenant_id = p_tenant_id
          AND eh.event_time <= p_as_of
        ORDER BY eh.entity_type, eh.entity_id, eh.event_time DESC, eh.id DESC
    ),

    -- Filter out entities that were deleted at that point
    live_state AS (
        SELECT * FROM latest_state
        WHERE event_action <> 'DELETED'
    ),

    -- Reconstruct persons
    persons AS (
        SELECT entity_id AS person_id,
               state_payload->>'display_name' AS display_name
        FROM live_state WHERE entity_type = 'person'
    ),

    -- Reconstruct AWS IDC users
    idc_users AS (
        SELECT entity_id AS user_id,
               (state_payload->>'person_id')::UUID AS person_id,
               state_payload->>'disabled_at' AS disabled_at
        FROM live_state WHERE entity_type = 'aws_idc_user'
    ),

    -- Reconstruct AWS IDC groups
    idc_groups AS (
        SELECT entity_id AS group_id,
               state_payload->>'display_name' AS display_name
        FROM live_state WHERE entity_type = 'aws_idc_group'
    ),

    -- Reconstruct AWS IDC group memberships
    idc_memberships AS (
        SELECT (state_payload->>'group_id')::UUID AS group_id,
               (state_payload->>'user_id')::UUID AS user_id
        FROM live_state WHERE entity_type = 'aws_idc_group_membership'
    ),

    -- Reconstruct AWS accounts
    aws_accounts AS (
        SELECT entity_id AS account_uuid,
               state_payload->>'account_id' AS account_id,
               state_payload->>'account_name' AS account_name
        FROM live_state WHERE entity_type = 'aws_account'
    ),

    -- Reconstruct AWS IDC permission sets
    idc_psets AS (
        SELECT entity_id AS ps_id,
               state_payload->>'permission_set_name' AS ps_name
        FROM live_state WHERE entity_type = 'aws_idc_permission_set'
    ),

    -- Reconstruct AWS IDC account assignments
    idc_assignments AS (
        SELECT state_payload->>'principal_type' AS principal_type,
               (state_payload->>'principal_user_id')::UUID AS principal_user_id,
               (state_payload->>'principal_group_id')::UUID AS principal_group_id,
               (state_payload->>'permission_set_id')::UUID AS permission_set_id,
               (state_payload->>'aws_account_id')::UUID AS aws_account_id
        FROM live_state WHERE entity_type = 'aws_idc_account_assignment'
    ),

    -- Reconstruct GCP projects
    gcp_projects AS (
        SELECT entity_id AS project_uuid,
               state_payload->>'project_id' AS project_id,
               state_payload->>'project_name' AS project_name
        FROM live_state WHERE entity_type = 'gcp_project'
    ),

    -- Reconstruct GCP workspace users
    gcp_ws_users AS (
        SELECT entity_id AS user_id,
               (state_payload->>'person_id')::UUID AS person_id
        FROM live_state WHERE entity_type = 'gcp_workspace_user'
    ),

    -- Reconstruct GCP workspace groups
    gcp_ws_groups AS (
        SELECT entity_id AS group_id,
               state_payload->>'display_name' AS display_name
        FROM live_state WHERE entity_type = 'gcp_workspace_group'
    ),

    -- Reconstruct GCP workspace group memberships
    gcp_ws_memberships AS (
        SELECT (state_payload->>'group_id')::UUID AS group_id,
               (state_payload->>'user_id')::UUID AS user_id
        FROM live_state WHERE entity_type = 'gcp_workspace_group_membership'
    ),

    -- Reconstruct GCP IAM bindings
    gcp_bindings AS (
        SELECT state_payload->>'principal_type' AS principal_type,
               (state_payload->>'workspace_user_id')::UUID AS workspace_user_id,
               (state_payload->>'workspace_group_id')::UUID AS workspace_group_id,
               state_payload->>'role' AS role,
               (state_payload->>'gcp_project_id')::UUID AS gcp_project_id
        FROM live_state WHERE entity_type = 'gcp_iam_binding'
    )

    -- ── AWS IDC: direct user assignments ──
    SELECT
        iu.person_id       AS person_entity_id,
        'aws'::TEXT,
        aa.account_id,
        aa.account_name,
        ps.ps_name,
        'direct'::TEXT,
        NULL::TEXT
    FROM idc_assignments asgn
    JOIN idc_users   iu ON iu.user_id = asgn.principal_user_id
    JOIN aws_accounts aa ON aa.account_uuid = asgn.aws_account_id
    JOIN idc_psets   ps ON ps.ps_id = asgn.permission_set_id
    WHERE asgn.principal_type = 'USER'
      AND iu.disabled_at IS NULL
      AND iu.person_id IS NOT NULL

    UNION ALL

    -- ── AWS IDC: group-derived assignments ──
    SELECT
        iu.person_id,
        'aws',
        aa.account_id,
        aa.account_name,
        ps.ps_name,
        'group',
        ig.display_name
    FROM idc_assignments asgn
    JOIN idc_groups      ig ON ig.group_id = asgn.principal_group_id
    JOIN idc_memberships gm ON gm.group_id = ig.group_id
    JOIN idc_users       iu ON iu.user_id = gm.user_id
    JOIN aws_accounts    aa ON aa.account_uuid = asgn.aws_account_id
    JOIN idc_psets       ps ON ps.ps_id = asgn.permission_set_id
    WHERE asgn.principal_type = 'GROUP'
      AND iu.disabled_at IS NULL
      AND iu.person_id IS NOT NULL

    UNION ALL

    -- ── GCP: direct user bindings ──
    SELECT
        wu.person_id,
        'gcp',
        gp.project_id,
        gp.project_name,
        b.role,
        'direct',
        NULL
    FROM gcp_bindings b
    JOIN gcp_ws_users  wu ON wu.user_id = b.workspace_user_id
    JOIN gcp_projects  gp ON gp.project_uuid = b.gcp_project_id
    WHERE b.principal_type = 'user'
      AND wu.person_id IS NOT NULL

    UNION ALL

    -- ── GCP: group-derived bindings ──
    SELECT
        wu.person_id,
        'gcp',
        gp.project_id,
        gp.project_name,
        b.role,
        'group',
        wg.display_name
    FROM gcp_bindings b
    JOIN gcp_ws_groups      wg ON wg.group_id = b.workspace_group_id
    JOIN gcp_ws_memberships gm ON gm.group_id = wg.group_id
    JOIN gcp_ws_users       wu ON wu.user_id = gm.user_id
    JOIN gcp_projects       gp ON gp.project_uuid = b.gcp_project_id
    WHERE b.principal_type = 'group'
      AND wu.person_id IS NOT NULL;

END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION fn_effective_access_as_of(UUID, TIMESTAMPTZ)
    TO cloudintel_analyst, cloudintel_audit;
