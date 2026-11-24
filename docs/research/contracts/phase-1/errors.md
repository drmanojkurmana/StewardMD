# ResearchMD Phase 1 error codes and conventions

Every API error answers the envelope in `schemas/error-envelope.json`:

```json
{ "error": { "code": "stale_version", "message": "Study changed on the server", "requestId": "req_abc" } }
```

The `x-request-id` header echoes `requestId`. Messages are human-readable and
safe to show; codes are stable and drive screen behavior.

## Codes

| HTTP | code | When |
|---|---|---|
| 400 | `invalid_body` | malformed JSON, wrong types, oversize payload |
| 400 | `invalid_project` | project create/update fails validation (title 1-180 chars) |
| 400 | `invalid_study` | study inputs fail validation (bad counts, CI ordering, unknown shape) |
| 400 | `invalid_run` | run spec fails validation (fewer than 2 pinned studies, bad model/test/level) |
| 401 | `unauthorized` | missing or invalid Firebase ID token |
| 403 | `not_member` | caller has no membership row for the project, or the role is too weak for the write (studies and runs need owner, editor or analyst) |
| 404 | `project_not_found` | no such project, or the caller is not a member (same answer either way) |
| 404 | `study_not_found` | no such study in the project |
| 404 | `run_not_found` | no such run in the project |
| 409 | `stale_version` | study update (or run pin) names a version older than the stored one |
| 422 | `unverified_studies` | a run lists a study whose verified flag is false; the message names the ids |
| 422 | `unpoolable_studies` | the pinned studies cannot pool (fewer than 2 included after exclusions) |
| 503 | `database_unavailable` | research D1 is not provisioned |
| 503 | `storage_unavailable` | research R2 is not provisioned (Phase 3) |

## 409 stale_version (offline conflict)

Studies carry an integer `version` starting at 1. Updates must send the
version the screen rendered from. On mismatch the API answers 409 with the
envelope plus the current study under `current`, so the screen shows both
values and the user picks:

```json
{
  "error": { "code": "stale_version", "message": "Study changed on the server", "requestId": "req_abc" },
  "current": { "study": { "id": "st_1", "version": 4 } }
}
```

A conflict is never silently overwritten. Queued offline writes replay with
idempotency keys; a replayed key with identical input returns the original
result instead of duplicating the row.

## Phase 3 codes (docs/research/contracts/phase-3, added by the 3.0 server build)

Same envelope. Cap messages are the ceilings.md hard-stop text, verbatim.
`callback_*` and the internal routes answer without Firebase auth (the
worker holds no user tokens; HMAC / per-job token is the credential, see
gateway.md). Credits are micro-USD; 402 is the insufficient-balance answer.

| HTTP | code | When |
|---|---|---|
| 400 | `ceiling_input_tokens` | gateway prompt estimate exceeds the tier input ceiling |
| 400 | `batch_too_large` | a pdf_extract batch names more than 20 PDFs |
| 400 | `invalid_multipart` / `missing_file` / `file_type` | PDF upload shape (same codes as the pilot paper upload) |
| 401 | `callback_skew` | callback timestamp not an integer or outside the 300 s window |
| 401 | `callback_signature` | HMAC mismatch (constant-time compare) |
| 402 | `insufficient_credits` | wallet + institution pool minus holds cannot cover the quote |
| 404 | `pdf_not_found` | no such PDF in the project |
| 404 | `job_not_found` | no such job (Phase 3 or pilot), or the caller is not a member |
| 404 | `institution_not_found` | admin route: no such institution |
| 409 | `callback_mismatch` | callback key/jobId/resultKey scope does not match the stored job |
| 409 | `idempotency_conflict` | a used idempotencyKey replays with a different PDF |
| 409 | `job_mismatch` | gateway token/body does not match the stored job (project, user, job) |
| 409 | `job_settled` | gateway call on an already-settled job |
| 413 | `ceiling_bytes` | PDF larger than 25 MB (26,214,400 bytes) |
| 422 | `phi_blocked` | PHI gate hit before a gateway call; `categories` lists hit categories, never matched text |
| 429 | `project_daily_cap` | 200 pdf_extract jobs / project / UTC day |
| 429 | `user_daily_cap` | 300 pdf_extract jobs / user / UTC day |
| 429 | `project_ai_cap` | US$5.00 managed AI spend / project / UTC day |
| 429 | `user_ai_cap` | US$10.00 managed AI spend / user / UTC day |
| 502 | `ai_provider_error` | the LLM facade failed; stable text, never provider output |
| 502 | `search_failed` | internal literature-search connector failure; stable text |
| 503 | `callback_unavailable` | RESEARCH_CALLBACK_SECRET not configured |
| 503 | `gateway_unavailable` | gateway secret not configured |
| 503 | `queue_unavailable` | RESEARCH_QUEUE absent or send failed (job marked failed, reserve released; retry with the same key) |
| 503 | `admin_unavailable` | RESEARCH_ADMIN_TOKEN not configured |
| 503 | `search_unconfigured` | RESEARCH_CONTACT_EMAIL absent (database terms require it) |

Worker callback error codes carried in `research_job_runs.error_code` are
the stable ceilings.md codes (`ceiling_pages`, `ceiling_seconds`,
`ceiling_bytes`) plus the worker's `input_missing` / `extract_failed`; free
text from a PDF is never accepted (callback.md).

## Pagination

List endpoints take `?limit` (1-100, default 20) and `?cursor` (opaque,
server-issued). Responses carry items plus `nextCursor`, absent on the last
page. Ordering is `updated_ts DESC` (studies) and `created_ts DESC` (runs),
so a replayed page during sync cannot skip rows.
