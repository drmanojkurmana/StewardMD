# IR Depth Progress (IR-DEPTH-PROGRESS.md)

**Job:** IR depth pass, owner 2026-10-16 "add and it's done". No UI in scope (content-only: lessons, MCQs, KB pages; no images) so standing UI skill block ignored.
**Worktree:** `/tmp/stewardmd-wt/ir-depth` (detached HEAD b4473a91c = origin/main). DEVIATION: job asked for SSD path `/Volumes/WD BLACK SN7100 1TB Media/stewardmd/wt/ir-depth`; sandbox denies writes outside workspace//tmp and approval prompts are off, so escalated mkdir was denied. Using /tmp worktree; main checkout untouched.
**Overlay set:** maikir2 confirmed free on origin/main (0 hits). maikir = 12 files x 10 = 120; prep-books-mcqs asserts totalItems==120 scoped to prep/overlays/maikir so maikir2/ folder will not break it. prep-subject slices overlaysOf().radiology(0,4) so appending maikir2 after maikir is safe. prep.js radiology currently [..., "maikir", "maiknuc2"]; plan: insert "maikir2" after "maikir".

## Plan (30 new lessons, 990 MCQs)
New module ids (all under rad-ir taxonomy section, new files only):
- access x3: rad-ir-access-closure, rad-ir-access-radial, rad-ir-access-complications
- embolisation x3: rad-ir-embolisation-agents, rad-ir-embolisation-gi, rad-ir-embolisation-trauma
- tips x3: rad-ir-tips-selection, rad-ir-tips-technique, rad-ir-tips-encephalopathy
- venous x3: rad-ir-venous-filter, rad-ir-venous-catheter, rad-ir-venous-svc
- stent x2: rad-ir-stent-iliac, rad-ir-stent-femoro
- thrombolysis x2: rad-ir-thrombolysis-ali, rad-ir-thrombolysis-pe
- drainage x3: rad-ir-drainage-ptbd, rad-ir-drainage-nephrostomy, rad-ir-drainage-aftercare
- ablation x2: rad-ir-ablation-planning, rad-ir-ablation-liver-directed
- malformation x2: rad-ir-malformation-avm, rad-ir-malformation-sclerotherapy
- selective x2: rad-ir-selective-uae, rad-ir-selective-pae
- pain-spine x2: rad-ir-pain-spine-augmentation, rad-ir-pain-spine-neurolysis
- safety x3: rad-ir-safety-contrast, rad-ir-safety-radiation, rad-ir-safety-anticoag-consent
MCQs: maikir2-001..750 (25 x 30 new), maikir2-751..990 (20 x 12 existing top-ups).

## Log
- 2026-10-16: discovery workflow done; repo verified (12 rad-ir lessons, 120 maikir MCQs, 9354 chunks); worktree created in /tmp; gates mapped (LP.checkLesson LIM steps[4,8] tx[40,90] say<120 bold-required; kb_validate_v2.py; prep-books-mcqs 120-count; prep-subject slice(0,4)).
- 2026-10-16: generator scaffold started (tools/generate-ir-depth.mjs + tools/ir-depth-data/).
- 2026-10-16: access family done (3 lessons, maikir2-001..075, validated BAD:0). Embolisation done (3 lessons, maikir2-076..150, validated BAD:0). Remaining: 24 lessons + topups (~840 MCQs).
- 2026-10-16: TIPS done (3 lessons, maikir2-151..225, validated BAD:0). Validator saved at /tmp/ir-validate.mjs. Typo watch: options arrays must close `"],` never `"]),`.
- 2026-10-16: venous done (3 lessons, maikir2-226..300, validated BAD:0). 12/30 lessons, 300/990 MCQs. Pattern fix: family export array always last line; new lessons insert before it.
- 2026-10-16: stent done (2 lessons, maikir2-301..350, validated BAD:0). 14/30 lessons, 350/990 MCQs. Lesson: verify edits landed in tx not say (same-vocabulary lines); dedupe check after splicing.
- 2026-10-16: thrombolysis done (2 lessons, maikir2-351..400, validated BAD:0). 16/30 lessons, 400/990 MCQs. Bulk-fix allowed for repeated `"]),` typos via python; always re-run typo sweep + validator after.
- 2026-10-16: drainage done (3 lessons, maikir2-401..475, validated BAD:0). 19/30 lessons, 475/990 MCQs. Ordering rule refined: append new blocks at file end; family export array absolutely last (printf-append if needed).
- 2026-10-16: ablation done (2 lessons, maikir2-476..525, validated BAD:0). 21/30 lessons, 525/990 MCQs.
- 2026-10-16: malformation done (2 lessons, maikir2-526..575, validated BAD:0). 23/30 lessons, 575/990 MCQs. Lesson: validator step indices are 0-based array positions; match the right step before editing.
- 2026-10-16: selective done (2 lessons, maikir2-576..625, validated BAD:0). 25/30 lessons, 625/990 MCQs.
- 2026-10-16: pain-spine done (2 lessons, maikir2-626..675, validated BAD:0). 27/30 lessons, 675/990 MCQs.
- 2026-10-16: safety done (3 lessons, maikir2-676..750, validated BAD:0). 30/30 lessons, 750/990 MCQs.
- 2026-10-16: top-ups done (maikir2-751..990, 20 x 12 existing lessons, all new overlay files, existing lessons untouched). 990/990 MCQs.
- 2026-10-16: verifiers green: normalised stem dup check 0 (990 new vs 120 bank + internal); 12-word passive similarity vs 712,495 chunk 12-grams = 0 verbatim hits.
- 2026-10-16: generator ran: 30 lessons + 30 KB pages + 42 maikir2 overlays, LP.checkLesson clean, failures 0. kb_validate_v2 clean. Tests: prep-lessons 23 pass, prep-books-mcqs 3 pass, prep-subject 6 pass, prep-app 33 pass. No hard-coded overlay-list failures.
