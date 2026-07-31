# StewardMD Connect — Phase 1 Stage 4: HIU Consume (end-to-end vs the mock gateway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **TDD is mandatory** (superpowers:test-driven-development): write the failing test first, watch it fail, then the minimum code to pass, then refactor. Two tasks are marked **REVIEW: DUAL-ADVERSARIAL** — spawn two independent adversarial reviewers before that task's code is considered done (see Execution handoff).

**Goal:** Wire the full HIU consume path end-to-end against the adversarial mock gateway: **consent-request → ingress webhook (signature/replay/correlate) → fetch + JWS-verify the consent artifact + request-time re-validation → data request (per-request consent-binding) → receive + per-entry Fidelius decrypt + exactly-once ack → NDHM-FHIR → SCCM normalize → engine tail → gated MaiK context.** `mode:live` is gated behind a specific verified, in-scope, unexpired, still-GRANTED artifact (R3), never a tenant flag. Everything runs offline vs the mock — no real credentials, no real endpoints.

**Architecture:** Stage 4 is the *orchestration* layer that composes the already-built primitives — it adds almost no new crypto/state machinery, it sequences them and adds the two ABDM protocol surfaces that were stubbed (outbound HIU calls + the inbound `/ingress/abdm` webhook). Outbound calls (`consent-request`, `data-request`) are clinician-initiated → **server-derived actor+tenant** via `resolveActor`/`resolveTenant`. The inbound `/ingress/abdm` route carries **no StewardMD actor** (ABDM-authenticated): its identity is the verified ABDM body-signature + the **correlation row** matched by our ids — tenant is derived from that row, never from the request body. PHI is pass-through: decrypt → normalize → SCCM → deterministic MaiK context → discard; the only clinical-at-rest is the transient **encrypted** R2 push-buffer (Fidelius ciphertext), deleted after decrypt+ack. Pure dependency-injected ES modules over D1 (`env.CONNECT_DB`) + R2 (`env.CONNECT_R2`) + KV (`env.MAIK_KV`, non-PHI nonce/token cache only) + the Stage-0 secrets, Stage-1 `fidelius.js`, Stage-2 `gateway.js`, Stage-3 `state.js` + `connector.js`/`ingestEvent`. The mock gateway (Stage-2 harness, extended here) plays gateway **and** HIP: it fires webhooks back into the ingress route and pushes a Fidelius-encrypted synthetic NDHM bundle, deliberately out-of-order / duplicate / partial / retry-after-ack (R10).

**Tech Stack:** Plain ES modules, D1, R2, KV, WebCrypto, `node:test`. No new dependencies. Consumes: Stage-1 `fidelius.js` (`randomBytes`/`importRawPrivate`/`sharedSecret`/`openEntry`/`nonce`), Stage-2 `gateway.js` (`makeGateway`/`ENDPOINTS`/`FIELDS`), Stage-3 `state.js` (all correlation/FSM/buffer/CAS + `tryJoin`) + `connector.js` + `engine.js`#`ingestEvent`, Phase-0 `engine.js`#`loadPatientContext` tail, `maik-context.js`, `audit.js`, `canonical/*`, `identity.js`, `testkit.js`.

## Global Constraints

- **Buildless Cloudflare stack; plain ES modules; `node --test`; NO new deps.**
- **Additive-only.** New files under `functions/_connect/abdm/*`, `functions/_connect/connectors/abdm/*`, `functions/api/connect/*`, `test/connect/abdm/*`. The ONLY edits to existing runtime files are the three spec-mandated ones: (a) the `/ingress/abdm` branch in `functions/api/connect/[[path]].js` (was `501`, R6), (b) `maik-context.js`#`assertEgressAllowed` (R7), (c) `audit.js` `ALLOW` list (R14). Do not touch any other existing runtime file.
- **Flag `smd_connect` default OFF** (`flagOn(env)` gate stays on every route). Zero regression: all Phase-0/Stage-1/2/3 tests stay green.
- **Mock-gateway-first — no real creds.** All endpoint paths + field names stay behind the ADR-2H `ENDPOINTS`/`FIELDS` seam; build/test against the mock only. Mark anything needing the owner's real ABDM endpoint/JWKS values with `// VERIFY`.
- **Server-derived identity — never the request body.** Outbound: `resolveActor`/`resolveTenant`. Inbound ingress: tenant derived from the verified-signature + correlation row, never body-supplied.
- **No PHI in URLs/logs/KV.** Raw ABHA is **POST-body only, `no-store`, never in a URL/path/log/KV/D1** (D1 stores only the per-tenant HMAC). KV holds only the non-PHI outbound token + inbound REQUEST-ID nonce cache (R16). `careContextReference` is HMAC'd before any key/audit/dedupe use (R14).
- **Ephemeral pass-through PHI.** Nothing clinical at rest beyond the transient **encrypted** R2 buffer (Fidelius ciphertext, deleted after decrypt+ack). Decrypted plaintext lives only in a request-scoped variable; never persisted, never logged.
- **Fail-closed everywhere.** Any verify/correlate/decrypt/state error → reject + audit metadata-only outcome; never partial-open, never silent-drop.
- **DUAL-ADVERSARIAL review** required for **Task 5 (artifact JWS-verify + request-time re-validation / consent-binding)** and **Task 7 (receive + per-entry decrypt + exactly-once ack)**.

### Prerequisite (blocks Stage 4 — see Self-review / owner note)

Stage 4 consumes four Stage-3 exports that are **not yet on the branch** (`state.js` currently ends at `claimAck`; there is no `connector.js` and no `engine.js`#`ingestEvent`): **`state.tryJoin`**, **`state.sweep`**, **`abdm/connector.js`** (event profile), and **`engine.js`#`ingestEvent`**. Stage-3 Tasks 5–7 must land first. This plan **references** those exports by their Stage-3-documented signatures and does not re-plan them.

---

## File structure

```
functions/_connect/abdm/jws.js              # pinned JWS/signature verifier (R4): alg allow-list + JWKS-host pin + ignore embedded locators
functions/_connect/abdm/consent.js          # fetch + JWS-verify the consent artifact + request-time re-validation checklist (R3,R4)
functions/_connect/abdm/hiu.js              # HIU orchestration: requestConsent, requestHealthInformation, consumeTransfer
functions/_connect/abdm/ingress.js          # inbound webhook handler: verify-sig + replay/dedupe + correlate-before-buffer + route (R6,R2,R8,R17)
functions/_connect/connectors/abdm/normalize.js   # NDHM-FHIR document Bundle -> SCCM (mirrors connectors/fhir-r4/normalize.js) (R12)
functions/api/connect/[[path]].js           # (edit) /ingress/abdm branch: 501 -> live handleIngress
functions/_connect/maik-context.js          # (edit) assertEgressAllowed fixed for live PHI (R7)
functions/_connect/audit.js                 # (edit) ALLOW += consentId, transactionId, careContextHash (R14)
test/connect/abdm/mock-gateway.mjs          # (extend) fire webhooks back into ingress + HIP-encrypt a synthetic NDHM push (R10)
test/connect/abdm/jws.test.mjs  consent.test.mjs  hiu-consent.test.mjs  ingress.test.mjs
test/connect/abdm/hiu-request.test.mjs  hiu-decrypt.test.mjs  normalize-ndhm.test.mjs  egress-audit.test.mjs
test/connect/abdm/hiu-flow.test.mjs         # end-to-end vs the adversarial mock (the integration proof)
test/connect/abdm/fixtures/ndhm-*.mjs       # SYNTHETIC NDHM document Bundles (never real ABDM data)
```

---

### Task 1 — consent-request builder + submit (`hiu.js`: `requestConsent`)

**Files:** Create `functions/_connect/abdm/hiu.js`; Test `test/connect/abdm/hiu-consent.test.mjs`.

**Interfaces:**
- `requestConsent(env, deps, req) -> { requestId, status:"INITIATED" }` where `deps = { db, kv, secrets, gateway, identifyFn, audit, now }` and `req = { request, tenantId, abhaAddress, purpose, hiTypes, dateRange, dataEraseAt }`.
- Derives actor via `resolveActor(deps.identifyFn, req.request, env)` + tenant via `resolveTenant(deps.db, actor.id, req.tenantId)` (server-derived; a non-member `tenantId` → `PermissionError`). Builds the consentInit body from the `FIELDS` seam (patient `abhaAddress` goes **only** into the POST body). Calls `gateway.post("consentInit", body)`; on `202` persists `putConsentReq(db, { requestId, tenantId, actor, patientAbhaHash: await hmacPseudonym(env, tenant.id, abhaAddress), hiTypes, expiresAt, now })`. Fresh `REQUEST-ID` is minted inside `gateway`. Audit `consent.requested` (metadata only: `requestId`, `patient_abha_hash`, `hiTypes` count).

**Invariant:** the raw ABHA never leaves the POST body — it is HMAC'd before it touches D1, and never appears in a URL/log/KV/audit. **No ephemeral keypair is minted here** (that is Task 6 / the data-request, per R17 + ADR-2D). `mode:live` is *not* gated at consent-request time (R3 — the live gate bites at the data request). Gateway non-202 → fail-closed throw, **no** consent_req row written.

**Tests:** builds the correct `consentInit` body through the `FIELDS` seam; persists a `connect_abdm_consent_req` row whose `patient_abha_hash` is the HMAC and where the raw ABHA is absent from every persisted/audited field; audit event contains only ALLOW-listed keys + `patient_abha_hash` (no raw ABHA); gateway `202` → `INITIATED`; gateway failure → throws, `getConsentReq` returns null; non-member tenant → `PermissionError`, no gateway call.

---

### Task 2 — pinned JWS / signature verifier (`jws.js`: `verifyJws` + `getPinnedJwks`)

**Files:** Create `functions/_connect/abdm/jws.js`; Test `test/connect/abdm/jws.test.mjs`. Shared by Task 4 (ingress body-signature) and Task 5 (artifact JWS). **Security primitive — feeds a DUAL-ADVERSARIAL task.**

**Interfaces:**
- `verifyJws(token, { jwks, allowedAlgs }) -> { ok:boolean, payload|null, reason? }` — parses the compact JWS, enforces the alg **allow-list** (reject `alg:"none"`; only `["RS256","ES256"]` pinned to ABDM's real alg — `// VERIFY` which one; block HMAC-family to defeat RSA/HMAC confusion), selects the key from the supplied `jwks` **by `kid` only within that JWKS**, and verifies via WebCrypto. **Ignores any token-embedded locator** (`jku`/`x5u`, or a `kid` that looks like a URL). Fail-closed: any parse/alg/key/verify error → `{ ok:false }`, never throws to the caller as "valid".
- `getPinnedJwks(env, deps) -> jwks` — fetches (+ caches in KV, non-PHI) the JWKS from the **configured, allow-listed ABDM JWKS host over TLS only**. The JWKS URL is a config constant marked `// VERIFY: ABDM JWKS URL (owner must confirm; research WAF-blocked)`; if unset/unreachable → verification fails closed (no bypass).

**Invariant (R4):** keys come **only** from the pinned JWKS host; `alg:none` and HMAC confusion are structurally impossible; token-embedded key locators are never dereferenced; unavailable JWKS ⇒ hard fail-closed (never "skip verification").

**Tests:** valid RS256/ES256 over a fixture JWKS → `ok:true`; `alg:"none"` → `ok:false`; an `HS256` token forged with the JWKS public key as the HMAC secret → `ok:false` (confusion blocked); a token carrying a `jku`/`x5u` pointing at an attacker JWKS → the embedded locator is ignored, verified only against the pinned JWKS → `ok:false`; tampered payload → `ok:false`; JWKS unavailable → `ok:false` (fail-closed), never `ok:true`.

---

### Task 3 — NDHM-FHIR → SCCM normalizer (`connectors/abdm/normalize.js`: `normalizeNdhm`)

**Files:** Create `functions/_connect/connectors/abdm/normalize.js` + `test/connect/abdm/fixtures/ndhm-*.mjs` (SYNTHETIC); Test `test/connect/abdm/normalize-ndhm.test.mjs`. Mirrors `connectors/fhir-r4/normalize.js` (same `cc()` text-fallback helper, same SCCM factories, same `kind: standard|local` rule).

**Interfaces:**
- `normalizeNdhm(ctx, docBundle) -> SCCM bundle` — walks the `Bundle.type=document` **Composition-first**, then its referenced resources: `Condition`→`condition`, `MedicationRequest`/`MedicationStatement`→`medicationStatement` (`origin: order|statement`), `Observation`(lab/vital)→`observation`, `AllergyIntolerance`→`allergyIntolerance`, `DiagnosticReport`→`diagnosticReport`, Composition narrative + `HealthDocumentRecord`→`documentReference` (by-reference/narrative text only — **no binary/pixel**). Tags `meta.sourceConnector:"abdm"` + a `source:"abdm"` provenance entry per resource. Every coded field routes through `cc(fhirCC, fallback)` so a `text` fallback is always present (R12).
- **WARN-don't-DROP (R12):** binary `HealthDocumentRecord` → metadata-only `documentReference` **+ a `meta.warnings` entry**; `InvoiceRecord` → skipped **+ warning**; `WellnessRecord` Observations → `observation` with `category: "wellness"|"social-history"` (mapped, not dropped). `ImmunizationRecord` → **metadata-only + `meta.warnings` entry** for now (SCCM has no `Immunization` resource key — see owner note; do NOT silently drop). Any unknown resourceType → warning, never a throw.

**Invariant:** never throws on a partial/unknown document — degrade to a `meta.warnings` note; never emits a coded field without a `text` fallback; never carries binary content into SCCM. Output is valid SCCM (passes `validateBundle`).

**Tests:** each synthetic profile (`DiagnosticReportRecord`/`PrescriptionRecord`/`OPConsultRecord`/`DischargeSummaryRecord`) → valid SCCM with `text` fallbacks; a binary `HealthDocumentRecord` → metadata-only + warning (no binary bytes present); `InvoiceRecord` → skipped + warning; `WellnessRecord` → wellness-category Observation; `ImmunizationRecord` → warning, not dropped, not a crash; a Bundle missing a referenced resource → warning, no throw.

---

### Task 4 — ingress route: verify-sig + replay/dedupe + correlate-before-buffer (`ingress.js` + edit `[[path]].js`)

**Files:** Create `functions/_connect/abdm/ingress.js`; **edit** the `/ingress/` branch of `functions/api/connect/[[path]].js` (501 → live); Test `test/connect/abdm/ingress.test.mjs`.

**Interfaces:**
- `handleIngress(env, deps, request) -> Response` where `deps = { db, r2, kv, secrets, jwks, ingestEvent, now }`. Steps, all fail-closed and **in this order**:
  1. **Body-signature verify** (R6): read the raw body, verify ABDM's signature over it with the Task-2 verifier + the pinned JWKS (same alg/host/locator pinning). The exact inbound scheme (JWS vs detached header) is `// VERIFY` behind the ADR-2H seam. Bad/absent signature → `401`, nothing persisted.
  2. **Replay defense** (R6): reject a stale `TIMESTAMP` (freshness window) + dedupe on `REQUEST-ID` via a KV nonce cache (TTL). A replayed REQUEST-ID → `202` no-op (idempotent), no state change.
  3. **Correlate BEFORE buffer** (R6): resolve `X-HIU-ID`/`X-HIP-ID` + our correlation ids to a known in-scope `consent_req`/`txn` row (`getConsentReq`/`getTxnByTransactionId`). Unknown correlation id, or `header-tenant ≠ correlation-tenant` → `403`, **no R2 write** (blocks storage-DoS + enforces consent-binding). `CF-Connecting-IP` checked against the allow-list (defense-in-depth only). Tenant is taken from the correlation row, never the body.
  4. **Route by event type** → `deps.ingestEvent(env, deps, rawEvent)` (R9): consent-notify → `updateConsentStatus` (monotonic — a replayed older `GRANTED` cannot un-`REVOKE`, R6); on-fetch → hand the artifact to Task 5; on-request → `attachTransactionId` + `advanceStatus`; data-push → `bufferEntry` per entry (only **after** correlation) then `advanceStatus` to `RECEIVING`.
- The route stays behind `flagOn(env)`; responses are `no-store`; errors are sanitized (`CODE(e)`), never echo raw ABHA / signature / body.

**Invariant (R6/R2/R8/R17):** signature-verify → replay-dedupe → correlate → THEN buffer, strictly ordered; a junk/unknown push never touches R2; consent-status transitions are monotonic; the ingress derives tenant only from the correlation row.

**Tests:** valid signed consent-notify → status advances, `200/202`; bad signature → `401`, no state change; replayed REQUEST-ID → idempotent no-op; unknown `X-HIP-ID`/correlation id → `403`, R2 untouched (`listBuffered` empty); `header-tenant ≠ correlation-tenant` → `403`; replayed older `GRANTED` after a `REVOKED` → `updateConsentStatus` refuses (stays `REVOKED`); a correlated data-push → entries buffered, txn `RECEIVING`; flag OFF → `404`.

---

### Task 5 — fetch + JWS-verify the consent artifact + request-time re-validation (`consent.js`) — **REVIEW: DUAL-ADVERSARIAL**

**Files:** Create `functions/_connect/abdm/consent.js`; Test `test/connect/abdm/consent.test.mjs`.

**Interfaces:**
- `fetchConsentArtifact(env, deps, { requestId, consentId }) -> void` — on a `GRANTED` notify, calls `gateway.post("consentFetch", { consentId })` (fire-and-forget `202`); the artifact returns later on the `on-fetch` webhook (Task 4 routes it here).
- `verifyConsentArtifact(env, deps, artifact) -> { ok, consent }` — verifies the artifact's `signature` (JWS) with the Task-2 `verifyJws` + pinned JWKS; parses `careContexts[]`, `hiTypes[]`, `permission{ dateRange, dataEraseAt, frequency }`, `expiry`, `purpose`, `status`. On success persists to `connect_abdm_consent_req` (`consent_id`, `hi_types`, status `GRANTED`); on failure fail-closed (no persist, audit `consent.denied` outcome).
- `revalidateForRequest(consent, req, now) -> { ok, reason? }` — the **normative request-time checklist (R4)**, re-run per data-request: `status==="GRANTED"` (not since-`REVOKED`/`EXPIRED`), `now ∈ permission.dateRange` **and** within artifact validity/`expiry`, `req.careContexts ⊆ consent.careContexts`, `req.hiTypes ⊆ consent.hiTypes`, `req.purpose === consent.purpose`. Any miss → `{ ok:false, reason }`.

**Invariant (R3/R4):** no persisted consent without a verified JWS; `mode:live` is **per-request-artifact-bound** — `revalidateForRequest` binds each data request to a *specific* verified, in-scope, unexpired, still-GRANTED artifact; a tenant flag is necessary-not-sufficient. Fail-closed on unavailable JWKS or any checklist miss.

**Tests:** valid artifact JWS → persisted, `GRANTED`; invalid signature → not persisted, fail-closed; a since-`REVOKED` consent → `revalidateForRequest` `ok:false`; `now` outside `dateRange` → `ok:false`; requested careContext ∉ artifact → `ok:false`; requested hiType ∉ artifact → `ok:false`; purpose mismatch → `ok:false`; expired artifact → `ok:false`. (**Adversarial reviewers must probe: scope-widening between fetch and request, `dateRange` boundary, REVOKE-after-GRANT race, JWKS-unavailable bypass.**)

---

### Task 6 — data request: mint ephemeral key + per-request consent-binding (`hiu.js`: `requestHealthInformation`)

**Files:** Edit `functions/_connect/abdm/hiu.js` (add export); Test `test/connect/abdm/hiu-request.test.mjs`.

**Interfaces:**
- `requestHealthInformation(env, deps, req) -> { requestId, status:"REQUESTED" }` where `req = { request, tenantId, consentId, careContexts, hiTypes, purpose, dateRange }`. Steps:
  1. Server-derive actor+tenant; load the verified consent (`getConsentReq`); run `revalidateForRequest(consent, req, now)` (Task 5) — **fail-closed** if not ok (this is the real `mode:live` gate, R3).
  2. Mint the ephemeral X25519 keypair **for this transaction** (ADR-2D) using existing Fidelius exports only, so `fidelius.js` stays untouched: `const scalar = randomBytes(32); const { privateKey, publicKeyRaw } = await importRawPrivate(scalar); const ourNonce = nonce();` — `scalar` (b64) is the storable private key, `publicKeyRaw` + `ourNonce` are the outbound keyMaterial.
  3. Build the `hiRequest` body with `keyMaterial:{ cryptoAlg:"ECDH", curve:"Curve25519", dhPublicKey:b64(publicKeyRaw), nonce:b64(ourNonce) }` + `consent.id` + `dateRange` + our `dataPushUrl` (all field names via the `FIELDS` seam, `// VERIFY`). `gateway.post("hiRequest", body)`.
  4. On `202`: `putTxn(db, secrets, { requestId, tenantId, consentId, ephPrivKeyB64:b64(scalar), ephPubRaw:b64(publicKeyRaw), ourNonce:b64(ourNonce), status:"CONSENT_GRANTED", expiresAt, now })` (sealed key, txn keyed by the data-request's `requestId`, R17), then `advanceStatus(db, requestId, "CONSENT_GRANTED", "REQUESTED", now)`. The `on-request` webhook later `attachTransactionId` (Task 4). Audit `data.requested` (metadata only).

**Invariant (R3/ADR-2D/R17):** one fresh ephemeral keypair **per data request**, private key stored **sealed only** (never plaintext, never logged); the request is refused unless `revalidateForRequest` passes against the fresh artifact; the txn row is keyed by `requestId` (transactionId attached at `on-request`).

**Tests:** happy path → `hiRequest` body carries a 32-byte b64 `dhPublicKey` + nonce, a sealed txn row exists, status `REQUESTED`; `revalidateForRequest` fail → no gateway call, no txn row (fail-closed); the stored `eph_privkey_sealed` is not the plaintext scalar; two calls mint two distinct keypairs (no key reuse); `on-request` webhook → `attachTransactionId` sets `transaction_id`.

---

### Task 7 — receive + per-entry decrypt + exactly-once ack (`hiu.js`: `consumeTransfer`) — **REVIEW: DUAL-ADVERSARIAL**

**Files:** Edit `functions/_connect/abdm/hiu.js` (add export); Test `test/connect/abdm/hiu-decrypt.test.mjs`.

**Interfaces:**
- `consumeTransfer(env, deps, { transactionId, hipKeyMaterial, sessionStatus }) -> { decrypted:string[], acked:boolean }`. Steps:
  1. `const { ready, entries, txn } = await tryJoin(deps.db, deps.r2, env, transactionId)` (Stage-3 buffer-then-join). `ready:false` (push arrived before `on-request`) → return `{ decrypted:[], acked:false }`, buffer left intact for a later join.
  2. When ready: `const scalarB64 = await unsealTxnKey(deps.secrets, txn); const { privateKey } = await importRawPrivate(unb64(scalarB64)); const secret = await sharedSecret(privateKey, unb64(hipKeyMaterial.dhPublicKey)); const ourNonce = unb64(txn.our_nonce); const hipNonce = unb64(hipKeyMaterial.nonce);`
  3. **Per-entry** decrypt loop (R1): for **each** buffered entry `await openEntry(secret, ourNonce, hipNonce, entry.contentB64, entry.checksum)` — checksum verified inside `openEntry`. **Never batch/concatenate.** A single entry's auth/checksum failure fails **that entry** closed (contributes to `PARTIAL`/`FAILED`) and never poisons its siblings.
  4. On transfer-complete: `const won = await claimAck(deps.db, transactionId, now)` (exactly-once CAS, R8). Only the winner sends the `hiNotify` ack (`gateway.post("hiNotify", { transactionId, sessionStatus })`), `deleteBuffered(r2, transactionId)`, and `advanceStatus` `RECEIVING → { TRANSFERRED | PARTIAL | FAILED }`. A retry-after-ack → `claimAck` false → **no** re-decrypt, **no** duplicate ack, **no** re-buffer.
  5. Return the decrypted NDHM JSON strings for Task 8; the plaintext is request-scoped only — never persisted/logged.

**Invariant (R1/R8/ADR-2E):** decrypt is strictly per-entry with post-decrypt checksum; the ack is exactly-once (CAS is the sole arbiter — no read-then-write); the R2 buffer + sealed key are deleted on the winning ack; a duplicate/retry push after ack is a no-op.

**Tests:** push-before-`on-request` → `ready:false`, buffer retained, no decrypt; join-then-push → each entry decrypts + checksum-verifies; a tampered ciphertext → that entry fails closed (GCM auth), siblings still decrypt, outcome `PARTIAL`; two concurrent `consumeTransfer` on transfer-complete → exactly one `acked:true`, one sends `hiNotify`, buffer deleted once; retry-after-ack → `acked:false`, no second ack, no re-decrypt; a low-order/bad HIP pubkey → `FideliusError`, fail-closed. (**Adversarial reviewers must probe: (key,iv) reuse across entries, checksum-bypass, double-ack race, buffer-not-deleted-on-failure, decrypt-then-crash key residue.**)

---

### Task 8 — engine tail + MaiK egress-predicate fix + audit ALLOW-list (edit `engine.js` seam use, `maik-context.js`, `audit.js`)

**Files:** Edit `functions/_connect/maik-context.js` (R7) + `functions/_connect/audit.js` (R14); use (do not re-plan) `engine.js`#`ingestEvent` + `loadPatientContext` tail; Test `test/connect/abdm/egress-audit.test.mjs`.

**Interfaces:**
- **Engine tail (R9):** feed each decrypted NDHM string → `normalizeNdhm` (Task 3) → the reused `loadPatientContext` **tail** (`assertConsumable` → `validateBundle` → permission FILTER by scope → PHI-free audit), **not** the pull-side fetch. Produce the SCCM `CanonicalBundle`, then `buildMaikContext(bundle)` (deterministic / non-LLM).
- **`assertEgressAllowed(bundle, tenant)` fix (R7):** re-express the LLM-egress guard as *"requires the no-retention-provider BAA/DPA flag (+ de-identification)"* — e.g. `if (!tenant || !tenant.egressBaaOk) throw new EgressBlocked(...)` — **NOT** `mode !== "sandbox"`. A live consented bundle (`mode:live`) feeds only the deterministic MaiK context; flipping `mode:live` never silently opens Vertex/Gemini egress for real PHI. (Preserve the existing sandbox-safe behavior for Phase-0 tests.)
- **Audit ALLOW-list (R14):** `ALLOW += ["consentId", "transactionId", "careContextHash"]`. New metadata-only events: `consent.granted/denied/revoked`, `data.requested/received/failed`. Never add raw `careContextReference` (HMAC → `careContextHash`), never raw ABHA, never decrypted content.

**Invariant (R7/R9/R14):** real PHI never reaches LLM egress on `mode:live` alone; the push-side reuses only the engine's normalize→validate→filter→audit tail; `buildAuditEvent` now structurally *keeps* `consentId`/`transactionId`/`careContextHash` (previously dropped) and still drops everything else.

**Tests:** a `mode:live` consented bundle → `assertEgressAllowed` throws `EgressBlocked` (LLM still gated); a tenant with the BAA/DPA flag set → egress allowed; a decrypted bundle flows through the tail → correct SCCM resource counts, scope-filtered; `buildAuditEvent({ consentId, transactionId, careContextHash })` retains all three; `buildAuditEvent({ careContextReference:"raw", abha:"x@sbx" })` drops both; no Phase-0 `maik-context.test.mjs` regression.

---

### Task 9 — end-to-end HIU flow vs the adversarial mock (`hiu-flow.test.mjs` + extend `mock-gateway.mjs`)

**Files:** Extend `test/connect/abdm/mock-gateway.mjs` (fire webhooks into `handleIngress`; add a HIP-encrypt path via `fidelius.sealBundle` over a synthetic NDHM bundle); Test `test/connect/abdm/hiu-flow.test.mjs`. Test-harness only — never shipped.

**Interfaces:**
- The mock plays gateway **and** HIP: on `consentInit`/`consentFetch`/`hiRequest` (`202`) it fires the matching webhook (`consents/hiu/notify`, `consents/on-fetch` with a **JWS-signed** synthetic artifact, `health-information/hiu/on-request` with a `transactionId`) back into `handleIngress`, then pushes a `sealBundle`-encrypted synthetic NDHM document Bundle. Behavior knobs (already stubbed in Stage-2): `outOfOrder`, `duplicate`, `partial`, `retryAfterAck`, `callbackDelayMs` (R10).
- The test drives `requestConsent → (notify) → fetchConsentArtifact/verifyConsentArtifact → requestHealthInformation → (on-request) → (push) → consumeTransfer → engine tail → buildMaikContext` and asserts the end state + audit trail.

**Invariant:** the whole HIU path is correct under adversarial delivery; the invariants of Tasks 4–8 hold *composed*, not just in isolation.

**Tests:** happy path → MaiK context carries the expected problems/meds/labs, exactly one ack, buffer + sealed key gone; **push-before-on-request** (`outOfOrder`) → buffer-then-join, correct final decrypt; **duplicate push** → deduped (one object, one decrypt); **partial** → `PARTIAL` ack, decrypted-subset surfaced; **retry-after-ack** → no second ack, no re-decrypt; **junk push** (unknown correlation) → `403`, R2 untouched; **replayed older GRANTED after REVOKE** → stays `REVOKED`; flag OFF anywhere → `404` and no side effects.

---

## Self-review

- **Spec coverage.** Stage-4 scope items map 1:1 → consent-request (T1), ingress webhook / verify+replay+correlate-before-buffer (T4, using the T2 verifier), fetch+JWS-verify+re-validation checklist (T5), data request / per-request consent-binding (T6), receive+per-entry-decrypt+exactly-once ack (T7), NDHM→SCCM normalize (T3), engine+MaiK+audit (T8), end-to-end vs the adversarial mock (T9). R-items: R1 per-entry decrypt+checksum (T7), R2/R8 buffer-then-join+CAS ack (T4/T7), R3 per-request-artifact-bound `mode:live` (T5/T6), R4 pinned JWS contract + request-time checklist (T2/T5), R6 ingress verify+replay+correlate-before-buffer+monotonic (T4), R7 fixed egress predicate (T8), R9 engine ingest tail / nullable event (T4/T8), R12 warn-don't-drop normalize (T3), R14 audit ALLOW-list + HMAC'd careContext (T8), R16 KV non-PHI only (T4), R17 txn keyed by requestId + ephemeral key at data-request (T6). **DUAL-ADVERSARIAL** on T5 and T7 as required.
- **No placeholders.** Every task lists concrete signatures + the invariant + inline test scenarios. `// VERIFY` marks only the genuinely-deferred owner values (JWKS URL, inbound signature scheme, `ENDPOINTS`/`FIELDS`/webhook path + `keyMaterial` field names) — never a logic gap.
- **Type/signature consistency.** `fidelius`: `randomBytes(32)`/`importRawPrivate(scalar)→{privateKey,publicKeyRaw}`/`sharedSecret(privateKey,Uint8Array(32))`/`openEntry(secret,ourNonce,theirNonce,contentB64,checksum)` used exactly as exported (fidelius stays **untouched** — the mint-via-`importRawPrivate` trick avoids needing a new `exportRawPrivate`). `state`: `putConsentReq`/`putTxn`(sealed)/`advanceStatus`(FSM edge `CONSENT_GRANTED→REQUESTED→RECEIVING→terminal`)/`claimAck`(CAS bool)/`tryJoin`/`bufferEntry`(HMAC'd ref) consumed per their Stage-3 signatures. `gateway.post(endpointKey,body)→{status,body}` with `ENDPOINTS` keys `consentInit|consentFetch|hiRequest|hiNotify`. `engine.loadPatientContext` tail + `ingestEvent`, `maik-context`, `audit`, `identity`, `canonical` all consumed as-built.

### Owner decisions / spec gaps noticed

1. **Prerequisite — Stage-3 Tasks 5–7 are not on the branch yet.** `state.tryJoin`, `state.sweep`, `abdm/connector.js`, and `engine.js`#`ingestEvent` (Stage-3 Tasks 5–7) are consumed by Stage 4 but not implemented (`state.js` ends at `claimAck`; no `connector.js`/`ingestEvent`). Stage 3 must be finished before Stage 4 can build/pass. **Confirm** we complete Stage-3 Tasks 5–7 first.
2. **Ephemeral-key timing conflict with the task brief.** The Stage-4 brief's item 1 says to *"generate the ephemeral X25519 keypair … persist via `putConsentReq`+`putTxn`"* at consent-request time — this contradicts the **spec (§3 step 6, §4 ADR-2D, R17)**, which mints the keypair at the **data request** and keys `putTxn` by the data-request `requestId`. This plan follows the **spec** (keypair + `putTxn` in T6, not T1). **Confirm** the spec ordering is intended (vs. minting early).
3. **Immunization vs the additive-only surface.** R12/§6 want `Immunization` (from `ImmunizationRecord`) as a real SCCM resource, but SCCM's `RESOURCE_KEYS` has no `immunizations` and adding one edits `canonical/model.js` + `validate.js` + engine `SCOPE_TO_KEY` + `maik-context.js` — **wider** than the stated additive surface (`abdm/*` + `connectors/abdm/*` + `api/connect/*` + audit ALLOW). This plan maps `ImmunizationRecord` as **warn-don't-drop** (metadata-only) for now. **Decide:** extend SCCM this stage (wider blast radius, needs a validator touch) or defer the `Immunization` resource to Stage-6 hardening.
4. **Inbound signature scheme unknown.** R6 mandates body-signature verification but the exact inbound mechanism (JWS vs detached RSA-SHA256 header vs HMAC) and the JWKS URL are unconfirmed (`sandbox.abdm.gov.in` was WAF-blocked). Both are `// VERIFY` behind the ADR-2H seam and fail closed until the owner pins them from the live Postman/Swagger.
5. **Minor — additive file surface.** The brief's additive list omits `functions/_connect/connectors/abdm/*`, but spec §9 places the NDHM normalizer there (mirroring the pull-side `connectors/fhir-r4/normalize.js`). This plan follows §9; the additive allow-list should include `connectors/abdm/*`.

## Execution handoff

Build order = Task 1 → 9 (each: failing test → code → refactor → commit). Tasks 2 and 3 are pure primitives with no cross-dependency and may be built in parallel with Task 1. **Task 5 and Task 7 each require a DUAL-ADVERSARIAL review** (two independent reviewers probing the consent-binding and the decrypt/exactly-once invariants, respectively) before they count as done — do not merge those tasks on a single reviewer. Task 9 is the composed integration proof and must pass every adversarial-delivery scenario (R10). Stage 5 (HIP serve, flag `smd_connect_hip`) and Stage 6 (hardening: `dataEraseAt`/REVOKE erasure via `state.sweep`, owner-onboarding docs, full no-PHI guard sweep) follow.
