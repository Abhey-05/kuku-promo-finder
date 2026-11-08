/** Stage names and labels, without zod, so the UI bundle stays small. */
export const STAGES = ['read', 'parse', 'segment', 'score', 'shortlist', 'judge', 'refine', 'writeup', 'verify', 'rank'] as const;
export const AI_STAGES = ['judge', 'refine', 'writeup'] as const;
export type StageName = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageName, string> = {
  read: 'Read files',
  parse: 'Parse scripts',
  segment: 'Find cut points',
  score: 'Score candidates',
  shortlist: 'Remove overlaps',
  judge: 'AI judge',
  refine: 'AI refines cuts',
  writeup: 'AI write-up',
  verify: 'Verify outputs',
  rank: 'Final ranking',
};

