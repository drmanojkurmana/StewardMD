# MCQ-LIST-FORMAT-DONE (2026-10-14, branch mcq-list-format-1014)

Render-only fix for run-together lists ("arrange" / "match the following" MCQs). Stored bank text is untouched;
prep-listfmt.js decides at draw time, and falls back to the original text whenever it is not confident.

## Measure: published-bank scan (211,621 items, 4,704 module/overlay files, live 2026-10-14)

Loose candidate hits per pattern family (field counts; one item can hit several):

| family | items | stem | option | explanation |
|---|---|---|---|---|
| glued lower `a. X b. Y` | 1403 | 558 | 1 | 848 |
| close paren `a) X b)` | 883 | 380 | 1 | 502 |
| paren `(a) X (b)` | 534 | 32 | 12 | 492 |
| numbered `1. X 2. Y` | 4046 | 1815 | 60 | 2190 |
| upper `A. X B. Y` | 916 | 493 | 1 | 425 |
| roman `i) X ii)` | 1801 | 8 | 4 | 1795 |
| match family | 67 | 67 | 0 | 0 |
| arrange family | 1391 | 90 | 1260* | 50 |
| sequence family | 1608 | 439 | 196 | 1188 |
| bare sequence options (`a,d,b,c,f,e`, `D>B>C>A`) | 568 | - | 568 | - |
| pair options (`1-E, 2-C`, `a-2, b-1`) | 507 | - | 507 | - |

* `arrange` in options is almost entirely ordinary prose ("Arrange for urgent plasmapheresis"); scoped out of rendering.

## Parser coverage (final PREP_LISTFMT over the same 211,621 items)

| surface | parsed neatly | fell back unchanged |
|---|---|---|
| stems to neat lists (`a)` `b)` hanging indent) | 1900 | rest |
| stems to match tables (Column I / Column II) | 498 | rest |
| items with sequence-chip options | 437 | rest |
| items with aligned pair options | 514 | rest |
| explanations to lists | 4178 | rest |
| explanations to value tables | 429 | rest |

Guard: >= 2 consecutive labels in order from the first element, single letter/number/roman labels, bodies
4+ chars (all-caps abbreviations exempt), glued first labels need 3+ items, deny-list for Vitamin/Fig./TNM/e.g.,
decimals and dose ranges never match. 120 clean stems: 0 parse. Owner item Q-8AV-4D5-GR7
(`1ff67f0c-e7de-4e4d-b703-fd2449bca47f`, surgery/sur-breast-cancer) parses exact, renders 6 rows + 8-row table.

## Wiring (all stem/option/explanation surfaces)

Question screen, timed review + solutions, QOTD, Arena battle, Ask MaiK context + stored explanation, offline
teacher stored explanation, `whyHtml` explanations everywhere (bookmarks/mistakes practice, mocks, shared opens
all run through these). Truncated list rows (review summaries, mistakes) stay plain text by design.

## Tests

- test/prep-listfmt.test.mjs (13 tests): owner exact stem/exp/options, false positives, phantom-then-real retry, match table, XSS,
  corpus properties over 441 real stems + 80 options + 60 explanations. PASS.
- test/prep-no-coming-soon.test.mjs (extended to prep-listfmt.js). PASS.
- Related suites (app, core, arena x2, ask x2, teacher, tests-collapse, viewer, 122 tests). PASS.
- test/run-prep-listfmt-ui.mjs (new, CDP 390px, light+dark shots, OL/table/aria/contrast/overflow asserts).
  NOT runnable in this sandbox (Chrome SIGABRT, listen EPERM); runs in CI where /opt/pw-browsers/chromium exists.
- Full `npm test`: see PR checks; unit failures must equal main's known set.
- Screenshots: blocked locally (no working browser); attach from the CI run of run-prep-listfmt-ui.mjs (SHOTS dir).

## Compliance pass (web-design-guidelines style)

- Semantics: real `ol > li` (list announced with 6 items), `table` with `th scope=col/row`, labelled scroll
  regions, `aria-label` order/pair text, markers `aria-hidden`. No div-buttons, no color-only meaning.
- Contrast from theme tokens: muted labels 5.62 (light/page), 6.30 (light/card), 7.96 (dark/page),
  7.42 (dark/card); body text 14.40 / 15.38. All >= 4.5:1, both themes.
- Touch: no new interactive elements (text and table only); existing option buttons keep 44px+ rows.
- Focus: match/explanation tables reuse `.pn-xt` region pattern (`tabindex=0`, visible focus ring).
- Motion: zero animations added; existing `prefers-reduced-motion` paths untouched.
- Layout: 390px via flex-wrap chips + horizontal scroll region for tables (existing `.pn-xt` pattern);
  palette stays #071318/#0D1D23/#42CDB5 theme tokens, no glows/gradients (flat `--pn-glow: none`).
- Visual check at 390px light/dark: PENDING a working browser (see above); second corroboration route open.
