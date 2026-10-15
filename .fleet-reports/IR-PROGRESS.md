# IR Progress Report (IR-PROGRESS.md)

**Date:** 2026-10-15 10:30 UTC
**Branch:** ir-2026-10-15 | **Worktree:** /private/tmp/ir-wt (main checkout untouched)
**Overlay prefix:** maikir- | **Spend:** $0.00 (no Anthropic API; local authoring only)

## Done
- 12 new IR procedure-family modules (rad-ir-access, embolisation, tips, venous, stent, thrombolysis, drainage, ablation, malformation, selective, pain-spine, safety). Existing rad-interventional core lesson and srd-ir SS module left untouched; graph links index confirmed both had kb:[] (genuine gaps).
- 12 lessons (prep/lessons/v1, 48 steps, LP.checkLesson 12/12) + 12 KB v2 pages (kb_validate_v2 12/12) + 120 original vignette MCQs (maikir-001 to 120, 10 per lesson, structured Answer / Why-others-wrong / Key-point explanations).
- Wiring: taxonomy rad-ir section (12), bank v5 radiology 23 -> 35 topics, prep.js radiology overlays + maikir, overlay-counts 120, topic-links 12 entries, prep/accuracy.json regenerated, maikir test block (120) + radiology overlay-list assertion updated.
- Verification (independent rule-based, /tmp/ir-verify.py): quiz-overlay id match 12/12, answer-letter match 120/120, no dup stems, stems 25+ words. Passive 12-word similarity vs all 9,354 chunks (cases 733 + handbook 4,541 + safari 4,080): **0 verbatim matches**. Log: .fleet-reports/IR-SIMILARITY-LOG.md.
- Gates: prep-books-mcqs 3/3, prep-lessons 23/23, prep-lessons-100 3/3, prep-subject 6/6, prep-accuracy 5/5, build-bank/links/medcov 54/54, wider prep set 87/87.
- Safari chunks finished mid-run (1,397/1397 pages, done.flag present); coverage spot-check confirmed all 12 families present in Safari text.
- UI compliance: text-only wave, no images/SVG added; lessons reuse the existing reader with table/flow visuals only; zero em-dashes; fixed palette untouched; 390px-safe layouts inherited from reader. Browser harness (run-prep-lessons-ui) left to CI: sandbox has no browser.
- Briefs unavailable in repo (briefs/*.md absent): followed BOOKS-DONE/BOOKS2-STATE precedent instead.

## Next
- Commit + push, open PR, watch CI (incl. browser harness), plain squash merge, dispatch ota-publish, write IR-DONE.md, remove worktree.
