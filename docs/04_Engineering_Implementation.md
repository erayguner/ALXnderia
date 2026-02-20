# 04 -- Engineering Implementation Guide: Alxderia Cloud Identity Intelligence

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Key Modules and Responsibilities](#2-key-modules-and-responsibilities)
3. [Local Development Setup](#3-local-development-setup)
4. [Build and Test](#4-build-and-test)
5. [Code Conventions and Patterns](#5-code-conventions-and-patterns)
6. [Common Tasks](#6-common-tasks)
7. [Environment Variables Reference](#7-environment-variables-reference)
8. [Assumptions](#8-assumptions)

---

## 1. Project Structure

The repository is split into three top-level directories with clear boundaries.

```
ALXnderia/
  app/          Next.js 15 application (App Router, API routes, NL2SQL agent)
  schema/       SQL files: DDL (01_schema.sql), seed data (02_seed_and_queries.sql), mock data (99-seed/)
  infra/        Terraform for local Docker PostgreSQL and cloud deploy modules
  docs/         Project documentation
  .github/      GitHub Actions CI/CD pipelines (5 workflows)
```

Inside `app/`, source code follows a strict server/client/shared separation:

```
app/src/
  server/
    agents/         NL2SQL agent (LLM-agnostic, schema cache)
    db/             Connection pool with tenant-scoped execution
    llm/            LLM provider abstraction (Anthropic, OpenAI, Gemini)
    middleware/     Audit logging (fire-and-forget)
    routes/         Handler functions for each API endpoint
                    (access.ts, audit.ts, chat.ts, groups.ts, people.ts, resources.ts)
    validators/     SQL security validator (libpg-query WASM parser)
  client/
    components/     React client components
                    (AccessExplorer, AuditLog, ChatInterface, GroupsList, PeopleList,
                     PersonDetail, ResourcesList, ResultsTable, Sidebar, UserBadge)
  shared/
    types/          TypeScript interfaces shared across client and server
    constants/      Allow-lists, block-lists, limits, synonyms
```

App Router pages include detail routes for individual resources:

```
app/app/
  page.tsx            Home (Chat)
  people/page.tsx     People list
  people/[id]/page.tsx  Person detail
  groups/page.tsx     Groups list
  groups/[id]/page.tsx  Group detail
  resources/page.tsx  Resources list
  access/page.tsx     Access Explorer
  audit/page.tsx      Audit Log
  api/                API route handlers (9 endpoints)
```

API route files under `app/app/api/` are thin wrappers that delegate to the corresponding handler in `src/server/routes/`. For example, `app/api/chat/route.ts` imports and calls `handleChat` from `@server/routes/chat`.


## 2. Key Modules and Responsibilities

**`src/server/db/pool.ts`** -- Database connection pool. Exports `executeWithTenant()` which wraps every query in a transaction with `SET LOCAL app.current_tenant_id` for forward-compatible tenant scoping. Also exports `executeReadOnly()` for system-level queries (e.g. schema introspection), `getSchemaMetadata()` for live catalogue introspection, and `healthCheck()` for readiness probes. Note: the current schema does not define RLS policies, but the application sets the tenant session variable in preparation for future RLS enablement.

**`src/server/llm/`** -- LLM provider abstraction layer. Defines an `LLMProvider` interface with a `complete()` method, and implements it for three backends: Anthropic Claude (`anthropic.ts`), OpenAI GPT (`openai.ts`), and Google Gemini (`gemini.ts`). The factory in `index.ts` reads the `LLM_PROVIDER` environment variable and returns a cached provider singleton. Only the selected provider's SDK is loaded at runtime via dynamic imports.

**`src/server/agents/nl2sql-agent.ts`** -- The NL2SQL agent. Builds a system prompt from live schema metadata, calls the configured LLM provider via the abstraction layer in `src/server/llm/`, parses the structured JSON response, validates the generated SQL, executes it within a tenant-scoped transaction, and returns a `ChatResponse` with narrative context. The schema context is cached in memory after the first call; call `clearSchemaCache()` after DDL changes.

**`src/server/validators/sql-validator.ts`** -- The critical security layer between LLM output and the database. Uses `libpg-query` (PostgreSQL's actual parser compiled to WASM) to parse SQL into an AST. Enforces: SELECT-only statements, table allow-list, blocked function list, blocked system-table prefixes, blocked keywords, and automatic `LIMIT` injection when absent. Defence-in-depth: comments are stripped before parsing, and a pre-parse keyword scan runs before the AST walk.

**`src/server/middleware/audit.ts`** -- Logs audit entries to the console. Records question text, SQL executed, row count, timing, and status. Never stores result data (data minimisation). The current schema does not include an `audit_log` table; database-backed audit logging is planned for a future iteration.

**`src/server/routes/chat.ts`** -- The chat endpoint handler. Validates the request body, enforces question length limits, calls `processQuestion()`, records the audit entry (fire-and-forget), and returns the response. Uses a hardcoded mock session in the current implementation.

**`src/server/routes/access.ts`** -- The access endpoint handler. Builds a multi-provider UNION ALL query across GitHub direct collaborator permissions, GitHub team-derived permissions, Google Workspace group memberships, and AWS Identity Center group memberships. Supports `provider`, `accessPath`, and `search` filters with parameterised queries. Returns a uniform row shape (`display_name`, `primary_email`, `cloud_provider`, `account_or_project_id`, `account_or_project_name`, `role_or_permission_set`, `access_path`, `via_group_name`, `person_id`).

**`src/server/routes/groups.ts`** -- The groups endpoint handler. Supports `handleGroupsList()` (lists groups with member counts across all providers) and `handleGroupDetails()` (returns a single group's metadata and members). Google Workspace membership resolution joins `member_id` to `google_workspace_users.google_id` (not email).

**`src/server/routes/people.ts`** -- The people endpoint handler. Supports `handlePeopleList()` (lists canonical users with identity counts) and `handlePersonDetail()` (returns a full canonical user with linked identities from Google Workspace, AWS Identity Center, and GitHub, plus canonical emails).

**`src/server/routes/resources.ts`** -- The resources endpoint handler. Lists resources from the selected provider (GitHub repos, Google Workspace groups, or AWS IDC groups) with member/permission counts.

**`src/server/routes/audit.ts`** -- The audit endpoint handler. Returns paginated audit log entries with optional action filter.

**`src/shared/constants/index.ts`** -- Security-critical configuration: `ALLOWED_TABLES` (all tables from the schema: `canonical_users`, `canonical_emails`, `canonical_user_provider_links`, `identity_reconciliation_queue`, `google_workspace_*`, `aws_identity_center_*`, `github_*`), `BLOCKED_FUNCTIONS`, `BLOCKED_KEYWORDS`, `BLOCKED_TABLE_PREFIXES`, `PII_TABLES` (tables containing email/name PII), `REDACTED_VIEW_MAP` (empty — no redacted views in current schema), `SCHEMA_SYNONYMS` (comprehensive mappings for all table names), and numeric limits (`MAX_ROWS`, `QUERY_TIMEOUT_MS`, `MAX_QUESTION_LENGTH`, `RATE_LIMIT_PER_MINUTE`).

**`src/shared/types/index.ts`** -- All TypeScript interfaces: `ChatRequest`, `ChatResponse`, `QueryPlan`, `UserSession`, `SqlValidationResult`, `AuditEntry`, pagination types, and schema metadata types. Shared across client and server; free of runtime dependencies.


## 3. Local Development Setup

### 3.1 Prerequisites

- Node.js 22 (matches the Dockerfile base image)
- Docker (for the local PostgreSQL container)
- Terraform >= 1.14.0

### 3.2 Provision the local database

From the repository root:

```bash
cd infra
terraform init
terraform apply -var="pg_superuser_password=localdev-change-me"
```

This starts a PostgreSQL 16 container (`cloud-intel-postgres`) on port 5432 with a persistent Docker volume. Terraform applies the two SQL files from `schema/` (`01_schema.sql` then `02_seed_and_queries.sql`) automatically. When either file changes, re-running `terraform apply` will re-apply the full schema.

### 3.3 Configure environment variables

Create `app/.env.local`:

```
PG_HOST=localhost
PG_PORT=5432
PG_USER=cloudintel
PG_PASSWORD=localdev-change-me
PG_DATABASE=cloud_identity_intel
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
```

`LLM_PROVIDER` accepts `anthropic`, `openai`, or `gemini`. `LLM_MODEL` is optional and defaults to the provider's recommended model.

### 3.4 Install dependencies and start

```bash
cd app
npm install
npm run dev
```

The application starts on `http://localhost:3000`. The `/api/health` endpoint confirms database connectivity.


## 4. Build and Test

### 4.1 Production build

```bash
cd app
npm run build
```

Next.js produces a standalone output (configured via `output: 'standalone'` in `next.config.ts`). The result in `.next/standalone` is a self-contained Node.js server. Native packages `pg` and `libpg-query` are listed under `serverExternalPackages` so that Next.js does not attempt to bundle them.

### 4.2 Docker image

The multi-stage Dockerfile (`app/Dockerfile`) builds in three stages: dependency installation, build, and a minimal production runner. The runner stage creates a non-root `nextjs` user and exposes port 3000 with a health check.

```bash
docker build -t alxderia-app ./app
docker run -p 3000:3000 --env-file app/.env.local alxderia-app
```

### 4.3 Test suite

```bash
cd app
npm test          # single run
npm run test:watch  # watch mode
```

The test suite uses Vitest 4.x. There are currently 142 tests across 13 suites covering the SQL validator, chat route handler, NL2SQL agent, API routes (access, audit, health, people), database pool, React components, and shared constants. Tests live in `app/tests/`.

### 4.4 Linting

```bash
cd app
npm run lint
```

Uses ESLint 9 with the `eslint-config-next` flat config (`eslint.config.mjs`). The lint script runs `eslint src/` directly (the deprecated `next lint` wrapper was replaced).

### 4.5 CI/CD Pipelines

Five GitHub Actions workflows are defined in `.github/workflows/`:

| Workflow | File | Triggers | Gates |
|----------|------|----------|-------|
| **CI** | `ci.yml` | push/PR to main | Lint + Type-check, Tests (vitest), Next.js Build, Schema Validation (PG 16 service container) |
| **CodeQL** | `codeql.yml` | push/PR/weekly | SAST with `security-extended` + `security-and-quality` queries scoped to `app/src` |
| **Checkov** | `checkov.yml` | infra/schema changes | Terraform IaC scan, Secrets scan, GitHub Actions config scan; uploads SARIF |
| **Security Audit** | `security-audit.yml` | push/PR/weekly | npm audit, SQL injection pattern scanner, TruffleHog secret detection, license compliance |
| **Bundle Analysis** | `nextjs-bundle.yml` | app changes | Build with analysis, bundle size limits (200 MB), dependency size report |

The Schema Validation job in CI spins up a PostgreSQL 16 service container, applies both SQL files in order, and verifies: all expected tables exist and seed data counts are correct.


## 5. Code Conventions and Patterns

### 5.1 TypeScript configuration

Strict mode is enabled. Target is ES2022. Module resolution is set to `bundler` for Next.js compatibility. `isolatedModules` is on, `noEmit` is on (Next.js handles emit).

### 5.2 Path aliases

Four path aliases are defined in `tsconfig.json`:

| Alias        | Resolves to         |
|-------------|---------------------|
| `@/*`       | `./src/*`           |
| `@server/*` | `./src/server/*`    |
| `@client/*` | `./src/client/*`    |
| `@shared/*` | `./src/shared/*`    |

Always use these aliases in imports rather than relative paths.

### 5.3 Server/client separation

All database access, API logic, and security validation lives under `src/server/`. Client components live under `src/client/`. Shared types and constants (no runtime dependencies) live under `src/shared/`. Never import from `@server/*` in client code.

### 5.4 Tenant isolation pattern

Every user-facing database query must go through `executeWithTenant(tenantId, sql, params)`. This function:

1. Acquires a client from the pool.
2. Opens a transaction with `BEGIN`.
3. Sets `SET LOCAL statement_timeout` and `SET LOCAL app.current_tenant_id`.
4. Executes the query.
5. Commits (or rolls back on error).
6. Releases the client.

The `SET LOCAL` ensures the tenant context is scoped to the transaction and automatically cleared on commit or rollback. The current schema does not define RLS policies, but the application sets `app.current_tenant_id` for forward compatibility. All tables include a `tenant_id` column with composite primary keys `(id, tenant_id)` to support future partition-based or RLS-based isolation.

### 5.5 Audit pattern

Audit logging is fire-and-forget: `recordAuditEntry(...).catch(() => {})`. This ensures a failure in the audit pipeline never degrades the primary query flow. Both successful and failed queries are audited. Result data is never stored, only metadata (question, SQL, row count, timing, status). Currently, audit entries are logged to the console. Database-backed audit logging will be added when an `audit_log` table is provisioned in the schema.

### 5.6 API route delegation

Route files under `app/api/` are kept deliberately thin. Each exports a single HTTP method handler that delegates to a function in `src/server/routes/`:

```typescript
// app/api/chat/route.ts
import { handleChat } from '@server/routes/chat';
export async function POST(request: NextRequest) {
  return handleChat(request);
}
```

Business logic, validation, and error handling live in the route handler, not in the route file.


## 6. Common Tasks

### 6.1 Adding a new API endpoint

1. Create the handler function in `src/server/routes/<name>.ts`. Accept `NextRequest`, return `NextResponse`.
2. Create the route file at `app/api/<path>/route.ts`. Import and re-export the handler for the appropriate HTTP method.
3. Add any new request/response types to `src/shared/types/index.ts`.
4. Add tests in `tests/server/`.

### 6.2 Adding a new table to the schema

1. Add the `CREATE TABLE` statement to `schema/01_schema.sql`. Follow the existing conventions: composite primary key `(id, tenant_id)`, `raw_response JSONB`, timestamp columns, and appropriate unique constraints.
2. If the table needs seed data, add `INSERT` statements to `schema/02_seed_and_queries.sql` using the demo tenant ID `11111111-1111-1111-1111-111111111111`.
3. If the table should be queryable by the NL2SQL agent, add its name to `ALLOWED_TABLES` in `src/shared/constants/index.ts`.
4. If the table contains PII, add it to `PII_TABLES`.
5. If the table is commonly referred to by alternative names, add entries to `SCHEMA_SYNONYMS`.
6. Re-run `terraform apply` in `infra/` to apply the schema change.
7. Call `clearSchemaCache()` or restart the application so the NL2SQL agent picks up the new table metadata.

### 6.3 Updating the NL2SQL agent's knowledge

The agent's behaviour is shaped by three things:

- **Live schema metadata** -- fetched from the database on first request and cached. Add column comments in your DDL to improve the agent's understanding of each field.
- **Synonym mappings** -- defined in `SCHEMA_SYNONYMS` in `src/shared/constants/index.ts`.
- **Few-shot examples** -- defined in `FEW_SHOT_EXAMPLES` in `src/server/agents/nl2sql-agent.ts`. Add new examples to teach the agent patterns for new tables or query shapes.

### 6.4 Running tests

```bash
cd app
npm test                    # run all tests once
npm run test:watch          # watch mode for development
npx vitest run tests/server/sql-validator.test.ts  # run a single test file
```

Always run `npm test` before committing. The validator tests are particularly important as they guard against SQL injection regressions.

### 6.5 Building and deploying the Docker image

For AWS:

```bash
./infra/scripts/build-and-push-aws.sh
```

For GCP:

```bash
./infra/scripts/build-and-push-gcp.sh
```

These scripts build the Docker image and push it to the respective container registry. Cloud infrastructure is defined in `infra/modules/aws/` and `infra/modules/gcp/`, each with networking, database, compute, registry, and secrets modules. Deploy configurations live in `infra/deploy/aws/` and `infra/deploy/gcp/`.

### 6.6 Deploying infrastructure changes

```bash
cd infra/deploy/aws   # or infra/deploy/gcp
terraform init
terraform plan
terraform apply
```

Schema migrations in cloud environments are handled by `infra/scripts/migrate-schema.sh`.


## 7. Environment Variables Reference

| Variable          | Required | Default                          | Description                                |
|-------------------|----------|----------------------------------|--------------------------------------------|
| `PG_HOST`         | Yes      | `localhost`                      | PostgreSQL hostname                        |
| `PG_PORT`         | Yes      | `5432`                           | PostgreSQL port                            |
| `PG_USER`         | Yes      | `cloudintel`                     | PostgreSQL username                        |
| `PG_PASSWORD`     | Yes      | `localdev-change-me`             | PostgreSQL password                        |
| `PG_DATABASE`     | Yes      | `cloud_identity_intel`           | PostgreSQL database name                   |
| `LLM_PROVIDER`    | No       | `anthropic`                      | LLM backend: anthropic, openai, or gemini  |
| `LLM_API_KEY`     | Yes      | --                               | API key for the configured LLM provider    |
| `LLM_MODEL`       | No       | (provider default)               | Model identifier (e.g. claude-sonnet-4-5-20250929, gpt-4o, gemini-2.5-pro) |
| `PORT`            | No       | `3000`                           | Application listen port (Docker)           |
| `HOSTNAME`        | No       | `0.0.0.0`                        | Application bind address (Docker)          |

Never commit `.env` files or hardcode credentials in source. Use the infrastructure secrets modules for production deployments.


## 8. Assumptions

1. **Authentication is mocked.** The `getSession()` function in `src/server/routes/chat.ts` returns a hardcoded demo user with tenant ID `11111111-1111-1111-1111-111111111111`. Production requires replacing this with Auth.js or an equivalent session provider. All downstream code already accepts tenantId and role as parameters.

2. **Schema cache is in-memory and per-process.** The NL2SQL agent caches schema metadata after the first query. In a multi-instance deployment, each instance maintains its own cache. After schema migrations, either restart all instances or expose an endpoint that calls `clearSchemaCache()`.

3. **Audit logging is console-only.** The current schema does not include an `audit_log` table. Audit entries are logged to the console and failures are swallowed. For strict compliance requirements, provision an audit table and consider a write-ahead log or message queue.

4. **The SQL validator is the sole security boundary.** The application trusts that if the validator passes a query, it is safe to execute. The validator enforces SELECT-only, table allow-listing, function block-listing, and automatic LIMIT injection. Any new table must be explicitly added to `ALLOWED_TABLES` before the agent can query it.

5. **Rate limiting is defined but not enforced.** `RATE_LIMIT_PER_MINUTE` is declared in constants but no middleware currently applies it. This must be implemented before production use.

6. **The `source_ip` field in audit entries is hardcoded to `127.0.0.1`.** Production must extract the real client IP from the request headers (respecting proxy configuration).

7. **The schema is defined in flat SQL files.** `schema/01_schema.sql` contains all DDL (extensions, tables, indexes, enums), `schema/02_seed_and_queries.sql` contains seed data and example queries, and `schema/99-seed/010_mock_data.sql` contains an extended mock dataset (~700 users, ~10K rows). They are applied in sort order. Terraform re-applies the schema when either file changes; there is no incremental migration tracking. The schema does not define database roles, RLS policies, or PII redaction views — these are planned for a future iteration.
