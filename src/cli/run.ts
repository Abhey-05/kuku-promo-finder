import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { DEFAULT_CONFIG } from '../core/config';
import { buildOutputs } from '../core/outputs';
import { describeSegments } from '../core/segment';
import { runPipeline } from '../core/pipeline';
import type { Config, InputFile, ProviderName } from '../core/schema';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function readInput(path: string): Promise<InputFile[]> {
  if (!existsSync(path)) throw new Error(`Input not found: ${path}`);
  if (statSync(path).isDirectory()) {
    return walk(path)
      .filter((p) => p.toLowerCase().endsWith('.txt'))
      .map((p) => ({ name: basename(p), text: readFileSync(p, 'utf8') }));
  }
  if (path.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(readFileSync(path));
    const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.txt') && !n.includes('__MACOSX'));
    return Promise.all(names.map(async (n) => ({ name: n.split('/').pop()!, text: await zip.files[n].async('string') })));
  }
  return [{ name: basename(path), text: readFileSync(path, 'utf8') }];
}

async function main() {
  const input = arg('input');
  const out = arg('out');
  if (!input || !out) {
    console.error('Usage: npm run cli -- --input <folder-or-zip> --out runs/<label> [--provider none|gemini|openai-compatible] [--top 10] [--weights weights.json] [--max-per-episode 2] [--model name] [--base-url url]');
    process.exit(2);
  }
  const cap = arg('max-per-episode');
  const weightsPath = arg('weights');
  const config: Config = {
    ...DEFAULT_CONFIG,
    label: basename(out),
    provider: (arg('provider') ?? 'none') as ProviderName,
    top: Number(arg('top') ?? DEFAULT_CONFIG.top),
    maxPerEpisode: cap === undefined ? DEFAULT_CONFIG.maxPerEpisode : cap === 'off' ? null : Number(cap),
    weights: weightsPath ? JSON.parse(readFileSync(weightsPath, 'utf8')) : DEFAULT_CONFIG.weights,
  };
  const files = await readInput(input);
  const result = await runPipeline(files, config, {
    apiKey: process.env.LLM_API_KEY,
    model: arg('model'),
    baseUrl: arg('base-url'),
  });
  const root = resolve('.');
  const outputs = buildOutputs(result, {
    assumptions: readFileSync(join(root, 'ASSUMPTIONS.md'), 'utf8'),
    builder: readFileSync(join(root, 'BUILDER.md'), 'utf8'),
  });
  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) writeFileSync(join(out, name), content);

  const c = result.log.counts;
  console.log(`Episodes parsed: ${c.episodes}/${c.files}  Entries: ${c.entries}  Unparsed lines: ${result.parseReport.totals.unparsed_lines}`);
  console.log(`Candidates: ${c.single_candidates} single, ${c.multi_candidates} stitched, ${c.after_nms} after NMS`);
  console.log(`Time: ${Object.values(result.log.timings_ms).reduce((a, b) => a + b, 0)} ms  Provider: ${config.provider}${result.log.llm.fallback_used ? ' (fell back to heuristic)' : ''}`);
  for (const p of result.promos) console.log(`${String(p.rank).padStart(2)}. ${p.scores.total.toFixed(3)}  ${p.total_duration_s.toFixed(1).padStart(4)}s  ${describeSegments(p.segments)}`);
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
