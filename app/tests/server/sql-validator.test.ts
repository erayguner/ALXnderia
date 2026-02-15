import { describe, it, expect } from 'vitest';
import { validateSql } from '../../src/server/validators/sql-validator';

describe('SQL Validator', () => {
  describe('safe SELECT queries', () => {
    it('should accept a simple SELECT', async () => {
      const result = await validateSql('SELECT id, display_name FROM person LIMIT 10');
      expect(result.valid).toBe(true);
      expect(result.statementType).toBe('SelectStmt');
    });

    it('should accept a query with JOINs', async () => {
      const result = await validateSql(`
        SELECT p.display_name, ea.role_or_permission_set
        FROM mv_effective_access ea
        JOIN person p ON p.id = ea.person_id
        WHERE ea.cloud_provider = 'aws'
        LIMIT 50
      `);
      expect(result.valid).toBe(true);
    });

    it('should accept aggregate queries', async () => {
      const result = await validateSql(
        'SELECT cloud_provider, COUNT(*) AS cnt FROM mv_effective_access GROUP BY cloud_provider'
      );
      expect(result.valid).toBe(true);
    });

    it('should accept subqueries in WHERE clause', async () => {
      const result = await validateSql(`
        SELECT display_name FROM person
        WHERE id IN (SELECT person_id FROM mv_effective_access WHERE cloud_provider = 'gcp')
        LIMIT 100
      `);
      expect(result.valid).toBe(true);
    });

    it('should accept CTEs', async () => {
      const result = await validateSql(`
        WITH admins AS (
          SELECT person_id FROM mv_effective_access
          WHERE role_or_permission_set = 'AdministratorAccess'
        )
        SELECT p.display_name FROM person p
        JOIN admins a ON a.person_id = p.id
        LIMIT 50
      `);
      expect(result.valid).toBe(true);
    });
  });

  describe('row limit enforcement', () => {
    it('should add LIMIT wrapper when no LIMIT present', async () => {
      const result = await validateSql('SELECT * FROM person');
      expect(result.valid).toBe(true);
      expect(result.sanitisedSql).toContain('LIMIT 500');
    });

    it('should not add LIMIT when already present', async () => {
      const result = await validateSql('SELECT * FROM person LIMIT 10');
      expect(result.valid).toBe(true);
      expect(result.sanitisedSql).not.toContain('LIMIT 500');
    });
  });

  describe('blocked statement types', () => {
    it('should reject INSERT', async () => {
      const result = await validateSql("INSERT INTO person (display_name) VALUES ('hacker')");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('SELECT'))).toBe(true);
    });

    it('should reject UPDATE', async () => {
      const result = await validateSql("UPDATE person SET status = 'departed'");
      expect(result.valid).toBe(false);
    });

    it('should reject DELETE', async () => {
      const result = await validateSql('DELETE FROM person WHERE id = $1');
      expect(result.valid).toBe(false);
    });

    it('should reject DROP TABLE', async () => {
      const result = await validateSql('DROP TABLE person');
      expect(result.valid).toBe(false);
    });

    it('should reject CREATE TABLE', async () => {
      const result = await validateSql('CREATE TABLE evil (id INT)');
      expect(result.valid).toBe(false);
    });

    it('should reject ALTER TABLE', async () => {
      const result = await validateSql('ALTER TABLE person ADD COLUMN hacked BOOLEAN');
      expect(result.valid).toBe(false);
    });

    it('should reject GRANT', async () => {
      const result = await validateSql('GRANT ALL ON person TO public');
      expect(result.valid).toBe(false);
    });

    it('should reject TRUNCATE', async () => {
      const result = await validateSql('TRUNCATE person');
      expect(result.valid).toBe(false);
    });
  });

  describe('blocked tables', () => {
    it('should reject pg_catalog access', async () => {
      const result = await validateSql('SELECT * FROM pg_catalog.pg_tables LIMIT 10');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('pg_catalog'))).toBe(true);
    });

    it('should reject information_schema access', async () => {
      const result = await validateSql('SELECT * FROM information_schema.tables LIMIT 10');
      expect(result.valid).toBe(false);
    });

    it('should reject unknown tables', async () => {
      const result = await validateSql('SELECT * FROM nonexistent_table LIMIT 10');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not in the allowed list'))).toBe(true);
    });
  });

  describe('blocked functions', () => {
    it('should reject pg_read_file', async () => {
      const result = await validateSql("SELECT pg_read_file('/etc/passwd')");
      expect(result.valid).toBe(false);
    });

    it('should reject pg_sleep', async () => {
      const result = await validateSql('SELECT pg_sleep(999)');
      expect(result.valid).toBe(false);
    });

    it('should reject dblink', async () => {
      const result = await validateSql("SELECT * FROM dblink('host=evil', 'SELECT 1') AS t(id INT)");
      expect(result.valid).toBe(false);
    });

    it('should allow safe functions', async () => {
      const result = await validateSql(
        'SELECT COUNT(*), MAX(created_at), COALESCE(display_name, \'unknown\') FROM person LIMIT 10'
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('multi-statement prevention', () => {
    it('should reject multiple statements', async () => {
      const result = await validateSql('SELECT 1; DROP TABLE person');
      expect(result.valid).toBe(false);
    });

    it('should reject statement with trailing semicolon and second statement', async () => {
      const result = await validateSql('SELECT * FROM person; SELECT * FROM tenant');
      expect(result.valid).toBe(false);
    });
  });

  describe('comment stripping', () => {
    it('should strip single-line comments', async () => {
      const result = await validateSql('SELECT * FROM person -- drop table person\nLIMIT 10');
      expect(result.valid).toBe(true);
    });

    it('should strip multi-line comments', async () => {
      const result = await validateSql('SELECT * FROM person /* evil stuff */ LIMIT 10');
      expect(result.valid).toBe(true);
    });
  });

  describe('keyword blocking', () => {
    it('should reject COPY command', async () => {
      const result = await validateSql("COPY person TO '/tmp/dump.csv'");
      expect(result.valid).toBe(false);
    });

    it('should reject SET', async () => {
      const result = await validateSql("SET role TO 'cloudintel_admin'");
      expect(result.valid).toBe(false);
    });
  });
});
