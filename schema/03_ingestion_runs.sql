-- =================================================================================================
-- Ingestion Run Tracking (PostgreSQL 18) - Multi-Tenant Version
-- =================================================================================================
-- Tracks each provider sync execution for observability, debugging, and scheduling.
-- =================================================================================================

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id               UUID DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL,
    provider         TEXT NOT NULL,
    entity_type      TEXT,
    status           TEXT NOT NULL DEFAULT 'RUNNING',
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ,
    records_upserted INTEGER DEFAULT 0,
    records_deleted  INTEGER DEFAULT 0,
    error_message    TEXT,
    error_detail     JSONB,
    run_metadata     JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_provider
    ON ingestion_runs(tenant_id, provider);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status
    ON ingestion_runs(tenant_id, status) WHERE status != 'SUCCESS';

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_latest
    ON ingestion_runs(tenant_id, provider, started_at DESC);
