# Disease-linked scores + ICU auto-calculation — design

**Date:** 2026-07-15
**Status:** Draft for review
**Author:** Claude (StewardMD)

## Problem / goal

The app has two assets that currently don't talk to each other:
1. A knowledge base of ~5,000 diseases, surfaced in the **Clinical Reasoning / Dx & Management** view (`reasoning.js`, data in `dxmgmt.js`).
2. A registry of ~405 clinical calculators/scores (`calculators.js`, `window.MEDCALC`).

Clinicians must remember *which* score applies to a condition and enter every value by hand. Goal:
- **Feature A — Disease → relevant scores.** When a diagnosis is shown, surface the scores that matter for it (e.g. acute pancreatitis → BISAP, Glasgow-Imrie, Ranson, APACHE II) as one-tap chips in the management area.
- **Feature B — ICU auto-calculation.** In the ICU dashboard, automatically compute the scores whose inputs are already available from fetched labs/vitals (SOFA, qSOFA, BISAP, MELD, …), showing value + interpretation, and greying out any that are one value short.

## Users / success criteria

- A clinician viewing "acute pancreatitis" in Clinical Reasoning sees a **Relevant scores** row and can open BISAP pre-filled in one tap.
- A clinician on the ICU dashboard sees a **Scores** panel that already shows the patient's SOFA/qSOFA/NEWS2 (from vitals) plus diagnosis-relevant scores (e.g. BISAP if the working diagnosis is pancreatitis), each with the inputs used, and "needs: GCS, lactate" where data is missing.
- **No formula is duplicated or wrong.** Every auto-computed score is produced by the *same* `MEDCALC` compute the manual calculator uses, and every ICU adapter is unit-tested against that calculator.

## Non-goals (YAGNI)

- Not wiring all 405 calculators into the ICU auto-engine — only those whose inputs ICU already ingests.
- Not hand-mapping all 417 `DX_MGMT` conditions — curate the high-yield ~80 and use a keyword fallback for the rest.
- Not changing the calculators themselves, the KB JSONs, or the ward-sync/fetch pipeline.
- No new backend; everything is client-side, consuming existing globals.

## Architecture overview

```
calc-links.js  (NEW, window.CALC_LINKS)
   ├── LINKS:  { <dxId>: [calcId, ...] }         curated, high-yield
   ├── KW:     [ { re:/pancreatit/i, calcs:[...] } ]   keyword fallback
   ├── forDisease(id, name) -> [calcId]   (existence-filtered vs MEDCALC._calcs, deduped, capped)
   └── forText(freeText)    -> [calcId]   (keyword match; for ICU free-text diagnosis)

reasoning.js  (EDIT)  — Feature A
   card() :~2295, openMgmt() :~2658, renderNIPage() :~4440
   → render "📊 Relevant scores" chip row from CALC_LINKS.forDisease(r.id, r.name)
   → chip onclick = SB.calc(calcId)   (existing hook; fallback MEDCALC.open)

icu.js  (EDIT)  — Feature B
   ├── vitals shape + ingest: ADD `gcs`
   ├── AUTOSCORES registry: [ { id, label, adapt(state) -> v|null, needs:[...] } ]
   ├── recompute(s): for each AUTOSCORE, v=adapt(s); if v -> MEDCALC._calcs[id].compute(v)
   │                 store into s.scores = [ {id,label,value,interp,used,missing} ]
   └── new "Scores" render section: always-on vitals scores + CALC_LINKS.forText(patient.diagnosis)
```

**Compute reuse (key decision):** ICU auto-calc calls `window.MEDCALC._calcs.find(c=>c.id===id).compute(v)` — the exact formula the UI uses. Rejected alternative: re-implementing formulas in `icu.js` (duplicates patient-critical logic, drifts).

## Component 1 — `calc-links.js`

New self-contained IIFE exposing `window.CALC_LINKS`. Small (< 400 lines).

```js
var LINKS = {
  acute_pancreatitis: ["bisap","glasgow_imrie","ranson","apache2"],
  upper_gi_bleed:     ["gbs","rockall","aims65"],
  dka:                ["anion_gap","corr_na","effective_osm"],
  cirrhosis:          ["childpugh","meld","meld_na","meld3"],
  pulmonary_embolism: ["wells_pe","perc","pesi","years_pe"],
  community_acquired_pneumonia: ["curb65","crb65","psi","smartcop"],
  ischemic_stroke:    ["nihss","abcd2","dragon","thrive"],
  // … ~80 curated high-yield conditions, keyed by DX diagnosis id
};
var KW = [
  { re:/pancreatit/i,            calcs:["bisap","glasgow_imrie","ranson","apache2"] },
  { re:/\b(sepsis|septic)\b/i,   calcs:["sofa","qsofa","news2","sirs"] },
  { re:/cirrhosis|hepatic|liver failure/i, calcs:["childpugh","meld","meld_na"] },
  // … fallback patterns
];
```

**API contract:**
- `forDisease(id, name) -> string[]`: `LINKS[id]` first, then any `KW` whose `re` tests `name`; concat, dedupe, drop ids not present in `MEDCALC._calcs`, cap (e.g. 6).
- `forText(text) -> string[]`: `KW` matches on free text; same filtering. Used for ICU `patient.diagnosis`.
- Both must tolerate `window.MEDCALC` being absent (return `[]`), since load order isn't guaranteed.

The DX diagnosis ids are enumerable from `reasoning.js` (`SYNDROMES`, `DDX_NI`) and `dxmgmt.js` keys — the curated `LINKS` keys are validated against that list during build (a dev-time check logs unknown keys; never throws in prod).

## Component 2 — `reasoning.js` (Feature A)

Three injection points, all rendering the same helper `scoreChips(r)`:
1. `card(r, …)` expanded detail (~`:2295`) — next to the existing "Related bedside tools" block.
2. `openMgmt(r)` (~`:2658`) — immediately after the `💊 Management / Treatment` `<ol>`.
3. `renderNIPage(e, syn)` (~`:4440`) — the full-page non-infective path.

`scoreChips(r)` builds:
```
📊 Relevant scores:  [ BISAP ] [ Glasgow-Imrie ] [ Ranson ] [ APACHE II ]
```
from `CALC_LINKS.forDisease(r.id, r.name)`, using each calc's `title` (from `MEDCALC._calcs`). Chip `onclick` → `SB.calc(id)` (with `MEDCALC.open(id)` fallback). If the list is empty, render nothing. Reuse the existing tool-chip CSS classes (no new styling framework).

## Component 3 — `icu.js` (Feature B)

### 3a. GCS field
`vitals[]` gains `gcs`; add `gcs` to the monitor ingest keys and to `WARD_LAB_MAP`/mapping so it populates from fetched data or manual entry. Existing inline qSOFA (`recompute` ~`:160`) already reads `lv.gcs`; this closes that gap.

### 3b. `AUTOSCORES` registry + `recompute` hook
```js
var AUTOSCORES = [
  { id:"qsofa",     always:true, adapt:function(s){ ... } },
  { id:"sofa",      always:true, adapt:function(s){ ... } },
  { id:"news2",     always:true, adapt:function(s){ ... } },
  { id:"bisap",     dx:/pancreatit/i, adapt:function(s){ ... } },
  { id:"meld",      dx:/cirrhosis|liver|hepat/i, adapt:function(s){ ... } },
  { id:"meld_na",   dx:/cirrhosis|liver|hepat/i, adapt:function(s){ ... } },
  { id:"childpugh", dx:/cirrhosis|liver|hepat/i, adapt:function(s){ ... } },
  { id:"anion_gap", always:true, adapt:function(s){ ... } },
  { id:"corr_na",   always:true, adapt:function(s){ ... } },
  { id:"pf_ratio",  always:true, adapt:function(s){ ... } },
  { id:"apache2",   dx:null, adapt:function(s){ ... } }   // phase 1b (banded)
];
```
`adapt(state)` returns either a values object `v` for the calc's `compute`, or `{__missing:["GCS","lactate"]}` when required inputs are absent. In `recompute(s)`:
- For each AUTOSCORE that is `always` **or** whose `dx` regex matches `s.patient.diagnosis` (per user decision: diagnosis-driven + always-on vitals scores):
  - `var v = def.adapt(s);`
  - if `v.__missing` → push `{id, label, missing}` (rendered greyed).
  - else → `var r = MEDCALC._calcs.find(c=>c.id===def.id).compute(v)`; push `{id, label, value:r.v, unit:r.u, interp:r.i, used}`.
- Write to `s.scores` (new state field). `recompute` already runs after every ingest, so scores refresh automatically.

### 3c. Render — "Scores" panel
New section in the ICU overview listing `s.scores`. Each row: score name, value + unit, one-line interpretation, small "inputs used" line, and an "Open calculator" link (`MEDCALC.open(id)`) to see/adjust the full form. Greyed rows show "needs: X, Y". Diagnosis-linked suggestions with no data yet appear as openable chips (via `CALC_LINKS.forText(patient.diagnosis)`), mirroring Feature A inside ICU.

## Unit / adapter mapping (Phase-1) — the correctness core

ICU units (from `LABDEF`): conventional — creatinine, urea, glucose, bilirubin in **mg/dL**; albumin **g/dL**; Na/K/Cl/HCO₃ **mEq/L**; platelets/WBC **×10⁹/L**; PaO₂ **mmHg**.

| Score | Inputs → ICU source | Conversion / notes |
|---|---|---|
| qSOFA | rr≥22, sbp≤100, gcs<15 (checks) | evaluate thresholds on `vitals` → booleans |
| NEWS2 | rr, spo2, o2, temp, sbp, hr, ACVPU (numbers) | vitals pass-through; **ACVPU** = A if gcs≥15 else V/P/U from gcs; `o2` from FiO₂>0.21 or O₂ device |
| SOFA | 6 banded selects (0–4): P/F, platelets, bilirubin, MAP+pressors, GCS, creatinine | **adapter encodes SOFA bands**; platelets ×10⁹/L pass-through; bili & creat mg/dL match; pressor dose from `infusions` (`isPressor`); tested vs manual SOFA |
| BISAP | **bun** (mg/dL), ams (GCS<15), sirs, age, effusion | **BUN = ICU `urea` ÷ 2.14** (ICU stores blood urea mg/dL, ref 15–45; code notes BUN≠urea); SIRS derived from temp/hr/rr/wbc; age from `patient.age`; effusion → `needs` (imaging) |
| MELD / MELD-Na | bili, inr, cr (mg/dL), na (mEq/L), dialysis | **pass-through** (units already match); dialysis flag default false |
| Child-Pugh | bili, alb, inr, ascites, encephalopathy | bili/alb/inr pass-through; ascites & enceph are clinical → `needs` unless recorded |
| anion gap | na, cl, hco3, alb (mEq/L, g/dL) | **pass-through** |
| corrected Na | na (mEq/L), glu (mg/dL) | **pass-through** (ICU glucose is mg/dL) |
| P/F ratio | pao2 (mmHg), fio2 (%) | pao2 pass-through; **fio2 × 100** if stored as fraction (0.4 → 40) |
| APACHE II (1b) | 12 banded selects + age + chronic | banded adapter; deferred to phase 1b due to breadth; tested vs manual |

Pass-through scores (MELD, MELD-Na, anion gap, corr Na, P/F) are lowest-risk. Banded scores (SOFA, APACHE II) and BISAP's BUN conversion are the tested-critical paths.

## Testing strategy

A node harness (mirrors the existing calculator test approach) that:
1. Loads `calculators.js` headlessly (`new Function("window","document",src)`), reads `window.MEDCALC._calcs`.
2. Loads `calc-links.js`; asserts every id in `LINKS`/`KW` resolves to a real calc; asserts `forDisease`/`forText` filtering and capping.
3. For each `AUTOSCORE` adapter: feed a synthetic `ICU_STATE` with known labs/vitals; assert `adapt(state)` → `v`, then `compute(v)` equals the value obtained by entering the equivalent values into the standalone calculator by hand (i.e. the adapter + unit conversion is correct). Explicitly test the **BISAP BUN=urea/2.14** path and one **SOFA** banding vector.
4. Missing-data path: assert `adapt` returns `{__missing:[...]}` when a required field is absent.

No adapter ships without a passing vector. `node --check` on all edited/new JS.

## Rendering / integration risks

- **Load order:** `calc-links.js` must load before `reasoning.js`/`icu.js` use it, but all guard for `window.CALC_LINKS`/`window.MEDCALC` absence and degrade to no-op. Add `<script src="/calc-links.js?v=…" defer>` in `index.html` before `reasoning.js`.
- **Cache-busting:** bump the `?v=gold…` query on edited files per the app's existing convention.
- **`patient.diagnosis` is free text:** matching is best-effort via `forText`; never assert a diagnosis, only *suggest* scores.
- **Duplication of banding thresholds** (SOFA/APACHE) in adapters: accepted, but each is pinned by a test against the calculator.

## Rollout / phasing

- **Phase 1:** `calc-links.js`; Feature A in `reasoning.js`; ICU GCS field; ICU Feature B for pass-through + simple-banded scores (qSOFA, NEWS2, SOFA, BISAP, MELD, MELD-Na, Child-Pugh, anion gap, corr Na, P/F); Scores panel.
- **Phase 1b:** APACHE II adapter (full banded) once its vector test passes.
- **Phase 2 (future):** broaden curated `LINKS`; more auto-scores as ICU ingests more fields; pre-fill the full calculator form from ICU state when opened from the panel.

## Open questions resolved
- Mapping source: **central `calc-links.js`** (not per-JSON, not pure-runtime).
- Scope: **both features now**.
- ICU panel: **diagnosis-driven + always-on vitals scores**.
- Missing input: **show greyed with "needs: X"** + open-calculator button.
