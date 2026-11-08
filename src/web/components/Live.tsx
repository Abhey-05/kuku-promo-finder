import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_STAGES, STAGE_LABELS, STAGES, type StageName } from '../../core/stages';
import { formatTimestamp } from '../../core/parse';
import { cancelledAt, totals, type FileRow, type Level, type LiveState, type StageRow } from '../live';
import { Button } from './ui';

/** Re-renders every `ms` while `active`, for elapsed-time readouts. */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

const secs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const n = (x: number) => x.toLocaleString('en-US');

/* ---------- Upload ---------- */

function FileStatusCell({ f }: { f: FileRow }) {
  if (f.status === 'queued') return <span className="text-muted">queued</span>;
  if (f.status === 'parsing') return <span className="stage-running text-accent">parsing…</span>;
  if (f.status === 'failed') return <span className="text-danger">✗ failed: {f.reason}</span>;
  const w = f.warnings ?? [];
  return (
    <span>
      <span className="text-ok">✓ parsed</span>{' '}
      <span className="tnum text-muted">
        {f.scenes} scenes · {f.entries} entries · {formatTimestamp(f.duration_s ?? 0)}
      </span>
      {w.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-warn">⚠ {w.length} warning{w.length === 1 ? '' : 's'}</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {w.slice(0, 50).map((x, i) => (
              <li key={i}>
                {x.line ? `line ${x.line}: ` : ''}
                {x.reason}
              </li>
            ))}
            {w.length > 50 && <li>…and {w.length - 50} more</li>}
          </ul>
        </details>
      )}
    </span>
  );
}

export function UploadPanel(p: {
  live: LiveState;
  source: string;
  modeLabel: string;
  autoRun: boolean;
  setAutoRun: (v: boolean) => void;
  onRun: () => void;
  onSettings: () => void;
}) {
  const { live } = p;
  const t = totals(live.files);
  const reading = live.phase === 'reading';
  const unzipping = reading && live.zip && live.stages.read.status === 'running';
  const canRun = !reading && t.parsed > 0;
  return (
    <section aria-label="Uploaded episodes" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{p.source}</h2>
          <p className="text-sm text-muted" data-testid="upload-status">
            {unzipping ? `Unzipping… ${t.total} file${t.total === 1 ? '' : 's'} found so far` : reading ? `Reading and parsing… ${t.parsed} of ${t.total}` : `${t.parsed} of ${t.total} parsed`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <Button onClick={p.onSettings}>Settings</Button>
            <Button variant="primary" onClick={p.onRun} disabled={!canRun}>Run analysis</Button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={p.autoRun} onChange={(e) => p.setAutoRun(e.target.checked)} /> Run automatically after upload
          </label>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="upload-summary">
        {(
          [
            ['Episodes parsed', `${t.parsed} / ${t.total}`],
            ['Runtime', `${(t.duration_s / 60).toFixed(1)} min`],
            ['Entries', n(t.entries)],
            ['Warnings', n(t.warnings)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded border border-border bg-surface-2 px-3 py-1.5">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={`tnum text-base font-semibold ${k === 'Warnings' && t.warnings ? 'text-warn' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">Mode: {p.modeLabel}. Change it with Settings or <kbd>m</kbd>.</p>

      <div className="mt-3 max-h-80 overflow-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-1.5 font-medium">File</th>
              <th className="px-3 py-1.5 font-medium">Ep</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {live.files.map((f) => (
              <tr key={f.name} className="border-t border-border align-top" data-testid="file-row" data-status={f.status}>
                <td className="max-w-[12rem] truncate px-3 py-1" title={f.name}>{f.name}</td>
                <td className="tnum px-3 py-1">{f.episode ?? '–'}</td>
                <td className="px-3 py-1"><FileStatusCell f={f} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Run ---------- */

const ICON: Record<StageRow['status'], string> = { pending: '○', running: '●', done: '✓', skipped: '–', failed: '✗', cancelled: '■' };

function StageLine({ stage, row, now, aiMode, onRetry, onHeuristic }: { stage: StageName; row: StageRow; now: number; aiMode: boolean; onRetry?: () => void; onHeuristic?: () => void }) {
  const elapsed = row.status === 'running' && row.startedAt ? Math.max(0, now - row.startedAt) : row.ms;
  const pct = row.total ? Math.min(100, Math.round(((row.done ?? 0) / row.total) * 100)) : null;
  const tone =
    row.status === 'done' ? 'border-ok bg-ok text-on-accent' : row.status === 'running' ? 'border-accent text-accent stage-running' : row.status === 'failed' ? 'border-danger text-danger' : row.status === 'cancelled' ? 'border-warn text-warn' : 'border-border text-muted';
  const isAi = (AI_STAGES as readonly string[]).includes(stage);
  return (
    <li className="py-1.5" data-testid={`stage-${stage}`} data-status={row.status} aria-current={row.status === 'running' ? 'step' : undefined}>
      <div className="flex items-center gap-3 text-sm">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${tone}`} aria-hidden="true">{ICON[row.status]}</span>
        <span className={row.status === 'running' ? 'font-semibold' : row.status === 'pending' || row.status === 'skipped' ? 'text-muted' : ''}>
          {STAGE_LABELS[stage]}
          <span className="sr-only">: {row.status}</span>
        </span>
        <span className="tnum ml-auto text-xs text-muted">
          {row.total && row.status === 'running' ? `${row.done ?? 0}/${row.total} · ` : ''}
          {elapsed !== undefined ? secs(elapsed) : ''}
        </span>
      </div>
      {pct !== null && row.status === 'running' && (
        <div className="ml-8 mt-1 h-1.5 rounded bg-track" role="progressbar" aria-label={`${STAGE_LABELS[stage]} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 rounded bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
      {row.summary && row.status !== 'pending' && <p className={`ml-8 text-xs ${row.status === 'skipped' ? 'text-muted' : ''}`}>{row.status === 'skipped' && !aiMode ? 'Skipped: heuristic only.' : row.summary}</p>}
      {row.warnings.length > 0 && (
        <details className="ml-8 text-xs">
          <summary className="cursor-pointer text-warn">⚠ {row.warnings.length} retr{row.warnings.length === 1 ? 'y or fallback' : 'ies, rejections or fallbacks'}</summary>
          <ul className="mt-1 space-y-0.5 text-warn">{row.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      {isAi && row.status === 'done' && row.warnings.some((w) => w.includes('fallback')) && onRetry && (
        <div className="ml-8 mt-1">
          <Button onClick={onRetry}>Retry the AI stages</Button>
        </div>
      )}
      {row.status === 'failed' && (
        <div className="ml-8 mt-1 rounded border border-danger p-2 text-xs" role="alert">
          <p className="text-danger">{row.error}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {onRetry && <Button onClick={onRetry}>{isAi ? 'Retry the AI stages' : 'Retry'}</Button>}
            {onHeuristic && aiMode && <Button onClick={onHeuristic}>Run heuristic only</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

export function StageTracker(p: { live: LiveState; aiMode: boolean; now: number; onRetry?: () => void; onHeuristic?: () => void }) {
  return (
    <ol className="divide-y divide-border" aria-label="Pipeline stages">
      {STAGES.map((s) => (
        <StageLine key={s} stage={s} row={p.live.stages[s]} now={p.now} aiMode={p.aiMode} onRetry={p.onRetry} onHeuristic={p.onHeuristic} />
      ))}
    </ol>
  );
}

export function Counters({ live, now, aiMode }: { live: LiveState; now: number; aiMode: boolean }) {
  const elapsed = live.startedAt ? Math.max(0, (live.endedAt ?? now) - live.startedAt) : 0;
  const c = live.counters;
  const items: [string, string, boolean?][] = [
    ['Elapsed', secs(elapsed)],
    ['Candidates', n(c.generated)],
    ['After overlaps', c.kept ? n(c.kept) : '–'],
    ['Shortlisted', c.shortlisted ? n(c.shortlisted) : '–'],
  ];
  if (aiMode) items.push(['LLM calls', n(c.calls)], ['Tokens', c.tokens ? n(c.tokens) : '–'], ['Fallbacks', n(c.fallbacks), c.fallbacks > 0]);
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="live-counters">
      {items.map(([k, v, warn]) => (
        <div key={k} className="rounded border border-border bg-surface-2 px-3 py-1.5">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className={`tnum text-base font-semibold ${warn ? 'text-warn' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const CARD_H = 56;

export function LiveResults({ live }: { live: LiveState }) {
  const status = live.phase === 'cancelled' || live.phase === 'error' ? 'partial' : live.final && live.phase === 'done' ? 'final' : 'provisional';
  const top = live.top;
  return (
    <section aria-label="Live results" className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Top {top.length || 10}</h3>
        <span className="text-xs text-muted">{status === 'final' ? 'Final ranking' : status === 'partial' ? 'Partial: the run did not finish' : 'Updates as stages finish'}</span>
      </div>
      {top.length === 0 ? (
        <p className="rounded border border-dashed border-border p-4 text-sm text-muted">Results appear here as soon as the first episodes are scored.</p>
      ) : (
        <ol className="relative" style={{ height: top.length * CARD_H }} data-testid="live-results">
          {top.map((p) => (
            <li key={p.id} className="live-card" style={{ transform: `translateY(${(p.rank - 1) * CARD_H}px)`, height: CARD_H - 6 }}>
              <div className="flex h-full items-center gap-3 rounded border border-border bg-surface px-3">
                <span className="tnum w-6 shrink-0 text-right font-semibold">{p.rank}</span>
                <div className="min-w-0 flex-1">
                  <p className="tnum truncate text-sm" title={p.where}>{p.where}</p>
                  <p className="tnum text-xs text-muted">
                    {p.duration_s.toFixed(1)} s · score {p.score.toFixed(3)}
                    {p.ai_score !== undefined ? ` · AI ${p.ai_score.toFixed(2)}` : ''}
                  </p>
                </div>
                <span
                  data-testid="result-badge"
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${status === 'final' ? 'border-ok text-ok' : status === 'partial' ? 'border-warn text-warn' : 'border-border text-muted'}`}
                >
                  {status}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function RunPanel(p: { live: LiveState; aiMode: boolean; onCancel: () => void; onRetry: () => void; onHeuristic: () => void; onResults?: () => void }) {
  const { live } = p;
  const running = live.phase === 'running';
  const now = useNow(running);
  const stopped = cancelledAt(live);
  return (
    <section aria-label="Run progress" className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold" data-testid="run-heading">
          {running ? 'Running' : live.phase === 'cancelled' ? `Cancelled at ${stopped ? STAGE_LABELS[stopped] : 'start'}` : live.phase === 'error' ? 'The run stopped' : 'Done'}
        </h2>
        <div className="flex gap-2">
          {running && <Button onClick={p.onCancel}>Cancel</Button>}
          {!running && <Button onClick={p.onRetry}>Run again</Button>}
          {live.phase === 'done' && p.onResults && <Button variant="primary" onClick={p.onResults}>Open results</Button>}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{live.announce}</p>
      <Counters live={live} now={now} aiMode={p.aiMode} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <StageTracker live={live} aiMode={p.aiMode} now={now} onRetry={p.onRetry} onHeuristic={p.onHeuristic} />
        <LiveResults live={live} />
      </div>
      <p className="text-xs text-muted">Press <kbd>l</kbd> for the live log.</p>
    </section>
  );
}

/** The finished run, folded to one line on the results page. Expands to the full tracker. */
export function RunSummaryLine({ live, aiMode, onRetry }: { live: LiveState; aiMode: boolean; onRetry: () => void }) {
  if (live.phase !== 'done' || !live.startedAt) return null;
  const total = (live.endedAt ?? live.startedAt) - live.startedAt;
  const c = live.counters;
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-2 text-sm" data-testid="run-summary">
      <summary className="cursor-pointer">
        Done in {secs(total)} · {n(c.generated)} candidates → {n(c.kept)} after overlaps
        {aiMode ? ` · ${c.calls} LLM calls · ${n(c.tokens)} tokens${c.fallbacks ? ` · ${c.fallbacks} fallbacks` : ''}` : ''}
      </summary>
      <div className="mt-2">
        <StageTracker live={live} aiMode={aiMode} now={live.endedAt ?? Date.now()} onRetry={onRetry} />
      </div>
    </details>
  );
}

/* ---------- Log ---------- */

export function LogDrawer({ live, onClose }: { live: LiveState; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const [stage, setStage] = useState<'all' | StageName>('all');
  const [level, setLevel] = useState<'all' | Level>('all');
  const box = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => live.log.filter((e) => (stage === 'all' || e.stage === stage) && (level === 'all' || e.level === level || (level === 'warn' && e.level === 'error'))), [live.log, stage, level]);
  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [rows, paused]);
  return (
    <aside aria-label="Live log" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface shadow-lg" data-testid="log-drawer">
      <div className="mx-auto max-w-5xl px-4 py-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <h2 className="font-semibold">Live log</h2>
          <label className="flex items-center gap-1 text-xs">
            Stage
            <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
              <option value="all">all</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            Level
            <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
              <option value="all">all</option>
              <option value="info">info</option>
              <option value="warn">warnings and errors</option>
              <option value="error">errors</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause scroll
          </label>
          <span className="text-xs text-muted">{rows.length} of {live.log.length}</span>
          <Button className="ml-auto" onClick={onClose} aria-label="Close the log">Close</Button>
        </div>
        <div ref={box} className="mt-2 h-48 overflow-auto rounded border border-border bg-surface-2 p-2 font-mono text-xs" role="log" aria-live="off">
          {rows.length === 0 ? (
            <p className="text-muted">Nothing yet. Events appear here as files are read and stages run.</p>
          ) : (
            rows.map((e) => (
              <div key={e.id} className={e.level === 'error' ? 'text-danger' : e.level === 'warn' ? 'text-warn' : ''}>
                <span className="text-muted">{(e.t / 1000).toFixed(2).padStart(7)}s</span> <span className="text-muted">[{e.stage ?? 'run'}]</span> {e.text}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
