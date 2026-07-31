# StewardMD Connect — Part 2 / Phase 1: ABDM (HIP + HIU) Design

**Date:** 2026-07-31
**Status:** Draft for owner review (no implementation until approved)
**Builds on:** Part-1 v1.1 (`2026-07-31-stewardmd-connect-part1-foundation-design.md`) — Phase 0 MERGED to main (commit 54b1b949), flag `smd_connect` OFF.
**Owner-approved scope (2026-07-31):** **full HIP + HIU** (consume records AND serve StewardMD's own records to other HIUs on consent). ABHA *creation* (Aadhaar OTP) deferred.

> **Grounding caveat (read first).** ABDM's official `sandbox.abdm.gov.in` was WAF-blocked during research, so every **endpoint path and JSON field name** below is corroborated from independent secondary sources, **not read off an official page** — treat them as "verify against the live Postman collection / Swagger before coding." The **Fidelius crypto scheme** (§4) and the **NDHM FHIR profiles** (§6, from the official NRCES IG v6.5.0) are high-confidence. We therefore build against a **mock ABDM gateway** with all paths/field-names isolated behind one config module (ADR-2H), so pinning them to reality later is a one-file change.

---

## 1. What Phase 1 adds

Phase 0 gave us the canonical model, the connector contract (with a reserved `event`/push profile + ingress route), the ephemeral fail-closed engine, and a MaiK context boundary. Phase 1 makes StewardMD Connect a real **ABDM participant**:

- **HIU (Health Information User)** — request patient consent via the ABDM Consent Manager, receive the encrypted FHIR bundles the patient's providers push, decrypt them (Fidelius), normalize NDHM-FHIR → **SCCM**, and hand the canonical model to MaiK. *This is the direct "feed MaiK with a patient's longitudinal records" path.*
- **HIP (Health Information Provider)** — register StewardMD's own patient records as ABDM **care contexts**, respond to discovery + consent notifications, and encrypt+push those records to requesting HIUs. *This lets StewardMD contribute records back to the network.*

Both roles share one machinery: session auth, the async request/callback pattern, the Fidelius crypto, the NDHM-FHIR profiles, and D1/R2 async-state. HIP layers onto the HIU core, it does not duplicate it.

**Non-goals for Phase 1:** ABHA *creation* (Aadhaar-OTP enrolment) — deferred; a patient supplies their existing ABHA address. NHCX/claims. Production credentials (owner-gated; V3 is sandbox-only today — see §12 risk).

---

## 2. Reconciliation with Phase 0

| Phase-0 seam | Phase-1 use |
|---|---|
| Connector `event` profile (`initiate`/`ingest`) — reserved | The **ABDM HIU connector** implements it: `initiate` = consent-request; `ingest` = decrypt+normalize a pushed bundle. |
| Signature-gated `POST /ingress/:connector` route — reserved (501) | Becomes the live **ABDM callback surface** (consent notify, on-request, data push), authenticated by ABDM (no StewardMD actor). |
| ADR-002 ephemeral PHI, "encrypted cache is a later opt-in" | The **transient encrypted push-buffer** (R2, short TTL, delete-after-decrypt) is that opt-in — needed because bundles arrive out-of-band, async. |
| `tenant.mode: sandbox\|live`; `live` refused until consent | Phase 1 **enables `live`** — but only once a real signed **consent artifact** exists for the requested care contexts. |
| SCCM v1 + validator + engine | Reused unchanged; add an **NDHM-FHIR document-Bundle → SCCM** normalizer + (Phase-1) a couple of SCCM fields. |
| Identity/tenant/audit/secrets | Reused. ABDM Client ID/Secret + the HIU/HIP private keys live in the envelope-encrypted secret store; consent/transaction correlation is new D1 tables; audit gains consent/transaction events. |

**Async-state decision (ADR-2A):** ABDM is *fire-and-forget + later webhook* at every step — the HIU never blocks waiting. So there is **no synchronous waiter to coordinate**; a Durable Object is unnecessary. We persist correlation in **D1** (consent-request⇄patient/requester; transaction⇄consent) and buffer the pushed (still-encrypted) bundle in **R2** with a short TTL, deduped by `careContextReference`+checksum. Both bind cleanly to Pages Functions.

---

## 3. HIU flow (the core)

```
[clinician picks patient + supplies ABHA address]           (patient QR / typed; no HIU lookup API by design)
        │
1  session ── POST /api/hiecm/gateway/v3/sessions {clientId,clientSecret,grantType:client_credentials} → bearer (short TTL)
2  init    ── POST /consent-requests/init {consent:{purpose,patient.id:"x@sbx",hiu.id,requester,hiTypes[],permission{dateRange,dataEraseAt,frequency}}} → 202
        │        (store request⇄patient/requester in D1, keyed by our fresh REQUEST-ID/requestId)
3  ⌛ patient approves in their ABHA app (minutes–hours later)
4  webhook ─→ POST /ingress/abdm  (consents/hiu/notify): {status:GRANTED|DENIED|REVOKED, consentId(s)}  → ack /consents/hiu/on-notify (fast)
5  fetch   ── POST /consents/fetch {consentId} → 202 → webhook /consents/on-fetch {artifact:{careContexts[],hiTypes[],permission,signature(JWS)}}
        │        (verify artifact JWS vs ABDM JWKS — see §8; store consent+careContexts in D1)
6  request ── POST /health-information/cm/request {hiRequest:{consent.id,dateRange,dataPushUrl,keyMaterial:{cryptoAlg:ECDH,curve:Curve25519,dhPublicKey,nonce}}} → 202
        │        (generate an EPHEMERAL X25519 keypair + nonce for THIS transaction; store priv key ⇄ transaction in D1, short TTL)
7  on-req  ─→ webhook /health-information/hiu/on-request {transactionId}   (store transaction⇄consent in D1)
8  push    ─→ POST {dataPushUrl}=/ingress/abdm  from HIP(s): {entries[]:{content(b64),media,checksum,careContextReference}, keyMaterial(HIP pubkey+nonce)}
        │        (buffer entries in R2 encrypted; dedupe by careContextReference+checksum; may arrive unordered / multi-HIP / retried)
9  decrypt ── Fidelius(ourPriv, hipPub, ourNonce, hipNonce) → AES-GCM-decrypt each entry → NDHM-FHIR document Bundle
10 normalize NDHM-FHIR → SCCM ; validate ; permission-filter ; → CanonicalBundle → (gated) MaiK context
11 ack     ── POST /health-information/notify {transactionId, sessionStatus:TRANSFERRED|PARTIAL|FAILED}
        │        (delete R2 buffer + the ephemeral private key; audit metadata only)
```

Steps 1-2-6-11 are outbound (HIU→gateway); steps 4-5-7-8 are inbound on the **one** registered callback base URL (`/ingress/abdm`), disambiguated by `X-HIU-ID`/`X-HIP-ID` + our correlation ids. The clinician-facing UI is a thin "request records for this ABHA / show status" surface (Phase-1 minimal; polished in Phase 3's portal).

---

## 4. Fidelius crypto (high-confidence; build + test standalone first)

Isolated module `functions/_connect/abdm/fidelius.js`. The scheme (independently reproduced across 3 implementations):

1. Each party: fresh **X25519** (Curve25519 ECDH) keypair + 32-byte random **nonce**.
2. `shared = X25519(ourPriv, theirPub)`.
3. `xorNonce = ourNonce XOR theirNonce` (32 bytes).
4. `salt = xorNonce[0..20)` ; `iv = xorNonce[20..32)` (last 12 bytes).
5. `key = HKDF-SHA256(ikm=shared, salt=salt, info="", len=32)` → AES-256-GCM key.
6. `plaintext = AES-256-GCM-decrypt(key, iv, base64decode(entry.content))` → FHIR JSON. (Encrypt is the mirror, for HIP.)

**Implementation:** HKDF + AES-GCM are in WebCrypto (Workers **and** Node webcrypto). **X25519 is the one risk** — `crypto.subtle` X25519 `deriveBits` is supported in recent Workers and Node ≥ (verify), but not universally. **ADR-2C:** wrap X25519 behind a tiny `x25519(priv,pub)` function; primary path = WebCrypto `deriveBits({name:"X25519"})`; documented contingency = a single vendored audited X25519 source file (not an npm dep) if the runtime lacks it. Ship known-answer test vectors so the module is provably correct before any gateway wiring.

**Key lifecycle (ADR-2D):** one ephemeral keypair **per `health-information/cm/request`**; the private key is stored envelope-encrypted in D1 keyed by `transactionId`, used only to decrypt that transaction's push, and **deleted** on ack/expiry. No global/static DH key.

---

## 5. Async state (D1 + R2)

New D1 tables (additive, in `stewardmd-connect` DB):
```sql
CREATE TABLE connect_abdm_consent_req (   -- step 2→4 correlation
  request_id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, patient_abha_hash TEXT,  -- HMAC, not raw ABHA
  status TEXT, consent_id TEXT, hi_types TEXT, created_at TEXT, updated_at TEXT );

CREATE TABLE connect_abdm_txn (            -- step 6→8 correlation
  transaction_id TEXT PRIMARY KEY, tenant_id TEXT, consent_id TEXT,
  eph_privkey_ref TEXT,                     -- envelope-encrypted ephemeral X25519 private key (or KV ref), short TTL
  status TEXT, expires_at TEXT, created_at TEXT );

CREATE TABLE connect_abdm_carecontext (    -- HIP side: what StewardMD can serve
  id TEXT PRIMARY KEY, tenant_id TEXT, patient_abha_hash TEXT, source TEXT,  -- followcare|icu|case
  ref TEXT, hi_type TEXT, display TEXT, linked_at TEXT );
```
Push buffer: **R2** object per `{transactionId}/{careContextReference}`, storing the still-Fidelius-encrypted entry + checksum, TTL ~ minutes, deleted after decrypt+ack. `patient_abha_hash` is a per-tenant **HMAC** (never the raw ABHA — same pseudonym discipline as Phase 0's `patientRefHash`).

---

## 6. NDHM-FHIR → SCCM normalizer

Official NRCES IG v6.5.0 (`nrces.in/ndhm/fhir/r4/`). Each pushed entry is a `Bundle.type=document` with a **Composition first**, one of: `DiagnosticReportRecord`, `PrescriptionRecord`, `DischargeSummaryRecord`, `OPConsultRecord`, `WellnessRecord`, `ImmunizationRecord`, `HealthDocumentRecord`, `InvoiceRecord`, generic `DocumentBundle`.

`functions/_connect/connectors/abdm/normalize.js` maps the document Bundle → SCCM by walking the Composition + its referenced resources: `Condition`→Condition, `MedicationRequest`/`MedicationStatement`→MedicationStatement(+origin), `Observation`(lab/vital)→Observation, `AllergyIntolerance`→AllergyIntolerance, `DiagnosticReport`→DiagnosticReport, the Composition narrative + `HealthDocumentRecord`→DocumentReference (by-reference/narrative — no binary/pixel). Reuses the Phase-0 SCCM factories + `kind:standard|local` coding + required `text` fallback + stable-id rules. Phase-1 SCCM additions (additive-within-major): `Immunization` (from ImmunizationRecord) and a `source: "abdm"` provenance tag. Fixtures: **synthetic** NDHM bundles (never real ABDM data).

---

## 7. HIP flow (serve StewardMD's own records)

StewardMD isn't an EMR, but it holds patient clinical data that can be lawfully shareable **care contexts**: **FollowCare** discharge/recovery records, **ICU** session summaries, saved **cases**. HIP capability:

1. **Care-context registration:** when a StewardMD patient has an ABHA, link the relevant record(s) as care contexts (`connect_abdm_carecontext`). Owner/clinician-initiated, consent-noted.
2. **Discovery** (V3 synchronous): respond to a patient-discovery request with matching care contexts.
3. **Consent notification:** on a HIP-side consent grant, store it.
4. **Data request → encrypt + push:** on a HIU's data request, render the StewardMD record as an **NDHM-FHIR document Bundle** (Composition-first; globally-unique `Bundle.identifier`), Fidelius-encrypt with the HIU's public key + our fresh keypair, and push to the HIU's `dataPushUrl`.

**Guardrails (ADR-2G):** HIP serves only records StewardMD already holds and is authorized to share; it **generates FHIR from existing data — it never diagnoses, prescribes, or alters records** (consistent with the FollowCare invariant); every served record is consent-gated + audited. HIP is **flag-gated separately** (`smd_connect_hip`) so consuming (HIU) can ship without serving. Phase 1 wires HIP to **one** source end-to-end (proposal: FollowCare discharge summary) and scaffolds the others behind a `HipSource` interface.

---

## 8. Security, consent & DPDP

- **Consent-first is now REAL.** No `health-information/cm/request` without a fetched, **JWS-verified** consent artifact whose `careContexts`+`hiTypes`+`permission` cover the request. Artifact signature verified against ABDM's published JWKS (**owner must confirm the JWKS URL** — research couldn't pin it; until then, signature-verify is a hard gate that fails closed if the JWKS/key is unavailable). `permission.dataEraseAt` honored (delete derived state by then).
- **PHI handling.** Decrypted bundles are PHI. HIU path stays **ephemeral by default** (decrypt → SCCM → MaiK → discard), *except* the unavoidable **transient encrypted push-buffer** (R2, minutes TTL, deleted after decrypt+ack, encrypted at rest). MaiK LLM egress stays gated (`assertEgressAllowed`) until the no-retention provider tier + BAA/DPA exist.
- **Secrets.** ABDM Client ID/Secret + HIP/HIU signing/private keys in the envelope-encrypted store (fail-closed); ephemeral DH private keys envelope-encrypted, `transactionId`-scoped, deleted on completion. `REQUEST-ID` is a fresh UUID per call (gateway rejects reuse).
- **Callback authenticity.** `/ingress/abdm` is authenticated by ABDM's mechanism (IP allow-list + the request signature/headers ABDM provides), **not** a StewardMD actor; it fails closed on an unrecognized `X-HIU-ID`/`X-HIP-ID` or a correlation id with no matching D1 row.
- **DPDP roles.** For HIU consume, the **patient** consents via the ABDM Consent Manager and StewardMD processes under that consent + purpose limitation (`purpose.code`), `dataEraseAt`, minimum-necessary `hiTypes`. For HIP serve, StewardMD is the source Fiduciary for its own records. India data-residency: pin D1/KV/R2 to an India region where available.
- **Audit.** New metadata-only events (PHI-free, append-only): `consent.requested/granted/denied/revoked`, `data.requested/received/failed`, `hip.served`, each carrying `patient_abha_hash` (HMAC), consent/transaction ids, counts — never PHI, never the raw ABHA, never decrypted content.

---

## 9. Folder structure (Phase-1 additions)

```
functions/_connect/
  abdm/
    fidelius.js            # X25519 ECDH + XOR-nonce salt/iv + HKDF + AES-GCM (encrypt+decrypt)
    gateway.js            # session auth + the outbound HIU calls; ALL endpoint paths + field names live here (ADR-2H config)
    hiu.js                # HIU orchestration: init → (webhook) → fetch → request → (push) → decrypt → normalize
    hip.js                # HIP orchestration: discovery/consent → render FHIR → encrypt → push  (flag smd_connect_hip)
    consent.js            # consent-artifact parse + JWS verify (JWKS) + permission checks
    state.js              # D1 correlation tables + R2 push-buffer (store/lookup/dedupe/expire)
    hip-sources/followcare.js  # HipSource: StewardMD record → NDHM-FHIR document Bundle (one real source; others scaffolded)
  connectors/abdm/
    connector.js          # event-profile connector (initiate=consent, ingest=decrypt+normalize) — plugs into the Phase-0 engine
    normalize.js          # NDHM-FHIR document Bundle → SCCM
  db/connect_abdm_schema.sql
functions/api/connect/[[path]].js   # /ingress/abdm becomes live (was 501)
test/connect/abdm/
  fidelius.test.mjs (known-answer vectors)  gateway.test.mjs (mock gateway)  hiu-flow.test.mjs (end-to-end vs mock)
  normalize-ndhm.test.mjs  consent.test.mjs  hip.test.mjs  state.test.mjs  fixtures/ (SYNTHETIC NDHM bundles)
docs/connect/abdm/  adr/  hiu-flow.md  hip-flow.md  crypto.md  owner-onboarding.md
```

---

## 10. Testing (mock-gateway-first)

- **Fidelius**: known-answer vectors (round-trip + cross-implementation vectors where available); tamper → GCM auth failure (fails closed).
- **Mock ABDM gateway** (`test/connect/abdm/mock-gateway.mjs`): plays the gateway + a HIP — accepts init/fetch/request, fires the webhooks back into `/ingress/abdm`, and pushes a Fidelius-encrypted synthetic NDHM bundle. Exercises the whole HIU flow deterministically, offline, with no real credentials.
- **NDHM normalize**: synthetic document Bundles (each profile) → valid SCCM; partial/missing → warnings, never crash.
- **Consent**: JWS verify (valid/invalid signature, expired, scope-mismatch → deny fail-closed).
- **State**: correlation lookup, dedupe by careContextReference+checksum, TTL/delete, ephemeral-key delete-after-ack.
- **HIP**: FollowCare record → valid NDHM document Bundle (unique identifier, Composition-first) → encrypt → mock HIU receives+decrypts it.
- **no-PHI guard** extended: no decrypted content / raw ABHA / private key in any audit/log/error; synthetic fixtures only.
- Perf: Fidelius decrypt + normalize per bundle < 50ms; end-to-end (mock) deterministic.

---

## 11. ADRs (summary)

- **ADR-2A** — D1+R2 for async state, not a Durable Object (ABDM is async-webhook, no sync waiter to coordinate).
- **ADR-2B** — HIU + HIP as `event`-profile connectors reusing the Phase-0 engine + the reserved ingress route; HIP separately flag-gated.
- **ADR-2C** — Fidelius X25519 via WebCrypto `deriveBits`, with a vendored-single-file contingency; standalone known-answer-tested before any wiring.
- **ADR-2D** — ephemeral DH keypair per data-request, `transactionId`-scoped, envelope-encrypted, deleted on ack.
- **ADR-2E** — transient **encrypted** R2 push-buffer is the ADR-002 opt-in exception (minutes TTL, delete-after-decrypt); everything else stays ephemeral.
- **ADR-2F** — consent-first for real: JWS-verified artifact required before any data request; `mode:live` enabled only behind a valid artifact; fail-closed if JWKS/signature unavailable.
- **ADR-2G** — HIP renders FHIR from existing StewardMD data only; never diagnoses/prescribes/alters; consent-gated + audited.
- **ADR-2H** — every unverified ABDM endpoint path + field name lives in ONE `gateway.js` config block; build/test against a mock gateway; pinning to the real Postman/Swagger is a one-file change (research was WAF-blocked from official docs).
- **ADR-2I** — ABHA supplied by the patient (QR/typed), not resolved by a HIU lookup (no such API by design); ABHA creation deferred.

---

## 12. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Endpoint paths/field-names wrong (official docs WAF-blocked) | High→Low | All isolated in `gateway.js` (ADR-2H); mock-gateway build; owner pins to live Postman before real calls |
| X25519 not in a target runtime's WebCrypto | Medium | Isolated `x25519()`; vendored-file contingency (ADR-2C); test vectors |
| V3 is sandbox-only; prod is still V1 | High | Build V3 for sandbox; keep the gateway adapter versioned so a V1/V3 prod difference is contained; owner confirms prod parity before go-live |
| Consent-artifact JWKS/signature URL unknown | Medium | Signature-verify is a hard fail-closed gate; owner confirms JWKS from Postman/NHA; no data request without a verified artifact |
| Async push: unordered / multi-HIP / retried / partial | Medium | Dedupe (careContextReference+checksum); PARTIAL/FAILED handling; idempotent ingest keyed by transaction |
| Buffered PHI at rest (push-buffer) | Medium | Encrypted in R2, minutes TTL, delete-after-decrypt, HMAC ABHA; DPDP DPIA note |
| HIP over-shares / serves wrong record | High | Consent-gated + audited; renders existing data only; single wired source + scaffolds; separate flag |
| Sandbox flakiness (403/WAF, per research) | Low | Retry/backoff + manual support escape hatch; mock-gateway tests are the source of truth for our correctness |

---

## 13. Owner steps (before real ABDM calls)

1. Register StewardMD on **sandbox.abdm.gov.in** (~3-4 days); obtain **Client ID/Secret**; declare an **HIU ID** (+ **HIP ID** for serving).
2. Whitelist **one** callback base URL = `https://stewardmd.in/api/connect/ingress/abdm` (ABDM health-checks it).
3. Pull the **live Postman collection / Swagger** and hand me the exact paths + field names + the JWKS URL, so I pin `gateway.js`/`consent.js` to reality (research was WAF-blocked from these).
4. Provide the sandbox Client ID/Secret as Workers secrets (`ABDM_CLIENT_ID`/`ABDM_CLIENT_SECRET`); confirm the India region for D1/KV/R2.
5. Production is a separate, gated exit process (FIME functional test + Safe-to-Host security cert + NHA review) — not in Phase 1.

---

## 14. Phased build order (within Phase 1)

Each stage: implement → test → benchmark → review → document, then next (subagent-driven, like Phase 0).

1. **Fidelius crypto** (standalone, known-answer vectors) — provable before anything touches a gateway.
2. **Mock gateway + gateway.js adapter** (config-isolated paths) + session auth.
3. **State** (D1 correlation + R2 buffer) + the **event-profile ABDM connector** skeleton.
4. **HIU consume**: init → webhook ingress → fetch+verify consent → data request → receive+decrypt → **NDHM→SCCM** → engine → MaiK context, end-to-end vs the mock. `mode:live` gated behind a verified artifact.
5. **HIP serve** (flag `smd_connect_hip`): FollowCare source → NDHM document Bundle → encrypt → push; mock HIU decrypts.
6. **Hardening**: consent JWS verify, dataEraseAt honoring, PARTIAL/retry handling, audit events, no-PHI guard, owner-onboarding docs.

Deferred to later phases (unchanged): ABHA creation; the enterprise onboarding portal UI (Phase 3); MaiK orchestration/timeline (Phase 4); NHCX/claims.
