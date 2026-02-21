/**
 * Audit logging middleware.
 *
 * Writes query audit entries to the audit_log table. Falls back to
 * console logging if the DB write fails. Audit failures never
 * propagate to the caller, ensuring that a broken audit pipeline
 * does not degrade the primary query flow.
 */

import type { AuditEntry } from '../../shared/types';
import { pool } from '../db/pool';

const INSERT_SQL = `
  INSERT INTO audit_log (tenant_id, user_id, question, sql_executed, row_count, execution_time_ms, status, rejection_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

/**
 * Record a query audit entry.
 *
 * Writes to audit_log table; falls back to console on failure.
 */
export async function recordAuditEntry(
  entry: Omit<AuditEntry, 'id'>,
): Promise<void> {
  try {
    await pool.query(INSERT_SQL, [
      entry.tenantId,
      entry.userId,
      entry.question,
      entry.sqlExecuted,
      entry.rowCount,
      entry.executionTimeMs,
      entry.status,
      entry.rejectionReason ?? null,
    ]);
  } catch (dbError) {
    // Fallback: log to console so audit data is never silently lost
    try {
      console.error('Failed to write audit entry to DB, falling back to console:', dbError);
      console.log('[AUDIT]', {
        tenant: entry.tenantId,
        user: entry.userId,
        question: entry.question,
        status: entry.status,
        rowCount: entry.rowCount,
        durationMs: entry.executionTimeMs,
      });
    } catch {
      // Swallow: audit must never break the primary flow
    }
  }
}
