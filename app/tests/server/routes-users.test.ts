import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../src/server/db/pool', () => ({
  executeWithTenant: vi.fn(),
}));

import { handleUserList, handleUserDetail } from '../../src/server/routes/users';
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

describe('handleUserList', () => {
  it('should return paginated list of users', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '42' }], rowCount: 1, durationMs: 3 })
      .mockResolvedValueOnce({
        rows: [
          { id: '1', full_name: 'Alice', primary_email: 'alice@example.com', identity_count: 3 },
          { id: '2', full_name: 'Bob', primary_email: 'bob@example.com', identity_count: 2 },
        ],
        rowCount: 2,
        durationMs: 5,
      });

    const res = await handleUserList(makeRequest('/api/users'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(42);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.totalPages).toBe(1);
  });

  it('should apply search filter', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1, durationMs: 2 })
      .mockResolvedValueOnce({
        rows: [{ id: '1', full_name: 'Alice', primary_email: 'alice@example.com' }],
        rowCount: 1,
        durationMs: 3,
      });

    const res = await handleUserList(makeRequest('/api/users', { search: 'alice' }));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    // Verify search param was passed to the query
    const countCallParams = mockExecute.mock.calls[0][2] as unknown[];
    expect(countCallParams[0]).toBe('%alice%');
  });

  it('should handle custom pagination params', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '100' }], rowCount: 1, durationMs: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 2 });

    const res = await handleUserList(
      makeRequest('/api/users', { page: '3', limit: '20' }),
    );
    const body = await res.json();

    expect(body.page).toBe(3);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(5);
  });

  it('should clamp page to minimum 1 and limit to maximum 100', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1, durationMs: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 });

    const res = await handleUserList(
      makeRequest('/api/users', { page: '-5', limit: '999' }),
    );
    const body = await res.json();

    expect(body.page).toBe(1);
    expect(body.limit).toBe(100);
  });

  it('should return 500 on database error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'));

    const res = await handleUserList(makeRequest('/api/users'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to load users');
  });
});

describe('handleUserDetail', () => {
  it('should return user with linked identities', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        full_name: 'Alice',
        primary_email: 'alice@example.com',
        linked_identities: [{ provider_type: 'GITHUB', provider_user_id: 'gh-123' }],
        emails: [{ email: 'alice@example.com', is_primary: true }],
        google_identities: null,
        aws_idc_identities: null,
        github_identities: [{ login: 'alice-gh', email: 'alice@example.com' }],
        github_org_memberships: null,
        github_team_memberships: null,
        github_repo_access: null,
      }],
      rowCount: 1,
      durationMs: 8,
    });

    const res = await handleUserDetail(makeRequest('/api/users/user-1'), 'user-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.full_name).toBe('Alice');
    expect(body.user.linked_identities).toHaveLength(1);
  });

  it('should return github org memberships, team memberships, and repo access', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-2',
        full_name: 'Bob',
        primary_email: 'bob@example.com',
        linked_identities: [],
        emails: [],
        google_identities: null,
        aws_idc_identities: null,
        github_identities: [{ login: 'bob-gh', email: 'bob@example.com', name: 'Bob', type: 'User' }],
        github_org_memberships: [
          { org_login: 'my-org', org_name: 'My Org', role: 'member', state: 'active' },
        ],
        github_team_memberships: [
          { team_id: 'team-uuid-1', team_name: 'Platform', team_slug: 'platform', org_login: 'my-org', role: 'maintainer', state: 'active' },
        ],
        github_repo_access: [
          { repo_full_name: 'my-org/secret-repo', repo_name: 'secret-repo', permission: 'push', is_outside_collaborator: true },
        ],
      }],
      rowCount: 1,
      durationMs: 10,
    });

    const res = await handleUserDetail(makeRequest('/api/users/user-2'), 'user-2');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.github_org_memberships).toHaveLength(1);
    expect(body.user.github_org_memberships[0].org_login).toBe('my-org');
    expect(body.user.github_team_memberships).toHaveLength(1);
    expect(body.user.github_team_memberships[0].team_name).toBe('Platform');
    expect(body.user.github_team_memberships[0].team_id).toBe('team-uuid-1');
    expect(body.user.github_repo_access).toHaveLength(1);
    expect(body.user.github_repo_access[0].is_outside_collaborator).toBe(true);
  });

  it('should return 404 when user not found', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 3 });

    const res = await handleUserDetail(
      makeRequest('/api/users/nonexistent'),
      'nonexistent',
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  it('should return 500 on database error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('query timeout'));

    const res = await handleUserDetail(makeRequest('/api/users/user-1'), 'user-1');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to load user');
  });
});
