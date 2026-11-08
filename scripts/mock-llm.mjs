// A local OpenAI-compatible server for QA. It answers the judge, refine and write-up prompts
// from the prompt text alone, with CORS headers, so the browser path can be tested without a key.
// Usage: node scripts/mock-llm.mjs [port] [delay-ms]   Good key: "good-key". Any other key gets HTTP 401.
// A delay holds each answer, so a run can be watched (and screenshotted) mid-way.
import { createServer } from 'node:http';

export function answer(prompt) {
  const blocks = prompt
    .split('\n### ')
    .slice(1)
    .map((b) => ({ id: b.slice(0, b.indexOf('\n')), lines: b.slice(b.indexOf('\n') + 1).trimEnd().split('\n').filter((l) => /^E\d+#\d+/.test(l)) }));
  if (prompt.includes('"ratings"')) {
    return { ratings: blocks.map((b, i) => ({ id: b.id, hook: 5 - (i % 3), cliffhanger: 3 + (i % 3), standalone: 4, reason: 'Mock judge: strong open, unresolved end.' })) };
  }
  if (prompt.includes('"refinements"')) return { refinements: blocks.map((b) => ({ id: b.id, keep: true })) };
  if (prompt.includes('"promos"')) {
    const text = (l) => l.replace(/^\S+ \S+ [^:]+: /, '').trim();
    const quote = (l) => {
      const t = text(l);
      return t.slice(0, Math.min(t.length, 20));
    };
    return {
      promos: blocks.map((b) => ({
        id: b.id,
        hook: { entry: b.lines[0].split(' ')[0], quote: quote(b.lines[0]) },
        cliffhanger: { entry: b.lines[b.lines.length - 1].split(' ')[0], quote: quote(b.lines[b.lines.length - 1]) },
        why: 'Mock write-up: opens on conflict and ends on a question.',
      })),
    };
  }
  return { ok: true };
}

export function startMock(port = 4199, delayMs = 0) {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.headers.authorization !== 'Bearer good-key') {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Incorrect API key provided.' } }));
        return;
      }
      const { model, messages } = JSON.parse(body);
      const content = JSON.stringify(answer(messages[0].content));
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: Math.round(body.length / 4), completion_tokens: Math.round(content.length / 4) } }),
      );
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4199);
  await startMock(port, Number(process.argv[3] ?? 0));
  console.log(`mock LLM on http://127.0.0.1:${port}/v1`);
}
