import { useRef, useState } from 'react';
import { DEFAULT_AGENT, DEFAULT_WEIGHTS } from '../../core/config';
import { PROVIDERS, testConnection, type ConnectionResult } from '../../core/llm/interface';
import type { AgentSettings, ProviderName, Weights } from '../../core/schema';
import type { ThemeChoice } from '../theme';
import { Button, Overlay } from './ui';

export interface LlmSettings {
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
}

interface Props {
  llm: LlmSettings;
  setLlm: (l: LlmSettings) => void;
  agent: AgentSettings;
  setAgent: (a: AgentSettings) => void;
  weights: Weights;
  setWeights: (w: Weights) => void;
  cap: number | null;
  setCap: (c: number | null) => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  onClose: () => void;
}

const SLIDERS: [keyof Weights, string, number][] = [
  ['hook', 'Hook', 1],
  ['cliffhanger', 'Cliffhanger', 1],
  ['standalone', 'Standalone', 1],
  ['duration', 'Duration', 1],
  ['joinPenalty', 'Penalty per join', 0.3],
];

const field = 'mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text';

function ModelSection({ llm, setLlm, agent, setAgent }: Pick<Props, 'llm' | 'setLlm' | 'agent' | 'setAgent'>) {
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const info = PROVIDERS[llm.provider];
  const ai = llm.provider !== 'none';
  const ready = ai && (!info.needsKey || llm.apiKey) && (!info.needsBaseUrl || llm.baseUrl);
  const set = (patch: Partial<LlmSettings>) => {
    setResult(null);
    setLlm({ ...llm, ...patch });
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    setResult(await testConnection({ provider: llm.provider, apiKey: llm.apiKey || undefined, model: llm.model || undefined, baseUrl: llm.baseUrl || undefined, temperature: llm.temperature }));
    setTesting(false);
  };

  return (
    <section aria-labelledby="model-heading">
      <h3 id="model-heading" className="mb-2 text-sm font-semibold">Model</h3>
      <label className="block text-sm">
        Provider
        <select className={field} value={llm.provider} onChange={(e) => {
            // A base URL belongs to the provider it was typed for; switching provider clears it.
            const next = e.target.value as ProviderName;
            set({ provider: next, model: '', baseUrl: next === llm.provider ? llm.baseUrl : '' });
          }}>
          {(Object.keys(PROVIDERS) as ProviderName[]).map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].label}</option>
          ))}
        </select>
      </label>
      {!ai && <p className="mt-2 text-xs text-muted">Rules only. Free, fast, and nothing leaves your browser.</p>}
      {ai && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">{info.browser}</p>
          <label className="block text-sm">
            Model
            <input className={field} list="model-suggestions" value={llm.model} placeholder={info.defaultModel} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
            <datalist id="model-suggestions">{info.suggested.map((m) => <option key={m} value={m} />)}</datalist>
            <span className="mt-1 block text-xs text-muted">Any model name works. Empty uses {info.defaultModel}.</span>
          </label>
          {(info.needsBaseUrl || llm.baseUrl) && (
            <label className="block text-sm">
              Base URL
              <input className={field} value={llm.baseUrl} placeholder={info.baseUrlHint ?? ''} onChange={(e) => set({ baseUrl: e.target.value })} spellCheck={false} />
            </label>
          )}
          <label className="block text-sm">
            API key {info.needsKey ? '' : <span className="text-muted">(optional for local servers)</span>}
            <span className="mt-1 flex gap-1.5">
              <input className={`${field} mt-0`} type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={llm.apiKey} onChange={(e) => set({ apiKey: e.target.value })} aria-label="API key" />
              <Button onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide key' : 'Show key'}>{showKey ? 'Hide' : 'Show'}</Button>
            </span>
          </label>
          <p className="text-xs text-muted">The key stays in this tab's memory. It is never saved, logged, exported or put in the trace, and it is gone on reload. Script excerpts go from your browser straight to this provider.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void test()} disabled={!ready || testing}>{testing ? 'Testing…' : 'Test connection'}</Button>
            {!ready && <span className="text-xs text-muted">{info.needsBaseUrl && !llm.baseUrl ? 'Enter a base URL first.' : 'Enter a key first.'}</span>}
          </div>
          {result && (
            <p role="status" className={`rounded-md border p-2 text-sm ${result.ok ? 'border-ok' : 'border-danger'}`}>
              {result.ok ? (
                <><span className="font-semibold text-ok">✓ Connected.</span> {result.model}, {result.latency_ms} ms.</>
              ) : (
                <><span className="font-semibold text-danger">✕ Failed.</span> {result.message}</>
              )}
            </p>
          )}
          <label className="block text-sm">
            <span className="flex justify-between">Temperature <span className="tnum">{llm.temperature.toFixed(1)}</span></span>
            <input type="range" className="w-full" min={0} max={1} step={0.1} value={llm.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} />
          </label>
          <label className="block text-sm">
            <span className="flex justify-between">AI weight in the final rank (α) <span className="tnum">{agent.alpha.toFixed(2)}</span></span>
            <input type="range" className="w-full" min={0} max={1} step={0.05} value={agent.alpha} onChange={(e) => setAgent({ ...agent, alpha: Number(e.target.value) })} />
            <span className="block text-xs text-muted">final = α × AI score + (1 − α) × heuristic score</span>
          </label>
          <label className="block text-sm">
            Candidates sent to the model
            <input className={field} type="number" min={5} max={60} value={agent.maxCandidates} onChange={(e) => setAgent({ ...agent, maxCandidates: Math.min(60, Math.max(5, Number(e.target.value) || DEFAULT_AGENT.maxCandidates)) })} />
            <span className="mt-1 block text-xs text-muted">About {Math.ceil(agent.maxCandidates / agent.batchSize) + 2} calls per run, at most {agent.callCap}.</span>
          </label>
        </div>
      )}
    </section>
  );
}

export function Settings({ llm, setLlm, agent, setAgent, weights, setWeights, cap, setCap, theme, setTheme, onClose }: Props) {
  const top = useRef<HTMLDivElement>(null);
  return (
    <Overlay title="Settings" onClose={onClose} side>
      <div ref={top} className="space-y-6">
        <ModelSection llm={llm} setLlm={setLlm} agent={agent} setAgent={setAgent} />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Heuristic weights</h3>
            <Button onClick={() => setWeights(DEFAULT_WEIGHTS)}>Reset</Button>
          </div>
          {SLIDERS.map(([k, name, max]) => (
            <label key={k} className="mb-2 block text-sm">
              <span className="flex justify-between">
                {name} <span className="tnum">{weights[k].toFixed(2)}</span>
              </span>
              <input type="range" className="w-full" min={0} max={max} step={0.01} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
            </label>
          ))}
          <p className="text-xs text-muted">Changes apply on the next run.</p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Diversity</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cap !== null} onChange={(e) => setCap(e.target.checked ? 2 : null)} />
            Limit promos per episode
          </label>
          {cap !== null && (
            <label className="mt-2 block text-sm">
              Most per episode
              <input className={field} type="number" min={1} max={10} value={cap} onChange={(e) => setCap(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Theme</h3>
          <div className="flex gap-2" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as ThemeChoice[]).map((t) => (
              <Button key={t} aria-pressed={theme === t} className={theme === t ? 'border-accent!' : ''} onClick={() => setTheme(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </Overlay>
  );
}
