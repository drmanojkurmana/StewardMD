# ResearchMD Phase 5A.4 autorater rubric

The autorater scores a draft manuscript on six dimensions, each an integer
1-5. It runs ONLY after the deterministic integrity gates pass (see
`tokens.md` failure behaviour and `po_adapter.gates`); a gate violation blocks
scoring entirely. The LLM rater is an independent critic (plan tier T3 when
justified, otherwise T2); every call goes through the gateway client, after the
PHI gate, with token logging. The rater never calculates numbers and never
invents data; it judges the writing against the materials provided.

Implementation: `backend/research/manuscript/autorater.py`
(`deterministic_report`, `LLMRater`, `score_draft`, `cost_per_review`). The
dimension keys below are the contract; `autorater.DIMENSIONS` must match them.

## Dimensions and anchors

### integrity
Whether the draft honours the integrity rules: numbers are tokens, claims carry
source links, nothing is fabricated, direction/significance words agree with the
token values. (The hard gates already enforce the mechanical part; this dimension
judges residual honesty, e.g. overclaiming beyond the cited evidence.)
- 1: fabricates results, references or quotes, or misrepresents the evidence.
- 3: mostly faithful, minor overstatement or unsupported emphasis.
- 5: every claim is bounded by its source; limitations stated plainly.

### methods_clarity
Whether the methods are reproducible from the text: protocol, eligibility,
search, screening, extraction, risk of bias, synthesis model and software.
- 1: methods missing or unreproducible.
- 3: core methods present but gaps (e.g. no search dates, model unspecified).
- 5: a reader could reproduce the review from the methods alone.

### results_accuracy
Whether the results match the saved runs and are reported completely: effects,
CIs, p-values, heterogeneity, study/participant counts, subgroup/sensitivity.
- 1: results contradict the runs or omit primary outcomes.
- 3: primary results correct, secondary reporting incomplete.
- 5: complete, accurate, token-consistent reporting of all planned outcomes.

### discussion_balance
Whether the discussion weighs benefits and harms, certainty (GRADE), risk of
bias and limitations, and avoids spin.
- 1: spin; ignores limitations or certainty.
- 3: balanced but thin on limitations or GRADE.
- 5: interpretation proportionate to the certainty and bias of the evidence.

### reporting_compliance
Whether the draft follows PRISMA 2020 and IMRAD structure, with a structured
abstract and required items (registration, funding, conflicts).
- 1: major PRISMA items absent.
- 3: structure correct, several items missing.
- 5: PRISMA 2020 items addressed; structured abstract; declarations present.

### references_quality
Whether references are relevant, current, correctly cited in Vancouver order,
and resolve to DOI/PMID (the citation gate enforces resolution mechanically).
- 1: irrelevant or unverifiable references.
- 3: adequate coverage, minor citation-order or relevance issues.
- 5: pertinent, balanced, correctly numbered and resolved references.

## Output shape

The rater returns fenced JSON:

```json
{
  "scores": {
    "integrity": {"score": 4, "comment": "..."},
    "methods_clarity": {"score": 3, "comment": "..."}
  },
  "summary": "..."
}
```

`score_draft` returns `{blocked, deterministic, rubric, overall}` where
`overall` is the mean of the six dimension scores (3 decimals). When
`blocked` is true, `rubric` and `overall` are null and the violation list is in
`deterministic.violations`.

## Cost per review

`cost_per_review(records)` aggregates `research_ai_usage`-shaped records (the D1
row: `step, tier, model, tokens_in, tokens_out, cost_micro_usd, ts, job_id,
project_id, user_id`; or the adapter client's camelCase usage records). It
reports calls, tokens in/out, `cost_micro_usd` and `cost_usd`, grouped by step,
tier and job. Cost is taken from the authoritative `cost_micro_usd` field;
records without it contribute tokens only and set `cost_complete=false`. No
model rate is invented in this package. Plan section 12 requires cost measured
on at least five real reviews before pricing; this report is the measurement
instrument, not a price.
