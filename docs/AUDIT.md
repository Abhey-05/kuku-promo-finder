# Audit of the LLM path (before v2)

Written on 2026-11-08, before any v2 code change. Line numbers refer to commit `be7d8b6`.

## 1. What happens when a user enters a key and clicks Run

| Step | What the code does | Where |
|---|---|---|
| 1 | Settings keeps provider, model, base URL and key in React state only (`type="password"`, not saved to storage). | `src/web/components/Settings.tsx:42-69`, `src/web/App.tsx:53` |
| 2 | Run posts the files, the config and `{ apiKey, model, baseUrl }` to a Web Worker. The key is read. | `src/web/App.tsx:115-120` |
| 3 | The worker calls `runPipeline`, which builds a summary of the 30 pooled candidates and calls `rerank`. | `src/web/worker.ts:23`, `src/core/pipeline.ts:51-54` |
| 4 | `rerank` returns at once for provider `none`. Otherwise it picks the adapter and sends one request with all 30 candidates. A request is sent. | `src/core/llm/interface.ts:98-106` |
| 5 | The reply is checked: JSON, zod shape, known IDs, no duplicates, quotes verbatim. On failure it retries once with a stricter suffix. | `src/core/llm/interface.ts:36-73`, `:103-119` |
| 6 | After two failures, or any thrown error, it falls back to the heuristic order and sets `fallback_used`. | `src/core/llm/interface.ts:120-121` |
| 7 | The results page shows a banner with the last note when it fell back. | `src/web/screens/Results.tsx:130-134` |

Findings:

- **F1. The path is wired, not dead.** A key does reach the adapter and a real `fetch` is sent. It has never been run against a real provider, only against mocked `fetch` in `tests/llm.test.ts`.
- **F2. Errors are opaque.** Adapters throw `HTTP <status>` with no body, so a 401, a wrong model name and a CORS block all look alike. A CORS block surfaces as a bare `TypeError: Failed to fetch`. (`gemini.ts:16`, `openai-compatible.ts:16`)
- **F3. No connection check.** Nothing tells the user that a key or model works until a full run has fallen back.
- **F4. openai-compatible without a base URL** throws "A base URL is required" and silently falls back. The field shows a Groq placeholder, which is not a value. (`openai-compatible.ts:6`, `Settings.tsx:59`)
- **F5. No 429/5xx backoff, no call cap, no temperature setting.** One failure uses up a retry.
- **F6. One stage only.** The model reorders 30 candidates in a single call. It cannot change boundaries or write the hook, cliffhanger or why lines, and its ratings are logged but not blended with the heuristic score.
- **F7. Little visibility.** The mode is shown only as small text on the upload screen (`Home.tsx:104`). Tokens and notes are in `run_log.json` but are not shown in the UI.
- **F8. The CLI** reads the key from `LLM_API_KEY` and the provider from `--provider` (`src/cli/run.ts:49,56`). It has no guard against sending the confidential pack to a provider.

## 2. Provider adapters

| Adapter | Endpoint | Auth | Ever called for real? |
|---|---|---|---|
| `none` | none | none | n/a |
| `gemini` | `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key` header | No. Mocks only. |
| `openai-compatible` | `{baseUrl}/chat/completions` | `Authorization: Bearer` when a key is given | No. Mocks only. |

There was no Anthropic or OpenAI adapter. OpenAI could be reached through `openai-compatible` with the base URL `https://api.openai.com/v1`.

## 3. Git remote

`git remote -v` gives `https://github.com/Abhey-05/kuku-promo-finder.git`. An earlier brief named a different account, but the builder confirmed on 2026-11-08 that the project is theirs (Abhey Garg, GitHub `Abhey-05`), so the remote is correct and no migration is needed. The builder card had carried another person's name, roll number and GitHub handle; v2 corrects it.

## 4. Keys available on the build machine

No provider key was set in the environment (`env` was checked for KEY, TOKEN, LLM, KUKU, OPENAI, ANTHROPIC, GEMINI, GROQ and OPENROUTER names), and no local Ollama was running. Real model calls could not be made in this pass. See the README and `docs/EVAL.md` for what this means.
