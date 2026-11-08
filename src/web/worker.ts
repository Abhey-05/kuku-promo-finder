/// <reference lib="webworker" />
import JSZip from 'jszip';
import assumptions from '../../ASSUMPTIONS.md?raw';
import builder from '../../BUILDER.md?raw';
import { createBatcher, type ProgressEvent } from '../core/events';
import { buildOutputs } from '../core/outputs';
import { parseWithEvents, runPipeline } from '../core/pipeline';
import type { Config, InputFile, LlmOptions, ParseReport, RunView } from '../core/schema';

/**
 * All heavy work runs here, off the main thread: unzipping, reading, parsing and the pipeline.
 * Progress events go back in batches of at most about ten a second (see createBatcher).
 */
export type WorkerRequest =
  | { type: 'read'; sources: (File | InputFile)[] }
  | {
      type: 'run';
      files: InputFile[];
      config: Config;
      /** The key lives in this message and in memory only. It is not in config, outputs, events or the trace. */
      llm: Omit<LlmOptions, 'provider' | 'signal'>;
    };

export type WorkerMessage =
  | { type: 'events'; events: ProgressEvent[] }
  | { type: 'read_done'; files: InputFile[]; report: ParseReport }
  | { type: 'done'; view: RunView; outputs: Record<string, string> }
  | { type: 'error'; message: string };

const post = (m: WorkerMessage) => self.postMessage(m);
const batcher = createBatcher((events) => post({ type: 'events', events }));
const emit = batcher.push;

const isFile = (x: File | InputFile): x is File => typeof (x as File).arrayBuffer === 'function';

async function readSources(sources: (File | InputFile)[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  const add = (f: InputFile) => {
    out.push(f);
    emit({ type: 'file_received', name: f.name, bytes: new TextEncoder().encode(f.text).length });
  };
  for (const s of sources) {
    if (!isFile(s)) {
      add(s);
      continue;
    }
    const lower = s.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(s);
      const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.txt') && !n.includes('__MACOSX') && !zip.files[n].dir);
      // One at a time, so the file count ticks up while unzipping.
      for (const n of names) add({ name: n.split('/').pop()!, text: await zip.files[n].async('string') });
    } else if (lower.endsWith('.txt')) {
      add({ name: s.name, text: await s.text() });
    }
  }
  return out;
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'read') {
      let t = performance.now();
      emit({ type: 'stage_started', stage: 'read' });
      const files = await readSources(data.sources);
      emit({ type: 'stage_done', stage: 'read', ms: Math.round(performance.now() - t), summary: `${files.length} screenplay file${files.length === 1 ? '' : 's'}` });
      if (files.length === 0) throw new Error('No .txt screenplays found in that selection.');
      t = performance.now();
      emit({ type: 'stage_started', stage: 'parse', total: files.length });
      const { report } = parseWithEvents(files, emit);
      emit({ type: 'stage_done', stage: 'parse', ms: Math.round(performance.now() - t), summary: `${report.totals.episodes_parsed} of ${files.length} episodes parsed` });
      batcher.flush();
      post({ type: 'read_done', files, report });
      return;
    }
    const r = await runPipeline(data.files, data.config, data.llm, { emit });
    batcher.flush();
    const { parseReport, promos, heuristicPromos, runnersUp, trace, log } = r;
    post({ type: 'done', view: { parseReport, promos, heuristicPromos, runnersUp, trace, log }, outputs: buildOutputs(r, { assumptions, builder }) });
  } catch (err) {
    batcher.flush();
    post({ type: 'error', message: err instanceof Error ? err.message : 'The run failed.' });
  }
};
