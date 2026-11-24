# ResearchMD Phase 6: journal records + matching (5B.3), `_journals.js`

Seed: `journals.seed.json` (this directory), 10 real medical journals. The
module embeds the SAME records (the `_extraction.js` / global-reasons pattern:
Pages functions do not read docs at runtime) and lazy-seeds
`research_journals` with INSERT OR IGNORE on first read. A test asserts the
embedded seed equals the JSON file, so the two cannot drift.

## Integrity posture

The seed is a knowledge snapshot dated 2026-11-24, NOT live-verified.
`checkedTs` is null for every record until a source check (Gemini desktop
research pass, plan 5B.3) lands. Any value the seed is unsure of is null
(word limits, some author-instruction URLs, some reference styles). ISSN
values are the commonly cited print/online ISSNs. Nothing here is fabricated:
uncertain fields are explicitly null (plan rule 4).

## Routes (Firebase claims; read-only)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/journals?q=` | list; optional case-insensitive substring filter on name/scope |
| GET | `/v1/journals/{id}` | one record; unknown 404 `journal_not_found` |
| POST | `/v1/journals/match` | `{keywords:[string], design?:string}` -> ranked matches |

## Match scoring (deterministic, no LLM)

`score = 2 * (keyword overlap with scope) + 3 * (design in designs)`.
Keywords are lowercased; overlap counts distinct scope hits. Journals with
score 0 are omitted. Ties break by name ASC. Response:
`{matches:[{journal, score, matchedKeywords, designMatch}]}`. `design` uses
the template design keys plus `systematic_review`, `meta_analysis`,
`narrative_review`, `case_report`.

## Record shape

```json
{ "id": "nejm", "name": "New England Journal of Medicine",
  "issn": "0028-4793", "scope": ["general medicine", ...],
  "designs": ["rct", "cohort", ...],
  "authorInstructionsUrl": "https://... or null",
  "wordLimits": { "abstract": null, "main": null },
  "referenceStyle": "vancouver|ama|null", "checkedTs": null }
```
