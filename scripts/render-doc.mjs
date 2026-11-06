// Renders docs/SOLUTION_DOC.md to PDF. Usage: RAW_OUTPUTS_URL=<link> CHROMIUM_PATH=<path> node scripts/render-doc.mjs
import { readFileSync } from 'node:fs';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

const md = readFileSync('docs/SOLUTION_DOC.md', 'utf8').replace('{{RAW_OUTPUTS_URL}}', process.env.RAW_OUTPUTS_URL ?? 'link in the submission form');
const css = `body{font:8.9pt/1.31 -apple-system,Helvetica,Arial,sans-serif;color:#1c1b19;margin:0}
h1{font-size:15pt;margin:0 0 3pt}h2{font-size:10pt;margin:7pt 0 1.5pt;break-after:avoid}p{margin:2pt 0}ul,ol{margin:2pt 0;padding-left:14pt}li{margin:0.5pt 0}
code{font:8.2pt ui-monospace,Menlo,monospace}a{color:#c2410c}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
await page.setContent(`<!doctype html><meta charset=utf-8><style>${css}</style>${await marked.parse(md, { breaks: false })}`);
await page.pdf({ path: 'docs/SOLUTION_DOC.pdf', format: 'A4', margin: { top: '13mm', bottom: '12mm', left: '15mm', right: '15mm' }, printBackground: true });
await browser.close();
const pages = (readFileSync('docs/SOLUTION_DOC.pdf', 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`${pages} pages`);
process.exit(pages <= 2 ? 0 : 1);
