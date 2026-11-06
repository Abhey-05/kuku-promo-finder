import type { Cue, Entry, Episode, Segment } from './schema';
import {
  ALL_CAPS_WORD,
  CLIFF_GROUPS,
  HOOK_GROUPS,
  HOOK_LATE_FACTOR,
  OPEN_LINE_WEIGHTS,
  RESOLUTION,
  SHOUT_WEIGHT,
  STANDALONE,
  STANDALONE_WEIGHTS as SW,
  type CueGroup,
} from './lexicon';

export const HOOK_WINDOW_S = 3;
export const CLIFF_WINDOW_S = 5;
const EPS = 0.005;

function word(pattern: string): RegExp {
  return new RegExp(`\\b(?:${pattern})\\b`, 'i');
}

const compiled = new Map<string, RegExp>();
function re(g: CueGroup): RegExp {
  let r = compiled.get(g.pattern);
  if (!r) compiled.set(g.pattern, (r = word(g.pattern)));
  return r;
}

function cue(feature: Cue['feature'], group: string, match: string, weight: number, e: Entry, episode: number): Cue {
  return { feature, group, match, text: e.text, weight, episode, timestamp: e.start, source_type: e.type };
}

function matchGroup(feature: Cue['feature'], g: CueGroup, e: Entry, ep: number): Cue | null {
  const m = e.text.match(re(g));
  return m ? cue(feature, g.group, m[0], g.weight, e, ep) : null;
}

/** Strips the quote marks so end-of-line checks see the words. */
export function spoken(e: Entry): string {
  return e.text.replace(/^["“\s]+|["”\s]+$/g, '');
}

/** Combines by group: the best cue of each group counts, then noisy-OR. */
function noisyOr(cues: Cue[]): number {
  const best = new Map<string, number>();
  for (const c of cues) if (c.weight > 0) best.set(c.group, Math.max(best.get(c.group) ?? 0, c.weight));
  return 1 - [...best.values()].reduce((p, w) => p * (1 - w), 1);
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function hookCues(entry: Entry, ep: number): Cue[] {
  const out: (Cue | null)[] = [];
  if (entry.type === 'SFX') out.push(...HOOK_GROUPS.sfx.map((g) => matchGroup('hook', g, entry, ep)));
  if (entry.type === 'ACTION' || entry.type === 'CAMERA') {
    // Camera entries outnumber action entries 5 to 1 here and often carry the event itself.
    out.push(...HOOK_GROUPS.action.map((g) => matchGroup('hook', g, entry, ep)));
  }
  if (entry.type === 'CAMERA') out.push(...HOOK_GROUPS.camera.map((g) => matchGroup('hook', g, entry, ep)));
  if (entry.type === 'DIALOGUE') {
    out.push(...HOOK_GROUPS.dialogue.map((g) => matchGroup('hook', g, entry, ep)));
    const line = spoken(entry);
    const caps = line.match(ALL_CAPS_WORD);
    if (line.endsWith('!')) out.push(cue('hook', 'shouted line', '!', SHOUT_WEIGHT, entry, ep));
    else if (caps) out.push(cue('hook', 'shouted line', caps[0], SHOUT_WEIGHT, entry, ep));
  }
  return out.filter((c): c is Cue => c !== null);
}

/** Entries that start inside [from, to). */
function startingIn(ep: Episode, from: number, to: number): Entry[] {
  return ep.entries.filter((e) => e.start >= from - EPS && e.start < to - EPS);
}

export function hookScore(ep: Episode, start: number): { score: number; cues: Cue[] } {
  // The scroll decision happens early, so a cue on frame one beats the same cue at 2.9 s.
  const cues = startingIn(ep, start, start + HOOK_WINDOW_S).flatMap((e) => {
    const decay = 1 - (1 - HOOK_LATE_FACTOR) * ((e.start - start) / HOOK_WINDOW_S);
    return hookCues(e, ep.number).map((c) => ({ ...c, weight: round(c.weight * decay) }));
  });
  return { score: round(noisyOr(cues)), cues };
}

export function cliffScore(ep: Episode, end: number): { score: number; cues: Cue[] } {
  const inWindow = (e: Entry) => e.end > end - CLIFF_WINDOW_S + EPS && e.end <= end + EPS;
  const tail = ep.entries.filter(inWindow);
  const cues: Cue[] = [];
  const neg: Cue[] = [];

  const lastLine = [...ep.entries].reverse().find((e) => e.type === 'DIALOGUE' && e.end <= end + EPS);
  const lastInTail = lastLine && inWindow(lastLine) ? lastLine : undefined;

  for (const e of tail) {
    if (e.type === 'SFX') {
      for (const g of [CLIFF_GROUPS.marked, CLIFF_GROUPS.sfx]) {
        const c = matchGroup('cliffhanger', g, e, ep.number);
        if (c) cues.push(c);
      }
    }
    if (e.type !== 'DIALOGUE') {
      const c = matchGroup('cliffhanger', RESOLUTION.tone, e, ep.number);
      if (c) neg.push(c);
    }
  }

  if (lastInTail) {
    const line = spoken(lastInTail);
    if (line.endsWith('?')) cues.push(cue('cliffhanger', 'open question', '?', OPEN_LINE_WEIGHTS.question, lastInTail, ep.number));
    else if (/(—|–|-|\.\.\.|…)$/.test(line)) {
      const tailMark = line.match(/(—|–|-|\.\.\.|…)$/)![0];
      cues.push(cue('cliffhanger', 'line left hanging', tailMark, OPEN_LINE_WEIGHTS.trailing, lastInTail, ep.number));
    }
    const threat = matchGroup('cliffhanger', CLIFF_GROUPS.threat, lastInTail, ep.number);
    if (threat) cues.push(threat);
    const resolved = matchGroup('cliffhanger', RESOLUTION.dialogue, lastInTail, ep.number);
    if (resolved) neg.push(resolved);
  }

  // A hard ending only counts over something unresolved.
  if (neg.length === 0) {
    for (const e of tail) {
      if (e.type === 'DIALOGUE') continue;
      const c = matchGroup('cliffhanger', CLIFF_GROUPS.camera, e, ep.number);
      if (c) cues.push(c);
    }
  }

  const penalty = neg.reduce((sum, c) => sum + c.weight, 0);
  return { score: round(clamp(noisyOr(cues) + penalty)), cues: [...cues, ...neg] };
}

/** Names the viewer can reasonably place: from the logline and scene headings. */
function introducedText(ep: Episode): string {
  return `${ep.logline} ${ep.scenes.map((s) => s.heading).join(' ')}`.toUpperCase();
}

function isRole(speaker: string): boolean {
  return word(STANDALONE.roles).test(speaker);
}

function nameTokens(speaker: string): string[] {
  return speaker
    .toUpperCase()
    .replace(/'S\b/g, '')
    .replace(STANDALONE.titles, ' ')
    .split(/[^A-Z]+/)
    .filter((t) => t.length > 2);
}

/** Show-wide proper names, taken from speaker labels so no name is hardcoded. */
export function showNames(episodes: Episode[]): Set<string> {
  const names = new Set<string>();
  for (const ep of episodes) {
    for (const e of ep.entries) {
      if (e.type === 'DIALOGUE' && e.speaker && !isRole(e.speaker)) nameTokens(e.speaker).forEach((t) => names.add(t));
      if (e.type === 'DIALOGUE' && e.speaker && isRole(e.speaker)) {
        const t = nameTokens(e.speaker);
        if (t.length === 1 && !word(STANDALONE.roles).test(t[0])) names.add(t[0]);
      }
    }
  }
  return names;
}

export interface StandaloneContext {
  names: Set<string>;
  lastEpisode: number;
  /** Index by episode number, for looking up parts of a stitched promo. */
  episodes: Map<number, Episode>;
}

export function standaloneScore(segments: Segment[], ctx: StandaloneContext): { score: number; cues: Cue[] } {
  const cues: Cue[] = [];
  let score = SW.base;
  const add = (group: string, match: string, weight: number, e: Entry, ep: number, derived = false) => {
    cues.push({ ...cue('standalone', group, match, weight, e, ep), ...(derived ? { derived } : {}) });
    score += weight;
  };

  const lines: { e: Entry; ep: Episode }[] = [];
  for (const s of segments) {
    const ep = ctx.episodes.get(s.episode);
    if (!ep) continue;
    for (const e of ep.entries) {
      if (e.type === 'DIALOGUE' && e.start >= s.start - EPS && e.end <= s.end + EPS) lines.push({ e, ep });
    }
  }

  const first = lines[0];
  if (first) {
    const m = first.e.text.match(STANDALONE.pronounOpener);
    if (m) add('pronoun opener', m[1], SW.pronounOpener, first.e, first.ep.number);
  }

  const backRe = word(STANDALONE.backReference);
  const backHit = lines.find((l) => backRe.test(l.e.text));
  if (backHit) add('reference to an earlier event', backHit.e.text.match(backRe)![0], SW.backReference, backHit.e, backHit.ep.number);

  const speakers = new Map<string, { e: Entry; ep: Episode }>();
  for (const l of lines) if (l.e.speaker && !speakers.has(l.e.speaker)) speakers.set(l.e.speaker, l);
  let unintroduced = 0;
  for (const [speaker, l] of speakers) {
    if (isRole(speaker) || unintroduced >= 2) continue;
    const known = introducedText(l.ep);
    if (!nameTokens(speaker).some((t) => known.includes(t))) {
      add('speaker not introduced', speaker, SW.unintroduced, l.e, l.ep.number, true);
      unintroduced++;
    }
  }

  const spokenName = lines.find((l) => l.e.text.toUpperCase().split(/[^A-Z]+/).some((t) => ctx.names.has(t)));
  if (spokenName) {
    const name = spokenName.e.text.split(/[^A-Za-z]+/).find((t) => ctx.names.has(t.toUpperCase()))!;
    add('name spoken aloud', name, SW.spokenName, spokenName.e, spokenName.ep.number);
  }

  const stakesRe = word(STANDALONE.stakes);
  const stakesHit = lines.find((l) => stakesRe.test(l.e.text));
  if (stakesHit) add('relationship stated', stakesHit.e.text.match(stakesRe)![0], SW.stakes, stakesHit.e, stakesHit.ep.number);

  if (first && speakers.size > 0 && speakers.size <= 3) add('few speakers', `${speakers.size}`, SW.fewSpeakers, first.e, first.ep.number, true);
  if (first && speakers.size > 4) add('crowded cast', `${speakers.size}`, SW.crowded, first.e, first.ep.number, true);

  if (first && ctx.lastEpisode > 1) {
    const depth = (first.ep.number - 1) / (ctx.lastEpisode - 1);
    const p = round(SW.storyDepth * depth);
    if (p < 0) add('late in the story', `episode ${first.ep.number}`, p, first.e, first.ep.number, true);
  }

  return { score: round(clamp(score)), cues };
}

/** 1.0 for 30 to 45 s, falling linearly to 0 at 20 s and 60 s. */
export function durationFit(seconds: number): number {
  if (seconds <= 20 || seconds >= 60) return 0;
  if (seconds < 30) return round((seconds - 20) / 10);
  if (seconds <= 45) return 1;
  return round((60 - seconds) / 15);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
