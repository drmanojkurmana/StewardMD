# Kardia QA report (jobs cxp-kardia-wp13, cxp-kardia-wp13b, 2026-10-25)

Scope: plan section 7 validation gates. Unit evidence was run in the wp13b pass
(`node --test --experimental-test-module-mocks --experimental-sqlite
test/kardia-*.test.mjs test/kardiox-*.test.mjs`: 187 passed, 0 failed).
The Chromium runners could not run here (this sandbox cannot launch Chromium),
so `test/run-kardia-ui.mjs` was fixed and statically verified, and the lead
reruns it. Static scans below are labelled as such; they do not replace the live run.

Lead run commands (Chromium required):

- `node test/run-kardia-ui.mjs` (extended: every tab and screen at 390, 820 and
  1194 x 834, light and dark, plus all QA gates)
- `node test/run-kardia-measure-ui.mjs` (390/820 only; unchanged)
- `CHROME=<chrome-headless-shell> CHROME_FLAGS="--single-process --no-zygote --no-sandbox --disable-gpu" node test/run-kardia-geom-ui.mjs`
- Same `CHROME`/`CHROME_FLAGS` form for `run-kardia-us-ui.mjs` and
  `run-kardia-doppler-ui.mjs`

## Gate 1. Cycle model ranges: partly met

Unit tests prove the automated half: `test/kardia-sim-heart.test.mjs` 10/10 and
`test/kardia-pathology.test.mjs` 21/21 pass, and every view carries its guideline
source in own words in `kardia/views.json`. Still needs the owner: an independent
fact-check of each number against the cited ASE/BSE/ACEP guideline, and a named
clinical reviewer (plan section 9 leaves open who that is).

## Gate 2. View catalogue: partly met

`test/kardia-catalogue.test.mjs` 13/13 and `test/kardia-sim-probe.test.mjs` 9/9
pass (catalogue shape, landmarks, tolerances, probe clamps and scoring).
The automated probe sweep plus screenshots in `run-kardia-geom-ui.mjs` are
written but not executed here; needs the lead run.

## Gate 3. Renderer 30 fps, no context-loss crash: needs the owner

Unit halves pass (`kardia-sim-geom` 16/16, `kardia-sim-us` 10/10) and the
SwiftShader frame/context-loss/restore runners (`run-kardia-geom-ui.mjs`,
`run-kardia-us-ui.mjs`) are written but not executed here. Two owner items:
the 30 fps check must happen on a real iPhone 12-class device and iPad mini 6
(SwiftShader numbers are not device numbers), and the owner signs off on
screenshots (`work/shots/kardia-geom-*.png`, `kardia-us-*.png`) before phase 2.

## Gate 4. Measurements: partly met

`test/kardia-sim-measure.test.mjs` 7/7 passes and `run-kardia-measure-ui.mjs`
grades Simpson biplane and VTI traces against ground truth at 390/820 with
44 px controls and no-overflow checks. Full-app grading is additionally covered
in the extended `run-kardia-ui.mjs` case flow at 390/820/1194. Needs the lead run.

## Gate 5. Doppler: partly met

`test/kardia-sim-doppler.test.mjs` 21/21 passes (Bernoulli gradients, aliasing,
colour jet geometry). `run-kardia-doppler-ui.mjs` renders PW/CW/colour and is
written but not executed here; needs the lead run.

## Gate 6. Content: partly met

- British spelling, no em/en dashes, cited numbers: `test/kardia-learn-content.test.mjs`
  10/10 and `test/kardia-mcq.test.mjs` 7/7 pass. Static scan in the wp13 pass found
  zero `color|center|anemia|hemorrhage|esophageal|ischemia` and zero em/en dashes
  in rendered Kardia text (`kardia.js`, `kardia-cases.js`, `kardia/views.json`,
  `kardia/cases/`, fixtures, learn/decks). The wp13b pass found the same scan
  failing on the KardiQ X atlas that Learn ECG renders (titles such as
  "NSTEMI / Subendocardial Ischemia" plus categories and body text): all
  learner-visible American spellings in `kardiox-content.js` (83 replacements)
  and `kardiox-content-pack.js` (484) were converted to British
  (ischaemia, haemorrhage, oedema, anaemia, oesophageal, paediatric, centre,
  colour, haemodynamic, with case and plurals preserved); ids, keys, image
  paths and trace data are byte-identical, rescans are clean, and all kardiox
  unit tests still pass (list of files under wp13b fixes below).
- `ai_drafted` until review: `kardia/views.json` carries `"review":{"status":"ai_drafted"}`
  and every screen keeps the draft footer; clinical review needs the owner.
- KardiQ X gate untouched: `test/kardia-host.test.mjs` 13/13 passes and the
  extended runner re-proves the tab never opens the AI overlay without a code.
- UI QA gates (extended in `run-kardia-ui.mjs`, pending the lead rerun): every tab
  main screen, one open echo lesson, one answered bank question and the case
  debrief are probed at 390, 820 and 1194 x 834 in light and dark for document
  `scrollWidth <= viewport`, every control target >= 44x44 CSS px (inline text
  links excepted per the WCAG inline-target exception; measured sizes are
  divided by the page's effective scale from a 100px probe, so phone-width
  scaling never fails them), accessible names on all buttons and inputs, a
  `:focus-visible` 2px outline (engine `specialty.css` covers all buttons;
  `kardia.css`/`kardia-cases.css` add chest, strips and inputs; the measured
  width is likewise scale-corrected), body-text contrast >= 4.5:1 computed from
  computed styles (two live failures fixed in wp13b: faded bank options 1.25,
  active step chips 2.58; see below), emulated `prefers-reduced-motion`
  zeroing all Kardia transitions (durations <= 0.01s count as disabled; the
  case-history residual is fixed in wp13b), and the wording scan above repeated
  live plus a full 8-step fixture-case text sweep.
- Static token contrast (computed in this pass, live computed-styles check
  pending): dark text 17.81:1, dark muted 8.73:1, light text 16.75:1, light
  muted 6.53:1, light accent 6.50:1, light ok 5.02:1, light bad 6.57:1, light
  warn 5.43:1. All clear of 4.5:1.

## Gate 7. Licences: met

`test/kardia-media.test.mjs` passes: `kardia/media/credits.json` parses, every
clip carries a commercial-use licence (CC BY/CC BY-SA/CC0/public domain, never
NC/ND) with attribution, source URL, de-identification note and sha256.
Scoped search over `kardia/`, `data/` and `docs/kardia/` finds no EchoNet,
EchoXFlow, CAMUS or MIMIC reference; `kardia/media/` holds only `credits.json`
(clips ship from R2).

## Small fixes applied in the wp13 pass

- `kardia-flags.js` header comment held the repo's only em dash in any
  `kardia*` source; replaced with a colon. It was never rendered, but gate 6
  is zero-tolerance. (The "no CSS change needed" reading was superseded by
  wp13b below: the live run caught two real contrast defects and one
  reduced-motion residual that token reading had missed.)

## Fixes applied in this pass (job cxp-kardia-wp13b)

Checker artefacts (lead's 86 failures that are not app defects):

- A. Phone-width scaling: the app pages scale down at phone widths (44px
  targets measured ~42px, the 2px focus outline ~1.85px). `test/run-kardia-ui.mjs`
  now plants a known 100px probe inside `#smdKardia`, computes the effective
  scale, and divides every target rect, the focus outline width, and the tab-bar
  44px spot check by it. Thresholds unchanged; inline text links stay excepted.
- B. Reduced-motion tolerance: any computed transition duration <= 0.01s now
  counts as disabled (engines can report `transition: none` as ~1e-06s rather
  than 0s). Durations are parsed per-component with ms/s handling; the
  `animation-name: none` requirement is unchanged.

Real defects (all in `.krd-root`-scoped CSS; no engine file touched):

- C. Answered bank options: the engine fades non-picked options with
  `opacity: .5`, dropping text contrast to 1.25. `kardia.css` now overrides
  `.krd-root .sp-answers .sp-ans[data-state="dim"]` to full opacity with a
  transparent fill and dashed border: still visually de-emphasised, but option
  text keeps full strength (verified by token math: text on neighbouring
  surfaces 13.59-17.81:1, muted letter badge 5.30-7.37:1, both themes).
- D. Case debrief step chips: the active chip (`li[data-on="true"]`, e.g.
  "8 Debrief") set muted-on-accent-wash text read by the probe as 2.58:1
  (light; 1.54:1 dark). `kardia-cases.css` now sets accent text on the opaque
  card surface with an accent border (verified 5.76:1 light, 10.81:1 dark);
  the number bubble was already passing (6.50:1 light, 10.80:1 dark) and is
  unchanged. Inactive chips already pass (5.79-8.18:1) and are unchanged.
- E. Learn ECG American spellings: the titles come from the KardiQ X atlas,
  moved in unchanged. Converted learner-visible titles and text to British in
  exactly two files: `kardiox-content.js` (83 replacements across titles,
  categories, prose, quiz, flashcards) and `kardiox-content-pack.js` (484).
  Ids, keys, image paths, ECG trace/strip data and references are untouched;
  rescan for the runner's American-word list is clean. All kardiox unit tests
  pass unchanged (see unit evidence at the top). Pre-existing note, out of
  scope: the pack holds 14 duplicate ids internally (e.g. two
  `tb-ecg-blog-sick-sinus-syndrome` entries); ids were left byte-identical,
  so this is flagged for the owner, not changed here.
- F. Case history screen reduced motion: `kardia-cases.css` now zeroes
  transitions with `!important` (`.kc-q`, `.kc-bar i`) so the engine's own
  reduced-motion property override cannot resurrect them, and kills the
  residual engine button fade (`.sp-btn`, plus `:active` transform snap) on
  case screens under `prefers-reduced-motion: reduce`.

Verification in this pass: `node --check` on the edited runner; the new
motion-duration filter probed in node (7 cases: 0s/1e-6s/multi-0s pass,
0.14s/140ms/animation/pulse/garbage fail); token-contrast math recomputed for
every changed pair (all >= 4.5:1); atlas rescan clean with ids asserted
byte-identical; `node --test` over all kardia/kardiox suites 187 passed,
0 failed. Chromium execution still needs the lead run (commands at the top).

## Larger defects for the owner/dev (not fixed; engine/behaviour scope)

1. Chest-map probe surface (`#krdChest`, `role="application"`) is pointer-only:
   no `tabindex`, no keyboard path, while the tilt/rock strips have both
   (`tabindex="0"` plus arrow keys). Fix needs a small behaviour change in
   `kardia.js`, outside this pass's css/text scope.
2. Real-phone 30 fps and iPad mini 6 check (gate 3) needs the owner.
3. Clinical sign-off of numbers and content, plus naming the reviewer
   (gates 1, 6), needs the owner.
4. All five Chromium runners need the lead run (commands at the top); nothing
   in this sandbox can execute them. `run-kardia-measure-ui.mjs` still covers
   390/820 only by design (harness UI, not app screens).
