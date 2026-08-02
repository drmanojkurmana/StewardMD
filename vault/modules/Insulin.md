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
  Settings); combined/meal/correction calcs; transparent steps + How-it-works panel (method + formula
  + trusted source); manual + preset target; signal-word-placard safety banners (variant A) with
  critical hard-interrupt + confirm gate; Settings (units mg/dL<->mmol/L, rounding, default target,
  max bolus, max daily, institution) persisted per-uid; dose-history audit log persisted, surfaced on
  the dashboard; daily-total feeds max-daily check; motion + ported Magic-UI effects; app integration
  (tile/dispatch/reg). Storage keys: `smd_insulin_settings_<uid>`, `smd_insulin_log_<uid>`.
- NOT done (rest of v1 scope): basal/IOB dedicated screens (engine done); patient profiles on
  `SMD_CASES`; insulin database + brands + selection + comparison; conversion workflows; gated DKA +
  pediatric; tighten `refs` to pinned citations (R1 item); native rebuild.

## Gotchas
- motion.dev (this build) mis-interpolates a `transform` **string** with a `"none"` keyframe and can
  settle at `scale(0)` (invisible). Use typed props (`scale`, `y`), never a transform string. See the
  `springIn()` fix in `insulin.js`.
- Patient data must stay MRN/DOB-free (app deliberately avoids storing those; `caseshare.js` redacts
  them). Persist to `SMD_CASES` (name/age/sex/notes) only.
- Native app only sees this after build-www -> cap sync -> native rebuild + reinstall.
