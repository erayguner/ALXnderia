-- 04-identity · Person (unified cross-provider identity)
CREATE TABLE IF NOT EXISTS person (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    display_name    TEXT,
    primary_email   TEXT,
    hr_employee_id  TEXT,
    status          TEXT DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    raw_payload     JSONB
);

-- Add deferred FKs from provider identity tables to person
ALTER TABLE aws_iam_user
    ADD CONSTRAINT fk_aws_iam_user_person
    FOREIGN KEY (person_id) REFERENCES person(id);

ALTER TABLE aws_idc_user
    ADD CONSTRAINT fk_aws_idc_user_person
    FOREIGN KEY (person_id) REFERENCES person(id);

ALTER TABLE gcp_workspace_user
    ADD CONSTRAINT fk_gcp_ws_user_person
    FOREIGN KEY (person_id) REFERENCES person(id);

-- github_user FK is added in schema/11-github/060_github_post_setup.sql
-- (github_user table does not exist yet at this point in sort order)
