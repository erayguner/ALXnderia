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
Question: "What can Oliver Smith access?"
Query Plan: Look up effective access for a person named Oliver Smith by joining mv_effective_access with person.
SQL: SELECT ea.cloud_provider, ea.account_or_project_id, ea.account_or_project_name, ea.role_or_permission_set, ea.access_path, ea.via_group_name FROM mv_effective_access ea JOIN person p ON p.id = ea.person_id WHERE p.display_name ILIKE '%Oliver Smith%' ORDER BY ea.cloud_provider, ea.account_or_project_id
Explanation: Access is derived from AWS IDC account assignments and GCP IAM bindings, both direct and via group memberships.

Example 2:
Question: "Who has admin access to the nw-prod-01 AWS account?"
Query Plan: Find all persons with AdministratorAccess permission set on the nw-prod-01 account.
SQL: SELECT p.display_name, p.primary_email, ea.role_or_permission_set, ea.access_path, ea.via_group_name FROM mv_effective_access ea JOIN person p ON p.id = ea.person_id WHERE ea.cloud_provider = 'aws' AND ea.account_or_project_id IN (SELECT account_id FROM aws_account WHERE account_name = 'nw-prod-01') AND ea.role_or_permission_set IN ('AdministratorAccess', 'PowerUserAccess') ORDER BY ea.role_or_permission_set, p.display_name
Explanation: Results show direct and group-derived admin access to this account.

Example 3:
Question: "Show users who haven't been seen in 90 days but have admin access"
Query Plan: Join effective access with provider identity tables to find stale users with high-privilege roles.
SQL: SELECT DISTINCT p.display_name, p.primary_email, ea.cloud_provider, ea.role_or_permission_set, GREATEST((SELECT MAX(last_seen_at) FROM aws_idc_user WHERE person_id = p.id), (SELECT MAX(last_seen_at) FROM aws_iam_user WHERE person_id = p.id), (SELECT MAX(last_seen_at) FROM gcp_workspace_user WHERE person_id = p.id)) AS latest_seen_at FROM mv_effective_access ea JOIN person p ON p.id = ea.person_id WHERE ea.role_or_permission_set IN ('AdministratorAccess', 'PowerUserAccess', 'roles/owner', 'roles/editor') AND GREATEST((SELECT MAX(last_seen_at) FROM aws_idc_user WHERE person_id = p.id), (SELECT MAX(last_seen_at) FROM aws_iam_user WHERE person_id = p.id), (SELECT MAX(last_seen_at) FROM gcp_workspace_user WHERE person_id = p.id)) < NOW() - INTERVAL '90 days' ORDER BY latest_seen_at ASC LIMIT 50
Explanation: These users have elevated privileges but haven't been active recently, posing a security risk.

Example 4:
Question: "Who is in the Security-Admins group?"
Query Plan: List members of an AWS IDC group matching 'Security-Admins'.
SQL: SELECT p.display_name, p.primary_email, g.display_name AS group_name FROM aws_idc_group g JOIN aws_idc_group_membership gm ON gm.group_id = g.id JOIN aws_idc_user iu ON iu.id = gm.user_id JOIN person p ON p.id = iu.person_id WHERE g.display_name ILIKE '%Security-Admins%' AND gm.deleted_at IS NULL ORDER BY p.display_name
Explanation: Members are linked through IDC group membership, then to person records via the identity linkage.
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
3. Use mv_effective_access for access/entitlement queries (it pre-joins all providers).
4. Use ILIKE for name/email searches (case-insensitive).
5. Always add ORDER BY for deterministic results.
6. Add LIMIT ${MAX_ROWS} unless the user specifies a different limit.
7. Never access pg_catalog, information_schema, or system tables.
8. If the question is ambiguous, set needsClarification to true and provide options.
9. For temporal queries, use fn_effective_access_as_of(tenant_uuid, timestamp) or query entity_history directly.
10. For PII-sensitive contexts, prefer the v_*_redacted views.

DATABASE SCHEMA:
${schema}

${synonyms}

IMPORTANT TABLE RELATIONSHIPS:
- person is the central entity linking all identities
- aws_idc_user.person_id -> person.id (AWS Identity Center identity)
- gcp_workspace_user.person_id -> person.id (Google Workspace identity)
- aws_iam_user.person_id -> person.id (AWS IAM identity)
- mv_effective_access.person_id -> person.id (pre-computed effective access)
- person_link provides the audit trail of identity linkage with confidence scores

KEY PATTERNS:
- "Who can access X?" -> query mv_effective_access filtered by account/project
- "What can person X access?" -> query mv_effective_access filtered by person
- "Group members" -> join aws_idc_group_membership or gcp_workspace_group_membership
- "Dormant/stale users" -> check last_seen_at columns on provider identity tables
- "Access changes" -> query entity_history with event_action filter

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

    if ('cloud_provider' in firstRow) {
      const providers = new Set(rows.map((r) => r.cloud_provider as string));
      parts.push(
        `Across ${providers.size} cloud provider${providers.size === 1 ? '' : 's'}: ${Array.from(providers).join(', ')}.`,
      );
    }

    if ('access_path' in firstRow) {
      const directCount = rows.filter(
        (r) => r.access_path === 'direct',
      ).length;
      const groupCount = rows.filter(
        (r) => r.access_path === 'group',
      ).length;
      if (directCount > 0 || groupCount > 0) {
        parts.push(
          `${directCount} direct entitlement${directCount === 1 ? '' : 's'} ` +
            `and ${groupCount} group-derived entitlement${groupCount === 1 ? '' : 's'}.`,
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
