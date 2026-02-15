-- ============================================================
-- 10-dlp · Legal Hold
-- ============================================================
-- Prevents deletion/purge of data within a defined scope and time range.
-- Used for litigation, regulatory investigations, and compliance audits.
--
-- While a legal hold is active, NO history or audit data matching its
-- scope may be purged, redacted, or hard-deleted.
-- ============================================================

CREATE TABLE IF NOT EXISTS legal_hold (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),

    hold_name           TEXT NOT NULL,
    description         TEXT,
    status              TEXT NOT NULL DEFAULT 'active',  -- 'active', 'released'

    -- Scope (NULL = all)
    scope_provider_code TEXT REFERENCES cloud_provider(provider_code),
    scope_entity_type   TEXT,
    scope_entity_id     UUID,                  -- specific entity, or NULL for all

    -- Time range the hold covers
    hold_from           TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    hold_until          TIMESTAMPTZ DEFAULT 'infinity',

    -- Administrative
    requested_by        TEXT NOT NULL,
    approved_by         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at         TIMESTAMPTZ,
    released_by         TEXT,
    notes               TEXT,

    CONSTRAINT ck_legal_hold_status CHECK (status IN ('active', 'released')),
    CONSTRAINT ck_hold_time_range   CHECK (hold_from <= hold_until)
);

CREATE INDEX IF NOT EXISTS idx_legal_hold_active
    ON legal_hold (tenant_id, status) WHERE status = 'active';

-- Only admin can manage legal holds
GRANT SELECT ON legal_hold TO cloudintel_audit, cloudintel_analyst;
GRANT SELECT, INSERT, UPDATE ON legal_hold TO cloudintel_admin;
-- No DELETE: legal holds are released, never deleted
REVOKE DELETE ON legal_hold FROM cloudintel_admin;
