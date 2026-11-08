import { useRef, useState, type DragEvent } from 'react';
import { RunPanel, UploadPanel } from '../components/Live';
import { Button, Empty } from '../components/ui';
import type { LiveState } from '../live';

interface Props {
  live: LiveState;
  source: string;
  error: string | null;
  aiMode: boolean;
  modeLabel: string;
  hasResults: boolean;
  autoRun: boolean;
  setAutoRun: (v: boolean) => void;
  onDrop: (e: DragEvent) => void;
  onPick: (files: File[]) => void;
  onDemo: () => void;
  onRun: () => void;
  onCancel: () => void;
  onHeuristic: () => void;
  onSettings: () => void;
  onResults: () => void;
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

export function Home(p: Props) {
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const { live } = p;
  const running = live.phase === 'running';
  const busy = running || live.phase === 'reading';
  const step = running ? 1 : live.phase === 'done' || p.hasResults ? 2 : live.files.length ? 1 : 0;
  const showRun = live.job === 'run';

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Find the promos in a screenplay</h1>
        <p className="max-w-2xl text-muted">Turns timestamped episode scripts into ranked 20 to 60 second promo clips, each with its hook, cliffhanger and reason.</p>
        <Stepper step={step} />
      </div>

      {showRun && <RunPanel live={live} aiMode={p.aiMode} onCancel={p.onCancel} onRetry={p.onRun} onHeuristic={p.onHeuristic} onResults={p.onResults} />}

      {!busy && (
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
          className={`rounded-lg border-2 border-dashed px-6 text-center ${live.files.length ? 'py-5' : 'py-12'} ${over ? 'border-accent bg-surface-2' : 'border-border bg-surface'}`}
        >
          <p className="text-lg font-semibold">{live.files.length ? 'Drop other files to replace these' : 'Drop a folder, .txt files or a .zip here'}</p>
          <p className="mt-1 text-sm text-muted">Files stay in your browser. Parsing starts as soon as they land.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={p.onDemo}>Try demo show</Button>
            <Button onClick={() => fileInput.current?.click()}>Choose files</Button>
            <Button onClick={() => folderInput.current?.click()}>Choose folder</Button>
          </div>
          <input ref={fileInput} type="file" multiple accept=".txt,.zip" hidden aria-label="Choose files" onChange={(e) => p.onPick([...(e.target.files ?? [])])} />
          <input ref={folderInput} type="file" hidden aria-label="Choose folder" {...({ webkitdirectory: '' } as object)} onChange={(e) => p.onPick([...(e.target.files ?? [])])} />
          {!live.files.length && <p className="mt-4 text-xs text-muted">The demo is a short fictional show written for this tool.</p>}
        </div>
      )}

      {p.error && (
        <div role="alert" className="rounded-lg border border-danger bg-surface p-4 text-sm">
          <strong className="text-danger">That did not work.</strong> {p.error}
        </div>
      )}

      {live.files.length > 0 && !running ? (
        <UploadPanel live={live} source={p.source} modeLabel={p.modeLabel} autoRun={p.autoRun} setAutoRun={p.setAutoRun} onRun={p.onRun} onSettings={p.onSettings} />
      ) : (
        !busy && !showRun && <Empty title="No episodes loaded yet">Add files above, or start with the demo show.</Empty>
      )}
      {live.phase === 'ready' && live.files.length > 0 && live.files.every((f) => f.status === 'failed') && (
        <Empty title="None of these files look like a screenplay">Each episode needs entries with Start and End timestamps. The table above shows what was found.</Empty>
      )}
    </div>
  );
}
