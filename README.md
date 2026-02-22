# ALXnderia

**Cloud Identity Intelligence -- Natural Language to SQL**

[![CI](https://github.com/erayguner/ALXnderia/actions/workflows/ci.yml/badge.svg)](https://github.com/erayguner/ALXnderia/actions/workflows/ci.yml)
[![CodeQL](https://github.com/erayguner/ALXnderia/actions/workflows/codeql.yml/badge.svg)](https://github.com/erayguner/ALXnderia/actions/workflows/codeql.yml)
[![Checkov](https://github.com/erayguner/ALXnderia/actions/workflows/checkov.yml/badge.svg)](https://github.com/erayguner/ALXnderia/actions/workflows/checkov.yml)
[![Security Audit](https://github.com/erayguner/ALXnderia/actions/workflows/security-audit.yml/badge.svg)](https://github.com/erayguner/ALXnderia/actions/workflows/security-audit.yml)
[![Bundle Analysis](https://github.com/erayguner/ALXnderia/actions/workflows/nextjs-bundle.yml/badge.svg)](https://github.com/erayguner/ALXnderia/actions/workflows/nextjs-bundle.yml)

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%2F18-4169E1?logo=postgresql)
![Terraform](https://img.shields.io/badge/Terraform-IaC-7B42BC?logo=terraform)
![License](https://img.shields.io/badge/License-Private-red)

---

ALXnderia enables security teams, compliance officers, and identity administrators to query cloud access data across **AWS Identity Center**, **Google Workspace**, and **GitHub** using plain English. It translates natural-language questions into validated SQL, executes them against a consolidated identity data store, and returns enriched narrative results.

## Architecture

```
  User (Browser)
       |
   Next.js App (App Router)
       |
  NL2SQL Agent ──> LLM API (Anthropic / OpenAI / Gemini)
       |
  SQL Validator (7-layer defence-in-depth)
       |
  PostgreSQL (Aurora / Cloud SQL)
    ├── Google Workspace (users, groups, memberships)
    ├── AWS Identity Center (users, groups, memberships)
    ├── AWS Accounts & account assignments (IAM IDC → account mapping)
    ├── GCP Organisations & Projects (IAM bindings)
    ├── GitHub (orgs, users, teams, repos, permissions)
    ├── Canonical identity layer (cross-provider linkage)
    └── Resource access grants (normalised cross-provider permissions matrix)
       ▲
       |  (upsert via ON CONFLICT DO UPDATE)
  Ingestion Service (Python)
    ├── GCP providers ──> Cloud Run Jobs (Workload Identity)
    │   ├── Google Workspace (Admin SDK)
    │   ├── GCP Resource Manager (CRM v3)
    │   └── GitHub (REST API, token from Secret Manager)
    ├── AWS providers ──> Lambda (IAM roles)
    │   ├── AWS Identity Center (identitystore + sso-admin)
    │   └── AWS Organizations (organizations API)
    ├── Post-processing
    │   ├── Identity resolver (cross-provider email matching)
    │   └── Grants backfill (resource_access_grants rebuild)
    └── Scheduling: Cloud Scheduler (GCP) / EventBridge (AWS)
```

### Key capabilities

- **NL2SQL** -- Ask questions in plain English; get validated, tenant-isolated SQL
- **Multi-cloud identity** -- AWS Identity Center, Google Workspace, GitHub Orgs/Users/Teams
- **Cloud resource inventory** -- AWS accounts (12-digit IDs, org structure) and GCP projects (project IDs, folders, labels)
- **Person graph** -- Cross-provider identity linkage via email matching
- **Access Explorer** -- Cross-provider effective access view combining GitHub (direct + team-derived), Google Workspace group memberships, and AWS Identity Center group memberships
- **Accounts browser** -- Unified AWS account and GCP project view with assignment/binding counts
- **Defence-in-depth** -- 7-layer SQL validation (libpg-query WASM AST parser), tenant-scoped queries, composite PK multi-tenancy
- **LLM-agnostic** -- Swap between Anthropic Claude, OpenAI GPT, or Google Gemini via env var
- **Live ingestion** -- Modular Python service syncs live data from all 5 providers with pagination, rate limiting, and run tracking
- **Dual-cloud deploy** -- AWS (App Runner + Aurora Serverless v2) and GCP (Cloud Run + Cloud SQL)

## Quick Start

### Prerequisites

| Tool          | Version | Required for |
|---------------|---------|-------------|
| Node.js       | 22+     | Always |
| npm           | 10+     | Always |
| PostgreSQL    | 14+     | Native setup (Option A) |
| Docker        | 24+     | Docker setup (Option B) |
| Terraform     | 1.14+   | Docker setup (Option B) |

You also need **one** LLM API key: Anthropic (`ANTHROPIC_API_KEY`), OpenAI (`OPENAI_API_KEY`), or Google Gemini (`GOOGLE_API_KEY`).

### Option A: Native PostgreSQL (macOS / Linux)

```bash
# 1. Create roles and database
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel WITH LOGIN PASSWORD 'localdev-change-me' CREATEDB;"
psql -U $(whoami) -d postgres -c "CREATE DATABASE cloud_identity_intel OWNER cloudintel;"

# 2. Apply schema and seed data (see docs/LOCAL_SETUP.md for full commands)

# 3. Configure and run the app
cd app
cp .env.example .env.local   # then set your LLM_API_KEY
npm install && npm run dev
```

### Option B: Docker + Terraform

```bash
cd infra
terraform init && terraform apply -auto-approve
cd ../app
cp .env.example .env.local   # then set your LLM_API_KEY
npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and try a question like *"Show all GitHub org admins"*, *"Who has access to the production AWS account?"*, or *"List all GCP projects with editor bindings"*.

> **Detailed setup guide**: See [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) for step-by-step instructions, schema application order, troubleshooting, and database reset procedures.

### Run tests

```bash
cd app
npm test        # 14 test suites
npm run lint    # ESLint 9 with eslint-config-next
```

## Project Structure

```
ALXnderia/
  app/              Next.js 15 application (App Router, API routes, NL2SQL agent)
  schema/           SQL files: DDL, cloud resources extension, ingestion tracking, seed data
  infra/            Terraform modules for local Docker, AWS, and GCP deployments (incl. ingestion)
  scripts/          Utility scripts (preflight, seed_cloud_resources.py, ingestion service)
  docs/             Architecture and operations documentation
  .github/          5 GitHub Actions CI/CD workflows
```

### Schema overview

| File | Contents |
|------|----------|
| `schema/01_schema.sql` | Extensions (`uuid-ossp`), identity table DDL, indexes, enums (`provider_type_enum`) |
| `schema/02_cloud_resources.sql` | AWS accounts, GCP orgs/projects, IAM bindings, `resource_access_grants` matrix |
| `schema/02_seed_and_queries.sql` | Seed data for demo tenant `11111111-...`, example queries |
| `schema/03_ingestion_runs.sql` | Ingestion run tracking table (`ingestion_runs`) |
| `schema/04_audit_log.sql` | Audit log table DDL and indexes |
| `schema/99-seed/010_mock_data.sql` | Extended identity mock dataset (~700 users, ~10K rows across all providers) |
| `schema/99-seed/020_cloud_resources_seed.sql` | Cloud resource seed data (12 AWS accounts, 15 GCP projects, ~240 assignments, ~180 IAM bindings, 800+ access grants) |
| `schema/99-seed/021_cloud_resources_validation.sql` | 10 validation queries for cloud resource data integrity |
| `scripts/seed_cloud_resources.py` | Repeatable Python seed script (`--dry-run`, `--dsn`, `-o`) |
| `scripts/ingestion/` | Modular Python ingestion service (5 providers, scheduler, CLI) |

| Provider | Tables |
|----------|--------|
| **Google Workspace** | `google_workspace_users`, `google_workspace_groups`, `google_workspace_memberships` |
| **AWS Identity Center** | `aws_identity_center_users`, `aws_identity_center_groups`, `aws_identity_center_memberships` |
| **AWS Accounts** | `aws_accounts`, `aws_account_assignments` |
| **GCP Cloud** | `gcp_organisations`, `gcp_projects`, `gcp_project_iam_bindings` |
| **GitHub** | `github_organisations`, `github_users`, `github_teams`, `github_org_memberships`, `github_team_memberships`, `github_repositories`, `github_repo_team_permissions`, `github_repo_collaborator_permissions` |
| **Canonical Identity** | `canonical_users`, `canonical_emails`, `canonical_user_provider_links`, `identity_reconciliation_queue` |
| **Cross-Provider** | `resource_access_grants` (denormalised permissions matrix) |
| **Ingestion Tracking** | `ingestion_runs` (execution history, status, record counts) |
| **Audit** | `audit_log` (query audit trail with tenant/user/timing metadata) |

All tables use composite primary keys `(id, tenant_id)` for partition-friendly multi-tenancy. **26 tables** across 9 domains.

## Security

- **SQL Validation** -- 7-layer pipeline: comment stripping, keyword blocklist, AST parsing (libpg-query WASM), SELECT-only enforcement, table allowlisting, function blocklisting, automatic LIMIT injection
- **Tenant Isolation** -- All tables use composite PK `(id, tenant_id)`; app sets `SET LOCAL app.current_tenant_id` per transaction (RLS-ready)
- **Audit Logging** -- All queries logged to `audit_log` table with metadata (question, SQL, row count, timing, status); falls back to console on DB failure
- **Identity Reconciliation** -- Unresolved cross-provider matches queued in `identity_reconciliation_queue` for review
- **Denormalised Access Matrix** -- `resource_access_grants` provides pre-computed, group-expanded cross-provider access with canonical user resolution

## CI/CD Pipelines

| Workflow | Purpose |
|----------|---------|
| **CI** | Lint, type-check, test (Vitest), build, schema validation (PG 16 service container) |
| **CodeQL** | SAST with `security-extended` + `security-and-quality` queries |
| **Checkov** | Terraform IaC scan, secrets scan, GitHub Actions config scan |
| **Security Audit** | npm audit, SQL injection pattern scanner, TruffleHog, license compliance |
| **Bundle Analysis** | Next.js build analysis with size limits |

## Cloud Deployment

### AWS

App Runner + Aurora Serverless v2 (0.5--16 ACU) in a custom VPC with private subnets. ECR (immutable tags, scan-on-push) for images, Secrets Manager for credentials. Ingestion runs as Lambda functions (Identity Center + Organizations) with X-Ray tracing, SQS dead-letter queues, and EventBridge scheduling.

```bash
./infra/scripts/build-and-push.sh --platform aws --target app
./infra/scripts/build-and-push.sh --platform aws --target ingestion
cd infra/deploy/aws && terraform apply
```

### GCP

Cloud Run v2 + Cloud SQL (PostgreSQL 18, regional HA) with private IP, SSL required, pgAudit enabled, VPC flow logs. Artifact Registry for images, Secret Manager for credentials. Ingestion runs as Cloud Run Jobs (Google Workspace + GCP CRM + GitHub) triggered by Cloud Scheduler.

```bash
./infra/scripts/build-and-push.sh --platform gcp --target app
./infra/scripts/build-and-push.sh --platform gcp --target ingestion
cd infra/deploy/gcp && terraform apply
```

### Environment Configs

Per-environment Terraform variable files are provided in `infra/environments/`:

| File | Scheduler | Log Level | Batch Size |
|------|-----------|-----------|------------|
| `dev.tfvars` | Disabled | DEBUG | 100 |
| `stage.tfvars` | Enabled | INFO | 500 |
| `prod.tfvars` | Enabled | INFO | 500 |

```bash
cd infra/deploy/gcp && terraform apply -var-file=../../environments/prod.tfvars
```

## Documentation

| Document | Description |
|----------|-------------|
| [Executive Overview](docs/01_Executive_Overview.md) | Business context and capabilities |
| [High-Level Architecture](docs/02_High_Level_Architecture.md) | Components, data flows, security boundaries |
| [Low-Level Design](docs/03_Low_Level_Design.md) | Schema DDL, validation logic, API contracts |
| [Engineering Implementation](docs/04_Engineering_Implementation.md) | Setup, conventions, common tasks |
| [SRE Operations Guide](docs/05_SRE_Operations_Guide.md) | Deployment, monitoring, runbooks |
| [GitHub Identity Integration](docs/06_GitHub_Identity_Integration.md) | GitHub provider design and mapping |
| [Target Architecture](docs/07_Target_Architecture_GraphQL_DLP.md) | GraphQL API and Export/DLP roadmap |
| [Database Schema](docs/08_Database_Schema.md) | Complete schema reference (26 tables, indexes, constraints) |
| [Local Setup](docs/LOCAL_SETUP.md) | Complete local setup guide (native PG + Docker options, troubleshooting, reset procedures) |
| [Performance Metrics](docs/performance-metrics.md) | Query benchmarks and index analysis |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| LLM | Anthropic Claude / OpenAI GPT / Google Gemini (configurable) |
| SQL Validation | libpg-query (PostgreSQL parser compiled to WASM) |
| Database | PostgreSQL 16 (Aurora) / 18 (Cloud SQL) |
| Ingestion | Python 3.12, psycopg2, boto3, google-api-python-client, APScheduler |
| Infrastructure | Terraform, Docker |
| Compute | AWS App Runner / GCP Cloud Run v2, Lambda (ingestion), Cloud Run Jobs (ingestion) |
| CI/CD | GitHub Actions (5 workflows) |
| Testing | Vitest 4.x (14 test suites) |
| Linting | ESLint 9 with eslint-config-next |

## License

Private -- All rights reserved.
