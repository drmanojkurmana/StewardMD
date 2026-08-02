# StewardMD Connect — Owner Go-Live Checklist

**Scope:** This covers **Phase 0 (walking skeleton / FHIR-R4 pull)** + **Phase 1 (ABDM HIU consume + HIP serve)**, which are BUILT and merged to `main`, behind the feature flag `smd_connect` (env `CONNECT_FLAG`, default OFF) and, for HIP, `smd_connect_hip` (env `CONNECT_HIP_FLAG`, default OFF). Today the code is **inert and mock-only**: no D1/R2 binding, no secrets, flag off — nothing runs until the owner works through the steps below.

This document is the concrete path from **"merged, flag-off, mock-only" → "live in production."** Every item is either a command/value you can run as-is, or is tagged `// VERIFY` / `OWNER` where it needs your real value (e.g. the live ABDM Postman/Swagger, a signed BAA, a provisioned binding).

> **Tracks A–D are NOT in scope here.** The other Connect connector tracks currently in design — **Track A** (FHIR/SMART-on-FHIR live), **Track B** (HL7v2 / file / SFTP), **Track C** (embeddable SDK), **Track D** (Enterprise + MaiK deep integration) — will each **append their own go-live section** to this file as they ship. Do not treat this checklist as complete for those.

**Recovery / rollback anchors:** merge/recovery tags `pre-connect-stage3-merge`, `pre-connect-stage4-merge`, `pre-connect-stage5`, `pre-connect-stage6`; base flag kill = set `CONNECT_FLAG` unset/`0`. See **Section F**.

**Unresolved `// VERIFY` owner-pins in the merged code: 56** (grep `// VERIFY functions/_connect`). These are enumerated in **Section C**.

---

## A. Cloudflare provisioning

All Connect data-plane bindings are **Pages bindings** (Cloudflare Pages project → Settings → Functions → bindings/secrets), **not** `wrangler.toml`. This is deliberate and fail-safe: with the flag off (or a binding missing) every `/api/connect/*` route 404/400s, so a partial provision cannot leak. The **cron sweep** (Section F / Stage-6) runs in the separate `stewardmd-api` **Worker** (`wrangler`), which delegates to a Pages Function via `X-Admin-Token`.

### D1 (canonical + ABDM state)
- [ ] Create the dedicated D1 database: `wrangler d1 create stewardmd-connect` `OWNER` (record the returned `database_id`).
- [ ] Add it as a **Pages binding** named **`CONNECT_DB`** → the `stewardmd-connect` DB. (Code reads `env.CONNECT_DB`.)
- [ ] Apply the base schema (Section B): `wrangler d1 execute stewardmd-connect --file db/connect_schema.sql`.
- [ ] Apply the ABDM schema (Section B): `wrangler d1 execute stewardmd-connect --file db/connect_abdm_schema.sql`.
- [ ] Confirm the D1 **region is India** where available (Part-2 spec §13.4). `OWNER`

### R2 (transient encrypted push-buffer)
- [ ] Create an R2 bucket for the ABDM push-buffer: `wrangler r2 bucket create stewardmd-connect` (or your chosen name). `OWNER`
- [ ] Add it as a **Pages binding** named **`CONNECT_R2`**. (Code reads `env.CONNECT_R2`; holds only Fidelius-ciphertext, erased on ack/sweep.)
- [ ] Confirm the R2 **jurisdiction/region is India** where offered; document the residency gap otherwise (R16 DPIA item). `OWNER`

### KV (non-PHI only: outbound token + JWKS cache)
- [ ] Confirm the existing **`MAIK_KV`** namespace is bound to the Pages project. Connect **reuses** it (JWKS public-key cache `connect:abdm:jwks`, gateway token cache) — no new KV namespace. **Invariant: no PHI/ABHA/key material in KV** (R16).

### Workers/Pages secrets + env vars
- [ ] **`CONNECT_MASTER_KEY`** — 32-byte AES-256 key, base64-encoded (secrets.js requires exactly 32 raw bytes). Generate: `openssl rand -base64 32`. `OWNER`
- [ ] **`CONNECT_HMAC_SALT`** — per-deployment salt for the `patientRefHash`/`patient_abha_hash` HMAC (audit.js, state.js). Generate a high-entropy value: `openssl rand -base64 32`. Raise rotation priority (low-entropy-ABHA brute-force is a DPIA item). `OWNER`
- [ ] **`CONNECT_FLAG`** — base kill-switch. Leave **unset / `0`** until go-live (Section F). Set to `"1"` to enable.
- [ ] **`CONNECT_HIP_FLAG`** — HIP-serve flag (`smd_connect_hip`). Leave **unset / `0`**. HIP requires **BOTH** `CONNECT_FLAG` and `CONNECT_HIP_FLAG`. `// VERIFY` the final env-var name against the Stage-5 plan when HIP serve lands.
- [ ] **`ABDM_CLIENT_ID`** — ABDM sandbox client id (Section C registration). `OWNER`
- [ ] **`ABDM_CLIENT_SECRET`** — ABDM sandbox client secret. `OWNER`
- [ ] **`ABDM_JWKS_URL`** — the ABDM published JWKS endpoint used to verify inbound consent/gateway JWS. Empty by default → signature verification **fails closed** until set. `// VERIFY` (research WAF-blocked; jws.js:103–105).
- [ ] **`CONNECT_ABDM_DATA_PUSH_URL`** — OUR on-push callback URL the HIP posts Fidelius ciphertext to (hiu.js:206). Expected `https://stewardmd.in/api/connect/ingress/abdm`. `// VERIFY`
- [ ] **JWKS host allow-list** — confirm/edit the code constant `ABDM_JWKS_HOSTS` in `functions/_connect/abdm/jws.js` (currently `healthidsbx.abdm.gov.in`, `dev.abdm.gov.in`, `sbx.abdm.gov.in`, `abdm.gov.in`). A configured `ABDM_JWKS_URL` whose host is not on this list is refused (defence-in-depth). `// VERIFY` the live sandbox/prod host.
- [ ] **`dataPushUrl` host allow-list** — confirm the ABDM-registered HIU push-host allow-list used by the HIP serve path (Stage-5 plan gap #5), or confirm the transfer instead routes via the trusted CM gateway. `// VERIFY` `OWNER`
- [ ] **`UPDATES_ADMIN_TOKEN`** — reuse the existing admin token that the `stewardmd-api` Worker cron uses to call the Pages `/admin/sweep` erasure route (Stage-6 T8). `OWNER`

---

## B. Schema migrations

There are two paths. **Pick ONE.**

### B1. Fresh provision (new `stewardmd-connect` D1) — run the full schema
- [ ] `wrangler d1 execute stewardmd-connect --file db/connect_schema.sql` — creates `connect_tenant`, `connect_membership`, `connect_connector_config`, `connect_audit_event` (+ `idx_connect_audit_tenant_ts`).
- [ ] `wrangler d1 execute stewardmd-connect --file db/connect_abdm_schema.sql` — creates `connect_abdm_consent_req` (with `care_contexts`/`purpose`/`date_range` columns + partial `UNIQUE(consent_id)` index `idx_consent_req_cid`), `connect_abdm_txn` (+ partial `UNIQUE(transaction_id)` index `idx_abdm_txn_txid`), `connect_abdm_carecontext`.

### B2. Pre-existing Connect D1 (built before Stage-4) — ALTER + add the unique index
If your D1 already has `connect_abdm_consent_req` from before Stage-4, it lacks the three signed-scope columns and the consent-id uniqueness backstop. Run exactly:
- [ ] Add the three signed-scope columns (R4 reload authority):
  ```sql
  ALTER TABLE connect_abdm_consent_req ADD COLUMN care_contexts TEXT;
  ALTER TABLE connect_abdm_consent_req ADD COLUMN purpose TEXT;
  ALTER TABLE connect_abdm_consent_req ADD COLUMN date_range TEXT;
  ```
- [ ] Add the partial unique index that makes the two-row consent split structurally impossible:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_req_cid
    ON connect_abdm_consent_req(consent_id) WHERE consent_id IS NOT NULL;
  ```
- [ ] Verify `connect_abdm_txn` also carries `idx_abdm_txn_txid` (the exactly-once ack backstop); create it if missing:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_abdm_txn_txid
    ON connect_abdm_txn(transaction_id) WHERE transaction_id IS NOT NULL;
  ```

---

## C. ABDM Sandbox V3 registration + pin every `// VERIFY`

### C1. Register on ABDM sandbox (Part-2 spec §13)
- [ ] Register StewardMD on **sandbox.abdm.gov.in** (~3–4 days); obtain **Client ID / Secret**; declare an **HIU ID** (consume) and an **HIP ID** (serve). `OWNER`
- [ ] Whitelist exactly **one** callback base URL: `https://stewardmd.in/api/connect/ingress/abdm` (ABDM health-checks it). `OWNER`
- [ ] Pull the **live Postman collection / Swagger** for ABDM HIECM **V3** and confirm sandbox-vs-prod parity (V3 is sandbox-only today; prod may still be V1 — keep the gateway adapter versioned). `OWNER`

### C2. Pin the 56 `// VERIFY` owner-values against the live Postman/Swagger
Each row below is a cluster of `// VERIFY` markers in the merged code that must be confirmed/edited before real calls. All fail **closed** until pinned. (`grep -rn "// VERIFY" functions/_connect`.)

- [ ] **Gateway endpoint paths (5)** — `functions/_connect/abdm/gateway.js:8–12` `ENDPOINTS`: `sessions`, `consentInit`, `consentFetch`, `hiRequest`, `hiNotify`. `// VERIFY`
- [ ] **Gateway session request/response field names (6)** — `gateway.js:17–22`: `clientId`/`clientSecret`/`grantType`/`client_credentials` (request) and `accessToken`/`expiresIn` (response; may be `access_token`/`expires_in`). `// VERIFY`
- [ ] **Gateway HTTP header names (7)** — `gateway.js:29–36`: `authorization` (Bearer), `X-CM-ID`, `REQUEST-ID` (fresh per call), `TIMESTAMP`, `content-type`, `X-HIU-ID`, `X-HIP-ID`. `// VERIFY`
- [ ] **JWKS URL + JWKS host(s) + signing alg (3)** — `jws.js:18` (ABDM signs gateway/artifact JWS with RS256?), `jws.js:103–105` (JWKS URL), `jws.js:107–108` (host allow-list). `// VERIFY`
- [ ] **Inbound webhook signature scheme (4)** — `ingress.js:18` (which sig ABDM signs with), `:20` (real TIMESTAMP freshness skew; default 5 min / `FRESHNESS_MS`), `:24` (data-push entry wire-shape), `:38` (is the webhook body a compact JWS carried AS the POST body?). `// VERIFY`
- [ ] **Webhook / notify id-echo mapping (4)** — `ingress.js:72` (the notify's real ids), `engine.js:100` (id-echoing on notify/status callback), `consent.js:104` (notify echoes our correlation requestId AND the consent-artefact id), `consent.js:131` (notify→fetch ordering). `// VERIFY`
- [ ] **HIU consent-request field names (10)** — `hiu.js:23–32` `CONSENT_FIELDS`: `requestId`, `timestamp`, `consent`, `purpose`, `patient`, `patientId`(`id`, raw ABHA, POST-body-only never persisted), `hiTypes`, `permission`, `dateRange`, `dataEraseAt`. `// VERIFY`
- [ ] **HIU consent erase/expiry semantics (2)** — `hiu.js:86` (`expiresAt` = consent-artifact erase/expiry bound; pin to real `dataEraseAt` semantics), `hiu.js:178` (data-request resolves by `consent_id`, not `request_id`). `// VERIFY`
- [ ] **HIU health-information-request + keyMaterial wire-shape (12)** — `hiu.js:120–131` `HIREQUEST_FIELDS`: `requestId`, `timestamp`, `hiRequest`, `consent`, `consentId`(`id`), `dateRange`, `dataPushUrl`, `keyMaterial`, `cryptoAlg`, `curve`, `dhPublicKey` (b64 ephemeral X25519 pubkey), `nonce` (b64 32-byte nonce). `// VERIFY`
- [ ] **HIU dataPushUrl config source (1)** — `hiu.js:206` reads `env.CONNECT_ABDM_DATA_PUSH_URL` as our callback URL (also Section A). `// VERIFY`
- [ ] **HIP FHIR/NDHM bundle conformance (1)** — `connectors/abdm/serialize.js:166`: run the emitted bundle through the live NRCES/FHIR validator (R11; structural gate, also Section D). `// VERIFY`
- [ ] **Reconciliation sweep type contract (1)** — `state.js:258`: `sweep` compares `Number(expires_at) < Number(now)` (assumes epoch-ms); if the Stage-6 cron passes ISO → `NaN` → expiry-GC silently no-ops. Pin `expires_at`/`now` as epoch-ms (or make sweep ISO-aware) **before** wiring expiry-driven GC. `// VERIFY`
- [ ] **Stage-5 HIP transfer wire-shape** — confirm whether ABDM `/health-information/transfer` carries one `keyMaterial` per multi-entry page (HIP must page one-entry-per-transfer, never batch) or per-entry keyMaterial; and whether it POSTs to the HIU `dataPushUrl` directly or via the CM gateway (Stage-5 plan gap #1). `// VERIFY` `OWNER`
- [ ] **Stage-5 discovery response contract + synchronous SLA** — the exact discovery response shape, the constant-shape no-match (existence-oracle blunting), and the SLA budget (Stage-5 plan gap #3). `// VERIFY` `OWNER`

---

## D. Legal / compliance gates (BLOCKING before ANY real / non-sandbox PHI)

These are hard preconditions. Until every one is satisfied, keep `tenant.mode = sandbox` and the LLM egress gated.
- [ ] **BAA / DPA signed** with every downstream processor that could touch real bundles (hard precondition per Part-1 C6/C7). `OWNER`
- [ ] **No-retention / no-training LLM provider tier** for MaiK egress (Vertex/Gemini). This is the **R7 egress gate**: `assertEgressAllowed` / `functions/_connect/maik-context.js` must require the `tenant.egressBaaOk` (BAA/DPA + de-identification) flag — NOT `mode==sandbox` — so flipping `mode:live` never silently opens LLM egress for real PHI. `OWNER`
- [ ] **NRCES / FHIR validator run** on the emitted synthetic HIP bundles (R11; `serialize.js:166` `// VERIFY`) — the structural gate before real serving; confirm `Composition.author`/`custodian`/provenance tag so a StewardMD decision-support summary is not ingested as a hospital's legal medical record. `OWNER`
- [ ] **DPDP Fiduciary / Processor documentation** — record that for an HIU pull the **hospital = Data Fiduciary, Connect = Data Processor** (processor contract, purpose-limitation via `purpose.code`, no secondary use); complete the **DPIA** items (real worst-case residency ~up to a day for an abandoned txn; global-KV/edge residency gap; HMAC-salt rotation; REVOKE/`dataEraseAt` erasure model with PHI-free audit retained under §8(6)). `OWNER`
- [ ] **Clinician sign-off** on the consent flow (HIU consume) and the serve flow (HIP): thresholds, purpose codes, and that served summaries are decision-support, not the legal record. `OWNER`
- [ ] **Production ABDM cert path** (separate, gated exit process; NOT in Phase 1): **FIME functional test + Safe-to-Host security cert + NHA production review** before prod credentials. `OWNER`

---

## E. CI

- [ ] **Fix the non-recursive `npm test` glob so the ABDM suite runs.** Current `package.json` `test` script:
  ```
  for f in test/*.test.mjs test/connect/*.test.mjs rx-build.test.mjs; do echo "→ $f"; node "$f" || exit 1; done
  ```
  `test/connect/*.test.mjs` is **non-recursive** → the ~188-test `test/connect/abdm/*.test.mjs` suite is **never run under `npm test`** (pre-existing gap since Stage-1; the abdm tests only pass because they're run directly). Add `test/connect/abdm/*.test.mjs` to the glob list (or make it recursive).
- [ ] Confirm the pre-existing `test/fundx-flags.test.mjs` failure + the fail-fast (`|| exit 1`) is resolved or the ordering fixed, so the Connect globs are actually reached under `npm test` (not a Connect regression — another session's file, per memory).

---

## F. Flag-enable sequence (safe order + rollback)

Turn Connect on in this order — **do not skip a step**; each is inert/fail-safe until the previous is proven.
- [ ] **1. Provision** — complete Sections A + B (bindings, secrets, schema). Flag still OFF → all routes 404.
- [ ] **2. Mock / sandbox smoke test** — run the full suite green (`node --test test/connect/*.test.mjs` and `node --test test/connect/abdm/*.test.mjs`; Section E) and the local mock-gateway integration. No real endpoints.
- [ ] **3. Enable base flag in sandbox mode** — set `CONNECT_FLAG=1` with every tenant at `mode = sandbox` (the enforced sandbox-only gate: `live` is refused until a consent artifact exists, and the synthetic-base-URL allow-list holds). Verify `/api/connect/health` and a sandbox `POST /api/connect/context`.
- [ ] **4. Live consent artifact** — only after Sections C + D are satisfied and a real JWS-verified ABDM consent artifact exists may a tenant move to `mode = live`. Confirm the R7 egress gate blocks LLM egress unless `egressBaaOk`.
- [ ] **5. Enable HIP serve** — set `CONNECT_HIP_FLAG=1` (requires BOTH flags) only after the NRCES validator run (Section D) and the Stage-5 transfer/discovery `// VERIFY` pins (Section C). Wire the Stage-6 `/admin/sweep` cron in `stewardmd-api` (needs `UPDATES_ADMIN_TOKEN` + the pinned `expires_at` epoch-ms contract).
- [ ] **6. Production** — after the FIME + Safe-to-Host + NHA cert path (Section D) and confirmed V3/V1 prod parity.

**Rollback (any step):**
- [ ] **Instant kill** — set `CONNECT_FLAG` (and `CONNECT_HIP_FLAG`) unset/`0`. Every `/api/connect/*` route immediately 404s; nothing else in the app is affected (additive, zero-regression).
- [ ] **Full revert** — revert the Connect merge commit(s) on `main`; recovery tags `pre-connect-stage3-merge` / `pre-connect-stage4-merge` / `pre-connect-stage5` / `pre-connect-stage6`.
- [ ] **Data** — on rollback, run the Stage-6 REVOKE/`dataEraseAt` erasure sweep to wipe any R2 buffers + sealed ephemeral keys + txn rows; the PHI-free audit is retained (DPDP §8(6)).

---

## G. Track A/B — Self-service EMR onboarding (direct-EMR, non-ABDM)

The generic, multi-tenant, self-service onboarding track (FHIR/SMART pull + CSV + HL7 feed + FHIR-push webhook)
has its **own dedicated owner go-live + hospital-admin guide**: **`docs/connect/onboard/owner-onboarding.md`**.
Work that document to take direct-EMR onboarding live. Summary of what it requires (all default OFF, inert):

- **Bindings/secret:** `CONNECT_DB` (D1) + schema `db/connect_schema.sql` + `db/connect_hl7_schema.sql`;
  reuse `MAIK_KV`; secret `CONNECT_MASTER_KEY` (32-byte, seals EMR creds). No R2 needed for this track.
- **Flags:** `CONNECT_FLAG` + `CONNECT_ONBOARD_FLAG` (wizard/pull/CSV); `CONNECT_HL7_FLAG` (HL7 ingest);
  `CONNECT_FHIR_PUSH_FLAG` (webhook ingest).
- **Legal:** BAA/DPA + the R7 `egressBaaOk` gate before any real PHI reaches MaiK; ratify the onboard-pull
  PHI-to-admin policy; DNS-rebinding resolve-then-pin before opening the wizard to untrusted admins.

**CI (Section E) — RESOLVED:** the `npm test` glob now includes `test/connect/*/*.test.mjs`, so the ABDM +
onboard + smart + file + hl7v2 subdir suites run under `npm test` (previously only the top-level
`test/connect/*.test.mjs` ran).
