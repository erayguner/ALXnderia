# 03 -- Low-Level Design: Alxderia Cloud Identity Intelligence

| Field        | Value                  |
|--------------|------------------------|
| Status       | Draft                  |
| Authors      | Engineering Team       |
| Audience     | Developers, Tech Leads |
| Last Updated | 2026-02-20             |

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

**`app/api/access/route.ts`** -- GET handler. Delegates to `handleAccessList()`. Parses query parameters (`page`, `limit`, `search`, `provider`, `accessPath`) from the URL before forwarding.

**`app/api/people/route.ts`** -- GET handler. Delegates to `handlePeopleList()`. Same delegation pattern as above.

**`app/api/people/[id]/route.ts`** -- GET handler. Delegates to `handlePersonDetail()`. Returns a full canonical user record with linked identities from all providers and canonical emails.

**`app/api/groups/route.ts`** -- GET handler. Delegates to `handleGroupsList()`. Lists groups across all three providers with member counts.

**`app/api/groups/[id]/route.ts`** -- GET handler. Delegates to `handleGroupDetails()`. Returns group metadata and its members list with resolved names and emails.

**`app/api/resources/route.ts`** -- GET handler. Delegates to `handleResourcesList()`. Lists resources (GitHub repos, Google Workspace groups, AWS IDC groups) with permission/member counts.

**`app/api/audit/route.ts`** -- GET handler. Delegates to `handleAuditList()`. Returns paginated audit log entries.

**`app/api/health/route.ts`** -- GET handler. Performs a lightweight connection check against the database pool and returns `{ status: "ok" }` or `{ status: "error", message }`.

### 1.2 Client Components

**`ChatInterface.tsx`** -- Manages local conversation state (message history, loading indicator, error display). On submit, posts the user question to `/api/chat` with an optional `conversationId`. On response, renders the SQL explanation, results table, narrative summary, and follow-up suggestions. Uses streaming UX patterns: a skeleton loader appears immediately and is replaced once the full response arrives.

**`AccessExplorer.tsx`** -- Cross-provider effective access browser. Queries `/api/access` and displays unified access data from GitHub (direct + team-derived), Google Workspace (group memberships), and AWS Identity Center (group memberships). Supports provider filter, access path filter (direct/group), free-text search, CSV export, and server-side pagination. Each filter change resets the page cursor to 1.

**`GroupsList.tsx`** -- Paginated group browser across all three providers. Queries `/api/groups` with provider filter (google, aws, github), free-text search, and server-side pagination. Groups are clickable and link to `/groups/[id]?provider=...` detail page.

**`PeopleList.tsx`** -- Paginated canonical user browser. Queries `/api/people` with free-text search and server-side pagination. People are clickable and link to `/people/[id]` detail page.

**`PersonDetail.tsx`** -- Person detail view. Fetches a single canonical user record from `/api/people/[id]` and displays: header (name, email, status), accounts and access table (built from Google, AWS, and GitHub identities), linked identities, and canonical emails. Uses `ResultsTable` for data display.

**`AuditLog.tsx`** -- Paginated audit log viewer. Queries `/api/audit` with action type filter (all events or NL2SQL queries only) and server-side pagination.

**`ResourcesList.tsx`** -- Resource browser (GitHub repos, Google Workspace groups, AWS IDC groups). Queries `/api/resources` with provider filter, free-text search, and server-side pagination.

**`ResultsTable.tsx`** -- Generic data grid with dynamic column inference from row data. Supports client-side column sorting, automatic formatting of column headers (snake_case to Title Case), provider badge colouring, clickable rows via `getRowLink` prop, and automatic hiding of internal ID columns. Hides columns ending in `_id` (except `account_or_project_id`) and hides the `id` column when `getRowLink` is active.

**`AccountsList.tsx`** -- Unified AWS account and GCP project browser. Queries `/api/accounts` with provider filter (aws/gcp/all), free-text search, and server-side pagination. Displays cloud account metadata including IDs, names, status, and assignment/binding counts.

**`Sidebar.tsx`** -- Navigation sidebar with seven items: Chat, People, Resources, Accounts, Groups, Access Explorer, and Audit Log. Active route is highlighted with an indigo accent. Includes a connection status indicator at the bottom.

**`UserBadge.tsx`** -- User avatar and identity badge displayed in the header. Shows a gradient avatar with the user's initials and name/email.

### 1.3 Server Components

**`llm/` (provider abstraction)** -- Defines an `LLMProvider` interface and implements it for three backends: Anthropic (`anthropic.ts`), OpenAI (`openai.ts`), and Google Gemini (`gemini.ts`). The factory in `index.ts` reads `LLM_PROVIDER` and returns a cached singleton. All providers use dynamic imports so only the selected SDK is loaded at runtime.

**`nl2sql-agent.ts`** -- The core intelligence layer. Calls the LLM provider abstraction layer via `getLLMProvider()` instead of directly importing the Anthropic SDK. Described in full in section 5.1.

**`pool.ts`** -- Wraps `pg.Pool`. On creation, sets connection defaults including `statement_timeout` and `idle_in_transaction_session_timeout`. Exposes a `withTenant(tenantId, callback)` helper that acquires a connection, issues `SET app.current_tenant_id = $1`, invokes the callback, and releases the connection in a `finally` block. Also exposes a `healthCheck()` method that runs `SELECT 1`.

**`audit.ts`** -- Middleware that logs every API request to the console. Records tenant_id, actor identity, action name, question, status, and timing. Currently console-only; production should write to a dedicated audit table.

**`sql-validator.ts`** -- Seven-layer validation pipeline. Described in full in section 5.2.

**`validators/` and `routes/`** -- Each route handler (`chat.ts`, `access.ts`, `accounts.ts`, `people.ts`) validates input, acquires a tenant-scoped connection via `pool.withTenant()`, executes the query, and returns a shaped response. No business logic leaks into the `app/api/` thin wrappers.

### 1.4 Shared Code

**`types/index.ts`** -- All TypeScript interfaces used across client and server: `ChatRequest`, `ChatResponse`, `AccessRow`, `PersonRow`, `PaginatedResponse<T>`, `QueryPlan`, `ValidationResult`, and supporting types.

**`constants/index.ts`** -- Contains `ALLOWED_TABLES` (the set of table names the SQL validator permits, including all Google Workspace, AWS Identity Center, GitHub, and canonical identity tables), `BLOCKED_KEYWORDS` (DDL/DML verbs and dangerous constructs), `BLOCKED_FUNCTIONS` (system functions that must not appear in generated SQL), `PII_TABLES` (tables containing PII), `REDACTED_VIEW_MAP` (placeholder for future redacted views), `SCHEMA_SYNONYMS` (natural-language term to table-name mappings), and numeric limits (`MAX_ROWS`, `QUERY_TIMEOUT_MS`, `MAX_QUESTION_LENGTH`, `RATE_LIMIT_PER_MINUTE`).

---

## 2. Internal Service Interactions

The request flow for the chat endpoint, which is the most complex path, proceeds as follows:

```
Client (ChatInterface)
  |  POST /api/chat { question, conversationId? }
  v
app/api/chat/route.ts
  |  Extracts body, calls handleChat()
  v
src/server/routes/chat.ts -- handleChat()
  |  1. Validates input (question length, character set)
  |  2. Calls audit.log("chat_query", ...)
  |  3. Calls nl2sqlAgent.processQuestion(question, tenantId)
  v
src/server/agents/nl2sql-agent.ts -- processQuestion()
  |  1. getSchemaContext()       -> queries information_schema, caches
  |  2. getSynonymContext()      -> maps NL terms
  |  3. buildSystemPrompt()     -> assembles full prompt
  |  4. Calls LLM Provider      -> receives { sql, explanation }
  |  5. sqlValidator.validate()  -> 7-layer check
  |  6. pool.withTenant()        -> executes validated SQL
  |  7. generateNarrative()     -> enriches results
  |  8. Returns ChatResponse
  v
app/api/chat/route.ts
  |  Returns JSON response to client
  v
Client (ChatInterface)
  |  Renders results, narrative, follow-up suggestions
```

For the access and people endpoints, the flow is simpler: the route handler parses pagination and filter parameters, builds a parameterised query against the relevant tables, executes it within a tenant-scoped connection, and returns a `PaginatedResponse<T>`.

The health endpoint bypasses tenant scoping entirely and runs a bare `SELECT 1` against the pool.

---

## 3. Database Schema and Key Tables

The schema is defined in `schema/01_schema.sql` (identity DDL), `schema/02_cloud_resources.sql` (cloud resource DDL: AWS accounts, GCP projects, `resource_access_grants`), `schema/02_seed_and_queries.sql` (seed data and example queries), `schema/99-seed/010_mock_data.sql` (extended identity mock), and `schema/99-seed/020_cloud_resources_seed.sql` (cloud resource mock).

### 3.1 Canonical Identity Layer

| Table | Primary Key | Tenant-Scoped | Purpose |
|-------|-------------|---------------|---------|
| `canonical_users` | `(id, tenant_id)` | Yes | Central identity record for each person |
| `canonical_emails` | `(id, tenant_id)` | Yes | Email addresses linked to canonical users |
| `canonical_user_provider_links` | `(id, tenant_id)` | Yes | Maps canonical users to provider-specific identities |
| `identity_reconciliation_queue` | `(id, tenant_id)` | Yes | Tracks unmatched identities needing manual review |

The `canonical_users` table is the hub of the identity graph. Provider-specific user records are linked via `canonical_user_provider_links` using `provider_type` (enum: GOOGLE_WORKSPACE, AWS_IDENTITY_CENTER, GITHUB) and `provider_user_id`.

### 3.2 Google Workspace Tables

- **`google_workspace_users`** -- One row per Google Workspace user. Identified by `google_id`. Stores `primary_email`, `name_full`, admin status (`is_admin`, `is_delegated_admin`), 2FA status (`is_enrolled_in_2sv`, `is_enforced_in_2sv`), suspension/archive state, `suspension_reason`, `customer_id`, `org_unit_path`, and `last_login_time`.
- **`google_workspace_groups`** -- Workspace groups identified by `google_id`. Stores `email`, `name`, `description`, and `direct_members_count`.
- **`google_workspace_memberships`** -- Links groups (by `group_id` = google group ID) to members (by `member_id` = google user ID). `member_type` can be USER, GROUP, EXTERNAL, or CUSTOMER. Stores `member_email` for identity resolution of external members.

### 3.3 AWS Identity Center Tables

- **`aws_identity_center_users`** -- Identity Center users identified by `identity_store_id` + `user_id`. Stores `user_name`, `display_name`, `active` status, `user_status` (ENABLED/DISABLED), `email`, `given_name`, and `family_name`.
- **`aws_identity_center_groups`** -- Groups scoped by `identity_store_id` + `group_id`. Stores `display_name`, `description`.
- **`aws_identity_center_memberships`** -- Links groups to users via `identity_store_id`, `group_id`, and `member_user_id`.

### 3.4 GitHub Tables

- **`github_organisations`** -- One row per GitHub organisation. Identified by `node_id` and `github_id` (BIGINT). Stores `login`, `name`, `email`.
- **`github_users`** -- GitHub users identified by `node_id` and `github_id`. Stores `login`, `name`, `email`, `type` (User/Bot), `site_admin`, and `avatar_url`.
- **`github_teams`** -- Teams within an organisation. Identified by `node_id`. Stores `name`, `slug`, `description`, `privacy`, `permission` (default permission level), and self-referencing `parent_team_id`/`parent_team_node_id`.
- **`github_org_memberships`** -- Links users to organisations via `org_node_id` and `user_node_id`. `role` is 'member' or 'admin'.
- **`github_team_memberships`** -- Links users to teams via `team_node_id` and `user_node_id`. `role` is 'member' or 'maintainer'. `state` tracks membership status (active/pending).
- **`github_repositories`** -- Repositories within an organisation. Stores `name`, `full_name`, `private`, `visibility`, `archived`, `default_branch`, `description`, `fork`, `language`, and `pushed_at`.
- **`github_repo_team_permissions`** -- Links repos to teams with a `permission` level.
- **`github_repo_collaborator_permissions`** -- Links repos to individual users with `permission` and `is_outside_collaborator` flag.

### 3.5 AWS Account Tables

- **`aws_accounts`** -- AWS Organisation member accounts. Identified by `account_id` (12-digit). Stores `name`, `email` (root account), `status` (ACTIVE/SUSPENDED), `joined_method` (CREATED/INVITED), `org_id`, and `parent_id` (OU).
- **`aws_account_assignments`** -- IAM Identity Center account assignments. Maps a principal (user or group via `principal_type` + `principal_id`) to an AWS account via a `permission_set_arn`. Stores `permission_set_name` for readability.

### 3.6 GCP Tables

- **`gcp_organisations`** -- GCP organisations. Identified by `org_id` (e.g. `organizations/123456789012`). Stores `display_name`, `domain`, and `lifecycle_state`.
- **`gcp_projects`** -- GCP projects. Identified by `project_id` (slug) and `project_number`. Stores `display_name`, `lifecycle_state`, `org_id`, `folder_id`, and `labels` (JSONB).
- **`gcp_project_iam_bindings`** -- Project-level IAM policy bindings. Links a `member_type` + `member_id` (user email or group email) to a project via a `role`. Supports optional IAM conditions (`condition_expression`, `condition_title`).

### 3.7 Cross-Provider Permissions Matrix

- **`resource_access_grants`** -- Denormalised table populated by sync jobs. Represents effective, resolved access across all providers. Columns: `provider` (aws/gcp/github), `resource_type` (account/project/repository), `resource_id`, `subject_type` (user/group/team/service_account), `subject_provider_id`, `canonical_user_id` (resolved where possible), `role_or_permission`, `access_path` (direct/group/inherited), and `via_group_id`/`via_group_display_name` for group-expanded grants.

### 3.8 Provider Type Enum

A PostgreSQL enum `provider_type_enum` with values: `GOOGLE_WORKSPACE`, `AWS_IDENTITY_CENTER`, `GITHUB`. Used by `canonical_user_provider_links` and `identity_reconciliation_queue`.

### 3.9 Multi-Tenancy Model

All tables use composite primary keys `(id, tenant_id)` for partition-friendliness. Every table has a `tenant_id UUID NOT NULL` column. The application sets `app.current_tenant_id` via `SET LOCAL` at the start of each connection lease. RLS policies should be added in production.

### 3.10 Common Columns

All provider tables share these metadata/audit columns:
- `raw_response JSONB` -- Full API response for data fidelity
- `created_at`, `updated_at` -- Timestamps
- `last_synced_at` -- Last sync from provider API
- `deleted_at` -- Soft-delete marker

---

## 4. API Contracts

### 4.1 POST /api/chat

**Request:**

```json
{
  "question": "Show all GitHub org admins",
  "conversationId": "optional-uuid"
}
```

**Response (`ChatResponse`):**

```json
{
  "id": "uuid",
  "queryPlan": { "tables": [...], "estimatedRows": 42 },
  "sql": "SELECT ... FROM github_org_memberships WHERE ...",
  "results": [ { "login": "...", "role": "admin", ... } ],
  "narrative": "There are 3 GitHub organisation admins...",
  "explanation": "I queried github_org_memberships filtering by...",
  "metadata": { "rowCount": 3, "executionTimeMs": 87 },
  "followUpSuggestions": [
    "Which teams do these admins belong to?",
    "Show their linked canonical identities."
  ],
  "clarificationNeeded": null
}
```

### 4.2 GET /api/access

**Query parameters:** `page` (default 1), `limit` (default 50, max 100), `search` (free-text, optional), `provider` (github|google|aws, optional), `accessPath` (direct|group, optional).

**Response:** `PaginatedResponse` with cross-provider effective access data. Each row contains: `display_name`, `primary_email`, `cloud_provider`, `account_or_project_id`, `account_or_project_name`, `role_or_permission_set`, `access_path` (direct or group), `via_group_name`, `person_id`. Data is aggregated via UNION ALL across GitHub direct collaborator permissions, GitHub team-derived permissions, Google Workspace group memberships, and AWS Identity Center group memberships.

### 4.3 GET /api/people

**Query parameters:** `page` (default 1), `limit` (default 50, max 100), `search` (free-text, optional).

**Response:** `PaginatedResponse` with `canonical_users` data: `id`, `full_name`, `primary_email`, `identity_count`.

### 4.4 GET /api/people/[id]

**Response:** Full canonical user with linked identities from all providers (Google, AWS IDC, GitHub) and canonical emails.

### 4.5 GET /api/resources

**Query parameters:** `page`, `limit`, `search`, `provider` (github|google|aws).

**Response:** `PaginatedResponse` with resources from the selected provider: GitHub repositories (with collaborator and team permission counts), Google Workspace groups (with member counts), or AWS Identity Center groups (with member counts).

### 4.6 GET /api/groups

**Query parameters:** `page`, `limit`, `search`, `provider` (google|aws|github).

**Response:** `PaginatedResponse` with groups/teams from all three providers, including `member_count`. Groups are identifiable by `id` and `provider` fields.

### 4.7 GET /api/groups/[id]

**Query parameters:** `provider` (google|aws|github, optional -- helps resolve ambiguity).

**Response:** `{ group: GroupDetails, members: Member[] }`. Group details include `id`, `name`, `description`, `email`, `provider`, `last_synced_at`. Members include `id`, `name`, `email`, `role`, `status`, `member_type`, `user_id`. For Google Workspace, member names are resolved by joining `google_workspace_memberships.member_id` to `google_workspace_users.google_id`.

### 4.8 GET /api/audit

**Query parameters:** `page`, `limit`, `action` (optional, e.g. `NL2SQL_QUERY`).

**Response:** `PaginatedResponse` with audit log entries: `id`, `event_time`, `actor`, `action`, `target_table`, `question`, `query_status`, `row_count`, `duration_ms`.

### 4.9 GET /api/accounts

**Query parameters:** `page` (default 1), `limit` (default 50, max 100), `search` (free-text, optional), `provider` (aws|gcp, optional).

**Response:** `PaginatedResponse` with unified AWS account and GCP project data. AWS rows include: `account_id`, `name`, `email`, `status`, `org_id`, `assignment_count`. GCP rows include: `project_id`, `project_number`, `display_name`, `lifecycle_state`, `org_id`, `binding_count`. All rows include a `provider` field.

### 4.10 GET /api/health

**Response:** `{ "status": "ok" }` or `{ "status": "error", "message": "Connection refused" }`.

---

## 5. Key Algorithms and Workflows

### 5.1 NL2SQL Pipeline

The `processQuestion()` method in `nl2sql-agent.ts` executes the following steps:

1. **Schema context retrieval** -- `getSchemaContext()` queries `information_schema.columns` and `pg_matviews` to build a text representation of all tables, their columns, and types. The result is cached in-process after the first call; cache invalidation is manual (application restart).

2. **Synonym mapping** -- `getSynonymContext()` reads `SCHEMA_SYNONYMS` from constants and formats it as a lookup block for the prompt. This maps terms such as "user", "person", "employee" to `canonical_users`, and "repo", "repository" to `github_repositories`.

3. **System prompt assembly** -- `buildSystemPrompt()` concatenates the schema context, synonym context, six few-shot examples, and eight mandatory rules. The rules include: always generate SELECT only; use ILIKE for searches; always add ORDER BY and LIMIT.

4. **LLM invocation** -- Calls the configured LLM provider via `getLLMProvider().complete()`. The provider is selected by `LLM_PROVIDER` (default: `anthropic`). The call includes a system prompt, user message, and `maxTokens: 4096`. The expected response format is a JSON object.

5. **Response parsing** -- Extracts the JSON from the LLM response. If parsing fails, returns a `clarificationNeeded` response.

6. **SQL validation** -- Passes the extracted SQL through the seven-layer validator (section 5.2). If validation fails, returns the validation error to the user without executing.

7. **Tenant-scoped execution** -- Calls `pool.withTenant(tenantId, ...)`. The SET LOCAL ensures the query runs in tenant context.

8. **Narrative generation** -- `generateNarrative()` analyses the result set to produce a human-readable summary.

### 5.2 SQL Validation Pipeline

The validator in `sql-validator.ts` applies seven layers in sequence. Failure at any layer halts processing and returns the error.

| Layer | Method | Purpose |
|-------|--------|---------|
| 1 | `stripComments()` | Removes `--` line comments and `/* */` block comments to prevent obfuscation. |
| 2 | `checkBlockedKeywords()` | Scans for `BLOCKED_KEYWORDS`. Also rejects input containing semicolons (multiple statements). |
| 3 | Parse via `libpg-query` | Parses the SQL using the WASM build of the PostgreSQL parser. Rejects syntactically invalid SQL. |
| 4 | Statement type check | Inspects the AST root. Only `SelectStmt` nodes are permitted. |
| 5 | `extractTableRefs()` | Recursively walks the AST collecting all `RangeVar` nodes. Each table reference is checked against `ALLOWED_TABLES`. System catalogue prefixes (`pg_`, `information_schema`) are rejected. |
| 6 | `extractFunctionCalls()` | Recursively walks the AST collecting all `FuncCall` nodes. Each function name is checked against `BLOCKED_FUNCTIONS`. |
| 7 | Auto-LIMIT enforcement | If the parsed AST does not contain a `LIMIT` clause, the SQL is wrapped as `SELECT * FROM (<original_sql>) AS _limited LIMIT 500`. |

### 5.3 Tenant Execution Model

Every tenant-scoped query follows this connection lifecycle:

```
1. pool.connect()                    -> acquire connection from pg.Pool
2. SET LOCAL statement_timeout       -> per-query timeout
3. SET LOCAL app.current_tenant_id   -> sets session variable for RLS
4. Execute application query         -> queries run in tenant context
5. COMMIT
6. client.release()                  -> return connection to pool (in finally block)
```

---

## 6. Configuration Patterns

### 6.1 TypeScript Path Aliases

`tsconfig.json` maps `@/*` to `./src/*`, `@server/*` to `./src/server/*`, `@client/*` to `./src/client/*`, and `@shared/*` to `./src/shared/*`. All imports within the `src/` directory tree use these aliases. Imports from `app/` use relative paths or the `@server/*` alias for route delegation.

### 6.2 Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `LLM_API_KEY` | API key for the configured LLM provider |
| `LLM_PROVIDER` | LLM backend: anthropic, openai, or gemini (default: anthropic) |
| `LLM_MODEL` | Model identifier override |
| `NODE_ENV` | `production` or `development` |

No environment variables are committed to the repository.

---

## 7. Dependency Graph

```
app/api/chat/route.ts
  +-> src/server/routes/chat.ts
        +-> src/server/agents/nl2sql-agent.ts
        |     +-> src/server/llm/             (LLM provider abstraction)
        |     +-> src/server/validators/sql-validator.ts
        |     |     +-> libpg-query           (PostgreSQL parser, WASM)
        |     +-> src/server/db/pool.ts
        |     |     +-> pg                    (PostgreSQL client)
        |     +-> src/shared/constants/index.ts
        +-> src/server/middleware/audit.ts

app/api/access/route.ts
  +-> src/server/routes/access.ts
        +-> src/server/db/pool.ts
        (UNION ALL across github_repo_collaborator_permissions,
         github_repo_team_permissions, google_workspace_memberships,
         aws_identity_center_memberships + related JOINs)

app/api/people/route.ts
  +-> src/server/routes/people.ts
        +-> src/server/db/pool.ts

app/api/people/[id]/route.ts
  +-> src/server/routes/people.ts (handlePersonDetail)
        +-> src/server/db/pool.ts

app/api/groups/route.ts
  +-> src/server/routes/groups.ts (handleGroupsList)
        +-> src/server/db/pool.ts

app/api/groups/[id]/route.ts
  +-> src/server/routes/groups.ts (handleGroupDetails)
        +-> src/server/db/pool.ts

app/api/resources/route.ts
  +-> src/server/routes/resources.ts
        +-> src/server/db/pool.ts

app/api/accounts/route.ts
  +-> src/server/routes/accounts.ts
        +-> src/server/db/pool.ts
        (UNION ALL across aws_accounts + gcp_projects
         with assignment/binding count subqueries)

app/api/audit/route.ts
  +-> src/server/routes/audit.ts
        +-> src/server/db/pool.ts

app/api/health/route.ts
  +-> src/server/db/pool.ts (healthCheck)
```

---

## 8. Assumptions

1. **Single-region deployment.** The application and database are co-located in the same region.

2. **Tenant ID is always available.** Every authenticated request carries a tenant identifier. The mock session currently uses `11111111-1111-1111-1111-111111111111`.

3. **LLM API availability.** The NL2SQL pipeline depends on the configured LLM provider API. The system does not automatically fall back to alternative providers.

4. **Connection pool sizing.** The `pg.Pool` default of 10 connections is assumed sufficient.

5. **No write operations through the API.** The application's API surface is read-only.

6. **No RLS policies in current schema.** The schema defines tables with `tenant_id` columns but does not define RLS policies. The application sets `app.current_tenant_id` via SET LOCAL for forward compatibility. Manual tenant filtering is not applied in routes; RLS policies should be added for production.

7. **No audit table.** The current schema does not include an `audit_log` table. Audit entries are logged to the console. A dedicated audit table should be added for production.

8. **No materialised views.** The schema does not include pre-computed views like `mv_effective_access`. Access data is queried via a dynamic UNION ALL across GitHub collaborator/team permissions, Google Workspace group memberships, and AWS Identity Center group memberships. However, the `resource_access_grants` table provides a denormalised, pre-computed cross-provider permissions matrix that can be populated by sync jobs for fast lookups.

9. **Cloud resources require separate seeding.** AWS accounts, GCP projects, and the `resource_access_grants` matrix are populated via `schema/99-seed/020_cloud_resources_seed.sql` (or `scripts/seed_cloud_resources.py`). These must be loaded after the identity mock data (`010_mock_data.sql`).
