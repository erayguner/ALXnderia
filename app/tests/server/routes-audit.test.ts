import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { handleAuditList } from '../../src/server/routes/audit';

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/audit');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe('Audit Route Handler', () => {
  it('should return empty data with default pagination', async () => {
    const res = await handleAuditList(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.totalPages).toBe(0);
  });

  it('should respect page and limit query params', async () => {
    const res = await handleAuditList(makeRequest({ page: '3', limit: '25' }));
    const body = await res.json();

    expect(body.page).toBe(3);
    expect(body.limit).toBe(25);
  });

  it('should clamp page to minimum of 1', async () => {
    const res = await handleAuditList(makeRequest({ page: '0' }));
    const body = await res.json();

    expect(body.page).toBe(1);
  });

  it('should clamp limit to maximum of 100', async () => {
    const res = await handleAuditList(makeRequest({ limit: '500' }));
    const body = await res.json();

    expect(body.limit).toBe(100);
  });

  it('should include a message about unprovisioned table', async () => {
    const res = await handleAuditList(makeRequest());
    const body = await res.json();

    expect(body.message).toContain('not yet provisioned');
  });
});
