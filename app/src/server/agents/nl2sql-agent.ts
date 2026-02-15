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

let cachedSchema: string | null = null;

/**
 * Build the schema context string from live database metadata.
 * The result is cached in memory so subsequent calls avoid a round-trip.
 */
async function getSchemaContext(): Promise<string> {
  if (cachedSchema) return cachedSchema;

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

  cachedSchema = lines.join('\n');
  return cachedSchema;
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
Question: "Show Alice's full identity map"
Query Plan: Look up a canonical user and all linked provider identities.
SQL: SELECT cu.full_name, cu.primary_email, jsonb_object_agg(link.provider_type, link.provider_user_id) as linked_identities FROM canonical_users cu JOIN canonical_user_provider_links link ON cu.id = link.canonical_user_id AND cu.tenant_id = link.tenant_id WHERE cu.primary_email ILIKE '%alice%' GROUP BY cu.id, cu.full_name, cu.primary_email
Explanation: The canonical_user_provider_links table links a canonical user to their Google, AWS, and GitHub identities via provider_type and provider_user_id.

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
  const validation = await validateSql(agentResponse.sql);
  if (!validation.valid) {
    throw new Error(
      `Generated SQL failed validation: ${validation.errors.join('; ')}`,
    );
  }

  const sqlToExecute = validation.sanitisedSql || agentResponse.sql;

  // Execute the validated query within a tenant-scoped transaction
  const { rows, rowCount, durationMs } = await executeWithTenant(
    tenantId,
    sqlToExecute,
  );

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
 * Call this after schema migrations or DDL changes.
 */
export function clearSchemaCache(): void {
  cachedSchema = null;
}
