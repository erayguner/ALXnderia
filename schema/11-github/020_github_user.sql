-- 11-github · GitHub User
CREATE TABLE IF NOT EXISTS github_user (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    person_id           UUID,               -- FK added after person table exists

    github_user_id      BIGINT NOT NULL,
    login               TEXT NOT NULL,
    node_id             TEXT,
    display_name        TEXT,
    email               TEXT,
    avatar_url          TEXT,
    two_factor_enabled  BOOLEAN DEFAULT FALSE,
    source_of_truth     TEXT NOT NULL DEFAULT 'github_api',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    raw_payload         JSONB,

    CONSTRAINT uq_github_user_per_tenant UNIQUE (tenant_id, github_user_id)
);
