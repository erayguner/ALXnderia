-- 11-github · GitHub Team
CREATE TABLE IF NOT EXISTS github_team (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    org_id              UUID NOT NULL REFERENCES github_organisation(id),

    github_team_id      BIGINT NOT NULL,
    slug                TEXT NOT NULL,
    display_name        TEXT,
    description         TEXT,
    privacy             TEXT,               -- 'secret' or 'closed'
    parent_team_id      UUID REFERENCES github_team(id),
    source_of_truth     TEXT NOT NULL DEFAULT 'github_api',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    raw_payload         JSONB,

    CONSTRAINT uq_github_team UNIQUE (tenant_id, org_id, github_team_id)
);
