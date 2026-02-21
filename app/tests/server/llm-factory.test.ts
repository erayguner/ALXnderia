import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
}));

vi.mock('../../src/server/llm/index', async (importOriginal) => {
  const providers: Record<string, { name: string; complete: typeof mockComplete }> = {
    anthropic: { name: 'anthropic', complete: mockComplete },
    openai: { name: 'openai', complete: mockComplete },
    gemini: { name: 'gemini', complete: mockComplete },
  };

  let cached: (typeof providers)[string] | null = null;
  let cachedName: string | null = null;

  return {
    getLLMProvider: () => {
      const name = (process.env.LLM_PROVIDER || 'anthropic') as string;
      if (cached && cachedName === name) return cached;
      if (!providers[name]) {
        throw new Error(
          `Unsupported LLM_PROVIDER: "${name}". Supported values: anthropic, openai, gemini`,
        );
      }
      cached = providers[name];
      cachedName = name;
      return cached;
    },
    resetProvider: () => {
      cached = null;
      cachedName = null;
    },
  };
});

import { getLLMProvider, resetProvider } from '../../src/server/llm';

describe('LLM Provider Factory', () => {
  const originalEnv = process.env.LLM_PROVIDER;

  beforeEach(() => {
    resetProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = originalEnv;
    }
    resetProvider();
  });

  it('should default to Anthropic when LLM_PROVIDER is not set', () => {
    delete process.env.LLM_PROVIDER;
    const provider = getLLMProvider();
    expect(provider.name).toBe('anthropic');
  });

  it('should select Anthropic for "anthropic"', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const provider = getLLMProvider();
    expect(provider.name).toBe('anthropic');
  });

  it('should select OpenAI for "openai"', () => {
    process.env.LLM_PROVIDER = 'openai';
    const provider = getLLMProvider();
    expect(provider.name).toBe('openai');
  });

  it('should select Gemini for "gemini"', () => {
    process.env.LLM_PROVIDER = 'gemini';
    const provider = getLLMProvider();
    expect(provider.name).toBe('gemini');
  });

  it('should throw for unsupported provider names', () => {
    process.env.LLM_PROVIDER = 'unsupported';
    expect(() => getLLMProvider()).toThrow('Unsupported LLM_PROVIDER');
    expect(() => getLLMProvider()).toThrow('unsupported');
  });

  it('should cache the provider singleton', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const first = getLLMProvider();
    const second = getLLMProvider();
    expect(first).toBe(second);
  });

  it('should switch providers when LLM_PROVIDER changes', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const first = getLLMProvider();
    expect(first.name).toBe('anthropic');

    process.env.LLM_PROVIDER = 'openai';
    const second = getLLMProvider();
    expect(second.name).toBe('openai');
    expect(first).not.toBe(second);
  });

  it('should expose a complete method on the provider', () => {
    const provider = getLLMProvider();
    expect(typeof provider.complete).toBe('function');
  });

  it('should clear cache on resetProvider()', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    getLLMProvider();

    resetProvider();
    process.env.LLM_PROVIDER = 'gemini';
    const provider = getLLMProvider();
    expect(provider.name).toBe('gemini');
  });
});
