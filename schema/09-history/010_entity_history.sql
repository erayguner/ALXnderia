-- ============================================================
-- 09-history · Append-Only Entity History with Hash Chaining
-- ============================================================
-- Purpose:
--   Immutable record of every state change for every tracked entity.
--   Supports: point-in-time reconstruction, backup/DLP, tamper evidence,
--   privilege drift detection, and compliance investigations.
--
-- Design:
--   Single polymorphic history table partitioned by event_time.
--   Each row captures the FULL entity state (as JSONB) at that moment.
--   Hash chain: each row includes SHA-256(previous_hash || current_payload)
--   to provide tamper-evidence. Verification is done out-of-band.
--
-- Trade-off:
--   JSONB payload duplicates data but enables schema-independent
--   reconstruction and avoids N history tables.
--   For very high-volume entities, consider per-entity-type partitions.
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_history (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    event_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_id       UUID NOT NULL,
    entity_type     TEXT NOT NULL,              -- 'aws_iam_user', 'aws_idc_group_membership', etc.
    entity_id       UUID NOT NULL,              -- PK of the entity in its operational table
    provider_code   TEXT NOT NULL,              -- 'aws', 'gcp'
    event_action    TEXT NOT NULL,              -- 'SNAPSHOT', 'CREATED', 'UPDATED', 'DELETED', 'RESTORED'
    -- Full entity state at this point in time
    state_payload   JSONB NOT NULL,
    -- Delta from previous state (optional, for efficient diff queries)
    delta_payload   JSONB,
    -- Provenance
    source_system   TEXT NOT NULL DEFAULT 'sync_pipeline',
    sync_run_id     TEXT,                      -- correlates to a specific ingestion run
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Hash chain for tamper evidence
    previous_hash   TEXT,                      -- hex SHA-256 of the previous row for this entity
    integrity_hash  TEXT NOT NULL,             -- hex SHA-256(previous_hash || state_payload::TEXT)

    PRIMARY KEY (event_time, id)
) PARTITION BY RANGE (event_time);

-- Monthly partitions (create via cron/migration for future months)
CREATE TABLE IF NOT EXISTS entity_history_2026_01 PARTITION OF entity_history
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_02 PARTITION OF entity_history
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_03 PARTITION OF entity_history
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_04 PARTITION OF entity_history
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_05 PARTITION OF entity_history
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_06 PARTITION OF entity_history
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_07 PARTITION OF entity_history
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_08 PARTITION OF entity_history
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_09 PARTITION OF entity_history
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_10 PARTITION OF entity_history
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_11 PARTITION OF entity_history
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS entity_history_2026_12 PARTITION OF entity_history
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_eh_entity_lookup
    ON entity_history (tenant_id, entity_type, entity_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_eh_tenant_time
    ON entity_history (tenant_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_eh_sync_run
    ON entity_history (sync_run_id) WHERE sync_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eh_action
    ON entity_history (event_action, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_eh_provider
    ON entity_history (provider_code, entity_type, event_time DESC);

-- GIN on state_payload for ad-hoc JSONB queries during investigations
CREATE INDEX IF NOT EXISTS idx_eh_state_gin
    ON entity_history USING GIN (state_payload);

-- Grants
GRANT SELECT ON entity_history TO cloudintel_audit, cloudintel_analyst;
GRANT INSERT ON entity_history TO cloudintel_ingest;
REVOKE UPDATE, DELETE, TRUNCATE ON entity_history FROM cloudintel_ingest;

-- ============================================================
-- Hash chain computation (application-side pseudocode):
--
--   previous = SELECT integrity_hash FROM entity_history
--              WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
--              ORDER BY event_time DESC, id DESC LIMIT 1;
--
--   new_hash = SHA-256(COALESCE(previous, 'GENESIS') || state_payload::TEXT);
--
--   INSERT INTO entity_history (..., previous_hash, integrity_hash)
--   VALUES (..., previous, new_hash);
-- ============================================================
