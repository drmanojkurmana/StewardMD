# ResearchMD Phase 3 extraction contract (3.3 / 3.4 / 3.5)

Frozen before the screens. The server builder implements these routes; the
worker (`backend/research/worker/research_worker/extract.py`) produces the
`result.json` the PDF screen renders. Auth, project role, the error envelope
and pagination follow `../phase-1/errors.md` and `../phase-2/errors.md`.
Every write carries `version`; a stale write returns 409 `stale_version` with
`current` so the screen can show both values (plan 5.1).

Locator shape is `../phase-1/locator.schema.json` (kind `pdf`, `pdf.artifactId`,
`pdf.page`, normalized `pdf.box` {x,y,w,h} 0..1, plus `quote`). Readers must
never drop the `pdf` block.

## Integrity rules enforced here (plan section 3)

- One value per field. Every value keeps a locator AND a verbatim quote.
- Field status is `unverified`, `verified` or `corrected`. Only `verified` and
  `corrected` (both human-attested) may reach analysis. `unverified` never does.
- AI suggestions (T1, 3.5) arrive as `unverified`, are labelled "Suggestion",
  and Accept moves the value into the field still `unverified`. A human must
  Verify before promote. No suggestion is ever auto-applied or auto-verified.
- Corrections append an audit row {old, new, reason, by, ts}; nothing is
  silently overwritten.
- Nothing is inferred from unreadable text. OCR pages are flagged `ocr:true`.

## Form templates (GET /v1/extraction-templates)

Response `extraction-templates.response.json`. Three templates, each a list of
fields with `key`, `label`, `type` (integer|number|text), `required`, and the
engine `measure` options the template can promote to.

| Template | Fields (key) | Promotes to measure | Engine inputs shape |
|---|---|---|---|
| `rct_binary` | events1, n1, events2, n2 | OR, RR, RD | rawCounts |
| `rct_continuous` | mean1, sd1, n1, mean2, sd2, n2 | MD, SMD | rawMeans |
| `generic_effect` | yi, se, effect, ciLower, ciUpper, ciLevel | OR, RR, HR, MD, SMD (generic) | generic (yi+se) or reported (effect+CI) |

`generic_effect`: if `yi` and `se` are present the promote uses the generic
shape; else if `effect`, `ciLower`, `ciUpper` are present it uses reported.
Ratio measures promoted from `reported`/`generic` store the logged yi per the
phase-1 study contract.

## Extraction resource

Schema `extraction.schema.json`. Keyed by `(projectId, studyId)`. The study is
a `research_studies` row (phase 1); an included report's study may start as a
bare placeholder (no inputs) awaiting extraction.

```
GET /v1/projects/{projectId}/studies/{studyId}/extraction?template=rct_binary
```

- All member roles read. Returns `{extraction}`. If none exists the API returns
  a fresh draft scaffold (`version:0`, empty `fields`, `status:"draft"`) bound
  to the requested template; it is persisted on the first PUT.
- `extraction.artifactId` names the linked PDF artifact (nullable until a PDF
  is attached). `extraction.fields` is a map keyed by field key; each value is
  `{value, locator, quote, status, source, verifier, verifiedAt}`. `source` is
  `human` or `suggestion`. `suggestions[]` holds pending T1 suggestions
  `{id, fieldKey, value, locator, quote, model, status:"unverified", createdTs}`.

```
PUT /v1/projects/{projectId}/studies/{studyId}/extraction
```

Request `extraction-update.request.json`: `{template, version, fields}`.
Owner/editor/analyst. `fields` is the full map of edited field values
(`{value, locator, quote}`); the server keeps status `unverified` for any
changed value (editing invalidates prior verification). 409 `stale_version`
with `current.extraction` when `version` is old. Returns `{extraction}`.

```
POST /v1/extractions/{extractionId}/verify
```

Request `extraction-verify.request.json`: `{fieldKey?, version}`. With
`fieldKey` verifies one field; without, verifies every field that has a value,
locator and quote. Owner/editor/analyst. A field missing locator or quote is
rejected 422 `locator_required` (integrity rule 2). Sets status `verified`,
`verifier` = caller, `verifiedAt` = now. Returns `{extraction}`.

```
POST /v1/extractions/{extractionId}/correct
```

Request `extraction-correct.request.json`:
`{fieldKey, value, locator?, quote?, reason, version}`. `reason` required
(non-empty). Appends `{id, fieldKey, old, new, reason, by, ts}` to the audit
log, sets the field value, status `corrected`, `verifier` = caller. A corrected
value is human-attested and may promote. Returns `{extraction}`.

```
GET /v1/extractions/{extractionId}/audit
```

Response `extraction-audit.response.json`: `{events:[...]}` ordered ts DESC.
Event kinds: `field_saved`, `verified`, `corrected`, `suggestion_accepted`,
`promoted`. Each carries `by`, `ts`, and kind-specific detail (corrections
carry old/new/reason). All member roles read.

```
POST /v1/extractions/{extractionId}/suggestions/{suggestionId}/accept
```

Owner/editor/analyst. Moves the suggestion value into `fields[fieldKey]` with
status `unverified`, source `suggestion`; removes it from `suggestions[]`;
appends a `suggestion_accepted` audit event. Never verifies. Returns
`{extraction}`.

```
POST /v1/extractions/{extractionId}/promote
```

Request `extraction-promote.request.json`: `{measure, label?, locatorFieldKey?}`.
Owner/editor/analyst. Validates: every template-required field for the chosen
measure is present and `verified`/`corrected`; otherwise 422
`extraction_unverified` (no AI value reaches analysis unverified, plan gate 12).
Builds the phase-1 `inputs` shape from the template mapping, builds the study
`locator` from `locatorFieldKey` (default: the first verified field's locator)
and `quote` from that field. Writes the `research_studies` row for
`extraction.studyId` (creates inputs/measure/locator/quote, sets
`verified:true`, `verifiedBy`, bumps `version`). Returns `{study}` per
`../phase-1/schemas/study-get.response.json`. Appends a `promoted` audit event.
The engine then runs on that study exactly as a phase-1 manual study.

## PDF artifacts and the worker result (3.2 / 3.3)

```
GET /v1/projects/{projectId}/artifacts
```

Response `extraction-artifact-list.response.json`:
`{artifacts:[{id, projectId, filename, sha256, bytes, pages, status, jobId, createdTs}]}`.
`status` is `queued|running|succeeded|failed|cancelled` (mirrors `research_jobs`).

```
POST /v1/projects/{projectId}/pdf-uploads   (multipart, field "file")
```

Owner/editor/analyst. PDF only, 1 byte to 25 MB (ceilings.md). Stores to R2
`projects/{projectId}/pdf/{sha256}.pdf` (retention.md), creates an artifact row,
enqueues a `pdf_extract` job (job-message.schema.json). Returns `{artifact}`
(201). Errors: 400 `missing_file`/`invalid_multipart`, 413 `ceiling_bytes`,
415 `file_type`, 429 caps per ceilings.md, 503 `storage_unavailable`.

```
GET /v1/artifacts/{artifactId}/result
```

Response `extraction-artifact-result.response.json`: the worker `result.json`
payload. 404 `artifact_not_found`; 409 `job_not_done` while the job is still
queued/running (the screen polls `GET /v1/jobs/{jobId}`). Shape:

```
{ jobId, idempotencyKey, status:"done", usage:{pages,seconds},
  ocr:bool, sha256,
  pages:[ { n, width, height, text, ocr,
            words:[{t, x0, y0, x1, y1}],
            tables:[{bbox:[x0,y0,x1,y1], rows:[[cell,...],...]}] } ] }
```

Coordinates are pdfplumber points in DISPLAY space (top-left origin, y down),
`width`/`height` in points. The PDF screen renders words positioned at
`x0/width`, `y0/height` (normalized) so it works fully offline from this JSON;
it never loads the PDF bytes or an external PDF library. A locator `pdf.box`
{ x,y,w,h } is normalized 0..1 against the same page, so highlighting is
`left = x*width`, `top = y*height`, `w*width`, `h*height` at any render scale.

```
GET /v1/jobs/{jobId}
```

`{job:{id, projectId, kind, status, errorCode, usage, createdTs, completedTs}}`.
Used to poll until `succeeded` before fetching the result.

## Error codes added (envelope per phase-1/phase-2)

| HTTP | code | When |
|---|---|---|
| 404 | `extraction_not_found` | no such extraction id |
| 404 | `artifact_not_found` | no such artifact in the project |
| 404 | `job_not_found` | no such job |
| 409 | `job_not_done` | result requested before the job succeeded |
| 409 | `stale_version` | (phase 1) extraction version old |
| 422 | `locator_required` | verify/promote on a field without locator+quote |
| 422 | `extraction_unverified` | promote with a required field unverified |
| 422 | `invalid_template` | unknown template or measure not allowed for it |
| 400 | `invalid_correction` | correct without fieldKey/value/reason |
