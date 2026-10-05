---
tags: [plan, learning, ai, cost]
status: proposed (2026-10-05, revision 2), builds on the owner's "PrepNucleus" spec (Document_8.docx). Nothing built yet.
owner-goal: "every PDF to MCQs must not cost much, as cheap as possible, best output"; "best and easy cheap"
flag: smd_prep (planned, default OFF)
---
# PrepNucleus

Adaptive exam-prep layer (NEET-UG/PG/SS, INI-CET/SS, USMLE) inside StewardMD. The product vision of the
original spec stands unchanged: SOURCE -> DECK -> TEST -> MISTAKE -> FSRS -> MASTERY, six experiences
(Learn, Questions, Flashcards, Exams, Create, Progress), exam profiles as versioned config, MaiK as the
teacher. This document is the engineering plan: what is built, in what order, on what contracts, at what
cost, and what must be measured before any student sees an AI-written question.

One-line architecture: **AI is paid once per deck (never per study session), on Gemini 3.1 Flash-Lite, after
free on-phone extraction, after a free bank lookup, behind caps, and only after a measured pilot.**

## 1. Decisions already made by the owner (not reopened here)
| Topic | Decision | Basis |
|---|---|---|
| Generation model | `gemini-3.1-flash-lite` for every AI step (facts, MCQs, review) | Cheapest Gemini still in service. List prices read 2026-10-05 from ai.google.dev/gemini-api/docs/pricing: 3.1 Flash-Lite $0.25 in / $1.50 out per 1M (Batch $0.125 / $0.75); 3.5 Flash-Lite $0.30 / $2.50; 3.6 Flash $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50; 2.5 Flash-Lite $0.10 / $0.40 but every Gemini 2.5 model retires on Vertex on 2026-10-16 (Vertex release notes 2026-04-02) and it already 404s on our Developer API key (comment in `functions/_ai_usage.js`, 2026-08-24) |
| Server defaults | `functions/_ai_usage.js` on main (merged 2026-10-05, PR #1391): `MODEL_HARD_DEFAULT` = `gemini-3.1-flash-lite`, `ACCURATE_MODEL` = `gemini-3.5-flash-lite`, plus `MODEL_RETIRES` and `envModel`; `MODEL_RATES` prices both | Verified in code |
| Offline models | MaiK Lite (1.7B fine-tune, 1,107,408,704 bytes) and MxCore (MedGemma 1.5 4B, 2,489,894,976 bytes), both `nCtx: 4096`, llama.cpp via `local-plugins/capacitor-llama`, native only, 10 to 40 s per answer (`maik-models.js`, `maik-local.js`). **Offline teacher only** ("why is B wrong?", simpler wording). Never question writer or reviewer | Small models fail at four plausible distractors with reasons; saving is about $0.02 a deck |
| OCR | Digital PDFs: pdf.js text layer on the phone (`vendor/pdfjs/pdf.min.js`, `img-compress.js` `pdfParts`). Scanned pages: the app's on-device OCR through `native-bridge.js` `ocr()`: Apple Vision on iOS (`local-plugins/capacitor-vision-ocr`, `recognitionLevel = .accurate`), Google ML Kit on Android (`@capacitor-mlkit/text-recognition`; the vision-ocr plugin's Android side is digits only). OCR never costs Gemini tokens. `arcships/light-ocr` (PP-OCRv6) is desktop Node/C++ only: at most an owner-side Mac tool for building banks. LightOnOCR-2-1B is a later optional Labs download for table-heavy pages, gated by an on-phone test (speed, heat, quality vs Apple Vision on 10 scanned pages). Not v1 | Owner: "do as you wish, best, easy, cheap" |
| Bank first | A topic request is answered from licensed banks before anything is generated | "Acute leukemia" from the bank costs $0 |

## 2. Scope
### v1 (Phases 0 to 3)
- Questions and timed exam from the existing licensed banks, under a `prep` host of the specialty engine.
- Premium MCQ screen: why right, why wrong per option, exam pearl, source line, flag, bookmark.
- Mistake -> flashcard -> FSRS, from fields written at generation time (no AI during study).
- SOURCE -> DECK from pasted text, then digital PDF, then scanned PDF (native OCR). 10 questions at a time.
- Per-deck cost log, caps, cache, provenance labels, doctor-graded sample before exposure.

### Non-goals for v1 (explicit)
- No per-session AI: mastery, daily plan, adaptive difficulty, mistake classification and "fix my weak areas" are plain code over stored tags and FSRS state.
- No semantic (Vectorize) search over banks; lexical only (what `specialty-bank.js` does today).
- No "current reference" source-conflict check (spec section 15): needs retrieval per question; scope undefined.
- No image questions, no vision calls, no web build OCR, no shared knowledge graph.
- No new scheduler, no new `prep-*.js` constellation of 11 files: one host on the shared engine.
- No MCQ intent in StewardMD Edge in v1 (small new work, Phase 4).
- The server never receives a PDF. It receives extracted text only.

## 3. What this revision changes
| Original spec / revision 1 | Now | Why |
|---|---|---|
| Build the generator, then see what it costs | **Phase 0 measures first** (5 PDFs, 100 questions, both temperatures, thinking-token billing, reject rate, doctor grade) | Every number in section 9 is an estimate until then |
| Reviewer sees the question and one source sentence, returns `ok` | Reviewer sees the **surrounding paragraph**, answers **gate-specific yes/no fields**; `ok` is necessary, not sufficient | A single "ok" rubber-stamps |
| Doctor sample after launch | **200 doctor-graded questions per exam profile before any student sees generated questions** | Medicine; owner sets the bar |
| New route inside `functions/api/ai/[[path]].js` (230 KB) | Sibling file `functions/api/ai/_prep-generate.js` (prompts, schemas, sanitizers, pipeline), 20 lines of wiring in `[[path]].js` | Same pattern as `_maik-ask.js`, `_surgx-note.js` |
| "Vectorize + lexical search over banks" | **Lexical only**; Vectorize (`KB_VECTORIZE`) indexes KB disease pages, not banks (`functions/api/retrieve/[[path]].js`) | Wrong claim corrected |
| "Edge already maps 'give me 10 questions on lymphoma'" | Edge candidates are calculator, tool, kb, drug, icd, scheme (`edge-router.js`); **no MCQ kind exists** | Wrong claim corrected |
| "Vertex first, Developer fallback" for uploads | **Uploaded text goes to Vertex only**; `callGemini` fails over to the Developer API today (`providerOrder`), so prep passes a no-failover option (new) | Student text must not leave the Vertex project |
| Bank items used as is | Items carrying a doubtful-key flag are **excluded**; every bank item is labelled **LICENSED**; option reasons are added only to **doctor-approved** items (Review Desk) | 68 of 9,196 OBGYN items are flagged; keys are "not clinically reviewed" (`tokos/decks/mcq/index.json`) |
| Generated deck stored like a bank file | **Deck-source abstraction** in `specialty-bank.js`: static fetch or IndexedDB | Engine loads `I.getJSON(INDEX)` and `I.getJSON("decks/" + file)` today; those two calls become one interface |
| Budget "to be defined" | `prep` module in **both** registries, a page cap, a chars cap, a **hard per-deck token cap that stops generation**, a daily deck cap | Section 10 |

Drift found while verifying (not fixed here): `vault/Flags.md` says `smd_edge` is OFF; `vault/modules/StewardMD Edge.md` and `home.js` say default ON since 2026-10-04. Separate fix. Also `img-compress.js` `pdfParts()` has no production caller and no test yet.

## 4. Architecture
```
PHONE (free)                         SERVER (Cloudflare Pages Functions)            GOOGLE
pdf.js text layer / native OCR  ->   POST /api/ai/prep-generate                 ->  Vertex only
clean, split by headings             gate: prep module + caps + cache               gemini-3.1-flash-lite
pick pages (cap 60)                  step 1 facts  (1 call per chunk)               thinkingBudget: 0
bank first (lexical)                 step 2 MCQs   (1 call per 10)                  responseSchema JSON
IndexedDB deck store                 step 3 gates  (code)
specialty engine: FSRS-6, sessions   step 4 review (1 call per 10)
MCQ screen, exam, mastery (code)     log tokens per step, cost, rejects
MaiK Lite / MxCore: offline teacher  cache deck 30 days (KV, per student)
```

### Files
| Layer | File | Role |
|---|---|---|
| Client | `prep.js` | `SPECIALTY.createHost({id:"prep", flag:"smd_prep", storeKey:"smd_prep_v1", ...})` like `tokos.js`; registers banks, exam, create, progress |
| Client | `prep-loader.js` | Boot stub; engine and prep files load on first open (pattern: `tokos-loader.js`) |
| Client | `prep-create.js` | SOURCE -> DECK screen, progress, "10 more" |
| Client | `prep-source.js` | pdf.js text layer, `native-bridge.js` `ocr()` for scanned pages, cleaning, heading split, page picker, caps |
| Client | `prep-decks.js` | IndexedDB store (`prep-decks`, `prep-items`), deck-source for the engine, export/delete |
| Client | `prep.css` | Under `.prep-root`, `--sp-*` tokens |
| Data | `prep/profiles/<exam>.json`, `prep/decks/...` | Exam profiles (versioned), static StewardMD decks. `scripts/build-www.sh` needs a copy line like the `tokos/` one |
| Engine | `specialty-bank.js` | `opts.source` (section 6.6); `validateItems` accepts the optional fields of section 6.2 |
| Server | `functions/api/ai/_prep-generate.js` | Prompts, `responseSchema`s, sanitizers, gates, pipeline, cost log |
| Server | `functions/api/ai/[[path]].js` | `seg === "prep-generate"` dispatch, `MODULE_FOR["prep-generate"] = "prep"`, import |
| Server | `functions/_ai_usage.js` | `AI_MODULES.prep` |
| Tools | `tools/prep-measure.mjs` | Phase 0 harness (dev only, never shipped) |
| Tests | `test/prep-*.test.mjs`, `test/run-prep-ui.mjs` | Unit (pure helpers, route with mocked `generateContent` as in `test/ai-router-model.test.mjs`), headless CDP UI (as `test/run-specialty-ui.mjs`) |

Module registration is in two places and both are needed: `AI_MODULES` in `functions/_ai_usage.js` (label,
daily cap, `AI_LIMIT_PREP` env override, admin KV override through `resolveLimit`) and `MODULE_FOR` in
`functions/api/ai/[[path]].js` (which segment meters against which module; the gate block calls
`gateAndCount(env, store, _mod, ...)`). Caps are enforced only when `MAIK_ENFORCE_CAPS=1` (`capsEnforced`).

## 5. Roadmap with exit criteria
No phase spends AI money before Phase 0 passes. Phases 1, 4, 5 and 6 cost $0 in AI.

| Phase | Build | Exit criteria |
|---|---|---|
| **0 Measure** (owner key, no app code) | `tools/prep-measure.mjs`: 5 PDFs (2 digital textbook chapters, 1 two-column, 1 scanned, 1 pasted notes), 100 kept questions, at temperature 1.0 and 0.2, `thinkingBudget: 0`. Records per step: `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, wall time, parse failures, code-gate rejects, reviewer rejects. A doctor grades the 100 with the rubric in 8.3. Output: `vault/plans/prep-measure-<date>.md` | Cost per 50-page deck known within 20%; thinking billing known; temperature chosen (fewer rejects, no repeated text); reject rate known; graded accuracy against the owner's bar. Fail -> fix prompts or model before any UI |
| **1 Foundation** ($0 AI) | `prep.js` host behind `smd_prep` OFF; banks (OBGYN 9,196, Ophthalmology 3,035) as LICENSED sources with flagged items excluded; MCQ screen (why right / why wrong from `r` when present, else `exp`); flags, bookmarks, saved mistakes; FSRS via `specialty-core.js`; deck-source abstraction; IndexedDB store; exam profiles as config | `npm test` green; `test/run-prep-ui.mjs` passes; engine test still forbids host names in engine files; zero AI calls in the network log |
| **2 Create from pasted text** (internal) | `_prep-generate.js` pipeline, `prep` module, caps, cache, cost log, Vertex-only, 10 at a time, "10 more"; flag stays OFF for students | 200 doctor-graded questions per exam profile meet the owner's bar (8.3); cost log matches Phase 0 within 20%; token cap stop tested |
| **3 PDF** | Digital PDF via pdf.js text layer with page picker and 60-page cap; scanned pages via native OCR; source line "Page 84" and "View source" opens the page | 10-PDF test set: text extraction correct on 9; OCR deck accepted at the same rate as digital within 10 points; no Gemini tokens for OCR |
| **4 Adapt** ($0 AI) | Mastery per topic/subtopic, daily plan, adaptive difficulty, mistake tags, "fix my weak areas" from unseen and missed items (generates 10 only when the pool is dry); Edge MCQ intent (`{action:"start_mcq", topic, count}`) | Unit-tested over fixture FSRS state; plan never calls AI |
| **5 Exam** ($0 AI) | Timed exam per profile (engine `examDraw`, `EXAM_N`/`EXAM_SEC` made profile-driven), analysis screen, weak areas | Headless exam run passes; results feed Phase 4 |
| **6 Offline teacher** ($0 AI) | "Why is B wrong?" / "explain again" on MaiK Lite / MxCore when a pack is installed, grounded on the stored `r` and `kp` | Answer stays within the stored reason (no new drug, dose or diagnosis); 10-20 s on MaiK Lite |
| Later, optional | Option reasons for approved bank items via Batch API (half price); LightOnOCR Labs test; images; "Save source to my library"; shared cache (owner decision) | Each behind its own flag |

## 6. Data contracts
Short keys everywhere the model writes (fewer output tokens) and in storage (phone parses less).

### 6.1 Model output (step 1, facts) `responseSchema`
```
{ f: [ { t: "testable fact, one sentence",
         c: "the source sentence, verbatim, <= 40 words",
         p: 12,                       // page (1-based) or null for pasted text
         s: "Management of ACS",      // heading, may be ""
         k: "recall|mechanism|dx|mgmt|next|guideline|calc|adverse" } ] }
```
Cap: `f.length <= 3 x pages in chunk`, 60 max per call. These facts are the flashcards and pearls; no second generation.

### 6.2 Model output (step 2, MCQs) `responseSchema`
```
{ q: [ { s: "stem (vignette or direct), <= 90 words",
         o: ["", "", "", ""],                 // exactly 4
         a: 0,                                // index of the key
         r: ["", "", "", ""],                 // why right / why wrong, <= 20 words each
         kp: "exam pearl, <= 25 words",
         et: [null, "confused", "exception", "next"],   // error tag per WRONG option, null on the key
         fi: 3,                               // index into the facts given in the prompt
         d: 2,                                // 1 easy 2 medium 3 hard
         cog: "recall|application|reasoning" } ] }
```
`et` enum (from spec section 19, generation-time subset): `knowledge`, `confused`, `exception`, `dx`, `mgmt`,
`next`, `guideline`, `calc`. `misread` is a learner self-report tap after a wrong answer, never a model output.

### 6.3 Model output (step 4, review) `responseSchema`
```
{ r: [ { i: 0,
         g6: true,   // every distractor medically plausible
         g7: true,   // every distractor genuinely wrong
         g8: true,   // reasons and key agree with each other
         g9: true,   // the source paragraph supports the key
         g10: true,  // exactly one defensible best answer
         g11: true,  // difficulty fits the exam profile
         ok: true,
         why: "<= 20 words, only when something is false" } ] }
```
Accept only if `ok` AND every `g*` is true. One false -> regenerate that question once (step 2, same fact,
"avoid: <why>") -> review again -> still false -> drop. Never escalate to a bigger model by default.

### 6.4 Stored item (extends the engine format `{id, q, o[4], a, exp, t, d, flags?}`)
```
{ id: "p_8f3a2c1d", q, o: [4], a: 0, exp: "", t: "topic-id", d: 2,
  r: [4]?, kp?, et: [4]?, cog?,
  src?: { doc: "sha12", name: "Harrison AML.pdf", p: [82, 83], s: "HER2-positive disease", c: "source sentence" },
  prov: "AI" | "LIC" | "SMD" | "USR" | "PUB",      // AI GENERATED, LICENSED, STEWARDMD, USER SOURCE, PUBLIC
  ex: ["ini-ss"], pv: "p1", mv: "gemini-3.1-flash-lite",   // exam profiles, prompt version, model
  rv: { ok: true, g: 6 }?,                         // reviewer result (count of gates passed)
  flags?: [] }
```
`exp` stays for bank items; for generated items `exp` = `r[a]`. `validateItems` gains: `r`/`et` are arrays of
4 when present, `prov` is one of five values, `src.p` is an int list.

### 6.5 Deck manifest (generated deck, in IndexedDB)
```
{ id: "gen_<sha12 of cache key>", v: 1, title, exam: "ini-ss", profileV: 3,
  source: { type: "paste|pdf|topic", name, pages: [1, 50], sha: "<sha256 of cleaned text>", kept: false },
  prov: "AI", label: "AI-generated educational content", model, pv: "p1", created: 1759600000000,
  stats: { facts: 118, generated: 34, accepted: 25, rejected: 9, regenerated: 6, cards: 118 },
  cost: { inTok, outTok, thinkTok, inr, stopped: null | "token-cap" | "deck-cap" | "page-cap" },
  topics: [ { id: "sec-3", title: { en: "Management" }, count: 9, file: "idb:gen_x/sec-3" } ],
  reviewed: false }
```
Same shape as `decks/mcq/index.json` so the engine's `topics()`/`validateIndex` apply; `file` prefixed `idb:` is served by the IndexedDB source.

### 6.6 Deck source (engine)
`SP.features.bank(host, {source})` where `source = { index(): Promise<manifest>, topic(file): Promise<{items}>, search?(): Promise<sx> }`.
Default source = today's static `I.getJSON`. Generated source = `prep-decks.js` reading IndexedDB. The two
`I.getJSON` calls in `load()` and `loadTopic()` are the only change inside `specialty-bank.js`.

### 6.7 Cache key (server, KV, 30-day TTL)
```
"prep:deck:" + sha256(normText + "|" + exam + "|" + profileV + "|" + promptV + "|" + model + "|" + ownerScope)
```
`normText` = cleaned text, whitespace collapsed, lower-cased; `ownerScope` = hashed uid (default) or `"shared"`
(only if the owner decides decision 2). Hit = $0 and instant. Same pattern as `functions/_maik_cache.js`
(`maik:ans:` keys, SHA-256 of normalised input, version component).

### 6.8 Cost log (server, per deck; no text, no PHI)
Each Gemini call already lands in `buildUsageRecord` (`module`, `feature`, `model`, `promptTokens`,
`completionTokens`, `estCostInr`), with `feature` = `prep:facts | prep:mcq | prep:review`. Note that
`metered tokens` folds `thoughtsTokenCount` into output (`[[path]].js`, usage parsing), so the deck summary
records thinking separately:
```
{ k: "prep:log:<deckId>", uid: "<hash>", ts, model, pv, exam, pages, chars,
  steps: [ { step: "facts|mcq|review|regen", calls, inTok, outTok, thinkTok, ms } ],
  facts, generated, accepted, rejected, regenerated, inr, stopped: null | "token-cap" | ... }
```
Daily rollup through `_counters.js` (`aiu.mod.prep`), visible in the AI Control Center like every module.

### 6.9 Exam profile (config, versioned)
```
prep/profiles/ini-ss.json
{ id: "ini-ss", v: 3, name: "INI-SS", style: "advanced subspecialty, trials and guidelines, molecular, rare but exam-relevant",
  cog: { recall: 0.2, application: 0.4, reasoning: 0.4 }, d: { 1: 0.1, 2: 0.4, 3: 0.5 },
  stem: "clinical vignette", exam: { n: 100, sec: 72, negative: 0.33 } }
```
The profile text is injected into the step 2 and step 4 prompts; `cog`/`d` drive the per-call mix; `exam` drives the simulator.

## 7. Prompts (shape, not text)
| Step | Inputs | Output | Limits |
|---|---|---|---|
| 1 Facts | System: role, "only facts stated in the text", fact kinds. User: one chunk (<= 6,000 tokens, split at headings), page markers `[[p12]]` | 6.1 schema | `maxOutputTokens` 2,048; temperature from Phase 0; `thinkingBudget: 0` (never together with `thinkingLevel`, a 400) |
| 2 MCQs | System: exam profile text, single-best-answer rules, "distractors must be plausible and each wrong for a stated reason", "no grammar or length clues", short keys. User: 10 to 14 facts with their `c` sentences, requested `d`/`cog` mix, list of stems already in the deck (dedupe) | 6.2 schema | `maxOutputTokens` 3,500 per call; one call per 10 kept (14 generated at the measured reject rate) |
| 4 Review | System: "You are the examiner. Judge each gate independently. Default to false when unsure." User: 10 questions, each with its `c` sentence AND the surrounding paragraph (<= 250 tokens) | 6.3 schema | `maxOutputTokens` 800; same model; `fi`-matched paragraph only, never the whole document |
| Regenerate | Step 2 prompt + "previous attempt failed gate g9: <why>; write a different question on the same fact" | 6.2 | Once per fact |

All three send `generationConfig.responseSchema` (new; the repo sends only `responseMimeType` today in
`genBody`) so replies parse first time and nothing is paid twice. Sanitizers in `_prep-generate.js` whitelist
every field (pattern: `sanitizeMaikNext`).

## 8. Quality and medical safety
### 8.1 Gates: who checks what
| Gate (spec section 13) | Checked by | How |
|---|---|---|
| 1 exactly four options | Code | schema + sanitizer |
| 2 exactly one key | Code | `a` in 0..3, `et[a] === null` |
| 3 no duplicate options | Code | normalised text compare |
| 4 no grammatical clue | Code heuristics (article/plural agreement between stem end and options), reviewer backstop | |
| 5 no length clue | Code | key length within 1.6x of the median distractor |
| 6 plausible distractors, 7 each distractor wrong, 8 reasons agree with key, 9 source supports key, 10 unambiguous, 11 exam difficulty | Reviewer call | gate fields g6..g11, all must be true |
| 12 not a near-duplicate | Code | token Jaccard >= 0.6 against deck stems and the bank search index; Workers AI embeddings only if Phase 0 shows Jaccard misses |
| Key balance | Code | shuffle so keys are spread across A to D |

### 8.2 Labels and provenance
- Every item carries `prov`. UI shows "AI-generated educational content" on `AI`, the licence line on `LIC`
  (the index's `citation`, `licence`, `modifications`, as `specialty-bank.js` `srcLine` does today), "Your source"
  on `USR`.
- Generated items are never written into a shared bank. A deck lives on one student's phone (and in their
  KV cache). Promotion to `SMD` provenance only via Review Desk approval and a committed data file.
- Content only from licence-verified sources or our own writing (decision 2026-09-28, `vault/decisions/Decisions.md`).

### 8.3 Doctor-graded sample (before exposure)
200 generated questions per exam profile, graded in Review Desk (new kind `prep`, same JSON export and
`scripts/apply-reviews.mjs` flow as Tokós items). Rubric per question: key correct; single best answer;
every distractor wrong; reasons accurate; source supports; exam-appropriate; no clue. The owner sets the bar
(decision 4); suggested default: >= 95% key-correct, >= 90% fully clean, reject rate <= 30%.

### 8.4 Copyright
- Students may generate from their own notes, their own PDFs, licensed banks, StewardMD content, public-domain
  material. The upload screen says so and the student confirms once per source.
- No commercial QBank content is reproduced into a shared store; decks are private by default (decision 2).
- Bank attribution is kept from `index.json` (MedMCQA MIT, pinned HF commit `91c6572c...` for OBGYN).

### 8.5 Privacy and security
- The PDF never leaves the phone. Only cleaned text travels, over the existing authenticated `/api/ai` route.
- Server: process in request, cache the deck (not the source), log tokens only. Source text is never stored
  server-side. "Save this source to my library" (later) stores on the phone only.
- Delete source by default: the client drops the extracted text when the deck is saved.
- Students paste case notes: client warns, server runs `functions/_deid.js` over pasted text before the model
  (a question on a topic loses nothing; names, UHIDs, phones do).
- Separate `storeKey` and IndexedDB database from every clinical store; nothing joins patient records.
- Limits: text body <= 400 KB, pages <= 60, MIME `application/json` only, same rate limit as other AI calls.

## 9. Cost
Estimate, to be replaced by Phase 0 measurement. Assumptions: textbook page 900 to 1,300 tokens after
cleaning; 260 to 300 output tokens per MCQ; 25 to 40% rejected before tuning; thinking not billed with
`thinkingBudget: 0` (unverified for 3.1 Flash-Lite; if billed, output roughly doubles). Prices from section 1.
Rs at 96 per USD (the rate `_ai_usage.js` uses).

### 9.1 Per step, 50-page digital PDF, 25 questions kept
| Step | Model | Calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|---|
| Phone extraction, cleaning, OCR | none | 0 | 0 | 0 | 0 |
| Bank lookup, cache check | none | 0 | 0 | 0 | 0 |
| 1 Facts | 3.1 Flash-Lite | 9 to 11 chunks | 45k to 65k | 4k to 8k | 0.017 to 0.028 |
| 2 MCQs (34 to 42 generated) | 3.1 Flash-Lite | 3 to 5 | 8k to 12k | 9k to 13k | 0.016 to 0.023 |
| 3 Gates | code | 0 | 0 | 0 | 0 |
| 4 Review | 3.1 Flash-Lite | 3 to 5 | 18k to 30k | 1.2k to 2k | 0.006 to 0.010 |
| Regenerate + re-review | 3.1 Flash-Lite | 0 to 2 | 3k to 8k | 2k to 4k | 0.004 to 0.008 |
| **Deck total** | | | | | **0.03 to 0.08 (Rs 3 to 8)** |

| Scenario | USD (estimate) |
|---|---|
| Lazy: facts + first 10 questions | 0.02 to 0.04 |
| Each further 10 questions | 0.007 to 0.012 |
| Pasted notes (2,000 words), 10 questions | about 0.01 |
| Student picks 15 pages, 10 questions | about 0.015 |
| Topic from the bank, cache hit, any study session, exam, flashcard, mistake | 0 |
| Worst case if thinking is billed | up to 2x the above |

### 9.2 Levers, largest first
1. Bank first and cache: a hit is $0.
2. Fewer input tokens: phone extraction, strip headers/footers/references/TOC, page picker, 60-page cap (input is roughly half the bill).
3. Fewer rejects: prompt tuning from Phase 0 data (each reject costs a write plus a review).
4. Lazy generation: 10 at a time; most students never finish 100.
5. Short keys, `responseSchema`, 20-word reasons: output tokens are 6x the input price.
6. Batch API (half price) for offline jobs only (bank option reasons), never for interactive decks.
7. Escalation to 3.5 Flash-Lite off by default; turn on only if the graded sample fails on Flash-Lite.

### 9.3 Caps
| Cap | Where | Default (owner decides, decision 3) |
|---|---|---|
| Decks per day | `AI_MODULES.prep.daily`, `AI_LIMIT_PREP`, admin KV | 5 |
| Pages per deck | client + server (`PREP_PAGE_CAP`) | 60 |
| Text per deck | client + server (`PREP_CHARS_CAP`) | 300,000 chars |
| **Tokens per deck (hard stop)** | server counter per deck id in KV, checked before every call (`PREP_DECK_TOKEN_CAP`) | 150,000 total; stop, return the accepted questions so far, `stopped: "token-cap"` |
| Output per call | `maxOutputTokens` per step (section 7) | 2,048 / 3,500 / 800 |
| Monthly spend | existing `functions/_aibudget.js` allowance when `AI_BUDGET_ON`, daily rupee cap in `_credits.js` when `AI_COST_CAP_ON` | as configured |
| Existing MaiK limits | `functions/_usage.js` (`maxInputTokens` 4,000, 10 PDF pages per report) are MaiK's; prep gets its own, the globals are not raised | |

## 10. Bank first
- Sources today: `tokos/decks/mcq/` (OBGYN, 9,196 items, 17 topics, MIT, 7,526 with explanation, 68 flagged) and
  `ophthalmos/decks/mcq.json` (3,035 items, one file, `source: "medmcqa"`). Build tool: `tools/tokos-build-mcq.mjs`
  (dev only) with flags `exp-letter`, `exp-text`, `dup-key`, `dup-stem`.
- Matching a topic request is lexical: the engine's `searchIndex` (inverted `search.json`) or `search()` over loaded
  topics. "Enough questions" = at least the requested count at the requested difficulty after excluding flagged items.
- Items with any flag are excluded from prep sets until a doctor clears them in Review Desk (which already lists
  "confirm the flagged answer keys" per Tokós topic).
- Bank items show `exp` only; `r`/`kp`/`et` for bank items come from a one-time Batch job run **only on items a
  doctor approved**, committed as data with `prov: "LIC"`, reasons labelled AI-written. Not v1.
- Ophthalmology's single-file deck should be split to the index + topic files format before it joins prep (the engine's lazy loading assumes it).

## 11. Offline and Edge roles
| Job | Where | Cost |
|---|---|---|
| "Give me 10 questions on lymphoma", "show my mistakes" | Edge rules (new `start_mcq` candidate kind, Phase 4) | 0 |
| Explain again, "why is B wrong?", clinical example | MaiK Lite / MxCore when installed, grounded on stored `r`, `kp`, `c`; MaiK Cloud otherwise (existing metering) | 0 offline |
| Facts, MCQs, review | Gemini 3.1 Flash-Lite | section 9 |
| FSRS, mastery, plan, adaptive difficulty, exam, mistake tags | code | 0 |

## 12. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Thinking tokens billed despite `thinkingBudget: 0` | Phase 0 reads `thoughtsTokenCount`; if billed, cost table doubles and the owner re-decides before Phase 2 |
| 3.1 Flash-Lite retired or repriced | Model by env/KV override (`resolveModel`), `MODEL_RATES` keeps prices, `pv`/`mv` on every item; a deck is reproducible from its manifest |
| Reviewer rubber-stamps | Gate fields, "default to false", paragraph context, doctor sample of 200 per profile, ongoing 2% random re-grade |
| Wrong key reaches a student | Label on every AI item, flag button, flagged items removed from circulation on the phone at once |
| Hallucinated page reference | `src.c` must appear verbatim in the chunk text (code check) or the item is dropped |
| pdf.js text layer garbage (two-column, ligatures, tables) | Phase 0 includes a two-column PDF; cleaning heuristics; fall back to OCR of that page when the text layer has < 200 chars or > 10% non-words |
| Android OCR weaker (ML Kit: no per-line confidence, no language correction knob) | Phase 3 test set on both platforms; LightOnOCR Labs test only if Android lags by > 10 points |
| IndexedDB evicted under storage pressure | Deck re-fetched from the KV cache (30 days) by cache key; manifest also mirrored in `localStorage` (small) |
| Students paste patient notes | `_deid.js` pass, client warning, no server storage of text |
| Cost abuse (long loops of "10 more") | Deck token cap, daily deck cap, per-user cost cap, owner kill switch (`ai:emergency` pause) |
| Phone heat / time on 300-page uploads | Page picker, 60-page cap, extraction in a Web Worker, progress UI |
| `requireUser`-style 500s or fail-open gates | Prep gate returns 429/402 JSON like the other segments; metering stays fail-open as the route does |

## 13. Metrics and targets
| Metric | Target (first review after Phase 2) |
|---|---|
| Reject rate (code + reviewer) | <= 30% after tuning; trend down per prompt version |
| Doctor-graded key accuracy | >= 95% (owner bar, decision 4) |
| Source-grounding check pass | >= 98% of accepted items (`c` verbatim in chunk) |
| Near-duplicate rate in a deck | <= 2% |
| Measured cost per 50-page deck | <= $0.08; alert if a deck exceeds Rs 10 |
| Cache hit rate on repeat uploads | reported; no target yet |
| Time to first 10 questions (p50) | <= 60 s on a 50-page digital PDF |
| Study: repeat-error rate on tagged concepts | falls week over week for active learners |
| FSRS retention at review | about 0.9 (engine default request retention) |
| Product: deck completion, questions per session, flagged-item rate | reported in the AI Control Center |

## 14. Open decisions for the owner
1. Quality bar for the graded sample (suggested: >= 95% key-correct, >= 90% fully clean, <= 30% rejects) and who grades.
2. May a deck cached from one student's upload serve another student's byte-identical upload? Default here: no.
3. Caps per plan: decks per day, pages per deck, token cap (defaults in 9.3), and whether Create is Pro, Trainee, or free with a trial (one trial per feature is the engine's existing pattern).
4. Audience: PrepNucleus serves UG students (NEET-UG), which the app's `student`/`trainee` role covers (`vault/Role-Tiers.md`); confirm it is visible to that role and not clinician-only.
5. Escalation to 3.5 Flash-Lite: off until the graded sample says otherwise. Confirm.
6. Who writes and versions the exam profiles (section 6.9), and whether USMLE ships in v1.
7. "Save this source to my library" in v1 or later (default: later, phone-only).

## 15. Verified against the code (2026-10-05, branch docs/prepnucleus-plan)
- `functions/_ai_usage.js`: `AI_MODULES` registry, `moduleDailyLimit`/`resolveLimit`, `capsEnforced`, `MODEL_RATES` with 3.1/3.5 Flash-Lite, `buildUsageRecord` fields, `gateAndCount`, `MODEL_HARD_DEFAULT` (`gemini-3.1-flash-lite`), `ACCURATE_MODEL`, `MODEL_RETIRES`, `envModel`.
- `functions/api/ai/[[path]].js`: `MODULE_FOR`, `genBody` (temperature 0.2 default, `thinkingBudget: 0`, `responseMimeType` only), `callGemini` + `providerOrder` (Vertex then Developer with failover, no per-call pin), usage parsing adds `thoughtsTokenCount` to output, `MAX_IN_CHARS` from `MAIK_MAX_INPUT_TOKENS`.
- `functions/_usage.js`: `usageConfig` limits; `functions/_maik_cache.js`: KV cache pattern; `functions/_counters.js`: D1 rollups; `functions/_deid.js`; `functions/_aibudget.js`; `functions/_credits.js` (imported by `_ai_usage.js`).
- `specialty-core.js` (FSRS-6 from ts-fsrs 5.4.2), `specialty-bank.js` (formats, `validateItems`, lexical `search`/`searchIndex`, `examDraw`, `I.getJSON` load points, user `flags`), `specialty-data.js` (localStorage store per host, trials), `tokos.js` (host config), `tokos-loader.js`, `scripts/build-www.sh` (tokos data copy).
- Banks: `tokos/decks/mcq/index.json` stats; `ophthalmos/decks/mcq.json`; `tools/tokos-build-mcq.mjs`; `review-desk.js` bank rows.
- Vectorize scope: `wrangler.toml` `KB_VECTORIZE`, `functions/api/retrieve/[[path]].js`.
- Edge kinds: `edge-router.js`; flag state: `home.js`, `vault/modules/StewardMD Edge.md` vs `vault/Flags.md`.
- OCR/PDF: `native-bridge.js` `ocr()`, `local-plugins/capacitor-vision-ocr` (iOS `detectText`, Android `readDigits` only), `img-compress.js` `pdfParts`, `vendor/pdfjs`.
- Offline models: `maik-models.js` (bytes, `nCtx`, timings), `maik-local.js` (`P.Llama`, native).
- Tests to copy: `test/ai-router-model.test.mjs`, `test/run-specialty-ui.mjs`, `test/specialty-bank.test.mjs`.
