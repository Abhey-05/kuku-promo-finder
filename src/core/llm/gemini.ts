import type { LlmOptions } from '../schema';
import { LlmError, postJson, scrub, type CallResult, type Message } from './http';

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
  ).catch((err) => {
    if (err instanceof LlmError && err.kind === 'not_found') {
      throw new LlmError('not_found', `${err.message} Model "${opts.model}" may not exist for this key. List the models it can call with: npm run cli -- --provider gemini --list-models`, err.status);
    }
    throw err;
  })) as GeminiReply;
  return {
    text: data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    model: data.modelVersion,
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

export interface GeminiModel {
  name: string;
  displayName?: string;
}

/**
 * Lists the models this key can call with generateContent (GET /models). Used to confirm a model
 * name against the live API instead of from memory. The key goes in a header.
 */
export async function listGeminiModels(opts: LlmOptions, fetchImpl: typeof fetch = fetch): Promise<GeminiModel[]> {
  if (!opts.apiKey) throw new LlmError('config', 'Gemini needs an API key. Put it in .env as GEMINI_API_KEY=...');
  const base = (opts.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const out: GeminiModel[] = [];
  let page = '';
  for (let i = 0; i < 10; i++) {
    const url = `${base}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { 'x-goog-api-key': opts.apiKey } });
    } catch {
      throw new LlmError('network', 'Could not reach generativelanguage.googleapis.com. Check the connection.');
    }
    const body = await res.text();
    if (!res.ok) {
      const kind = res.status === 401 || res.status === 403 || /API key not valid/i.test(body) ? 'auth' : res.status === 429 ? 'rate_limit' : 'other';
      throw new LlmError(kind, scrub(`Listing Gemini models failed (HTTP ${res.status}): ${body.slice(0, 200)}`, opts.apiKey));
    }
    const data = JSON.parse(body) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
    for (const m of data.models ?? []) {
      if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
      out.push({ name: m.name.replace(/^models\//, ''), displayName: m.displayName });
    }
    if (!data.nextPageToken) break;
    page = data.nextPageToken;
  }
  return out;
}
