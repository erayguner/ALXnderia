-- ==========================================================================
-- 04  Audit Log
-- ==========================================================================
-- Stores query audit entries for compliance and debugging.
-- Data-minimised: logs metadata only (question, SQL, timing), never result data.

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    user_id         TEXT NOT NULL,
    question        TEXT NOT NULL,
    sql_executed    TEXT NOT NULL DEFAULT '',
    row_count       INTEGER NOT NULL DEFAULT 0,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL CHECK (status IN ('success', 'error', 'rejected')),
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created
    ON audit_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
    ON audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_status
    ON audit_log (status) WHERE status != 'success';
