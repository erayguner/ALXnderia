-- 03-gcp · Google Workspace Group
CREATE TABLE IF NOT EXISTS gcp_workspace_group (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),

    gw_group_id     TEXT NOT NULL,
    group_email     TEXT NOT NULL,
    display_name    TEXT,
    description     TEXT,
    customer_id     TEXT,
    admin_created   BOOLEAN,
    source_of_truth TEXT NOT NULL DEFAULT 'directory_api',
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    raw_payload     JSONB,

    CONSTRAINT uq_gcp_ws_group_id    UNIQUE (tenant_id, gw_group_id),
    CONSTRAINT uq_gcp_ws_group_email UNIQUE (tenant_id, group_email)
);
