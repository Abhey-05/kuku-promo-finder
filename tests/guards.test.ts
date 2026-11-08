import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCli, withDotEnv } from '../src/cli/config';
import { listGeminiModels } from '../src/core/llm/gemini';
// @ts-expect-error plain .mjs helper
import { viteKeyVars } from '../scripts/check-env.mjs';
// @ts-expect-error plain .mjs helper
import { scanBundle } from '../scripts/check-bundle.mjs';

const FAKE = 'AIza' + 'Sy' + 'X'.repeat(33);

describe('.env loading for the CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kuku-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, `KUKU_LLM_PROVIDER=gemini\nKUKU_LLM_MODEL=gemini-from-file\nGEMINI_API_KEY=${FAKE}\n`);

  it('reads GEMINI_API_KEY from .env for the gemini provider', () => {
    const r = readCli(['--input', 'samples/demo-show', '--out', 'runs/x'], withDotEnv({}, file));
    expect(r.errors).toEqual([]);
    expect(r.config.provider).toBe('gemini');
    expect(r.llm.apiKey).toBe(FAKE);
    expect(r.llm.model).toBe('gemini-from-file');
  });
  it('lets the shell override .env, and flags override both', () => {
    const env = withDotEnv({ KUKU_LLM_MODEL: 'from-shell' }, file);
    expect(readCli(['--input', 'a', '--out', 'b'], env).llm.model).toBe('from-shell');
    expect(readCli(['--input', 'a', '--out', 'b', '--model', 'from-flag'], env).llm.model).toBe('from-flag');
  });
  it('does not use GEMINI_API_KEY for another provider', () => {
    const r = readCli(['--input', 'a', '--out', 'b', '--provider', 'openai'], withDotEnv({}, file));
    expect(r.llm.apiKey).toBeUndefined();
    expect(r.errors.join()).toMatch(/needs a key/);
  });
  it('is a no-op when there is no .env', () => {
    expect(withDotEnv({ A: '1' }, join(dir, 'missing'))).toEqual({ A: '1' });
  });
  it('keeps the confidential pack guard with a .env key', () => {
    const r = readCli(['--input', 'input_pack/x', '--out', 'b'], withDotEnv({}, file));
    expect(r.errors.join()).toMatch(/confidential/);
  });
  it('.env is ignored by git and .env.example is not', () => {
    expect(existsSync('.env.example')).toBe(true);
    const ignored = (p: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', p]);
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored('.env')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
    expect(ignored('.env.example')).toBe(false);
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^GEMINI_API_KEY=$/m);
  });
});

describe('Gemini model list', () => {
  it('lists generateContent models with the key in a header, not the URL', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const fake = (async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, headers: init.headers };
      return new Response(JSON.stringify({ models: [
        { name: 'models/gemini-x-flash', displayName: 'X Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const models = await listGeminiModels({ provider: 'gemini', apiKey: FAKE }, fake);
    expect(models).toEqual([{ name: 'gemini-x-flash', displayName: 'X Flash' }]);
    expect(seen!.url).not.toContain(FAKE);
    expect(seen!.headers['x-goog-api-key']).toBe(FAKE);
  });
  it('reports a bad key in plain words without echoing it', async () => {
    const fake = (async () => new Response(`{"error":{"message":"API key not valid. ${FAKE}"}}`, { status: 400 })) as unknown as typeof fetch;
    await expect(listGeminiModels({ provider: 'gemini', apiKey: FAKE }, fake)).rejects.toThrow(/HTTP 400/);
    await listGeminiModels({ provider: 'gemini', apiKey: FAKE }, fake).catch((e: Error) => expect(e.message).not.toContain(FAKE));
  });
});

describe('the key never reaches the browser bundle', () => {
  it('prebuild check flags VITE_ key variables', () => {
    expect(viteKeyVars({ VITE_GEMINI_API_KEY: 'x', VITE_BASE: '/a/', GEMINI_API_KEY: 'y' })).toEqual(['VITE_GEMINI_API_KEY']);
    expect(viteKeyVars({ VITE_BASE: '/a/' })).toEqual([]);
  });
  it('post-build scan finds an AIza key or a key value', () => {
    const d = mkdtempSync(join(tmpdir(), 'kuku-dist-'));
    writeFileSync(join(d, 'a.js'), 'const ok = 1;');
    expect(scanBundle(d, {})).toEqual([]);
    writeFileSync(join(d, 'b.js'), `const k = "${FAKE}";`);
    expect(scanBundle(d, {}).length).toBeGreaterThan(0);
    writeFileSync(join(d, 'b.js'), 'const k = "plain-secret-value-123";');
    expect(scanBundle(d, { GEMINI_API_KEY: 'plain-secret-value-123' }).length).toBeGreaterThan(0);
  });
  it('the current dist/ is clean, if built', () => {
    if (!existsSync('dist') || !statSync('dist').isDirectory()) return;
    expect(scanBundle('dist', {})).toEqual([]);
  }, 120_000);
});

// The strings are stored encoded so this file does not itself contain them.
const OLD_IDENTITY = ['UmlzaGFi', 'UmlzaGll', 'R2F1dGFt', 'ZWUyNGJ0ZWNoMTEyMjA=', 'aWl0aC5hYy5pbg=='].map((b) => Buffer.from(b, 'base64').toString('utf8'));

describe('identity', () => {
  it('no tracked file mentions the previous identity', () => {
    const re = new RegExp(OLD_IDENTITY.map((s) => s.replace(/\./g, '\\.')).join('|'), 'i');
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const extra = ['dist', 'BUILDER.md'].filter((p) => existsSync(p));
    const hits: string[] = [];
    for (const f of [...files, ...extra.filter((p) => !statSync(p).isDirectory())]) {
      if (!existsSync(f) || statSync(f).isDirectory()) continue;
      const text = readFileSync(f).toString('latin1');
      if (re.test(text)) hits.push(f);
    }
    expect(hits).toEqual([]);
  }, 120_000);
});

describe('request timeout', () => {
  it('turns a hung request into a readable, retryable error', async () => {
    const { postJson, LlmError } = await import('../src/core/llm/http');
    const orig = globalThis.fetch;
    globalThis.fetch = ((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    try {
      const err = (await postJson('https://example.test/x', {}, {}, { provider: 'gemini' }, 50).catch((e: unknown) => e)) as InstanceType<typeof LlmError>;
      expect(err).toBeInstanceOf(LlmError);
      expect(err.retryable).toBe(true);
      expect(err.message).toMatch(/did not answer within/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
