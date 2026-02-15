# Alxderia - Local Setup Guide

A Next.js app (NL2SQL) that lets you ask natural-language questions about cloud identity data (AWS, GCP, and GitHub). It uses an LLM to generate SQL, runs it against PostgreSQL, and returns results.

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

# Create the application-level roles used by RLS policies
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel_admin;"
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel_analyst;"
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel_readonly;"
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel_audit;"
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel_ingest;"
psql -U $(whoami) -d postgres -c "CREATE ROLE cloudintel_app;"
psql -U $(whoami) -d postgres -c "GRANT cloudintel_analyst TO cloudintel;"
psql -U $(whoami) -d postgres -c "GRANT cloudintel_app TO cloudintel;"

# Create the database
psql -U $(whoami) -d postgres -c "CREATE DATABASE cloud_identity_intel OWNER cloudintel;"
```

### 2. Apply the schema

The schema files must be applied in a specific order. GitHub tables must be created before the identity tables (which add foreign keys to them).

```bash
cd /path/to/ALXnderia

# Extensions (requires superuser)
psql -U $(whoami) -d cloud_identity_intel -f schema/00-extensions/extensions.sql

# Schema files in dependency order
for f in \
  schema/01-reference/010_cloud_provider.sql \
  schema/01-reference/020_tenant.sql \
  schema/02-aws/010_aws_account.sql \
  schema/02-aws/020_aws_iam_user.sql \
  schema/02-aws/030_aws_iam_user_policy_attachment.sql \
  schema/02-aws/040_aws_idc_user.sql \
  schema/02-aws/050_aws_idc_group.sql \
  schema/02-aws/060_aws_idc_group_membership.sql \
  schema/02-aws/070_aws_idc_permission_set.sql \
  schema/02-aws/080_aws_idc_account_assignment.sql \
  schema/03-gcp/010_gcp_project.sql \
  schema/03-gcp/020_gcp_workspace_user.sql \
  schema/03-gcp/030_gcp_workspace_group.sql \
  schema/03-gcp/040_gcp_workspace_group_membership.sql \
  schema/03-gcp/050_gcp_iam_binding.sql \
  schema/11-github/010_github_organisation.sql \
  schema/11-github/020_github_user.sql \
  schema/11-github/030_github_team.sql \
  schema/11-github/040_github_team_membership.sql \
  schema/11-github/050_github_org_membership.sql \
  schema/04-identity/010_person.sql \
  schema/04-identity/020_person_link.sql \
  schema/05-views/010_mv_effective_access.sql \
  schema/05-views/020_fn_effective_access_as_of.sql \
  schema/07-indexes/010_indexes.sql \
  schema/09-history/010_entity_history.sql \
  schema/09-history/020_snapshot_registry.sql \
  schema/09-history/030_hash_verify_function.sql \
  schema/10-dlp/010_retention_policy.sql \
  schema/10-dlp/020_legal_hold.sql \
  schema/10-dlp/030_pii_redaction_views.sql \
  schema/11-github/060_github_post_setup.sql \
  schema/08-security/010_roles.sql \
  schema/08-security/020_rls_policies.sql; do
  echo "==> $f"
  psql -U $(whoami) -d cloud_identity_intel -f "$f"
done
```

**PostgreSQL 14 users:** The materialized view index uses `NULLS NOT DISTINCT` (PG 15+). If you see a syntax error, run this manually:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ea_unique ON mv_effective_access (
    person_id, cloud_provider, account_or_project_id,
    role_or_permission_set, access_path, COALESCE(via_group_name, '')
);
```

### 3. Seed mock data

```bash
psql -U $(whoami) -d cloud_identity_intel -f schema/99-seed/010_mock_data.sql
```

### 4. Grant permissions

```bash
psql -U $(whoami) -d cloud_identity_intel -c "
GRANT USAGE ON SCHEMA public TO cloudintel;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cloudintel;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cloudintel;
"
```

### 5. Verify

```bash
psql -U cloudintel -h localhost -d cloud_identity_intel -c "
SET ROLE cloudintel_analyst;
BEGIN;
SET LOCAL app.current_tenant_id = 'a0000000-0000-0000-0000-000000000001';
SELECT COUNT(*) AS people FROM person WHERE deleted_at IS NULL;
COMMIT;
"
# Expected: 680 rows
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

This spins up a PostgreSQL 16 container on **port 5432** with the `cloud_identity_intel` database, applies all schema files, and seeds mock data.

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
curl -s http://localhost:3000/api/health   # {"status":"ok"}
curl -s http://localhost:3000/api/people   # 680 people (Northwind tenant)
curl -s http://localhost:3000/api/groups   # 230 groups
curl -s http://localhost:3000/api/resources # 150 resources (AWS accounts + GCP projects)
curl -s http://localhost:3000/api/audit    # 0 entries (empty until queries are made)
```

### 4. Run tests

```bash
npm test        # 32 tests (28 SQL validator + 4 chat route)
npm run lint    # ESLint 9 with eslint-config-next
```

---

## Application Pages

| Page | URL | Description |
| ---- | --- | ----------- |
| Chat | `/` | Natural-language query interface (NL2SQL) |
| People | `/people` | Browse all persons with identity counts |
| Resources | `/resources` | AWS accounts and GCP projects |
| Groups | `/groups` | AWS IDC groups and GCP Workspace groups |
| Access Explorer | `/access` | Cross-provider effective access view |
| Audit Log | `/audit` | Query execution audit trail |

---

## Mock Data Summary

The seed file (`schema/99-seed/010_mock_data.sql`) creates a deterministic dataset across two tenants:

| Entity | Northwind | Southbank | Total |
| ------ | --------- | --------- | ----- |
| Persons | 700 | 300 | 1,000 |
| AWS IDC Users | 410 | 170 | 580 |
| AWS IAM Users | 105 | 45 | 150 |
| GCP Workspace Users | 370 | 150 | 520 |
| GitHub Users | 280 | 120 | 400 |
| AWS IDC Groups | 120 | 60 | 180 |
| GCP Workspace Groups | 110 | 50 | 160 |
| GitHub Teams | 20 | 10 | 30 |
| Person Links | - | - | ~1,630 |
| Entity History Events | - | - | 140 |

Edge cases included: 20 departed persons, 15 suspended GCP users, 30 stale IDC accounts, 5 display name mismatches, 20 GitHub noreply users.

The app defaults to the **Northwind Holdings** tenant (`a0000000-0000-0000-0000-000000000001`), which shows 680 active people after filtering out departed users.

---

## Database Roles

| Role | Purpose |
| ---- | ------- |
| `cloudintel` | Application login role (connects to the database) |
| `cloudintel_admin` | Schema management (DDL) |
| `cloudintel_ingest` | Data loading (INSERT/UPDATE) |
| `cloudintel_analyst` | Full read access with PII (used by the app via `SET LOCAL ROLE`) |
| `cloudintel_readonly` | Redacted views only |
| `cloudintel_audit` | Audit log access |
| `cloudintel_app` | Application runtime queries |

The app uses `SET LOCAL ROLE cloudintel_analyst` inside each transaction to satisfy RLS policies, which scope all queries to the current tenant via `SET LOCAL app.current_tenant_id`.

---

## Reset Database

To drop everything and start fresh:

```bash
# Kill any running app
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Drop and recreate (native PostgreSQL)
psql -U $(whoami) -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'cloud_identity_intel' AND pid <> pg_backend_pid();"
psql -U $(whoami) -d postgres -c "DROP DATABASE IF EXISTS cloud_identity_intel;"
psql -U $(whoami) -d postgres -c "DROP ROLE IF EXISTS cloudintel_admin, cloudintel_analyst, cloudintel_readonly, cloudintel_audit, cloudintel_ingest, cloudintel_app, cloudintel;"

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
| `NULLS NOT DISTINCT` syntax error | You're on PG 14. Run the `COALESCE` index workaround above |
| `current transaction is aborted` | Run `ROLLBACK;` in your psql session, then retry |
| `permission denied for table` | Run the `GRANT SELECT ON ALL TABLES` commands from Step 4 |
| `Failed to load people` (500) | Check server logs. Common causes: missing `SET LOCAL ROLE`, wrong column names, missing tables |
| App can't connect to DB | Verify PostgreSQL is running (`pg_isready`) and `.env.local` credentials match |
| Chat returns errors | Check your `LLM_API_KEY` is valid and `LLM_PROVIDER` matches |
| Port 3000 in use | Run `npx next dev --port 3001` or kill the process: `lsof -ti:3000 \| xargs kill` |
| RLS returns 0 rows | The app must use `SET LOCAL ROLE cloudintel_analyst` before queries. Check `pool.ts` |

---

## Project Structure

```
ALXnderia/
├── app/                  # Next.js 15 application
│   ├── app/              # App Router pages and API routes
│   │   ├── layout.tsx    # Root layout (sidebar + user badge header)
│   │   ├── page.tsx      # Chat interface (home)
│   │   ├── people/       # People list page
│   │   ├── groups/       # Groups list page
│   │   ├── resources/    # Resources list page
│   │   ├── access/       # Access explorer page
│   │   ├── audit/        # Audit log page
│   │   └── api/          # API route handlers
│   ├── src/
│   │   ├── client/       # React components (9 components)
│   │   ├── server/       # DB pool, route handlers, NL2SQL agent, SQL validator
│   │   └── shared/       # TypeScript type definitions
│   └── tests/            # Vitest tests (32 tests across 2 suites)
├── schema/               # 39 SQL files across 12 directories
│   ├── 00-extensions/    # pgcrypto, uuid-ossp
│   ├── 01-reference/     # cloud_provider, tenant
│   ├── 02-aws/           # AWS accounts, IAM users, IDC users/groups/permissions
│   ├── 03-gcp/           # GCP projects, Workspace users/groups, IAM bindings
│   ├── 04-identity/      # person, person_link (cross-provider graph)
│   ├── 05-views/         # mv_effective_access (materialised view)
│   ├── 06-queries/       # Example and advanced query templates
│   ├── 07-indexes/       # Performance indexes
│   ├── 08-security/      # Roles and RLS policies
│   ├── 09-history/       # entity_history (hash-chained, partitioned)
│   ├── 10-dlp/           # Retention policies, legal holds, PII redaction views
│   ├── 11-github/        # GitHub orgs, users, teams, memberships
│   └── 99-seed/          # Mock data (1,000 persons, ~15,000 rows total)
├── infra/                # Terraform (local Docker + AWS/GCP cloud deploy)
├── scripts/              # Utility scripts (preflight.sh)
├── docs/                 # Architecture and operations documentation
└── .github/              # GitHub Actions CI/CD (5 workflows)
```
