# ResearchMD PRISMA 2020 counting rules (2.6 builder contract)

Counts come from the `research_prisma_counts` view
(`0002_research_v2.sql`), which derives every number from stored rows:
search runs, records, dedup groups, screening decisions and conflicts.
Nothing is stored separately, so the plan section-12 gate ("counts equal
stored decisions, 100%") holds by construction. The `excludedByReason`
breakdown in `prisma-get.response.json` is the only API-computed part, and
it counts the same decision rows the view reads.

## Records, reports, studies

- A **record** is one database entry (or one imported reference).
- A **report** is one full-text item sought or retrieved for one record.
- A **study** is one included report linked to a Phase 1 analysis row
  (`research_reports.study_id`). Reports included without an analysis row
  yet still count as included; the link is filled when the study is built.

## Box-by-box mapping

| PRISMA 2020 box | Source |
|---|---|
| Records identified from databases | `records_from_databases` (sources pubmed, europe_pmc, crossref, semantic_scholar) |
| Records identified from other sources | `records_from_other_sources` (imports: `import:ris/bibtex/csv`, plus any future source) |
| Records removed before screening (duplicates) | `records_duplicates_removed` (non-canonical dedup members; nothing is deleted) |
| Records screened (title/abstract) | `records_screened` (at least one vote) |
| Records excluded (title/abstract) | `records_excluded` (outcome exclude) |
| Reports sought for retrieval | `reports_sought` (every report row) |
| Reports not retrieved | `reports_not_retrieved` (status exactly `not_retrieved`, an explicit terminal state, never an absence) |
| Reports assessed for eligibility | `reports_assessed` (at least one full-text vote) |
| Reports excluded, with reasons | `reports_excluded` plus `excludedByReason` (latest vote per reviewer) |
| Studies included in review | `studies_included` (full-text outcome include) |

## Outcome rules (shared by the view and the API)

For one item at one stage, looking at the latest vote per reviewer:

1. An **open conflict** means pending.
2. A **resolved conflict** follows the resolution.
3. **No votes** means unscreened (not pending: the item was never touched).
4. **Unanimous include** means include; **unanimous exclude** means exclude.
5. Anything else (a split vote or any `uncertain`) means pending and, once
   both reviewers have voted, opens (or keeps) a conflict.

Exclusion reasons count only from the latest `exclude` vote per reviewer per
report; global and project codes merge in `reason-list`. Reason text shown
in the flow diagram is the reason `label`, never free text.

## Reproducibility rules

- Replaying a search from the archived R2 ID list (`search_runs.r2_key`)
  must reproduce the record set 100%: same IDs, same order.
- Re-running a date-bounded query live must match at least 99% of the
  stored IDs (`ids` intersection over stored set). Below 99% the run is
  saved but flagged, and the screen offers archive-replay instead.
- `dateTo` is part of every comparison: runs with different upper bounds
  are never compared for the 99% gate.

## Standard global exclusion codes

Seeded by the 2.5 builder as `project_id = 'global'` rows. Projects add
their own codes; they never redefine these.

| Code | Label |
|---|---|
| WRONG_POPULATION | Wrong population |
| WRONG_INTERVENTION | Wrong intervention or exposure |
| WRONG_COMPARATOR | Wrong comparator |
| WRONG_OUTCOME | Wrong outcome |
| WRONG_DESIGN | Wrong study design |
| DUPLICATE_REPORT | Duplicate report of an included study |
| FULL_TEXT_UNAVAILABLE | Full text unavailable |
| LANGUAGE | Language exclusion |
| ABSTRACT_ONLY | Conference abstract only, no full data |
| ONGOING_STUDY | Ongoing study, no results yet |
