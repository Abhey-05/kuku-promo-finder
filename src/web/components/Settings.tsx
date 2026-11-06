import { DEFAULT_MODELS } from '../../core/llm/interface';
import { DEFAULT_WEIGHTS } from '../../core/config';
import type { ProviderName, Weights } from '../../core/schema';
import type { ThemeChoice } from '../theme';
import { Button, Overlay } from './ui';

export interface LlmSettings {
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface Props {
  llm: LlmSettings;
  setLlm: (l: LlmSettings) => void;
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

export function Settings({ llm, setLlm, weights, setWeights, cap, setCap, theme, setTheme, onClose }: Props) {
  return (
    <Overlay title="Settings" onClose={onClose} side>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Model</h3>
          <label className="block text-sm">
            Provider
            <select className={field} value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.target.value as ProviderName })}>
              <option value="none">None: rules only, no key needed</option>
              <option value="gemini">Gemini</option>
              <option value="openai-compatible">OpenAI-compatible (Groq, OpenRouter, Ollama)</option>
            </select>
          </label>
          {llm.provider !== 'none' && (
            <div className="mt-3 space-y-3">
              <label className="block text-sm">
                Model name
                <input className={field} value={llm.model} placeholder={DEFAULT_MODELS[llm.provider]} onChange={(e) => setLlm({ ...llm, model: e.target.value })} />
              </label>
              {llm.provider === 'openai-compatible' && (
                <label className="block text-sm">
                  Base URL
                  <input className={field} value={llm.baseUrl} placeholder="https://api.groq.com/openai/v1" onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })} />
                </label>
              )}
              <label className="block text-sm">
                API key
                <input className={field} type="password" autoComplete="off" value={llm.apiKey} onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })} />
              </label>
              <p className="text-xs text-muted">
                The key stays in this tab's memory and is gone on reload. Candidate excerpts go straight from your browser to the provider you choose, so use one you are allowed to send the script to.
              </p>
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Weights</h3>
            <Button onClick={() => setWeights(DEFAULT_WEIGHTS)}>Reset to defaults</Button>
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
