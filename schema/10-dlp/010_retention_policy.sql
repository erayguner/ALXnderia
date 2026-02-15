-- ============================================================
-- 10-dlp · Data Retention Policies
-- ============================================================
-- Configurable per-tenant, per-entity-type retention schedules.
-- The application (or a cron job) uses these rules to determine
-- when to purge old entity_history rows and raw_payload data.
--
-- Hard-delete of history is ONLY permitted after:
--   1) Retention period has passed, AND
--   2) No active legal_hold covers the data, AND
--   3) The purge is logged in audit_log.
-- ============================================================

CREATE TABLE IF NOT EXISTS retention_policy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    entity_type         TEXT,                    -- NULL = default for all types
    provider_code       TEXT REFERENCES cloud_provider(provider_code),

    -- Retention durations
    operational_ttl     INTERVAL NOT NULL DEFAULT '365 days',  -- current-state raw_payload
    history_ttl         INTERVAL NOT NULL DEFAULT '2555 days', -- ~7 years for entity_history
    audit_log_ttl       INTERVAL NOT NULL DEFAULT '2555 days', -- ~7 years for audit_log

    -- PII-specific
    pii_redact_after    INTERVAL DEFAULT '90 days',   -- redact PII fields after this
    pii_hard_delete_after INTERVAL DEFAULT '730 days', -- hard-delete PII after this

    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT NOT NULL DEFAULT current_user,

    CONSTRAINT uq_retention_policy UNIQUE (tenant_id, entity_type, provider_code)
);

-- Grants: only admin can manage retention policies
GRANT SELECT ON retention_policy TO cloudintel_audit, cloudintel_analyst;
GRANT SELECT, INSERT, UPDATE ON retention_policy TO cloudintel_admin;

-- ============================================================
-- Purge function: removes history rows past retention, respecting legal holds.
-- Should be called by a scheduled job (pg_cron or external scheduler).
-- ============================================================

CREATE OR REPLACE FUNCTION purge_expired_history(p_dry_run BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
    tenant_id       UUID,
    entity_type     TEXT,
    rows_to_purge   BIGINT,
    action_taken    TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT
            eh.tenant_id,
            eh.entity_type,
            COUNT(*) AS cnt
        FROM entity_history eh
        JOIN retention_policy rp
            ON rp.tenant_id = eh.tenant_id
           AND (rp.entity_type IS NULL OR rp.entity_type = eh.entity_type)
           AND rp.enabled = TRUE
        WHERE eh.event_time < now() - rp.history_ttl
          -- Exclude anything under legal hold
          AND NOT EXISTS (
              SELECT 1 FROM legal_hold lh
              WHERE lh.tenant_id = eh.tenant_id
                AND lh.status = 'active'
                AND (lh.scope_entity_type IS NULL OR lh.scope_entity_type = eh.entity_type)
                AND eh.event_time BETWEEN lh.hold_from AND COALESCE(lh.hold_until, 'infinity')
          )
        GROUP BY eh.tenant_id, eh.entity_type
    )
    SELECT
        c.tenant_id,
        c.entity_type,
        c.cnt,
        CASE WHEN p_dry_run THEN 'DRY_RUN' ELSE 'PURGED' END
    FROM candidates c;

    -- Actual deletion only when not dry-run
    IF NOT p_dry_run THEN
        DELETE FROM entity_history eh
        USING retention_policy rp
        WHERE rp.tenant_id = eh.tenant_id
          AND (rp.entity_type IS NULL OR rp.entity_type = eh.entity_type)
          AND rp.enabled = TRUE
          AND eh.event_time < now() - rp.history_ttl
          AND NOT EXISTS (
              SELECT 1 FROM legal_hold lh
              WHERE lh.tenant_id = eh.tenant_id
                AND lh.status = 'active'
                AND (lh.scope_entity_type IS NULL OR lh.scope_entity_type = eh.entity_type)
                AND eh.event_time BETWEEN lh.hold_from AND COALESCE(lh.hold_until, 'infinity')
          );
    END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION purge_expired_history(BOOLEAN) TO cloudintel_admin;
