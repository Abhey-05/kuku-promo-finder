import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { buildOutputs } from '../core/outputs';
import { describeSegments } from '../core/segment';
import { runPipeline } from '../core/pipeline';
import { resolveOptions, testConnection } from '../core/llm/interface';
import { listGeminiModels } from '../core/llm/gemini';
import type { InputFile } from '../core/schema';
import { readCli, USAGE, withDotEnv } from './config';
import { cliProgress } from './progress';

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
  const cli = readCli(process.argv.slice(2), withDotEnv(process.env));
  if (cli.errors.length) {
    console.error(cli.errors.map((e) => `Error: ${e}`).join('\n') + `\n\n${USAGE}`);
    process.exit(2);
  }
  const { config, llm } = cli;
  if (cli.listModels) {
    try {
      const models = await listGeminiModels(resolveOptions({ ...llm, provider: 'gemini' }));
      console.log(models.map((m) => `${m.name}${m.displayName ? `  (${m.displayName})` : ''}`).join('\n'));
      process.exit(0);
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }
  if (cli.testConnection) {
    const r = await testConnection({ ...llm, provider: config.provider });
    console.log(r.ok ? `OK: ${config.provider}/${r.model} answered in ${r.latency_ms} ms` : `Failed (${r.kind}): ${r.message}`);
    process.exit(r.ok ? 0 : 1);
  }
  const files = await readInput(cli.input!);
  const out = cli.out!;
  const result = await runPipeline(files, config, llm, { emit: cliProgress(process.stderr) });
  const root = resolve('.');
  const outputs = buildOutputs(result, {
    assumptions: readFileSync(join(root, 'ASSUMPTIONS.md'), 'utf8'),
    builder: readFileSync(join(root, 'BUILDER.md'), 'utf8'),
  });
  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) writeFileSync(join(out, name), content);

  const c = result.log.counts;
  const t = result.trace;
  console.log(`Episodes parsed: ${c.episodes}/${c.files}  Entries: ${c.entries}  Unparsed lines: ${result.parseReport.totals.unparsed_lines}`);
  console.log(`Candidates: ${c.single_candidates} single, ${c.multi_candidates} stitched, ${c.after_nms} after NMS`);
  console.log(`Time: ${Object.values(result.log.timings_ms).reduce((a, b) => a + b, 0)} ms  Mode: ${t.mode === 'ai' ? `AI ${t.provider}/${t.model}` : 'heuristic only'}`);
  if (t.mode === 'ai') {
    const v = t.stages.find((s) => s.stage === 'verify');
    console.log(`Calls: ${t.calls}/${t.call_cap}  Tokens: ${t.input_tokens ?? '?'} in, ${t.output_tokens ?? '?'} out  Cost: ${t.estimated_cost_usd === null ? 'unknown for this model' : `$${t.estimated_cost_usd}`}  Fallbacks: ${v?.fallbacks.length ?? 0}`);
    for (const n of result.log.llm.notes) console.log(`  ${n}`);
  }
  for (const p of result.promos) console.log(`${String(p.rank).padStart(2)}. ${p.final_score.toFixed(3)}  ${p.total_duration_s.toFixed(1).padStart(4)}s  ${describeSegments(p.segments)}${p.flags.includes('llm_fallback') ? '  [llm_fallback]' : ''}`);
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
