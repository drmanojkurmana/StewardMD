# Lesson footer buttons, Report reason, biostatistics images: DONE (2026-10-13)

Branch `lessonui-1013`. Bottom player bar untouched throughout; it is the token source.

## A. Upper controls now match the bottom bar

- One shared component, `prep-action-row.js` + `prep-action-row.css`
  (`window.PREP_ACTION`), renders Report / Share / Bookmark as soft filled
  pills: no border, no shadow, `var(--pn-r-pill)` radius, 52px height (the play
  pill), 8px gaps, `var(--pn-s1)` fill, gold `var(--pn-fill)` for the saved
  bookmark (the play pill's on state), press `scale(.97)` on the 120ms token
  ease, 44px minimum on quiet chips. Used by pearl footers, every lesson foot
  (replacing the lone ID row), and the MCQ report flow; KB surfaces can render
  the same `actionRowHtml`/sheet from the same module.
- IDs are one quiet metadata line: filled pill chip, tap to copy, single
  "Copied" live region (`prep-action-row` meta chips and the restyled
  `.pi-chip`, now `var(--pn-s1)` filled at 44px).
- Header: back and share circles already are the bottom bar's `.pn-ib`; the
  "Auto" pill is now borderless `var(--pn-s1)` like the 1x pill, with the same
  press scale. States covered: default, pressed, focus-visible, disabled,
  loading (`aria-busy` on Send), success (Saved fill, report confirmation),
  error (inline sheet error). Light, dark and reduced motion handled by tokens
  and media queries.

## B. Report asks why

- Bottom sheet "What is wrong?": seven single-choice reasons, optional note
  (required for Other, 500 max with counter), Send/Cancel, success
  confirmation, focus trap, Escape to close, focus restored.
- Payload `{itemId, itemType, subject, module, reason, text, appVersion}`
  posts to the existing `/api/prep/flag` with the same Bearer auth prep.js
  used. Server accepts the new fields optionally (old payloads unchanged),
  whitelists reasons/types, caps and strips the note. Offline reports queue
  in localStorage and retry on `online`/`flushQueue()`.
- Tests: `test/prep-action-row.test.mjs` (payload, legacy codes, queue,
  sheet markup), new flag cases in `test/prep-server.test.mjs`, MCQ and
  MaiK-module browser tests updated to the sheet flow
  (`test/run-prep-ui.mjs`, `test/run-prep-qgen-ui.mjs`).

## C. Images

- Audit: `.fleet-reports/LESSON-IMAGE-AUDIT.md` (1,005 of 1,041 lessons had
  zero images; per-subject counts).
- 16 original SVG diagrams in `prep/lessons/media/stats-*.svg`, wired into
  18 biostatistics and community-medicine lessons (28 steps), all passing
  `checkLesson`. Numbers verified by recomputation; attribution in
  `prep/lessons/media/ATTRIBUTION.md`. Remaining queue in
  `.fleet-reports/LESSON-UI-IMAGES-PROGRESS.md`.

## Verification

- Unit/guard: prep action row, pearl, lessons, lessons-100, pearl figs and
  prep-server suites pass (55/56; the one failure, `bank: medcov overlays`,
  fails identically on untouched `origin/main`).
- Browser: the sandbox blocks local servers and headless Chrome, so the
  updated browser tests and 390px light/dark screenshots could not be run
  here. They are ready to run with `node test/run-prep-ui.mjs` and
  `node test/run-prep-lessons-ui.mjs` (SHOTS=dir) on a machine with Chrome.
