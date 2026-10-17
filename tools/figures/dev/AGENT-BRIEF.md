# Brief for building one animated scene

Build ONE animated scene with the shared framework, following `tools/figures/scenes/sepsis.mjs` and `sepsis.page.js` as the pattern (read them,
`bio-scene.mjs`, `bio.lib.js`, `bio-scene.css` first; `hypersens.mjs`, `graft.mjs`, `acs.mjs` are further examples). Original drawing from the
mechanism (never copy a textbook figure). Stage W=960, H about 610, dark and light themes, readable at 390 px via the viewer's zoom.

Create only: `tools/figures/scenes/<name>.mjs`, `<name>.page.js`, `<name>.reg.json` (registry entry
`{"id","title","blurb","page":"prep/figures/<id>.html","scene":true,"drugs":{},"terms":[regex strings]}`), `tools/figures/specs/<id>.json`
(stub like `specs/sepsis-pathogenesis.json`), and the generated `prep/figures/<id>.html` and `-light.html`. Scene CSS goes in `buildScene`'s `extraCss`.
Do not edit shared files. Do not commit or push unless asked.

Rules
- Model = level slider + treatment select; pure `modelOf(S, level, drug)` with `TESTS` asserting 3 to 4 readouts.
- Without = setting 0, With = last non-zero (`withoutLabel` / `withLabel`). Gauges panel. Hover text on every labelled part.
- Label pills must not overlap (check screenshots). No doses or numbers. No em or en dashes in app-facing text.
- AI-assisted / for-review sources footer. Never put CSS `opacity` on pooled particle classes. No NaN or console errors.
- Registry terms: specific regex strings, case-insensitive, word-bounded, matched against lesson and knowledge-library text across all exam
  streams. Avoid bare common words. Check with `python3 tools/figures/dev/termcheck.py tools/figures/scenes/<name>.reg.json` (aim for relevant hits only, about 5 to 150).

Verify: `--print-model` is sensible; `node tools/figures/dev/shot.mjs <id> "?d=0&l=1" <tag>` and the `-light` page; read the PNGs; fix overlaps.
Then `tools/figures/dev/register.sh <name> <id> "<subject>"`.
