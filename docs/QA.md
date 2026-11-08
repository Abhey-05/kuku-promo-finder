# QA record (v2, 2026-11-08)

Commit `90b9d70`. Screenshots of every screen in both themes are in `qa/screenshots/` on the build machine (git-ignored).

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
