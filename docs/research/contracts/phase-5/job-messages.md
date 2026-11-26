# ResearchMD Phase 5 job messages (stats_model, manuscript_draft)

The Phase 3 `job-message.schema.json` `kind` enum now lists `pdf_extract`,
`stats_model` and `manuscript_draft`. The schema's `input`/`ceilings` blocks
still describe `pdf_extract` only (the Phase 3 builder owns that file beyond the
kind enum). This document is the contract for the two new kinds' `input` and
`ceilings` shapes until a reviewed edit makes the Phase 3 schema per-kind.
The worker routes each kind to its own validator and handler
(`research_worker.jobs.handler_for`); a message that fails its kind's validator
retries to the DLQ exactly like a malformed `pdf_extract`.

Common envelope (all kinds): `{v: 1, jobId, kind, projectId, idempotencyKey,
input, ceilings, createdAt}`. Pointers only: no user tokens, no Firebase claims,
no PHI, no file bytes. The `projectId` inside `input.r2Key` must equal the
message `projectId`; the handler checks this before reading. Results go to
`projects/{projectId}/jobs/{jobId}/result.json`; the HMAC callback carries codes
and pointers only (`phase-3/callback.md`). The callback `usage` object stays
`{pages, seconds}` for every kind; AI token detail lives in `result.json` and in
the server-side `research_ai_usage` rows, not in the callback.

## stats_model (Phase 5D)

Handler: `backend/research/stats/job.py`. Canonical for regression, survival and
diagnostic models, with R parity. No LLM call; patient-level rows never reach an
LLM (5C.3 IPD gate).

```json
{
  "v": 1, "kind": "stats_model",
  "jobId": "job_1", "projectId": "p1", "idempotencyKey": "k1",
  "createdAt": 1763900000,
  "input": {
    "r2Key": "projects/p1/data/snapshots/imp1.csv",
    "model": {"family": "linear", "formula": "y ~ x1 + x2"},
    "compliance": {"ipdApproved": true, "evidenceId": "irb-2026-001"}
  },
  "ceilings": {"maxSeconds": 240, "maxRows": 100000}
}
```

- `input.r2Key`: `^projects/<pid>/data/(snapshots/)?<name>\.(csv|json)$`.
- `input.model.family`: `linear | logistic | km | logrank | cox | diagnostic`
  (model specs in `stats/job.py`).
- `input.compliance`: mandatory; `ipdApproved` must be true or the job fails
  `ipd_gate` before any computation.
- `ceilings.maxSeconds` 1..240, `ceilings.maxRows` 1..100000 (global caps).
- `result.json`: aggregate statistics + manifest (data hash, model spec,
  engine version), never rows.

## manuscript_draft (Phase 5A.1)

Handler: `backend/research/manuscript/job.py`. Drives the PaperOrchestra adapter
(outline -> section writing -> gated refinement -> JSON manuscript) from a
frozen project snapshot. Every LLM call goes through the gateway client with a
per-job bearer token minted locally from `RESEARCH_CALLBACK_SECRET`
(`phase-3/gateway.md`); no provider key. The PHI gate and tier ceilings run
inside the client before any request leaves the worker.

```json
{
  "v": 1, "kind": "manuscript_draft",
  "jobId": "job_2", "projectId": "p1", "idempotencyKey": "k2",
  "createdAt": 1763900000,
  "input": {
    "r2Key": "projects/p1/manuscript/snapshots/snap1.json",
    "cutoffDate": "2024-11"
  },
  "ceilings": {"maxSeconds": 600, "maxCalls": 64}
}
```

- `input.r2Key`: `^projects/<pid>/manuscript/snapshots/<name>\.json$`. The object
  is the ResearchMD manifest (`po_adapter/loader.py` shape): protocol (locked),
  verified evidence, `rob`, `grade`, saved `runs`, `references`.
- `input.cutoffDate` (optional): `YYYY-MM` literature cutoff.
- `ceilings.maxSeconds` 1..600, `ceilings.maxCalls` 1..64. `maxCalls` is the
  adapter-local per-job call guard (SEAMS.md; not a ceilings.md row). Tier token
  /retry/refinement ceilings are enforced by the gateway client (T2 default).
- `result.json` on done: `{jobId, idempotencyKey, status, usage, aiUsage, draft}`
  where `draft` is the manuscript JSON with numbers STILL canonical
  `{{run:<runId>.<fieldPath>}}` tokens (unresolved). `aiUsage` carries the
  per-call gateway usage records for cost measurement (5A.4).
- On a hard-gate failure the job fails `gate_failed` and persists the violation
  list to `result.json` (`violations`) for audit/UI; no partial draft is
  returned. Other stable codes: `input_missing`, `snapshot_invalid`,
  `phi_blocked`, `gateway_unconfigured`, the loader codes, the ceiling codes,
  `gateway_*`, `manuscript_failed`.

### Enqueue guards and caps (`POST /v1/projects/{id}/jobs`, `kind: "manuscript_draft"`)

Checked in order before queuing:
0. Feature gate: `env.RESEARCH_PO_ENABLED === "1"` (checked first, before the
   project/role gate; otherwise `404 not_found`).
1. Role & study type: `owner`, `editor`, or `analyst` role (`projectGate`); the
   project's `study_type` must be a systematic review or meta-analysis
   (`409 not_systematic_review` otherwise).
2. Frozen baseline: latest `research_protocols` row must have `status = 'locked'`
   and a non-empty `lock_hash` (`409 protocol_unlocked`), and the project must
   have at least one saved `research_runs` row (`409 no_saved_run`).
3. Idempotency & concurrency: replay on `(projectId, idempotencyKey)` returns
   the existing job (`200`, `idempotentReplay: true`; `409 idempotency_conflict`
   if that key was used for another job kind); any other `queued` or `running`
   `manuscript_draft` job for the project fails `409 job_active`.
4. Daily caps (UTC day): max `3` `manuscript_draft` jobs per project
   (`429 cap_po_project_daily`) and max `5` per user (`429 cap_po_user_daily`).
5. Credits & PHI gate: quotes `quoteAiCall(env, "T2") * 64` micro-USD
   (`402 insufficient_credits`), reserves the quote, builds the v1 manifest
   snapshot (locked protocol, verified evidence with `locator` and `quote`,
   verified/agreed RoB with `locator` and `quote`, saved runs, GRADE,
   references), and runs `scan(JSON.stringify(snapshot))`. A PHI hit releases
   credits immediately and returns `422 phi_blocked` with `{categories}` only
   (nothing is written to R2 or queued).

## Container

`worker/Dockerfile` COPYs `stats/`, `manuscript/` and `paperorchestra/` and sets
`PYTHONPATH=/srv/research/worker:/srv/research` so every registered kind imports.
The adapter puts `paperorchestra/upstream` on `sys.path` itself at import.
