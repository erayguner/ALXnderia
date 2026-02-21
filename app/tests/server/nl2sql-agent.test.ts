import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../src/server/llm', () => ({
  getLLMProvider: vi.fn(),
}));

vi.mock('../../src/server/validators/sql-validator', () => ({
  validateSql: vi.fn(),
}));

vi.mock('../../src/server/db/pool', () => ({
  executeWithTenant: vi.fn(),
  getSchemaMetadata: vi.fn().mockResolvedValue({
    tables: [{ table_name: 'canonical_users' }],
    columns: [
      { table_name: 'canonical_users', column_name: 'id', data_type: 'uuid', is_nullable: 'NO', description: null },
      { table_name: 'canonical_users', column_name: 'full_name', data_type: 'text', is_nullable: 'NO', description: null },
    ],
    foreignKeys: [],
    materializedViews: [],
  }),
}));

import { processQuestion, clearSchemaCache } from '../../src/server/agents/nl2sql-agent';
import { getLLMProvider } from '../../src/server/llm';
import { validateSql } from '../../src/server/validators/sql-validator';
import { executeWithTenant } from '../../src/server/db/pool';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ORIGINAL_MOCK_MODE = process.env.MOCK_MODE;

function makeLLMResponse(response: Record<string, unknown>): string {
  return JSON.stringify(response);
}

function makeLLMResponseWithFences(response: Record<string, unknown>): string {
  return '```json\n' + JSON.stringify(response) + '\n```';
}

describe('NL2SQL Agent', () => {
  const mockComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearSchemaCache();
    delete process.env.MOCK_MODE;

    (getLLMProvider as ReturnType<typeof vi.fn>).mockReturnValue({
      name: 'anthropic',
      complete: mockComplete,
    });
  });

  afterEach(() => {
    if (ORIGINAL_MOCK_MODE === undefined) {
      delete process.env.MOCK_MODE;
    } else {
      process.env.MOCK_MODE = ORIGINAL_MOCK_MODE;
    }
  });

  describe('mock mode', () => {
    it('should return static data when MOCK_MODE is true', async () => {
      process.env.MOCK_MODE = 'true';

      const result = await processQuestion(
        { question: 'Show all people' },
        TENANT_ID,
        'analyst',
      );

      expect(result.id).toBe('mock-response-id');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.narrative).toContain('MOCK');
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });

  const validAgentResponse = {
    queryPlan: {
      description: 'List all canonical users',
      tablesUsed: ['canonical_users'],
      estimatedComplexity: 'low',
    },
    sql: 'SELECT id, full_name FROM canonical_users LIMIT 10',
    explanation: 'Queried the canonical_users table.',
    followUpSuggestions: ['Show linked identities'],
    needsClarification: false,
  };

  describe('normal flow', () => {
    it('should process a question end-to-end', async () => {
      mockComplete.mockResolvedValueOnce({
        text: makeLLMResponse(validAgentResponse),
        model: 'claude-sonnet-4-5-20250929',
      });

      (validateSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        valid: true,
        errors: [],
        sanitisedSql: 'SELECT id, full_name FROM canonical_users LIMIT 10',
        statementType: 'SelectStmt',
        tablesReferenced: ['canonical_users'],
        functionsUsed: [],
      });

      (executeWithTenant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ id: '1', full_name: 'Alice' }],
        rowCount: 1,
        durationMs: 15,
      });

      const result = await processQuestion(
        { question: 'Show all people' },
        TENANT_ID,
        'analyst',
      );

      expect(result.id).toBeDefined();
      expect(result.queryPlan.description).toBe('List all canonical users');
      expect(result.sql).toBe('SELECT id, full_name FROM canonical_users LIMIT 10');
      expect(result.results).toHaveLength(1);
      expect(result.narrative).toContain('Found 1 result');
      expect(result.metadata.tablesUsed).toContain('canonical_users');
      expect(result.metadata.rowCount).toBe(1);
      expect(result.followUpSuggestions).toContain('Show linked identities');
    });

    it('should handle markdown-fenced JSON from LLM', async () => {
      mockComplete.mockResolvedValueOnce({
        text: makeLLMResponseWithFences(validAgentResponse),
        model: 'claude-sonnet-4-5-20250929',
      });

      (validateSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        valid: true,
        errors: [],
        sanitisedSql: validAgentResponse.sql,
        statementType: 'SelectStmt',
        tablesReferenced: ['canonical_users'],
        functionsUsed: [],
      });

      (executeWithTenant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        durationMs: 5,
      });

      const result = await processQuestion(
        { question: 'Show all people' },
        TENANT_ID,
        'analyst',
      );

      expect(result.id).toBeDefined();
      expect(result.queryPlan.description).toBe('List all canonical users');
    });

    it('should throw when LLM returns invalid JSON', async () => {
      mockComplete.mockResolvedValueOnce({
        text: 'This is not JSON at all',
        model: 'claude-sonnet-4-5-20250929',
      });

      await expect(
        processQuestion({ question: 'test' }, TENANT_ID, 'analyst'),
      ).rejects.toThrow('Failed to parse agent response as JSON');
    });

    it('should throw when SQL validation fails', async () => {
      mockComplete.mockResolvedValueOnce({
        text: makeLLMResponse({
          ...validAgentResponse,
          sql: 'DROP TABLE canonical_users',
        }),
        model: 'claude-sonnet-4-5-20250929',
      });

      (validateSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        valid: false,
        errors: ['Only SELECT statements are permitted'],
      });

      await expect(
        processQuestion({ question: 'delete everything' }, TENANT_ID, 'analyst'),
      ).rejects.toThrow('Generated SQL failed validation');
    });
  });

  describe('clarification flow', () => {
    it('should return clarification response without executing SQL', async () => {
      mockComplete.mockResolvedValueOnce({
        text: makeLLMResponse({
          queryPlan: {
            description: 'Clarification needed',
            tablesUsed: [],
            estimatedComplexity: 'low',
          },
          sql: '',
          explanation: '',
          followUpSuggestions: ['Be more specific'],
          needsClarification: true,
          clarificationMessage: 'Which provider do you mean?',
          clarificationOptions: ['Google', 'AWS', 'GitHub'],
        }),
        model: 'claude-sonnet-4-5-20250929',
      });

      const result = await processQuestion(
        { question: 'Show groups' },
        TENANT_ID,
        'analyst',
      );

      expect(result.sql).toBe('');
      expect(result.results).toHaveLength(0);
      expect(result.clarificationNeeded).toBeDefined();
      expect(result.clarificationNeeded?.message).toBe('Which provider do you mean?');
      expect(result.clarificationNeeded?.options).toEqual(['Google', 'AWS', 'GitHub']);

      // Should NOT have called validateSql or executeWithTenant
      expect(validateSql).not.toHaveBeenCalled();
      expect(executeWithTenant).not.toHaveBeenCalled();
    });
  });

  describe('narrative generation', () => {
    it('should report "no results" when query returns zero rows', async () => {
      mockComplete.mockResolvedValueOnce({
        text: makeLLMResponse({
          queryPlan: { description: 'test', tablesUsed: ['canonical_users'], estimatedComplexity: 'low' },
          sql: "SELECT * FROM canonical_users WHERE full_name = 'nobody' LIMIT 10",
          explanation: 'Searched for user.',
          followUpSuggestions: [],
        }),
        model: 'claude-sonnet-4-5-20250929',
      });

      (validateSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        valid: true,
        errors: [],
        sanitisedSql: "SELECT * FROM canonical_users WHERE full_name = 'nobody' LIMIT 10",
        statementType: 'SelectStmt',
        tablesReferenced: ['canonical_users'],
        functionsUsed: [],
      });

      (executeWithTenant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        durationMs: 3,
      });

      const result = await processQuestion(
        { question: 'Find nobody' },
        TENANT_ID,
        'analyst',
      );

      expect(result.narrative).toContain('No results found');
    });

    it('should include provider breakdown when rows contain provider_type', async () => {
      mockComplete.mockResolvedValueOnce({
        text: makeLLMResponse({
          queryPlan: { description: 'test', tablesUsed: ['canonical_user_provider_links'], estimatedComplexity: 'low' },
          sql: 'SELECT provider_type FROM canonical_user_provider_links LIMIT 10',
          explanation: 'Listed providers.',
          followUpSuggestions: [],
        }),
        model: 'claude-sonnet-4-5-20250929',
      });

      (validateSql as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        valid: true,
        errors: [],
        sanitisedSql: 'SELECT provider_type FROM canonical_user_provider_links LIMIT 10',
        statementType: 'SelectStmt',
        tablesReferenced: ['canonical_user_provider_links'],
        functionsUsed: [],
      });

      (executeWithTenant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          { provider_type: 'GITHUB' },
          { provider_type: 'GOOGLE_WORKSPACE' },
          { provider_type: 'GITHUB' },
        ],
        rowCount: 3,
        durationMs: 5,
      });

      const result = await processQuestion(
        { question: 'Show provider links' },
        TENANT_ID,
        'analyst',
      );

      expect(result.narrative).toContain('2 providers');
      expect(result.narrative).toContain('GITHUB');
      expect(result.narrative).toContain('GOOGLE_WORKSPACE');
    });
  });

  describe('schema caching', () => {
    it('should cache schema after first call', async () => {
      const { getSchemaMetadata } = await import('../../src/server/db/pool');

      // Clear counts from previous test setup
      (getSchemaMetadata as ReturnType<typeof vi.fn>).mockClear();

      const response = {
        text: makeLLMResponse(validAgentResponse),
        model: 'claude-sonnet-4-5-20250929',
      };

      mockComplete.mockResolvedValue(response);

      (validateSql as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
        errors: [],
        sanitisedSql: validAgentResponse.sql,
        statementType: 'SelectStmt',
        tablesReferenced: ['canonical_users'],
        functionsUsed: [],
      });

      (executeWithTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: '1' }],
        rowCount: 1,
        durationMs: 1,
      });

      // clearSchemaCache was called in beforeEach, so first call should fetch
      await processQuestion({ question: 'q1' }, TENANT_ID, 'analyst');
      // Second call should use cache
      await processQuestion({ question: 'q2' }, TENANT_ID, 'analyst');

      // getSchemaMetadata should be called only once due to caching
      expect(getSchemaMetadata).toHaveBeenCalledOnce();
    });
  });
});
