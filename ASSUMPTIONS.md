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
