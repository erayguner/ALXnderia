import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMCompletionRequest } from '../../src/server/llm/types';

// Hoist all mock functions so they're available during vi.mock factory execution
const { mockAnthropicCreate, mockOpenAICreate, mockGeminiGenerate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockOpenAICreate: vi.fn(),
  mockGeminiGenerate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: function MockAnthropic() {
    return { messages: { create: mockAnthropicCreate } };
  },
}));

vi.mock('openai', () => ({
  default: function MockOpenAI() {
    return { chat: { completions: { create: mockOpenAICreate } } };
  },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: function MockGoogleGenAI() {
    return { models: { generateContent: mockGeminiGenerate } };
  },
}));

// ── Anthropic Provider ──────────────────────────────────────────────────────

describe('AnthropicProvider', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalModel = process.env.LLM_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = originalModel;
  });

  it('should return text from Anthropic response', async () => {
    const { AnthropicProvider } = await import('../../src/server/llm');

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"sql": "SELECT 1"}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const provider = new AnthropicProvider();
    const request: LLMCompletionRequest = {
      system: 'You are helpful.',
      userMessage: 'Hello',
    };

    const result = await provider.complete(request);

    expect(result.text).toBe('{"sql": "SELECT 1"}');
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(50);
    expect(provider.name).toBe('anthropic');
  });

  it('should throw when no text block is returned', async () => {
    const { AnthropicProvider } = await import('../../src/server/llm');

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tool_1' }],
      usage: {},
    });

    const provider = new AnthropicProvider();

    await expect(
      provider.complete({ system: 'test', userMessage: 'test' }),
    ).rejects.toThrow('No text response received from Anthropic');
  });

  it('should use custom model from LLM_MODEL env var', async () => {
    const { AnthropicProvider } = await import('../../src/server/llm');
    process.env.LLM_MODEL = 'claude-opus-4-6';

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'response' }],
      usage: {},
    });

    const provider = new AnthropicProvider();
    const result = await provider.complete({ system: 'test', userMessage: 'test' });

    expect(result.model).toBe('claude-opus-4-6');
  });

  it('should pass maxTokens to the API', async () => {
    const { AnthropicProvider } = await import('../../src/server/llm');

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: {},
    });

    const provider = new AnthropicProvider();
    await provider.complete({ system: 'test', userMessage: 'test', maxTokens: 2048 });

    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 }),
    );
  });
});

// ── OpenAI Provider ─────────────────────────────────────────────────────────

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.LLM_MODEL;
  });

  it('should return text from OpenAI response', async () => {
    const { OpenAIProvider } = await import('../../src/server/llm');

    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"sql": "SELECT 1"}' } }],
      usage: { prompt_tokens: 80, completion_tokens: 30 },
    });

    const provider = new OpenAIProvider();
    const result = await provider.complete({
      system: 'You are helpful.',
      userMessage: 'Hello',
    });

    expect(result.text).toBe('{"sql": "SELECT 1"}');
    expect(result.usage?.inputTokens).toBe(80);
    expect(result.usage?.outputTokens).toBe(30);
    expect(provider.name).toBe('openai');
  });

  it('should throw when no text is in the response', async () => {
    const { OpenAIProvider } = await import('../../src/server/llm');

    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
      usage: {},
    });

    const provider = new OpenAIProvider();

    await expect(
      provider.complete({ system: 'test', userMessage: 'test' }),
    ).rejects.toThrow('No text response received from OpenAI');
  });

  it('should throw when choices array is empty', async () => {
    const { OpenAIProvider } = await import('../../src/server/llm');

    mockOpenAICreate.mockResolvedValueOnce({ choices: [], usage: {} });

    const provider = new OpenAIProvider();

    await expect(
      provider.complete({ system: 'test', userMessage: 'test' }),
    ).rejects.toThrow('No text response received from OpenAI');
  });
});

// ── Gemini Provider ─────────────────────────────────────────────────────────

describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-key';
    delete process.env.LLM_MODEL;
  });

  it('should return text from Gemini response', async () => {
    const { GeminiProvider } = await import('../../src/server/llm');

    mockGeminiGenerate.mockResolvedValueOnce({
      text: '{"sql": "SELECT 1"}',
      usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 20 },
    });

    const provider = new GeminiProvider();
    const result = await provider.complete({
      system: 'You are helpful.',
      userMessage: 'Hello',
    });

    expect(result.text).toBe('{"sql": "SELECT 1"}');
    expect(result.usage?.inputTokens).toBe(60);
    expect(result.usage?.outputTokens).toBe(20);
    expect(provider.name).toBe('gemini');
  });

  it('should throw when no text is returned', async () => {
    const { GeminiProvider } = await import('../../src/server/llm');

    mockGeminiGenerate.mockResolvedValueOnce({
      text: null,
      usageMetadata: {},
    });

    const provider = new GeminiProvider();

    await expect(
      provider.complete({ system: 'test', userMessage: 'test' }),
    ).rejects.toThrow('No text response received from Gemini');
  });
});
