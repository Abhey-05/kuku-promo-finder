import { STAGE_LABELS, type Emit, type ProgressEvent } from '../core/events';

/** Prints the engine's progress events: a live line per stage on a terminal, plain lines otherwise. */
export function cliProgress(out: { write: (s: string) => unknown; isTTY?: boolean }): Emit {
  const tty = Boolean(out.isTTY);
  let live = false;
  const line = (s: string) => {
    if (live) out.write('\r\x1b[2K');
    live = false;
    out.write(`${s}\n`);
  };
  return (e: ProgressEvent) => {
    switch (e.type) {
      case 'stage_progress':
        if (tty) {
          out.write(`\r\x1b[2K  … ${STAGE_LABELS[e.stage]} ${e.done}/${e.total}`);
          live = true;
        }
        break;
      case 'stage_done':
        line(`  ✓ ${STAGE_LABELS[e.stage].padEnd(18)} ${e.summary} (${Math.round(e.ms)} ms)`);
        break;
      case 'stage_skipped':
        line(`  – ${STAGE_LABELS[e.stage].padEnd(18)} skipped`);
        break;
      case 'file_failed':
        line(`  ✗ ${e.name}: ${e.reason}`);
        break;
      case 'llm_call':
        if (e.status !== 'started') line(`    ${e.step} batch ${e.batch}: ${e.status}${e.tokens ? `, ${e.tokens.toLocaleString('en-US')} tokens` : ''}${e.ms ? `, ${(e.ms / 1000).toFixed(1)} s` : ''}${e.detail ? ` (${e.detail})` : ''}`);
        break;
      case 'run_error':
        line(`  ✗ ${STAGE_LABELS[e.stage]}: ${e.message}`);
        break;
      default:
        break;
    }
  };
}

