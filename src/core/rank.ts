import type { Candidate, Cue, DiversityEvent, Entry, Episode, Promo, PromoSegment, QuotedMoment, Segment } from './schema';
import { formatTimestamp } from './parse';
import { overlapsTooMuch } from './segment';
import { quoteOf } from './score';

const EPS = 0.005;

/** Two promos on the same opening or the same ending would read as one promo posted twice. */
function sharesEdge(a: Segment[], b: Segment[]): boolean {
  const [af, bf] = [a[0], b[0]];
  const [al, bl] = [a[a.length - 1], b[b.length - 1]];
  return (af.episode === bf.episode && af.start === bf.start) || (al.episode === bl.episode && al.end === bl.end);
}

/** Greedy NMS over a list already sorted best first. Returns the IDs that survive. */
export function nonMaxSuppression<T extends { id: string; segments: Segment[] }>(sorted: T[]): T[] {
  const kept: T[] = [];
  const byEpisode = new Map<number, T[]>();
  for (const c of sorted) {
    const eps = [...new Set(c.segments.map((s) => s.episode))];
    const clash = eps.some((e) =>
      (byEpisode.get(e) ?? []).some((k) => overlapsTooMuch(c.segments, k.segments) || sharesEdge(c.segments, k.segments)),
    );
    if (clash) continue;
    kept.push(c);
    for (const e of eps) byEpisode.set(e, [...(byEpisode.get(e) ?? []), c]);
  }
  return kept;
}

/** Picks the top N, holding each episode to `maxPerEpisode`. Records every swap the cap caused. */
export function applyDiversity<T extends { id: string; segments: Segment[]; scores: { total: number } }>(
  sorted: T[],
  top: number,
  maxPerEpisode: number | null,
): { chosen: T[]; events: DiversityEvent[] } {
  const chosen: T[] = [];
  const events: DiversityEvent[] = [];
  const counts = new Map<number, number>();
  for (const c of sorted) {
    if (chosen.length >= top) break;
    const eps = [...new Set(c.segments.map((s) => s.episode))];
    const blocked = maxPerEpisode !== null ? eps.find((e) => (counts.get(e) ?? 0) >= maxPerEpisode) : undefined;
    if (blocked !== undefined) {
      events.push({
        skipped_id: c.id,
        skipped_score: c.scores.total,
        episode: blocked,
        note: `Skipped: episode ${blocked} already has ${maxPerEpisode} promos in the top ${top}.`,
      });
      continue;
    }
    chosen.push(c);
    for (const e of eps) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return { chosen, events };
}

function moment(cue: Cue): QuotedMoment {
  return { text: cue.text, timestamp: cue.timestamp, episode: cue.episode, source_type: cue.source_type };
}

function entryMoment(e: Entry, episode: number): QuotedMoment {
  return { text: e.text, timestamp: e.start, episode, source_type: e.type };
}

const strongest = (cues: Cue[]) =>
  [...cues].sort((a, b) => b.weight - a.weight || a.timestamp - b.timestamp || a.text.localeCompare(b.text))[0];

const short = (t: string, n = 80) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)));

const withArticle = (s: string) => `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}`;

const STRONG_TYPES = new Set(['DIALOGUE', 'SFX', 'ACTION']);

/** Prefers a cue the viewer hears or sees as an event over a framing note. */
function pick(cues: Cue[]): Cue | undefined {
  const positive = cues.filter((c) => c.weight > 0);
  return strongest(positive.filter((c) => STRONG_TYPES.has(c.source_type))) ?? strongest(positive);
}

/** One line, built only from matched cues, quoting only source text. */
export function explain(c: Candidate): string {
  const hook = pick(c.cues.filter((x) => x.feature === 'hook'));
  const cliff = pick(c.cues.filter((x) => x.feature === 'cliffhanger'));
  const open = hook
    ? `Opens on ${withArticle(hook.group)} (${hook.source_type} ${formatTimestamp(hook.timestamp)}, Ep ${hook.episode}): "${short(quoteOf(hook))}"`
    : 'No hook cue in the first 3 seconds';
  const close = cliff
    ? `ends on ${withArticle(cliff.group)} (${cliff.source_type} ${formatTimestamp(cliff.timestamp)}): "${short(quoteOf(cliff))}"`
    : 'no cliffhanger cue at the end';
  const join = c.segments.length > 1 ? ` Stitches ${c.segments.length} moments.` : '';
  return `${open}; ${close}.${join}`;
}

function promoSegment(ep: Episode, s: Segment): PromoSegment {
  const inside = ep.entries.filter((e) => e.start >= s.start - EPS && e.end <= s.end + EPS);
  const sceneNums = [...new Set(inside.map((e) => e.scene))];
  return {
    ...s,
    scene_ids: sceneNums,
    scene_headings: sceneNums.map((n) => ep.scenes.find((x) => x.number === n)?.heading ?? ''),
    text: inside
      .map((e) => `[${formatTimestamp(e.start)}] ${e.type === 'DIALOGUE' ? `${e.speaker}: ` : `${e.type}: `}${e.text}`)
      .join('\n'),
  };
}

export function toPromo(c: Candidate, rank: number, heuristicRank: number, episodes: Map<number, Episode>): Promo {
  const segments = c.segments.map((s) => promoSegment(episodes.get(s.episode)!, s));
  const hookCue = pick(c.cues.filter((x) => x.feature === 'hook'));
  const cliffCue = pick(c.cues.filter((x) => x.feature === 'cliffhanger'));
  const first = c.segments[0];
  const last = c.segments[c.segments.length - 1];
  const firstEp = episodes.get(first.episode)!;
  const lastEp = episodes.get(last.episode)!;
  const openEntry =
    firstEp.entries.find((e) => e.type !== 'CAMERA' && e.start >= first.start - EPS) ?? firstEp.entries[0];
  const closeEntry = [...lastEp.entries].reverse().find((e) => e.type !== 'CAMERA' && e.end <= last.end + EPS) ?? lastEp.entries[0];
  return {
    id: c.id,
    rank,
    heuristic_rank: heuristicRank,
    episodes: [...new Set(c.segments.map((s) => s.episode))],
    segments,
    total_duration_s: c.total_duration_s,
    hook: hookCue ? moment(hookCue) : entryMoment(openEntry, first.episode),
    cliffhanger: cliffCue ? moment(cliffCue) : entryMoment(closeEntry, last.episode),
    why: explain(c),
    scores: c.scores,
    judge: { source: 'heuristic' },
    flags: c.flags,
    cues: c.cues,
  };
}
