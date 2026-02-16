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
    ├── GitHub (orgs, users, teams, repos, permissions)
    └── Canonical identity layer (cross-provider linkage)
```

### Key capabilities

- **NL2SQL** -- Ask questions in plain English; get validated, tenant-isolated SQL
- **Multi-cloud identity** -- AWS Identity Center, Google Workspace, GitHub Orgs/Users/Teams
- **Person graph** -- Cross-provider identity linkage via email matching
- **Access Explorer** -- Cross-provider effective access view combining GitHub (direct + team-derived), Google Workspace group memberships, and AWS Identity Center group memberships
- **Defence-in-depth** -- 7-layer SQL validation (libpg-query WASM AST parser), tenant-scoped queries, composite PK multi-tenancy
- **LLM-agnostic** -- Swap between Anthropic Claude, OpenAI GPT, or Google Gemini via env var
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

Open [http://localhost:3000](http://localhost:3000) and try a question like *"Show all GitHub org admins"* or *"Who has access to the production AWS account?"*.

> **Detailed setup guide**: See [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) for step-by-step instructions, schema application order, troubleshooting, and database reset procedures.

### Run tests

```bash
cd app
npm test        # 32 tests (28 SQL validator + 4 chat route)
npm run lint    # ESLint 9 with eslint-config-next
```

## Project Structure

```
ALXnderia/
  app/              Next.js 15 application (App Router, API routes, NL2SQL agent)
  schema/           SQL files: DDL, seed data, and mock data
  infra/            Terraform modules for local Docker, AWS, and GCP deployments
  docs/             Architecture and operations documentation
  .github/          5 GitHub Actions CI/CD workflows
```

### Schema overview

| File | Contents |
|------|----------|
| `schema/01_schema.sql` | Extensions (`uuid-ossp`), all table DDL, indexes, enums (`provider_type_enum`) |
| `schema/02_seed_and_queries.sql` | Seed data for demo tenant `11111111-...`, example queries |
| `schema/99-seed/010_mock_data.sql` | Extended mock dataset (~700 users, ~10K rows across all providers) |

| Provider | Tables |
|----------|--------|
| **Google Workspace** | `google_workspace_users`, `google_workspace_groups`, `google_workspace_memberships` |
| **AWS Identity Center** | `aws_identity_center_users`, `aws_identity_center_groups`, `aws_identity_center_memberships` |
| **GitHub** | `github_organisations`, `github_users`, `github_teams`, `github_org_memberships`, `github_team_memberships`, `github_repositories`, `github_repo_team_permissions`, `github_repo_collaborator_permissions` |
| **Canonical Identity** | `canonical_users`, `canonical_emails`, `canonical_user_provider_links`, `identity_reconciliation_queue` |

All tables use composite primary keys `(id, tenant_id)` for partition-friendly multi-tenancy.

## Security

- **SQL Validation** -- 7-layer pipeline: comment stripping, keyword blocklist, AST parsing (libpg-query WASM), SELECT-only enforcement, table allowlisting, function blocklisting, automatic LIMIT injection
- **Tenant Isolation** -- All tables use composite PK `(id, tenant_id)`; app sets `SET LOCAL app.current_tenant_id` per transaction (RLS-ready)
- **Audit Logging** -- All queries logged with metadata (question, SQL, row count, timing, status); database-backed audit planned
- **Identity Reconciliation** -- Unresolved cross-provider matches queued in `identity_reconciliation_queue` for review

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

App Runner + Aurora Serverless v2 (0.5--16 ACU) in a custom VPC with private subnets. ECR for images, Secrets Manager for credentials.

```bash
./infra/scripts/build-and-push-aws.sh
cd infra/deploy/aws && terraform apply
```

### GCP

Cloud Run v2 + Cloud SQL (PostgreSQL 18, regional HA) with private IP. Artifact Registry for images, Secret Manager for credentials.

```bash
./infra/scripts/build-and-push-gcp.sh
cd infra/deploy/gcp && terraform apply
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
| [Local Setup](docs/LOCAL_SETUP.md) | Complete local setup guide (native PG + Docker options, troubleshooting, reset procedures) |
| [Performance Metrics](docs/performance-metrics.md) | Query benchmarks and index analysis |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| LLM | Anthropic Claude / OpenAI GPT / Google Gemini (configurable) |
| SQL Validation | libpg-query (PostgreSQL parser compiled to WASM) |
| Database | PostgreSQL 16 (Aurora) / 18 (Cloud SQL) |
| Infrastructure | Terraform, Docker |
| Compute | AWS App Runner / GCP Cloud Run v2 |
| CI/CD | GitHub Actions (5 workflows) |
| Testing | Vitest 3.0 (32 tests) |
| Linting | ESLint 9 with eslint-config-next |

## License

Private -- All rights reserved.
