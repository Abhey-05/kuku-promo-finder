import { formatTimestamp } from '../../core/parse';
import type { Promo } from '../../core/schema';
import { HOOK_WINDOW_S, CLIFF_WINDOW_S } from '../../core/features';
import type { Vote } from '../labels';
import { Button } from './ui';

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
              <div className="relative h-8 rounded bg-track">
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
