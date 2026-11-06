import { formatTimestamp } from '../../core/parse';
import type { Cue, CueFeature, Promo } from '../../core/schema';
import { describeSegments } from '../../core/segment';
import { ScoreBars, Timeline, VoteButtons } from '../components/Promo';
import { Button, CopyButton, Empty } from '../components/ui';
import type { Vote } from '../labels';

const FEATURES: [CueFeature, string][] = [
  ['hook', 'Hook cues'],
  ['cliffhanger', 'Cliffhanger cues'],
  ['standalone', 'Standalone cues'],
];

function CueList({ cues }: { cues: Cue[] }) {
  if (cues.length === 0) return <p className="text-sm text-muted">No cue matched.</p>;
  const seen = new Set<string>();
  const unique = cues.filter((c) => {
    const k = `${c.group}|${c.match}|${c.timestamp}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <ul className="space-y-1 text-sm">
      {unique.map((c, i) => (
        <li key={i}>
          <span className="tnum">{c.weight > 0 ? '+' : ''}{c.weight.toFixed(2)}</span> {c.group}: <em>{c.match}</em>{' '}
          <span className="tnum text-xs text-muted">Ep {c.episode} {formatTimestamp(c.timestamp)}</span>
        </li>
      ))}
    </ul>
  );
}

function SegmentText({ promo }: { promo: Promo }) {
  return (
    <div className="space-y-5">
      {promo.segments.map((s, i) => (
        <section key={i}>
          <h3 className="text-sm font-semibold">Segment {i + 1}: {describeSegments([s])}</h3>
          <p className="mb-2 text-xs text-muted">{s.scene_headings.join(' / ')}</p>
          <div className="space-y-1 text-sm">
            {s.text.split(/\n(?=\[\d)/).map((line, j) => {
              const m = line.match(/^\[(.+?)\] (CAMERA|ACTION|SFX)?(?:: )?([\s\S]*)$/);
              const dim = m?.[2] === 'CAMERA';
              return (
                <p key={j} className={`m-0 break-words ${dim ? 'text-muted' : ''}`}>
                  <span className="tnum text-xs text-muted">{m?.[1]}</span> {m?.[2] ? <span className="text-xs text-muted">{m[2]}: </span> : null}{m?.[3] ?? line}
                </p>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Detail({ promo, vote, onVote, onBack }: { promo?: Promo; vote?: Vote; onVote: (v: Vote) => void; onBack: () => void }) {
  if (!promo) {
    return (
      <Empty title="This promo is not in the current run">
        <div className="mt-3"><Button onClick={onBack}>Back to results</Button></div>
      </Empty>
    );
  }
  const { cues: _cues, ...json } = promo;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onBack} aria-label="Back to results">← Results</Button>
        <h1 className="text-xl font-semibold">Promo #{promo.rank}</h1>
        <span className="tnum text-sm text-muted">{promo.total_duration_s.toFixed(1)} s, score {promo.scores.total.toFixed(3)}</span>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <Timeline promo={promo} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4" style={{ boxShadow: 'inset 3px 0 0 var(--accent)' }}>
          <p className="text-xs font-semibold text-muted">HOOK, Ep {promo.hook.episode} {formatTimestamp(promo.hook.timestamp)}, {promo.hook.source_type}</p>
          <p className="mt-1 text-sm">{promo.hook.text}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4" style={{ boxShadow: 'inset 3px 0 0 var(--ink-bar)' }}>
          <p className="text-xs font-semibold text-muted">CLIFFHANGER, Ep {promo.cliffhanger.episode} {formatTimestamp(promo.cliffhanger.timestamp)}, {promo.cliffhanger.source_type}</p>
          <p className="mt-1 text-sm">{promo.cliffhanger.text}</p>
        </div>
      </section>

      <p className="text-sm">{promo.judge.source === 'llm' && promo.judge.reason ? promo.judge.reason : promo.why}</p>

      <div className="flex flex-wrap items-center gap-2">
        <VoteButtons vote={vote} onVote={onVote} />
        <CopyButton text={JSON.stringify(json, null, 2)} label="Copy JSON" />
        <CopyButton text={describeSegments(promo.segments)} label="Copy timestamps" />
      </div>

      <section className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
          <SegmentText promo={promo} />
        </div>
        <div className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Score breakdown</h2>
          <ScoreBars promo={promo} wide />
          {promo.scores.join_penalty > 0 && <p className="text-xs text-muted">Join penalty: −{promo.scores.join_penalty.toFixed(2)}</p>}
          {FEATURES.map(([f, name]) => (
            <div key={f}>
              <h3 className="mb-1 text-sm font-semibold">{name}</h3>
              <CueList cues={promo.cues.filter((c) => c.feature === f)} />
            </div>
          ))}
          {promo.flags.length > 0 && <p className="text-xs text-muted">Flags: {promo.flags.join(', ')}</p>}
        </div>
      </section>
    </div>
  );
}
