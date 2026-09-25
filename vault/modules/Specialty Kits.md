---
tags: [module, opd, clinical-content]
status: built 2026-09-25 (flag ON). Content ai_drafted, PENDING clinical review.
flag: smd_specialty_kits (client, def:true, ?kits=0 hides the OPD tab, the Home tile and the sheet)
---
# Specialty Kits

The specialty layer of the OPD consult for doctors who are not physicians: **O&G, Paediatrics,
Orthopaedics, Ophthalmology, ENT, Dermatology, Psychiatry, Dental** (owner, 2026-09-25: "Start with O&G
and Paediatrics kits and complete all"). Two places:
- **OPD EMR "Specialty" tab**, right after Assessment ([[OPD Queue]]). Writes into the consult.
- **Home tile "Specialty Kits"** (`home.js` `act:"speckit"`, defOn) opening a standalone sheet
  (`#smdKit`), where every Add becomes Copy. For looking things up without a patient open.

A kit is:
1. **Sections**: structured history/exam fields. "Add to <field>" composes ONLY what was filled
   ("Obstetric history: Gravida: 2; Living children: 1.") and APPENDS it to an existing Initial
   Assessment field (`target`); a field can also write one value straight into a form field (`set`,
   e.g. LMP, Weight, Hydration, children alive). So the normal Save to GHIS/EMR saves it, and nothing is
   saved, signed or ordered by the kit itself. A section may carry an `alert` that shows when any of its
   checkboxes is ticked (red flags: ETAT/IMCI signs, cauda equina, compartment syndrome, SJS/TEN,
   spreading dental infection, suicide risk...).
2. **Tools** (maths in `specialty-kits.js`, node-tested against published oracles):
   - `pregnancy-dating`: Naegele EDD with cycle adjustment, scan dating, **ACOG CO 700** redating
     thresholds, milestone windows (11+0 to 13+6 scan, anomaly scan, GDM test, anti-D, term, 41+0).
   - `growth-who`: **WHO z-scores 0 to 19 years**, exactly WHO's anthro/anthroplus method: LMS by day
     (0 to 5 y) and month (5 to 19 y), restricted application beyond +/-3 SD for weight-based
     indicators, 0.7 cm length/height standardisation, 9-month standing rule, oedema = SAM with weight
     indices withheld, MUAC 11.5 / 12.5 cm cut-offs (6 to 59 months), WHO plausibility flags.
   - `milestones`: CDC "Learn the Signs. Act Early" 2022 checklists, 12 checkpoints (2 months to 5 years).
   - `visual-acuity` (Snellen, logMAR, WHO ICD-11 category from the better eye, IOP > 21 flag),
     `hearing` (WHO 2021 grades, Rinne/Weber interpretation), `pasi`, `odontogram` (FDI chart, DMFT/dmft),
     `immunisation` (OPD only: opens the existing Immunisation tab).
3. Shortcuts: investigations (fills the OPD investigation search), protocols (opens the reader in the
   OPD Protocol tab, or the Knowledge Library from Home), calculators (MEDCALC), patient-advice texts.
4. Sources and a review status on every kit. Picking a kit chip in the OPD also selects the matching
   [[MaiK Scribe]] specialty template (`scribe` field), so the scribe listens for what the kit documents.

## Key files
- `specialty-kits.js` (`window.SMD_KITS`) - engine: pure maths (exported `_dating`, `_growth`, ...),
  rendering for a host, events, the standalone sheet. `specialty-kits.css`, `specialty-kits-flags.js`.
- `kb/specialty-kits/src/<kit>.json` - one kit per file; `src/data-milestones.json` - CDC checklist data.
- `kb/specialty-kits/kits.json` - GENERATED bundle (never hand-edit).
- `scripts/build-specialty-kits.mjs` - schema (header comment), validator, bundle builder.
  `--validate [ids]` checks only; no flag = validate + write the bundle + sync `KITS_V`, `GROWTH_V` and
  the `specialty-kits.js?v=` token in `index.html`; `--check` = fail if anything is stale.
- `kb/growth/who-growth.json` (459 KB, 112 KB gzipped; fetched only when the growth tool first runs) -
  built by `scripts/build-who-growth.mjs <anthro-dir> <anthroplus-dir>` from WHO's own tables.
- `opd-emr.js`: `kitTab`, `kitHost` (the host interface below), the tab in `tabsNav`, `switchTab("kit")`
  loads the assessment. `scribe-templates.js`: one template per kit.
- Tests: `test/specialty-kits.test.mjs` (maths vs oracles, validator, bundle freshness, rendering, OPD
  host), `test/run-specialty-kits-ui.mjs` (full app in headless Chrome at 390px: Home tile, sheet,
  stacking, OPD tab, every kit, read-only, flag off), `test/scribe-templates.test.mjs`.

## Adding or editing a kit
1. Edit `kb/specialty-kits/src/<id>.json` per the schema in the build script header. Targets and `set`
   fields must be real `ASSESS_SCHEMA` names; protocols, calculators, subject, scribe and workspace
   ids are all checked against the code. A new kit id also goes in `KIT_ORDER`.
2. `node scripts/build-specialty-kits.mjs`, then both tests above.
3. Native: `build-www` copies `kits.json` and `who-growth.json`.

## The host interface (what a new surface must provide)
`kind, canWrite(), writeNote(), ready(), readyNote(), addLabel(), fieldLabel(name), insert(field, text,
sets), repaint(), protocol(id), calculator(id)|null, investigate(query)|null, openTab(tab)|null,
setScribe(id)|null, patient()`. `insert` is the only write; the OPD host appends (textarea: new line;
single-line field: "; "), coerces `sets` through `voiceCoerce` (selects snap to the form's own option or
set nothing), marks the fields touched (so the scribe never overwrites them) and toasts where it went.

## Gotchas
- **`ready()` guards the write.** `loadAssessment()` REPLACES `assessVals` wholesale, so an Add before
  the assessment loaded would be lost; the kit disables Add until it has.
- **`fieldLabel` exists twice in opd-emr.js** (line ~530 from `OPD_LABEL`, and a DOM-reading one near
  the field mic). Function hoisting makes the second win everywhere, so off the Assessment tab it
  returns the raw key ("Nutrtion"). The kit host uses `OPD_LABEL` directly. The other callers (review
  rows, required-missing prompt) still get the DOM version; left alone, flagged here.
- **Stacking.** The sheet is z 880. While it is open `html.kit-lock` lifts `.mc-overlay` (870) and the
  Knowledge Library (home.js injects `body.ui-v2 .sbref-overlay{z-index:140!important}`, so the lift is
  a more specific `!important`) to 1300. In the OPD (12010) a calculator tap adds `html.oe-kit-calc`
  (MEDCALC to 12015); `OPDEMR.close()` removes it. Protocols in the OPD open in its own Protocol tab.
- **Copy in a WebView.** `navigator.clipboard.writeText` can reject or never settle without focus; the
  sheet copies with a hidden textarea first, then the async API with a 1.5 s limit, and the toast says
  what actually happened.
- **Kit values are memory only**, keyed per consult (`st.kitKey`) and dropped (`SMD_KITS.forget`) when
  the next consult's kit is first shown. Never in storage: they can be clinical findings.
- **The app zooms `<html>`** (Display settings): browser tests measure tap targets in CSS px
  (`getComputedStyle().height`), not client rects.
- Class names avoid `-back`/`-close`/`-cancel` (swipe-back.js matches them); the sheet's close button
  is found by its `aria-label="Close specialty kit"`.

## Content status
- 8 kits, all `review.status: "ai_drafted"` (compiled with AI assistance from the cited sources, each
  URL retrieved), NOT clinically reviewed; every kit says so on screen. `reviewed`/`approved` needs a
  named reviewer (validator-enforced). Kit authors' open points: search terms may not match a
  hospital's catalogue names; Psychiatry insight grades and dental mobility grades are uncited
  conventions; Dental uses the MoHFW 2-week ulcer rule (SDCEP says 3 weeks); Psychiatry has no
  low/medium/high risk label on purpose (NICE NG225).
- **WHO growth data provenance and licence.** Values come from the `data-raw/growthstandards` tables of
  WHO's official R packages `anthro` and `anthroplus` (GitHub WorldHealthOrganization) and are identical
  to the expanded tables on who.int (checked: weight-for-age boys, 1827 days, 0 differences). Only the
  WHO numbers are used (no package code); the kit cites WHO. The same method reproduces WHO's anthro
  README examples and all 2101 z-scores of WHO's 2007 reference survey (`survey_who2007_z.csv`); a
  35-child sample of that survey is embedded in the unit test.
- No em/en dashes (validator + browser test), British spelling.

Deps: [[OPD Queue]] · [[MaiK Scribe]] · [[Clinical Protocols]] · [[Home Tools]] · [[Knowledge Library]].
