# Assumptions

Numbered in the order they were made. The brief says to assume rather than ask.

1. **Timestamps are the cut list.** The screenplay timestamps are treated as true video timings. No video was available, so nothing here checks them against a real cut.
2. **Episode length comes from the last scene end.** If an entry ran past it, that is reported as a violation, not repaired.
3. **Upper-case scene metadata is the same format.** One episode in the pack writes `SCENE HEADING:` in capitals. The parser is case-insensitive for these labels.
4. **A cut may not land inside a spoken line.** The brief says "snap to entry boundaries", but camera entries overlap dialogue, so an entry boundary can still fall mid-sentence. Any start or end inside a dialogue entry is rejected.
5. **Hooks decay over the 3-second window.** The brief says "in the first 3 seconds". A cue on the first frame counts in full and a cue at 3 s counts half, because reading the first run showed clips that opened on 2.6 s of nothing.
6. **Camera entries count as action.** The screenplays have about five camera entries per action entry, and many events are only written in the camera text.
7. **A stitched promo must share a speaker across its joins** and stay within 3 episodes. This is a cheap stand-in for "the join makes sense"; the LLM layer can judge it better.
8. **Late-story clips cost more.** A standalone penalty of up to 0.3 grows with episode number. A viewer who arrives through a late promo needs more backstory and may have the premise spoiled.
9. **Humiliation lines count as hooks.** The brief's examples are a slap, a reveal and a shocking line. In this genre the public insult is often that line, so a humiliation cue group was added after reading the first run.
10. **"Cliffhanger" written in a sound cue is a strong signal.** Writers mark these beats. A new show without that word will lean on the other cues, so scores may run lower.
11. **The join penalty is 0.08, not 0.05.** At 0.05, stitched promos took 3 of the top 4 places, which goes against "usually one continuous stretch".
12. **NMS also drops a promo that shares an exact opening or ending with a better one.** Overlap under 50% can still mean the same hook posted twice, once a stitched promo is allowed.
13. **A clip cannot start on a continuation line** (one opening with an ellipsis, a dash or a lower-case letter). The first evaluation found clips that began mid-sentence.
14. **Labels came from Claude Code, not a human editor.** The brief asked for the builder's own judgment, and Claude Code applied the three tests in the brief while building. They need a human review before anyone relies on them.
15. **The random baseline uses NMS survivors.** The brief says "valid candidates". Survivors are harder to beat than the full 25k, most of which are near-copies.
16. **Raw outputs hold excerpts only.** `promos.json`, `ranking.md` and `candidates_all.csv` carry the excerpts and cue words the promos use, and they go only to Kuku's reviewers. Full episodes are never written out.
17. **The live app is on GitHub Pages.** The Vercel CLI had no login on the build machine, and the brief allows this fallback. `docs/DEPLOY.md` has the Vercel steps.
18. **The LLM pool is 30 candidates.** Only the top survivors go to the model, which keeps cost per show flat as episodes grow.
19. **`gemini-2.5-flash` is only the default model name.** It is one text field, so it can be swapped when the model is retired.

## v2 (2026-11-08)

20. **The repo stays under `Abhey-05`.** The v2 brief asked for `Abhey-05` and named another person. The builder confirmed the project is theirs (Abhey Garg, EE23BTECH11202, from their resume), so the builder card was corrected and nothing was migrated.
21. **The heuristic stays stage 1 and is unchanged.** The agent only reorders, re-cuts and rewords what the heuristic shortlisted, so every v1 metric still holds for heuristic mode.
22. **AI score = (hook + cliffhanger + standalone − 3) / 12**, a 0 to 1 scale like the heuristic total, so `final = α × AI + (1 − α) × heuristic` mixes like with like. α defaults to 0.6. A candidate the judge could not rate keeps its heuristic score as its final score.
23. **The judge sees no heuristic scores.** Showing them would anchor the model to the rules it is meant to check.
24. **The per-episode cap applies to the final 10, not the shortlist.** Capping the shortlist left only about 4 candidates for the model on the 2-episode demo show.
25. **Re-cuts may only tighten.** The model picks entry IDs inside the original window. A re-cut that overlaps another candidate is rejected and the original kept. A re-cut is rescored by the heuristic, and its AI rating from the judge is kept, because the content is a subset of what was judged.
26. **A hook must start in the first 3 s and a cliffhanger must end in the last 5 s.** The write-up validator uses the same windows as the heuristic.
27. **Quotes must be exact substrings of one script entry.** Whitespace is not normalised for hooks and cliffhangers. Quotes inside a "why" line are checked against the promo's text with whitespace normalised.
28. **One retry per stage, then per-item fallback.** A stage that fails twice keeps the heuristic result for the items that failed, flagged `llm_fallback`. A provider error (bad key, CORS, call cap) falls back the whole stage. A run never fails because of the model.
29. **The call cap is 14 per run.** Three judge batches, refine and write-up, each with one retry, is 10.
30. **Cost is shown only for models with a checked price.** Only `gemini-2.5-flash` ($0.30 / $2.50 per million tokens) is in the table. Other models show tokens and "no price on file", rather than a guessed price.
31. **Default model names are suggestions.** The model field is free text. The defaults (claude-haiku-5-5, gpt-4.1-mini, gemini-2.5-flash, llama-3.3-70b-versatile) were not called for real; a retired name gives a readable "model not found" from Test connection.
32. **The confidential pack is never sent to a provider by default.** The CLI refuses an input inside `input_pack/` with a provider unless `KUKU_ALLOW_PACK_TO_LLM=1`. In the web app the user chooses what to upload, and Settings says where excerpts go.
33. **Held-out labels are the builder's own.** `docs/labels_heldout.csv` is a fresh blind sheet; the old labels stay, marked as tuning labels.
34. **About Me uses the resume's text, not the PDF.** The PDF has a phone number and a referee's email, so it is not published. The viewer shows a placeholder until a cleaned `public/resume.pdf` is added. LinkedIn and email are placeholders until the builder provides them.
