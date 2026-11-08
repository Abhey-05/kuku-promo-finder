# Promo Finder

Reads timestamped microdrama screenplays and ranks 20 to 60 second promo clips. Each promo gets exact timestamps, a hook, a cliffhanger and a one-line reason, for an editor to review. Kuku AI Generalist Assignment, Problem 1.

**Live app:** https://abhey-05.github.io/kuku-promo-finder/ (try the demo show, or upload your own scripts; files stay in your browser)

## Run it in 5 minutes

Needs Node 22.

```bash
git clone https://github.com/Abhey-05/kuku-promo-finder.git
cd kuku-promo-finder
npm install
npm test                 # the full-pack tests skip when input_pack/ is absent
npm run dev              # web app
npm run cli -- --input samples/demo-show --out runs/demo
```

Running on a new show with a key in an interview: see [docs/INTERVIEW_RUNBOOK.md](docs/INTERVIEW_RUNBOOK.md).

## Modes

| Mode | What runs | Needs |
|---|---|---|
| Heuristic only (default) | Parse, candidates, cue scores, overlap removal, top 10 | Nothing. Free, under a second for 50 episodes, deterministic. |
| AI | The heuristic, then an LLM agent on top: judge, re-cut, write-up, each checked by code | A provider and usually a key |

The header badge always shows the mode: "Heuristic only" or "AI: provider/model".

### The live view

Everything runs in a Web Worker, so the page stays responsive on a 50-episode pack. The engine emits typed progress events (`src/core/events.ts`), and the web app and the CLI show the same thing.

- **Upload.** Parsing starts as soon as files land. A zip shows "Unzipping…" with a running file count. Each episode has a row that updates in place, from queued to parsed (scenes · entries · length) or failed (with the reason). Warnings expand. A summary bar counts episodes, runtime, entries and warnings. "Run automatically after upload" is on by default and remembered in this browser.
- **Run.** A stage tracker covers read, parse, find cut points, score, remove overlaps, the AI judge, refine and write-up (marked skipped in heuristic mode), verify and rank. Each stage shows its status, a progress bar where the total is known, elapsed time, and a one-line summary such as "25,562 candidates → 237 after overlap removal". Counters show elapsed time, candidates, survivors, the shortlist, LLM calls, tokens and fallbacks. Next to the tracker (below it on a phone), the top 10 updates as stages finish and slides into place when ranks change (no motion if the system asks for reduced motion). Each card is marked "provisional" until the run ends, then "final".
- **Log.** Press `l` for a timestamped event feed, with filters for stage and level and a pause-scroll option. It shows IDs, counts and short labels: never a key or screenplay text.
- **AI mode.** Every judge, refine and write-up call appears as it happens. Retries, rejections and fallbacks show in the warning colour on their stage, with "Retry the AI stages".
- **Cancel** stops the worker at once, shows "Cancelled at <stage>", and keeps the results so far, marked partial.
- **Done.** A "Done in …" toast appears, focus moves to the results, and the tracker folds into one line above them that expands again.

The CLI prints a line for each finished stage, a live counter on a terminal, and each model call in AI mode.

### The AI agent

1. **Shortlist (code).** The heuristic's best 30 survivors (configurable).
2. **Judge (LLM).** Rates hook, cliffhanger and standalone 1 to 5 against a written rubric, 10 candidates per call, strict JSON.
3. **Refine (LLM, constrained).** For the best 15, the model may tighten the cut, but only by picking entry IDs from a list. Code turns IDs into timestamps and enforces valid cut points, 20 to 60 s, order and no overlaps.
4. **Write-up (LLM).** Hook, cliffhanger and a one-line why for each final promo, quoting only given lines.
5. **Verify (code) + one retry.** zod schemas; unknown IDs, non-verbatim quotes, out-of-window hooks, bad durations and overlaps are rejected. The errors go back to the model once. If it fails again, that item keeps the heuristic result and is flagged `llm_fallback`.
6. **Final rank.** `final = α × AI + (1 − α) × heuristic`, α = 0.6 by default (Settings). AI = (hook + cliffhanger + standalone − 3) / 12. The heuristic rank stays visible next to it, and "Compare" (`c`) shows both lists side by side.

Every stage is shown in the Agent trace panel and saved as `agent_trace.json`: model, items in and out, tokens, latency, rejected outputs and why, retries and fallbacks. A run makes about 5 calls (cap 14), with backoff on 429 and 5xx. The key is never in the trace, exports or logs.

### Providers

| Provider | Default model | From the browser | Real model call verified |
|---|---|---|---|
| `anthropic` | claude-haiku-5-5 | Yes, CORS allowed (uses `anthropic-dangerous-direct-browser-access`) | No, mocks only |
| `openai` | gpt-4.1-mini | Yes, CORS allowed | No, mocks only |
| `gemini` | gemini-3.8-flash | Yes, CORS allowed | No, mocks only |
| `openai-compatible` | llama-3.3-70b-versatile | Groq and OpenRouter: yes. Local Ollama needs `OLLAMA_ORIGINS`. Any other endpoint: use Test connection, or the CLI | No, mocks only |

"CORS allowed" was checked on 2026-11-08 by sending a request with a fake key from the browser: each provider returned a readable 401 or 400, so a real key will reach it. **No real model call has been made**, because no key was available. The whole agent path is verified against mocks only: mocked HTTP in `tests/llm.test.ts` and a local OpenAI-compatible mock server in the browser QA (`scripts/mock-llm.mjs`). Expect to adjust prompts on the first real run.

In the web app, open Settings (`m`), pick a provider, type any model name (suggestions are offered), paste the key, and press **Test connection**. It shows ✓ with the model and latency, or the error in plain words (bad key, wrong model, rate limit, CORS).

### Gemini with a .env file (CLI)

```bash
cp .env.example .env          # .env is git-ignored and has never been committed
# open .env and paste your key after GEMINI_API_KEY=
npm run cli -- --provider gemini --list-models      # confirm the model name your key can call
npm run cli -- --test-connection
npm run cli -- --input samples/demo-show --out runs/demo-gemini --provider gemini
```

On the website, paste the key into Settings (`m`) instead. It is held in memory for the session and never stored or built into the site. The build fails if any `VITE_*KEY*` variable is set (Vite would copy it into the public bundle), and after building it scans `dist/` for `AIza…` and other key patterns.

**Data note.** On Gemini's free tier, Google may use what you send to improve its products. That is why the confidential `input_pack/` is never sent to any provider unless `KUKU_ALLOW_PACK_TO_LLM=1` is set (the default in `.env.example` is 0). Use `samples/demo-show/`, which is synthetic, to try a provider. The free tier also has low rate limits: the client retries an HTTP 429 twice with backoff, honours Retry-After up to 10 seconds, and then falls back to the heuristic result.

### CLI configuration

Flags win over environment variables, and real environment variables win over `.env`. The key is read only from the environment or `.env`, never from a flag.

| Setting | Flag | Environment |
|---|---|---|
| Provider | `--provider` | `KUKU_LLM_PROVIDER` |
| Model | `--model` | `KUKU_LLM_MODEL` |
| API key | none | `KUKU_LLM_API_KEY`, the older `LLM_API_KEY`, or `GEMINI_API_KEY` for Gemini |
| Base URL | `--base-url` | `KUKU_LLM_BASE_URL` |
| Temperature (0) | `--temperature` | `KUKU_LLM_TEMPERATURE` |
| α (0.6) | `--alpha` | `KUKU_LLM_ALPHA` |
| Candidates to the model (30) | `--max-candidates` | `KUKU_LLM_MAX_CANDIDATES` |

```bash
KUKU_LLM_PROVIDER=anthropic KUKU_LLM_API_KEY=... npm run cli -- --test-connection
KUKU_LLM_PROVIDER=anthropic KUKU_LLM_API_KEY=... npm run cli -- --input new-show/ --out runs/new-show
```

Other flags: `--top 10`, `--weights weights.json`, `--max-per-episode 2|off`. An input inside `input_pack/` is never sent to a provider unless `KUKU_ALLOW_PACK_TO_LLM=1` is set.

## How the heuristic works

The parser turns each script into timed entries and reports anything it cannot read. Candidates are windows that start on a dialogue or action entry and end on an entry end, never inside a spoken line, and a capped search stitches strong openings to strong endings. Each candidate gets a hook, cliffhanger, standalone and duration score, every one backed by the list of cues that fired, and `total = 0.35 hook + 0.35 cliffhanger + 0.15 standalone + 0.15 duration - 0.08 per join`. Overlaps are removed and the top 10 is capped at 2 per episode. The CLI and the web app share `src/core`, so they give the same ranking.

Results and failures are in [docs/EVAL.md](docs/EVAL.md). Assumptions are in [ASSUMPTIONS.md](ASSUMPTIONS.md). Deployment is in [docs/DEPLOY.md](docs/DEPLOY.md). The pre-v2 audit of the LLM path is in [docs/AUDIT.md](docs/AUDIT.md).

## Cue groups

All cue words are plain data in `src/core/lexicon.ts`.

| Feature | Group | What it looks for |
|---|---|---|
| Hook | impact sound | Slap, crash, scream and similar in a sound entry |
| Hook | violence or reveal action | Slaps, lunges, storms in, and so on, in action or camera text |
| Hook | reveal or conflict line | Dead, secret, liar, it's you, and so on |
| Hook | humiliation line | Worthless, disgrace, beggar, and so on |
| Hook | shouted line | Ends in `!` or has an all-caps word |
| Hook | snap camera move, close-up opener | Crash zoom, whip pan; close-up is weak |
| Cliffhanger | scripted cliffhanger | The word "cliffhanger" in a sound cue |
| Cliffhanger | tension sound | Sting, drone, swell, heartbeat, ominous |
| Cliffhanger | hard ending | Freeze or cut to black, only if unresolved |
| Cliffhanger | open question, line left hanging | Last line ends in `?`, `—` or `...` |
| Cliffhanger | threat | You'll pay, never, I will destroy, and so on |
| Cliffhanger | penalties | Forgive, together, warm music, tender action |
| Standalone | rewards | Name spoken aloud, relationship stated, 3 speakers or fewer |
| Standalone | penalties | Pronoun opener, back-reference, unintroduced speaker, crowded cast, late in the story |

## Limits

- **The script is all it sees.** It has never seen the video, so a promo can read well and play badly.
- **The labels are not a human editor's.** See the warning at the top of docs/EVAL.md. Below the top 10 the order is close to noise.
- **The standalone score is weak.** Five failure-log entries are standalone misjudgements. A human checks these.
- **The LLM agent has never run on a real model.** No key was available. It is verified against mocks only, so it may need prompt fixes on first real use. Browser CORS was checked for each provider with a fake key.
- **No held-out numbers yet.** The held-out sheet waits on the builder's labels. Nothing here claims the AI ranking beats the heuristic.
- **AI runs are not deterministic.** Even at temperature 0, a model can answer differently. Heuristic runs are deterministic.
- **Cuts from the original plan:** none. The optional video is not recorded.
- **The lexicon was tuned on one show.** Expect lower scores on a new one. A new genre needs new cue words.

## Reproduce the raw outputs

```bash
npm run cli -- --input "<path to the input pack>" --out runs/full-pack --provider none
```

The run writes `promos.json`, `promos.csv`, `ranking.md`, `candidates_all.csv`, `parse_report.json`, `run_log.json`, `agent_trace.json`, `ASSUMPTIONS.md` and `BUILDER.md`. These hold only excerpts that the promos use, plus cue words. No output holds a full screenplay. The input pack, run outputs and labels are git-ignored because the content is confidential. Labels are also left out of the raw outputs, since those links open for anyone who has them.

To re-run the evaluation: `npm run eval -- metrics` (tuning labels in `docs/labels.csv`) or `npm run eval -- heldout` (the builder's labels in `docs/labels_heldout.csv`), with the pack in `input_pack/`.

## QA

`CHROMIUM_PATH=<chrome> node scripts/smoke.mjs <url> qa/screenshots/<name>` runs 54 browser checks: heuristic and AI runs on the demo show (AI through a local mock provider), Test connection with good and bad keys, CORS probes for each real provider, every shortcut, both themes, About Me links and phone width. It saves a screenshot of each screen in both themes to `qa/screenshots/` (git-ignored). Set `GITHUB_TOKEN` to avoid GitHub's API rate limit on the About Me link check.

`node scripts/live-qa.mjs <url> qa/screenshots [pack.zip]` checks the live view: per-file rows, the stage tracker, provisional results that become final, the log drawer, an AI run through a slow local mock (mid-run state, cancel, fallback and retry), phone width, keyboard-only upload, and a Gemini run when `GEMINI_API_KEY` is set. With a local zip of the pack, it also measures main-thread long tasks (see `docs/EVAL.md`). Never pass the pack against the deployed site.

## Walkthrough video (optional, 3 minutes)

Show these in order: upload the scripts, run, open one promo's detail and its cues, open model settings with `m` and press Test connection, compare with `c`, toggle dark and light with `t`, open shortcuts with `?`, then one failure from docs/EVAL.md, such as `E34-035.30-066.70`.
