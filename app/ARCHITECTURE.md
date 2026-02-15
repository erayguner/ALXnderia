# Cloud Account & Identity Intelligence -- Architecture Document

## 1. Research Summary with Citations

### NL2SQL Best Practices

- **Schema-aware prompting**: Feed DDL, column descriptions, and FK relationships to the LLM for every query. The model performs significantly better when it has the full structural context rather than relying on implicit knowledge.
  - Cite: [NL2SQL Handbook](https://github.com/HKUSTDial/NL2SQL_Handbook)
  - Cite: [Survey of Text-to-SQL](https://arxiv.org/abs/2408.05109)

- **Exemplar selection**: Use few-shot examples that match the query pattern. Retrieval-based selection with embeddings ensures the most relevant examples are chosen dynamically rather than relying on a static set.
  - Cite: [Prompt Optimisation in NL2SQL](https://arxiv.org/html/2505.20591v1)

- **Schema routing**: Decouple schema selection from SQL generation for multi-schema databases. This allows the system to first identify which tables are relevant, then generate SQL against only those tables, reducing hallucination and improving accuracy.
  - Cite: [DBCopilot](https://www.openproceedings.org/2025/conf/edbt/paper-209.pdf)

- **Ambiguity handling**: Generate candidate interpretations and ask the user to disambiguate. This is preferable to guessing, as incorrect assumptions lead to wrong results and eroded trust.
  - Cite: [NL2SQL Schema Ambiguity](https://arxiv.org/pdf/2505.19302)

- **Semantic caching**: Cache similar questions to avoid regenerating SQL. Use embedding similarity to match incoming questions against previously answered ones, returning cached results when confidence is high.
  - Cite: [NL2SQL System Design 2025](https://medium.com/@adityamahakali/nl2sql-system-design-guide-2025-c517a00ae34d)

- **Structured outputs**: Use Claude's constrained decoding to guarantee valid JSON with query plan, SQL, and explanation. This eliminates parsing failures and ensures downstream systems always receive well-formed responses.
  - Cite: [Claude Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

### OWASP LLM Security

- **LLM01:2025 Prompt Injection** -- The number one risk. Mitigate with input/output validation, context separation, and tool allow-lists. Never allow the LLM to execute arbitrary actions; constrain it to a well-defined set of capabilities.
  - Cite: [OWASP LLM Top 10 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/)

- **LLM02:2025 Sensitive Information Disclosure** -- Never include secrets in prompts. Redact PII from LLM context. Ensure that even if the model is compromised, it cannot leak credentials or personal data.

- **LLM06:2025 Excessive Agency** -- Restrict the LLM to SELECT-only SQL. Validate the AST before execution. The model must never be able to modify data, schema, or permissions.

- **Defence-in-depth**: Treat all LLM output as untrusted. Validate at every boundary -- after generation, before execution, and before display to the user.
  - Cite: [OWASP Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### PostgreSQL Row-Level Security (RLS)

- Use `current_setting('app.current_tenant_id')` in RLS policies for tenant isolation. This ensures that every query is automatically scoped to the authenticated tenant without requiring application-level filtering.
  - Cite: [PG RLS Docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

- Set the session variable per request via `SET LOCAL app.current_tenant_id = $1`. The `SET LOCAL` ensures the variable is scoped to the current transaction and is automatically cleared on commit/rollback.
  - Cite: [Crunchy Data RLS](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)

- Use `LEAKPROOF` functions in RLS predicates to allow index usage. Without this, PostgreSQL may refuse to push predicates below the RLS barrier, resulting in sequential scans.
  - Cite: [Bytebase RLS Footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/)

- Parameterised queries prevent SQL injection at the driver level. Combined with RLS, this provides two independent layers of protection.

### SQL AST Validation

- **`libpg-query` for Node.js**: Wraps PostgreSQL's actual parser in WASM, providing 100% spec-compliant parsing. This is the gold standard for SQL validation because it uses the same parser as PostgreSQL itself.
  - Cite: [libpg-query-node](https://github.com/launchql/libpg-query-node)

- **`pgsql-parser`**: Provides parse and deparse round-trip capability, battle-tested on 23,000+ statements. Useful for transforming SQL (e.g., injecting LIMIT clauses) after validation.
  - Cite: [pgsql-parser](https://github.com/launchql/pgsql-parser)

- Validate the SQL AST to ensure: only SELECT statements are present, no DDL/DML, no comments, no multi-statement batches, no system catalogue access, and no subqueries referencing `pg_*` tables.

### Authentication

- **Auth.js v5 (NextAuth v5)** with App Router for OIDC providers (Google, Azure AD, Okta). This provides a mature, well-maintained authentication layer with native Next.js integration.
  - Cite: [Auth.js](https://next-auth.js.org/)

- **CVE-2025-29927**: Must use Next.js 15.2.3 or later. This CVE allows middleware bypass in earlier versions, which would compromise the authentication layer.
  - Cite: [Clerk Auth Guide](https://clerk.com/articles/complete-authentication-guide-for-nextjs-app-router)

---

## 2. Architecture Diagram Description

```
+-----------------------------------------------------------------+
|                          FRONTEND                                |
|  Next.js 15 (App Router, React 19, TypeScript)                  |
|  +----------+ +----------+ +----------+ +----------+            |
|  | Chat UI  | | People   | |Resources | | Access   |            |
|  | (NL Q&A) | |Directory | | Browser  | |Explorer  |            |
|  +----+-----+ +----+-----+ +----+-----+ +----+-----+            |
|       +-------------+-----------+-----------+                    |
|                         |                                        |
|                         | Server Actions / API Routes            |
+-----------------------------------------------------------------+
|                       BACKEND                                    |
|  Next.js API Routes (Route Handlers)                             |
|  +-----------+  +----------+  +-------------+                    |
|  | Auth      |  | NL2SQL   |  | Query       |                    |
|  | Middleware |  | Agent    |  | Executor    |                    |
|  | (Auth.js) |  | (Claude) |  | (pg pool)   |                    |
|  +-----+-----+  +-----+----+  +------+------+                    |
|        |               |              |                           |
|  +-----+-----+  +------+----+  +-----+-------+                   |
|  | Session   |  | SQL       |  | Audit       |                   |
|  | Store     |  | Validator |  | Logger      |                   |
|  | (Redis)   |  | (libpg)   |  |             |                   |
|  +-----------+  +-----------+  +-------------+                   |
+-----------------------------------------------------------------+
|                      DATABASE                                    |
|  PostgreSQL 16                                                   |
|  +--------------+  +--------------+  +--------------+            |
|  | Operational  |  | Materialised |  | Audit Log    |            |
|  | Tables + RLS |  | Views        |  | (partitioned)|            |
|  +--------------+  +--------------+  +--------------+            |
+-----------------------------------------------------------------+
```

### Data Flow

1. User authenticates via OIDC. Auth.js creates a session containing `tenant_id` and `role`.
2. User asks a natural language question. The frontend sends it to the `/api/chat` endpoint.
3. Auth middleware validates the session and extracts `tenant_id` and `role`.
4. The NL2SQL agent receives the question along with schema metadata and few-shot examples.
5. The agent returns: `{ queryPlan, sql, params, explanation }`.
6. The SQL Validator parses the AST, checks the allow-list, and rejects unsafe queries.
7. The Query Executor opens a connection, sets `app.current_tenant_id`, and executes the parameterised query with a timeout and row limit.
8. Results are returned to the agent for narrative summarisation.
9. A full audit log entry is recorded (question, SQL, row count, user, timestamp).
10. The frontend renders the narrative, a data table, and drilldown links.

---

## 3. Threat Model

| # | Threat | Likelihood | Impact | Mitigation |
|---|--------|-----------|--------|------------|
| T1 | Prompt injection (user crafts question to exfiltrate data) | High | Critical | SQL AST validation, SELECT-only allow-list, output filtering, tenant RLS |
| T2 | SQL injection via LLM output | High | Critical | libpg-query AST parsing, parameterised execution, no string interpolation |
| T3 | Cross-tenant data leakage | Medium | Critical | RLS enforced at DB level, tenant_id from session (not user input), BYPASSRLS only for admin |
| T4 | Excessive data exposure | Medium | High | Row limits (max 500), column allow-list per role, PII redaction views for readonly role |
| T5 | Session hijacking | Medium | High | HttpOnly + Secure + SameSite cookies, short TTL, OIDC refresh tokens |
| T6 | Denial of service (expensive queries) | Medium | Medium | Query timeout (10s), statement_timeout per connection, rate limiting |
| T7 | LLM hallucination (wrong SQL) | High | Medium | Show SQL to user, validate results against schema, confidence scoring |
| T8 | Audit log tampering | Low | High | Append-only table, separate audit role, hash chain integrity |
| T9 | Schema information leakage | Low | Medium | Do not expose raw schema to users; show only role-appropriate metadata |
| T10 | Indirect prompt injection via stored data | Low | Medium | Sanitise data before including in LLM context; limit context window |

---

## 4. API Design

### Authentication

- `GET /api/auth/[...nextauth]` -- Auth.js catch-all (OIDC flows)
- `GET /api/auth/session` -- Current session info

### Chat (NL2SQL)

- `POST /api/chat` -- Ask a natural language question

**Request:**

```json
{
  "question": "Who has admin access to the Belfast prod GCP project?",
  "conversationId": "conv-uuid-optional",
  "followUp": false
}
```

**Response:**

```json
{
  "id": "msg-uuid",
  "queryPlan": "Look up GCP IAM bindings with admin roles for project matching 'Belfast prod', join to persons via workspace users",
  "sql": "SELECT ... FROM mv_effective_access ea JOIN person p ON ...",
  "results": [
    {
      "display_name": "Alice Smith",
      "role": "roles/owner",
      "access_path": "direct"
    }
  ],
  "narrative": "3 people have admin-level access to the Belfast Production project...",
  "explanation": "Access is derived from: 1 direct IAM binding (roles/owner) and 2 group-derived bindings via 'platform-admins' group.",
  "metadata": {
    "tablesUsed": ["mv_effective_access", "person"],
    "rowCount": 3,
    "executionTimeMs": 12,
    "cached": false
  },
  "followUpSuggestions": [
    "Show me the group memberships for these users",
    "Are any of these users dormant?"
  ]
}
```

### People Directory

- `GET /api/people?page=1&limit=50&search=alice&tenant=northwind` -- List persons
- `GET /api/people/:id` -- Person detail with linked identities
- `GET /api/people/:id/access` -- Effective access for person

### Resources

- `GET /api/resources/aws-accounts?page=1&limit=50` -- List AWS accounts
- `GET /api/resources/gcp-projects?page=1&limit=50` -- List GCP projects
- `GET /api/resources/:type/:id/access` -- Who can access this resource

### Groups

- `GET /api/groups/aws-idc?page=1&limit=50` -- List IDC groups
- `GET /api/groups/gcp-workspace?page=1&limit=50` -- List Workspace groups
- `GET /api/groups/:type/:id/members` -- Group members

### Export

- `GET /api/export/csv?query=...&format=csv` -- Export results as CSV

### Audit

- `GET /api/audit/queries?page=1&limit=50` -- Query audit log (admin only)

---

## 5. Database Access Layer

- **Connection pooling**: `pg` with `Pool` (min: 2, max: 10, idleTimeout: 30s).
- **RLS enforcement**: Every query is wrapped in a transaction that sets `SET LOCAL app.current_tenant_id = $1` before executing the user's query.
- **Read-only role**: Agent queries use the `cloudintel_analyst` role (SELECT only on operational tables and materialised views).
- **Parameterised queries**: All user-facing queries use `$1, $2` placeholders. No string interpolation is ever used.
- **Timeouts**: `statement_timeout = '10s'` is set per connection to prevent runaway queries.
- **Row limits**: All queries are wrapped with `LIMIT 500` if no explicit limit is already present.
- **Materialised view usage**: Queries against effective access use `mv_effective_access` for performance, avoiding expensive joins at query time.

---

## 6. NL2SQL Agent Design

### System Prompt Strategy

The agent receives the following context with every invocation:

1. **Role definition**: "You are a database query agent for a cloud identity intelligence system."
2. **Schema metadata**: DDL for all tables with column descriptions, foreign keys, and CHECK constraints.
3. **Synonym map**: `{"account" -> "aws_account", "project" -> "gcp_project", ...}`
4. **Security rules**: "Generate SELECT-only queries. Never use DDL/DML. Always filter by tenant_id."
5. **Few-shot examples** (8-10) covering common query patterns.

### Schema Retrieval Strategy

- Pre-compute schema metadata at startup from `information_schema`.
- Store as structured JSON: tables, columns, types, constraints, foreign keys, indexes.
- Include materialised view definitions and function signatures.
- Refresh on schema change (or application restart).

### SQL Validation Strategy (Multi-Layer)

1. **AST Parse**: Use `libpg-query` to parse SQL into an abstract syntax tree.
2. **Statement type check**: Only `SelectStmt` is allowed. Reject INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, GRANT, COPY, and EXECUTE.
3. **Table allow-list**: Only tables in the operational schema and materialised views are permitted. Reject `pg_catalog`, `information_schema`, and all `pg_*` tables.
4. **Function allow-list**: Only known-safe functions (COUNT, SUM, MAX, MIN, AVG, COALESCE, etc.). Reject `pg_read_file`, `lo_import`, `dblink`, `copy_to`, and similar dangerous functions.
5. **No multi-statement**: Reject if the AST contains more than one statement.
6. **No comments**: Strip SQL comments before parsing.
7. **Keyword block-list**: Reject any SQL containing GRANT, REVOKE, SET, RESET, LOAD, or COPY.
8. **Row limit injection**: If no LIMIT clause is present in the AST, wrap the query with `SELECT * FROM (...) AS q LIMIT 500`.

### Fallback Behaviour

- If the question is ambiguous, return the top 3 interpretations and ask the user to pick one.
- If SQL validation fails, explain the failure to the user and ask them to rephrase.
- If the query returns 0 rows, suggest alternative search terms.
- If the query times out, explain the timeout and suggest narrowing the scope.

---

## 7. Tech Stack Choice

| Layer | Choice | Justification |
|-------|--------|--------------|
| Frontend | Next.js 15 + React 19 + TypeScript | App Router for server components, streaming, and server actions; largest ecosystem |
| Styling | Tailwind CSS + shadcn/ui | Rapid, consistent, accessible components |
| Auth | Auth.js v5 | Native Next.js integration, OIDC support for Google/Azure/Okta |
| Backend | Next.js Route Handlers | Same runtime, no separate server, TypeScript end-to-end |
| LLM | Claude (Sonnet 4.5 primary, Haiku 4.5 for classification) | Best structured output support, tool use, large context window |
| SQL Parser | libpg-query (WASM) | PostgreSQL's actual parser, 100% spec-compliant |
| DB Driver | pg (node-postgres) | Mature, parameterised queries, pool support |
| Cache | In-memory LRU (lru-cache) | Simple, no Redis dependency for MVP; Redis upgrade path |
| Testing | Vitest + Testing Library | Fast, ESM-native, React component testing |

### LLM Provider Options

1. **Claude Sonnet 4.5** (recommended): Best structured output, 200K context, $3/$15 per MTok. Ideal for NL2SQL with full schema in context.
2. **Claude Haiku 4.5**: $0.80/$4 per MTok. Use for query classification and simple lookups where full reasoning is not required.
3. **GPT-4o**: Alternative if Anthropic is unavailable. Similar structured output support.

---

## 8. Repository Structure

```
app/
+-- src/
|   +-- server/
|   |   +-- routes/            # API route handlers
|   |   +-- middleware/         # Auth, audit, rate-limit
|   |   +-- services/          # Business logic
|   |   +-- agents/            # NL2SQL agent
|   |   +-- db/                # Connection pool, query executor
|   |   +-- validators/        # SQL AST validator
|   +-- client/
|   |   +-- components/        # React components
|   |   +-- pages/             # Page components
|   |   +-- hooks/             # Custom React hooks
|   |   +-- lib/               # Client utilities
|   |   +-- styles/            # Tailwind config
|   +-- shared/
|       +-- types/             # Shared TypeScript types
|       +-- constants/         # Shared constants
+-- tests/
|   +-- server/                # Backend tests
|   +-- client/                # Frontend tests
+-- config/                    # Environment config
+-- package.json
+-- tsconfig.json
+-- next.config.ts
+-- ARCHITECTURE.md
```

---

## 9. Sample Prompts (20)

### Effective Access

1. "What can Oliver Smith access across all providers?"
2. "Show me everyone who has admin access to account nw-prod-01"
3. "Who has roles/owner on GCP project prj-northwind-005?"
4. "List all people with PowerUserAccess in any AWS account"

### Access Reviews

5. "Which users haven't logged in for 90 days but still have admin access?"
6. "Show suspended Google Workspace users who still have GCP project access"
7. "Find departed employees who still have active entitlements"
8. "List users with access to more than 10 AWS accounts"

### Group Analysis

9. "Who is in the Security-Admins IDC group?"
10. "What can members of the 'platform-admins' Workspace group access?"
11. "Show groups with more than 50 members"
12. "Find users who are in both AWS and GCP admin groups"

### Anomalies

13. "Are there any users with mismatched display names across providers?"
14. "Find identities that aren't linked to any person"
15. "Show accounts with no active assignments"

### Temporal / History

16. "What did Oliver Smith's access look like on January 15th?"
17. "Show all access changes in the last 30 days"
18. "Who was deleted from the system in February?"

### DLP / Compliance

19. "Show the legal hold scope for entity history"
20. "Verify the integrity chain for a specific person"
