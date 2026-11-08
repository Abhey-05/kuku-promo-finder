import type { Candidate, Config, InputFile, LlmOptions, Promo, RunResult } from './schema';
import { parseAll } from './parse';
import { byScore, generateCandidates } from './score';
import { applyDiversity, nonMaxSuppression, toPromo } from './rank';
import { heuristicTrace, llmLog, runAgent } from './llm/agent';
import { resolveOptions } from './llm/interface';
import { RERANK_POOL, RUNNERS_UP } from './config';

/** The stages shown in the UI, in order. The last four run only when a provider is set. */
export type Stage = 'parse' | 'shortlist' | 'judge' | 'refine' | 'writeup' | 'verify';
export const STAGES: Stage[] = ['parse', 'shortlist', 'judge', 'refine', 'writeup', 'verify'];
export const LLM_STAGES: Stage[] = ['judge', 'refine', 'writeup', 'verify'];

export interface StageInfo {
  /** Items done and total, when the stage has a count to show. */
  done?: number;
  total?: number;
  detail?: string;
}

export interface RunHooks {
  onStage?: (stage: Stage, info?: StageInfo) => void;
  /** Called between stages. Throw to stop the run. */
  checkpoint?: () => void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ms = (t: number) => Math.round(now() - t);

export async function runPipeline(
  files: InputFile[],
  config: Config,
  llm: Omit<LlmOptions, 'provider'> = {},
  hooks: RunHooks = {},
): Promise<RunResult> {
  const timings: Record<string, number> = {};
  const stage = (s: Stage, info?: StageInfo) => {
    hooks.checkpoint?.();
    hooks.onStage?.(s, info);
    return now();
  };

  let t = stage('parse');
  const { episodes, report } = parseAll(files);
  timings.parse = ms(t);
  if (episodes.length === 0) throw new Error('No readable episodes found in the input.');
  hooks.onStage?.('parse', { detail: `${episodes.length} episodes, ${report.totals.entries} entries` });

  t = stage('shortlist');
  const { singles, multi, ctx } = generateCandidates(episodes, config.weights);
  timings.segment_and_features = ms(t);
  t = now();
  const all = [...singles, ...multi].sort(byScore);
  const survivors = nonMaxSuppression(all);
  const keptIds = new Set(survivors.map((c) => c.id));
  const heuristicRanks = new Map<string, number>(survivors.map((c, i) => [c.id, i + 1]));
  const plain = applyDiversity(survivors, config.top, config.maxPerEpisode);
  timings.rank = ms(t);
  hooks.onStage?.('shortlist', { detail: `${all.length.toLocaleString('en-US')} candidates, ${survivors.length} after overlap removal` });

  const heuristicPromos = plain.chosen.map((c, i) => toPromo(c, i + 1, heuristicRanks.get(c.id)!, ctx.episodes));
  let promos: Promo[] = heuristicPromos;
  let trace = heuristicTrace(config, survivors.length, plain.chosen.length);

  if (config.provider !== 'none') {
    t = now();
    const opts = resolveOptions({ ...llm, provider: config.provider });
    // The per-episode cap applies to the final top N inside the agent, not to the shortlist.
    const pool = survivors.slice(0, Math.max(RERANK_POOL, config.agent.maxCandidates, config.top));
    const out = await runAgent(pool, {
      config,
      opts,
      ctx,
      heuristicRanks,
      onProgress: (s, done, total) => stage(s, { done, total }),
    });
    promos = out.promos;
    trace = out.trace;
    timings.llm_stages = ms(t);
  }

  const shortlisted = new Set(promos.map((p) => p.id));
  const runnersUp = survivors
    .filter((c: Candidate) => !shortlisted.has(c.id))
    .slice(0, RUNNERS_UP)
    .map((c, i) => toPromo(c, promos.length + i + 1, heuristicRanks.get(c.id)!, ctx.episodes));

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
      counts: {
        files: files.length,
        episodes: episodes.length,
        entries: report.totals.entries,
        single_candidates: singles.length,
        multi_candidates: multi.length,
        after_nms: survivors.length,
        promos: promos.length,
      },
      diversity: plain.events,
      llm: llmLog(trace),
      determinism_note:
        'No random numbers and no clock in the heuristic ranking. With provider none, the same input and config give an identical promos.json. Model output can vary even at temperature 0, so AI runs are not guaranteed to repeat.',
    },
  };
}
