import type {
  Entry,
  EntryType,
  Episode,
  EpisodeReport,
  InputFile,
  ParseIssue,
  ParseReport,
  Scene,
} from './schema';

/** Accepts mm:ss.cc and hh:mm:ss.cc. Returns seconds, or null when malformed. */
export function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  const cs = frac ? Number(`0.${frac}`) : 0;
  return round2(Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + cs);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** mm:ss.cc, the same form the screenplays use. */
export function formatTimestamp(t: number): string {
  const cs = Math.round(t * 100);
  const m = Math.floor(cs / 6000);
  const s = (cs - m * 6000) / 100;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

const LABEL = /^\*\*(.+?):?\*\*:?\s*$/;
const TIMES = /^Start:\s*\((.*?)\)\s*\|\s*End:\s*\((.*?)\)\s*$/i;
const SCENE = /^SCENE\s+(\d+)\s*$/i;

function classifyLabel(label: string): Pick<Entry, 'type' | 'speaker' | 'parenthetical'> {
  const upper = label.trim().toUpperCase();
  if (/^CAMERA\b/.test(upper)) return { type: 'CAMERA' };
  if (/^ACTION\b/.test(upper)) return { type: 'ACTION' };
  if (/^(SOUND\s*FX|SFX|SOUND\s*EFFECTS?)\b/.test(upper)) return { type: 'SFX' };
  const m = label.trim().match(/^(.*?)\s*\((.*)\)\s*$/);
  return m
    ? { type: 'DIALOGUE', speaker: m[1].trim(), parenthetical: m[2].trim() }
    : { type: 'DIALOGUE', speaker: label.trim() };
}

/** Parses one screenplay. Never throws; anything unreadable lands in the report. */
export function parseEpisode(file: string, source: string, fallbackNumber = 0): { episode: Episode; report: EpisodeReport } {
  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  const unparsed: ParseIssue[] = [];
  const violations: ParseIssue[] = [];
  const scenes: Scene[] = [];
  const entries: Entry[] = [];

  let number: number | null = null;
  let logline = '';
  let continuity = '';
  let scene: Scene | null = null;
  let current: { entry: Entry; textLines: string[]; timed: boolean } | null = null;
  let finishedScript = false;

  const flush = () => {
    if (!current) return;
    const { entry, textLines, timed } = current;
    if (!timed) {
      unparsed.push({ line: entry.line, text: `**${entry.label}**`, reason: 'entry has no Start/End line; dropped' });
    } else {
      entry.text = textLines.join('\n');
      if (!entry.text) violations.push({ line: entry.line, text: entry.label, reason: 'entry has no text' });
      entry.idx = entries.length;
      entries.push(entry);
    }
    current = null;
  };

  const setScene = (key: 'start' | 'end', raw: string, lineNo: number, line: string) => {
    const t = parseTimestamp(raw);
    if (t === null || !scene) unparsed.push({ line: lineNo, text: line, reason: `bad scene ${key}` });
    else scene[key] = t;
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      return;
    }
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^EPISODE NUMBER:\s*(.*)$/i))) {
      const n = m[1].match(/\d+/);
      if (n) number = Number(n[0]);
      else unparsed.push({ line: lineNo, text: line, reason: 'episode number has no digits' });
    } else if ((m = trimmed.match(/^EPISODE LOGLINE:\s*(.*)$/i))) logline = m[1];
    else if ((m = trimmed.match(/^CONTINUITY NOTES:\s*(.*)$/i))) continuity = m[1];
    else if (/^---\s*SCRIPT START\s*---$/i.test(trimmed)) flush();
    else if (/^---\s*SCRIPT END\s*---$/i.test(trimmed)) {
      flush();
      finishedScript = true;
    } else if ((m = trimmed.match(SCENE))) {
      flush();
      scene = { number: Number(m[1]), heading: '', start: 0, end: 0 };
      scenes.push(scene);
    } else if ((m = trimmed.match(/^Scene heading:\s*(.*)$/i))) {
      if (scene) scene.heading = m[1];
      else unparsed.push({ line: lineNo, text: line, reason: 'scene heading outside a scene' });
    } else if ((m = trimmed.match(/^Scene start:\s*(.*)$/i))) setScene('start', m[1], lineNo, line);
    else if ((m = trimmed.match(/^Scene end:\s*(.*)$/i))) setScene('end', m[1], lineNo, line);
    else if (/^Actions and dialogue:$/i.test(trimmed)) flush();
    else if ((m = trimmed.match(LABEL))) {
      flush();
      current = {
        entry: {
          idx: -1,
          label: m[1].trim(),
          ...classifyLabel(m[1]),
          start: 0,
          end: 0,
          text: '',
          scene: scene ? (scene as Scene).number : 0,
          line: lineNo,
        },
        textLines: [],
        timed: false,
      };
    } else if ((m = trimmed.match(TIMES))) {
      const c = current as { entry: Entry; textLines: string[]; timed: boolean } | null;
      const start = parseTimestamp(m[1]);
      const end = parseTimestamp(m[2]);
      if (!c || c.timed) unparsed.push({ line: lineNo, text: line, reason: 'Start/End line without an entry label' });
      else if (start === null || end === null) unparsed.push({ line: lineNo, text: line, reason: 'bad timestamp' });
      else {
        c.entry.start = start;
        c.entry.end = end;
        c.timed = true;
      }
    } else if (current && (current as { timed: boolean }).timed) {
      (current as { textLines: string[] }).textLines.push(trimmed);
    } else {
      unparsed.push({ line: lineNo, text: line, reason: finishedScript ? 'text after SCRIPT END' : 'unrecognised line' });
    }
  });
  flush();

  const duration = Math.max(0, ...scenes.map((s) => s.end), ...entries.map((e) => e.end));
  const lastSceneEnd = Math.max(0, ...scenes.map((s) => s.end));

  // Hard validation. These are reported, never silently repaired.
  for (const e of entries) {
    if (e.end < e.start) violations.push({ line: e.line, text: e.label, reason: `end ${e.end} before start ${e.start}` });
    if (lastSceneEnd > 0 && e.end > lastSceneEnd) {
      violations.push({ line: e.line, text: e.label, reason: `entry end ${e.end} past episode end ${lastSceneEnd}` });
    }
  }
  scenes.forEach((s, i) => {
    if (s.end < s.start) violations.push({ line: 0, text: `scene ${s.number}`, reason: 'scene end before start' });
    const prev = scenes[i - 1];
    if (prev && s.number <= prev.number) violations.push({ line: 0, text: `scene ${s.number}`, reason: 'scene number out of order' });
    if (prev && s.start < prev.start) violations.push({ line: 0, text: `scene ${s.number}`, reason: 'scene starts before previous scene' });
  });
  if (entries.length === 0) violations.push({ line: 0, text: file, reason: 'no entries found' });

  const by_type: Record<EntryType, number> = { CAMERA: 0, ACTION: 0, SFX: 0, DIALOGUE: 0 };
  for (const e of entries) by_type[e.type]++;

  const resolved = number ?? Number(file.match(/episode-0*(\d+)/i)?.[1] ?? fallbackNumber);
  entries.sort((a, b) => a.start - b.start || a.idx - b.idx).forEach((e, i) => (e.idx = i));

  return {
    episode: { number: resolved, file, logline, continuity, scenes, entries, duration, source },
    report: {
      file,
      episode: resolved,
      scene_count: scenes.length,
      entry_count: entries.length,
      by_type,
      duration_s: round2(duration),
      total_lines: lines.length,
      unparsed,
      violations,
    },
  };
}

/** Parses a set of files. Files that yield nothing stay in the report but out of `episodes`. */
export function parseAll(
  files: InputFile[],
  onFile?: (p: { episode: Episode; report: EpisodeReport }, done: number, total: number) => void,
): { episodes: Episode[]; report: ParseReport } {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const parsed = sorted.map((f, i) => {
    const p = parseEpisode(f.name, f.text, i + 1);
    onFile?.(p, i + 1, sorted.length);
    return p;
  });
  const episodes = parsed
    .map((p) => p.episode)
    .filter((e) => e.entries.length > 0)
    .sort((a, b) => a.number - b.number);
  const reports = parsed.map((p) => p.report).sort((a, b) => a.episode - b.episode);
  return {
    episodes,
    report: {
      episodes: reports,
      totals: {
        files: files.length,
        episodes_parsed: episodes.length,
        scenes: reports.reduce((n, r) => n + r.scene_count, 0),
        entries: reports.reduce((n, r) => n + r.entry_count, 0),
        duration_s: round2(reports.reduce((n, r) => n + r.duration_s, 0)),
        unparsed_lines: reports.reduce((n, r) => n + r.unparsed.length, 0),
        violations: reports.reduce((n, r) => n + r.violations.length, 0),
      },
    },
  };
}
