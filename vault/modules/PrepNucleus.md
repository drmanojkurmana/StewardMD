# PrepNucleus

Exam question bank for NEET-PG / INI-CET, NEET-SS and USMLE. About 1,750 modules across 19 MBBS subjects and 14
SS Medicine groups, laid out as exam tabs, a subject grid, sections with numbered modules, practice with
explanations, timed tests with a question grid, bookmarks, a custom module, subject search and offline downloads.
FSRS-6 spaced review through `specialty-core.js`. Students can also turn their own PDF or notes into a deck
(Layer C). Plan: [[plans/PrepNucleus]] (revision 8) and [[plans/PrepNucleus-LayerC]].

- **Entry points:** Home tile `prep` (flag-gated) · `PREP.open()` · `PREP.open({ subject })`
- **Flag + default:** `smd_prep`, default **OFF**. `localStorage.smd_prep = "1"` or `?prep=1` turns it on; `"0"`
  or `?prep=0` off. The same rule lives in `prep-loader.js` (`enabled`) and `home.js` (`eligible`).
- **Status:** built behind the flag; bank not yet uploaded to R2; Layer B fill and the key screen not yet run
  (owner-run, cost money). Doctor grading deferred by the owner (D7): automatic checks are the gate.

## Files
- Boot: `prep-loader.js` (the only file at boot; loads `prep.css`, `specialty-core.js`, `specialty-bank.js`,
  `prep.js` on first open at one `?v=` token; skips engine files already on the page).
- App: `prep.js` (screens, store, IndexedDB cache, runner; pure helpers under node), `prep.css` (`.pn-*`, `body.dark`).
- Layer C client: `prep-create.js` and friends draw through `PREP._host`; `prep.js` forwards every `data-act`
  starting `c-` to `window.PREP_C.act`. See [[plans/PrepNucleus-LayerC]].
- Data shipped: `prep/taxonomy.json` (tree, no scope text) and `prep/bank/v1/<subject>/index.json` (counts), copied
  by `scripts/build-www.sh`. Module files and `search.json` (about 180 MB) live in R2 bucket `stewardmd-offline`
  under `prep-bank/`, served by `functions/api/prep/bank/[[path]].js` (whitelisted paths, immutable cache), and
  cached in IndexedDB `prep-bank` after first open.
- Server: `functions/api/prep/bank/[[path]].js`, `functions/api/prep/flag.js` (reports, auto-hide, owner list and
  restore), `functions/api/ai/_prep-generate.js` + `functions/_prep-core.js` (Layer C ops and shared gates).
- Review Desk: "PrepNucleus reports" tab (owners and signers see the tab; the list is owner-only).
- Build tools (dev only, `tools/` is 404 on the web): `prep-embed.py` (local bge-small classifier, $0),
  `prep-build-bank.mjs` (Layer A from MedMCQA, $0), `prep-upload-bank.mjs` (wrangler R2 upload),
  `prep-measure.mjs`, `prep-screen-keys.mjs`, `prep-fill.mjs` (owner-run, Vertex Batch, cost money).
- Taxonomy source: `prep/taxonomy/*.json` (one per subject; `validateSubject` in the builder).

## Store
localStorage `smd_prep_v1`: `{v, cards, conf, days, mod:{t,ok,last}, bm, rep, exam, last, dl, hid}`. FSRS deck key
`p:<module>` (Layer C decks `p:deck-<id>`). `hid` is the auto-hidden list, refreshed at most every 6 hours.

## Tests
`test/prep-app.test.mjs`, `test/prep-build-bank.test.mjs`, `test/prep-server.test.mjs`, `test/prep-core.test.mjs`,
`test/prep-generate.test.mjs`, headless `test/run-prep-ui.mjs` (real app + fixture bank in `test/fixtures/prep/`;
Chromium at `/opt/pw-browsers/chromium` by default, `CHROME=` to override).

## Gotchas
- **MedMCQA "rt" repair needs guards.** Building the repair vocabulary over every subject attests rare words
  ("RTIs", "tort", "arts"), and the unguarded Tokós repair turned "is" into "rtis" in about half the questions.
  `REPAIR` in `prep-build-bank.mjs` (ratio guards + keep list) fixes it; Tokós calls `buildRepair` without options
  and is unchanged.
- **MedMCQA subject labels are noisy.** About a fifth of "Anatomy" items are pathology or medicine. `planMoves`
  moves an item to another subject's module when its own best cosine is under 0.62 and another subject's beats it
  by 0.03 (needs `prep-embed.py` output with `x`).
- **Auto-hide is 3 separate reporters**, not the plan's "3% of attempts": the server never sees attempts.
- **`/api/` in UI tests:** `test/serve.mjs` proxies `/api/*` to a live host. The UI test points the bank and the
  hidden list at fixtures (`SMD_PREP_BANK_API`, `SMD_PREP_FLAG_API`) and answers the report API inside the browser.
- Practice uses FSRS (due, then new); once everything is seen and nothing is due it becomes a random set. A timed
  test is always a random draw.
