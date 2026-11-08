import type { Candidate, Config, Episode, InputFile, LlmOptions, Promo, RunResult } from './schema';
import { parseAll } from './parse';
import { byScore, generateCandidates } from './score';
import { applyDiversity, nonMaxSuppression, toPromo } from './rank';
import { heuristicTrace, llmLog, runAgent } from './llm/agent';
import { resolveOptions } from './llm/interface';
import { RERANK_POOL, RUNNERS_UP } from './config';
import { AI_STAGES, type Emit, type PromoSummary, type StageName } from './events';
import { describeSegments, MAX_PROMO_S, MIN_PROMO_S, MIN_SEGMENT_S } from './segment';

export { STAGES, AI_STAGES, STAGE_LABELS, type StageName } from './events';

export interface RunHooks {
  /** Live progress events. See src/core/events.ts. */
  emit?: Emit;
  /** Called between stages. Throw to stop the run. */
  checkpoint?: () => void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ms = (t: number) => Math.round(now() - t);
const n = (x: number) => x.toLocaleString('en-US');

const textBytes = (t: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(t).length : t.length);

export function summarize(c: Candidate, rank: number, final = c.scores.total): PromoSummary {
  return {
    id: c.id,
    rank,
    where: describeSegments(c.segments),
    duration_s: Math.round(c.segments.reduce((d, s) => d + s.end - s.start, 0) * 100) / 100,
    score: final,
    heuristic_score: c.scores.total,
  };
}

const promoSummary = (p: Promo): PromoSummary => ({
  id: p.id,
  rank: p.rank,
  where: describeSegments(p.segments),
  duration_s: p.total_duration_s,
  score: p.final_score,
  heuristic_score: p.heuristic_score,
  ...(p.ai ? { ai_score: p.ai.score } : {}),
});

/** Code checks on the final list: lengths, order, and quotes copied exactly from the script. */
export function verifyPromos(promos: Promo[], episodes: Map<number, Episode>): string[] {
  const problems: string[] = [];
  for (const p of promos) {
    if (p.total_duration_s < MIN_PROMO_S - 0.01 || p.total_duration_s > MAX_PROMO_S + 0.01) problems.push(`${p.id}: length ${p.total_duration_s}s`);
    if (p.segments.some((s) => s.end - s.start < MIN_SEGMENT_S - 0.01)) problems.push(`${p.id}: a segment under ${MIN_SEGMENT_S}s`);
    for (const q of [p.hook, p.cliffhanger]) {
      const src = episodes.get(q.episode)?.source ?? '';
      if (!src.includes(q.text)) problems.push(`${p.id}: a quote is not verbatim`);
    }
  }
  return problems;
}

/** Parses every file and reports each one as it is done. The caller emits stage start and end. */
export function parseWithEvents(files: InputFile[], emit: Emit) {
  return parseAll(files, ({ episode, report: r }, d, total) => {
    if (episode.entries.length === 0) emit({ type: 'file_failed', name: r.file, reason: 'No timestamped entries found. Is this a screenplay in the expected format?' });
    else
      emit({
        type: 'file_parsed',
        name: r.file,
        episode: r.episode,
        scenes: r.scene_count,
        entries: r.entry_count,
        duration_s: r.duration_s,
        warnings: [...r.unparsed, ...r.violations].map((w) => ({ line: w.line, reason: w.reason })),
      });
    emit({ type: 'stage_progress', stage: 'parse', done: d, total });
  });
}

export async function runPipeline(
  files: InputFile[],
  config: Config,
  llm: Omit<LlmOptions, 'provider'> = {},
  hooks: RunHooks = {},
): Promise<RunResult> {
  const emit: Emit = hooks.emit ?? (() => {});
  const runStart = now();
  const timings: Record<string, number> = {};
  let current: StageName = 'read';
  let t = now();
  const start = (s: StageName, total?: number) => {
    hooks.checkpoint?.();
    current = s;
    t = now();
    emit({ type: 'stage_started', stage: s, total });
  };
  const done = (s: StageName, summary: string) => {
    timings[s] = ms(t);
    emit({ type: 'stage_done', stage: s, ms: timings[s], summary });
  };
  const fail = (err: unknown): never => {
    emit({ type: 'run_error', stage: current, message: err instanceof Error ? err.message : String(err) });
    throw err;
  };

  try {
    // Read: the files are already in memory; report what arrived.
    start('read', files.length);
    let bytes = 0;
    for (const f of files) {
      const b = textBytes(f.text);
      bytes += b;
      emit({ type: 'file_received', name: f.name, bytes: b });
    }
    done('read', `${files.length} file${files.length === 1 ? '' : 's'}, ${n(Math.round(bytes / 1024))} KB`);

    start('parse', files.length);
    const { episodes, report } = parseWithEvents(files, emit);
    if (episodes.length === 0) throw new Error('No readable episodes found in the input.');
    done('parse', `${episodes.length} of ${files.length} episodes, ${n(report.totals.entries)} entries, ${(report.totals.duration_s / 60).toFixed(1)} min`);

    start('segment', episodes.length);
    let windows = 0;
    let generated = 0;
    const { singles, multi, ctx } = generateCandidates(episodes, config.weights, {
      onSegment: (d, total, w) => {
        windows = w;
        emit({ type: 'stage_progress', stage: 'segment', done: d, total });
      },
      onSegmentDone: () => {
        done('segment', `${n(windows)} single-scene windows across ${episodes.length} episodes`);
        start('score', episodes.length + 1);
      },
      onScore: (d, total, g, best) => {
        generated = g;
        emit({ type: 'stage_progress', stage: 'score', done: d, total });
        emit({ type: 'candidates_update', generated: g });
        emit({ type: 'partial_ranking', top: nonMaxSuppression(best).slice(0, 10).map((c, i) => summarize(c, i + 1)) });
      },
    });
    done('score', `${n(singles.length)} single + ${n(multi.length)} stitched = ${n(generated || singles.length + multi.length)} candidates`);

    start('shortlist');
    const all = [...singles, ...multi].sort(byScore);
    const survivors = nonMaxSuppression(all);
    const keptIds = new Set(survivors.map((c) => c.id));
    const heuristicRanks = new Map<string, number>(survivors.map((c, i) => [c.id, i + 1]));
    const plain = applyDiversity(survivors, config.top, config.maxPerEpisode);
    const aiMode = config.provider !== 'none';
    const shortlisted = aiMode ? Math.min(survivors.length, config.agent.maxCandidates) : plain.chosen.length;
    emit({ type: 'candidates_update', generated: all.length, kept_after_nms: survivors.length, shortlisted });
    emit({ type: 'partial_ranking', top: plain.chosen.slice(0, 10).map((c, i) => summarize(c, i + 1)) });
    done('shortlist', `${n(all.length)} candidates → ${n(survivors.length)} after overlap removal`);

    const heuristicPromos = plain.chosen.map((c, i) => toPromo(c, i + 1, heuristicRanks.get(c.id)!, ctx.episodes));
    let promos: Promo[] = heuristicPromos;
    let trace = heuristicTrace(config, survivors.length, plain.chosen.length);

    if (aiMode) {
      hooks.checkpoint?.();
      current = 'judge';
      const tl = now();
      const opts = resolveOptions({ ...llm, provider: config.provider });
      // The per-episode cap applies to the final top N inside the agent, not to the shortlist.
      const pool = survivors.slice(0, Math.max(RERANK_POOL, config.agent.maxCandidates, config.top));
      const out = await runAgent(pool, {
        config,
        opts,
        ctx,
        heuristicRanks,
        emit: (e) => {
          if (e.type === 'stage_started') current = e.stage;
          emit(e);
        },
      });
      promos = out.promos;
      trace = out.trace;
      timings.llm_stages = ms(tl);
    } else {
      for (const s of AI_STAGES) emit({ type: 'stage_skipped', stage: s, reason: 'Heuristic only. Pick a model in Settings to run the AI stages.' });
    }

    start('verify', promos.length);
    const problems = verifyPromos(promos, ctx.episodes);
    const fallbacks = trace.stages.find((s) => s.stage === 'verify')?.fallbacks.length ?? 0;
    done(
      'verify',
      `${promos.length - new Set(problems.map((p) => p.split(':')[0])).size} of ${promos.length} promos pass the length and verbatim-quote checks${aiMode ? `; ${fallbacks} AI fallback${fallbacks === 1 ? '' : 's'}` : ''}`,
    );

    start('rank');
    const inList = new Set(promos.map((p) => p.id));
    const runnersUp = survivors
      .filter((c: Candidate) => !inList.has(c.id))
      .slice(0, RUNNERS_UP)
      .map((c, i) => toPromo(c, promos.length + i + 1, heuristicRanks.get(c.id)!, ctx.episodes));
    emit({ type: 'partial_ranking', top: promos.slice(0, 10).map(promoSummary), final: true });
    done('rank', `${promos.length} promos ranked${config.maxPerEpisode ? `, at most ${config.maxPerEpisode} per episode` : ''}; ${runnersUp.length} runners-up kept for labelling`);

    const counts = {
      files: files.length,
      episodes: episodes.length,
      entries: report.totals.entries,
      single_candidates: singles.length,
      multi_candidates: multi.length,
      after_nms: survivors.length,
      promos: promos.length,
    };
    emit({ type: 'run_done', ms: ms(runStart), counts: { ...counts, llm_calls: trace.calls } });

    return {
      episodes,
      parseReport: report,
      candidates: all.map((c) => ({ ...c, kept: keptIds.has(c.id) })),
      promos,
      heuristicPromos,
      runnersUp,
      trace,
      log: {
        label: config.label,
        config,
        timings_ms: timings,
        counts,
        diversity: plain.events,
        llm: llmLog(trace),
        determinism_note:
          'No random numbers and no clock in the heuristic ranking. With provider none, the same input and config give an identical promos.json. Model output can vary even at temperature 0, so AI runs are not guaranteed to repeat.',
      },
    };
  } catch (err) {
    return fail(err);
  }
}
