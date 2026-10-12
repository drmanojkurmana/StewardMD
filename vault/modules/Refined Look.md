---
tags: [module, ui, design]
status: BUILT, browser-tested (real app, headless Chromium). Not yet seen on a handset.
flag: `html.smd-refined` (default ON); localStorage `smd_refined=0` turns it off
---
# Refined clinical look (inner screens only)

Owner picked "Refined clinical" from three renders (2026-10-12) and said **"Keep existing look home page."**
So `refined.css` is scoped to `html.smd-refined body > :not(#homeV2)`: every top-level layer EXCEPT the home page
(tool screens, sheets, sidebar, alerts, search). The class is set by an inline script in index.html's head, before
first paint.

## What it changes
- Design-system tokens for inner screens: `--rds-r` 16, `--rds-r-lg` 20, `--rds-r-sheet` 26, `--rds-el-card` a layered
  soft shadow, `--rds-fs-body` 14.
- Cards (`[class$="-card"]`, `.db-comp`): 16px radius, hairline `--rf-line`, layered shadow. Search fields 14px.
- Large titles tighter (-0.03em, Drug DB title 34px), Drug DB row titles 15.5px, `.hv-mi` 14.5px, sheets 26px.
- Dark mode: lighter hairline (white alpha) and a deeper shadow, via `body.dark` / `body.v3-dark`.

## Gotchas
- **home.js has an older `body.ui-v2 .mc-card {...!important}` skin**, so card rules here use `!important`.
  Other modules may have the same; check computed style, not the stylesheet, when a rule seems ignored.
- Selectors carry an id (`:not(#homeV2)`), so they outrank single-class module rules without `!important`.
- Coverage is the shared card/row/sheet classes plus the Drug Database; modules with their own prefixes
  (ICU, queue, PrepNucleus, ...) are refined only where they use `-card` classes. Extend by adding their classes.

## Test
`test/run-refined-ui.mjs` (real app): the HOME PAGE fingerprint (253 elements: radius, shadow, border, font, colour,
padding, margin) is identical with the class on and off (elements with a running animation are skipped: the Ask MaiK
glow changes by itself); inner cards are 16px / old 14px with the class off; the More sheet is 26px; dark shadows;
kill switch.
