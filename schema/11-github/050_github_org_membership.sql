-- 11-github · GitHub Organisation Membership
CREATE TABLE IF NOT EXISTS github_org_membership (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    org_id              UUID NOT NULL REFERENCES github_organisation(id),
    user_id             UUID NOT NULL REFERENCES github_user(id),

    role                TEXT NOT NULL DEFAULT 'member',  -- 'member' or 'admin'
    state               TEXT NOT NULL DEFAULT 'active',  -- 'active' or 'pending'
    source_of_truth     TEXT NOT NULL DEFAULT 'github_api',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT uq_github_org_membership UNIQUE (org_id, user_id)
);
