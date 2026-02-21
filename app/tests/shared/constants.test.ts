import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TABLES,
  PII_TABLES,
  BLOCKED_FUNCTIONS,
  BLOCKED_TABLE_PREFIXES,
  BLOCKED_KEYWORDS,
  MAX_ROWS,
  QUERY_TIMEOUT_MS,
  MAX_QUESTION_LENGTH,
  RATE_LIMIT_PER_MINUTE,
  SCHEMA_SYNONYMS,
} from '../../src/shared/constants';

describe('Constants', () => {
  describe('ALLOWED_TABLES', () => {
    it('should be a non-empty Set', () => {
      expect(ALLOWED_TABLES).toBeInstanceOf(Set);
      expect(ALLOWED_TABLES.size).toBeGreaterThan(0);
    });

    it('should contain all canonical identity tables', () => {
      expect(ALLOWED_TABLES.has('canonical_users')).toBe(true);
      expect(ALLOWED_TABLES.has('canonical_emails')).toBe(true);
      expect(ALLOWED_TABLES.has('canonical_user_provider_links')).toBe(true);
      expect(ALLOWED_TABLES.has('identity_reconciliation_queue')).toBe(true);
    });

    it('should contain all Google Workspace tables', () => {
      expect(ALLOWED_TABLES.has('google_workspace_users')).toBe(true);
      expect(ALLOWED_TABLES.has('google_workspace_groups')).toBe(true);
      expect(ALLOWED_TABLES.has('google_workspace_memberships')).toBe(true);
    });

    it('should contain all AWS Identity Center tables', () => {
      expect(ALLOWED_TABLES.has('aws_identity_center_users')).toBe(true);
      expect(ALLOWED_TABLES.has('aws_identity_center_groups')).toBe(true);
      expect(ALLOWED_TABLES.has('aws_identity_center_memberships')).toBe(true);
    });

    it('should contain all GitHub tables', () => {
      expect(ALLOWED_TABLES.has('github_organisations')).toBe(true);
      expect(ALLOWED_TABLES.has('github_users')).toBe(true);
      expect(ALLOWED_TABLES.has('github_teams')).toBe(true);
      expect(ALLOWED_TABLES.has('github_repositories')).toBe(true);
      expect(ALLOWED_TABLES.has('github_org_memberships')).toBe(true);
      expect(ALLOWED_TABLES.has('github_team_memberships')).toBe(true);
      expect(ALLOWED_TABLES.has('github_repo_team_permissions')).toBe(true);
      expect(ALLOWED_TABLES.has('github_repo_collaborator_permissions')).toBe(true);
    });

    it('should not contain system tables', () => {
      expect(ALLOWED_TABLES.has('pg_catalog')).toBe(false);
      expect(ALLOWED_TABLES.has('pg_tables')).toBe(false);
      expect(ALLOWED_TABLES.has('information_schema')).toBe(false);
    });
  });

  describe('PII_TABLES', () => {
    it('should be a subset of ALLOWED_TABLES', () => {
      for (const table of PII_TABLES) {
        expect(ALLOWED_TABLES.has(table)).toBe(true);
      }
    });

    it('should contain user-related tables with personal data', () => {
      expect(PII_TABLES.has('canonical_users')).toBe(true);
      expect(PII_TABLES.has('canonical_emails')).toBe(true);
    });

    it('should not contain group or permission tables', () => {
      expect(PII_TABLES.has('google_workspace_groups')).toBe(false);
      expect(PII_TABLES.has('github_teams')).toBe(false);
      expect(PII_TABLES.has('github_repositories')).toBe(false);
    });
  });

  describe('BLOCKED_FUNCTIONS', () => {
    it('should block file-system access functions', () => {
      expect(BLOCKED_FUNCTIONS.has('pg_read_file')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('pg_read_binary_file')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('pg_ls_dir')).toBe(true);
    });

    it('should block large-object functions', () => {
      expect(BLOCKED_FUNCTIONS.has('lo_import')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('lo_export')).toBe(true);
    });

    it('should block external connection functions', () => {
      expect(BLOCKED_FUNCTIONS.has('dblink')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('dblink_exec')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('dblink_connect')).toBe(true);
    });

    it('should block administrative functions', () => {
      expect(BLOCKED_FUNCTIONS.has('pg_terminate_backend')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('pg_cancel_backend')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('pg_reload_conf')).toBe(true);
    });

    it('should block denial-of-service functions', () => {
      expect(BLOCKED_FUNCTIONS.has('pg_sleep')).toBe(true);
      expect(BLOCKED_FUNCTIONS.has('pg_advisory_lock')).toBe(true);
    });
  });

  describe('BLOCKED_TABLE_PREFIXES', () => {
    it('should block pg_ prefixed tables', () => {
      expect(BLOCKED_TABLE_PREFIXES.some(p => 'pg_tables'.startsWith(p))).toBe(true);
    });

    it('should block information_schema tables', () => {
      expect(BLOCKED_TABLE_PREFIXES.some(p => 'information_schema.tables'.startsWith(p))).toBe(true);
    });
  });

  describe('BLOCKED_KEYWORDS', () => {
    it('should block privilege escalation keywords', () => {
      expect(BLOCKED_KEYWORDS.has('GRANT')).toBe(true);
      expect(BLOCKED_KEYWORDS.has('REVOKE')).toBe(true);
    });

    it('should block session manipulation keywords', () => {
      expect(BLOCKED_KEYWORDS.has('SET')).toBe(true);
      expect(BLOCKED_KEYWORDS.has('RESET')).toBe(true);
    });

    it('should block maintenance keywords', () => {
      expect(BLOCKED_KEYWORDS.has('VACUUM')).toBe(true);
      expect(BLOCKED_KEYWORDS.has('ANALYZE')).toBe(true);
      expect(BLOCKED_KEYWORDS.has('REINDEX')).toBe(true);
    });
  });

  describe('query limits', () => {
    it('MAX_ROWS should be a reasonable positive number', () => {
      expect(MAX_ROWS).toBeGreaterThan(0);
      expect(MAX_ROWS).toBeLessThanOrEqual(10_000);
    });

    it('QUERY_TIMEOUT_MS should be between 1s and 60s', () => {
      expect(QUERY_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
      expect(QUERY_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    });

    it('MAX_QUESTION_LENGTH should be a reasonable limit', () => {
      expect(MAX_QUESTION_LENGTH).toBeGreaterThan(0);
      expect(MAX_QUESTION_LENGTH).toBeLessThanOrEqual(10_000);
    });

    it('RATE_LIMIT_PER_MINUTE should be a positive number', () => {
      expect(RATE_LIMIT_PER_MINUTE).toBeGreaterThan(0);
    });
  });

  describe('SCHEMA_SYNONYMS', () => {
    it('should have entries for all allowed tables', () => {
      for (const table of Object.keys(SCHEMA_SYNONYMS)) {
        expect(ALLOWED_TABLES.has(table)).toBe(true);
      }
    });

    it('should have non-empty synonym arrays', () => {
      for (const [table, synonyms] of Object.entries(SCHEMA_SYNONYMS)) {
        expect(synonyms.length).toBeGreaterThan(0);
        for (const synonym of synonyms) {
          expect(synonym.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it('should map common terms to expected tables', () => {
      expect(SCHEMA_SYNONYMS['canonical_users']).toContain('person');
      expect(SCHEMA_SYNONYMS['canonical_users']).toContain('people');
      expect(SCHEMA_SYNONYMS['github_repositories']).toContain('repo');
      expect(SCHEMA_SYNONYMS['github_teams']).toContain('team');
    });
  });
});
