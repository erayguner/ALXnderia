/**
 * Shared constants for the NL2SQL application.
 *
 * Security-critical allow-lists, block-lists, and configuration
 * values used across server-side modules.
 */

// ---------------------------------------------------------------------------
// Table allow-list
// ---------------------------------------------------------------------------

/** Tables that the NL2SQL agent is permitted to query. */
export const ALLOWED_TABLES = new Set([
  // Canonical identity
  'canonical_users',
  'canonical_emails',
  'canonical_user_provider_links',
  'identity_reconciliation_queue',
  // Google Workspace
  'google_workspace_users',
  'google_workspace_groups',
  'google_workspace_memberships',
  // AWS Identity Center
  'aws_identity_center_users',
  'aws_identity_center_groups',
  'aws_identity_center_memberships',
  // GitHub
  'github_organisations',
  'github_users',
  'github_teams',
  'github_org_memberships',
  'github_team_memberships',
  'github_repositories',
  'github_repo_team_permissions',
  'github_repo_collaborator_permissions',
]);

// ---------------------------------------------------------------------------
// PII protection
// ---------------------------------------------------------------------------

/** Tables containing personally-identifiable information that require redaction for readonly users. */
export const PII_TABLES = new Set([
  'canonical_users',
  'canonical_emails',
  'google_workspace_users',
  'aws_identity_center_users',
  'github_users',
]);

/** Mapping from PII tables to their redacted view equivalents. */
export const REDACTED_VIEW_MAP: Record<string, string> = {
  // No redacted views in the current schema; placeholder for future use
};

// ---------------------------------------------------------------------------
// SQL security block-lists
// ---------------------------------------------------------------------------

/** PostgreSQL functions that must never appear in generated queries. */
export const BLOCKED_FUNCTIONS = new Set([
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir',
  'lo_import', 'lo_export', 'lo_get', 'lo_put',
  'dblink', 'dblink_exec', 'dblink_connect',
  'copy', 'pg_copy_from', 'pg_copy_to',
  'set_config', 'current_setting',
  'pg_terminate_backend', 'pg_cancel_backend',
  'pg_reload_conf', 'pg_rotate_logfile',
  'txid_current', 'pg_advisory_lock',
  'pg_sleep',
]);

/** Table-name prefixes that indicate system/catalogue tables. */
export const BLOCKED_TABLE_PREFIXES = [
  'pg_', 'information_schema.', 'pg_catalog.',
];

/** SQL keywords that must be rejected regardless of statement type. */
export const BLOCKED_KEYWORDS = new Set([
  'GRANT', 'REVOKE', 'SET', 'RESET', 'LOAD',
  'COPY', 'EXECUTE', 'PREPARE', 'DEALLOCATE',
  'LISTEN', 'NOTIFY', 'VACUUM', 'ANALYZE',
  'CLUSTER', 'REINDEX', 'SECURITY DEFINER',
]);

// ---------------------------------------------------------------------------
// Query limits and rate-limiting
// ---------------------------------------------------------------------------

/** Maximum number of rows returned by any single query. */
export const MAX_ROWS = 500;

/** Per-query execution timeout in milliseconds. */
export const QUERY_TIMEOUT_MS = 10_000;

/** Maximum length of a user-submitted question (characters). */
export const MAX_QUESTION_LENGTH = 1_000;

/** Maximum number of queries a user may submit per minute. */
export const RATE_LIMIT_PER_MINUTE = 30;

// ---------------------------------------------------------------------------
// Schema synonyms for NL2SQL
// ---------------------------------------------------------------------------

/**
 * Maps canonical table names to natural-language synonyms.
 * The NL2SQL agent uses these to resolve ambiguous references
 * in user questions.
 */
export const SCHEMA_SYNONYMS: Record<string, string[]> = {
  'canonical_users': ['user', 'person', 'people', 'employee', 'staff', 'member', 'identity'],
  'canonical_emails': ['email', 'emails', 'email address'],
  'canonical_user_provider_links': ['identity link', 'linkage', 'provider link', 'linked identity'],
  'identity_reconciliation_queue': ['reconciliation', 'unmatched', 'pending review', 'unmapped'],
  'google_workspace_users': ['google user', 'workspace user', 'gws user', 'google account'],
  'google_workspace_groups': ['google group', 'workspace group', 'gws group'],
  'google_workspace_memberships': ['google membership', 'workspace membership'],
  'aws_identity_center_users': ['aws user', 'idc user', 'identity center user', 'sso user'],
  'aws_identity_center_groups': ['aws group', 'idc group', 'identity center group', 'sso group'],
  'aws_identity_center_memberships': ['aws membership', 'idc membership'],
  'github_organisations': ['github org', 'github organisation', 'github organization', 'gh org'],
  'github_users': ['github user', 'github member', 'gh user', 'github account'],
  'github_teams': ['github team', 'gh team', 'team'],
  'github_org_memberships': ['github org member', 'org membership', 'org admin'],
  'github_team_memberships': ['github team member', 'team membership'],
  'github_repositories': ['repo', 'repository', 'repos', 'github repo'],
  'github_repo_team_permissions': ['repo team permission', 'team access'],
  'github_repo_collaborator_permissions': ['repo collaborator', 'collaborator', 'outside collaborator', 'repo access'],
};
