import { readFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { DEFAULT_CONFIG } from '../core/config';
import { PROVIDERS } from '../core/llm/interface';
import type { Config, LlmOptions, ProviderName } from '../core/schema';

export const USAGE = `Usage: npm run cli -- --input <folder-or-zip> --out runs/<label> [options]

Options (flags win over environment variables):
  --provider none|anthropic|openai|gemini|openai-compatible   env KUKU_LLM_PROVIDER   (default none)
  --model <name>                                              env KUKU_LLM_MODEL      (default per provider)
  --base-url <url>                                            env KUKU_LLM_BASE_URL   (openai-compatible)
  --temperature <0..2>                                        env KUKU_LLM_TEMPERATURE (default 0)
  --alpha <0..1>                                              env KUKU_LLM_ALPHA      (default 0.6)
  --max-candidates <n>                                        env KUKU_LLM_MAX_CANDIDATES (default 30)
  --top <n>  --max-per-episode <n|off>  --weights <file.json>
  --test-connection     Send one tiny request and exit.
The API key is read only from KUKU_LLM_API_KEY (or LLM_API_KEY), never from a flag, so it stays out of shell history.
Inputs inside input_pack/ are not sent to a provider unless KUKU_ALLOW_PACK_TO_LLM=1.`;

export interface CliSettings {
  input?: string;
  out?: string;
  testConnection: boolean;
  config: Config;
  llm: Omit<LlmOptions, 'provider'>;
  errors: string[];
}

const PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[];

function num(v: string | undefined, name: string, min: number, max: number, errors: string[]): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${name} must be a number from ${min} to ${max}, got "${v}".`);
    return undefined;
  }
  return n;
}

/** Reads flags and environment into a run config. Pure apart from reading a weights file. */
export function readCli(argv: string[], env: Record<string, string | undefined>): CliSettings {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pick = (flag: string, key: string) => arg(flag) ?? env[key];
  const errors: string[] = [];

  const provider = (pick('provider', 'KUKU_LLM_PROVIDER') ?? 'none') as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) errors.push(`Unknown provider "${provider}". Use one of: ${PROVIDER_NAMES.join(', ')}.`);
  if (argv.includes('--api-key')) errors.push('Do not pass the key as a flag. Set KUKU_LLM_API_KEY instead.');

  const out = arg('out');
  const cap = arg('max-per-episode');
  const weightsPath = arg('weights');
  const d = DEFAULT_CONFIG;
  const config: Config = {
    ...d,
    label: out ? basename(out) : 'run',
    provider,
    top: num(arg('top'), '--top', 1, 50, errors) ?? d.top,
    maxPerEpisode: cap === undefined ? d.maxPerEpisode : cap === 'off' ? null : num(cap, '--max-per-episode', 1, 50, errors) ?? d.maxPerEpisode,
    weights: weightsPath ? JSON.parse(readFileSync(weightsPath, 'utf8')) : d.weights,
    agent: {
      ...d.agent,
      alpha: num(pick('alpha', 'KUKU_LLM_ALPHA'), 'alpha', 0, 1, errors) ?? d.agent.alpha,
      maxCandidates: num(pick('max-candidates', 'KUKU_LLM_MAX_CANDIDATES'), 'max candidates', 1, 100, errors) ?? d.agent.maxCandidates,
    },
  };
  const llm = {
    apiKey: env.KUKU_LLM_API_KEY || env.LLM_API_KEY || undefined,
    model: pick('model', 'KUKU_LLM_MODEL') || undefined,
    baseUrl: pick('base-url', 'KUKU_LLM_BASE_URL') || undefined,
    temperature: num(pick('temperature', 'KUKU_LLM_TEMPERATURE'), 'temperature', 0, 2, errors) ?? 0,
  };
  if (provider !== 'none' && PROVIDERS[provider]?.needsKey && !llm.apiKey) errors.push(`${provider} needs a key. Set KUKU_LLM_API_KEY.`);
  if (provider === 'openai-compatible' && !llm.baseUrl) errors.push('openai-compatible needs --base-url or KUKU_LLM_BASE_URL.');

  const input = arg('input');
  const testConnection = argv.includes('--test-connection');
  if (!testConnection && (!input || !out)) errors.push('Both --input and --out are required.');
  if (input && provider !== 'none' && insidePack(input) && env.KUKU_ALLOW_PACK_TO_LLM !== '1') {
    errors.push('The input is inside input_pack/, which is confidential. It is not sent to a provider unless KUKU_ALLOW_PACK_TO_LLM=1 is set. Run with --provider none, or set that variable if you are allowed to share the pack with this provider.');
  }
  return { input, out, testConnection, config, llm, errors };
}

export function insidePack(path: string): boolean {
  const p = resolve(path);
  return p.split(sep).includes('input_pack');
}
