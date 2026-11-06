import type { CandidateSummary, Judgement } from '../schema';

/** The default adapter: keeps the heuristic order. Needs no key and no network. */
export function noneRerank(candidates: CandidateSummary[]): Judgement[] {
  return candidates.map((c, i) => ({ id: c.id, rank: i + 1, source: 'heuristic' as const }));
}
