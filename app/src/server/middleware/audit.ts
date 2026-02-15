/**
 * Audit logging middleware.
 *
 * The current multi-tenant schema does not include an audit_log table.
 * This middleware logs audit entries to the console only. When an
 * audit table is added, the INSERT should be restored here.
 *
 * Audit failures never propagate to the caller, ensuring that a
 * broken audit pipeline does not degrade the primary query flow.
 */

import type { AuditEntry } from '../../shared/types';

/**
 * Record a query audit entry.
 *
 * Currently logs to console only (no audit_log table in schema).
 */
export async function recordAuditEntry(
  entry: Omit<AuditEntry, 'id'>,
): Promise<void> {
  try {
    console.log('[AUDIT]', {
      tenant: entry.tenantId,
      user: entry.userId,
      question: entry.question,
      status: entry.status,
      rowCount: entry.rowCount,
      durationMs: entry.executionTimeMs,
    });
  } catch (error) {
    console.error('Failed to record audit entry:', error);
  }
}
