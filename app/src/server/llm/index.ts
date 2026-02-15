/**
 * LLM Provider factory.
 *
 * Selects the active provider based on the LLM_PROVIDER environment variable.
 * Defaults to "anthropic" for backward compatibility.
 *
 * Environment variables:
 *   LLM_PROVIDER  - "anthropic" | "openai" | "gemini"  (default: "anthropic")
 *   LLM_MODEL     - Model identifier override (provider-specific)
 *   LLM_API_KEY   - API key (falls back to provider-specific vars:
 *                    ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)
 */

import type { LLMProvider, LLMProviderName } from './types';

export type { LLMProvider, LLMProviderName, LLMCompletionRequest, LLMCompletionResponse } from './types';

let cachedProvider: LLMProvider | null = null;
let cachedProviderName: string | null = null;

/**
 * Return the configured LLM provider singleton.
 * The provider is lazily initialised on first call and cached.
 * Changing LLM_PROVIDER at runtime requires calling `resetProvider()`.
 */
export function getLLMProvider(): LLMProvider {
  const providerName = (process.env.LLM_PROVIDER || 'anthropic') as LLMProviderName;

  if (cachedProvider && cachedProviderName === providerName) {
    return cachedProvider;
  }

  switch (providerName) {
    case 'anthropic': {
      const { AnthropicProvider } = require('./anthropic');
      cachedProvider = new AnthropicProvider();
      break;
    }
    case 'openai': {
      const { OpenAIProvider } = require('./openai');
      cachedProvider = new OpenAIProvider();
      break;
    }
    case 'gemini': {
      const { GeminiProvider } = require('./gemini');
      cachedProvider = new GeminiProvider();
      break;
    }
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER: "${providerName}". ` +
        'Supported values: anthropic, openai, gemini',
      );
  }

  cachedProviderName = providerName;
  return cachedProvider!;
}

/** Reset the cached provider (useful for testing or runtime reconfiguration). */
export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderName = null;
}
