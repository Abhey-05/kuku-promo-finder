import type { Candidate, Cue, Episode, Segment, Weights } from './schema';
import { cliffScore, durationFit, hookScore, showNames, spoken, standaloneScore, type StandaloneContext } from './features';
import {
  MAX_PROMO_S,
  MIN_PROMO_S,
  MIN_SEGMENT_S,
  candidateId,
  headSlices,
  segmentDuration,
  segmentsInOrder,
  singleWindows,
  spokenWithin,
  tailSlices,
  totalDuration,
} from './segment';

export const TOP_SINGLES_FOR_JOINS = 200;
const MOMENTS_PER_ROLE = 60;
const MAX_EPISODE_GAP = 3;
const LATE_STORY_FRACTION = 0.5;

/** Hook and cliffhanger depend only on one point in time, so each is computed once. */
class ScoreCache {
  private hooks = new Map<string, ReturnType<typeof hookScore>>();
  private cliffs = new Map<string, ReturnType<typeof cliffScore>>();
  constructor(private readonly byNumber: Map<number, Episode>) {}
  hook(s: Segment) {
    const k = `${s.episode}:${s.start}`;
    let v = this.hooks.get(k);
    if (!v) this.hooks.set(k, (v = hookScore(this.byNumber.get(s.episode)!, s.start)));
    return v;
  }
  cliff(s: Segment) {
    const k = `${s.episode}:${s.end}`;
    let v = this.cliffs.get(k);
    if (!v) this.cliffs.set(k, (v = cliffScore(this.byNumber.get(s.episode)!, s.end)));
    return v;
  }
}

export function totalScore(s: Omit<Candidate['scores'], 'total'>, w: Weights): number {
  const raw = w.hook * s.hook + w.cliffhanger * s.cliffhanger + w.standalone * s.standalone + w.duration * s.duration - s.join_penalty;
  return Math.round(raw * 10000) / 10000;
}

function buildFlags(segments: Segment[], scores: Candidate['scores'], cues: Cue[], ctx: StandaloneContext): string[] {
  const flags: string[] = [];
  if (scores.hook === 0) flags.push('no-hook-cue');
  if (scores.cliffhanger === 0) flags.push('no-cliffhanger-cue');
  if (segments.length > 1) flags.push('stitched');
  if (new Set(segments.map((s) => s.episode)).size > 1) flags.push('cross-episode');
  if (cues.some((c) => c.group === 'pronoun opener')) flags.push('pronoun-opener');
  if (cues.some((c) => c.group === 'speaker not introduced')) flags.push('speaker-not-introduced');
  if (segments[0].episode / ctx.lastEpisode > LATE_STORY_FRACTION) flags.push('late-story-spoiler-risk');
  const last = segments[segments.length - 1];
  if (Math.abs(last.end - ctx.episodes.get(last.episode)!.duration) < 1.5) flags.push('ends-at-episode-end');
  const first = segments[0];
  const ep = ctx.episodes.get(first.episode)!;
  const scenes = new Set(
    ep.entries.filter((e) => e.start >= first.start && e.end <= first.end).map((e) => e.scene),
  );
  if (scenes.size > 1) flags.push('crosses-scene');
  return flags;
}

function score(segments: Segment[], cache: ScoreCache, ctx: StandaloneContext, weights: Weights): Candidate {
  const hook = cache.hook(segments[0]);
  const cliff = cache.cliff(segments[segments.length - 1]);
  const standalone = standaloneScore(segments, ctx);
  const total_duration_s = totalDuration(segments);
  const base = {
    hook: hook.score,
    cliffhanger: cliff.score,
    standalone: standalone.score,
    duration: durationFit(total_duration_s),
    join_penalty: Math.round(weights.joinPenalty * (segments.length - 1) * 1000) / 1000,
  };
  const scores = { ...base, total: totalScore(base, weights) };
  const cues = [...hook.cues, ...cliff.cues, ...standalone.cues];
  return { id: candidateId(segments), segments, total_duration_s, scores, cues, flags: buildFlags(segments, scores, cues, ctx) };
}

export function byScore(a: Candidate, b: Candidate): number {
  return b.scores.total - a.scores.total || a.id.localeCompare(b.id);
}

/** A stitched promo must follow one person, or it reads as two unrelated clips. */
function shareSpeaker(a: Segment, b: Segment, byNumber: Map<number, Episode>): boolean {
  const left = new Set(spokenWithin(byNumber.get(a.episode)!, a).map((e) => e.speaker));
  return spokenWithin(byNumber.get(b.episode)!, b).some((e) => left.has(e.speaker));
}

/**
 * Joins the best openings to the best endings. Search is capped: moments come only from the
 * top single windows, so runtime stays flat as the pack grows.
 */
function stitched(singles: Candidate[], cache: ScoreCache, ctx: StandaloneContext, weights: Weights): Candidate[] {
  const top = singles.slice(0, TOP_SINGLES_FOR_JOINS);
  const dedupe = (segs: Segment[], rank: (s: Segment) => number) => {
    const seen = new Map<string, Segment>();
    for (const s of segs) seen.set(`${s.episode}:${s.start}:${s.end}`, s);
    return [...seen.values()]
      .sort((a, b) => rank(b) - rank(a) || candidateId([a]).localeCompare(candidateId([b])))
      .slice(0, MOMENTS_PER_ROLE);
  };
  const heads = dedupe(
    top.flatMap((c) => headSlices(ctx.episodes.get(c.segments[0].episode)!, c.segments[0])),
    (s) => cache.hook(s).score,
  );
  const tails = dedupe(
    top.flatMap((c) => tailSlices(ctx.episodes.get(c.segments[0].episode)!, c.segments[0])),
    (s) => cache.cliff(s).score,
  );

  const valid = (segs: Segment[]) => {
    const d = totalDuration(segs);
    return (
      d >= MIN_PROMO_S &&
      d <= MAX_PROMO_S &&
      segs.every((s) => segmentDuration(s) >= MIN_SEGMENT_S) &&
      segmentsInOrder(segs) &&
      segs.every((s, i) => i === 0 || s.episode - segs[i - 1].episode <= MAX_EPISODE_GAP)
    );
  };

  const out = new Map<string, Candidate>();
  const pairs: [Segment, Segment][] = [];
  for (const h of heads) {
    for (const t of tails) {
      const adjacent = h.episode === t.episode && Math.abs(t.start - h.end) < 1;
      if (!adjacent && valid([h, t]) && shareSpeaker(h, t, ctx.episodes)) pairs.push([h, t]);
    }
  }
  for (const [h, t] of pairs) {
    const c = score([h, t], cache, ctx, weights);
    out.set(c.id, c);
  }
  // Three moments: put the strongest opening between a pair, for the 40 best pairs only.
  const bestPairs = [...out.values()].sort(byScore).slice(0, 40);
  for (const p of bestPairs) {
    const [h, t] = p.segments;
    for (const mid of heads) {
      const segs = [h, mid, t];
      if (valid(segs) && shareSpeaker(h, mid, ctx.episodes)) {
        const c = score(segs, cache, ctx, weights);
        out.set(c.id, c);
      }
    }
  }
  return [...out.values()];
}

/** Progress hooks for the live view. They observe only; the result is the same with or without them. */
export interface GenerateHooks {
  /** After each episode's cut points are found. */
  onSegment?: (done: number, total: number, windows: number) => void;
  onSegmentDone?: (windows: number) => void;
  /** After each episode's windows are scored, with the best so far. */
  onScore?: (done: number, total: number, generated: number, best: Candidate[]) => void;
}

// Kept large enough that ten remain after overlap removal in the live view.
const TOP_LIVE = 60;

function mergeBest(best: Candidate[], more: Candidate[]): Candidate[] {
  return [...best, ...[...more].sort(byScore).slice(0, TOP_LIVE)].sort(byScore).slice(0, TOP_LIVE);
}

export function generateCandidates(
  episodes: Episode[],
  weights: Weights,
  hooks: GenerateHooks = {},
): { singles: Candidate[]; multi: Candidate[]; ctx: StandaloneContext } {
  const byNumber = new Map(episodes.map((e) => [e.number, e]));
  const ctx: StandaloneContext = {
    names: showNames(episodes),
    lastEpisode: Math.max(...episodes.map((e) => e.number), 1),
    episodes: byNumber,
  };
  const cache = new ScoreCache(byNumber);
  // Segment: the cut points of every episode.
  let windowCount = 0;
  const windows = episodes.map((ep, i) => {
    const w = singleWindows(ep);
    windowCount += w.length;
    hooks.onSegment?.(i + 1, episodes.length, windowCount);
    return w;
  });
  hooks.onSegmentDone?.(windowCount);
  // Score: one episode at a time, so the best-so-far list can be shown while it runs.
  const singles: Candidate[] = [];
  let best: Candidate[] = [];
  windows.forEach((ws, i) => {
    const scored = ws.map((s) => score([s], cache, ctx, weights));
    singles.push(...scored);
    if (hooks.onScore) {
      best = mergeBest(best, scored);
      hooks.onScore(i + 1, windows.length + 1, singles.length, best);
    }
  });
  singles.sort(byScore);
  const multi = stitched(singles, cache, ctx, weights).sort(byScore);
  if (hooks.onScore) hooks.onScore(windows.length + 1, windows.length + 1, singles.length + multi.length, mergeBest(best, multi));
  return { singles, multi, ctx };
}

/** Scores any cut the same way the generator does. Used to rescore a cut the model tightened. */
export function scoreSegments(segments: Segment[], ctx: StandaloneContext, weights: Weights): Candidate {
  return score(segments, new ScoreCache(ctx.episodes), ctx, weights);
}

/** Verbatim, single-line form of a line, for quoting in prose. */
export function quoteOf(cue: Cue): string {
  const firstLine = cue.text.split('\n')[0];
  return cue.source_type === 'DIALOGUE' ? firstLine.replace(/^["“\s]+|["”\s]+$/g, '') : firstLine;
}

export { spoken };
