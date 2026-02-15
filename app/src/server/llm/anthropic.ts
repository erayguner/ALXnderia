import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse } from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

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
    const model = process.env.LLM_MODEL || DEFAULT_MODEL;

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
