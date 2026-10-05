---
tags: [plan, learning, ai, cost]
status: proposed (2026-10-05), revision of the owner's "PrepNucleus" spec (Document_8.docx)
owner-goal: "every PDF to MCQs must not cost much, as cheap as possible, best output"
---
# PrepNucleus (revised plan)

The product vision in the original spec stands: SOURCE -> DECK -> TEST -> MISTAKE -> FSRS -> MASTERY,
exam profiles as configuration, paste text before PDF, MaiK as the teacher. This revision changes HOW it is
built so that AI is paid for once per deck, never per study session, on the cheapest Gemini that is still
in service.

## What changed from the original spec
| Original | Revised | Why |
|---|---|---|
| Model unspecified, "large model only when needed" | **Gemini 3.1 Flash-Lite for every generation step** | Cheapest Gemini still in service (below) |
| Gemini 2.5 (owner asked) | Not used | Every 2.5 model retires on Vertex on 2026-10-16; 2.5 Flash-Lite already 404s on our Developer API key (`functions/_ai_usage.js`, 2026-08-24) |
| 11 new `prep-*.js` files + a new scheduler | One more specialty on the shared engine (`specialty-*.js`) | FSRS-6 (`specialty-core.js`), the MCQ bank format and the timed exam already exist |
| Mistake classification, mistake -> flashcard, "Fix my weaknesses" call the AI | Decided at generation time, then plain code | Cost no longer grows with study time |
| Separate AI medical review + source verification passes | Code gates + ONE cheap reviewer call per 10 questions | Gates 1, 2, 3, 5, 12 are code |
| AI writes the whole question object | AI writes stem, options, reasons, key point, error tags; code fills the rest | A quality flag the AI sets about itself proves nothing |
| PDF sent to the AI | Text extracted and OCR'd on the phone (free) | Input tokens are ~55% of the bill |
| 50 to 100 questions up front | 10 at a time | Most students never finish 100 |
| Every topic generates | Bank first, cache second, generate last | "Acute leukemia" from the bank costs $0 |

## Model decision (owner, 2026-10-05: "choose the cheapest model next available")
Gemini API list prices per 1M tokens, read 2026-10-05 (ai.google.dev/gemini-api/docs/pricing):

| Model | Input | Output | Use |
|---|---|---|---|
| 2.5 Flash-Lite | $0.10 | $0.40 | Unavailable: retires on Vertex 2026-10-16, and 404s on our Developer API key |
| **3.1 Flash-Lite** | **$0.25** | **$1.50** | **All PrepNucleus steps** (batch $0.125 / $0.75) |
| 3.5 Flash-Lite | $0.30 | $2.50 | Escalation only (see below) |
| 3.6 Flash | $0.75 | $3.75 | Not used (doubles to $1.50 / $7.50 on 2027-01-01) |

- **Escalation, not a stronger default:** a question the reviewer flags is regenerated ONCE on 3.1 Flash-Lite;
  if flagged again it is dropped and replaced, never escalated by default. Turn on escalation to
  3.5 Flash-Lite only if the doctor-graded sample (below) shows Flash-Lite questions failing.
- **Thinking off:** send `thinkingBudget: 0` (Gemini 3 still accepts it; never send it together with
  `thinkingLevel`, which is a 400). **Measure** whether 3.1 Flash-Lite bills thinking tokens anyway.
- **Temperature:** Google recommends 1.0 for Gemini 3 and warns lower values can loop. Run the sample at
  1.0 and at our usual 0.2; keep the one with fewer rejects and no repeated text.
- **JSON:** send `responseSchema` (the repo only sends `responseMimeType` today) with short keys, so every
  reply parses and nothing is paid twice.

## Can the offline models (MaiK Lite, MxCore) do it?
Partly. They cost $0 per call, but they are native-only (llama.cpp plugin, not the web build), slow, and
small. Facts from `maik-models.js`:
- **MaiK Lite:** our 1.7B fine-tune, 1.1 GB, 4k context, 10 to 20 s per answer.
- **MxCore:** MedGemma 1.5 4B, 2.5 GB, 4k context, 20 to 40 s per answer, needs about 8 GB RAM.

| Job | Offline? | Reason |
|---|---|---|
| "Give me 10 questions on lymphoma", "show my mistakes" | **Yes, already** | StewardMD Edge (rules + on-device router, ON for all) maps it to an action, no model needed |
| Explain again, "why is B wrong?", simpler wording, clinical example | **Yes: MaiK Lite / MxCore** | The stored per-option reason is the grounding, the same way they read the KB today. $0 per question asked |
| Fact extraction (step 1) | Labs option later | Possible on MxCore, but a 50-page chapter is 8+ calls at 4k context, several minutes and a hot phone, to save about $0.01 a deck |
| MCQ writing (step 2) and review (step 4) | **No** | Writing four plausible distractors with a reason each, and judging them, is where small models fail. Not worth the medical risk to save $0.016 a deck |
| FSRS, mastery, daily plan, adaptive difficulty, exams | **Yes, already plain code** | No model at all |

## Cost per deck (3.1 Flash-Lite)
Assumptions: a 50-page digital PDF, about 500 tokens per page after cleaning; 25 questions kept (29
generated); about 210 output tokens per question (reasons capped at 20 words); flashcards and pearls are the
step-1 facts, not a second generation.

| What | 3.1 Flash-Lite | (old 2.5 Flash, for comparison) |
|---|---|---|
| Full deck: 50 pages, 25 MCQs + flashcards | **$0.027 (Rs 2.6)** | $0.039 |
| Lazy: facts + first 10 questions | **$0.018** | |
| Each further 10 questions | **$0.007** | |
| Student picks 15 pages, 10 questions | **$0.010 (Rs 1)** | |
| Topic answered from the bank, or a cache hit | **$0** | $0 |
| Any study session, exam, mistake, flashcard review | **$0** | |

Estimates from token counts, not measured. Log real tokens per deck from day one and correct this table.

## Pipeline
```
Phone (free)       pdf.js text (img-compress.js pdfParts) or native OCR -> strip headers, footers, references,
                   TOC -> split by headings -> student picks chapters or pages (default: all, capped)
Bank first ($0)    topic request or heading names -> existing Vectorize + lexical search over licensed banks
                   enough questions? -> deck from the bank, stop
Cache ($0)         key = sha256(cleaned text + exam profile + prompt version) -> hit? -> stop
Step 1  3.1 FL     chunks -> testable facts [{f, page, sec, type}] -> these ARE the flashcards and pearls
Step 2  3.1 FL     10 chosen facts + their source sentence -> 10 MCQs, short-key JSON via responseSchema:
                   stem, 4 options, <=20-word reason each, key point, error tag per wrong option
Step 3  code       gates 1,2,3,5 + duplicate check (Workers AI embeddings) + shuffle + ids + metadata
Step 4  3.1 FL     10 questions per call, each with ONLY its source sentence -> [{i, ok, why}]
                   flagged -> regenerate once -> flagged again -> drop
Store              deck to the device (IndexedDB, not localStorage: ~5 MB cap); progress syncs
```

### Quality gates: who checks what
| Gate | Checked by |
|---|---|
| 1 four options, 2 one key, 3 no duplicate options, 5 no length clue, 12 not a near-duplicate | Code |
| 4 no grammar clue | Code (article/plural agreement heuristics), reviewer as backstop |
| 6 plausible distractors, 7 each distractor wrong, 8 explanation agrees, 9 source supports, 10 unambiguous, 11 exam difficulty | The one reviewer call |

## Mistakes, flashcards and adaptation without per-session AI
- **Mistake type:** step 2 tags every wrong option with the error it represents (knowledge gap, confused two
  concepts, missed exception, next-step error, ...). Choosing that option IS the classification.
- **Mistake -> flashcard:** the card (front from the stem's concept, back from the key point) is written in
  step 2 and stored unseen; a wrong answer only schedules it in FSRS.
- **Fix my weak areas:** pulls from weak topics' unseen and missed items. Generates (10 at a time) only when
  the pool runs dry.
- **Mastery, daily plan, adaptive difficulty:** code over FSRS state, accuracy, time-to-answer and tags.

## Reuse in the repo
- **Engine:** PrepNucleus is one more host on `specialty-core.js` / `specialty-bank.js` (FSRS-6, sessions,
  bank format `{id, q, o[4], a, exp, t, d}` with validation, lazy topic files, timed exam). Extend the
  format with optional `r` (reason per option), `kp` (key point), `et` (error tag per option) and `src`.
- **Banks:** 9,196 obstetrics/gynaecology and 3,035 ophthalmology MCQs (MedMCQA, MIT licence) are the first
  "bank first" sources. Adding per-option reasons to them is a one-time Batch job at half price.
- **Server:** one new route `POST /api/ai/prep-generate` in `functions/api/ai/[[path]].js` (Vertex first,
  Developer fallback, metering), with its own `prep` entry in `AI_MODULES`.

## Budgets and limits (missing from the original)
- `prep` module: a daily deck cap per student, a page cap per deck (start at 60), and a monthly cap.
- `functions/_usage.js` limits (`maxInputTokens: 4000`, 10 PDF pages) are too small for this route: give
  `prep` its own limits rather than raising the global ones.
- Reject a 1,000-page upload on the phone before any upload; MIME and size checks on the server.
- Cost logged per deck (tokens in/out per step, prompt version, rejects).

## Unchanged from the original
Exam profiles as versioned config; MCQ screen, after-answer "why right / why wrong / pearl"; exam simulator;
source grounding with page numbers; "AI-generated educational content" label; provenance
(PUBLIC / LICENSED / STEWARDMD / USER SOURCE / AI GENERATED); uploads deleted after generation unless saved;
never mixed with patient records; offline decks.

## Cut from v1
- The "current reference" source-conflict check (section 15): needs retrieval per question, scope undefined.
- Image questions from PDFs: needs a vision call per image.
- Scanned-PDF OCR on the web build (native OCR only at first).

## Roadmap (revised)
1. **Foundation:** PrepNucleus as a specialty host behind flag `smd_prep` (default OFF); bank format
   extended (`r`, `kp`, `et`, `src`); bookmarks, flags, saved mistakes; progress sync.
2. **Premium MCQ screen:** why right / why wrong / pearl from stored fields; mistake -> scheduled card.
3. **Mastery and daily plan:** code only.
4. **SOURCE -> DECK, paste text:** the pipeline above, 10 at a time, cache, logging.
5. **Quality bar:** a doctor-graded sample of 200 generated questions per exam profile; publish only if the
   reject rate and graded accuracy meet the bar the owner sets.
6. **PDF:** digital first, then native OCR.
7. **Offline teacher:** "why is B wrong?" on MaiK Lite / MxCore when a pack is installed.

## Decisions for the owner
1. Accept 3.1 Flash-Lite for writing AND reviewing, with escalation off until the graded sample says otherwise?
2. May a cached deck built from one student's upload be reused for another student's identical upload
   (section 32 copyright)? Default here: no; cache is per student.
3. Daily deck cap and page cap per plan (free vs Pro).
4. The quality bar for step 5 (for example: under 15% rejected, 95% of graded questions correct).
