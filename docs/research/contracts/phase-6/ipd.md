# ResearchMD Phase 6: IPD compliance (5C.2 + 5C.3), module `_ipd.js`

Spec source: `docs/research/compliance/5C1-applicability.md` section 6 checklist.
Migration 0005 (this directory). Every route verifies Firebase claims and the
project role; an outsider gets 404. Admin incident routes use `adminAuth`
(institutions.md). No patient-level row ever reaches an LLM (plan rule 10).

## Routes

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/v1/projects/{pid}/ipd-evidence` | owner/editor/analyst | multipart `file` (1 B..10 MB, pdf/png/jpg), fields `kind`, `jurisdiction` (optional), `title`, `metadataJson` (optional), `expiresTs` (optional). R2 `projects/{pid}/ipd/evidence/{evidenceId}` |
| GET | `/v1/projects/{pid}/ipd-evidence` | all | metadata list, newest first |
| GET | `/v1/ipd-evidence/{eid}` | all | metadata only |
| GET | `/v1/ipd-evidence/{eid}/file` | owner/editor/analyst | raw bytes (evidence carries no patient rows) |
| POST | `/v1/ipd-evidence/{eid}/approve` | owner | sets approved + approved_by + approved_ts |
| POST | `/v1/ipd-evidence/{eid}/reject` | owner | sets rejected |
| POST | `/v1/projects/{pid}/ipd-config` | owner | body below; locks `research_projects.data_region` |
| GET | `/v1/projects/{pid}/ipd-config` | all | config or `{config:null}` |
| POST | `/v1/projects/{pid}/ipd-uploads` | owner/editor/analyst | multipart CSV; gate -> scanner -> encrypt -> R2 |
| GET | `/v1/projects/{pid}/ipd-datasets` | all | metadata list (no rows) |
| GET | `/v1/ipd-datasets/{id}` | all | metadata only |
| GET | `/v1/ipd-datasets/{id}/snapshot` | owner/editor/analyst | decrypted CSV; writes an access-log row on EVERY read |
| GET | `/v1/projects/{pid}/ipd-access-log` | owner | append-only log, newest first |
| POST | `/v1/projects/{pid}/stats-jobs` | owner/editor/analyst | `{datasetId, model, idempotencyKey, maxRows?, maxSeconds?}` |
| GET | `/v1/stats-jobs/{id}` | member | status |
| POST | `/v1/stats-jobs/{id}/cancel` | owner/editor/analyst | R2 cancel flag, same layout as pdf jobs |
| POST | `/v1/jobs/{id}/callback`, `/jobs/{id}/callback` | HMAC | dispatched here when the id is a stats job; callback.md verification order exactly |
| POST | `/v1/admin/incidents` | adminAuth | breach log create |
| GET | `/v1/admin/incidents`, `/v1/admin/incidents/{id}` | adminAuth | list / one |
| POST | `/v1/admin/incidents/{id}/status` | adminAuth | `{status: open|contained|closed, note?}` |

## IPD config body (owner)

```json
{
  "dataRegion": "IN|EU|US|GLOBAL_DEID",
  "jurisdictions": ["IN", "EU", "US"],
  "identifiabilityTier": "anonymised_deid|hipaa_lds|coded_pseudonymised",
  "legalBasis": { "IN": "consent|dpdp_s17_2_b_research",
                  "EU": "9_2_a_explicit_consent|9_2_j_scientific_research",
                  "US": "authorization|waiver|dua|deidentified" },
  "attestation": { "responsibility": true, "noIndividualDecisions": false,
                   "pediatric": false, "guardianConsent": false,
                   "dpia": false, "memberStateLaw": "", "noActualKnowledge": false },
  "agreements": { "dpa": false, "baa": false }
}
```

- `jurisdictions` may be empty only for `GLOBAL_DEID` + `anonymised_deid`.
- `US` legal basis `preparatory_to_research` is refused at config time (400):
  45 CFR 164.512(i)(1)(ii) forbids removing PHI from the covered entity.
- Saving the config pins `research_projects.data_region`; a later config with
  a different region is 409 `region_locked` once any IPD dataset exists, and
  the region column is never rewritten after the first lock.
- `attestation.responsibility` is the signed researcher responsibility
  attestation; it must be true or the config is refused (400).

## Upload gate (5C.3, HTTP 403 BEFORE any R2 write)

`ipd_gate` unless ALL hold:
1. An IPD config exists for the project.
2. `attestation.responsibility === true`.
3. Every required evidence group has at least one row with
   `status='approved'`, `approved_by = project.owner_uid`, and
   `expires_ts` null or in the future. Groups (any kind in a group satisfies it):
   - all jurisdictions: ethics = `[irb_approval, exemption_waiver]`
   - IN: `consent` basis -> `[consent_basis]`; `dpdp_s17_2_b_research` ->
     `attestation.noIndividualDecisions === true`; pediatric ->
     `attestation.guardianConsent === true`
   - EU: `agreements.dpa === true` AND `[dpa]`; `attestation.dpia === true`;
     `9_2_a_explicit_consent` -> `[consent_basis]`; `9_2_j_scientific_research`
     -> non-empty `attestation.memberStateLaw`
   - US `anonymised_deid`: `[safe_harbor, expert_determination]`; safe_harbor
     also requires `attestation.noActualKnowledge === true`
   - US `hipaa_lds` / `coded_pseudonymised`: `agreements.baa === true` AND
     `[baa]`; `hipaa_lds` -> `[dua]`; `coded_pseudonymised` ->
     `[dua, exemption_waiver, authorization]`
   - `GLOBAL_DEID` with no jurisdictions: `[safe_harbor, expert_determination]`
     plus `attestation.noActualKnowledge === true`
4. The error lists the missing group names only (never cell values).

The study-level path (`_data.js`) is untouched and still refuses patient-level
identifiers with 422 `ipd_gate`.

## Deterministic pre-upload scanner (T0, no LLM)

Headers and up to 200 sampled data rows are scanned before the snapshot is
committed. Hits return 422 `ipd_identifiers` with `{column, rule}` pairs only.
- `anonymised_deid` (Safe Harbor, 18 identifiers): name/MRN/SSN/Aadhaar/phone/
  fax/email/address/ZIP/URL/IP/device/license/vehicle/biometric/photo/account/
  health-plan columns; full dates other than year; ages > 89 in an `age`
  column; unique identifying code columns (patient_id, subject_id, ...).
- `hipaa_lds` (16 direct identifiers): the same minus dates, city/state and
  5-digit ZIP, which are permitted; patient codes are permitted.
- `coded_pseudonymised`: direct-identifier columns (names, MRN, SSN, Aadhaar,
  phone, fax, email, address, URL, IP) still block; coded ids and dates pass.
Known limit (documented, same posture as the PHI gate): free-text names inside
otherwise innocuous columns are not detectable deterministically; the tier
attestation and ethics evidence carry that responsibility.

## Envelope encryption at rest (5C.2)

- KEK: HKDF-SHA256 over `env.RESEARCH_IPD_KEK` (salt `research-ipd-kek-v1`,
  info `ipd-snapshot-wrap`) -> AES-KW-256 wrapping key. Unset or shorter than
  16 chars -> 503 `ipd_kek_unconfigured`. The KEK never enters D1 or R2.
- Per snapshot: random AES-GCM-256 data key, random 96-bit IV;
  `ciphertext = AES-GCM(dataKey, iv, plaintext)`; the R2 object
  `projects/{pid}/data/snapshots/{datasetId}.csv` holds ciphertext ONLY.
  The key keeps the job.py `R2_KEY_RE` shape (`data/snapshots/*.csv`) so the
  stats message validates; the BYTES are ciphertext (contentType
  `application/octet-stream`, customMetadata `containsIpd:"true"`).
- `wrappedKey = AES-KW(kek, dataKey)`; D1 `envelope_json` =
  `{alg:"AES-256-GCM", wrap:"AES-KW", iv:<b64>, wrappedKey:<b64>}`.
- Read: unwrap -> decrypt. A wrong KEK fails the unwrap (OperationError); the
  route answers 500 `ipd_decrypt_failed` (stable text, no detail).
- `sha256`/`bytes` on the row describe the plaintext for audit; the R2
  customMetadata carries `containsIpd:"true"`.

## Access log, residency, retention

- Every snapshot read writes `research_ipd_access_log`
  (`user_id, project_id, dataset_id, action='read', result, ip_hash, ts`).
  Upload writes `upload`; stats-job creation writes `analysis`. `ip_hash` =
  first 16 hex of SHA-256(client IP); the raw IP is never stored.
- `data_region` is the project residency pin (IN/EU/US/GLOBAL_DEID). Routing
  R2/worker execution to region-pinned infrastructure is an infra decision
  (D-2 provisioning); the API records and refuses cross-region config changes.
- Retention floors (sweeper is a later package): India access/processing logs
  >= 1 year; US compliance evidence >= 6 years. Cryptographic erasure =
  destroy the wrapped key + purge the R2 object + tombstone audit row; the
  erasure endpoint itself is deferred with the retention sweeper.

## stats_model jobs (job.py flag contract)

Message exactly per `backend/research/stats/job.py`:

```json
{ "v": 1, "kind": "stats_model", "jobId": "...", "projectId": "...",
  "idempotencyKey": "...", "createdAt": 0,
  "input": { "r2Key": "projects/<pid>/data/snapshots/<datasetId>.csv",
             "model": { "family": "cox", "...": "..." },
             "compliance": { "ipdApproved": true, "evidenceId": "ev_..." } },
  "ceilings": { "maxSeconds": 240, "maxRows": 100000 } }
```

- The compliance flag is attached ONLY when the upload gate re-passes at job
  creation (evidence still approved and non-expired). Otherwise 403 `ipd_gate`,
  no row, no message. `evidenceId` is the approved ethics evidence row.
- The worker re-checks the flag on every model call (`require_ipd_approval`).
- OPEN SEAM (recorded, not solved here): the Python worker reads plaintext CSV
  and holds no KEK, so it cannot yet decrypt an envelope-encrypted snapshot.
  The API-side gate and message contract are complete; the worker decryption
  seam (job-scoped unwrap capability) is Phase 5D wiring and must land before
  IPD stats jobs run end to end. Study-level stats_model jobs are not offered
  by this route because `require_ipd_approval` is unconditional.
- Credits: stats jobs are T0 deterministic work; no reserve/settle. Worker
  compute metering for stats is a Phase 5D decision.
- Callback: same HMAC order as callback.md; `done -> succeeded`, replay 200,
  key/scope mismatch 409. No credit movement (no reserve row).

## Gateway IPD refusal (`_gateway.js`)

`POST /v1/internal/llm` refuses, BEFORE the PHI gate and any provider call:
- any body with `containsIpd: true` (or `ipd: true`) -> 422 `ipd_blocked`;
- any request bound to a stats job with `contains_ipd = 1` -> 422 `ipd_blocked`.
Audit `ai_ipd_blocked` (metadata only). Aggregated, small-cell-suppressed
summary outputs are the only IPD-derived text that may enter drafting, and
only through the ordinary PHI-gated path (token insertion stays deterministic).

## Breach log SLA timers (computed at create, stored in sla_json)

- IN: DPBI intimation without delay; DPBI detailed report <= 72 h; CERT-In <= 6 h.
- EU: processor-to-controller without undue delay; authority <= 72 h.
- US: BA-to-CE / individuals / OCR <= 60 calendar days; < 500 annual log note.
`encrypted_flag` records whether the affected data was envelope-encrypted
(GDPR Art. 34(3)(a) / HIPAA safe harbor context for the responder).

## Worker decryption (Phase 5D seam)

`backend/research/stats/ipd_crypto.py` decrypts envelope snapshots in the
Python worker, byte-compatible with this module's `deriveKek` /
`encryptSnapshot` (cryptography library):

- KEK: HKDF-SHA256 over env `RESEARCH_IPD_KEK` (UTF-8 bytes), salt
  `research-ipd-kek-v1`, info `ipd-snapshot-wrap`, 32-byte output. Unset or
  shorter than 16 chars fails `ipd_kek_unconfigured`. The worker secret must
  be the SAME value as the Pages API secret; it never enters D1, R2 or logs.
- Unwrap: AES-KW (RFC 3394, no padding) over the 40-byte `wrappedKey` ->
  32-byte data key. Decrypt: AES-256-GCM, 12-byte IV, 128-bit tag appended
  to the ciphertext (WebCrypto layout), no AAD.
- Delivery: the stats message carries `input.envelope`, the D1
  `envelope_json` object verbatim (`{alg, wrap, iv, wrappedKey}`). Producer
  wiring still open on the API side: `createStatsJob` must attach
  `envelope: JSON.parse(dataset.envelope_json)` to `input` when enqueuing
  (functions/ is not edited by the worker seam). A message without
  `input.envelope` is a plaintext snapshot and follows the existing path.
- Gate order (`stats/job.py`): `require_ipd_approval` runs BEFORE any
  unwrap. Without `{ipdApproved:true, evidenceId}` the job fails `ipd_gate`
  and never touches the KEK. A wrong KEK or tampered ciphertext, wrapped
  key or IV fails `ipd_decrypt_failed` (stable code, no detail; mirrors the
  API's 500). A malformed envelope fails `validate_message` (DLQ).
- Plaintext stays in worker memory only: never written to R2, disk or
  logs. `result.json` keeps aggregates + manifest only. Idempotent replay
  and cancel paths need no KEK.
- Container env: `RESEARCH_IPD_KEK` reaches the container only if listed in
  `ENV_KEYS` (`workers/research-worker/src/index.js`); add it there at
  provisioning. Set with `npx wrangler secret put RESEARCH_IPD_KEK` in
  `workers/research-worker` (its README lists every worker secret).
- Cross-language test: `node test/fixtures/research/ipd/make-vector.mjs`
  regenerates `test/fixtures/research/ipd/vector.json` using this module's
  own `encryptSnapshot` with a fixed TEST KEK (committed fixture, not a
  production secret). `backend/research/tests/test_stats_ipd_crypto.py`
  decrypts the vector byte-exactly, runs a stats_model job on it end to
  end, and asserts wrong-KEK, tamper and no-flag refusals.
