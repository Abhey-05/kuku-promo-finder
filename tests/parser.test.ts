import { describe, expect, it } from 'vitest';
import { formatTimestamp, parseAll, parseEpisode, parseTimestamp } from '../src/core/parse';
import { loadPack, PACK_AVAILABLE } from './helpers';

const SAMPLE = `EPISODE NUMBER: Episode 7
EPISODE LOGLINE: Nora finds the ledger.
CONTINUITY NOTES: None.

--- SCRIPT START ---

SCENE 01
Scene heading: INT. HARBOUR OFFICE – NIGHT
Scene start: 00:00.00
Scene end: 00:40.00

Actions and dialogue:

**CAMERA:**
Start: (00:00.00) | End: (00:04.80)
Close-up on a door.

**NORA (Cold, Commanding):**
Start: (00:05.00) | End: (00:07.10)
"You lied to me."

**SOUND FX:**
Start: (00:30.00) | End: (00:39.50)
Low ominous drone.
It keeps building.

--- SCRIPT END ---
`;

describe('parseTimestamp', () => {
  it('reads both forms', () => {
    expect(parseTimestamp('00:04.80')).toBe(4.8);
    expect(parseTimestamp('02:18.00')).toBe(138);
    expect(parseTimestamp('01:02:03.50')).toBe(3723.5);
    expect(parseTimestamp('garbage')).toBeNull();
  });
  it('round-trips through formatTimestamp', () => {
    for (const t of [0, 4.8, 59.99, 138, 200.75]) expect(parseTimestamp(formatTimestamp(t))).toBe(t);
  });
});

describe('parseEpisode', () => {
  it('parses the documented format', () => {
    const { episode, report } = parseEpisode('e.txt', SAMPLE);
    expect(episode.number).toBe(7);
    expect(episode.scenes).toHaveLength(1);
    expect(episode.entries.map((e) => e.type)).toEqual(['CAMERA', 'DIALOGUE', 'SFX']);
    expect(episode.entries[1].speaker).toBe('NORA');
    expect(episode.entries[1].parenthetical).toBe('Cold, Commanding');
    expect(episode.entries[2].text).toBe('Low ominous drone.\nIt keeps building.');
    expect(episode.duration).toBe(40);
    expect(report.unparsed).toEqual([]);
    expect(report.violations).toEqual([]);
  });

  it('never crashes on drift and reports what it could not read', () => {
    const drifted = SAMPLE.replace('Start: (00:05.00) | End: (00:07.10)', 'Start: (bad) | End: (00:07.10)')
      .replace('SCENE 01', 'random stray line\nSCENE 01');
    const { report } = parseEpisode('e.txt', drifted);
    const reasons = report.unparsed.map((u) => u.reason);
    expect(reasons).toContain('bad timestamp');
    expect(reasons).toContain('unrecognised line');
    expect(report.unparsed.every((u) => u.line > 0)).toBe(true);
  });

  it.each(['', 'nonsense', '**CAMERA:**', 'Start: (00:01.00) | End: (00:02.00)', '\u0000\u0001'])(
    'survives junk input %j',
    (text) => {
      expect(() => parseEpisode('junk.txt', text)).not.toThrow();
    },
  );

  it('reports time violations without repairing them', () => {
    const bad = SAMPLE.replace('Start: (00:30.00) | End: (00:39.50)', 'Start: (00:30.00) | End: (00:20.00)').replace(
      'Start: (00:05.00) | End: (00:07.10)',
      'Start: (00:05.00) | End: (00:55.00)',
    );
    const { report, episode } = parseEpisode('e.txt', bad);
    expect(report.violations.map((v) => v.reason).join()).toMatch(/before start/);
    expect(report.violations.map((v) => v.reason).join()).toMatch(/past episode end/);
    expect(episode.entries.find((e) => e.type === 'SFX')?.end).toBe(20);
  });

  it('accepts upper-case scene metadata, which one real episode uses', () => {
    const upper = SAMPLE.replace('Scene heading:', 'SCENE HEADING:').replace('Scene start:', 'SCENE START:').replace('Scene end:', 'SCENE END:');
    const { episode, report } = parseEpisode('e.txt', upper);
    expect(episode.scenes).toHaveLength(1);
    expect(episode.scenes[0].heading).toMatch(/^INT\./);
    expect(report.unparsed).toEqual([]);
  });

  it('keeps text verbatim', () => {
    const { episode } = parseEpisode('e.txt', SAMPLE);
    for (const e of episode.entries) expect(SAMPLE).toContain(e.text.split('\n')[0]);
  });
});

describe.skipIf(!PACK_AVAILABLE)('full input pack', () => {
  const { report, episodes } = parseAll(PACK_AVAILABLE ? loadPack() : []);
  it('parses all 50 episodes with zero unexplained lines', () => {
    expect(report.totals.episodes_parsed).toBe(50);
    expect(report.episodes.flatMap((e) => e.unparsed)).toEqual([]);
  });
  it('has unique, contiguous episode numbers', () => {
    expect(episodes.map((e) => e.number)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
  it('accounts for every timestamp line in the source', () => {
    const lines = loadPack().reduce((n, f) => n + (f.text.match(/^Start: \(/gm)?.length ?? 0), 0);
    expect(report.totals.entries).toBe(lines);
  });
});
