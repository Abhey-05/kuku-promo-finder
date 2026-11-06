import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InputFile } from '../src/core/schema';

/** The real pack is confidential and never in git. Tests that need it skip when it is absent. */
const PACK = resolve(process.env.INPUT_PACK ?? 'input_pack');
export const PACK_AVAILABLE = existsSync(PACK);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function loadPack(): InputFile[] {
  return walk(PACK)
    .filter((p) => p.endsWith('.txt'))
    .map((p) => ({ name: p.split('/').pop()!, text: readFileSync(p, 'utf8') }));
}

export function loadDemo(): InputFile[] {
  const dir = resolve('samples/demo-show');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.txt'))
    .map((n) => ({ name: n, text: readFileSync(join(dir, n), 'utf8') }));
}
