import { z } from 'zod';

export type EntryType = 'CAMERA' | 'ACTION' | 'SFX' | 'DIALOGUE';

export interface Entry {
  idx: number;
  type: EntryType;
  /** Raw bold label, e.g. "SOUND FX" or "MAID (Quiet)". */
  label: string;
  speaker?: string;
  parenthetical?: string;
  start: number;
  end: number;
  /** Verbatim source text (lines joined by \n). Dialogue keeps its quote marks. */
  text: string;
  scene: number;
  line: number;
}

export interface Scene {
  number: number;
  heading: string;
  start: number;
  end: number;
}

export interface Episode {
  number: number;
  file: string;
  logline: string;
  continuity: string;
  scenes: Scene[];
  entries: Entry[];
  duration: number;
  /** Full source text, kept so every quote can be checked against it. */
  source: string;
}

export interface ParseIssue {
  line: number;
  text: string;
  reason: string;
}

export interface EpisodeReport {
  file: string;
  episode: number;
  scene_count: number;
  entry_count: number;
  by_type: Record<EntryType, number>;
  duration_s: number;
  total_lines: number;
  unparsed: ParseIssue[];
  violations: ParseIssue[];
}

export interface ParseReport {
  episodes: EpisodeReport[];
  totals: {
    files: number;
    episodes_parsed: number;
    scenes: number;
    entries: number;
    duration_s: number;
    unparsed_lines: number;
    violations: number;
  };
}

export type CueFeature = 'hook' | 'cliffhanger' | 'standalone';

export interface Cue {
  feature: CueFeature;
  group: string;
  /** The word or phrase that matched. A verbatim substring of `text`, unless `derived`. */
  match: string;
  /** True when the cue is a count or a label, not words found in `text`. */
  derived?: boolean;
  /** Verbatim text of the entry the cue came from. */
  text: string;
  /** Effect on the score: positive weight, negative for a penalty. */
  weight: number;
  episode: number;
  timestamp: number;
  source_type: EntryType;
}

export interface Segment {
  episode: number;
  start: number;
  end: number;
}

export interface Features {
  hook: number;
  cliffhanger: number;
  standalone: number;
  duration: number;
  join_penalty: number;
  total: number;
}

export interface Candidate {
  id: string;
  segments: Segment[];
  total_duration_s: number;
  scores: Features;
  cues: Cue[];
  flags: string[];
}

export interface Weights {
  hook: number;
  cliffhanger: number;
  standalone: number;
  duration: number;
  joinPenalty: number;
}

export interface Config {
  weights: Weights;
  top: number;
  maxPerEpisode: number | null;
  provider: ProviderName;
  label: string;
}

export type ProviderName = 'none' | 'gemini' | 'openai-compatible';

export interface LlmOptions {
  provider: ProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface QuotedMoment {
  text: string;
  timestamp: number;
  episode: number;
  source_type: EntryType;
}

export interface PromoSegment extends Segment {
  scene_ids: number[];
  scene_headings: string[];
  text: string;
}

export interface Promo {
  id: string;
  rank: number;
  heuristic_rank: number;
  episodes: number[];
  segments: PromoSegment[];
  total_duration_s: number;
  hook: QuotedMoment;
  cliffhanger: QuotedMoment;
  why: string;
  scores: Features;
  judge: { source: 'heuristic' | 'llm'; reason?: string };
  flags: string[];
  cues: Cue[];
}

export interface DiversityEvent {
  skipped_id: string;
  skipped_score: number;
  episode: number;
  note: string;
}

/** What the model sees for one candidate. Lines are verbatim, with timestamps. */
export interface CandidateSummary {
  id: string;
  lines: string[];
  features: { hook: number; cliffhanger: number; standalone: number; duration: number; total: number };
  cues: string[];
}

export const JudgementSchema = z.object({
  id: z.string(),
  hook: z.number().min(1).max(5),
  cliffhanger: z.number().min(1).max(5),
  standalone: z.number().min(1).max(5),
});

export const LlmResponseSchema = z.object({
  ratings: z.array(JudgementSchema),
  top: z
    .array(z.object({ id: z.string(), reason: z.string(), quote: z.string().optional() }))
    .min(1),
});

export type LlmResponse = z.infer<typeof LlmResponseSchema>;

export interface Judgement {
  id: string;
  rank: number;
  source: 'heuristic' | 'llm';
  reason?: string;
  ratings?: { hook: number; cliffhanger: number; standalone: number };
}

export interface LlmLog {
  provider: ProviderName;
  model: string | null;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  failures: number;
  fallback_used: boolean;
  notes: string[];
}

export interface RunLog {
  label: string;
  config: Config;
  timings_ms: Record<string, number>;
  counts: {
    files: number;
    episodes: number;
    entries: number;
    single_candidates: number;
    multi_candidates: number;
    after_nms: number;
    promos: number;
  };
  diversity: DiversityEvent[];
  llm: LlmLog;
  determinism_note: string;
}

export interface RunResult {
  episodes: Episode[];
  parseReport: ParseReport;
  /** Every scored candidate, best first. `kept` is true when it survived NMS. */
  candidates: (Candidate & { kept: boolean })[];
  promos: Promo[];
  /** Best promos in plain heuristic order, for the order toggle in the UI. */
  heuristicPromos: Promo[];
  log: RunLog;
}

export interface InputFile {
  name: string;
  text: string;
}
