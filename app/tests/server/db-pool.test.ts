import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClient, mockPool } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn(),
  };
  return { mockClient, mockPool };
});

vi.mock('pg', () => ({
  Pool: function () { return mockPool; },
}));

import { executeWithTenant, executeReadOnly, healthCheck } from '../../src/server/db/pool';

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
});

describe('executeWithTenant', () => {
  it('should set tenant context and execute within a transaction', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const sql = 'SELECT * FROM canonical_users';
    const mockRows = [{ id: '1', full_name: 'Alice' }];

    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
      .mockResolvedValueOnce(undefined) // SET LOCAL app.current_tenant_id
      .mockResolvedValueOnce({ rows: mockRows, rowCount: 1 }) // actual query
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await executeWithTenant(tenantId, sql);

    expect(result.rows).toEqual(mockRows);
    expect(result.rowCount).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith(
      'SELECT set_config($1, $2, true)',
      ['statement_timeout', '10000ms'],
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'SELECT set_config($1, $2, true)',
      ['app.current_tenant_id', tenantId],
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('should pass bind parameters to the query', async () => {
    const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const sql = 'SELECT * FROM canonical_users WHERE id = $1';
    const params = ['user-123'];

    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce(undefined);

    await executeWithTenant(tenantId, sql, params);

    expect(mockClient.query).toHaveBeenCalledWith(sql, params);
  });

  it('should ROLLBACK and re-throw on query error', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';

    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET timeout
      .mockResolvedValueOnce(undefined) // SET tenant
      .mockRejectedValueOnce(new Error('relation does not exist')) // query fails
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(
      executeWithTenant(tenantId, 'SELECT * FROM bad_table'),
    ).rejects.toThrow('relation does not exist');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('should sanitise tenantId to prevent injection', async () => {
    const maliciousTenantId = "'; DROP TABLE users; --";

    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce(undefined);

    await executeWithTenant(maliciousTenantId, 'SELECT 1');

    // With parameterised set_config, the tenant value is in the params array, not the SQL string
    const setTenantArgs = mockClient.query.mock.calls[2] as [string, string[]];
    expect(setTenantArgs[0]).toBe('SELECT set_config($1, $2, true)');
    // Regex sanitisation strips everything except [a-f0-9-]
    const sanitisedValue = setTenantArgs[1][1];
    expect(sanitisedValue).not.toContain('DROP');
    expect(sanitisedValue).not.toContain(';');
  });

  it('should use the provided timeout', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce(undefined);

    await executeWithTenant('11111111-1111-1111-1111-111111111111', 'SELECT 1', [], 5000);

    const timeoutArgs = mockClient.query.mock.calls[1] as [string, string[]];
    expect(timeoutArgs[0]).toBe('SELECT set_config($1, $2, true)');
    expect(timeoutArgs[1]).toEqual(['statement_timeout', '5000ms']);
  });

  it('should always release the client, even on error', async () => {
    mockClient.query
      .mockRejectedValueOnce(new Error('BEGIN failed'));

    await expect(
      executeWithTenant('11111111-1111-1111-1111-111111111111', 'SELECT 1'),
    ).rejects.toThrow();

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('should default rowCount to 0 when null', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce(undefined);

    const result = await executeWithTenant('11111111-1111-1111-1111-111111111111', 'SELECT 1');
    expect(result.rowCount).toBe(0);
  });
});

describe('executeReadOnly', () => {
  it('should execute a query without tenant context', async () => {
    const mockRows = [{ table_name: 'canonical_users' }];
    mockPool.query.mockResolvedValueOnce({ rows: mockRows, rowCount: 1 });

    const result = await executeReadOnly('SELECT table_name FROM information_schema.tables');

    expect(result.rows).toEqual(mockRows);
    expect(result.rowCount).toBe(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT table_name FROM information_schema.tables',
      [],
    );
  });

  it('should pass parameters to the query', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await executeReadOnly('SELECT * FROM pg_tables WHERE tablename = $1', ['users']);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['users'],
    );
  });

  it('should default rowCount to 0 when null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await executeReadOnly('SELECT 1');
    expect(result.rowCount).toBe(0);
  });
});

describe('healthCheck', () => {
  it('should return true when the pool is healthy', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await healthCheck();
    expect(result).toBe(true);
  });

  it('should return false when the pool is unreachable', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await healthCheck();
    expect(result).toBe(false);
  });
});
