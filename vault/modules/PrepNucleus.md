# PrepNucleus

Exam question bank for NEET-PG / INI-CET, NEET-SS, USMLE and FMGE (FMGE = the MBBS bank as is). About 1,750 modules across 19 MBBS subjects and 14
SS Medicine groups, laid out as exam tabs, a subject grid, sections with numbered modules, practice with
explanations, timed tests with a question grid, bookmarks, a custom module, subject search and offline downloads.
FSRS-6 spaced review through `specialty-core.js`. Students can also turn their own PDF or notes into a deck
(Layer C). Plan: [[plans/PrepNucleus]] (revision 8) and [[plans/PrepNucleus-LayerC]].

- **Entry points:** Home tile `prep` (flag-gated) · `PREP.open()` · `PREP.open({ subject })`
- **Flag + default:** `smd_prep`, default **OFF**. `localStorage.smd_prep = "1"` or `?prep=1` turns it on; `"0"`
  or `?prep=0` off. The same rule lives in `prep-loader.js` (`enabled`) and `home.js` (`eligible`).
- **Arena flag:** `smd_prep_arena`, default **OFF** (needs `smd_prep` too). `localStorage.smd_prep_arena = "1"` or
  `?arena=1` shows the Compete section; `"0"` or `?arena=0` hides it. Rule in `prep-arena.js` (`enabled`).
- **Status (2026-10-06):** bank v1 (147,310 questions, Gemini-mapped, key-screened: about 16.6k disputed keys flagged)
  uploaded to R2 `stewardmd-offline/prep-bank/`; Phase 0 passed (98% seeded-key catch, temperatures set; billing
  reconciliation pending); Layer B pilot run; full fill and phone tests pending. Doctor grading deferred by the owner
  (D7): automatic checks are the gate.

## Files
- Boot: `prep-loader.js` (the only file at boot; loads `prep.css`, `specialty-core.js`, `specialty-bank.js`,
  `prep.js` on first open at one `?v=` token; skips engine files already on the page).
- App: `prep.js` (screens, store, IndexedDB cache, runner; pure helpers under node), `prep.css` (`.pn-*`, `body.dark`).
- Plan: `prep-plan.js` + `prep-plan.css` (`window.PREP_PLAN`, loaded after `prep-pyq.js`; onboarding, readiness, Today's
  plan; `prep.js` forwards `data-act` `p-*`, asks `back()` first). See "Plan, readiness, onboarding, FMGE".
- Arena client and My stats: `prep-arena.js` (`window.PREP_ARENA`, loaded after `prep.js`, draws through `PREP._host`;
  `prep.js` forwards every `data-act` starting `a-` to it and asks `PREP_ARENA.back()` first on back). See "Arena client".
- Layer C client: `prep-create.js` and friends draw through `PREP._host`; `prep.js` forwards every `data-act`
  starting `c-` to `window.PREP_C.act`. See [[plans/PrepNucleus-LayerC]].
- Data shipped: `prep/taxonomy.json` (tree, no scope text) and `prep/bank/v1/<subject>/index.json` (counts), copied
  by `scripts/build-www.sh`. Module files and `search.json` (about 180 MB) live in R2 bucket `stewardmd-offline`
  under `prep-bank/`, served by `functions/api/prep/bank/[[path]].js` (whitelisted paths, immutable cache), and
  cached in IndexedDB `prep-bank` after first open.
- Server: `functions/api/prep/bank/[[path]].js`, `functions/api/prep/flag.js` (reports, auto-hide, owner list and
  restore), `functions/api/ai/_prep-generate.js` + `functions/_prep-core.js` (Layer C ops and shared gates).
- Adapt and exam (in `prep.js`): Today card (due reviews, daily goal; replaced on home by Today's plan from `prep-plan.js`,
  "Weak areas" is now a Practise row),
  adaptive difficulty for new questions (`targetDifficulty`), My mistakes with tags (`mt`), mock exams per
  pattern (`MOCKS`: NEET-PG +4/-1, INI-CET +1/-1/3, NEET-SS +4/-1, USMLE block, FMGE +1/0 in parts of 150) with per-subject analysis.
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
- Layer B source packs: `tools/prep-packs.mjs` ($0, no model call) builds a pack for every shortfall module without
  a hand-made one. Repo KB first (`kb/clinical-protocols`, `kb/diseases` + `kb/treatments`, `kb/reference`,
  `kb/protocols`, `kb/onco/staging`, flattened without ids, sources, references, review, provenance or source names;
  BM25 match, threshold 0.30), then up to 3 StatPearls chapters for modules short of their word target (E-utilities
  esearch/esummary for the chapter ids, text from one streamed pass over the NCBI Literature Archive bundle, because
  the Bookshelf pages answer bots with a reCAPTCHA and efetch has no book text). Cap 6,000 words a pack.
  **Two pack roots:** KB-only packs in `prep/fill/packs/<module>/` (committed); any pack with StatPearls text in
  `~/prep-data/packs-statpearls/<module>/` (outside the repo: the repo is public, StatPearls is CC BY-NC-ND; copy in
  `gs://project-6074a703-e86c-40a5-848-prep-batch/packs-statpearls`). `prep-fill.mjs` reads both: `--packs-extra
  <dir>` or env `PREP_PACKS_EXTRA` (the `--packs` root wins on a tie). Raw StatPearls cache:
  `~/prep-data/statpearls-cache/`. Generated packs carry `"gen": "prep-packs"` in `pack.json`; a pack without it is
  hand-made and never overwritten. Coverage report: `vault/plans/prep-packs-<date>.md`. Run 2026-10-06: 194 KB-only
  packs, 697 with StatPearls, 7 modules uncovered; fill dry run over the 891 covered modules $28.57 (not run).
  Test: `test/prep-packs.test.mjs`.
- Taxonomy source: `prep/taxonomy/*.json` (one per subject; `validateSubject` in the builder).

## Arena server (2026-10-06, merged into `feat/prepnucleus`, not deployed)
Plan: [[plans/PrepNucleus-Arena]] (deviations listed there). Flags `smd_prep` + `smd_prep_arena` stay OFF.
- **Pages:** `functions/api/prep/arena/[[path]].js` (consent, events, start, submit, event board, rating board,
  me/stats; Bearer Firebase token, uid stored only as `sha256(uid)` first 24 hex, name from the token `name` claim).
  Pure helpers in `functions/_prep-arena.js`: subjects per exam (copied from `prep/taxonomy.json`, keep in step),
  marking `SCHEMES` (= `MOCKS`), Elo K=24, IST schedule (`eventFromId`, `scheduleFor`), seeded `drawItems` over R2.
- **Worker `prep-arena`:** `prep-arena-worker/` (`src/index.js` Worker + `Matchmaker` + `BattleRoom`, `src/core.js`
  pure battle logic, `schema.sql`, own `wrangler.toml`). WS `wss://prep-arena.<account>.workers.dev/battle?exam=` with
  `Sec-WebSocket-Protocol: smd-arena, <id token>`; consent checked in D1. Extra server messages beyond the plan:
  `busy` (already in a battle), `slow` (queue rate limit), `match` with `resume:true` + `score` on reconnect, `end`
  with `forfeit: you|opp|both`.
- **Bindings:** D1 `PREP_ARENA_DB` (database `prep-arena-db`) on Pages (root `wrangler.toml`, default and production)
  and on the Worker; R2 `PREP_BANK_R2` (`stewardmd-offline`) on both; DOs `MATCHMAKER`, `BATTLE_ROOM` on the Worker.
  D1 `prep-arena-db` (45bc1834-baa0-4f75-890e-cc0d81fdff08, APAC) created and schema applied 2026-10-06; Worker deployed at `https://prep-arena.drmanojkurmana.workers.dev` (version 5cbaec0c). Pages gets the binding on the next deploy of this branch.
- **Deploy (owner, in order):** `npx wrangler d1 create prep-arena-db`, paste the id into `wrangler.toml` (both
  `PREP_ARENA_DB` blocks) and `prep-arena-worker/wrangler.toml`; `npx wrangler d1 execute prep-arena-db --remote
  --file prep-arena-worker/schema.sql`; `cd prep-arena-worker && npx wrangler deploy`; then merge for Pages. Do not
  merge with the placeholder id: the Pages deploy is expected to reject an unknown database id (not tested).
- **Tests:** `test/prep-arena-server.test.mjs` (route on node:sqlite D1), `test/prep-arena-battle.test.mjs` (core with
  a fake clock). Local battle smoke in workerd: `prep-arena-worker/smoke/run.sh` (real DOs, alarms, RPC, D1; auth
  replaced by `?u=`; never deploy `smoke/`).
- **Gotchas:** NEET-SS has no bank items yet, so its events answer 503 `bank-empty` and battles answer `nobody`.
  One active battle per uid holds per exam (one Matchmaker each), not across exams.

## Arena client (2026-10-06, merged into `feat/prepnucleus`)
Plan: [[plans/PrepNucleus-Arena]] (client half; the server half and its deviations are on `feat/prep-arena-server`).
- **Home** (refined redesign): sections Today (plan card), Compete (only with `smd_prep_arena`), Practise (Solve next,
  Bookmarks, Custom module, My mistakes, Mock exam, Your decks, My stats as one grouped list), Subjects (list cards with
  an authored 24px SVG icon per subject, `SUBJ` in `prep.js`, "done/total modules", MCQ count, progress). No text
  monograms. Exam tabs are a segmented control. Subject screen opens with a completion summary.
- **Compete:** guest -> "Sign in to compete"; offline -> "Needs a connection"; NEET-SS -> "coming soon" (`SOON` in
  `prep-arena.js`; the server answers 503 bank-empty until its bank exists). Otherwise Daily sprint and Weekly grand
  test rows with a live countdown (one 1 s interval for every `[data-cd]` on screen), 1v1 battle, Leaderboard.
- **Consent:** first Arena entry checks `GET consent`; if not joined, a bottom sheet names the account (`displayName`,
  never the email): "Join Arena" (POST) / "Not now". "Leave the Arena" (DELETE, confirm) on the leaderboard and My stats.
- **Events:** lobby (window, countdown, count, minutes, the exam's marking from `MOCKS`, Start/Resume, inline errors for
  425 not-open, 409, 410 closed/too-late, 503 coming soon) -> the timed runner with `opts.custom` (`runQuestions` neither
  marks nor records: items have no key; no FSRS cards, no mistakes) -> submit `{ ans, ms }` -> result with the server's
  score, rank of N, time (server ms), leaderboard and the missed list (keys known only now). Network failure keeps the
  answers with "Send again".
- **Battle:** WebSocket `SMD_PREP_ARENA_WS` (default `wss://prep-arena.drmanojkurmana.workers.dev`) `+ /battle?exam=`, protocols
  `["smd-arena", <ID token>]`. Pure state machine `battleStep` (queue, match, q, r, end; nobody, busy, slow; resume after
  a drop; forfeit you/opp/both). A drop mid-battle reconnects once after 1 s without queueing (the server resumes it in
  its 10 s grace); a second drop shows "Connection lost". Timer bar is a CSS scaleX animation offset by the time already
  gone; a server deadline further than the round length is clamped (clock skew).
- **Leaderboards:** Today's sprint (event board), This week and All time (battle rating); the caller's row (`me: true` or
  `me`) is marked and appended when outside the top rows.
- **My stats** (works without the Arena flag): 30-day answered bars from `store.days`, accuracy by subject from
  `store.mod`, mock history `store.mh` (last 20 finished mocks); with the flag on and joined, `me/stats` adds rating,
  won/lost/drawn (lost and drawn from the listed battles), recent battles and events.
- **Token:** `SMD_AUTH.currentUser.getIdToken()` per call, same as the report call in `prep.js`.
- **Tests:** `test/prep-app.test.mjs` (flag, events, countdown, error words, local stats, battle state machine) and the
  headless `test/run-prep-arena-ui.mjs` (mocked `/api/prep/arena/*` by Fetch interception, `window.WebSocket` stub;
  `SHOTS=<dir>` saves dark and light screenshots of every Arena screen).

## Lessons (2026-10-06, branch `feat/prepnucleus`)
Short chapter lessons (Revisable's "Path", done our way): text on top, one visual below, read aloud, then 3 quick
questions. No flag of its own: a module screen shows a **Lesson** row only when `prep/lessons/v1/index.json` lists the
module. Decision: [[decisions/Decisions]] 2026-10-06 "PrepNucleus Lessons".
- **Format** `prep/lessons/v1/<module>.json`: `{ v: 1, module, subject, title, minutes, steps: [{ tx, say, vis }], quiz:
  [3 bank item ids], src: [neutral ids], gen: "AI" | "hand", checks }`. `tx` 40-90 words with `**bold**` key terms;
  `say` plain narration under 120 words; `vis` null or `{kind:"table", cols, rows}` (2-5 x 2-8),
  `{kind:"flow", nodes:[{id,label,sub?}], edges:[[from,to,label?]]}` (3-8 nodes, acyclic, at most 3 a level),
  `{kind:"compare", left:{title,points}, right:{...}}` (1-6 points) or `{kind:"image", src, alt, caption}` (in-app
  path only). Validators: `PREP_LESSONS._pure.checkLesson / checkStep / checkVis` (shared by the generator).
- **Client** `prep-lessons.js` (`window.PREP_LESSONS`, loaded by `prep-loader.js` after `prep-arena.js`; `prep.js`
  forwards `data-act` `l-*`, asks `back()` first and calls `leave()` on close). Reader: segmented progress bar, 19px
  text with bold terms, the visual as real HTML/SVG (theme tokens; flow drawn in levels with connector lines,
  arrowheads and edge labels plus a screen-reader list), bottom bar: Ask MaiK (only with an on-device model:
  `PREP_TEACHER.explainStep`, same number/drug check as the question teacher), Previous, Play/Pause, speed
  0.75/1/1.25/1.5, Next/Finish; swipe left/right; "Auto" in the top bar advances when a step's narration ends. Image:
  tap to enlarge (opaque overlay, tap again for 2.2x, back/Escape closes it first). Finish: +10 XP a step on the first
  finish only, then "3 quick questions" through the normal runner (`study` mode: FSRS cards, mistakes), "Read again".
- **Narration:** `Capacitor.Plugins.TextToSpeech` on native (`lang en-IN`, `rate` = speed), `speechSynthesis` on the
  web; nothing leaves the phone. Pause stops and Play restarts the current step (the plugin has no pause). Leaving the
  reader, closing PrepNucleus or Ask MaiK stops it. No voice available: the play and speed controls are not drawn.
- **Data and offline:** lessons, the index and `prep/lessons/media/*` ship in www (`scripts/build-www.sh`); each lesson
  is also kept in IndexedDB `prep-bank` under `lessons/v1/<module>.json`. A full generated set is too big for the bundle
  and git: put it in R2 next to the bank and add `lessons/` to the bank route's whitelist first (not done).
- **Store:** `ls: { <module>: { i, n, done, xp } }`, `lsp: { r: speed, au: 0|1 }` in `smd_prep_v1`.
- **Generator** `tools/prep-lessons.mjs` (owner-run, costs money; `--dry-run` and `--check` are $0): grounding = the
  KB-only fill pack in `prep/fill/packs/<module>/` when it has 300+ words, else a lexical match of title + scope over
  `kb/reference`, `kb/diseases`, `kb/clinical-protocols`, `kb/protocols`, `kb/oncotree`, `kb/treatments` (docs named by
  the title or two scope phrases, or 5+ body hits; sentences ranked by scope words; citations and metadata stripped;
  4,000 words). Never the StatPearls packs. Stages (one Batch job each, resumable in `prep/lessons/work/`): 01-gen ->
  code gates -> 02-check (blind "is anything unsupported" per step) -> 03-redo (failed steps once) -> 04-check -> write.
  Gates: shape, every number and drug name in the grounding, no 12-word copy, no em/en dash, cleared images only.
  Quiz: 3 unflagged items from `prep/bank/v1` (else `v2`) matching the bold terms. `--index` rebuilds the index.
- **Pilot dry run (2026-10-06, 13 modules):** breast benign + cancer, AF, acute HF, oncologic emergencies,
  myelosuppression, diabetic emergencies, heart failure, acid-base (Medicine), anticoagulants, HF drugs, acid-base
  (Physiology), cardiac cycle: in 324k tokens, out 39k, **$0.07** (Rs 6.7), about $0.0054 a lesson. Weak grounding:
  physiology and pharmacology modules match clinical KB docs only (cardiac cycle took heart failure protocols); they
  want a physiology pack before a paid run. SS modules' quiz items come from bank v2 (not served to the app yet).
- **Sample:** `sur-breast-cancer` written by hand (`gen: "hand"`) from `kb/reference/breast_cancer.json` and
  `kb/oncotree/breast.json`, original wording, 8 steps (every visual kind; the T-size diagram
  `prep/lessons/media/breast-t-size.svg` is a StewardMD original). Passes every code gate (`--check`). Needs a
  clinician read before it ships.
- **Tests:** `test/prep-lessons.test.mjs` (validators, gates, citations, quiz pick, schema keys, dry run with no call,
  the 4-stage pipeline on a fake Vertex, `teachStep`) and headless `test/run-prep-lessons-ui.mjs` (sample lesson end to
  end with a stubbed `speechSynthesis`; `SHOTS=<dir>`, `PN_LIGHT=1`; fixture quiz bank `test/fixtures/prep-lessons/`).

## Previous year papers / PYQ (2026-10-06, branch `feat/prepnucleus`)
Plan: [[plans/PrepNucleus-Plan2]] section 3. Decision: [[decisions/Decisions]] 2026-10-06 "PrepNucleus PYQ". No flag of its
own (inside `smd_prep`): the home row shows on the NEET-PG tab; data comes from R2, so nothing shows until it is uploaded.
- **Copyright (public repo):** recall question text, options and images NEVER enter git. `prep/pyq/` is gitignored; the
  data lives in R2 `stewardmd-offline/prep-bank/v2/pyq/` (owner uploads) and the private bucket
  `gs://project-6074a703-e86c-40a5-848-prep-batch/pyq/`. Publisher names, URLs, watermarks and explanations are never
  kept; even the watermark text and publisher names live only in the private config `~/prep-data/pyq/papers.json`
  (`mark`, `brand`). Committed: code, tests, the synthetic fixtures (`test/fixtures/prep-pyq/`,
  `test/fixtures/prep/api/v2/pyq/`, made-up questions and a generated test-pattern image).
- **Honesty:** every paper is `kind: "recall"` (memory-based, compiled after the exam; NBEMS does not publish NEET-PG
  papers). The app says so on the papers screen, the paper panel, every run title, every chip ("Asked in NEET-PG 2025
  (recall)") and the source line. "official" exists in the code only for a source that really is official.
- **Tool** `tools/prep-pyq.mjs` ($0 steps): parse three layouts (`blog`: subject headers, `Q<n>.`, `A.-D.`, `Answer:
  <letter>`, page headers/footers; `topic`: bare subject lines, `Topic:`, `Q.<n>.`, `1.-4.`, `Correct Answer: <text>`
  matched to an option, else `key-unclear`; `ques`: `Ques <n>.`, `a.-d.`/Cyrillic look-alikes, `Ans. <letter>`). The
  options are the LAST A-D run before the answer line, so numbered statements stay in the stem; a short later stem
  paragraph without "?" is an image caption and is dropped; watermark shreds = pieces of 4 or fewer characters that are
  substrings of the mark (after 2+ spaces, or a dotted piece after one). Images: `pdftohtml -xml`, an image belongs to
  the question whose Q line came before it and whose answer line has not come yet; logos (same bytes twice or more) and
  icons (< 64 px) dropped; `cwebp -q 78`, at most 900 px wide. Stems that point at a picture with none attached:
  `img-missing` (hidden). Then merge repeats across papers (one item, both sources in `pyq`, `dup-key` when keys
  differ) and dedupe against bank v1: same normalised stem (6+ words, 2+ shared options), or char 5-gram Jaccard >= 0.8
  on stem + options, or (recalls reword stems) same key + 3 shared options + stem content-word Jaccard >= 0.3. A bank
  match is a tag `index.tags[bankId] = [module, [[exam, year, kind]]]`, not a copy. Paid stages (`--map` = subject for
  unsorted items then prep-classify's module prompt; `--screen` = prep-screen-keys blind solve, image and unclear-key
  items skipped; `--explain` = our own reasons per option + pearl, grounded on the nearest bank explanation, code gates
  (every reason, numbers grounded, no 12-word copy, no dash, no URL or publisher) then `buildReviewPrompt` gates) all
  `--dry-run` first; results in `prep/pyq/work/results.json`, applied by re-running the build.
- **Output** `prep/pyq/out/index.json` (papers with item ids, `file`, `tags`, `mods`; no question text; short cache) and
  `items-<sha8>.json` (immutable) and `img/*.webp`. Upload: `node tools/prep-upload-bank.mjs --dir prep/pyq/out --as
  v2/pyq` (dry run; `--yes` uploads, index last). Route whitelist: `v<n>/pyq/(index.json|items-<8 hex>.json|img/<name>.webp)`.
- **Client** `prep-pyq.js` (`window.PREP_PYQ`, loaded by `prep-loader.js` after `prep-lessons.js`; `prep.js` forwards
  `data-act` `y-*`, asks `back()` first, calls `chips()`, `figure()`, `prov()` while drawing a question, `mount()` on the
  module screen). Screens: Previous year papers (honesty note, years newest first, Recall label, counts without flagged
  items) -> a paper (questions, held back, timed test in the NEET-PG pattern from `MOCKS` scaled to the paper (210 min
  per 200, +4/-1), practice in paper order, by-subject list). Module screen: "All questions / PYQ n" chips; PYQ runs
  the recall items mapped to the module (not bank copies) plus bank items tagged as asked. Images: lesson figure style,
  tap to enlarge (`.pn-zoom`, tap again 2.2x, back/Escape closes first). Recall items have no bookmark and stay out of
  My mistakes (both reload module files); FSRS cards go under the mapped module (`p:pyq` until mapped). Index and items
  cached in IndexedDB `prep-bank` (`pyq/index.json`, `pyq/items-*.json`); images rely on the HTTP cache (immutable).
- **First run (2026-10-06, 4 owner papers, all recall):** 2025 compilation 198/200 parsed, 2024 topic-wise 39/40,
  2024 shift 1 80/92, 2024 shift 2 12/27 (the shift papers' failures are the source: questions recalled with 2 or 3
  options, or answers with no letter). 327 items after 2 repeats merged; 102 images attached; 11 held back for a
  missing image, 1 for an unclear key; 3 bank matches (0 key conflicts); 90 items without a subject until `--map`.
  Dry run of map + screen + explain + review: about $0.11 (Rs 11). Not run (owner's yes needed), not uploaded to R2.
- **Gotcha:** `emoji-icons.js` removes page locators ("pg 45") from rendered text, which also ate "PG 2025" out of
  "NEET-PG 2025"; `scrubBooks` now protects "NEET-PG" (test in `test/emoji-icons.test.mjs`).
- **Tests:** `test/prep-pyq.test.mjs` (three parsers on synthetic fixtures incl. watermark shreds, option matching,
  image attachment, merge and bank dedupe, stage requests and gates, dry run with no call, app pure helpers),
  `test/prep-server.test.mjs` (PYQ route whitelist), headless `test/run-prep-pyq-ui.mjs` (`SHOTS=<dir>`, `PN_LIGHT=1`).

## Plan, readiness, onboarding, FMGE (2026-10-06, branch `feat/prep-plan`)
Plan: [[plans/PrepNucleus-Plan2]] sections 1, 4, 5 phase 1. Decision: [[decisions/Decisions]] 2026-10-06 "PrepNucleus plan".
No flag of its own (inside `smd_prep`).
- **Onboarding** (`onboard()`): first plain `PREP.open()` while `pl.ob` is not 1. Exam (NEET-PG, INI-CET, NEET-SS, USMLE,
  FMGE; INI-CET maps to the NEET-PG tab), exam date (native date input, "Not decided yet"), minutes a day (15/30/60/90/120),
  reminder time (native time input or none; stored only, the native reminder needs a store build). Skip stores defaults
  (30 min, no date). "Change plan" on home opens the same fields in a settings sheet; saving re-plans the day.
- **Store:** `pl { ob, exam, date, min, rem }`; `pt { d, ex, min, items, total }` today's plan per exam tab (rebuilt on a
  new local day, a tab change or new minutes); `ra` answer log `[module, 1|0]`, newest last, 600 kept (written by
  `record()` in `prep.js` through `PREP_PLAN.noteAnswer`).
- **Readiness** (`readiness()`, pure): geometric mean of coverage, retention, accuracy, x 100. Coverage = modules with
  any answer or card / modules with questions for the exam (taxonomy modules until the subject index loads), weighted
  per subject by `BLUEPRINT[exam]` (FMGE only: NBEMS bulletin marks; radiotherapy 5 has no bank subject, so 295) else by
  module count. Retention = mean `SPECIALTY_CORE.retrievability(today - last, s)` of the exam's seen cards. Accuracy =
  last 200 logged answers in the exam's modules, module totals when the log is empty. Home: one line (score /100, exam,
  days to the exam when a date is set and the tab matches the chosen exam). Tap: sheet with the three factors, what each
  counts, the three weakest subjects (score asc, heavier first) and one action each (`subjectAction`: most due ->
  "Review N due", weakest module under 60% -> "Practise", first untouched -> "Start").
- **Today's plan** (`planDay()`, pure): reviews 30 s each up to the minutes; a mini mock (50 questions, the chosen exam's
  pattern) on Saturday/Sunday, or any day within 14 days of the exam, when it fits; a lesson (`pickLesson`: the weakest
  subject with an unfinished lesson in `prep/lessons/v1/index.json`) when it fits and the exam is more than 14 days away;
  new questions (exam sec/60 min each, at least 5) in `weakModules`, else where "solve next" points. Rows tick from the
  store (`itemProgress`: due count dropped since planning, new cards made today since planning, lesson finished today,
  a mock finished today). Starting: reviews and new questions run here through `HOST.run`; the lesson row is `l-open`;
  the mock row is `HOST.startMock(id, "mini")`. PYQ papers are not planned yet (data not in R2).
- **FMGE:** `EXAMS` entry `fmge` with `all: true` (every MBBS subject regardless of its `ex` tags). `MOCKS.fmge`: 300
  questions, 300 min, 2 parts, +1/0, pass 150; the mock screen offers "One part: 150 questions, 2 h 30 min" and a mini
  mock; the result names the pass mark. Source: NBEMS "FMGE October 2026 information bulletin" v2.2
  (https://nbe.edu.in/IB/FMGE%20october%202026%20information%20bulletin%20v2.2.pdf), section 5 (scheme, no negative
  marking, pass 150/300) and section 12.2 (blueprint), fetched 2026-10-06. The bulletin gives each part as 150+3 min;
  the mock uses 150. Arena: `SOON.fmge` in `prep-arena.js` ("coming soon"), no server scheme.
- **Tests:** `test/prep-plan.test.mjs` (readiness factors, blueprint, last-200 window, empty and all-wrong, daysLeft,
  planner order and budget over every minutes/due/weekend/pace/days combination, lessons, progress, actions, FMGE pattern
  and blueprint) and headless `test/run-prep-plan-ui.mjs` (onboarding, hero, sheet, plan ticking, settings re-plan, skip,
  FMGE tab, mock and Arena; `SHOTS=<dir>`, `PN_LIGHT=1`).
- **Gotcha:** every other headless PrepNucleus test sets `window.SMD_PREP_ONBOARD=false` in its init script, or the first
  open stops at onboarding. A new UI test needs the same line.

## Store
localStorage `smd_prep_v1`: `{v, cards, conf, days, mod:{t,ok,last}, bm, rep, exam, last, dl, hid, mt, goal, mh, ls, lsp, pl, pt, ra}` (`ls`/`lsp`: Lessons;
`pl`/`pt`/`ra`: Plan). FSRS deck key
`p:<module>` (Layer C decks `p:deck-<id>`). `hid` is the auto-hidden list, refreshed at most every 6 hours.

## Tests
`test/prep-app.test.mjs`, `test/prep-build-bank.test.mjs`, `test/prep-server.test.mjs`, `test/prep-core.test.mjs`,
`test/prep-generate.test.mjs`, `test/prep-layerc-e2e.test.mjs`, `test/prep-create.test.mjs`, `test/prep-teacher.test.mjs`,
`test/prep-tools.test.mjs`, `test/prep-lessons.test.mjs`, `test/prep-plan.test.mjs`, headless `test/run-prep-plan-ui.mjs`, `test/edge-start-mcq.test.mjs`, headless `test/run-prep-lessons-ui.mjs`, headless `test/run-prep-create-ui.mjs`, `test/run-prep-arena-ui.mjs` and `test/run-prep-ui.mjs` (real app + fixture bank in `test/fixtures/prep/`;
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
