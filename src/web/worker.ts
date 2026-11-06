/// <reference lib="webworker" />
import assumptions from '../../ASSUMPTIONS.md?raw';
import builder from '../../BUILDER.md?raw';
import { buildOutputs } from '../core/outputs';
import { runPipeline, type Stage } from '../core/pipeline';
import type { Config, InputFile, LlmOptions, RunView } from '../core/schema';

export interface WorkerRequest {
  files: InputFile[];
  config: Config;
  llm: Omit<LlmOptions, 'provider' | 'signal'>;
}

export type WorkerMessage =
  | { type: 'stage'; stage: Stage }
  | { type: 'done'; view: RunView; outputs: Record<string, string> }
  | { type: 'error'; message: string };

const post = (m: WorkerMessage) => self.postMessage(m);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const r = await runPipeline(data.files, data.config, data.llm, { onStage: (stage) => post({ type: 'stage', stage }) });
    const { parseReport, promos, heuristicPromos, runnersUp, log } = r;
    post({
      type: 'done',
      view: { parseReport, promos, heuristicPromos, runnersUp, log },
      outputs: buildOutputs(r, { assumptions, builder }),
    });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'The run failed.' });
  }
};
