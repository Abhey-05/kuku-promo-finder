import { LlmResponseSchema, type CandidateSummary, type Judgement, type LlmLog, type LlmOptions } from '../schema';
import { buildPrompt } from './prompt';
import { noneRerank } from './none';
import { geminiCall } from './gemini';
import { openAiCompatibleCall } from './openai-compatible';

export interface CallResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** One adapter is one function: prompt in, text out. Swapping models touches nothing else. */
export type ModelCall = (prompt: string, opts: LlmOptions) => Promise<CallResult>;

const ADAPTERS: Record<'gemini' | 'openai-compatible', ModelCall> = {
  gemini: geminiCall,
  'openai-compatible': openAiCompatibleCall,
};

export const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  'openai-compatible': 'llama-3.3-70b-versatile',
};

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Checks a raw model reply. Rejects unknown IDs and quotes that are not verbatim.
 * Returns an error string rather than throwing, so the caller can fall back.
 */
export function validateResponse(
  raw: string,
  candidates: CandidateSummary[],
): { ok: true; judgements: Judgement[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { ok: false, error: 'reply is not JSON' };
  }
  const result = LlmResponseSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: `schema: ${result.error.issues[0]?.message ?? 'invalid'}` };

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ratings = new Map(result.data.ratings.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const judgements: Judgement[] = [];
  for (const [i, t] of result.data.top.entries()) {
    const c = byId.get(t.id);
    if (!c) return { ok: false, error: `unknown id ${t.id}` };
    if (seen.has(t.id)) return { ok: false, error: `duplicate id ${t.id}` };
    seen.add(t.id);
    const source = normalise(c.lines.join('\n'));
    // Anything in straight or curly double quotes inside the reason counts as a quote too.
    const quoted = [t.quote, ...[...t.reason.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1])].filter(Boolean) as string[];
    const bad = quoted.find((q) => !source.includes(normalise(q)));
    if (bad !== undefined) return { ok: false, error: `quote not verbatim for ${t.id}` };
    const r = ratings.get(t.id);
    judgements.push({
      id: t.id,
      rank: i + 1,
      source: 'llm',
      reason: t.reason,
      ratings: r ? { hook: r.hook, cliffhanger: r.cliffhanger, standalone: r.standalone } : undefined,
    });
  }
  return { ok: true, judgements };
}

export function emptyLlmLog(opts: LlmOptions): LlmLog {
  return {
    provider: opts.provider,
    model: opts.provider === 'none' ? null : opts.model ?? DEFAULT_MODELS[opts.provider] ?? null,
    calls: 0,
    input_tokens: null,
    output_tokens: null,
    failures: 0,
    fallback_used: false,
    notes: [],
  };
}

/**
 * The single entry point for ranking by model. Never rejects: any failure logs and
 * falls back to the heuristic order, so a bad key or bad reply cannot lose a run.
 */
export async function rerank(
  candidates: CandidateSummary[],
  opts: LlmOptions & { topN: number; call?: ModelCall },
): Promise<{ judgements: Judgement[]; log: LlmLog }> {
  const log = emptyLlmLog(opts);
  const fallback = () => noneRerank(candidates).slice(0, opts.topN);
  if (opts.provider === 'none') return { judgements: fallback(), log };

  const call = opts.call ?? ADAPTERS[opts.provider];
  const prompt = buildPrompt(candidates, opts.topN);
  // One retry with a stricter reminder: a free model's bad reply is often just malformed.
  for (const suffix of ['', '\n\nYour last reply failed validation. Reply with the JSON only, and quote only exact words.']) {
    try {
      log.calls++;
      const res = await call(prompt + suffix, { ...opts, model: log.model ?? undefined });
      if (res.inputTokens !== undefined) log.input_tokens = (log.input_tokens ?? 0) + res.inputTokens;
      if (res.outputTokens !== undefined) log.output_tokens = (log.output_tokens ?? 0) + res.outputTokens;
      const checked = validateResponse(res.text, candidates);
      if (checked.ok) return { judgements: checked.judgements, log };
      log.failures++;
      log.notes.push(checked.error);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      log.failures++;
      // Messages only, so a key inside a URL or header can never reach the run log.
      log.notes.push(`call failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`);
    }
  }
  log.fallback_used = true;
  return { judgements: fallback(), log };
}
