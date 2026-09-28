---
tags: [module, clinical]
---
# Dose Calculator

Dose for one patient from our own monographs: weight (per kg / per m²), age group, caps, ideal or
adjusted weight in obesity, kidney (CrCl bands, dialysis) and liver (Child-Pugh). Owner request
2026-09-28 ("55 kg, levothyroxine, 1.6 mcg/kg x 55 kg").

## Flag + default
- `smd_dose_calc`: **DEFAULT ON** (owner 2026-09-28: "The doses in our database drug monograph are
  already verified"). Off per device with `localStorage.smd_dose_calc = "0"` or `?dosecalc=0`.
- While OFF: no Drugs-sheet row, no Home/All tools/search entry, no drug-page button, no ICU/OPD button.
  `dose-calc.js` still loads (small) but the rules file is only fetched when the calculator opens.

## Key files
- `scripts/lib/dose-parse.mjs`: text -> rules. Only unambiguous numbers become rules; every number is
  round-trip checked against its sentence (0 rejections). Caps (max / not to exceed) vs "up to" vs doses.
- `scripts/build-dose-rules.mjs` -> `data/dose-rules.json.gz` (shipped; `build-www.sh` copies it to the
  www root). Working copies `data/dose-rules.json` and `data/dose-rules-report.json` are gitignored.
- `scripts/build-dose-review-page.mjs`: the owner review page (artifact "Dose Rules Review", db
  collection `verdicts`, doc {item, verdict ok|wrong, note}).
- `dose-calc.js` (`window.SMD_DOSECALC`): pure ENGINE (compute, derive, ibw Devine, adjbw, bsa Mosteller,
  Cockcroft-Gault / bedside Schwartz, practical rounding), exported to node via `module.exports`; then the
  overlay `#doseCalc` (z-index 10050, above `#icuRoot` 10000). API: open({patient, drug, source}), close,
  on, buttonHTML(composition), listPatients, find, load, engine.
- Entry points: `home.js` ACT.drugmenu row "Dose calculator" + ACT.dosecalc + HOME_TOOLS `dosecalc`
  (so All tools and search list it); `api.js renderDetail` button (delegated click on
  `[data-dosecalc-drug]`); `icu.js` "Dose for this patient" + per-drug "Dose" (`dosecalc:` action,
  prefills weight/age/sex/height/creatinine); `opd-emr.js` `dose-calc-open` (weight/height/age/sex).
- Tests: `test/dose-parse.test.mjs`, `test/dose-calc.test.mjs` (engine against the shipped rules),
  `test/run-dose-calc-ui.mjs` (headless: Drugs sheet -> 55 kg -> levothyroxine 88 mcg, CrCl, cap, prefill,
  z-order, flag off, no overflow).

## Behaviour
- Kidney: the app's verified renal table (`SMD_SAFETY.renalDoseFor`, antibiotics) wins over the monograph
  band; its draft table is labelled draft. Boundary values take the lower-function band. Bands whose
  advice still names a clearance are "unclear": the whole note is shown instead.
- A neonate with no neonatal row gets child rows with a warning; a child with no child row gets adult
  rows marked reference only. Missing age = adult, with a note.
- Patient values are never stored, sent or logged; `close()` wipes them.

## Gotchas
- `home.js` loads before `dose-calc.js`: HOME_TOOLS `eligible` reads the flag directly (`doseCalcOn`).
- Regenerate the rules after any monograph edit: `node scripts/build-dose-rules.mjs`, then bump `VER`
  in `dose-calc.js` (the `?v=` on the gz fetch).
