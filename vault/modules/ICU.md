---
tags: [module, clinical]
status: live
flag: mixed
---
# ICU

The ICU flagship workstation (`icu.js`, single dashboard). Multi-workspace nav, Trends, complaints+dx,
calculators, guided clinical workflow, imaging import, alerts, Lab Watch.

## Key files
- `icu.js` — the dashboard (INF/ICU merged; `INF.openDashboard` aliased to `ICU.open`)
- `clinical-vocab.js` (`SMD_VOCAB`) — reusable engine-safe finding vocab (documentation-only chips)
- unit registry: `UNIT_REGISTRY`/`SMD_UNITS` + `fmtLab` + `unitSystem` pref
- collab: `icu-collab.js` (Firestore rounds/tasks/timeline/notifs)

## Sub-features / branches
- Guided Clinical Workflow (findings→working dx→Deep Review) — LIVE, flag `smd_icu_dxflow`
- Ask MaiK about this patient — follow-up chat on top of Deep Review, flag `smd_icu_askmaik` (default ON).
  Entry points: Care Plan → Diagnosis (under Deep clinical review), Clinical Correlation card, Imaging/reports header.
  Reuses the home MaiK pipeline (`StewardRAG.buildPackage` → `SMD_AI.explainGrounded`); prompt = de-identified
  correlation context + the deep-review output + last 3 Q&A turns. Test: `test/run-icu-askmaik.mjs`.
- Swipe-to-remove on the unit board (ICU + Ward) — drag a patient card left (WhatsApp chat row) to
  reveal a red Remove action; tapping it opens a chooser: Discharge (opens the Discharge tab) ·
  Clear patient (removes now) · Cancel. The swipe alone never deletes. Solo → `rosterRemove`;
  group → `api.removePatient` (canInstruct-gated). Gesture: `swStart/swMove/swEnd` + `v2SwipeRow`
  in `icu.js`, axis-locked so vertical scroll still wins. Test: `test/run-icu-swipe-remove.mjs`.
- Discharge Creator · **Draft with MaiK** — flag `smd_icu_dischargeai` (default ON, rides
  `smd_icu_askmaik`; `?icudisai=0` kills it). Drafts FOUR narrative sections only — hospital course,
  condition at discharge, follow-up, advice — plus a non-inserted "Guideline basis" panel. Reuses the
  Ask MaiK pipeline (`StewardRAG.buildPackage` → `SMD_AI.explainGrounded`) on the de-identified
  context. **Never drafts medications, the final diagnosis, or pending results**, and writes nothing
  until the clinician ticks a section and presses Insert. `disAiParse` is heading-tolerant (`##`,
  `**bold**`, `3. Numbered:`); unplaceable output is kept in `_rest`, never dropped. The review sheet
  reuses the one modal, so field values are captured first and restored on Insert AND Cancel.
  Test: `test/run-icu-discharge-ai.mjs`. See [[Decisions]] (2026-08-22).
- Imaging import + correlation — Phase 1 shipped (`smd_icu_imaging`); phases 2–4 pending
- ICU v2 redesign + collab — `feat/icu-v2-redesign` BUILT, flags `smd_icu_v2`/`smd_icu_groups` OFF, NOT deployed (owner must deploy rules+indexes, emulator + 2-device test)
- Alert-safety fix — `fix/icu-alert-safety` committed NOT pushed
- Lab Watch — needs Google/Apple sign-in for 24/7

## Visual design system
All ICU styling is ONE place: `injectCSS()` in `icu.js` (tokens on `#icuRoot,.icu-modal,.icu-tour`,
v2 rules scoped under `#icuRoot.icu-v2`). Tokens: `--bg/--panel/--panel2/--border/--border-soft`,
`--ink/--ink2/--muted`, `--primary/--primary2/--primary3(+ -soft)`, `--ok/--warn/--danger(+ -soft)`,
radii `--r:12 / --r-sm:10 / --r-xs:8 / --r-pill`, `--sh` (1px hairline) + `--sh-lift`.
Rules of the system: hairlines separate (not shadows); status colour is reserved for status (a stable
bed tile is neutral); header chrome is FLAT `--primary2`, never a gradient; numbers use tabular
figures; selection is colour + weight, press is brightness. See [[Decisions]] (2026-08-22).

## Gotchas
- Chips feed the engine with NO rebaseline (icu.js only).
- SW-warmup flakiness in headless tests (warmup protocol).
- **Always read current vitals via `mergedVitals(_raw.vitals)`, never `latestVitals()`.**
  `ingestMonitor()` pushes a NEW ROW per save containing only the fields just entered/imported, so
  `latestVitals()` (newest-TIMESTAMP row only) drops any field not in that latest row — e.g. save
  Heart Rate, then separately save BP, and the HR tile goes blank even though the HR row is still
  in `_raw.vitals`. `mergedVitals()` forward-fills the newest non-null value per field across the
  whole series and was built for exactly this (see its header, "R1 C1") but was only wired into
  `recompute()`/`curMap()`/`shockIndex()`, not the display code. Fixed 2026-09-07 in
  `renderLiveStatus`, the Hemo tab, the Fluids tab, `liveSummaryLine`, `patientBanner`, and the
  import-review "current value" comparison (`openImportReview`/`openImportReviewAll`) — all six now
  use `mergedVitals`. Regression test: `test/run-icu-livestatus-merge.mjs`.
Deps: [[Scan-Meds and Drug Index]] · [[Medical Knowledge Base]] · [[FollowCare]] (discharge). See [[Roadmap]].
