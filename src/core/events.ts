import { z } from 'zod';

/**
 * Progress events from the engine. The web worker forwards them with postMessage and the CLI
 * prints them, so both show the same live view. Payloads carry IDs, counts, file names and short
 * labels only: never screenplay text and never an API key.
 */

import { STAGES } from './stages';
export { AI_STAGES, STAGE_LABELS, STAGES, type StageName } from './stages';
import type { StageName } from './stages';
export const StageNameSchema = z.enum(STAGES);

export const PromoSummary = z.object({
  id: z.string(),
  rank: z.number().int().positive(),
  /** e.g. "Ep 3 00:12.00–00:48.50": positions only, no text. */
  where: z.string(),
  duration_s: z.number(),
  score: z.number(),
  heuristic_score: z.number(),
  ai_score: z.number().optional(),
});
export type PromoSummary = z.infer<typeof PromoSummary>;

const Warning = z.object({ line: z.number().int(), reason: z.string() });

export const LlmStep = z.enum(['judge', 'refine', 'writeup']);
export const LlmStatus = z.enum(['started', 'ok', 'retry', 'rejected', 'fallback']);

export const ProgressEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file_received'), name: z.string(), bytes: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('file_parsed'),
    name: z.string(),
    episode: z.number().int(),
    scenes: z.number().int(),
    entries: z.number().int(),
    duration_s: z.number(),
    warnings: z.array(Warning),
  }),
  z.object({ type: z.literal('file_failed'), name: z.string(), reason: z.string() }),
  z.object({ type: z.literal('stage_started'), stage: StageNameSchema, total: z.number().int().optional() }),
  z.object({ type: z.literal('stage_progress'), stage: StageNameSchema, done: z.number().int(), total: z.number().int() }),
  z.object({ type: z.literal('stage_done'), stage: StageNameSchema, ms: z.number(), summary: z.string() }),
  z.object({ type: z.literal('stage_skipped'), stage: StageNameSchema, reason: z.string() }),
  z.object({ type: z.literal('candidates_update'), generated: z.number().int(), kept_after_nms: z.number().int().optional(), shortlisted: z.number().int().optional() }),
  z.object({ type: z.literal('partial_ranking'), top: z.array(PromoSummary), final: z.boolean().optional() }),
  z.object({
    type: z.literal('llm_call'),
    step: LlmStep,
    batch: z.number().int(),
    status: LlmStatus,
    tokens: z.number().optional(),
    ms: z.number().optional(),
    /** A count or an error kind, e.g. "3 items rejected" or "rate_limit". Never provider text. */
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal('run_done'), ms: z.number(), counts: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal('run_error'), stage: StageNameSchema, message: z.string() }),
]);
export type ProgressEvent = z.infer<typeof ProgressEvent>;
export type Emit = (e: ProgressEvent) => void;

/** Events that are never coalesced or delayed. */
export function isCritical(e: ProgressEvent): boolean {
  if (e.type === 'llm_call') return e.status === 'rejected' || e.status === 'fallback';
  return e.type === 'file_failed' || e.type === 'stage_done' || e.type === 'run_error' || e.type === 'run_done';
}

/** Only these replace an older pending event of the same key; everything else is kept in order. */
function coalesceKey(e: ProgressEvent): string | null {
  if (e.type === 'stage_progress') return `progress:${e.stage}`;
  if (e.type === 'candidates_update') return 'candidates';
  if (e.type === 'partial_ranking') return 'ranking';
  return null;
}

/**
 * Groups events into batches of at most one every `intervalMs` (about 10 a second). Superseded
 * progress, candidate counts and rankings are dropped; no other event is. A critical event
 * flushes at once, after everything queued before it, so order is kept. The clock is checked on
 * every push, which works inside synchronous engine code, and a timer flushes whatever is left
 * while the engine waits (for example on a model call), so nothing sits unsent.
 */
export function createBatcher(
  send: (batch: ProgressEvent[]) => void,
  intervalMs = 100,
  now: () => number = () => Date.now(),
  timer: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } | null = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
) {
  let queue: ProgressEvent[] = [];
  let last = -Infinity;
  let pending: unknown = null;
  const flush = () => {
    if (pending !== null) {
      timer?.clear(pending);
      pending = null;
    }
    if (queue.length === 0) return;
    const out = queue;
    queue = [];
    last = now();
    send(out);
  };
  const push = (e: ProgressEvent) => {
    const key = coalesceKey(e);
    if (key) {
      const i = queue.findIndex((q) => coalesceKey(q) === key);
      if (i >= 0) queue.splice(i, 1);
    }
    queue.push(e);
    if (isCritical(e) || now() - last >= intervalMs) flush();
    else if (pending === null && timer) pending = timer.set(flush, Math.max(0, intervalMs - (now() - last)));
  };
  return { push, flush };
}

/** Checks a stream: stages in the fixed order, each started stage ends in stage_done or run_error. */
export function checkOrder(events: ProgressEvent[]): string[] {
  const problems: string[] = [];
  let lastIndex = -1;
  const open = new Set<StageName>();
  for (const e of events) {
    if (e.type === 'stage_started' || e.type === 'stage_skipped') {
      const i = STAGES.indexOf(e.stage);
      if (i <= lastIndex) problems.push(`${e.stage} began after ${STAGES[lastIndex]}`);
      lastIndex = Math.max(lastIndex, i);
      if (e.type === 'stage_started') open.add(e.stage);
    } else if (e.type === 'stage_done') {
      if (!open.delete(e.stage)) problems.push(`${e.stage} finished without starting`);
    } else if (e.type === 'stage_progress' && !open.has(e.stage)) {
      problems.push(`progress for ${e.stage} outside the stage`);
    } else if (e.type === 'run_error') {
      open.delete(e.stage);
    }
  }
  for (const s of open) problems.push(`${s} never finished`);
  return problems;
}
