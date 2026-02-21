-- =================================================================================================
-- Cloud Resources Extension Schema (PostgreSQL 18) - Multi-Tenant Version
-- =================================================================================================
-- Extends 01_schema.sql with:
--   § 5  AWS Accounts + IAM Identity Center Account Assignments
--   § 6  GCP Organisations + Projects + IAM Bindings
--   § 7  Normalised Cross-Provider Permissions Matrix (resource_access_grants)
-- =================================================================================================

-- =================================================================================================
-- 5. AWS Accounts & Account Assignments
-- =================================================================================================

-- AWS Accounts (Organisation member accounts)
CREATE TABLE aws_accounts (
    id              UUID DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    account_id      TEXT NOT NULL,           -- 12-digit AWS account ID, e.g. '123456789012'
    name            TEXT NOT NULL,
    email           TEXT,                    -- root account email
    status          TEXT DEFAULT 'ACTIVE',   -- ACTIVE | SUSPENDED
    joined_method   TEXT,                    -- CREATED | INVITED
    joined_at       TIMESTAMP WITH TIME ZONE,
    org_id          TEXT,                    -- AWS Organization ID, e.g. 'o-exampleorgid11'
    parent_id       TEXT,                    -- Org root or OU node ID

    -- Metadata & Audit
    raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, account_id)
);
CREATE INDEX idx_aws_accounts_name    ON aws_accounts(tenant_id, name);
CREATE INDEX idx_aws_accounts_org     ON aws_accounts(tenant_id, org_id);
CREATE INDEX idx_aws_accounts_status  ON aws_accounts(tenant_id, status) WHERE deleted_at IS NULL;

-- IAM Identity Center account assignments (user or group → account via permission set)
CREATE TABLE aws_account_assignments (
    id                  UUID DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL,
    identity_store_id   TEXT NOT NULL,
    account_id          TEXT NOT NULL,           -- references aws_accounts.account_id
    permission_set_arn  TEXT NOT NULL,           -- full ARN, e.g. 'arn:aws:sso:::permissionSet/...'
    permission_set_name TEXT,                    -- human-readable name for the permission set
    principal_type      TEXT NOT NULL CHECK (principal_type IN ('USER', 'GROUP')),
    principal_id        TEXT NOT NULL,           -- IAM IDC user_id or group_id

    -- Metadata & Audit
    raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, account_id, permission_set_arn, principal_type, principal_id)
);
CREATE INDEX idx_aws_aa_account   ON aws_account_assignments(tenant_id, account_id);
CREATE INDEX idx_aws_aa_principal ON aws_account_assignments(tenant_id, principal_type, principal_id);
CREATE INDEX idx_aws_aa_pset      ON aws_account_assignments(tenant_id, permission_set_arn);

-- =================================================================================================
-- 6. GCP Organisations, Projects & IAM Bindings
-- =================================================================================================

CREATE TABLE gcp_organisations (
    id              UUID DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    org_id          TEXT NOT NULL,           -- 'organizations/123456789012'
    display_name    TEXT,
    domain          TEXT,                    -- primary domain
    lifecycle_state TEXT DEFAULT 'ACTIVE',   -- ACTIVE | DELETE_REQUESTED

    -- Metadata & Audit
    raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, org_id)
);
CREATE INDEX idx_gcp_orgs_domain ON gcp_organisations(tenant_id, domain);

CREATE TABLE gcp_projects (
    id              UUID DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    project_id      TEXT NOT NULL,           -- globally unique slug, e.g. 'my-project-123'
    project_number  TEXT NOT NULL,           -- numeric identifier, e.g. '314159265358'
    display_name    TEXT,
    lifecycle_state TEXT DEFAULT 'ACTIVE',   -- ACTIVE | DELETE_REQUESTED | DELETE_IN_PROGRESS
    org_id          TEXT,                    -- references gcp_organisations.org_id (nullable)
    folder_id       TEXT,                    -- parent folder if applicable
    labels          JSONB DEFAULT '{}'::jsonb,

    -- Metadata & Audit
    raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, project_id),
    UNIQUE (tenant_id, project_number)
);
CREATE INDEX idx_gcp_projects_org    ON gcp_projects(tenant_id, org_id);
CREATE INDEX idx_gcp_projects_name   ON gcp_projects(tenant_id, display_name);
CREATE INDEX idx_gcp_projects_state  ON gcp_projects(tenant_id, lifecycle_state) WHERE deleted_at IS NULL;

-- GCP IAM policy bindings at project level
-- member_id format: 'user:alice@example.com' | 'group:eng@example.com'
--                   | 'serviceAccount:sa@proj.iam.gserviceaccount.com'
--                   | 'allUsers' | 'allAuthenticatedUsers' | 'domain:example.com'
CREATE TABLE gcp_project_iam_bindings (
    id                   UUID DEFAULT uuid_generate_v4(),
    tenant_id            UUID NOT NULL,
    project_id           TEXT NOT NULL,           -- references gcp_projects.project_id
    role                 TEXT NOT NULL,            -- 'roles/viewer' | 'roles/editor' | custom role ARN
    member_type          TEXT NOT NULL,            -- 'user' | 'group' | 'serviceAccount' | 'allUsers' | etc.
    member_id            TEXT NOT NULL,            -- email or special value (without type prefix)
    condition_expression TEXT,                     -- optional IAM condition CEL expression
    condition_title      TEXT,

    -- Metadata & Audit
    raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, project_id, role, member_type, member_id)
);
CREATE INDEX idx_gcp_iam_project ON gcp_project_iam_bindings(tenant_id, project_id);
CREATE INDEX idx_gcp_iam_member  ON gcp_project_iam_bindings(tenant_id, member_type, member_id);
CREATE INDEX idx_gcp_iam_role    ON gcp_project_iam_bindings(tenant_id, role);

-- =================================================================================================
-- 7. Normalised Cross-Provider Permissions Matrix
-- =================================================================================================
-- Denormalised table populated by sync jobs.
-- Represents effective, resolved access (groups expanded to individual users where possible).
-- Supports fast permission lookups without expensive joins across provider tables.
-- =================================================================================================

CREATE TABLE resource_access_grants (
    id                      UUID DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL,

    -- Resource (what is being accessed)
    provider                TEXT NOT NULL,          -- 'aws' | 'gcp' | 'github' | 'google_workspace'
    resource_type           TEXT NOT NULL,          -- 'account' | 'project' | 'repository' | 'group'
    resource_id             TEXT NOT NULL,          -- provider-native resource identifier
    resource_display_name   TEXT,

    -- Subject (who has access)
    subject_type            TEXT NOT NULL,          -- 'user' | 'group' | 'service_account' | 'team'
    subject_provider_id     TEXT NOT NULL,          -- provider-native user/group identifier (email or ID)
    subject_display_name    TEXT,
    canonical_user_id       UUID,                   -- resolved canonical user; NULL for groups/SAs

    -- Permission
    role_or_permission      TEXT NOT NULL,
    access_path             TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'group' | 'inherited' | 'org_policy'
    via_group_id            TEXT,
    via_group_display_name  TEXT,

    -- Lifecycle
    raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    -- Unique effective grant per subject+role on a resource
    UNIQUE (tenant_id, provider, resource_type, resource_id, subject_type, subject_provider_id, role_or_permission)
);

-- Fast lookups by resource
CREATE INDEX idx_rag_resource       ON resource_access_grants(tenant_id, provider, resource_type, resource_id)
    WHERE deleted_at IS NULL;
-- Fast lookups by canonical user
CREATE INDEX idx_rag_canonical_user ON resource_access_grants(tenant_id, canonical_user_id)
    WHERE canonical_user_id IS NOT NULL AND deleted_at IS NULL;
-- Fast lookups by subject (before canonical resolution)
CREATE INDEX idx_rag_subject        ON resource_access_grants(tenant_id, subject_type, subject_provider_id)
    WHERE deleted_at IS NULL;
-- Fast provider-scoped scans
CREATE INDEX idx_rag_provider       ON resource_access_grants(tenant_id, provider)
    WHERE deleted_at IS NULL;
-- Partial index for direct access (most-queried access_path)
CREATE INDEX idx_rag_direct         ON resource_access_grants(tenant_id, provider, resource_id)
    WHERE access_path = 'direct' AND deleted_at IS NULL;
