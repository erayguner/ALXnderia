-- =================================================================================================
-- 02_seed_and_queries.sql
-- Seed Data & Verification Queries (Multi-Tenant Version)
-- =================================================================================================

-- -------------------------------------------------------------------------------------------------
-- SEED DATA
-- -------------------------------------------------------------------------------------------------

-- Prerequisite: Create a mock tenant for this session (since we don't have a tenants table in this schema)
-- We will use a fixed UUID for this example: '11111111-1111-1111-1111-111111111111'
DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN

-- Scenario 1: Alice (Present in all 3 providers, Happy Path)
-- Google
INSERT INTO google_workspace_users (tenant_id, google_id, primary_email, name_full, is_admin)
VALUES (v_tenant_id, 'g_alice_123', 'alice@company.com', 'Alice Engineer', FALSE)
ON CONFLICT (tenant_id, google_id) DO NOTHING;

-- AWS
INSERT INTO aws_identity_center_users (tenant_id, identity_store_id, user_id, user_name, display_name)
VALUES (v_tenant_id, 'd_12345', 'aws_alice_abc', 'alice@company.com', 'Alice Engineer')
ON CONFLICT (tenant_id, identity_store_id, user_id) DO NOTHING;

-- GitHub
INSERT INTO github_users (tenant_id, github_id, node_id, login, email, type)
VALUES (v_tenant_id, 1001, 'U_alice', 'alicerocks', 'alice@company.com', 'User')
ON CONFLICT (tenant_id, node_id) DO NOTHING;

-- Canonical Identity (The "Human")
INSERT INTO canonical_users (id, tenant_id, full_name, primary_email)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', v_tenant_id, 'Alice Engineer', 'alice@company.com')
ON CONFLICT (id, tenant_id) DO NOTHING;

-- Canonical Email
INSERT INTO canonical_emails (tenant_id, canonical_user_id, email, is_primary)
VALUES (v_tenant_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'alice@company.com', TRUE)
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Links (Simulate what the sync job would create)
INSERT INTO canonical_user_provider_links (tenant_id, canonical_user_id, provider_type, provider_user_id, match_method)
VALUES 
(v_tenant_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'GOOGLE_WORKSPACE', 'g_alice_123', 'EMAIL_EXACT'),
(v_tenant_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'AWS_IDENTITY_CENTER', 'aws_alice_abc', 'EMAIL_EXACT'),
(v_tenant_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'GITHUB', 'U_alice', 'EMAIL_EXACT')
ON CONFLICT (tenant_id, provider_type, provider_user_id) DO NOTHING;


-- Scenario 2: Bob (GitHub only, hidden email, Unmapped / Needs Review)
INSERT INTO github_users (tenant_id, github_id, node_id, login, email, type)
VALUES (v_tenant_id, 2002, 'U_bob', 'bobby_tables', NULL, 'User')
ON CONFLICT (tenant_id, node_id) DO NOTHING;

-- Reconciliation Queue Item
INSERT INTO identity_reconciliation_queue (tenant_id, provider_type, provider_user_id, conflict_reason, status)
VALUES (v_tenant_id, 'GITHUB', 'U_bob', 'No verified email found for matching', 'PENDING');


-- Scenario 3: Carol (External Collaborator)
-- Not in Google/AWS, only GitHub
INSERT INTO github_users (tenant_id, github_id, node_id, login, email, type)
VALUES (v_tenant_id, 3003, 'U_carol', 'carol_vendor', 'carol@vendor.com', 'User')
ON CONFLICT (tenant_id, node_id) DO NOTHING;

-- Org & Repo
INSERT INTO github_organisations (tenant_id, github_id, node_id, login) 
VALUES (v_tenant_id, 1, 'O_tech', 'techco')
ON CONFLICT (tenant_id, node_id) DO NOTHING;

INSERT INTO github_repositories (tenant_id, github_id, node_id, org_node_id, name, full_name, private)
VALUES (v_tenant_id, 500, 'R_backend', 'O_tech', 'backend', 'techco/backend', TRUE)
ON CONFLICT (tenant_id, node_id) DO NOTHING;

-- Permission (Direct Collaborator)
INSERT INTO github_repo_collaborator_permissions (tenant_id, repo_node_id, user_node_id, permission, is_outside_collaborator)
VALUES (v_tenant_id, 'R_backend', 'U_carol', 'push', TRUE)
ON CONFLICT (tenant_id, repo_node_id, user_node_id) DO NOTHING;


-- Use Case 4: Conflict (Same email 'dave@company.com' on two different AWS identities? Rare but possible with bad hygiene)
INSERT INTO google_workspace_users (tenant_id, google_id, primary_email) 
VALUES (v_tenant_id, 'g_dave_444', 'dave@company.com')
ON CONFLICT (tenant_id, google_id) DO NOTHING;

END $$;

-- -------------------------------------------------------------------------------------------------
-- QUERIES
-- -------------------------------------------------------------------------------------------------

-- Query 1: Get a canonical user’s full identity map (Alice)
SELECT 
    cu.full_name,
    cu.primary_email,
    jsonb_object_agg(link.provider_type, link.provider_user_id) as linked_identities
FROM canonical_users cu
JOIN canonical_user_provider_links link ON cu.id = link.canonical_user_id AND cu.tenant_id = link.tenant_id
WHERE cu.tenant_id = '11111111-1111-1111-1111-111111111111' 
  AND cu.primary_email = 'alice@company.com'
GROUP BY cu.id, cu.full_name, cu.primary_email;

-- Query 2: List unmapped provider identities (Who acts on our systems but isn't a known employee?)
SELECT 
    'GITHUB' as provider,
    login as identifier,
    email,
    'https://github.com/' || login as url
FROM github_users gu
WHERE gu.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_user_provider_links link 
    WHERE link.tenant_id = gu.tenant_id
      AND link.provider_type = 'GITHUB' 
      AND link.provider_user_id = gu.node_id
);

-- Query 3: List all external collaborators with access to any repo in an org
-- Shows who has access but isn't an org member
SELECT 
    r.full_name as repo_name,
    u.login as user,
    perm.permission
FROM github_repo_collaborator_permissions perm
JOIN github_repositories r ON perm.repo_node_id = r.node_id AND perm.tenant_id = r.tenant_id
JOIN github_users u ON perm.user_node_id = u.node_id AND perm.tenant_id = u.tenant_id
WHERE perm.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND perm.is_outside_collaborator = TRUE;

-- Query 4: Reconciliation Queue (Items needing manual review)
SELECT * FROM identity_reconciliation_queue 
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND status = 'PENDING';
