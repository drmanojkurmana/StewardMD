# MaiK Clinical Decision Engine — Brain Architecture (Part 1)

Status: **approved (architecture + phasing)**, 2026-07-30. Author: owner spec + Claude.
Scope: reasoning-pipeline refactor only. **UI unchanged.** Flag-gated, reversible.

## Objective

Redesign MaiK's reasoning so it behaves like an experienced physician, not a retrieval
chatbot. Every query (typed or voice) flows through one deterministic, modular pipeline
that prioritises, in order: understand intent → is it medical → clarify if needed → use
local deterministic knowledge → use Gemini only for real synthesis → never guess when
ambiguity changes management → return the safest answer with evidence.

## Non-negotiables

- **Deterministic-local-first.** Intent, entity recognition, ontology mapping, ambiguity,
  dialogue and planning run locally, offline, with **zero tokens**. The server LLM router
  (`/refine`) is a **fallback/augmentation** for genuinely hard entity/ambiguity cases, not
  the primary path. Gemini (`/explain`) is used **only** when the planner decides synthesis
  or multi-step reasoning is required.
- **No disease-specific hardcoding.** One canonical ontology assembled from existing assets;
  logic generalises across every specialty.
- **Never guess** when ambiguity changes clinical management.
- **Reuse, don't rebuild.** Keep `MaiKScope`, `MaiKKB`, `StewardRAG`, `SMD_REASON`,
  `MEDDRUGS`, `INTERACTIONS`, `DrugFuzzy`, `/explain`, and the entire Aurora UI.
- **Reversible.** New engine behind flag `smd_maik_brain` (default OFF; `?brain=1` on,
  `?brain=0` off). Flag-off is byte-for-byte today's MaiK. Recovery tag per phase.
- **Benchmarked.** Every phase is gated by a golden + "never-guess" benchmark with a scorer.

## Architecture

New orchestrator `window.MaiKBrain` in `kb/ai/maik-brain.js` runs the 12 stages as small,
independently-testable modules that thread a single object through:

```
Query{raw,lang} → MaiKBrain.run(query, context) →
  1 language → 2 scope(medical?) → 3 intent → 4 context → 5 NER → 6 ontology →
  7 ambiguity → 8 dialogue → 9 PLAN → 10 execute → 11 validate → 12 compose+followup
→ Answer
```

### Contracts (the objects that flow)

- **`Query`** = `{ raw, lang, norm }`.
- **`Resolved`** (front half output) = `{ scope:{medical,category}, intent, entities:[Entity],
  primary:Entity|null, context:{disease,drug,subtype,intent,population}, ambiguity:
  {kind:'none'|'lexical'|'clinical', options:[...], decision:'answer'|'overview'|'ask'} }`.
- **`Entity`** = `{ surface, canonicalId, canonicalName, type:'disease'|'drug'|'investigation'
  |'score'|'procedure'|'organism'|'lab'|'unit'|'abbrev', parentId?, subtypes?, confidence }`.
- **`Plan`** = `{ steps:[{ source:'kb'|'drugdb'|'treatment'|'guideline'|'calculator'|'protocol'
  |'context'|'router'|'research'|'gemini', op, args, why }], needsGemini:bool, estCost }`.
- **`Answer`** = `{ intent, entities, sections:[{kind,title,md}], doses:[{drug,dose,route,
  freq,adjust}], citations:[...], safetyFlags:[...], refinements:[...], followups:[...],
  mode, confidence }`. Rendered by the existing renderer (adapted `maikRenderAnswer`).

### Modules (map to the 12 stages)

| Stage | Module | Build | Source of truth |
|---|---|---|---|
| 1 Language | `detectLang` | new, light | heuristic; EN default |
| 2 Medical? | `scope` | **reuse** `MaiKScope.classify` | allow-list firewall |
| 3 Intent | `intent` | **new (unifies 3 today)** | ontology-driven; router fallback |
| 4 Context | `context` | upgrade `maikResolveFollowup`+`_maikTopic` | structured last disease/drug/intent/subtype |
| 5 NER | `ner` | new deterministic | ontology index |
| 6 Ontology | `ontology` | **new** `maik-ontology` | assembled from existing assets |
| 7 Ambiguity | `ambiguity` | **new** confidence-gated policy | lexical + clinical |
| 8 Dialogue | `dialogue` | upgrade `MaiKKB.clinicalDialogue` | overview+chips vs one clarification |
| 9 Planner | `planner` | **new (the core)** | source-priority scoring |
| 10 Execute | `execute` | **new** wiring | KB / drugdb / interactions / renal / calc / gemini |
| 11 Validate | `validate` | **new** (upgrades `reviewKB`) | dose/unit/interaction/citation checks |
| 12 Compose+FU | `compose`,`followup` | new structured + upgrade chips | intent-adaptive |

### Ontology (Stage 6) — how, without hardcoding

`maik-ontology` builds ONE canonical index at load from assets that already exist:
`MaiKKB.buildNameIndex` (KB+DX+treatments names) + `ABBREV` (~90) + `SMD_ALIASES`
(discriminative synonyms) + `DX_MGMT[].syn` + `MEDDRUGS` (generics/brands) + `SMD_VOCAB`.
Output per concept: `{ id, name, type, synonyms[], abbrevs[], parentId?, subtypeIds[] }`.
Parent/subtype links are learned from the name index (broadness heuristic already in
`clinicalDialogue`), not a hand-written disease tree. Entity linking is exact/synonym →
abbrev-expansion → conservative fuzzy (`DrugFuzzy`/Levenshtein) with a confidence score;
the **router `/refine` is called only when local linking is low-confidence or ambiguous**.

### Planner (Stage 9) — the new brain

Given `{intent, entities, context}`, score which internal source can *safely* answer, in
priority order: StewardMD KB → Drug DB → Treatment KB → Guidelines → Clinical Calculators →
Protocols → hospital overlay → conversation context. Emit the cheapest safe `Plan`. Escalate
to trusted guideline search / Gemini synthesis **only** when local confidence is insufficient.
Examples: exact KB → return, 0 Gemini; multiple KB sources → Gemini synthesis; calculator
intent → run calc, Gemini only explains; drug interaction → `INTERACTIONS`, Gemini explains
significance; prescription → drug DB + dose validation + Rx builder.

### Execution wiring (Stage 10)

Reuse deterministic engines; **extract headless facades** where only UI exists today:
- **new `MEDCALC.run(id, inputs)`** facade over the per-calc `compute()` (calculators are UI-only now).
- structured calls to `INTERACTIONS.checkInteractions`, `getRenalAdjustment`, `MEDDRUGS.match/findByName`, `MaiKKB.compose`, `StewardRAG`.
- Gemini `/explain` invoked only per the plan.

### Validation (Stage 10/11)

`validate(answer)`: dose present-and-from-KB (extends `composeDose` safety), unit sanity,
drug-in-regimen, interaction/contraindication check via `INTERACTIONS`, citation presence,
and conflict acknowledgement (surface uncertainty rather than silently pick one).

## Testing & benchmark

- Unit (`node --test test/*.test.mjs`): one `.test.mjs` per module (intent, ontology, ner,
  ambiguity, planner, validate) with a corpus that generalises across specialties.
- Golden/benchmark: extend `test/maik-coverage-questions.json` (167 Qs) with a **never-guess
  set** (broad diseases → overview+chips; 2-letter abbrevs → options; follow-up resolution;
  wrong-condition = fail) + a scorer `test/run-maik-brain-bench.mjs`. Baseline measured in
  Phase 0; each phase must not regress and must improve its target metric.
- CDP harness parity: `test/run-maik-*` continue to pass with `smd_maik_brain` off (parity)
  and, once wired, on.

## Phased plan (each: shippable, flag+benchmark gated, own recovery tag)

- **Phase 0 — Contracts + benchmark (parity, zero behavior change).** `maik-brain.js`
  skeleton + `Query/Resolved/Plan/Answer` contracts (inert when flag off); expand the golden
  set with the never-guess/safety corpus + scorer; capture the current baseline. Recovery
  tag `pre-maik-brain`.
- **Phase 1 — Deterministic front half (stages 1–7).** language, unified intent, ontology,
  NER, structured context, ambiguity, dialogue. Gate: 0 wrong-condition picks; broad → chips;
  abbrev → options; follow-ups resolve — all offline.
- **Phase 2 — Planner + execution + validation (stages 8–10).** planner, execute wiring
  (incl. `MEDCALC.run`), validation. Gate: measurable Gemini-token drop; calc/drug-DB
  auto-used; dose/interaction validation active.
- **Phase 3 — Composer + adaptive follow-up (stages 11–12).** single structured Answer +
  intent-adaptive sections + predicted follow-ups.

Parts 2 and 3 (answer quality, copilot) plug into `MaiKBrain` without changing the architecture.

## Success criteria (from the spec)

MaiK never guesses between clinically different conditions; broad diseases handled safely;
follow-ups resolve from context; Gemini minimised via KB-first planning; calculators/drug
DB/treatment KB/protocols used automatically; external sources only when the internal
ecosystem can't safely answer; every decision evidence-driven, benchmarked, and generalises
across specialties without disease-specific hardcoding.
