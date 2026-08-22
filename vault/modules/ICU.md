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
- Imaging import + correlation — Phase 1 shipped (`smd_icu_imaging`); phases 2–4 pending
- ICU v2 redesign + collab — `feat/icu-v2-redesign` BUILT, flags `smd_icu_v2`/`smd_icu_groups` OFF, NOT deployed (owner must deploy rules+indexes, emulator + 2-device test)
- Alert-safety fix — `fix/icu-alert-safety` committed NOT pushed
- Lab Watch — needs Google/Apple sign-in for 24/7

## Gotchas
- Chips feed the engine with NO rebaseline (icu.js only).
- SW-warmup flakiness in headless tests (warmup protocol).
Deps: [[Scan-Meds and Drug Index]] · [[Medical Knowledge Base]] · [[FollowCare]] (discharge). See [[Roadmap]].
