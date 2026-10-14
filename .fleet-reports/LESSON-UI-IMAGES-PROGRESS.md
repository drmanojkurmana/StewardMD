# Lesson UI images: progress (branch lessonui-1013, 2026-10-14)

## A. Footer/header shared component: verified, no change needed

The shared component the job asks for already exists and is wired everywhere:

- `prep-action-row.js` + `prep-action-row.css`: one `PREP_ACTION.actionRowHtml`
  for lessons, pearls, MCQs and KB (Report / Share / Bookmark in a single
  3-column row of 52px soft-filled pills, radius `var(--pn-r-pill)`, fill
  `var(--pn-s1)`, pressed `scale(.97)` over `var(--pn-d-press,120ms)`).
- ID line: `metaHtml` tap-to-copy chips (44px pills) for pearls; lessons use
  the same-token `pi-chip` from `prep-ids.css`. Header keeps the round
  back/share buttons (44px circles) and the 44px `Auto` pill. Bottom player
  bar untouched. Light + dark follow `prep.css` tokens; reduced-motion,
  focus-visible, disabled / busy / error / success states all present.
- Wiring: lessons (`prep-lessons.js` footHtml + bridge), pearls
  (`prep-pearl.js` footerHtml), MCQs (`prep.js` openReport with legacy
  fallback), loader (`prep-loader.js` CSS/JS lists), all shipped.

## B. Report reason sheet: verified, no change needed

`openSheet` bottom sheet: title "What is wrong?", the exact 7 single-choice
reasons, optional note (required for Other, 500 max, live count), Send /
Cancel, success confirmation, focus trap + Escape + focus return, offline
queue (`smd-report-queue-v1`, cap 50, flush on online) that never throws.
Payload `{itemId, itemType, subject, module, reason, text, appVersion}` posts
through the existing `/api/prep/flag` path, which already accepts the new
optional fields and stays backward compatible. Unit:
`test/prep-action-row.test.mjs` green. Browser: `test/run-prep-ui.mjs`
(report sheet flow) + `test/run-prep-qgen-ui.mjs` run in the
lessonui-browser CI gate.

## C. Biostatistics images: done this branch

- Audit: `.fleet-reports/LESSON-IMAGE-AUDIT.md` (2026-10-13 pass preserved;
  2026-10-14 addendum with per-subject zero-image counts over all 1449
  lessons; 62 lessons carry an image step).
- Backfilled 5 null-visual steps in 4 lessons from the original-figure bank
  (no new files, no third-party images, ATTRIBUTION.md unchanged):
  mstat-sampling x2 (stats-errors, stats-ci-forest), mstat-regression
  (stats-scatter), mstat-design (epi-bias), cm-infectious-epi (epi-curve).
- Figure numbers re-verified second pass (recall-bias OR 1.0 -> 6.0; alpha
  0.05, power = 1 - beta; 65-case point-source / 72-case propagated curves;
  2x2 sens 80 / spec 90 / PPV 88.9 / NPV 81.8).
- Guards green: `test/prep-lessons.test.mjs`, `prep-lessons-100`,
  `prep-action-row` (34 tests), full `npm test` in CI.

## Remaining (other subjects, by exam weight)

community-medicine 42, physiology 41, medicine 113, pathology 73,
pharmacology 72 zero-image lessons still queued; each needs a subject-figure
bank first (no bank exists outside stats/epi/anatomy-path PNGs). Left for
follow-up branches; this branch proves the wiring pattern.
