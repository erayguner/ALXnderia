-- ============================================================
-- 09-history · Snapshot Registry
-- ============================================================
-- Tracks full-state snapshots taken for a tenant+provider scope.
-- Each snapshot correlates to a set of entity_history rows with
-- matching sync_run_id and event_action = 'SNAPSHOT'.
--
-- Used to:
--   - Record when full syncs occurred,
--   - Enable "reconstruct as-of timestamp T" by finding the nearest snapshot
--     then applying deltas forward,
--   - Support DLP evidence collection and provider-state export.
-- ============================================================

CREATE TABLE IF NOT EXISTS snapshot_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    provider_code   TEXT NOT NULL REFERENCES cloud_provider(provider_code),
    scope           TEXT NOT NULL DEFAULT 'full',  -- 'full', 'users', 'groups', 'entitlements'
    sync_run_id     TEXT NOT NULL UNIQUE,
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'in_progress',  -- 'in_progress', 'completed', 'failed'
    entity_count    INTEGER,
    error_detail    TEXT,
    -- Integrity: hash of all entity hashes in this snapshot (Merkle root)
    merkle_root     TEXT,
    metadata        JSONB,

    CONSTRAINT ck_snapshot_status CHECK (status IN ('in_progress', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_snapshot_tenant_provider
    ON snapshot_registry (tenant_id, provider_code, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_status
    ON snapshot_registry (status) WHERE status = 'in_progress';

-- Grants
GRANT SELECT ON snapshot_registry TO cloudintel_audit, cloudintel_analyst;
GRANT SELECT, INSERT, UPDATE ON snapshot_registry TO cloudintel_ingest;
