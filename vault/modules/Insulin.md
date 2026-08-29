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

## 2026-08-29 (later) - Diabetes type gate, WardSync import, remaining ward gaps

### Diabetes type asked FIRST (owner's design call)
New `dxgate` screen shown on open unless a type is already known or the user skipped.
Five types in `INSULIN_ENGINE.DX_TYPES`: `t1`, `t2`, `stress`, `steroid`, `secondary`.
Each carries `resistance` (sensitive/usual/resistant), `tddFactor`, `correctionOnly`,
`basalMayStop`, `notes[]`, `suggest[]` and `discourage{}`.
- The type SETS THE SCALE: same 70 kg patient, T1 gets ISF 85.7 -> 1/1/2/2/3/4 u; stress
  gets ISF 42.9 -> 1/2/4/5/6/8 u. Verified in the browser.
- The type GATES REGIMENS: correction-only is `never` in t1/secondary (a refusal banner
  renders on the scale screen) and `acceptable` in stress - the recognised ADA exception.
- Stress carries a mandatory "check an HbA1c, at/above 6.5% this is undiagnosed diabetes".
- `Skip - take me straight to the calculator` sets `st.dxSkipped`; everything still works,
  you just get the `usual` band and no type-specific notes. Chip on the dashboard changes it.
- A patient profile's `dxType` (if it matches a known id) restores the type automatically.

### Add a patient from Ward Sync (GHIS / Connect EMR)
"Add from Ward Sync" on the Patients screen, shown only when `GHIS.isConnected()`.
Uses the EXISTING one-shot picker `GHIS.pickPatient(cb)` -> `{episodeId, patientId, name}`,
enriched from `GHIS.getPatients()` (age lives in GHIS's `dob` field, plus gender/bed/dept).
Same handoff SurgX uses. `ghis-ward.js` is generated ("do not edit by hand") and was NOT touched.
**PRIVACY DECISION:** no DOB and no MRN-as-identity is copied. Hospital ids go in a separate
`ward: {source, patientId, episodeId, bed, dept, linkedAt}` block used only for re-linking; they
are never written to the dose log and never appear in the CSV audit export. Weight is deliberately
NOT guessed - every weight-based calculation needs it, so the clinician enters it.

### Remaining ward gaps closed
`nutritionInsulin` (continuous / bolus / TPN; 1 u per 10-15 g carbohydrate, 0.1 u per g dextrose,
plus the feed-interruption -> 10% dextrose warning), `periopRegimen` (75-80% basal, prandial held,
SGLT2 hold 3-4 days, target 100-180), `dischargeRegimen` (home basal 80% of inpatient, regimen by
HbA1c, education checklist + 15-15 rule + 1-2 week follow-up), `sickDayRules` (never stop insulin,
10-20% of TDD extra, ketone testing, red-flag list). UI modes: Tube feed / TPN, Surgery, Sick day
(Special situations) and Discharge (Adjusting).

### Tests: 183 insulin tests pass
- `test/insulin-ward.test.mjs` now 52 (adds dx-type behaviour + the 4 new workflows)
- `test/insulin-ui.test.mjs` NEW, 18 tests - the UI layer driven in Node with a DOM stub
  (same approach as `test/oncotree-ui.test.mjs`). Locks the UI-layer bugs: empty defaults,
  per-patient IOB and daily totals, unit contamination, the paediatric critical gate, the
  pediatric-flag-not-a-fake-age fix, dx routing, WardSync profile privacy, and a
  no-undefined/NaN/[object Object] render check.
- `insulin.js` exposes a test-only `window.INSULIN._st` / `._build` surface for this (mirrors
  `oncotree.js` `_st`). Not used by the app.
Browser-verified again via Playwright on `insulin-demo.html`: type gate, T1 refusal banner,
T1-vs-stress scale differentiation, zero console errors.
Cache-bust: `insulin.css` / `insulin-engine.js` / `insulin-safety.js` / `insulin.js` -> `?v=ins13`.

## 2026-08-29 (ease-of-use pass)

- **`suggest[]` wired up** (it was dead data). The dashboard now reorders the task list for the
  chosen diagnosis and collapses the rest behind "Everything else (n)". A steroid patient sees
  4 relevant tasks with steroid cover first, not 22 flat buttons.
- **`QUESTIONS` table** - one source for the dashboard, the search and the long tail, so they
  cannot drift. Each entry is {question, detail, keywords}.
- **Search across all calculators**, matched on question + detail + keywords. Deliberately
  indexed with ward vocabulary: "ryles", "nbm", "mixtard", "preop", "sliding scale", "stacking".
- **Named empty states.** `NEEDS` declares the required inputs per mode; the result card says
  "Still needed: current basal dose, fasting glucose" and narrows as fields fill. `any` groups
  alternatives ("total daily dose or weight").
- **`dxSkipped` persists** in settings: a clinician who skips the type gate is never asked
  again. The TYPE itself is deliberately NOT persisted globally (it belongs to a patient).
- **a11y**: role="tab" now uses aria-selected + roving tabindex + aria-controls, and the input
  card is a labelled tabpanel. aria-pressed removed from tab roles.

### BUG found and fixed during this pass (and the testing lesson)
`render()` called `missingFields(m)` where `m` is a `var` assigned FURTHER DOWN the function,
so hoisting passed `undefined` and the screen silently fell back to "Enter all required values"
while `missingFields()` itself tested green. Fixed to `st.mode`.
The UI tests had called the helper directly, which is why they missed it. `test/insulin-ui.test.mjs`
now stubs REAL elements for `insOut`/`insInputs` and drives `render()`, asserting what the screen
says. Verified the new test has teeth by reintroducing the bug (2 tests fail) and restoring it.

193 insulin tests pass (28 UI). Cache-bust: `insulin.css` / `insulin.js` -> `?v=ins14`.

## 2026-08-29 - Ask MaiK in the insulin module (`insulin-ask.js`)

**It did not exist before this.** There were zero MaiK references in `insulin.js`; nothing had
been wired in by an earlier session.

### The design: the model fills SLOTS, the calculator does the dose
`window.INSULIN_ASK` (pure, dual-export, 22 tests). A sentence becomes slots; those slots drive
the SAME `INSULIN_ENGINE` function a human would reach, with `INSULIN_SAFETY` unchanged. The
model never emits a dose. That is what makes it both cheap and safe:
- **Cheap:** `parse()` is deterministic regex + keyword routing and costs NOTHING. It already
  handles the ward vocabulary (cbg/rbs/grbs, lantus/basalog/mixtard, nbm, ryles, dexa, GDM
  weeks -> trimester, mmol -> mg/dL). The model is called ONLY for the residue, with
  `llmPrompt()` demanding flat JSON and explicitly forbidding a dose or any prose - a few dozen
  output tokens, not a reasoning chain.
- **Safe:** every slot is range-checked against `BOUNDS` before it can reach the engine, so a
  misread or hallucinated number is DROPPED, not dosed. `applyLlm()` lets the model fill a
  blank but never overrule the local parse, refuses unknown keys, refuses a `task` that is not
  a real calculator, and cannot introduce a `dose` field at all. Anything the model supplied is
  chipped as "AI" in the UI.
- Provider-agnostic: it just exchanges JSON, so Vertex / Gemini / any future SMD_AI backend
  works. Wired through the existing cheap `SMD_AI.refine()` path; no new server endpoint, and
  `functions/api/ai/[[path]].js` was NOT touched.

### Showing the calculator being used
Ask prints no answer of its own. It writes the slots into the ordinary `st` and lands the user
IN the calculator, above which `askReadoutHTML()` shows: the chips it read, "Using the
<name> calculator `engineFn()`", anything still needed, and how it was answered ("Answered on
this device. No AI call was made." / "One small AI call filled: weight."). So there is no
parallel AI path to drift - it is the tested calculator, driven.

Verified in the browser with the owner's own example, "pt sugar is 260, she is pregnant with
GDM at 30 weeks, 68 kg": chips glucose 260 / weight 68 / pregnancy yes / trimester 3, routes to
Correction (`firstDoseCorrection()`), target auto-tightened to 100 mg/dL for pregnancy, dose
2 units from (260-100)/90, pregnancy safety warning raised, **no AI call**. Zero console errors.

215 insulin tests pass. `test/insulin-ask.test.mjs` (22) runs with zero model calls and asserts
the safety contract: implausible values refused, missing values asked for, local parse wins,
model junk dropped, and Ask == the manual screen for the same case.
Loaded in `index.html` + `insulin-demo.html`. Cache-bust: `insulin.js`/`insulin.css` -> `?v=ins15`.

## 2026-08-29 - Clinical acceptance review (diabetologist pass)

`test/insulin-scenarios.test.mjs` (38): whole BEDSIDE CASES rather than unit tests - hypo,
DKA/HHS, paediatric DKA, GDM by trimester, dialysis, cirrhosis, stacking, T1 invariants,
titration through a nocturnal low, overbasalization, steroid cap, drip-to-subcut overlap,
perioperative SGLT2, feed interruption, weight-typo caps, mmol misread, discharge, sick day,
and "no calculator produces an uncited number".

### TWO REAL FINDINGS, both fixed
1. **The hypoglycaemia critical said what to withhold, not what to DO.** It read only
   "treat the low first". It now carries the 15-15 rule (15 g fast-acting carbohydrate, recheck
   at 15 min, repeat until above 70), adds 25% dextrose IV / glucagon BELOW 54 mg/dL where the
   patient may not be able to swallow, and explicitly says NOT to omit the next basal dose
   (omitting basal after a hypo is how a type 1 rebounds into ketoacidosis) plus the causes to
   look for. This is the module's most severe warning and it was clinically empty.
2. **The correction scale had no stop conditions.** Its top band handed out 8 units at
   "400 and above" with no ketone prompt - exactly where DKA hides, on a chart a nurse runs
   without the calculator in front of them. The scale now carries, in its own notes: check
   ketones above 300, STOP and assess for ketoacidosis above 400 or if unwell/vomiting/
   breathless, and do not repeat a correction inside 4 hours (stacking).

### One TEST defect found (not a module defect)
A scenario asserted a tighter pregnancy target yields a bigger dose using the ROUNDED value; at
glucose 200 both 120 and 100 round to 2 u (1.6 vs 2.0), so rounding hid the effect. Rewritten
to assert the computed value plus a case where the difference survives rounding.

252 insulin tests pass. Cache-bust: engine/safety/ask -> `?v=ins15`.

## 2026-08-29 - R1 CLINICAL SIGN-OFF COMPLETE (gate discharged)

The DKA and paediatric workflows were held behind a "needs a cited protocol + R1 review" gate
carried forward from the original build. **That review was performed by the owner, a physician,
on 2026-08-29**, against the clinical acceptance suite (`test/insulin-scenarios.test.mjs`):
hypoglycaemia handling, DKA/HHS routing and the potassium gate, paediatric DKA rate and the
cerebral-oedema warning, and the weight-based caps.

**The gate is DISCHARGED, not skipped.** `smd_insulin`, `smd_insulin_dka` and
`smd_insulin_peds` all ship DEFAULT ON deliberately, and `insulin-flags.js` now records the
sign-off instead of describing a pending release gate (the old comment said
"PUBLIC-RELEASE-GATE: dev/testing default ON", which no longer described reality).

Unchanged and still in force - these are product safeguards, not the review gate:
- "Trained clinicians only" banner on every DKA and paediatric screen
- The institutional-protocol acknowledgement checkbox (`clinMode` -> `advAck`)
- The critical-warning acknowledgement, which since this branch applies in DKA and paediatric
  too (it previously did not - that was one of the 11 bugs fixed here)
- Every DKA result still carries "follow your institutional DKA protocol" and its ADA/JBDS-IP
  and ISPAD citations

Future sessions: do NOT re-raise the R1 gate as outstanding. It is closed. If the DKA or
paediatric CLINICAL CONTENT is materially changed, that is a new review, not this one.
