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

## Gotchas
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

## 2026-08-29 - Clinical-safety fixes + ward workflows (branch `worktree-insulin-5of5`)

### Bugs fixed (all had regression tests added)
1. **Context multipliers compounded.** `bolusContextFactor` multiplied renal x hepatic x
   exercise: 0.75^3 = 0.42, a 58% cut on an ordinary CKD + cirrhosis + ambulating patient
   (9 u -> 4 u). Now takes the **most restrictive SINGLE factor**; the losers are returned in
   `considered[]` and shown as an "Also considered" step. Two tests had CODIFIED the bug
   (`0.42` "// 0.75^3", and `0.56` "contexts compound") - both rewritten with a documented
   rationale per the golden-suite rule.
2. **Exercise reduction applied twice.** The engine reduced 25%, then `bolusContextAdvice`
   advised reducing the ALREADY-reduced dose by a further 25-50% (9 u -> 6 u shown -> "3 to
   4.5 u" advised). Advice now EXPLAINS the applied reduction and forbids a second one.
3. **Hepatic is advisory only.** It applied 0.75 while its own comment said no validated
   multiplier exists. It no longer scales any dose; it returns guidance instead.
4. **IOB and daily totals leaked across patients.** The log had no `patientId`, so on one
   ward phone bed 4's bolus became bed 7's IOB and six patients shared one "max daily
   exceeded" critical interrupt. Log entries now carry `patientId`; `recentBolusDoses()` and
   `todayTotal()` are patient-scoped (`logForPatient()`); with no patient selected IOB is not
   estimated and the daily cap is not applied (an `info` warning says so).
5. **units/hour summed into a unit total.** `todayTotal()` now counts only bolus modes with
   `unit === "units"` - DKA (u/h) and basal/paediatric (whole-day TDD) no longer contaminate it.
6. **Calculator opened pre-filled with a fictional patient** (glucose 180, carbs 45, ICR 10,
   ISF 50, IOB 2, weight 70, age 40) and therefore displayed a dose for nobody. The IOB
   default of 2 silently subtracted 2 u from every correction. ALL clinical inputs now start
   empty; `N()` keeps blank blank rather than passing 0 to the engine.
7. **Critical warnings were bypassable in Pediatric and DKA** (`hasCritical && !clinMode(m)`),
   the two highest-harm modes. Both gates now apply and BOTH must be ticked (`syncCta()`).
8. **Renal chip with no eGFR** now states the band it is assuming instead of silently cutting 25%.
9. **Pregnancy silently overrode an explicit basal factor and rewrote the target.** Both are
   now announced (`factorOverridden`, `st.targetNote`) and a manually typed target survives.
10. **The "Pediatric" chip faked an age** (wrote 8 / 40 into the patient context). Replaced
    with a real `ctx.pediatric` flag; `insulin-safety.js` accepts it alongside a real age.
11. **The audit trail could not record an override.** `confirmDose` now writes `givenDose` +
    `overridden`; history and CSV show the patient and the override. IOB and the daily total
    read `givenDose`, so they follow what was actually prescribed.

### New ward workflows (`insulin-engine.js`, 33 tests in `test/insulin-ward.test.mjs`)
The module was a type 1 outpatient carb-counting tool; residents could not answer the
commonest ward questions with it. Added, each pinned to a named guideline in `refs`:
- `basalTitration` - ADA 2-by-3 rule, hypo overrides a high mean, overbasalization ceiling 0.5 u/kg/day
- `correctionScale` - q6h supplemental table built from the patient's own ISF, capped
- `inpatientInit` - RABBIT-2 (0.4 / 0.5 u/kg by admission glucose; 0.3 if age >=70 or creatinine >=2.0)
- `npoRegimen` - basal continues (never stopped in type 1), prandial held, correction q4-6h
- `steroidCover` - NPH 0.1 u/kg/day per 10 mg prednisolone equivalent, cap 0.4, tapers with the steroid
- `ivToSubcut` - 60-80% of the extrapolated 24 h infusion, basal 2-4 h BEFORE stopping the drip
- `premixInit` / `premixTitration` - 2/3 morning : 1/3 evening; each injection judged on the
  reading before the next one
Plus a `basalT2` UI mode (min(10 u, 0.2 u/kg/day), ADA type 2 initiation).

### UI restructure
Simple/Advanced replaced by five **clinical task groups** (Starting insulin / Adjusting /
High sugar now / Special situations / Work out a ratio). The old split hid ISF and carb ratio
behind "Advanced" while the "Simple" calculators demanded them as input. The dashboard now
opens with the QUESTION ("Sugars are high on the current dose", "Patient is nil by mouth")
rather than formula names. Dose number no longer re-animates from 0 on every keystroke.
Correction scales render as a table; multi-part regimens render every component.

### Flag drift RESOLVED (documentation, not behaviour)
This file said `smd_insulin_dka` / `smd_insulin_peds` were DEFAULT OFF pending R1 sign-off;
`insulin-flags.js` has had them `def: true` since the owner's "flip all on" on 2026-08-16.
The DRIFT was the bug. Flags left ON per the owner's decision; this note now matches the code.
`smd_insulin` is also DEFAULT ON. **If these ship enabled, DKA and paediatric still need the
cited institution-configurable protocol + R1 sign-off that was always the condition.**

### Test counts
146 insulin tests pass (113 existing + 33 new ward). Verified in a real headless browser
(Playwright against `insulin-demo.html`): blank inputs, titration 20->22 u, correction-scale
table, and the Pediatric double-acknowledgement gate. Zero console errors.
Cache-bust tokens: `insulin.css` / `insulin-engine.js` / `insulin-safety.js` / `insulin.js` -> `?v=ins12`.
