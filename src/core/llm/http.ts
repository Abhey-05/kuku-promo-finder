import type { LlmOptions } from '../schema';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallResult {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** One adapter is one function: messages in, text out. Swapping models touches nothing else. */
export type ModelCall = (messages: Message[], opts: LlmOptions) => Promise<CallResult>;

export type LlmErrorKind = 'auth' | 'not_found' | 'rate_limit' | 'server' | 'network' | 'bad_request' | 'config' | 'other';

/** A provider failure in plain words. The message never contains the key. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server';
  }
}

/** Removes the key from any text before it is shown or logged. */
export function scrub(text: string, key?: string): string {
  let out = text;
  if (key && key.length >= 4) out = out.split(key).join('[key]');
  return out.replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1…').replace(/(AIza[0-9A-Za-z_-]{6})[0-9A-Za-z_-]+/g, '$1…');
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function explain(status: number, detail: string, url: string): [LlmErrorKind, string] {
  const tail = detail ? ` Provider said: ${detail}` : '';
  if (status === 401 || status === 403) return ['auth', `The key was rejected (HTTP ${status}). Check that it is correct and has access to this model.${tail}`];
  if (status === 404) return ['not_found', `Not found (HTTP 404). The model name or the base URL is wrong for ${host(url)}.${tail}`];
  if (status === 429) return ['rate_limit', `Rate limit or quota reached (HTTP 429). Wait a minute, or use a key with more quota.${tail}`];
  if (status >= 500) return ['server', `The provider had a server error (HTTP ${status}). Try again shortly.${tail}`];
  if (status === 400 || status === 422) return ['bad_request', `The provider refused the request (HTTP ${status}).${tail}`];
  return ['other', `Unexpected reply (HTTP ${status}).${tail}`];
}

/** POSTs JSON and turns every failure into an LlmError with a readable message. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: LlmOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: opts.signal });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new LlmError(
      'network',
      `Could not reach ${host(url)}. Either you are offline, the URL is wrong, or the provider blocks requests from a browser (CORS). The command-line tool has no CORS limit.`,
    );
  }
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = data as { error?: { message?: string } | string; message?: string } | null;
    const detail = typeof d?.error === 'string' ? d.error : d?.error?.message ?? d?.message ?? '';
    const [kind, message] = explain(res.status, scrub(String(detail).slice(0, 240), opts.apiKey), url);
    const after = Number(res.headers.get('retry-after'));
    throw new LlmError(kind, message, res.status, Number.isFinite(after) && after > 0 ? after : undefined);
  }
  if (data === null) throw new LlmError('other', `The provider at ${host(url)} did not return JSON.`);
  return data;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries 429 and 5xx up to `tries` attempts in all, waiting 1 s, then 2 s, or the
 * provider's Retry-After when it is shorter than 10 s.
 */
export async function withBackoff<T>(fn: () => Promise<T>, onRetry: (e: LlmError) => void = () => {}, wait = sleep, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LlmError) || !err.retryable || attempt >= tries) throw err;
      onRetry(err);
      await wait(Math.min(10, err.retryAfterS ?? 2 ** (attempt - 1)) * 1000);
    }
  }
}
