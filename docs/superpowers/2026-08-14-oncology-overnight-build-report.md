# StewardMD Oncology Module - Overnight Build Report

Branch: `claude/onco-protocol-engine` (worktree `.claude/worktrees/onco-protocol`), 45 commits ahead of `main`.
Status: ready for your validation and testing. Nothing deployed. Everything behind default-OFF flags. `main` untouched.

## TL;DR

Cancer A to Z is done and clinically reviewed. Three tracks landed overnight:

1. KB expansion: 198 of 199 oncology diseases upgraded to DeVita 12th ed + NCCN grounded, dose-free, per-disease R1-reviewed management. 1 residual documented.
2. Phase 8 Onco workbench (from the reference video + our plan): P0 Onco Home, P1 staging + tall-man + drug/interaction + protocol reference, P2 CTCAE + IO toxicity + RECIST + favorites.
3. Dose-engine hardening (opt-in creatinine floor, AIBW, carboplatin cap, Appendix A/B citations).

Final R1 clinical-safety review: GO for owner validation, no blocking findings, confidence 92.
Tests: 149 onco unit tests pass, 4 real headless-Chrome UI suites pass, content validation 4959 files 0 errors.

## What landed

### 1. KB oncology management expansion (198/199)
Every oncology disease's `reference.management` was rewritten from generic AI text to a DeVita 12th ed + NCCN grounded narrative through a safe pipeline: draft (grounded, dose-free, cited) -> adversarial verify (never-invent) -> R1 clinical review (blocking) -> reformat -> merge -> validate -> commit. Content that R1 held was run through a revise-against-R1 correction loop (up to 3 rounds) and re-reviewed.

- 198 merged and committed to `kb/reference/*.json`.
- 1 residual: `hepatosplenic_t_cell_lymphoma` did not clear R1's bar after 3 correction rounds. It keeps its prior generic management (no regression) and is flagged for manual clinical sourcing.
- All management prose is dose-free (doses live only in the structured protocol engine). R1 machine-scan confirmed 0 dose leaks across the 194 changed files it checked.

### 2. Phase 8 Onco workbench (tags: onco-phase8-p0/p1/p2)
Structured engines first, AI as a layer, evidence/gaps visible, all reusing existing StewardMD assets (MEDCALC, KB, drugs, interaction rules, ONCODOSE).

- P0 Onco Home (`smd_onco_home`): dashboard grid + global categorized search + evidence/provenance + patient-context strip, over calculators/scores/diseases/drugs/protocols.
- P1 (`smd_onco_staging`, `smd_onco_tallman`, `smd_onco_drugview`, `smd_onco_protoref`): AJCC/TNM staging engine (versioned, seeds only the universal TNM scaffold, everything else a marked gap, fail-closed fabrication auditor), ISMP tall-man lettering, onco drug + interaction view, read-only NCCN protocol reference with a DRAFT badge.
- P2 (`smd_onco_ctcae`, `smd_onco_iotox`, `smd_onco_recist`, `smd_onco_favorites`): CTCAE v5.0 grading (14 common AEs seeded verbatim-flagged, v4.03 a gap, fail-closed), immune-related AE management principles (no numbers, principle-level), RECIST 1.1 response calculator, favorites + recent.

### 3. Dose-engine hardening (tag: onco-dose-hardening)
`onco-dose.js` gained four OPT-IN, default-OFF features so existing golden tests are byte-for-byte unchanged: creatinine floor (Cockcroft-Gault), AIBW/Devine IBW for obese patients, carboplatin absolute mg cap, and NCCN Appendix A/B re-citation. All floors/caps/thresholds are caller-supplied, never hardcoded universals. Never-invent contract preserved. 11 pre-existing golden tests unchanged + 15 new tests.

## Final clinical review (R1) - GO with conditions

No blocking findings. Verified clean: never-invent holds end to end; no fabricated staging cutoffs; no leaked KB doses; all 14 CTCAE v5.0 boundaries correct; RECIST 1.1 correct; R-CHOP doses correct including the vincristine 2 mg per-dose cap; R-CHOP ships inactive (draft) so it cannot be selected.

GO conditions (none block a flag-OFF validation build; all are before-live-use):
1. Keep all `smd_onco_*` flags OFF until you source-verify the CTCAE, staging, irAE, and R-CHOP seeds against the licensed/official documents. Each seeded value is honestly flagged `requiresR1Verification`, not fabricated.
2. Before enabling `smd_onco_protocols`: decide institutional creatinine-floor + carboplatin absolute-cap values and wire them (the unhardened default can overestimate GFR), and note cumulative anthracycline lifetime dose is warning-only in v1 (hard enforcement lands with cross-encounter history).
3. Re-run `stewardmd-ai-reviewer` if any CTCAE/staging seed is regenerated with model assistance, and `stewardmd-security-reviewer` before the write path (`QUEUE_ONCO_WRITE`) touches real patient plans.

Advisory: ~21 changed reference files use generic source strings (e.g. "Oncology references") rather than a named text; tighten to named sources before any public release. Not fabricated.

## How to validate and test

- Web preview: open the app locally with an onco flag on, e.g. `?qoncohome=1` (Onco Home), `?qoncostaging=1`, `?qoncoctcae=1`, `?qoncorecist=1`. Flags also toggle in Display and Accessibility once wired for a device build.
- Unit tests: `node --test test/onco-*.test.mjs` (149 pass).
- UI tests (real headless Chrome): `node test/run-onco-ui.mjs`, `run-onco-home-ui.mjs`, `run-onco-p1-ui.mjs`, `run-onco-p2-ui.mjs`.
- Content validation: `node kb/tools/validate-content.mjs` (4959 files, 0 errors).
- Read a sample upgraded disease: `kb/reference/gastrointestinal_stromal_tumour.json`, `mesothelioma.json`, `merkel_cell_carcinoma.json`, `burkitt_lymphoma.json`.
- Per-disease R1 reviews and adversarial verdicts are preserved as sidecars under `docs/superpowers/onco-waves/**/*.r1.md` and `*.verdict.md` if you want the audit trail.

## Reversibility and safety posture

- 10 oncology feature flags, all default OFF. Nothing reaches the app until you flip a flag.
- Nothing deployed; `main` untouched; native app unaffected.
- Milestone tags: `onco-p0..p6` (protocol engine), `onco-phase8-p0/p1/p2` (workbench), `onco-dose-hardening`.
- The one live-dose protocol (R-CHOP) is `lifecycleState: "draft"` and cannot be selected for a plan until a human activates it.

## Residual / follow-ups for you

- `hepatosplenic_t_cell_lymphoma` management: needs manual clinical sourcing (kept generic content, no regression).
- Source-verify CTCAE v5.0 / AJCC staging / irAE / R-CHOP seeds before enabling those flags.
- Decide dose-engine floor/cap institutional defaults before enabling the protocol engine.
- Tighten the ~21 generic KB source strings before any public release.
- Device/native verification and merge-to-main remain your call.
