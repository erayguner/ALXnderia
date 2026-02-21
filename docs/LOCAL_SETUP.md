# Alxderia - Local Setup Guide

A Next.js app (NL2SQL) that lets you ask natural-language questions about cloud identity data (Google Workspace, AWS Identity Center, and GitHub). It uses an LLM to generate SQL, runs it against PostgreSQL, and returns results.

## Prerequisites

### All setups

| Tool          | Version | Check command    |
| ------------- | ------- | ---------------- |
| **Node.js**   | 22+     | `node -v`        |
| **npm**       | 10+     | `npm -v`         |

### Option A only (native PostgreSQL)

| Tool          | Version | Check command    |
| ------------- | ------- | ---------------- |
| **PostgreSQL** | 14+    | `psql --version` |

### Option B only (Docker + Terraform)

| Tool          | Version | Check command          |
| ------------- | ------- | ---------------------- |
| **Docker**    | 24+     | `docker --version`     |
| **Terraform** | 1.14+   | `terraform --version`  |

### LLM API key

You need **one** LLM API key (pick one provider):

- Anthropic: set `LLM_PROVIDER=anthropic` and `LLM_API_KEY=<your-anthropic-key>`
- OpenAI: set `LLM_PROVIDER=openai` and `LLM_API_KEY=<your-openai-key>`
- Google Gemini: set `LLM_PROVIDER=gemini` and `LLM_API_KEY=<your-google-key>`

> **Note:** Set `MOCK_MODE=true` in `.env.local` to bypass LLM calls entirely (returns mock responses). No API key required in mock mode.

> **Tip:** Run the pre-flight script first to verify everything:
> ```bash
> bash scripts/preflight.sh
> ```

---

## Option A: Native PostgreSQL (Recommended for macOS)

Use this if you have PostgreSQL installed locally (e.g. via Homebrew).

### 1. Create the database role and database

```bash
# Create the application role
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel WITH LOGIN PASSWORD 'localdev-change-me' CREATEDB;"

# Create the database
psql -U $(whoami) -d postgres -c "CREATE DATABASE cloud_identity_intel OWNER cloudintel;"
```

### 2. Apply the schema

The schema is defined in flat SQL files. Apply them in order:

```bash
cd /path/to/ALXnderia

# DDL: extensions, identity tables, indexes, enums
psql -U $(whoami) -d cloud_identity_intel -f schema/01_schema.sql

# DDL: cloud resource tables (AWS accounts, GCP projects, access grants)
psql -U $(whoami) -d cloud_identity_intel -f schema/02_cloud_resources.sql

# DDL: ingestion run tracking table
psql -U $(whoami) -d cloud_identity_intel -f schema/03_ingestion_runs.sql

# Seed data and example queries
psql -U $(whoami) -d cloud_identity_intel -f schema/02_seed_and_queries.sql
```

Load mock data (~700 users, ~10K identity rows + cloud resources):
```bash
# Identity data (users, groups, memberships, repos)
psql -U $(whoami) -d cloud_identity_intel -f schema/99-seed/010_mock_data.sql

# Cloud resources (12 AWS accounts, 15 GCP projects, ~240 assignments, ~180 IAM bindings, 800+ access grants)
psql -U $(whoami) -d cloud_identity_intel -f schema/99-seed/020_cloud_resources_seed.sql
```

Alternatively, use the Python seed script for cloud resources:
```bash
python3 scripts/seed_cloud_resources.py --dsn "postgresql://cloudintel:localdev-change-me@localhost:5432/cloud_identity_intel"
# or: python3 scripts/seed_cloud_resources.py --dry-run   # print SQL without executing
```

### 3. Grant permissions

```bash
psql -U $(whoami) -d cloud_identity_intel -c "
GRANT USAGE ON SCHEMA public TO cloudintel;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cloudintel;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cloudintel;
"
```

### 4. Verify

```bash
psql -U cloudintel -h localhost -d cloud_identity_intel -c "
SELECT COUNT(*) AS canonical_users FROM canonical_users
WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
"
# Expected: 1 (Alice from base seed)
# After loading extended mock data (010_mock_data.sql): ~700+
```

---

## Option B: Docker + Terraform

Use this if you prefer containerised databases or don't have PostgreSQL installed.

### 1. Start the database

```bash
cd infra
terraform init
terraform apply -auto-approve
```

This spins up a PostgreSQL 16 container on **port 5433** (deliberately non-default to avoid conflicts with local PostgreSQL installs) with the `cloud_identity_intel` database, applies all schema and seed SQL files in lexicographic order, and populates the full mock dataset.

> **Note:** The password is read from `infra/terraform.tfvars` (default: `localdev-change-me`). If the file is missing, Terraform will prompt for `pg_superuser_password` interactively.

Verify it's running:

```bash
docker ps | grep cloud-intel-postgres
```

---

## Configure and Run the App

### 1. Create your `.env.local` file

```bash
cd app
```

Copy the template and fill in your API key:

```bash
cp .env.example .env.local
# Edit .env.local and set your LLM_API_KEY
```

The template (`app/.env.example`) contains:

```env
# Database — matches Docker/Terraform defaults (port 5433 avoids local PG conflicts)
PG_HOST=localhost
PG_PORT=5433
PG_USER=cloudintel
PG_PASSWORD=localdev-change-me
PG_DATABASE=cloud_identity_intel

# LLM provider — pick ONE: anthropic, openai, or gemini
LLM_PROVIDER=anthropic
LLM_API_KEY=<your-api-key>

# Set to true to bypass LLM calls (returns mock responses)
MOCK_MODE=true
```

> **Note:** If you used Option A (native PostgreSQL on port 5432), set `PG_PORT=5432` instead.

### 2. Install dependencies and run

```bash
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

### 3. Verify the app works

Check all API endpoints return data:

```bash
curl -s http://localhost:3000/api/health    # {"status":"ok"}
curl -s http://localhost:3000/api/people    # canonical users list
curl -s http://localhost:3000/api/groups    # groups across all 3 providers
curl -s http://localhost:3000/api/resources # resources (repos, groups) by provider
curl -s http://localhost:3000/api/accounts  # AWS accounts + GCP projects
curl -s http://localhost:3000/api/access    # cross-provider effective access
curl -s http://localhost:3000/api/audit     # audit log entries
```

### 4. Run tests

```bash
npm test        # 14 test suites
npm run lint    # ESLint 9 with eslint-config-next
```

---

## Application Pages

| Page | URL | Description |
| ---- | --- | ----------- |
| Chat | `/` | Natural-language query interface (NL2SQL) |
| People | `/people` | Browse canonical users with identity counts |
| Person Detail | `/people/[id]` | Full person record with cross-provider identities, accounts/access, and emails |
| Resources | `/resources` | GitHub repos, Google Workspace groups, and AWS IDC groups with member/permission counts |
| Accounts | `/accounts` | Unified AWS account and GCP project browser with assignment/binding counts. Supports provider filter (aws/gcp) and search. |
| Groups | `/groups` | Google Workspace, AWS Identity Center, and GitHub groups with member counts |
| Group Detail | `/groups/[id]` | Group metadata and resolved member list with names, emails, roles, and status |
| Access Explorer | `/access` | Cross-provider effective access: GitHub (direct + team-derived), Google Workspace groups, AWS Identity Center groups. Supports provider, access path, and search filters with CSV export. |
| Audit Log | `/audit` | Query execution audit trail with action type filter |

---

## Seed Data Summary

### Base seed (`schema/02_seed_and_queries.sql`)

The base seed file creates a small deterministic dataset for a single demo tenant (`11111111-1111-1111-1111-111111111111`):

| Entity | Count | Details |
| ------ | ----- | ------- |
| Canonical Users | 1 | Alice Engineer |
| Canonical Emails | 1 | alice@company.com |
| Canonical Provider Links | 3 | Alice linked to all 3 providers |
| Google Workspace Users | 2 | Alice, Dave |
| AWS Identity Center Users | 1 | Alice |
| GitHub Organisations | 1 | techco |
| GitHub Users | 3 | Alice, Bob, Carol |
| GitHub Repositories | 1 | techco/backend |
| GitHub Repo Collaborator Permissions | 1 | Carol (external collaborator, push) |
| Identity Reconciliation Queue | 1 | Bob (pending review, no verified email) |

> **Note:** Bob and Dave do not have `canonical_users` entries in the base seed. Bob is GitHub-only with no verified email (queued for reconciliation). Dave is Google Workspace-only with no canonical identity yet. The base seed has no groups, teams, org memberships, or team memberships — those are populated by the extended mock data.

### Extended identity mock (`schema/99-seed/010_mock_data.sql`)

~700 canonical users, ~370 Google Workspace users, ~410 AWS IDC users, ~280 GitHub users, 20 teams, 50 repos, ~10K rows total. Includes edge cases: suspended/archived Google users, inactive AWS IDC users, noreply GitHub users.

### Cloud resources mock (`schema/99-seed/020_cloud_resources_seed.sql`)

| Entity | Count | Details |
| ------ | ----- | ------- |
| AWS Accounts | 12 | 1 management + 10 workload + 1 suspended |
| AWS Account Assignments | ~240 | IDC groups mapped to accounts via 8 permission sets |
| GCP Organisation | 1 | `organizations/901234567890` |
| GCP Projects | 15 | 14 active across prod/dev/sandbox + 1 decommissioned |
| GCP Project IAM Bindings | ~180 | User and group bindings across 12 GCP roles |
| Resource Access Grants | 800+ | Denormalised cross-provider matrix (AWS + GCP + GitHub) |

A Python seed script is also available: `scripts/seed_cloud_resources.py` (supports `--dry-run`, `--dsn`, `-o`).

Validation queries: `schema/99-seed/021_cloud_resources_validation.sql` (10 queries covering counts, distributions, cross-cloud users, and referential integrity).

### Edge cases in seed data

- **Alice** is linked across all three providers (Google Workspace, AWS Identity Center, GitHub) and is the only base-seed user with a `canonical_users` entry
- **Bob** is a GitHub-only user with no verified email — queued in `identity_reconciliation_queue` with status `PENDING`, no canonical identity link
- **Carol** is an external collaborator (`is_outside_collaborator = TRUE`, `push` permission on techco/backend) with no org membership and no canonical identity
- **Dave** exists only in Google Workspace (no GitHub, AWS, or canonical identity presence in base seed)
- **demo-deprecated** is a suspended AWS account (migration complete)
- **demo-decommissioned** is a GCP project with `DELETE_REQUESTED` lifecycle state

---

## Schema Overview

| File | Contents |
|------|----------|
| `schema/01_schema.sql` | Extensions (`uuid-ossp`), identity table DDL, indexes, `provider_type_enum` |
| `schema/02_cloud_resources.sql` | AWS accounts, GCP orgs/projects, IAM bindings, `resource_access_grants` matrix |
| `schema/02_seed_and_queries.sql` | Seed data for demo tenant, 4 example queries |
| `schema/03_ingestion_runs.sql` | Ingestion run tracking table |
| `schema/99-seed/010_mock_data.sql` | Extended identity mock dataset (~700 users, ~10K rows) |
| `schema/99-seed/020_cloud_resources_seed.sql` | Cloud resource seed (12 AWS accounts, 15 GCP projects, 800+ grants) |
| `schema/99-seed/021_cloud_resources_validation.sql` | 10 validation queries for cloud resource integrity |

### Tables by provider

| Provider | Tables |
|----------|--------|
| **Google Workspace** | `google_workspace_users`, `google_workspace_groups`, `google_workspace_memberships` |
| **AWS Identity Center** | `aws_identity_center_users`, `aws_identity_center_groups`, `aws_identity_center_memberships` |
| **AWS Accounts** | `aws_accounts`, `aws_account_assignments` |
| **GCP Cloud** | `gcp_organisations`, `gcp_projects`, `gcp_project_iam_bindings` |
| **GitHub** | `github_organisations`, `github_users`, `github_teams`, `github_org_memberships`, `github_team_memberships`, `github_repositories`, `github_repo_team_permissions`, `github_repo_collaborator_permissions` |
| **Canonical Identity** | `canonical_users`, `canonical_emails`, `canonical_user_provider_links`, `identity_reconciliation_queue` |
| **Cross-Provider** | `resource_access_grants` (denormalised permissions matrix) |

### Design principles

- All tables use composite primary keys `(id, tenant_id)` for partition-friendly multi-tenancy
- GitHub tables use `node_id` (TEXT) as the cross-reference key (mirrors GitHub GraphQL API)
- All provider tables include `raw_response JSONB` for full API response storage
- All tables include `deleted_at` for soft-delete support
- `provider_type_enum` classifies links: `GOOGLE_WORKSPACE`, `AWS_IDENTITY_CENTER`, `GITHUB`
- The application sets `SET LOCAL app.current_tenant_id` per transaction (RLS-ready for future)

---

## Ingestion Service (Optional)

The ingestion service syncs live data from provider APIs into the database, replacing static seed data with real identity and resource information.

### 1. Install Python dependencies

```bash
cd scripts/ingestion
pip install -r requirements.txt
```

### 2. Configure provider credentials

```bash
cp scripts/ingestion/.env.example scripts/ingestion/.env
# Edit .env and fill in credentials for the providers you want to sync
```

At minimum, set `TENANT_ID` and database connection variables. Then enable providers by setting their credentials:

| Provider | Required Variables |
|----------|-------------------|
| GitHub | `GITHUB_TOKEN`, `GITHUB_ORG_LOGINS` |
| Google Workspace | `GOOGLE_SA_KEY_FILE`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_CUSTOMER_ID` |
| AWS Identity Center | `AWS_IDENTITY_STORE_ID`, `AWS_SSO_INSTANCE_ARN` |
| AWS Organizations | `AWS_ORGANIZATIONS_ENABLED=true` (uses default AWS credentials) |
| GCP Resource Manager | `GCP_SA_KEY_FILE`, `GCP_ORG_ID` |

### 3. Run a sync

```bash
# Sync a single provider (GitHub is easiest to test with just a token)
python -m scripts.ingestion sync --provider github

# Sync all configured providers
python -m scripts.ingestion sync --provider all

# Run post-processing (identity resolution + grants backfill)
python -m scripts.ingestion sync --provider post-process

# Check run status
python -m scripts.ingestion status --provider github --limit 5
```

### 4. Run the scheduler (optional)

For continuous syncing on intervals:

```bash
python -m scripts.ingestion scheduler
```

Default intervals: Google Workspace 60 min, AWS IDC 60 min, GitHub 30 min, AWS Orgs 6 hours, GCP CRM 2 hours, post-processing 15 min.

### 5. Verify data

```bash
# Check ingestion runs
psql -U cloudintel -h localhost -d cloud_identity_intel -c \
  "SELECT provider, status, records_upserted, started_at FROM ingestion_runs ORDER BY started_at DESC LIMIT 10;"

# Verify data landed
psql -U cloudintel -h localhost -d cloud_identity_intel -c \
  "SELECT COUNT(*) FROM github_users WHERE last_synced_at > NOW() - INTERVAL '1 hour';"
```

> **Note:** The ingestion service requires `INSERT`/`UPDATE` grants on identity tables. If using the read-only `cloudintel` role from Option A, grant write access:
> ```bash
> psql -U $(whoami) -d cloud_identity_intel -c "GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO cloudintel;"
> ```

---

## Reset Database

To drop everything and start fresh:

```bash
# Kill any running app
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Drop and recreate (native PostgreSQL)
psql -U $(whoami) -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'cloud_identity_intel' AND pid <> pg_backend_pid();"
psql -U $(whoami) -d postgres -c "DROP DATABASE IF EXISTS cloud_identity_intel;"
psql -U $(whoami) -d postgres -c "DROP ROLE IF EXISTS cloudintel;"

# Then re-run the setup steps above
```

For Docker/Terraform (credentials in `infra/terraform.tfvars`):

```bash
cd infra
terraform destroy -auto-approve
terraform apply -auto-approve
```

---

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `role "cloudintel" does not exist` | Run the role creation commands from Step 1 of Option A |
| `current transaction is aborted` | Run `ROLLBACK;` in your psql session, then retry |
| `permission denied for table` | See "Port Conflicts" section below |
| App can't connect to DB | Verify PostgreSQL is running (`pg_isready -p 5433`) and `.env.local` credentials match |
| Chat returns errors | Check your `LLM_API_KEY` is valid and `LLM_PROVIDER` matches the key type |
| Port 3000 in use | Run `npx next dev --port 3001` or kill the process: `lsof -ti:3000 \| xargs kill` |
| `relation "canonical_users" does not exist` | Schema not applied. Run `psql -f schema/01_schema.sql` first |
| `relation "aws_accounts" does not exist` | Cloud resource schema not applied. Run `psql -f schema/02_cloud_resources.sql` |
| Terraform prompts for password | Ensure `infra/terraform.tfvars` exists with `pg_superuser_password = "localdev-change-me"` |
| `npm test` fails with rollup error | Run `rm -rf app/node_modules && cd app && npm install` to rebuild native modules |
| `/api/accounts` returns empty | Cloud resource seed not loaded. Run `psql -f schema/99-seed/020_cloud_resources_seed.sql` |

### Port Conflicts (Docker + local PostgreSQL)

If you see `permission denied for table` errors when using Option B (Docker), you may have a **local PostgreSQL** (Homebrew, Postgres.app) running on the same port. The app silently connects to the wrong database.

**Diagnose:**

```bash
# Check what's listening on the Docker port
lsof -iTCP:5433 -sTCP:LISTEN

# If you see a local postgres process (not com.docker), that's the conflict
```

**Fix:**

```bash
# Option 1: Stop local PostgreSQL
brew services stop postgresql

# Option 2: Use a different port for Docker
cd infra
terraform apply -var pg_port=5434
# Then update PG_PORT in app/.env.local to match
```

**Why this happens:** Docker maps its internal port 5432 to the host port (default 5433). If another PostgreSQL is already on that port, the app connects to the wrong instance. The default port is 5433 specifically to avoid this — but if you've overridden it to 5432, you'll hit this issue.

---

## Project Structure

```
ALXnderia/
├── app/                  # Next.js 15 application
│   ├── app/              # App Router pages and API routes
│   │   ├── layout.tsx    # Root layout (sidebar + user badge header)
│   │   ├── page.tsx      # Chat interface (home)
│   │   ├── people/       # People list page
│   │   │   └── [id]/     # Person detail page
│   │   ├── accounts/     # Accounts page (AWS accounts + GCP projects)
│   │   ├── groups/       # Groups list page
│   │   │   └── [id]/     # Group detail page
│   │   ├── resources/    # Resources list page
│   │   ├── access/       # Access explorer page
│   │   ├── audit/        # Audit log page
│   │   └── api/          # API route handlers (11 endpoints)
│   │       ├── chat/     # POST /api/chat (NL2SQL)
│   │       ├── access/   # GET /api/access (cross-provider effective access)
│   │       ├── accounts/ # GET /api/accounts + /api/accounts/[id]
│   │       ├── people/   # GET /api/people + /api/people/[id]
│   │       ├── groups/   # GET /api/groups + /api/groups/[id]
│   │       ├── resources/# GET /api/resources
│   │       ├── audit/    # GET /api/audit
│   │       └── health/   # GET /api/health
│   ├── src/
│   │   ├── client/       # React components (11 components)
│   │   ├── server/       # DB pool, route handlers, NL2SQL agent, SQL validator
│   │   └── shared/       # TypeScript types and constants
│   └── tests/            # Vitest tests (14 suites)
├── schema/               # SQL files: DDL, cloud resources, seed data, mock data
│   ├── 01_schema.sql     # Identity table DDL, indexes, enums, extensions
│   ├── 02_cloud_resources.sql   # AWS accounts, GCP projects, access grants DDL
│   ├── 02_seed_and_queries.sql  # Base seed data and example queries
│   └── 99-seed/
│       ├── 010_mock_data.sql             # Extended identity mock (~700 users, ~10K rows)
│       ├── 020_cloud_resources_seed.sql  # Cloud resource seed (12 AWS accounts, 15 GCP projects, 800+ grants)
│       └── 021_cloud_resources_validation.sql  # Validation queries
├── infra/                # Terraform (local Docker + AWS/GCP cloud deploy + ingestion modules)
├── scripts/              # Utility scripts (preflight.sh, seed_cloud_resources.py, ingestion/)
├── docs/                 # Architecture and operations documentation
└── .github/              # GitHub Actions CI/CD (5 workflows)
```
