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
| **AccessExplorer** | Provides a paginated browser for effective access records across AWS and GCP. |
| **ResultsTable** | Renders dynamic data grids returned by SQL queries. |
| **Sidebar** | Application-level navigation and context switching. |
| **API Routes** | Four HTTP endpoints: `/api/chat` (NL2SQL), `/api/access` (paginated access), `/api/people` (people browser), `/api/health` (readiness probe). |

### 2.2 AI / NL2SQL Pipeline

The **NL2SQL Agent** is the core server-side module responsible for translating natural language into safe, executable SQL. It constructs a system prompt that includes live schema metadata, column synonyms, and few-shot examples, then delegates SQL generation to the configured LLM provider (selected via the `LLM_PROVIDER` environment variable; options include Anthropic Claude, OpenAI GPT, and Google Gemini). The agent receives a structured JSON response containing a query plan, SQL statement, human-readable explanation, and follow-up suggestions.

The **SQL Validator** enforces a seven-layer defence-in-depth pipeline before any generated SQL reaches the database: comment stripping, keyword blocklist, AST parsing via libpg-query WASM, statement-type enforcement (SELECT only), table allowlisting, function blocklisting, and automatic LIMIT injection.

### 2.3 Database Layer

**PostgreSQL** (version 16 on Aurora, version 18 on Cloud SQL) stores all identity, access, and compliance data.

| Element | Responsibility |
|---------|---------------|
| **Core tables** (tenant, person, person_link, aws_*, gcp_*, github_*) | Normalised storage of multi-cloud identity and access records. |
| **mv_effective_access** | Materialised view that unions direct and group-derived access across AWS and GCP into a single queryable surface. |
| **entity_history** | Append-only, hash-chained, monthly-partitioned table recording all entity state changes. |
| **audit_log** | Quarterly-partitioned, integrity-hashed compliance log. |
| **PII redaction views** | Filtered views (v_person_redacted, v_aws_idc_user_redacted, v_gcp_workspace_user_redacted, v_effective_access_redacted, v_github_user_redacted) that mask personally identifiable information. |
| **DLP subsystem** | Retention policies, legal hold support, and PII redaction functions. |

The schema is organised into 39 SQL migration files across 12 numbered directories (`00-extensions` through `11-github`, plus `99-seed`), with six database roles (admin, ingest, analyst, readonly, audit, app) providing principle-of-least-privilege access.

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

External identity data (AWS IAM users, AWS IDC users/groups/permission sets, GCP IAM bindings, GCP Workspace users/groups, GitHub organisations/users/teams/memberships) is loaded into core tables via the `ingest` database role. After ingestion, the `mv_effective_access` materialised view is refreshed to reflect current state. Each mutation is captured in `entity_history`.

### 3.3 Schema Migration Flow

The `migrate-schema.sh` script applies SQL files from the numbered directories in order. Migrations run under the `admin` role. State backends track which migrations have been applied to each environment.

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

### 7.3 Row-Level Security

All tenant-scoped tables enforce row-level security (RLS) policies keyed on the `app.current_tenant_id` session variable. Every query executes within a transaction that sets this variable via `SET LOCAL`, ensuring strict tenant isolation at the database layer.

### 7.4 Database Role Separation

Six roles enforce principle-of-least-privilege access: `admin` (schema management), `ingest` (data loading), `analyst` (read with full PII), `readonly` (restricted read), `audit` (compliance log access), and `app` (application runtime queries).

### 7.5 PII Redaction and DLP

Redacted views (`v_person_redacted`, `v_aws_idc_user_redacted`, `v_gcp_workspace_user_redacted`, `v_effective_access_redacted`, `v_github_user_redacted`) mask personally identifiable fields for roles that do not require full access. The DLP subsystem provides retention policies, legal hold capabilities, and PII redaction functions.

### 7.6 Audit and Integrity

The `audit_log` table is quarterly-partitioned and integrity-hashed, providing a tamper-evident compliance trail. The `entity_history` table is append-only with hash chaining and monthly partitioning, recording all state changes with cryptographic linkage.

---

## 8. Assumptions

1. **Single-region deployments.** Each cloud environment (AWS, GCP) is assumed to operate within a single region. Multi-region replication is not currently addressed.
2. **Trusted ingestion sources.** Data loaded via the `ingest` role is assumed to originate from authenticated and authorised cloud identity providers.
3. **LLM API availability.** The NL2SQL pipeline depends on the configured LLM provider API (Anthropic Claude, OpenAI GPT, or Google Gemini). Degraded availability of the selected external service will directly affect query capabilities.
4. **Schema stability.** The SQL Validator's table allowlist and the NL2SQL Agent's schema metadata are assumed to be kept in sync with the deployed database schema.
5. **Tenant isolation via session variable.** The security model assumes that the application layer correctly sets `app.current_tenant_id` for every database transaction. No bypass path should exist outside the `executeWithTenant()` function.
6. **Materialised view freshness.** `mv_effective_access` is refreshed after ingestion. Between refresh cycles, query results may reflect stale access state.
7. **Container image immutability.** Deployed images in ECR and Artifact Registry are treated as immutable artefacts. Rollback is achieved by redeploying a prior image tag.
8. **Secret rotation.** Credentials stored in AWS Secrets Manager and GCP Secret Manager are assumed to be rotated according to organisational policy; the application retrieves secrets at startup or on rotation events.
