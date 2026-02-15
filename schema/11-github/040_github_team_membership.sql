-- 11-github · GitHub Team Membership
CREATE TABLE IF NOT EXISTS github_team_membership (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    team_id             UUID NOT NULL REFERENCES github_team(id),
    user_id             UUID NOT NULL REFERENCES github_user(id),

    membership_role     TEXT NOT NULL DEFAULT 'member',  -- 'member' or 'maintainer'
    source_of_truth     TEXT NOT NULL DEFAULT 'github_api',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT uq_github_team_membership UNIQUE (team_id, user_id)
);
