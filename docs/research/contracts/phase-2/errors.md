# ResearchMD Phase 2 error codes and conventions

Phase 1 codes and the envelope live in `../phase-1/errors.md` and
`../phase-1/schemas/error-envelope.json`; Phase 2 reuses that envelope and
adds the codes below. Pagination follows the Phase 1 convention (`?limit`
1-100 default 20, `?cursor`, `nextCursor`, `updated_ts DESC` / `created_ts
DESC` ordering).

## Role matrix (server-enforced from research_members)

| Role | Protocol | Invites | Searches/imports/dedup | Votes | Resolve conflicts | Reads |
|---|---|---|---|---|---|---|
| owner | create/version/lock | manage | run | vote | yes | all |
| editor | create/version | manage | run | vote | yes | all |
| analyst | read | none | run | vote | no | all |
| reviewer | read | none | none | vote | no | blinded votes only |
| viewer | read | none | none | no | no | non-vote data only |

## Codes

| HTTP | code | When |
|---|---|---|
| 400 | `invalid_protocol` | protocol content fails validation (bad PICO, empty version body) |
| 400 | `invalid_search` | unknown database, bad query/filters/date_to, search adapter error in input |
| 400 | `invalid_decision` | bad vote value, reason code required but missing/unknown, voting on an item outside your stage |
| 400 | `invalid_invitation` | bad email, unknown role |
| 403 | `not_member` | (Phase 1 code) caller has no membership row, or the role is too weak for the write |
| 403 | `resolver_only` | conflict resolution needs owner or editor |
| 404 | `protocol_not_found` | no such protocol (or version) in the project |
| 404 | `invitation_not_found` | no such invitation (or token unknown; same answer either way) |
| 404 | `search_not_found` | no such search run in the project |
| 404 | `record_not_found` | no such record in the project |
| 404 | `report_not_found` | no such report in the project |
| 404 | `conflict_not_found` | no such conflict in the project |
| 409 | `protocol_locked` | versioning or editing a locked protocol (create a new protocol instead) |
| 409 | `stale_version` | (Phase 1 code) update names a version older than the stored one |
| 409 | `conflict_open` | voting on an item whose conflict is still open; resolve it first |
| 409 | `already_decided` | invitation already accepted/declined/revoked |
| 410 | `invitation_expired` | invitation past expires_ts (gone, not merely invalid) |
| 422 | `exclusion_reason_unknown` | reason code is neither a global nor a project code |
| 429 | `search_rate_limited` | connector hit a database rate limit; retry after the given delay |
| 502 | `search_failed` | connector error after retries; the search run is saved with result_count 0 and the error |
| 503 | `database_unavailable` | research D1 is not provisioned |
| 503 | `storage_unavailable` | research R2 is not provisioned |

## 410 invitation_expired

Like 409 `stale_version`, the envelope may carry the current resource so the
screen can offer "resend invitation" without another round trip:

```json
{
  "error": { "code": "invitation_expired", "message": "Invitation expired", "requestId": "req_abc" },
  "current": { "invitation": { "id": "inv_1", "status": "expired" } }
}
```
