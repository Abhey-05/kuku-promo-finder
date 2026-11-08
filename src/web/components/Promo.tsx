import { formatTimestamp } from '../../core/parse';
import type { AgentTrace, Promo, TraceStage } from '../../core/schema';
import { HOOK_WINDOW_S, CLIFF_WINDOW_S } from '../../core/features';
import type { Vote } from '../labels';
import { Button, Chip } from './ui';

export function ScoreBars({ promo, wide = false }: { promo: Promo; wide?: boolean }) {
  const rows: [string, number][] = [
    ['Hook', promo.scores.hook],
    ['Cliffhanger', promo.scores.cliffhanger],
    ['Standalone', promo.scores.standalone],
    ['Duration', promo.scores.duration],
  ];
  return (
    <div className={`grid gap-1 ${wide ? '' : 'sm:grid-cols-2 sm:gap-x-6'}`}>
      {rows.map(([name, v]) => (
        <div key={name} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 text-muted">{name}</span>
          <div className="h-2 flex-1 rounded-sm bg-track" role="img" aria-label={`${name} ${v.toFixed(2)} out of 1`}>
            <div className="h-2 rounded-sm bg-ink-bar" style={{ width: `${v * 100}%` }} />
          </div>
          <span className="tnum w-9 text-right">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

/** Heuristic score, AI score and the blended final, side by side. */
export function ScoreChips({ promo }: { promo: Promo }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip title="Rule-based score, 0 to 1">Heuristic <span className="tnum">{promo.heuristic_score.toFixed(3)}</span> · #{promo.heuristic_rank}</Chip>
      {promo.ai && (
        <Chip title="AI judge: hook / cliffhanger / standalone, each 1 to 5">
          AI <span className="tnum">{promo.ai.hook}/{promo.ai.cliffhanger}/{promo.ai.standalone}</span>
        </Chip>
      )}
      {promo.ai && <Chip strong title="Blended score used for the rank">Final <span className="tnum">{promo.final_score.toFixed(3)}</span></Chip>}
    </div>
  );
}

const FLAG_NAMES: Record<string, string> = {
  'late-story-spoiler-risk': 'spoiler risk',
  stitched: 'stitched',
  llm_fallback: 'AI fallback',
  refined: 'AI re-cut',
  'cross-episode': 'cross-episode',
};

export function Flags({ flags, all = false }: { flags: string[]; all?: boolean }) {
  const shown = all ? flags : flags.filter((f) => f in FLAG_NAMES);
  if (!shown.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Flags">
      {shown.map((f) => (
        <li key={f}>
          <Chip strong={f === 'llm_fallback' || f === 'late-story-spoiler-risk'}>{FLAG_NAMES[f] ?? f.replace(/-/g, ' ')}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** A thin strip: each segment to scale, hook window at the start, cliffhanger window at the end. */
export function MiniTimeline({ promo }: { promo: Promo }) {
  const total = promo.total_duration_s;
  const last = promo.segments.length - 1;
  return (
    <div className="flex h-2 gap-0.5" role="img" aria-label={`Timeline: ${promo.segments.length} segment${promo.segments.length > 1 ? 's' : ''}, ${total.toFixed(1)} seconds`}>
      {promo.segments.map((s, i) => {
        const d = s.end - s.start;
        return (
          <div key={i} className="relative h-2 overflow-hidden rounded-sm bg-track" style={{ flex: `${d / total} 1 0` }}>
            {i === 0 && <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.min(100, (HOOK_WINDOW_S / d) * 100)}%` }} />}
            {i === last && <div className="absolute inset-y-0 right-0 bg-ink-bar" style={{ width: `${Math.min(100, (CLIFF_WINDOW_S / d) * 100)}%` }} />}
          </div>
        );
      })}
    </div>
  );
}

/** Each segment is drawn to scale. Accent marks the hook window, ink marks the cliffhanger window. */
export function Timeline({ promo }: { promo: Promo }) {
  const total = promo.total_duration_s;
  const last = promo.segments.length - 1;
  return (
    <div className="overflow-x-auto pb-2" tabIndex={0} aria-label="Promo timeline">
      <div className="flex min-w-[520px] gap-2">
        {promo.segments.map((s, i) => {
          const d = s.end - s.start;
          const hookPct = Math.min(100, (HOOK_WINDOW_S / d) * 100);
          const cliffPct = Math.min(100, (CLIFF_WINDOW_S / d) * 100);
          return (
            <div key={i} style={{ flex: `${d / total} 1 0` }} className="min-w-0">
              <p className="mb-1 text-xs font-semibold">Episode {s.episode}</p>
              <div className="relative h-10 rounded bg-track">
                {i === 0 && <div className="absolute inset-y-0 left-0 rounded-l bg-accent" style={{ width: `${hookPct}%` }} />}
                {i === last && <div className="absolute inset-y-0 right-0 rounded-r bg-ink-bar" style={{ width: `${cliffPct}%` }} />}
              </div>
              <div className="tnum mt-1 flex justify-between text-xs text-muted">
                <span>{formatTimestamp(s.start)}</span>
                <span>{formatTimestamp(s.end)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent" /> Hook window, first 3 s. Hook at {formatTimestamp(promo.hook.timestamp)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-ink-bar" /> Cliffhanger window, last 5 s. Cue at {formatTimestamp(promo.cliffhanger.timestamp)}
        </span>
      </div>
    </div>
  );
}

export function VoteButtons({ vote, onVote }: { vote?: Vote; onVote: (v: Vote) => void }) {
  return (
    <div className="flex gap-1">
      <Button aria-label="Thumbs up: post this promo" aria-pressed={vote === 'up'} onClick={() => onVote('up')} className={vote === 'up' ? 'border-accent!' : ''}>
        👍
      </Button>
      <Button aria-label="Thumbs down: do not post this promo" aria-pressed={vote === 'down'} onClick={() => onVote('down')} className={vote === 'down' ? 'border-accent!' : ''}>
        👎
      </Button>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  shortlist: 'Shortlist (code)',
  judge: 'Judge (AI)',
  refine: 'Refine cuts (AI)',
  writeup: 'Write-up (AI)',
  verify: 'Verify (code)',
  rank: 'Final rank (code)',
};

const tokens = (s: TraceStage) => (s.input_tokens === null && s.output_tokens === null ? '–' : `${s.input_tokens ?? '?'} / ${s.output_tokens ?? '?'}`);

/** Every stage of the run: what went in, what came out, and what the verifier threw away. */
export function AgentTracePanel({ trace, onlyItem }: { trace: AgentTrace; onlyItem?: string[] }) {
  const stages = trace.stages.map((s) => ({
    ...s,
    rejected: onlyItem ? s.rejected.filter((r) => r.item && onlyItem.includes(r.item)) : s.rejected,
    fallbacks: onlyItem ? s.fallbacks.filter((f) => onlyItem.includes(f)) : s.fallbacks,
  }));
  return (
    <div className="space-y-3 text-sm">
      {!onlyItem && (
        <p className="text-muted">
          {trace.mode === 'ai' ? (
            <>
              {trace.provider}/{trace.model}, temperature {trace.temperature}, α {trace.alpha}. {trace.calls} of {trace.call_cap} calls used. Tokens in/out: {trace.input_tokens ?? '?'} / {trace.output_tokens ?? '?'}. Cost: {trace.estimated_cost_usd === null ? 'no price on file for this model' : `about $${trace.estimated_cost_usd.toFixed(4)}`}.
            </>
          ) : (
            'Heuristic only. No model was called.'
          )}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Stage</th>
              <th className="py-1 pr-3 font-medium">Model</th>
              <th className="py-1 pr-3 font-medium">In → out</th>
              <th className="py-1 pr-3 font-medium">Calls</th>
              <th className="py-1 pr-3 font-medium">Tokens in / out</th>
              <th className="py-1 pr-3 font-medium">Time</th>
              <th className="py-1 pr-3 font-medium">Rejected</th>
              <th className="py-1 pr-3 font-medium">Retries</th>
              <th className="py-1 font-medium">Fallbacks</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {stages.map((s) => (
              <tr key={s.stage} className="border-t border-border">
                <td className="py-1 pr-3 font-sans">{STAGE_LABEL[s.stage] ?? s.stage}</td>
                <td className="py-1 pr-3">{s.model ?? '–'}</td>
                <td className="py-1 pr-3">{s.items_in} → {s.items_out}</td>
                <td className="py-1 pr-3">{s.calls}</td>
                <td className="py-1 pr-3">{tokens(s)}</td>
                <td className="py-1 pr-3">{s.latency_ms ? `${(s.latency_ms / 1000).toFixed(1)} s` : '–'}</td>
                <td className={`py-1 pr-3 ${s.rejected.length ? 'text-danger' : ''}`}>{s.rejected.length}</td>
                <td className="py-1 pr-3">{s.retries}</td>
                <td className={`py-1 ${s.fallbacks.length ? 'text-danger' : ''}`}>{s.fallbacks.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stages.some((s) => s.rejected.length || s.notes.length) && (
        <ul className="space-y-1 text-xs">
          {stages.flatMap((s) => [
            ...s.rejected.map((r, i) => (
              <li key={`${s.stage}-r${i}`}>
                <span className="text-danger">Rejected</span> in {s.stage}, reply {r.attempt}: {r.reason}
              </li>
            )),
            ...(onlyItem ? [] : s.notes.map((n, i) => <li key={`${s.stage}-n${i}`} className="text-muted">{s.stage}: {n}</li>)),
          ])}
        </ul>
      )}
    </div>
  );
}
