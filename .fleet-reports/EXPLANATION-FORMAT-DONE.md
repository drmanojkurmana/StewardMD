# Explanation format: DONE (2026-10-15, branch explanation-format-1015, PR #1654)

Owner ask: "make explanation look good rather than unformatted text without proper bolding,
formatting etc" (example Q-8AV-4D5-GR7, a raw pasted table). Standing UI rules followed
(skills read before the first edit; palette #071318/#0D1D23/#42CDB5 tokens only, no glows).

## Rule honored: stored text never rewritten

All work on existing items is RENDER-TIME. New file `prep-expfmt.js` (pure ES5,
`window.PREP_EXPFMT`, node-exported for tests) formats at draw time on top of the merged
MCQ list-format parser (`prep-listfmt.js`, #1648): callers try `PREP_LISTFMT.exp` first and
fall through to `PREP_EXPFMT.exp`. Anything unsure falls back to clean paragraphs.

## What renders now

- Answer sentence lifts into a strong key line (`Ans. ...`, `Answer ...`, `ANSWTER: (A) ...`;
  abbreviation ends like `i.e.` never cut it short).
- Option phrases (the item's own diagnoses), drug names from the app's `drug-lexicon.js`
  generics+brands (common words excluded), and numeric doses with units embolden.
- Legacy MedMCQA `*` runs and `;` runs become lists; pasted `label value` tables stay tables.
- Trailing `REF:`/`Reference:` lines become quiet inline chips where they stood (order kept);
  glued blobs (`weeksREF: ...58-59HCG...`) stay untouched rather than mislabelled.
- New structured Markdown renders natively (bold, bullets, numbered steps, `##`, pipe tables).
- `Key point` callout when the item has `kp`; `Why the others are wrong` bullets when it has
  `r`; item-level `prov/credit/licence` intentionally NOT chipped (uniform `SMD`/boilerplate).
- Ask MaiK answers render Markdown bold/bullets (were literal `**`). Root cause found while
  testing: `teach()`/`teachStep()`/`teachChat()` stripped `**` via `cleanAnswer` before display.
  The gate still runs on the cleaned text; only the returned display text keeps the markdown
  (2 existing test asserts updated to the owner-authorized contract, commented).
- Applied everywhere: feedback, review, solutions, mocks, bookmarks/mistakes practice, Arena
  review opens, share opens, Why chips + panel, teacher, Ask MaiK answers + stored context.

## Counts (312-explanation real-bank corpus, production drug lexicon)

kindOf over `test/prep-expfmt-corpus.json` (22 subjects, English-only, owner item pinned, 20
MedMCQA-era deck items pinned): answer 4, rich (emphasis) 159, md 4, semi 17, legacy 10,
plain paragraphs 118. Formatted with structure/emphasis: 194. Clean-paragraph fallback: 118.
Zero items drop or reorder text (preservation invariant, 312/312). The listfmt table/list path
covers the pasted-table cases first (owner item renders as a table, asserted).

## Tests

- `test/prep-expfmt.test.mjs`: 15 tests green (corpus shape, owner item, 20 MedMCQA-style,
  preservation invariant, list-path no-drop, answer/REF/emphasis/markdown/abbreviations,
  XSS, blanks, tag hygiene, reasons/key-points, kind distribution).
- Neighbors green: listfmt, no-coming-soon (+prep-expfmt.js), app, ask-chat, teacher, reason,
  why-chips, review; full prep sweep 96/97 (prep-ids needs its fetch cache: fails identically
  on the clean tree). CI `unit-tests` green on the merged runs.
- Browser `test/run-prep-expfmt-ui.mjs` (kept for reruns): 23/23 PASS in CI -
  key line, drug/dose bolds, 3 why bullets, Remember callout, ref chip, Why panel, MaiK bold +
  2 bullets, contrast 16.13:1 light / 16.73:1 dark, no 390px scroll, no animation, no errors.
- Debugging notes (kept honest): fresh threads open empty by design (no auto-ask); typed doubts
  correctly omit first-turn stored details; the reveal() word-by-word animation means asserts must
  wait for settle; `?tour=0` keeps the welcome tour out of shots.

## Screenshots (390px, after; "before" was unformatted running text)

- `.fleet-reports/shots-expfmt/expfmt-fb-light.png` - feedback: key line, paragraphs, bold
  aspirin 75 mg, reference chip, why-others bullets (light)
- `.fleet-reports/shots-expfmt/expfmt-fb-dark.png` - same (dark)
- `.fleet-reports/shots-expfmt/expfmt-ask-light.png` - MaiK answer: bold lead + 2 bullets (light)
- `.fleet-reports/shots-expfmt/expfmt-ask-dark.png` - same (dark)
- fb shots predate a final CSS-only chip tweak (fragment padding); structure identical.

## Compliance pass (web-design-guidelines style)

- Contrast: key line 16.13:1 (light) / 16.73:1 (dark), both ≥ 4.5, measured in CI.
- 44px targets: no new interactive elements (chips/details reuse existing controls).
- Focus: tables reuse `.pn-xt` labelled scroll regions; no new focusables.
- Reduced motion: zero animations added (harness asserts none on explanation nodes).
- Light/dark: token-only colors; 390px: no horizontal scroll (asserted).
- Screen reader: `strong`, `ul`/`ol`/`li`, tables with `th scope`, `role=status`/`aria-live`
  regions untouched; XSS: escape-first, no raw HTML, no links, no attributes from text.
