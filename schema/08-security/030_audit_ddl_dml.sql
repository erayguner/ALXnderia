-- ============================================================
-- 08-security · Audit Log (DDL/DML event capture)
-- ============================================================
-- This table captures significant data-mutation events from the
-- application layer (ingestion pipeline) for compliance auditing.
-- For DDL auditing, enable pgaudit extension at the server level.
--
-- This is NOT a replacement for the history/event log in 09-history
-- which tracks entity state changes. This table tracks *who did what
-- from which system* at the database interaction level.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_id       UUID,
    actor           TEXT NOT NULL DEFAULT current_user,
    client_addr     INET DEFAULT inet_client_addr(),
    action          TEXT NOT NULL,             -- 'INSERT', 'UPDATE', 'DELETE', 'DDL', 'LOGIN', 'EXPORT'
    target_table    TEXT,
    target_id       UUID,                      -- PK of affected row (if applicable)
    detail          JSONB,                     -- changed fields, old/new values (selective)
    source_system   TEXT,                      -- 'sync_pipeline', 'admin_ui', 'api'
    request_id      TEXT,                      -- correlation id from the calling system
    integrity_hash  TEXT                        -- SHA-256 chain (see 09-history)
) PARTITION BY RANGE (event_time);

-- Create initial partitions (quarterly; add more via cron/migration)
CREATE TABLE IF NOT EXISTS audit_log_2026_q1 PARTITION OF audit_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS audit_log_2026_q2 PARTITION OF audit_log
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS audit_log_2026_q3 PARTITION OF audit_log
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS audit_log_2026_q4 PARTITION OF audit_log
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

CREATE INDEX IF NOT EXISTS idx_audit_log_time     ON audit_log (event_time);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant   ON audit_log (tenant_id, event_time);
CREATE INDEX IF NOT EXISTS idx_audit_log_target   ON audit_log (target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor    ON audit_log (actor, event_time);

-- Audit role: read-only on audit and history tables
GRANT SELECT ON audit_log TO cloudintel_audit;

-- Ingest role can INSERT audit entries but never UPDATE/DELETE them
GRANT INSERT ON audit_log TO cloudintel_ingest;
-- Explicitly revoke mutation (defence-in-depth)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM cloudintel_ingest;

-- ============================================================
-- pgaudit configuration (server-level; set in postgresql.conf):
--
--   shared_preload_libraries = 'pgaudit'
--   pgaudit.log = 'ddl, role'
--   pgaudit.log_catalog = off
--   pgaudit.log_relation = on
--   pgaudit.log_statement_once = on
--
-- This captures all DDL and role changes to the PG server log,
-- which should be shipped to a SIEM (e.g., CloudWatch, Loki).
-- ============================================================
