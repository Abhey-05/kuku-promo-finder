# QA record (v2, 2026-11-08)

The v2 build, before the live view. Screenshots of every screen in both themes are in `qa/screenshots/` on the build machine (git-ignored).

| Check | Result |
|---|---|
| `npm test` | 124 passed, 0 failed (4 files). Includes adapters on mocked HTTP, the verifier and retry loop, re-cuts by entry ID, the key never in exports or traces, and the CLI env config |
| `npm run build` | Passed, 0 TypeScript errors |
| Browser QA, local preview (`scripts/smoke.mjs`) | 54 of 54 passed |
| Browser QA, live GitHub Pages | 49 of 54 passed. The 5 that failed all use the local mock provider: Chrome blocks an HTTPS page from calling `http://127.0.0.1`. The run still completed and every promo showed "AI fallback", which is the designed behaviour. These 5 passed against the local preview |
| Bundle scan (`dist/`) | 0 of 200 dialogue fragments from the pack; no character names; no key patterns |
| Tracked files | No `input_pack/`, `runs/`, labels, `.env`, `docs/private/` or `qa/` in git |
| Solution doc PDF | 2 pages |

## Providers from a browser

Each provider was sent a request with a fake key by the app's own adapter, from the live site and from localhost. A readable HTTP error means the browser reached the provider, so a real key will work from the web app.

| Provider | Endpoint | Result from the live site | Real model call |
|---|---|---|---|
| Anthropic | api.anthropic.com | HTTP 401, readable: CORS allowed | Not made: no key |
| OpenAI | api.openai.com | HTTP 401, readable: CORS allowed | Not made: no key |
| Gemini | generativelanguage.googleapis.com | HTTP 400 "API key not valid", readable: CORS allowed | Not made: no key |
| Groq (OpenAI-compatible) | api.groq.com/openai/v1 | HTTP 401, readable: CORS allowed | Not made: no key |
| OpenRouter (OpenAI-compatible) | openrouter.ai/api/v1 | HTTP 401, readable: CORS allowed | Not made: no key |
| Local OpenAI-compatible mock | 127.0.0.1:4199 | From localhost: full AI run, Test connection ✓ and readable 401. From the HTTPS site: blocked by the browser | Mock only |

The agent path end to end is **verified against mocks only**.

## Live view QA (2026-11-08)

| Check | Result |
|---|---|
| `npm test` | 155 passed, 0 failed (6 files), including the event schema, stage order, batching never dropping critical events, cancel mid-run, and no key or show text in any event |
| `npm run build` | Passed: no `VITE_*KEY*` variable, no key pattern in `dist/` |
| `scripts/smoke.mjs`, local preview | 54 of 54 |
| `scripts/smoke.mjs`, live site | 49 of 54. The same 5 mock-provider checks as above: an HTTPS page cannot call the local mock |
| `scripts/live-qa.mjs`, local preview, with the pack zip | 32 of 33. Per-file rows, stage tracker, provisional then final results, log drawer, AI run mid-way through a slow mock, cancel, fallback with retry, phone width, keyboard-only upload, full-pack long tasks (0 over 50 ms). The miss is Gemini |
| `scripts/live-qa.mjs`, live site | 20 of 21. Mock-model sections skipped (local only). The miss is Gemini |
| Live bundle | 0 key patterns, the key from `.env` absent, 0 of 300 sampled show lines |

**Gemini.** The key works: the models list returned and Test connection reached Gemini from the browser and the CLI. Every generateContent call on 2026-11-08 returned HTTP 503 "This model is currently experiencing high demand", or did not answer within 90 s, for `gemini-3.8-flash` and the other Flash models tried. A real Gemini run of the demo show is still to do.
