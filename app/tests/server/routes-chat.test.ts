import { describe, it, expect, vi } from 'vitest';

// Mock the agent module
vi.mock('../../src/server/agents/nl2sql-agent', () => ({
  processQuestion: vi.fn(),
}));

vi.mock('../../src/server/middleware/audit', () => ({
  recordAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

import { handleChat } from '../../src/server/routes/chat';
import { processQuestion } from '../../src/server/agents/nl2sql-agent';
import { NextRequest } from 'next/server';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Chat Route Handler', () => {
  it('should return 400 for missing question', async () => {
    const res = await handleChat(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('should return 400 for empty question', async () => {
    const res = await handleChat(makeRequest({ question: '   ' }));
    expect(res.status).toBe(400);
  });

  it('should return 400 for too-long question', async () => {
    const res = await handleChat(makeRequest({ question: 'x'.repeat(1001) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('maximum length');
  });

  it('should return 200 with valid question', async () => {
    const mockResponse = {
      id: 'test-id',
      queryPlan: { description: 'test', tablesUsed: ['person'], estimatedComplexity: 'low' },
      sql: 'SELECT * FROM person LIMIT 10',
      results: [{ display_name: 'Test User' }],
      narrative: 'Found 1 result.',
      explanation: 'Queried person table.',
      metadata: { tablesUsed: ['person'], rowCount: 1, executionTimeMs: 5, cached: false },
      followUpSuggestions: [],
    };

    (processQuestion as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const res = await handleChat(makeRequest({ question: 'Show all people' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.narrative).toBe('Found 1 result.');
    expect(body.results).toHaveLength(1);
  });
});
