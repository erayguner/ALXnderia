# 02 -- High-Level Architecture: Alxderia Cloud Identity Intelligence

## Table of Contents

1. [System Context](#1-system-context)
2. [Major Components and Responsibilities](#2-major-components-and-responsibilities)
3. [Data Flows](#3-data-flows)
4. [Integration Points](#4-integration-points)
5. [Technology Stack](#5-technology-stack)
6. [Deployment Environments](#6-deployment-environments)
7. [Security Boundaries](#7-security-boundaries)
8. [Assumptions](#8-assumptions)

---

## 1. System Context

Alxderia is a Natural Language to SQL (NL2SQL) Cloud Identity Intelligence platform. It enables security teams, compliance officers, and identity administrators to query cloud access data across AWS, GCP, and GitHub estates using plain English, without requiring direct SQL knowledge.

The system occupies the following position within the broader organisational landscape:

```
                        +-------------------+
                        |   End Users       |
                        | (Security, IAM,   |
                        |  Compliance)      |
                        +---------+---------+
                                  |
                          HTTPS / Browser
                                  |
                        +---------v---------+
                        |   Alxderia        |
                        |   (Next.js App)   |
                        +---------+---------+
                           |             |
               LLM API     |             |  PostgreSQL
  (Anthropic / OpenAI /   |             |  (Aurora / Cloud SQL)
         Google)          |             |
                           v             v
                   +----------+   +-----------+
                   |Configur- |   | Identity  |
                   |able LLM  |   | Data      |
                   +----------+   | Store     |
                                  +-----------+
                                       ^
                                       |
                              Ingestion pipelines
                              (AWS IAM, AWS IDC,
                               GCP IAM, Workspace,
                               GitHub Orgs/Users/Teams)
```

End users interact with the platform through a browser-based chat interface. Alxderia translates their natural-language questions into validated SQL, executes queries against a consolidated identity data store, and returns enriched narrative results. The platform connects outward to a configurable LLM API (Anthropic Claude, OpenAI GPT, or Google Gemini) for language understanding and SQL generation, and inward to PostgreSQL for persistent storage of identity, access, and audit data. GitHub identity data (organisations, users, teams, memberships) is fully integrated into the person-centric model.

---

## 2. Major Components and Responsibilities

### 2.1 Application Layer

The front-end and API surface are served by a **Next.js 15** application using the App Router pattern with React 19 and TypeScript.

| Component | Responsibility |
|-----------|---------------|
| **ChatInterface** | Presents the NL2SQL conversational interface; sends user questions and renders structured responses. |
| **AccessExplorer** | Cross-provider effective access browser with provider and access-path filters across GitHub, Google Workspace, and AWS Identity Center. Includes CSV export. |
| **GroupsList** | Paginated group browser across all three providers with provider filter and search. Groups link to detail pages. |
| **PeopleList** | Paginated canonical user browser with search. People link to detail pages showing cross-provider identities. |
| **PersonDetail** | Person detail view showing accounts/access, linked identities, and canonical emails across all providers. |
| **AuditLog** | Paginated audit log viewer with action type filter. |
| **ResourcesList** | Resource browser (GitHub repos, Google Workspace groups, AWS IDC groups) with provider filter and search. |
| **ResultsTable** | Generic data grid with dynamic column inference, client-side sorting, provider badge colouring, and clickable row support via `getRowLink`. |
| **Sidebar** | Six-item navigation sidebar: Chat, People, Resources, Groups, Access Explorer, Audit Log. |
| **UserBadge** | User avatar and identity badge displayed in the header. |
| **API Routes** | Nine HTTP endpoints: `/api/chat` (NL2SQL), `/api/access` (cross-provider access), `/api/people` (people list), `/api/people/[id]` (person detail), `/api/groups` (groups list), `/api/groups/[id]` (group detail), `/api/resources` (resources list), `/api/audit` (audit log), `/api/health` (readiness probe). |

### 2.2 AI / NL2SQL Pipeline

The **NL2SQL Agent** is the core server-side module responsible for translating natural language into safe, executable SQL. It constructs a system prompt that includes live schema metadata, column synonyms, and few-shot examples, then delegates SQL generation to the configured LLM provider (selected via the `LLM_PROVIDER` environment variable; options include Anthropic Claude, OpenAI GPT, and Google Gemini). The agent receives a structured JSON response containing a query plan, SQL statement, human-readable explanation, and follow-up suggestions.

The **SQL Validator** enforces a seven-layer defence-in-depth pipeline before any generated SQL reaches the database: comment stripping, keyword blocklist, AST parsing via libpg-query WASM, statement-type enforcement (SELECT only), table allowlisting, function blocklisting, and automatic LIMIT injection.

### 2.3 Database Layer

**PostgreSQL** (version 16 on Aurora, version 18 on Cloud SQL) stores all identity, access, and compliance data.

| Element | Responsibility |
|---------|---------------|
| **Canonical identity layer** (canonical_users, canonical_emails, canonical_user_provider_links, identity_reconciliation_queue) | Unified person-centric hub linking identities across providers. |
| **Google Workspace tables** (google_workspace_users, google_workspace_groups, google_workspace_memberships) | Google Workspace identity and group data. |
| **AWS Identity Center tables** (aws_identity_center_users, aws_identity_center_groups, aws_identity_center_memberships) | AWS SSO identity and group data. |
| **GitHub tables** (github_organisations, github_users, github_teams, github_org_memberships, github_team_memberships, github_repositories, github_repo_team_permissions, github_repo_collaborator_permissions) | GitHub organisation, user, team, and repository access data. |

The schema is defined in flat SQL files: `schema/01_schema.sql` (DDL, extensions, indexes, enums), `schema/02_seed_and_queries.sql` (seed data and example queries), and `schema/99-seed/010_mock_data.sql` (extended mock dataset with ~700 users). All tables use composite primary keys `(id, tenant_id)` for partition-friendliness. A `provider_type_enum` (GOOGLE_WORKSPACE, AWS_IDENTITY_CENTER, GITHUB) classifies provider links.

### 2.4 Infrastructure Layer

Infrastructure is defined in **Terraform** with a modular structure under `infra/modules/{aws,gcp}/{networking,database,compute,registry,secrets}`. Deployment configurations reside under `infra/deploy/{aws,gcp}/` with remote state backends (S3 for AWS, GCS for GCP). Shell scripts handle container image builds and schema migrations.

---

## 3. Data Flows

### 3.1 NL2SQL Query Flow

1. The user types a natural-language question in the **ChatInterface**.
2. The client issues `POST /api/chat` with the question payload.
3. The **NL2SQL Agent** assembles a system prompt containing live schema metadata, synonyms, and few-shot examples, then calls the configured **LLM API** (Anthropic, OpenAI, or Google).
4. The LLM returns structured JSON: `queryPlan`, `SQL`, `explanation`, and `followUpSuggestions`.
5. The **SQL Validator** processes the SQL through all seven defence layers.
6. `executeWithTenant()` opens a transaction: `BEGIN` then `SET LOCAL app.current_tenant_id` then executes the validated query then `COMMIT`.
7. The **narrative generator** enriches raw results with contextual summaries (provider distribution, access path breakdown).
8. A structured `ChatResponse` is returned to the client with results, metadata, and data lineage.

### 3.2 Ingestion Flow

External identity data (Google Workspace users/groups, AWS Identity Center users/groups, GitHub organisations/users/teams/repositories/permissions) is loaded into the provider-specific tables. After ingestion, canonical identity links are updated or created in the `canonical_user_provider_links` table. Unresolved matches are queued in `identity_reconciliation_queue` for manual review.

### 3.3 Schema Migration Flow

The `migrate-schema.sh` script applies the two SQL files from `schema/` in order (`01_schema.sql` then `02_seed_and_queries.sql`). The schema uses `CREATE TABLE` and `CREATE INDEX` statements without `IF NOT EXISTS`, so the target database must be empty or the schema must be dropped first.

---

## 4. Integration Points

| Integration | Protocol | Direction | Purpose |
|-------------|----------|-----------|---------|
| **LLM Provider API** (Anthropic / OpenAI / Google Gemini) | HTTPS / REST | Outbound | NL2SQL generation; receives natural-language prompts, returns structured JSON with SQL and explanations. Provider-agnostic design with configurable backend selection via environment variables. |
| **PostgreSQL** (Aurora / Cloud SQL) | TCP / libpq | Internal | Primary data store for identity records, effective access, audit logs, and entity history. |
| **AWS Services** (VPC, Aurora, App Runner, ECR, Secrets Manager) | AWS SDK / Terraform | Internal | AWS deployment target; managed networking, database, compute, container registry, and secrets. |
| **GCP Services** (VPC, Cloud SQL, Cloud Run, Artifact Registry, Secret Manager) | GCP SDK / Terraform | Internal | GCP deployment target; equivalent managed services on Google Cloud. |
| **Docker** | Container runtime | Local | Local development database provisioned via Terraform using the kreuzwerker/docker and cyrilgdn/postgresql providers. |

---

## 5. Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Front-end framework | Next.js | 15 | Server-side rendering, App Router, API routes |
| UI library | React | 19 | Component-based user interface |
| Language | TypeScript | -- | Type-safe application code |
| LLM | Configurable (Claude, GPT-4o, Gemini 2.5 Pro) | -- | Natural language understanding, SQL generation |
| LLM abstraction | src/server/llm/ | -- | Provider-agnostic LLM interface (Anthropic, OpenAI, Google Gemini) |
| SQL validation | libpg-query WASM | -- | AST-level SQL parsing and validation |
| Database | PostgreSQL | 16 (Aurora) / 18 (Cloud SQL) | Relational data store with RLS and partitioning |
| Managed DB (AWS) | Aurora Serverless v2 | -- | Auto-scaling PostgreSQL (0.5--16 ACU) |
| Managed DB (GCP) | Cloud SQL | POSTGRES_18 | Regional HA PostgreSQL with private IP |
| Compute (AWS) | App Runner | -- | Managed container hosting (1 vCPU, 2 GB) |
| Compute (GCP) | Cloud Run v2 | -- | Serverless container hosting (2 CPU, 4 Gi, 0--10 instances) |
| Container registry (AWS) | ECR | -- | Docker image storage |
| Container registry (GCP) | Artifact Registry | -- | Docker image storage |
| Secrets (AWS) | Secrets Manager | -- | Credential storage |
| Secrets (GCP) | Secret Manager | -- | Credential storage |
| Infrastructure as Code | Terraform | -- | Declarative infrastructure provisioning |
| Local database | Docker + Terraform | -- | Containerised PostgreSQL for development |

---

## 6. Deployment Environments

### 6.1 Local Development

A Docker container running PostgreSQL is provisioned by Terraform using the `kreuzwerker/docker` and `cyrilgdn/postgresql` providers. The Next.js application runs locally via `npm run dev`. This environment is suitable for development, testing, and schema iteration without cloud dependencies.

### 6.2 AWS Production

- **Networking**: Custom VPC with two public and two private subnets, a NAT gateway, and an internet gateway.
- **Database**: Aurora Serverless v2 (PostgreSQL 16), scaling between 0.5 and 16 ACUs, deployed into private subnets.
- **Compute**: App Runner (1 vCPU, 2 GB RAM) with a VPC connector to reach the Aurora cluster.
- **Supporting services**: ECR for container images; Secrets Manager for credentials.
- **State**: Terraform remote state stored in S3.

### 6.3 GCP Production

- **Networking**: Custom VPC with a private services connection and a VPC access connector.
- **Database**: Cloud SQL (PostgreSQL 18) with regional high availability and private IP only.
- **Compute**: Cloud Run v2 (2 CPU, 4 Gi memory, 0--10 instances) connected to the VPC.
- **Supporting services**: Artifact Registry for container images; Secret Manager for credentials.
- **State**: Terraform remote state stored in GCS.

Build and deployment scripts (`build-and-push-aws.sh`, `build-and-push-gcp.sh`) handle image construction and registry upload. The `migrate-schema.sh` script applies database migrations in each target environment.

---

## 7. Security Boundaries

### 7.1 Network Boundaries

All cloud deployments place the database in private subnets with no public IP. Compute services connect to the database through VPC-internal networking (VPC connector on AWS App Runner, VPC access connector on GCP Cloud Run). External traffic reaches only the compute layer over HTTPS.

### 7.2 SQL Validation (Defence-in-Depth)

Generated SQL passes through seven sequential validation layers before execution:

1. **Comment stripping** -- removes inline and block comments.
2. **Keyword blocklist** -- rejects statements containing DDL, DML, or administrative keywords.
3. **AST parsing** -- uses libpg-query WASM to produce an abstract syntax tree; malformed SQL is rejected.
4. **Statement type enforcement** -- only `SELECT` statements are permitted.
5. **Table allowlisting** -- queries may reference only pre-approved tables and views.
6. **Function blocklisting** -- prevents invocation of dangerous or administrative functions.
7. **Automatic LIMIT injection** -- caps result set size to prevent resource exhaustion.

### 7.3 Tenant Isolation

All tables include a `tenant_id` column with composite primary keys `(id, tenant_id)`. The application sets `SET LOCAL app.current_tenant_id` in every transaction for forward-compatible tenant scoping. RLS policies are not yet defined in the schema but can be added without application changes. The NL2SQL agent's generated queries are constrained by the SQL Validator's table allowlist, providing an additional isolation layer.

### 7.4 Audit Logging

Audit entries (question, SQL executed, row count, timing, status) are logged to the console in a fire-and-forget pattern. Database-backed audit logging with partitioning and integrity hashing is planned for a future iteration. Result data is never stored — only metadata.

---

## 8. Assumptions

1. **Single-region deployments.** Each cloud environment (AWS, GCP) is assumed to operate within a single region. Multi-region replication is not currently addressed.
2. **Trusted ingestion sources.** Data loaded via the `ingest` role is assumed to originate from authenticated and authorised cloud identity providers.
3. **LLM API availability.** The NL2SQL pipeline depends on the configured LLM provider API (Anthropic Claude, OpenAI GPT, or Google Gemini). Degraded availability of the selected external service will directly affect query capabilities.
4. **Schema stability.** The SQL Validator's table allowlist and the NL2SQL Agent's schema metadata are assumed to be kept in sync with the deployed database schema.
5. **Tenant isolation via session variable.** The security model assumes that the application layer correctly sets `app.current_tenant_id` for every database transaction. No bypass path should exist outside the `executeWithTenant()` function. RLS policies are not yet defined but the session variable is set for forward compatibility.
7. **Container image immutability.** Deployed images in ECR and Artifact Registry are treated as immutable artefacts. Rollback is achieved by redeploying a prior image tag.
8. **Secret rotation.** Credentials stored in AWS Secrets Manager and GCP Secret Manager are assumed to be rotated according to organisational policy; the application retrieves secrets at startup or on rotation events.
