// Browser QA. Usage: node scripts/smoke.mjs <url> [screenshot-dir] [input-zip]
// Needs CHROMIUM_PATH. Starts a local mock LLM for the AI-mode checks. The zip is optional and stays on this machine.
// Real providers are probed with a fake key: a readable 401/400 means the browser can reach them (CORS allows it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startMock } from './mock-llm.mjs';

const [url, shots = '', zip = ''] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const mock = await startMock(4199);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, colorScheme: 'light' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const page = await ctx.newPage();
const problems = [];
const report = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_FAILED|CORS/.test(m.text()) && problems.push(`console: ${m.text()}`));
let pass = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  report.push({ name, ok, extra });
  if (ok) pass++;
  else problems.push(name);
};
const seen = (loc, timeout = 4000) => loc.waitFor({ timeout }).then(() => true, () => false);
const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const isDark = async () => (await bg()) !== 'rgb(250, 249, 246)';
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Screenshots in both themes, then back to the theme it found. */
const shot = async (n) => {
  if (!shots) return;
  const dark = await isDark();
  await page.screenshot({ path: `${shots}/${n}-${dark ? 'dark' : 'light'}.png` });
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.keyboard.press('t');
  await page.screenshot({ path: `${shots}/${n}-${dark ? 'light' : 'dark'}.png` });
  await page.keyboard.press('t');
};
const press = async (...keys) => {
  for (const k of keys) await page.keyboard.press(k);
};
const badge = () => page.getByTestId('mode-badge').textContent();

await page.goto(url);
check('home renders with stepper and drop zone', (await page.getByRole('heading', { name: /Find the promos/ }).isVisible()) && (await page.getByRole('list', { name: 'Steps' }).isVisible()));
check('mode badge says Heuristic only', (await badge()) === 'Heuristic only');
await shot('01-home');

// Heuristic run.
await page.getByRole('button', { name: 'Try demo show' }).click();
check('demo loads and shows the episode table', (await page.locator('tbody tr').count()) === 2);
await press('r');
await page.waitForURL(/#\/results/, { timeout: 20000 });
const cards = page.locator('article');
check('demo runs end to end, heuristic only', (await cards.count()) > 0, `${await cards.count()} cards`);
check('heuristic run: trace says no model was called', await seen(page.getByText('Agent trace')));
await shot('02-results-heuristic');

await press('j');
check('j selects next', (await cards.nth(1).getAttribute('aria-current')) === 'true');
await press('k');
check('k selects previous', (await cards.nth(0).getAttribute('aria-current')) === 'true');
await press('+');
check('+ votes up', (await cards.nth(0).getByRole('button', { name: /Thumbs up/ }).getAttribute('aria-pressed')) === 'true');
await press('-');
check('- votes down', (await cards.nth(0).getByRole('button', { name: /Thumbs down/ }).getAttribute('aria-pressed')) === 'true');

await press('/');
const search = page.getByLabel('Search promos');
await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search promos', null, { timeout: 2000 }).catch(() => {});
check('/ focuses search', await search.evaluate((e) => e === document.activeElement));
await page.keyboard.type('j');
check('typing in search is not taken as a shortcut', (await search.inputValue()) === 'j');
await press('Escape');
check('Esc clears focus', !(await search.evaluate((e) => e === document.activeElement)));
await search.fill('zzzzqq');
check('empty filter state', await page.getByText('No promos match these filters').isVisible());
await search.fill('');
await press('Escape');

await press('c');
check('c opens the side-by-side compare', await seen(page.getByRole('region', { name: 'Compare rankings' })));
await press('c');

await press('?');
check('? opens help with the new shortcuts', (await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible()) && (await page.getByText('Open Model settings').isVisible()) && (await page.getByText('Go to About Me').isVisible()));
await shot('03-help');
await press('?');
check('? closes help', (await page.getByRole('dialog').count()) === 0);
await press('s');
check('s opens settings', await page.getByRole('dialog', { name: 'Settings' }).isVisible());
await press('Escape');
check('Esc closes settings', (await page.getByRole('dialog').count()) === 0);
await press('m');
check('m opens model settings', await seen(page.getByRole('heading', { name: 'Model' })));

// Model settings: real providers, fake key. A readable error proves the browser reached them.
const provider = page.getByLabel('Provider');
const testBtn = page.getByRole('button', { name: 'Test connection' });
const probe = async (name, value, baseUrl) => {
  await provider.selectOption(value);
  if (baseUrl) await page.getByLabel('Base URL').fill(baseUrl);
  await page.getByLabel('API key').fill('invalid-test-key-0000');
  await testBtn.click();
  const status = page.getByRole('status').filter({ hasText: /Connected|Failed/ });
  await status.waitFor({ timeout: 20000 }).catch(() => {});
  const text = (await status.textContent().catch(() => '')) ?? '';
  const blocked = /Could not reach/.test(text);
  const readable = /HTTP (4\d\d)/.test(text);
  check(`CORS: ${name} answers a browser request`, readable && !blocked, text.slice(0, 110));
  return { name, readable, blocked, text };
};
const cors = [];
cors.push(await probe('anthropic', 'anthropic'));
await shot('04-settings-error');
await press('m');
cors.push(await probe('openai', 'openai'));
cors.push(await probe('gemini', 'gemini'));
cors.push(await probe('groq (openai-compatible)', 'openai-compatible', 'https://api.groq.com/openai/v1'));
cors.push(await probe('openrouter (openai-compatible)', 'openai-compatible', 'https://openrouter.ai/api/v1'));

// Mock provider: good key works, bad key gives a readable error.
await provider.selectOption('openai-compatible');
await page.getByLabel('Base URL').fill('http://127.0.0.1:4199/v1');
await page.locator('input[list="model-suggestions"]').fill('mock-model');
await page.getByLabel('API key').fill('wrong-key');
await testBtn.click();
check('Test connection: bad key gives a readable error', await seen(page.getByText(/key was rejected \(HTTP 401\)/)));
await page.getByLabel('API key').fill('good-key');
await testBtn.click();
check('Test connection: good key shows ✓ with model and latency', await seen(page.getByText(/Connected\./)), (await page.getByRole('status').filter({ hasText: 'Connected' }).textContent().catch(() => '')) ?? '');
await shot('05-settings-connected');
await press('Escape');
check('mode badge shows the AI provider and model', (await badge()) === 'AI: openai-compatible/mock-model', await badge());

// AI run on the demo show through the mock.
await press('u');
await press('r');
check('run screen shows stage progress with cancel', (await seen(page.getByRole('region', { name: 'Run progress' }), 3000)) || (await page.url()).includes('results'));
await page.waitForURL(/#\/results/, { timeout: 30000 });
check('demo runs end to end in AI mode', (await cards.count()) > 0, `${await cards.count()} cards`);
check('cards show heuristic, AI and final score chips', await seen(cards.first().getByText(/^Final/)));
await page.getByText('Agent trace').click();
check('agent trace renders every stage', (await seen(page.getByRole('cell', { name: 'Judge (AI)' }))) && (await seen(page.getByRole('cell', { name: 'Write-up (AI)' }))) && (await seen(page.getByRole('cell', { name: 'Verify (code)' }))));
const traceText = (await page.locator('details').textContent()) ?? '';
check('trace never shows the key', !traceText.includes('good-key'));
await shot('06-results-ai');
await press('c');
check('compare shows both orders', (await seen(page.getByRole('heading', { name: 'Heuristic order' }))) && (await seen(page.getByRole('heading', { name: /AI order \(/ }))));
await shot('07-compare');
await press('c');

await press('Enter');
await page.waitForURL(/#\/promo\//);
check('Enter opens the promo', await seen(page.getByRole('heading', { name: /Promo #1/ })));
check('detail shows timeline, cues, AI judge and its trace slice', (await seen(page.getByLabel('Promo timeline'))) && (await seen(page.getByText('Hook cues'))) && (await seen(page.getByRole('heading', { name: 'AI judge' }))) && (await seen(page.getByText('This promo in the agent trace'))));
await page.getByRole('button', { name: 'Copy timestamps' }).click();
check('copy shows a toast', await seen(page.getByText('Copied')));
await shot('08-detail');

const [download] = await Promise.all([page.waitForEvent('download'), press('e')]);
const zipPath = await download.path();
const { default: JSZip } = await import('jszip');
const { readFileSync } = await import('node:fs');
const z = await JSZip.loadAsync(readFileSync(zipPath));
const names = Object.keys(z.files);
const allText = (await Promise.all(names.map((n) => z.files[n].async('string')))).join('\n');
check('e exports a zip with agent_trace.json', names.includes('agent_trace.json'), names.length + ' files');
check('export never contains the key', !allText.includes('good-key'));

// About pages.
await press('g', 'a');
await page.waitForURL(/#\/about$/);
check('g a goes to About, card has the fields', await seen(page.getByText('Roll number')));
await page.getByRole('button', { name: 'Copy builder card' }).click();
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check('copy builder card gives plain text', clip.includes('Roll number: EE23BTECH11202') && clip.includes('Name: Abhey Garg'), clip.split('\n')[0]);
await shot('09-about');
await press('g', 'm');
await page.waitForURL(/#\/about-me/);
check('g m goes to About Me', await seen(page.getByRole('heading', { name: 'Abhey Garg' })));
check('About Me has experience, projects, skills and the why card', (await seen(page.getByRole('region', { name: 'Experience' }))) && (await seen(page.getByRole('region', { name: 'Projects' }))) && (await seen(page.getByRole('region', { name: 'Skills' }))) && (await seen(page.getByRole('region', { name: 'Why I built it this way' }))));
const links = await page.locator('header a[href^="http"]').evaluateAll((as) => as.map((a) => a.href));
for (const href of links) {
  // github.com answers scripted requests unreliably, so a profile link is checked through GitHub's own API.
  const gh = href.match(/^https:\/\/github\.com\/([^/]+)\/?$/);
  const target = gh ? `https://api.github.com/users/${gh[1]}` : href;
  const r = await fetch(target, { redirect: 'follow' }).catch(() => null);
  check(`About Me link resolves: ${href}`, !!r && r.status === 200, `${r?.status}${gh ? ' (via api.github.com)' : ''}`);
}
check('missing LinkedIn and email show placeholders, not broken links', (await page.getByText('LinkedIn: not added yet').isVisible()) && (await page.getByText('Email: not added yet').isVisible()));
const resumeOk = await seen(page.getByTitle('Resume PDF'), 3000);
const resumeMissing = await page.getByText('The resume PDF is not published yet').isVisible();
check('resume viewer loads, or shows a clean placeholder', resumeOk || resumeMissing, resumeOk ? 'pdf' : 'placeholder');
await shot('10-about-me');

// Theme.
const before = await bg();
await press('t');
const after = await bg();
check('t toggles theme', before !== after, `${before} -> ${after}`);
await page.reload();
check('theme persists on reload', (await bg()) === after);
check('a deep link to results without a run shows a useful state', await page.goto(`${url}#/results`).then(() => seen(page.getByText('No results yet'))));
await press('t');

// Phone width.
await page.setViewportSize({ width: 375, height: 800 });
for (const [name, hash] of [['home', '#/'], ['about me', '#/about-me'], ['about', '#/about']]) {
  await page.goto(`${url}${hash}`);
  await page.waitForTimeout(200);
  check(`no horizontal scroll at phone width: ${name}`, await noHScroll());
}
await page.getByRole('link', { name: 'Upload' }).click();
await page.getByRole('button', { name: 'Try demo show' }).click();
await press('r');
await page.waitForURL(/#\/results/, { timeout: 20000 });
check('no horizontal scroll at phone width: results', await noHScroll());
await shot('11-results-phone');
await press('Enter');
await page.waitForURL(/#\/promo\//);
check('no horizontal scroll at phone width: detail', await noHScroll());
await page.setViewportSize({ width: 1200, height: 900 });

await page.goto(`${url}#/`);
await page.locator('input[aria-label="Choose files"]').setInputFiles({ name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a screenplay') });
await page.waitForTimeout(300);
check('junk file gives a readable message', await page.getByText('None of these files look like a screenplay').isVisible());

if (zip) {
  await page.locator('input[aria-label="Choose files"]').setInputFiles(zip);
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 50, null, { timeout: 15000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await page.waitForURL(/#\/results/, { timeout: 60000 });
  console.log(`     full pack browser run (heuristic only): ${Date.now() - t0} ms`);
  check('full pack gives 10 promos', (await page.locator('article').count()) === 10);
}

console.log(`\n${pass} passed, ${problems.length} problems`);
problems.forEach((p) => console.log(' -', p));
if (shots) writeFileSync(`${shots}/report.json`, JSON.stringify({ url, pass, problems, report, cors }, null, 2));
await browser.close();
mock.close();
process.exit(problems.length ? 1 : 0);
