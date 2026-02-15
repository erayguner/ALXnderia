-- ============================================================
-- 08-security · Row-Level Security for Tenant Isolation
-- ============================================================
-- Strategy:
--   Every table with tenant_id gets RLS enabled.
--   The application sets current_setting('app.current_tenant_id')
--   at connection/transaction start.
--   Admin role bypasses RLS (BYPASSRLS attribute).
--   Ingest and analyst roles are filtered by tenant_id.
-- ============================================================

-- Helper: create a standard tenant-isolation policy on a table.
-- Idempotent: drops existing policy first if present.
CREATE OR REPLACE FUNCTION _create_tenant_rls(p_table TEXT)
RETURNS VOID AS $$
BEGIN
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table);
    -- Force RLS even for table owner (defence-in-depth)
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_table);

    -- Drop existing policy if present (idempotent)
    EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation ON %I', p_table
    );

    -- Permissive SELECT/INSERT/UPDATE/DELETE: tenant must match session var
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
         AS PERMISSIVE
         FOR ALL
         TO cloudintel_ingest, cloudintel_analyst, cloudintel_app
         USING (tenant_id = current_setting(''app.current_tenant_id'')::UUID)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'')::UUID)',
        p_table
    );
END;
$$ LANGUAGE plpgsql;

-- Apply to all tenant-scoped tables
SELECT _create_tenant_rls(t) FROM unnest(ARRAY[
    'aws_account', 'aws_iam_user', 'aws_iam_user_policy_attachment',
    'aws_idc_user', 'aws_idc_group', 'aws_idc_group_membership',
    'aws_idc_permission_set', 'aws_idc_account_assignment',
    'gcp_project', 'gcp_workspace_user', 'gcp_workspace_group',
    'gcp_workspace_group_membership', 'gcp_iam_binding',
    'person', 'person_link',
    'github_organisation', 'github_user', 'github_team',
    'github_team_membership', 'github_org_membership'
]) AS t;

-- Admin bypasses RLS
ALTER ROLE cloudintel_admin BYPASSRLS;

-- Drop the helper (not needed at runtime)
DROP FUNCTION _create_tenant_rls(TEXT);

-- ============================================================
-- Usage pattern (application must set before every transaction):
--
--   SET LOCAL app.current_tenant_id = '<tenant-uuid>';
--   SELECT * FROM aws_account;  -- only sees rows for that tenant
-- ============================================================
