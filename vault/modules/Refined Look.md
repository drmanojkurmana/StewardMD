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

## Added after the first cut (same day)
- **Dark-mode audit.** Measured text contrast on six inner screens, light and dark. Dark teal was both a FILL under white
  text (3.8:1) and a TEXT colour on dark panels (4.0:1; a lightbulb 2.5:1), so no single teal fits both: fills now use
  `#1F7A6E`, teal text `#4CC2B0`. Light: muted text on the tinted antibiotic panels darkened (`#4D6272`).
- **Pressed state.** Forcing `:active` on ~270 tappables showed ~95% already scale to .97 over 120ms (the app was more
  consistent than a grep suggested). Fixed the gaps: sheet rows get the iOS background highlight, antibiogram
  pills/links get the .97 press, and every tappable presses in at 80ms and releases with a small overshoot spring
  (`cubic-bezier(.32,1.25,.5,1)`, 340ms).
- **Empty and error placeholders.** `empty-states.js` marks the SIMPLE ones (6-160 chars, <=3 child elements, no
  controls, >=180px block, not in a table or a row) with `data-smd-empty="empty|error"`; CSS draws a soft icon circle,
  centred 14px text and a fade-in. ~500 placeholders across ~60 module classes. Ones that already have an icon keep it.
  Errors get `role="alert"`. Anything with a button or rich structure is left as the module drew it.

## Gotchas
- **home.js has an older `body.ui-v2 .mc-card {...!important}` skin**, so card rules here use `!important`.
  Other modules may have the same; check computed style, not the stylesheet, when a rule seems ignored.
- A rule that looks ignored: ask CDP `CSS.getMatchedStylesForNode`; the app has base rules like `:where(button...){transition:...}` and `button,[role=button]{transition:...}` that a refined rule must outrank.
- Selectors carry an id (`:not(#homeV2)`), so they outrank single-class module rules without `!important`.
- Coverage is the shared card/row/sheet classes plus the Drug Database; modules with their own prefixes
  (ICU, queue, PrepNucleus, ...) are refined only where they use `-card` classes. Extend by adding their classes.

## Test
`test/run-refined-ui.mjs` (real app): the HOME PAGE fingerprint (253 elements: radius, shadow, border, font, colour,
padding, margin) is identical with the class on and off (elements with a running animation are skipped: the Ask MaiK
glow changes by itself); inner cards are 16px / old 14px with the class off; the More sheet is 26px; dark shadows;
kill switch.
