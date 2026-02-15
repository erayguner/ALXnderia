/**
 * LLM Provider abstraction.
 *
 * Defines a provider-agnostic interface so the NL2SQL agent
 * can work with any LLM backend (Anthropic, OpenAI, Google Gemini, etc.).
 */

export interface LLMCompletionRequest {
  /** System prompt providing context and instructions. */
  system: string;
  /** The user's message / question. */
  userMessage: string;
  /** Maximum tokens in the response. */
  maxTokens?: number;
}

export interface LLMCompletionResponse {
  /** The text content returned by the model. */
  text: string;
  /** Provider-specific model identifier that was used. */
  model: string;
  /** Token usage stats (when available from the provider). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * All LLM providers must implement this interface.
 */
export interface LLMProvider {
  /** Human-readable provider name (e.g. "anthropic", "openai", "gemini"). */
  readonly name: string;

  /**
   * Send a completion request and return the model's text response.
   * Throws on network / auth / rate-limit errors.
   */
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}

/** Supported provider identifiers. */
export type LLMProviderName = 'anthropic' | 'openai' | 'gemini';
