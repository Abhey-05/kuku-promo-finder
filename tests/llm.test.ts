import { describe, expect, it, vi } from 'vitest';
import { rerank, validateResponse } from '../src/core/llm/interface';
import { runPipeline } from '../src/core/pipeline';
import { DEFAULT_CONFIG } from '../src/core/config';
import type { CandidateSummary } from '../src/core/schema';
import { geminiCall } from '../src/core/llm/gemini';
import { openAiCompatibleCall } from '../src/core/llm/openai-compatible';
import { loadDemo } from './helpers';

const features = { hook: 0.5, cliffhanger: 0.5, standalone: 0.5, duration: 1, total: 0.6 };
const cands: CandidateSummary[] = [
  { id: 'A', lines: ['Ep1 00:01.00 NORA: "You lied to me."'], features, cues: [] },
  { id: 'B', lines: ['Ep1 00:40.00 FELIX: "Who sent you?"'], features, cues: [] },
];
const reply = (top: unknown[], ratings: unknown[] = [{ id: 'B', hook: 5, cliffhanger: 4, standalone: 3 }]) => JSON.stringify({ ratings, top });

describe('validateResponse', () => {
  it('accepts a good reply, even inside a code fence', () => {
    const v = validateResponse('```json\n' + reply([{ id: 'B', reason: 'Ends on "Who sent you?"', quote: 'Who sent you?' }]) + '\n```', cands);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.judgements[0]).toMatchObject({ id: 'B', source: 'llm', ratings: { hook: 5 } });
  });
  it('rejects unknown IDs', () => {
    expect(validateResponse(reply([{ id: 'Z', reason: 'x' }]), cands)).toEqual({ ok: false, error: 'unknown id Z' });
  });
  it('rejects a quote field that is not verbatim', () => {
    expect(validateResponse(reply([{ id: 'A', reason: 'x', quote: 'You betrayed me' }]), cands).ok).toBe(false);
  });
  it('rejects an invented quote hidden inside the reason', () => {
    expect(validateResponse(reply([{ id: 'A', reason: 'Great line: "I will destroy you"' }]), cands).ok).toBe(false);
  });
  it('rejects a quote taken from a different candidate', () => {
    expect(validateResponse(reply([{ id: 'A', reason: 'x', quote: 'Who sent you?' }]), cands).ok).toBe(false);
  });
  it('rejects bad JSON, bad shapes and out-of-range ratings', () => {
    expect(validateResponse('not json', cands).ok).toBe(false);
    expect(validateResponse('{"top":[]}', cands).ok).toBe(false);
    expect(validateResponse(reply([{ id: 'A', reason: 'x' }], [{ id: 'A', hook: 9, cliffhanger: 1, standalone: 1 }]), cands).ok).toBe(false);
  });
});

describe('rerank', () => {
  it('uses the model order when valid and records tokens', async () => {
    const call = vi.fn().mockResolvedValue({ text: reply([{ id: 'B', reason: 'good' }, { id: 'A', reason: 'ok' }]), inputTokens: 100, outputTokens: 20 });
    const { judgements, log } = await rerank(cands, { provider: 'gemini', topN: 2, call });
    expect(judgements.map((j) => j.id)).toEqual(['B', 'A']);
    expect(log).toMatchObject({ calls: 1, input_tokens: 100, output_tokens: 20, failures: 0, fallback_used: false });
  });
  it('retries once, then falls back to the heuristic order and logs it', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'garbage' });
    const { judgements, log } = await rerank(cands, { provider: 'openai-compatible', topN: 2, call });
    expect(call).toHaveBeenCalledTimes(2);
    expect(judgements.map((j) => [j.id, j.source])).toEqual([['A', 'heuristic'], ['B', 'heuristic']]);
    expect(log).toMatchObject({ failures: 2, fallback_used: true });
  });
  it('survives a thrown network error', async () => {
    const call = vi.fn().mockRejectedValue(new Error('HTTP 429'));
    const { log } = await rerank(cands, { provider: 'gemini', topN: 2, call });
    expect(log.fallback_used).toBe(true);
    expect(log.notes[0]).toContain('429');
  });
  it('makes no call with provider none', async () => {
    const call = vi.fn();
    await rerank(cands, { provider: 'none', topN: 2, call });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('adapters', () => {
  const ok = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

  it('gemini sends the key in a header, not the URL, and reads usage', async () => {
    const f = ok({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } });
    vi.stubGlobal('fetch', f);
    const r = await geminiCall('hi', { provider: 'gemini', apiKey: 'SECRET', model: 'm' });
    expect(r).toEqual({ text: '{}', inputTokens: 7, outputTokens: 3 });
    expect(String(f.mock.calls[0][0])).not.toContain('SECRET');
    vi.unstubAllGlobals();
  });
  it('openai-compatible trims the base URL and omits auth when no key is given', async () => {
    const f = ok({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } });
    vi.stubGlobal('fetch', f);
    const r = await openAiCompatibleCall('hi', { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1/', model: 'm' });
    expect(f.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(r.text).toBe('x');
    vi.unstubAllGlobals();
  });
});

describe('pipeline with a mock model', () => {
  it('applies the model order, keeps the heuristic list, and still passes the cap', async () => {
    const files = loadDemo();
    const base = await runPipeline(files, DEFAULT_CONFIG);
    const ids = base.promos.map((p) => p.id).reverse();
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply(ids.map((id) => ({ id, reason: 'mock' }))) }] } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    const r = await runPipeline(files, { ...DEFAULT_CONFIG, provider: 'gemini' }, { apiKey: 'k' });
    vi.unstubAllGlobals();
    expect(r.promos[0].id).toBe(ids[0]);
    expect(r.promos[0].judge.source).toBe('llm');
    expect(r.heuristicPromos.map((p) => p.id)).toEqual(base.promos.map((p) => p.id));
  });
});
