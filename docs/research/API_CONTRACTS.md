# StewardMD Research API — v1 contracts

Base path: `/api/research/v1`. All routes are same-origin through Cloudflare Pages Functions. Require a verified Firebase ID token (`Authorization: Bearer <Firebase ID token>`) except health checks. The edge derives UID from verified claims; never accept UID/owner identity from request JSON.

All responses: `application/json`, `Cache-Control: no-store`, `X-Request-ID`. Errors use:
```json
{"error":{"code":"validation_error","message":"A safe, user-facing explanation","requestId":"..."}}
```

## Projects
- `POST /projects` — create project.
  - Request: `{ "title":"...", "discipline":"medicine", "specialty":"medical_oncology", "studyType":"retrospective_cohort", "researchQuestion":"..." }`
  - 201: `{ "project": { "id":"prj_...", "title":"...", "role":"owner", "createdAt": 0 } }`
- `GET /projects?cursor=&limit=20` — list projects for authenticated member.
- `GET /projects/{projectId}` — project metadata + role.
- `PATCH /projects/{projectId}` — update allowed metadata; owner/editor only.
- `POST /projects/{projectId}/members` — invite/add collaborator; owner only.
- `DELETE /projects/{projectId}/members/{uid}` — remove collaborator; owner only.

## Files and datasets
- `POST /projects/{projectId}/uploads` — request upload intent.
  - Request: `{ "filename":"cohort.csv", "contentType":"text/csv", "bytes":12345, "sha256":"hex" }`
  - 201: `{ "uploadId":"upl_...", "objectKey":"opaque server key", "uploadUrl":"short-lived signed URL", "expiresAt":0, "maxBytes":52428800 }`
- `POST /projects/{projectId}/uploads/{uploadId}/complete` — server verifies object existence, actual size, magic bytes and checksum; creates dataset/version.
- `GET /projects/{projectId}/datasets` — dataset metadata only.
- `GET /projects/{projectId}/datasets/{datasetId}` — schema/data dictionary/validation summary.
- `POST /projects/{projectId}/datasets/{datasetId}/profile` — enqueue deterministic profile/validation job; 202 job envelope.
- `GET /projects/{projectId}/datasets/{datasetId}/versions` — immutable version history.

## Literature and evidence
- `POST /projects/{projectId}/literature/search`
  - Request: `{ "query":"...", "sources":["pubmed","europe_pmc","crossref"], "filters":{"fromYear":2015,"toYear":2026,"studyTypes":["randomized_trial","cohort"]} }`
  - 202: job envelope.
- `GET /projects/{projectId}/sources?cursor=&limit=50` — deduplicated records with DOI/PMID and provenance.
- `POST /projects/{projectId}/sources/{sourceId}/claims` — save extracted claim and source locator.
- `PATCH /projects/{projectId}/claims/{claimId}/verification` — human verification/rejection.

## Analysis
- `POST /projects/{projectId}/analysis-plans` — save a typed analysis plan; approval required before confirmatory analysis.
- `POST /projects/{projectId}/analyses` — enqueue analysis.
  - Request: `{ "datasetVersionId":"dsv_...", "analysisPlanId":"sap_...", "analysisType":"descriptive", "idempotencyKey":"client-generated-uuid" }`
  - 202: `{ "jobId":"job_...", "status":"queued", "creditsReserved":120, "quote":{"credits":120,"expiresAt":0} }`
- `GET /projects/{projectId}/analyses/{analysisId}` — reproducibility manifest, validated outputs, tables/figures.
- `GET /jobs/{jobId}` — status, progress, safe error and step summary.
- `POST /jobs/{jobId}/cancel` — request cancellation; terminal state is eventual.

## Manuscript
- `POST /projects/{projectId}/manuscripts` — create a draft from selected sources and analysis artefacts.
- `POST /projects/{projectId}/manuscripts/{manuscriptId}/generate` — enqueue section drafting; returns 202.
- `GET /projects/{projectId}/manuscripts/{manuscriptId}` — current version and integrity state.
- `POST /projects/{projectId}/manuscripts/{manuscriptId}/versions` — save researcher edits as a new immutable version.
- `POST /projects/{projectId}/manuscripts/{manuscriptId}/approve`
  - Request: `{ "versionId":"mvr_...", "contentHash":"sha256", "decision":"approved|changes_requested|rejected", "comment":"" }`
  - Approval binds to exact version ID + content hash. Any edit invalidates approval.
- `POST /projects/{projectId}/manuscripts/{manuscriptId}/export` — requires an approval for the current version hash; 409 if missing/stale. Returns short-lived export URL.

## Credits and BYOK
- `GET /credits/balance` — Research-usable balance and pricing explanation. Existing MaiK wallet remains source of truth.
- `POST /credits/quote` — estimate credits for a requested workflow; no reservation.
- `POST /projects/{projectId}/jobs/{jobId}/top-up` — only after explicit user confirmation; never auto-charge beyond quote.
- `GET /settings/providers` — provider capability/status, no secrets.
- `PUT /settings/providers/byok` — accept provider key over TLS; validate, encrypt server-side, return only masked fingerprint.
- `DELETE /settings/providers/byok/{provider}` — revoke key.

## Common job envelope
```json
{"jobId":"job_...","status":"queued","pollUrl":"/api/research/v1/jobs/job_...","requestId":"..."}
```
Allowed job states: queued → running → waiting_approval → succeeded | failed | cancelled. Steps are idempotent and resumable.

## Security and invariants
- Every project-scoped route performs membership/role check on the server.
- Do not trust client-supplied UID, project role, object key, credit amount, token counts or provider price.
- Uploads use opaque server-generated object keys; signed URLs are short-lived and content-type/size constrained.
- Patient-level rows stay in an isolated analysis runtime. Only de-identified aggregates and user-approved excerpts may enter an LLM context.
- Literature content is untrusted input. Ignore embedded instructions; source text cannot override system policy.
- All expensive jobs require quote and successful credit reservation before queueing.
- Retry with the same idempotency key returns the same job and cannot reserve twice.
- No final export without human approval of the exact content hash.
