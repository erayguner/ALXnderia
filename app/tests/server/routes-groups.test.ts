import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../src/server/db/pool', () => ({
  executeWithTenant: vi.fn(),
}));

import { handleGroupsList, handleGroupDetails } from '../../src/server/routes/groups';
import { executeWithTenant } from '../../src/server/db/pool';

const mockExecute = executeWithTenant as ReturnType<typeof vi.fn>;

function makeRequest(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleGroupsList', () => {
  describe('single provider filters', () => {
    it('should return Google groups when provider=google', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', name: 'engineering', provider: 'google', member_count: 10 },
            { id: '2', name: 'marketing', provider: 'google', member_count: 5 },
          ],
          rowCount: 2,
          durationMs: 4,
        });

      const res = await handleGroupsList(
        makeRequest('/api/groups', { provider: 'google' }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('should return AWS groups when provider=aws', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [{ id: '1', name: 'SecurityAdmins', provider: 'aws', member_count: 3 }],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleGroupsList(
        makeRequest('/api/groups', { provider: 'aws' }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });

    it('should return GitHub teams when provider=github', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '3' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', name: 'platform', provider: 'github', member_count: 8 },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleGroupsList(
        makeRequest('/api/groups', { provider: 'github' }),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('all providers (no filter)', () => {
    it('should return union of all groups', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '5' }], rowCount: 1, durationMs: 3 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', name: 'eng', provider: 'google' },
            { id: '2', name: 'devops', provider: 'aws' },
            { id: '3', name: 'platform', provider: 'github' },
          ],
          rowCount: 3,
          durationMs: 8,
        });

      const res = await handleGroupsList(makeRequest('/api/groups'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(3);
      expect(body.total).toBe(5);
    });
  });

  describe('search', () => {
    it('should filter groups by search term', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1, durationMs: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: '1', name: 'security-team', provider: 'github' }],
          rowCount: 1,
          durationMs: 2,
        });

      const res = await handleGroupsList(
        makeRequest('/api/groups', { provider: 'github', search: 'security' }),
      );
      const body = await res.json();

      expect(body.data).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('connection refused'));

      const res = await handleGroupsList(
        makeRequest('/api/groups', { provider: 'google' }),
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Failed to load groups');
    });
  });
});

describe('handleGroupDetails', () => {
  it('should return Google group with members', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ id: 'g1', name: 'engineering', provider: 'google', google_id: 'gid-1' }],
        rowCount: 1,
        durationMs: 3,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'm1', email: 'alice@example.com', name: 'Alice', role: 'MEMBER' },
          { id: 'm2', email: 'bob@example.com', name: 'Bob', role: 'OWNER' },
        ],
        rowCount: 2,
        durationMs: 4,
      });

    const res = await handleGroupDetails(
      makeRequest('/api/groups/g1', { provider: 'google' }),
      'g1',
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.group.name).toBe('engineering');
    expect(body.members).toHaveLength(2);
  });

  it('should return 404 when group not found', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 2 });
    mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 2 });
    mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 2 });

    const res = await handleGroupDetails(
      makeRequest('/api/groups/nonexistent'),
      'nonexistent',
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  it('should return GitHub team with members (with canonical_user_id) and repository permissions', async () => {
    // provider=github → Google and AWS checks are skipped; only 3 calls: team, members, repos
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 'gh-team-1',
          name: 'Platform',
          slug: 'platform',
          node_id: 'NT_platform',
          provider: 'github',
          description: 'Platform team',
          last_synced_at: null,
        }],
        rowCount: 1,
        durationMs: 3,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'm1', login: 'alice', name: 'Alice', role: 'maintainer', state: 'active', canonical_user_id: 'cu-alice' },
          { id: 'm2', login: 'bob', name: 'Bob', role: 'member', state: 'active', canonical_user_id: null },
        ],
        rowCount: 2,
        durationMs: 4,
      })
      .mockResolvedValueOnce({
        rows: [
          { repo_id: 'r1', full_name: 'my-org/infra', repo_name: 'infra', visibility: 'private', archived: false, permission: 'push' },
          { repo_id: 'r2', full_name: 'my-org/docs', repo_name: 'docs', visibility: 'public', archived: false, permission: 'pull' },
        ],
        rowCount: 2,
        durationMs: 3,
      });

    const res = await handleGroupDetails(
      makeRequest('/api/groups/gh-team-1', { provider: 'github' }),
      'gh-team-1',
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.group.name).toBe('Platform');
    expect(body.group.provider).toBe('github');
    expect(body.members).toHaveLength(2);
    expect(body.members[0].canonical_user_id).toBe('cu-alice');
    expect(body.members[1].canonical_user_id).toBeNull();
    expect(body.repositories).toHaveLength(2);
    expect(body.repositories[0].full_name).toBe('my-org/infra');
    expect(body.repositories[0].permission).toBe('push');
    expect(body.repositories[1].permission).toBe('pull');
  });

  it('should return Google group members with canonical_user_id', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ id: 'g1', name: 'engineering', provider: 'google', google_id: 'gid-1' }],
        rowCount: 1,
        durationMs: 3,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'm1', email: 'alice@example.com', name: 'Alice', role: 'MEMBER', canonical_user_id: 'cu-alice' },
          { id: 'm2', email: 'bob@example.com', name: 'Bob', role: 'OWNER', canonical_user_id: null },
        ],
        rowCount: 2,
        durationMs: 4,
      });

    const res = await handleGroupDetails(
      makeRequest('/api/groups/g1', { provider: 'google' }),
      'g1',
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.members[0].canonical_user_id).toBe('cu-alice');
    expect(body.repositories).toHaveLength(0);
  });

  it('should return AWS group details when found in AWS', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 }) // Google: not found
      .mockResolvedValueOnce({
        rows: [{
          id: 'aws-1',
          name: 'DevOps',
          provider: 'aws',
          group_id: 'grp-1',
          identity_store_id: 'store-1',
        }],
        rowCount: 1,
        durationMs: 3,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'm1', email: 'admin@example.com', name: 'Admin', role: 'MEMBER' }],
        rowCount: 1,
        durationMs: 2,
      });

    const res = await handleGroupDetails(
      makeRequest('/api/groups/aws-1'),
      'aws-1',
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.group.name).toBe('DevOps');
    expect(body.members).toHaveLength(1);
  });

  it('should return 500 on database error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('timeout'));

    const res = await handleGroupDetails(
      makeRequest('/api/groups/g1', { provider: 'google' }),
      'g1',
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to load group details');
  });
});
