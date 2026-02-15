-- 02-aws · AWS IAM User Policy Attachment
CREATE TABLE IF NOT EXISTS aws_iam_user_policy_attachment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    iam_user_id     UUID NOT NULL REFERENCES aws_iam_user(id),
    policy_arn      TEXT NOT NULL,
    policy_name     TEXT,
    is_inline       BOOLEAN DEFAULT FALSE,
    source_of_truth TEXT NOT NULL DEFAULT 'iam_api',
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT uq_iam_user_policy UNIQUE (iam_user_id, policy_arn)
);
