import type { LlmOptions } from '../schema';
import type { CallResult } from './interface';

/** Covers Groq, OpenRouter, Ollama and anything else that speaks /chat/completions. */
export async function openAiCompatibleCall(prompt: string, opts: LlmOptions): Promise<CallResult> {
  if (!opts.baseUrl) throw new Error('A base URL is required');
  const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: opts.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
  const data = await res.json();
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    inputTokens: data?.usage?.prompt_tokens,
    outputTokens: data?.usage?.completion_tokens,
  };
}
