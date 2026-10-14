# Lesson UI images: done (branch lessonui-1013, 2026-10-14)

## Shipped

1. `prep/lessons/v1/mstat-sampling.json`: power step -> stats-errors.svg,
   non-significant-result step -> stats-ci-forest.svg (alt + caption, ar 1.5385).
2. `prep/lessons/v1/mstat-regression.json`: linear-regression step ->
   stats-scatter.svg.
3. `prep/lessons/v1/mstat-design.json`: misclassification step -> epi-bias.svg.
4. `prep/lessons/v1/cm-infectious-epi.json`: generation-time step ->
   epi-curve.svg.
5. `.fleet-reports/LESSON-IMAGE-AUDIT.md`: 2026-10-13 pass preserved + 2026-10-14
   addendum (per-subject zero-image counts, 1449 lessons, 62 with images).
6. `.fleet-reports/LESSON-UI-IMAGES-PROGRESS.md`: A/B verification notes,
   backfill list, remaining queue by exam weight.

## Verification

- `node --test test/prep-action-row.test.mjs test/prep-lessons.test.mjs
  test/prep-lessons-100.test.mjs`: 34 pass, 0 fail.
- Full `npm test` + `test/run-prep-lessons-ui.mjs` (dark + light, 390px) +
  `test/run-prep-ui.mjs` + `test/run-prep-qgen-ui.mjs`: CI gate
  `lessonui-browser.yml` (run 38541313402), shots attached to the PR.
- Compliance (web-design-guidelines): 44px+ targets, focus-visible + trap +
  Escape + focus return, aria-live/error/success, labels on all form controls,
  reduced-motion, light + dark tokens, no `transition: all`, images carry
  width/height + lazy + alt + captions. Pre-existing `outline: none` rules in
  `prep.css` are on programmatic-focus containers, out of scope.
- No new dependencies, no third-party images, no test weakened
  (`bug-report.test.mjs` needs its documented
  `--experimental-test-module-mocks` flag via `npm test`; direct `node --test`
  fails on `mock.module` with or without this branch).
