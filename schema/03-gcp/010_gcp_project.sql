-- 03-gcp · GCP Project
CREATE TABLE IF NOT EXISTS gcp_project (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id),
    project_id        TEXT NOT NULL,
    project_number    BIGINT,
    project_name      TEXT,
    org_id            TEXT,
    folder_id         TEXT,
    lifecycle_state   TEXT DEFAULT 'ACTIVE',
    labels            JSONB,
    source_of_truth   TEXT NOT NULL DEFAULT 'resource_manager_api',
    ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    raw_payload       JSONB,

    CONSTRAINT uq_gcp_project_per_tenant UNIQUE (tenant_id, project_id),
    CONSTRAINT ck_gcp_project_id_format  CHECK (project_id ~ '^[a-z][a-z0-9\-]{4,28}[a-z0-9]$')
);
