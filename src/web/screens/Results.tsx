import { useEffect, useMemo, useRef } from 'react';
import { formatTimestamp } from '../../core/parse';
import type { Promo, RunView } from '../../core/schema';
import { candidateId, describeSegments } from '../../core/segment';
import { BuilderFooter } from '../components/BuilderCard';
import { AgentTracePanel, Flags, MiniTimeline, ScoreChips, VoteButtons } from '../components/Promo';
import { Button, Empty } from '../components/ui';
import type { Vote } from '../labels';

export type SortKey = 'rank' | 'duration' | 'episode';

export interface ResultFilters {
  query: string;
  episode: string;
  minScore: number;
  sort: SortKey;
  useLlm: boolean;
  showRunnersUp: boolean;
}

interface Props {
  view: RunView | null;
  filters: ResultFilters;
  setFilters: (f: ResultFilters) => void;
  visible: Promo[];
  selected: number;
  setSelected: (i: number) => void;
  labels: Record<string, Vote>;
  compare: boolean;
  setCompare: (c: boolean) => void;
  onVote: (id: string, v: Vote) => void;
  onOpen: (id: string) => void;
  onExport: () => void;
  onExportLabels: () => void;
  onUpload: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** The finished run's tracker, folded to one line. */
  runSummary?: React.ReactNode;
}

export const aiRan = (view: RunView) => view.trace.mode === 'ai';

export function applyFilters(view: RunView, f: ResultFilters): Promo[] {
  const base = f.useLlm && aiRan(view) ? view.promos : view.heuristicPromos;
  const list = f.showRunnersUp ? [...base, ...view.runnersUp] : base;
  const q = f.query.trim().toLowerCase();
  const out = list.filter(
    (p) =>
      (!f.episode || p.episodes.includes(Number(f.episode))) &&
      p.final_score >= f.minScore &&
      (!q || `${p.hook.text} ${p.cliffhanger.text} ${p.why} ${p.judge.reason ?? ''} ${p.segments.map((s) => s.text).join(' ')}`.toLowerCase().includes(q)),
  );
  if (f.sort === 'duration') return [...out].sort((a, b) => a.total_duration_s - b.total_duration_s || a.rank - b.rank);
  if (f.sort === 'episode') return [...out].sort((a, b) => a.episodes[0] - b.episodes[0] || a.segments[0].start - b.segments[0].start);
  return out;
}

const control = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text';

function Quote({ label, at, text }: { label: string; at: string; text: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-muted">
        {label} <span className="tnum font-normal">{at}</span>
      </p>
      <p className="m-0 line-clamp-3 break-words">{text}</p>
    </div>
  );
}

function Card({ p, selected, vote, onVote, onOpen, onSelect }: { p: Promo; selected: boolean; vote?: Vote; onVote: (v: Vote) => void; onOpen: () => void; onSelect: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <article
      ref={ref}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      aria-label={`Promo ${p.rank}`}
      className={`rounded-lg border bg-surface p-4 ${selected ? 'border-accent' : 'border-border'}`}
      style={selected ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tnum text-2xl font-semibold">#{p.rank}</span>
        <span className="tnum text-sm">{describeSegments(p.segments)}</span>
        <span className="tnum ml-auto text-sm text-muted">{p.total_duration_s.toFixed(1)} s</span>
      </div>
      <div className="mt-2">
        <MiniTimeline promo={p} />
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Quote label="Hook" at={`Ep ${p.hook.episode} ${formatTimestamp(p.hook.timestamp)}`} text={p.hook.text} />
        <Quote label="Cliffhanger" at={`Ep ${p.cliffhanger.episode} ${formatTimestamp(p.cliffhanger.timestamp)}`} text={p.cliffhanger.text} />
      </div>
      <p className="mt-3 text-sm text-muted">{p.judge.source === 'llm' && p.judge.reason ? p.judge.reason : p.why}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ScoreChips promo={p} />
        <Flags flags={p.flags} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <VoteButtons vote={vote} onVote={onVote} />
        <Button onClick={onOpen}>Open</Button>
      </div>
    </article>
  );
}

/** Heuristic and AI top lists next to each other, with how far each promo moved. */
function Compare({ view, onOpen }: { view: RunView; onOpen: (id: string) => void }) {
  const hRank = new Map(view.heuristicPromos.map((p) => [p.id, p.rank]));
  const aRank = new Map(view.promos.map((p) => [p.id, p.rank]));
  const row = (p: Promo, other: Map<string, number>, ai: boolean) => {
    // A re-cut promo has a new ID, so look it up by the cut it came from.
    const o = other.get(ai && p.refined_from ? candidateId(p.refined_from) : p.id);
    const move = o === undefined ? (ai ? 'new' : 'dropped') : o === p.rank ? '=' : o > p.rank ? `▲${o - p.rank}` : `▼${p.rank - o}`;
    return (
      <li key={p.id} className="flex items-center gap-2 border-t border-border py-1.5 text-sm">
        <span className="tnum w-7 font-semibold">#{p.rank}</span>
        <button type="button" className="min-w-0 flex-1 truncate text-left text-text underline-offset-2 hover:underline" onClick={() => onOpen(p.id)}>
          {describeSegments(p.segments)}
        </button>
        <span className="tnum w-14 text-right text-xs text-muted">{(ai ? p.final_score : p.heuristic_score).toFixed(3)}</span>
        <span className={`tnum w-14 text-right text-xs ${move === 'new' || move === 'dropped' ? 'text-accent' : 'text-muted'}`}>{move}</span>
      </li>
    );
  };
  return (
    <section aria-label="Compare rankings" className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Heuristic order</h2>
        <ol className="m-0 list-none p-0">{view.heuristicPromos.map((p) => row(p, aRank, false))}</ol>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">AI order {aiRan(view) ? `(${view.trace.provider}/${view.trace.model})` : ''}</h2>
        {aiRan(view) ? (
          <ol className="m-0 list-none p-0">{view.promos.map((p) => row(p, hRank, true))}</ol>
        ) : (
          <p className="text-sm text-muted">This run was heuristic only. Pick a provider in Settings (<kbd>m</kbd>) and run again to compare.</p>
        )}
      </div>
    </section>
  );
}

export function Results(p: Props) {
  const f = p.filters;
  const set = (patch: Partial<ResultFilters>) => p.setFilters({ ...f, ...patch });
  const episodes = useMemo(() => [...new Set((p.view?.parseReport.episodes ?? []).map((e) => e.episode))], [p.view]);

  if (!p.view) {
    return (
      <Empty title="No results yet">
        <p>Load episodes and run the analysis first.</p>
        <div className="mt-3"><Button variant="primary" onClick={p.onUpload}>Go to Upload</Button></div>
      </Empty>
    );
  }
  const { log, trace } = p.view;
  const ai = aiRan(p.view);
  const fallbacks = trace.stages.find((s) => s.stage === 'verify')?.fallbacks.length ?? 0;
  const labelled = Object.keys(p.labels).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="results-heading" tabIndex={-1} className="text-2xl font-semibold outline-none">Ranked promos</h1>
          <p className="text-sm text-muted">
            {log.counts.episodes} episodes, {(log.counts.single_candidates + log.counts.multi_candidates).toLocaleString('en-US')} candidates, {log.counts.after_nms} after removing overlaps, {(Object.values(log.timings_ms).reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={p.onExportLabels} disabled={labelled === 0}>Export labels ({labelled})</Button>
          <Button variant="primary" onClick={p.onExport}>Export run</Button>
        </div>
      </div>
      {p.runSummary}

      {ai && fallbacks > 0 && (
        <div role="status" className="rounded-lg border border-danger bg-surface p-3 text-sm">
          {fallbacks} item{fallbacks > 1 ? 's' : ''} kept the heuristic result because the model's output failed the checks twice or the call failed. They are flagged "AI fallback". {log.llm.notes[0] ? `First error: ${log.llm.notes[0]}` : ''}
        </div>
      )}

      <details className="rounded-lg border border-border bg-surface p-4" open={ai && fallbacks > 0}>
        <summary className="cursor-pointer text-sm font-semibold">Agent trace</summary>
        <div className="mt-3">
          <AgentTracePanel trace={trace} />
        </div>
      </details>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur" role="search">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={p.searchRef} type="search" aria-label="Search promos" placeholder="Search text (/)" className={`${control} min-w-0 flex-1 basis-40`} value={f.query} onChange={(e) => set({ query: e.target.value })} />
          <select aria-label="Filter by episode" className={control} value={f.episode} onChange={(e) => set({ episode: e.target.value })}>
            <option value="">All episodes</option>
            {episodes.map((e) => <option key={e} value={e}>Episode {e}</option>)}
          </select>
          <select aria-label="Sort" className={control} value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
            <option value="rank">Sort by rank</option>
            <option value="duration">Sort by duration</option>
            <option value="episode">Sort by episode</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="flex rounded-md border border-border" role="group" aria-label="Ranking">
            <button type="button" aria-pressed={f.useLlm && ai} disabled={!ai} onClick={() => set({ useLlm: true })} className={`rounded-l-md px-2.5 py-1 ${f.useLlm && ai ? 'bg-accent text-on-accent' : 'text-muted'}`}>AI order</button>
            <button type="button" aria-pressed={!f.useLlm || !ai} onClick={() => set({ useLlm: false })} className={`rounded-r-md px-2.5 py-1 ${!f.useLlm || !ai ? 'bg-accent text-on-accent' : 'text-muted'}`}>Heuristic order</button>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} />
            Compare side by side (<kbd>c</kbd>)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.showRunnersUp} onChange={(e) => set({ showRunnersUp: e.target.checked })} />
            Next {p.view.runnersUp.length}
          </label>
          <label className="flex items-center gap-2">
            Min score
            <input type="range" min={0} max={1} step={0.05} value={f.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} />
            <span className="tnum">{f.minScore.toFixed(2)}</span>
          </label>
        </div>
      </div>

      {p.compare && <Compare view={p.view} onOpen={p.onOpen} />}

      {p.visible.length === 0 ? (
        <Empty title="No promos match these filters">Clear the search or lower the minimum score.</Empty>
      ) : (
        <div className="space-y-3">
          {p.visible.map((x, i) => (
            <Card key={x.id} p={x} selected={i === p.selected} vote={p.labels[x.id]} onVote={(v) => p.onVote(x.id, v)} onOpen={() => p.onOpen(x.id)} onSelect={() => p.setSelected(i)} />
          ))}
        </div>
      )}
      <BuilderFooter />
    </div>
  );
}
