-- 03-gcp · Google Workspace Group Membership
CREATE TABLE IF NOT EXISTS gcp_workspace_group_membership (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    group_id        UUID NOT NULL REFERENCES gcp_workspace_group(id),
    user_id         UUID NOT NULL REFERENCES gcp_workspace_user(id),

    membership_role TEXT DEFAULT 'MEMBER',       -- MEMBER, MANAGER, OWNER
    membership_type TEXT DEFAULT 'USER',         -- USER, GROUP (nested)
    source_of_truth TEXT NOT NULL DEFAULT 'directory_api',
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT uq_gcp_ws_membership UNIQUE (group_id, user_id)
);
