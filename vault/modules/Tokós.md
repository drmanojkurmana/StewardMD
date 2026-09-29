---
tags: [module, education, obgyn]
status: built 2026-09-29, ON for all during testing (owner decision 2026-09-29); content ai_drafted pending obstetrician review in the Review Desk
flag: smd_tokos (client, def:true, "0" or ?tokos=0 hides it)
---
# Tokós

**Tokós 2.0 (2026-09-29, branch `feat/tokos2-engine`):** Tokós now runs on the [[Specialty Engine]] as its first host:
Obstetrics and Gynaecology (EN/HI), Learn and Test tabs (first-run choice, then the last tab), Today's plan, progress,
question bank, calculators, drills, Explore and notes as their content lands. `tokos.js` is the host config;
`tokos-ctg.js` is the CTG clinic plugin (the pure checklist and key logic, `window.TOKOS_CTG`, used by the Review Desk and
`scripts/apply-reviews.mjs`); `tokos-core.js`, `tokos-data.js` and `tokos-stage.js` are gone. Lazy loading: the app loads
only `tokos-loader.js` at boot (`window.TOKOS` is a stand-in with the same surface; `TOKOS_LOADER.load()`); the first open
injects `specialty*.{js,css}`, `tokos.css`, `tokos.js`, `tokos-calipers.js`, `tokos-ctg.js` at `?v=tok7`, then the ordered
model list in `tokos/models.json` (`tokos-models/<id>.js`; `build-www.sh` copies `tokos-models/`). Learn content goes in
`tokos/learn/units/*.json`, `lessons/`, `media/credits-<unit>.json`; `node tools/tokos-learn-index.mjs` builds
`index.json`, `glossary.json` and `media/credits.json` (checked by `test/tokos-learn-content.test.mjs`) and
`docs/tokos/competency-coverage.md` (NMC OG codes taught; 131 of 142 at integration).

**Integrated 2026-09-30 (branch `feat/tokos2`):** 40 units / 227 lessons, 9,196-question bank, 13 calculators, 6 drills,
labour room simulator (`tokos-sim-labour.js`), 6 explorers (`tokos-explore-ui.js`), CTG + fetal planes + HC biometry
clinics (`tokos-clinic-us.js`), and an "OSCE and viva stations" entry that calls `CLINIX.openDeep("tokos-osce")`. The loader
also injects those three UI files. Lessons can carry `review: {status, verify: [...]}` (claims written without the source
open; `SPECIALTY_DATA.reviewStatus()` reads either form); `deeper.text` renders on the lesson finish screen.
**Review Desk (Tokós tab):** besides the CTG cases and text blocks, one item per unit (verify-first units at the top), bank
topic (flagged keys), drill, the labour room, calculator, explorer and ultrasound clinic. `scripts/apply-reviews.mjs`
approves each in its own file (lessons, `tokos/drill/*.json` + rebuild, model `review:` line, deck `review`) and records
every approval in `tokos/reviews.json`, which the desk reads for status. The sections below describe the CTG clinic.

OBGYN CTG reading trainer. A learner reads a real intrapartum CTG strip (last 30 minutes, calipers and zoom on
the inline trace), works a FIGO checklist, then sees the reveal: the rule-based FIGO category, the real outcome
(pH, base deficit, Apgar) as a separate block, and a rationale per answer. FSRS-6 spaced repetition and the zoom
stage are copied from [[Ophthalmós]].

- **Status (2026-09-29):** built on branch `feat/tokos`. ON for all users while the app is in testing (owner
  decision 2026-09-29), content `ai_drafted`, pending obstetrician review in the Review Desk (Tokós tab). 12 real traces from CTU-UHB (ODC-BY 1.0, credits in
  `tokos/media/credits.json`). Every screen carries the "To be verified, draft" footer (`.tok-draft`).
- **Entry points:** Home tile `tokos` · `TOKOS.open()` · `TOKOS.openCase(id)` (Review Desk "Read it": opens straight
  into one case, same kill switch and Resident trial gate) · overlay `#smdTokos.tok-root` · `TOKOS.back()` is called
  from `swipe-back.js` (canGoBack and goBack) and by the module's own Escape handler.
- **Flag + default:** `smd_tokos`, client, default **ON** (owner decision 2026-09-29, the app is in testing). Kill
  switch `localStorage.smd_tokos = "0"` or `?tokos=0` for the current load. Gating is inline in `home.js`
  `eligible()` (`!== "0"`), same as `atlas` and `ophthalmos`; the tile has no `defOn: false`, so it shows on Home by
  default. With the kill switch set the tile does not render, and `ACT.tokos` (the one door for the tile,
  `stewardmd://tokos` and the MaiK tool chip) is a quiet no-op, decided by the same `eligible()`. `TOKOS.openCase`
  repeats the same check in `tokos.js`.
- **Files:** `tokos-core.js` (FSRS-6, sessions), `tokos-data.js` (levels, trial, persistence `smd_tokos_v1` and
  `smd_tokos_prefs`, FIGO checklist, grading), `tokos-stage.js` (zoom), `tokos-calipers.js` (bpm and time
  calipers in viewBox units), `tokos.js` (shell, screens), `tokos.css`. Load tags in `index.html` at `?v=tok3`.
- **Data:** `tokos/tracks.json`, `tokos/decks/ctg.json`, `tokos/rationale.json` (en and hi),
  `tokos/media/ctg/*.svg`, `tokos/media/credits.json`. `scripts/build-www.sh` copies the whole `tokos/`
  directory. `tools/tokos-ctg-prep.mjs` and `docs/tokos/` are authoring only and do not ship; `functions/_middleware.js`
  404s `/tools/` and `/docs/` on every host.
- **Levels:** MBBS (free) gets a 5 question checklist: contractions, baseline, variability, decelerations, FIGO
  category. Resident (Pro, one free trial per feature, `clinic.ctg`) adds the FIGO action, and the deceleration
  type only where an obstetrician confirmed it (`case.review.decelType`). The trial gate runs before any fetch.
- **Tests:** `test/tokos-*.test.mjs` (core, data, stage, calipers, content, wiring), `test/run-tokos-ui.mjs`
  (module UI), `test/run-tokos-app-ui.mjs` (real app: tile shows and opens by default, hub shows the CTG clinic, back
  returns home; Review Desk Tokós tab lists the items and Read it opens a case; `smd_tokos="0"` and `?tokos=0` hide
  the tile and block every entry; no uncaught errors). Review Desk and apply tests for Tokós are in
  `test/kit-tools-docs.test.mjs`.

## Rule-based labels

Computed in `tools/tokos-ctg-prep.mjs` over the last 60 minutes of each record (the strip shows the last 30):
FIGO category, baseline class, variability class, deceleration subtype, acidosis class, tachysystole flag, signal
quality. Each case shows "Rule-based, pending obstetrician review" until its review is complete
(`TOKOS_DATA.reviewComplete`: `case.review.complete === true`). Learners are graded on
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

1. The obstetrician opens Review Desk (Home > Add Tool > Review content), Tokós tab. Items: one per case
   (`case-<id>`, "Tokós CTG case <id>": the suggested FIGO category, baseline, variability, decelerations with
   suggested subtypes, contractions, acidosis class and the signal quality note, `case.qualityNote`), and three text
   blocks: `rationale` (the 14 teaching points in `tokos/rationale.json`), `checklist` (`tokos.js` `L10N.*.opts`,
   including the FIGO next-step strings) and `calipers` (`tokos-calipers.js` `WORDS`). "Read it" opens a case in
   Tokós (`TOKOS.openCase`) and shows a text block inline.
2. Approve, Approve after minor edits, or Needs changes, with comments; export (or Send to StewardMD).
3. The owner runs `node scripts/apply-reviews.mjs <file.json>`. Approve on a case sets its `review` in
   `tokos/decks/ctg.json` to `{ by: "<name>, Reg. No. <n>", date, uc, baselineClass, variability, decels, figo,
   decelType (only when every deceleration has the same suggested subtype), acidosis, complete: true }`
   (`TOKOS_DATA.suggestedReview`), so `truthFor` grades against it and the banner drops. ctg.json is rewritten with
   `JSON.stringify(deck, null, 1)`, the form the prep tool writes; the script refuses if the file is not in that form.
   Approve on a text block sets `review` / `reviewChecklist` / `reviewCalipers` in `tokos/rationale.json` to
   `reviewed`. Approve-minor and Needs changes go to `vault/handoff/review-feedback.md`; a corrected label is then
   set by hand in the case's `review` (every graded field is overridable, see `truthFor`).
4. Review state shown in the desk comes from the content: a case is reviewed when `review.complete === true`, a text
   block when its review object in `rationale.json` says `reviewed`.
5. `docs/tokos/review-queue.md` stays as the pipeline notes (field reference, suggested labels, quality notes, the
   hand-maintained pipeline check). Regenerate its header with `node tools/tokos-ctg-prep.mjs --queue-only` (reads
   `case.qualityNote` from the deck; the full run writes it).

## Review gate

Tokós is ON for all during testing, but its labels stay rule-based until approved in the Review Desk: every case shows
"Rule-based, pending obstetrician review" until its `review.complete === true`, and every screen keeps the "To be
verified, draft" footer. Known content issues a reviewer should settle:

- 1495: the strip shows bradycardia (last third at 70 to 90 bpm; strip baseline 125 against the 60 min
  baseline 155) while the key is "suspicious".
- 1031 and 1020: keyed normal while the rule counts short "variable" dips (9 and 4 of them, 15 to 92 s long).
- 1035 and 1036: 1035 is keyed normal with FHR at 180 to 200 bpm from 13 min; 1036 has 359 samples above
  180 bpm in the last 5 min. Either may be artefact.
- Features and keys are computed on the last 60 min while the learner sees the last 30 min, so a key can rest
  on events that are not on screen.

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
- The FSRS and zoom engine are the [[Specialty Engine]]'s (the 1.0 duplicate is gone; decision 2026-09-29).
- Inline trace SVGs emit classes only, no `<style>`; an inline style element would restyle the app.
