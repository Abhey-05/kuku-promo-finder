import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import { checkJudge, checkRefine, checkWriteup, parseJson, runAgent } from '../src/core/llm/agent';
import { anthropicCall } from '../src/core/llm/anthropic';
import { geminiCall } from '../src/core/llm/gemini';
import { LlmError, scrub, withBackoff, type Message, type ModelCall } from '../src/core/llm/http';
import { testConnection } from '../src/core/llm/interface';
import { openAiCall } from '../src/core/llm/openai';
import { openAiCompatibleCall } from '../src/core/llm/openai-compatible';
import { entriesOf } from '../src/core/llm/prompts';
import { buildOutputs } from '../src/core/outputs';
import { runPipeline } from '../src/core/pipeline';
import type { Config, RunResult } from '../src/core/schema';
import { readCli } from '../src/cli/config';
import { loadDemo } from './helpers';

const KEY = 'sk-test-SECRET-123456789';
const msgs: Message[] = [{ role: 'user', content: 'hi' }];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe('adapters (mocked HTTP)', () => {
  it('anthropic sends the browser header, version and key, and reads usage', async () => {
    const f = vi.fn().mockResolvedValue(json({ model: 'claude-x', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 5, output_tokens: 2 } }));
    vi.stubGlobal('fetch', f);
    const r = await anthropicCall(msgs, { provider: 'anthropic', apiKey: KEY, model: 'claude-x', temperature: 0 });
    expect(f.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    const h = f.mock.calls[0][1].headers;
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['x-api-key']).toBe(KEY);
    expect(h['anthropic-version']).toBeTruthy();
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ model: 'claude-x', temperature: 0, messages: msgs });
    expect(r).toEqual({ text: '{}', model: 'claude-x', inputTokens: 5, outputTokens: 2 });
  });

  it('openai uses Bearer auth and JSON mode', async () => {
    const f = vi.fn().mockResolvedValue(json({ model: 'gpt-x', choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
    vi.stubGlobal('fetch', f);
    const r = await openAiCall(msgs, { provider: 'openai', apiKey: KEY, model: 'gpt-x' });
    expect(f.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(f.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' });
    expect(r).toMatchObject({ text: 'x', inputTokens: 1, outputTokens: 2 });
  });

  it('gemini sends the key in a header, never the URL, and maps the assistant role', async () => {
    const f = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }));
    vi.stubGlobal('fetch', f);
    const r = await geminiCall([...msgs, { role: 'assistant', content: 'a' }], { provider: 'gemini', apiKey: KEY, model: 'm' });
    expect(String(f.mock.calls[0][0])).not.toContain('SECRET');
    expect(JSON.parse(f.mock.calls[0][1].body).contents[1].role).toBe('model');
    expect(r).toMatchObject({ text: '{}', inputTokens: 7, outputTokens: 3 });
  });

  it('openai-compatible trims the base URL and omits auth without a key', async () => {
    const f = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: 'x' } }] }));
    vi.stubGlobal('fetch', f);
    await openAiCompatibleCall(msgs, { provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1/', model: 'm' });
    expect(f.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('openai-compatible without a base URL is a config error, not a network call', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(openAiCompatibleCall(msgs, { provider: 'openai-compatible' })).rejects.toMatchObject({ kind: 'config' });
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth', /key was rejected/],
    [404, 'not_found', /model name or the base URL/],
    [429, 'rate_limit', /Rate limit/],
    [503, 'server', /server error/],
  ])('HTTP %i becomes a readable %s error with the key scrubbed', async (status, kind, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: `bad key ${KEY}` } }, status)));
    const err = await openAiCall(msgs, { provider: 'openai', apiKey: KEY, model: 'm' }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe(kind);
    expect(err.message).toMatch(text);
    expect(err.message).not.toContain(KEY);
  });

  it('a fetch TypeError becomes a network error that mentions CORS and the CLI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await geminiCall(msgs, { provider: 'gemini', apiKey: KEY, model: 'm' }).catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.message).toMatch(/CORS/);
    expect(err.message).toMatch(/command-line/);
  });
});

describe('backoff and connection test', () => {
  it('retries 429 and 5xx up to 3 tries, then gives up', async () => {
    const waits: number[] = [];
    const fn = vi.fn().mockRejectedValue(new LlmError('rate_limit', 'slow down', 429));
    await expect(withBackoff(fn, () => {}, async (ms) => void waits.push(ms))).rejects.toThrow('slow down');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 2000]);
  });
  it('does not retry an auth error', async () => {
    const fn = vi.fn().mockRejectedValue(new LlmError('auth', 'no', 401));
    await expect(withBackoff(fn, () => {}, async () => {})).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('honours a short Retry-After', async () => {
    const waits: number[] = [];
    const fn = vi.fn().mockRejectedValueOnce(new LlmError('rate_limit', 'x', 429, 3)).mockResolvedValue('ok');
    expect(await withBackoff(fn, () => {}, async (ms) => void waits.push(ms))).toBe('ok');
    expect(waits).toEqual([3000]);
  });
  it('reports success with the model name, or the error in plain words', async () => {
    const good: ModelCall = async () => ({ text: '{"ok":true}', model: 'served-model' });
    expect(await testConnection({ provider: 'gemini', apiKey: KEY }, good)).toMatchObject({ ok: true, model: 'served-model' });
    const bad: ModelCall = async () => {
      throw new LlmError('auth', `The key was rejected (HTTP 401). ${KEY}`, 401);
    };
    const r = await testConnection({ provider: 'gemini', apiKey: KEY }, bad);
    expect(r).toMatchObject({ ok: false, kind: 'auth' });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('scrub hides the key and key-shaped strings', () => {
    expect(scrub(`x ${KEY} y`, KEY)).toBe('x [key] y');
    expect(scrub('AIzaSyABCDEFGHIJKLMNOP')).not.toContain('KLMNOP');
  });
  it('parseJson accepts fences and surrounding text', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseJson('nope')).toThrow();
  });
});

describe('verifier', () => {
  const batch = new Map([
    ['A', '"You lied to me."'],
    ['B', '"Who sent you?"'],
  ]);
  const rating = (id: string, extra: object = {}) => ({ id, hook: 4, cliffhanger: 3, standalone: 5, reason: 'ok', ...extra });

  it('accepts good ratings and flags missing ones', () => {
    const r = checkJudge(JSON.stringify({ ratings: [rating('A', { reason: 'opens on "You lied to me."' })] }), batch);
    expect([...r.value.keys()]).toEqual(['A']);
    expect(r.problems).toEqual([{ item: 'B', reason: 'no rating for B' }]);
  });
  it('rejects unknown IDs, duplicates, out-of-range scores and invented quotes', () => {
    const r = checkJudge(
      JSON.stringify({ ratings: [rating('Z'), rating('A'), rating('A'), rating('B', { hook: 9 }), rating('B', { reason: 'says "I will destroy you"' })] }),
      batch,
    );
    const reasons = r.problems.map((p) => p.reason).join(' | ');
    expect(reasons).toMatch(/unknown id Z/);
    expect(reasons).toMatch(/rated twice/);
    expect(reasons).toMatch(/bad rating/);
    expect(reasons).toMatch(/not in the lines/);
    expect([...r.value.keys()]).toEqual(['A']);
  });
  it('rejects non-JSON', () => {
    expect(checkJudge('garbage', batch).problems[0].reason).toMatch(/not valid JSON/);
  });
});

describe('agent on the demo show (mocked model)', () => {
  const files = loadDemo();
  const config: Config = { ...DEFAULT_CONFIG, provider: 'gemini', agent: { ...DEFAULT_CONFIG.agent, maxCandidates: 12, batchSize: 6, refineTop: 5 } };

  /** A fake model that answers each stage from the prompt it was given. */
  function fakeModel(opts: { badFirst?: boolean; refine?: (ids: Map<string, string[][]>) => unknown; writeupBad?: boolean } = {}): ModelCall & { calls: Message[][] } {
    const calls: Message[][] = [];
    const fn = (async (messages: Message[]) => {
      calls.push(messages);
      const p = messages[0].content;
      const retry = messages.length > 1;
      const blocks = p
        .split('\n### ')
        .slice(1)
        .map((b) => ({ id: b.slice(0, b.indexOf('\n')), body: b.slice(b.indexOf('\n') + 1).trimEnd() }));
      if (p.includes('"ratings"')) {
        if (opts.badFirst && !retry) return { text: 'not json at all', inputTokens: 10, outputTokens: 1 };
        // Reverse the heuristic order: the last candidate gets the best ratings.
        const ratings = blocks.map((b, i) => ({ id: b.id, hook: 1 + (i % 5), cliffhanger: 1 + (i % 5), standalone: 3, reason: 'mock' }));
        return { text: JSON.stringify({ ratings }), inputTokens: 100, outputTokens: 20 };
      }
      if (p.includes('"refinements"')) {
        const ids = new Map(blocks.map((b) => [b.id, b.body.split(/Segment \d+:\n/).filter(Boolean).map((s) => s.trim().split('\n'))]));
        return { text: JSON.stringify(opts.refine ? opts.refine(ids) : { refinements: [...ids.keys()].map((id) => ({ id, keep: true })) }) };
      }
      const promos = blocks.map((b) => {
        const lines = b.body.trim().split('\n');
        const first = lines[0];
        const last = lines[lines.length - 1];
        const quote = (l: string) => l.replace(/^\S+ \S+ [^:]+: /, '').slice(0, 12);
        return {
          id: b.id,
          hook: { entry: first.split(' ')[0], quote: opts.writeupBad ? 'INVENTED LINE' : quote(first) },
          cliffhanger: { entry: last.split(' ')[0], quote: quote(last) },
          why: 'Opens hard and ends open.',
        };
      });
      return { text: JSON.stringify({ promos }) };
    }) as unknown as ModelCall & { calls: Message[][] };
    fn.calls = calls;
    return fn;
  }

  async function agentRun(call: ModelCall, cfg = config): Promise<RunResult> {
    // runPipeline uses the real adapter, so route its fetch to the fake model through Gemini's reply shape.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const messages = body.contents.map((c: { role: string; parts: { text: string }[] }) => ({ role: c.role === 'model' ? 'assistant' : 'user', content: c.parts[0].text }));
        const r = await call(messages, { provider: 'gemini' });
        return json({ modelVersion: 'mock-1', candidates: [{ content: { parts: [{ text: r.text }] } }], usageMetadata: { promptTokenCount: r.inputTokens ?? 1, candidatesTokenCount: r.outputTokens ?? 1 } });
      }),
    );
    return runPipeline(files, cfg, { apiKey: KEY });
  }

  it('runs every stage, blends scores, keeps the heuristic list and never stores the key', async () => {
    const r = await agentRun(fakeModel());
    expect(r.trace.mode).toBe('ai');
    expect(r.trace.stages.map((s) => s.stage)).toEqual(['shortlist', 'judge', 'refine', 'writeup', 'verify', 'rank']);
    expect(r.trace.calls).toBe(4);
    expect(r.trace.input_tokens).toBeGreaterThan(0);
    const p = r.promos[0];
    expect(p.ai).toBeDefined();
    expect(p.final_score).toBeCloseTo(0.6 * p.ai!.score + 0.4 * p.heuristic_score, 3);
    expect(r.promos.every((x) => !x.flags.includes('llm_fallback'))).toBe(true);
    expect(r.promos.every((x) => x.judge.source === 'llm' && x.judge.reason === 'Opens hard and ends open.')).toBe(true);
    const base = await runPipeline(files, DEFAULT_CONFIG);
    expect(r.heuristicPromos.map((x) => x.id)).toEqual(base.promos.map((x) => x.id));
    const outputs = buildOutputs(r, { assumptions: '', builder: '' });
    for (const [name, text] of Object.entries(outputs)) expect(text, name).not.toContain(KEY);
    expect(JSON.parse(outputs['agent_trace.json']).mode).toBe('ai');
  });

  it('keeps hooks and cliffhangers verbatim and inside the right windows', async () => {
    const r = await agentRun(fakeModel());
    const src = new Map(r.episodes.map((e) => [e.number, e.source]));
    for (const p of r.promos) {
      expect(src.get(p.hook.episode)).toContain(p.hook.text);
      expect(src.get(p.cliffhanger.episode)).toContain(p.cliffhanger.text);
      expect(p.hook.timestamp - p.segments[0].start).toBeLessThan(3);
    }
  });

  it('retries once with the errors, then succeeds', async () => {
    const m = fakeModel({ badFirst: true });
    const r = await agentRun(m);
    const judge = r.trace.stages.find((s) => s.stage === 'judge')!;
    expect(judge.retries).toBe(2);
    expect(judge.rejected[0]).toMatchObject({ attempt: 1, reason: expect.stringMatching(/not valid JSON/) });
    expect(judge.fallbacks).toEqual([]);
    const retried = m.calls.find((c) => c.length === 3)!;
    expect(retried[2].content).toMatch(/Your reply had these problems/);
  });

  it('falls back per promo and flags llm_fallback when the write-up invents a quote twice', async () => {
    const r = await agentRun(fakeModel({ writeupBad: true }));
    const w = r.trace.stages.find((s) => s.stage === 'writeup')!;
    expect(w.retries).toBe(1);
    expect(w.fallbacks.length).toBe(r.promos.length);
    expect(r.promos.every((p) => p.flags.includes('llm_fallback'))).toBe(true);
    expect(r.promos.every((p) => p.hook.text !== 'INVENTED LINE')).toBe(true);
    expect(r.log.llm.fallback_used).toBe(true);
  });

  it('falls back to the heuristic order when every call fails, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { message: 'bad key' } }, 401)));
    const r = await runPipeline(files, config, { apiKey: KEY });
    expect(r.trace.calls).toBe(4);
    expect(r.promos.every((p) => p.flags.includes('llm_fallback'))).toBe(true);
    expect(r.log.llm.notes.join(' ')).toMatch(/key was rejected/);
    expect(JSON.stringify(r.trace)).not.toContain(KEY);
  });

  it('stops at the call cap', async () => {
    const r = await agentRun(fakeModel({ badFirst: true }), { ...config, agent: { ...config.agent, callCap: 2 } });
    expect(r.trace.calls).toBe(2);
    expect(r.trace.stages.flatMap((s) => s.notes).join(' ')).toMatch(/Call cap of 2/);
  });
});

describe('boundary refinement by entry IDs', () => {
  it('converts IDs to timestamps, rescoring the cut, and rejects bad picks', async () => {
    const files = loadDemo();
    const base = await runPipeline(files, DEFAULT_CONFIG);
    const ep = new Map(base.episodes.map((e) => [e.number, e]));
    const target = base.promos.find((p) => p.segments.length === 1 && p.total_duration_s > 30)!;
    const entries = entriesOf({ ...target, scores: target.scores, cues: [], flags: [], id: target.id, segments: target.segments, total_duration_s: target.total_duration_s }, ep);
    // Model-side: keep the start, end at the last [E] entry that leaves at least 20 s.
    const call: ModelCall = async (messages) => {
      const p = messages[0].content;
      if (p.includes('"ratings"')) {
        const ids = [...p.matchAll(/^### (\S+)/gm)].map((m) => m[1]);
        return { text: JSON.stringify({ ratings: ids.map((id) => ({ id, hook: 5, cliffhanger: 5, standalone: 5, reason: 'x' })) }) };
      }
      if (p.includes('"refinements"')) {
        const block = p.split(`### ${target.id}\n`)[1]?.split('\n### ')[0] ?? '';
        const lines = block.split('\n').filter((l) => /^E\d+#/.test(l));
        const start = lines.find((l) => l.includes('[S]'))!.split(' ')[0];
        const startT = entries.find((e) => e.id === start)!.e.start;
        const end = lines
          .filter((l) => l.includes('[E]'))
          .map((l) => l.split(' ')[0])
          .find((id) => {
            const e = entries.find((x) => x.id === id)!.e;
            return e.end - startT >= 21 && e.end < target.segments[0].end - 1;
          });
        return { text: JSON.stringify({ refinements: end ? [{ id: target.id, segments: [{ start, end }] }] : [] }) };
      }
      return { text: '{"promos":[]}' };
    };
    vi.stubGlobal('fetch', vi.fn());
    const cfg: Config = { ...DEFAULT_CONFIG, provider: 'gemini', agent: { ...DEFAULT_CONFIG.agent, refineTop: 30 } };
    const { generateCandidates, byScore } = await import('../src/core/score');
    const { nonMaxSuppression, applyDiversity } = await import('../src/core/rank');
    const { episodes } = await import('../src/core/parse').then((m) => m.parseAll(files));
    const g = generateCandidates(episodes, cfg.weights);
    const survivors = nonMaxSuppression([...g.singles, ...g.multi].sort(byScore));
    const pool = applyDiversity(survivors, 30, cfg.maxPerEpisode).chosen;
    const out = await runAgent(pool, { config: cfg, opts: { provider: 'gemini', apiKey: KEY }, ctx: g.ctx, heuristicRanks: new Map(survivors.map((c, i) => [c.id, i + 1])), call });
    const refine = out.trace.stages.find((s) => s.stage === 'refine')!;
    expect(refine.items_out).toBe(1);
    const moved = out.promos.find((p) => p.refined_from);
    if (moved) {
      expect(moved.flags).toContain('refined');
      expect(moved.total_duration_s).toBeGreaterThanOrEqual(20);
      expect(moved.segments[0].end).toBeLessThan(target.segments[0].end);
    }
  });

  it('checkRefine rejects IDs outside the list, unmarked starts and bad totals', () => {
    const segs = [
      new Map([
        ['E1#1', { start: 0, end: 2, s: true, e: false }],
        ['E1#2', { start: 2, end: 10, s: false, e: true }],
        ['E1#3', { start: 10, end: 30, s: true, e: true }],
      ]),
    ];
    const c = { id: 'C', segments: [{ episode: 1, start: 0, end: 30 }], total_duration_s: 30, scores: DEFAULT_CONFIG.weights as never, cues: [], flags: [] };
    const info = new Map([['C', { c, segs }]]);
    const r = (seg: object) => checkRefine(JSON.stringify({ refinements: [{ id: 'C', segments: [seg] }] }), info).problems[0]?.reason ?? 'ok';
    expect(r({ start: 'E9#9', end: 'E1#3' })).toMatch(/not in its list/);
    expect(r({ start: 'E1#2', end: 'E1#3' })).toMatch(/not marked \[S\]/);
    expect(r({ start: 'E1#1', end: 'E1#2' })).toMatch(/outside 20 to 60/);
    expect(r({ start: 'E1#1', end: 'E1#3' })).toBe('ok');
    expect(checkRefine(JSON.stringify({ refinements: [{ id: 'C', keep: true }] }), info).value.get('C')).toBe('keep');
  });

  it('checkWriteup rejects a hook outside the first 3 s and a non-verbatim cliffhanger', () => {
    const e = (idx: number, start: number, end: number, text: string) => ({ idx, type: 'DIALOGUE' as const, label: 'A', speaker: 'A', start, end, text, scene: 1, line: idx });
    const all = [e(1, 0, 2, '"Open now."'), e(2, 5, 20, '"Middle."'), e(3, 20, 25, '"Who are you?"')];
    const entries = new Map(all.map((x) => [`E1#${x.idx}`, { id: `E1#${x.idx}`, seg: 0, episode: 1, e: x }]));
    const c = { id: 'P', segments: [{ episode: 1, start: 0, end: 25 }], total_duration_s: 25, scores: {} as never, cues: [], flags: [] };
    const info = new Map([['P', { c, entries, text: all.map((x) => x.text).join('\n') }]]);
    const w = (hook: object, cliff: object) => checkWriteup(JSON.stringify({ promos: [{ id: 'P', hook, cliffhanger: cliff, why: 'fine' }] }), info).problems[0]?.reason ?? 'ok';
    expect(w({ entry: 'E1#2', quote: 'Middle' }, { entry: 'E1#3', quote: 'Who are you?' })).toMatch(/first 3 s/);
    expect(w({ entry: 'E1#1', quote: 'Open now' }, { entry: 'E1#3', quote: 'Who are YOU' })).toMatch(/not copied exactly/);
    expect(w({ entry: 'E1#1', quote: 'Open now' }, { entry: 'E1#2', quote: 'Middle' })).toMatch(/last 5 s/);
    expect(w({ entry: 'E1#1', quote: 'Open now' }, { entry: 'E1#3', quote: 'Who are you?' })).toBe('ok');
  });
});

describe('CLI config', () => {
  const base = ['--input', 'samples/demo-show', '--out', 'runs/x'];
  it('reads provider, model, base URL and key from env', () => {
    const r = readCli(base, { KUKU_LLM_PROVIDER: 'openai-compatible', KUKU_LLM_MODEL: 'm1', KUKU_LLM_BASE_URL: 'http://h/v1', KUKU_LLM_API_KEY: KEY, KUKU_LLM_ALPHA: '0.3' });
    expect(r.errors).toEqual([]);
    expect(r.config.provider).toBe('openai-compatible');
    expect(r.config.agent.alpha).toBe(0.3);
    expect(r.llm).toMatchObject({ model: 'm1', baseUrl: 'http://h/v1', apiKey: KEY, temperature: 0 });
  });
  it('lets flags win over env', () => {
    const r = readCli([...base, '--provider', 'anthropic', '--model', 'flag-model'], { KUKU_LLM_PROVIDER: 'gemini', KUKU_LLM_MODEL: 'env-model', KUKU_LLM_API_KEY: KEY });
    expect(r.config.provider).toBe('anthropic');
    expect(r.llm.model).toBe('flag-model');
  });
  it('defaults to heuristic only and accepts the old LLM_API_KEY', () => {
    expect(readCli(base, {}).config.provider).toBe('none');
    expect(readCli([...base, '--provider', 'gemini'], { LLM_API_KEY: KEY }).llm.apiKey).toBe(KEY);
  });
  it('refuses a key flag, a missing key, unknown providers and bad numbers', () => {
    expect(readCli([...base, '--api-key', 'x'], {}).errors.join()).toMatch(/Do not pass the key/);
    expect(readCli([...base, '--provider', 'gemini'], {}).errors.join()).toMatch(/needs a key/);
    expect(readCli([...base, '--provider', 'nope'], {}).errors.join()).toMatch(/Unknown provider/);
    expect(readCli([...base, '--alpha', '2'], {}).errors.join()).toMatch(/alpha must be/);
  });
  it('will not send input_pack to a provider unless KUKU_ALLOW_PACK_TO_LLM=1', () => {
    const pack = ['--input', 'input_pack', '--out', 'runs/x', '--provider', 'gemini'];
    expect(readCli(pack, { KUKU_LLM_API_KEY: KEY }).errors.join()).toMatch(/confidential/);
    expect(readCli(pack, { KUKU_LLM_API_KEY: KEY, KUKU_ALLOW_PACK_TO_LLM: '1' }).errors).toEqual([]);
    expect(readCli(['--input', 'input_pack', '--out', 'runs/x'], {}).errors).toEqual([]);
  });
});
