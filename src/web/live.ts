import type { ProgressEvent, PromoSummary } from '../core/events';
import { STAGE_LABELS, STAGES, type StageName } from '../core/stages';

/** The live view's state, built only from progress events. Pure, so it can be tested without a DOM. */

export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled';
export type FileStatus = 'queued' | 'parsing' | 'parsed' | 'failed';
export type Phase = 'idle' | 'reading' | 'ready' | 'running' | 'done' | 'cancelled' | 'error';
export type Level = 'info' | 'warn' | 'error';

export interface StageRow {
  status: StageStatus;
  done?: number;
  total?: number;
  startedAt?: number;
  ms?: number;
  summary?: string;
  error?: string;
  /** Retries, rejections and fallbacks seen in this stage. */
  warnings: string[];
}

export interface FileRow {
  name: string;
  status: FileStatus;
  bytes?: number;
  episode?: number;
  scenes?: number;
  entries?: number;
  duration_s?: number;
  warnings?: { line: number; reason: string }[];
  reason?: string;
}

export interface LogEntry {
  id: number;
  /** Milliseconds since the phase started. */
  t: number;
  stage?: StageName;
  level: Level;
  text: string;
}

export interface LiveState {
  phase: Phase;
  /** Which worker job the state describes: reading the upload, or a full run. */
  job: 'read' | 'run' | null;
  zip: boolean;
  files: FileRow[];
  stages: Record<StageName, StageRow>;
  counters: { generated: number; kept: number; shortlisted: number; calls: number; tokens: number; fallbacks: number; retries: number };
  top: PromoSummary[];
  final: boolean;
  log: LogEntry[];
  startedAt: number | null;
  endedAt: number | null;
  current: StageName | null;
  /** For aria-live: changes on stage changes only, not on every counter tick. */
  announce: string;
  error: string | null;
}

export type LiveAction =
  | { type: 'start'; phase: 'reading' | 'running'; zip?: boolean; at: number; keepFiles?: boolean }
  | { type: 'events'; events: ProgressEvent[]; at: number }
  | { type: 'read_done'; at: number }
  | { type: 'cancel'; at: number }
  | { type: 'fail'; message: string; at: number }
  | { type: 'reset' };

const LOG_CAP = 1000;

const freshStages = (): Record<StageName, StageRow> => Object.fromEntries(STAGES.map((s) => [s, { status: 'pending', warnings: [] }])) as unknown as Record<StageName, StageRow>;

export const initialLive = (): LiveState => ({
  phase: 'idle',
  job: null,
  zip: false,
  files: [],
  stages: freshStages(),
  counters: { generated: 0, kept: 0, shortlisted: 0, calls: 0, tokens: 0, fallbacks: 0, retries: 0 },
  top: [],
  final: false,
  log: [],
  startedAt: null,
  endedAt: null,
  current: null,
  announce: '',
  error: null,
});

/** One short line per event for the log. IDs, counts and labels only. */
export function describe(e: ProgressEvent): { level: Level; text: string; stage?: StageName } | null {
  switch (e.type) {
    case 'file_received':
      return { level: 'info', stage: 'read', text: `received ${e.name} (${Math.round(e.bytes / 1024)} KB)` };
    case 'file_parsed':
      return { level: e.warnings.length ? 'warn' : 'info', stage: 'parse', text: `parsed ${e.name}: ep ${e.episode}, ${e.scenes} scenes, ${e.entries} entries${e.warnings.length ? `, ${e.warnings.length} warnings` : ''}` };
    case 'file_failed':
      return { level: 'error', stage: 'parse', text: `failed ${e.name}: ${e.reason}` };
    case 'stage_started':
      return { level: 'info', stage: e.stage, text: `${STAGE_LABELS[e.stage]} started${e.total ? ` (${e.total} steps)` : ''}` };
    case 'stage_done':
      return { level: 'info', stage: e.stage, text: `${STAGE_LABELS[e.stage]} done in ${Math.round(e.ms)} ms: ${e.summary}` };
    case 'stage_skipped':
      return { level: 'info', stage: e.stage, text: `${STAGE_LABELS[e.stage]} skipped` };
    case 'candidates_update':
      return { level: 'info', stage: e.kept_after_nms === undefined ? 'score' : 'shortlist', text: `${e.generated.toLocaleString('en-US')} candidates${e.kept_after_nms === undefined ? '' : `, ${e.kept_after_nms} after overlap removal`}` };
    case 'partial_ranking':
      return { level: 'info', text: `${e.final ? 'final' : 'provisional'} top ${e.top.length}${e.top[0] ? `, #1 ${e.top[0].id}` : ''}` };
    case 'llm_call': {
      const warn = e.status === 'retry' || e.status === 'rejected' || e.status === 'fallback';
      const extra = [e.tokens ? `${e.tokens.toLocaleString('en-US')} tokens` : '', e.ms ? `${(e.ms / 1000).toFixed(1)} s` : '', e.detail ?? ''].filter(Boolean).join(', ');
      return { level: warn ? 'warn' : 'info', stage: e.step, text: `${e.step} batch ${e.batch}: ${e.status}${extra ? ` (${extra})` : ''}` };
    }
    case 'run_done':
      return { level: 'info', text: `run finished in ${(e.ms / 1000).toFixed(2)} s` };
    case 'run_error':
      return { level: 'error', stage: e.stage, text: `${STAGE_LABELS[e.stage]} failed: ${e.message}` };
  }
  return null;
}

function applyEvent(s: LiveState, e: ProgressEvent, at: number): LiveState {
  const stages = s.stages;
  const row = (st: StageName, patch: Partial<StageRow>) => {
    stages[st] = { ...stages[st], ...patch };
  };
  switch (e.type) {
    case 'file_received': {
      if (!s.files.some((f) => f.name === e.name)) s.files = [...s.files, { name: e.name, status: 'queued', bytes: e.bytes }];
      break;
    }
    case 'file_parsed':
      s.files = s.files.map((f) => (f.name === e.name ? { ...f, status: 'parsed', episode: e.episode, scenes: e.scenes, entries: e.entries, duration_s: e.duration_s, warnings: e.warnings } : f));
      break;
    case 'file_failed':
      s.files = s.files.map((f) => (f.name === e.name ? { ...f, status: 'failed', reason: e.reason } : f));
      break;
    case 'stage_started':
      row(e.stage, { status: 'running', startedAt: at, total: e.total, done: e.total ? 0 : undefined, error: undefined });
      s.current = e.stage;
      s.announce = `${STAGE_LABELS[e.stage]} running`;
      if (e.stage === 'parse') s.files = s.files.map((f) => (f.status === 'queued' ? { ...f, status: 'parsing' } : f));
      break;
    case 'stage_progress':
      row(e.stage, { done: e.done, total: e.total });
      break;
    case 'stage_done':
      row(e.stage, { status: 'done', ms: e.ms, summary: e.summary, done: stages[e.stage].total ?? stages[e.stage].done });
      s.announce = `${STAGE_LABELS[e.stage]} done: ${e.summary}`;
      break;
    case 'stage_skipped':
      row(e.stage, { status: 'skipped', summary: e.reason });
      break;
    case 'candidates_update':
      s.counters = {
        ...s.counters,
        generated: e.generated,
        kept: e.kept_after_nms ?? s.counters.kept,
        shortlisted: e.shortlisted ?? s.counters.shortlisted,
      };
      break;
    case 'partial_ranking':
      s.top = e.top;
      s.final = Boolean(e.final);
      break;
    case 'llm_call': {
      const c = { ...s.counters };
      if (e.status === 'started') c.calls++;
      if (e.status === 'ok' && e.tokens) c.tokens += e.tokens;
      if (e.status === 'retry') c.retries++;
      if (e.status === 'fallback') c.fallbacks++;
      s.counters = c;
      if (e.status === 'retry' || e.status === 'rejected' || e.status === 'fallback') {
        row(e.step, { warnings: [...stages[e.step].warnings, `batch ${e.batch}: ${e.status}${e.detail ? ` (${e.detail})` : ''}`] });
      }
      break;
    }
    case 'run_done':
      s.phase = 'done';
      s.endedAt = at;
      s.current = null;
      s.announce = `Done in ${(e.ms / 1000).toFixed(1)} seconds`;
      break;
    case 'run_error':
      row(e.stage, { status: 'failed', error: e.message });
      s.phase = 'error';
      s.error = e.message;
      s.endedAt = at;
      s.announce = `${STAGE_LABELS[e.stage]} failed`;
      break;
  }
  return s;
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'reset':
      return initialLive();
    case 'start': {
      const base = initialLive();
      return {
        ...base,
        phase: action.phase,
        job: action.phase === 'reading' ? 'read' : 'run',
        zip: action.zip ?? state.zip,
        files: action.keepFiles ? state.files : [],
        startedAt: action.at,
      };
    }
    case 'events': {
      const s: LiveState = { ...state, stages: { ...state.stages } };
      const start = state.startedAt ?? action.at;
      const add: LogEntry[] = [];
      let id = state.log.length ? state.log[state.log.length - 1].id + 1 : 1;
      for (const e of action.events) {
        applyEvent(s, e, action.at);
        const d = describe(e);
        if (d) add.push({ id: id++, t: Math.max(0, action.at - start), ...d });
      }
      s.log = [...state.log, ...add].slice(-LOG_CAP);
      return s;
    }
    case 'read_done':
      return { ...state, phase: 'ready', endedAt: action.at, current: null, announce: `${state.files.filter((f) => f.status === 'parsed').length} episodes parsed` };
    case 'cancel': {
      if (state.phase !== 'running' && state.phase !== 'reading') return state;
      const stages = { ...state.stages };
      const at = state.current;
      for (const k of STAGES) if (stages[k].status === 'running') stages[k] = { ...stages[k], status: 'cancelled', ms: stages[k].startedAt ? action.at - stages[k].startedAt! : undefined };
      return {
        ...state,
        stages,
        phase: 'cancelled',
        final: false,
        endedAt: action.at,
        current: null,
        error: null,
        announce: `Cancelled${at ? ` at ${STAGE_LABELS[at]}` : ''}`,
        log: [...state.log, { id: (state.log.at(-1)?.id ?? 0) + 1, t: action.at - (state.startedAt ?? action.at), stage: at ?? undefined, level: 'warn' as Level, text: `cancelled${at ? ` at ${STAGE_LABELS[at]}` : ''}` }].slice(-LOG_CAP),
      };
    }
    case 'fail': {
      const stages = { ...state.stages };
      const at = state.current;
      if (at && stages[at].status === 'running') stages[at] = { ...stages[at], status: 'failed', error: action.message };
      return { ...state, stages, phase: 'error', error: action.message, endedAt: action.at, current: null, announce: 'The run failed' };
    }
  }
}

/** The stage a cancelled run stopped at, from the reducer's own record. */
export function cancelledAt(s: LiveState): StageName | null {
  return STAGES.find((k) => s.stages[k].status === 'cancelled') ?? null;
}

export function totals(files: FileRow[]) {
  const parsed = files.filter((f) => f.status === 'parsed');
  return {
    total: files.length,
    parsed: parsed.length,
    failed: files.filter((f) => f.status === 'failed').length,
    duration_s: parsed.reduce((n, f) => n + (f.duration_s ?? 0), 0),
    entries: parsed.reduce((n, f) => n + (f.entries ?? 0), 0),
    warnings: parsed.reduce((n, f) => n + (f.warnings?.length ?? 0), 0),
  };
}
