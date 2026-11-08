# Interview runbook: a new show and a provided key, in under 2 minutes

## Web (fastest)

1. Open https://abhey-05.github.io/kuku-promo-finder/ (or the Render URL in `docs/DEPLOY.md`).
2. Press `m`. Pick the provider:
   - Claude: **Anthropic**. OpenAI: **OpenAI**. Gemini: **Google Gemini**.
   - Groq, OpenRouter, Together, Ollama, or **any endpoint Kuku provides**: **OpenAI-compatible**, and paste the base URL (the part before `/chat/completions`, for example `https://api.groq.com/openai/v1`).
3. Type the model name they give you (or keep the suggested default). Paste the key.
4. Press **Test connection**. Wait for "✓ Connected" with the model name and latency. Press `Esc`.
5. The header badge now reads `AI: provider/model`. Drop the new show's folder or zip on the page. Check the parse table: every episode parsed, 0 unreadable lines.
6. Press `r`. The run screen shows parse, shortlist, judge, refine, write-up and verify with live counts. A 50-episode show takes the heuristic under a second, then about 5 model calls.
7. On Results: open **Agent trace** to show calls, tokens, rejections and fallbacks. Press `c` to compare the heuristic and AI lists. Press `Enter` on a promo for the judge's reasoning and its trace. Press `e` to export everything, including `agent_trace.json`.

## CLI (when the browser is blocked, or for a script)

```bash
export KUKU_LLM_PROVIDER=openai-compatible        # or anthropic | openai | gemini
export KUKU_LLM_BASE_URL=https://their-endpoint/v1   # openai-compatible only
export KUKU_LLM_MODEL=their-model
export KUKU_LLM_API_KEY=...                       # read from the environment only
npm run cli -- --test-connection
npm run cli -- --input path/to/new-show --out runs/new-show
```

For Gemini, the same settings can live in `.env` instead (copy `.env.example`, paste the key after `GEMINI_API_KEY=`). `npm run cli -- --provider gemini --list-models` shows the model names the key can call.

The CLI prints calls, tokens, cost (when the model's price is known) and any fallbacks, and writes the same files as the web export.

## If the provider fails

Nothing is lost. Any failure falls back to the heuristic result, which is the full answer on its own.

| What you see | Meaning | Do |
|---|---|---|
| "The key was rejected (HTTP 401)" | Wrong key, or no access to that model | Re-paste the key; check the model name |
| "Not found (HTTP 404)" | Wrong model name or base URL | Fix the model name (for Gemini, `--list-models` shows valid names); for openai-compatible, check the base URL ends before `/chat/completions` |
| "Rate limit or quota reached (HTTP 429)" | Too many calls or no credit | The app already retried twice with backoff. Lower "Candidates sent to the model", or wait |
| "Could not reach …" | Offline, wrong URL, or the endpoint blocks browsers (CORS) | Use the CLI path above; it has no CORS limit |
| Results with "AI fallback" chips | Some outputs failed the checks twice | Say so: the verifier rejected them and kept the heuristic result. The trace shows each reason |

Then say: "The heuristic ranking is the baseline the agent sits on. Here it is, with the same exports."

## Changing the model

It is one field. In the web app, change the Model field in Settings (`m`) and press Test connection. In the CLI, change `KUKU_LLM_MODEL`. In code, a new provider is one file in `src/core/llm/` that takes messages and returns text, plus one entry in `PROVIDERS` in `src/core/llm/interface.ts`.

## Before the interview

- `npm test` and `npm run build` pass.
- Do not keep the repo in an iCloud-synced folder (such as the Desktop with iCloud Drive on). Offloaded files made tests hang on the build machine. If you must, keep `node_modules` as a `node_modules.nosync` folder with a `node_modules` symlink to it.
- The confidential pack is never sent to a provider from the CLI unless `KUKU_ALLOW_PACK_TO_LLM=1`. A new show from Kuku in the interview is theirs to send.
