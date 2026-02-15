# 03 -- Low-Level Design: Alxderia Cloud Identity Intelligence

| Field        | Value                  |
|--------------|------------------------|
| Status       | Draft                  |
| Authors      | Engineering Team       |
| Audience     | Developers, Tech Leads |
| Last Updated | 2026-02-15             |

---

## Table of Contents

1. [Detailed Component Descriptions](#1-detailed-component-descriptions)
2. [Internal Service Interactions](#2-internal-service-interactions)
3. [Database Schema and Key Tables](#3-database-schema-and-key-tables)
4. [API Contracts](#4-api-contracts)
5. [Key Algorithms and Workflows](#5-key-algorithms-and-workflows)
6. [Configuration Patterns](#6-configuration-patterns)
7. [Dependency Graph](#7-dependency-graph)
8. [Assumptions](#8-assumptions)

---

## 1. Detailed Component Descriptions

### 1.1 Next.js App Router Layer

The application uses Next.js 15 with the App Router convention. All pages reside under `app/` and all non-route source code under `src/`.

**`app/layout.tsx`** -- Root layout. Renders the HTML skeleton, attaches Tailwind CSS, and wraps all child routes. No authentication or provider wrappers at this level; the layout is purely structural.

**`app/page.tsx`** -- Home route. Renders `ChatInterface` as the default view. No server-side data fetching; the component hydrates on the client and issues requests to `/api/chat`.

**`app/access/page.tsx`** -- Access Explorer route. Renders `AccessExplorer`, which fetches paginated data from `/api/access` on mount and on filter change.

**`app/api/chat/route.ts`** -- POST handler. Delegates to `handleChat()` in `src/server/routes/chat.ts`. Responsible only for extracting the request body and returning the response; all logic lives in the route handler.

**`app/api/access/route.ts`** -- GET handler. Delegates to `handleAccessList()`. Parses query parameters (`page`, `limit`, `provider`, `accessPath`, `search`) from the URL before forwarding.

**`app/api/people/route.ts`** -- GET handler. Delegates to `handlePeopleList()`. Same delegation pattern as above.

**`app/api/health/route.ts`** -- GET handler. Performs a lightweight connection check against the database pool and returns `{ status: "ok" }` or `{ status: "error", message }`.

### 1.2 Client Components

**`ChatInterface.tsx`** -- Manages local conversation state (message history, loading indicator, error display). On submit, posts the user question to `/api/chat` with an optional `conversationId`. On response, renders the SQL explanation, results table, narrative summary, and follow-up suggestions. Uses streaming UX patterns: a skeleton loader appears immediately and is replaced once the full response arrives.

**`AccessExplorer.tsx`** -- Paginated browser for `mv_effective_access` data. Maintains filter state for provider (`aws` | `gcp`), access path (`direct` | `group`), and free-text search. Each filter change resets the page cursor to 1 and issues a fresh GET to `/api/access`.

**`ResultsTable.tsx`** -- Generic data grid. Accepts column definitions and row data as props. Renders headers dynamically from the column array. No sorting or filtering logic; it is a pure display component.

**`Sidebar.tsx`** -- Navigation sidebar. Contains links to the chat view and the access explorer. Highlights the active route.

### 1.3 Server Components

**`llm/` (provider abstraction)** -- Defines an `LLMProvider` interface and implements it for three backends: Anthropic (`anthropic.ts`), OpenAI (`openai.ts`), and Google Gemini (`gemini.ts`). The factory in `index.ts` reads `LLM_PROVIDER` and returns a cached singleton. All providers use dynamic imports so only the selected SDK is loaded at runtime.

**`nl2sql-agent.ts`** -- The core intelligence layer. Calls the LLM provider abstraction layer via `getLLMProvider()` instead of directly importing the Anthropic SDK. Described in full in section 5.1.

**`pool.ts`** -- Wraps `pg.Pool`. On creation, sets connection defaults including `statement_timeout` and `idle_in_transaction_session_timeout`. Exposes a `withTenant(tenantId, callback)` helper that acquires a connection, issues `SET app.current_tenant_id = $1`, invokes the callback, and releases the connection in a `finally` block. Also exposes a `healthCheck()` method that runs `SELECT 1`.

**`audit.ts`** -- Middleware that logs every API request. Captures `tenant_id`, actor identity, action name, target table, target ID, detail payload, source system, and a request-scoped UUID. Computes an `integrity_hash` (SHA-256 over the concatenation of all fields) before inserting into the `audit_log` table.

**`sql-validator.ts`** -- Seven-layer validation pipeline. Described in full in section 5.2.

**`validators/` and `routes/`** -- Each route handler (`chat.ts`, `access.ts`, `people.ts`) validates input, acquires a tenant-scoped connection via `pool.withTenant()`, executes the query, and returns a shaped response. No business logic leaks into the `app/api/` thin wrappers.

### 1.4 Shared Code

**`types/index.ts`** -- All TypeScript interfaces used across client and server: `ChatRequest`, `ChatResponse`, `AccessRow`, `PersonRow`, `PaginatedResponse<T>`, `QueryPlan`, `ValidationResult`, and supporting types.

**`constants/index.ts`** -- Contains `ALLOWED_TABLES` (the set of table and view names the SQL validator permits, including all GitHub tables and `v_github_user_redacted`), `BLOCKED_KEYWORDS` (DDL/DML verbs and dangerous constructs), `BLOCKED_FUNCTIONS` (system functions that must not appear in generated SQL), `PII_TABLES` (tables containing PII including `github_user`), `REDACTED_VIEW_MAP` (mapping PII tables to redacted views), `RESULT_LIMIT` (500), and `SCHEMA_SYNONYMS` (natural-language term to table-name mappings, including GitHub synonyms).

---

## 2. Internal Service Interactions

The request flow for the chat endpoint, which is the most complex path, proceeds as follows:

```
Client (ChatInterface)
  │  POST /api/chat { question, conversationId? }
  ▼
app/api/chat/route.ts
  │  Extracts body, calls handleChat()
  ▼
src/server/routes/chat.ts — handleChat()
  │  1. Validates input (question length, character set)
  │  2. Calls audit.log("chat_query", ...)
  │  3. Calls nl2sqlAgent.processQuestion(question, tenantId)
  ▼
src/server/agents/nl2sql-agent.ts — processQuestion()
  │  1. getSchemaContext()       → queries information_schema, caches
  │  2. getSynonymContext()      → maps NL terms
  │  3. buildSystemPrompt()     → assembles full prompt
  │  4. Calls LLM Provider      → receives { sql, explanation }
  │  5. sqlValidator.validate()  → 7-layer check
  │  6. pool.withTenant()        → executes validated SQL
  │  7. generateNarrative()     → enriches results
  │  8. Returns ChatResponse
  ▼
app/api/chat/route.ts
  │  Returns JSON response to client
  ▼
Client (ChatInterface)
  │  Renders results, narrative, follow-up suggestions
```

For the access and people endpoints, the flow is simpler: the route handler parses pagination and filter parameters, builds a parameterised query against `mv_effective_access` or the `person` table respectively, executes it within a tenant-scoped connection, and returns a `PaginatedResponse<T>`.

The health endpoint bypasses tenant scoping entirely and runs a bare `SELECT 1` against the pool.

---

## 3. Database Schema and Key Tables

### 3.1 Core Entities

| Table | Primary Key | Tenant-Scoped | Purpose |
|-------|-------------|---------------|---------|
| `cloud_provider` | `id` (serial) | No | Reference data: AWS, GCP, GitHub codes and display names |
| `tenant` | `id` (UUID) | No | Top-level organisational unit |
| `person` | `id` (UUID) | Yes | Central identity record; links to all provider identities |
| `person_link` | Composite (`person_id`, `identity_type`, `provider_code`) | Yes | Audit trail for identity linkage with confidence scores |

The `person` table is the hub of the identity graph. Every provider-specific user record holds a `person_id` foreign key pointing back to it.

### 3.2 AWS Tables

- **`aws_account`** -- One row per AWS account. Stores the 12-digit `account_id`, human-readable `account_name`, and the Organisational Unit path (`ou_path`).
- **`aws_iam_user`** -- IAM users. Linked to `person` via `person_id`. Stores `arn` and `last_seen_at` for dormancy detection.
- **`aws_iam_user_policy_attachment`** -- Join table between IAM users and managed policies. Stores both the `policy_arn` and a denormalised `policy_name` for query convenience.
- **`aws_idc_user`** -- AWS Identity Centre users. Linked to `person`. Includes `disabled_at` for deprovisioning tracking.
- **`aws_idc_group`** -- Identity Centre groups.
- **`aws_idc_group_membership`** -- Soft-deletable membership join. `deleted_at` supports temporal queries.
- **`aws_idc_permission_set`** -- Permission sets identified by ARN.
- **`aws_idc_account_assignment`** -- The critical access grant table. Links an account, a permission set, and a principal (either a user or a group). `principal_type` discriminates between the two nullable foreign keys.

### 3.3 GCP Tables

- **`gcp_project`** -- One row per GCP project.
- **`gcp_workspace_user`** -- Google Workspace users linked to `person`.
- **`gcp_workspace_group`** and **`gcp_workspace_group_membership`** -- Group structure, mirroring the AWS pattern.
- **`gcp_iam_binding`** -- IAM role bindings at project level. `principal_type` discriminates between user and group principals.

### 3.3b GitHub Tables

- **`github_organisation`** -- One row per GitHub organisation. Stores `github_org_id` (GitHub's numeric ID), `login`, `display_name`, `plan`, and `two_factor_requirement_enabled`.
- **`github_user`** -- GitHub users linked to `person` via `person_id` (nullable; null for noreply-email users). Stores `github_user_id`, `login`, `email`, `two_factor_enabled`.
- **`github_team`** -- Teams within an organisation. Supports nested teams via self-referencing `parent_team_id`. Stores `slug`, `privacy` (secret/closed).
- **`github_team_membership`** -- Join table linking `github_user` to `github_team` with `membership_role` (member/maintainer).
- **`github_org_membership`** -- Organisation-level membership linking `github_user` to `github_organisation` with `role` (member/admin) and `state` (active/pending).

All GitHub tables follow the same patterns as AWS/GCP tables: UUID primary keys, `tenant_id` FK, `source_of_truth`, `ingested_at`, `last_seen_at`, `deleted_at`, and `raw_payload JSONB`. RLS tenant isolation policies and role grants are applied via `060_github_post_setup.sql`.

### 3.4 Materialised View: `mv_effective_access`

This view is the primary query target for the NL2SQL agent and the Access Explorer. It is a `UNION ALL` of four queries:

1. **AWS direct** -- Joins `aws_idc_account_assignment` (where `principal_type = 'USER'`) through to `person`, `aws_account`, and `aws_idc_permission_set`.
2. **AWS group** -- Same join path but through `aws_idc_group_membership` and `aws_idc_group`.
3. **GCP direct** -- Joins `gcp_iam_binding` (where `principal_type = 'USER'`) through to `person` and `gcp_project`.
4. **GCP group** -- Same join path but through `gcp_workspace_group_membership` and `gcp_workspace_group`.

Output columns: `person_id`, `tenant_id`, `cloud_provider`, `account_or_project_id`, `account_or_project_name`, `role_or_permission_set`, `access_path` (`'direct'` or `'group'`), `via_group_name` (null for direct), `last_seen_at`.

The view must be refreshed explicitly after ingestion runs. It is not incrementally maintained.

### 3.5 History and Audit

**`entity_history`** -- Partitioned by month. Each row records a state change for any entity. `state_payload` holds the full entity state as JSONB; `delta_payload` holds only the changed fields. Rows are hash-chained: `integrity_hash = SHA-256(entity_type || entity_id || event_action || state_payload || previous_hash)`. The `previous_hash` for the first event of a given entity is a well-known seed value.

**`audit_log`** -- Partitioned by quarter. Records API-level actions rather than entity-level mutations. Each row carries its own `integrity_hash` computed over all non-hash fields.

**`snapshot_registry`** -- Tracks point-in-time snapshots of materialised views or table exports, with timestamps and metadata.

### 3.6 DLP Layer

- **`retention_policy`** -- Configurable per-table retention periods.
- **`legal_hold`** -- Prevents deletion of records matching hold criteria.
- **Redacted views** (`v_person_redacted`, `v_aws_idc_user_redacted`, `v_gcp_workspace_user_redacted`, `v_effective_access_redacted`, `v_github_user_redacted`) -- Apply `_redact_email()` and `_redact_name()` to PII columns. The `cloudintel_readonly` role is granted access only to these views.
- **`_redact_email(email)`** -- Returns `SHA-256(local_part)@domain`. The domain is preserved for operational utility; the local part is irreversibly hashed.
- **`_redact_name(name)`** -- Returns the first character, a fixed-length mask, and the last character.

### 3.7 Security Roles and RLS

Six database roles enforce least-privilege access:

| Role | Capabilities |
|------|-------------|
| `cloudintel_admin` | `BYPASSRLS`. Full DDL and DML. Schema migrations and emergency access. |
| `cloudintel_ingest` | INSERT, UPDATE, DELETE on operational tables. INSERT-only on `audit_log` and `entity_history` (append-only). |
| `cloudintel_analyst` | SELECT on operational tables and materialised views. No access to audit tables. |
| `cloudintel_readonly` | SELECT on redacted views only. Cannot see raw PII. |
| `cloudintel_audit` | SELECT on `audit_log` and `entity_history` only. For compliance review. |
| `cloudintel_app` | LOGIN role. Inherits `cloudintel_ingest`. Used by the application connection pool. |

Row-Level Security is enabled and forced on every tenant-scoped table. The policy predicate is:

```sql
tenant_id = current_setting('app.current_tenant_id')::UUID
```

The application sets this via `SET app.current_tenant_id = $1` at the start of each connection lease, as implemented in `pool.withTenant()`.

---

## 4. API Contracts

### 4.1 POST /api/chat

**Request:**

```json
{
  "question": "Who has admin access to the production AWS account?",
  "conversationId": "optional-uuid"
}
```

**Response (`ChatResponse`):**

```json
{
  "id": "uuid",
  "queryPlan": { "tables": [...], "estimatedRows": 42 },
  "sql": "SELECT ... FROM mv_effective_access WHERE ...",
  "results": [ { "person_id": "...", "cloud_provider": "aws", ... } ],
  "narrative": "There are 12 individuals with admin-level access...",
  "explanation": "I queried the effective access view filtering by...",
  "metadata": { "rowCount": 12, "executionTimeMs": 87 },
  "followUpSuggestions": [
    "Which of these users last accessed the account more than 90 days ago?",
    "Show me the group memberships that grant this access."
  ],
  "clarificationNeeded": null
}
```

If the agent cannot resolve the question to a valid query, `clarificationNeeded` is populated with a string and `sql`, `results`, and `narrative` are null.

### 4.2 GET /api/access

**Query parameters:** `page` (default 1), `limit` (default 50, max 200), `provider` (`aws` | `gcp`, optional), `accessPath` (`direct` | `group`, optional), `search` (free-text, optional).

**Response:** `PaginatedResponse<AccessRow>` with fields `data`, `page`, `limit`, `total`, `totalPages`.

### 4.3 GET /api/people

**Query parameters:** `page` (default 1), `limit` (default 50, max 200), `search` (free-text, optional).

**Response:** `PaginatedResponse<PersonRow>`.

### 4.4 GET /api/health

**Response:** `{ "status": "ok" }` or `{ "status": "error", "message": "Connection refused" }`.

---

## 5. Key Algorithms and Workflows

### 5.1 NL2SQL Pipeline

The `processQuestion()` method in `nl2sql-agent.ts` executes the following steps:

1. **Schema context retrieval** -- `getSchemaContext()` queries `information_schema.columns` and `pg_matviews` to build a text representation of all tables, their columns, and types. The result is cached in-process after the first call; cache invalidation is manual (application restart).

2. **Synonym mapping** -- `getSynonymContext()` reads `SYNONYM_MAP` from constants and formats it as a lookup block for the prompt. This maps terms such as "permissions", "entitlements", and "access rights" to `mv_effective_access`, and "employees", "staff", and "users" to `person`.

3. **System prompt assembly** -- `buildSystemPrompt()` concatenates the schema context, synonym context, four few-shot examples, and ten mandatory rules. The rules include: always use `mv_effective_access` for access queries; never use subqueries against `entity_history`; always return `person_id`; never use `SELECT *`; always alias columns for readability.

4. **LLM invocation** -- Calls the configured LLM provider via `getLLMProvider().complete()`. The provider is selected by `LLM_PROVIDER` (default: `anthropic`). The model can be overridden via `LLM_MODEL`. The call includes a system prompt, user message containing the natural-language question, and `maxTokens: 4096`. The expected response format is a JSON object with `sql` and `explanation` fields.

5. **Response parsing** -- Extracts the JSON from the LLM response. If parsing fails, returns a `clarificationNeeded` response.

6. **SQL validation** -- Passes the extracted SQL through the seven-layer validator (section 5.2). If validation fails, returns the validation error to the user without executing.

7. **Tenant-scoped execution** -- Calls `pool.withTenant(tenantId, async (client) => client.query(validatedSql))`. The RLS policy ensures the query can only see data belonging to the current tenant.

8. **Narrative generation** -- `generateNarrative()` analyses the result set to produce a human-readable summary. It computes cloud provider distribution (percentage of rows per provider) and access path breakdown (direct versus group). The narrative is a plain-text paragraph, not Markdown.

### 5.2 SQL Validation Pipeline

The validator in `sql-validator.ts` applies seven layers in sequence. Failure at any layer halts processing and returns the error.

| Layer | Method | Purpose |
|-------|--------|---------|
| 1 | `stripComments()` | Removes `--` line comments and `/* */` block comments to prevent obfuscation. |
| 2 | `checkBlockedKeywords()` | Scans for `BLOCKED_KEYWORDS` (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT, REVOKE, COPY, EXECUTE, and others). Also rejects input containing semicolons (multiple statements). |
| 3 | Parse via `libpg-query` | Parses the SQL using the WASM build of the actual PostgreSQL parser. Rejects syntactically invalid SQL. |
| 4 | Statement type check | Inspects the AST root. Only `SelectStmt` nodes are permitted. |
| 5 | `extractTableRefs()` | Recursively walks the AST collecting all `RangeVar` nodes. CTE names (from `WithClause`) are excluded from the collected set. Each table reference is checked against `ALLOWED_TABLES`. System catalogue prefixes (`pg_`, `information_schema`) are explicitly rejected. |
| 6 | `extractFunctionCalls()` | Recursively walks the AST collecting all `FuncCall` nodes. Each function name is checked against `BLOCKED_FUNCTIONS` (which includes `pg_read_file`, `pg_ls_dir`, `lo_import`, `dblink`, `set_config`, and others). |
| 7 | Auto-LIMIT enforcement | If the parsed AST does not contain a `LIMIT` clause, the SQL is wrapped as `SELECT * FROM (<original_sql>) AS _limited LIMIT 500`. |

### 5.3 RLS Execution Model

Every tenant-scoped query follows this connection lifecycle:

```
1. pool.connect()                    → acquire connection from pg.Pool
2. SET app.current_tenant_id = $1    → parameterised; sets session variable
3. Execute application query         → RLS policies filter by tenant_id
4. client.release()                  → return connection to pool (in finally block)
```

The `SET` command uses a parameterised call to prevent injection. The `finally` block in `withTenant()` guarantees connection release even if the query throws. The session variable is connection-scoped, so it does not leak between requests that share the pool.

### 5.4 Hash Chain Computation (Entity History)

Each row in `entity_history` carries an `integrity_hash` and a `previous_hash`. The chain is computed as follows:

```
integrity_hash = SHA-256(
    entity_type || '|' ||
    entity_id   || '|' ||
    event_action || '|' ||
    state_payload::text || '|' ||
    previous_hash
)
```

For the first event of a given entity, `previous_hash` is set to a well-known seed: `SHA-256('GENESIS')`. Verification of chain integrity proceeds by replaying events for a given `(entity_type, entity_id)` pair in chronological order and confirming that each row's `previous_hash` matches the preceding row's `integrity_hash`.

---

## 6. Configuration Patterns

### 6.1 TypeScript Path Aliases

`tsconfig.json` maps `@/*` to `./src/*`. All imports within the `src/` directory tree use this alias. Imports from `app/` use relative paths.

### 6.2 Next.js Configuration

`next.config.ts` sets `output: 'standalone'` for Docker deployments and lists `pg` and `libpg-query` in `serverExternalPackages` to prevent them from being bundled by webpack (they contain native or WASM binaries).

### 6.3 Docker Build

The `Dockerfile` uses a three-stage build:

1. **deps** -- Installs `node_modules` from `package.json` and lockfile.
2. **build** -- Copies source, runs `next build`, produces the standalone output.
3. **runner** -- Copies only the standalone output, `public/`, and `.next/static/`. Runs as a non-root user. Exposes port 3000.

### 6.4 Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `LLM_API_KEY` | API key for the configured LLM provider (falls back to ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY) |
| `LLM_PROVIDER` | LLM backend: anthropic, openai, or gemini (default: anthropic) |
| `LLM_MODEL` | Model identifier override (provider-specific, e.g. claude-sonnet-4-5-20250929, gpt-4o, gemini-2.5-pro) |
| `DEFAULT_TENANT_ID` | Fallback tenant for development |
| `NODE_ENV` | `production` or `development` |

No environment variables are committed to the repository. A `.env.example` file documents the expected keys without values.

---

## 7. Dependency Graph

```
app/api/chat/route.ts
  └─► src/server/routes/chat.ts
        ├─► src/server/agents/nl2sql-agent.ts
        │     ├─► src/server/llm/             (LLM provider abstraction)
        │     │     ├─► @anthropic-ai/sdk     (dynamic import)
        │     │     ├─► openai                (dynamic import)
        │     │     └─► @google/genai         (dynamic import)
        │     ├─► src/server/validators/sql-validator.ts
        │     │     └─► libpg-query           (PostgreSQL parser, WASM)
        │     ├─► src/server/db/pool.ts
        │     │     └─► pg                    (PostgreSQL client)
        │     └─► src/shared/constants/index.ts
        └─► src/server/middleware/audit.ts
              └─► src/server/db/pool.ts

app/api/access/route.ts
  └─► src/server/routes/access.ts
        └─► src/server/db/pool.ts

app/api/people/route.ts
  └─► src/server/routes/people.ts
        └─► src/server/db/pool.ts

app/page.tsx
  └─► src/client/components/ChatInterface.tsx
        └─► src/client/components/ResultsTable.tsx

app/access/page.tsx
  └─► src/client/components/AccessExplorer.tsx
        └─► src/client/components/ResultsTable.tsx

app/layout.tsx
  └─► src/client/components/Sidebar.tsx
```

Key external dependencies and their roles:

| Package | Version Constraint | Role |
|---------|--------------------|------|
| `next` | 15.x | Application framework, routing, build |
| `react` | 19.x | UI rendering |
| `pg` | 8.x | PostgreSQL wire protocol client |
| `@anthropic-ai/sdk` | ^0.39 | Anthropic Claude provider (dynamic import) |
| `openai` | ^4.80 | OpenAI GPT provider (dynamic import) |
| `@google/genai` | ^1.0 | Google Gemini provider (dynamic import) |
| `libpg-query` | 2.x (WASM) | SQL parsing and AST generation |
| `vitest` | dev | Test runner |

---

## 8. Assumptions

1. **Single-region deployment.** The application and database are co-located in the same region. Cross-region latency is not accounted for in timeout budgets.

2. **Tenant ID is always available.** Every authenticated request carries a tenant identifier. The application does not support cross-tenant queries. The `DEFAULT_TENANT_ID` variable exists only for local development.

3. **Materialised view refresh is external.** The application does not trigger `REFRESH MATERIALIZED VIEW`. This is handled by the ingestion pipeline or a scheduled job. Queries against `mv_effective_access` may return stale data between refreshes.

4. **LLM API availability.** The NL2SQL pipeline depends on the configured LLM provider API (Anthropic, OpenAI, or Google Gemini). The system is provider-agnostic but does not automatically fall back to alternative providers if the configured API is unreachable or rate-limited. The chat endpoint returns an error in such cases. Future iterations may implement cross-provider fallback logic.

5. **libpg-query WASM compatibility.** The WASM build of `libpg-query` is assumed to support the same SQL grammar as the target PostgreSQL version (16.x). Dialect mismatches between the parser and the running database are considered unlikely but not impossible.

6. **Connection pool sizing.** The `pg.Pool` default of 10 connections is assumed sufficient for expected concurrency. Under heavy load, connection exhaustion would manifest as request timeouts. Pool sizing should be tuned based on observed usage.

7. **No write operations through the API.** The application's API surface is read-only (SELECT queries and audit log inserts). All data ingestion occurs through separate pipelines that use the `cloudintel_ingest` role directly.

8. **Hash chain verification is offline.** The integrity of `entity_history` hash chains is verified by batch audit processes, not by the application at query time. A broken chain does not prevent reads.
