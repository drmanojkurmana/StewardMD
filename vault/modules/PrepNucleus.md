# PrepNucleus

Exam question bank for NEET-PG / INI-CET, NEET-SS and USMLE. About 1,750 modules across 19 MBBS subjects and 14
SS Medicine groups, laid out as exam tabs, a subject grid, sections with numbered modules, practice with
explanations, timed tests with a question grid, bookmarks, a custom module, subject search and offline downloads.
FSRS-6 spaced review through `specialty-core.js`. Students can also turn their own PDF or notes into a deck
(Layer C). Plan: [[plans/PrepNucleus]] (revision 8) and [[plans/PrepNucleus-LayerC]].

- **Entry points:** Home tile `prep` (flag-gated) · `PREP.open()` · `PREP.open({ subject })`
- **Flag + default:** `smd_prep`, default **OFF**. `localStorage.smd_prep = "1"` or `?prep=1` turns it on; `"0"`
  or `?prep=0` off. The same rule lives in `prep-loader.js` (`enabled`) and `home.js` (`eligible`).
- **Status (2026-10-06):** bank v1 (147,310 questions, Gemini-mapped, key-screened: about 16.6k disputed keys flagged)
  uploaded to R2 `stewardmd-offline/prep-bank/`; Phase 0 passed (98% seeded-key catch, temperatures set; billing
  reconciliation pending); Layer B pilot run; full fill and phone tests pending. Doctor grading deferred by the owner
  (D7): automatic checks are the gate.

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
- Adapt and exam (in `prep.js`): Today card (due reviews, daily goal 20/30/50/100, "Fix my weak areas"),
  adaptive difficulty for new questions (`targetDifficulty`), My mistakes with tags (`mt`), mock exams per
  pattern (`MOCKS`: NEET-PG +4/-1, INI-CET +1/-1/3, NEET-SS +4/-1, USMLE block) with per-subject analysis.
- Offline teacher: `prep-teacher.js` ("Why is B wrong? Ask MaiK offline", native with a downloaded pack only;
  answers checked for numbers and drug names against the grounding, else the stored explanation).
- Edge: `start_mcq` in `edge-router.js` opens `PREP.open({ query, n, mode })` ([[StewardMD Edge]]).
- Review Desk: "PrepNucleus reports" tab (owners and signers see the tab; the list is owner-only).
- Build tools (dev only, `tools/` is 404 on the web): `prep-embed.py` (local bge-small classifier, $0),
  `prep-build-bank.mjs` (Layer A from MedMCQA, $0; `--upload`; writes `vault/plans/prep-bank-<date>.md`),
  `prep-upload-bank.mjs` (wrangler R2 upload), and owner-run Vertex tools that cost money:
  `prep-measure.mjs` (Phase 0), `prep-screen-keys.mjs` (blind-solve key screen, about $3.4 at 7 items a request),
  `prep-fill.mjs` (Layer B four Batch stages, `--merge` to `v2`, estimate about $19 for the whole fill), all on
  `prep-vertex.mjs`. Every `--dry-run` makes no call. Batch format checked against a real job 2026-10-06: Batch for
  `gemini-3.1-flash-lite` runs only in location `global` (us-central1 refuses it, MODEL_NOT_SUPPORTED_FOR_BATCH), now
  the default; `key` is echoed on each output line; user (non-ADC) gcloud logins need the `x-goog-user-project` header.
- Taxonomy source: `prep/taxonomy/*.json` (one per subject; `validateSubject` in the builder).

## Store
localStorage `smd_prep_v1`: `{v, cards, conf, days, mod:{t,ok,last}, bm, rep, exam, last, dl, hid, mt, goal}`. FSRS deck key
`p:<module>` (Layer C decks `p:deck-<id>`). `hid` is the auto-hidden list, refreshed at most every 6 hours.

## Tests
`test/prep-app.test.mjs`, `test/prep-build-bank.test.mjs`, `test/prep-server.test.mjs`, `test/prep-core.test.mjs`,
`test/prep-generate.test.mjs`, `test/prep-layerc-e2e.test.mjs`, `test/prep-create.test.mjs`, `test/prep-teacher.test.mjs`,
`test/prep-tools.test.mjs`, `test/edge-start-mcq.test.mjs`, headless `test/run-prep-create-ui.mjs` and `test/run-prep-ui.mjs` (real app + fixture bank in `test/fixtures/prep/`;
Chromium at `/opt/pw-browsers/chromium` by default, `CHROME=` to override).

## Bank v1 mapping (2026-10-06)
Gemini mapping (`prep-classify.mjs --per 10`, all 19 MBBS subjects, $16.11 estimate) scored 96.7% on the 120-item
Anatomy sample (--per 25 scored 93.3%, so 10 was kept); the built bank agrees 92.5% (plan target 90%). The builder
prefers confident Gemini answers; embeddings are only the fallback, so bge-small (default pin) is used for them.
`prep/build/embed-*.json` and `llm-*.json` are committed (owner rule after a worktree cleanup deleted them); the
`vec-*.npy` caches are not.

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
