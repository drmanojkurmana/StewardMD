# ResearchMD Phase 3 retention and deletion (3.0)

## What is kept, and for how long

| Data | Where | Retention |
|---|---|---|
| Uploaded PDFs | R2 `projects/{projectId}/pdf/{sha256}.pdf` | while the project exists |
| Extraction results | R2 `projects/{projectId}/jobs/{jobId}/result.json` | while the project exists |
| Cancel flags | R2 `projects/{projectId}/jobs/{jobId}/cancel` | until the job settles, then deleted |
| Job metadata, audit pointers | D1 `research_jobs`, `research_audit_events` | while the project exists (FK cascade) |

When a project is deleted, every R2 object under `projects/{projectId}/` and
every D1 row scoped to it is deleted within 30 days. The API marks the project
deleted immediately (reads and writes stop); a sweeper job completes the R2
deletion. No backup copies are kept beyond that window; R2 versioning is off
for this bucket.

## R2 key layout (private bucket stewardmd-research)

```
projects/{projectId}/pdf/{sha256}.pdf          uploaded PDF, content-addressed
projects/{projectId}/jobs/{jobId}/result.json  extraction result (extract.py shape)
projects/{projectId}/jobs/{jobId}/cancel       empty object; presence means cancel
```

Rules:

- `{sha256}` is the hex SHA-256 of the exact uploaded bytes. Re-uploading the
  same file in a project reuses the object; the API still records a new
  artifact row pointing at it.
- The worker only ever reads/writes keys under the message's `projectId`, and
  checks that `input.r2Key` starts with `projects/{projectId}/` before reading.
- No public access, no cross-project sharing, no caching of paywalled full
  text across tenants. The app reads PDFs through short-lived presigned GETs
  (15 minutes max) issued by the API after the role check; the worker's S3
  credentials never reach the app.
- `result.json` carries `jobId`, `idempotencyKey`, `status`, `usage` and the
  extraction payload, so a redelivered job can settle from storage alone
  (callback.md idempotent skip).

## Deletion mechanics

1. API deletes the project row; D1 FKs cascade metadata and audit pointers.
2. API writes a deletion task (D1) with `projectId` and `due_ts` (now + 30 d
   upper bound; the sweeper runs daily and deletes immediately when it runs).
3. Sweeper lists and deletes every object under `projects/{projectId}/`.
4. Audit: the deletion itself is logged in the platform audit log (project id
   only, no PHI) before the rows disappear.

Cancel flags: the API writes the `cancel` object when a user cancels; the
worker checks it between pages; the API deletes it when the job settles.
A cancel for an already-settled job is a no-op (the callback replay rule).