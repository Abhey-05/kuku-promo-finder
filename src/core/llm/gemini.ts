import type { LlmOptions } from '../schema';
import { LlmError, postJson, type CallResult, type Message } from './http';

type GeminiReply = {
  modelVersion?: string;
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

/** Gemini generateContent. The key goes in a header, never in the URL. */
export async function geminiCall(messages: Message[], opts: LlmOptions): Promise<CallResult> {
  if (!opts.apiKey) throw new LlmError('config', 'Gemini needs an API key.');
  const base = (opts.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const data = (await postJson(
    `${base}/models/${encodeURIComponent(opts.model ?? '')}:generateContent`,
    { 'x-goog-api-key': opts.apiKey },
    {
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: opts.temperature ?? 0, responseMimeType: 'application/json' },
    },
    opts,
  )) as GeminiReply;
  return {
    text: data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    model: data.modelVersion,
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
  };
}
