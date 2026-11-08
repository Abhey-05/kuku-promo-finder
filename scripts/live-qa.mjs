// Browser QA for the live processing view.
// Usage: node scripts/live-qa.mjs <url> [screenshot-dir] [input-zip]
// Needs CHROMIUM_PATH. Starts a slow local mock model so a run can be watched mid-way.
// If GEMINI_API_KEY is in the environment or .env, also runs the demo show through Gemini.
// The zip (the confidential pack) is optional, is read only by the local browser, and is never sent to a model.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { chromium } from 'playwright-core';
import { startMock } from './mock-llm.mjs';

const [url, shots = '', zip = ''] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const env = { ...(existsSync('.env') ? parse(readFileSync('.env')) : {}), ...process.env };
const geminiKey = env.GEMINI_API_KEY || '';
const MOCK_PORT = 4198;
const mock = await startMock(MOCK_PORT, 900);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });

// Records every status change of file rows, stages, result badges and the aria-live line, plus long tasks.
await ctx.addInitScript(() => {
  window.__live = [];
  window.__longtasks = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longtasks.push({ start: e.startTime, ms: e.duration }))).observe({ type: 'longtask', buffered: true });
  } catch {}
  const seen = new Map();
  const scan = () => {
    document.querySelectorAll('[data-testid="file-row"],[data-testid^="stage-"],[data-testid="result-badge"],[aria-live="polite"]').forEach((el, i) => {
      const id = el.dataset.testid === 'file-row' ? `file:${el.querySelector('td')?.textContent}` : el.dataset.testid?.startsWith('stage-') ? el.dataset.testid : el.dataset.testid === 'result-badge' ? `badge:${i}` : 'live';
      const v = el.dataset.status ?? el.textContent;
      if (seen.get(id) !== v) {
        seen.set(id, v);
        window.__live.push({ id, v, t: performance.now() });
      }
    });
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});

const page = await ctx.newPage();
const problems = [];
const report = [];
const metrics = {};
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
let pass = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  report.push({ name, ok, extra });
  if (ok) pass++;
  else problems.push(name);
};
const seen = (loc, timeout = 5000) => loc.waitFor({ timeout }).then(() => true, () => false);
const isDark = async () => (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgb(250, 249, 246)';
const shot = async (n) => {
  if (!shots) return;
  const dark = await isDark();
  await page.screenshot({ path: `${shots}/${n}-${dark ? 'dark' : 'light'}.png` });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('t');
  await page.screenshot({ path: `${shots}/${n}-${dark ? 'light' : 'dark'}.png` });
  await page.keyboard.press('t');
};
const press = async (...keys) => {
  for (const k of keys) await page.keyboard.press(k);
};
const history = () => page.evaluate(() => window.__live.splice(0));
const statusOf = (h, prefix) => h.filter((x) => x.id.startsWith(prefix)).map((x) => x.v);
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const setModel = async ({ provider, baseUrl = '', model = '', key }) => {
  await press('m');
  await page.getByLabel('Provider').selectOption(provider);
  if (baseUrl) await page.getByLabel('Base URL').fill(baseUrl);
  if (provider !== 'none') await page.locator('input[list="model-suggestions"]').fill(model);
  if (key !== undefined && provider !== 'none') await page.getByLabel('API key').fill(key);
};

await page.goto(url);
await history();

// 1. Heuristic: upload the demo with the keyboard only and watch it go through.
let found = false;
for (let i = 0; i < 40 && !found; i++) {
  await press('Tab');
  found = (await page.evaluate(() => document.activeElement?.textContent)) === 'Try demo show';
}
check('keyboard only: Tab reaches "Try demo show"', found);
await press('Enter');
await page.waitForURL(/#\/results/, { timeout: 20000 });
let h = await history();
const fileStates = statusOf(h, 'file:');
check('file rows update in place: queued or parsing, then parsed', fileStates.includes('parsed') && (fileStates.includes('queued') || fileStates.includes('parsing')), [...new Set(fileStates)].join(' → '));
const stageStates = statusOf(h, 'stage-');
// The heuristic demo finishes in well under 100 ms, so stages can go straight from pending to done.
// The running state is checked on the slower AI run below.
check('stage tracker reaches done for every heuristic stage', stageStates.filter((s) => s === 'done').length >= 7, `${stageStates.filter((s) => s === 'done').length} done`);
check('AI stages show as skipped in heuristic mode', stageStates.includes('skipped'));
const badges = statusOf(h, 'badge:');
check('provisional results appear before the final ranking', badges.includes('provisional') && badges.includes('final') && badges.indexOf('provisional') < badges.indexOf('final'), [...new Set(badges)].join(' → '));
const announced = statusOf(h, 'live').filter(Boolean);
check('aria-live announces stage changes', announced.some((a) => /done/.test(a)), `${announced.length} announcements`);
check('a "Done in" toast appears', await seen(page.getByRole('status').filter({ hasText: /^Done in / }).first()));
check('focus moves to the results', await page.evaluate(() => document.activeElement?.id === 'results-heading'));
const summary = page.getByTestId('run-summary');
check('the tracker collapses to a one-line summary on Results', await seen(summary), ((await summary.locator(':scope > summary').textContent().catch(() => '')) ?? '').trim().slice(0, 100));
await summary.locator(':scope > summary').click();
check('the summary expands to the full tracker', await seen(summary.getByTestId('stage-shortlist')));
await shot('live-01-results-summary');
await press('u');
check('Upload shows the finished run with final badges', (await page.getByTestId('result-badge').first().textContent()) === 'final');
check('upload summary bar shows episodes, runtime, entries, warnings', /Episodes parsed/.test((await page.getByTestId('upload-summary').textContent()) ?? ''));
await shot('live-02-heuristic-done');

// 2. Log drawer.
await press('l');
check('l opens the live log', await seen(page.getByTestId('log-drawer')));
const logText = (await page.getByRole('log').textContent()) ?? '';
check('the log has timestamped stage events', /Parse scripts done in/.test(logText) && /\d+\.\d\ds/.test(logText));
await page.getByTestId('log-drawer').getByLabel('Level').selectOption('warn');
check('the log filters by level', ((await page.getByRole('log').textContent()) ?? '').length < logText.length);
await page.getByTestId('log-drawer').getByLabel('Level').selectOption('all');
await page.getByTestId('log-drawer').getByLabel('Stage').selectOption('score');
check('the log filters by stage', !/Parse scripts done/.test((await page.getByRole('log').textContent()) ?? ''));
await page.getByTestId('log-drawer').getByLabel('Stage').selectOption('all');
await shot('live-03-log');
await page.evaluate(() => document.activeElement?.blur?.());
await press('l');
check('l closes the log', !(await page.getByTestId('log-drawer').isVisible().catch(() => false)));
await press('?');
check('? help lists the l shortcut', await seen(page.getByRole('cell', { name: 'Open or close the live log' })));
await press('Escape');

// 3. AI mode through the slow mock: mid-run state.
await setModel({ provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-model', key: 'good-key' });
await press('Escape');
await press('u');
await history();
await press('r');
const judgeRunning = await seen(page.locator('[data-testid="stage-judge"][data-status="running"]'), 15000);
check('AI run: the judge stage shows as running', judgeRunning);
if (!judgeRunning) console.log(page.url(), await page.getByTestId('mode-badge').textContent(), (await page.locator('main').innerText()).slice(0, 600));
await page.waitForFunction(() => /[1-9]/.test(document.querySelector('[data-testid="live-counters"]')?.textContent?.match(/LLM calls(\d+)/)?.[1] ?? ''), null, { timeout: 10000 }).catch(() => {});
const counters = (await page.getByTestId('live-counters').textContent()) ?? '';
check('live counters show elapsed time, candidates and LLM calls', /Elapsed/.test(counters) && /LLM calls[1-9]/.test(counters), counters.replace(/\s+/g, ' ').slice(0, 120));
check('provisional results are on screen mid-run', (await page.getByTestId('result-badge').first().textContent()) === 'provisional');
await press('l');
check('the log shows model calls as they happen', /judge batch 1: (started|ok)/.test((await page.getByRole('log').textContent()) ?? ''));
await shot('live-04-ai-mid-run');
await press('l');
await page.waitForURL(/#\/results/, { timeout: 60000 });
h = await history();
check('AI run finishes with refine and write-up done', statusOf(h, 'stage-').filter((s) => s === 'done').length >= 8);
await shot('live-05-ai-done');

// 4. Cancel mid-run.
await press('u');
await press('r');
await seen(page.locator('[data-testid="stage-judge"][data-status="running"]'), 15000);
await page.getByRole('button', { name: 'Cancel' }).click();
check('Cancel shows "Cancelled at <stage>"', await seen(page.getByRole('heading', { name: /^Cancelled at / })), (await page.getByTestId('run-heading').textContent()) ?? '');
check('cancelled results are kept and marked partial', (await page.getByTestId('result-badge').first().textContent()) === 'partial');
check('no stage is left running after cancel', (await page.locator('[data-status="running"]').count()) === 0);
await shot('live-06-cancelled');

// 5. A provider that rejects the key: the AI stages fall back, highlighted, with a retry.
await setModel({ provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-model', key: 'wrong-key' });
await press('Escape');
await press('u');
await press('r');
await page.waitForURL(/#\/results/, { timeout: 60000 });
await page.getByTestId('run-summary').locator(':scope > summary').click();
check('fallbacks show in the warning colour on the stage', await seen(page.getByTestId('stage-judge').locator('.text-warn').first()));
check('a "Retry the AI stages" button is offered', await seen(page.getByRole('button', { name: 'Retry the AI stages' }).first()));
await shot('live-07-fallback-retry');

// 6. Phone width, mid-run.
await setModel({ provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-model', key: 'good-key' });
await press('Escape');
await page.setViewportSize({ width: 375, height: 800 });
await press('u');
await press('r');
await seen(page.locator('[data-testid="stage-judge"][data-status="running"]'), 15000);
check('no horizontal scroll at phone width mid-run', await noHScroll());
const trackerBox = await page.getByTestId('stage-read').boundingBox();
const resultsBox = await page.getByRole('region', { name: 'Live results' }).boundingBox();
check('results stack below the tracker on a phone', !!trackerBox && !!resultsBox && resultsBox.y > trackerBox.y + 100);
await shot('live-08-phone-mid-run');
await page.waitForURL(/#\/results/, { timeout: 60000 });
await page.setViewportSize({ width: 1200, height: 900 });

// 7. Gemini, when a key is available (demo show only).
if (geminiKey) {
  await setModel({ provider: 'gemini', model: env.KUKU_LLM_MODEL || '', key: geminiKey });
  await page.getByRole('button', { name: 'Test connection' }).click();
  const status = page.getByRole('status').filter({ hasText: /Connected|Failed/ });
  await status.waitFor({ timeout: 120000 }).catch(() => {});
  const text = ((await status.textContent().catch(() => '')) ?? '').replace(geminiKey, '[key]');
  metrics.gemini_test_connection = text;
  check('Gemini: Test connection', /Connected/.test(text), text.slice(0, 140));
  await press('Escape');
  if (/Connected/.test(text)) {
    await press('u');
    const t0 = Date.now();
    await press('r');
    await page.waitForURL(/#\/results/, { timeout: 600000 }).catch(() => {});
    metrics.gemini_run_ms = Date.now() - t0;
    await page.getByTestId('run-summary').locator(':scope > summary').click().catch(() => {});
    const line = ((await page.getByTestId('run-summary').locator(':scope > summary').textContent().catch(() => '')) ?? '').trim();
    metrics.gemini_summary = line;
    check('Gemini: the demo show runs in AI mode with the live view', /LLM calls/.test(line), line);
    await shot('live-09-gemini-done');
  }
  await setModel({ provider: 'none', key: '' });
  await press('Escape');
} else {
  console.log('     (no GEMINI_API_KEY: Gemini browser run skipped)');
}

// 8. The full pack, locally: main-thread long tasks during upload and run.
if (zip) {
  await page.goto(url);
  await page.evaluate(() => (window.__longtasks = []));
  const t0 = await page.evaluate(() => performance.now());
  await page.locator('input[aria-label="Choose files"]').setInputFiles(zip);
  await page.waitForURL(/#\/results/, { timeout: 120000 });
  const t1 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(500);
  const tasks = await page.evaluate(() => window.__longtasks);
  const inRun = tasks.filter((x) => x.start >= t0 - 50);
  const max = inRun.reduce((m, x) => Math.max(m, x.ms), 0);
  metrics.full_pack = { upload_to_results_ms: Math.round(t1 - t0), long_tasks: inRun.length, over_200ms: inRun.filter((x) => x.ms > 200).length, max_long_task_ms: Math.round(max), all: inRun.map((x) => Math.round(x.ms)) };
  console.log(`     full pack: ${JSON.stringify(metrics.full_pack)}`);
  check('full pack: no main-thread task over 200 ms', metrics.full_pack.over_200ms === 0, `max ${metrics.full_pack.max_long_task_ms} ms, ${inRun.length} tasks over 50 ms`);
  check('full pack: 10 promos', (await page.locator('article').count()) === 10);
}

console.log(`\n${pass} passed, ${problems.length} problems`);
problems.forEach((p) => console.log(' -', p));
if (shots) writeFileSync(`${shots}/live-report.json`, JSON.stringify({ url, pass, problems, report, metrics }, null, 2));
await browser.close();
mock.close();
process.exit(problems.length ? 1 : 0);
