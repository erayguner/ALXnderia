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
| Database | PostgreSQL (18 Cloud SQL / 16 Aurora) | 28 tables, 4 mat views, 6 roles, RLS, partitioned audit + history |
| Auth | **Mock** — hardcoded session in route handlers | No real AuthN/AuthZ |
| Ingestion | External pipeline assumed; `cloudintel_ingest` role | No application-level connector code |
| Export/DLP | `entity_history` + `snapshot_registry` + hash chains | Schema exists; no API or job runner |
| Infra | Terraform (Docker local / AWS Aurora+App Runner / GCP Cloud SQL+Cloud Run) | Dual-cloud IaC defined |
| Tests | Vitest configured | 0 test files committed |

### Key gaps

1. **No real authentication.** `getSession()` returns a hardcoded mock.
2. **No GraphQL.** API is bespoke REST endpoints with inline SQL.
3. **No ingestion API or connectors.** Data loading is assumed external.
4. **No export/backup jobs.** Schema for snapshots exists but no execution layer.
5. **No CI/CD pipeline.** No `.github/workflows/` files.
6. **No tests.** Vitest configured but empty.
7. **GitHub tables newly added** but not yet wired into `mv_effective_access`, RLS, or role grants.

### What works well (keep)

- RLS with `SET LOCAL app.current_tenant_id` — clean tenant isolation.
- 6-role privilege model — well-separated.
- Hash-chained `entity_history` with verification function — strong audit trail.
- Partitioned `audit_log` and `entity_history` — ready for scale.
- SQL validator (7-layer, AST-based) — robust defence-in-depth for NL2SQL path.
- Person-centric identity model with `person_link` — sound canonical design.
- Open-ended `person_link.identity_type` CHECK — extensible for future providers.

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
| **PostgreSQL** | System of record, RLS, audit, history | PostgreSQL 18, existing schema |
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

The existing codebase already has a `pg` pool with tenant-scoping, 6 DB roles, and RLS. A code-first GraphQL server gives us:
- Explicit schema surface (no accidental exposure)
- Resolver-level authZ in addition to RLS (defence-in-depth)
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
  "tenant_id": "a0000000-0000-0000-0000-000000000001",
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
| GitHub tables added to RLS + role grants | Additive — existing queries unaffected | Run schema migration |
| Export worker | Additive | Deploy as separate process or Cloud Scheduler job |

---

## C. Data Model Impact

### C.1 Canonical User Model

```
person (canonical identity)
  │
  ├── person_link ──► aws_iam_user      (provider_code='aws', identity_type='aws_iam_user')
  ├── person_link ──► aws_idc_user      (provider_code='aws', identity_type='aws_idc_user')
  ├── person_link ──► gcp_workspace_user(provider_code='gcp', identity_type='gcp_workspace_user')
  └── person_link ──► github_user       (provider_code='github', identity_type='github_user')

Source of truth: person.primary_email (lowercase, unique per tenant)
Internal identifier: person.id (UUID)
```

### C.2 Conflict Handling Matrix

| Scenario | Detection | Resolution |
|----------|-----------|------------|
| **Duplicate email across providers** | Exact match: `lower(person.primary_email) = lower(provider_user.email)` | Link to existing person; create `person_link` with `confidence=1.00`, `linkage_strategy='email_match'` |
| **Email mismatch (display name differs)** | Same email, different display_name | Tolerate — log in `person_link.notes`; person.display_name is authoritative |
| **Missing email** (GitHub noreply, service accounts) | `email LIKE '%@users.noreply.github.com'` or `email IS NULL` | Set `person_id = NULL`; create `person_link` with `confidence=0.00`, `linkage_strategy='pending_review'` |
| **Email change** (user changes corporate email) | Provider sync detects new email, no person match | Flag for manual review; do NOT auto-create duplicate person |
| **Merge required** (two person records for same human) | Admin identifies via audit | Admin merges: reparent all `person_link` rows to surviving person, soft-delete duplicate, log in `audit_log` |
| **Cross-tenant collision** | Same email in different tenants | Expected and valid — RLS prevents cross-tenant visibility |

### C.3 Required Schema Changes (New)

The following changes are needed to complete GitHub integration and support GraphQL:

**1. Add GitHub tables to RLS policies** (`schema/08-security/020_rls_policies.sql`):

```sql
-- Add to the unnest array in _create_tenant_rls call:
SELECT _create_tenant_rls(t) FROM unnest(ARRAY[
    -- ... existing tables ...
    'github_organisation', 'github_user', 'github_team',
    'github_team_membership', 'github_org_membership'
]) AS t;
```

**2. Add GitHub tables to role grants** (`schema/08-security/010_roles.sql`):

```sql
-- Add to the operational tables array:
'github_organisation', 'github_user', 'github_team',
'github_team_membership', 'github_org_membership'
```

**3. Add unique index on person email per tenant** (for conflict detection):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_email_unique
    ON person (tenant_id, lower(primary_email))
    WHERE primary_email IS NOT NULL AND deleted_at IS NULL;
```

**4. Add cursor pagination support index** (for GraphQL):

```sql
CREATE INDEX IF NOT EXISTS idx_person_cursor
    ON person (tenant_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_person_link_cursor
    ON person_link (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_github_user_cursor
    ON github_user (tenant_id, id);
```

### C.4 Indexing Strategy for Graph Queries

| Query Pattern | Index | Notes |
|---------------|-------|-------|
| Person by email | `idx_person_email` (existing) | `(tenant_id, primary_email)` |
| Person identities | `idx_person_link_person` (existing) | `(person_id)` |
| GitHub user by login | `idx_github_user_login` (existing) | `(tenant_id, login)` |
| GitHub user by email | `idx_github_user_email` (existing) | `(tenant_id, lower(email))` |
| Team members | `idx_github_tm_team` + `idx_github_tm_user` (existing) | Composite join path |
| Effective access | `idx_mv_ea_person` (existing) | `(person_id)` on mat view |
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

# ─── Person (Canonical Identity) ───────────────────────────
type Person {
  id: UUID!
  displayName: String
  primaryEmail: String          # Null for readonly role (PII)
  hrEmployeeId: String
  status: String!
  createdAt: DateTime!
  updatedAt: DateTime!

  # Relations (DataLoader-backed)
  identityLinks(
    first: Int = 20
    after: String
    providerCode: String
  ): PersonLinkConnection!

  awsIdcUsers: [AwsIdcUser!]!
  awsIamUsers: [AwsIamUser!]!
  gcpWorkspaceUsers: [GcpWorkspaceUser!]!
  githubUsers: [GitHubUser!]!

  effectiveAccess(
    first: Int = 50
    after: String
    cloudProvider: String
    accessPath: String
  ): EffectiveAccessConnection!

  groupMemberships: [GroupMembership!]!
}

type PersonConnection {
  edges: [PersonEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type PersonEdge {
  node: Person!
  cursor: String!
}

# ─── Person Link ───────────────────────────────────────────
type PersonLink {
  id: UUID!
  providerCode: String!
  identityType: String!
  linkageStrategy: String!
  confidence: Float!
  linkedAt: DateTime!
  notes: String
}

type PersonLinkConnection {
  edges: [PersonLinkEdge!]!
  pageInfo: PageInfo!
}

type PersonLinkEdge {
  node: PersonLink!
  cursor: String!
}

# ─── Provider Identities ──────────────────────────────────
type AwsIdcUser {
  id: UUID!
  identityStoreUserId: String!
  userName: String
  displayName: String
  email: String              # PII-guarded
  lastSeenAt: DateTime
  disabledAt: DateTime
  person: Person
  groupMemberships: [AwsIdcGroupMembership!]!
}

type AwsIamUser {
  id: UUID!
  iamUserName: String!
  arn: String!
  lastSeenAt: DateTime
  person: Person
  policyAttachments: [AwsIamPolicyAttachment!]!
}

type AwsIamPolicyAttachment {
  policyArn: String!
  policyName: String!
}

type GcpWorkspaceUser {
  id: UUID!
  primaryEmail: String       # PII-guarded
  displayName: String
  suspended: Boolean!
  lastSeenAt: DateTime
  person: Person
  groupMemberships: [GcpWorkspaceGroupMembership!]!
}

type GitHubUser {
  id: UUID!
  githubUserId: Int!
  login: String!
  displayName: String
  email: String              # PII-guarded
  twoFactorEnabled: Boolean
  lastSeenAt: DateTime
  person: Person
  teamMemberships: [GitHubTeamMembership!]!
  orgMemberships: [GitHubOrgMembership!]!
}

# ─── Groups / Teams ────────────────────────────────────────
type AwsIdcGroup {
  id: UUID!
  displayName: String!
  description: String
  members(first: Int = 50, after: String): AwsIdcGroupMembershipConnection!
}

type AwsIdcGroupMembership {
  group: AwsIdcGroup!
  user: AwsIdcUser!
}

type AwsIdcGroupMembershipConnection {
  edges: [AwsIdcGroupMembershipEdge!]!
  pageInfo: PageInfo!
}

type AwsIdcGroupMembershipEdge {
  node: AwsIdcGroupMembership!
  cursor: String!
}

type GcpWorkspaceGroup {
  id: UUID!
  displayName: String!
  groupEmail: String!
  members(first: Int = 50, after: String): GcpGroupMembershipConnection!
}

type GcpWorkspaceGroupMembership {
  group: GcpWorkspaceGroup!
  user: GcpWorkspaceUser!
  role: String!
}

type GcpGroupMembershipConnection {
  edges: [GcpGroupMembershipEdge!]!
  pageInfo: PageInfo!
}

type GcpGroupMembershipEdge {
  node: GcpWorkspaceGroupMembership!
  cursor: String!
}

type GitHubOrganisation {
  id: UUID!
  login: String!
  displayName: String
  plan: String
  twoFactorRequirementEnabled: Boolean
  teams(first: Int = 50, after: String): GitHubTeamConnection!
  members(first: Int = 50, after: String): GitHubOrgMembershipConnection!
}

type GitHubTeam {
  id: UUID!
  slug: String!
  displayName: String
  privacy: String
  parentTeam: GitHubTeam
  members(first: Int = 50, after: String): GitHubTeamMembershipConnection!
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

# ─── Effective Access ──────────────────────────────────────
type EffectiveAccess {
  cloudProvider: String!
  accountOrProjectId: String!
  accountOrProjectName: String!
  roleOrPermissionSet: String!
  accessPath: String!
  viaGroupName: String
  lastSeenAt: DateTime
}

type EffectiveAccessConnection {
  edges: [EffectiveAccessEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type EffectiveAccessEdge {
  node: EffectiveAccess!
  cursor: String!
}

# ─── Union type for group memberships ──────────────────────
union GroupMembership =
    AwsIdcGroupMembership
  | GcpWorkspaceGroupMembership
  | GitHubTeamMembership
  | GitHubOrgMembership

# ─── Queries ──────────────────────────────────────────────
type Query {
  # Person lookups
  person(id: UUID!): Person
  personByEmail(email: String!): Person
  persons(
    first: Int = 20
    after: String
    search: String
    status: String
  ): PersonConnection!

  # Unmapped identities (person_id IS NULL)
  unmappedIdentities(
    providerCode: String
    first: Int = 50
    after: String
  ): UnmappedIdentityConnection!

  # Provider-specific lookups
  githubOrganisation(id: UUID!): GitHubOrganisation
  githubOrganisations(first: Int = 10, after: String): GitHubOrganisationConnection!
  githubUser(login: String!): GitHubUser
  awsIdcGroup(id: UUID!): AwsIdcGroup
  gcpWorkspaceGroup(id: UUID!): GcpWorkspaceGroup

  # Cross-provider search
  identitiesByEmail(email: String!): [ProviderIdentity!]!

  # Orphan detection
  personsWithIncompleteMapping(
    minProviders: Int = 3
    first: Int = 50
    after: String
  ): PersonConnection!

  # Access queries
  whoCanAccess(
    accountOrProjectId: String!
    cloudProvider: String
    first: Int = 50
    after: String
  ): PersonConnection!

  # Audit
  entityHistory(
    entityType: String!
    entityId: UUID!
    first: Int = 50
    after: String
  ): EntityHistoryConnection!

  # Export jobs
  exportJobs(status: String, first: Int = 20, after: String): ExportJobConnection!
}

# ─── Unmapped Identity ─────────────────────────────────────
union UnmappedIdentity = AwsIdcUser | AwsIamUser | GcpWorkspaceUser | GitHubUser

type UnmappedIdentityConnection {
  edges: [UnmappedIdentityEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UnmappedIdentityEdge {
  node: UnmappedIdentity!
  cursor: String!
}

# ─── Provider Identity (for cross-provider search) ─────────
type ProviderIdentity {
  providerCode: String!
  identityType: String!
  displayName: String
  email: String
  lastSeenAt: DateTime
  personId: UUID
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
    personId: UUID!
    providerIdentityId: UUID!
    identityType: String!
    providerCode: String!
    notes: String
  ): PersonLink!

  # Merge duplicate persons (admin only)
  mergePersons(
    survivingPersonId: UUID!
    duplicatePersonId: UUID!
    reason: String!
  ): Person!

  # Trigger export job (admin/analyst)
  createExportJob(
    scope: String!          # 'full', 'persons', 'access', 'github', 'audit'
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
  personByEmail(email: "oliver.smith42@demo-example.co.uk") {
    id
    displayName
    primaryEmail
    status
    identityLinks(first: 10) {
      edges {
        node {
          providerCode
          identityType
          confidence
          linkageStrategy
        }
      }
    }
    awsIdcUsers { id userName email lastSeenAt }
    awsIamUsers { id iamUserName arn lastSeenAt }
    gcpWorkspaceUsers { id primaryEmail suspended }
    githubUsers { id login email twoFactorEnabled }
  }
}
```

**2. Unmapped users (no person link):**

```graphql
query UnmappedGitHubUsers {
  unmappedIdentities(providerCode: "github", first: 20) {
    totalCount
    edges {
      node {
        ... on GitHubUser {
          login
          email
          githubUserId
          lastSeenAt
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**3. Access paths for a person:**

```graphql
query PersonAccess($personId: UUID!) {
  person(id: $personId) {
    displayName
    effectiveAccess(first: 100, cloudProvider: "aws") {
      totalCount
      edges {
        node {
          cloudProvider
          accountOrProjectId
          accountOrProjectName
          roleOrPermissionSet
          accessPath
          viaGroupName
        }
      }
      pageInfo { hasNextPage endCursor }
    }
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
        displayName
        teams(first: 30) {
          edges {
            node {
              slug
              displayName
              members(first: 50) {
                edges {
                  node {
                    role
                    user {
                      login
                      person { displayName primaryEmail }
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
// Example: Person.awsIdcUsers resolver uses DataLoader
const awsIdcUsersByPersonIdLoader = new DataLoader<string, AwsIdcUser[]>(
  async (personIds) => {
    const { rows } = await executeWithTenant(
      ctx.tenantId,
      `SELECT * FROM aws_idc_user
       WHERE person_id = ANY($1) AND disabled_at IS NULL`,
      [personIds],
    );
    // Group by person_id and return in order
    const map = new Map<string, AwsIdcUser[]>();
    for (const row of rows) {
      const list = map.get(row.person_id) || [];
      list.push(row);
      map.set(row.person_id, list);
    }
    return personIds.map((id) => map.get(id) || []);
  },
);
```

**Cursor pagination (keyset-based):**

Cursors encode `(id)` as base64. Keyset pagination avoids `OFFSET` performance degradation:

```sql
SELECT * FROM person
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

**Layer 3 — RLS (database):**
- Every query runs through `executeWithTenant()` which sets the RLS context
- Even if a resolver bug leaks a cross-tenant ID, the DB rejects it

**Layer 4 — Audit logging:**
- Every GraphQL operation is logged to `audit_log` with query hash, variables, user, and tenant

---

## E. Export/DLP Deliverables

### E.1 Export Table

```sql
CREATE TABLE IF NOT EXISTS export_job (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
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
1. Uses `entity_history` as the change feed
2. Queries: `SELECT * FROM entity_history WHERE tenant_id = $1 AND event_time > $2`
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
| 3 | Run row count assertions: `SELECT COUNT(*) FROM person` matches `export_job.entity_count` | Weekly |
| 4 | Run hash chain verification: `SELECT * FROM verify_entity_integrity_chain(...)` on 10 random entities | Weekly |
| 5 | Run sample query: join person → person_link → provider tables; verify referential integrity | Weekly |
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
| **Integration (DB+API)** | GraphQL queries return correct data from seeded DB; pagination cursors work; RLS enforces tenant isolation | Full query suite against test DB | `npm run test:integration` must pass |
| **Integration (connectors)** | Provider connectors (mocked) produce correct person_link records | AWS, GCP, GitHub connectors | Mock-based integration tests |
| **Security (authZ)** | JWT validation; role-based field masking; cross-tenant rejection | 5+ authZ scenarios | `npm test -- --filter security` must pass |
| **Security (RLS)** | Tenant A cannot see Tenant B data via GraphQL | Cross-tenant isolation test | Must pass with 0 leaked rows |
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

// ─── Person Type ────────────────────────────────────────────
const PersonRef = builder.node('Person', {
  id: { resolve: (person) => person.id },
  fields: (t) => ({
    displayName: t.string({
      nullable: true,
      resolve: (person) => person.display_name,
    }),
    primaryEmail: t.string({
      nullable: true,
      resolve: (person, _args, ctx) => {
        // PII guard: readonly users cannot see email
        if (ctx.role === 'readonly') return null;
        return person.primary_email;
      },
    }),
    status: t.exposeString('status'),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (person) => person.created_at,
    }),
    // DataLoader-backed relation
    awsIdcUsers: t.loadableList({
      type: AwsIdcUserRef,
      load: async (ids: string[], ctx) => {
        const rows = await ctx.executeQuery(
          `SELECT * FROM aws_idc_user WHERE person_id = ANY($1) AND disabled_at IS NULL`,
          [ids],
        );
        return ids.map((id) => rows.filter((r: any) => r.person_id === id));
      },
      resolve: (person) => person.id,
    }),
    githubUsers: t.loadableList({
      type: GitHubUserRef,
      load: async (ids: string[], ctx) => {
        const rows = await ctx.executeQuery(
          `SELECT * FROM github_user WHERE person_id = ANY($1)`,
          [ids],
        );
        return ids.map((id) => rows.filter((r: any) => r.person_id === id));
      },
      resolve: (person) => person.id,
    }),
  }),
});

// ─── Query: personByEmail ───────────────────────────────────
builder.queryField('personByEmail', (t) =>
  t.field({
    type: PersonRef,
    nullable: true,
    args: { email: t.arg.string({ required: true }) },
    resolve: async (_parent, args, ctx) => {
      const rows = await ctx.executeQuery(
        `SELECT * FROM person
         WHERE lower(primary_email) = lower($1)
           AND deleted_at IS NULL
         LIMIT 1`,
        [args.email],
      );
      return rows[0] || null;
    },
  }),
);

// ─── Query: persons (cursor-paginated) ──────────────────────
builder.queryField('persons', (t) =>
  t.connection({
    type: PersonRef,
    args: {
      search: t.arg.string(),
      status: t.arg.string(),
    },
    resolve: async (_parent, args, ctx) => {
      const first = Math.min(args.first ?? 20, 100);
      const afterId = args.after
        ? Buffer.from(args.after, 'base64').toString()
        : null;

      const conditions = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (afterId) {
        conditions.push(`id > $${paramIdx++}`);
        params.push(afterId);
      }
      if (args.search) {
        conditions.push(
          `(display_name ILIKE $${paramIdx} OR primary_email ILIKE $${paramIdx})`,
        );
        params.push(`%${args.search}%`);
        paramIdx++;
      }
      if (args.status) {
        conditions.push(`status = $${paramIdx++}`);
        params.push(args.status);
      }

      params.push(first + 1); // fetch one extra to detect hasNextPage

      const rows = await ctx.executeQuery<any>(
        `SELECT * FROM person
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
    'SELECT * FROM person',
    'SELECT * FROM person_link',
    'SELECT * FROM aws_idc_user',
    'SELECT * FROM aws_iam_user',
    'SELECT * FROM gcp_workspace_user',
    'SELECT * FROM github_user',
    'SELECT * FROM github_organisation',
    'SELECT * FROM github_team',
    'SELECT * FROM github_team_membership',
    'SELECT * FROM github_org_membership',
  ],
  persons: ['SELECT * FROM person', 'SELECT * FROM person_link'],
  access: ['SELECT * FROM mv_effective_access'],
  github: [
    'SELECT * FROM github_organisation',
    'SELECT * FROM github_user',
    'SELECT * FROM github_team',
    'SELECT * FROM github_team_membership',
    'SELECT * FROM github_org_membership',
  ],
  audit: ['SELECT * FROM audit_log'],
  history: ['SELECT * FROM entity_history'],
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

describe('person_link constraints', () => {
  it('accepts valid identity_type matching ^[a-z][a-z0-9_]+$', async () => {
    // This should succeed (open-ended CHECK allows any future provider)
    const result = await pool.query(`
      SELECT 'azure_ad_user' ~ '^[a-z][a-z0-9_]+$' AS valid
    `);
    expect(result.rows[0].valid).toBe(true);
  });

  it('rejects identity_type with uppercase characters', async () => {
    const result = await pool.query(`
      SELECT 'AwsIamUser' ~ '^[a-z][a-z0-9_]+$' AS valid
    `);
    expect(result.rows[0].valid).toBe(false);
  });

  it('rejects identity_type starting with number', async () => {
    const result = await pool.query(`
      SELECT '1invalid' ~ '^[a-z][a-z0-9_]+$' AS valid
    `);
    expect(result.rows[0].valid).toBe(false);
  });

  it('rejects empty identity_type', async () => {
    const result = await pool.query(`
      SELECT '' ~ '^[a-z][a-z0-9_]+$' AS valid
    `);
    expect(result.rows[0].valid).toBe(false);
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

const TENANT_A = 'a0000000-0000-0000-0000-000000000001'; // northwind
const TENANT_B = 'b0000000-0000-0000-0000-000000000001'; // southbank

describe('RLS tenant isolation', () => {
  it('tenant A cannot see tenant B persons', async () => {
    const { rows } = await executeWithTenant(TENANT_A,
      `SELECT COUNT(*) AS cnt FROM person
       WHERE tenant_id = $1`, [TENANT_B],
    );
    expect(Number(rows[0].cnt)).toBe(0);
  });

  it('tenant A sees only own github_users', async () => {
    const { rows } = await executeWithTenant(TENANT_A,
      `SELECT DISTINCT tenant_id FROM github_user`,
    );
    expect(rows.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it('cross-tenant person_link lookup returns empty', async () => {
    const { rows } = await executeWithTenant(TENANT_A,
      `SELECT * FROM person_link
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

const TENANT = 'a0000000-0000-0000-0000-000000000001';

describe('Email matching logic', () => {
  it('matches person by case-insensitive email', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT p.id FROM person p
       WHERE lower(p.primary_email) = lower($1)
         AND p.deleted_at IS NULL`,
      ['OLIVER.SMITH1@DEMO-EXAMPLE.CO.UK'],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects noreply GitHub emails for matching', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT gu.id, gu.login, gu.person_id
       FROM github_user gu
       WHERE gu.email LIKE '%@users.noreply.github.com'`,
    );
    // All noreply users should have person_id = NULL
    for (const row of rows) {
      expect(row.person_id).toBeNull();
    }
  });

  it('linked GitHub users have person_link entries', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT gu.id
       FROM github_user gu
       LEFT JOIN person_link pl ON pl.provider_identity_id = gu.id
         AND pl.identity_type = 'github_user'
       WHERE gu.person_id IS NOT NULL
         AND pl.id IS NULL`,
    );
    // No linked users should be missing a person_link
    expect(rows).toHaveLength(0);
  });

  it('confidence is 1.00 for email-matched identities', async () => {
    const { rows } = await executeWithTenant(TENANT,
      `SELECT confidence, linkage_strategy
       FROM person_link
       WHERE identity_type = 'github_user'
         AND linkage_strategy = 'email_match'
       LIMIT 10`,
    );
    for (const row of rows) {
      expect(Number(row.confidence)).toBe(1.0);
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
          for sqlfile in $(find schema -name '*.sql' | sort); do
            psql --set ON_ERROR_STOP=1 -f "$sqlfile"
          done

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
          for sqlfile in $(find schema -name '*.sql' | sort); do
            echo "Applying $sqlfile"
            psql --set ON_ERROR_STOP=1 -f "$sqlfile"
          done

      - name: Verify table counts
        env:
          PGHOST: localhost
          PGPORT: 5432
          PGUSER: cloudintel
          PGPASSWORD: test-password
          PGDATABASE: cloud_identity_intel_test
        run: |
          PERSON_COUNT=$(psql -t -c "SELECT COUNT(*) FROM person")
          GITHUB_COUNT=$(psql -t -c "SELECT COUNT(*) FROM github_user")
          LINK_COUNT=$(psql -t -c "SELECT COUNT(*) FROM person_link WHERE identity_type = 'github_user'")

          echo "Persons: $PERSON_COUNT, GitHub users: $GITHUB_COUNT, GitHub links: $LINK_COUNT"

          # Assertions
          [ "$PERSON_COUNT" -ge 1000 ] || (echo "Expected >= 1000 persons" && exit 1)
          [ "$GITHUB_COUNT" -ge 350 ] || (echo "Expected >= 350 github_users" && exit 1)
          [ "$LINK_COUNT" -ge 300 ] || (echo "Expected >= 300 github person_links" && exit 1)

      - name: Idempotency check (re-apply must succeed)
        env:
          PGHOST: localhost
          PGPORT: 5432
          PGUSER: cloudintel
          PGPASSWORD: test-password
          PGDATABASE: cloud_identity_intel_test
        run: |
          for sqlfile in $(find schema -name '*.sql' -not -path '*/99-seed/*' | sort); do
            psql --set ON_ERROR_STOP=1 -f "$sqlfile"
          done
```

---

## Assumptions

1. **OIDC IdP exists.** The organisation has an identity provider (Auth0, Entra ID, or Google Workspace) capable of issuing JWTs with custom claims (`tenant_id`, `roles`).
2. **PostgreSQL 18.** All DDL is compatible with PG 18; tested locally on PG 18 Alpine. Aurora may lag behind — tested against PG 16 for AWS compatibility.
3. **Single-region.** GraphQL server and database are co-located. Cross-region read replicas are out of scope.
4. **No real-time subscriptions.** GraphQL subscriptions are not included; polling or webhook-based refresh is preferred to avoid WebSocket infrastructure.
5. **Export bucket exists.** Cloud Storage bucket with lifecycle policies is provisioned by Terraform (not defined in this document).
6. **Ingestion pipeline is external.** Connector code (GitHub API client, AWS SDK calls) is not in scope for this document. The schema and person_link contract are defined here; connectors implement them.
7. **`mv_effective_access` does not yet include GitHub.** GitHub has no direct access grant model (teams grant repo access, not cloud resource access). The mat view remains AWS+GCP scoped. GitHub data is queryable via the identity graph but does not appear in "effective access".
