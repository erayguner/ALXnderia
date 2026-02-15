-- 02-aws · AWS IAM Identity Center User
CREATE TABLE IF NOT EXISTS aws_idc_user (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id),
    person_id               UUID,               -- FK added after person table

    identity_store_user_id  TEXT NOT NULL,
    identity_store_id       TEXT,                -- d-xxxxxxxxxx
    user_name               TEXT,
    display_name            TEXT,
    email                   TEXT,
    source_of_truth         TEXT NOT NULL DEFAULT 'identity_store_api',
    ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at             TIMESTAMPTZ,
    raw_payload             JSONB,

    CONSTRAINT uq_aws_idc_user UNIQUE (tenant_id, identity_store_id, identity_store_user_id)
);
