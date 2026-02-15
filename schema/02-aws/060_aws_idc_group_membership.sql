-- 02-aws · AWS Identity Center Group Membership
CREATE TABLE IF NOT EXISTS aws_idc_group_membership (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    group_id        UUID NOT NULL REFERENCES aws_idc_group(id),
    user_id         UUID NOT NULL REFERENCES aws_idc_user(id),

    membership_id   TEXT,
    source_of_truth TEXT NOT NULL DEFAULT 'identity_store_api',
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT uq_aws_idc_membership UNIQUE (group_id, user_id)
);
