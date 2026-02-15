-- ============================================================
-- 10-dlp · PII Redaction Views
-- ============================================================
-- These views expose identity data with PII fields masked/tokenised.
-- Used by the cloudintel_readonly role for analytics dashboards
-- that must not expose personal data (GDPR data minimisation).
--
-- Strategy: replace email local-part with a hash, mask display names.
-- ============================================================

CREATE OR REPLACE FUNCTION _redact_email(email TEXT)
RETURNS TEXT AS $$
BEGIN
    IF email IS NULL THEN RETURN NULL; END IF;
    RETURN LEFT(encode(digest(split_part(email, '@', 1), 'sha256'), 'hex'), 8)
           || '@' || split_part(email, '@', 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _redact_name(name TEXT)
RETURNS TEXT AS $$
BEGIN
    IF name IS NULL THEN RETURN NULL; END IF;
    IF length(name) <= 2 THEN RETURN '***'; END IF;
    RETURN left(name, 1) || repeat('*', length(name) - 2) || right(name, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── Redacted person view ──
CREATE OR REPLACE VIEW v_person_redacted AS
SELECT
    p.id,
    p.tenant_id,
    _redact_name(p.display_name) AS display_name,
    _redact_email(p.primary_email) AS primary_email,
    p.status,
    p.created_at,
    p.updated_at
FROM person p;

-- ── Redacted AWS IDC user view ──
CREATE OR REPLACE VIEW v_aws_idc_user_redacted AS
SELECT
    u.id,
    u.tenant_id,
    u.identity_store_user_id,
    u.identity_store_id,
    _redact_email(u.email) AS email,
    _redact_name(u.display_name) AS display_name,
    u.ingested_at,
    u.last_seen_at,
    u.disabled_at
FROM aws_idc_user u;

-- ── Redacted GCP Workspace user view ──
CREATE OR REPLACE VIEW v_gcp_workspace_user_redacted AS
SELECT
    u.id,
    u.tenant_id,
    u.gw_user_id,
    _redact_email(u.primary_email) AS primary_email,
    _redact_name(u.display_name) AS display_name,
    u.suspended,
    u.ingested_at,
    u.last_seen_at
FROM gcp_workspace_user u;

-- ── Redacted effective access view ──
CREATE OR REPLACE VIEW v_effective_access_redacted AS
SELECT
    ea.person_id,
    ea.tenant_id,
    ea.cloud_provider,
    ea.account_or_project_id,
    ea.account_or_project_name,
    ea.role_or_permission_set,
    ea.access_path,
    ea.via_group_name,
    ea.last_seen_at
FROM mv_effective_access ea;
-- Note: person_id is a UUID (not PII); join to v_person_redacted for names.

-- ── Redacted GitHub user view ──
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

-- Grants for readonly role
GRANT SELECT ON v_person_redacted TO cloudintel_readonly;
GRANT SELECT ON v_aws_idc_user_redacted TO cloudintel_readonly;
GRANT SELECT ON v_gcp_workspace_user_redacted TO cloudintel_readonly;
GRANT SELECT ON v_effective_access_redacted TO cloudintel_readonly;
GRANT SELECT ON v_github_user_redacted TO cloudintel_readonly;
