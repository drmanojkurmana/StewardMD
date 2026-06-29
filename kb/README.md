# StewardMD Medical Knowledge Base (KB) — schema & evaluator (Phase 1)

This is the **architecture** of the Knowledge Base — the future single source of
truth for disease knowledge. Phase 1 ships the schema + a generic evaluator +
proof that the declarative model reproduces the live engine. **It does not yet
replace the production engine** (that swap is Phase 3) — nothing here is shipped
to users or referenced by `index.html`.

## Design principles (locked)
- **Knowledge and treatment are separate.** `kb/diseases/*.json` hold disease
  *knowledge* (matching, pathogens, differentials, mimics, investigations,
  red flags, narrative). `kb/treatments/*.json` hold *recommendations*. A disease
  links to its treatment via `treatmentRef`.
- **Disease reference = Harrison's.** Knowledge narrative is anchored to Harrison
  (primary), enriched by guidelines.
- **Treatment precedence = ICMR ▸ international guidelines ▸ hospital overlay.**
  Hospital policy (`kb/policies/<hospital>/*.json`) is an *optional, user-selected
  overlay* — it never replaces national/international guidance by default.
- **Drug Index is the only pharmacology DB.** Treatments link drugs by
  `composition` key; no drug data is duplicated here.
- **Engine is generic over the schema.** Adding a disease is adding a JSON file;
  the reasoning code never changes — the path to 5,000+ diseases.
- **Offline-first / backward-compatible.** Authored per-disease files are compiled
  (Phase 1.5 codegen) into a single shipped `kb.core.json`; the runtime stays
  buildless. Nothing here changes current behavior.
- **RAG-ready / AI-ready, but no AI yet.** Each `narrative[]` chunk is an
  addressable, individually-citable unit (stable `section` id + `text` + `source`
  locator) ready for an embedding pipeline. AI integration is Phase 4.

## Files
- `schema/disease.schema.json` — disease knowledge object (JSON Schema 2020-12).
- `schema/treatment.schema.json` — treatment recommendations (multi-source + precedence).
- `schema/policy-overlay.schema.json` — optional hospital overlay.
- `engine/evaluator.mjs` — generic, dependency-free declarative evaluator.
- `diseases/*.json`, `treatments/*.json` — sample conversions of existing content.

## How legacy logic maps to data (verified)
| Legacy (reasoning.js / SYNDROMES) | KB schema |
|---|---|
| `match: e => e.fever && (e.neckStiffness \|\| ...)` | `matching.rule` (allOf/anyOf/not/leaf) |
| `baseScore: e => { let i=70; e.x&&(i+=15); ... }` | `matching.score` = `{base, modifiers:[{when,add}]}` |
| `find: { ascites:30, fever:-6 }` (non-infective) | `matching.find` (weighted sum) |
| `reasoning: e => "..."` | `matching.reasoningTemplate` |
| `decision`, `investigations`, `pathogens` | `redFlags`, `investigations[]`, `pathogens` |
| free-text drug names in tx / policy | `drugRefs` / treatment `drugRefs[].composition` |
| disease-level `src:"Harrison 22e · p"` | per-chunk `source.locator` + treatment `evidence` |

## Rule / score DSL
```
rule  : "findingKey"                       // truthy in the finding set
      | ["a","b"]                           // implicit allOf
      | { "allOf": [rule...] }
      | { "anyOf": [rule...] }
      | { "not": rule }
      | { "key":"curb65", "gte":2 }         // numeric comparison (gte/gt/lte/lt/eq)
score : { "base": 70, "modifiers": [ { "when": rule, "add": 15 }, ... ] }
```
`baseScore = base + Σ add` for each satisfied `when`. The host engine then applies
the **same shared post-steps for every disease** (IDF soft-score for pre-match,
dominant-system modifier, clamp 0–100) — those are engine logic, not per-disease,
so they never need editing as diseases scale.

## Validation
`node test/run-kb-parity.mjs` fuzzes thousands of random finding-sets through both
the live `SYNDROMES[id].match/baseScore` closures and the declarative evaluator
over the converted diseases, and asserts identical match-boolean and base-score —
proving the data-driven model is behavior-equivalent to today's code.
