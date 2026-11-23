# ResearchMD Phase 3 worker callback contract (3.0)

The worker settles a job by calling the Pages API. The worker holds no user
tokens; this HMAC signature is its only credential. The API builder implements
the server side to this file; the worker side lives in
`backend/research/worker/research_worker/jobs.py`.

## Request

```
POST https://stewardmd.in/api/research/jobs/{jobId}/callback
Content-Type: application/json
X-Research-Timestamp: <unix seconds, integer as string>
X-Research-Signature: <hex HMAC-SHA256>
```

Body (exact JSON, no extra fields):

```json
{
  "jobId": "job_1",
  "idempotencyKey": "k1",
  "status": "done",
  "resultKey": "projects/p1/jobs/job_1/result.json",
  "usage": { "pages": 2, "seconds": 1.5 }
}
```

| Field | Type | Rules |
|---|---|---|
| `jobId` | string | must equal the path job id |
| `idempotencyKey` | string | must equal the stored `research_jobs.idempotency_key` |
| `status` | string | `done`, `failed` or `cancelled` |
| `resultKey` | string | required when `done`; the R2 key of `result.json` (retention.md). Absent otherwise |
| `error` | string | required when `failed`; a stable code from ceilings.md, never free text from the PDF. Absent otherwise |
| `usage` | object | always present. `pages`: integer, pages actually processed. `seconds`: number, wall clock rounded to 1 decimal |

## Signature

```
signature = hex( HMAC-SHA256( RESEARCH_CALLBACK_SECRET, timestamp + "." + rawBody ) )
```

- `rawBody` is the exact byte string sent, before any parsing or
  re-serialisation. The server must read the raw body first and verify before
  `JSON.parse`.
- `timestamp` is the header value verbatim (decimal unix seconds).
- Secret name: `RESEARCH_CALLBACK_SECRET` (Pages secret and container secret,
  same value, never in the repo).

Test vector (both sides must reproduce this in CI):

```
secret    = "test-secret"
timestamp = "1763900000"
rawBody   = {"jobId":"job_1","idempotencyKey":"k1","status":"done","resultKey":"projects/p1/jobs/job_1/result.json","usage":{"pages":2,"seconds":1.5}}
signature = d9526eaa7328d6c49e32502c09811b05d46cdea2f82ec680ab29afe838c487e5
```

(The rawBody above is the compact JSON string with no spaces; the signature
was computed over exactly those bytes.)

## Server verification order

1. Secret configured? No: 503 `callback_unavailable`.
2. Timestamp parses as integer and `abs(now - timestamp) <= 300`? No: 401
   `callback_skew`.
3. Signature matches (constant-time compare)? No: 401 `callback_signature`.
4. Body parses and validates against the table above? No: 400 `invalid_body`.
5. Job exists? No: 404 `job_not_found`.
6. `idempotencyKey` and path/body `jobId` match the stored row? No: 409
   `callback_mismatch`.
7. Replay: the job is already settled (`succeeded`, `failed` or `cancelled`)
   with this same `jobId` + `idempotencyKey`: return 200 with the stored job,
   change nothing. A settled job is never reopened by a callback.
8. Otherwise apply the transition in one statement guarded by
   `status IN ('queued','running')`:

| Callback status | research_jobs.status | Extra writes |
|---|---|---|
| `done` | `succeeded` | `output_json` = `{resultKey, usage}`, `completed_ts` |
| `failed` | `failed` | `error_code` = body `error`, `output_json` = `{usage}`, `completed_ts` |
| `cancelled` | `cancelled` | `output_json` = `{usage}`, `completed_ts` |

Credits settle on the same transition (section 7 of the plan): charge actual
usage, release the rest of the reservation.

## Worker behaviour

- Send with `httpx`, 10 s timeout per attempt, at most 3 attempts, backoff
  1 s then 2 s. Any 2xx settles. 4xx other than 409 is a contract bug: log,
  do not ack, let the queue retry (the DLQ alert catches it).
- Ack the queue message only after the result is written (when `done`) AND
  the callback returned 2xx. If the callback never returns 2xx, the message
  is explicitly retried with `delay_seconds` 60; the redelivery finds
  `result.json` already in R2 and skips straight to the callback (idempotent
  skip, below).
- Idempotent skip: before any extraction the worker checks
  `projects/{projectId}/jobs/{jobId}/result.json`. If it exists, the worker
  does no work and only re-sends the callback built from the stored result.
  The API guarantees one `jobId` per `(projectId, idempotencyKey)`, so the
  result key is the idempotency record; the stored JSON also carries the
  `idempotencyKey` for audit.
- The worker never sends PHI in the callback: codes and pointers only.