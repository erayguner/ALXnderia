-- 02-aws · AWS Identity Center Permission Set
CREATE TABLE IF NOT EXISTS aws_idc_permission_set (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),

    permission_set_arn  TEXT NOT NULL,
    permission_set_name TEXT NOT NULL,
    description         TEXT,
    session_duration    TEXT,
    identity_store_id   TEXT,
    instance_arn        TEXT,
    source_of_truth     TEXT NOT NULL DEFAULT 'sso_admin_api',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    raw_payload         JSONB,

    CONSTRAINT uq_aws_idc_ps_arn UNIQUE (tenant_id, permission_set_arn)
);
