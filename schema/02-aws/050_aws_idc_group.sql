-- 02-aws · AWS IAM Identity Center Group
CREATE TABLE IF NOT EXISTS aws_idc_group (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID NOT NULL REFERENCES tenant(id),

    identity_store_group_id  TEXT NOT NULL,
    identity_store_id        TEXT,
    display_name             TEXT NOT NULL,
    description              TEXT,
    source_of_truth          TEXT NOT NULL DEFAULT 'identity_store_api',
    ingested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at               TIMESTAMPTZ,
    raw_payload              JSONB,

    CONSTRAINT uq_aws_idc_group UNIQUE (tenant_id, identity_store_id, identity_store_group_id)
);
