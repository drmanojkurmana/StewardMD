# ResearchMD Phase 3 threat model (3.0)

Scope: the PDF extraction pipeline and the AI foundation. Assets, actors,
trust boundaries, STRIDE analysis, and mitigations mapped to code. Reviewed
before any AI call or PDF processing ships (plan 3.0).

## Assets

| Asset | Sensitivity |
|---|---|
| Uploaded PDFs (paywalled full text, possible incidental PHI) | high: copyright plus privacy |
| Extraction results and project metadata (D1) | high: tenant research data |
| Credits / MaiK wallet balances | high: money |
| `RESEARCH_CALLBACK_SECRET`, `CF_QUEUES_TOKEN`, R2 keys, `DRAIN_TOKEN` | critical: pipeline credentials |
| Firebase ID tokens (app to API only) | critical: user identity |
| Audit trails | high: integrity evidence |

## Actors

- Malicious or careless uploader: tries to store PHI, oversize files, or
  instruction-laden PDFs (prompt injection).
- Curious tenant: tries to read another project's PDFs, jobs or results.
- External attacker: replays or forges callbacks, hits the drain endpoint,
  guesses R2 keys.
- Compromised or curious LLM provider: receives whatever the gateway sends.
- Malicious PDF content: text that impersonates instructions to the model.

## Trust boundaries

```
app ──(1 Firebase ID token)──> Pages API ──(2 producer binding)──> research-jobs queue
queue ──(3 HTTP pull, CF_QUEUES_TOKEN)──> container worker
worker ──(4 S3 keys, project-scoped)──> R2
worker ──(5 HMAC callback)──> Pages API
worker/API ──(6 PHI gate, gateway key)──> LLM gateway
```

1. App to API: untrusted client. Every call authenticates the Firebase token
   and checks the project role server-side.
2. API to queue: trusted producer; messages validated against
   job-message.schema.json before send. No tokens or PHI in messages.
3. Queue to worker: the pull token is the only credential; the worker treats
   every message body as untrusted input even though the producer is ours.
4. Worker to R2: keys are project-scoped by contract and checked in code.
5. Worker to API: HMAC signature plus timestamp; the worker holds no user
   tokens and cannot act as a user.
6. Gateway boundary: the PHI gate is the last deterministic check before any
   text leaves.

## STRIDE

| Threat | Boundary | Attack | Mitigation | Code location |
|---|---|---|---|---|
| Spoofing | 5 | forged callback settles a job or steals credits | HMAC-SHA256 over timestamp + raw body, 300 s skew window, constant-time compare | `worker/research_worker/jobs.py` (sign), API callback handler per callback.md |
| Spoofing | 3 | attacker pulls or acks messages | Bearer token with queues read/write only, stored as a secret | `worker/research_worker/queue.py` |
| Spoofing | drain | stranger triggers compute | `X-Drain-Token` constant-time check; endpoint unreachable publicly (Worker fetch returns 404) | `worker/research_worker/app.py`, `workers/research-worker/src/index.js` |
| Tampering | 2/3 | message points at another project's PDF | schema pattern plus worker check that `input.r2Key` starts with `projects/{projectId}/` | `worker/research_worker/jobs.py` |
| Tampering | 4 | result swapped after write | content-addressed PDF keys (sha256), result carries jobId + idempotencyKey; callback replay never reopens settled jobs | retention.md, callback.md |
| Repudiation | all | user denies a decision or extraction | audit events per screening vote, correction, run, approval; jobs carry attempt counts and usage | D1 `research_audit_events`, `research_jobs` |
| Info disclosure | 6 | PHI reaches an LLM provider | deterministic PHI gate before every gateway call; 100% synthetic block gate | phi-gate.md (3.5 implementation) |
| Info disclosure | 4 | cross-tenant PDF read | private bucket, no public access, presigned GETs <= 15 min after role check, project-scoped worker keys | retention.md, API artifact endpoints |
| Info disclosure | 1 | token or PHI in URLs/logs | pointers only in messages and callbacks; codes not matched text in logs | job-message.schema.json, callback.md |
| DoS | 3/4 | giant or endless PDF burns compute | 60 pages / 240 s / 25 MB ceilings, batch 20, daily caps, 3 retries then DLQ | `worker/research_worker/extract.py`, ceilings.md |
| DoS | drain | cron storm spawns containers | single named DO serialises drains; max_instances 3; inactivity timeout 5 min | `workers/research-worker/src/index.js`, worker-runtime.md |
| Elevation | 1 | viewer writes, reviewer sees unblinded votes | server-enforced role matrix on every endpoint | Phase 2 errors.md role matrix, API |
| Elevation | 5 | worker acts as a user | worker holds no Firebase tokens; callback can only settle the named job | callback.md |
| Injection | 6 | PDF text instructs the model | document text is delimited data, never instructions; system prompt forbids following document instructions; prompt-injection test set, gate: 0 instructions followed | 3.0 test set, 3.5 gateway adapter |

## Untrusted input rules (plan rule 11)

- PDF bytes are parsed, never executed. No embedded JavaScript, no external
  entity resolution, no network fetches from within a document.
- Extracted text is data. Any instruction inside it is ignored by design and
  covered by the injection test set.
- Error messages surfaced to the app are stable codes from ceilings.md, never
  raw exception text (which could echo document content).

## Residual risks (accepted for Phase 3)

- Incidental PHI inside a published PDF is stored (retention.md) but never
  sent to an LLM; the upload warning is advisory.
- A compromised Cloudflare account is out of scope; secret rotation is an
  infra runbook step (vault/Infra.md).
- OCR quality on poor scans is a data-quality risk, handled by human
  verification (plan rule 9), not a security control.