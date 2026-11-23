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

## Pagination

List endpoints take `?limit` (1-100, default 20) and `?cursor` (opaque,
server-issued). Responses carry items plus `nextCursor`, absent on the last
page. Ordering is `updated_ts DESC` (studies) and `created_ts DESC` (runs),
so a replayed page during sync cannot skip rows.
