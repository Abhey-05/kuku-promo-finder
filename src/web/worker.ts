/// <reference lib="webworker" />
import assumptions from '../../ASSUMPTIONS.md?raw';
import builder from '../../BUILDER.md?raw';
import { buildOutputs } from '../core/outputs';
import { runPipeline, type Stage, type StageInfo } from '../core/pipeline';
import type { Config, InputFile, LlmOptions, RunView } from '../core/schema';

export interface WorkerRequest {
  files: InputFile[];
  config: Config;
  /** The key lives in this message and in memory only. It is not in config, outputs or the trace. */
  llm: Omit<LlmOptions, 'provider' | 'signal'>;
}

export type WorkerMessage =
  | { type: 'stage'; stage: Stage; info?: StageInfo }
  | { type: 'done'; view: RunView; outputs: Record<string, string> }
  | { type: 'error'; message: string };

const post = (m: WorkerMessage) => self.postMessage(m);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const r = await runPipeline(data.files, data.config, data.llm, { onStage: (stage, info) => post({ type: 'stage', stage, info }) });
    const { parseReport, promos, heuristicPromos, runnersUp, trace, log } = r;
    post({
      type: 'done',
      view: { parseReport, promos, heuristicPromos, runnersUp, trace, log },
      outputs: buildOutputs(r, { assumptions, builder }),
    });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'The run failed.' });
  }
};
