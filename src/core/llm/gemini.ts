import type { LlmOptions } from '../schema';
import type { CallResult } from './interface';

export async function geminiCall(prompt: string, opts: LlmOptions): Promise<CallResult> {
  if (!opts.apiKey) throw new Error('Gemini needs an API key');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model ?? '')}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return {
    text: data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '',
    inputTokens: data?.usageMetadata?.promptTokenCount,
    outputTokens: data?.usageMetadata?.candidatesTokenCount,
  };
}
