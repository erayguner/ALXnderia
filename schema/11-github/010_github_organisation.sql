-- 11-github · GitHub Organisation
CREATE TABLE IF NOT EXISTS github_organisation (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                       UUID NOT NULL REFERENCES tenant(id),

    github_org_id                   BIGINT NOT NULL,
    login                           TEXT NOT NULL,
    display_name                    TEXT,
    email                           TEXT,
    billing_email                   TEXT,
    plan                            TEXT,
    two_factor_requirement_enabled  BOOLEAN DEFAULT FALSE,
    source_of_truth                 TEXT NOT NULL DEFAULT 'github_api',
    ingested_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                      TIMESTAMPTZ,
    raw_payload                     JSONB,

    CONSTRAINT uq_github_org_per_tenant UNIQUE (tenant_id, github_org_id)
);
