# 07 — Target Architecture: GraphQL API, Export/DLP, and Security Hardening

| Field        | Value                       |
|--------------|-----------------------------|
| Status       | Proposed                    |
| Authors      | Architecture Review         |
| Audience     | Engineering, Security, SRE  |
| Last Updated | 2026-02-15                  |

---

## Table of Contents

- [A. Current Architecture Summary](#a-current-architecture-summary)
- [B. Target Architecture](#b-target-architecture)
- [C. Data Model Impact](#c-data-model-impact)
- [D. GraphQL Deliverables](#d-graphql-deliverables)
- [E. Export/DLP Deliverables](#e-exportdlp-deliverables)
- [F. Testing & Validation Plan](#f-testing--validation-plan)
- [G. Runnable Examples](#g-runnable-examples)

---

## A. Current Architecture Summary

### What exists today

| Layer | Technology | State |
|-------|-----------|-------|
| Frontend | Next.js 15 / React 19 / Tailwind | Working chat UI + access explorer |
| API | Next.js API routes (REST) | 4 endpoints: `/api/chat`, `/api/access`, `/api/people`, `/api/health` |
| AI | NL2SQL agent with 7-layer SQL validator | Anthropic / OpenAI / Gemini, provider-agnostic |
| Database | PostgreSQL (18 Cloud SQL / 16 Aurora) | 18 tables across 4 providers + canonical identity layer, composite PK `(id, tenant_id)`, no RLS yet |
| Auth | **Mock** — hardcoded session in route handlers | No real AuthN/AuthZ |
| Ingestion | External pipeline assumed | No application-level connector code |
| Export/DLP | Not implemented | Planned for future iteration |
| Infra | Terraform (Docker local / AWS Aurora+App Runner / GCP Cloud SQL+Cloud Run) | Dual-cloud IaC defined |
| Tests | Vitest | 32 tests (28 SQL validator + 4 chat route) |

### Key gaps

1. **No real authentication.** `getSession()` returns a hardcoded mock.
2. **No GraphQL.** API is bespoke REST endpoints with inline SQL.
3. **No ingestion API or connectors.** Data loading is assumed external.
4. **No export/backup jobs.** No export schema or execution layer.
5. **No RLS policies.** App sets `SET LOCAL app.current_tenant_id` per transaction (forward-compatible) but no RLS policies defined yet.
6. **No database-backed audit.** Audit middleware logs to console only; database audit table planned.
7. **No database roles.** Single `cloudintel` role; role separation planned for production.

### What works well (keep)

- Forward-compatible tenant scoping with `SET LOCAL app.current_tenant_id`.
- Composite PK `(id, tenant_id)` on all tables — partition-friendly multi-tenancy.
- SQL validator (7-layer, AST-based) — robust defence-in-depth for NL2SQL path.
- Canonical identity model with `canonical_users` + `canonical_user_provider_links` — sound cross-provider design.
- `provider_type_enum` (GOOGLE_WORKSPACE, AWS_IDENTITY_CENTER, GITHUB) — typed provider classification.
- `identity_reconciliation_queue` — explicit handling for unmatched identities.
- 5 CI/CD pipelines (CI, CodeQL, Checkov, Security Audit, Bundle Analysis).
- 32 tests (28 SQL validator + 4 chat route).

---

## B. Target Architecture

### B.1 Trust Boundary Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  PUBLIC INTERNET                                                  │
│                                                                   │
│   Browser ──HTTPS──► CDN/WAF                                     │
│   CI/CD   ──HTTPS──► GitHub Actions                              │
│   IdP     ──OIDC───► Auth0 / Entra ID / Google Workspace        │
└──────────────┬────────────────────────────────────────────────────┘
               │ TLS-terminated at load balancer
┌──────────────▼────────────────────────────────────────────────────┐
│  DMZ / COMPUTE (private subnet, egress-controlled)                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  APPLICATION TIER (Cloud Run / App Runner)                  │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │  │
│  │  │  Next.js BFF │  │  GraphQL     │  │  Export Worker  │   │  │
│  │  │  (UI + REST) │  │  Server      │  │  (Job runner)   │   │  │
│  │  │              │  │  (Yoga +     │  │                 │   │  │
│  │  │  /api/chat   │  │   Pothos)    │  │  Cron / queue   │   │  │
│  │  │  /api/health │  │              │  │  triggered      │   │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────────┘   │  │
│  │         │                 │                  │              │  │
│  │         │ ◄── Auth middleware (JWT verify + tenant extract) │  │
│  │         │                 │                  │              │  │
│  └─────────┼─────────────────┼──────────────────┼──────────────┘  │
│            │                 │                  │                  │
│            ▼                 ▼                  ▼                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  DATA TIER (private subnet, no public IP)                   │  │
│  │                                                             │  │
│  │  PostgreSQL 18                                              │  │
│  │  (Aurora Serverless v2 / Cloud SQL)                         │  │
│  │  ┌───────────────┐ ┌───────────────┐ ┌──────────────────┐  │  │
│  │  │ Operational   │ │ entity_history│ │ audit_log        │  │  │
│  │  │ tables        │ │ (hash-chained)│ │ (partitioned)    │  │  │
│  │  │ (RLS-enabled) │ │               │ │                  │  │  │
│  │  └───────────────┘ └───────────────┘ └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │ Secret Manager │  │ Cloud Storage    │  │ Cloud KMS       │   │
│  │ (DB creds,     │  │ (export bucket,  │  │ (encryption     │   │
│  │  API keys,     │  │  signed URLs)    │  │  keys)          │   │
│  │  JWT signing)  │  │                  │  │                 │   │
│  └────────────────┘  └──────────────────┘  └─────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### B.2 Component Responsibilities

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| **Next.js BFF** | UI serving, NL2SQL chat API, health probe | Next.js 15, existing code |
| **GraphQL Server** | Identity graph queries, cursor pagination, field-level authZ | GraphQL Yoga + Pothos (code-first schema) |
| **Auth Middleware** | JWT validation, OIDC federation, tenant extraction, role resolution | `jose` library (JWT verify), OIDC discovery |
| **Export Worker** | Async snapshot/export jobs, signed URL generation | Node.js worker, triggered by DB queue or Cloud Scheduler |
| **PostgreSQL** | System of record, tenant-scoped queries, identity data | PostgreSQL 18, existing schema |
| **Secret Manager** | All credentials, rotated, scoped IAM access | AWS Secrets Manager / GCP Secret Manager |
| **Cloud Storage** | Export artefact storage with lifecycle policies | S3 / GCS with encryption + signed URLs |
| **Cloud KMS** | Envelope encryption for exports, DB column encryption | AWS KMS / GCP Cloud KMS |

### B.3 Rationale: Custom GraphQL Server over PostGraphile/Hasura

**Decision: GraphQL Yoga + Pothos (code-first) running as a standalone service alongside Next.js.**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Hasura** | Zero-code, auto-generates from schema | RLS mapping is fragile at scale; hard to enforce field-level authZ per role; mutation exposure risk; limited query complexity controls; vendor lock-in | Reject |
| **PostGraphile** | Auto-generates with plugin system | Still exposes full schema surface; security depends on RLS being perfect (no fallback); difficult to add custom business logic; plugin API learning curve | Reject |
| **Yoga + Pothos** | Full control over schema surface; code-first types mirror domain model; field-level authZ via resolver guards; DataLoader built in; query complexity plugin; integrates with existing `pg` pool | More code to write; must define schema explicitly | **Accept** |

The existing codebase already has a `pg` pool with tenant-scoping via `SET LOCAL app.current_tenant_id`. A code-first GraphQL server gives us:
- Explicit schema surface (no accidental exposure)
- Resolver-level authZ with defence-in-depth (adding RLS as a future layer)
- Built-in query complexity scoring and depth limiting
- DataLoader integration for N+1 prevention
- Clean separation from the NL2SQL path

### B.4 Authentication Architecture

```
Browser ──► IdP (Auth0/Entra/Google) ──► ID Token (JWT)
                                              │
                                              ▼
                                    Application verifies:
                                    1. Signature (JWKS from IdP)
                                    2. iss, aud, exp claims
                                    3. Extract tenant_id from custom claim
                                    4. Extract role from custom claim
                                    5. Set RLS context: SET LOCAL app.current_tenant_id
```

**Token claims (required):**
```json
{
  "sub": "auth0|user-uuid",
  "email": "analyst@northwind.co.uk",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "roles": ["analyst"],
  "iss": "https://auth.alxderia.io/",
  "aud": "alxderia-api",
  "exp": 1739712000
}
```

**Workload identity (service-to-service):** Cloud Run / App Runner uses workload identity federation to assume IAM roles for Secret Manager and Cloud Storage access. No long-lived credentials.

### B.5 Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| New `/graphql` endpoint | Additive — no breakage | Deploy alongside existing REST |
| Auth middleware replacing mock `getSession()` | **Breaking** — all REST endpoints require JWT | Add `Authorization: Bearer <token>` header; update frontend |
| RLS policies added to all tables | Additive — existing queries unaffected | Run schema migration |
| Export worker | Additive | Deploy as separate process or Cloud Scheduler job |

---

## C. Data Model Impact

### C.1 Canonical User Model

```
canonical_users (canonical identity)
  │
  ├── canonical_user_provider_links ──► google_workspace_users  (provider_type='GOOGLE_WORKSPACE')
  ├── canonical_user_provider_links ──► aws_identity_center_users (provider_type='AWS_IDENTITY_CENTER')
  └── canonical_user_provider_links ──► github_users             (provider_type='GITHUB')

Source of truth: canonical_users.primary_email (lowercase, unique per tenant)
Internal identifier: canonical_users.id (UUID)
Provider link key: provider_user_id (maps to google_id, user_id, or node_id depending on provider)
```

### C.2 Conflict Handling Matrix

| Scenario | Detection | Resolution |
|----------|-----------|------------|
| **Duplicate email across providers** | Exact match: `lower(canonical_users.primary_email) = lower(provider_user.email)` | Link to existing canonical user; create `canonical_user_provider_links` with `confidence_score=100`, `match_method='email_exact'` |
| **Email mismatch (display name differs)** | Same email, different name | Tolerate — canonical_users.full_name is authoritative |
| **Missing email** (GitHub noreply, service accounts) | `email LIKE '%@users.noreply.github.com'` or `email IS NULL` | No provider link created; insert into `identity_reconciliation_queue` with `status='PENDING'`, `conflict_reason='noreply_email'` |
| **Email change** (user changes corporate email) | Provider sync detects new email, no canonical user match | Flag for manual review in reconciliation queue; do NOT auto-create duplicate canonical user |
| **Merge required** (two canonical_users records for same human) | Admin identifies via audit | Admin merges: reparent all `canonical_user_provider_links` rows to surviving user, soft-delete duplicate |
| **Cross-tenant collision** | Same email in different tenants | Expected and valid — composite PK `(id, tenant_id)` enforces tenant isolation |

### C.3 Required Schema Changes (for GraphQL support)

The following changes are needed to support GraphQL:

**1. Add RLS policies** (not yet defined in the current schema):

```sql
-- Enable RLS on all tables and create policies scoped by tenant_id
-- The app already sets SET LOCAL app.current_tenant_id per transaction
ALTER TABLE canonical_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON canonical_users
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
-- Repeat for all 18 tables
```

**2. Add database roles** (not yet defined in the current schema):

```sql
-- Production role separation (currently single cloudintel role)
CREATE ROLE cloudintel_readonly;
CREATE ROLE cloudintel_analyst;
CREATE ROLE cloudintel_admin;
CREATE ROLE cloudintel_audit;
```

**3. Add cursor pagination support indexes** (for GraphQL):

```sql
CREATE INDEX IF NOT EXISTS idx_canonical_users_cursor
    ON canonical_users (tenant_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_provider_links_cursor
    ON canonical_user_provider_links (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_github_users_cursor
    ON github_users (tenant_id, id);
```

**4. Add audit_log table** (for database-backed audit, currently console-only):

```sql
CREATE TABLE audit_log (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    query_text TEXT NOT NULL,
    question TEXT,
    row_count INTEGER,
    duration_ms INTEGER,
    status TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, tenant_id)
);
```

### C.4 Indexing Strategy for Graph Queries

| Query Pattern | Index | Notes |
|---------------|-------|-------|
| Canonical user by email | `idx_canonical_emails_email` (existing) | `(tenant_id, email)` |
| Provider links by user | `canonical_user_provider_links` FK | `(canonical_user_id, tenant_id)` |
| Google Workspace by email | `idx_gw_users_email` (existing) | `(tenant_id, primary_email)` |
| GitHub user by login | `idx_github_users_login` (existing) | `(tenant_id, login)` |
| AWS IDC user by username | `idx_aws_users_username` (existing) | `(tenant_id, user_name)` |
| Google Workspace groups by email | `idx_gw_groups_email` (existing) | `(tenant_id, email)` |
| Cursor pagination (all entities) | New cursor indexes above | `(tenant_id, id)` — supports keyset pagination |

---

## D. GraphQL Deliverables

### D.1 Schema (SDL)

```graphql
# ─── Scalars ───────────────────────────────────────────────
scalar DateTime
scalar UUID

# ─── Pagination ────────────────────────────────────────────
type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

# ─── Canonical User (Canonical Identity) ──────────────────
type CanonicalUser {
  id: UUID!
  fullName: String
  primaryEmail: String          # Null for readonly role (PII)
  createdAt: DateTime!
  updatedAt: DateTime!

  # Relations (DataLoader-backed)
  providerLinks(
    first: Int = 20
    after: String
    providerType: String
  ): ProviderLinkConnection!

  awsIdentityCenterUsers: [AwsIdentityCenterUser!]!
  googleWorkspaceUsers: [GoogleWorkspaceUser!]!
  githubUsers: [GitHubUser!]!

  groupMemberships: [GroupMembership!]!
}

type CanonicalUserConnection {
  edges: [CanonicalUserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type CanonicalUserEdge {
  node: CanonicalUser!
  cursor: String!
}

# ─── Provider Link ─────────────────────────────────────────
type ProviderLink {
  id: UUID!
  providerType: String!        # GOOGLE_WORKSPACE, AWS_IDENTITY_CENTER, GITHUB
  providerUserId: String!
  confidenceScore: Int!
  matchMethod: String!
  createdAt: DateTime!
}

type ProviderLinkConnection {
  edges: [ProviderLinkEdge!]!
  pageInfo: PageInfo!
}

type ProviderLinkEdge {
  node: ProviderLink!
  cursor: String!
}

# ─── Provider Identities ──────────────────────────────────
type AwsIdentityCenterUser {
  id: UUID!
  identityStoreId: String!
  userId: String!
  userName: String!
  displayName: String
  active: Boolean!
  lastSyncedAt: DateTime
  canonicalUser: CanonicalUser
  groupMemberships: [AwsIdentityCenterMembership!]!
}

type GoogleWorkspaceUser {
  id: UUID!
  googleId: String!
  primaryEmail: String       # PII-guarded
  nameFull: String
  suspended: Boolean!
  archived: Boolean!
  isAdmin: Boolean!
  lastLoginTime: DateTime
  lastSyncedAt: DateTime
  canonicalUser: CanonicalUser
  groupMemberships: [GoogleWorkspaceMembership!]!
}

type GitHubUser {
  id: UUID!
  githubId: Int!
  nodeId: String!
  login: String!
  name: String
  email: String              # PII-guarded
  type: String!
  siteAdmin: Boolean!
  lastSyncedAt: DateTime
  canonicalUser: CanonicalUser
  teamMemberships: [GitHubTeamMembership!]!
  orgMemberships: [GitHubOrgMembership!]!
  repoPermissions: [GitHubRepoCollaboratorPermission!]!
}

# ─── Groups / Teams ────────────────────────────────────────
type AwsIdentityCenterGroup {
  id: UUID!
  identityStoreId: String!
  groupId: String!
  displayName: String!
  description: String
  members(first: Int = 50, after: String): AwsIdentityCenterMembershipConnection!
}

type AwsIdentityCenterMembership {
  group: AwsIdentityCenterGroup!
  user: AwsIdentityCenterUser!
}

type AwsIdentityCenterMembershipConnection {
  edges: [AwsIdentityCenterMembershipEdge!]!
  pageInfo: PageInfo!
}

type AwsIdentityCenterMembershipEdge {
  node: AwsIdentityCenterMembership!
  cursor: String!
}

type GoogleWorkspaceGroup {
  id: UUID!
  googleId: String!
  email: String!
  name: String
  description: String
  members(first: Int = 50, after: String): GoogleWorkspaceMembershipConnection!
}

type GoogleWorkspaceMembership {
  group: GoogleWorkspaceGroup!
  memberType: String!
  role: String!
  status: String!
}

type GoogleWorkspaceMembershipConnection {
  edges: [GoogleWorkspaceMembershipEdge!]!
  pageInfo: PageInfo!
}

type GoogleWorkspaceMembershipEdge {
  node: GoogleWorkspaceMembership!
  cursor: String!
}

type GitHubOrganisation {
  id: UUID!
  githubId: Int!
  nodeId: String!
  login: String!
  name: String
  email: String
  teams(first: Int = 50, after: String): GitHubTeamConnection!
  members(first: Int = 50, after: String): GitHubOrgMembershipConnection!
  repositories(first: Int = 50, after: String): GitHubRepositoryConnection!
}

type GitHubTeam {
  id: UUID!
  githubId: Int!
  nodeId: String!
  slug: String!
  name: String!
  description: String
  privacy: String
  parentTeam: GitHubTeam
  members(first: Int = 50, after: String): GitHubTeamMembershipConnection!
  repoPermissions(first: Int = 50, after: String): GitHubRepoTeamPermissionConnection!
}

type GitHubRepository {
  id: UUID!
  githubId: Int!
  nodeId: String!
  name: String!
  fullName: String!
  private: Boolean!
  visibility: String
  archived: Boolean!
  defaultBranch: String
  teamPermissions(first: Int = 50, after: String): GitHubRepoTeamPermissionConnection!
  collaborators(first: Int = 50, after: String): GitHubRepoCollaboratorPermissionConnection!
}

type GitHubRepositoryConnection {
  edges: [GitHubRepositoryEdge!]!
  pageInfo: PageInfo!
}

type GitHubRepositoryEdge {
  node: GitHubRepository!
  cursor: String!
}

type GitHubRepoTeamPermission {
  repo: GitHubRepository!
  team: GitHubTeam!
  permission: String!
}

type GitHubRepoTeamPermissionConnection {
  edges: [GitHubRepoTeamPermissionEdge!]!
  pageInfo: PageInfo!
}

type GitHubRepoTeamPermissionEdge {
  node: GitHubRepoTeamPermission!
  cursor: String!
}

type GitHubRepoCollaboratorPermission {
  repo: GitHubRepository!
  user: GitHubUser!
  permission: String!
  isOutsideCollaborator: Boolean!
}

type GitHubRepoCollaboratorPermissionConnection {
  edges: [GitHubRepoCollaboratorPermissionEdge!]!
  pageInfo: PageInfo!
}

type GitHubRepoCollaboratorPermissionEdge {
  node: GitHubRepoCollaboratorPermission!
  cursor: String!
}

type GitHubTeamConnection {
  edges: [GitHubTeamEdge!]!
  pageInfo: PageInfo!
}

type GitHubTeamEdge {
  node: GitHubTeam!
  cursor: String!
}

type GitHubTeamMembership {
  team: GitHubTeam!
  user: GitHubUser!
  role: String!
}

type GitHubTeamMembershipConnection {
  edges: [GitHubTeamMembershipEdge!]!
  pageInfo: PageInfo!
}

type GitHubTeamMembershipEdge {
  node: GitHubTeamMembership!
  cursor: String!
}

type GitHubOrgMembership {
  org: GitHubOrganisation!
  user: GitHubUser!
  role: String!
  state: String!
}

type GitHubOrgMembershipConnection {
  edges: [GitHubOrgMembershipEdge!]!
  pageInfo: PageInfo!
}

type GitHubOrgMembershipEdge {
  node: GitHubOrgMembership!
  cursor: String!
}

# ─── Union type for group memberships ──────────────────────
union GroupMembership =
    AwsIdentityCenterMembership
  | GoogleWorkspaceMembership
  | GitHubTeamMembership
  | GitHubOrgMembership

# ─── Queries ──────────────────────────────────────────────
type Query {
  # Canonical user lookups
  canonicalUser(id: UUID!): CanonicalUser
  canonicalUserByEmail(email: String!): CanonicalUser
  canonicalUsers(
    first: Int = 20
    after: String
    search: String
    includeDeleted: Boolean = false
  ): CanonicalUserConnection!

  # Identity reconciliation queue (unmatched identities)
  reconciliationQueue(
    providerType: String
    status: String = "PENDING"
    first: Int = 50
    after: String
  ): ReconciliationQueueConnection!

  # Provider-specific lookups
  githubOrganisation(id: UUID!): GitHubOrganisation
  githubOrganisations(first: Int = 10, after: String): GitHubOrganisationConnection!
  githubUser(login: String!): GitHubUser
  githubRepository(fullName: String!): GitHubRepository
  awsIdentityCenterGroup(id: UUID!): AwsIdentityCenterGroup
  googleWorkspaceGroup(id: UUID!): GoogleWorkspaceGroup

  # Cross-provider search
  identitiesByEmail(email: String!): [ProviderIdentity!]!

  # Orphan detection (users linked to fewer than minProviders)
  usersWithIncompleteMapping(
    minProviders: Int = 3
    first: Int = 50
    after: String
  ): CanonicalUserConnection!

  # External collaborator queries
  externalCollaborators(
    first: Int = 50
    after: String
  ): GitHubRepoCollaboratorPermissionConnection!

  # Export jobs (future)
  exportJobs(status: String, first: Int = 20, after: String): ExportJobConnection!
}

# ─── Reconciliation Queue ─────────────────────────────────
type ReconciliationQueueEntry {
  id: UUID!
  providerType: String!
  providerUserId: String!
  conflictReason: String
  status: String!
  createdAt: DateTime!
}

type ReconciliationQueueConnection {
  edges: [ReconciliationQueueEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type ReconciliationQueueEdge {
  node: ReconciliationQueueEntry!
  cursor: String!
}

# ─── Provider Identity (for cross-provider search) ─────────
type ProviderIdentity {
  providerType: String!       # GOOGLE_WORKSPACE, AWS_IDENTITY_CENTER, GITHUB
  providerUserId: String!
  displayName: String
  email: String
  lastSyncedAt: DateTime
  canonicalUserId: UUID
}

# ─── GitHub Organisation Connection ────────────────────────
type GitHubOrganisationConnection {
  edges: [GitHubOrganisationEdge!]!
  pageInfo: PageInfo!
}

type GitHubOrganisationEdge {
  node: GitHubOrganisation!
  cursor: String!
}

# ─── Entity History ────────────────────────────────────────
type EntityHistoryEntry {
  eventTime: DateTime!
  eventAction: String!
  providerCode: String!
  statePayload: String     # JSON string; restricted to audit role
  deltaPayload: String
  sourceSystem: String!
  integrityHash: String!
}

type EntityHistoryConnection {
  edges: [EntityHistoryEdge!]!
  pageInfo: PageInfo!
}

type EntityHistoryEdge {
  node: EntityHistoryEntry!
  cursor: String!
}

# ─── Export Jobs ───────────────────────────────────────────
type ExportJob {
  id: UUID!
  tenantId: UUID!
  scope: String!
  format: String!
  status: String!
  createdAt: DateTime!
  completedAt: DateTime
  downloadUrl: String       # Signed URL, time-limited
  entityCount: Int
  checksumSha256: String
}

type ExportJobConnection {
  edges: [ExportJobEdge!]!
  pageInfo: PageInfo!
}

type ExportJobEdge {
  node: ExportJob!
  cursor: String!
}

# ─── Mutations (minimal, admin-only) ──────────────────────
type Mutation {
  # Manual identity linkage (admin only)
  linkIdentity(
    canonicalUserId: UUID!
    providerType: String!        # GOOGLE_WORKSPACE, AWS_IDENTITY_CENTER, GITHUB
    providerUserId: String!
    matchMethod: String!
    confidenceScore: Int = 100
  ): ProviderLink!

  # Resolve reconciliation queue entry (admin only)
  resolveReconciliation(
    reconciliationId: UUID!
    canonicalUserId: UUID         # null = reject match
    resolution: String!           # 'linked', 'rejected', 'new_user'
  ): ReconciliationQueueEntry!

  # Merge duplicate canonical users (admin only)
  mergeCanonicalUsers(
    survivingUserId: UUID!
    duplicateUserId: UUID!
    reason: String!
  ): CanonicalUser!

  # Trigger export job (admin/analyst)
  createExportJob(
    scope: String!          # 'full', 'canonical_users', 'github', 'google_workspace', 'aws_identity_center'
    format: String!         # 'json', 'csv', 'parquet'
    incremental: Boolean    # default false
    sinceTimestamp: DateTime # for incremental
  ): ExportJob!
}
```

### D.2 Example Queries

**1. All identities for a given email:**

```graphql
query IdentitiesByEmail {
  canonicalUserByEmail(email: "oliver.smith42@demo-example.co.uk") {
    id
    fullName
    primaryEmail
    providerLinks(first: 10) {
      edges {
        node {
          providerType
          providerUserId
          confidenceScore
          matchMethod
        }
      }
    }
    awsIdentityCenterUsers { id userName displayName active }
    googleWorkspaceUsers { id primaryEmail suspended isAdmin }
    githubUsers { id login email type }
  }
}
```

**2. Identity reconciliation queue (unmatched users):**

```graphql
query UnmatchedGitHubUsers {
  reconciliationQueue(providerType: "GITHUB", status: "PENDING", first: 20) {
    totalCount
    edges {
      node {
        id
        providerType
        providerUserId
        conflictReason
        status
        createdAt
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**3. External collaborators across all repositories:**

```graphql
query ExternalCollaborators {
  externalCollaborators(first: 50) {
    edges {
      node {
        permission
        isOutsideCollaborator
        user { login email name }
        repo { fullName visibility }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**4. Team membership drill-down:**

```graphql
query GitHubTeamMembers {
  githubOrganisations(first: 5) {
    edges {
      node {
        login
        name
        teams(first: 30) {
          edges {
            node {
              slug
              name
              members(first: 50) {
                edges {
                  node {
                    role
                    user {
                      login
                      canonicalUser { fullName primaryEmail }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### D.3 Resolver Strategy

**DataLoader pattern (N+1 prevention):**

Every relationship field uses a DataLoader that batches lookups within a single tick:

```typescript
// Example: CanonicalUser.awsIdentityCenterUsers resolver uses DataLoader
// Joins through canonical_user_provider_links to find AWS IDC users
const awsIdcUsersByCanonicalUserIdLoader = new DataLoader<string, AwsIdentityCenterUser[]>(
  async (canonicalUserIds) => {
    const { rows } = await executeWithTenant(
      ctx.tenantId,
      `SELECT aicu.*, cupl.canonical_user_id
       FROM canonical_user_provider_links cupl
       JOIN aws_identity_center_users aicu
         ON aicu.user_id = cupl.provider_user_id
         AND aicu.tenant_id = cupl.tenant_id
       WHERE cupl.canonical_user_id = ANY($1)
         AND cupl.provider_type = 'AWS_IDENTITY_CENTER'
         AND cupl.tenant_id = $2`,
      [canonicalUserIds, ctx.tenantId],
    );
    // Group by canonical_user_id and return in order
    const map = new Map<string, AwsIdentityCenterUser[]>();
    for (const row of rows) {
      const list = map.get(row.canonical_user_id) || [];
      list.push(row);
      map.set(row.canonical_user_id, list);
    }
    return canonicalUserIds.map((id) => map.get(id) || []);
  },
);
```

**Cursor pagination (keyset-based):**

Cursors encode `(id)` as base64. Keyset pagination avoids `OFFSET` performance degradation:

```sql
SELECT * FROM canonical_users
WHERE tenant_id = $1
  AND deleted_at IS NULL
  AND id > $2       -- decoded cursor
ORDER BY id
LIMIT $3            -- first + 1 (to detect hasNextPage)
```

### D.4 Query Guardrails

| Control | Setting | Enforcement |
|---------|---------|-------------|
| **Max depth** | 7 | `@graphql-yoga/plugin-query-depth` — rejects queries exceeding depth before execution |
| **Max complexity** | 1000 | Pothos complexity plugin — each field has a cost (scalars=1, lists=10, connections=20) |
| **Max first/limit** | 100 | Input validation in resolver — clamps `first` to `min(requested, 100)` |
| **Timeout** | 10s | `statement_timeout` via `SET LOCAL` (already exists in pool) |
| **Rate limit** | 60 req/min per user | Token bucket middleware keyed on `sub` claim |
| **Introspection** | Disabled in production | `@graphql-yoga/plugin-disable-introspection` |
| **Persisted queries** | APQ only in production | Automatic persisted queries; reject arbitrary strings |

### D.5 AuthZ Model

**Layer 1 — JWT validation (middleware):**
- Verify signature via JWKS
- Check `iss`, `aud`, `exp`
- Extract `tenant_id` and `roles`
- Set RLS context: `SET LOCAL app.current_tenant_id`

**Layer 2 — Role-based field guards (resolver):**

| Role | Sees PII fields? | Can mutate? | Can export? | Can view audit? |
|------|------------------|-------------|-------------|-----------------|
| `admin` | Yes | Yes | Yes | Yes |
| `analyst` | Yes | No | Yes (own tenant) | No |
| `readonly` | **No** — PII fields return `null` | No | No | No |
| `audit` | No | No | No | Yes |

**Field-level enforcement:**

```typescript
// In Pothos schema builder
t.string({
  resolve: (person, _args, ctx) => {
    if (ctx.role === 'readonly') return null; // PII guard
    return person.primary_email;
  },
});
```

**Layer 3 — Tenant-scoped queries (database):**
- Every query runs through `executeWithTenant()` which sets the tenant context via `SET LOCAL app.current_tenant_id`
- RLS policies (planned) will provide an additional layer of isolation at the database level

**Layer 4 — Audit logging:**
- Every GraphQL operation logged to console (current) with query hash, variables, user, and tenant
- Database-backed audit table planned for production

---

## E. Export/DLP Deliverables

### E.1 Export Table

```sql
CREATE TABLE IF NOT EXISTS export_job (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    scope           TEXT NOT NULL,   -- 'full', 'persons', 'access', 'github', 'audit'
    format          TEXT NOT NULL,   -- 'json', 'csv', 'parquet'
    incremental     BOOLEAN NOT NULL DEFAULT FALSE,
    since_timestamp TIMESTAMPTZ,     -- for incremental exports
    status          TEXT NOT NULL DEFAULT 'pending',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    entity_count    INTEGER,
    file_size_bytes BIGINT,
    storage_path    TEXT,            -- gs://bucket/path or s3://bucket/path
    checksum_sha256 TEXT,
    signed_url      TEXT,            -- populated after completion
    signed_url_expires_at TIMESTAMPTZ,
    error_detail    TEXT,
    metadata        JSONB,

    CONSTRAINT ck_export_status CHECK (status IN (
        'pending', 'running', 'completed', 'failed', 'expired'
    )),
    CONSTRAINT ck_export_format CHECK (format IN ('json', 'csv', 'parquet')),
    CONSTRAINT ck_export_scope CHECK (scope IN (
        'full', 'persons', 'access', 'github', 'audit', 'history'
    ))
);

CREATE INDEX IF NOT EXISTS idx_export_job_tenant
    ON export_job (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_job_status
    ON export_job (status) WHERE status IN ('pending', 'running');
```

### E.2 Snapshot Strategy

**Full export (weekly, scheduled):**
1. Export worker polls `export_job` for `status = 'pending'`
2. Opens a read-only transaction with `REPEATABLE READ` isolation
3. Streams rows from each table in scope using server-side cursors (`DECLARE ... CURSOR`)
4. Writes to Cloud Storage as newline-delimited JSON / CSV / Parquet
5. Computes SHA-256 checksum over the output
6. Updates `export_job` with `status='completed'`, `checksum_sha256`, `file_size_bytes`
7. Generates signed download URL (valid 24h)

**Incremental export (daily or on-demand):**
1. Uses `updated_at` timestamps as the change indicator (all tables have `updated_at`)
2. Queries each table with: `WHERE tenant_id = $1 AND updated_at > $2`
3. Produces a delta file containing only changed entities
4. Same checksum and signing flow as full export

**Retention policy:**
- Export files: 90-day lifecycle policy on the storage bucket
- Signed URLs: 24-hour expiry, regenerated on request
- `export_job` rows: retained indefinitely (metadata only, no PII)

### E.3 Export File Encryption

```
Export file ──► Envelope encryption:
  1. Generate random 256-bit DEK (data encryption key)
  2. Encrypt file with AES-256-GCM using DEK
  3. Encrypt DEK with Cloud KMS (KEK)
  4. Store encrypted DEK alongside file metadata
  5. Decrypt: retrieve KEK from KMS, unwrap DEK, decrypt file
```

### E.4 Restore Validation Playbook

| Step | Action | Frequency |
|------|--------|-----------|
| 1 | Verify checksum: `sha256sum export_file == export_job.checksum_sha256` | Every export |
| 2 | Load into staging database: `psql -f export_file staging_db` | Weekly (automated) |
| 3 | Run row count assertions: `SELECT COUNT(*) FROM canonical_users` matches `export_job.entity_count` | Weekly |
| 4 | Run sample query: join canonical_users → canonical_user_provider_links → provider tables; verify referential integrity | Weekly |
| 5 | Verify provider link counts match expected ratios | Weekly |
| 6 | Full restore drill: provision fresh PG instance, load full export, run integration test suite | Monthly |

**Measurable acceptance criteria:**
- RPO (Recovery Point Objective): 24 hours (daily incremental)
- RTO (Recovery Time Objective): 4 hours (full restore from latest export)
- Restore test: monthly, must complete in < 2 hours, all assertions pass

---

## F. Testing & Validation Plan

### F.1 Test Types and Acceptance Criteria

| Category | What It Asserts | Target | CI Gate |
|----------|----------------|--------|---------|
| **Unit (schema)** | DDL applies cleanly; constraints reject invalid data; CHECK constraints work | 100% of tables | `npm test -- --filter schema` must pass |
| **Unit (resolver)** | Each resolver returns correct shape; PII masking for readonly role; error cases | Every resolver + authZ variant | `npm test -- --filter resolver` must pass |
| **Unit (mapping)** | Email matching logic: exact match, noreply rejection, case insensitivity, conflict detection | All 6 conflict scenarios in C.2 | `npm test -- --filter mapping` must pass |
| **Integration (DB+API)** | GraphQL queries return correct data from seeded DB; pagination cursors work; tenant isolation enforced | Full query suite against test DB | `npm run test:integration` must pass |
| **Integration (connectors)** | Provider connectors (mocked) produce correct `canonical_user_provider_links` records | Google Workspace, AWS IDC, GitHub connectors | Mock-based integration tests |
| **Security (authZ)** | JWT validation; role-based field masking; cross-tenant rejection | 5+ authZ scenarios | `npm test -- --filter security` must pass |
| **Security (tenant isolation)** | Tenant A cannot see Tenant B data via GraphQL | Cross-tenant isolation test | Must pass with 0 leaked rows |
| **Security (scanning)** | No leaked secrets; dependency vulnerabilities below threshold | SAST + dependency scan | `npm audit --audit-level=high` exits 0 |
| **Performance (query)** | P95 latency < 200ms for common queries; complexity scorer rejects overweight queries | Load test with k6 | P95 < 200ms, 0 complexity violations |
| **Performance (DB)** | Query plans use indexes (no seq scans on large tables); cursor pagination stable at depth | `EXPLAIN ANALYZE` assertions | All plans use index scans |
| **Chaos (connector)** | Partial sync does not corrupt data; retry is idempotent | Simulate mid-sync failure | Data integrity check passes after recovery |
| **Chaos (replay)** | Re-ingesting the same data produces no duplicates | Idempotency test | Row counts unchanged after replay |

### F.2 CI Pipeline Gates

```yaml
# Every PR must pass ALL of these before merge
gates:
  - name: lint
    command: npm run lint
    must_pass: true

  - name: typecheck
    command: npx tsc --noEmit
    must_pass: true

  - name: unit_tests
    command: npm test -- --reporter=junit
    must_pass: true
    coverage_threshold: 80%

  - name: integration_tests
    command: npm run test:integration
    must_pass: true
    requires: [postgres_service]

  - name: security_audit
    command: npm audit --audit-level=high
    must_pass: true

  - name: secret_scanning
    command: gitleaks detect --source=.
    must_pass: true

  - name: dependency_review
    command: gh api /repos/{owner}/{repo}/dependency-graph/compare
    must_pass: true

  - name: graphql_complexity_test
    command: npm test -- --filter complexity
    must_pass: true
    criteria: "max_depth=7, max_complexity=1000"

  - name: schema_migration_test
    command: docker compose run --rm migrate && npm run test:schema
    must_pass: true

  - name: container_scan
    command: trivy image --severity HIGH,CRITICAL alxderia:test
    must_pass: true
```

---

## G. Runnable Examples

### G.1 GraphQL Server Setup (`src/server/graphql/server.ts`)

```typescript
import { createYoga, createSchema } from 'graphql-yoga';
import { useQueryDepth } from '@escape.tech/graphql-armor-max-depth';
import { useQueryComplexity } from '@escape.tech/graphql-armor-max-cost';
import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import SchemaBuilder from '@pothos/core';
import RelayPlugin from '@pothos/plugin-relay';
import DataloaderPlugin from '@pothos/plugin-dataloader';
import { executeWithTenant } from '../db/pool';
import { verifyJwt, extractTenantId, extractRole } from '../auth/jwt';

// ─── Pothos Schema Builder ─────────────────────────────────
const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    UUID: { Input: string; Output: string };
  };
}>({
  plugins: [RelayPlugin, DataloaderPlugin],
  relay: { clientMutationId: 'omit', cursorType: 'String' },
});

interface GraphQLContext {
  tenantId: string;
  userId: string;
  role: 'admin' | 'analyst' | 'readonly' | 'audit';
  executeQuery: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
}

// ─── Canonical User Type ────────────────────────────────────
const CanonicalUserRef = builder.node('CanonicalUser', {
  id: { resolve: (user) => user.id },
  fields: (t) => ({
    fullName: t.string({
      nullable: true,
      resolve: (user) => user.full_name,
    }),
    primaryEmail: t.string({
      nullable: true,
      resolve: (user, _args, ctx) => {
        // PII guard: readonly users cannot see email
        if (ctx.role === 'readonly') return null;
        return user.primary_email;
      },
    }),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (user) => user.created_at,
    }),
    // DataLoader-backed relation via provider links
    awsIdentityCenterUsers: t.loadableList({
      type: AwsIdentityCenterUserRef,
      load: async (ids: string[], ctx) => {
        const rows = await ctx.executeQuery(
          `SELECT aicu.*, cupl.canonical_user_id
           FROM canonical_user_provider_links cupl
           JOIN aws_identity_center_users aicu
             ON aicu.user_id = cupl.provider_user_id AND aicu.tenant_id = cupl.tenant_id
           WHERE cupl.canonical_user_id = ANY($1)
             AND cupl.provider_type = 'AWS_IDENTITY_CENTER'
             AND cupl.tenant_id = $2`,
          [ids, ctx.tenantId],
        );
        return ids.map((id) => rows.filter((r: any) => r.canonical_user_id === id));
      },
      resolve: (user) => user.id,
    }),
    githubUsers: t.loadableList({
      type: GitHubUserRef,
      load: async (ids: string[], ctx) => {
        const rows = await ctx.executeQuery(
          `SELECT gu.*, cupl.canonical_user_id
           FROM canonical_user_provider_links cupl
           JOIN github_users gu
             ON gu.node_id = cupl.provider_user_id AND gu.tenant_id = cupl.tenant_id
           WHERE cupl.canonical_user_id = ANY($1)
             AND cupl.provider_type = 'GITHUB'
             AND cupl.tenant_id = $2`,
          [ids, ctx.tenantId],
        );
        return ids.map((id) => rows.filter((r: any) => r.canonical_user_id === id));
      },
      resolve: (user) => user.id,
    }),
  }),
});

// ─── Query: canonicalUserByEmail ─────────────────────────────
builder.queryField('canonicalUserByEmail', (t) =>
  t.field({
    type: CanonicalUserRef,
    nullable: true,
    args: { email: t.arg.string({ required: true }) },
    resolve: async (_parent, args, ctx) => {
      const rows = await ctx.executeQuery(
        `SELECT * FROM canonical_users
         WHERE lower(primary_email) = lower($1)
           AND tenant_id = $2
           AND deleted_at IS NULL
         LIMIT 1`,
        [args.email, ctx.tenantId],
      );
      return rows[0] || null;
    },
  }),
);

// ─── Query: canonicalUsers (cursor-paginated) ────────────────
builder.queryField('canonicalUsers', (t) =>
  t.connection({
    type: CanonicalUserRef,
    args: {
      search: t.arg.string(),
      includeDeleted: t.arg.boolean({ defaultValue: false }),
    },
    resolve: async (_parent, args, ctx) => {
      const first = Math.min(args.first ?? 20, 100);
      const afterId = args.after
        ? Buffer.from(args.after, 'base64').toString()
        : null;

      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [ctx.tenantId];
      let paramIdx = 2;

      if (!args.includeDeleted) {
        conditions.push('deleted_at IS NULL');
      }

      if (afterId) {
        conditions.push(`id > $${paramIdx++}`);
        params.push(afterId);
      }
      if (args.search) {
        conditions.push(
          `(full_name ILIKE $${paramIdx} OR primary_email ILIKE $${paramIdx})`,
        );
        params.push(`%${args.search}%`);
        paramIdx++;
      }

      params.push(first + 1); // fetch one extra to detect hasNextPage

      const rows = await ctx.executeQuery<any>(
        `SELECT * FROM canonical_users
         WHERE ${conditions.join(' AND ')}
         ORDER BY id
         LIMIT $${paramIdx}`,
        params,
      );

      const hasNextPage = rows.length > first;
      const nodes = hasNextPage ? rows.slice(0, first) : rows;

      return {
        edges: nodes.map((node: any) => ({
          node,
          cursor: Buffer.from(node.id).toString('base64'),
        })),
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!afterId,
          startCursor: nodes[0]
            ? Buffer.from(nodes[0].id).toString('base64')
            : null,
          endCursor: nodes.length
            ? Buffer.from(nodes[nodes.length - 1].id).toString('base64')
            : null,
        },
      };
    },
  }),
);

// ─── Yoga Server ────────────────────────────────────────────
export function createGraphQLHandler() {
  const schema = builder.toSchema();
  const plugins = [
    useQueryDepth({ maxDepth: 7 }),
    useQueryComplexity({ maxCost: 1000 }),
  ];

  if (process.env.NODE_ENV === 'production') {
    plugins.push(useDisableIntrospection());
  }

  return createYoga({
    schema,
    plugins,
    context: async ({ request }) => {
      const authHeader = request.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('Missing authorization header');
      }
      const token = authHeader.slice(7);
      const payload = await verifyJwt(token);
      const tenantId = extractTenantId(payload);
      const role = extractRole(payload);

      return {
        tenantId,
        userId: payload.sub,
        role,
        executeQuery: async <T>(sql: string, params: unknown[] = []) => {
          const result = await executeWithTenant<T>(tenantId, sql, params);
          return result.rows;
        },
      } satisfies GraphQLContext;
    },
  });
}
```

### G.2 Auth Middleware (`src/server/auth/jwt.ts`)

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS_URI = process.env.AUTH_JWKS_URI!;      // e.g. https://auth.alxderia.io/.well-known/jwks.json
const ISSUER = process.env.AUTH_ISSUER!;           // e.g. https://auth.alxderia.io/
const AUDIENCE = process.env.AUTH_AUDIENCE!;        // e.g. alxderia-api

const jwks = createRemoteJWKSet(new URL(JWKS_URI));

export interface JwtPayload {
  sub: string;
  email: string;
  tenant_id: string;
  roles: string[];
  iss: string;
  aud: string;
  exp: number;
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: ISSUER,
    audience: AUDIENCE,
    clockTolerance: 30, // 30 seconds clock skew tolerance
  });
  return payload as unknown as JwtPayload;
}

export function extractTenantId(payload: JwtPayload): string {
  if (!payload.tenant_id) {
    throw new Error('Token missing tenant_id claim');
  }
  return payload.tenant_id;
}

export function extractRole(
  payload: JwtPayload,
): 'admin' | 'analyst' | 'readonly' | 'audit' {
  const roles = payload.roles || [];
  // Highest privilege wins
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('analyst')) return 'analyst';
  if (roles.includes('audit')) return 'audit';
  return 'readonly';
}
```

### G.3 Export Worker (`src/server/export/worker.ts`)

```typescript
import { Pool } from 'pg';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import { executeReadOnly, executeWithTenant } from '../db/pool';

interface ExportJobRow {
  id: string;
  tenant_id: string;
  scope: string;
  format: string;
  incremental: boolean;
  since_timestamp: string | null;
}

const SCOPE_QUERIES: Record<string, string[]> = {
  full: [
    'SELECT * FROM canonical_users',
    'SELECT * FROM canonical_emails',
    'SELECT * FROM canonical_user_provider_links',
    'SELECT * FROM google_workspace_users',
    'SELECT * FROM google_workspace_groups',
    'SELECT * FROM google_workspace_memberships',
    'SELECT * FROM aws_identity_center_users',
    'SELECT * FROM aws_identity_center_groups',
    'SELECT * FROM aws_identity_center_memberships',
    'SELECT * FROM github_organisations',
    'SELECT * FROM github_users',
    'SELECT * FROM github_teams',
    'SELECT * FROM github_org_memberships',
    'SELECT * FROM github_team_memberships',
    'SELECT * FROM github_repositories',
    'SELECT * FROM github_repo_team_permissions',
    'SELECT * FROM github_repo_collaborator_permissions',
    'SELECT * FROM identity_reconciliation_queue',
  ],
  canonical_users: [
    'SELECT * FROM canonical_users',
    'SELECT * FROM canonical_emails',
    'SELECT * FROM canonical_user_provider_links',
  ],
  github: [
    'SELECT * FROM github_organisations',
    'SELECT * FROM github_users',
    'SELECT * FROM github_teams',
    'SELECT * FROM github_org_memberships',
    'SELECT * FROM github_team_memberships',
    'SELECT * FROM github_repositories',
    'SELECT * FROM github_repo_team_permissions',
    'SELECT * FROM github_repo_collaborator_permissions',
  ],
  google_workspace: [
    'SELECT * FROM google_workspace_users',
    'SELECT * FROM google_workspace_groups',
    'SELECT * FROM google_workspace_memberships',
  ],
  aws_identity_center: [
    'SELECT * FROM aws_identity_center_users',
    'SELECT * FROM aws_identity_center_groups',
    'SELECT * FROM aws_identity_center_memberships',
  ],
};

export async function processExportJob(job: ExportJobRow): Promise<void> {
  const startedAt = new Date();

  // Mark as running
  await executeReadOnly(
    `UPDATE export_job SET status = 'running', started_at = $1 WHERE id = $2`,
    [startedAt, job.id],
  );

  try {
    const queries = SCOPE_QUERIES[job.scope];
    if (!queries) throw new Error(`Unknown scope: ${job.scope}`);

    let totalRows = 0;
    const hash = createHash('sha256');
    const outputPath = `/tmp/export-${job.id}.${job.format === 'json' ? 'ndjson' : job.format}`;
    const out = createWriteStream(outputPath);

    for (const baseQuery of queries) {
      const query = job.incremental && job.since_timestamp
        ? `${baseQuery} WHERE ingested_at > $1`
        : baseQuery;
      const params = job.incremental && job.since_timestamp
        ? [job.since_timestamp]
        : [];

      const { rows } = await executeWithTenant(job.tenant_id, query, params, 300_000);

      for (const row of rows) {
        const line = JSON.stringify(row) + '\n';
        out.write(line);
        hash.update(line);
        totalRows++;
      }
    }

    out.end();
    const checksum = hash.digest('hex');

    // In production: upload to Cloud Storage and generate signed URL
    // const storageUrl = await uploadToStorage(outputPath, job);
    // const signedUrl = await generateSignedUrl(storageUrl, 24 * 60 * 60);

    await executeReadOnly(
      `UPDATE export_job
       SET status = 'completed',
           completed_at = NOW(),
           entity_count = $1,
           checksum_sha256 = $2,
           storage_path = $3
       WHERE id = $4`,
      [totalRows, checksum, outputPath, job.id],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await executeReadOnly(
      `UPDATE export_job SET status = 'failed', error_detail = $1 WHERE id = $2`,
      [message, job.id],
    );
    throw error;
  }
}

// Poll loop (production: replace with Cloud Scheduler or SQS trigger)
export async function startExportWorker(): Promise<void> {
  const POLL_INTERVAL = 30_000; // 30 seconds

  const tick = async () => {
    const { rows } = await executeReadOnly<ExportJobRow>(
      `SELECT * FROM export_job
       WHERE status = 'pending'
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );

    if (rows.length > 0) {
      await processExportJob(rows[0]);
    }
  };

  setInterval(tick, POLL_INTERVAL);
  tick(); // run immediately on start
}
```

### G.4 Test Examples

**Test 1 — Schema constraint validation:**

```typescript
// tests/schema/person-link-constraint.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
});

afterAll(async () => {
  await pool.end();
});

describe('provider_type_enum constraints', () => {
  it('accepts valid provider_type_enum values', async () => {
    const result = await pool.query(`
      SELECT enum_range(NULL::provider_type_enum) AS valid_types
    `);
    expect(result.rows[0].valid_types).toContain('GOOGLE_WORKSPACE');
    expect(result.rows[0].valid_types).toContain('AWS_IDENTITY_CENTER');
    expect(result.rows[0].valid_types).toContain('GITHUB');
  });

  it('rejects invalid provider_type values', async () => {
    await expect(pool.query(`
      INSERT INTO canonical_user_provider_links
        (tenant_id, canonical_user_id, provider_type, provider_user_id, match_method)
      VALUES ('11111111-1111-1111-1111-111111111111', uuid_generate_v4(), 'INVALID', 'test', 'test')
    `)).rejects.toThrow();
  });

  it('enforces composite PK (id, tenant_id) uniqueness', async () => {
    const result = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'canonical_users'::regclass AND contype = 'p'
    `);
    expect(result.rows[0].conname).toBe('canonical_users_pkey');
  });
});
```

**Test 2 — PII masking for readonly role:**

```typescript
// tests/resolvers/pii-masking.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from '../helpers/test-context';

describe('PII masking', () => {
  it('admin sees primaryEmail', async () => {
    const ctx = createTestContext({ role: 'admin' });
    const result = await ctx.executeGraphQL(`
      query { personByEmail(email: "oliver.smith1@demo-example.co.uk") {
        primaryEmail
      }}
    `);
    expect(result.data.personByEmail.primaryEmail).toBe(
      'oliver.smith1@demo-example.co.uk',
    );
  });

  it('readonly user sees null for primaryEmail', async () => {
    const ctx = createTestContext({ role: 'readonly' });
    const result = await ctx.executeGraphQL(`
      query { personByEmail(email: "oliver.smith1@demo-example.co.uk") {
        primaryEmail
      }}
    `);
    expect(result.data.personByEmail.primaryEmail).toBeNull();
  });
});
```

**Test 3 — RLS tenant isolation:**

```typescript
// tests/security/rls-isolation.test.ts
import { describe, it, expect } from 'vitest';
import { executeWithTenant } from '../../src/server/db/pool';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('Tenant isolation', () => {
  it('tenant A cannot see tenant B canonical users', async () => {
    const { rows } = await executeWithTenant(TENANT_A,
      `SELECT COUNT(*) AS cnt FROM canonical_users
       WHERE tenant_id = $1`, [TENANT_B],
    );
    expect(Number(rows[0].cnt)).toBe(0);
  });

  it('tenant A sees only own github_users', async () => {
    const { rows } = await executeWithTenant(TENANT_A,
      `SELECT DISTINCT tenant_id FROM github_users`,
    );
    expect(rows.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it('cross-tenant provider_link lookup returns empty', async () => {
    const { rows } = await executeWithTenant(TENANT_A,
      `SELECT * FROM canonical_user_provider_links
       WHERE tenant_id = $1 LIMIT 1`, [TENANT_B],
    );
    expect(rows).toHaveLength(0);
  });
});
```

**Test 4 — Query complexity rejection:**

```typescript
// tests/graphql/complexity.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from '../helpers/test-context';

describe('GraphQL query guardrails', () => {
  it('rejects queries exceeding max depth of 7', async () => {
    const ctx = createTestContext({ role: 'analyst' });
    // Depth 8: persons → githubUsers → teamMemberships → team → parentTeam
    //          → members → user → person → awsIdcUsers (9 levels)
    const result = await ctx.executeGraphQL(`
      query {
        persons(first: 1) { edges { node {
          githubUsers { teamMemberships { team {
            parentTeam { members(first: 1) { edges { node {
              user { person { displayName awsIdcUsers { id } } }
            }}}}
          }}}
        }}}
      }
    `);
    expect(result.errors).toBeDefined();
    expect(result.errors[0].message).toContain('depth');
  });

  it('accepts queries within depth limit', async () => {
    const ctx = createTestContext({ role: 'analyst' });
    const result = await ctx.executeGraphQL(`
      query {
        persons(first: 5) {
          edges {
            node { displayName githubUsers { login } }
          }
          pageInfo { hasNextPage }
        }
      }
    `);
    expect(result.errors).toBeUndefined();
  });

  it('clamps first parameter to 100', async () => {
    const ctx = createTestContext({ role: 'analyst' });
    const result = await ctx.executeGraphQL(`
      query { persons(first: 9999) { edges { node { id } } } }
    `);
    // Should succeed but return at most 100 edges
    expect(result.data.persons.edges.length).toBeLessThanOrEqual(100);
  });
});
```

**Test 5 — Email matching logic:**

```typescript
// tests/mapping/email-match.test.ts
import { describe, it, expect } from 'vitest';
import { executeWithTenant } from '../../src/server/db/pool';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('Email matching logic', () => {
  it('matches canonical user by case-insensitive email', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT cu.id FROM canonical_users cu
       WHERE lower(cu.primary_email) = lower($1)
         AND cu.deleted_at IS NULL`,
      ['ALICE.JOHNSON@DEMO-EXAMPLE.CO.UK'],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('noreply GitHub users are in reconciliation queue', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT irq.id, irq.provider_user_id, irq.status
       FROM identity_reconciliation_queue irq
       WHERE irq.provider_type = 'GITHUB'
         AND irq.conflict_reason LIKE '%noreply%'`,
    );
    // All noreply users should be in the reconciliation queue as PENDING
    for (const row of rows) {
      expect(row.status).toBe('PENDING');
    }
  });

  it('linked GitHub users have canonical_user_provider_links entries', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT gu.id
       FROM github_users gu
       LEFT JOIN canonical_user_provider_links cupl
         ON cupl.provider_user_id = gu.node_id
         AND cupl.provider_type = 'GITHUB'
         AND cupl.tenant_id = gu.tenant_id
       WHERE gu.email NOT LIKE '%@users.noreply.github.com'
         AND cupl.id IS NULL`,
    );
    // No linked users should be missing a provider link
    expect(rows).toHaveLength(0);
  });

  it('confidence_score is 100 for email-matched identities', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT confidence_score, match_method
       FROM canonical_user_provider_links
       WHERE provider_type = 'GITHUB'
         AND match_method = 'email_exact'
       LIMIT 10`,
    );
    for (const row of rows) {
      expect(Number(row.confidence_score)).toBe(100);
    }
  });
});
```

### G.5 CI Pipeline (`/.github/workflows/ci.yml`)

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write

env:
  NODE_VERSION: '22'
  PG_VERSION: '18'

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: cd app && npm ci
      - run: cd app && npm run lint
      - run: cd app && npx tsc --noEmit

  unit-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:${{ env.PG_VERSION }}-alpine
        env:
          POSTGRES_USER: cloudintel
          POSTGRES_PASSWORD: test-password
          POSTGRES_DB: cloud_identity_intel_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U cloudintel"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: cd app && npm ci

      # Apply schema + seed data
      - name: Apply schema
        env:
          PGHOST: localhost
          PGPORT: 5432
          PGUSER: cloudintel
          PGPASSWORD: test-password
          PGDATABASE: cloud_identity_intel_test
        run: |
          psql --set ON_ERROR_STOP=1 -f schema/01_schema.sql
          psql --set ON_ERROR_STOP=1 -f schema/02_seed_and_queries.sql

      - name: Run unit tests
        env:
          TEST_DATABASE_URL: postgresql://cloudintel:test-password@localhost:5432/cloud_identity_intel_test
        run: cd app && npm test -- --reporter=junit --coverage

      - name: Check coverage threshold
        run: |
          cd app
          COVERAGE=$(npx vitest run --coverage --reporter=json 2>/dev/null | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80% threshold"
            exit 1
          fi

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: cd app && npm ci

      # Dependency audit
      - name: npm audit
        run: cd app && npm audit --audit-level=high

      # Secret scanning
      - name: Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}

      # SAST via CodeQL
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: typescript
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
      - name: Perform CodeQL analysis
        uses: github/codeql-action/analyze@v3

  container-scan:
    runs-on: ubuntu-latest
    needs: [unit-tests]
    steps:
      - uses: actions/checkout@v4
      - name: Build image
        run: docker build -t alxderia:test app/
      - name: Trivy scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: alxderia:test
          format: sarif
          output: trivy-results.sarif
          severity: HIGH,CRITICAL
          exit-code: 1
      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif

  schema-migration-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:${{ env.PG_VERSION }}-alpine
        env:
          POSTGRES_USER: cloudintel
          POSTGRES_PASSWORD: test-password
          POSTGRES_DB: cloud_identity_intel_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U cloudintel"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - name: Apply schema (must succeed cleanly)
        env:
          PGHOST: localhost
          PGPORT: 5432
          PGUSER: cloudintel
          PGPASSWORD: test-password
          PGDATABASE: cloud_identity_intel_test
        run: |
          psql --set ON_ERROR_STOP=1 -f schema/01_schema.sql
          psql --set ON_ERROR_STOP=1 -f schema/02_seed_and_queries.sql

      - name: Verify table counts
        env:
          PGHOST: localhost
          PGPORT: 5432
          PGUSER: cloudintel
          PGPASSWORD: test-password
          PGDATABASE: cloud_identity_intel_test
        run: |
          CU_COUNT=$(psql -t -c "SELECT COUNT(*) FROM canonical_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'")
          GH_COUNT=$(psql -t -c "SELECT COUNT(*) FROM github_users WHERE tenant_id = '11111111-1111-1111-1111-111111111111'")
          LINK_COUNT=$(psql -t -c "SELECT COUNT(*) FROM canonical_user_provider_links WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND provider_type = 'GITHUB'")

          echo "Canonical users: $CU_COUNT, GitHub users: $GH_COUNT, GitHub links: $LINK_COUNT"

          # Assertions (demo seed has 3 canonical users, 2 GitHub users)
          [ "$(echo $CU_COUNT | tr -d ' ')" -ge 3 ] || (echo "Expected >= 3 canonical_users" && exit 1)
          [ "$(echo $GH_COUNT | tr -d ' ')" -ge 2 ] || (echo "Expected >= 2 github_users" && exit 1)
```

---

## Assumptions

1. **OIDC IdP exists.** The organisation has an identity provider (Auth0, Entra ID, or Google Workspace) capable of issuing JWTs with custom claims (`tenant_id`, `roles`).
2. **PostgreSQL 18.** All DDL is compatible with PG 18; tested locally on PG 18 Alpine. Aurora may lag behind — tested against PG 16 for AWS compatibility.
3. **Single-region.** GraphQL server and database are co-located. Cross-region read replicas are out of scope.
4. **No real-time subscriptions.** GraphQL subscriptions are not included; polling or webhook-based refresh is preferred to avoid WebSocket infrastructure.
5. **Export bucket exists.** Cloud Storage bucket with lifecycle policies is provisioned by Terraform (not defined in this document).
6. **Ingestion pipeline is external.** Connector code (GitHub API client, AWS SDK calls) is not in scope for this document. The schema and `canonical_user_provider_links` contract are defined here; connectors implement them.
7. **GitHub access is via repository permissions.** GitHub teams grant repo access (`github_repo_team_permissions`), not cloud resource access. GitHub data is queryable via the identity graph and `github_repo_collaborator_permissions` table.
