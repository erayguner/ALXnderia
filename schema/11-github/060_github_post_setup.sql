-- 11-github · Post-Setup: Indexes, RLS, Redaction View, Grants
-- This file runs AFTER tables 010–050 are created and AFTER the
-- 07-indexes / 08-security / 10-dlp scripts (which cannot reference
-- tables that don't yet exist at sort-order time).

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_github_user_person ON github_user (person_id)
    WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_github_user_email  ON github_user (tenant_id, lower(email))
    WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_github_user_login  ON github_user (tenant_id, login);
CREATE INDEX IF NOT EXISTS idx_github_org_tenant ON github_organisation (tenant_id);
CREATE INDEX IF NOT EXISTS idx_github_team_org ON github_team (org_id);
CREATE INDEX IF NOT EXISTS idx_github_team_parent ON github_team (parent_team_id)
    WHERE parent_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_github_tm_user ON github_team_membership (user_id);
CREATE INDEX IF NOT EXISTS idx_github_tm_team ON github_team_membership (team_id);
CREATE INDEX IF NOT EXISTS idx_github_om_user ON github_org_membership (user_id);
CREATE INDEX IF NOT EXISTS idx_github_om_org  ON github_org_membership (org_id);

-- ── Row-Level Security ──
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'github_organisation', 'github_user', 'github_team',
        'github_team_membership', 'github_org_membership'
    ]) LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             AS PERMISSIVE FOR ALL
             TO cloudintel_ingest, cloudintel_analyst, cloudintel_app
             USING (tenant_id = current_setting(''app.current_tenant_id'')::UUID)
             WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'')::UUID)',
            tbl
        );
        -- Grants
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO cloudintel_ingest', tbl);
        EXECUTE format('GRANT SELECT ON %I TO cloudintel_analyst', tbl);
    END LOOP;
END $$;

-- ── PII Redaction View ──
CREATE OR REPLACE VIEW v_github_user_redacted AS
SELECT
    u.id,
    u.tenant_id,
    u.github_user_id,
    u.login,
    _redact_email(u.email) AS email,
    _redact_name(u.display_name) AS display_name,
    u.two_factor_enabled,
    u.ingested_at,
    u.last_seen_at
FROM github_user u;

GRANT SELECT ON v_github_user_redacted TO cloudintel_readonly;

-- ── person_id FK (deferred — person table created in 04-identity) ──
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_github_user_person'
    ) THEN
        ALTER TABLE github_user
            ADD CONSTRAINT fk_github_user_person
            FOREIGN KEY (person_id) REFERENCES person(id);
    END IF;
END $$;
