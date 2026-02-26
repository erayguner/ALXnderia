/**
 * NL2SQL Agent.
 *
 * Converts natural-language questions into validated PostgreSQL queries
 * using a configurable LLM provider (Anthropic, OpenAI, Gemini, etc.),
 * executes them within a tenant-scoped transaction, and returns a
 * structured response with narrative context.
 */

import { randomUUID } from 'crypto';

import type { ChatRequest, ChatResponse, QueryPlan } from '../../shared/types';
import { SCHEMA_SYNONYMS, MAX_ROWS } from '../../shared/constants';
import { validateSql } from '../validators/sql-validator';
import { executeWithTenant, getSchemaMetadata } from '../db/pool';
import { getLLMProvider } from '../llm';

// ---------------------------------------------------------------------------
// Schema context (cached after first retrieval)
// ---------------------------------------------------------------------------

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let schemaCache: { data: string; expiry: number } | null = null;

/**
 * Build the schema context string from live database metadata.
 * The result is cached in memory with a TTL so subsequent calls avoid a round-trip.
 * Cache auto-refreshes after TTL expires — no manual clearing needed.
 */
async function getSchemaContext(): Promise<string> {
  if (schemaCache && Date.now() < schemaCache.expiry) return schemaCache.data;

  const meta = await getSchemaMetadata();
  const lines: string[] = [
    '-- Database Schema for Cloud Account & Identity Intelligence\n',
  ];

  // Group columns by table
  const tableColumns = new Map<
    string,
    Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      description: string | null;
    }>
  >();
  for (const col of meta.columns) {
    const cols = tableColumns.get(col.table_name) || [];
    cols.push(col);
    tableColumns.set(col.table_name, cols);
  }

  // Group foreign keys by table
  const tableFks = new Map<
    string,
    Array<{
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>
  >();
  for (const fk of meta.foreignKeys) {
    const fks = tableFks.get(fk.table_name) || [];
    fks.push(fk);
    tableFks.set(fk.table_name, fks);
  }

  for (const table of meta.tables) {
    lines.push(`-- Table: ${table.table_name}`);
    const cols = tableColumns.get(table.table_name) || [];
    for (const col of cols) {
      const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      const desc = col.description ? ` -- ${col.description}` : '';
      lines.push(`--   ${col.column_name} ${col.data_type} ${nullable}${desc}`);
    }
    const fks = tableFks.get(table.table_name) || [];
    for (const fk of fks) {
      lines.push(
        `--   FK: ${fk.column_name} -> ${fk.foreign_table_name}(${fk.foreign_column_name})`,
      );
    }
    lines.push('');
  }

  for (const mv of meta.materializedViews) {
    lines.push(`-- Materialised View: ${mv.table_name}`);
    const cols = tableColumns.get(mv.table_name) || [];
    for (const col of cols) {
      lines.push(`--   ${col.column_name} ${col.data_type}`);
    }
    lines.push('');
  }

  const data = lines.join('\n');
  schemaCache = { data, expiry: Date.now() + SCHEMA_CACHE_TTL_MS };
  return data;
}

// ---------------------------------------------------------------------------
// Synonym context
// ---------------------------------------------------------------------------

/**
 * Build a human-readable synonym reference for the system prompt.
 */
function getSynonymContext(): string {
  const lines = ['Synonym mapping (user might say -> actual table):'];
  for (const [table, synonyms] of Object.entries(SCHEMA_SYNONYMS)) {
    lines.push(`  "${synonyms.join('", "')}" -> ${table}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Few-shot examples
// ---------------------------------------------------------------------------

const FEW_SHOT_EXAMPLES = `
Example 1:
Question: "Show Alice's identity links"
Query Plan: Look up a canonical user and all linked provider identities (identity linkages only, not access).
SQL: SELECT cu.full_name, cu.primary_email, jsonb_object_agg(link.provider_type, link.provider_user_id) as linked_identities FROM canonical_users cu JOIN canonical_user_provider_links link ON cu.id = link.canonical_user_id AND cu.tenant_id = link.tenant_id WHERE cu.primary_email ILIKE '%alice%' GROUP BY cu.id, cu.full_name, cu.primary_email
Explanation: The canonical_user_provider_links table links a canonical user to their Google, AWS, and GitHub identities via provider_type and provider_user_id. NOTE: For "full identity map" or "full profile" queries, also include access data from resource_access_grants using UNION ALL (see Example 16).

Example 2:
Question: "Who are the unmapped GitHub users?"
Query Plan: Find GitHub users that have no canonical identity linkage.
SQL: SELECT 'GITHUB' as provider, gu.login as identifier, gu.email FROM github_users gu WHERE gu.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM canonical_user_provider_links link WHERE link.provider_type = 'GITHUB' AND link.provider_user_id = gu.node_id AND link.tenant_id = gu.tenant_id) ORDER BY gu.login
Explanation: These are GitHub users present in the system but not yet linked to a canonical identity. They may be external collaborators or users with hidden emails.

Example 3:
Question: "Show all external collaborators with repo access"
Query Plan: List GitHub users who have repo access as outside collaborators.
SQL: SELECT r.full_name as repo_name, u.login as user_login, perm.permission FROM github_repo_collaborator_permissions perm JOIN github_repositories r ON perm.repo_node_id = r.node_id AND perm.tenant_id = r.tenant_id JOIN github_users u ON perm.user_node_id = u.node_id AND perm.tenant_id = u.tenant_id WHERE perm.is_outside_collaborator = TRUE ORDER BY r.full_name, u.login
Explanation: Outside collaborators have access to specific repositories but are not organisation members.

Example 4:
Question: "Who is in the AWS Security-Admins group?"
Query Plan: List members of an AWS Identity Center group.
SQL: SELECT aicu.user_name, aicu.display_name, g.display_name AS group_name FROM aws_identity_center_groups g JOIN aws_identity_center_memberships gm ON gm.group_id = g.group_id AND gm.identity_store_id = g.identity_store_id AND gm.tenant_id = g.tenant_id JOIN aws_identity_center_users aicu ON aicu.user_id = gm.member_user_id AND aicu.identity_store_id = gm.identity_store_id AND aicu.tenant_id = gm.tenant_id WHERE g.display_name ILIKE '%Security-Admins%' AND gm.deleted_at IS NULL ORDER BY aicu.display_name
Explanation: AWS Identity Center groups link to users via memberships using identity_store_id and group_id/user_id as join keys.

Example 5:
Question: "Show all GitHub org admins"
Query Plan: List users with admin role in GitHub organisations.
SQL: SELECT gu.login, gu.email, go.login AS org_login FROM github_org_memberships gom JOIN github_users gu ON gom.user_node_id = gu.node_id AND gom.tenant_id = gu.tenant_id JOIN github_organisations go ON gom.org_node_id = go.node_id AND gom.tenant_id = go.tenant_id WHERE gom.role = 'admin' ORDER BY go.login, gu.login
Explanation: GitHub org admins are identified by the role column in github_org_memberships. Joins use node_id as the linking column.

Example 6:
Question: "Show pending identity reconciliation items"
Query Plan: List items in the reconciliation queue that need manual review.
SQL: SELECT irq.provider_type, irq.provider_user_id, irq.conflict_reason, irq.status, irq.created_at FROM identity_reconciliation_queue irq WHERE irq.status = 'PENDING' ORDER BY irq.created_at
Explanation: The identity_reconciliation_queue tracks provider identities that could not be automatically matched to canonical users and need manual review.

Example 7:
Question: "Who has access to demo-data-prod?"
Query Plan: Find all users with access to a specific project or account using the resource_access_grants matrix.
SQL: SELECT rag.subject_display_name, rag.provider, rag.resource_display_name, rag.role_or_permission, rag.access_path, rag.via_group_display_name FROM resource_access_grants rag WHERE (rag.resource_display_name ILIKE '%demo-data-prod%' OR rag.resource_id ILIKE '%demo-data-prod%') AND rag.deleted_at IS NULL ORDER BY rag.provider, rag.subject_display_name LIMIT 500
Explanation: The resource_access_grants table is a denormalised cross-provider access matrix. subject_display_name is the person, resource_display_name is the account/project, role_or_permission is the permission level, and via_group_display_name shows which group grants access (if access_path = 'group').

Example 8:
Question: "How many users have access to demo-data-prod?"
Query Plan: Count distinct users with access to a specific project or account.
SQL: SELECT COUNT(DISTINCT rag.canonical_user_id) AS user_count FROM resource_access_grants rag WHERE (rag.resource_display_name ILIKE '%demo-data-prod%' OR rag.resource_id ILIKE '%demo-data-prod%') AND rag.deleted_at IS NULL
Explanation: Count queries should use COUNT(DISTINCT canonical_user_id) since one person can have multiple access paths to the same resource.

Example 9:
Question: "Which groups grant access to demo-data-prod?"
Query Plan: List groups that provide access to a specific account or project.
SQL: SELECT DISTINCT rag.via_group_display_name, rag.provider, rag.role_or_permission, COUNT(*) AS member_count FROM resource_access_grants rag WHERE (rag.resource_display_name ILIKE '%demo-data-prod%' OR rag.resource_id ILIKE '%demo-data-prod%') AND rag.access_path = 'group' AND rag.via_group_display_name IS NOT NULL AND rag.deleted_at IS NULL GROUP BY rag.via_group_display_name, rag.provider, rag.role_or_permission ORDER BY rag.provider, rag.via_group_display_name
Explanation: Filter resource_access_grants by access_path = 'group' to find group-based access, then aggregate by via_group_display_name.

Example 10:
Question: "Through which role does user X access AWS account Y?"
Query Plan: Trace a specific user's access path to an AWS account.
SQL: SELECT rag.subject_display_name, rag.resource_display_name, rag.role_or_permission, rag.access_path, rag.via_group_display_name FROM resource_access_grants rag WHERE rag.subject_display_name ILIKE '%X%' AND (rag.resource_display_name ILIKE '%Y%' OR rag.resource_id ILIKE '%Y%') AND rag.provider = 'aws' AND rag.deleted_at IS NULL ORDER BY rag.role_or_permission
Explanation: The resource_access_grants table shows the full access chain: subject_display_name (user), resource_display_name (account), role_or_permission, and via_group_display_name (if group-based).

Example 11:
Question: "List all AWS accounts"
Query Plan: List all AWS accounts with their status and assignment counts.
SQL: SELECT aa.account_id, aa.name AS account_name, aa.email AS account_email, aa.status, aa.joined_method, COUNT(asg.id) AS assignment_count FROM aws_accounts aa LEFT JOIN aws_account_assignments asg ON asg.account_id = aa.account_id AND asg.tenant_id = aa.tenant_id AND asg.deleted_at IS NULL WHERE aa.deleted_at IS NULL GROUP BY aa.id, aa.account_id, aa.name, aa.email, aa.status, aa.joined_method ORDER BY aa.name
Explanation: aws_accounts stores AWS Organization member accounts (columns: name, email, status). aws_account_assignments links via account_id.

Example 12:
Question: "Show all GCP projects and their IAM bindings"
Query Plan: List GCP projects with IAM binding counts.
SQL: SELECT gp.project_id, gp.display_name, gp.lifecycle_state, COUNT(pib.id) AS binding_count FROM gcp_projects gp LEFT JOIN gcp_project_iam_bindings pib ON pib.project_id = gp.project_id AND pib.tenant_id = gp.tenant_id AND pib.deleted_at IS NULL WHERE gp.deleted_at IS NULL GROUP BY gp.id, gp.project_id, gp.display_name, gp.lifecycle_state ORDER BY gp.display_name
Explanation: gcp_projects stores Google Cloud projects. gcp_project_iam_bindings maps principals (member_type, member_id) to projects with IAM roles.

Example 13:
Question: "List all external collaborators with access to production resources"
Query Plan: Find external collaborators on production repositories.
SQL: SELECT DISTINCT u.login AS github_user, r.full_name AS repo_name, perm.permission FROM github_repo_collaborator_permissions perm JOIN github_repositories r ON perm.repo_node_id = r.node_id AND perm.tenant_id = r.tenant_id JOIN github_users u ON perm.user_node_id = u.node_id AND perm.tenant_id = u.tenant_id WHERE perm.is_outside_collaborator = TRUE AND (r.full_name ILIKE '%prod%' OR r.full_name ILIKE '%production%') AND perm.deleted_at IS NULL ORDER BY r.full_name, u.login
Explanation: External collaborators are identified by is_outside_collaborator = TRUE. Production resources are matched by name pattern.

Example 14:
Question: "Show the latest ingestion runs"
Query Plan: Display recent data sync operations with their status.
SQL: SELECT provider, entity_type, status, records_upserted, records_deleted, error_message, started_at, finished_at FROM ingestion_runs ORDER BY started_at DESC LIMIT 20
Explanation: The ingestion_runs table tracks provider data synchronisation operations.

Example 15:
Question: "Show the audit log"
Query Plan: Display recent query audit trail entries.
SQL: SELECT user_id, question, sql_executed, row_count, execution_time_ms, status, created_at FROM audit_log ORDER BY created_at DESC LIMIT 50
Explanation: The audit_log table records all NL2SQL query executions with user_id, question text, SQL executed, and performance metrics.

Example 16:
Question: "Show kai.ahmed500@demo-example.co.uk's full identity map across all providers"
Query Plan: Retrieve the user's canonical identity, all linked provider identities, AND all access grants across every cloud account and project.
SQL: SELECT 'identity' AS record_type, cu.full_name, cu.primary_email, link.provider_type, link.provider_user_id AS identifier, NULL AS resource_name, NULL AS role_or_permission, NULL AS access_path, NULL AS via_group FROM canonical_users cu JOIN canonical_user_provider_links link ON cu.id = link.canonical_user_id AND cu.tenant_id = link.tenant_id WHERE cu.primary_email ILIKE '%kai.ahmed500%' UNION ALL SELECT 'access' AS record_type, rag.subject_display_name AS full_name, NULL AS primary_email, rag.provider AS provider_type, NULL AS identifier, rag.resource_display_name AS resource_name, rag.role_or_permission, rag.access_path, rag.via_group_display_name AS via_group FROM resource_access_grants rag WHERE rag.subject_display_name ILIKE '%Kai Ahmed%' AND rag.deleted_at IS NULL ORDER BY record_type, provider_type
Explanation: A "full identity map" means BOTH the user's linked provider identities AND all their access grants across every cloud account/project. The query uses UNION ALL to combine canonical_user_provider_links (identity linkages) with resource_access_grants (actual access to AWS accounts, GCP projects, etc.).

Example 17:
Question: "What can Alice access across all providers?"
Query Plan: List all cloud resources (accounts, projects, repos) the user can access from resource_access_grants.
SQL: SELECT rag.provider, rag.resource_type, rag.resource_display_name, rag.role_or_permission, rag.access_path, rag.via_group_display_name FROM resource_access_grants rag WHERE rag.subject_display_name ILIKE '%Alice%' AND rag.deleted_at IS NULL ORDER BY rag.provider, rag.resource_display_name
Explanation: Use resource_access_grants to show everything a user can access. This table is the denormalised cross-provider access matrix covering AWS, GCP, and GitHub.
`;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Construct the full system prompt including schema, synonyms, and examples.
 */
async function buildSystemPrompt(): Promise<string> {
  const schema = await getSchemaContext();
  const synonyms = getSynonymContext();

  return `You are a database query agent for a Cloud Account & Identity Intelligence system.
Your role is to convert natural language questions into safe PostgreSQL queries.

RULES (MANDATORY):
1. Generate ONLY SELECT statements. Never INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, GRANT, or TRUNCATE.
2. Always include appropriate JOINs to provide human-readable results (names, emails, not just UUIDs).
3. Use ILIKE for name/email searches (case-insensitive).
4. Always add ORDER BY for deterministic results.
5. Add LIMIT ${MAX_ROWS} unless the user specifies a different limit.
6. Never access pg_catalog, information_schema, or system tables.
7. If the question is ambiguous, set needsClarification to true and provide options.
8. All data is multi-tenant; queries are scoped to a single tenant via RLS.

DATABASE SCHEMA:
${schema}

${synonyms}

IMPORTANT TABLE RELATIONSHIPS:
- canonical_users is the central identity entity
- canonical_user_provider_links maps canonical users to provider identities:
  - provider_type = 'GOOGLE_WORKSPACE', provider_user_id = google_workspace_users.google_id
  - provider_type = 'AWS_IDENTITY_CENTER', provider_user_id = aws_identity_center_users.user_id
  - provider_type = 'GITHUB', provider_user_id = github_users.node_id
- canonical_emails stores all email addresses for a canonical user
- identity_reconciliation_queue tracks unmatched identities needing review
- Google Workspace: google_workspace_memberships links groups (by google_id) to members (by member_id)
- AWS Identity Center: aws_identity_center_memberships links groups (by group_id) to users (by member_user_id), scoped by identity_store_id
- GitHub: github_org_memberships uses org_node_id and user_node_id to link users to orgs
- GitHub: github_team_memberships uses team_node_id and user_node_id to link users to teams
- GitHub: github_repo_collaborator_permissions links repos (by repo_node_id) to users (by user_node_id) with permission level
- GitHub: github_repo_team_permissions links repos to teams with permission level

CLOUD RESOURCE TABLE RELATIONSHIPS:
- aws_accounts: AWS Organization member accounts. Columns: account_id, name, email, status, joined_method, joined_at, org_id
- aws_account_assignments: Maps IDC groups/users to AWS accounts via permission sets
  - Columns: identity_store_id, account_id, permission_set_arn, permission_set_name, principal_type (USER/GROUP), principal_id
  - Links: account_id -> aws_accounts.account_id, principal_id -> aws_identity_center_groups.group_id or aws_identity_center_users.user_id
- gcp_organisations: Google Cloud org node (org_id like "organizations/NNNN")
- gcp_projects: Google Cloud projects. Columns: project_id, project_number, display_name, lifecycle_state (ACTIVE/DELETE_REQUESTED), org_id
- gcp_project_iam_bindings: Maps principals to GCP projects with IAM roles
  - Columns: project_id, role, member_type, member_id, condition_expression, condition_title
  - Links: project_id -> gcp_projects.project_id
- resource_access_grants: DENORMALISED cross-provider access matrix (THE PRIMARY TABLE FOR ACCESS QUERIES)
  - Columns: provider (text: aws/gcp/github), resource_type, resource_id, resource_display_name,
    subject_type, subject_provider_id, subject_display_name, canonical_user_id (uuid FK to canonical_users),
    role_or_permission, access_path (direct/group), via_group_id, via_group_display_name
  - USE THIS TABLE FIRST for questions about "who has access to X", "what can user Y access",
    "which groups grant access", etc.
  - To search by resource name: WHERE resource_display_name ILIKE '%name%' OR resource_id ILIKE '%name%'
  - To search by user: WHERE subject_display_name ILIKE '%name%'
  - To find group-based access: WHERE access_path = 'group' AND via_group_display_name IS NOT NULL
- ingestion_runs: Tracks provider data sync operations. Columns: provider, entity_type, status, started_at, finished_at, records_upserted, records_deleted, error_message
- audit_log: Query execution audit trail. Columns: user_id, question, sql_executed, row_count, execution_time_ms, status (success/error/rejected), rejection_reason, created_at

KEY PATTERNS:
- "Who is person X?" -> query canonical_users with canonical_user_provider_links
- "Show identities for X" -> join canonical_users to provider tables via canonical_user_provider_links
- "Group members" -> join google_workspace_memberships or aws_identity_center_memberships
- "Team members" -> join github_team_memberships with github_users and github_teams
- "Org admins" -> query github_org_memberships WHERE role = 'admin'
- "Repo access" -> query github_repo_collaborator_permissions joined with github_users and github_repositories
- "Unmapped users" -> find provider users not in canonical_user_provider_links
- "Pending review" -> query identity_reconciliation_queue WHERE status = 'PENDING'
- "External collaborators" -> query github_repo_collaborator_permissions WHERE is_outside_collaborator = TRUE
- "Who has access to X?" -> query resource_access_grants WHERE resource_display_name ILIKE '%X%' OR resource_id ILIKE '%X%'
- "How many users access X?" -> SELECT COUNT(DISTINCT canonical_user_id) FROM resource_access_grants WHERE resource_display_name ILIKE '%X%'
- "Which groups grant access to X?" -> query resource_access_grants WHERE access_path = 'group' AND via_group_display_name IS NOT NULL
- "Through which role does user X access Y?" -> query resource_access_grants filtered by subject_display_name and resource_display_name
- "List all AWS accounts" -> query aws_accounts (columns: account_id, name, email, status), optionally LEFT JOIN aws_account_assignments for counts
- "Show GCP projects" -> query gcp_projects (columns: project_id, display_name, lifecycle_state), optionally LEFT JOIN gcp_project_iam_bindings for counts
- "GCP IAM bindings for project X" -> query gcp_project_iam_bindings WHERE project_id ILIKE '%X%'
- "AWS account assignments" -> query aws_account_assignments with JOINs to aws_accounts (on account_id) and aws_identity_center_groups (on principal_id = group_id)
- "Show audit log" -> query audit_log (columns: user_id, question, sql_executed, status, created_at) ORDER BY created_at DESC
- "Ingestion status" -> query ingestion_runs (columns: provider, status, records_upserted, started_at, finished_at) ORDER BY started_at DESC
- "Cross-provider access for user X" -> query resource_access_grants WHERE subject_display_name ILIKE '%X%'
- "Full identity map for user X" / "full profile across all providers" -> UNION ALL combining canonical_user_provider_links (identity linkages) WITH resource_access_grants (all access across accounts/projects). ALWAYS include access data, not just identity links.
- "What can user X access?" / "show all access for X" -> query resource_access_grants WHERE subject_display_name ILIKE '%X%' to list all accounts, projects, and roles

ENTITY RECOGNITION HINTS:
- Account/project names often contain patterns like "demo-*", "prod-*", "dev-*", "sandbox-*"
- When the user mentions a specific name (e.g. "demo-data-prod"), search using ILIKE '%name%' on relevant name columns
- AWS accounts: search aws_accounts.name or resource_access_grants.resource_display_name
- GCP projects: search gcp_projects.project_id or gcp_projects.display_name or resource_access_grants.resource_display_name
- GitHub entities: org logins, repo full_names (e.g. "techco/backend"), team names, user logins
- For "production" or "prod" resources, search name columns with ILIKE '%prod%'

${FEW_SHOT_EXAMPLES}

Respond with a JSON object containing:
{
  "queryPlan": { "description": "...", "tablesUsed": [...], "estimatedComplexity": "low|medium|high" },
  "sql": "SELECT ...",
  "explanation": "How the results should be interpreted...",
  "followUpSuggestions": ["...", "..."],
  "needsClarification": false,
  "clarificationMessage": null,
  "clarificationOptions": null
}`;
}

// ---------------------------------------------------------------------------
// Agent response type (internal)
// ---------------------------------------------------------------------------

interface AgentResponse {
  queryPlan: QueryPlan;
  sql: string;
  explanation: string;
  followUpSuggestions: string[];
  needsClarification?: boolean;
  clarificationMessage?: string;
  clarificationOptions?: string[];
}

// ---------------------------------------------------------------------------
// Core question processor
// ---------------------------------------------------------------------------

/**
 * Process a natural-language question end-to-end:
 *  1. Build system prompt with live schema
 *  2. Call Claude to generate a query plan and SQL
 *  3. Validate the generated SQL (security layer)
 *  4. Execute within a tenant-scoped transaction
 *  5. Generate a human-readable narrative
 *
 * @param request   - The chat request containing the user's question.
 * @param tenantId  - UUID of the authenticated tenant.
 * @param userRole  - Role of the authenticated user (for future PII redaction).
 * @returns A fully populated ChatResponse.
 */
export async function processQuestion(
  request: ChatRequest,
  tenantId: string,
  _userRole: string,
): Promise<ChatResponse> {
  // MOCK MODE: Return static data if enabled
  if (process.env.MOCK_MODE === 'true') {
    return {
      id: 'mock-response-id',
      queryPlan: {
        description: 'Mock query for testing UI flow',
        tablesUsed: ['canonical_users', 'canonical_user_provider_links'],
        estimatedComplexity: 'low',
      },
      sql: "SELECT * FROM canonical_users WHERE full_name ILIKE '%Mock%'",
      results: [
        {
          id: 'mock-person-1',
          display_name: 'Mock User 1',
          email: 'mock1@example.com',
          role: 'Admin',
          cloud_provider: 'aws',
          access_path: 'direct',
        },
        {
          id: 'mock-person-2',
          display_name: 'Mock User 2',
          email: 'mock2@example.com',
          role: 'Viewer',
          cloud_provider: 'gcp',
          access_path: 'group',
        },
      ],
      narrative: 'This is a MOCK response. Found 2 mock results. The backend is running in mock mode.',
      explanation: 'The system bypassed the database and LLM to return this static testing data.',
      metadata: {
        tablesUsed: ['canonical_users'],
        rowCount: 2,
        executionTimeMs: 10,
        cached: false,
      },
      followUpSuggestions: ['Try another mock query', 'Disable mock mode to use real data'],
    };
  }

  const msgId = randomUUID();
  const systemPrompt = await buildSystemPrompt();

  // Call the configured LLM provider
  const llm = getLLMProvider();
  const completion = await llm.complete({
    system: systemPrompt,
    userMessage: request.question,
    maxTokens: 4096,
  });

  // Parse JSON from the response, handling optional markdown fences
  let responseText = completion.text.trim();
  if (responseText.startsWith('```')) {
    responseText = responseText
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '');
  }

  let agentResponse: AgentResponse;
  try {
    agentResponse = JSON.parse(responseText);
  } catch {
    throw new Error('Failed to parse agent response as JSON');
  }

  // Handle clarification-needed responses (no SQL to execute)
  if (agentResponse.needsClarification) {
    return {
      id: msgId,
      queryPlan: agentResponse.queryPlan || {
        description: 'Clarification needed',
        tablesUsed: [],
        estimatedComplexity: 'low',
      },
      sql: '',
      results: [],
      narrative:
        agentResponse.clarificationMessage ||
        'Could you please clarify your question?',
      explanation: '',
      metadata: {
        tablesUsed: [],
        rowCount: 0,
        executionTimeMs: 0,
        cached: false,
      },
      followUpSuggestions: agentResponse.followUpSuggestions || [],
      clarificationNeeded: {
        message: agentResponse.clarificationMessage || 'Please clarify',
        options: agentResponse.clarificationOptions || [],
      },
    };
  }

  // Validate the generated SQL through the security layer
  let validation = await validateSql(agentResponse.sql);

  // If validation fails, retry once with the error feedback
  if (!validation.valid) {
    const retryMessage =
      `Your previous SQL was rejected by the validator:\n${validation.errors.join('\n')}\n\n` +
      `Original question: "${request.question}"\n` +
      `Previous SQL: ${agentResponse.sql}\n\n` +
      `Please generate a corrected SQL query that only uses tables from the allowed list. ` +
      `For access-related queries, prefer the resource_access_grants table. ` +
      `For AWS accounts, use aws_accounts. For GCP projects, use gcp_projects. ` +
      `For GCP IAM, use gcp_project_iam_bindings. For AWS assignments, use aws_account_assignments.`;

    const retryCompletion = await llm.complete({
      system: systemPrompt,
      userMessage: retryMessage,
      maxTokens: 4096,
    });

    let retryText = retryCompletion.text.trim();
    if (retryText.startsWith('```')) {
      retryText = retryText
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
    }

    try {
      agentResponse = JSON.parse(retryText);
    } catch {
      throw new Error(
        `Generated SQL failed validation: ${validation.errors.join('; ')}`,
      );
    }

    validation = await validateSql(agentResponse.sql);
    if (!validation.valid) {
      throw new Error(
        `Generated SQL failed validation: ${validation.errors.join('; ')}`,
      );
    }
  }

  let sqlToExecute = validation.sanitisedSql || agentResponse.sql;

  // Execute the validated query within a tenant-scoped transaction
  // If execution fails (e.g. wrong column name), retry once with error feedback
  let rows: Record<string, unknown>[];
  let rowCount: number;
  let durationMs: number;

  try {
    const result = await executeWithTenant(tenantId, sqlToExecute);
    rows = result.rows;
    rowCount = result.rowCount;
    durationMs = result.durationMs;
  } catch (execError: unknown) {
    const execMsg = execError instanceof Error ? execError.message : String(execError);

    // Retry once: send the DB error back to the LLM for correction
    const retryMessage =
      `Your SQL query failed with a database error:\n${execMsg}\n\n` +
      `Original question: "${request.question}"\n` +
      `Failed SQL: ${agentResponse.sql}\n\n` +
      `Please fix the SQL. Common issues:\n` +
      `- google_workspace_groups uses "name" not "display_name"\n` +
      `- aws_accounts uses "name" not "account_name" and "email" not "account_email"\n` +
      `- resource_access_grants uses "subject_display_name", "resource_display_name", "role_or_permission", "via_group_display_name", "provider"\n` +
      `- gcp_project_iam_bindings uses "member_type" and "member_id" not "member"\n` +
      `- audit_log uses "user_id", "question", "sql_executed" not "action_type", "actor_email", "query_text"\n` +
      `Check the DATABASE SCHEMA section for exact column names.`;

    const retryCompletion = await llm.complete({
      system: systemPrompt,
      userMessage: retryMessage,
      maxTokens: 4096,
    });

    let retryText = retryCompletion.text.trim();
    if (retryText.startsWith('```')) {
      retryText = retryText
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
    }

    let retryResponse: AgentResponse;
    try {
      retryResponse = JSON.parse(retryText);
    } catch {
      throw new Error(`Query execution failed: ${execMsg}`);
    }

    const retryValidation = await validateSql(retryResponse.sql);
    if (!retryValidation.valid) {
      throw new Error(`Query execution failed: ${execMsg}`);
    }

    const retrySql = retryValidation.sanitisedSql || retryResponse.sql;
    const retryResult = await executeWithTenant(tenantId, retrySql);
    rows = retryResult.rows;
    rowCount = retryResult.rowCount;
    durationMs = retryResult.durationMs;
    agentResponse = retryResponse;
    validation = retryValidation;
  }

  // Generate a human-readable narrative from the results
  const narrative = generateNarrative(
    request.question,
    rows,
    rowCount,
    agentResponse.explanation,
  );

  return {
    id: msgId,
    queryPlan: agentResponse.queryPlan,
    sql: agentResponse.sql,
    results: rows,
    narrative,
    explanation: agentResponse.explanation,
    metadata: {
      tablesUsed: validation.tablesReferenced || [],
      rowCount,
      executionTimeMs: durationMs,
      cached: false,
    },
    followUpSuggestions: agentResponse.followUpSuggestions || [],
  };
}

// ---------------------------------------------------------------------------
// Narrative generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable narrative summarising the query results.
 *
 * Provides contextual information such as cloud-provider distribution
 * and access-path breakdown when relevant columns are present.
 */
function generateNarrative(
  _question: string,
  rows: Record<string, unknown>[],
  rowCount: number,
  explanation: string,
): string {
  if (rowCount === 0) {
    return (
      'No results found matching your query. ' +
      'This could mean the access does not exist, or the search terms need adjusting.'
    );
  }

  const parts: string[] = [];
  parts.push(`Found ${rowCount} result${rowCount === 1 ? '' : 's'}.`);

  if (explanation) {
    parts.push(explanation);
  }

  // Provide additional context based on well-known columns
  if (rows.length > 0) {
    const firstRow = rows[0];

    if ('provider_type' in firstRow) {
      const providers = new Set(rows.map((r) => r.provider_type as string));
      parts.push(
        `Across ${providers.size} provider${providers.size === 1 ? '' : 's'}: ${Array.from(providers).join(', ')}.`,
      );
    }

    if ('provider' in firstRow) {
      const providers = new Set(rows.map((r) => r.provider as string));
      parts.push(
        `Across ${providers.size} provider${providers.size === 1 ? '' : 's'}: ${Array.from(providers).join(', ')}.`,
      );
    }

    if ('is_outside_collaborator' in firstRow) {
      const externalCount = rows.filter(
        (r) => r.is_outside_collaborator === true,
      ).length;
      const memberCount = rows.filter(
        (r) => r.is_outside_collaborator === false,
      ).length;
      if (externalCount > 0 || memberCount > 0) {
        parts.push(
          `${memberCount} member${memberCount === 1 ? '' : 's'} ` +
            `and ${externalCount} external collaborator${externalCount === 1 ? '' : 's'}.`,
        );
      }
    }
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/**
 * Clear the cached schema context.
 * Normally not needed since the cache auto-refreshes after TTL.
 * Provided for testing or forced refresh after DDL changes.
 */
export function clearSchemaCache(): void {
  schemaCache = null;
}
