import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import { checkOrder, createBatcher, isCritical, ProgressEvent, STAGES, type ProgressEvent as Ev } from '../src/core/events';
import { runPipeline } from '../src/core/pipeline';
import { parseAll } from '../src/core/parse';
import { cancelledAt, initialLive, liveReducer, totals } from '../src/web/live';
import { cliProgress } from '../src/cli/progress';
// @ts-expect-error plain .mjs helper
import { answer } from '../scripts/mock-llm.mjs';
import { loadDemo } from './helpers';

const KEY = 'AIza' + 'Test' + 'k'.repeat(31);
const files = loadDemo();

async function collect(provider: 'none' | 'gemini' = 'none', checkpointAt?: string) {
  const events: Ev[] = [];
  let current = '';
  const run = runPipeline(files, { ...DEFAULT_CONFIG, provider }, provider === 'none' ? {} : { apiKey: KEY }, {
    emit: (e) => {
      if (e.type === 'stage_started') current = e.stage;
      events.push(e);
    },
    checkpoint: () => {
      if (checkpointAt && current === checkpointAt) throw new Error('Cancelled');
    },
  });
  return { events, run };
}

function stubGemini() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const text = JSON.stringify(answer(body.contents[0].parts[0].text));
      return new Response(JSON.stringify({ modelVersion: 'mock-1', candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 } }), { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('progress events', () => {
  it('every event of a heuristic run matches the schema', async () => {
    const { events, run } = await collect();
    await run;
    expect(events.length).toBeGreaterThan(20);
    for (const e of events) expect(ProgressEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
  });

  it('runs the stages strictly in order, each one ending, with AI stages skipped', async () => {
    const { events, run } = await collect();
    await run;
    expect(checkOrder(events)).toEqual([]);
    const order = events.filter((e) => e.type === 'stage_started' || e.type === 'stage_skipped').map((e) => (e as { stage: string }).stage);
    expect(order).toEqual([...STAGES]);
    expect(events.filter((e) => e.type === 'stage_skipped').map((e) => (e as { stage: string }).stage)).toEqual(['judge', 'refine', 'writeup']);
    expect(events.at(-1)?.type).toBe('run_done');
    const parsed = events.filter((e) => e.type === 'file_parsed');
    expect(parsed).toHaveLength(files.length);
    const last = events.filter((e) => e.type === 'partial_ranking').at(-1) as Extract<Ev, { type: 'partial_ranking' }>;
    expect(last.final).toBe(true);
  });

  it('shows provisional results before the final ranking', async () => {
    const { events, run } = await collect();
    const r = await run;
    const rankings = events.filter((e): e is Extract<Ev, { type: 'partial_ranking' }> => e.type === 'partial_ranking');
    const firstAt = events.indexOf(rankings[0]);
    const shortlistDone = events.findIndex((e) => e.type === 'stage_done' && e.stage === 'shortlist');
    expect(firstAt).toBeLessThan(shortlistDone);
    expect(rankings.at(-1)!.top.map((p) => p.id)).toEqual(r.promos.slice(0, 10).map((p) => p.id));
  });

  it('an AI run emits each model call, in stage order, and blends the ranking live', async () => {
    stubGemini();
    const { events, run } = await collect('gemini');
    const r = await run;
    expect(checkOrder(events)).toEqual([]);
    for (const e of events) expect(ProgressEvent.safeParse(e).success).toBe(true);
    const calls = events.filter((e): e is Extract<Ev, { type: 'llm_call' }> => e.type === 'llm_call');
    expect(calls.filter((c) => c.status === 'started')).toHaveLength(r.trace.calls);
    expect(calls.filter((c) => c.status === 'ok').every((c) => c.tokens === 60)).toBe(true);
    expect(new Set(calls.map((c) => c.step))).toEqual(new Set(['judge', 'refine', 'writeup']));
    expect(events.filter((e) => e.type === 'stage_skipped')).toHaveLength(0);
  });

  it('no event carries the key or screenplay text', async () => {
    stubGemini();
    const { events, run } = await collect('gemini');
    await run;
    const blob = JSON.stringify(events);
    expect(blob).not.toContain(KEY);
    expect(blob).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    const lines = parseAll(files)
      .episodes.flatMap((ep) => ep.entries.map((x) => x.text.split('\n')[0].trim()))
      .filter((t) => t.length >= 20);
    expect(lines.length).toBeGreaterThan(20);
    const leaked = lines.filter((t) => blob.includes(t));
    expect(leaked).toEqual([]);
  });

  it('a failure mid-run ends the open stage with run_error', async () => {
    const { events, run } = await collect('none', 'score');
    await expect(run).rejects.toThrow('Cancelled');
    expect(checkOrder(events)).toEqual([]);
    const err = events.at(-1)!;
    expect(err.type).toBe('run_error');
    expect((err as { stage: string }).stage).toBe('score');
  });
});

describe('batching', () => {
  it('never drops or reorders a critical event, and coalesces progress to about 10 a second', () => {
    let clock = 0;
    const batches: Ev[][] = [];
    const b = createBatcher((x) => batches.push(x), 100, () => clock, null);
    const sent: Ev[] = [];
    const push = (e: Ev) => {
      sent.push(e);
      b.push(e);
    };
    push({ type: 'stage_started', stage: 'score', total: 1000 });
    for (let i = 1; i <= 1000; i++) {
      clock += 1; // 1 ms apart: 1000 events in one second
      push({ type: 'stage_progress', stage: 'score', done: i, total: 1000 });
      push({ type: 'candidates_update', generated: i * 10 });
      if (i % 100 === 0) push({ type: 'llm_call', step: 'judge', batch: i / 100, status: i % 200 ? 'rejected' : 'fallback', detail: 'x' });
      if (i === 500) push({ type: 'file_failed', name: 'bad.txt', reason: 'no entries' });
    }
    push({ type: 'stage_done', stage: 'score', ms: 1000, summary: 'ok' });
    push({ type: 'run_error', stage: 'score', message: 'stop' });
    b.flush();
    const got = batches.flat();
    const critical = sent.filter(isCritical);
    expect(got.filter(isCritical)).toEqual(critical);
    // In order relative to each other and to stage start.
    expect(checkOrder(got)).toEqual([]);
    // About 10 batches a second from the clock, plus one per critical event.
    expect(batches.length).toBeLessThanOrEqual(10 + critical.length + 2);
    // The last progress value survives coalescing.
    const lastProgress = got.filter((e) => e.type === 'stage_progress').at(-1) as Extract<Ev, { type: 'stage_progress' }>;
    expect(lastProgress.done).toBe(1000);
  });

  it('flushes a waiting event on a timer, so a stage start shows while the engine waits', async () => {
    const batches: Ev[][] = [];
    const b = createBatcher((x) => batches.push(x), 30);
    b.push({ type: 'stage_started', stage: 'parse', total: 1 });
    b.push({ type: 'stage_started', stage: 'segment' }); // within the interval: queued
    expect(batches.flat()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(batches.flat()).toHaveLength(2);
  });

  it('keeps every per-file and per-call event', () => {
    const batches: Ev[][] = [];
    const b = createBatcher((x) => batches.push(x), 100, () => 0, null);
    for (let i = 0; i < 50; i++) b.push({ type: 'file_parsed', name: `e${i}.txt`, episode: i, scenes: 1, entries: 1, duration_s: 1, warnings: [] });
    for (let i = 0; i < 5; i++) b.push({ type: 'llm_call', step: 'judge', batch: i, status: 'started' });
    b.flush();
    expect(batches.flat()).toHaveLength(55);
  });
});

describe('live view state', () => {
  it('cancel mid-run leaves a consistent state and keeps partial results', async () => {
    const { events, run } = await collect();
    await run;
    const cut = events.findIndex((e) => e.type === 'stage_started' && e.stage === 'shortlist');
    let s = liveReducer(initialLive(), { type: 'start', phase: 'running', at: 0 });
    s = liveReducer(s, { type: 'events', events: events.slice(0, cut + 1), at: 10 });
    expect(s.stages.shortlist.status).toBe('running');
    expect(s.top.length).toBeGreaterThan(0);
    s = liveReducer(s, { type: 'cancel', at: 20 });
    expect(s.phase).toBe('cancelled');
    expect(Object.values(s.stages).some((x) => x.status === 'running')).toBe(false);
    expect(cancelledAt(s)).toBe('shortlist');
    expect(s.final).toBe(false);
    expect(s.top.length).toBeGreaterThan(0);
    expect(s.stages.score.status).toBe('done');
    expect(s.stages.judge.status).toBe('pending');
    // Late events from a terminated worker cannot exist, but a second cancel is a no-op.
    expect(liveReducer(s, { type: 'cancel', at: 30 })).toBe(s);
  });

  it('a full run ends done, final, with file totals', async () => {
    const { events, run } = await collect();
    await run;
    let s = liveReducer(initialLive(), { type: 'start', phase: 'running', at: 0 });
    s = liveReducer(s, { type: 'events', events, at: 5 });
    expect(s.phase).toBe('done');
    expect(s.final).toBe(true);
    expect(totals(s.files).parsed).toBe(files.length);
    expect(s.counters.generated).toBeGreaterThan(s.counters.kept);
    expect(s.log.every((l) => !l.text.includes(KEY))).toBe(true);
  });
});

describe('CLI progress', () => {
  it('prints one line per finished stage', async () => {
    let out = '';
    const print = cliProgress({ write: (x: string) => (out += x), isTTY: false });
    await runPipeline(files, DEFAULT_CONFIG, {}, { emit: print });
    for (const label of ['Read files', 'Parse scripts', 'Find cut points', 'Score candidates', 'Remove overlaps', 'Verify outputs', 'Final ranking']) expect(out).toContain(label);
    expect(out).toContain('skipped');
  });
});
