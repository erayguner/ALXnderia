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

import type { LLMProvider, LLMProviderName, LLMCompletionRequest, LLMCompletionResponse } from './types';

export type { LLMProvider, LLMProviderName, LLMCompletionRequest, LLMCompletionResponse } from './types';

// ── Provider implementations ────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private client: import('@anthropic-ai/sdk').default | null = null;

  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const client = await this.getClient();
    const model = process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929';

    const message = await client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: [{ role: 'user', content: request.userMessage }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response received from Anthropic');
    }

    return {
      text: textBlock.text,
      model,
      usage: {
        inputTokens: message.usage?.input_tokens,
        outputTokens: message.usage?.output_tokens,
      },
    };
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  private client: import('openai').default | null = null;

  private async getClient() {
    if (!this.client) {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      });
    }
    return this.client;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const client = await this.getClient();
    const model = process.env.LLM_MODEL || 'gpt-4o';

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.userMessage },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error('No text response received from OpenAI');
    }

    return {
      text,
      model,
      usage: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
      },
    };
  }
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  private ai: import('@google/genai').GoogleGenAI | null = null;

  private async getAI() {
    if (!this.ai) {
      const { GoogleGenAI } = await import('@google/genai');
      this.ai = new GoogleGenAI({
        apiKey: process.env.LLM_API_KEY || process.env.GOOGLE_API_KEY,
      });
    }
    return this.ai;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const ai = await this.getAI();
    const model = process.env.LLM_MODEL || 'gemini-2.5-pro';

    const response = await ai.models.generateContent({
      model,
      config: {
        maxOutputTokens: request.maxTokens ?? 4096,
        systemInstruction: request.system,
      },
      contents: request.userMessage,
    });

    const text = response.text;
    if (!text) {
      throw new Error('No text response received from Gemini');
    }

    return {
      text,
      model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

const PROVIDERS: Record<LLMProviderName, new () => LLMProvider> = {
  anthropic: AnthropicProvider,
  openai: OpenAIProvider,
  gemini: GeminiProvider,
};

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

  const ProviderClass = PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new Error(
      `Unsupported LLM_PROVIDER: "${providerName}". ` +
      'Supported values: anthropic, openai, gemini',
    );
  }

  cachedProvider = new ProviderClass();
  cachedProviderName = providerName;
  return cachedProvider;
}

/** Reset the cached provider (useful for testing or runtime reconfiguration). */
export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderName = null;
}
