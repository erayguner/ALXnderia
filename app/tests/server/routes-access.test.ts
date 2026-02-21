import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../src/server/db/pool', () => ({
  executeWithTenant: vi.fn(),
}));

import { handleAccessList } from '../../src/server/routes/access';
import { executeWithTenant } from '../../src/server/db/pool';

const mockExecute = executeWithTenant as ReturnType<typeof vi.fn>;

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/access');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleAccessList', () => {
  describe('default (all providers, all access paths)', () => {
    it('should return paginated access data', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '25' }], rowCount: 1, durationMs: 5 })
        .mockResolvedValueOnce({
          rows: [
            {
              display_name: 'Alice',
              primary_email: 'alice@example.com',
              cloud_provider: 'github',
              role_or_permission_set: 'write',
              access_path: 'direct',
              via_group_name: null,
            },
            {
              display_name: 'Bob',
              primary_email: 'bob@example.com',
              cloud_provider: 'google',
              role_or_permission_set: 'MEMBER',
              access_path: 'group',
              via_group_name: 'engineering',
            },
          ],
          rowCount: 2,
          durationMs: 10,
        });

      const res = await handleAccessList(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(25);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(50);
    });
  });

  describe('provider filter', () => {
    it('should filter by github provider', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '5' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { display_name: 'Alice', cloud_provider: 'github', access_path: 'direct' },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccessList(makeRequest({ provider: 'github' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });

    it('should filter by google provider', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '3' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { display_name: 'Bob', cloud_provider: 'google', access_path: 'group' },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccessList(makeRequest({ provider: 'google' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });

    it('should filter by aws provider', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { display_name: 'Carol', cloud_provider: 'aws', access_path: 'group' },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccessList(makeRequest({ provider: 'aws' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('access path filter', () => {
    it('should filter by direct access path', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '4' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { display_name: 'Alice', access_path: 'direct', via_group_name: null },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccessList(makeRequest({ accessPath: 'direct' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });

    it('should filter by group access path', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '10' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { display_name: 'Bob', access_path: 'group', via_group_name: 'devops' },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccessList(makeRequest({ accessPath: 'group' }));
      const body = await res.json();

      expect(res.status).toBe(200);
    });
  });

  describe('combined filters', () => {
    it('should apply provider + accessPath + search together', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            {
              display_name: 'Alice',
              cloud_provider: 'github',
              access_path: 'direct',
              role_or_permission_set: 'admin',
            },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccessList(
        makeRequest({
          provider: 'github',
          accessPath: 'direct',
          search: 'alice',
        }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should return empty when no parts match filter combination', async () => {
      // Google provider with direct access path => no matching parts
      const res = await handleAccessList(
        makeRequest({ provider: 'google', accessPath: 'direct' }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should clamp pagination values', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1, durationMs: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 });

      const res = await handleAccessList(
        makeRequest({ page: '0', limit: '200' }),
      );
      const body = await res.json();

      expect(body.page).toBe(1);
      expect(body.limit).toBe(100);
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('connection pool exhausted'));

      const res = await handleAccessList(makeRequest());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Failed to load access data');
    });
  });
});
