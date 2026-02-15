-- 02-aws · AWS IAM User
CREATE TABLE IF NOT EXISTS aws_iam_user (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    aws_account_id   UUID NOT NULL REFERENCES aws_account(id),
    person_id        UUID,                      -- FK added after person table

    iam_user_name    TEXT NOT NULL,
    iam_user_id      TEXT NOT NULL,              -- AIDA… prefix
    arn              TEXT NOT NULL,
    path             TEXT DEFAULT '/',
    status           TEXT DEFAULT 'active',
    created_at       TIMESTAMPTZ,
    source_of_truth  TEXT NOT NULL DEFAULT 'iam_api',
    ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    raw_payload      JSONB,

    CONSTRAINT uq_aws_iam_user_id   UNIQUE (tenant_id, iam_user_id),
    CONSTRAINT uq_aws_iam_user_arn  UNIQUE (tenant_id, arn),
    CONSTRAINT ck_iam_user_id_prefix CHECK (iam_user_id ~ '^AIDA')
);
