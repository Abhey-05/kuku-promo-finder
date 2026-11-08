import type { Candidate, Promo, RunResult } from './schema';
import { formatTimestamp } from './parse';
import { describeSegments } from './segment';

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

function publicPromo({ cues: _cues, ...p }: Promo) {
  return p;
}

/** The ranked promos as stored in promos.json. Excludes anything that varies between runs. */
export function promosJson(result: RunResult): string {
  return JSON.stringify(result.promos.map(publicPromo), null, 2) + '\n';
}

function promosCsv(promos: Promo[]): string {
  return csv(
    ['rank', 'id', 'episodes', 'segments', 'total_duration_s', 'hook_text', 'hook_timestamp', 'hook_source', 'cliffhanger_text', 'cliffhanger_timestamp', 'cliffhanger_source', 'why', 'hook', 'cliffhanger', 'standalone', 'duration', 'join_penalty', 'total', 'heuristic_rank', 'final_score', 'ai_hook', 'ai_cliffhanger', 'ai_standalone', 'ai_score', 'judge', 'judge_reason', 'flags'],
    promos.map((p) => [
      p.rank, p.id, p.episodes.join(' '), describeSegments(p.segments), p.total_duration_s,
      p.hook.text, formatTimestamp(p.hook.timestamp), p.hook.source_type,
      p.cliffhanger.text, formatTimestamp(p.cliffhanger.timestamp), p.cliffhanger.source_type,
      p.why, p.scores.hook, p.scores.cliffhanger, p.scores.standalone, p.scores.duration, p.scores.join_penalty, p.scores.total,
      p.heuristic_rank, p.final_score, p.ai?.hook ?? '', p.ai?.cliffhanger ?? '', p.ai?.standalone ?? '', p.ai?.score ?? '',
      p.judge.source, p.judge.reason ?? '', p.flags.join(' '),
    ]),
  );
}

function candidatesCsv(candidates: (Candidate & { kept: boolean })[]): string {
  const groups = (c: Candidate, f: string) => [...new Set(c.cues.filter((x) => x.feature === f).map((x) => `${x.group}=${x.match}`))].join(' | ');
  return csv(
    ['rank', 'id', 'segments', 'n_segments', 'total_duration_s', 'kept_after_nms', 'total', 'hook', 'cliffhanger', 'standalone', 'duration', 'join_penalty', 'hook_cues', 'cliffhanger_cues', 'standalone_cues', 'flags'],
    candidates.map((c, i) => [
      i + 1, c.id, describeSegments(c.segments), c.segments.length, c.total_duration_s, c.kept ? 1 : 0, c.scores.total,
      c.scores.hook, c.scores.cliffhanger, c.scores.standalone, c.scores.duration, c.scores.join_penalty,
      groups(c, 'hook'), groups(c, 'cliffhanger'), groups(c, 'standalone'), c.flags.join(' '),
    ]),
  );
}

function rankingMd(r: RunResult): string {
  const p = r.promos;
  const out = ['# Ranked promos', '', `${r.log.counts.episodes} episodes, ${r.log.counts.single_candidates + r.log.counts.multi_candidates} candidates, ${p.length} promos. Mode: ${r.trace.mode === 'ai' ? `AI, ${r.trace.provider}/${r.trace.model}` : 'heuristic only'}.`, ''];
  const first = p[0];
  if (first) {
    const early = [...p].sort((a, b) => a.episodes[0] - b.episodes[0] || a.rank - b.rank)[0];
    out.push('## Post first', '');
    out.push(`**#1, ${describeSegments(first.segments)}.** It has the best ${r.trace.mode === 'ai' ? `final score (${first.final_score.toFixed(3)}, heuristic rank ${first.heuristic_rank})` : `combined score (${first.scores.total.toFixed(3)})`}: hook ${first.scores.hook.toFixed(2)}, cliffhanger ${first.scores.cliffhanger.toFixed(2)}, standalone ${first.scores.standalone.toFixed(2)}.`);
    if (first.flags.includes('late-story-spoiler-risk')) {
      const safer = p.find((x) => !x.flags.includes('late-story-spoiler-risk'));
      if (safer) out.push('', `It comes from the second half of the story, so check it for spoilers first. The highest-ranked promo from the first half is #${safer.rank} (${describeSegments(safer.segments)}).`);
    } else if (early.rank !== first.rank) {
      out.push('', `The earliest entry point in this list is #${early.rank} (${describeSegments(early.segments)}), if you would rather send viewers near the first episode.`);
    }
    out.push('');
  }
  out.push('## All promos', '');
  for (const x of p) {
    out.push(`### ${x.rank}. ${describeSegments(x.segments)} (${x.total_duration_s.toFixed(1)} s)`, '');
    out.push(`- **Hook** (Ep ${x.hook.episode} ${formatTimestamp(x.hook.timestamp)}, ${x.hook.source_type}): ${x.hook.text}`);
    out.push(`- **Cliffhanger** (Ep ${x.cliffhanger.episode} ${formatTimestamp(x.cliffhanger.timestamp)}, ${x.cliffhanger.source_type}): ${x.cliffhanger.text}`);
    out.push(`- **Why:** ${x.judge.source === 'llm' && x.judge.reason ? x.judge.reason : x.why}`);
    out.push(`- **Scores:** total ${x.scores.total.toFixed(3)}; hook ${x.scores.hook.toFixed(2)}, cliffhanger ${x.scores.cliffhanger.toFixed(2)}, standalone ${x.scores.standalone.toFixed(2)}, duration ${x.scores.duration.toFixed(2)}${x.scores.join_penalty ? `, join penalty ${x.scores.join_penalty.toFixed(2)}` : ''}`);
    if (x.ai) out.push(`- **AI judge:** hook ${x.ai.hook}/5, cliffhanger ${x.ai.cliffhanger}/5, standalone ${x.ai.standalone}/5; final ${x.final_score.toFixed(3)} (heuristic rank ${x.heuristic_rank})`);
    if (x.flags.length) out.push(`- **Flags:** ${x.flags.join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}

/** Every file of a run, keyed by name. The CLI writes these to disk; the web app zips them. */
export function buildOutputs(result: RunResult, extras: { assumptions: string; builder: string }): Record<string, string> {
  return {
    'promos.json': promosJson(result),
    'promos.csv': promosCsv(result.promos),
    'ranking.md': rankingMd(result),
    'candidates_all.csv': candidatesCsv(result.candidates),
    'parse_report.json': JSON.stringify(result.parseReport, null, 2) + '\n',
    'run_log.json': JSON.stringify(result.log, null, 2) + '\n',
    'agent_trace.json': JSON.stringify(result.trace, null, 2) + '\n',
    'ASSUMPTIONS.md': extras.assumptions,
    'BUILDER.md': extras.builder,
  };
}
