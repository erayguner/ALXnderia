-- 02-aws · AWS Account
CREATE TABLE IF NOT EXISTS aws_account (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    account_id      TEXT NOT NULL,
    account_name    TEXT,
    org_id          TEXT,
    status          TEXT DEFAULT 'ACTIVE',
    tags            JSONB,
    source_of_truth TEXT NOT NULL DEFAULT 'organizations_api',
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    raw_payload     JSONB,

    CONSTRAINT uq_aws_account_per_tenant UNIQUE (tenant_id, account_id),
    CONSTRAINT ck_aws_account_id_format  CHECK (account_id ~ '^\d{12}$')
);
