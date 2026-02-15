-- 02-aws · AWS Identity Center Account Assignment
-- Models: principal (USER|GROUP) → permission_set → aws_account
CREATE TABLE IF NOT EXISTS aws_idc_account_assignment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),

    principal_type      TEXT NOT NULL,
    principal_user_id   UUID REFERENCES aws_idc_user(id),
    principal_group_id  UUID REFERENCES aws_idc_group(id),

    permission_set_id   UUID NOT NULL REFERENCES aws_idc_permission_set(id),
    aws_account_id      UUID NOT NULL REFERENCES aws_account(id),

    source_of_truth     TEXT NOT NULL DEFAULT 'sso_admin_api',
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    raw_payload         JSONB,

    CONSTRAINT ck_principal_type CHECK (principal_type IN ('USER', 'GROUP')),
    CONSTRAINT ck_principal_xor  CHECK (
        (principal_type = 'USER'  AND principal_user_id  IS NOT NULL AND principal_group_id IS NULL) OR
        (principal_type = 'GROUP' AND principal_group_id IS NOT NULL AND principal_user_id  IS NULL)
    )
);
