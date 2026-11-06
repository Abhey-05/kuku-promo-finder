import type { Candidate, Config, InputFile, LlmOptions, Promo, RunResult } from './schema';
import { parseAll } from './parse';
import { byScore, generateCandidates } from './score';
import { applyDiversity, nonMaxSuppression, toPromo } from './rank';
import { rerank } from './llm/interface';
import { summarise } from './llm/prompt';
import { RERANK_POOL, RUNNERS_UP } from './config';

export type Stage = 'parse' | 'segment' | 'score' | 'judge' | 'finalize';
export const STAGES: Stage[] = ['parse', 'segment', 'score', 'judge', 'finalize'];

export interface RunHooks {
  onStage?: (stage: Stage) => void;
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
  const stage = (s: Stage) => {
    hooks.checkpoint?.();
    hooks.onStage?.(s);
    return now();
  };

  let t = stage('parse');
  const { episodes, report } = parseAll(files);
  timings.parse = ms(t);
  if (episodes.length === 0) throw new Error('No readable episodes found in the input.');

  t = stage('segment');
  const { singles, multi, ctx } = generateCandidates(episodes, config.weights);
  timings.segment_and_features = ms(t);

  t = stage('score');
  const all = [...singles, ...multi].sort(byScore);
  const survivors = nonMaxSuppression(all);
  const keptIds = new Set(survivors.map((c) => c.id));
  const pooled = applyDiversity(survivors, Math.max(RERANK_POOL, config.top), config.maxPerEpisode).chosen;
  const heuristicRanks = new Map<string, number>(survivors.map((c, i) => [c.id, i + 1]));
  timings.rank = ms(t);

  t = stage('judge');
  const llmOpts: LlmOptions = { ...llm, provider: config.provider };
  const summaries = pooled.map((c) => summarise(c, ctx.episodes));
  const { judgements, log: llmLog } = await rerank(summaries, { ...llmOpts, topN: config.top });
  timings.judge = ms(t);

  t = stage('finalize');
  const byId = new Map<string, Candidate>(pooled.map((c) => [c.id, c]));
  const reordered = judgements.map((j) => byId.get(j.id)!).filter(Boolean);
  const rest = pooled.filter((c) => !judgements.some((j) => j.id === c.id));
  const { chosen } = applyDiversity([...reordered, ...rest], config.top, config.maxPerEpisode);
  const judgeById = new Map(judgements.map((j) => [j.id, j]));

  const promos: Promo[] = chosen.map((c, i) => {
    const promo = toPromo(c, i + 1, heuristicRanks.get(c.id)!, ctx.episodes);
    const j = judgeById.get(c.id);
    if (j?.source === 'llm') promo.judge = { source: 'llm', reason: j.reason };
    return promo;
  });
  const plain = applyDiversity(survivors, config.top, config.maxPerEpisode);
  const heuristicPromos = plain.chosen.map((c, i) => toPromo(c, i + 1, heuristicRanks.get(c.id)!, ctx.episodes));
  const shortlisted = new Set(promos.map((p) => p.id));
  const runnersUp = survivors
    .filter((c) => !shortlisted.has(c.id))
    .slice(0, RUNNERS_UP)
    .map((c, i) => toPromo(c, promos.length + i + 1, heuristicRanks.get(c.id)!, ctx.episodes));
  timings.finalize = ms(t);

  return {
    episodes,
    parseReport: report,
    candidates: all.map((c) => ({ ...c, kept: keptIds.has(c.id) })),
    promos,
    heuristicPromos,
    runnersUp,
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
      llm: llmLog,
      determinism_note:
        'No random numbers and no clock in the ranking. With provider none, the same input and config give an identical promos.json. Only timings in this log change.',
    },
  };
}
