import { formatTimestamp } from '../../core/parse';
import type { AgentTrace, Cue, CueFeature, Promo } from '../../core/schema';
import { candidateId, describeSegments } from '../../core/segment';
import { AgentTracePanel, Flags, ScoreBars, ScoreChips, Timeline, VoteButtons } from '../components/Promo';
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

function AiJudge({ promo }: { promo: Promo }) {
  if (!promo.ai && promo.judge.source !== 'llm') return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">AI judge</h2>
      {promo.ai ? (
        <>
          <p className="tnum mt-1 text-sm">
            Hook {promo.ai.hook}/5, cliffhanger {promo.ai.cliffhanger}/5, standalone {promo.ai.standalone}/5. AI score {promo.ai.score.toFixed(3)}; heuristic {promo.heuristic_score.toFixed(3)} (rank #{promo.heuristic_rank}); final {promo.final_score.toFixed(3)}.
          </p>
          <p className="mt-2 text-sm"><span className="text-muted">Judge's reason:</span> {promo.ai.reason}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">The judge's ratings for this promo failed the checks, so it kept its heuristic score.</p>
      )}
      {promo.judge.reason && promo.judge.reason !== promo.ai?.reason && <p className="mt-2 text-sm"><span className="text-muted">Write-up:</span> {promo.judge.reason}</p>}
      {promo.refined_from && <p className="mt-2 text-sm"><span className="text-muted">Re-cut by the AI from</span> <span className="tnum">{describeSegments(promo.refined_from)}</span>.</p>}
    </section>
  );
}

export function Detail({ promo, trace, vote, onVote, onBack }: { promo?: Promo; trace?: AgentTrace; vote?: Vote; onVote: (v: Vote) => void; onBack: () => void }) {
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
        <span className="tnum text-sm text-muted">{promo.total_duration_s.toFixed(1)} s</span>
        <ScoreChips promo={promo} />
        <Flags flags={promo.flags} />
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

      <AiJudge promo={promo} />

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
          <h2 className="text-sm font-semibold">Heuristic score breakdown</h2>
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

      {trace?.mode === 'ai' && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">This promo in the agent trace</h2>
          <AgentTracePanel trace={trace} onlyItem={[promo.id, ...(promo.refined_from ? [candidateId(promo.refined_from)] : [])]} />
        </section>
      )}
    </div>
  );
}
