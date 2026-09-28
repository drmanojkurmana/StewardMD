---
tags: [module, education, obgyn]
status: built 2026-09-29, flag OFF; content ai_drafted pending obstetrician review (docs/tokos/review-queue.md)
flag: smd_tokos (client, def:false, ?tokos=1 shows)
---
# Tokós

OBGYN CTG reading trainer. A learner reads a real intrapartum CTG strip (last 30 minutes, calipers and zoom on
the inline trace), works a FIGO checklist, then sees the reveal: the rule-based FIGO category, the real outcome
(pH, base deficit, Apgar) as a separate block, and a rationale per answer. FSRS-6 spaced repetition and the zoom
stage are copied from [[Ophthalmós]].

- **Status (2026-09-29):** built on branch `feat/tokos`, flag OFF, content `ai_drafted`, pending obstetrician
  review through `docs/tokos/review-queue.md`. 12 real traces from CTU-UHB (ODC-BY 1.0, credits in
  `tokos/media/credits.json`). Every screen carries the "To be verified, draft" footer (`.tok-draft`).
- **Entry points:** Home tile `tokos` · `TOKOS.open()` · overlay `#smdTokos.tok-root` · `TOKOS.back()` is called
  from `swipe-back.js` (canGoBack and goBack) and by the module's own Escape handler.
- **Flag + default:** `smd_tokos`, client, default **OFF** (hidden). Show with `localStorage.smd_tokos = "1"` or
  `?tokos=1` for the current load. Gating is inline in `home.js` `eligible()`, same as `atlas` and `ophthalmos`.
  With the flag off the tile does not render.
- **Files:** `tokos-core.js` (FSRS-6, sessions), `tokos-data.js` (levels, trial, persistence `smd_tokos_v1` and
  `smd_tokos_prefs`, FIGO checklist, grading), `tokos-stage.js` (zoom), `tokos-calipers.js` (bpm and time
  calipers in viewBox units), `tokos.js` (shell, screens), `tokos.css`. Load tags in `index.html` at `?v=tok1`.
- **Data:** `tokos/tracks.json`, `tokos/decks/ctg.json`, `tokos/rationale.json` (en and hi),
  `tokos/media/ctg/*.svg`, `tokos/media/credits.json`. `scripts/build-www.sh` copies the whole `tokos/`
  directory. `tools/tokos-ctg-prep.mjs` and `docs/tokos/` are authoring only and do not ship.
- **Levels:** MBBS (free) gets a 5 question checklist: contractions, baseline, variability, decelerations, FIGO
  category. Resident (Pro, one free trial per feature, `clinic.ctg`) adds the FIGO action, and the deceleration
  type only where an obstetrician confirmed it (`case.review.decelType`). The trial gate runs before any fetch.
- **Tests:** `test/tokos-*.test.mjs` (core, data, stage, calipers, content, wiring), `test/run-tokos-ui.mjs`
  (module UI), `test/run-tokos-app-ui.mjs` (real app: tile absent with flag off, opens with flag on, hub shows the
  CTG clinic, back returns home, no uncaught errors).

## Rule-based labels

Computed in `tools/tokos-ctg-prep.mjs` over the last 60 minutes of each record (the strip shows the last 30):
FIGO category, baseline class, variability class, deceleration subtype, acidosis class, tachysystole flag, signal
quality. All show as "Rule-based, pending obstetrician review" until `case.review` is set. Learners are graded on
deceleration subtype only where `case.review.decelType` exists. Tachysystole is a separate flag and never raises
the FIGO category. Numerals (pH, bpm, seconds, kPa, mmol/L, Apgar) stay plain ASCII digits in Hindi.

Guideline values (FIGO 2015 classification table, change only with the guideline): prolonged deceleration over
3 min (`PROLONGED_SEC` 180), pathological over 5 min (`PATH_DECEL_SEC` 300), reduced variability pathological over
50 min (`RED_VAR_PATH_MIN`), increased variability over 30 min (`INC_VAR_PATH_MIN`), baseline bands, severe
bradycardia below 100 bpm.

Tokós choices (an obstetrician may change): `UC_PROMINENCE` 15 and `UC_MIN_SEC` 30 (contraction detection,
relative to resting tone), `DECEL_DROP` 15, `DECEL_MIN_SEC` 15, `QUALITY_SUBOPTIMAL_PCT` 30, `FHR_MIN` 50 and
`FHR_MAX` 210 (artefact bounds), `WINDOW_MIN` 60, `STRIP_MIN` 30, and the 5th to 95th percentile variability
range (max minus min over-called increased variability on real records).

## Reviewer workflow

1. Obstetrician opens `docs/tokos/review-queue.md`: suggested label, outcome and quality note per case.
2. Confirm or correct, then set `review` in `tokos/decks/ctg.json` to
   `{"by": "<name>", "date": "YYYY-MM-DD", "figo": "...", "decelType": "..."}`.
3. Labels for that case stop reading "rule-based" and Resident grading of deceleration type turns on.
The flag stays OFF until this is done for the cases the owner wants live.

## Known limits

- No tachysystole or reduced-variability case exists in the dataset pool; archetypes filled by 1097, 1022, 1033.
- `FIELD_OK` in the prep tool is empty: the 0/1 codings of Diabetes, Hypertension, Preeclampsia, Pyrexia,
  Meconium and Induced are unconfirmed, so no risk chips or induced line show until confirmed.
- Units: the sources do not state them for pCO2 and BDecf. The app shows kPa and mmol/L; confirm.
- Case 1035 is labelled normal but FHR sits at 180 to 200 bpm from 13 min with dropouts; may be artefact or a real
  tachycardia episode. 1036, 1048 and 1033 have similar artefact or noisy contraction notes in the queue.
- Vignettes use only fields present in the CTU-UHB header; never cervical dilation, oxytocin or maternal vitals.

## Review items

- Hindi strings in `tokos.js` and `tokos/rationale.json` need a Hindi reviewer.
- FIGO 2015: Ayres-de-Campos D, Spong CY, Chandraharan E, FIGO Intrapartum Fetal Monitoring Expert Consensus
  Panel, "FIGO consensus guidelines on intrapartum fetal monitoring: Cardiotocography", Int J Gynaecol Obstet
  2015;131(1):13-24. Not verified against the source (publisher pages returned 403); confirm the thresholds above
  against its classification table.
- NICE NG229 "Fetal monitoring in labour": title and date (published 14 December 2022, last updated 25 March 2026)
  confirmed by web search. Section references are not verified; the app cites the guideline by name only.
- Acidosis class follows the Low criteria named in the plan; obstetrician to confirm.

## Roadmap (not built)

Phase 2 candidates: Bishop score calculator, labour-room simulator, fetal ultrasound plane recognition
(HC18 and FETAL_PLANES_DB, both CC BY 4.0, licence-clear). Dataset licence findings for other specialties (WHO and
IAP charts, Kermany, MURA blocked) are in memory note `specialty-module-dataset-licenses.md`.

## Gotchas

- Tokós lives natively in StewardMD (not a synced repo). Edit the files here.
- The FSRS and zoom engine are duplicated from [[Ophthalmós]] until a third specialty module needs them.
- Inline trace SVGs emit classes only, no `<style>`; an inline style element would restyle the app.
