import { useEffect, useMemo, useRef } from 'react';
import { formatTimestamp } from '../../core/parse';
import type { Promo, RunView } from '../../core/schema';
import { BuilderFooter } from '../components/BuilderCard';
import { ScoreBars, VoteButtons } from '../components/Promo';
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
  onVote: (id: string, v: Vote) => void;
  onOpen: (id: string) => void;
  onExport: () => void;
  onExportLabels: () => void;
  onUpload: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

export function applyFilters(view: RunView, f: ResultFilters): Promo[] {
  const base = f.useLlm ? view.promos : view.heuristicPromos;
  const list = f.showRunnersUp ? [...base, ...view.runnersUp] : base;
  const q = f.query.trim().toLowerCase();
  const out = list.filter(
    (p) =>
      (!f.episode || p.episodes.includes(Number(f.episode))) &&
      p.scores.total >= f.minScore &&
      (!q || `${p.hook.text} ${p.cliffhanger.text} ${p.why} ${p.segments.map((s) => s.text).join(' ')}`.toLowerCase().includes(q)),
  );
  if (f.sort === 'duration') return [...out].sort((a, b) => a.total_duration_s - b.total_duration_s || a.rank - b.rank);
  if (f.sort === 'episode') return [...out].sort((a, b) => a.episodes[0] - b.episodes[0] || a.segments[0].start - b.segments[0].start);
  return out;
}

const control = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text';

function Card({ p, selected, vote, onVote, onOpen, onSelect, displayRank }: { p: Promo; selected: boolean; vote?: Vote; onVote: (v: Vote) => void; onOpen: () => void; onSelect: () => void; displayRank: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <article ref={ref} onClick={onSelect} aria-current={selected ? 'true' : undefined} className={`rounded-lg border bg-surface p-4 ${selected ? 'border-accent' : 'border-border'}`} style={selected ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-semibold tnum">#{displayRank}</span>
        {p.segments.map((s, i) => (
          <span key={i} className="tnum rounded bg-surface-2 px-2 py-0.5 text-xs">
            Ep {s.episode} {formatTimestamp(s.start)}–{formatTimestamp(s.end)}
          </span>
        ))}
        <span className="tnum text-sm text-muted">{p.total_duration_s.toFixed(1)} s</span>
        <span className="tnum ml-auto text-sm font-semibold">{p.scores.total.toFixed(3)}</span>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="inline font-semibold">Hook <span className="tnum font-normal text-muted">{formatTimestamp(p.hook.timestamp)}</span> </dt>
          <dd className="inline">{p.hook.text}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Cliffhanger <span className="tnum font-normal text-muted">{formatTimestamp(p.cliffhanger.timestamp)}</span> </dt>
          <dd className="inline">{p.cliffhanger.text}</dd>
        </div>
        <div>
          <dt className="sr-only">Why it works</dt>
          <dd className="text-muted">{p.judge.source === 'llm' && p.judge.reason ? p.judge.reason : p.why}</dd>
        </div>
      </dl>
      <div className="mt-3"><ScoreBars promo={p} /></div>
      {p.flags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5 text-xs text-muted" aria-label="Flags">
          {p.flags.map((f) => <li key={f} className="rounded border border-border px-1.5">{f.replace(/-/g, ' ')}</li>)}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between">
        <VoteButtons vote={vote} onVote={onVote} />
        <Button onClick={onOpen}>Open</Button>
      </div>
    </article>
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
  const { log } = p.view;
  const llmRan = log.llm.provider !== 'none' && !log.llm.fallback_used;
  const labelled = Object.keys(p.labels).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ranked promos</h1>
          <p className="text-sm text-muted">
            {log.counts.episodes} episodes, {(log.counts.single_candidates + log.counts.multi_candidates).toLocaleString('en-US')} candidates, {log.counts.after_nms} after removing overlaps, {Object.values(log.timings_ms).reduce((a, b) => a + b, 0)} ms.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={p.onExportLabels} disabled={labelled === 0}>Export labels ({labelled})</Button>
          <Button variant="primary" onClick={p.onExport}>Export run</Button>
        </div>
      </div>

      {log.llm.fallback_used && (
        <div role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm">
          The model reply failed validation or the call failed, so this is the rule-based order. Reason: {log.llm.notes[log.llm.notes.length - 1]}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={p.searchRef} type="search" aria-label="Search promos" placeholder="Search text (/)" className={`${control} min-w-0 flex-1 basis-48`} value={f.query} onChange={(e) => set({ query: e.target.value })} />
        <select aria-label="Filter by episode" className={control} value={f.episode} onChange={(e) => set({ episode: e.target.value })}>
          <option value="">All episodes</option>
          {episodes.map((e) => <option key={e} value={e}>Episode {e}</option>)}
        </select>
        <select aria-label="Sort" className={control} value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          <option value="rank">Sort by rank</option>
          <option value="duration">Sort by duration</option>
          <option value="episode">Sort by episode</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          Min score
          <input type="range" min={0} max={1} step={0.05} value={f.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} />
          <span className="tnum">{f.minScore.toFixed(2)}</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.showRunnersUp} onChange={(e) => set({ showRunnersUp: e.target.checked })} />
          Show the next {p.view.runnersUp.length} candidates
        </label>
        <label className={`flex items-center gap-2 ${llmRan ? '' : 'text-muted'}`} title={llmRan ? '' : 'Needs a model run'}>
          <input type="checkbox" disabled={!llmRan} checked={f.useLlm && llmRan} onChange={(e) => set({ useLlm: e.target.checked })} />
          Model order {llmRan ? '' : '(no model used in this run)'}
        </label>
      </div>

      {p.visible.length === 0 ? (
        <Empty title="No promos match these filters">Clear the search or lower the minimum score.</Empty>
      ) : (
        <div className="space-y-3">
          {p.visible.map((x, i) => (
            <Card key={x.id} p={x} displayRank={x.rank} selected={i === p.selected} vote={p.labels[x.id]} onVote={(v) => p.onVote(x.id, v)} onOpen={() => p.onOpen(x.id)} onSelect={() => p.setSelected(i)} />
          ))}
        </div>
      )}
      <BuilderFooter />
    </div>
  );
}
