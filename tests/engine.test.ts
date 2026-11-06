import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import { cliffScore, durationFit, hookScore } from '../src/core/features';
import { parseEpisode } from '../src/core/parse';
import { runPipeline } from '../src/core/pipeline';
import { applyDiversity, nonMaxSuppression } from '../src/core/rank';
import { promosJson } from '../src/core/outputs';
import { candidateEnds, candidateStarts, overlapsTooMuch, segmentsInOrder } from '../src/core/segment';
import type { Candidate, Entry, InputFile, RunResult } from '../src/core/schema';
import { loadDemo, loadPack, PACK_AVAILABLE } from './helpers';

const script = (body: string) => `EPISODE NUMBER: Episode 1
EPISODE LOGLINE: Nora fights Felix.
CONTINUITY NOTES: None.

--- SCRIPT START ---

SCENE 01
Scene heading: INT. ROOM – NIGHT
Scene start: 00:00.00
Scene end: 00:30.00

Actions and dialogue:

${body}

--- SCRIPT END ---
`;
const entry = (label: string, a: string, b: string, text: string) => `**${label}:**\nStart: (${a}) | End: (${b})\n${text}\n`;

describe('hook score', () => {
  it('finds a slap on the first frame and lists the cue', () => {
    const { episode } = parseEpisode('e', script(entry('SOUND FX', '00:00.00', '00:01.00', 'A sharp slap rings out.')));
    const { score, cues } = hookScore(episode, 0);
    expect(score).toBeCloseTo(0.5);
    expect(cues[0].group).toBe('impact sound');
    expect(cues[0].match).toBe('slap');
  });
  it('counts the same cue less when it comes later', () => {
    const { episode } = parseEpisode('e', script(entry('SOUND FX', '00:02.70', '00:03.00', 'A sharp slap rings out.')));
    expect(hookScore(episode, 0).score).toBeLessThan(0.3);
  });
  it('ignores cues after 3 seconds', () => {
    const { episode } = parseEpisode('e', script(entry('SOUND FX', '00:05.00', '00:06.00', 'A sharp slap rings out.')));
    expect(hookScore(episode, 0).score).toBe(0);
  });
  it('scores zero when nothing happens', () => {
    const { episode } = parseEpisode('e', script(entry('NORA', '00:00.00', '00:02.00', '"The weather is mild."')));
    expect(hookScore(episode, 0).score).toBe(0);
  });
});

describe('cliffhanger score', () => {
  it('rewards an open question and a scripted sting', () => {
    const { episode } = parseEpisode('e', script(
      entry('NORA', '00:20.00', '00:22.00', '"Who sent you?"') + '\n' +
      entry('SOUND FX', '00:22.00', '00:24.00', 'Ominous cliffhanger sting.'),
    ));
    const { score, cues } = cliffScore(episode, 24);
    expect(score).toBeGreaterThan(0.7);
    expect(cues.map((c) => c.group)).toContain('open question');
  });
  it('penalises a resolved ending', () => {
    const open = parseEpisode('e', script(entry('NORA', '00:20.00', '00:22.00', '"Who sent you?"'))).episode;
    const closed = parseEpisode('e', script(
      entry('NORA', '00:20.00', '00:22.00', '"Who sent you? I forgive you."') + '\n' +
      entry('SOUND FX', '00:22.00', '00:24.00', 'Warm strings fading out.'),
    )).episode;
    expect(cliffScore(closed, 24).score).toBeLessThan(cliffScore(open, 22).score);
  });
  it('gives no credit for cut to black over a resolved line', () => {
    const { episode } = parseEpisode('e', script(
      entry('NORA', '00:20.00', '00:22.00', '"We are finally together."') + '\n' +
      entry('CAMERA', '00:22.00', '00:23.00', 'Cut to black.'),
    ));
    expect(cliffScore(episode, 23).cues.some((c) => c.group === 'hard ending')).toBe(false);
  });
});

describe('duration fit', () => {
  it.each([[20, 0], [25, 0.5], [30, 1], [45, 1], [52.5, 0.5], [60, 0]])('%d s gives %d', (s, want) => {
    expect(durationFit(s)).toBeCloseTo(want);
  });
});

describe('segmentation', () => {
  it('never cuts inside a spoken line, even where a camera entry ends mid-sentence', () => {
    const { episode } = parseEpisode('e', script(
      entry('NORA', '00:01.00', '00:05.00', '"A long line."') + '\n' +
      entry('CAMERA', '00:02.00', '00:03.00', 'Close-up.') + '\n' +
      entry('ACTION', '00:03.00', '00:04.00', 'Felix stands.'),
    ));
    expect(candidateEnds(episode)).not.toContain(3);
    expect(candidateStarts(episode)).not.toContain(3);
    expect(candidateEnds(episode)).toContain(5);
  });
});

describe('fixes from the failure log', () => {
  it('does not start a clip on the second half of a sentence', () => {
    const { episode } = parseEpisode('e', script(
      entry('NORA', '00:01.00', '00:02.00', '"...and then he left."') + '\n' +
      entry('NORA', '00:03.00', '00:04.00', '"then I ran."') + '\n' +
      entry('NORA', '00:05.00', '00:06.00', '"I ran."'),
    ));
    expect(candidateStarts(episode)).toEqual([5]);
  });
  it('reads a freeze written in an action entry, in any verb form', () => {
    const { episode } = parseEpisode('e', script(entry('ACTION', '00:20.00', '00:22.00', 'Nora stares as the scene freezes on her face.')));
    expect(cliffScore(episode, 22).cues.map((c) => c.group)).toContain('hard ending');
  });
  it('treats a tender action as resolution even when the sound cue says cliffhanger', () => {
    const { episode } = parseEpisode('e', script(
      entry('ACTION', '00:20.00', '00:22.00', 'They look at each other, an unspoken bond forming.') + '\n' +
      entry('SOUND FX', '00:22.00', '00:24.00', 'Cello swelling to a dramatic cliffhanger hold.'),
    ));
    const plain = parseEpisode('e', script(entry('SOUND FX', '00:22.00', '00:24.00', 'Cello swelling to a dramatic cliffhanger hold.'))).episode;
    expect(cliffScore(episode, 24).score).toBeLessThan(cliffScore(plain, 24).score);
  });
});

const fake = (id: string, episode: number, start: number, end: number, total: number) =>
  ({ id, segments: [{ episode, start, end }], total_duration_s: end - start, cues: [], flags: [], scores: { total } }) as unknown as Candidate;

describe('NMS and diversity', () => {
  it('keeps the higher-scoring of two overlapping windows', () => {
    const kept = nonMaxSuppression([fake('a', 1, 0, 30, 0.9), fake('b', 1, 5, 35, 0.8), fake('c', 1, 40, 70, 0.7), fake('d', 2, 0, 30, 0.6)]);
    expect(kept.map((c) => c.id)).toEqual(['a', 'c', 'd']);
  });
  it('drops a promo that reuses the opening or closing moment of a better one', () => {
    const stitched = (id: string, a: number, b: number, c: number, d: number, total: number) =>
      ({ ...fake(id, 1, a, b, total), segments: [{ episode: 1, start: a, end: b }, { episode: 1, start: c, end: d }] }) as Candidate;
    const kept = nonMaxSuppression([stitched('a', 0, 20, 100, 125, 0.9), stitched('b', 0, 20, 200, 225, 0.8), stitched('c', 50, 70, 100, 125, 0.7)]);
    expect(kept.map((c) => c.id)).toEqual(['a']);
  });
  it('applies the cap and records the swap', () => {
    const list = [fake('a', 1, 0, 30, 0.9), fake('b', 1, 40, 70, 0.8), fake('c', 1, 80, 110, 0.7), fake('d', 2, 0, 30, 0.6)];
    const { chosen, events } = applyDiversity(list, 3, 2);
    expect(chosen.map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(events[0].skipped_id).toBe('c');
    expect(applyDiversity(list, 3, null).chosen.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

function invariants(name: string, load: () => InputFile[]) {
  describe(`invariants: ${name}`, () => {
    let r: RunResult;
    let files: InputFile[];
    beforeAll(async () => {
      files = load();
      r = await runPipeline(files, DEFAULT_CONFIG);
    });
    const source = () => new Map(r.episodes.map((e) => [e.number, e]));

    it('produces promos', () => expect(r.promos.length).toBeGreaterThan(0));

    it('quotes only verbatim source text in hooks, cliffhangers and cues', () => {
      for (const p of r.promos) {
        expect(source().get(p.hook.episode)!.source).toContain(p.hook.text);
        expect(source().get(p.cliffhanger.episode)!.source).toContain(p.cliffhanger.text);
        for (const c of p.cues) {
          const src = source().get(c.episode)!.source;
          expect(src).toContain(c.text);
          if (!c.derived) expect(c.text).toContain(c.match);
        }
      }
    });

    it('quotes only verbatim source text in the why line', () => {
      for (const p of r.promos) {
        const all = p.episodes.map((e) => source().get(e)!.source).join('\n');
        for (const m of p.why.matchAll(/"([^"]+)"/g)) expect(all).toContain(m[1]);
      }
    });

    it('builds segment text only from source lines', () => {
      for (const p of r.promos) {
        for (const s of p.segments) {
          const ep = source().get(s.episode)!;
          const texts = ep.entries.map((e: Entry) => e.text);
          for (const block of s.text.split(/\n(?=\[)/)) {
            expect(texts.some((t) => block.endsWith(t))).toBe(true);
          }
        }
      }
    });

    it('keeps every segment inside its episode and every promo 20 to 60 s', () => {
      for (const c of r.candidates) {
        expect(c.total_duration_s).toBeGreaterThanOrEqual(20);
        expect(c.total_duration_s).toBeLessThanOrEqual(60);
        for (const s of c.segments) {
          const ep = source().get(s.episode)!;
          expect(s.start).toBeGreaterThanOrEqual(0);
          expect(s.end).toBeLessThanOrEqual(ep.duration);
          expect(s.end).toBeGreaterThan(s.start);
        }
      }
    });

    it('has each hook timestamp inside the first 3 s of the promo when a cue exists', () => {
      for (const p of r.promos) {
        if (p.scores.hook === 0) continue;
        const d = p.hook.timestamp - p.segments[0].start;
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(3);
      }
    });

    it('keeps segments in script order, each at least 3 s', () => {
      for (const c of r.candidates) {
        expect(segmentsInOrder(c.segments)).toBe(true);
        if (c.segments.length > 1) for (const s of c.segments) expect(s.end - s.start).toBeGreaterThanOrEqual(3);
      }
    });

    it('has no two promos overlapping by more than 50%', () => {
      r.promos.forEach((a, i) => r.promos.slice(i + 1).forEach((b) => expect(overlapsTooMuch(a.segments, b.segments)).toBe(false)));
    });

    it('never posts the same hook or the same ending twice', () => {
      const firsts = r.promos.map((p) => `${p.segments[0].episode}:${p.segments[0].start}`);
      const lasts = r.promos.map((p) => { const s = p.segments[p.segments.length - 1]; return `${s.episode}:${s.end}`; });
      expect(new Set(firsts).size).toBe(firsts.length);
      expect(new Set(lasts).size).toBe(lasts.length);
    });

    it('holds the diversity cap', () => {
      const counts = new Map<number, number>();
      for (const p of r.promos) for (const e of p.episodes) counts.set(e, (counts.get(e) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(DEFAULT_CONFIG.maxPerEpisode!);
    });

    it('is deterministic', async () => {
      const again = await runPipeline([...files].reverse(), DEFAULT_CONFIG);
      expect(promosJson(again)).toBe(promosJson(r));
    });
  });
}

invariants('demo show', loadDemo);
if (PACK_AVAILABLE) invariants('full pack', loadPack);

describe('demo show', () => {
  it('parses cleanly', async () => {
    const r = await runPipeline(loadDemo(), DEFAULT_CONFIG);
    expect(r.parseReport.totals).toMatchObject({ episodes_parsed: 2, unparsed_lines: 0, violations: 0 });
  });
});
