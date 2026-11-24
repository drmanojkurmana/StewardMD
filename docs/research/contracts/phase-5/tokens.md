# ResearchMD Phase 5A manuscript number tokens (canonical contract)

This is the ONE canonical token format for manuscript numbers. It reconciles
the wording drift flagged in `backend/research/paperorchestra/SEAMS.md` (seam 3):
plan rule 6 writes the dot form `{{run:<id>.<field>}}`; the 3.7 spike used a
colon form `{{run:<runId>:<path>}}`. **The dot form wins.** The colon form is
retired and is rejected as `malformed_token` by the gates and by strict
rendering. Changing this grammar is a reviewed contract change.

## Grammar

```
token      = "{{run:" runId "." fieldPath "}}"
runId      = [A-Za-z0-9_-]+            ; a saved analysis run id; never contains "."
fieldPath  = field ("." field)*        ; dot path into the run's result object
field      = [A-Za-z0-9_]+
```

Regular expression (shared by gates, writer and renderer):

```
\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}
```

- The separator between `runId` and `fieldPath` is a single dot `.`.
- `fieldPath` may itself contain dots for nested results, e.g.
  `{{run:r1.subgroup.active.estimate}}`.
- No spaces, no colon separator, no other punctuation inside the braces.
- A `{{run:...}}` spelling that does not match the grammar (including the
  retired `{{run:r1:estimate}}`) is a **malformed token**, not a number and not
  a resolvable token.

## Token table

The deterministic token table is keyed by the same canonical string
`"<runId>.<fieldPath>"` (dot). Each entry carries:

```json
{ "value": <number>, "null": <number>, "measure": "OR", "runId": "r1" }
```

`null` is the null effect for the measure: 1 for ratio measures (OR, RR, HR,
ROM, IRR, RRR), 0 for differences (MD, RD, SMD). Built by
`po_adapter.loader.build_token_table` from saved runs; the same dot keys are
what `manuscript.render_tokens.normalize_runs` reconstructs runs from.

## Allowed fields

Any numeric field present in a saved run's `result` object is addressable by
its dot path. The renderer's rule table (`manuscript/render_tokens.py`) formats
the common fields:

| Field(s) | Format |
|---|---|
| `estimate`, `effect`, `yi`, `or`, `rr`, `rd`, `md`, `smd`, `hr`, `hedges_g`, `ciLower`, `ciUpper`, `ci_lower`, `ci_upper`, `tau2`, `tau`, `se`, `se_yi`, `q` | 2 decimals |
| `p`, `pValue`, `p_value`, `pval` | APA 7th (`< .001`, `> .999`, else `.020`, no leading zero) |
| `k`, `n`, `total`, `sample_size`, `count`, `studies`, `participants`, `events`, `events_intervention`, `events_control`, `df` | integer |
| `i2`, `i_squared` | 1 decimal percent (`35.2%`) |
| other numeric fields | 2 decimals (float) or `str(value)` |

### Composite CI fields

`ci`, `ci95`, `confidence_interval`, `confidenceinterval` (case-insensitive) are
composite tokens. They resolve when the run carries both bounds (`ciLower` and
`ciUpper`, or `ci_lower`/`ci_upper`, or a two-element `ci` array) and render as
`(95% CI a to b)`. The numbers gate accepts a composite CI token as known when
both bound keys exist for that run; it is not a flattened table key itself.

## Resolution rules

1. Numbers are inserted by token only; a model never types a statistical number
   (plan rule 6). The draft manuscript JSON keeps tokens **unresolved**.
2. `po_adapter.writer.render_tokens(text, token_table)` is the deterministic
   preview substitution against the token table; unknown tokens are left as-is
   so the gates can flag them.
3. `manuscript.render_tokens.render_tokens(text, runs, strict=...)` is the
   export/preview renderer against saved runs (list, runId-keyed dict, or token
   table). `strict=True` raises `UnresolvedTokenError` on any token that cannot
   be resolved; `strict=False` leaves unresolved tokens untouched (preview).
4. Rendering happens only at preview/export (5A.2/5A.3). The `manuscript_draft`
   job output and the canonical manuscript text always keep tokens.

## Failure behaviour (hard gates)

`po_adapter.gates` runs before any autorater score and on the final draft, and
`manuscript.docx_export.export` runs them before writing any file. A violation
blocks export with the full list (`GateError.violations`); nothing is written.

| Gate code | Meaning |
|---|---|
| `untokenised_number` | a bare statistical number in Abstract/Results that is not a token. Allowed bare numbers: years (19xx/20xx), reviewer/assessor/screener counts, stated thresholds (alpha, cutoffs, 90/95/99% CI labels, heterogeneity cutoffs). |
| `unknown_token` | a canonical token whose `runId.fieldPath` is not in the token table (and is not a resolvable composite CI). |
| `malformed_token` | a `{{run:...}}` that does not match the canonical grammar (e.g. the retired colon form). |
| `unresolved_citation` | a `\cite{key}`/`[@key]` that is not in the library (`not_in_library`), has no DOI or PMID (`no_doi_or_pmid`), or whose identifier is not in the manifest (`not_in_manifest`). |
| `claim_without_source` | a claim sentence in Abstract/Results/Discussion with no source link. A source link is a canonical run token (a saved run) or a citation; the citation gate independently requires every citation to resolve to a stored record with DOI/PMID (verified evidence or references), so together every claim links to a run or a verified stored record. |
| `direction_mismatch` | "reduced"/"decreased" with estimate >= null, or "increased"/"higher" with estimate <= null. |
| `significance_mismatch` | "significant" with a CI crossing the null, or "not significant" with a CI excluding it. |

Strict rendering additionally raises `UnresolvedTokenError` for an unknown
run, an unknown field, an invalid result object, a missing CI pair, or a
malformed token. DOCX export raises `UnresolvedCitationError` for a citation
key absent from the supplied references or lacking both DOI and PMID.

## Where each form lives

- Grammar + gates: `backend/research/paperorchestra/adapter/po_adapter/gates.py`
- Token table + loader: `.../po_adapter/loader.py`
- Preview substitution: `.../po_adapter/writer.py`
- Export renderer + rule table: `backend/research/manuscript/render_tokens.py`
- Export gate enforcement: `backend/research/manuscript/docx_export.py`
- Version-lock run-id extraction: `backend/research/manuscript/version_lock.py`
