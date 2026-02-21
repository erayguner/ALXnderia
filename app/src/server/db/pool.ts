/**
 * Database connection pool with Row-Level Security (RLS) support.
 *
 * Provides tenant-scoped query execution by setting
 * `app.current_tenant_id` via SET LOCAL within a transaction,
 * ensuring that PostgreSQL RLS policies are enforced transparently.
 */

import { Pool, type QueryResultRow } from 'pg';

// ---------------------------------------------------------------------------
// Pool initialisation
// ---------------------------------------------------------------------------

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'cloudintel',
  password: process.env.PG_PASSWORD || 'localdev-change-me',
  database: process.env.PG_DATABASE || 'cloud_identity_intel',
  min: 2,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// ---------------------------------------------------------------------------
// Tenant-scoped execution
// ---------------------------------------------------------------------------

/**
 * Execute a query within an RLS-aware transaction.
 *
 * Sets the tenant context via `SET LOCAL` before running the query,
 * guaranteeing that all RLS policies see the correct tenant identifier.
 *
 * @param tenantId  - UUID of the tenant whose data should be visible.
 * @param sql       - The SQL statement to execute.
 * @param params    - Bind parameters for the query.
 * @param timeoutMs - Per-statement timeout (defaults to 10 s).
 * @returns The result rows, count, and wall-clock duration.
 */
export async function executeWithTenant<T extends QueryResultRow = Record<string, unknown>>(
  tenantId: string,
  sql: string,
  params: unknown[] = [],
  timeoutMs: number = 10_000,
): Promise<{ rows: T[]; rowCount: number; durationMs: number }> {
  const client = await pool.connect();
  const start = Date.now();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['statement_timeout', Number(timeoutMs) + 'ms']);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId.replace(/[^a-f0-9-]/g, '')]);

    const result = await client.query<T>(sql, params);

    await client.query('COMMIT');

    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? 0,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// System-level (non-tenant) execution
// ---------------------------------------------------------------------------

/**
 * Execute a read-only query without tenant context.
 *
 * Intended for administrative or system-level operations such as
 * schema introspection where RLS scoping is not required.
 */
export async function executeReadOnly<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await pool.query<T>(sql, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

/**
 * Retrieve schema metadata from information_schema and pg_matviews.
 *
 * Returns table names, column definitions, foreign-key relationships,
 * and materialised views within the `public` schema.
 */
export async function getSchemaMetadata() {
  const tablesResult = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY table_name
  `);

  const columnsResult = await pool.query(`
    SELECT table_name, column_name, data_type, is_nullable,
           col_description(
             (table_schema || '.' || table_name)::regclass,
             ordinal_position
           ) AS description
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const fksResult = await pool.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name  AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);

  // Materialised views are not listed in information_schema
  const mvsResult = await pool.query(`
    SELECT matviewname AS table_name
    FROM pg_matviews
    WHERE schemaname = 'public'
  `);

  return {
    tables: tablesResult.rows,
    columns: columnsResult.rows,
    foreignKeys: fksResult.rows,
    materializedViews: mvsResult.rows,
  };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Lightweight connectivity check.
 *
 * Returns `true` if the pool can successfully execute a trivial query,
 * `false` otherwise. Safe to call from readiness probes.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { pool };
