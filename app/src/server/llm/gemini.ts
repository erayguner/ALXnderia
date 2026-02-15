import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse } from './types';

const DEFAULT_MODEL = 'gemini-2.5-pro';

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
    const model = process.env.LLM_MODEL || DEFAULT_MODEL;

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
