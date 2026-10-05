---
tags: [plan, learning, ai, cost]
status: proposed (2026-10-05, revision 8), builds on the owner's "PrepNucleus" spec (Document_8.docx). Phases 1 and 2 are about to be implemented. Layer C contract in full: [[PrepNucleus-LayerC]] (`vault/plans/PrepNucleus-LayerC.md`, frozen from commit `c3f3725c`; caps updated in its 9.3 for decision 5 below).
owner-goal: ready-made module-wise question banks over all MBBS subjects and the superspecialties, as many questions as each module's content supports; PDF -> deck as an optional feature. "Complete the project."
flag: smd_prep (planned, default OFF)
---
# PrepNucleus

Exam-prep layer inside StewardMD for NEET-PG, INI-CET, NEET-SS and USMLE (v1). The learning loop of the spec
stands: QUESTION -> WHY -> WHY NOT -> MISTAKE -> FLASHCARD -> FSRS -> MASTERY; exam profiles as config; MaiK as
teacher. The student opens a **subject grid -> section -> module** bank (about 1,700 modules in v1), answers,
and the engine schedules what comes back. SOURCE -> DECK from a student's own PDF is an optional, capped feature.

One-line architecture: **three layers on one engine. A: the free all-subject MedMCQA bank ($0 AI). B: a one-time
owner-run Batch fill (Gemini 3.1 Flash-Lite, Batch price) that brings every module up to a size-scaled target.
C: optional PDF -> deck per student.** Quality is enforced by automatic checks (code gates, blind solve, review,
a blind-solve screen of the bank, student flags); doctor grading is deferred by the owner and optional.

## 1. Decisions made by the owner (2026-10-05 unless dated)
| # | Topic | Decision (owner's words in quotes) | Consequence |
|---|---|---|---|
| D1 | Default product | Ready-made module-wise banks "over all branches, specialties and sub specialties by default"; PDF -> deck for "who wants MCQs from a specific PDF" | Layers A and B are the product; Layer C ships last |
| D2 | Sources for Layer B | "Use all, no issues, I will take responsibility for every text used from my app." | Every candidate source may ground generation, including the Harrison-derived `kb/diseases` pages, StatPearls, WHO and other references. **Owner-accepted legal risk**; one recommendation stands: a legal review of the source list before the SS banks go live. Quality rules stay (6.3) |
| D3 | Taxonomy | "All branches in MBBS, and superspecialities like gastro, oncology, etc (topic wise), for example like the photos pasted." | Branch > subject > section > module, sized like the reference screenshots (6.1); competitor material is a layout reference only |
| D4 | Questions per module | "Thin topics less MCQs, as many as possible for the topic; big topic more questions; small one 10-25 covering the topic." | Size-scaled target per module (6.1), coverage of the module's concepts, not a flat 100 |
| D5 | v1 exams | NEET-PG, INI-CET, NEET-SS, USMLE. NEET-UG out | No minors, so no DPDP parental-consent flow in v1 |
| D6 | Layer C caps | "10 decks per month, 3 max per day." | Applies to every signed-in user, no plan split (owner gave none); replaces per-plan token budgets (9.3) |
| D7 | Doctor grading | "Ignore doctor grading for now. Complete the project." | Deferred: not a gate for any phase or go-live. Automatic checks gate instead (8.1); the doctor sample is an optional switch (8.4). AI-generated items are labelled in the UI |
| D8 | Generation model | `gemini-3.1-flash-lite` everywhere | $0.25 in / $1.50 out per 1M; Batch $0.125 / $0.75 (read 2026-10-05). `MODEL_HARD_DEFAULT` in `functions/_ai_usage.js` |
| D9 | Offline models | MaiK Lite / MxCore are teachers only | Never writer or reviewer |
| D10 | OCR | On the phone only (pdf.js text layer, Apple Vision / ML Kit) | Never Gemini |
| 2026-09-24 | No textbook names or page numbers displayed | Still applies to what the app shows: D2 covers what the model may read, not what the student sees | Layer A explanation scrubber stays (6.2); Layer B items never show a source book name or page, only "StewardMD reference notes" |

## 2. Scope
- **Layer A (Phase 1, $0 AI plus a Rs 500 screen)**: every MedMCQA subject that maps to the MBBS taxonomy
  (Dental and the unlabeled bucket dropped), cleaned, de-duplicated across subjects, difficulty-tagged,
  flagged, explanation references scrubbed, mapped to modules, blind-solve screened. Every clean, unflagged,
  undisputed item ships (no cap: "as many as possible").
- **Layer B (Phases 3 to 4)**: Batch fill of every module below its target (mostly SS Medicine and USMLE
  vignettes), same gates as Layer C, labelled AI-generated, live as each subject's batch passes the automatic
  checks.
- **Layer C (Phases 5 to 6)**: PDF -> deck, design frozen in [[PrepNucleus-LayerC]], caps per D6.
- **Non-goals for v1**: per-session AI; semantic search; image questions; "current reference" conflict check;
  SS Surgery and SS Paediatrics banks (later groups, 6.1); PDF on the server; verbatim copying of any
  third-party text; **any question, explanation or image copied from a third-party commercial QBank or app**
  (competitor apps are a layout reference only).

## 3. Corrections carried from revisions 2 to 7 (verified against code; details in git history)
- One Gemini call per HTTP call (`aiDeadlineMs` 28 s); per call <= 15 facts / <= 7 MCQs / solve / review.
- Facts grounded by document-wide sentence numbers; key-first generation; server shuffle; blind `solve`.
- Metering: `checkQuota` type `prep`, `gateAndCount` deferred with `commit(extra)` (today `q.commit` takes no
  arguments), `addDailyCostInr` exported, `bump("maik.cost")`; never `_usage.js` `recordUsage`.
- `_deid.js` unusable for prep; `prepScrub` instead. Engine: `opts.source`, profile-driven exam, per-topic
  `lic`/`cite`, `validateIndex` file check from the source, new `prep-cards.js` (no flashcard feature exists).
- `kb/diseases`: 140 of 144 cite Harrison 22e (now allowed as grounding by D2, still never displayed).
  2,967 of 7,526 OBGYN explanations carry textbook references, 1,190 page locators (scrubbed at build).
- Engine flags are phone-local; a server flag endpoint is new. R2 for the bank, read only through a binding.
- Drift (not fixed here): `vault/Flags.md` says `smd_edge` OFF; `home.js` says ON since 2026-10-04.

## 4. Architecture
```
BUILD TIME (owner's Mac / CI)                       RUNTIME (phone + server)
MedMCQA parquet -> tools/prep-build-bank.mjs        prep.js host on the specialty engine
  clean, dedupe, flags, difficulty, module map,       bundled: taxonomy.json + per-subject index.json (~300 KB)
  reference scrub -> prep/bank/v1/<subject>/...       on demand: /api/prep/bank/v1/<subject>/{search,<module>}.json
tools/prep-screen-keys.mjs (Batch blind solve)        cached in IndexedDB; "download subject" for offline
  -> disputed flags, excluded                         subject grid -> section -> module -> MCQ screen
tools/prep-fill.mjs (Layer B, Batch)                  cards, exam, FSRS, mastery, solve next (code)
  shortfall -> source packs -> facts | mcq | gates     flags -> POST /api/prep/flag
  | solve | review -> prep/fill/<module>.json          Layer C: POST /api/ai/prep-generate {op}
R2 bucket stewardmd-prep-bank (PREP_BANK_R2)          MaiK Lite / MxCore: offline teacher
```

## 5. Phases 1 and 2: precise enough to code from
### 5.1 Phase 1: bank build (`tools/prep-build-bank.mjs`, $0 AI; screen Rs 500)
**Input.** MedMCQA parquet `train` + `validation` from HF `openlifescienceai/medmcqa` at the pinned commit
`91c6572c454088bf71b679ad90aa8dffcd0d5868` (same download lines as `tools/tokos-build-mcq.mjs`), converted
to JSONL per subject. Dental and unlabeled subjects skipped. Expected about 187k rows (confirm; not
verifiable offline).

**CLI.** `MEDMCQA_DIR=<dir> node tools/prep-build-bank.mjs [--subject <id>] [--out prep/bank/v1] [--upload]`.
One run builds all subjects; `--subject` rebuilds one. `--upload` puts files to R2 with `wrangler r2 object
put stewardmd-prep-bank/v1/<subject>/<file> --content-type application/json --cache-control "public,
max-age=31536000, immutable" --remote` (the Ophthalmós image pattern).

**Pipeline per subject** (port of the Tokós tool, in order): keep subject -> strip HTML and whitespace ->
repair dropped "rt" letters -> drop broken / keyless / figure-dependent items -> **cross-subject dedupe** (a
normalised-stem hash set shared across the whole run; the first subject in taxonomy order keeps the item) ->
same-key and same-stem conflict flags (`dup-key`, `dup-stem`) -> explanation flags (`exp-letter`,
`exp-text`) -> **reference scrub** -> module mapping -> difficulty -> **USMLE tag** -> write.

- Reference scrub (`scrubRefs(exp)` exported, unit-tested): removes clauses that name a textbook with an
  edition or "Ref.", and `pg|page|p.|pp.|Chapter|Ch.` locators with their numbers, using the title list the
  display scrubber in `emoji-icons.js` already carries (flag `smd_nobooks`) plus "Park", "Dutta", "Shaw",
  "Ganong", "Bailey", "Sabiston" and the other Indian PG staples; protects eponyms the same way. An explanation
  that was only a reference becomes `""`. Fixture: the 1,190 OBGYN locator cases; exit asserts zero survivors
  with the test regex `/(\d+(st|nd|rd|th)\s*ed|\bref\.|\b(pg|page|pp?)\.?\s*\d)/i`.
- Module mapping: `prep/taxonomy.json` gives each module `match: { topic: [regex], stem: [regex], key:
  [regex] }`; score as the Tokós tool does (topic_name 2, stem 3, key option 2, explanation 1 each up to 3);
  best module wins, ties to the earlier module; nothing scored -> the subject's `<subject>-unmapped` module.
- Difficulty `d` 1 to 3 as the Tokós tool (`tag_difficulty` port).
- USMLE tag `ex: ["usmle"]` when the stem is a vignette: `/^A\s+\d{1,2}-(year|month|day)-old/i` or `/\b(presents|is brought|complains)\b/i`
  and stem length >= 25 words. Counted per subject in the report.

**Output formats** (engine shape; `validateIndex` and `validateItems` in `specialty-bank.js` must pass):
```
prep/taxonomy.json
{ v: 1, branches: [ { id: "mbbs", name: {en}, subjects: [ { id: "anatomy", name: {en, hi}, medmcqa: "Anatomy",
    sections: [ { id: "anat-embryo", name: {en}, modules: [ { id: "anat-embryo-gameto", name: {en, hi},
      ex: ["neet-pg", "ini-cet"], target: null, match: { topic: ["gametogenesis", "oogenesis", "spermatogenesis"], stem: [...] } } ] } ] } ] },
  { id: "ss-medicine", subjects: [ { id: "cardiology", ... } ] } ] }

prep/bank/v1/<subject>/index.json            (engine index; one per subject)
{ id: "<subject>", v: 1, source: "medmcqa", licence: "MIT", sourceCommit, citation, modifications,
  counts: { total, d1, d2, d3 }, flagLegend: {...}, usmle: <n>,
  topics: [ { id: "<module>", title: {en, hi}, group: "<section>", count, file: "mcq/<module>.json", lic: "MIT", cite: "MedMCQA" } ] }

prep/bank/v1/<subject>/mcq/<module>.json     (one per module)
{ topic: "<module>", items: [ { id, q, o: [4], a, exp, t: "<module>", d, flags?: [], ex?: ["usmle"], prov: "LIC" } ] }

prep/bank/v1/<subject>/search.json           (tools/tokos-build-mcq-search.mjs writeSearch(dir), unchanged format)
prep/bank/v1/manifest.json                   { v: 1, built, subjects: [ { id, items, modules, bytes } ] }
```
`group` is the engine's existing per-topic grouping (Tokós uses obstetrics / gynaecology), so section headers
need no engine change. Module ids are stable; items keep their MedMCQA uuid as `id`.

**Screen** (`tools/prep-screen-keys.mjs`): Batch request per item, stem and shuffled options only, schema
`{ ot }`; mismatch with `o[a]` -> `flags: ["disputed"]`. About 150 in / 15 out tokens per item: 170k items =
25M in + 2.5M out at Batch price = about $5.1 (Rs 490). Disputed items are written to the module files with
the flag and excluded by the app like other flags; they are not a review queue. The screen also writes
`prep/bank/v1/screen-<date>.json` (per-subject agreement rate) for the report.

**Report** `vault/plans/prep-bank-<date>.md`: per subject rows read / dropped / deduped / kept / flagged /
disputed / usmle-tagged / modules / modules below 10 / below 25 / unmapped share; per module counts; the Layer
B shortfall list `prep/fill/shortfall.json` = modules with `kept < target` (6.1).

**Exit criteria.** (1) `node --test` passes `test/prep-build-bank.test.mjs`: `scrubRefs` fixtures, module
mapping on 50 hand-labelled items per branch >= 90% agreement, dedupe removes a planted cross-subject
duplicate, every emitted index passes `validateIndex` and every module file passes `validateItems`. (2) Report
produced; unmapped share <= 10% per subject. (3) Zero reference survivors. (4) Screen done, disputed rate per
subject recorded. (5) Files on R2 and `manifest.json` lists them; `curl` of one module through the API route
returns it with the immutable header. (6) Reproducible: a second run from the same inputs is byte-identical.

### 5.2 Phase 2: the bank app ($0 AI)
> **As built (2026-10-05):** `prep.js` is a standalone overlay on `specialty-core.js` FSRS, not
> `SPECIALTY.createHost` (Decisions 2026-10-05); there is no `prep-bank.js`, the browser, filters, custom module,
> search and downloads live in `prep.js`. The bank route reads the existing bucket `stewardmd-offline` under
> `prep-bank/`, not a new `stewardmd-prep-bank`. Auto-hide is 3 separate reporters (the server never sees attempts).
> Module notes: [[PrepNucleus]].

**Files.**
| File | Role |
|---|---|
| `prep-loader.js` | Boot stub like `tokos-loader.js`: loads `specialty-core.js`, `specialty-data.js`, `specialty-stage.js`, `specialty-shell.js`, `specialty-bank.js`, `prep-bank.js`, `prep-cards.js`, `prep.js` on first open; kill switch `localStorage smd_prep = "0"`; flag `smd_prep` default OFF |
| `prep.js` | `SPECIALTY.createHost({ id: "prep", global: "PREP", base: "/prep/", rootId: "smdPrep", rootClass: "prep-root", storeKey: "smd_prep_v1", prefKey: "smd_prep_prefs", flag: "smd_prep", levels: { free: ["mbbs", "resident"] } })`; registers the subject grid as home; one bank feature per subject through `prep-bank.js`'s source |
| `prep-bank.js` | Taxonomy browser (subject grid -> section -> module), `source` for `SP.features.bank` (`index()` from the bundled subject index, `topic(file)` and `search()` from `/api/prep/bank/v1/...` with IndexedDB cache `prep-bank` store `files` keyed by path), subject download, filters, custom module, solve next |
| `prep-cards.js` | Cards view: front (stem), back (key + first `exp` sentence), I knew it / I did not -> `gradeFor` |
| `prep.css` | Under `.prep-root`, `--sp-*` tokens |
| `prep/taxonomy.json`, `prep/bank/v1/<subject>/index.json` | Bundled by `scripts/build-www.sh` (copy only these; module and search files stay on R2) |
| `prep/profiles/{neet-pg,ini-cet,neet-ss,usmle}.json` | Exam profiles (7) |
| `functions/api/prep/bank/[[path]].js` | `GET /api/prep/bank/v1/<subject>/<file>`: reads `env.PREP_BANK_R2` (new `[[r2_buckets]]` binding `PREP_BANK_R2`, bucket `stewardmd-prep-bank` in `wrangler.toml`), path whitelist `^v\d+/[a-z0-9-]+/(index|search|manifest|mcq/[a-z0-9-]+)\.json$`, returns `Cache-Control: public, max-age=31536000, immutable`, 404 otherwise. No auth (public bank, licence MIT) |
| `functions/api/prep/flag.js` | `POST { itemId, subject, module, reason }` signed-in: KV `prep:flag:<itemId>` `{ n, reasons, first, last }` and a D1 counter `prep.flag.<subject>`; Review Desk reads the top flagged list |
| `review-desk.js` | Kind `prep`: per-subject rows "flagged keys" and "student flags", read-only in Phase 2 |
| `home.js` | Home tile "PrepNucleus" behind `smd_prep` (pattern: Tokós tile) |
| `test/prep-bank.test.mjs`, `test/run-prep-ui.mjs` | Unit (source adapter, filters, solve-next ranking, custom module draw over fixture data) and headless CDP UI (open subject, open module, answer 5, bookmark, flag, filter, custom module, offline download) |

**Engine changes** (`specialty-bank.js`, all behind options, Tokós unaffected; `test/specialty-bank.test.mjs`
extended): `opts.source = { index, topic, search, fileOk }` replacing the three `I.getJSON` points and the
`^mcq/` check; `opts.exam = { n, sec }` replacing `EXAM_N`/`EXAM_SEC`; `srcLine` reads topic `lic`/`cite` when
present; `validateItems` accepts `ex`, `prov`, and the Layer B fields (`r[4]`, `kp`, `et[4]`, `gen`, `rv`).

**UI shape** (from the owner's reference, layout only):
- Home: branch tabs (MBBS, SS Medicine) -> subject grid; each tile shows modules done / total and a progress ring.
- Subject: sections as headers, modules as rows with MCQ count, a mastery rating (engine `classStats` per
  module: correct share and FSRS stability bucket shown as 0 to 5 stars), state chip; filters All / Paused
  (started, not finished) / Completed / Unattempted / Free (d <= 2 for the free level); Bookmarks list;
  **Custom module** (pick modules, difficulty, count; drawn with `examPick` over the chosen module files);
  **Solve next** (first due module by FSRS `dueTopics`, else the lowest-mastery started module, else the next
  unattempted in order).
- Module: the engine's MCQ run (study mode with explanation, or timed). Items carry a small provenance line:
  "MedMCQA (MIT)" for LIC, **"AI-generated, auto-checked"** for Layer B, "Your deck" for Layer C.
- Settings: downloaded subjects with sizes, "Download for offline", "Remove".

**Storage.** Host store (`specialty-data.js`, localStorage) holds progress, FSRS state, bookmarks, flags,
module state; IndexedDB `prep-bank` holds cached files (`files: path -> {json, bytes, ts}`) and the offline
subject list. Bundled 300 KB; a subject's `search.json` 0.5 to 2 MB on first search; module files 30 to 300 KB
each; a full subject 3 to 12 MB.

**Exit criteria.** `npm test` green including the new tests; `test/run-prep-ui.mjs` passes on the headless
build; the engine test that forbids host names in engine files passes; zero AI calls in the network log;
first module opens in <= 2 s on a throttled 4G profile with a cold cache; offline: airplane mode after
downloading a subject still opens every module of it; `build-www` output contains taxonomy and indexes only.

## 6. Taxonomy, targets and the shared layers
### 6.1 Taxonomy and question targets (D3, D4)
- **Tree**: branch > subject > section > module. v1 branches: **MBBS** (19 subjects, about **835 modules**,
  sized like the reference: Anatomy 63, Biochemistry 28, Physiology 43, Pharmacology 67, Microbiology 35,
  Pathology 71, Community Medicine 64, Forensic 21, Ophthalmology 28, ENT 38, Anaesthesia 25, Dermatology 23,
  Psychiatry 33, Radiology 21, Medicine 104, Surgery 54, Orthopaedics 31, Paediatrics 39, OBGYN 47) and
  **SS Medicine** (14 groups, about **850 modules**: General Medicine 209, Neurology 77, Cardiology 36,
  Hepatology 26, Gastroenterology 27, Endocrinology 43, Nephrology 57, Rheumatology and Immunology 81,
  Hematology 24, Medical Oncology 91, Pulmonology 31, Infectious Diseases 84, Critical Care 63,
  Biostatistics 1). **v1 total about 1,685 modules.** Module names and groupings are written by us (the
  reference gives counts and layout only).
- **Later branches** (estimates): SS Surgery, 8 groups (surgical gastroenterology, surgical oncology, urology,
  neurosurgery, CTVS, plastic, paediatric surgery, vascular) x 40 to 60 = **350 to 450 modules**; SS
  Paediatrics, 9 groups (neonatology, cardiology, neurology, nephrology, haemato-oncology, PICU,
  gastroenterology, endocrinology, genetics) x 25 to 40 = **250 to 350**. Full tree eventually about
  **2,300 to 2,500 modules**.
- **Exam tags**: MBBS modules `neet-pg`, `ini-cet`, and `usmle` where the module is in the Step 1 / Step 2 CK
  content outline; SS Medicine modules `neet-ss` (NEET-SS Medicine group maps 1:1 onto the 14 groups, General
  Medicine being the common paper) and `ini-ss`.
- **Target per module** (D4): Layer A ships every clean item, no cap. The fill target is
  `target = clamp(round(1.5 x concepts), 10, 100)` where `concepts` = distinct accepted facts from the module's
  source pack (Layer B) or, before a pack exists, the module's row count in the reference tier (small 10 to 25,
  medium 25 to 60, large 60 to 100). Fill = `max(0, target - kept)`. So a thin module gets 10 to 25 questions
  that cover its concepts; a large one up to 100; a subject still ends with hundreds to thousands.
- Authorship: tree drafted by Claude from the seeds (MedMCQA `subject_name` / `topic_name`, the 26 Specialty
  Kits, `kb/diseases` for links, the reference layout), **approved by the owner**; versioned; items reference
  module ids, so a split or merge is a data migration.

### 6.2 Layer A coverage (estimates until the Phase 1 report)
- About 170k clean items (OBGYN: 10,237 read -> 9,196 kept). Over 835 MBBS modules that averages about 200
  per module against a reference tier of 15 to 25, so MBBS is largely covered from Layer A alone. Expect **10
  to 20% of MBBS modules (85 to 170) below their target** (small subjects: Radiology, Anaesthesia, Forensic,
  Psychiatry, Dermatology), average fill about 15: **1,300 to 2,500 items**.
- SS Medicine: MedMCQA Medicine items map to groups but rarely at SS depth; assume 10 to 15% of the need is
  met. 850 modules at an average target of 30 = 25,500, minus 2,500 to 3,800 covered: **21,000 to 23,000
  items**.
- USMLE: vignette-tagged bank items (estimate 10 to 15% of clinical items, 12k to 18k) cover much of Step 2 CK
  recall; generated vignettes fill Step 1 mechanism and Step 2 next-step gaps: about 150 per MBBS subject,
  **2,500 to 3,500 items**, output 1.5x a NEET item.
- Keys measured, not assumed: the Batch blind-solve screen (5.1) runs over every item; disputed items are
  excluded; the per-subject agreement rate is shown on the subject's licence line.

### 6.3 Layer B: central fill (D2 sources, same gates as Layer C)
- Driver `tools/prep-fill.mjs`, owner-side, Vertex project, Batch mode. Four stages with a file between each:
  `01-facts.jsonl` (one request per chunk of the source pack) -> gates, `fid` -> `02-mcq.jsonl` (7 facts per
  request, exam profile `style` injected) -> code gates 1, 2, 3, 5, 9b, 12, shuffle -> `03-solve.jsonl` ->
  compare -> `04-review.jsonl` -> accept; regen list through 02 to 04 once -> `prep/fill/<module>.json`.
  Resumable per stage; Batch job ids recorded.
- Sources (D2): any reference the owner holds, including `kb/diseases` and `kb/clinical-protocols`
  (Harrison-derived), `kb/dist`, Learn units, StatPearls, WHO, ICMR, NIH/NCI, open-access articles. Each
  module records `srcPack: [{id, title, url?}]`. Recommendation kept to one line: a legal review of the list
  before SS banks go live.
- **Quality and plagiarism rules (not licence rules, so they stay under D2)**: questions, options and reasons
  are written fresh from facts; no sentence of any source is reproduced verbatim (code check: no 12-word
  window of an option, reason or pearl appears in the pack); no source book name or page is stored or shown
  (2026-09-24); nothing is copied from a commercial QBank or app.
- Labels: `prov: "SMD"`, `gen: "AI"`, `rv`, `pv`, `mv`; UI line "AI-generated, auto-checked".
- Output per module `prep/fill/<module>.json` merged into the subject's R2 files as `v2`, index counts updated.

### 6.4 USMLE profile (D5)
`prep/profiles/usmle.json`: `style` "clinical vignette, mechanism, diagnosis, next best step; 2 to 5 sentence
stem with age, sex, setting and findings", `cog` reasoning-heavy, `stem: "vignette"`, `exam: { n: 40, sec: 90 }`
per block (Step 1 and Step 2 CK blocks are 40 questions in 60 minutes; confirm from the current bulletin,
decision 2). Bank items tagged `usmle` by the vignette rule plus Layer B vignettes; the Review `g11` gate judges
"fits USMLE style" when the profile is usmle.

## 7. Contracts ([[PrepNucleus-LayerC]] sections 6 to 8 are authoritative; Layer B uses the same gates)
- Layer C ops `facts | mcq | solve | review`, one Gemini call each, `idem`, 4 s retry after a 504; errors
  `400 bad-input, 401 sign-in, 413 too-large, 429 rate | circuit-breaker | daily-calls | daily-decks |
  month-decks | token-cap, 502 ai-failed, 504 ai-timeout` (402 `needs-plan` unused under D6).
- Facts `{ ft, cq, sn, fk }`; MCQ `{ st, key: {ot, wr}, dis: [{ot, wr, et}] x3, kp, fi, dl, cog }`; solve
  `{ s: [{i, ot}] }` with `a` carried in the request, never in the prompt; review `{ g: [{i, g4, g6..g11, old,
  why}] }`. Code gates 1, 2, 3, 5, 9b (every number in the key appears in the cited sentences), 12.
- Stored item: engine `{id, q, o[4], a, exp, t, d}` plus `r[4], kp, et[4], cog, fid, src, prov, ex[], pv, mv,
  rv{solved, pass, old}`, Layer B `gen: "AI"`, `srcPack`.
- Metering: `checkQuota` type `prep`, `gateAndCount` deferred + `commit(extra)`, `addDailyCostInr`,
  `bump("maik.cost")`, `PREP_MODEL`, Vertex only, fail-closed per-deck cap.
- Exam profile `{ id, v, name, style, cog, d, stem, exam: { n, sec, negative } }`.

## 8. Quality and safety
### 8.1 Automatic checks are the gate (D7)
| Layer | Checks before an item is live |
|---|---|
| A | Build drops and flags (`dup-key`, `dup-stem`, `exp-letter`, `exp-text`), reference scrub, Batch blind-solve screen (`disputed` excluded), per-subject agreement rate on the licence line |
| B, C | Schema + sanitizers; code gates 1, 2, 3, 5, 9b, 12; blind solve must match; review gates g4, g6 to g11 all true; regen once then drop; verbatim 12-word check; label `gen: "AI"` |
| All | Student flag -> `/api/prep/flag`; an item with >= 3 flags from distinct users or a flag rate >= 3% of attempts is auto-hidden in the next index build (`hidden: true`) and listed in Review Desk |

### 8.2 Labels
`prov` on every item; UI line per item: "MedMCQA (MIT), answer keys crowd-sourced, N% agree with the
auto-check" (LIC), **"AI-generated, auto-checked"** (SMD + gen AI), "AI-generated educational content, your
deck" (AI), plus "May be outdated" when `rv.old`. No book names or pages anywhere (2026-09-24).

### 8.3 Copyright and privacy
D2 recorded in section 1; quality and plagiarism rules in 6.3. Layer C privacy unchanged ([[PrepNucleus-LayerC]] 8.5).

### 8.4 Optional later: doctor sample (owner switch, not a gate)
When the owner turns it on: 200 items per subject or SS group in Review Desk kind `prep`, rubric as before,
reported as a Wilson lower bound on the subject's licence line (197/200 for >= 95%). About 3 to 5 minutes per
item; one subject about 10 to 17 hours. No phase waits for it.

## 9. Cost
### 9.1 One-time (Batch price)
Per 100 accepted NEET-style questions about 215k in / 71k out = **$0.08 (Rs 7.7)**; USMLE vignettes about
**$0.11** (longer stems and reasons).

| Item | Count | AI cost | With 2x margin |
|---|---|---|---|
| Layer A blind-solve screen | 170,000 items | $5.1 (Rs 490) | Rs 1,000 |
| MBBS fill | 1,300 to 2,500 | $1 to 2 | Rs 400 |
| SS Medicine fill | 21,000 to 23,000 | $17 to 18 | Rs 3,500 |
| USMLE vignettes | 2,500 to 3,500 | $3 to 4 | Rs 750 |
| **v1 total** | about 25,000 to 29,000 generated | **$26 to 29 (Rs 2,500 to 2,800)** | **Rs 5,600** |
| Later: SS Surgery + SS Paediatrics | 18,000 to 24,000 | $14 to 19 | Rs 3,700 |

Re-running one subject after a prompt fix: Rs 50 to 300. The AI bill is small; build and review tooling time is the cost.

### 9.2 Per student (Layer C)
50-page PDF, 25 questions: $0.053 to 0.070 (Rs 5.1 to 6.7), 25 to 31 calls. Study, exam, cards, bank: $0.
Worst case under D6: 10 decks x Rs 6.7 = **Rs 67 per student per month**, every plan.

### 9.3 Layer C caps (D6, every signed-in user, no plan split)
| Cap | Where | Value |
|---|---|---|
| Decks per month | `prep:decks:<uid>:<month>` | **10** (`month-decks`) |
| Decks per day | `prep:decks:<uid>:<day>` | **3** (`daily-decks`) |
| Calls per day | `AI_MODULES.prep.daily`, `AI_LIMIT_PREP` | **95** (3 decks x up to 31 calls = 93, plus 2 for a retried call) |
| Tokens per deck (hard stop) | `prep:tok:<deckId>` | 200,000 (fail closed) |
| Pages / text per deck | `PREP_PAGE_CAP`, `PREP_CHARS_CAP` | 60 / 300,000 chars |
| Output per call | `maxOutputTokens` | 1,536 / 3,000 / 400 / 800 |
| Project spend | `_usage.js` daily-cost breaker fed by `addDailyCostInr`; `ai:emergency` | as configured |
Monthly token budgets per plan (`PREP_MONTH_TOK_*`) are dropped. Layers A and B have no caps.

### 9.4 Storage and delivery
Layer A about 170k x 0.93 KB = 160 MB; Layer B 25k to 29k x 1.3 KB = 33 to 38 MB; total about **200 MB** on R2
(`stewardmd-prep-bank`, read only through `PREP_BANK_R2`, versioned immutable paths). Bundled: taxonomy and
subject indexes (about 300 KB). On demand: `search.json` per subject, module files. Offline per subject 3 to
12 MB. Not committed to git (a rebuild is about 40 MB compressed).

## 10. Roadmap after Phase 2
| Phase | Build | Exit |
|---|---|---|
| 0 Measure (before any generation) | `tools/prep-measure.mjs`: 100 kept questions, both temperatures, tokens incl. thinking, `finishReason`, Batch run of the same set, 50 seeded wrong keys | Cost fit within 20% of billing; Batch turnaround known; solve catch rate >= 90% on seeds |
| 3 Fill pilot | 2 SS groups (Cardiology, Medical Oncology) + USMLE for 2 MBBS subjects | Per-100 cost within 20% of 9.1; reject rate <= 30%; verbatim check zero; items live with the AI label |
| 4 Fill all v1 | Remaining shortfall, by subject; `v2` R2 files | Every v1 module >= its target or listed with its pack coverage |
| 5 PDF -> deck | [[PrepNucleus-LayerC]] with 9.3 caps | One usage record per call; caps and idempotent retry tested |
| 6 Scanned PDF, adapt, offline teacher, Edge intent | as before | OCR within 10 points; plan never calls AI |
| Later | SS Surgery, SS Paediatrics, INI-SS profile, NEET-UG (needs a minors flow), optional doctor sample (8.4) | each behind its own switch |

## 11. Metrics
| Metric | Target |
|---|---|
| v1 modules at or above target | 100% or listed with pack coverage |
| Layer A screen agreement per subject | reported on the licence line; subjects under 85% get a visible note |
| Solve catch rate on seeded wrong keys (Phase 0) | >= 90% |
| Reject rate (code + solve + review) | <= 30% after tuning |
| Student flag rate per module | <= 1% of attempts; auto-hide at 3% |
| Layer B cost per 100 questions | <= $0.10 Batch |
| Layer C cost per deck | <= $0.07; alert at Rs 10 |
| First module open on 4G | <= 2 s; offline subject <= 12 MB |
| FSRS retention, repeat-error trend | about 0.9; falls week over week |

## 12. Risks
| Risk | Mitigation |
|---|---|
| No doctor in the loop (D7) | Blind solve, review gates, bank screen, verbatim check, student flags with auto-hide, clear AI label, optional sample later (8.4) |
| Copyright of grounding sources (D2, owner-accepted) | Fresh writing only, verbatim check, no book names or pages shown, source packs recorded; legal review recommended before SS go-live |
| Flash-Lite thin at SS depth | Facts must cite pack sentences; thin packs yield fewer questions (D4 allows it); pilot on 2 groups first |
| MedMCQA keys wrong | Screen excludes disputed; agreement rate shown; flags |
| Mapping errors (half the items lack `topic_name`) | Scored match tables per module, unmapped bucket, 50-item hand check per branch in the Phase 1 test |
| Thinking billed / Batch slow | Phase 0 measures both |
| Bank size | R2 only, per-subject indexes, on-demand modules, offline per subject |
| Native app may only call `/api/*` | `functions/api/prep/bank/[[path]].js` over `PREP_BANK_R2` |
| Layer C abuse | D6 caps, per-deck token cap, breaker, `ai:emergency` |

## 13. Open decisions for the owner
1. **Taxonomy sign-off**: the v1 tree (about 1,685 modules) when drafted; whether to start the later SS Surgery and SS Paediatrics groups right after v1.
2. **Exam profile numbers** (`n`, `sec`, `negative`) from the current NEET-PG, INI-CET, NEET-SS and USMLE bulletins; who maintains them.
3. **Legal review** of the D2 source list before SS banks go live (recommended; owner has accepted the risk).
4. **Fill order** for Layer B after the pilot (recommend by student demand: General Medicine, Cardiology, Neurology, Gastroenterology, Medical Oncology first).
5. **Layer A subjects under 85% screen agreement**: ship with the note (recommended) or hold.
6. Log for prep the Ophthalmós "licence-verified sources" rule as superseded by D2.

## 14. Verified against the code and data (2026-10-05, branch docs/prepnucleus-plan)
- `specialty-bank.js` header: index `{id, v, source, licence, sourceCommit, citation, modifications, counts, flagLegend?, topics[{id, title, group?, count, file}]}`, topic file `{topic, items[{id, q, o[4], a, exp, t, d, flags?}]}`; `group` renders as section headers (line 304); `validateIndex`, `validateItems`, `searchIndex`, `examDraw`, `examPick`, `dueTopics`, `classStats`; three `I.getJSON` points; `EXAM_N = 30`, `EXAM_SEC = 90`; flags phone-local.
- `tokos.js` `createHost` options (`id, global, base, rootId, rootClass, storeKey, prefKey, flag`); `tokos-loader.js` JS list; `specialty-data.js` levels `mbbs` / `resident`, trials in localStorage; `tools/tokos-build-mcq-search.mjs` `writeSearch(dir)`.
- `tools/tokos-build-mcq.mjs`: OBGYN-only `SUBJECT`, scoring 3/2/2/+1, flags, MIT notice, HF commit `91c6572c...`. `tokos/decks/mcq/index.json` build stats (10,237 -> 9,196; 68 flagged; 7,526 with explanation).
- OBGYN explanations: 2,967 textbook references, 1,190 page locators (regex count). `Decisions.md:688` (2026-09-24) scrubs titles and locators on the DOM via `emoji-icons.js` `smd_nobooks`; data still carries them.
- `kb/diseases`: 140 of 144 `"source": "Harrison's ... 22e (2025)"`; `[[path]].js:633` "Harrison-derived".
- `functions/_ai_usage.js`: `gateAndCount` `q.commit = rec` (no args, 544), `realCostInr` reads `maik.cost` (579); `_usage.js` breaker, 3 s rate limit, `addDailyCostInr` private; `_counters.js` `bump(env, day, incs)`; `wrangler.toml`: one R2 binding (`FOLLOWCARE_R2`), `AI_COST_CAP_ON` unset.
- `vault/modules/Ophthalmós.md`: R2 `stewardmd-ophthalmos-img`, `wrangler r2 object put ... --cache-control "public, max-age=31536000, immutable" --remote`.
- Not verifiable offline: MedMCQA split sizes and subject list; USMLE block format; reference-app module counts (owner's screenshots, layout reference only).
