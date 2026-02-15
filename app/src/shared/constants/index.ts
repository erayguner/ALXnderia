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
  'tenant',
  'person',
  'person_link',
  'aws_account',
  'aws_iam_user',
  'aws_iam_user_policy_attachment',
  'aws_idc_user',
  'aws_idc_group',
  'aws_idc_group_membership',
  'aws_idc_permission_set',
  'aws_idc_account_assignment',
  'gcp_project',
  'gcp_workspace_user',
  'gcp_workspace_group',
  'gcp_workspace_group_membership',
  'gcp_iam_binding',
  'github_organisation',
  'github_user',
  'github_team',
  'github_team_membership',
  'github_org_membership',
  'mv_effective_access',
  'entity_history',
  'snapshot_registry',
  // PII-redacted views
  'v_person_redacted',
  'v_aws_idc_user_redacted',
  'v_gcp_workspace_user_redacted',
  'v_github_user_redacted',
  'v_effective_access_redacted',
]);

// ---------------------------------------------------------------------------
// PII protection
// ---------------------------------------------------------------------------

/** Tables containing personally-identifiable information that require redaction for readonly users. */
export const PII_TABLES = new Set([
  'person',
  'aws_idc_user',
  'gcp_workspace_user',
  'aws_iam_user',
  'github_user',
]);

/** Mapping from PII tables to their redacted view equivalents. */
export const REDACTED_VIEW_MAP: Record<string, string> = {
  'person': 'v_person_redacted',
  'aws_idc_user': 'v_aws_idc_user_redacted',
  'gcp_workspace_user': 'v_gcp_workspace_user_redacted',
  'github_user': 'v_github_user_redacted',
  'mv_effective_access': 'v_effective_access_redacted',
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
  'aws_account': ['account', 'aws account', 'aws accounts'],
  'gcp_project': ['project', 'gcp project', 'google project', 'gcp projects'],
  'person': ['user', 'person', 'people', 'employee', 'staff', 'member'],
  'aws_idc_group': ['idc group', 'identity center group', 'aws group', 'sso group'],
  'gcp_workspace_group': ['workspace group', 'google group', 'gws group'],
  'aws_idc_permission_set': ['permission set', 'permission', 'access level'],
  'aws_idc_account_assignment': ['assignment', 'account assignment', 'aws assignment'],
  'gcp_iam_binding': ['binding', 'iam binding', 'gcp binding', 'role binding'],
  'mv_effective_access': ['access', 'effective access', 'entitlement', 'entitlements'],
  'person_link': ['identity link', 'linkage', 'person link'],
  'entity_history': ['history', 'audit trail', 'change log', 'changelog'],
  'github_organisation': ['github org', 'github organisation', 'github organization', 'gh org'],
  'github_user': ['github user', 'github member', 'gh user', 'github account'],
  'github_team': ['github team', 'gh team'],
  'github_team_membership': ['github team member', 'team membership'],
  'github_org_membership': ['github org member', 'org membership'],
};
