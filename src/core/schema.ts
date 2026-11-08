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

/** Settings of the LLM stages. Ignored when the provider is none. */
export interface AgentSettings {
  /** Weight of the model's score in the final rank: final = alpha * llm + (1 - alpha) * heuristic. */
  alpha: number;
  /** How many heuristic survivors go to the judge. */
  maxCandidates: number;
  /** How many of the best judged candidates the model may re-cut. */
  refineTop: number;
  /** Candidates per judge call. */
  batchSize: number;
  /** Hard limit on model calls in one run, retries included. */
  callCap: number;
}

export interface Config {
  weights: Weights;
  top: number;
  maxPerEpisode: number | null;
  provider: ProviderName;
  agent: AgentSettings;
  label: string;
}

export type ProviderName = 'none' | 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';

export interface LlmOptions {
  provider: ProviderName;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
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
  /** The heuristic total, kept next to the blended score for comparison. */
  heuristic_score: number;
  /** The model's ratings, when the judge stage accepted them. */
  ai?: { hook: number; cliffhanger: number; standalone: number; score: number; reason: string };
  /** alpha * ai.score + (1 - alpha) * heuristic_score, or the heuristic score in heuristic mode. */
  final_score: number;
  /** The heuristic cut, when the refine stage moved the boundaries. */
  refined_from?: Segment[];
  flags: string[];
  cues: Cue[];
}

export interface DiversityEvent {
  skipped_id: string;
  skipped_score: number;
  episode: number;
  note: string;
}

export type TraceStageName = 'shortlist' | 'judge' | 'refine' | 'writeup' | 'verify' | 'rank';

export interface TraceRejection {
  /** Candidate or promo ID, when the problem is tied to one. */
  item?: string;
  reason: string;
  /** 1 for the first reply, 2 for the retry. */
  attempt: number;
}

export interface TraceStage {
  stage: TraceStageName;
  model: string | null;
  items_in: number;
  items_out: number;
  calls: number;
  retries: number;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  rejected: TraceRejection[];
  /** IDs that kept the heuristic result because the model's output failed twice. */
  fallbacks: string[];
  notes: string[];
}

/** Every LLM stage of one run. Never holds the API key. */
export interface AgentTrace {
  mode: 'heuristic' | 'ai';
  provider: ProviderName;
  model: string | null;
  base_url: string | null;
  temperature: number;
  alpha: number;
  call_cap: number;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Null when the model has no price in the table. */
  estimated_cost_usd: number | null;
  stages: TraceStage[];
}

/** Short form of the trace for the run log and the CLI. */
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
  /** The next survivors after the top N, so an editor can label beyond the shortlist. */
  runnersUp: Promo[];
  trace: AgentTrace;
  log: RunLog;
}

/** What the web worker sends back. Leaves out the 25k candidates; they stay in the zip. */
export type RunView = Pick<RunResult, 'parseReport' | 'promos' | 'heuristicPromos' | 'runnersUp' | 'trace' | 'log'>;

export interface InputFile {
  name: string;
  text: string;
}
