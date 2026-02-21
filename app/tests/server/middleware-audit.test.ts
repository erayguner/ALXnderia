import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock('../../src/server/db/pool', () => ({
  pool: { query: mockPoolQuery },
}));

import { recordAuditEntry } from '../../src/server/middleware/audit';

describe('Audit Middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPoolQuery.mockReset();
  });

  const baseEntry = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    question: 'Show all users',
    sqlExecuted: 'SELECT * FROM canonical_users',
    rowCount: 5,
    executionTimeMs: 42,
    timestamp: new Date('2026-01-01'),
    status: 'success' as const,
  };

  it('should insert audit entry into DB', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await recordAuditEntry(baseEntry);

    expect(mockPoolQuery).toHaveBeenCalledOnce();
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      ['tenant-1', 'user-1', 'Show all users', 'SELECT * FROM canonical_users', 5, 42, 'success', null],
    );
  });

  it('should log error status entries to DB', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await recordAuditEntry({
      ...baseEntry,
      status: 'error',
      rejectionReason: 'SQL validation failed',
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['error', 'SQL validation failed']),
    );
  });

  it('should log rejected status entries to DB', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await recordAuditEntry({
      ...baseEntry,
      question: 'DROP TABLE',
      sqlExecuted: '',
      status: 'rejected',
      rejectionReason: 'Blocked keyword',
    });

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['rejected', 'Blocked keyword']),
    );
  });

  it('should fall back to console when DB write fails', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPoolQuery.mockRejectedValueOnce(new Error('DB unavailable'));

    await recordAuditEntry(baseEntry);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[AUDIT]',
      expect.objectContaining({
        tenant: 'tenant-1',
        user: 'user-1',
        question: 'Show all users',
        status: 'success',
        rowCount: 5,
        durationMs: 42,
      }),
    );
  });

  it('should never throw even when both DB and console fail', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('DB down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('Console broken');
    });

    // Should not throw — audit failures are swallowed
    await expect(recordAuditEntry(baseEntry)).resolves.toBeUndefined();
  });
});
