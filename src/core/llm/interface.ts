import type { LlmOptions, ProviderName } from '../schema';
import { anthropicCall } from './anthropic';
import { geminiCall } from './gemini';
import { LlmError, scrub, type ModelCall } from './http';
import { openAiCall } from './openai';
import { openAiCompatibleCall } from './openai-compatible';

export type RemoteProvider = Exclude<ProviderName, 'none'>;

export const ADAPTERS: Record<RemoteProvider, ModelCall> = {
  anthropic: anthropicCall,
  openai: openAiCall,
  gemini: geminiCall,
  'openai-compatible': openAiCompatibleCall,
};

export interface ProviderInfo {
  label: string;
  defaultModel: string;
  /** Suggestions only. The model field takes any name. */
  suggested: string[];
  needsKey: boolean;
  needsBaseUrl: boolean;
  baseUrlHint?: string;
  /** What a browser can do with this provider, as checked in docs/QA.md. */
  browser: string;
}

export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  none: { label: 'Heuristic only (no key)', defaultModel: '', suggested: [], needsKey: false, needsBaseUrl: false, browser: '' },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-5-5',
    suggested: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    needsKey: true,
    needsBaseUrl: false,
    browser: 'Browser calls allowed with the direct-access header.',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    suggested: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
    needsKey: true,
    needsBaseUrl: false,
    browser: 'Browser calls allowed.',
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    suggested: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    needsKey: true,
    needsBaseUrl: false,
    browser: 'Browser calls allowed.',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible (Groq, OpenRouter, Together, Ollama, Kuku)',
    defaultModel: 'llama-3.3-70b-versatile',
    suggested: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen2.5:7b'],
    needsKey: false,
    needsBaseUrl: true,
    baseUrlHint: 'https://api.groq.com/openai/v1',
    browser: 'Depends on the endpoint. Groq and OpenRouter allow browser calls; local Ollama needs OLLAMA_ORIGINS set. If the browser is blocked, use the CLI.',
  },
};

/** USD per million tokens [input, output]. Only prices we have checked; others report tokens only. */
const PRICES: Record<string, [number, number]> = {
  'gemini-2.5-flash': [0.3, 2.5],
};

export function estimateCost(model: string | null, input: number | null, output: number | null): number | null {
  const p = model ? PRICES[model] : undefined;
  if (!p || input === null || output === null) return null;
  return Math.round(((input * p[0] + output * p[1]) / 1e6) * 1e6) / 1e6;
}

/** Fills in the default model. Leaves the key as given. */
export function resolveOptions(opts: LlmOptions): LlmOptions {
  if (opts.provider === 'none') return opts;
  return { ...opts, model: opts.model?.trim() || PROVIDERS[opts.provider].defaultModel, baseUrl: opts.baseUrl?.trim() || undefined, temperature: opts.temperature ?? 0 };
}

export type ConnectionResult =
  | { ok: true; model: string; latency_ms: number; reply: string }
  | { ok: false; kind: string; message: string; latency_ms: number };

/** Sends one tiny request. Reports the model the provider says it used, or the error in plain words. */
export async function testConnection(raw: LlmOptions, call?: ModelCall): Promise<ConnectionResult> {
  const t0 = Date.now();
  if (raw.provider === 'none') return { ok: false, kind: 'config', message: 'Pick a provider first.', latency_ms: 0 };
  const opts = resolveOptions(raw);
  try {
    const res = await (call ?? ADAPTERS[raw.provider])([{ role: 'user', content: 'Reply with the JSON {"ok":true} and nothing else.' }], opts);
    return { ok: true, model: res.model ?? opts.model ?? '', latency_ms: Date.now() - t0, reply: res.text.slice(0, 80) };
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'other';
    const message = err instanceof Error ? scrub(err.message, opts.apiKey) : 'Unknown error.';
    return { ok: false, kind, message, latency_ms: Date.now() - t0 };
  }
}
