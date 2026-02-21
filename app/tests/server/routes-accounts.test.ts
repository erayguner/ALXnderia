import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../src/server/db/pool', () => ({
  executeWithTenant: vi.fn(),
}));

import { handleAccountList, handleAccountDetail } from '../../src/server/routes/accounts';
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

// ---------------------------------------------------------------------------
// handleAccountList
// ---------------------------------------------------------------------------

describe('handleAccountList', () => {
  describe('provider=aws', () => {
    it('should return paginated AWS accounts', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '3' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { id: 'acct-1', account_id: '111111111111', name: 'Production', email: 'root@prod.com', status: 'ACTIVE', org_id: 'o-abc', last_synced_at: null, provider: 'aws', access_count: '5' },
            { id: 'acct-2', account_id: '222222222222', name: 'Staging', email: 'root@stage.com', status: 'ACTIVE', org_id: 'o-abc', last_synced_at: null, provider: 'aws', access_count: '2' },
          ],
          rowCount: 2,
          durationMs: 4,
        });

      const res = await handleAccountList(makeRequest('/api/accounts', { provider: 'aws' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(3);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(50);
    });

    it('should apply search filter for AWS accounts', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1, durationMs: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: 'acct-1', account_id: '111111111111', name: 'Production', provider: 'aws', access_count: '5' }],
          rowCount: 1,
          durationMs: 2,
        });

      const res = await handleAccountList(makeRequest('/api/accounts', { provider: 'aws', search: 'prod' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      const callParams = mockExecute.mock.calls[0][2] as unknown[];
      expect(callParams[0]).toBe('%prod%');
    });
  });

  describe('provider=gcp', () => {
    it('should return paginated GCP projects', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '2' }], rowCount: 1, durationMs: 2 })
        .mockResolvedValueOnce({
          rows: [
            { id: 'proj-1', project_id: 'my-project-123', project_number: '314159265358', name: 'My Project', status: 'ACTIVE', org_id: null, last_synced_at: null, provider: 'gcp', access_count: '10' },
          ],
          rowCount: 1,
          durationMs: 3,
        });

      const res = await handleAccountList(makeRequest('/api/accounts', { provider: 'gcp' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(2);
    });
  });

  describe('no provider (UNION ALL)', () => {
    it('should return combined AWS + GCP results', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '4' }], rowCount: 1, durationMs: 3 })
        .mockResolvedValueOnce({
          rows: [
            { id: 'acct-1', resource_id: '111111111111', display_name: 'Production', status: 'ACTIVE', provider: 'aws', access_count: '5' },
            { id: 'proj-1', resource_id: 'my-project-123', display_name: 'My Project', status: 'ACTIVE', provider: 'gcp', access_count: '10' },
          ],
          rowCount: 2,
          durationMs: 6,
        });

      const res = await handleAccountList(makeRequest('/api/accounts'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(4);
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('connection timeout'));

      const res = await handleAccountList(makeRequest('/api/accounts', { provider: 'aws' }));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Failed to load accounts');
    });
  });
});

// ---------------------------------------------------------------------------
// handleAccountDetail
// ---------------------------------------------------------------------------

describe('handleAccountDetail', () => {
  it('should return AWS account with access entries and group assignments', async () => {
    // 1: AWS account lookup (found)
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 'acct-1',
          account_id: '111111111111',
          name: 'Production',
          email: 'root@prod.com',
          status: 'ACTIVE',
          joined_method: 'CREATED',
          joined_at: null,
          org_id: 'o-abc123',
          parent_id: null,
          last_synced_at: null,
          provider: 'aws',
        }],
        rowCount: 1,
        durationMs: 3,
      })
      // 2-4: parallel queries (direct, group-expanded, group-direct)
      .mockResolvedValueOnce({
        rows: [
          { role_or_permission: 'AdministratorAccess', permission_set_arn: 'arn:aws:sso:::permissionSet/1', access_path: 'direct', via_group_name: null, subject_email: 'alice@example.com', subject_name: 'Alice', subject_type: 'USER', canonical_user_id: 'cu-alice' },
        ],
        rowCount: 1,
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        rows: [
          { role_or_permission: 'ReadOnlyAccess', permission_set_arn: 'arn:aws:sso:::permissionSet/2', access_path: 'group', via_group_name: 'Developers', subject_email: 'bob@example.com', subject_name: 'Bob', subject_type: 'USER', canonical_user_id: null },
        ],
        rowCount: 1,
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        rows: [
          { role_or_permission: 'ReadOnlyAccess', permission_set_arn: 'arn:aws:sso:::permissionSet/2', access_path: 'group', via_group_name: 'Developers', subject_name: 'Developers', subject_email: null, subject_type: 'GROUP', canonical_user_id: null },
        ],
        rowCount: 1,
        durationMs: 2,
      });

    const res = await handleAccountDetail(
      makeRequest('/api/accounts/acct-1', { provider: 'aws' }),
      'acct-1',
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account.name).toBe('Production');
    expect(body.account.provider).toBe('aws');
    expect(body.access_entries).toHaveLength(2); // direct + group-expanded
    expect(body.access_entries[0].canonical_user_id).toBe('cu-alice');
    expect(body.access_entries[1].via_group_name).toBe('Developers');
    expect(body.group_assignments).toHaveLength(1);
    expect(body.group_assignments[0].subject_type).toBe('GROUP');
  });

  it('should return GCP project with IAM bindings when AWS not found', async () => {
    // 1: AWS account lookup (not found — no provider specified so AWS checked first)
    mockExecute
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 })
      // 2: GCP project lookup (found)
      .mockResolvedValueOnce({
        rows: [{
          id: 'proj-1',
          project_id: 'my-project-123',
          project_number: '314159265358',
          name: 'My Project',
          status: 'ACTIVE',
          org_id: null,
          folder_id: null,
          labels: {},
          last_synced_at: null,
          provider: 'gcp',
        }],
        rowCount: 1,
        durationMs: 2,
      })
      // 3-5: parallel queries (direct IAM, group IAM expanded, group summary)
      .mockResolvedValueOnce({
        rows: [
          { role_or_permission: 'roles/viewer', subject_type: 'user', subject_email: 'alice@example.com', subject_name: 'Alice', access_path: 'direct', via_group_name: null, condition_title: null, condition_expression: null, canonical_user_id: 'cu-alice' },
        ],
        rowCount: 1,
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        rows: [
          { role_or_permission: 'roles/editor', subject_type: 'user', subject_email: 'bob@example.com', subject_name: 'Bob', access_path: 'group', via_group_name: 'eng@example.com', condition_title: null, condition_expression: null, canonical_user_id: null },
        ],
        rowCount: 1,
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        rows: [
          { role_or_permission: 'roles/editor', subject_type: 'group', subject_email: 'eng@example.com', subject_name: 'Engineering', access_path: 'group', via_group_name: null, condition_title: null, condition_expression: null, canonical_user_id: null },
        ],
        rowCount: 1,
        durationMs: 2,
      });

    const res = await handleAccountDetail(makeRequest('/api/accounts/proj-1'), 'proj-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account.project_id).toBe('my-project-123');
    expect(body.account.provider).toBe('gcp');
    expect(body.access_entries).toHaveLength(2); // direct + group expanded
    expect(body.access_entries[0].canonical_user_id).toBe('cu-alice');
    expect(body.group_assignments).toHaveLength(1);
    expect(body.group_assignments[0].subject_type).toBe('group');
  });

  it('should return GCP project directly when provider=gcp is specified', async () => {
    // provider=gcp → skips AWS block entirely
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 'proj-1',
          project_id: 'my-project-123',
          project_number: '314159265358',
          name: 'My Project',
          status: 'ACTIVE',
          org_id: null,
          folder_id: null,
          labels: {},
          last_synced_at: null,
          provider: 'gcp',
        }],
        rowCount: 1,
        durationMs: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 });

    const res = await handleAccountDetail(
      makeRequest('/api/accounts/proj-1', { provider: 'gcp' }),
      'proj-1',
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account.provider).toBe('gcp');
    expect(body.access_entries).toHaveLength(0);
    expect(body.group_assignments).toHaveLength(0);
    // Only 4 calls: GCP lookup + 3 parallel (no AWS lookup)
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  it('should return 404 when neither AWS nor GCP found', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 }) // AWS not found
      .mockResolvedValueOnce({ rows: [], rowCount: 0, durationMs: 1 }); // GCP not found

    const res = await handleAccountDetail(makeRequest('/api/accounts/nonexistent'), 'nonexistent');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  it('should return 500 on database error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('query failed'));

    const res = await handleAccountDetail(
      makeRequest('/api/accounts/acct-1', { provider: 'aws' }),
      'acct-1',
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to load account details');
  });
});
