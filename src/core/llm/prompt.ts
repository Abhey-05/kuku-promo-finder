import type { Candidate, CandidateSummary, Episode } from '../schema';
import { formatTimestamp } from '../parse';

const EPS = 0.005;

/** Verbatim lines of a candidate, for the model and for checking its quotes. */
export function candidateLines(c: Candidate, episodes: Map<number, Episode>): string[] {
  return c.segments.flatMap((s) => {
    const ep = episodes.get(s.episode)!;
    return ep.entries
      .filter((e) => e.type !== 'CAMERA' && e.start >= s.start - EPS && e.end <= s.end + EPS)
      .map((e) => `Ep${s.episode} ${formatTimestamp(e.start)} ${e.type === 'DIALOGUE' ? e.speaker : e.type}: ${e.text}`);
  });
}

export function summarise(c: Candidate, episodes: Map<number, Episode>): CandidateSummary {
  const { hook, cliffhanger, standalone, duration, total } = c.scores;
  return {
    id: c.id,
    lines: candidateLines(c, episodes),
    features: { hook, cliffhanger, standalone, duration, total },
    cues: [...new Set(c.cues.filter((x) => x.weight > 0).map((x) => `${x.feature}: ${x.group}`))],
  };
}

export function buildPrompt(candidates: CandidateSummary[], topN: number): string {
  return `You pick promos for a vertical microdrama. A promo is a 20 to 60 second clip posted to social feeds to pull in new viewers.
A good promo opens on a hook in the first 3 seconds, ends on an unresolved cliffhanger, and makes sense to someone who has never seen the show.

Rate each candidate below from 1 to 5 on hook, cliffhanger and standalone. Then choose the best ${topN} candidate IDs, best first, each with a one-line reason.
Rules:
- Use only the IDs given. Do not invent IDs.
- A reason may quote only words that appear in that candidate's lines. If you quote, also put the exact quoted words in "quote".
- Judge stitched candidates (IDs containing "+") on whether the join makes the story clearer or just confuses it.

Reply with JSON only, in this shape:
{"ratings":[{"id":"...","hook":1,"cliffhanger":1,"standalone":1}],"top":[{"id":"...","reason":"...","quote":"..."}]}

Candidates:
${JSON.stringify(candidates)}`;
}
