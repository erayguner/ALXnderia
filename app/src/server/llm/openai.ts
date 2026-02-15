import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse } from './types';

const DEFAULT_MODEL = 'gpt-4o';

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
    const model = process.env.LLM_MODEL || DEFAULT_MODEL;

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
