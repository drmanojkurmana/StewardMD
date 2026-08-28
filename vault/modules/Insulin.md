---
tags: [module, clinical]
---
# Insulin — dose CDSS

Clinical decision-support module for insulin dosing. Active recommender, but the physician
decides: every recommendation is stamped AI-assisted and requires an explicit confirm.

## Flag + default
- `smd_insulin` — master flag, **DEFAULT OFF**. Reveal the home tile with `?insulin=1` or
  `localStorage.smd_insulin="1"`. `insulin.js` is a complete no-op while OFF.
- `smd_insulin_dka`, `smd_insulin_peds` — high-risk sub-workflows, **DEFAULT OFF**, intended to be
  access-gated (SMD_XACCESS) + R1-reviewed against a cited, institution-configurable protocol. Not
  built yet.
- Registry: `insulin-flags.js` (`window.SMD_INSULIN_FLAGS`), pattern mirrors `thorex-flags.js`.

## Key files
- `insulin-engine.js` — pure dose math (`window.INSULIN_ENGINE`, dual-export for node). correction,
  meal bolus, combined (IOB-subtracted), activeInsulin (linear IOB), isf/icrFromTdd, basalInitiation.
  Every result: `{result, rounded, unit, steps[], formula, assumptions[], clinicalNotes[], refs[]}`.
- `insulin-safety.js` — pure safety eval (`window.INSULIN_SAFETY.evaluate(context, input, result)`),
  severity-ranked warnings (`info|caution|warning|critical`); `critical` => `interrupt:true`.
- `insulin.js` — overlay UI (`window.INSULIN={open,close,isOn}`), combined/meal/correction screens,
  transparent step panel, confirm gate, AI banner. motion.dev via `window.Motion`.
- `insulin.css` — scoped `#insulinRoot`/`.ins-*`; inherits app `--rds`/`--sev` tokens (light+dark).
- `insulin-demo.html` — dev-only standalone harness (sets the flag, opens the module).
- Tests: `test/insulin-engine.test.mjs`, `test/insulin-safety.test.mjs`, `test/insulin-golden.test.mjs`
  (`node --test`, 31 cases). Golden suite locks clinical outputs — change expected values only with a
  documented rationale.

## Integration points
- `home.js` — flag-gated tile in `rnav-grid` (`rtile("insulin","vaccines",...)`); `ACT.insulin`
  dispatcher persists the flag and calls `INSULIN.open()`.
- `index.html` — `insulin.css?v=ins1` + `insulin-flags/engine/safety/insulin.js?v=ins1` (defer, after
  home.js).

## Dependencies
- `window.Motion` (vendored `/vendor/motion/motion.js`, loaded app-wide by dialog-motion.js).
- Reuses `calculators.js` conventions (mg/dL canonical, `/18` mmol/L inline). `insulin_rules` in
  `calculators.js` already did ISF/ICR-from-TDD; the engine extends that, does not duplicate it.

## Status (2026-08-02, branch `claude/insulin-module`)
- DONE + verified: backend engine + safety (31 tests); routed shell (Dashboard / Calculator /
  Library / Compare / Settings); combined/meal/correction calcs; transparent steps + How-it-works
  panel (method + formula + trusted source); manual + preset target; signal-word-placard safety
  banners (variant A) with critical hard-interrupt + confirm gate; Settings (rounding, default target,
  max bolus, max daily, institution) persisted per-uid; dose-history audit log persisted + on the
  dashboard; daily-total feeds max-daily check; insulin database (`insulin-db.js`, 15 insulins x 7
  classes) with search / class filter / rich cards / side-by-side compare (37 tests total); motion +
  ported Magic-UI effects; app integration (tile/dispatch/reg). Storage keys:
  `smd_insulin_settings_<uid>`, `smd_insulin_log_<uid>`.
- UNITS: mg/dL ONLY (India standard, owner decision) - mmol/L toggle and unit-switch code removed;
  `open()` forces `SET.units="mgdl"`. The mmol helpers remain as no-ops; do not re-add mmol without asking.
- DONE (this pass): bolus-insulin selector in the calculator (persisted) - the chosen insulin drives
  timing/PK guidance, an IOB estimate from the confirmed-dose log via its DIA (INSULIN_ENGINE.activeInsulin),
  and a short-acting-insulin safety note.
- DONE (this pass): reusable patient profiles in a dedicated per-uid store
  `smd_insulin_patients_<uid>` (name/age/sex/weight/dxType/notes + ICR/ISF/target/preferred-bolus +
  pregnancy/renal/hepatic flags; NO MRN/DOB). Create/edit/use/delete + search; using a profile applies
  params to the calculator and its flags feed the safety engine; dashboard patient bar + calc chip;
  "Import from saved cases" bridge (app-only).
- DONE (this pass): guided insulin **conversion** (`insulin-convert.js`, 9 tests) - conservative
  bolus<->bolus / basal<->basal (NPH -20%) / premix<->premix / basal->basal-bolus, with assumptions +
  monitoring + follow-up + mandatory verify-against-protocol confirm gate; dashboard entry.
- iOS bundle assembled: `npm run build:www` (build #2276) then web assets copied into
  `ios/App/App/public` (gitignored) + `ios/App/App/capacitor.config.json` taken from the main checkout
  (22 plugins incl. WatchBridge). Did NOT run `cap sync` on purpose - `node_modules` here lacks
  `@capacitor/cli` and an incomplete-`node_modules` sync drops plugins ([[watch-bridge-capapp-spm-gotcha]]).
  Only web assets changed, so the manual public copy is equivalent + safe. Open `ios/App/App.xcodeproj`
  (SPM, not `.xcworkspace`); devicectl uninstall before install to drop the stale SW.
- NOT done (rest of v1 scope): basal/IOB dedicated screens (engine done); gated DKA + pediatric
  (deliberately deferred - need cited protocol + R1 sign-off, high harm); tighten `refs` to pinned
  citations (R1 item); expand the insulin dataset; on-device verification of the native build.

## Ask MaiK (2026-08-29, `smd_insulin_ask` DEFAULT OFF)
Free text -> MaiK PRE-FILLS the calculator; it never prints a dose. Decision + rationale:
`vault/decisions/Decisions.md` 2026-08-28. Files: `insulin-extract.js` (`window.INSULIN_EXTRACT` -
validator + provider seam, node-testable), `functions/api/ai/_insulin-extract.js` + the
`insulin-extract` kind in `functions/api/ai/[[path]].js`, the `ask*` block in `insulin.js`,
`.ins-ask*` in `insulin.css`.
Tests: `test/insulin-extract.test.mjs` (34, in `npm test`) + `test/run-insulin-ask-ui.mjs` (34, headless).

- **The load-bearing line is the HOLD.** This calculator has NO Calculate button - `render()` recomputes
  on every keystroke. `st.askPending` short-circuits `render()` to paint the review card instead of
  computing. Remove it and the feature silently becomes the inline answer the owner rejected.
- **Required-but-unread inputs are BLANKED, not defaulted**, because `st` has a value for everything
  and the engine will not catch it (see the IOB gotcha below). `inval()` renders a non-finite value as
  an empty box; Calculate stays disabled until `askUnresolved()` is empty.
- `pedStage` is REQUIRED for pediatric: `pediatricInit()` does `stageFactor[stage] || 0.5`, so an
  unstated stage silently becomes prepubertal.
- A gated workflow (DKA, paediatric) is never opened by a sentence - `askAllowedModes()` filters, and
  an out-of-list mode comes back as a steer message.
- Extraction is CLOUD (`SMD_AI.maik`). On-device is a `setProvider()` swap, not yet wired - the local
  engine takes a KB package, not a prompt, and is PRO + pack gated. **Owner decision pending.**

## Gotchas
- **`firstDoseCorrection()` IGNORES a plain `iob` argument** (it resolves IOB only from
  `priorDose {units, minutesAgo}`, else states "0 u assumed" in its provenance), and `compute()` never
  passes `st.iob` into it. But `firstDoseInputs()` renders an `iob` box in the **Known TDD** branch.
  That box is DEAD: typing an IOB there changes nothing while reading as "stacking was accounted for".
  Found 2026-08-29 while building Ask MaiK; NOT fixed (pre-existing, needs an owner call - wire it
  through to `priorDose`, or drop the box). Ask MaiK deliberately does not fill or demand it there.
- motion.dev (this build) mis-interpolates a `transform` **string** with a `"none"` keyframe and can
  settle at `scale(0)` (invisible). Use typed props (`scale`, `y`), never a transform string. See the
  `springIn()` fix in `insulin.js`.
- Patient data must stay MRN/DOB-free (app deliberately avoids storing those; `caseshare.js` redacts
  them). Insulin profiles use their own store `smd_insulin_patients_<uid>`, NOT `SMD_CASES`.
- `SMD_CASES` (account.js-wrapped) is a callback API: `save(ownerKey, useFs, caseObj, cb)` and
  `getAll(ownerKey, useFs, cb)` - both return `undefined` if called without the ownerKey+callback (and
  it's auth/owner-dependent + cloud-merged). Use `SMD_OWNER_KEY()` for ownerKey. Only used here for the
  read-only "import from saved cases" bridge; do not build profile persistence on it.
- Native app only sees this after build-www -> cap sync -> native rebuild + reinstall.
