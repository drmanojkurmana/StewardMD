---
tags: [plan, learning, ai, cost]
status: proposed (2026-10-05, revision 5), builds on the owner's "PrepNucleus" spec (Document_8.docx). Nothing built yet.
owner-goal: "Make 100+ questions for each topic on default. Over all branches, specialties and sub specialties by default. Who wants MCQs from a specific PDF may use this feature." Earlier: "best, easy, cheap".
flag: smd_prep (planned, default OFF)
---
# PrepNucleus

Exam-prep layer inside StewardMD (NEET-PG, INI-CET first; NEET-SS, INI-SS, USMLE, NEET-UG later). The learning
loop of the spec stands: QUESTION -> WHY -> WHY NOT -> MISTAKE -> FLASHCARD -> FSRS -> MASTERY, six
experiences, exam profiles as config, MaiK as teacher.

**Revision 5 flips the default.** The product a student opens is a **ready-made shared bank with at least 100
questions per topic across every branch, specialty and subspecialty**. SOURCE -> DECK from a student's own
PDF or notes stays, with the design of revisions 2 to 4 unchanged, but as an optional feature that ships last.

One-line architecture: **three layers. A: the free MedMCQA bank for every subject ($0 AI). B: a one-time,
owner-run batch fill (Gemini 3.1 Flash-Lite, Batch price) for every topic below 100, released per specialty
only after a doctor-graded sample passes. C: optional PDF -> deck for the individual student, paid per deck and
capped.** Every layer uses the same engine, item format, gates and labels.

## 1. Decisions already made by the owner
| Topic | Decision | Basis |
|---|---|---|
| Default product | 100+ questions per topic, all branches, specialties and subspecialties, ready-made. PDF -> deck optional | Owner, 2026-10-05 |
| Generation model | `gemini-3.1-flash-lite` for every AI step | Prices read 2026-10-05: $0.25 in / $1.50 out per 1M; **Batch $0.125 / $0.75**. 3.5 Flash-Lite $0.30 / $2.50. Every Gemini 2.5 model retires on Vertex 2026-10-16 |
| Server defaults | `functions/_ai_usage.js`: `MODEL_HARD_DEFAULT` = `gemini-3.1-flash-lite`, `MODEL_RATES` Rs 0.024 / 0.144 per 1k | Verified |
| Offline models | MaiK Lite (1.7B) and MxCore (MedGemma 1.5 4B), llama.cpp, native only. **Teacher only**, never writer or reviewer | Small models fail at four plausible distractors with reasons |
| OCR | On the phone: pdf.js text layer; Apple Vision / ML Kit for scans (`native-bridge.js` `ocr()`). Never Gemini | "best, easy, cheap" |
| Bank first | A topic request is served from the bank; generation is the exception | This revision makes the bank the whole default |

## 2. Scope
### Layer A: free bank (Phases 1 to 2, $0 AI)
All 21 MedMCQA subjects, cleaned, de-duplicated, difficulty-tagged, doubtful-key flagged, mapped to the topic
taxonomy (section 6). Items are LICENSED provenance with the source's keys ("not clinically reviewed", as the
Tokós index says today). Topics with >= 100 clean items ship as is.

### Layer B: central fill (Phases 3 to 4)
For every taxonomy topic below 100 items (mostly subspecialty depth, which MedMCQA lacks), an owner-run batch
job generates the shortfall with the full pipeline (facts from an allowed source, key-first generation, server
gates, blind solve, review). Items are AI GENERATED + STEWARDMD provenance, go live per specialty after the
doctor-graded sample passes (section 8).

### Layer C: PDF -> deck (Phases 5 to 6, optional, paid per deck)
Pasted text and digital PDF first, scanned PDF after. Design of revisions 2 to 4 (sections 7, 9.2, 10.2) unchanged.

### Non-goals for v1
No per-session AI (mastery, plan, adaptive difficulty, mistake tags are code over FSRS state); no semantic
search over banks; no image questions; no "current reference" conflict check; no new scheduler; no PDF on
the server, ever; no verbatim copyrighted text in any shared item.

## 3. Corrections carried from revisions 2 to 4 (all verified against code; details in git history)
- Request protocol is one Gemini call per HTTP call (`aiDeadlineMs` 28 s, client gives up at 25 to 35 s).
- Per call: <= 15 facts (cap 1,536 out), <= 7 MCQs (3,000), solve (400), review (800).
- Facts are grounded by document-wide sentence numbers; the server fills quote, page, heading.
- Generator writes the key first; the server shuffles; a blind `solve` call (no key, no reasons in the prompt) must agree.
- Metering: `checkQuota` type `prep` (breaker and rate limit, not MaiK allowances); `gateAndCount` with
  `deferRecord` and a `commit(extra)` that merges real tokens and cost (today `q.commit` takes no arguments);
  `addDailyCostInr` exported and `bump(env, day, {"maik.cost"})` so the breaker and the console see prep.
  Never `_usage.js` `recordUsage` (MaiK rates, MaiK allowance).
- `_deid.js` is unusable for prep (deletes 4+ digit numbers and newlines); prep has `prepScrub`.
- Engine changes: three `I.getJSON` points behind `opts.source`, `EXAM_N`/`EXAM_SEC` from the profile,
  `srcLine` per topic (`lic`/`cite`), `validateIndex` file check from the source. No flashcard feature exists;
  `prep-cards.js` adds one; FSRS `gradeFor` is Again/Good.
- Quality bar: Wilson 95% lower bound >= 95% key-correct, which needs >= 197/200.
- `ophthalmos/decks/mcq.json` has no `licence`/`citation` and 0 flags; the 2026-09-28 "licence-verified
  sources only" decision is Ophthalmós-scoped; `tools/tokos-build-mcq.mjs` hard-codes OBGYN.
- Drift (not fixed here): `vault/Flags.md` says `smd_edge` OFF; `home.js` and the module note say ON since 2026-10-04.

## 4. Architecture
```
BUILD TIME (owner's Mac / CI, $0 or Batch)        RUNTIME (phone + server)
MedMCQA parquet -> tools/prep-build-bank.mjs      prep.js host on the specialty engine
  clean, dedupe, flags, difficulty, taxonomy map    taxonomy.json + per-subject index/search (bundled, ~3 MB)
  -> prep/bank/<subject>/<topic>.json              topic files on demand from /api/prep/bank/<subject>/<topic>.json
tools/prep-fill.mjs (Layer B)                        cached in IndexedDB; "download subject" for offline
  shortfall list -> sources -> Batch jobs          MCQ screen, cards, exam, FSRS, mastery (code)
  facts | mcq | gates | solve | review             Layer C: POST /api/ai/prep-generate {op} (section 7)
  -> prep/fill/<topic>.json + review sample        MaiK Lite / MxCore: offline teacher
Review Desk: kind "prep", stratified sample,
  per-specialty go-live switch
```

### Files
| Layer | File | Role |
|---|---|---|
| Data | `prep/taxonomy.json` | Versioned branch > specialty > subspecialty > topic tree with exam tags (section 6) |
| Data | `prep/bank/<subject>/index.json`, `search.json`, `<topic>.json` | Layer A, built, committed, served by the API route below |
| Data | `prep/fill/<topic>.json`, `prep/fill/reviews/` | Layer B items and their graded samples |
| Data | `prep/profiles/<exam>.json` | Exam profiles |
| Tools | `tools/prep-build-bank.mjs` | `tokos-build-mcq.mjs` generalised: subject argument, taxonomy mapping table per subject, same flags and difficulty. $0 AI |
| Tools | `tools/prep-fill.mjs` | Layer B batch driver: shortfall list, source packs, Batch submit/poll, gates, solve, review, sample export |
| Tools | `tools/prep-measure.mjs` | Phase 0 harness |
| Server | `functions/api/prep/bank/[[path]].js` | Serves bank files (static assets or R2) with long cache headers; the native app may only call `stewardmd.in/api/*` |
| Server | `functions/api/ai/_prep-generate.js`, `[[path]].js`, `_ai_usage.js`, `_usage.js` | Layer C ops and metering (revision 4 design) |
| Client | `prep.js`, `prep-loader.js`, `prep-bank.js` (taxonomy browser, subject download), `prep-cards.js`, `prep-create.js`, `prep-source.js`, `prep-decks.js`, `prep.css` | Host, browsing, cards, Layer C UI |
| Engine | `specialty-bank.js`, `specialty-core.js` | `opts.source`, `opts.exam`, per-topic `lic`/`cite`, 6.4 fields |
| Review | `review-desk.js`, `scripts/apply-reviews.mjs` | Kind `prep`: bank flagged keys per topic, Layer B samples, go-live per specialty |

## 5. Roadmap with exit criteria
| Phase | Build | Exit criteria |
|---|---|---|
| **0 Measure** (before any generation) | `tools/prep-measure.mjs` on Vertex, 5 sources, 100 kept questions, both temperatures; records tokens incl. thinking and cached, `finishReason`, model version, 429s, latency, Vertex `labels` for billing reconciliation; 50 seeded wrong keys for the solve catch rate; doctor grades 100 kept + 50 rejected. **Also runs the same 100 through Batch mode** to confirm half price and turnaround | Fitted cost within 20% of billing; Batch price and turnaround known; solve catch rate >= 90% on seeds; reject rate known; graded accuracy against the bar |
| **1 Bank build** ($0 AI) | `tools/prep-build-bank.mjs` over all 21 subjects; `prep/taxonomy.json` v1 (owner approves, decision 2); per-topic counts report `vault/plans/prep-bank-<date>.md` | Build reproducible from the pinned HF commit; every item mapped or in a per-subject "unmapped" topic; shortfall list per topic produced |
| **2 Bank app** ($0 AI) | `prep.js` host behind `smd_prep` OFF; taxonomy browser; on-demand topic files via `/api/prep/bank`; offline subject download; MCQ screen (`exp` only for bank items); flags, bookmarks, mistakes; cards from `exp` sentences (simple recall cards); FSRS; NEET-PG and INI-CET profiles; timed exam | `npm test` green; `test/run-prep-ui.mjs` passes; engine test forbids host names in engine files; zero AI calls; first topic opens in <= 2 s on 4G |
| **3 Fill pilot** | `tools/prep-fill.mjs` on 3 subspecialties (recommend cardiology, nephrology, medical oncology); sources per 6.3; Batch mode; Review Desk kind `prep`; 200-item graded sample each | Each pilot specialty passes 8.1; per-100-question cost within 20% of 9.1; doctor time per item measured |
| **4 Fill all** | Remaining shortfall topics in batches per specialty; go-live switch per specialty after its sample passes | Every taxonomy topic >= 100 live items or an owner-accepted exception list |
| **5 PDF -> deck, text and digital PDF** | Revision 4 design: `_prep-generate.js` ops, caps, metering, step loop; internal first | 200 graded per profile pass 8.1; one usage record per call with real tokens; token-cap stop and idempotent retry tested |
| **6 Scanned PDF, adapt, offline teacher** | Native OCR path; mastery, daily plan, "fix my weak areas" from unseen and missed items; Edge `start_mcq`; MaiK Lite / MxCore teacher grounded on stored reasons | OCR decks within 10 points of digital; plan never calls AI; teacher answer adds no drug or number absent from the grounding text |

## 6. Topic taxonomy and the two shared layers
### 6.1 Taxonomy (`prep/taxonomy.json`, versioned)
```
{ v: 1, branches: [ { id: "medicine", name, specialties: [ { id: "cardiology", name, sub: true,
    topics: [ { id: "card-hf", name: { en, hi }, ex: ["neet-pg", "ini-cet", "neet-ss", "ini-ss"], kb: ["heart-failure"], min: 100 } ] } ] } ] }
```
- Seed: MedMCQA `subject_name` (21 values) and `topic_name` (present on about half the items, messy: the
  Tokós builder already has a first-match table plus keyword rules for it), the 26 Specialty Kits for branch
  names, and the 144 `kb/diseases` entries for `kb` links.
- Size estimate: PG level, 19 clinical subjects x 12 to 18 topics (Tokós uses 17 for OBGYN) = **230 to 340
  topics**. Subspecialty level for NEET-SS / INI-SS: about 11 medical and 8 surgical superspecialties plus
  neonatology and a few paediatric ones, 8 to 12 topics each = **160 to 250 topics**. Total **400 to 600**;
  recommendation 450 for v1, with subspecialty topics tagged so they can ship in waves.
- Authorship: drafted by Claude from the seeds, **approved by the owner** (decision 2); each specialty's topic
  list can be delegated to one reviewing doctor. Versioned; items reference topic ids, so a split or merge is a
  data migration, not a regeneration.

### 6.2 Layer A: MedMCQA bank
- Source as stated by the coordinator (not re-verified here, no network in this session): train 182,822 +
  validation 4,183 answered rows, 21 subjects, licence MIT (repo) / Apache-2.0 (HF card); the builder embeds
  the MIT notice and pins the HF commit. Consistency check: the OBGYN build read 10,237 rows (5.5% of 187k) and
  kept 9,196 after drops and dedupe (90%), so **about 165k to 170k clean items** are expected overall.
- Per topic: 170k over 230 to 340 PG topics averages 500+, but the distribution is skewed; small subjects
  (Psychiatry, Radiology, Skin, Anaesthesia, Forensic, Dental) will have topics under 100. Estimate **15 to 25%
  of PG topics (35 to 85) fall short, average shortfall about 50 items**: 2,000 to 4,500 items. Subspecialty
  topics start near zero (a Medicine item maps to cardiology, but not at SS depth): **160 to 250 topics x 100 =
  16,000 to 25,000 items**. Layer B total: **18,000 to 30,000 items**. Phase 1 replaces these estimates with counts.
- Shipped as LICENSED, keys from the source, flagged items (dup-stem, dup-key, exp-letter, exp-text) excluded
  until a doctor clears them in Review Desk (existing per-topic row). `exp` shown as the explanation; no `r`/`kp`.
- Ophthalmology: rebuilt from MedMCQA by the same tool (gives it the missing `licence`/`citation` and flags); the
  current `ophthalmos/decks/mcq.json` stays for Ophthalmós until then.

### 6.3 Layer B: central fill
- Driver `tools/prep-fill.mjs`, owner-side, Vertex project, **Batch mode** ($0.125 / $0.75 per 1M). Same ops,
  schemas, gates, blind solve and review as Layer C (section 7); the only difference is the source and the
  batch transport. Pinned `PREP_MODEL`, `pv` and `mv` on every item.
- Allowed grounding sources, in order: StewardMD-authored KB disease pages and clinical protocols
  (`kb/diseases`, `kb/clinical-protocols`), StewardMD Learn units, open-licence texts (CC BY / CC0 / public
  domain, e.g. WHO, NIH/NCBI Bookshelf open chapters, StatPearls where its licence permits), and licensed
  material the owner has rights to. **Never a copyrighted textbook or commercial QBank**, even paraphrased by
  the model (decision 3). Each topic file records its source pack (`srcPack: [{id, licence, url}]`).
- Facts amortise: one source pack (30 to 50 pages) feeds all 100 questions of a topic, so a topic costs less
  per question than a student deck (9.1).
- Output per topic: `prep/fill/<topic>.json` (items with `prov: "SMD"`, `gen: "AI"`, `rv`), plus a stratified
  sample for Review Desk. Items are **invisible until the specialty's go-live switch** is set after 8.1.

## 7. Contracts (unchanged from revision 4, summarised)
- Request protocol, Layer C: `POST /api/ai/prep-generate` with `op: facts | mcq | solve | review`, one Gemini
  call each, `idem` key, errors `400 bad-input, 401 sign-in, 402 needs-plan, 413 too-large, 429 rate |
  circuit-breaker | daily-calls | daily-decks | token-cap | month-budget, 502 ai-failed, 504 ai-timeout`.
  Layer B runs the same four ops through the Batch API from the driver.
- Facts `{ ft, cq, sn, fk }`; MCQ `{ st, key: {ot, wr}, dis: [{ot, wr, et}] x3, kp, fi, dl, cog }`; solve
  `{ s: [{i, ot}] }`; review `{ g: [{i, g4, g6..g11, old, why}] }`.
- Stored item: engine `{id, q, o[4], a, exp, t, d}` plus `r[4], kp, et[4], cog, fid, src{doc, name, p, h, sn},
  prov: AI|LIC|SMD|USR|PUB, ex[], pv, mv, rv{solved, pass, old}`. Layer B adds `gen: "AI"` and `srcPack`.
- Card `{ id: "c_<sha12(deck + fid)>", fid, front: cq, back: ft, src, prov }`. Bank items without facts get a
  simple recall card (stem -> key + first `exp` sentence), built on the phone, no AI.
- Bank index per subject: engine shape (`id, v, licence, citation, modifications, topics[{id, title, count,
  file, lic, cite}]`); `search.json` as the Tokós builder emits (1.4 MB for 9,196 items).
- Exam profile `{ id, v, name, style, cog, d, stem, exam: { n, sec, negative } }`, numbers from the exam's
  current notification, filled by the profile author (decision 7).

## 8. Quality, review and safety
### 8.1 Doctor-graded sample: the real bottleneck
- Only **generated** items (Layer B, Layer C) need the bar. Layer A ships with source keys labelled "not
  clinically reviewed" (as Tokós does today) plus the flagged-key rows.
- Release unit = **specialty or subspecialty** that received Layer B items. Estimate 30 to 45 units
  (all SS specialties plus the PG subjects with shortfall topics).
- Per unit: 200 items, stratified across its topics and source packs, graded in Review Desk (rubric: key
  correct, single best answer, every distractor wrong, reasons accurate, source supports, exam-appropriate, no
  clue, may-be-outdated). **Pass = >= 197/200 key-correct** (Wilson 95% lower bound 95.7%; 196 gives 94.97%),
  >= 90% fully clean. 20% double-graded, clashes adjudicated. 100 per unit does not work: 99/100 gives 94.6%.
- Time: about 2 minutes per item with source at hand (measure in Phase 3). 30 to 45 units x 200 x 1.2 (double
  grading) = **7,200 to 10,800 gradings, 240 to 360 doctor-hours**. One doctor full time: 6 to 9 weeks. Five
  reviewers at 6 hours a week: 8 to 12 weeks. Failing units add a regeneration round and a fresh 200.
- **Recommendation (decision 4)**: owner names a reviewer per branch (medicine, surgery, paediatrics, basic
  sciences, others), 200 per unit, ship subspecialties in waves as each passes; Review Desk shows the queue and
  the Wilson bound live. Alternative the owner may prefer: 200 per branch (5 to 6 units, about 60 hours) with a
  weaker per-specialty guarantee, clearly labelled.
- Ongoing: student flags remove an item from circulation on that phone at once and queue it in Review Desk;
  flag rate per topic is a metric (section 11).

### 8.2 Labels and provenance
`prov` on every item: LIC (bank, licence line per topic), SMD + `gen: "AI"` ("AI-generated, doctor-sampled"),
AI (student deck, "AI-generated educational content"), USR, PUB. "May be outdated" when `rv.old`.

### 8.3 Copyright (decision 3)
Layer B grounds only on sources in 6.3. The model never receives commercial textbook or QBank text. Source
packs and their licences are committed next to the items. MedMCQA attribution kept as today.

### 8.4 Privacy (Layer C only)
PDF never leaves the phone; numbered sentences only; `prepScrub` keeps numbers and newlines; no server storage
beyond counters and a 10-minute idempotency record; sign-in and plan checked on the server; separate
IndexedDB from clinical stores.

## 9. Cost
### 9.1 One-time, Layer B (Batch price; per-question tokens from the revision 4 deck model, facts amortised over a topic)
Per topic of 100 accepted questions (140 generated at 30% reject): facts on a 40-page pack 45k in / 9k out;
`mcq` 20 calls 30k / 40k; `solve` 20 calls 28k / 2k; `review` 20 calls 76k / 6k; regen 10k / 4k.
Total about **190k in, 60k out = $0.024 + $0.045 = $0.07 per topic (Rs 6.7), $0.0007 per question.**

| Layer B size | Items | One-time AI cost | With 2x margin (thinking, higher rejects) |
|---|---|---|---|
| Pilot (3 subspecialties) | 3,000 | $2 (Rs 200) | Rs 400 |
| Low estimate | 18,000 | $13 (Rs 1,250) | Rs 2,500 |
| High estimate | 30,000 | $21 (Rs 2,000) | Rs 4,000 |
| Full 450 topics regenerated from scratch | 45,000 | $32 (Rs 3,000) | Rs 6,000 |

The AI bill is small; **doctor time is the cost** (8.1). Re-running a specialty after a prompt fix is Rs 50 to 100.

### 9.2 Per student (Layer C, interactive price, from revision 4)
50-page digital PDF, 25 questions kept: 85k to 110k in, 22k to 29k out, **$0.053 to 0.070 (Rs 5.1 to 6.7)**,
25 to 31 calls; each further 10 questions $0.011 to 0.013; pasted notes 10 questions about $0.013; lazy first
10 about $0.015. A 60-page deck runs 125k to 165k tokens. Study, exam, cards, bank: $0.

### 9.3 Runtime caps (Layer C only; defaults are proposals, decision 6)
Calls per day 150 (`AI_MODULES.prep.daily`, one record per call); decks per day 5; tokens per month Free 200k /
Trainee 1M (about 8 decks, Rs 50) / Pro 3M (`prep:tok:<uid>:<month>`); tokens per deck 200k; pages per deck 60;
`maxOutputTokens` 1,536 / 3,000 / 400 / 800; project breaker fed by `addDailyCostInr`. Layer A and B cost the
student nothing and have no caps.

### 9.4 Storage and delivery
- Layer A about 170k items x 0.9 KB (Tokós files measure 903 bytes per item with `exp`) = **about 150 MB**;
  Layer B 18k to 30k items x 1.3 KB (reasons, pearl, tags) = 25 to 40 MB; **total 175 to 190 MB**. Not bundled:
  the whole `www/` must stay small and the native app only talks to `stewardmd.in/api/*`.
- Bundled by default: `taxonomy.json` and the 21 per-subject `index.json` (about 200 KB). Downloaded on first
  open of a subject: its `search.json` (1 to 2 MB each; 21 subjects about 25 MB, so per subject, not all).
  Downloaded on demand and cached in IndexedDB: topic files (0.1 to 1 MB each). "Download for offline" per
  subject or specialty (3 to 10 MB), with a storage line in Settings. Service worker caches `/api/prep/bank/*`
  with `Cache-Control: immutable` and a version in the path (`/api/prep/bank/v1/...`).
- Serving: `functions/api/prep/bank/[[path]].js` reads Pages static assets (`prep/bank/` committed, like
  `tokos/decks/`) or R2 if the repo grows too much; owner decision 5 (repo size: 190 MB of JSON compresses to
  about 40 MB in git, acceptable; R2 avoids it).

## 10. Offline and Edge roles
| Job | Where | Cost |
|---|---|---|
| Browse, answer, exam, cards, mistakes, mastery, plan | phone, code | 0 |
| "10 questions on heart failure" | Edge rules (`start_mcq`, Phase 6) | 0 |
| "Why is B wrong?" | MaiK Lite / MxCore when installed, grounded on `r`, `kp`, source sentences; MaiK Cloud otherwise | 0 offline |
| Layer B fill | owner batch job | 9.1 |
| Layer C deck | Gemini 3.1 Flash-Lite, interactive | 9.2 |

## 11. Metrics and targets
| Metric | Target |
|---|---|
| Topics with >= 100 live items | 100% of taxonomy v1, or an owner-accepted exception list |
| Layer B key accuracy per unit | Wilson 95% lower bound >= 95% (>= 197/200) |
| Solve catch rate on seeded wrong keys (Phase 0) | >= 90% (measures only what the solver knows; shared errors show in the doctor grade) |
| Reject rate (code + solve + review) | <= 30% after tuning |
| Student flag rate per topic | <= 1% of attempts; alert at 3% |
| Doctor minutes per graded item | measured in Phase 3; drives 8.1 |
| Layer B cost per 100 accepted questions | <= $0.10 at Batch price |
| Layer C cost per 50-page deck | <= $0.07; alert at Rs 10 |
| First topic open on 4G | <= 2 s; offline subject download <= 10 MB |
| FSRS retention, repeat-error trend | about 0.9; falls week over week |

## 12. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Doctor review cannot keep up | Ship per specialty as each passes; Review Desk queue and live Wilson bound; owner picks 200 per unit or per branch (decision 4) |
| Copyright in Layer B sources | Allowed-source list, source pack committed per topic, no textbook or QBank text ever sent to the model (decision 3) |
| MedMCQA keys wrong (crowd-sourced) | LICENSED label "not clinically reviewed", flagged items excluded, student flags, per-topic flagged-key row in Review Desk |
| Taxonomy mapping errors (half the items lack `topic_name`) | Keyword tables per subject as in the Tokós builder, "unmapped" bucket per subject, counts report, owner review of the tree |
| Thinking billed or Batch slower than expected | Phase 0 runs Batch too; `finishReason` and `thoughtsTokenCount` logged |
| Reviewer rubber-stamps | Blind solve, gate fields, seeded wrong keys in Phase 0, graded sample |
| Bank too big for the app | Not bundled; per-subject indexes, on-demand topics, offline download per subject, immutable versioned paths |
| Native app may only call `/api/*` | Bank served through `functions/api/prep/bank/[[path]].js` |
| 3.1 Flash-Lite retired or repriced | `PREP_MODEL`, `MODEL_RATES`, `pv`/`mv` per item; a topic is reproducible from its source pack |
| Layer C abuse | Caps in 9.3, breaker, `ai:emergency` pause |
| Students paste patient notes (Layer C) | `prepScrub`, client warning, no server storage |

## 13. Open decisions for the owner
1. **Exam profiles in v1**: NEET-PG and INI-CET first; subspecialty topics carry NEET-SS / INI-SS tags from the start. Confirm. NEET-UG stays out until a minors/consent flow exists.
2. **Taxonomy**: approve the tree (recommend about 450 topics, section 6.1) and name who signs off per branch.
3. **Layer B sources**: confirm the allowed list (StewardMD KB and protocols, Learn units, open-licence texts, owner-licensed material) and that no copyrighted textbook or QBank text is ever used, even paraphrased.
4. **Doctor grading volume**: recommend 200 per specialty/subspecialty unit (240 to 360 doctor-hours in total, shipped in waves); alternative 200 per branch (about 60 hours, weaker guarantee). Name the reviewers.
5. **Bank hosting**: commit `prep/bank/` to the repo (about 40 MB compressed) or move to R2. Recommend repo for v1, R2 when it passes 300 MB.
6. **Layer C caps and plan placement** (9.3): Trainee or Pro only; monthly token budgets.
7. **Who writes exam profiles** and fills `exam.n/sec/negative` from the notifications.
8. Log for prep the "licence-verified sources or our own writing" rule (today Ophthalmós-scoped).

## 14. Verified against the code and data (2026-10-05, branch docs/prepnucleus-plan)
- `tools/tokos-build-mcq.mjs`: `SUBJECT = "Gynaecology & Obstetrics"`, 17 `SUBTOPICS`, `TOPIC_TABLE` first-match on `topic_name` plus keyword scoring, flags `exp-letter | exp-text | dup-key | dup-stem`, MIT notice, HF commit `91c6572c...`, test split unused.
- `tokos/decks/mcq/index.json` `stats.build`: read 10,237, after drops 10,179, after dedupe 9,196 (983 dups removed), 7,526 with explanation, 68 flagged, smallest topic 131; `search.json` 1,447,796 bytes; `ob-antenatal.json` 536,232 bytes for 835 items (642 bytes per item; 903 bytes per item across the 8.3 MB directory).
- `ophthalmos/decks/mcq.json`: keys `id, v, source, topics, items`, 3,035 items, 0 flagged, 2.5 MB.
- `kb/diseases`: 144 entries; `vault/Home.md`: 26 Specialty Kits. `review-desk.js`: bank rows per topic ("confirm the flagged answer keys").
- `specialty-shell.js` `getJSON` fetches `BASE + path`; `scripts/build-www.sh` copies `ophthalmos/decks` into `www/`; `wrangler.toml` has one R2 binding (`FOLLOWCARE_R2`), none for banks yet.
- `functions/_ai_usage.js`: `MODEL_RATES`, `gateAndCount` deferred `q.commit = rec` (no arguments, line 544), `realCostInr` reads `maik.cost` (579); `functions/_usage.js`: `checkQuota` breaker and 3 s rate limit, `addDailyCostInr` private, `recordUsage` MaiK rates; `functions/_counters.js` `bump(env, day, incs)`; `functions/_entitlements.js` `ROLES` (no `doctor`); `wrangler.toml` `AI_COST_CAP_ON` unset.
- `functions/api/ai/[[path]].js`: `aiDeadlineMs` 28,000, `deferRecord` only for `explain` (1698), `providerOrder` from `AI_PROVIDER`, `genBody` without `responseSchema` or `labels`.
- `specialty-bank.js`: `validateIndex`, three `I.getJSON` points, `EXAM_N`/`EXAM_SEC`, `srcLine`; `specialty-core.js` `gradeFor`; engine features bank/explore/learn/notes/tools/drills (no cards).
- Not verifiable offline: MedMCQA split sizes and the 21-subject list (taken from the coordinator; consistent with the OBGYN row count).
