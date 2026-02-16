-- =================================================================================================
-- Identity & Access Management Schema (PostgreSQL 18) - Multi-Tenant Version
-- =================================================================================================
-- Design Principles:
-- 1. Multi-Tenancy: All data is scoped by 'tenant_id'.
-- 2. Full Fidelity: Store raw JSONB responses.
-- 3. No Cross-Pollination: Separate schemas/tables per provider.
-- 4. Immutability: Provider IDs are stored as-is.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================================================================================================
-- 1. Google Workspace Schema
-- =================================================================================================

CREATE TABLE google_workspace_users (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    google_id TEXT NOT NULL,              -- Stable 'id' from Admin SDK
    primary_email TEXT NOT NULL,          -- Mutable 'primaryEmail'
    name_full TEXT,                       -- name.fullName from Admin SDK
    suspended BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    creation_time TIMESTAMP WITH TIME ZONE,
    last_login_time TIMESTAMP WITH TIME ZONE,
    org_unit_path TEXT,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id), -- Partitioning friendly
    UNIQUE (tenant_id, google_id)
);
CREATE INDEX idx_gw_users_email ON google_workspace_users(tenant_id, primary_email);

CREATE TABLE google_workspace_groups (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    google_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    description TEXT,
    admin_created BOOLEAN DEFAULT TRUE,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, google_id)
);
CREATE INDEX idx_gw_groups_email ON google_workspace_groups(tenant_id, email);

CREATE TABLE google_workspace_memberships (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    group_id TEXT NOT NULL, -- references google_workspace_groups(google_id) within tenant
    member_id TEXT NOT NULL,
    member_type TEXT NOT NULL CHECK (member_type IN ('USER', 'GROUP', 'EXTERNAL', 'CUSTOMER')),
    role TEXT DEFAULT 'MEMBER',
    status TEXT DEFAULT 'ACTIVE',
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, group_id, member_id)
);

-- =================================================================================================
-- 2. AWS IAM Identity Center Schema
-- =================================================================================================

CREATE TABLE aws_identity_center_users (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    identity_store_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    display_name TEXT,
    active BOOLEAN DEFAULT TRUE,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, identity_store_id, user_id)
);
CREATE INDEX idx_aws_users_username ON aws_identity_center_users(tenant_id, user_name);

CREATE TABLE aws_identity_center_groups (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    identity_store_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, identity_store_id, group_id)
);

CREATE TABLE aws_identity_center_memberships (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    membership_id TEXT NOT NULL,
    identity_store_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    member_user_id TEXT NOT NULL,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, identity_store_id, membership_id)
);

-- =================================================================================================
-- 3. GitHub Schema (Org Level)
-- =================================================================================================

CREATE TABLE github_organisations (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    github_id BIGINT NOT NULL,
    node_id TEXT NOT NULL, -- Unique per tenant (technically global, but we scope per tenant)
    login TEXT NOT NULL,
    name TEXT,
    email TEXT,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, node_id),
    UNIQUE (tenant_id, login)
);

CREATE TABLE github_users (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    github_id BIGINT NOT NULL,
    node_id TEXT NOT NULL,
    login TEXT NOT NULL,
    name TEXT,
    email TEXT,
    type TEXT NOT NULL,
    site_admin BOOLEAN DEFAULT FALSE,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, node_id)
);
CREATE INDEX idx_github_users_login ON github_users(tenant_id, login);

CREATE TABLE github_teams (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    github_id BIGINT NOT NULL,
    node_id TEXT NOT NULL,
    org_node_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    privacy TEXT,
    parent_team_id BIGINT,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, node_id)
);

-- Org Members (User <-> Org)
CREATE TABLE github_org_memberships (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    org_node_id TEXT NOT NULL,
    user_node_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    state TEXT DEFAULT 'active',
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, org_node_id, user_node_id)
);

-- Team Memberships (User <-> Team)
CREATE TABLE github_team_memberships (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    team_node_id TEXT NOT NULL,
    user_node_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, team_node_id, user_node_id)
);

CREATE TABLE github_repositories (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    github_id BIGINT NOT NULL,
    node_id TEXT NOT NULL,
    org_node_id TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    private BOOLEAN DEFAULT FALSE,
    visibility TEXT,
    archived BOOLEAN DEFAULT FALSE,
    default_branch TEXT,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, node_id)
);

CREATE TABLE github_repo_team_permissions (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    repo_node_id TEXT NOT NULL,
    team_node_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, repo_node_id, team_node_id)
);

CREATE TABLE github_repo_collaborator_permissions (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    repo_node_id TEXT NOT NULL,
    user_node_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    is_outside_collaborator BOOLEAN DEFAULT FALSE,
    
    -- Metadata & Audit
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, repo_node_id, user_node_id)
);

-- =================================================================================================
-- 4. Canonical Identity Layer
-- =================================================================================================

CREATE TABLE canonical_users (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    full_name TEXT,
    primary_email TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY (id, tenant_id)
);

CREATE TABLE canonical_emails (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    canonical_user_id UUID NOT NULL,
    email TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, email),
    FOREIGN KEY (canonical_user_id, tenant_id) REFERENCES canonical_users(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX idx_canonical_emails_email ON canonical_emails(tenant_id, email);

CREATE TYPE provider_type_enum AS ENUM ('GOOGLE_WORKSPACE', 'AWS_IDENTITY_CENTER', 'GITHUB');

CREATE TABLE canonical_user_provider_links (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    canonical_user_id UUID NOT NULL,
    provider_type provider_type_enum NOT NULL,
    provider_user_id TEXT NOT NULL,
    
    confidence_score INTEGER DEFAULT 100,
    match_method TEXT NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, provider_type, provider_user_id),
    FOREIGN KEY (canonical_user_id, tenant_id) REFERENCES canonical_users(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE identity_reconciliation_queue (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    provider_type provider_type_enum NOT NULL,
    provider_user_id TEXT NOT NULL,
    suggested_canonical_user_id UUID,
    conflict_reason TEXT,
    status TEXT DEFAULT 'PENDING',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (id, tenant_id),
    FOREIGN KEY (suggested_canonical_user_id, tenant_id) REFERENCES canonical_users(id, tenant_id)
);
