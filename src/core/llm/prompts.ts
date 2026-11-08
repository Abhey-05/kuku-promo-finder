import type { Candidate, Entry, Episode } from '../schema';
import { formatTimestamp } from '../parse';

const EPS = 0.005;

export const entryId = (episode: number, e: Entry) => `E${episode}#${e.idx}`;

/** Every entry inside a candidate's segments, in order, with its stable ID. */
export function entriesOf(c: Candidate, episodes: Map<number, Episode>): { id: string; seg: number; episode: number; e: Entry }[] {
  return c.segments.flatMap((s, seg) => {
    const ep = episodes.get(s.episode)!;
    return ep.entries
      .filter((e) => e.start >= s.start - EPS && e.end <= s.end + EPS)
      .map((e) => ({ id: entryId(s.episode, e), seg, episode: s.episode, e }));
  });
}

const who = (e: Entry) => (e.type === 'DIALOGUE' ? e.speaker : e.type);
const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ');

/** One line per entry: ID, time, speaker or type, verbatim text. */
export function lineOf(id: string, e: Entry, mark = ''): string {
  return `${id}${mark} ${formatTimestamp(e.start)}-${formatTimestamp(e.end)} ${who(e)}: ${oneLine(e.text)}`;
}

const SHOW = 'You help an editor pick promos for a vertical microdrama. A promo is a 20 to 60 second clip posted to social feeds to pull in viewers who have never seen the show.';

export const JUDGE_RUBRIC = `Rate each candidate from 1 to 5 on three things.
hook: 5 = the first 3 seconds have an event or line that stops a scroll (a slap, a scream, an accusation, a reveal). 3 = mildly interesting. 1 = calm setup, or it starts mid-conversation.
cliffhanger: 5 = it ends on an open question, threat or reveal, so the viewer needs the next moment. 3 = some tension. 1 = the moment is resolved, or it ends on a tender beat.
standalone: 5 = a stranger understands who wants what without any earlier episode. 3 = mostly clear. 1 = needs earlier episodes to make sense.
Judge only from the lines given. Clips with several segments are stitched: judge whether the join reads as one story.`;

export function judgePrompt(cands: { id: string; lines: string[] }[]): string {
  return `${SHOW}

${JUDGE_RUBRIC}

For every candidate give the three ratings and a one-line reason. A reason may quote only exact words from that candidate's lines, inside double quotes.
Reply with JSON only, in this shape:
{"ratings":[{"id":"...","hook":1,"cliffhanger":1,"standalone":1,"reason":"..."}]}

Candidates:
${cands.map((c) => `### ${c.id}\n${c.lines.join('\n')}`).join('\n\n')}`;
}

export function refinePrompt(cands: { id: string; segments: string[][] }[]): string {
  return `${SHOW}

For each candidate below you may tighten the cut, so it opens closer to its hook and ends right on its cliffhanger. Rules:
- Choose boundaries only from the entry IDs listed. A start must be an entry marked [S]. An end must be an entry marked [E].
- Keep the same number of segments. Each segment stays inside its own list, and its start comes before its end.
- The total length must be 20 to 60 seconds. Each segment must be at least 3 seconds.
- If the current cut is already best, reply with "keep": true.
Reply with JSON only, in this shape:
{"refinements":[{"id":"...","keep":true},{"id":"...","segments":[{"start":"E3#45","end":"E3#52"}]}]}

Candidates:
${cands.map((c) => `### ${c.id}\n${c.segments.map((s, i) => `Segment ${i + 1}:\n${s.join('\n')}`).join('\n')}`).join('\n\n')}`;
}

export function writeupPrompt(promos: { id: string; lines: string[] }[]): string {
  return `${SHOW}

For each promo below write three things:
- hook: the moment the viewer meets in the first 3 seconds. Give its entry ID and a quote copied exactly from that entry (part of it is fine).
- cliffhanger: the moment it ends on, in the last 5 seconds. Give its entry ID and an exact quote from that entry.
- why: one line, under 200 characters, on why a stranger would keep watching. It may quote only exact words, inside double quotes.
Never invent or change words. Copy quotes character for character.
Reply with JSON only, in this shape:
{"promos":[{"id":"...","hook":{"entry":"E3#45","quote":"..."},"cliffhanger":{"entry":"E3#60","quote":"..."},"why":"..."}]}

Promos:
${promos.map((p) => `### ${p.id}\n${p.lines.join('\n')}`).join('\n\n')}`;
}

export function retryMessage(errors: string[]): string {
  return `Your reply had these problems:
${errors.slice(0, 20).map((e) => `- ${e}`).join('\n')}
Reply again with the full corrected JSON only. Use only the IDs given and copy quotes exactly.`;
}
