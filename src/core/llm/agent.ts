import { z } from 'zod';
import { CLIFF_WINDOW_S, HOOK_WINDOW_S, type StandaloneContext } from '../features';
import { applyDiversity, sharesEdge, toPromo } from '../rank';
import { scoreSegments } from '../score';
import { candidateEnds, candidateStarts, describeSegments, MAX_PROMO_S, MIN_PROMO_S, MIN_SEGMENT_S, overlapsTooMuch } from '../segment';
import type { Emit, PromoSummary } from '../events';
import type { AgentTrace, Candidate, Config, LlmLog, LlmOptions, Promo, Segment, TraceStage, TraceStageName } from '../schema';
import { LlmError, scrub, sleep, withBackoff, type Message, type ModelCall } from './http';
import { ADAPTERS, estimateCost, resolveOptions } from './interface';
import { entriesOf, judgePrompt, lineOf, refinePrompt, retryMessage, writeupPrompt } from './prompts';

const EPS = 0.005;

export interface AgentDeps {
  config: Config;
  opts: LlmOptions;
  ctx: StandaloneContext;
  heuristicRanks: Map<string, number>;
  /** Replaces the provider adapter, for tests. */
  call?: ModelCall;
  wait?: (ms: number) => Promise<void>;
  /** Live progress: stage start and end, every model call, provisional rankings. */
  emit?: Emit;
}

type Step = 'judge' | 'refine' | 'writeup';
interface Tag {
  step: Step;
  batch: number;
  emit: Emit;
}

type Problem = { item?: string; reason: string };
type Checked<T> = { value: T; problems: Problem[] };

function newStage(stage: TraceStageName, model: string | null, itemsIn: number): TraceStage {
  return { stage, model, items_in: itemsIn, items_out: 0, calls: 0, retries: 0, input_tokens: null, output_tokens: null, latency_ms: 0, rejected: [], fallbacks: [], notes: [] };
}

export function emptyTrace(config: Config, opts: LlmOptions): AgentTrace {
  const ai = config.provider !== 'none';
  return {
    mode: ai ? 'ai' : 'heuristic',
    provider: config.provider,
    model: ai ? opts.model ?? null : null,
    base_url: ai ? opts.baseUrl ?? null : null,
    temperature: opts.temperature ?? 0,
    alpha: config.agent.alpha,
    call_cap: config.agent.callCap,
    calls: 0,
    input_tokens: null,
    output_tokens: null,
    estimated_cost_usd: null,
    stages: [],
  };
}

/** Reads JSON from a reply, tolerating a code fence or text around the object. */
export function parseJson(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('not JSON');
  }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Quotes in straight or curly double quotes. */
const quotesIn = (text: string) => [...text.matchAll(/["“]([^"”]{2,})["”]/g)].map((m) => m[1]);

function badQuote(text: string, source: string): string | undefined {
  const src = norm(source);
  return quotesIn(text).find((q) => !src.includes(norm(q)));
}

const Rating = z.object({
  id: z.string(),
  hook: z.number().int().min(1).max(5),
  cliffhanger: z.number().int().min(1).max(5),
  standalone: z.number().int().min(1).max(5),
  reason: z.string().min(1).max(400),
});
type Rating = z.infer<typeof Rating>;

const listOf = (key: string, raw: string): { items: unknown[] } | { error: string } => {
  let data: unknown;
  try {
    data = parseJson(raw);
  } catch {
    return { error: 'the reply is not valid JSON' };
  }
  const items = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(items) ? { items } : { error: `the reply has no "${key}" array` };
};

const issue = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');

export function checkJudge(raw: string, batch: Map<string, string>): Checked<Map<string, Rating>> {
  const out = new Map<string, Rating>();
  const problems: Problem[] = [];
  const list = listOf('ratings', raw);
  if ('error' in list) return { value: out, problems: [{ reason: list.error }] };
  for (const item of list.items) {
    const r = Rating.safeParse(item);
    const id = (item as { id?: unknown })?.id;
    if (!r.success) {
      problems.push({ item: typeof id === 'string' ? id : undefined, reason: `bad rating: ${issue(r.error)}` });
      continue;
    }
    if (!batch.has(r.data.id)) problems.push({ item: r.data.id, reason: `unknown id ${r.data.id}` });
    else if (out.has(r.data.id)) problems.push({ item: r.data.id, reason: `rated twice: ${r.data.id}` });
    else {
      const q = badQuote(r.data.reason, batch.get(r.data.id)!);
      if (q) problems.push({ item: r.data.id, reason: `reason quotes words not in the lines: "${q}"` });
      else out.set(r.data.id, r.data);
    }
  }
  for (const id of batch.keys()) if (!out.has(id) && !problems.some((p) => p.item === id)) problems.push({ item: id, reason: `no rating for ${id}` });
  return { value: out, problems };
}

interface RefineInfo {
  c: Candidate;
  /** Per segment: entry ID to [time, can start here, can end here]. */
  segs: Map<string, { start: number; end: number; s: boolean; e: boolean }>[];
}

const Refinement = z.object({
  id: z.string(),
  keep: z.boolean().optional(),
  segments: z.array(z.object({ start: z.string(), end: z.string() })).optional(),
});

export function checkRefine(raw: string, info: Map<string, RefineInfo>): Checked<Map<string, Segment[] | 'keep'>> {
  const out = new Map<string, Segment[] | 'keep'>();
  const problems: Problem[] = [];
  const list = listOf('refinements', raw);
  if ('error' in list) return { value: out, problems: [{ reason: list.error }] };
  for (const item of list.items) {
    const r = Refinement.safeParse(item);
    if (!r.success) {
      problems.push({ reason: `bad refinement: ${issue(r.error)}` });
      continue;
    }
    const { id, keep, segments } = r.data;
    const ref = info.get(id);
    if (!ref) {
      problems.push({ item: id, reason: `unknown id ${id}` });
      continue;
    }
    if (keep || !segments) {
      out.set(id, 'keep');
      continue;
    }
    const fail = (reason: string) => problems.push({ item: id, reason: `${id}: ${reason}` });
    if (segments.length !== ref.c.segments.length) {
      fail(`needs ${ref.c.segments.length} segment(s), got ${segments.length}`);
      continue;
    }
    const next: Segment[] = [];
    let bad = false;
    segments.forEach((s, i) => {
      if (bad) return;
      const allowed = ref.segs[i];
      const a = allowed.get(s.start);
      const b = allowed.get(s.end);
      if (!a || !b) return (bad = true), fail(`segment ${i + 1} uses an entry ID that is not in its list`);
      if (!a.s) return (bad = true), fail(`segment ${i + 1} cannot start at ${s.start}, it is not marked [S]`);
      if (!b.e) return (bad = true), fail(`segment ${i + 1} cannot end at ${s.end}, it is not marked [E]`);
      if (b.end - a.start < MIN_SEGMENT_S - EPS) return (bad = true), fail(`segment ${i + 1} is shorter than ${MIN_SEGMENT_S} s or ends before it starts`);
      next.push({ episode: ref.c.segments[i].episode, start: a.start, end: b.end });
    });
    if (bad) continue;
    const total = next.reduce((n, s) => n + s.end - s.start, 0);
    if (total < MIN_PROMO_S - EPS || total > MAX_PROMO_S + EPS) {
      fail(`total ${total.toFixed(1)} s is outside 20 to 60 s`);
      continue;
    }
    const same = next.every((s, i) => Math.abs(s.start - ref.c.segments[i].start) < EPS && Math.abs(s.end - ref.c.segments[i].end) < EPS);
    out.set(id, same ? 'keep' : next);
  }
  return { value: out, problems };
}

interface WriteupInfo {
  c: Candidate;
  entries: Map<string, ReturnType<typeof entriesOf>[number]>;
  text: string;
}

const Pick = z.object({ entry: z.string(), quote: z.string().min(2) });
const Writeup = z.object({ id: z.string(), hook: Pick, cliffhanger: Pick, why: z.string().min(1).max(240) });
export type WriteupItem = z.infer<typeof Writeup>;

export function checkWriteup(raw: string, info: Map<string, WriteupInfo>): Checked<Map<string, WriteupItem>> {
  const out = new Map<string, WriteupItem>();
  const problems: Problem[] = [];
  const list = listOf('promos', raw);
  if ('error' in list) return { value: out, problems: [{ reason: list.error }] };
  for (const item of list.items) {
    const r = Writeup.safeParse(item);
    const rawId = (item as { id?: unknown })?.id;
    if (!r.success) {
      problems.push({ item: typeof rawId === 'string' ? rawId : undefined, reason: `bad write-up: ${issue(r.error)}` });
      continue;
    }
    const w = r.data;
    const p = info.get(w.id);
    if (!p) {
      problems.push({ item: w.id, reason: `unknown id ${w.id}` });
      continue;
    }
    const fail = (reason: string) => problems.push({ item: w.id, reason: `${w.id}: ${reason}` });
    const first = p.c.segments[0];
    const last = p.c.segments[p.c.segments.length - 1];
    const h = p.entries.get(w.hook.entry);
    const k = p.entries.get(w.cliffhanger.entry);
    if (!h) fail(`hook entry ${w.hook.entry} is not in this promo`);
    else if (h.seg !== 0 || h.e.start > first.start + HOOK_WINDOW_S - EPS) fail(`hook entry ${w.hook.entry} is not in the first ${HOOK_WINDOW_S} s`);
    else if (!h.e.text.includes(w.hook.quote)) fail(`hook quote is not copied exactly from ${w.hook.entry}`);
    else if (!k) fail(`cliffhanger entry ${w.cliffhanger.entry} is not in this promo`);
    else if (k.seg !== p.c.segments.length - 1 || k.e.end <= last.end - CLIFF_WINDOW_S + EPS) fail(`cliffhanger entry ${w.cliffhanger.entry} does not end in the last ${CLIFF_WINDOW_S} s`);
    else if (!k.e.text.includes(w.cliffhanger.quote)) fail(`cliffhanger quote is not copied exactly from ${w.cliffhanger.entry}`);
    else {
      const q = badQuote(w.why, p.text);
      if (q) fail(`why quotes words not in the promo: "${q}"`);
      else out.set(w.id, w);
    }
  }
  for (const id of info.keys()) if (!out.has(id) && !problems.some((p) => p.item === id)) problems.push({ item: id, reason: `no write-up for ${id}` });
  return { value: out, problems };
}

/** Wraps the adapter with the call cap, backoff and the stage's counters. */
function client(deps: AgentDeps, trace: AgentTrace) {
  const opts = deps.opts;
  const call = deps.call ?? (opts.provider === 'none' ? undefined : ADAPTERS[opts.provider]);
  return async (stage: TraceStage, messages: Message[], tag: Tag): Promise<string> => {
    if (!call) throw new LlmError('config', 'No provider is set.');
    if (trace.calls >= trace.call_cap) throw new LlmError('config', `Call cap of ${trace.call_cap} reached for this run.`);
    trace.calls++;
    stage.calls++;
    const t0 = Date.now();
    tag.emit({ type: 'llm_call', step: tag.step, batch: tag.batch, status: 'started' });
    try {
      const res = await withBackoff(
        () => call(messages, opts),
        (e) => {
          stage.notes.push(`retrying after: ${e.message}`);
          tag.emit({ type: 'llm_call', step: tag.step, batch: tag.batch, status: 'retry', detail: e.kind });
        },
        deps.wait ?? sleep,
      );
      if (res.inputTokens !== undefined) stage.input_tokens = (stage.input_tokens ?? 0) + res.inputTokens;
      if (res.outputTokens !== undefined) stage.output_tokens = (stage.output_tokens ?? 0) + res.outputTokens;
      if (res.model && !stage.model) stage.model = res.model;
      const tokens = res.inputTokens === undefined && res.outputTokens === undefined ? undefined : (res.inputTokens ?? 0) + (res.outputTokens ?? 0);
      tag.emit({ type: 'llm_call', step: tag.step, batch: tag.batch, status: 'ok', tokens, ms: Date.now() - t0 });
      return res.text;
    } finally {
      stage.latency_ms += Date.now() - t0;
    }
  };
}

/**
 * Asks once, checks the reply, and on problems sends them back once. Returns what passed.
 * A thrown provider error ends the stage with nothing accepted, so the caller falls back.
 */
async function askChecked<T>(
  ask: ReturnType<typeof client>,
  stage: TraceStage,
  prompt: string,
  check: (raw: string) => Checked<T>,
  key: string | undefined,
  tag: Tag,
): Promise<T | null> {
  const messages: Message[] = [{ role: 'user', content: prompt }];
  let last: Checked<T> | null = null;
  const ev = (status: 'retry' | 'rejected' | 'fallback', detail: string) => tag.emit({ type: 'llm_call', step: tag.step, batch: tag.batch, status, detail });
  for (const attempt of [1, 2]) {
    let raw: string;
    try {
      raw = await ask(stage, messages, tag);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      stage.notes.push(`call failed: ${scrub(err instanceof Error ? err.message : String(err), key).slice(0, 300)}`);
      ev('fallback', err instanceof LlmError ? `call failed: ${err.kind}` : 'call failed');
      return last?.value ?? null;
    }
    last = check(raw);
    for (const p of last.problems) stage.rejected.push({ ...p, attempt });
    if (last.problems.length) ev('rejected', `${last.problems.length} item${last.problems.length === 1 ? '' : 's'} rejected by the verifier`);
    if (last.problems.length === 0) return last.value;
    if (attempt === 2) {
      ev('fallback', 'rejected items keep the heuristic result');
      return last.value;
    }
    ev('retry', 'sending the problems back once');
    stage.retries++;
    messages.push({ role: 'assistant', content: raw.slice(0, 12000) }, { role: 'user', content: retryMessage(last.problems.map((p) => p.reason)) });
  }
  return last?.value ?? null;
}

const clash = (a: Segment[], b: Segment[]) => overlapsTooMuch(a, b) || sharesEdge(a, b);

interface Scored {
  c: Candidate;
  /** ID of the heuristic candidate this came from. */
  origin: string;
  rating?: Rating;
  llm?: number;
  final: number;
  refinedFrom?: Segment[];
  fallback: boolean;
}

/**
 * The LLM stages on top of the heuristic shortlist: judge, refine, write-up, each checked
 * by code with one retry. Never throws on a provider or reply problem; it falls back per item.
 */
export async function runAgent(pool: Candidate[], deps: AgentDeps): Promise<{ promos: Promo[]; trace: AgentTrace }> {
  const { config, ctx } = deps;
  const opts = resolveOptions(deps.opts);
  deps = { ...deps, opts };
  const { alpha, maxCandidates, batchSize, refineTop } = config.agent;
  const trace = emptyTrace(config, opts);
  const ask = client(deps, trace);
  const model = opts.model ?? null;
  const emit: Emit = deps.emit ?? (() => {});
  let stageStart = Date.now();
  const started = (stage: Step, total?: number) => {
    stageStart = Date.now();
    emit({ type: 'stage_started', stage, total });
  };
  const done = (stage: Step, summary: string) => emit({ type: 'stage_done', stage, ms: Date.now() - stageStart, summary });
  const summaries = (list: Scored[]): PromoSummary[] =>
    list.slice(0, 10).map((s, i) => ({
      id: s.c.id,
      rank: i + 1,
      where: describeSegments(s.c.segments),
      duration_s: Math.round(s.c.segments.reduce((n, g) => n + g.end - g.start, 0) * 100) / 100,
      score: s.final,
      heuristic_score: s.c.scores.total,
      ...(s.llm === undefined ? {} : { ai_score: Math.round(s.llm * 1000) / 1000 }),
    }));

  // 1. Shortlist (code).
  const shortlist = pool.slice(0, maxCandidates);
  const sl = newStage('shortlist', null, pool.length);
  sl.items_out = shortlist.length;
  sl.notes.push(`Top ${shortlist.length} heuristic survivors after overlap removal. The per-episode cap applies at the final rank.`);
  trace.stages.push(sl);

  // 2. Judge (LLM), in batches.
  const judge = newStage('judge', model, shortlist.length);
  trace.stages.push(judge);
  const linesOf = (c: Candidate) => entriesOf(c, ctx.episodes).filter((x) => x.e.type !== 'CAMERA');
  const ratings = new Map<string, Rating>();
  const batches: Candidate[][] = [];
  for (let i = 0; i < shortlist.length; i += batchSize) batches.push(shortlist.slice(i, i + batchSize));
  started('judge', batches.length);
  for (const [bi, batch] of batches.entries()) {
    const text = new Map(batch.map((c) => [c.id, linesOf(c).map((x) => x.e.text).join('\n')]));
    const prompt = judgePrompt(batch.map((c) => ({ id: c.id, lines: linesOf(c).map((x) => lineOf(x.id, x.e)) })));
    const got = await askChecked(ask, judge, prompt, (raw) => checkJudge(raw, text), opts.apiKey, { step: 'judge', batch: bi + 1, emit });
    for (const [id, r] of got ?? []) ratings.set(id, r);
    emit({ type: 'stage_progress', stage: 'judge', done: bi + 1, total: batches.length });
  }
  judge.items_out = ratings.size;
  judge.fallbacks = shortlist.filter((c) => !ratings.has(c.id)).map((c) => c.id);
  done('judge', `${ratings.size} of ${shortlist.length} rated in ${batches.length} batch${batches.length === 1 ? '' : 'es'}${judge.fallbacks.length ? `, ${judge.fallbacks.length} kept the heuristic score` : ''}`);

  // 6a. Blend: final = alpha * llm + (1 - alpha) * heuristic.
  const blend = (c: Candidate, r?: Rating) => {
    const llm = r ? (r.hook + r.cliffhanger + r.standalone - 3) / 12 : undefined;
    return { llm, final: llm === undefined ? c.scores.total : Math.round((alpha * llm + (1 - alpha) * c.scores.total) * 10000) / 10000 };
  };
  const hr = (id: string) => deps.heuristicRanks.get(id) ?? Number.MAX_SAFE_INTEGER;
  const order = (a: Scored, b: Scored) => b.final - a.final || hr(a.origin) - hr(b.origin);
  let scored: Scored[] = shortlist
    .map((c) => ({ c, origin: c.id, rating: ratings.get(c.id), ...blend(c, ratings.get(c.id)), fallback: !ratings.has(c.id) }))
    .sort(order);
  emit({ type: 'partial_ranking', top: summaries(scored) });

  // 3. Refine boundaries (LLM, constrained to entry IDs).
  const refine = newStage('refine', model, Math.min(refineTop, scored.length));
  trace.stages.push(refine);
  started('refine', 1);
  const toRefine = scored.slice(0, refineTop);
  const info = new Map<string, RefineInfo>();
  const blocks = toRefine.map(({ c }) => {
    const all = entriesOf(c, ctx.episodes);
    const segs = c.segments.map((s, i) => {
      const ep = ctx.episodes.get(s.episode)!;
      const starts = new Set(candidateStarts(ep));
      const ends = new Set(candidateEnds(ep));
      return new Map(all.filter((x) => x.seg === i).map((x) => [x.id, { start: x.e.start, end: x.e.end, s: starts.has(x.e.start), e: ends.has(x.e.end) }]));
    });
    info.set(c.id, { c, segs });
    return {
      id: c.id,
      segments: c.segments.map((_, i) =>
        all
          .filter((x) => x.seg === i)
          .map((x) => {
            const f = segs[i].get(x.id)!;
            return lineOf(x.id, x.e, `${f.s ? ' [S]' : ''}${f.e ? ' [E]' : ''}`);
          }),
      ),
    };
  });
  const cuts = toRefine.length ? await askChecked(ask, refine, refinePrompt(blocks), (raw) => checkRefine(raw, info), opts.apiKey, { step: 'refine', batch: 1, emit }) : new Map();
  // Applied one at a time, so a new cut is checked against cuts already moved too.
  let moved = 0;
  for (const [i, s] of scored.entries()) {
    const cut = cuts?.get(s.c.id);
    if (!cut || cut === 'keep') continue;
    const c = scoreSegments(cut, ctx, config.weights);
    const hit = scored.find((o, j) => j !== i && clash(c.segments, o.c.segments));
    if (hit) {
      refine.rejected.push({ item: s.c.id, reason: `the new cut overlaps ${hit.c.id}, kept the original`, attempt: refine.retries + 1 });
      continue;
    }
    moved++;
    scored[i] = { ...s, c, ...blend(c, s.rating), refinedFrom: s.c.segments };
  }
  if (cuts === null && toRefine.length) refine.fallbacks = toRefine.map((s) => s.c.id);
  refine.items_out = moved;
  refine.notes.push(`${moved} of ${toRefine.length} cuts changed.`);
  scored.sort(order);
  emit({ type: 'stage_progress', stage: 'refine', done: 1, total: 1 });
  done('refine', `${moved} of ${toRefine.length} cuts changed${refine.fallbacks.length ? '; kept the heuristic cuts after a failed call' : ''}`);
  emit({ type: 'partial_ranking', top: summaries(scored) });

  // 6b. Final rank, with the per-episode cap.
  const rank = newStage('rank', null, scored.length);
  const { chosen } = applyDiversity(
    scored.map((s) => ({ ...s, id: s.c.id, segments: s.c.segments, scores: { total: s.final } })),
    config.top,
    config.maxPerEpisode,
  );
  rank.items_out = chosen.length;
  rank.notes.push(`final = ${alpha} x llm + ${Math.round((1 - alpha) * 100) / 100} x heuristic. llm = (hook + cliffhanger + standalone - 3) / 12. Unjudged candidates keep their heuristic score.`);

  // 4. Write-up (LLM).
  const writeup = newStage('writeup', model, chosen.length);
  trace.stages.push(writeup);
  started('writeup', 1);
  const winfo = new Map<string, WriteupInfo>();
  const wblocks = chosen.map(({ c }) => {
    const all = entriesOf(c, ctx.episodes);
    winfo.set(c.id, { c, entries: new Map(all.map((x) => [x.id, x])), text: all.map((x) => x.e.text).join('\n') });
    return { id: c.id, lines: all.map((x) => lineOf(x.id, x.e)) };
  });
  const notes = chosen.length ? await askChecked(ask, writeup, writeupPrompt(wblocks), (raw) => checkWriteup(raw, winfo), opts.apiKey, { step: 'writeup', batch: 1, emit }) : new Map();
  writeup.items_out = notes?.size ?? 0;
  writeup.fallbacks = chosen.filter((s) => !notes?.has(s.c.id)).map((s) => s.c.id);
  emit({ type: 'stage_progress', stage: 'writeup', done: 1, total: 1 });
  done('writeup', `${writeup.items_out} of ${chosen.length} written${writeup.fallbacks.length ? `, ${writeup.fallbacks.length} fell back` : ''}`);

  // 5. Verify (code): a summary of every check above, then the final promos.
  const verify = newStage('verify', null, 0);
  const llmStages = [judge, refine, writeup];
  verify.items_in = llmStages.reduce((n, s) => n + s.items_in, 0);
  verify.items_out = judge.items_out + writeup.items_out + (refine.fallbacks.length ? 0 : refine.items_in);
  verify.retries = llmStages.reduce((n, s) => n + s.retries, 0);
  verify.fallbacks = [...new Set(llmStages.flatMap((s) => s.fallbacks))];
  for (const s of llmStages) verify.notes.push(`${s.stage}: ${s.rejected.length} rejected, ${s.retries} retries, ${s.fallbacks.length} fallbacks.`);
  trace.stages.push(verify, rank);

  const promos = chosen.map((s, i) => {
    const p = toPromo(s.c, i + 1, hr(s.origin), ctx.episodes);
    p.final_score = s.final;
    if (s.rating) p.ai = { hook: s.rating.hook, cliffhanger: s.rating.cliffhanger, standalone: s.rating.standalone, score: Math.round(s.llm! * 1000) / 1000, reason: s.rating.reason };
    if (s.refinedFrom) {
      p.refined_from = s.refinedFrom;
      p.flags = [...p.flags, 'refined'];
    }
    const w = notes?.get(s.c.id);
    const info = winfo.get(s.c.id)!;
    if (w) {
      const h = info.entries.get(w.hook.entry)!;
      const k = info.entries.get(w.cliffhanger.entry)!;
      p.hook = { text: w.hook.quote, timestamp: h.e.start, episode: h.episode, source_type: h.e.type };
      p.cliffhanger = { text: w.cliffhanger.quote, timestamp: k.e.start, episode: k.episode, source_type: k.e.type };
      p.judge = { source: 'llm', reason: w.why };
    } else if (s.rating) {
      p.judge = { source: 'llm', reason: s.rating.reason };
    }
    if (s.fallback || !w) p.flags = [...p.flags, 'llm_fallback'];
    return p;
  });

  const sum = (k: 'input_tokens' | 'output_tokens') => {
    const xs = trace.stages.map((s) => s[k]).filter((n): n is number => n !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  };
  trace.input_tokens = sum('input_tokens');
  trace.output_tokens = sum('output_tokens');
  trace.estimated_cost_usd = estimateCost(model, trace.input_tokens, trace.output_tokens);
  return { promos, trace };
}

/** The heuristic run's trace: no model, no calls. */
export function heuristicTrace(config: Config, survivors: number, chosen: number): AgentTrace {
  const trace = emptyTrace(config, { provider: 'none' });
  const sl = newStage('shortlist', null, survivors);
  sl.items_out = chosen;
  sl.notes.push('Heuristic only. No model was called.');
  trace.stages.push(sl);
  return trace;
}

/** Short summary for run_log.json and the CLI. */
export function llmLog(trace: AgentTrace): LlmLog {
  const rejected = trace.stages.reduce((n, s) => n + s.rejected.length, 0);
  const verify = trace.stages.find((s) => s.stage === 'verify');
  return {
    provider: trace.provider,
    model: trace.model,
    calls: trace.calls,
    input_tokens: trace.input_tokens,
    output_tokens: trace.output_tokens,
    failures: rejected + trace.stages.reduce((n, s) => n + s.notes.filter((x) => x.startsWith('call failed')).length, 0),
    fallback_used: (verify?.fallbacks.length ?? 0) > 0,
    notes: trace.stages.flatMap((s) => s.notes.filter((x) => x.startsWith('call failed')).map((x) => `${s.stage}: ${x}`)),
  };
}
