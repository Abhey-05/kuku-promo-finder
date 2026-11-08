import defaults from '../../weights.default.json';
import type { AgentSettings, Config, Weights } from './schema';

export const DEFAULT_WEIGHTS: Weights = defaults;

/** Top 10 hold at most 2 promos from one episode unless the user turns the cap off. */
export const DEFAULT_AGENT: AgentSettings = {
  alpha: 0.6,
  maxCandidates: 30,
  refineTop: 15,
  batchSize: 10,
  // 3 judge batches, refine and write-up, each with one retry, is 10. The rest is headroom.
  callCap: 14,
};

export const DEFAULT_CONFIG: Config = {
  weights: DEFAULT_WEIGHTS,
  top: 10,
  maxPerEpisode: 2,
  provider: 'none',
  agent: DEFAULT_AGENT,
  label: 'run',
};

/** Survivors kept in the pool before the shortlist. The agent's maxCandidates takes from the top of it. */
export const RERANK_POOL = 30;

/** Survivors shown after the shortlist in the web app. */
export const RUNNERS_UP = 40;
