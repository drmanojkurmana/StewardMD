# ResearchMD Phase 6: cost reports + pricing note (6.3), `_reports.js`

Sources: `research_ai_usage` (per-call tokens + cost, micro-USD) and
`research_credit_ledger` (reserve/release/settle/grant). Deterministic SQL
aggregation only; no LLM. Unit: integer micro-USD everywhere.

## Routes

| Method | Path | Gate | Notes |
|---|---|---|---|
| GET | `/v1/projects/{pid}/cost-report?from=&to=` | owner/editor | totals by step, tier, model, UTC day + ledger totals for the project's jobs |
| GET | `/v1/projects/{pid}/cost-report.csv` | owner/editor | `text/csv` detail rows + TOTAL row |
| GET | `/v1/cost-report?from=&to=` | Firebase (self) | the caller's own usage across projects + their wallet-key ledger totals |
| GET | `/v1/cost-report.csv` | Firebase (self) | CSV of the same |
| GET | `/v1/admin/pricing-note` | adminAuth | measured cost per review + pricing note text |

`from`/`to` are epoch-ms bounds (optional; default all time; from <= to else
400). Outsiders get 404 on project routes.

## Report shape

```json
{ "report": {
    "scope": "project|user", "id": "...", "from": null, "to": null,
    "unit": "micro-USD",
    "ai": { "totalCostMicroUsd": 0, "tokensIn": 0, "tokensOut": 0, "calls": 0,
            "byStep": [{"key":"extraction","costMicroUsd":0,"calls":0}],
            "byTier": [...], "byModel": [...],
            "byDay":  [{"key":"2026-11-24","costMicroUsd":0,"calls":0}] },
    "ledger": { "grantedMicroUsd": 0, "reservedMicroUsd": 0,
                "releasedMicroUsd": 0, "settledMicroUsd": 0,
                "netMicroUsd": 0 },
    "totalChargedMicroUsd": 0 },
  "generatedTs": 0 }
```

- `ai` comes from `research_ai_usage` (authoritative per project/user).
- `ledger` for a project sums rows whose `job_id` is one of the project's
  `research_job_runs` ids (pdf compute + gateway AI settles). Suggestion
  settles carry a request-id pointer, not a job id; they are counted in `ai`
  but not in the project ledger join (documented limitation).
- `totalChargedMicroUsd` = sum of settle charges (ledger for projects; for a
  user, the AI usage total plus their pdf-job settles, deduplicated by job id).
- CSV columns: `scope,day,step,tier,model,tokens_in,tokens_out,cost_micro_usd`,
  ordered day ASC, step, tier, model; final `TOTAL` row. RFC4180 quoting.

## Pricing note (admin)

Measured review = a project with at least one saved run (`research_runs`).
Cost per review = the project's `research_ai_usage` total. The note reports
count, mean/median/min/max, the plan section 6 target (US$0.50-2.00 managed AI
spend per standard review), the section 12 gate (at least 5 real reviews
before any price is set), and the unit-economics reminder: worker compute, R2,
store fees (15-30% in-app) and taxes are NOT in the AI number. Output is
deterministic text + the measured statistics; it sets no price.
