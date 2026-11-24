# ResearchMD Phase 6: study design templates (5D.1), `_templates.js`

Read-only reference data served from the module (no DB writes), the
`_extraction.js` TEMPLATES pattern. Firebase claims required; no project role.
Analysis defaults name the Python worker `stats_model` families exactly as
`backend/research/stats/job.py` accepts them; the JS engine stays canonical
for univariate meta-analysis (plan section 2).

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/study-templates` | `{templates:[summary]}` (id, name, design, reportingChecklistId) |
| GET | `/v1/study-templates/{id}` | full template; unknown id 404 `template_not_found` |

## Templates (five)

| id | design | reportingChecklistId | analysisDefaults.family |
|---|---|---|---|
| `rct` | randomised controlled trial | `consort` (protocol: `spirit`) | `linear` / `logistic` |
| `cohort` | cohort | `strobe` | `cox` / `km` / `logrank` |
| `observational` | observational (cross-sectional / case-control) | `strobe` | `logistic` |
| `diagnostic_accuracy` | diagnostic accuracy | `stard` | `diagnostic` (REITSMA bivariate) |
| `prognostic` | prognostic model | `tripod` | `cox` / `linear` |

Each template carries:
- `protocolFields`: ordered `{key, label, type, required}` list (design-specific
  PICO/PECO, eligibility, outcomes, time points, sample size, registration).
- `extractionForm`: `{fields:[{key, label, type, required, unit?}]}` for the
  design's data items (arms, events, means, follow-up, 2x2 cells, covariates).
- `analysisDefaults`: `{jobKind:"stats_model", family, spec, engine:"python-stats",
  notes}` matching job.py model specs (`formula`, `time/event/group`,
  `covariates`, `columns:{TP,FN,FP,TN}`).
- `reportingChecklistId` + `guidance` text (human sign-off still required;
  templates never auto-fill a protocol or run an analysis).
