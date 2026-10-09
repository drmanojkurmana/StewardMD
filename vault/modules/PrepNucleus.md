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
  is also kept in IndexedDB `prep-bank` under `lessons/v1/<module>.json`. **Generated lessons are served from R2**
  (2026-10-06, branch `feat/prep-native`): `prep-bank/v1/lessons/index.json` + `<module>.json` (1,082 modules, uploaded
  with `tools/prep-upload-bank.mjs --dir <gen dir> --as v1/lessons --yes`), read through `/api/prep/bank/v1/lessons/...`
  (`host.bankApi`, so tests point it at `test/fixtures/prep-lessons/api/`). `index()` merges the bundled index with the
  bank index (`mergeIx`: bank wins, a bundled `gen:"hand"` lesson always wins; each entry carries `from: app|bank`).
  Bank lessons are kept in IndexedDB under `v1/lessons/<module>.json`, cache first (immutable); a bank 404 or offline
  first open falls back to the bundled file. The route also whitelists `v<n>/lessons/media/<file>.(svg|webp)` (CSP on
  SVG), but no generated lesson uses bank media yet and the upload tool only uploads `.json`/`.webp`.
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
  `--dry-run` first; results in `prep/pyq/work/results.json`, applied by re-running the build. `--explain-redo` (one
  retry, resumable, Batch stages `explain-redo` + `review-redo`): every item whose first explanation failed a code gate
  or the review is regenerated once with the reason fed back (g9b names the ungrounded numbers; a review failure names
  the failed gates in words plus the reviewer's note) and a stricter stay-in-the-notes instruction, then the same gates
  and review. Rejections are rebuilt from the saved first-pass requests and replies, so nothing is re-sent. Disputed and
  key-unclear items are never explained. Still failing: `pending` -> flag `exp-pending`, which (alone of all flags) does
  not hide the question; the app shows "Explanation coming soon".
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
  Paid run (owner's yes): subject + map + screen + explain + review about $0.12; explanations 315 sent, 209 accepted
  (rejected: g9b 24, review 82), 32 disputed keys. Retry (`--explain-redo`, $0.025): 91 sent (the 15 disputed rejects
  skipped), 28 accepted, 63 `exp-pending` (g9b 4, review 59). Now 237 items carry our explanation; 283 of 327 usable,
  220 of those explained. Uploaded to R2 `prep-bank/v2/pyq/` (verified by hash) and to the private bucket. The live
  `/api/prep/bank/v2/pyq/` route answers only after this branch's bank route deploys (main's whitelist lacks it).
- **Second batch (2026-10-06, owner's zip of 13 compilations, 2012-2023):** three more layouts (`num`: "N." + "a)" +
  "Correct Answer - X" with the publisher's explanation and its numbered lists, read by answer ordinal; `aipg17`: "Question
  N" with mixed answer styles; `qno`: "Ques No:" bank export with Subject/Topic lines). Image-only pages OCRed with
  macOS Vision (`conf.ocr`, 200 dpi, a page at a time; about 15 s a page; some pages failed and were left out). 2012-2016
  are tagged `aipgmee` (pre-2017) but hold 1,450 to 2,100 questions each, so they are year-wise compilations, not single
  papers: the app times any paper over 200 questions as 200 random ones. 2017 is tagged `neet-pg` (owner's rule) though
  the file says AIPGMEE. Totals after merging all 17 papers: 10,485 items (587 repeats merged), 5,410 bank matches
  (213 with a different key, hidden), 460 images. Paid run $3.50 (map, screen 1,243 disputed, explain 7,173 + 504 on
  the retry); now 7,914 explained, 1,227 `exp-pending`, 8,975 usable. Uploaded to R2 and the private bucket.
- **Frozen papers:** the owner deletes inputs after use, so a paper whose txt and pdf are gone is kept from the last
  build (its items, merges, images) instead of re-parsed; a rebuild without the inputs reproduced the same 10,485 items.
  `index.json` is now about 800 KB and the items file about 11 MB (split per paper if phones struggle).
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

## Cards (2026-10-06, branch `feat/prep-cards`)
Module flashcards (Plan 2 phase 2). No flag of its own (inside `smd_prep`): a module screen shows **Cards · n** when
`prep/cards/v1/index.json` lists the module; home shows **Cards due** once any card was studied. Decision:
[[decisions/Decisions]] 2026-10-06 "PrepNucleus Cards".
- **Format** `prep/cards/v1/<module>.json`: `{ v: 1, module, subject, cards: [{ id, kind: "basic"|"cloze"|"occl", fr, bk,
  src: { item? | kb? }, gen: "AI"|"hand" }] }`. `fr` at most 25 words (basic: a question ending "?"; cloze: exactly one
  `{{term}}`), `bk` at most 40. Occlusion adds `img` (cleared `prep/lessons/media/*` only) and `boxes: [{ x, y, w, h,
  label }]` in fractions of the image. Validators `PREP_FLASH._pure.checkCard / checkDeck` (shared by the generator).
- **Client** `prep-flash.js` (`window.PREP_FLASH`, loaded after `prep-pyq.js`; `prep.js` forwards `data-act` `k-*`, mounts
  `#pnCardSlot`, adds the home row, calls `leave()` on close) and `prep-flash.css`. Tap turns a basic card (260 ms 3D turn;
  cross-fade under reduced motion; no motion for keys); cloze fills in place (the hidden term is `aria-hidden` with a
  screen-reader "blank"); occlusion masks are buttons, each opens alone, grades appear once all are open ("Reveal all"
  opens every one). Grades Again/Hard/Good/Easy show the FSRS interval each gives (`intervalFor` = what `review` writes);
  swipe right Good, left Again (touch only, not from the left 28 px edge); keys Space/Enter reveal, 1 to 4 grade;
  `SMD_HAPTICS.selection()` on every grade. Session: due first (least remembered first), then new cards in deck order up
  to today's allowance; an Again comes back once at the end. End screen: count, tally, when the next cards are due,
  "Learn 10 more" when new cards remain, new cards a day 10/20/30/50 (`fc.cap`, default 20).
- **Memory:** deck key `p:<module>:c` in the shared store; `progressByModule` skips card keys (MCQ counts unchanged),
  `recall(store, "p:<module>")` counts both. Store `fc: { cap, day, n, more }`. Decks are kept in IndexedDB `prep-bank`
  under `cards/v1/<module>.json`; `scripts/build-www.sh` ships `prep/cards/v1`. **Generated decks come from R2**
  (2026-10-06): `prep-bank/v1/cards/index.json` + `<module>.json` (864 decks, 39,963 cards, from `~/prep-data/cards-gen`),
  through `/api/prep/bank/v1/cards/...`, merged and cached exactly like lessons (`mergeIx`, IndexedDB
  `v1/cards/<module>.json`, bundled hand deck wins, bundled fallback). SS modules have no decks (no SS bank).
- **Generator** `tools/prep-cards.mjs` (owner-run, costs money; `--dry-run`, `--check`, `--index` are $0; `--bank <dir>`
  for a worktree without the gitignored bank). Sources: unflagged items with a 12+ word explanation (negative stems last),
  at most 120 (two per card), 12 per request asking 7 cards; plus one request per KB-only fill pack (8 cards). Stages
  `01-gen`, `02-check` (blind self-check), resumable through `prep-lessons.mjs` `stage()` (exported, `ctx.jobPrefix`).
  Gates per card against its own source: shape, numbers and drugs (`prep-teacher.js` check), 12-word verbatim, book /
  page / edition / site names (`emoji-icons.js` `hasBooks` plus a short list), dashes, duplicate fronts (Jaccard 0.7).
  Keeps at most `min(60, ceil(usable / 2))`. A deck with a hand card is never overwritten. `--pilot` = sur-breast-cancer
  plus the largest other module of each MBBS subject (20).
- **Dry runs (2026-10-06, not run):** pilot 20 modules, 199 requests, $0.26 (Rs 25); all 864 MBBS modules, 6,915
  requests, about 40k cards kept at most, $8.61 (Rs 826). SS modules have no v1 bank yet.
- **Sample:** `sur-breast-cancer` by hand (10 cards: 7 basic, 2 cloze, 1 occlusion on `breast-t-size.svg`), cited to
  `kb-reference-breast-cancer`; passes every gate (`--check`). Needs a clinician read before it ships.
- **Open:** "answered today" on the home plan counts card reviews too (`store.days` is shared); the plan/readiness work
  should decide whether the daily question goal counts cards. `?v=prep5` was not bumped (merge with the parallel branch
  first). Not tested on a phone.
- **Tests:** `test/prep-flash.test.mjs` (validators, gates, dedupe, scheduling hook, interval previews, dry run with no
  call, the 2-stage pipeline on a fake Vertex, sample deck) and headless `test/run-prep-flash-ui.mjs` (flip, grades, key,
  swipe, cloze, occlusion, end screen, FSRS rows, home Cards due; `SHOTS=<dir>`, `PN_LIGHT=1`).

## Phase 4 native: sync, reminders, widgets, Live Activity (2026-10-06, branch `feat/prep-native`, not deployed)
Owner checklist: [[plans/PrepNucleus-Phase4-OwnerChecklist]]. Cache token `prep8`.
- **Sync (opt-in, off by default, needs sign-in):** `prep-sync.js` (`window.PREP_SYNC`: `status/enable/disable({wipe})/sync/onChange`),
  route `functions/api/prep/sync/[[path]].js` (GET/PUT/DELETE, base64 body because native `/api/*` goes through
  CapacitorHttp string bodies; 256 KB cap; `If-Match` + salt compare-and-set; DELETE returns 200 `{deleted}`), table
  `prep_sync` in `PREP_ARENA_DB` (`prep-arena-worker/migrations/0001_prep_sync.sql`, NOT applied). Row key
  sha256("prep-sync|"+uid); the uid is never stored.
  Crypto: HKDF-SHA256(uid, per-user random server salt) -> AES-GCM-256, gzip (CompressionStream; raw-JSON flag fallback).
  Merge: `specialty-core.js review()` appends `[key, day, g, ts]` to `store.rl` only when the store has `rl` (sync on);
  cards = server base + union of review events by id, replayed in time order; events older than 30 days are compacted into
  the base. `days` and `mod.t/ok` are per-device G-counters (max per slot, sum); `mod.last` max; `exam/goal/last/pl/pt/lsp/ra`
  and map keys `bm/mt/rep/ls` are LWW with tombstones (hybrid clock, 120-day tombstone prune); `mh` union, newest 20.
  Device-local, never synced: `conf`, `dl`, `hid`, `fc`, sims. Local sync state: localStorage `smd_prep_sync_v1`.
  Triggers: PrepNucleus open, a finished set, app visibility change, "Sync now".
- **Threat model:** protects against a database/backup leak and anyone without the uid. Does NOT protect against the
  server operator running modified code (sees the uid on each request, holds the salt); closing that needs a
  user-held secret + recovery code. Server sees blob size, update times, uid hash.
- **Known approximations:** events from a device offline over 30 days replay on top of the compacted base; over 120 days
  offline can resurrect a deleted map key; Layer C deck deletion (`purgeStore`) is not synced and counters never decrease;
  `store.rl` grows while sync is on but offline.
- **Reminders:** `prep-native.js` (`window.PREP_NATIVE`), `@capacitor/local-notifications` (already installed). One daily
  notification (id 2147483100) at `pl.rem`, re-scheduled on each open/plan change for the next occurrence only;
  permission only from the reminder switch ("Study reminders" since the nudges); on/off per device in localStorage `smd_prep_rem`; tap
  `extra.route = "prep"` -> `native-push.js` -> `SMD_openRoute("prep")` (home.js).
- **Widgets + Live Activity:** plugin `@stewardmd/capacitor-prep-widgets` (`local-plugins/capacitor-prep-widgets`, JS
  `PrepWidgets`: `setData/activityStatus/startActivity/updateActivity/endActivity`). Data JSON `{v, score, exam, daysLeft,
  done, total, next, day, updated}` in App Group `group.in.stewardmd.app` key `prep.widget` / Android SharedPreferences
  `prep_widget`/`data`. iOS widget kind `StewardMDPrep` (small + medium) and `PrepLiveActivity` in the existing
  `ios/App/StewardMDWidget` bundle (`PrepWidgets.swift`); attributes in `Packages/StewardMDWatchCore/.../PrepActivity.swift`.
  Android `PrepWidgetProvider` (hourly refresh). Taps open `stewardmd://prep`. Live Activity starts on tapping a plan item
  (only if enabled in system settings), updates as items complete, ends when all done or on the next day's first open.
  No Android ongoing notification (owner).
- **Smart nudges (2026-10-06, branch `feat/prep-nudges`, not deployed):** the reminder switch is now "Study reminders"
  with two modes, Smart nudges (default) and Daily reminder only (`smd_prep_ndg_mode`). `prep-nudges.js`
  (`window.PREP_NUDGES`) schedules up to about 12 personal, true local notifications (ids 2147483001 to 2147483060): plan,
  due reviews, weak subject, streak, wins, exam countdown, comeback, weekly recap, Arena sprint; 2 a day, 4 h apart,
  quiet hours, back-off. Social pushes (challenge, passed you on the college board, friends studied today) from
  `functions/_prep-nudge-push.js` (D1 `social_push`, migration 0003, NOT applied; Worker cron + `PREP_CRON_TOKEN`, NOT
  set). Taps open the exact screen through `SMD_openRoute("prep", opts)`. Full catalogue and rules:
  [[plans/PrepNucleus-Nudges]]. Token `prep12`.
- **Feeds update only after PrepNucleus was opened in that app session** (prep-native.js loads with PrepNucleus). The
  same holds for nudges: they are computed when PrepNucleus is open and scheduled ahead (up to day 21).
- **Tests:** `test/prep-sync.test.mjs` (11), `test/prep-sync-route.test.mjs` (4), `test/prep-native.test.mjs` (5), headless
  `test/run-prep-native.mjs`; Swift `PrepSnapshotTests` in StewardMDWatchCore.
- **Not verified:** full iOS app build and `assembleDebug` (disk ran out), anything on a device, real D1 BLOB binding.

## Pro, free tier, social, accuracy page (2026-10-06, branch `feat/prep-social`, not deployed)
Owner decisions: [[decisions/Decisions]] "PrepNucleus pricing, free tier and social" plus the two price-ladder updates the same day.

**Pricing (server is the only source of prices):** list Rs 5,999/year, charged on renewal. First year: launch Rs 1,499 until `PREP_LAUNCH_ENDS` (2027-03-31 23:59 IST), then `PREP_INTRO_AFTER_LAUNCH` (default Rs 5,999, no intro). Student (existing `traineeVerified` claim): 20% off list. One-time win-back Rs 999: eligible on a visit at least 60 min after an unpaid prep Razorpay order, 48 h from first shown, one per account ever, dismiss ends it. Best single price, never stacked; `offPct`/`saveRupees` computed from config. Anyone who paid before gets `priceReason:"renewal"` (list). Referral: code = referrer's StewardMD ID, recorded before purchase; referrer gets 30 days on the referee's first paid purchase, in the same atomic write, once. 3-month plan dropped.
- Server: `functions/_prep_pro.js` (config, quote, offer, referral, fulfilment); `functions/api/entitlements/[[path]].js` (GET `prepPro`, `prep-quote`, `prep-offer`, `prep-offer/dismiss`, `prep-referral`; Firebase user auth, not owner-only); `functions/api/billing/[[path]].js` (Razorpay order amount from the quote with `{prepPlan:"year"}`, store receipt verify for the prep product, `/api/billing/status` carries `prepPro`, PhonePe refuses prep). State on `entitlements/{uid}` (`prepProExp`, `prepPaidRefs`, `prepCheckoutAt`, `prepOfferShownAt`, `prepOfferEnded`, `prepReferrer`...). Config via KV `billing:cfg` or env `PREP_*` (a numeric 0 cannot be set: falls back to default).
- Cancel anytime: Razorpay purchases are one-time orders (`autoRenews:false`, nothing to cancel). Store purchases return `manageUrl` (App Store / Play subscriptions page). Refund: 7-day full refund for Razorpay purchases (`refunds.html#prepnucleus`), requested in app via `POST /api/support` (subject "Refund request (PrepNucleus)") or email; the owner revokes access by hand. Store purchases are refunded by Apple/Google.
- Client: `prep-pro.js` + `prep-pro.css`; `window.PrepPro.can(feature)` holds every gate. Flag `smd_prep_pro_enforce` default **OFF** (localStorage `"1"` or `?prepenforce=1`). On and not Pro: 50 questions, 1 lesson, 10 cards a day (localStorage `smd_prep_pro_day`), first 2 modules per subject open, own decks and the daily sprint free; checks only at the start of a set, never mid-question. Hooks in `prep.js` (runQuestions, record, onClick, home rows), `prep-flash.js` (card grade count), `prep-loader.js` (loads prep-pro/prep-social, token prep8), `pro-paywall.js` (`SMD_PRO.buy`, `productIdFor` passes `productId`).
- Gotcha: iOS IAP cannot apply the win-back or student price (`SMD_IAP.purchase(productId)` only; promotional offers need server signing that does not exist), so the client must not show those prices on the store path.

**Social (Arena D1, consent-first):** `functions/api/prep/social/[[path]].js` + `functions/_prep-social.js`; migration `prep-arena-worker/migrations/0002_social.sql` (also appended to `schema.sql`, a test keeps them equal). Friends by StewardMD ID (Firestore `doctorDirectory` lookup cached in `social_ids`), challenges (16-char room, 10 min, friends only, carries `exam`), college tag (normalised) with college/state boards (sum of Arena event scores over 30 days, ties by battle rating), study groups (code, max 30, daily target, weekly board from client-reported `POST /progress`). Leave Arena deletes all social rows. Worker: `/battle?exam=&room=` checks the room against `social_challenges`, rooms pair only with the same room, 3 min wait then `{t:"nobody"}`. Client `prep-social.js` (`PrepSocial.open/openAccuracy`), `prep-arena.js` (`PREP_ARENA.startBattle({room, exam})`).

**Accuracy page:** `node tools/prep-accuracy.mjs` writes `prep/accuracy.json` (disputed key rate per subject from the newest `prep/bank/v1/screen-*.json`, AI question/lesson/card gate pass rates from the fill/lesson/card reports). Report counts and median fix time are null ("Not yet published") because flag reports live only in server storage. Web page `prep/accuracy.html`; in app via `PrepSocial.openAccuracy()`. A test fails if the committed JSON drifts from the script output; rerun the script after new reports. Current headline: 12.0% of screened keys disputed (hidden), which the page publishes as is.

**Tests:** `test/prep-pro-server.test.mjs`, `prep-pro.test.mjs`, `prep-social-server.test.mjs`, `prep-arena-room.test.mjs`, `prep-accuracy.test.mjs`; headless `run-prep-pro-ui.mjs`, `run-prep-social-ui.mjs`.

### Owner checklist (in order)
1. Review the legal text: `refunds.html#prepnucleus` (7-day refund, Razorpay only) and that Terms mention PrepNucleus Pro, renewal at Rs 5,999 and the launch end date.
2. Decide whether to publish the accuracy page now (it shows 12.0% disputed keys, hidden from students). Plan 2 lists this as an open decision.
3. App Store Connect: auto-renewable subscription `in.stewardmd.prep.annual` (placeholder id; set `PREP_IAP_PRODUCT` if you choose another) at Rs 5,999/year with an introductory offer Rs 1,499 for 1 year (pay up front) ending with the launch date; a promotional offer or offer code `prep_winback_999` at Rs 999 for the first year (`PREP_IOS_WINBACK_OFFER`). Promotional offers need a server-signed offer (subscription key from App Store Connect + signing code, not built); until then iOS does not show the win-back.
4. Play Console: subscription with base plan `prep-annual` Rs 5,999/year auto-renewing, intro offer `prep-launch-1499` (new customers, 1 year at Rs 1,499), developer-determined offer `prep-winback-999` (1 year at Rs 999). Set `PREP_PLAY_*` if ids differ. Note the Android app currently checks out with Razorpay; Play billing ids are placeholders for when that changes.
5. Store server notifications (App Store Server Notifications v2, Play RTDN) for renewals are still placeholders: auto-renewals extend access only when the app re-posts a receipt. Wire before relying on store renewals.
6. D1: `npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0002_social.sql` (check the DB name in `prep-arena-worker/wrangler.toml`).
7. Redeploy the battle Worker (`prep-arena-worker`, adds `room`), then run its smoke (`prep-arena-worker/smoke/run.sh`) with two accounts doing a friend challenge.
8. Merge `feat/prep-social` and let Pages deploy; then build-www, cap sync and store builds for the native apps.
9. Real payment test on web/Android (Razorpay live, Rs 1,499 launch, then refund it via the support flow), plus a sandbox iOS purchase. Check: `prepPro.active`, expiry 365 days, referral credit on a second account, win-back appears after an abandoned order on a later visit and never again after dismiss.
10. Only after step 9: set `smd_prep_pro_enforce` on (it is a client flag today: localStorage / `?prepenforce=1`; a remote default needs a remote-config entry).
11. Optional config: `PREP_STUDENT_DISCOUNT_PCT`, `PREP_REFERRAL_DAYS`, `PREP_LAUNCH_ENDS`, `PREP_INTRO_AFTER_LAUNCH`, `PREP_WINBACK_*` in KV `billing:cfg`.

## Premium UI (2026-10-07, branch `feat/prep-premium-ui`, `?v=prep14`)
- World: night-teal room lit from the top (`--pn-aura` on `.pn-root`), one deep teal hero surface (`--pn-hero`) for readiness,
  finish screens (`.pn-score`, `.pn-lsn-fin`, `.pk-end`) and the Arena lobby; tokens are re-scoped inside the hero so children
  read on teal. Rounded numerals (`--pn-num`: ui-rounded, system fallback). Gradient icon squircles hued by `--h`
  (`subjHue()` in prep.js for subjects, `[data-act]` rules in prep.css for actions). Light cards: shadow, no border; dark
  cards: hairline `--pn-edge`.
- Home hero (`heroHtml` in prep-plan.js): readiness ring, exam countdown, chips for streak (`CORE.streak`), answers today
  (`days[today]`) and lesson XP (sum of `ls[*].xp`). Practise and Compete rows render as two-column tiles (CSS only).
- `prep-motion.js` (optional in the loader): MutationObserver on the overlay; ring draw and count-up, ease-out entrances,
  spring pop on finish screens and sheets, answer lift or shake with `SMD_HAPTICS` success/error, mouse-only tile tilt.
  Uses a modern Motion build (`/vendor/motion/motion.js`, evaluated privately because index.html keeps an older Motion One
  on `window.Motion` for OncoTree). Off under reduced motion; CSS shows the final state without it. CSS-only effects:
  aurora drift and meteors on hero surfaces (paused off screen), rotating light border on Solve next and the Daily sprint
  tile, shimmer on the plan placeholder.
- Owner rule (2026-10-07): no "AI-generated" labels and no per-item source or credit lines anywhere in PrepNucleus (runner,
  lessons, cards, decks, accuracy page). Credits and how content is made live in terms.html section 31 and privacy.html
  section 26. Data fields (`gen`, `prov`, deck `label`) stay in the JSON; only the PYQ paper type line still shows.
- Headless suites finish finite animations before each screenshot (`shotCall`), so shots show final frames.

## Premium UI round 2 (2026-10-07, same branch, `?v=prep15`)
- Art: 14 WebP illustrations in `prep/art/` (about 300 KB; `scripts/build-www.sh` copies them): `hero-dark`/`hero-light`
  (home and onboarding sky), `ob-exam|date|min|rem`, `fin-mock` (set, test and event results), `fin-lesson` (lesson and
  cards finish), `fin-win`/`fin-loss` (battle end; draw uses loss), `arena` (lobby banner, battle card), `empty-bm|sc`.
  Made with Vertex `gemini-3.1-flash-image` at 1K ($0.067 an image; Imagen 4 ids were discontinued 2026-06-30 and 404),
  15 billed calls, $1.01. No text, people or logos in them.
- Home scene: `.pn-sky` is the first child of the root on home and onboarding (CSS picks the theme's image); bar, tabs and
  body sit above it (z-index 1). prep-motion.js moves it with the body scroll (0.42x, 1x under reduced motion) and fades
  it; without prep-motion.js it stays put. Readiness card is frosted glass over it.
- Level: `xpOf(store)` = answers + right answers + lesson XP; `levelOf(xp)`: level n starts at 50n(n-1) XP, ranks Fresher
  (1), Intern (3), Resident (5), Registrar (8), Consultant (12). Shown in the hero and explained in the readiness sheet.
  The lesson XP chip is gone (it is inside the XP now).
- Section heads have a `.pn-eb` line above (outside `.pn-h`, so tests reading `.pn-h` text are unchanged). Compete with
  more than one row is a snap carousel; the battle card shows the arena art.
- Finish art is a `::after` on `.pn-score`, `.pn-lsn-fin`, `.pk-end`, `.pn-lobby`; empty states use `.pn-empty.pn-art-*`.
- Motion: sparkles replaced round 1's meteors (a meteor crossing the ring read as a stray line); confetti on a battle win,
  a lesson's first XP and a set at 70% or better; lesson XP counts up; the level bar fills; spotlight and tilt on tiles
  for mouse or trackpad only. Children of hero surfaces are `position: relative`, so the confetti layer is excluded.

## Premium UI round 3 (2026-10-07, same branch, `?v=prep16`)
- Runner focus mode (prep.js `renderRun`): `.pn-qprog` strip under the bar (one segment a question up to 30: right,
  wrong, answered, marked, current; a plain fill beyond), `runStreak` chip "N in a row" (3 or more, practice only, from
  this set's answers), a pace ring around the test clock (empties over limit / questions; `.over` turns it amber),
  bookmark and report as labelled icon buttons in the bar (`.pn-acts`), larger stem, options press to 0.97.
  The reveal plays once per answer: `r.fresh` puts `.pn-new` on the feedback card only on the paint right after a tap
  (a bookmark or tag repaint keeps still; a key answer sets `st.kb` and skips it). prep-motion.js: chosen option lifts
  or shakes once, the right option glows (CSS `pn-glow` via `:has(.pn-new)`), the card springs up 36 px.
- Runner swipe (`bindRunSwipe`, touch and pen only): left = next once answered (any time in a test), right = previous in
  a test; rubber band where it cannot go; commit past 80 px or 0.5 px/ms; the next question enters from that side
  (`.pn-qw.in-r/in-l`). A drag that settles back sets `st.dragAt` so its trailing click is not an answer (cleared on the
  next press). Keys (`onRunKey`): A to D or 1 to 4 answer, Enter or right arrow next, left arrow back in a test.
- Cards: `swipeGrade` adds up = Easy (4); drag tint and stamp per grade (`.pk-tint.l/r/u`, stamp is a tab above the
  card), next two cards peek (`.pk-stack .pk-peek`, blank backs) and the first rises with the throw; a thrown card
  carries on from the finger; a short throw settles on a spring (`PREP_MOTION.settle`); one haptic when the commit line
  is crossed. Progress is a ring in the bar (`.pk-ring`, cards left inside, animated from `K.ringAt`).
- Lessons: step dots (current a lit pill, `i.on` semantics unchanged), 21 px reading type with key terms on a
  highlighter stroke, image visuals edge to edge under 752 px, Play pill with a waveform that moves only while speaking,
  32 px shared-axis step slide, pinch zoom on the enlarged image (`bindPinch`, 1x to 4x around the midpoint, pan when
  zoomed, tap toggles 2.2x; transform only).
- Arena: initials avatars in gradient rings (`hueOf(name)`); the match screen is a VS moment over `prep/art/vs.webp`
  (`vsIntroHtml`, `.pn-vs.pn-vsi`, prep-motion.js `vsIntro`); scores roll when they change (`.tick`), a round's points
  float up once (`.pn-pts`, CSS only); the end counts the rating to its new value (`.pn-rtick`) with a delta chip.
- My stats is a profile: level card (`levelOf`/`xpOf` from prep-plan.js, `prep/art/level.webp`), day streak, best
  streak (`bestStreak`), answered, share right, a 12-week study calendar (`heatWeeks`, Monday first, `heatLevel` 0 to 4 at
  1/10/25/50 answers), "Subject mastery" bars (the accuracy list, fill by transform). "Share my progress" draws a
  1080 x 1350 PNG on a canvas (`drawCard`: hero-dark and streak art, level, streak, calendar, totals; no name or ID) and
  opens the native share sheet through Filesystem + Share (as atlas3d.js), else Web Share with a file, else a download.
- Art: `streak.webp`, `level.webp`, `vs.webp` (51 KB), 3 calls, $0.20 (log in the job's imagen/log.tsv).
- Headless suites wait 150 ms before each screenshot (Motion starts its animations on the next frame). `STRIP=<dir>`
  on run-prep-ui, run-prep-flash-ui and run-prep-arena-ui writes motion frames (paused animations stepped in ms).

## Premium UI round 4 (2026-10-07, same branch, `?v=prep17`)
- Navigation motion: prep.js `nav(dir)` marks the next `paint()` (push 1, back -1, tab or filter 0; the mark lapses after
  1.5 s; Escape never marks). prep-motion.js `nav(root, d)` runs WAAPI on `:scope > .pn-body` (28 px shared-axis slide plus
  fade, 240 ms) and the title and tabs (12 px, 200 ms); a tab cross-fades the body (180 ms); reduced motion is a 160 ms fade.
  The first 450 ms after the overlay opens are not animated. Marked: push, back, runner start, done, exam tab, subject
  filter, mistakes filter, onboarding steps (prep-plan.js), social tabs (prep-social.js), Arena board tabs (prep-arena.js).
  `HOST.nav` exposes it to the other files.
- Loading: every `.pn-load` is a CSS skeleton (four card shapes from one pseudo-element's box-shadows, a shimmer that moves
  by transform, `contain: paint`); the status text stays as a small label. Exempt: `.pn-sheet .pn-load` and
  `#pcCreateView .pn-load`. No JS change, so every module's loading state got it.
- Screens: subject hero (`.pn-subhead`, hue-tinted deep surface, icon, ring via `mring()`, reviews due), module panel
  `.pn-modp` (answered ring, hue glow; also the PYQ panels), mistakes filters on one scrolling line (`.pn-wrap.pn-scroll`)
  with a tag-hued mark per row, search field glyph and a prompt state (`.pn-hint`), bookmarks and downloads with subject
  tiles, downloads art (`empty-dl.webp`), custom module in two panels with a summary line, mock banner (`mock.webp`),
  per-subject meters in the mock analysis, question grid key, PYQ papers banner (`#pnYq::before`, `papers.webp`),
  pricing plan art (`pro.webp`), accuracy hero figure (`.ps-hero`, share of keys that matched the independent check).
- Perf: the readiness card lost its 22 px backdrop blur (it scrolls over the moving sky) and gained `contain: paint`;
  `.pn-qw` has `will-change` only while dragging; the Layer C progress bar fills by `scaleX`; `.pl-num` is solid white (no
  gradient text). Art: 4 calls, $0.27 (job imagen/log.tsv).
- A11y: chips, tabs and small buttons are 44 px tall; the custom-module rows reflow at 130% zoom.
- Headless: run-prep-ui.mjs checks the push and back slides, the tab cross-fade, Escape without animation, the reduced
  motion fade, the skeleton and the search prompt.

## Premium UI round 5 (2026-10-08, same branch, `?v=prep18`)
- Sheets (prep.js `bindSheetDrag`): every `.pn-sheet-wrap > .pn-sheet` follows a touch or pen drag down 1:1 (rubber band
  up), the scrim dims with it; release past 30% of the height (max 160 px) or faster than 0.5 px/ms (measured over the
  last 100 ms of movement, else the whole drag) slides it out from the finger and taps the sheet's own `.pn-scrim`, so
  each module closes it its own way; anything less springs back (`PREP_MOTION.settle`). A sheet scrolled into its
  content scrolls first unless the drag starts on `.pn-grab`; form fields never drag; a non-passive `touchmove` stops
  the top-of-sheet overscroll from stealing the gesture; the trusted click that ends a drag is swallowed (350 ms).
  Actions are a row (primary right); scrolling sheets keep them sticky at the bottom.
- Settings sheet (prep-plan.js `drawSettings`): header with `plan.webp` and the plan in one line, sections
  `.pl-grp.pl-g-<k>` with hued icon tiles (`.pl-sic`), exam and minutes as grouped rows (hairlines, check on the chosen,
  minutes detail only on the chosen row), date, time, reminder and sync (`prep-native.js syncHtml`) as cells.
- Readiness sheet (`whySheet`): `ready.webp` band with the score (`.pl-rnum`, the h2 text stays "X readiness: N"),
  three rings coverage x retention x accuracy (`.pl-meters .pl-m`, drawn by CSS `pn-draw`, staggered), the three
  factor rows with meters filling by scaleX (`.pl-fbar`, colour per factor), a level card (`.pl-rlv`, level.webp), the
  weakest subjects with subject icon tiles, a score pill and one action each.
- Limit sheet (prep-pro.js): `limit.webp`, used/limit meter, three icon rows.
- Teacher (prep-teacher.js `explain`, `explainStep`): a chat. `.pt-ctx` pins the stem (3-line clamp) with "You chose X"
  and "Answer Y" pills; the ask is the student's bubble; MaiK (`maik.webp` avatar) types (`.pt-dots`) while the phone
  works, then the checked reply (`.pt-ans-b`, "MaiK explains" sender line) with the check note under it; chips "Back to
  the question" and, after a good reply, "Show the stored explanation" (a native `details`). Nothing is streamed.
- List screens: `hband(art, figure, label, line)` in prep.js (`HOST.hband`) is a painted band with one big figure:
  bookmarks, mistakes (most common reason), custom module (live count), downloads (n of m offline), question grid
  (answered, marked), Your decks (prep-create.js, after the list loads), Friends (prep-social.js). The figure rolls up
  (prep-motion.js `rollNum`, WAAPI-clocked). Rows of `.pn-mods`, `.pc-decks`, `.ps-list` stagger in (35 ms) only on the
  first paint after a push (or a list arriving within 1.5 s of it), and the readiness rows when that sheet opens.
  The module hero carries the subject's icon tile above its figure (`.pn-modi`; a large glyph watermark was tried and
  dropped: the anatomy figure read as a stick man over the text); the PYQ paper panel the papers art;
  the accuracy hero the balance art; search hits a hued icon tile; mistakes and decks empty states have art.
- Owner rule: the student no longer sees "Cost so far: Rs ... (N tokens)" on the Layer C progress or saved screens
  (`costLine` stays for internal accounting and its tests). Every loading or busy label ends with the single
  character ellipsis.
- Art: 11 calls, $0.74 (job imagen/log.tsv): `accuracy custom decks friends grid limit maik mistakes empty-mt plan ready`.
- Headless: run-prep-plan-ui.mjs checks the readiness rings and bars against the factors and drag-to-dismiss (a 50 px
  pull springs back, a flick dismisses); run-prep-ui.mjs checks the teacher chat (stubbed native runtime).
- Screenshots in dark need the OS in dark mode or Chrome started with `--force-dark-mode` (the app follows
  prefers-color-scheme at boot).

## Premium UI round 6 (2026-10-08, same branch, `?v=prep19`)
- Plan sheet pickers (prep-plan.js `fieldsHtml`): in the settings sheet the exam and minutes are segmented controls
  (`.pl-seg`, radios with roving tabindex and arrow keys) with the choice's line under them; onboarding keeps the rows.
  The exam date is a calendar (`calHtml`, Monday first, past days disabled, today dotted, arrow keys by day or week,
  Page Up/Down by month, `P.cal` is the shown month); in settings it sits under a cell with the date and the count
  (`p-f-calopen`, `P.calOpen`). The reminder is two spin wheels (`spin`, role spinbutton, Up/Down keys; hours 1, minutes
  5, `timeStep`). The native `#plDate` / `#plRem` stay inside "Type a date" / "Type a time" details (exact entry; the
  headless tests drive them). A picker redraw puts the focus back on the same control (`refocus`). Stored data unchanged.
- Art (5 calls, $0.34): `subject` (subject hero, tinted to the subject's hue by a luminosity blend), `module` (module
  head band), `offline` (downloads band), `bookmarks` (bookmarks band). `empty-dl.webp` and `empty-nb.webp` deleted
  (nothing used them). `banner-dark|light.webp` had "AI-powered medical prep" painted under the wordmark: painted
  out (owner rule); the unused `banner.webp` (same tagline) deleted; the 4K/PNG masters were painted out in round 7.
  The Arena consent sheet uses `arena.webp` as its head and two icon rows (never shown; leave any time).
- Screens: the subject hero carries a module map (`.pn-subbar`: completed, in progress, not started, with a key); the
  module panel head is a band over the art; downloads show the date and a progress bar while downloading; bookmark rows
  a count and the last saved date; search hits mark the matched words (`hl`, on escaped text, never inside an entity);
  PYQ paper subjects get icon tiles and share bars; friends keep one hue each (`hueOf`), a challenge's time left is an
  amber chip; decks lead with a hued tile. The list skeleton opens with a band shape.
- Motion: `.pn-fills` (prep-motion.js) fills meters from empty only on the first paint after a push (subject map,
  paper subjects, accuracy bars).
- System: tokens on `.pn-root`: radius `--pn-r-xs|sm|md|lg|xl|pill` (4/10/14/20/26/999; square tiles, avatars and art
  keep proportional radii), motion `--pn-d-press|quick|base|enter|draw` (140/180/240/280/700), `--pn-sh-hero`. Every
  literal radius and duration in the six prep stylesheets maps onto them (`tmp/r6/radius.py`, `motion.py` in the job).
  `.pl-sic` is the `.pn-ic.xs` tile. Dead CSS removed: unused classes (`deadcss.py`) and declarations overridden by a
  later rule with the same selector (`dedupe.py`).

## Premium UI round 7 (2026-10-08, same branch, `?v=prep20`)
- Runner (prep.js `renderRun`): once answered, options that are neither the key nor the pick dim (CSS on
  `[aria-disabled=true]:not(.right):not(.wrong)`); a timed test's pick carries `.pn-mark.pn-pick` (check). Feedback order:
  `.pn-verdict` (Correct / Incorrect with "You chose X"), `.pn-ans` (the right answer on its own line), then "Why X is
  right" + `.pn-exp` when the item has per-option reasons `r` (PYQ and Layer C deck items; `exp` first, else `r[a]`) or
  "Explanation" otherwise, then "Why the others are wrong" `.pn-why` (one row per other option with a reason, the
  student's pick first, `li.mine`), pearl, outdated note, teacher, and the miss tags under a hairline. The study Next row
  is sticky at the bottom of `.pn-run` (buttons inside the feedback have `scroll-margin-bottom` to clear it).
- Motion: a pointer-tapped Next/Previous (`click` with `detail` > 0) sets `st.swipeIn` so the question slides in like a
  swipe; keys and synthetic clicks stay still. `finish()` marks `nav(1)` (not for key finishes).
- Result: `recapHtml` draws `.pn-recap` under the score (one mark a question up to 30: ok, no, skip).
- Banners: every master (`prep/art/banner-4k|dark-4k|light-4k|16x9-4k` png+webp, `banner.png`, repo-root
  `prepnucleus-banner.png|.webp`, `prepnucleus-banner-dark|light.webp`) had the tagline painted out (job `tmp/r7/paintout.py`,
  vertical blend of the rows above and below). No asset carries "AI-powered" now. $0 image spend.
- Headless: run-prep-ui.mjs checks the answer line, the dimmed options, the sticky row, the tapped-Next slide, the timed
  pick check and the result recap; run-prep-pyq-ui.mjs checks the right / others headings and the three reasons.

## Structured explanations (2026-10-08, branch `feat/prep-explain`, `?v=prep22`, bank v5)
- Owner (iPad, 2026-10-08): "How is explanation missing ... more details related to topic ... in easy readable way"
  (Marrow screenshots). Bank v1: 24,497 items with empty `exp`, 29,436 under 200 chars.
- Data: an item may carry `x = { key, notes, others: { letter: reason }, pearl }`; `exp` is never touched; `r` is
  filled from x when the item has none (`r[a] = key`). Written by `tools/prep-explain.mjs` (Batch, resumable,
  `--dry-run` per scope, `--pilot n`, `--apply --run <id> --to <dir>`). Work files and results live in the gitignored
  `prep/explain/<run>/` (prompts carry source-pack text, StatPearls included).
- Grounding: the item's exp + BM25 passages of its module pack (`prep/fill/packs`, `~/prep-data/packs-statpearls`) and
  of the KB (`kb/`, boilerplate index lines dropped; a KB passage must share a stem word and, unless the stem asks for
  the exception, a key word). Most MBBS modules have no pack, so the KB and exp carry most items.
- Gates (code): g1 fields, `key` (key line names the stored answer: squashed text, or 60% of words with prefix and
  2-letter slip tolerance, or the declared letter `ka` when the option has no nameable words), `align` (a reason under
  the wrong letter), g9b numbers grounded, verbatim 12 words, `markup` (subset only, tables well formed), `source`,
  `ai`, `dash`, `long`. Review: `buildReviewPrompt` + notes + gate `nt`; pass needs g7 g8 g9 g10 nt (g4 g6 g11 judge
  the question's writing, recorded as `rv.qf`). One retry with the reason; still failing -> `pending`, old exp stays.
- Pilot 1 lesson: asking for wrong-option reasons only (key = "") made the model pack reasons into A to C and leave D
  empty, i.e. reasons under the wrong letter. Now every option gets a reason in order (ra..rd) and `align` checks it.
- Client (prep.js pure part, unit-tested): `mdLite` (escape first, then `##`, `**`, `-`/`*` bullets, `1.` steps, pipe
  tables in a focusable `.pn-xt` region that scrolls inside the card with the first column pinned), `legacyExp` (old
  "*a *b" bullets -> list), `explainOf`. Runner and review screens: key line `.pn-xkey`, `.pn-xnotes`, why the others
  are wrong (from r or x), `.pn-kp` "Remember". Headless: `test/run-prep-explain-ui.mjs` (synthetic fixture
  `test/fixtures/prep-explain/items.json`, or `ITEMS=<pilot applied.json>` for real screenshots).
- Grounding rule (owner, 2026-10-08): a pack or KB passage is sent only when on topic (a strong stem word plus a strong
  key word; any option's word for "All of the above" or an EXCEPT stem; two stem words when no option has a word), else
  none and the model works from the item's exp and the stem. Names with digits (CD20, CD 20, IL-2, I-131, 50S) are
  exempt from the number gate. These cleared the 3 pilot pendings: pilot 60/60.
- Scope (b) run (owner approved: empty + short exp, 46,173 items after the pilot): `--scope short --run scope-b
  --skip-runs pilot,pilot-fix --parts 10 --conc 5 --max-usd 32` (a job that would pass the cap is never submitted).
- Bank v5 = v4 + x/r: `node tools/prep-explain.mjs --apply --runs pilot,pilot-fix,pilot-fix2,scope-b --bank <v4>
  --pyq <prep/pyq/out> --to <v5>` (refuses an existing folder). PYQ items matching a bank item with x (same key,
  options one to one) and a thinner explanation take the bank's x; the PYQ files go to v5/pyq/ and the client reads
  PYQ from `SMD_PREP_PYQ_VER` (default v5). A later PYQ build must be written under the version the client reads.
- Images in explanations: an item may carry `img` (webp names) and `imgPlace` "stem" | "exp"; bank item images are
  served at `/api/prep/bank/<VER>/img/<file>.webp` (route `IMG_RE`); `PREP_PYQ.figure(it, host, where)` draws both.

## Practice setup and image questions (2026-10-08, branch `feat/prep-practice-setup`, `?v=prep23`)
- `prep-setup.js` (`window.PREP_SETUP`, optional in the loader, after `prep-pyq.js`) + `prep-setup.css`. A sheet before a
  set from a module (Practice and Timed test; "Review N due" stays direct), a subject (new "Practise <subject>" under the
  hero), the custom module (its difficulty, count and mode panels moved into the sheet), My mistakes (no repeat row),
  bookmarks, a PYQ paper ("Choose questions", and each "By subject" row), a module's PYQs, and a Layer C deck.
  `prep.js` forwards `su-*` acts and asks `PREP_SETUP.back()` first. `window.SMD_PREP_SETUP = false` skips the sheet
  (older headless suites set it).
- Rows (each chip shows the pool it leaves, live): type All / Image-based / Clinical scenario / One-liner / Mix; count
  10/20/30/50 or a stepper, capped by the pool; New / Incorrect before / Bookmarked / Due for review / All / Mix;
  difficulty Easy/Moderate/Hard/Mix (`d` 1/2/3); mode Practice / Timed test; timer Off / Per question (30, 45, 60, 90 s,
  stepper) / Whole set (exam pace 1 min a question, or minutes). A timed test has no Off. Per question: a timed test
  moves on when time is up (unanswered), practice shows the ring only (`runQuestions` opts `qsec`, `limit`, `untimed`;
  `qtick` in prep.js).
- Image-based = `img` with `imgPlace` "stem", or a PYQ item with `img`. Clinical vs one-liner: `stemScore` (age +2, a
  person +1, strong vignette cue +2/+3, weak cue +1, vitals +1, 35+ words +2 / 22+ +1; 3 or more = scenario; a USMLE
  `ex` tag always a scenario), cached on the item as `_k`. Incorrect before = in `mt`, a lapse, or the card's
  `due - last == 1` (a miss is rescheduled for the next day).
- Draw: `customDraw` (prep.js) is the only picker; a Mix splits the count first (type thirds; repeat 50% new, 30% due,
  20% incorrect, short groups refilled; difficulty in proportion to the pool). Empty pool: `relaxHint` names the row.
- Remembered per scope in localStorage `smd_prep_setup` (`kind:id`, then `kind`, 40 kept). "Start with last settings"
  (`su-last`, `PREP_SETUP.quick`) starts a module, subject, bookmarks or mistakes set in one tap; decks and PYQ open the
  sheet already set to the last choice.
- Subject pool: every module when the subject is downloaded, else modules with progress first, 16 files at most.
- Layer C images: after a PDF's text is read, `PREP_SRC.extractImages` reads each page's operator list (`imageBoxes`:
  CTM through save/restore/transform/form XObjects), `pickImages` keeps images of 200 x 200 px or more, at least 12% of
  the page each way, no more than 4:1, not repeated on 2 pages (id or place), top to bottom, 20 at most; each is
  rendered from its page area at its own size (1280 px at most), WebP else JPEG. The "Images in your PDF" screen
  (`#pcImgView`) is a strip of toggles. After the text round, one `imcq` op per kept image with `nearSents` (caption
  first, page text, neighbours when thin, 12 sentences, 1,500 chars). Server (`_prep-generate.js`, `_prep-core.js`
  `buildImageMcqPrompt`): the image is an `inline_data` part of the same Vertex call; gates: `sure`, cited `sn` among
  those sent, code gates on the cited text, `gateImgSupport` (60% of the key's words in it), `imageStemOk`; else
  `skipped`. Same caps, metering and deck-not-started rule as the other ops; image base64 at most 360,000 chars (the
  phone re-encodes smaller). Kept images live in IndexedDB `prep-gen` store `prep-imgs` (db version 2), only for
  images that got a question; items carry `imgId`, `attachImages` puts the data URL in `img` at practice time and
  `PREP_PYQ.figure` shows `data:` URLs as they are.
- Gotcha: `emoji-icons.js` rewrites any on-screen "Page 3" text as a textbook citation line; the image strip shows the
  page number by a glyph instead.
- Tests: `test/prep-setup.test.mjs` (classifier, filters, draw, timer, synthetic 2-image PDF through vendored pdf.js,
  deck image step), `test/prep-imcq.test.mjs` (request shape, gates), headless `test/run-prep-setup-ui.mjs`. Out of
  scope: CT or MRI cine and video.

## Radiology notes, set "radnotes" (2026-10-09, branch `feat/prep-radnotes-app`, `?v=prep25`)
- Source: the owner's two radiology notes books (owner 2026-10-08: his own work, he holds the rights and authorises use;
  third-party logos, exam-question screenshots, watermarks and citations are kept and listed for him, his call).
  Built by `tools/prep-radnotes.mjs` (+ `tools/prep-radnotes-extract.py`, `test/prep-radnotes.test.mjs`). The PDFs, their
  text and figures never enter git; work and outputs live in `~/prep-data/radnotes` (manifest with SHA-256:
  `out/manifest.json`).
- R2 (`stewardmd-offline/prep-bank/`): 50 lessons `v1/lessons/radnotes-<sid>.json`, the lessons index `v1/lessons/index.json`
  (1,132 entries: the 1,082 generated + 50 radnotes; a radnotes entry carries `module` and `set: "radnotes"`), 54 figures
  `img/radnotes/rn-<figid>.webp`, 12 MCQ overlays `overlay/radnotes/radiology/<module>.json` ({topic, set, v, items}; 256
  items, 27 with a figure).
- Route: `RADNOTES_RE` in `functions/api/prep/bank/[[path]].js` serves `img/radnotes/rn-<id>.webp` and
  `overlay/radnotes/<subject>/<module>.json`, immutable.
- Lessons: an index key is no longer always a module id. `lessonsFor(ix, mid)` lists the module's own lesson (key = mid)
  first, then entries whose `module` is mid; one row reads "Lesson", several read by title (3, then "Show all N lessons",
  `l-more`). Rows carry `data-l` (key); `open(sid, mid, h, key)`; progress `store.ls` is per key. Image steps
  (`api/prep/bank/...`) resolve through the bank API base (`imgUrl`; tests point it at fixtures) and get
  `SMD_API_BASE` (https://stewardmd.in) on native. Plan (`prep-plan.js`): lesson list entries carry `k` (key), the plan
  item carries `l` when the key is not the module.
- MCQs: `loadModule` = bank file + overlay items (`OVERLAYS`, default `{ radiology: ["radnotes"] }`, `mergeOverlay`: bank
  first, then overlay items by new id; items untouched). Overlay files are cached in IndexedDB like module files; a 404
  adds nothing; an offline miss is asked again later. Overlay items carry `_ov` (set); `PREP_PYQ.figure` draws them from
  `img/<set>/` (prefixed with `SMD_API_BASE` on native, which also fixes PYQ and bank item figures on native). Lesson quick
  questions, practice, setup, bookmarks and mistakes all see overlay items through `loadModule`.
- Module MCQ counts on screens still come from the bank index (overlay items are not counted).
- Tests: `test/prep-server.test.mjs` (route), `test/prep-lessons.test.mjs` / `test/prep-app.test.mjs` / `test/prep-plan.test.mjs`
  (lessonsFor, imgUrl, mergeOverlay, plan by key), headless `test/run-prep-radnotes-ui.mjs` (synthetic fixture
  `test/fixtures/prep-radnotes/api/`, no content from the notes).

## Ask MaiK everywhere, MaiK lines, balloons, iPad (2026-10-09, branch `feat/prep-ipad-maik`, `?v=prep27`)
Plan: `vault/plans/PrepNucleus-iPad-Confetti-MaikLines.md` (on branch `feat/prep-ipad-plan`), owner decisions 2026-10-09.
- **Ask MaiK** (`prep-ask.js`, `window.PREP_ASK`, data-act `ak-`, CSS `prep-ask.css`): one sheet, on every MCQ answer
  (right or wrong), review, lesson step and flashcard back, web included. First use asks "On this phone" or "Online" with
  "Don't ask again"; store key `ask` `{ m: "local" | "online", q: 1 }` (synced register); Your plan settings has an "Ask
  MaiK" row (each time / on this phone / online). A web browser, an incapable phone and an unknown phone are told at once
  and offered Online. Both paths run `prep-teacher.js` `teach()` / `teachStep()` (same grounding, prompt and check). With
  the MaiK engine on Local, an online ask asks first; the engine setting is never changed. iPad landscape (>= 900 px) runner
  and review: a 420 px right side panel (`pa-side`); >= 700 px a centred panel; phones a bottom sheet.
- **Online route** `POST /api/ai/prep-teach` (`functions/api/ai/_prep-teach.js`): sign-in (401), `checkQuota` type
  "prep" (breaker, rate), `gateAndCount("prep_tutor")` = the existing MaiK Token rules (free daily MT allowance, then the
  prepaid balance, only while `AI_COST_CAP_ON` = 1; `prep_tutor` daily count 0 = unlimited by owner decision), one
  Gemini call (`PREP_TEACH_MODEL`, default `MODEL_HARD_DEFAULT`), one usage record `prep:teach`. 429 `ai-cost-cap` opens
  the app's "MaiK Tokens are used up" sheet (pro-paywall.js). Response carries `usage.mt` and `wallet`; the sheet shows
  "Used about N MaiK Tokens" (and the balance when the cap is on). About 70 MT a typical ask, under 200 worst case.
- **Device check** (`deviceVerdict`): today the llama plugin's total memory (7 GB or more = capable; iOS and Android) and
  the Android version from the user agent (12+); with the next store build `@capacitor/device` 8.0.3 (package.json) adds
  the model identifier, matched against `prep/device-capability.json` (52 Apple rows, ids UNVERIFIED, conservative), else
  the rule "iPhone major id >= 16". Feature-checked: without the native plugin the memory rule decides.
- **MaiK lines** `prep/maik-lines.json` (108 approved lines, 3 per subject + 3 per branch): one per app session after a
  set of 5+ answered (`st.mlShown` + sessionStorage) and on the lesson finish card, never in mocks or battles; rotation
  `store.ml[subject]` (synced). `pickLine` / `setSubject` in prep.js PURE.
- **Balloons** (`prep-motion.js` `balloons()`, WAAPI, transform and opacity): milestones only (level-up, new rank +2,
  streak 7/30/100/every 100 from 200, question milestones, first mock, first finished day plan), at most one a day except a
  level-up; `store.cel { day, keys }` (synced) so none fires twice. 7 balloons, 9 on cards wider than 600 px; none under
  reduced motion (the chip says it). Confetti stays for wins, sets at 70%+ and only the first lesson of the day (`data-cf`).
- Retired: the "AI-generated educational content" deck label (prep-decks.js) and the old supported-phones text
  (maik-models.js DEVICE_SUPPORTED now states the owner's cut-off, no "AI").
- Tests: `test/prep-ask.test.mjs`, `test/prep-teach-server.test.mjs`, headless `test/run-prep-ask-ui.mjs` and
  `test/run-prep-ipad.mjs`.

## Store
localStorage `smd_prep_v1`: `{v, cards, conf, days, mod:{t,ok,last}, bm, rep, exam, last, dl, hid, mt, goal, mh, ls, lsp, pl, pt, ra, fc, ask, cel, ml}` (`ask`/`cel`/`ml`: Ask MaiK choice, celebrated milestones, MaiK line rotation) (`ls`/`lsp`: Lessons;
`pl`/`pt`/`ra`: Plan; `fc`: Cards). FSRS deck key
`p:<module>` (module cards `p:<module>:c`, Layer C decks `p:deck-<id>`). `hid` is the auto-hidden list, refreshed at most every 6 hours.
Today's plan counts questions only: its "due reviews" and "new questions" skip card keys `p:<module>:c:<cardId>`
(`isQ` in `prep-plan.js`); cards due show on the home "Cards due" row, not as a plan item (yet). Readiness retention
still reads cards and questions together (`recall()` over `p:<module>`).

## Tests
`test/prep-app.test.mjs`, `test/prep-build-bank.test.mjs`, `test/prep-server.test.mjs`, `test/prep-core.test.mjs`,
`test/prep-generate.test.mjs`, `test/prep-layerc-e2e.test.mjs`, `test/prep-create.test.mjs`, `test/prep-teacher.test.mjs`,
`test/prep-tools.test.mjs`, `test/prep-explain.test.mjs`, headless `test/run-prep-explain-ui.mjs`, `test/prep-lessons.test.mjs`, `test/prep-plan.test.mjs`, headless `test/run-prep-plan-ui.mjs`, `test/prep-flash.test.mjs`, headless `test/run-prep-flash-ui.mjs`, `test/edge-start-mcq.test.mjs`, headless `test/run-prep-lessons-ui.mjs`, headless `test/run-prep-create-ui.mjs`, `test/run-prep-arena-ui.mjs`, `test/prep-nudges.test.mjs`, headless `test/run-prep-nudges.mjs` and `test/run-prep-ui.mjs` (real app + fixture bank in `test/fixtures/prep/`;
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

## Radiology NEET-SS pilot (2026-10-08, branch `feat/prep-radiology-ss`)
Plan and results: [[plans/PrepNucleus-RadiologySS]]. Subject `ss-radiology` (code `srd`, 12 sections, 19 modules) in the
NEET-SS tab (branch `ss-medicine`, behind `smd_prep`). New taxonomy field `bank` (app `bv`): this subject reads
`prep/bank/v6/ss-radiology/index.json` and `/api/prep/bank/v6/ss-radiology/...` while every other subject stays on the
global version (`prep.js` `bvOf`). 29 questions in R2 `prep-bank/v6/ss-radiology/` (26 image items, 3 scroll stacks).
- **Client:** `prep-rad.js` (`window.PREP_RAD`, optional in `prep-loader.js`, data-act `rd-`): scroll-stack viewer for
  `stack: { id, n, base, w, wl, ar, lbl }` (slices `<base><window>/<NNN>.webp`), drag, wheel, keys, scrubber, window
  switch, enlarge with pinch zoom, preload outward, cine only on request. Item images with a "/" in the name are bank
  paths (`prep-pyq.js` `imgUrl`).
- **Route:** `functions/api/prep/bank/[[path]].js` `RAD_RE` (img and stack files, immutable).
- **Tools (dev only):** `tools/prep-rad.mjs` (Open-i search, Europe PMC licence check and case text, fetch, Batch gen +
  review, Haiku vote inputs, finalize with credits), `tools/prep-rad-stack.py` (TCIA CC BY series to windowed WebP
  stacks), metadata in `tools/prep-rad/` (targets, stacks with licences and DOIs, verifier votes). Data outside git in
  `~/prep-data/rad/`. Credits in terms.html section 31 only.
- **Tests:** `test/prep-rad.test.mjs`, `test/prep-rad-viewer.test.mjs`, `test/run-prep-rad-ui.mjs` (fixture
  `test/fixtures/prep-rad/`; `REAL=~/prep-data/rad/out` runs on the real pilot output; `SHOTS`, `PN_LIGHT`).
- **Gotchas:** Arena's `NEET_SS_SUBJECTS` does not include `ss-radiology`. Files under v6 are add-only like any bank
  version; a changed module file needs a new name or version once the subject is live.

## Subject screen, Learn, exam once (2026-10-09, prep33)
- **Exam asked once.** Onboarding's exam step has no Skip; the choice lives in `pl.exam` (synced) with `exam` as the tab.
  Home has no exam tabs any more (they stay only if prep-plan.js is missing); it shows a Settings row ("Exam: X ·
  plan and reminder", `data-act=p-settings`) that opens the Your plan sheet, the only place to change it. Exams: NEET-PG,
  INI-CET, NEET-SS, INI-SS (tab neet-ss, no own mock pattern), USMLE, FMGE. Tests switch with `PREP._host.setExam(id)`.
- **Subject actions** are one block `.pn-subacts` (a direct child of `#pnSub`, so the column's width and auto margins):
  Practise, Learn, Start with last settings. The old `.pn-subgo { margin: 4px 0 2px }` overrode the auto margins and
  left-aligned the button in a column wider than the content (owner iPad screenshot 2026-10-09).
- **Learn.** `PREP_LESSONS.subjectButton` adds Learn when a module of the subject has a lesson (`subjectLessons`);
  `l-subject` opens the subject's lessons grouped by module. The module screen's slot is headed "Learn".
- **Overlay counts.** `prep/bank/overlay-counts.json` (tools/prep-overlay-counts.mjs, rerun after an overlay upload) gives
  `t.ov`; `countFor` = bank count + overlay items, so Radiology and Medicine counts match what practice draws.
- **ss-radiology v8 counts are real:** radmax items went mostly to cardiac, abdomen, MSK and anatomy; neuro, head and neck,
  chest, breast, IR, nuclear and physics hold 2 to 10 items each (targets 40 to 80). Content gap, not a cache bug.
- Test: `test/run-prep-subject-ui.mjs` (390, 820, 1180; alignment within 1 px, Learn, exam once), `test/prep-subject.test.mjs`.

## Strict per-question clock, review filters, saved practice sets (2026-10-09, branch `fix/prep-q-timer`, prep36)
- Owner bug: with 30 s a question, going to the next question and back restarted the clock at 30 s. Now (prep.js
  `qcNew`/`qcShow`/`qcPause`/`qcLeft`/`qcTick`/`qcNext`, `r.qc` on the run) each question has one budget, spent only while
  it is on screen (the question grid, a screen pushed over the runner and an answered practice question stop it), never
  reset. Counting is by timestamps, so background time counts on return (`visibilitychange` runs a tick at once). At 0 the
  question locks for the rest of the set (practice and timed test alike): options disabled, "Time up" note, grid cell
  dashed + "time up" label, a practice question is recorded unanswered (-1, like a timed test at the end), and the set
  moves to the next open question (else the first open earlier one, else it finishes). Whole-set timers unchanged.
- Result review: filters All / Wrong / Correct / Skipped (or Time up) / Bookmarked with counts, Wrong by default when any
  (`reviewSplit`, `reviewDefault`); "Practise the missed (n)" and "Practise all again (n)".
- Saved practice sets: every set started from the practice setup sheet (module, subject, custom, mistakes, bookmarks) or
  the old custom module screen is saved on finish in `s.ps` (synced map in prep-sync MAPS) as ids + answers only
  (`psPack`; PYQ and own-deck items are left out because they cannot be reloaded by module), at most 20 sets / 200
  items, expiring 7 days after creation (`psPurge` on load). Home lists "Your practice sets" (`psopen`): reopens on the
  result (`psUnpack` from the module files); "Practise all again" updates the same set and keeps its expiry.
- Tests: `test/prep-qclock.test.mjs`, `test/prep-review.test.mjs`, `test/run-prep-setup-ui.mjs` (fake Date.now clock:
  no reset on revisit, grid pause, lock + auto-advance, locked revisit, background catch-up; review filters, saved set
  reopen, re-practise, expiry purge).
## Radiology lessons from the owner's four PDFs, set "radbook" (2026-10-09, branch `feat/prep-radlessons`, prep35)
- Owner: "Learn lessons don't have X-rays; make the whole notebook into chapter-wise lessons with images." Built by
  `tools/prep-radbook.mjs` (+ `tools/prep-radbook-blur.py`, `test/prep-radbook.test.mjs`). Private data and every
  output live in `~/prep-data/radnotes/book` (backup `gs://<prep-batch bucket>/private/radlessons/`); no PDF text in git.
- Spine: the long-case book (RDN11, printed, data tables and figures); the two notes books and the anatomy true/false
  book are merged into the same system order (`CHAPTERS`). NEET-SS passes over the notes chapters cover the srd-*
  modules the long-case excerpt does not reach (brain, head and neck, chest, kidney, breast).
- Pipeline: F1 figure check (Gemini, image attached: kind, clear, what it shows, identifiers, third-party marks) ->
  O1 outline per chapter window (topics as page ranges + module + figure ids) -> L1-L4 (gen with figures, code gates,
  blind self-check, one redo, re-check) -> Q1 quiz pick (up to 3 live item ids of the lesson's module; radmax items
  excluded since the set moved to radmax2) -> two Haiku votes per figure use (doubt drops the figure, not the step) ->
  identifier blur (hand boxes, checked by eye before/after) -> assemble -> upload.
- R2: lessons `v1/lessons/radbook-<order><seq>-<slug>.json` (the key order keeps chapter order inside a module),
  figures `v1/lessons/media/rb-<figid>.webp` (existing STUDY_RE route, no route change), index `v1/lessons/index.json`
  rebuilt from the live copy: the 50 `set: "radnotes"` entries are superseded (their files stay in R2), radbook
  entries carry `module` and `set: "radbook"`.
- Client: `prep-lessons.js` `warm()` fetches every figure of a lesson when it opens (lessons opened once keep their
  X-rays offline through the one-year immutable cache); `lessonImages()` pure helper.
- Not covered (no source pages): rad-radiation-protection, rad-interventional, rad-nm-scans, rad-nm-principles and the
  radiotherapy modules (teletherapy, brachytherapy, toxicity, clinical-rt); srd-physics keeps its own lesson.

## Create deck overhaul: 50 a deck, page picker, decks that last (2026-10-09, branch `feat/prep-create-v2`, prep37)
Owner request 2026-10-09 (with his answers). Layer C contract otherwise as [[plans/PrepNucleus-LayerC]].
- **Caps:** 5 new decks a day, 30 a month (server `prepCaps`: `PREP_DECKS_PER_DAY` 5, `PREP_DECKS_PER_MONTH` 30; client
  `DAY_CAP`/`MONTH_CAP`, every message and the settings line). Month 30 is the lead's default, the owner may change it
  (env vars, no code change). Calls a day `AI_MODULES.prep.daily` 95 -> 300 (= `MAIK_DEVICE_DAILY_CAP`). Per-deck token
  cap 200k -> 600k (`PREP_DECK_TOKEN_CAP`). New server guard: 60 accepted questions a deck (`PREP_DECK_Q_CAP`, review
  passes plus image questions, KV deck record `q`) -> 429 `deck-full` on mcq/imcq.
- **50 a deck, 10 at a time:** `roundTarget(count)` = min(10, 50 - count). A round now asks for as many facts as it
  still wants (10, not 14), split into batches of at most 7 under the same ceiling `ceil(target x 1.4 / 7)`; failed facts
  get their one regeneration. So a round makes at most its 10 and a deck never passes 50. With images waiting, up to 5 of
  the 10 are image questions (`IMG_PER_ROUND`); the other chosen images wait in `prep-imgs` with `pend: 1` and
  `m.imgPend` for the next round.
- **Deck screen (a module):** Your decks rows open `renderDeck`: questions "N of 50", answered, accuracy (`store.mod
  ["deck-<id>"]`), due; rows Questions (setup sheet, timer, review, Ask MaiK through the shared runner), Timed test,
  Flashcards; "Make 10 more" with "N of 50" and the MaiK Token estimate; Continue when a round was cut off; Delete.
- **Create steps:** Source (paste or PDF) -> Pages (PDF only) -> Settings (exam NEET-PG / INI-CET / NEET-SS / USMLE,
  FMGE decks use the NEET-PG profile; difficulty Exam mix / Easy / Moderate / Hard sent as `mix.dl`; name; own-material
  check; MaiK Token line; caps line) -> scrub check -> progress. Progress shows the real count "N of 10 questions ready"
  and a live stage list (no percentage).
- **Page picker:** after a PDF opens. A PDF of 60 pages or fewer starts with every page picked, a longer one with none
  (never a silent "first 60"). Virtual grid (`gridWindow`: only rows in view plus 2 either side; ResizeObserver relays
  out on rotation or the app's text zoom), thumbnails rendered one at a time on demand (`renderThumb`, at most 240 kept),
  tap to pick, "Select a range" (first tap, last tap), typed ranges ("120-160, 175"), Clear, "N of 60 selected", and a
  refusal in words for anything past 60 (`selToggle`/`selRange`/`selFromSpec` refuse the whole change). Cell labels
  read "Page 3 of 500" (emoji-icons strips a bare "Page 3").
- **MaiK Tokens:** `usage.mt` (inrToMt of the call) and `wallet { balanceMt, costCapOn }` on every prep-generate reply,
  like Ask MaiK; module stays `prep` in `gateAndCount` (feature `prep:<op>`), so with `AI_COST_CAP_ON` a spent allowance
  is 429 `ai-cost-cap` (was mislabelled daily-calls). Owner: the cap stays OFF until 2026-11-01, so MT is recorded and
  shown, never blocking. The estimate before "Make 10" is the deck's own average per round (`m.cost.mt / m.rounds`),
  else 4,500 MT; the result says what the round used.
- **Resumable:** the running round lives in the manifest (`m.run`, saved after every step); a round cut off (offline,
  timeout, app closed) shows Continue and resumes at the op that failed (same idem, so a lost answer is a free replay).
  Coming back to the foreground resumes offline/timeout stops by itself.
- **Why decks were erased (root cause) and the fix:** `prep-decks.js` header. (1) A failed IndexedDB open (iOS WebKit
  drops its storage process in the background; the next open can fail once) switched the file to an in-memory store
  for the session, silently: the list came up empty and decks made then were lost on close. Now a failed open retries
  once, a dropped connection (onclose, InvalidStateError) reopens, memory is used only where IndexedDB does not exist
  (`durable()` false, said on screen). (2) Storage was best effort: `navigator.storage.persist()` is asked now. (3) A
  reinstall or new phone starts empty and nothing was kept elsewhere: every deck is mirrored to the app's files on native
  (`@capacitor/filesystem`, already in package.json, Directory DATA, `prep-decks/<id>.json`, whole deck with images and
  source) and backed up encrypted to the account (`/api/prep/decks`, D1 `prep_decks` + `prep_deck_keys`, migration
  `prep-arena-worker/migrations/0004_prep_decks.sql`; AES-GCM under HKDF(uid, per-user salt, "prepnucleus-decks-v1");
  payload = manifest, questions, cards and unused facts with only their cited sentences; no file, no images, no other
  page text; title scrubbed; 512 KB a deck, 120 decks). `restore()` on Your decks brings back missing decks: files first,
  then the account; deleted ids are remembered (`smd_prep_deck_del`) and deleted on the server too. A restored deck has
  no source on the phone (`noSrc`): its unused facts send `quote` instead of `sents`; image questions without their
  picture are left out of practice. Not causes (checked): OTA (capacitor-updater keeps the origin), sign-out (no wipe
  listener for prep).
- **Tests:** `test/prep-create-rounds.test.mjs` (caps agree, 10 at a time to 50, images per round, resume, MT, page
  cap, virtual grid), `test/prep-decks.test.mjs` (route on node:sqlite, payload, storage in a vm window with
  `test/fake-idb.mjs`: retry, reopen, mirror, backup, new-phone restore, evicted-store restore, delete),
  `test/prep-generate.test.mjs` (5/30, 300 calls, deck-full, MT, ai-cost-cap), headless `test/run-prep-create-ui.mjs`
  (steps, 500-page picker, cap, 10 at a time to 50, deck screen, restore after IndexedDB is cleared; SHOTS at 390, 820,
  1180 dark and light; deletes its Chrome profile).

## Native feel, one image viewer, real figures only (2026-10-09, branch `fix/prep-native-feel`, prep38)
Owner bug report (iPad screenshot): a deck question showed a whole page of notes as its "image" ("Based on the table
provided in the image..."), tap to enlarge was stuck, and screens jumped up on every tap.

**Shared image viewer: `prep-viewer.js` (`window.PREP_VIEWER`).** The one full-screen viewer for every enlarged image.
Use it for any new image surface (interactive lessons included); do not write another zoom.
- `PREP_VIEWER.open({ src, alt, caption, from, onClose })` opens it (mounted in `.pn-root`, else `document.body`).
  `from` gets focus back on close; `onClose` runs once however it closes.
- `PREP_VIEWER.close()` -> true when one was open. `prep.js back()` calls it first, so Escape and Android back close it.
- `PREP_VIEWER.isOpen()`; `_state()` -> `{ s, x, y, dy }` and `_pure` (gesture maths) for tests.
- Gestures: pinch 1x to 5x around the pinch point, pan with edge limits (rubber band past them), double tap 2.5x at the
  tap / back to fit, swipe down at fit to close, trackpad pinch (ctrl + wheel), keys (Escape, + - 0, arrows), and 44 px
  zoom out / level (fit) / zoom in buttons. All transform on the image; pointer coordinates are divided by the app's
  html zoom (home.js text size), so maths is in the stage's CSS px. CSS: the `.pv-*` block at the end of `prep.css`.
- Wired: PYQ / deck / explanation images (`prep-pyq.js zoomOpen`), lesson figures (prep.js `lessonZoomToViewer`: the
  lesson's own `#pnZoom` paint is hidden and shown in the viewer; closing it presses the lesson's `l-unzoom`, so
  `prep-lessons.js` needed no change). The radiology slice stack keeps its own enlarged mode (drag = slices).

**App shell (prep.js `paint`).** Root cause of "pages go up on clicking": every paint replaced the overlay, so the body
was new (scrollTop 0) and then `focus()` scrolled to the focused element. Now a repaint of the same screen keeps the
scroll position (set before the frame), a push starts at the top, back restores the position kept per stack depth, a
new question starts at the top, focus uses `preventScroll`, and a push or pop keeps the leaving body as `.pn-ghost` for
a 200 ms cross-fade (no empty frame; ids stripped; prep-motion ignores it). A fresh answer glides just enough to show the
verdict when it starts below the fold. `html.pn-open` (set on open) stops the document scrolling under the overlay;
`.pn-body` is `overflow-x: hidden` (overflow-y auto alone made x scrollable too), bars are `touch-action: none`.

**Deck images are figures only (`prep-source.js`).** An image covering 55% or more of its page is a page scan and never a
candidate; `scanPages` + `figureRegions` look inside a scan for a picture-like region (dense blocks, then
`classifyPixels` = picture) and find none on a page of text. Embedded images under more than 40 characters of the page's
text layer (OCR'd scans) are out. Every cut is classified from its pixels (`classifyPixels`: picture / diagram / text /
blank; text = lines in bands, a flat fill is text on a box) and only pictures and diagrams (scan regions: pictures) are
kept. Server (`functions/_prep-core.js`): imcq schema now says `kind` first (`IMG_KINDS`); text, table, chart, other ->
no question (`skipped: "not-figure"`); `imageStemReads` drops any stem or key that asks to read the image
(`"reads-image"`); the prompt forbids it. Old deck items whose stem reads the image are left out when practised
(`prep-create.js readsImage`). Fixtures: `test/fixtures/prep-figures/make-pdf.mjs`.
Tests: `test/prep-figures.test.mjs`, `test/prep-viewer.test.mjs`, `test/prep-imcq.test.mjs`, headless
`test/run-prep-feel-ui.mjs` (navigation scroll per frame, sideways overflow at 390/820/1180, viewer touch gestures via
CDP `Input.dispatchTouchEvent`, deck crops on the six fixture pages).
Real-device checks left: pinch and swipe-down feel in iOS WKWebView and Android WebView, rubber band of the overlay on
iOS, keyboard over inputs.

## Native feel pass 2: patch, never rebuild (2026-10-09, branch `fix/prep-native-feel2`, prep39)
Owner iPhone screen recording after OTA v244: in the "Set up practice" sheet every chip tap jumped the sheet to the top,
a scroll bar showed on its edge, scrolling stuttered, and it opened on "Incorrect before (0)" with Start disabled.
Headless Chrome never showed it. **Verify feel in WebKit**: `test/run-prep-webkit-ui.mjs` (Playwright WebKit, iPhone 15
profile, real touch taps; serves the repo through a route on `https://prep.test` because index.html's CSP upgrades
`http://localhost` in WebKit; service workers blocked so routes apply; `FRAMES=<dir>` saves a frame strip).
Root causes and fixes:
- **Rebuilds.** `prep-setup.js draw_()` set the whole sheet's innerHTML, so `.su-body` (the scroller) was a new node at
  scrollTop 0. Same class of bug in `paint()` for every inner scroller (a subject's filter row lost its sideways
  scroll). Now `PREP_DOM` (prep.js): `patch(el, html)` morphs the live tree (same tag + id + `data-key` at the same
  place = same node; attributes/text updated; a focused input keeps its value; nodes with `__pnKeep` such as motion
  sparkles, confetti and the lessons' Learn button are left alone). `paint()` patches when the screen key and view are
  the same and nothing navigates; the setup sheet, the plan settings sheet, the Ask sheet (same view) and the sync box
  patch too. Code that wires a node after a paint must use `PREP_DOM.on(el, site, type, fn)` (binds once, swaps the
  handler) or guard itself (`bindRunSwipe` uses `body.__pnSwipe`), else a surviving node gets a second listener.
- **The tapped chip stays under the finger** (`prep-setup.js anchored`): the scroller moves by however far the chip
  moved. The three timer panels share one grid cell (`.su-tstack`, hidden ones `inert`), so switching the timer never
  changes the sheet's height (at the bottom a shorter panel clamped the scroll).
- **Stutter.** The sheet scroller had a CSS mask (WebKit paints masked scrollers on the main thread): now a sticky fade.
  The sheet drag's non-passive `touchmove` sat on the whole overlay (iOS then waits for JS before every scroll): now on
  each `.pn-sheet-wrap` (armed by a MutationObserver), marker `wrap.__pnTouch`.
- **Scroll bars.** `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` for everything in `.pn-root`/`.pv`.
- **Page behind.** Scrim and the setup sheet's head and action bar are `touch-action: none` (a drag there pans nothing).
- **Defaults.** `PURE.fit(lists, sel, ctx, rows)` after the pool loads: a chosen option with 0 questions opens its row
  (All; Mix for difficulty), row by row. Options with 0 questions are `disabled` (faded, no press); arrow keys skip them.
Not verifiable here: real finger scrolling and momentum (Playwright mobile WebKit has no wheel or touch drag; the suite
scrolls in steps), the WKWebView rubber band, and the iOS scroll indicator itself. No iOS simulator runtime is installed.
## Interactive lessons + image-rich radiology lessons (2026-10-09, branch `feat/prep-interactive-lessons`, prep41)
Owner 2026-10-09: radiology lessons "don't have images as much as needed ... make it interesting, interactive and the
best way of learning."
- **Reader (`prep-lessons.js` + `prep-lx.css`, loader CSS list):** new optional parts, all drawn from data:
  spot the sign (`vis.spot { q, box [x,y,w,h] 0..1, label, why }`: tap on the image, hit = in the box or within 4%,
  miss ring, second miss or "Show me" reveals), labelled figure (`vis.marks [{x,y,label}]`: numbered points, tap a
  number or Show all, a key list under it), compare (`vis.pair { src, alt, tag, tagA, why, ar }`: a clip-path slider
  when both shapes are within 12% (`sliderPair`), drag with pointer capture, range input for keys, Show buttons as the
  single-tap alternative; else side by side, each enlarges), quick check (`step.qc { q, o, a, why }`, true/false when
  o is ["True","False"]; one tap, in-place feedback), classic signs deck (`lesson.cards [{f,b}]`, flip cards, a page
  after the steps) and key points (`lesson.keys`, the last page, with the score and best streak). `vis.ar` reserves the
  figure's shape (and sizes the stage on landscape iPad so overlays stay aligned: never object-fit an overlaid img).
  XP: 10 a step + 5 a right answer (first finish only). Pages = steps + cards + keys (`pages()`).
- **Fallback:** a file with every new part still passes the old `checkLesson` (figures stay kind "image"), and
  `tidyLesson()` drops any malformed optional part instead of failing the lesson. Revised lessons ship at
  `v2/lessons/<key>.json` and their v1 index entry gets `"r": 2` (same key, progress kept); older readers ignore `r`
  and keep their v1 copy (files are cached forever per path).
- **Viewer:** `l-zoom` calls `window.PREP_VIEWER.open({ src, alt, caption, from })` when the shared viewer is loaded,
  else the reader's own enlarge (now for any figure, the second image of a compare included).
- **Data (`tools/prep-radlx.mjs`, private data `~/prep-data/radnotes/lx`):** pool (the book's figures for the topic,
  the strict vote's dropped uses back in as candidates, licensed Open-i / Commons figures when the book has fewer than
  4 spare; licence from the article's own <permissions> or Commons extmetadata) -> plan (gemini-2.5-flash, images
  attached, one request a lesson) -> code gates -> two Haiku votes per element with a lesson rubric (labels and arrows
  on a figure are fine; refuse only wrong for the step, unreadable, identifiers or third-party marks; overlays checked
  on the figure with the box or numbered dots drawn) -> assemble -> upload (SHA-verified over the route).
- Tests: `test/prep-radlx.test.mjs`, `test/run-prep-lessons-ix-ui.mjs` (fixture `test/fixtures/prep-lx`, synthetic
  shapes; W=390|820|1180, PN_LIGHT=1). `test/serve.mjs` serves fixture lesson media immutable like the bank route so
  the offline check sees the real HTTP cache.
- **Run 2026-10-09 (results):** 340 radbook lessons revised (v2 files, `r: 2`). Images 350 -> 982 (lessons with 3+
  images 39 -> 207; with none 144 -> 46, mostly anatomy lessons from the true/false book, which has no figures);
  interactive elements 0 -> 1,234 (222 spot, 118 label sets, 15 compares, 577 quick checks, 302 sign decks; 325 lessons
  with 2+); 163 figure steps added; 306 figure uses the strict vote had dropped came back under the lesson rubric.
  Licensed figures: 12 Open-i case-report figures (11 CC BY 4.0, 1 CC BY 3.0), credited in terms.html; Commons gave
  none that passed. Animal and veterinary study figures are excluded in code (`ANIMAL`), hand vetoes in
  `<dir>/veto.json`. Spend $4.83 (plan gemini-2.5-flash $2.21, locate $2.62). Lesson: the plan request's own boxes
  were wrong (laterality, guessed round numbers); a detection-only request per image (`locate`) fixed them, so keep
  the two stages separate.

## Interactive + image pass on the 334 Crack the Core lessons (2026-10-09, branch `feat/prep-ctc-interactive`, prep42)
- Same pipeline as the radbook run: `node tools/prep-radlx.mjs <stage> --ctc` (book dir `~/prep-data/radnotes/ctc/book`,
  work dir `~/prep-data/radnotes/ctclx`). New in the tool: `--ctc`, a both-voters-say-wrong drop of a kept book figure
  (`no`), `PREP_PLAN_MODEL` / `PREP_LOC_MODEL` overrides, `--reverse` plan runner that skips planned lessons, and
  more brand words in `BAN` (prometheus, lionhart, crack the core, gamesmanship). `ANIMAL` now also catches calf,
  calves, heifer, goat, caprine, lamb (a calf case report had slipped through).
- **Results:** 334 lessons revised (all `r: 2`). Images 265 -> 713 (lessons with 3+ images 19 -> 132; with none
  168 -> 64); interactive elements 0 -> 1,046 (138 spot, 45 label sets, 14 compares, 545 quick checks, 304 sign
  decks, 333 key point pages); 317 lessons with 2+ interactive parts. Licensed figures: 34 Open-i (CC BY 4.0,
  3.0, 2.0) and 2 Commons (CC BY 4.0), merged into the terms.html "Radiology lesson figure credits" list.
- Hand fixes: `ctclx/veto.json` drops a teratoma image reused in the hydrometrocolpos lesson and a clinic stock photo
  from Commons; lesson 650692 step text corrected (tardus parvus is seen downstream of a stenosis). Veto keys are the
  full lesson id with its slug.
- Spend $4.04 (plan $2.58 across gemini-2.5-flash and gemini-3.6-flash, locate $1.46); votes by Haiku subagents.

## Ask MaiK is a short chat + the MaiK AI mark (2026-10-09 evening, branch `feat/prep-maik-chat`, prep43)
- After the first answer the Ask MaiK sheet has a follow-up box. Each doubt goes the same place (on this phone via
  `PREP_TEACHER.localGenerate`, or online `POST /api/ai/prep-teach` kind `chat`) with the same grounding, the newest 6
  turns (4 on the phone) and an extractive summary of older ones (`prep-teacher.js chatContext`, caps `CHAT_LIM`),
  and the same check against the grounding only. MaiK Tokens show under every online answer.
- 10 student messages per thread (the first ask counts); then "Continue this in MaiK Assistant" opens the main MaiK
  (home.js `SMD_askMaikHandoff`) with the set title as topic and a short summary + "My next doubt: " typed in.
  "Not covered" answers offer the same hand-off at once; a failed answer offers Try again (not a new message).
- Threads: per item (`threadKey`: MCQ id, step/card text), in memory and localStorage `smd_prep_ask_v1`
  (`pruneThreads`: 12 threads, 24 turns, 1,200 chars, 7 days). A started thread reopens (no new call); the place
  choice rule is unchanged ("Don't ask again" still skips the question).
- Server `functions/api/ai/_prep-teach.js`: kind `chat` { base, ground, turn 1..10, messages [{r:u|m,t}] (<= 8, user
  <= 400, MaiK <= 1,200, total <= 4,000, last is the student's), summary <= 800, idem }; every string `prepScrub`bed;
  turn > 10 = 400 `turns`; size = 413; `CHAT_SYSTEM` (same text as the client); one usage record per call, feature
  `prep:teach-chat`, counter `prep.teach.chat`.
- Tests: `test/prep-ask-chat.test.mjs`, `test/prep-teach-server.test.mjs` (chat part), `test/run-prep-ask-chat-ui.mjs`.
- Icon: see vault/modules/MaiK.md "MaiK AI mark".

## Release-readiness QA (2026-10-10, branch `fix/prep-ready`, prep44)
- **Ask MaiK reads structured explanations.** Items with bank v5 `x` (key, notes, others, pearl) and an empty `exp` were
  grounded on the stem alone and the fallback said "No explanation is stored" under a question that showed one (live
  sur-wound-healing: 40 of 245 items). `prep-teacher.js` `expOf` / `kpOf` / `reasons` now read `x` exactly as the
  question screen does (markdown made plain); old `*` bullets become lines and stray asterisks go.
- **Search in ss-radiology.** Bank v6 to v10 shipped no `search.json`, so search showed "needs a connection". On a 404
  `prep.js loadSearch` builds the same index from the subject's module files (`buildSearch`, flagged items out).
- **Bank route.** A failed R2 read is a 503 `bank-unavailable` (no-store), never a 404 (a 404 overlay is remembered as
  empty for the session); HEAD is answered like GET (it fell through to index.html with a 200).
- **Tests.** Lesson KB gate: `kbGrounding` puts a named doc's first (summary) sentence first and keeps repeated sentences
  once (KB v2 #1414 grew breast_cancer.json past the 1,400-word cut). Node 22 (CI): server mocks in
  prep-nudges.test.mjs moved above the first test (a mock.module made while a test runs is undone with it); the sprint
  assertion only applies in IST. run-prep-ask-ui waits for the sheet's open animation before measuring.
