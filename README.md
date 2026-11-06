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

CLI options: `--input <folder-or-zip> --out <folder> [--provider none|gemini|openai-compatible] [--top 10] [--weights weights.json] [--max-per-episode 2|off] [--model name] [--base-url url]`. With a provider, set the key in `LLM_API_KEY`.

## How it works

The parser turns each script into timed entries and reports anything it cannot read. Candidates are windows that start on a dialogue or action entry and end on an entry end, never inside a spoken line, and a capped search stitches strong openings to strong endings. Each candidate gets a hook, cliffhanger, standalone and duration score, every one backed by the list of cues that fired, and `total = 0.35 hook + 0.35 cliffhanger + 0.15 standalone + 0.15 duration - 0.08 per join`. Overlaps are removed, the top 10 is capped at 2 per episode, and an optional model can reorder the top 30. A model reply is rejected if it uses an unknown ID or a quote that is not verbatim, and the run then falls back to the rules. The CLI and the web app share `src/core`, so they give the same ranking.

Results and failures are in [docs/EVAL.md](docs/EVAL.md). Assumptions are in [ASSUMPTIONS.md](ASSUMPTIONS.md). Deployment is in [docs/DEPLOY.md](docs/DEPLOY.md).

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
- **The LLM layer has never run on a real model.** No key was available. It is tested against mocked replies only, so it may need prompt fixes on first real use.
- **Cuts from the original plan:** none. The optional video is not recorded.
- **The lexicon was tuned on one show.** Expect lower scores on a new one. A new genre needs new cue words.

## Reproduce the raw outputs

```bash
npm run cli -- --input "<path to the input pack>" --out runs/full-pack --provider none
```

The run writes `promos.json`, `promos.csv`, `ranking.md`, `candidates_all.csv`, `parse_report.json`, `run_log.json`, `ASSUMPTIONS.md` and `BUILDER.md`. These hold only excerpts that the promos use, plus cue words. No output holds a full screenplay. The input pack, run outputs and labels are git-ignored because the content is confidential. Labels are also left out of the raw outputs, since those links open for anyone who has them.

To re-run the evaluation: `npm run eval -- metrics`, with the pack in `input_pack/` and your labels in `docs/labels.csv`.

## Walkthrough video (optional, 3 minutes)

Show these in order: upload the scripts, run, open one promo's detail and its cues, toggle dark and light with `t`, open shortcuts with `?`, then one failure from docs/EVAL.md, such as `E34-035.30-066.70`.
