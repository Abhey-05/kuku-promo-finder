import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/web/index.css', 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
}
const light = tokens(css.match(/^:root \{[\s\S]*?^\}/m)![0]);
const dark = tokens(css.match(/^:root\[data-theme='dark'\] \{[\s\S]*?^\}/m)![0]);
const media = tokens(css.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?^\}/m)![0]);

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe.each([['light', light], ['dark', dark]] as const)('%s theme contrast (WCAG AA)', (_, t) => {
  it.each([
    ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
    ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
    ['accent', 'bg'], ['accent', 'surface'],
    ['on-accent', 'accent'],
  ])('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps bars readable against their track (3:1 for graphics)', () => {
    expect(ratio(t['ink-bar'], t.track)).toBeGreaterThanOrEqual(3);
    expect(ratio(t.accent, t.track)).toBeGreaterThanOrEqual(3);
  });
});

it('defines the same dark tokens for the system preference and the explicit choice', () => {
  expect(media).toEqual(dark);
});
