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
alxderia/
  app/          Next.js 15 application (App Router, API routes, NL2SQL agent)
  schema/       39 SQL migration files, numbered 00 through 99
  infra/        Terraform for local Docker PostgreSQL and cloud deploy modules
  docs/         Project documentation
  .github/      GitHub Actions CI/CD pipelines (5 workflows)
```

Inside `app/`, source code follows a strict server/client/shared separation:

```
app/src/
  server/
    agents/         NL2SQL agent (LLM-agnostic, schema cache)
    db/             Connection pool with RLS-aware tenant execution
    llm/            LLM provider abstraction (Anthropic, OpenAI, Gemini)
    middleware/     Audit logging (fire-and-forget)
    routes/         Handler functions for each API endpoint
    validators/     SQL security validator (libpg-query WASM parser)
  client/
    components/     React client components
  shared/
    types/          TypeScript interfaces shared across client and server
    constants/      Allow-lists, block-lists, limits, synonyms
```

API route files under `app/app/api/` are thin wrappers that delegate to the corresponding handler in `src/server/routes/`. For example, `app/api/chat/route.ts` imports and calls `handleChat` from `@server/routes/chat`.


## 2. Key Modules and Responsibilities

**`src/server/db/pool.ts`** -- Database connection pool. Exports `executeWithTenant()` which wraps every query in a transaction with `SET LOCAL app.current_tenant_id`, enforcing RLS. Also exports `executeReadOnly()` for system-level queries (e.g. schema introspection, audit writes), `getSchemaMetadata()` for live catalogue introspection, and `healthCheck()` for readiness probes.

**`src/server/llm/`** -- LLM provider abstraction layer. Defines an `LLMProvider` interface with a `complete()` method, and implements it for three backends: Anthropic Claude (`anthropic.ts`), OpenAI GPT (`openai.ts`), and Google Gemini (`gemini.ts`). The factory in `index.ts` reads the `LLM_PROVIDER` environment variable and returns a cached provider singleton. Only the selected provider's SDK is loaded at runtime via dynamic imports.

**`src/server/agents/nl2sql-agent.ts`** -- The NL2SQL agent. Builds a system prompt from live schema metadata, calls the configured LLM provider via the abstraction layer in `src/server/llm/`, parses the structured JSON response, validates the generated SQL, executes it within a tenant-scoped transaction, and returns a `ChatResponse` with narrative context. The schema context is cached in memory after the first call; call `clearSchemaCache()` after DDL changes.

**`src/server/validators/sql-validator.ts`** -- The critical security layer between LLM output and the database. Uses `libpg-query` (PostgreSQL's actual parser compiled to WASM) to parse SQL into an AST. Enforces: SELECT-only statements, table allow-list, blocked function list, blocked system-table prefixes, blocked keywords, and automatic `LIMIT` injection when absent. Defence-in-depth: comments are stripped before parsing, and a pre-parse keyword scan runs before the AST walk.

**`src/server/middleware/audit.ts`** -- Writes audit entries to the `audit_log` table. Records question text, SQL executed, row count, timing, and status. Never stores result data (data minimisation). Failures are caught and logged, never propagated to the caller.

**`src/server/routes/chat.ts`** -- The chat endpoint handler. Validates the request body, enforces question length limits, calls `processQuestion()`, records the audit entry (fire-and-forget), and returns the response. Uses a hardcoded mock session in the current implementation.

**`src/shared/constants/index.ts`** -- Security-critical configuration: `ALLOWED_TABLES` (includes all GitHub tables and `v_github_user_redacted`), `BLOCKED_FUNCTIONS`, `BLOCKED_KEYWORDS`, `BLOCKED_TABLE_PREFIXES`, `PII_TABLES` (includes `github_user`), `REDACTED_VIEW_MAP` (maps `github_user` to `v_github_user_redacted`), `SCHEMA_SYNONYMS` (includes GitHub synonyms), and numeric limits (`MAX_ROWS`, `QUERY_TIMEOUT_MS`, `MAX_QUESTION_LENGTH`, `RATE_LIMIT_PER_MINUTE`).

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

This starts a PostgreSQL 16 container (`cloud-intel-postgres`) on port 5432 with a persistent Docker volume. Terraform applies all SQL files from `schema/` in sorted order automatically. When any `.sql` file changes, re-running `terraform apply` will re-apply the full schema.

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

The test suite uses Vitest 3.0. There are currently 32 tests: 28 covering the SQL validator and 4 covering the chat route handler. Tests live in `app/tests/server/`.

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

The Schema Validation job in CI spins up a PostgreSQL 16 service container, applies all 39 SQL files in sorted order, and verifies: all expected tables exist, seed data counts are correct, RLS is enabled on all tenant-scoped tables, and redaction views are present.


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

### 5.4 RLS tenant isolation pattern

Every user-facing database query must go through `executeWithTenant(tenantId, sql, params)`. This function:

1. Acquires a client from the pool.
2. Opens a transaction with `BEGIN`.
3. Sets `SET LOCAL statement_timeout` and `SET LOCAL app.current_tenant_id`.
4. Executes the query.
5. Commits (or rolls back on error).
6. Releases the client.

The `SET LOCAL` ensures the tenant context is scoped to the transaction and automatically cleared on commit or rollback. PostgreSQL RLS policies on all entity tables filter rows by `tenant_id = current_setting('app.current_tenant_id')::uuid`.

### 5.5 Audit pattern

Audit logging is fire-and-forget: `recordAuditEntry(...).catch(() => {})`. This ensures a failure in the audit pipeline never degrades the primary query flow. Both successful and failed queries are audited. Result data is never stored in the audit log, only metadata (question, SQL, row count, timing, status).

### 5.6 API route delegation

Route files under `app/api/` are kept deliberately thin. Each exports a single HTTP method handler that delegates to a function in `src/server/routes/`:

```typescript
// app/api/chat/route.ts
import { handleChat } from '../../../src/server/routes/chat';
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

1. Create a new `.sql` file in the appropriate numbered directory under `schema/` (e.g. `schema/02-aws/09-aws-new-entity.sql`). The file sort order determines execution order.
2. If the table should be queryable by the NL2SQL agent, add its name to `ALLOWED_TABLES` in `src/shared/constants/index.ts`.
3. If the table contains PII, add it to `PII_TABLES` and create a redacted view, adding the mapping to `REDACTED_VIEW_MAP`.
4. If the table is commonly referred to by alternative names, add entries to `SCHEMA_SYNONYMS`.
5. Re-run `terraform apply` in `infra/` to apply the schema change.
6. Call `clearSchemaCache()` or restart the application so the NL2SQL agent picks up the new table metadata.

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

1. **Authentication is mocked.** The `getSession()` function in `src/server/routes/chat.ts` returns a hardcoded demo user with tenant ID `a0000000-0000-0000-0000-000000000001`. Production requires replacing this with Auth.js or an equivalent session provider. All downstream code already accepts tenantId and role as parameters.

2. **Schema cache is in-memory and per-process.** The NL2SQL agent caches schema metadata after the first query. In a multi-instance deployment, each instance maintains its own cache. After schema migrations, either restart all instances or expose an endpoint that calls `clearSchemaCache()`.

3. **Audit logging is best-effort.** Audit writes use `executeReadOnly()` (not tenant-scoped) and failures are swallowed. The audit pipeline does not guarantee delivery. For strict compliance requirements, consider a write-ahead log or message queue.

4. **The SQL validator is the sole security boundary.** The application trusts that if the validator passes a query, it is safe to execute. The validator enforces SELECT-only, table allow-listing, function block-listing, and automatic LIMIT injection. Any new table must be explicitly added to `ALLOWED_TABLES` before the agent can query it.

5. **Rate limiting is defined but not enforced.** `RATE_LIMIT_PER_MINUTE` is declared in constants but no middleware currently applies it. This must be implemented before production use.

6. **The `source_ip` field in audit entries is hardcoded to `127.0.0.1`.** Production must extract the real client IP from the request headers (respecting proxy configuration).

7. **All SQL migration files are applied in lexicographic sort order.** The naming convention `XX-category/NN-name.sql` ensures correct ordering. Terraform re-applies the entire schema when any file changes; there is no incremental migration tracking. Note: because `11-github/` sorts after `07-indexes/`, `08-security/`, and `10-dlp/`, GitHub-specific indexes, RLS policies, and redaction views are applied in `11-github/060_github_post_setup.sql` rather than in the earlier files.
