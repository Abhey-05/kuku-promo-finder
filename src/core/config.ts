import defaults from '../../weights.default.json';
import type { Config, Weights } from './schema';

export const DEFAULT_WEIGHTS: Weights = defaults;

/** Top 10 hold at most 2 promos from one episode unless the user turns the cap off. */
export const DEFAULT_CONFIG: Config = {
  weights: DEFAULT_WEIGHTS,
  top: 10,
  maxPerEpisode: 2,
  provider: 'none',
  label: 'run',
};

/** How many survivors of NMS go to the model. Keeps cost flat per show. */
export const RERANK_POOL = 30;

/** Survivors shown after the shortlist in the web app. */
export const RUNNERS_UP = 40;
