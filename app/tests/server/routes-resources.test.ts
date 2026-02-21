import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../src/server/db/pool', () => ({
  executeWithTenant: vi.fn(),
}));

import { handleResourcesList } from '../../src/server/routes/resources';
import { executeWithTenant } from '../../src/server/db/pool';

const mockExecute = executeWithTenant as ReturnType<typeof vi.fn>;

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/resources');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleResourcesList', () => {
  describe('GitHub provider (default)', () => {
    it('should return paginated GitHub repositories', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '10' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              name: 'my-repo',
              full_name: 'org/my-repo',
              visibility: 'private',
              archived: false,
              collaborator_count: 5,
              team_permission_count: 2,
            },
          ],
          rowCount: 1,
          durationMs: 5,
        });

      const res = await handleResourcesList(makeRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('my-repo');
      expect(body.total).toBe(10);
    });
  });

  describe('AWS provider', () => {
    it('should return paginated AWS Identity Center groups', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '3' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', display_name: 'Admins', description: 'Admin group', member_count: 5 },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleResourcesList(makeRequest({ provider: 'aws' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data[0].display_name).toBe('Admins');
    });
  });

  describe('Google provider', () => {
    it('should return paginated Google Workspace groups', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '7' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', name: 'engineering', email: 'eng@example.com', member_count: 20 },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleResourcesList(makeRequest({ provider: 'google' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data[0].name).toBe('engineering');
    });
  });

  describe('invalid provider', () => {
    it('should return 400 for unsupported provider', async () => {
      const res = await handleResourcesList(makeRequest({ provider: 'azure' }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid provider');
    });
  });

  describe('search', () => {
    it('should apply search filter', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1, durationMs: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: '1', name: 'search-match', full_name: 'org/search-match' }],
          rowCount: 1,
          durationMs: 2,
        });

      const res = await handleResourcesList(makeRequest({ search: 'match' }));
      const body = await res.json();

      expect(body.data).toHaveLength(1);
      // Verify ILIKE parameter was passed
      const countParams = mockExecute.mock.calls[0][2] as unknown[];
      expect(countParams[0]).toBe('%match%');
    });
  });

  describe('pagination', () => {
    it('should respect page and limit parameters', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '50' }], rowCount: 1, durationMs: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 });

      const res = await handleResourcesList(makeRequest({ page: '2', limit: '10' }));
      const body = await res.json();

      expect(body.page).toBe(2);
      expect(body.limit).toBe(10);
      expect(body.totalPages).toBe(5);
    });

    it('should clamp limit to 100', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1, durationMs: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 });

      const res = await handleResourcesList(makeRequest({ limit: '999' }));
      const body = await res.json();

      expect(body.limit).toBe(100);
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('timeout'));

      const res = await handleResourcesList(makeRequest());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Failed to load resources');
    });
  });
});
