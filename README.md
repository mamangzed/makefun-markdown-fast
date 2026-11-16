# makefun-markdown-fast

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/mamangzed/makefun-markdown-fast/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/mamangzed/makefun-markdown-fast/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A fast, dependency-free CommonMark 0.31.2 + GFM 0.29 renderer that returns exactly the HTML marked 18.1.3 produces with its default options. It is a single ES module (`parse.js`) with no dependencies, built for speed: one pass over blocks, one pass over inline content, no regex backtracking on hot paths.

## Cold-start performance

The bounty grades a **fresh process** (`node main.ts` on 720 cases,
2.86 MB of markdown), so the first parse pass — cold JIT, nothing
warmed up — is the number that matters. Measured on the practice set
on the build VM (Node 24, shared 1.5-CPU host; numbers vary ±15%
run to run under load):

| | import | parse pass 1 (cold) | parse pass 2 (warm) |
| --- | --- | --- | --- |
| this entry | ~5 ms | ~1.2 s | ~0.5 s |
| marked 18.1.3 | ~54 ms | ~1.17 s | ~0.8–1.1 s |

Before the cold-start work the entry's first pass was ~1.68 s, ~40%
slower than marked; it is now essentially tied cold and faster warm.
The work that closed the gap, all in `parse.js` and all
behaviour-identical (the full 720-case practice set is still
byte-identical to marked):

- `esc()` fast path: skip the regex entirely when the string contains
  none of `&<>"'` (an `indexOf` check is far cheaper than setting up
  a global regex exec loop).
- `parse()` skips the CRLF normalisation copy when the input contains
  no `\r`.
- `isEmailLocalCh` / `isPunctCP`: `Set` / `String.indexOf` lookups
  replaced by `Uint8Array` tables indexed by char code (no string
  allocation per probe).
- `hasOpenUnd()` cached with a dirty flag, invalidated exactly where
  delimiters change (push, `processEmphasis` entry, end of the `]`
  branch) instead of rescanning the whole delimiter list per autolink
  probe.
- Delimiter `openTags`/`closeTags` allocated lazily (most delimiters
  never match, so most never need the arrays).
- Node shapes made monomorphic: delimiters always carry
  `leftoverInside`, text nodes always carry `nomerge`, link nodes
  always carry `auto`, so V8 stops deoptimising on "wrong map" during
  warm-up.

Reproduce it:

```sh
npm run bench:cold -- /path/to/cases.json [warm-runs]
node test/regression.mjs   # pins the emphasis "star-budget" rule (doc-11)
```

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rf1dx0vr&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
