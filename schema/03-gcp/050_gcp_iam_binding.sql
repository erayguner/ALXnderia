-- 03-gcp · GCP IAM Binding (project-level)
-- Models: principal → role → resource
CREATE TABLE IF NOT EXISTS gcp_iam_binding (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenant(id),

    resource_type      TEXT NOT NULL DEFAULT 'project',
    gcp_project_id     UUID REFERENCES gcp_project(id),

    principal_type     TEXT NOT NULL,
    principal_email    TEXT NOT NULL,
    workspace_user_id  UUID REFERENCES gcp_workspace_user(id),
    workspace_group_id UUID REFERENCES gcp_workspace_group(id),

    role               TEXT NOT NULL,
    condition_title    TEXT,
    condition_expression TEXT,

    source_of_truth    TEXT NOT NULL DEFAULT 'resource_manager_api',
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    raw_payload        JSONB,

    CONSTRAINT ck_gcp_principal_type CHECK (
        principal_type IN ('user', 'group', 'serviceAccount', 'domain')
    )
);
