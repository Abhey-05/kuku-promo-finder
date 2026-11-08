import { useRef, useState, type DragEvent } from 'react';
import { LLM_STAGES, STAGES, type Stage, type StageInfo } from '../../core/pipeline';
import type { EpisodeReport, ParseReport } from '../../core/schema';
import { formatTimestamp } from '../../core/parse';
import { Button, Empty, Skeleton } from '../components/ui';

interface Props {
  fileCount: number;
  source: string;
  report: ParseReport | null;
  error: string | null;
  running: boolean;
  stage: Stage | null;
  stageInfo: Partial<Record<Stage, StageInfo>>;
  aiMode: boolean;
  modeLabel: string;
  hasResults: boolean;
  onDrop: (e: DragEvent) => void;
  onPick: (files: File[]) => void;
  onDemo: () => void;
  onRun: () => void;
  onCancel: () => void;
  onSettings: () => void;
}

const STAGE_NAMES: Record<Stage, string> = {
  parse: 'Parse scripts',
  shortlist: 'Shortlist candidates',
  judge: 'AI judge',
  refine: 'AI refines cuts',
  writeup: 'AI write-up',
  verify: 'Verify every output',
};

function Warnings({ r }: { r: EpisodeReport }) {
  const n = r.unparsed.length + r.violations.length;
  if (n === 0) return <span className="text-muted">None</span>;
  const first = [...r.unparsed, ...r.violations][0];
  return <span className="text-danger">{n}: line {first.line}, {first.reason}</span>;
}

function Stepper({ step }: { step: number }) {
  const steps = ['Upload', 'Run', 'Review'];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === step ? 'step' : undefined}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${i < step ? 'border-accent bg-accent text-on-accent' : i === step ? 'border-accent text-accent' : 'border-border text-muted'}`}>
            {i < step ? '✓' : i + 1}
          </span>
          <span className={i === step ? 'font-semibold' : 'text-muted'}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function RunProgress({ stage, info, aiMode, onCancel }: { stage: Stage; info: Props['stageInfo']; aiMode: boolean; onCancel: () => void }) {
  const at = STAGES.indexOf(stage);
  return (
    <section aria-label="Run progress" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Running</h2>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
      <ol className="mt-4 space-y-2" aria-live="polite">
        {STAGES.map((s, i) => {
          const skipped = !aiMode && LLM_STAGES.includes(s);
          const done = !skipped && i < at;
          const active = i === at;
          const d = info[s];
          return (
            <li key={s} className="flex items-center gap-3 text-sm" aria-current={active ? 'step' : undefined}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${done ? 'border-accent bg-accent text-on-accent' : active ? 'border-accent text-accent' : 'border-border text-muted'}`} aria-hidden="true">
                {done ? '✓' : active ? '•' : ''}
              </span>
              <span className={active ? 'font-semibold' : skipped ? 'text-muted line-through' : done ? '' : 'text-muted'}>{STAGE_NAMES[s]}</span>
              <span className="tnum ml-auto text-xs text-muted">
                {skipped ? 'skipped, heuristic only' : d?.total ? `${d.done ?? 0}/${d.total}` : d?.detail ?? (active ? 'working…' : '')}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 space-y-3">
        <Skeleton />
        <Skeleton lines={2} />
      </div>
    </section>
  );
}

export function Home(p: Props) {
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const step = p.running ? 1 : p.hasResults ? 2 : p.report?.totals.episodes_parsed ? 1 : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Find the promos in a screenplay</h1>
        <p className="max-w-2xl text-muted">Turns timestamped episode scripts into ranked 20 to 60 second promo clips, each with its hook, cliffhanger and reason.</p>
        <Stepper step={step} />
      </div>

      {p.running && p.stage ? (
        <RunProgress stage={p.stage} info={p.stageInfo} aiMode={p.aiMode} onCancel={p.onCancel} />
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            p.onDrop(e);
          }}
          className={`rounded-lg border-2 border-dashed px-6 py-12 text-center ${over ? 'border-accent bg-surface-2' : 'border-border bg-surface'}`}
        >
          <p className="text-lg font-semibold">Drop a folder, .txt files or a .zip here</p>
          <p className="mt-1 text-sm text-muted">Files stay in your browser.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={p.onDemo}>Try demo show</Button>
            <Button onClick={() => fileInput.current?.click()}>Choose files</Button>
            <Button onClick={() => folderInput.current?.click()}>Choose folder</Button>
          </div>
          <input ref={fileInput} type="file" multiple accept=".txt,.zip" hidden aria-label="Choose files" onChange={(e) => p.onPick([...(e.target.files ?? [])])} />
          <input ref={folderInput} type="file" hidden aria-label="Choose folder" {...({ webkitdirectory: '' } as object)} onChange={(e) => p.onPick([...(e.target.files ?? [])])} />
          <p className="mt-4 text-xs text-muted">The demo is a short fictional show written for this tool.</p>
        </div>
      )}

      {p.error && (
        <div role="alert" className="rounded-lg border border-danger bg-surface p-4 text-sm">
          <strong className="text-danger">That did not work.</strong> {p.error}
        </div>
      )}

      {p.report ? (
        <section aria-label="Parsed episodes" className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{p.source}</h2>
              <p className="text-sm text-muted">
                {p.report.totals.episodes_parsed} of {p.report.totals.files} files parsed, {p.report.totals.entries.toLocaleString('en-US')} entries, {(p.report.totals.duration_s / 60).toFixed(1)} minutes. Unreadable lines: {p.report.totals.unparsed_lines}. Timing problems: {p.report.totals.violations}.
              </p>
            </div>
            {!p.running && (
              <div className="flex gap-2">
                <Button onClick={p.onSettings}>Settings</Button>
                <Button variant="primary" onClick={p.onRun} disabled={p.report.totals.episodes_parsed === 0}>Run analysis</Button>
              </div>
            )}
          </div>
          {!p.running && <p className="mt-2 text-xs text-muted">Mode: {p.modeLabel}. Change it with Settings or <kbd>m</kbd>.</p>}

          <div className="mt-4 max-h-80 overflow-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Ep</th>
                  <th className="px-3 py-1.5 font-medium">Scenes</th>
                  <th className="px-3 py-1.5 font-medium">Entries</th>
                  <th className="px-3 py-1.5 font-medium">Length</th>
                  <th className="px-3 py-1.5 font-medium">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {p.report.episodes.map((r) => (
                  <tr key={r.file} className="border-t border-border">
                    <td className="tnum px-3 py-1">{r.episode}</td>
                    <td className="tnum px-3 py-1">{r.scene_count}</td>
                    <td className="tnum px-3 py-1">{r.entry_count}</td>
                    <td className="tnum px-3 py-1">{formatTimestamp(r.duration_s)}</td>
                    <td className="px-3 py-1"><Warnings r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        !p.running && <Empty title="No episodes loaded yet">Add files above, or start with the demo show.</Empty>
      )}
      {p.fileCount > 0 && p.report?.totals.episodes_parsed === 0 && (
        <Empty title="None of these files look like a screenplay">Each episode needs entries with Start and End timestamps. The table above shows what was found.</Empty>
      )}
    </div>
  );
}
