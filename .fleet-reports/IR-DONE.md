# IR Done Report (IR-DONE.md)

**Date:** 2026-10-15 (close-out)
**Content PR:** [#1672](https://github.com/drmanojkurmana/StewardMD/pull/1672) (branch `ir-2026-10-15`, squash-merged to main as `a641a13b6`)
**OTA publish:** run 38720299961 SUCCESS | **Spend:** $0.00 (no Anthropic API; local authoring + rule-based checks only)

## Counts
- 12 new radiology lessons (`prep/lessons/v1/rad-ir-*.json`, 48 steps): access, embolisation, tips, venous, stent, thrombolysis, drainage, ablation, malformation, selective, pain-spine, safety.
- 12 KB v2 pages (`kb/reference`): one per lesson.
- 120 original vignette MCQs (`prep/overlays/maikir/radiology`, maikir-001 to 120, 10 per lesson) with structured Answer / Why-others-wrong / Key-point explanations.
- Wiring: taxonomy rad-ir section (12 modules), compiled `prep/taxonomy.json` regenerated, bank v5 radiology 23 to 35 topics, prep.js radiology overlays + maikir, overlay-counts maikir 120, topic-links 12 entries, accuracy.json regenerated.

## Gates
- Content run: LP.checkLesson 12/12; kb_validate_v2 12/12; independent rule-based verifier 120/120 (quiz-overlay ids, answer letters, no dup stems, 25+ word stems).
- Passive 12-word similarity vs 9,354 book chunks (cases 733, handbook 4,541, safari 4,080): 0 verbatim matches. Log: `.fleet-reports/IR-SIMILARITY-LOG.md`.
- CI on PR #1672: unit-tests pass, clinix-ui (browser) pass, gaps pass.
- Close-out re-verification on merged main (this report): kb_validate_v2 12/12 ok; `prep-books-mcqs` 3/3 pass (incl. maikir); `prep-lessons` 23/23 pass; structural scan 120/120 items with 4 options, valid answer index, and Answer / Why-others-wrong / Key-point blocks.

## Coverage notes
- All 12 families of the job brief are covered (angiography and access, embolisation, TIPS and portal interventions, venous access and IVC filters, stents and angioplasty, thrombolysis, biliary and urinary drainage, ablation and chemo/radio-embolisation, vascular malformations, uterine/prostate/bariatric embolisation via the selective-embolisation family, pain and spine, IR safety).
- Existing `rad-interventional` core lesson and `srd-ir` SS module left untouched; both had empty kb links (genuine gaps filled, nothing duplicated).
- Text-only wave: no images or SVG added; owner figures to follow separately. SS radiology has no bank subject, so modules live under radiology with SS coverage via the shared srd-ir group taxonomy.
- briefs/*.md absent in repo; followed BOOKS-DONE/BOOKS2-STATE precedent. pick-ui-library N/A (existing reader reused, no new UI library).
- Main checkout never touched; work built in worktrees under /private/tmp (removed after merge; disk tight).
