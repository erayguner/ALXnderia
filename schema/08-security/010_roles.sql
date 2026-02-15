-- ============================================================
-- 08-security · Database Roles (Least Privilege)
-- ============================================================
-- Role hierarchy:
--   cloudintel_admin    → DDL, full DML, role management
--   cloudintel_ingest   → INSERT/UPDATE/DELETE on operational tables only
--   cloudintel_analyst  → SELECT on operational + mat views; no PII raw_payload
--   cloudintel_readonly → SELECT on redacted views only
--   cloudintel_audit    → SELECT on audit/history tables only (investigations)
--   cloudintel_app      → The application connection role (inherits ingest)
-- ============================================================

-- Roles (idempotent: DO blocks check existence)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudintel_admin') THEN
        CREATE ROLE cloudintel_admin NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudintel_ingest') THEN
        CREATE ROLE cloudintel_ingest NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudintel_analyst') THEN
        CREATE ROLE cloudintel_analyst NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudintel_readonly') THEN
        CREATE ROLE cloudintel_readonly NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudintel_audit') THEN
        CREATE ROLE cloudintel_audit NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudintel_app') THEN
        CREATE ROLE cloudintel_app LOGIN;
    END IF;
END $$;

-- cloudintel_app inherits ingest capabilities
GRANT cloudintel_ingest TO cloudintel_app;

-- Schema-level grants
GRANT USAGE ON SCHEMA public TO cloudintel_ingest, cloudintel_analyst,
    cloudintel_readonly, cloudintel_audit;

-- Admin: full control
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO cloudintel_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO cloudintel_admin;

-- Ingest: DML on operational tables (granted per-table below)
-- Analyst: SELECT on operational tables (granted per-table below)
-- Readonly: SELECT on redacted views only (granted in 10-dlp)
-- Audit: SELECT on history/audit tables only (granted in 09-history)

-- ── Per-table grants: operational tables ──
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'cloud_provider', 'tenant',
            'aws_account', 'aws_iam_user', 'aws_iam_user_policy_attachment',
            'aws_idc_user', 'aws_idc_group', 'aws_idc_group_membership',
            'aws_idc_permission_set', 'aws_idc_account_assignment',
            'gcp_project', 'gcp_workspace_user', 'gcp_workspace_group',
            'gcp_workspace_group_membership', 'gcp_iam_binding',
            'person', 'person_link',
            'github_organisation', 'github_user', 'github_team',
            'github_team_membership', 'github_org_membership'
        ])
    LOOP
        -- Ingest: INSERT, UPDATE, DELETE (no TRUNCATE, no DDL)
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO cloudintel_ingest', tbl);
        -- Analyst: read-only
        EXECUTE format('GRANT SELECT ON %I TO cloudintel_analyst', tbl);
    END LOOP;
END $$;

-- Analyst: access to materialised views
GRANT SELECT ON mv_effective_access TO cloudintel_analyst;

-- Sequences (for any serial columns or nextval calls)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO cloudintel_ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE ON SEQUENCES TO cloudintel_ingest;
