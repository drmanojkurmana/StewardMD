# FIX-1518-BROWSER: Tokos `browser` failure is a main-branch regression, not the Know-more diff

Date: 2026-10-12. Author: merge worker for PR #1518. Status: root cause found, fixed on
`feat/know-more-every-mcq`, regression test added.

## Symptom

Tokos UI `browser` job fails on exactly ONE check, everything else green:

```
❌ caliper steppers carry text and an aria-label in the first markup:
test/run-tokos-ui.mjs line 86
```

The harness clicks `[data-act=clinic]` and, in the SAME evaluate tick, reads
`[data-act=nudge]` expecting `Move line 1 down 1 bpm|−1bpm;Move line 1 up 1 bpm|+1bpm`.
It gets `""` (zero nudge nodes). ~200 ms later the clinic is fully open (5 questions,
calipers attach, grading, reveal, Escape, offline, bank: all green) and "no uncaught
Tokos errors" passes.

## Correction to the task premise: #1518 did not cause this

Bisect of the `tokos-ui.yml` history (all times UTC 2026-10-12):

| Run | Head | Result |
|---|---|---|
| 07:54 main `6e263fdf4` | before motion layer | ✅ success |
| 09:02 main `edebc4761` | Premium motion layer | ❌ same stepper check |
| 10:53 #1518 `086b8df97` (pre-merge head, already contains the motion files) | — | ❌ same |
| 11:13 plan-scope-tests `b1200e14f` | — | ❌ (presumed same; same window) |
| 16:16 plan-scope-tests, 16:21 #1518 `e94a9a0cb`, 16:30 main `2f5cc705b` | — | ❌ identical single failure |

The "passes on main / bank PRs" observations are stale runs from before 08:39 UTC.
Every head that contains main commit `edebc4761` fails; every head without it passes.
#1518's own 7-file diff (`index.html` token, `prep-loader.js` token, `prep-reason.js`,
`prep.css`, `prep.js`, `sw.js`, one prep test) cannot be the cause: none of the prep
files even load during the Tokos test (prep loads lazily on first Prep open), the CSS is
all `.pn-root`-scoped, and the new `data-act` names (`r-kb`, `l-open`, `r-drug`,
`r-proto`, `k-open`, `r-km-sheet`, `r-km-close`) collide with nothing in Tokos.

## Root cause: `view-transitions.js` holds row taps for an async replay

Main commit `edebc4761` ("Premium motion layer", 08:39 UTC) added nine boot scripts,
among them `view-transitions.js`: a **capture-phase document click listener** that
"holds" taps on ROWs (`button, a[href], [role=button], [role=link], [onclick],
[data-act]` that are full-width, 40-180 px tall, with a bold title leaf), calls
`stopImmediatePropagation() + preventDefault()`, and re-dispatches the click
**asynchronously inside `document.startViewTransition()`'s update callback**.

The Tokos CTG clinic row (`button.sp-row[data-act=clinic]`, full-width, ~70 px tall,
bold `<b>CTG reading</b>` title) qualifies as a row. So the harness's clinic tap never
reaches Tokos's handler synchronously: the same-tick `querySelectorAll('[data-act=nudge]')`
runs against the still-showing hub (zero nodes), and the replayed click opens the clinic
a frame+ later (which is why every later check passes and no exception is recorded).
It is the only same-tick DOM assertion in the harness, hence exactly one failure.

Ruled out: `skeletons.js` (CSS class + `el.animate` fade only, never removes nodes),
`long-press-preview.js` (needs a 430 ms pointer hold; synthetic `.click()` has no
pointerdown), `sheet-drag.js` / `pull-refresh.js` (`preventDefault` is in `touchmove`
handlers only), `prep-loader.js` token / `sw.js` CACHE bump (no behavioral effect).

## Fix (on this branch, will merge to main and green everyone)

`view-transitions.js`: never hold taps that start inside a modal dialog. Module overlays
(Tokos `#smdTokos`, PrepNucleus `#smdPrep`, Narke `#smdNarke`) are all
`role="dialog"` + `aria-modal="true"` roots with synchronous tap contracts.

```js
function inOverlay(el) { return !!(el && el.closest && el.closest('[role="dialog"],[aria-modal="true"]')); }
// in the capture listener, right after the row lookup:
if (inOverlay(t) || inOverlay(row)) return;
```

`inOverlay` is exported on the module seam for testing. Home/app rows (drug DB
`#dbOverlay` has no dialog role — verified) still morph; the motion suite's drug-row
transition checks are unaffected.

## Regression test

New `test/view-transitions.test.mjs` (runs in the CI `unit-tests` job, no browser needed;
stubs the globals and drives the real capture listener):

- `inOverlay` seam unit asserts,
- a dialog-contained row tap is NOT held (no `startViewTransition`, no
  `stopImmediatePropagation`/`preventDefault`) — **fails on unfixed code**,
- a plain home-screen row tap IS still held (no over-correction).

Verified: 2 fail / 1 pass on unfixed `view-transitions.js`, 3 pass with the fix.
`test/premium-motion-pure.test.mjs` 9/9 and `test/prep-reason.test.mjs` 21/21 stay green.
The existing Tokos harness line 86 is the end-to-end pin (fails pre-fix, must go green
in CI post-fix).

## For the plan-scope worker (#1520) and the lead

- #1520 needs no own fix: once this branch merges, rebase `plan-scope-tests` onto the
  new main (or cherry-pick the `view-transitions.js` + test commit from this branch).
- Do NOT "fix" this by editing `test/run-tokos-ui.mjs` line 86 (e.g. awaiting a tick):
  the same-tick contract is load-bearing for assistive tech (steppers must expose their
  text + `aria-label` in the first markup) and the hold delays EVERY overlay row tap.
- Heads-up: `test/run-premium-motion-ui.mjs` §7 builds a `role=dialog` fixture whose tap
  previously ran a transition; post-fix it applies synchronously and its asserts
  (`__open===1`, no menu) still hold. That harness has no CI runner (manual only).
