# Assumptions

Numbered in the order they were made. The brief says to assume rather than ask.

1. **Timestamps are the cut list.** The screenplay timestamps are treated as true video timings. No video was available, so nothing here checks them against a real cut.
2. **Episode length comes from the last scene end.** If an entry ran past it, that is reported as a violation, not repaired.
3. **Upper-case scene metadata is the same format.** One episode in the pack writes `SCENE HEADING:` in capitals. The parser is case-insensitive for these labels.
4. **A cut may not land inside a spoken line.** The brief says "snap to entry boundaries", but camera entries overlap dialogue, so an entry boundary can still fall mid-sentence. Any start or end inside a dialogue entry is rejected.
