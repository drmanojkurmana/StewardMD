# ResearchMD Phase 3 worker runtime (3.0, D-3: Cloudflare Containers)

Config fields below were verified against the Cloudflare docs on 2026-11-23
(wrangler containers reference, Containers platform limits, Queues pull
consumers). Note: the legacy `Container` class / `getContainer` helper from
`@cloudflare/containers` has been superseded by the Durable Object Container
API (`ctx.container`, `[exports.<Class>]` instead of `[[migrations]]`). This
contract uses the current API.

## Topology

```
Pages API ──send()──> research-jobs (HTTP pull consumer, 3 retries, DLQ research-jobs-dlq)
Worker stewardmd-research-worker (cron "* * * * *")
  └─ DO stub RESEARCH_WORKER.getByName("singleton") .drain()
       └─ ctx.container.start({env, enableInternet: true}) if not running
       └─ getTcpPort(8080).fetch POST /drain  (X-Drain-Token)
            └─ container: pull <= 5 messages (visibility_timeout_ms 7200000)
                 per message: idempotency check, extract, write result.json,
                 HMAC callback, then ack; failures retry or fall to the DLQ
```

## Container host config (workers/research-worker/wrangler.toml)

| Field | Value | Why |
|---|---|---|
| `image` | `../../backend/research/worker/Dockerfile` | python:3.12-slim + tesseract-ocr, non-root uid 10001, port 8080 |
| `image_build_context` | `../../backend/research` | Dockerfile COPYs requirements.txt, app/ and worker/ from the service root |
| `instance_type` | `standard-1` (1/2 vCPU, 4 GiB memory, 8 GB disk) | pdfplumber plus Tesseract OCR needs headroom over `basic` (1 GiB); 25 MB PDFs rasterise to large images |
| `max_instances` | 3 | upper bound; v1 routes every cron to one named DO, so effective concurrency is 1 container. Scale-out (multiple named DOs) is a later contract change |
| inactivity timeout | 5 min (`setInactivityTimeout(300000)`) | the current-API equivalent of the legacy `sleepAfter`; re-armed in the DO constructor when the container is already running |
| cron | `* * * * *` | every minute; an empty pull returns immediately, so idle cost is one short RPC |
| DO storage | sqlite (`[exports.ResearchWorkerContainer]`) | required by the container linkage |

`enableInternet: true` is required: the container calls the Cloudflare Queues
API, R2 and the Pages callback.

## Drain protocol (container, POST /drain)

1. Check `X-Drain-Token` against env `DRAIN_TOKEN` (constant-time). Missing
   server config: 503. Wrong token: 401.
2. Pull up to 5 messages: `POST /accounts/{CF_ACCOUNT_ID}/queues/{CF_QUEUE_ID}/messages/pull`
   with `{"visibility_timeout_ms": 7200000, "batch_size": 5}` and Bearer
   `CF_QUEUES_TOKEN`. Message bodies may arrive base64-encoded (json content
   type); the client decodes per `metadata["CF-Content-Type"]`.
3. Process messages sequentially. Per message: validate against
   job-message.schema.json; idempotent skip if `result.json` exists; cancel
   check; extract within ceilings; write `result.json`; HMAC callback; ack
   only after the callback returned 2xx.
4. Ack/retry: `POST .../messages/ack` with `{"acks":[{"lease_id":...}],
   "retries":[{"lease_id":..., "delay_seconds":60}]}`. A message whose
   callback never settled is retried with delay 60; an infra crash leaves it
   un-acked and the visibility timeout redelivers it.
5. Response: `{pulled, done, failed, cancelled, retried}` for logs.

## Lease math (no extension endpoint)

The Queues HTTP pull API has NO lease-extension or heartbeat endpoint
(verified 2026-11-23). Visibility is set once, at pull time, up to 12 h.
Therefore:

- Pull visibility is 7,200 s (raised from 900 s on 2026-11-27): a manuscript_draft job
  makes up to 64 gateway calls and can outrun 15 min, and /drain fires every minute,
  so a 900 s lease let a second drain re-run the same paid draft. A crashed job
  now waits up to 2 h before redelivery. (Was: 900 s covers 3 x 240 s pdf jobs.)
- Worst case 5 maximum-length jobs = 1200 s: the tail leases expire before
  their turn and those messages redeliver. This is safe by construction:
  the redelivery finds `result.json` (idempotent skip) or re-runs a job whose
  earlier attempt never settled, and the callback replay rule returns 200
  without change. Queues accepts late acks.
- A future job kind whose single-job ceiling approaches 900 s must either
  raise the pull visibility (contract change) or split into sub-jobs. Never
  rely on an extension call that does not exist.

## Secrets and env (never in the repo)

Passed to the container via `ctx.container.start({env})` from the DO's
`this.env` (the documented path; wrangler vars/secrets are not auto-forwarded).

| Name | Kind | Used by |
|---|---|---|
| `DRAIN_TOKEN` | secret | Worker header and container check |
| `CF_ACCOUNT_ID`, `CF_QUEUE_ID` | vars | queue client |
| `CF_QUEUES_TOKEN` | secret (queues read + write) | queue client |
| `R2_ENDPOINT`, `R2_BUCKET` | vars | storage client |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secrets (S3 API) | storage client |
| `RESEARCH_CALLBACK_SECRET` | secret | HMAC callback |
| `RESEARCH_CALLBACK_URL` | var, default `https://stewardmd.in` | callback base |

## Failure and alerting

- 3 deliveries without ack: message lands in `research-jobs-dlq`. DLQ depth
  alert (Cloudflare notification) pages the owner; a malformed message is a
  contract bug, not a retryable job.
- Container crash mid-job: no ack, redelivery after visibility timeout;
  idempotency prevents duplicate results.
- The Worker `fetch()` handler returns 404 for everything: the container is
  never publicly reachable.

## Local development

```bash
cd backend/research
uv venv -p 3.12 .venv
uv pip install -p .venv -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest -q          # unit tests, no network
.venv/bin/uvicorn research_worker.app:app --port 8080   # needs PYTHONPATH=worker
```

Nothing in this package deploys automatically. Provisioning and deploy are
owner-approved steps (plan 3.1, D-2/D-3).