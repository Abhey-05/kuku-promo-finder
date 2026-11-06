// Browser smoke test. Usage: node scripts/smoke.mjs <url> [screenshot-dir] [input-zip]
// Needs CHROMIUM_PATH. The zip is optional and stays on this machine.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [url, shots = '', zip = ''] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, colorScheme: 'light' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
let pass = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  if (ok) pass++;
  else problems.push(name);
};
const shot = (n) => (shots ? page.screenshot({ path: `${shots}/${n}.png`, fullPage: false }) : null);
const seen = (loc) => loc.waitFor({ timeout: 3000 }).then(() => true, () => false);
const theme = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(url);
check('home renders', await page.getByRole('heading', { name: /Find the promos/ }).isVisible());
await shot('home-light');

await page.getByRole('button', { name: 'Try the demo show' }).click();
check('demo loads and shows the episode table', (await page.locator('tbody tr').count()) === 2);

await page.keyboard.press('r');
await page.waitForURL(/#\/results/, { timeout: 15000 });
const cards = page.locator('article');
const count = await cards.count();
check('r runs the analysis in the worker', count > 0, `${count} cards`);
await shot('results-light');

await page.keyboard.press('j');
check('j selects next', (await cards.nth(1).getAttribute('aria-current')) === 'true');
await page.keyboard.press('k');
check('k selects previous', (await cards.nth(0).getAttribute('aria-current')) === 'true');

await page.keyboard.press('+');
check('+ votes up', (await cards.nth(0).getByRole('button', { name: /Thumbs up/ }).getAttribute('aria-pressed')) === 'true');
await page.keyboard.press('-');
check('- votes down', (await cards.nth(0).getByRole('button', { name: /Thumbs down/ }).getAttribute('aria-pressed')) === 'true');

await page.keyboard.press('/');
check('/ focuses search', await page.getByLabel('Search promos').evaluate((e) => e === document.activeElement));
await page.keyboard.type('j');
check('typing in search is not taken as a shortcut', (await page.getByLabel('Search promos').inputValue()) === 'j');
await page.keyboard.press('Escape');
check('Esc clears focus', !(await page.getByLabel('Search promos').evaluate((e) => e === document.activeElement)));
await page.getByLabel('Search promos').fill('');
await page.keyboard.press('Escape');
await page.getByLabel('Search promos').fill('zzzzqq');
check('empty filter state', await page.getByText('No promos match these filters').isVisible());
await page.getByLabel('Search promos').fill('');
await page.keyboard.press('Escape');

await page.keyboard.press('?');
check('? opens help', await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible());
await shot('help');
await page.keyboard.press('?');
check('? closes help', (await page.getByRole('dialog').count()) === 0);

await page.keyboard.press('s');
check('s opens settings', await page.getByRole('dialog', { name: 'Settings' }).isVisible());
await page.keyboard.press('Escape');
check('Esc closes settings', (await page.getByRole('dialog').count()) === 0);

const before = await theme();
await page.keyboard.press('t');
const after = await theme();
check('t toggles theme', before !== after, `${before} -> ${after}`);
await shot('results-dark');
await page.reload();
check('theme persists on reload', (await theme()) === after);
check('deep link to results without a run shows a useful state', await page.getByText('No results yet').isVisible());
await page.keyboard.press('t');

await page.keyboard.press('u');
await page.getByRole('button', { name: 'Try the demo show' }).click();
await page.getByRole('button', { name: 'Run analysis' }).click();
await page.waitForURL(/#\/results/, { timeout: 15000 });

await page.keyboard.press('Enter');
await page.waitForURL(/#\/promo\//);
check('Enter opens the promo', await seen(page.getByRole('heading', { name: /Promo #1/ })));
check('detail shows the timeline and cues', (await seen(page.getByText('Hook cues'))) && (await seen(page.getByLabel('Promo timeline'))));
await page.getByRole('button', { name: 'Copy timestamps' }).click();
check('copy timestamps', await seen(page.getByText('Copied')));
await shot('detail-light');

await page.keyboard.press('g');
await page.keyboard.press('a');
await page.waitForURL(/#\/about/);
check('g a goes to About, card has the fields', await seen(page.getByText('Roll number')));
await page.getByRole('button', { name: 'Copy builder card' }).click();
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check('copy builder card gives plain text', clip.includes('Roll number: EE23BTECH11202'), clip.split('\n')[0]);
await page.keyboard.press('g');
await page.keyboard.press('h');
await page.waitForURL(/#\/results/);
check('g h goes to Results', await seen(cards.first()));
check('builder footer on Results', await seen(page.getByText(/Built by/)));

const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('e')]);
check('e exports a zip', download.suggestedFilename() === 'promo-run.zip');

await page.setViewportSize({ width: 375, height: 800 });
check('no horizontal scroll at phone width: results', await noHScroll());
await shot('results-phone');
await page.keyboard.press('Enter');
await page.waitForURL(/#\/promo\//);
check('no horizontal scroll at phone width: detail', await noHScroll());
await shot('detail-phone');
await page.keyboard.press('t');
await shot('detail-phone-theme2');
await page.setViewportSize({ width: 1200, height: 900 });

await page.goto(`${url}#/`);
await page.locator('input[aria-label="Choose files"]').setInputFiles({ name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a screenplay') });
await page.waitForTimeout(300);
check('junk file gives a readable message', await page.getByText('None of these files look like a screenplay').isVisible());

if (zip) {
  await page.locator('input[aria-label="Choose files"]').setInputFiles(zip);
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 50, null, { timeout: 15000 });
  check('full pack zip loads through the UI', true);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await page.waitForURL(/#\/results/, { timeout: 60000 });
  console.log(`     full pack browser run: ${Date.now() - t0} ms`);
  const chips = await page.locator('article').first().locator('.tnum').allTextContents();
  console.log('     first card:', chips.slice(0, 3).join(' | '));
  const n = await page.locator('article').count();
  check('full pack gives 10 promos', n === 10, `${n}`);
  if (shots) await page.screenshot({ path: `${shots}/fullpack.png` });
}

console.log(`\n${pass} passed, ${problems.length} problems`);
problems.forEach((p) => console.log(' -', p));
await browser.close();
process.exit(problems.length ? 1 : 0);
