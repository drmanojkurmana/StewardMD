# StewardMD Connect — ABDM Owner-Onboarding + Go-Live Gates

**This is the single document the owner works through before the first real ABDM call.** It consolidates
every provisioning step, every `// VERIFY` owner-pin scattered across the shipped Stage-1..6 ABDM modules,
the legal / clinical / DPDP sign-offs, the wiring gaps that still block a live HIP serve, the DPIA items,
and the safe flag-enable + rollback sequence — as concrete, checkable items.

> **Authored:** Stage 6 (hardening), Phase 1 (ABDM). Spec: `docs/superpowers/specs/2026-07-31-stewardmd-connect-part2-abdm-design.md` §13 + §14 (stage-6 item 5).
> Plan: `docs/superpowers/plans/2026-07-31-connect-phase1-stage6-hardening.md`.

## Current state (what is true today)

- The code is **merged behind two flags, both default OFF, and is inert + mock-only**: base flag `smd_connect`
  (env **`CONNECT_FLAG`**), HIP-serve flag `smd_connect_hip` (env **`CONNECT_HIP_FLAG`**). With either flag
  unset — or any binding missing — every `/api/connect/*` route 404/400s, so a partial provision cannot leak.
- **No D1/R2 binding, no secrets, no real ABDM credential** exists yet. Nothing runs until the steps below are done.
- **`// VERIFY` owner-pins outstanding in the merged code: 64 as of authoring** (`grep -rn "// VERIFY" functions/_connect | wc -l`
  — reproducible; the remaining Stage-6 tasks are still landing in parallel, so re-run the grep for the live count).
  Every one is enumerated in **Section 4** and fails **closed** until pinned. (Was 56 at Phase 0/1; Stage-5 HIP
  added `hip.js`×5 + `hip-flags.js`×1; Stage-6 hardening added the `state.js` GC-query + age-backstop pins.)
- **Two wiring gaps block a functional HIP serve** even after the flags are on — the FollowCare episode-reader
  injection and the sweep type-contract. See **Section 5**. These are fail-closed today (throw / no-op), not leaks.

## How this relates to the other checklist

`docs/connect-GO-LIVE-CHECKLIST.md` is the **broader** Connect go-live checklist (Phase 0 FHIR-pull + Phase 1
ABDM + a note that connector Tracks A–D will each append their own section). **This ABDM owner-onboarding doc is
the authoritative pre-real-ABDM-call gate** and is self-contained for the ABDM path; where the two overlap, work
this one. Do not treat either as complete for the future Track A–D connectors.

**Recovery / rollback anchors:** tags `pre-connect-stage3-merge`, `pre-connect-stage4-merge`, `pre-connect-stage5`,
`pre-connect-stage6`; instant kill = set `CONNECT_FLAG` (and `CONNECT_HIP_FLAG`) unset/`0`. See **Section 8**.

---

## Section 1 — Cloudflare provisioning (bindings, secrets, env vars)

All Connect data-plane bindings are **Cloudflare Pages bindings** (Pages project → Settings → Functions →
bindings/secrets), **not** `wrangler.toml`. This is deliberate and fail-safe. The **cron sweep** (Section 8 /
Stage-6 T8) runs in the separate `stewardmd-api` **Worker** (`wrangler`), which delegates to a Pages Function via
`X-Admin-Token`.

### 1a. D1 (canonical + ABDM state)
- [ ] Create the dedicated D1 database: `wrangler d1 create stewardmd-connect` — record the returned `database_id`.
- [ ] Add it as a **Pages binding** named **`CONNECT_DB`** → the `stewardmd-connect` DB. (Code reads `env.CONNECT_DB`.)
- [ ] Confirm the D1 **region is India** where the option exists (spec §13.4 / R16 residency). If unavailable, record the gap in the DPIA (Section 7).

### 1b. R2 (transient encrypted push-buffer)
- [ ] Create an R2 bucket: `wrangler r2 bucket create stewardmd-connect` (or a chosen name).
- [ ] Add it as a **Pages binding** named **`CONNECT_R2`**. (Code reads `env.CONNECT_R2`; holds only Fidelius ciphertext, erased on ack/sweep.)
- [ ] Confirm the R2 **jurisdiction is India** where offered; otherwise document the residency gap (R16 DPIA item, Section 7).

### 1c. KV (non-PHI only)
- [ ] Confirm the existing **`MAIK_KV`** namespace is bound to the Pages project. Connect **reuses** it (JWKS public-key cache `connect:abdm:jwks`, gateway token cache, discovery rate-limit counters `connect:abdm:disco:*`, ingress replay-nonce cache) — **no new KV namespace**. **Invariant: no PHI / ABHA / key material in KV** (R16).

### 1d. Secrets + env vars
- [ ] **`CONNECT_MASTER_KEY`** — 32-byte AES-256 key, base64. `secrets.js` requires exactly 32 raw bytes. Generate: `openssl rand -base64 32`.
- [ ] **`CONNECT_HMAC_SALT`** — per-deployment salt for the `patient_abha_hash` / `careContextHash` / `patientRefHash` HMAC (`audit.js#hmacPseudonym`, `state.js`, `hip.js`). Generate high-entropy: `openssl rand -base64 32`. **Rotation priority is raised** — ABHA is low-entropy (~10^14) so a leaked salt is brute-forceable (R17 DPIA item, Section 7).
- [ ] **`CONNECT_FLAG`** — base kill-switch. Leave **unset / `0`** until go-live. Set to `"1"` to enable `smd_connect`.
- [ ] **`CONNECT_HIP_FLAG`** — HIP-serve flag (`smd_connect_hip`). Leave **unset / `0`**. HIP requires **BOTH** `CONNECT_FLAG` and `CONNECT_HIP_FLAG` (`hip-flags.js#hipFlagOn`).
- [ ] **`ABDM_CLIENT_ID`** — ABDM sandbox client id (Section 3 registration).
- [ ] **`ABDM_CLIENT_SECRET`** — ABDM sandbox client secret.
- [ ] **`ABDM_JWKS_URL`** — the ABDM published JWKS endpoint used to verify inbound consent/gateway JWS. **Empty by default → signature verification fails closed** until set (`jws.js:103`).
- [ ] **`CONNECT_ABDM_DATA_PUSH_URL`** — OUR on-push callback URL the HIP pushes Fidelius ciphertext to (`hiu.js:206`). Expected `https://stewardmd.in/api/connect/ingress/abdm`.
- [ ] **`UPDATES_ADMIN_TOKEN`** — reuse the existing admin token the `stewardmd-api` Worker cron uses to call the Pages `/api/connect/admin/sweep` erasure route (Stage-6 T8). Missing → the sweep route returns `401` (fail-closed).

---

## Section 2 — Schema migrations

Two paths — **pick ONE**. Apply against the `stewardmd-connect` D1.

### 2a. Fresh provision (new D1) — run the full schema
- [ ] `wrangler d1 execute stewardmd-connect --file db/connect_schema.sql` — creates `connect_tenant`, `connect_membership`, `connect_connector_config`, `connect_audit_event` (+ `idx_connect_audit_tenant_ts`), with the Stage-4/6 audit columns `consent_id` / `transaction_id` / `care_context_hash`.
- [ ] `wrangler d1 execute stewardmd-connect --file db/connect_abdm_schema.sql` — creates `connect_abdm_consent_req` (with `care_contexts` / `purpose` / `date_range` + the Stage-6 additive **`data_erase_at`** column + partial `UNIQUE(consent_id)` index `idx_consent_req_cid`), `connect_abdm_txn` (+ partial `UNIQUE(transaction_id)` index `idx_abdm_txn_txid`), `connect_abdm_carecontext`.

### 2b. Pre-existing Connect D1 (built before Stage-4/6) — ALTER
If your D1 already has `connect_abdm_consent_req` from before Stage-4/6, add the missing columns + indexes:
- [ ] Signed-scope columns (Stage-4, R4 reload authority):
  ```sql
  ALTER TABLE connect_abdm_consent_req ADD COLUMN care_contexts TEXT;
  ALTER TABLE connect_abdm_consent_req ADD COLUMN purpose TEXT;
  ALTER TABLE connect_abdm_consent_req ADD COLUMN date_range TEXT;
  ```
- [ ] Stage-6 erasure-deadline column (distinct from consent-validity `expires_at`, so "consent expired" ≠ "data must be erased"):
  ```sql
  ALTER TABLE connect_abdm_consent_req ADD COLUMN data_erase_at TEXT;
  ```
- [ ] Consent-id + txn-id uniqueness backstops (structurally prevent the two-row split / double-ack):
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_req_cid
    ON connect_abdm_consent_req(consent_id) WHERE consent_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_abdm_txn_txid
    ON connect_abdm_txn(transaction_id) WHERE transaction_id IS NOT NULL;
  ```
- [ ] Stage-4/6 audit columns (if `connect_audit_event` predates them):
  ```sql
  ALTER TABLE connect_audit_event ADD COLUMN consent_id TEXT;
  ALTER TABLE connect_audit_event ADD COLUMN transaction_id TEXT;
  ALTER TABLE connect_audit_event ADD COLUMN care_context_hash TEXT;
  ```

---

## Section 3 — ABDM sandbox V3 registration

- [ ] Register StewardMD on **sandbox.abdm.gov.in** (~3–4 days); obtain **Client ID / Secret**; declare an **HIU ID** (consume) and an **HIP ID** (serve). (Spec §13.1)
- [ ] Whitelist exactly **one** callback base URL: `https://stewardmd.in/api/connect/ingress/abdm` (ABDM health-checks it). (Spec §13.2)
- [ ] Pull the **live Postman collection / Swagger** for ABDM HIECM **V3** and hand over the exact paths + field names + the JWKS URL, so `gateway.js` / `consent.js` / `hiu.js` are pinned to reality (research was WAF-blocked). Confirm sandbox-vs-prod parity — V3 is sandbox-only today; prod may still be V1, so keep the gateway adapter versioned. (Spec §13.3)

---

## Section 4 — `// VERIFY` owner-pins (grep-sourced, one row each)

Every `// VERIFY` in the shipped Stage-1..6 code has a row here (`grep -rn "// VERIFY" functions/_connect`,
**62 markers**). All fail **closed** until confirmed/edited against the live Postman/Swagger of Section 3.
Each cluster's default placeholder value is shown; edit the code constant to the live value.

### 4a. Gateway endpoint paths — `abdm/gateway.js:8–12` `ENDPOINTS` (5)
| line | key | current placeholder | confirm |
|---|---|---|---|
| :8  | `sessions`     | `/api/hiecm/gateway/v3/sessions` | live Postman/Swagger path |
| :9  | `consentInit`  | `/consent-requests/init`         | path |
| :10 | `consentFetch` | `/consents/fetch`                | path |
| :11 | `hiRequest`    | `/health-information/cm/request` | path |
| :12 | `hiNotify`     | `/health-information/notify`     | path |

### 4b. Gateway session request/response field names — `gateway.js:17–22` (6)
| line | field | placeholder | confirm |
|---|---|---|---|
| :17 | `reqClientId`     | `clientId`            | session request body key |
| :18 | `reqClientSecret` | `clientSecret`        | key |
| :19 | `reqGrantType`    | `grantType`           | key |
| :20 | `grantTypeValue`  | `client_credentials`  | value |
| :21 | `resAccessToken`  | `accessToken`         | response key (may be `access_token`) |
| :22 | `resExpiresIn`    | `expiresIn`           | response key (may be `expires_in`) |

### 4c. Gateway HTTP header names — `gateway.js:29–36` (7)
| line | header | value/note | confirm |
|---|---|---|---|
| :29 | `authorization` | `Bearer <token>` | header name |
| :30 | `X-CM-ID`       | `sbx` default    | header name |
| :31 | `REQUEST-ID`    | fresh per call — gateway rejects reuse | header name |
| :32 | `TIMESTAMP`     | ISO             | header name |
| :33 | `content-type`  | `application/json` | header name |
| :35 | `X-HIU-ID`      | when consuming  | header name |
| :36 | `X-HIP-ID`      | when serving    | header name |

### 4d. JWKS + inbound signature — `abdm/jws.js` + `abdm/ingress.js` (3 + 5)
| line | pin | current | confirm |
|---|---|---|---|
| jws.js:18   | signing alg | `RS256` (RSASSA-PKCS1-v1_5, SHA-256) | ABDM signs its gateway/artifact JWS with RS256? |
| jws.js:103  | JWKS URL source | `env.ABDM_JWKS_URL`, empty→fail-closed | the live JWKS URL |
| jws.js:107  | `ABDM_JWKS_HOSTS` allow-list | `healthidsbx./dev./sbx./abdm.gov.in` | the live sandbox/prod JWKS host(s) — a configured URL off-list is refused (defence-in-depth) |
| ingress.js:24 | inbound sig scheme | (see jws) | which signature ABDM actually signs the webhook with |
| ingress.js:26 | `FRESHNESS_MS` | `5 * 60 * 1000` (5 min) | ABDM's real TIMESTAMP skew budget |
| ingress.js:30 | data-push entry wire-shape | ADR-2H seam | the ABDM HIP transfer payload entry shape |
| ingress.js:44 | webhook body form | compact JWS AS the POST body | whether the body is a compact JWS carried as the POST body |
| ingress.js:78 | notify id echo | assumes re-echo of our `requestId` | the notify's real ids |

### 4e. Webhook / notify id-echo mapping — `engine.js` + `consent.js` (3)
| line | pin | confirm |
|---|---|---|
| engine.js:108  | id-echoing on notify/status callback | ABDM echoes a `consentId` (else the link is skipped) |
| consent.js:104 | notify field mapping | notify echoes BOTH our correlation `requestId` AND the consent-artefact id |
| consent.js:131 | notify→fetch ordering | the notify→fetch ordering assumption |

### 4f. HIU consent-request field names — `abdm/hiu.js:23–32` `CONSENT_FIELDS` (10)
| line | field | placeholder | note |
|---|---|---|---|
| :23 | `requestId`   | `requestId`   | |
| :24 | `timestamp`   | `timestamp`   | |
| :25 | `consent`     | `consent`     | |
| :26 | `purpose`     | `purpose`     | |
| :27 | `patient`     | `patient`     | |
| :28 | `patientId`   | `id`          | RAW ABHA lands here — **POST body ONLY, never persisted** |
| :29 | `hiTypes`     | `hiTypes`     | |
| :30 | `permission`  | `permission`  | |
| :31 | `dateRange`   | `dateRange`   | |
| :32 | `dataEraseAt` | `dataEraseAt` | |

### 4g. HIU consent erase/expiry + resolution semantics — `hiu.js` (2)
| line | pin | confirm |
|---|---|---|
| :86  | `expiresAt = req.dataEraseAt ?? null` | consent-artifact erase/expiry bound — pin to the real `dataEraseAt` semantics (see also Section 9 decision #2) |
| :178 | data-request resolves by `consent_id` (not `request_id`) | the join the GRANT notify linked |

### 4h. HIU health-information-request + keyMaterial wire-shape — `hiu.js:120–131` `HIREQUEST_FIELDS` (12)
| line | field | placeholder | note |
|---|---|---|---|
| :120 | `requestId`   | `requestId`   | our correlation id (distinct from the per-HTTP `REQUEST-ID` header) |
| :121 | `timestamp`   | `timestamp`   | |
| :122 | `hiRequest`   | `hiRequest`   | wraps consent + dateRange + dataPushUrl + keyMaterial |
| :123 | `consent`     | `consent`     | |
| :124 | `consentId`   | `id`          | `{ id: <consentId> }` |
| :125 | `dateRange`   | `dateRange`   | the requested pull window |
| :126 | `dataPushUrl` | `dataPushUrl` | OUR callback URL; the HIP pushes Fidelius ciphertext here |
| :127 | `keyMaterial` | `keyMaterial` | |
| :128 | `cryptoAlg`   | `cryptoAlg`   | |
| :129 | `curve`       | `curve`       | |
| :130 | `dhPublicKey` | `dhPublicKey` | b64(our ephemeral X25519 public key) |
| :131 | `nonce`       | `nonce`       | b64(our 32-byte nonce) |

### 4i. HIU dataPushUrl config source — `hiu.js:206` (1)
- [ ] `hiu.js:206` reads `env.CONNECT_ABDM_DATA_PUSH_URL` as our on-push callback URL (also Section 1d). Confirm the value.

### 4j. HIP serve pins — `abdm/hip.js` + `abdm/hip-flags.js` (5 + 1)
| line | pin | confirm |
|---|---|---|
| hip-flags.js:8 | `smd_connect_hip` env-var name | defaulted to **`CONNECT_HIP_FLAG`** (matches `hip.js`) — confirm the final name |
| hip.js:34  | `smd_connect_hip` env-var name | same default `CONNECT_HIP_FLAG` |
| hip.js:172 | `dataPushUrl` host allow-list (SSRF) | the ABDM-registered HIU push-host allow-list, OR whether the transfer routes via the trusted CM gateway (Stage-5 gap) |
| hip.js:193 | gateway-routed transfer auth headers | when routed via the CM gateway, add the auth + `X-HIP-ID`/`X-HIU-ID` header fields (ADR-2H) |
| hip.js:206 | **transfer wire-shape** | one `keyMaterial` per multi-entry page (HIP pages one-entry-per-transfer, never batches) vs per-entry keyMaterial — **Stage-5 gap #1**; NEVER plaintext |
| hip.js:358 | discovery contract + SLA | discovery is a SYNCHRONOUS request/response (care-contexts/discover SLA); constant-shape no-match (existence-oracle blunting) — **Stage-5 gap** |

### 4k. State + serializer pins (3)
| line | pin | confirm |
|---|---|---|
| state.js:271       | sweep GC query shape | The Stage-6 T1 type-contract fix has **landed** — `sweep` now parses both sides as ISO via `Date.parse` (`isExpired`, `state.js:268`), so the old `Number(...)` NaN no-op is gone. This remaining pin: a real D1 GC should enumerate expired victims with an **indexed `WHERE expires_at < ?`**; the mock D1 only supports `col=?`/`col<>?`, so the code enumerates all rows no-WHERE and filters in JS. Confirm the real-D1 range query + index before production scale. |
| state.js:280       | sweep age backstop | `created_at + SWEEP_MAX_TXN_AGE` hard backstop so a garbled/NULL `expires_at` can never linger PHI indefinitely (wired in T2's erasure pass). Confirm the backstop max-age value. |
| serialize.js:166   | HIP FHIR/NDHM bundle conformance | run the emitted synthetic bundle through the **live NRCES/FHIR validator** (R11) — structural gate; confirm `Composition.author`/`custodian`/provenance so a StewardMD decision-support summary is not ingested as the hospital's legal record (also Section 6) |

> **Self-check (authoring invariant):** `grep -rn "// VERIFY" functions/_connect` — every line above is represented; no pin is absent from this section. Count = 64 as of authoring (Stage-6 tasks still landing; re-run to reconcile).

---

## Section 5 — Wiring gaps that block a functional go-live

These are **not** protocol pins — they are internal wiring that is fail-closed today (throws / no-ops) but must be
completed before the corresponding surface actually works with real data.

### 5a. FollowCare episode-reader injection (blocks `smd_connect_hip` serving real data) — **REQUIRED before `smd_connect_hip` ON**
Flagged by the Stage-5 whole-branch review (`.superpowers/sdd/2026-07-31-connect-phase1-stage5-hip/task-9-report.md:26`).

- The HIP serve source (`functions/_connect/abdm/hip-sources/followcare.js`) is a **pure read projection** that
  reads FollowCare discharge episodes through an **injected** reader `deps.followcare`, so there is no direct
  coupling to `_followcare.js` and the projection is unit-testable (ADR-2G). The reader contract is:
  `listEpisodes(env, { tenantId, patientAbhaHash }) → episode[]` and `getEpisode(env, { tenantId, careContextRef }) → episode|null`
  — **the reader HMACs the ABHA; the source never sees a raw ABHA**.
- **The gap:** the ingress route `functions/api/connect/[[path]].js:28–33` builds `deps` with
  `source: followcareSource` but **does NOT inject `deps.followcare`**. As a result:
  - `followcareSource.loadRecord(...)` throws `"FollowCare reader not injected"` (`followcare.js:146`), and
  - `followcareSource.listCareContexts(...)` degrades to `[]` (`followcare.js:130`).
  So HIP discovery returns no care contexts and any transfer throws — **fail-closed, safe, but non-functional.**
- [ ] **Wire a real FollowCare episode reader into the ingress `deps` (`[[path]].js`) before enabling `smd_connect_hip`.** The reader must be Firestore-backed in prod, HMAC the ABHA to `patient_abha_hash` (never expose raw), and honor `tenantId` scoping. Prove it with the Stage-5 mock-HIU round-trip against the real `followcareSource` (not the test `wrapSource` shim).
- [ ] Until wired, keep `smd_connect_hip` **OFF** (or accept a serve path that returns empty/refuses — no data leaves, but no records serve either).

### 5b. Sweep `expires_at`/`now` type contract — **RESOLVED in code (Stage-6 T1); confirm before wiring the T8 cron**
- The earlier bug — `Number(expires_at) < Number(now)` → `Number("2026-…")` = `NaN`, `NaN < NaN` = `false`, so the
  expiry branch never fired and an expired non-terminal txn kept its sealed key + R2 buffer past TTL — is **fixed**.
  `state.js#sweep` now parses both sides as ISO via `Date.parse` (`isExpired`, `state.js:268`), and a NULL/unparseable
  `expires_at` is surfaced as an anomaly (not silently kept) with a `created_at + SWEEP_MAX_TXN_AGE` backstop.
- [ ] Before wiring the Stage-6 T8 sweep cron in `stewardmd-api`, confirm the real-D1 GC uses an indexed `WHERE expires_at < ?` range query (`state.js:271` `// VERIFY`) and the `SWEEP_MAX_TXN_AGE` backstop value (`state.js:280` `// VERIFY`). See Section 9 decision #1 and Section 4k.

---

## Section 6 — Legal / clinical / DPDP sign-off gates (BLOCKING before ANY real / non-sandbox PHI)

Hard preconditions. Until every one is satisfied, keep every tenant `mode = sandbox` and the LLM egress gated.

- [ ] **BAA / DPA signed** with every downstream processor that could touch real bundles (Part-1 C6/C7 hard precondition).
- [ ] **No-retention / no-training LLM provider tier** for MaiK egress (Vertex/Gemini). This is the **R7 egress gate**: `assertEgressAllowed` in `functions/_connect/maik-context.js` must require the `tenant.egressBaaOk` flag (BAA/DPA + de-identification) — **NOT** `mode==sandbox` — so flipping `mode:live` never silently opens LLM egress for real PHI.
- [ ] **NRCES / FHIR validator run** on the emitted synthetic HIP bundles (R11; `serialize.js:166` `// VERIFY`) — the structural gate before real serving; confirm `Composition.author` / `custodian` / provenance tagging so a StewardMD decision-support summary is not mistaken for the hospital's legal medical record.
- [ ] **DPDP Fiduciary / Processor documentation** — record that for an HIU pull the **hospital = Data Fiduciary, StewardMD Connect = Data Processor**: processor contract, purpose-limitation via `purpose.code`, no secondary use. Complete the **DPIA** (Section 7). (R15)
- [ ] **Clinician sign-off** on both the consume flow (HIU) and the serve flow (HIP): thresholds, purpose codes, and the standing invariant that served summaries are **decision-support, not the legal record**.
- [ ] **Production ABDM cert path** (separate, gated, NOT in Phase 1): **FIME functional test → Safe-to-Host security cert → NHA production review** before any production credentials. (Spec §13.5)

---

## Section 7 — DPIA items (R2 / R15 / R16 / R17)

Complete these as the DPIA record before real PHI; they are honest statements of the platform's real limits.

- [ ] **R2 — real worst-case residency, not "minutes."** R2/D1 have no per-object minutes-TTL (R2 lifecycle is day-granular; D1 has none). Erasure is a **reconciliation cron sweep** (Stage-6 T8), so an **abandoned transaction's** encrypted buffer + sealed ephemeral key can persist up to the sweep interval (**~ up to a day** on a daily cron). Document the true worst-case residency — not "minutes." Consider a more frequent pass for the REVOKE/reconcile arm (Section 9 decision #5).
- [ ] **R16 — India-residency reality + edge/KV.** True India-only residency is **not fully achievable on Cloudflare today**: KV is globally replicated (so **no PHI/ABHA/key material in KV** — token/nonce/JWKS cache only), R2 "India" jurisdiction is not generally offered, D1 location control is limited, Workers compute is global-edge. Stop implying India-only; pin what is actually available (R2 jurisdiction / D1 hints where they exist, transient edge processing, encrypt-at-rest) and record the cross-border gap.
- [ ] **R17 — HMAC-salt low-entropy-ABHA brute-force + rotation priority.** ABHA is low-entropy (~10^14); if `CONNECT_HMAC_SALT` leaks, `patient_abha_hash` is brute-forceable. Record the **raised rotation priority** and the (deferred) rotation mechanism.
- [ ] **R15 — erasure model + lawful retention.** REVOKE / expired consent / past-`dataEraseAt` erases ALL associated derived state (R2 buffers, sealed ephemeral keys, txn rows); the **PHI-free audit is retained** under a separate accountability basis (**DPDP §8(6)**) and is NOT erased by `dataEraseAt`. Document this split.
- [ ] **R15 — roles + purpose-limitation + no secondary use.** Hospital = Data **Fiduciary**, Connect = Data **Processor**; every use is bound to the consented `purpose.code` (enforced at request time by `revalidateForRequest` and at use time by `assertPurposeBound`); **secondary use (analytics/training) is forbidden**; an untagged bundle fails closed (never treated as all-purpose).

---

## Section 8 — Safe flag-enable sequence + rollback

Turn Connect on in this order — **do not skip a step**; each is inert/fail-safe until the previous is proven.

- [ ] **1. Provision** — complete Sections 1 + 2 (bindings, secrets, schema). Flags still OFF → all routes 404.
- [ ] **2. Mock / sandbox smoke test** — full suite green (`node --test test/connect/*.test.mjs` and `node --test test/connect/abdm/*.test.mjs`) + the local mock-gateway round-trip. No real endpoints. (CI note: the `npm test` glob is non-recursive — confirm the `test/connect/abdm/*.test.mjs` suite is actually invoked, not only the top-level `test/connect/*.test.mjs`.)
- [ ] **3. Enable base flag in sandbox mode** — set `CONNECT_FLAG=1` with every tenant `mode = sandbox` (`live` is refused until a JWS-verified consent artifact exists). Verify `GET /api/connect/health` and a sandbox `POST /api/connect/context`.
- [ ] **4. Live consent artifact** — only after Sections 3 + 6 are satisfied and a real JWS-verified ABDM consent artifact exists may a tenant move to `mode = live`. Confirm the R7 egress gate blocks LLM egress unless `egressBaaOk`.
- [ ] **5. Enable HIP serve** — set `CONNECT_HIP_FLAG=1` (requires BOTH flags) only after: the NRCES validator run (Section 6), the Stage-5 transfer/discovery `// VERIFY` pins (Section 4j), **and the FollowCare reader is injected (Section 5a)**. Wire the Stage-6 `/api/connect/admin/sweep` cron in `stewardmd-api` (needs `UPDATES_ADMIN_TOKEN` + the pinned sweep type contract, Section 5b).
- [ ] **6. Production** — after the FIME + Safe-to-Host + NHA cert path (Section 6) and confirmed V3/V1 prod parity.

**Rollback (any step):**
- [ ] **Instant kill** — set `CONNECT_FLAG` (and `CONNECT_HIP_FLAG`) unset/`0`. Every `/api/connect/*` route immediately 404s; nothing else in the app is affected (additive, zero-regression).
- [ ] **Full revert** — revert the Connect merge commit(s) on `main`; recovery tags `pre-connect-stage3-merge` / `pre-connect-stage4-merge` / `pre-connect-stage5` / `pre-connect-stage6`.
- [ ] **Data** — on rollback, run the Stage-6 REVOKE/`dataEraseAt` erasure sweep to wipe R2 buffers + sealed ephemeral keys + txn rows; the PHI-free audit is retained (DPDP §8(6)).

---

## Section 9 — Open owner decisions (record a decision before real calls)

- [ ] **1. Sweep time-type (T1) — LANDED, confirm direction.** Stage-6 T1 pinned `expires_at`/`now` to **ISO-8601 + `Date.parse`** (the plan default, minimal + module-consistent) rather than migrating both to epoch-ms. Confirm this is the intended direction; it must stay proven-green before the T8 expiry cron is wired (Section 5b).
- [ ] **2. `dataEraseAt` vs consent-validity `expires_at` (T2).** Confirm whether ABDM's `dataEraseAt` equals the artifact expiry or is a separate (usually later) erasure bound. Stage-6 adds a distinct `data_erase_at` column so the two are not conflated (`hiu.js:86` `// VERIFY`).
- [ ] **3. Care-context erasure scope on REVOKE (T2).** A `connect_abdm_carecontext` registration may back MULTIPLE consents; confirm that a single-consent REVOKE must NOT drop a care-context that backs other live consents. Stage-6 erases care-context rows ONLY on a patient-level `dataEraseAt` / full-erase trigger, never on a single REVOKE.
- [ ] **4. Canonical `purpose.code` vocabulary (T5).** Pin the live ABDM purpose-code list (`CAREMGT`, `BTG`, …) that `assertPurposeBound` / `revalidateForRequest` bind against (`maik-context.js` `// VERIFY`).
- [ ] **5. Sweep cadence + REVOKE promptness SLA (T8).** Daily (co-run the `"30 5 * * *"` slot) matches R2's ~1-day worst-case residency, but a REVOKE/`dataEraseAt` erasure should arguably be prompter — decide daily vs a more frequent `*/15` pass for the REVOKE/reconcile arm vs cost (`worker/wrangler.jsonc` `// VERIFY`).
- [ ] **6. SCCM `Immunization` decision (carried from Stage 4).** Still open: extend SCCM with an `Immunization` resource (wider — touches `canonical/model.js` + `validate.js` + engine scope + `maik-context.js`) vs keep the Stage-4 **warn-don't-drop**. Not resolved in Stage 6 (no SCCM key added — keeps the additive surface tight). Decide in/after Phase 1.
