/**
 * Evaluation. Four commands:
 *   npm run eval -- sample          Writes a blind, shuffled labelling sheet (private, git-ignored).
 *   npm run eval -- metrics         Reads docs/labels.csv (tuned on) and writes the numbers into docs/EVAL.md.
 *   npm run eval -- heldout-sample  Writes docs/labels_heldout.csv for the builder to label (private, git-ignored).
 *   npm run eval -- heldout         Scores heuristic, AI (if allowed) and random on the held-out labels.
 * Nothing here is hand-typed: every number in the metrics block comes from this script.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/core/config';
import { formatTimestamp } from '../src/core/parse';
import { runPipeline } from '../src/core/pipeline';
import { describeSegments } from '../src/core/segment';
import type { Candidate, Config, InputFile, RunResult } from '../src/core/schema';

const PACK = process.env.INPUT_PACK ?? 'input_pack';
const LABELS = 'docs/labels.csv';
const SHEET = 'docs/private/label_sheet.md';
const SEED = 20261107;
const HELDOUT = 'docs/labels_heldout.csv';
const HELDOUT_STRATA = 'docs/private/heldout_strata.json';
const HELDOUT_SEED = 20261108;

function loadFiles(): InputFile[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return walk(PACK)
    .filter((p) => p.endsWith('.txt'))
    .map((p) => ({ name: p.split('/').pop()!, text: readFileSync(p, 'utf8') }));
}

/** mulberry32, so the sample can be reproduced. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Strata {
  top: Candidate[];
  upper: Candidate[];
  middle: Candidate[];
  lower: Candidate[];
}

/** Top 10 promos, plus the rest of the NMS survivors cut into three equal bands. */
function strata(r: RunResult): Strata {
  const topIds = new Set(r.promos.map((p) => p.id));
  const rest = r.candidates.filter((c) => c.kept && !topIds.has(c.id));
  const third = Math.ceil(rest.length / 3);
  return {
    top: r.candidates.filter((c) => topIds.has(c.id)),
    upper: rest.slice(0, third),
    middle: rest.slice(third, third * 2),
    lower: rest.slice(third * 2),
  };
}

function sheetBlock(c: Candidate, r: RunResult, i: number): string {
  const eps = new Map(r.episodes.map((e) => [e.number, e]));
  const lines = c.segments.flatMap((s) => {
    const ep = eps.get(s.episode)!;
    return [
      `--- ${describeSegments([s])} — ${ep.scenes.map((x) => x.heading).join(' / ')}`,
      ...ep.entries
        .filter((e) => e.start >= s.start - 0.005 && e.end <= s.end + 0.005 && e.type !== 'CAMERA')
        .map((e) => `${formatTimestamp(e.start)} ${e.type === 'DIALOGUE' ? e.speaker : e.type}: ${e.text}`),
    ];
  });
  return `## ${i + 1}. ${c.id}\n\n${lines.join('\n')}\n`;
}

async function sample() {
  const r = await runPipeline(loadFiles(), { ...DEFAULT_CONFIG, label: 'eval-sample' });
  const rand = rng(SEED);
  const s = strata(r);
  const take = (xs: Candidate[], n: number) => shuffled(xs, rand).slice(0, n);
  const picks = [
    ...s.top.map((c) => ({ c, stratum: 'top' })),
    ...take(s.upper, 7).map((c) => ({ c, stratum: 'upper' })),
    ...take(s.middle, 7).map((c) => ({ c, stratum: 'middle' })),
    ...take(s.lower, 6).map((c) => ({ c, stratum: 'lower' })),
  ];
  const blind = shuffled(picks, rand);
  mkdirSync('docs/private', { recursive: true });
  writeFileSync(
    SHEET,
    `# Blind labelling sheet\n\nShuffled. No scores and no rank shown.\n\n${blind.map((p, i) => sheetBlock(p.c, r, i)).join('\n')}`,
  );
  writeFileSync(`${LABELS}.template`, ['id,stratum,label,reason', ...blind.map((p) => `${p.c.id},${p.stratum},,`)].join('\n') + '\n');
  console.log(`Wrote ${SHEET} with ${blind.length} candidates. Top 10 and strata sizes:`, {
    top: s.top.length,
    upper: s.upper.length,
    middle: s.middle.length,
    lower: s.lower.length,
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((x) => x.some(Boolean));
}

function metricsTable(rows: (string | number)[][]): string {
  const [head, ...body] = rows;
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function metrics() {
  if (!existsSync(LABELS)) throw new Error(`Missing ${LABELS}. Run the sample step and label it first.`);
  const files = loadFiles();
  const t0 = performance.now();
  const r = await runPipeline(files, { ...DEFAULT_CONFIG, label: 'eval' });
  const runtime = Math.round(performance.now() - t0);

  const labels = new Map(
    parseCsv(readFileSync(LABELS, 'utf8'))
      .slice(1)
      .map(([id, stratum, label]) => [id, { stratum, post: label.trim().toLowerCase() === 'post' }]),
  );
  const missing = r.promos.filter((p) => !labels.has(p.id));
  if (missing.length) throw new Error(`Top promos changed since labelling: ${missing.map((p) => p.id).join(', ')}`);

  const precisionAt = (k: number) => r.promos.slice(0, k).filter((p) => labels.get(p.id)!.post).length / k;

  // Random baseline: expected post-rate of a uniform pick from all NMS survivors,
  // estimated from each band's labels and weighted by the band's true size.
  const s = strata(r);
  const bandRate = (name: string) => {
    const xs = [...labels.values()].filter((l) => l.stratum === name);
    return { n: xs.length, rate: xs.filter((l) => l.post).length / xs.length };
  };
  const sizes: Record<string, number> = { top: s.top.length, upper: s.upper.length, middle: s.middle.length, lower: s.lower.length };
  const pop = Object.values(sizes).reduce((a, b) => a + b, 0);
  const randomP = Object.entries(sizes).reduce((sum, [k, n]) => sum + (n / pop) * bandRate(k).rate, 0);

  // Hook and timestamp validity.
  const eps = new Map(r.episodes.map((e) => [e.number, e]));
  const verbatim = r.promos.filter(
    (p) => eps.get(p.hook.episode)!.source.includes(p.hook.text) && eps.get(p.cliffhanger.episode)!.source.includes(p.cliffhanger.text),
  ).length;
  const hookIn3 = r.promos.filter((p) => {
    const d = p.hook.timestamp - p.segments[0].start;
    return p.hook.episode === p.segments[0].episode && d >= 0 && d < 3 && p.scores.hook > 0;
  }).length;
  const tsValid = r.candidates.filter(
    (c) =>
      c.total_duration_s >= 20 &&
      c.total_duration_s <= 60 &&
      c.segments.every((x) => x.start >= 0 && x.end > x.start && x.end <= eps.get(x.episode)!.duration),
  ).length;

  // Ablation: zero one weight, compare the top 10.
  const base = new Set(r.promos.map((p) => p.id));
  const ablate: (string | number)[][] = [['Feature set to zero', 'Top 10 unchanged', 'New entries', 'Of the top 10, labelled post', 'Labelled share']];
  ablate.push(['None (baseline)', `${base.size}/10`, 0, `${r.promos.filter((p) => labels.get(p.id)?.post).length}`, '10/10']);
  for (const key of ['hook', 'cliffhanger', 'standalone', 'duration'] as const) {
    const cfg: Config = { ...DEFAULT_CONFIG, label: `ablate-${key}`, weights: { ...DEFAULT_CONFIG.weights, [key]: 0 } };
    const a = await runPipeline(files, cfg);
    const same = a.promos.filter((p) => base.has(p.id)).length;
    const known = a.promos.filter((p) => labels.has(p.id));
    ablate.push([key, `${same}/10`, 10 - same, known.filter((p) => labels.get(p.id)!.post).length, `${known.length}/10`]);
  }

  // Cap and episode spread.
  const capOff = await runPipeline(files, { ...DEFAULT_CONFIG, maxPerEpisode: null, label: 'cap-off' });
  const capChanged = capOff.promos.filter((p) => !base.has(p.id)).length;

  const totals = r.parseReport.totals;
  const block = [
    '### Core numbers',
    '',
    metricsTable([
      ['Metric', 'Value'],
      ['Precision@5, heuristic', pct(precisionAt(5))],
      ['Precision@10, heuristic', pct(precisionAt(10))],
      ['Random baseline (expected precision of a uniform pick)', pct(randomP)],
      ['LLM layer', 'Not on these labels. They were used to tune the heuristic; see the held-out section.'],
      ['Labelled post in the top 10', `${r.promos.filter((p) => labels.get(p.id)!.post).length}/10`],
      ['Hook and cliffhanger verbatim in source', `${verbatim}/${r.promos.length} (${pct(verbatim / r.promos.length)})`],
      ['Hook cue inside first 3 s of the promo', `${hookIn3}/${r.promos.length} (${pct(hookIn3 / r.promos.length)})`],
      ['Timestamp validity across all candidates', `${tsValid}/${r.candidates.length} (${pct(tsValid / r.candidates.length)})`],
      ['Parse coverage', `${totals.episodes_parsed}/${totals.files} episodes, ${totals.entries} entries, ${totals.scenes} scenes, ${totals.unparsed_lines} unparsed lines, ${totals.violations} violations`],
      ['Pack length', `${(totals.duration_s / 60).toFixed(1)} minutes`],
      ['Candidates generated', `${r.log.counts.single_candidates} single + ${r.log.counts.multi_candidates} stitched; ${r.log.counts.after_nms} after NMS`],
      ['Runtime on the full pack (this script, one run)', `${runtime} ms`],
      ['Diversity cap', `${r.log.diversity.length} candidates skipped; turning it off changes ${capChanged} of the top 10`],
    ]),
    '',
    '### Labels by band',
    '',
    metricsTable([
      ['Band', 'Population', 'Labelled', 'Post rate'],
      ...Object.entries(sizes).map(([k, n]) => [k, n, bandRate(k).n, pct(bandRate(k).rate)]),
    ]),
    '',
    '### Ablation',
    '',
    metricsTable(ablate),
  ].join('\n');

  const doc = 'docs/EVAL.md';
  const current = readFileSync(doc, 'utf8');
  const updated = current.replace(/<!-- metrics:start -->[\s\S]*<!-- metrics:end -->/, `<!-- metrics:start -->\n${block}\n<!-- metrics:end -->`);
  writeFileSync(doc, updated);
  console.log(block);
}


const csvCell = (v: unknown) => {
  const t = String(v ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Verbatim lines of a candidate, one cell, for the human labeller. No scores, no rank. */
function verbatim(c: Candidate, r: RunResult): string {
  const eps = new Map(r.episodes.map((e) => [e.number, e]));
  return c.segments
    .flatMap((s) =>
      eps
        .get(s.episode)!
        .entries.filter((e) => e.start >= s.start - 0.005 && e.end <= s.end + 0.005 && e.type !== 'CAMERA')
        .map((e) => `${formatTimestamp(e.start)} ${e.type === 'DIALOGUE' ? e.speaker : e.type}: ${e.text.replace(/\s*\n\s*/g, ' ')}`),
    )
    .join('\n');
}

/** The heuristic top 10 plus 20 stratified survivors, shuffled. The builder fills the label column. */
async function heldoutSample() {
  if (existsSync(HELDOUT)) throw new Error(`${HELDOUT} exists. It holds the builder's labels; move it away first if you really want a new sheet.`);
  const r = await runPipeline(loadFiles(), { ...DEFAULT_CONFIG, label: 'heldout-sample' });
  const rand = rng(HELDOUT_SEED);
  const s = strata(r);
  const take = (xs: Candidate[], n: number) => shuffled(xs, rand).slice(0, n);
  const picks = [
    ...s.top.map((c) => ({ c, stratum: 'top' })),
    ...take(s.upper, 7).map((c) => ({ c, stratum: 'upper' })),
    ...take(s.middle, 7).map((c) => ({ c, stratum: 'middle' })),
    ...take(s.lower, 6).map((c) => ({ c, stratum: 'lower' })),
  ];
  const blind = shuffled(picks, rand);
  const rows = blind.map(({ c }) => [
    c.id,
    [...new Set(c.segments.map((x) => x.episode))].join(' '),
    describeSegments(c.segments),
    verbatim(c, r),
    '',
    '',
  ]);
  writeFileSync(HELDOUT, [['candidate_id', 'episode', 'timestamps', 'verbatim_text', 'label', 'note'], ...rows].map((x) => x.map(csvCell).join(',')).join('\n') + '\n');
  mkdirSync('docs/private', { recursive: true });
  writeFileSync(HELDOUT_STRATA, JSON.stringify(Object.fromEntries(blind.map((p) => [p.c.id, p.stratum])), null, 2));
  console.log(`Wrote ${HELDOUT} with ${blind.length} rows. Label each "post" or "dont" in the label column.`);
}

async function heldout() {
  if (!existsSync(HELDOUT)) throw new Error(`Missing ${HELDOUT}. Run: npm run eval -- heldout-sample`);
  const rows = parseCsv(readFileSync(HELDOUT, 'utf8')).slice(1);
  const labels = new Map(rows.filter((x) => x[4]?.trim()).map((x) => [x[0], x[4].trim().toLowerCase() === 'post']));
  const block = (body: string) => {
    const doc = readFileSync('docs/EVAL.md', 'utf8');
    writeFileSync('docs/EVAL.md', doc.replace(/<!-- heldout:start -->[\s\S]*<!-- heldout:end -->/, `<!-- heldout:start -->\n${body}\n<!-- heldout:end -->`));
    console.log(body);
  };
  if (labels.size === 0) {
    block(`**Waiting on the builder's labels.** \`${HELDOUT}\` has ${rows.length} rows and none is labelled yet, so there are no held-out numbers.`);
    return;
  }
  const strataOf: Record<string, string> = JSON.parse(readFileSync(HELDOUT_STRATA, 'utf8'));
  const files = loadFiles();
  const r = await runPipeline(files, { ...DEFAULT_CONFIG, label: 'heldout' });
  const at = (ids: string[], k: number) => {
    const known = ids.slice(0, k).filter((id) => labels.has(id));
    return { p: known.filter((id) => labels.get(id)).length / k, coverage: `${known.length}/${k}` };
  };
  const s = strata(r);
  const sizes: Record<string, number> = { top: s.top.length, upper: s.upper.length, middle: s.middle.length, lower: s.lower.length };
  const pop = Object.values(sizes).reduce((a, b) => a + b, 0);
  const rate = (band: string) => {
    const xs = [...labels.entries()].filter(([id]) => strataOf[id] === band).map(([, v]) => v);
    return xs.length ? xs.filter(Boolean).length / xs.length : 0;
  };
  const randomP = Object.entries(sizes).reduce((sum, [k, n]) => sum + (n / pop) * rate(k), 0);
  const h = r.promos.map((p) => p.id);
  const table: (string | number)[][] = [
    ['Ranking', 'P@5', 'P@10', 'Labelled among its top 10'],
    ['Heuristic only', pct(at(h, 5).p), pct(at(h, 10).p), at(h, 10).coverage],
  ];
  const provider = process.env.KUKU_LLM_PROVIDER;
  let aiNote = 'AI ranking: not run. It needs KUKU_LLM_PROVIDER, KUKU_LLM_API_KEY and KUKU_ALLOW_PACK_TO_LLM=1, because this sends the confidential pack to the provider.';
  if (provider && provider !== 'none' && process.env.KUKU_ALLOW_PACK_TO_LLM === '1') {
    const ai = await runPipeline(files, { ...DEFAULT_CONFIG, provider: provider as Config['provider'], label: 'heldout-ai' }, {
      apiKey: process.env.KUKU_LLM_API_KEY,
      model: process.env.KUKU_LLM_MODEL,
      baseUrl: process.env.KUKU_LLM_BASE_URL,
    });
    const ids = ai.promos.map((p) => p.id);
    table.push([`AI blended (${ai.trace.provider}/${ai.trace.model})`, pct(at(ids, 5).p), pct(at(ids, 10).p), at(ids, 10).coverage]);
    const llm = ai.trace.stages.filter((x) => ['judge', 'refine', 'writeup'].includes(x.stage));
    const items = llm.reduce((n, x) => n + x.items_in, 0);
    aiNote = `AI run: ${ai.trace.calls} calls; rejected outputs ${llm.reduce((n, x) => n + x.rejected.length, 0)} of ${items} items; retries ${llm.reduce((n, x) => n + x.retries, 0)} of ${ai.trace.calls} calls; fallbacks ${new Set(llm.flatMap((x) => x.fallbacks)).size} of ${items} items. AI top-10 promos without a label count as not post, so a low coverage understates it.`;
  }
  table.push(['Random baseline', pct(randomP), pct(randomP), 'expected, from the bands']);
  block([`${labels.size} of ${rows.length} rows labelled by the builder.`, '', metricsTable(table), '', aiNote].join('\n'));
}

const mode = process.argv[2];
const modes: Record<string, () => Promise<void>> = { sample, metrics, 'heldout-sample': heldoutSample, heldout };
(modes[mode] ?? (() => Promise.reject(new Error('Use: sample | metrics | heldout-sample | heldout'))))().catch((e) => {
  console.error(e);
  process.exit(1);
});
