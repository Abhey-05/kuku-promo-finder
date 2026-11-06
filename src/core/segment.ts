import type { Entry, Episode, Segment } from './schema';
import { CONTINUATION_START } from './lexicon';
import { round2, formatTimestamp } from './parse';

export const MIN_PROMO_S = 20;
export const MAX_PROMO_S = 60;
export const MIN_SEGMENT_S = 3;
const EPS = 0.005;

/** True if t falls strictly inside a spoken line, which would clip a word. */
function insideDialogue(entries: Entry[], t: number): boolean {
  return entries.some((e) => e.type === 'DIALOGUE' && e.start < t - EPS && e.end > t + EPS);
}

/** Valid cut-in points: the start of a dialogue or action entry. */
export function candidateStarts(ep: Episode): number[] {
  const starts = ep.entries
    .filter((e) => (e.type === 'DIALOGUE' || e.type === 'ACTION') && e.end >= e.start)
    .filter((e) => !(e.type === 'DIALOGUE' && CONTINUATION_START.test(e.text)))
    .map((e) => e.start)
    .filter((t) => !insideDialogue(ep.entries, t));
  return [...new Set(starts)].sort((a, b) => a - b);
}

/** Valid cut-out points: the end of any entry, inside the episode. */
export function candidateEnds(ep: Episode): number[] {
  const ends = ep.entries
    .map((e) => e.end)
    .filter((t) => t <= ep.duration + EPS && !insideDialogue(ep.entries, t));
  return [...new Set(ends)].sort((a, b) => a - b);
}

export function singleWindows(ep: Episode): Segment[] {
  const ends = candidateEnds(ep);
  const out: Segment[] = [];
  for (const start of candidateStarts(ep)) {
    for (const end of ends) {
      const d = end - start;
      if (d >= MIN_PROMO_S - EPS && d <= MAX_PROMO_S + EPS) out.push({ episode: ep.number, start, end });
    }
  }
  return out;
}

export function segmentDuration(s: Segment): number {
  return round2(s.end - s.start);
}

export function totalDuration(segments: Segment[]): number {
  return round2(segments.reduce((n, s) => n + (s.end - s.start), 0));
}

/** Stable and readable: E03-012.50-047.30, joined by + for stitched promos. */
export function candidateId(segments: Segment[]): string {
  return segments
    .map((s) => `E${String(s.episode).padStart(2, '0')}-${s.start.toFixed(2).padStart(6, '0')}-${s.end.toFixed(2).padStart(6, '0')}`)
    .join('+');
}

export function segmentsInOrder(segments: Segment[]): boolean {
  return segments.every((s, i) => {
    const p = segments[i - 1];
    return !p || s.episode > p.episode || (s.episode === p.episode && s.start >= p.end - EPS);
  });
}

/** Seconds two promos share. */
export function overlapSeconds(a: Segment[], b: Segment[]): number {
  let n = 0;
  for (const x of a) {
    for (const y of b) {
      if (x.episode !== y.episode) continue;
      n += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
    }
  }
  return n;
}

export function overlapsTooMuch(a: Segment[], b: Segment[], limit = 0.5): boolean {
  const shorter = Math.min(totalDuration(a), totalDuration(b));
  return shorter > 0 && overlapSeconds(a, b) / shorter > limit;
}

export function spokenWithin(ep: Episode, s: Segment): Entry[] {
  return ep.entries.filter((e) => e.type === 'DIALOGUE' && e.start >= s.start - EPS && e.end <= s.end + EPS);
}

/** Opening slices of a window, for use as the first moment of a stitched promo. */
export function headSlices(ep: Episode, w: Segment): Segment[] {
  return candidateEnds(ep)
    .filter((t) => t > w.start + 8 - EPS && t <= Math.min(w.end, w.start + 20) + EPS)
    .slice(-1)
    .map((end) => ({ episode: w.episode, start: w.start, end }));
}

/** Closing slices of a window, for use as the last moment of a stitched promo. */
export function tailSlices(ep: Episode, w: Segment): Segment[] {
  return candidateStarts(ep)
    .filter((t) => t >= Math.max(w.start, w.end - 25) - EPS && t < w.end - 8 + EPS)
    .slice(0, 1)
    .map((start) => ({ episode: w.episode, start, end: w.end }));
}

export function describeSegments(segments: Segment[]): string {
  return segments.map((s) => `Ep ${s.episode} ${formatTimestamp(s.start)}–${formatTimestamp(s.end)}`).join(' + ');
}
