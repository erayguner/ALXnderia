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

Alxderia enables security teams, compliance officers, and identity administrators to query cloud access data across **AWS**, **GCP**, and **GitHub** using plain English. It translates natural-language questions into validated SQL, executes them against a consolidated identity data store, and returns enriched narrative results.

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
    ├── AWS identities (IAM, IDC, accounts)
    ├── GCP identities (Workspace, IAM bindings)
    ├── GitHub identities (orgs, users, teams)
    └── Cross-provider person graph
```

### Key capabilities

- **NL2SQL** -- Ask questions in plain English; get validated, tenant-isolated SQL
- **Multi-cloud identity** -- AWS IAM/IDC, GCP Workspace/IAM, GitHub Orgs/Users/Teams
- **Person graph** -- Cross-provider identity linkage via email matching
- **Defence-in-depth** -- 7-layer SQL validation (libpg-query WASM AST parser), RLS tenant isolation, PII redaction views
- **LLM-agnostic** -- Swap between Anthropic Claude, OpenAI GPT, or Google Gemini via env var
- **Dual-cloud deploy** -- AWS (App Runner + Aurora Serverless v2) and GCP (Cloud Run + Cloud SQL)

## Quick Start

### Prerequisites

| Tool          | Version |
|---------------|---------|
| Node.js       | 22+     |
| Docker        | 24+     |
| Terraform     | 1.14+   |

### 1. Start the database

```bash
cd infra
terraform init
terraform apply -auto-approve
```

This provisions a PostgreSQL 16 container, applies all 39 SQL migration files, and seeds mock data for AWS, GCP, and GitHub providers.

### 2. Configure environment

```bash
cp app/.env.example app/.env.local
# Edit app/.env.local with your LLM API key
```

```env
PG_HOST=localhost
PG_PORT=5432
PG_USER=cloudintel
PG_PASSWORD=localdev-change-me
PG_DATABASE=cloud_identity_intel
LLM_PROVIDER=anthropic          # or openai, gemini
LLM_API_KEY=sk-ant-your-key
```

### 3. Run the application

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and try a question like *"Show all GitHub org admins"* or *"Who has access to the production AWS account?"*.

### 4. Run tests

```bash
cd app
npm test        # 32 tests (28 SQL validator + 4 chat route)
npm run lint    # ESLint 9 with eslint-config-next
```

## Project Structure

```
alxderia/
  app/              Next.js 15 application (App Router, API routes, NL2SQL agent)
  schema/           39 SQL migration files across 12 directories (00-extensions .. 11-github, 99-seed)
  infra/            Terraform modules for local Docker, AWS, and GCP deployments
  docs/             Architecture and operations documentation
  .github/          5 GitHub Actions CI/CD workflows
```

### Schema overview

| Directory | Tables |
|-----------|--------|
| `01-reference` | `cloud_provider`, `tenant` |
| `02-aws` | `aws_account`, `aws_iam_user`, `aws_idc_user`, `aws_idc_group`, `aws_idc_group_membership`, `aws_idc_permission_set`, `aws_idc_account_assignment` |
| `03-gcp` | `gcp_project`, `gcp_workspace_user`, `gcp_workspace_group`, `gcp_workspace_group_membership`, `gcp_iam_binding` |
| `04-identity` | `person`, `person_link` |
| `05-access` | `mv_effective_access` (materialised view) |
| `06-history` | `entity_history` (hash-chained, monthly partitioned) |
| `09-audit` | `audit_log` (quarterly partitioned) |
| `10-dlp` | PII redaction views, retention policies |
| `11-github` | `github_organisation`, `github_user`, `github_team`, `github_team_membership`, `github_org_membership` |

### Database roles

| Role | Access |
|------|--------|
| `admin` | Schema management (DDL) |
| `ingest` | Data loading (INSERT/UPDATE) |
| `analyst` | Full read with PII |
| `readonly` | Redacted views only |
| `audit` | Audit log access |
| `app` | Application runtime queries |

## Security

- **SQL Validation** -- 7-layer pipeline: comment stripping, keyword blocklist, AST parsing (libpg-query WASM), SELECT-only enforcement, table allowlisting, function blocklisting, automatic LIMIT injection
- **Row-Level Security** -- All tenant-scoped tables enforce RLS via `SET LOCAL app.current_tenant_id`
- **PII Redaction** -- 5 redacted views (`v_person_redacted`, `v_aws_idc_user_redacted`, `v_gcp_workspace_user_redacted`, `v_effective_access_redacted`, `v_github_user_redacted`)
- **Audit Trail** -- Append-only `audit_log` (quarterly partitioned) and hash-chained `entity_history` (monthly partitioned)

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
| [Local Setup](docs/LOCAL_SETUP.md) | Quick-start guide |
| [Performance Metrics](docs/performance-metrics.md) | Query benchmarks and index analysis |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript |
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
