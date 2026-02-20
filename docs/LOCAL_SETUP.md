# Alxderia - Local Setup Guide

A Next.js app (NL2SQL) that lets you ask natural-language questions about cloud identity data (Google Workspace, AWS Identity Center, and GitHub). It uses an LLM to generate SQL, runs it against PostgreSQL, and returns results.

## Prerequisites

| Tool          | Version | Check command    |
| ------------- | ------- | ---------------- |
| **Node.js**   | 22+     | `node -v`        |
| **npm**       | 10+     | `npm -v`         |
| **PostgreSQL** | 14+    | `psql --version` |

You also need **one** LLM API key (pick one):

- Anthropic: `ANTHROPIC_API_KEY`
- OpenAI: `OPENAI_API_KEY`
- Google Gemini: `GOOGLE_API_KEY`

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

The schema is defined in two flat SQL files. Apply them in order:

```bash
cd /path/to/ALXnderia

# DDL: extensions, tables, indexes, enums
psql -U $(whoami) -d cloud_identity_intel -f schema/01_schema.sql

# Seed data and example queries
psql -U $(whoami) -d cloud_identity_intel -f schema/02_seed_and_queries.sql
```

# Load mock data (~700 users, ~10K rows total)
```bash
psql -U $(whoami) -d cloud_identity_intel -f schema/99-seed/010_mock_data.sql
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
# Expected: 3 rows (Alice, Bob, Dave from seed data)
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

This spins up a PostgreSQL 16 container on **port 5432** with the `cloud_identity_intel` database, applies both schema files, and seeds mock data.

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

Create `app/.env.local`:

```env
# Database (matches defaults - no changes needed for either setup option)
PG_HOST=localhost
PG_PORT=5432
PG_USER=cloudintel
PG_PASSWORD=localdev-change-me
PG_DATABASE=cloud_identity_intel

# LLM provider - pick ONE and set its key
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-your-key-here

# Optional: override the default model
# LLM_MODEL=claude-sonnet-4-5-20250929
```

Change `LLM_PROVIDER` to `openai` or `gemini` if using a different provider, and set the matching key.

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
curl -s http://localhost:3000/api/access    # cross-provider effective access
curl -s http://localhost:3000/api/audit     # audit log entries
```

### 4. Run tests

```bash
npm test        # 142 tests across 13 suites
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
| Groups | `/groups` | Google Workspace, AWS Identity Center, and GitHub groups with member counts |
| Group Detail | `/groups/[id]` | Group metadata and resolved member list with names, emails, roles, and status |
| Access Explorer | `/access` | Cross-provider effective access: GitHub (direct + team-derived), Google Workspace groups, AWS Identity Center groups. Supports provider, access path, and search filters with CSV export. |
| Audit Log | `/audit` | Query execution audit trail with action type filter |

---

## Seed Data Summary

The seed file (`schema/02_seed_and_queries.sql`) creates a deterministic dataset for a single demo tenant (`11111111-1111-1111-1111-111111111111`):

| Entity | Count | Details |
| ------ | ----- | ------- |
| Canonical Users | 3 | Alice Johnson, Bob Smith, Dave Wilson |
| Canonical Emails | 3 | One per canonical user |
| Canonical Provider Links | 5 | Alice (all 3), Bob (GitHub only), Dave (Google only) |
| Google Workspace Users | 2 | Alice, Dave |
| Google Workspace Groups | 1 | engineering-team |
| Google Workspace Memberships | 2 | Alice + Dave in engineering |
| AWS Identity Center Users | 1 | Alice |
| AWS Identity Center Groups | 1 | CloudAdmins |
| AWS Identity Center Memberships | 1 | Alice in CloudAdmins |
| GitHub Organisations | 1 | demo-org |
| GitHub Users | 2 | Alice, Bob |
| GitHub Teams | 1 | platform-team |
| GitHub Org Memberships | 2 | Alice (admin), Bob (member) |
| GitHub Team Memberships | 2 | Alice + Bob in platform-team |
| GitHub Repositories | 1 | infra-core |
| GitHub Repo Team Permissions | 1 | platform-team has push on infra-core |
| GitHub Repo Collaborator Permissions | 1 | Carol (external collaborator, read) |
| Identity Reconciliation Queue | 1 | Bob (pending review, GitHub-only) |

### Edge cases in seed data

- **Bob** is a GitHub-only user with no canonical identity link (queued for reconciliation)
- **Carol** is an external collaborator (`is_outside_collaborator = TRUE`) with no org membership
- **Alice** is linked across all three providers (Google Workspace, AWS Identity Center, GitHub)
- **Dave** exists only in Google Workspace (no GitHub or AWS presence)

---

## Schema Overview

| File | Contents |
|------|----------|
| `schema/01_schema.sql` | Extensions (`uuid-ossp`), all table DDL, indexes, `provider_type_enum` |
| `schema/02_seed_and_queries.sql` | Seed data for demo tenant, 4 example queries |
| `schema/99-seed/010_mock_data.sql` | Extended mock dataset (~700 users, ~10K rows across all providers) |

### Tables by provider

| Provider | Tables |
|----------|--------|
| **Google Workspace** | `google_workspace_users`, `google_workspace_groups`, `google_workspace_memberships` |
| **AWS Identity Center** | `aws_identity_center_users`, `aws_identity_center_groups`, `aws_identity_center_memberships` |
| **GitHub** | `github_organisations`, `github_users`, `github_teams`, `github_org_memberships`, `github_team_memberships`, `github_repositories`, `github_repo_team_permissions`, `github_repo_collaborator_permissions` |
| **Canonical Identity** | `canonical_users`, `canonical_emails`, `canonical_user_provider_links`, `identity_reconciliation_queue` |

### Design principles

- All tables use composite primary keys `(id, tenant_id)` for partition-friendly multi-tenancy
- GitHub tables use `node_id` (TEXT) as the cross-reference key (mirrors GitHub GraphQL API)
- All provider tables include `raw_response JSONB` for full API response storage
- All tables include `deleted_at` for soft-delete support
- `provider_type_enum` classifies links: `GOOGLE_WORKSPACE`, `AWS_IDENTITY_CENTER`, `GITHUB`
- The application sets `SET LOCAL app.current_tenant_id` per transaction (RLS-ready for future)

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

For Docker/Terraform:

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
| `permission denied for table` | Run the `GRANT SELECT ON ALL TABLES` commands from Step 3 |
| App can't connect to DB | Verify PostgreSQL is running (`pg_isready`) and `.env.local` credentials match |
| Chat returns errors | Check your `LLM_API_KEY` is valid and `LLM_PROVIDER` matches |
| Port 3000 in use | Run `npx next dev --port 3001` or kill the process: `lsof -ti:3000 \| xargs kill` |
| `relation "canonical_users" does not exist` | Schema not applied. Run `psql -f schema/01_schema.sql` first |

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
│   │   ├── groups/       # Groups list page
│   │   │   └── [id]/     # Group detail page
│   │   ├── resources/    # Resources list page
│   │   ├── access/       # Access explorer page
│   │   ├── audit/        # Audit log page
│   │   └── api/          # API route handlers (9 endpoints)
│   │       ├── chat/     # POST /api/chat (NL2SQL)
│   │       ├── access/   # GET /api/access (cross-provider effective access)
│   │       ├── people/   # GET /api/people + /api/people/[id]
│   │       ├── groups/   # GET /api/groups + /api/groups/[id]
│   │       ├── resources/# GET /api/resources
│   │       ├── audit/    # GET /api/audit
│   │       └── health/   # GET /api/health
│   ├── src/
│   │   ├── client/       # React components (10 components)
│   │   ├── server/       # DB pool, route handlers, NL2SQL agent, SQL validator
│   │   └── shared/       # TypeScript types and constants
│   └── tests/            # Vitest tests (142 tests across 13 suites)
├── schema/               # SQL files: DDL, seed data, and mock data
│   ├── 01_schema.sql     # All table DDL, indexes, enums, extensions
│   ├── 02_seed_and_queries.sql  # Seed data and example queries
│   └── 99-seed/
│       └── 010_mock_data.sql    # Extended mock dataset (~700 users, ~10K rows)
├── infra/                # Terraform (local Docker + AWS/GCP cloud deploy)
├── scripts/              # Utility scripts (preflight.sh)
├── docs/                 # Architecture and operations documentation
└── .github/              # GitHub Actions CI/CD (5 workflows)
```
