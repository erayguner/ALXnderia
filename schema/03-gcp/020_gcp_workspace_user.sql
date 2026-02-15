-- 03-gcp · Google Workspace User
CREATE TABLE IF NOT EXISTS gcp_workspace_user (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    person_id       UUID,                       -- FK added after person table

    gw_user_id      TEXT NOT NULL,
    primary_email   TEXT NOT NULL,
    customer_id     TEXT,
    display_name    TEXT,
    suspended       BOOLEAN DEFAULT FALSE,
    org_unit_path   TEXT,
    source_of_truth TEXT NOT NULL DEFAULT 'directory_api',
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    raw_payload     JSONB,

    CONSTRAINT uq_gcp_ws_user_id    UNIQUE (tenant_id, gw_user_id),
    CONSTRAINT uq_gcp_ws_user_email UNIQUE (tenant_id, primary_email)
);
