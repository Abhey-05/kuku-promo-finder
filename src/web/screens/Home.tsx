import { useRef, useState, type DragEvent } from 'react';
import { STAGES, type Stage } from '../../core/pipeline';
import type { EpisodeReport, ParseReport } from '../../core/schema';
import { formatTimestamp } from '../../core/parse';
import { Button, Empty } from '../components/ui';

interface Props {
  fileCount: number;
  source: string;
  report: ParseReport | null;
  error: string | null;
  running: boolean;
  stage: Stage | null;
  provider: string;
  onDrop: (e: DragEvent) => void;
  onPick: (files: File[]) => void;
  onDemo: () => void;
  onRun: () => void;
  onCancel: () => void;
  onSettings: () => void;
}

const STAGE_NAMES: Record<Stage, string> = { parse: 'Parse', segment: 'Segment', score: 'Score', judge: 'Judge', finalize: 'Finalize' };

function Warnings({ r }: { r: EpisodeReport }) {
  const n = r.unparsed.length + r.violations.length;
  if (n === 0) return <span className="text-muted">None</span>;
  const first = [...r.unparsed, ...r.violations][0];
  return <span className="text-accent">{n}: line {first.line}, {first.reason}</span>;
}

export function Home(p: Props) {
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const stageIndex = p.stage ? STAGES.indexOf(p.stage) : -1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Find the promos in a screenplay</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Upload the episode scripts. You get ranked 20 to 60 second clips, each with exact timestamps, the hook, the cliffhanger and the reason it was picked. Files stay in your browser.
        </p>
      </div>

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
        className={`rounded-lg border-2 border-dashed p-8 text-center ${over ? 'border-accent bg-surface-2' : 'border-border bg-surface'}`}
      >
        <p className="font-semibold">Drop a folder, .txt files or a .zip here</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileInput.current?.click()}>Choose files</Button>
          <Button onClick={() => folderInput.current?.click()}>Choose folder</Button>
          <Button variant="primary" onClick={p.onDemo}>Try the demo show</Button>
        </div>
        <input ref={fileInput} type="file" multiple accept=".txt,.zip" hidden aria-label="Choose files" onChange={(e) => p.onPick([...(e.target.files ?? [])])} />
        <input ref={folderInput} type="file" hidden aria-label="Choose folder" {...({ webkitdirectory: '' } as object)} onChange={(e) => p.onPick([...(e.target.files ?? [])])} />
        <p className="mt-3 text-xs text-muted">The demo is a short fictional show written for this tool.</p>
      </div>

      {p.error && (
        <div role="alert" className="rounded-lg border border-accent bg-surface p-4 text-sm">
          <strong>That did not work.</strong> {p.error}
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
            {p.running ? (
              <Button onClick={p.onCancel}>Cancel</Button>
            ) : (
              <div className="flex gap-2">
                <Button onClick={p.onSettings}>Settings</Button>
                <Button variant="primary" onClick={p.onRun} disabled={p.report.totals.episodes_parsed === 0}>Run analysis</Button>
              </div>
            )}
          </div>

          {p.running && (
            <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Progress" aria-live="polite">
              {STAGES.map((s, i) => (
                <li key={s} aria-current={s === p.stage ? 'step' : undefined} className={`rounded px-2 py-0.5 ${i < stageIndex ? 'bg-surface-2' : i === stageIndex ? 'bg-accent text-on-accent font-semibold' : 'text-muted'}`}>
                  {i < stageIndex ? '✓ ' : ''}{STAGE_NAMES[s]}
                </li>
              ))}
            </ol>
          )}
          {!p.running && <p className="mt-2 text-xs text-muted">Model: {p.provider === 'none' ? 'none, rules only' : p.provider}.</p>}

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
        <Empty title="No episodes loaded yet">Add files above, or start with the demo show.</Empty>
      )}
      {p.fileCount > 0 && p.report?.totals.episodes_parsed === 0 && (
        <Empty title="None of these files look like a screenplay">Each episode needs entries with Start and End timestamps. The table above shows what was found.</Empty>
      )}
    </div>
  );
}
