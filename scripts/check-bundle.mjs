// Post-build guard: fails if dist/ contains a Gemini-style key (AIza...), an OpenAI-style or
// Anthropic-style key, or the literal value of any key found in the environment or .env.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

const PATTERNS = [/AIza[0-9A-Za-z_-]{20,}/, /sk-ant-[A-Za-z0-9_-]{10,}/, /sk-(proj-)?[A-Za-z0-9]{20,}/, /gsk_[A-Za-z0-9]{20,}/];
const KEY_VARS = ['GEMINI_API_KEY', 'KUKU_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY'];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function scanBundle(dir, env) {
  const values = KEY_VARS.map((k) => env[k]).filter((v) => v && v.length >= 8);
  const hits = [];
  for (const f of walk(dir)) {
    const text = readFileSync(f, 'latin1');
    for (const re of PATTERNS) if (re.test(text)) hits.push(`${f}: matches ${re}`);
    for (const v of values) if (text.includes(v)) hits.push(`${f}: contains the value of a key variable`);
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'dist';
  const env = { ...(existsSync('.env') ? parse(readFileSync('.env')) : {}), ...process.env };
  const hits = scanBundle(dir, env);
  if (hits.length) {
    console.error(`Key found in the built bundle:\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log(`check-bundle: no key patterns or key values in ${dir}/`);
}
