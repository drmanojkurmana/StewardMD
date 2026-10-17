# Handoff: run the CodeBlue trainer UI test (lead action)

The headless-Chrome UI runner for the Megacode/ACLS trainer could not be
executed in the build sandbox (concrete blockers below). Please run it on a
capable machine and return the results.

## Command

```sh
SHOTS=/tmp/cbt-shots node test/run-codeblue-trainer-ui.mjs
```

Optional overrides (same as other `run-*-ui.mjs` runners):
`BASE=http://localhost:PORT/` for a running server, `CHROME=` for the binary,
`CHROME_FLAGS=` for extra flags.

## What a pass looks like

- 35/35 `PASS` lines ending with `ALL PASS` (exit 0). Any `FAIL` line exits 1.
- 8 screenshots in `$SHOTS`: `cbt-home`, `cbt-guided`, `cbt-debrief` in light
  and dark, plus `cbt-case-light` and `cbt-mine-dark`.
- Coverage: home disclaimer plus TRAINING badge, guided wrong-pick
  explanation and coach line, test station clock to a scored debrief citing
  SPEC timings, practice case to a result, My training with reset, 390 px
  no-horizontal-scroll, all touch targets at least 44 px, body-text contrast
  at least 4.5:1 in light and dark, reduced-motion support, close and
  re-entry disclaimer.

## Already verified (no need to redo)

- `node test/codeblue-trainer.test.mjs`: 15/15 pass (content validity,
  counts, scoring, store, SPEC timings).
- All UI flows driven with real clicks against the real files in jsdom:
  35/35 pass. Nine token-pair contrast ratios computed numerically:
  6.16:1 to 16.36:1.

## Sandbox blockers (why it was not run here)

1. Loopback TCP is denied: `listen EPERM 127.0.0.1`. The static server,
   free-port probe and CDP websocket cannot start.
2. Installed Chrome 155 SIGABRTs (exit 134) even for `about:blank
   --dump-dom` with a redirected HOME. No headless-Chrome run is possible
   in that sandbox.

## Please return

1. The runner output (pass count, e.g. `ALL PASS`).
2. The 8 screenshots, or a note of any visual defect they show.
3. Any `FAIL` lines verbatim.
