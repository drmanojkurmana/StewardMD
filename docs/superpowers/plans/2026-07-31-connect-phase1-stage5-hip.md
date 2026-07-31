# StewardMD Connect — Phase 1 Stage 5: HIP Serve (StewardMD as Health Information Provider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **TDD is mandatory** (superpowers:test-driven-development): write the failing test first, watch it fail, then the minimum code to pass, then refactor. Two tasks are marked **REVIEW: DUAL-ADVERSARIAL** — spawn two independent adversarial reviewers before that task's code is considered done (see Execution handoff). **Task 3 is a HARD GATE: the branch does not merge until its multi-entry Known-Answer-Test proves pairwise-distinct `(key,iv)` AND both adversarial reviewers sign off.**

**Goal:** Make StewardMD a Health Information **Provider** that ABDM/HIUs can discover and fetch from: turn a **FollowCare** discharge/recovery record into a valid **NRCES NDHM FHIR R4 document Bundle** (Composition-first, globally-unique `Bundle.identifier`, author/custodian/provenance-tagged), Fidelius-**encrypt** it against the requesting HIU's `keyMaterial` + our own fresh ephemeral keypair, and **push** it to the HIU's `dataPushUrl`; plus an **exact-match, rate-limited, audited discovery** oracle and a **cross-patient over-share guardrail** (R5). This is the mirror/inverse of the Stage-4 HIU consume path — Stage 5 goes SCCM/FollowCare → NDHM, not NDHM → SCCM. Everything runs offline vs an extended mock that now plays a **HIU** (it discovers, grants, requests, receives the push, and decrypts it) — no real credentials, no real endpoints. Flag **`smd_connect_hip`** is separate from `smd_connect` and default OFF, so consuming (HIU) ships without serving.

**Architecture:** Stage 5 is the *serve* layer that **consumes** the already-built Stage-1..4 primitives and adds no new crypto/state machinery — it sequences them in the opposite direction. `fidelius.js`/`gateway.js`/`state.js`/`connectors/abdm/normalize.js`/`consent.js`/`audit.js`/`identity.js` are used **as-built and untouched**. HIP-directed callbacks (discovery, HIP consent-notify, HIP data-request) arrive on the SAME single ingress base URL as HIU (`/ingress/abdm`), disambiguated by event type + `X-HIP-ID`, and reuse the Stage-4 fail-closed ingress spine unchanged (verify-body-signature → replay-defend → correlate-before-act); a second flag `smd_connect_hip` structurally gates every HIP surface. HIP is **ABDM-authenticated** (no StewardMD actor on the ingress) EXCEPT the owner/clinician-initiated care-context **registration** route, which is a normal server-derived-identity call (`resolveActor`/`resolveTenant`). PHI is pass-through: read the FollowCare record → serialize to NDHM → seal → push → discard; the NDHM plaintext lives only in a request-scoped variable, sealed immediately, never persisted, never logged. The one at-rest clinical trace stays what Stage 3 already owns (the transient **encrypted** R2 buffer, HIU-side). Pure dependency-injected ES modules over D1 (`env.CONNECT_DB`) + R2 (`env.CONNECT_R2`) + KV (`env.MAIK_KV`, non-PHI rate-limit/nonce cache only) + the Stage-0 secrets. The mock (Stage-2 harness, extended) now plays **HIU**: it fires HIP-directed webhooks into the ingress, captures the HIP's pushed transfer pages at a `dataPushUrl`, and **decrypts** each page with `fidelius.openEntry` using that page's keyMaterial — the round-trip proof.

**Tech Stack:** Plain ES modules, D1, R2, KV, WebCrypto, `node:test`. No new dependencies. Consumes: Stage-1 `fidelius.js` (`generateKeyPair`/`sharedSecret`/`nonce`/`deriveKeyIv`/`sealBundle`/`openEntry`/`FideliusError` — see its caller-contract docstring: **one plaintext per `(secret,ourNonce,theirNonce)`; there is no batch API on purpose; Stage 5 owns one-keyMaterial-per-entry + the multi-entry KAT**), Stage-2 `gateway.js` (`makeGateway`/`post`/`ENDPOINTS`/`FIELDS`), Stage-3 `state.js` (`putConsentReq`/`getConsentReq`/`updateConsentStatus`, the `connect_abdm_carecontext` table), Stage-4 `connectors/abdm/normalize.js` (the HIU-side normalizer we mirror/invert + round-trip against), `consent.js` (`verifyConsentArtifact`/`revalidateForRequest`), `jws.js` (`verifyJws`/`getPinnedJwks`), `canonical/model.js`+`coding.js`+`validate.js`, `audit.js` (`buildAuditEvent`/`hmacPseudonym`/ALLOW), `identity.js`, `ingress.js` spine, `testkit.js`.

## Global Constraints

- **Buildless Cloudflare stack; plain ES modules; `node --test`; NO new deps.**
- **Additive-only.** New files under `functions/_connect/abdm/*`, `functions/_connect/abdm/hip-sources/*`, `functions/_connect/connectors/abdm/*`, `functions/api/connect/*`, `test/connect/abdm/*`. The ONLY edits to existing runtime files are the two spec-mandated routing edits (**the HIP ingress + discovery routes**): (a) the HIP-event branches in `functions/_connect/abdm/ingress.js` (all `hipFlagOn`-gated, reusing the SAME verify→replay→correlate spine), and (b) the HIP deps + care-context-registration route in `functions/api/connect/[[path]].js`. Do NOT touch any other existing runtime file (`fidelius.js`/`gateway.js`/`state.js`/`consent.js`/`normalize.js`/`audit.js`/`identity.js` stay as-built).
- **Flag `smd_connect_hip` default OFF, separate from `smd_connect`.** `hipFlagOn(env)` requires BOTH the base connect flag AND the HIP flag; a HIP surface with `smd_connect_hip` OFF returns `404` (does not leak existence). Zero regression: all Phase-0/Stage-1/2/3/4 tests stay green; the HIU consume path is unaffected by the HIP flag.
- **Mock-first — no real creds.** All endpoint paths + field names stay behind the ADR-2H `ENDPOINTS`/`FIELDS`/local field-seam pattern; build/test against the mock only. Mark anything needing the owner's real ABDM endpoint/JWKS/transfer-shape values with `// VERIFY`.
- **Server-derived identity — never the request body.** Care-context registration: `resolveActor`/`resolveTenant` (a non-member `tenantId` → `PermissionError`). HIP ingress: ABDM-authenticated, tenant derived from the correlation / care-context row, never body-supplied.
- **No PHI in URLs/logs/KV.** Raw ABHA is **POST-body only, `no-store`, never in a URL/path/log/KV/D1** (D1 stores only the per-tenant HMAC). KV holds only the non-PHI discovery rate-limit counter + the inbound REQUEST-ID nonce cache (R16). `careContextReference` is HMAC'd before any key/audit/dedupe use (R14). The `dataPushUrl` is HIU-supplied → validated https + host-allow-listed before any POST (anti-SSRF).
- **Ephemeral pass-through PHI.** The FollowCare-derived NDHM plaintext lives only in a request-scoped variable; sealed immediately, never persisted, never logged. HIP renders FHIR from existing StewardMD data only — it **never diagnoses, prescribes, or alters records** (ADR-2G / the FollowCare invariant).
- **Fail-closed everywhere.** Any guard/serialize/seal/push/verify/correlate error → refuse + audit metadata-only outcome; never partial-open, never silent-leak.
- **⛔ HARD GATE (R1 nonce-safety).** The encrypt step MUST NOT reuse an AES-GCM `(key,iv)` across two distinct plaintexts. `fidelius` derives the iv deterministically from the two nonces, so looping `sealBundle` over multiple entries under ONE keyMaterial = GCM nonce-reuse catastrophe (GHASH-subkey leak → plaintext-XOR + tag forgery). Stage 5 implements R1 the **nonce-safe** way — a **FRESH keyMaterial (fresh ephemeral keypair + fresh nonce) per encrypted entry / one entry per transfer page** — and proves it with a **multi-entry Known-Answer-Test** (Task 3). The plan **must not** produce two plaintexts under one keyMaterial.
- **DUAL-ADVERSARIAL review** required for **Task 3 (nonce-safe multi-entry seal + multi-entry KAT — the HARD GATE)** and **Task 5 (cross-patient over-share guardrail, R5)**.

### Prerequisite (Stage-4 must be on the branch)

Stage 5 consumes Stage-4 exports (`consent.js#verifyConsentArtifact`/`revalidateForRequest`, `hiu.js#consumeTransfer` as the reconciliation reference, `connectors/abdm/normalize.js`, `ingress.js#handleIngress`, the R7 egress guard, the R14 ALLOW-list). Those are already committed on `feat/connect-phase1-stage4-hiu` (HEAD `bc7fbc57`). Branch Stage 5 off Stage-4; the recovery point is tag `pre-connect-stage5` (create before Task 1). This plan **references** those exports by their built signatures and does not re-plan them.

---

## File structure

```
functions/_connect/abdm/hip-sources/followcare.js   # HipSource: FollowCare discharge/recovery episode -> SCCM-shaped record (one real source; ICU/cases scaffolded)
functions/_connect/connectors/abdm/serialize.js     # SCCM record -> NDHM FHIR R4 document Bundle + validateNdhmDoc (mirror/INVERSE of connectors/abdm/normalize.js) (R11,R12)
functions/_connect/abdm/hip-crypto.js               # nonce-safe seal: FRESH keyMaterial per entry + no-batch contract + multi-entry KAT surface (R1 — HARD GATE)
functions/_connect/abdm/hip.js                       # HIP orchestration: assertServeAllowed(R5), serveTransfer, handleDiscovery, linkCareContext, HIP-consent store
functions/_connect/abdm/hip-flags.js                 # hipFlagOn(env) — requires BOTH smd_connect AND smd_connect_hip; default OFF
functions/_connect/abdm/ingress.js                   # (edit) add hipFlagOn-gated HIP-event branches: discovery | hip-consent-notify | hip-hi-request (same verify->replay->correlate spine)
functions/api/connect/[[path]].js                    # (edit) wire HIP deps (source, handlers) + a server-identity POST /hip/care-contexts registration route
test/connect/abdm/mock-gateway.mjs                   # (extend) the mock now plays a HIU: fire HIP webhooks, capture the push at dataPushUrl, DECRYPT each page via fidelius.openEntry
test/connect/abdm/hip-source-followcare.test.mjs  serialize-ndhm.test.mjs  hip-crypto.test.mjs  hip-serve.test.mjs
test/connect/abdm/hip-guard.test.mjs  hip-discovery.test.mjs  hip-ingress.test.mjs  hip-carecontext.test.mjs
test/connect/abdm/hip-flow.test.mjs                  # end-to-end HIP serve vs the mock HIU (the integration + round-trip proof)
test/connect/abdm/fixtures/hip-*.mjs                 # SYNTHETIC FollowCare episodes + expected NDHM bundles (never real patient data)
test/connect/abdm/vectors/hip-seal-*.mjs             # the multi-entry Known-Answer-Test vector (fixed HIU keyMaterial + fixed ephemeral scalars)
```

---

### Task 1 — HipSource interface + FollowCare adapter (`hip-sources/followcare.js`: `followcareSource`)

**Files:** Create `functions/_connect/abdm/hip-sources/followcare.js` + `test/connect/abdm/fixtures/hip-*.mjs` (SYNTHETIC); Test `test/connect/abdm/hip-source-followcare.test.mjs`.

**Interfaces:**
- `followcareSource = { id:"followcare", hiTypes:["DischargeSummary","OPConsultation","Prescription"], listCareContexts(env, deps, { tenantId, patientAbhaHash }) -> careContext[], loadRecord(env, deps, { tenantId, careContextRef }) -> { record, patientAbhaHash, hiType, recordType } }`. `deps = { db, now, followcare }` (the FollowCare episode reader is injected — no direct coupling). `record` is an **SCCM-shaped** intermediate built with the Phase-0 `bundle()`/`condition()`/`medicationStatement()`/`observation()`/`documentReference()` factories from a FollowCare discharge/recovery episode: patient, the discharge diagnosis → `conditions`, discharge meds → `medications`, recorded vitals/labs → `observations`, the discharge summary → a `documentReference` (narrative text, NO binary). `recordType:"DischargeSummaryRecord"`.
- Other sources (ICU session summary, saved cases) are declared behind the SAME `HipSource` shape but throw `NotImplemented` — scaffolded, not wired (spec §7: "wire HIP to ONE source end-to-end … scaffold the others").

**Invariant (ADR-2G):** the source is a **pure read projection** of data StewardMD already holds — it never diagnoses/prescribes/alters (the FollowCare invariant). It emits ONLY records whose subject is the requested patient (scoped by `patient_abha_hash`); an unknown/empty episode → an empty list, never a throw. No raw ABHA is read or returned (the source works from the HMAC `patient_abha_hash`).

**Tests:** a synthetic FollowCare discharge episode → one `careContext` + a `loadRecord` whose `record` carries SCCM-shaped `conditions`/`medications`/`documents` with `text` fallbacks; a patient with no records → `listCareContexts` empty (no throw); the source never emits a resource whose subject differs from the requested `patientAbhaHash`; an ICU/cases source id → `NotImplemented`.

---

### Task 2 — SCCM record → NDHM FHIR R4 document Bundle serializer (`connectors/abdm/serialize.js`: `serializeNdhm` + `validateNdhmDoc`)

**Files:** Create `functions/_connect/connectors/abdm/serialize.js` + expected-bundle fixtures; Test `test/connect/abdm/serialize-ndhm.test.mjs`. **Mirror/INVERSE of `connectors/abdm/normalize.js`** — same `STD` terminology set, the inverse of its `cc()` text-fallback helper, the same record-profile names, and its output must round-trip back through `normalizeNdhm` to the same SCCM resource counts.

**Interfaces:**
- `serializeNdhm(ctx, record) -> docBundle` — builds a `Bundle.type="document"` with:
  - a **globally-unique `Bundle.identifier`** = `{ system:"urn:ietf:rfc:3986", value:"urn:uuid:"+crypto.randomUUID() }` (fresh per call);
  - **Composition FIRST** (`entry[0]`): `Composition.type` = the record profile (e.g. DischargeSummaryRecord), `Composition.subject` → the Patient, **`Composition.author`** = a StewardMD `Device`/`Organization` resource, **`Composition.custodian`** = the StewardMD tenant `Organization`, `Composition.section[].entry` referencing each mapped resource (R11 — so a StewardMD decision-support summary is NOT ingested as a hospital's legal medical record);
  - then the referenced resources, inverting the normalizer: SCCM `condition`→`Condition`, `medicationStatement`→`MedicationRequest`|`MedicationStatement` (by `origin: order|statement`), `observation`→`Observation` (category preserved), `diagnosticReport`→`DiagnosticReport` (+ its result `Observation`s), `documentReference`→ Composition narrative / `DocumentReference` (by-reference / narrative text only — **NO binary/pixel/attachment bytes**);
  - every coded field emits `coding[]` **AND always a non-empty `text`** (the inverse of `cc()`; a StewardMD-`local` code stays `local`, a `standard` system stays standard);
  - `meta.tag`/provenance `source:"StewardMD"` on every resource.
- `validateNdhmDoc(docBundle) -> { ok:boolean, errors:string[] }` — the NDHM profile **shape** checker (mirror of what the HIU normalizer expects): `type==="document"`, a unique non-empty `Bundle.identifier`, **the first entry is a Composition**, the Composition has `author`+`custodian`+`subject`, every `CodeableConcept` has a non-empty `text`, and NO attachment/`Binary` bytes are present. `// VERIFY: validate the emitted bundle against the live NRCES/FHIR validator (R11) — this is the structural gate, not full profile conformance.`

**Invariant (R11/R12):** Composition-first; globally-unique identifier; author/custodian/provenance tagged; every coded field has a `text` fallback; zero binary. **Round-trip:** `serializeNdhm(ctx, r)` fed back through `normalizeNdhm` yields the same SCCM resource counts (the inverse-correctness proof).

**Tests:** a discharge record → a `type:document` bundle whose `entry[0]` is a Composition with `author`+`custodian` and a fresh `urn:uuid:` identifier; every CodeableConcept has a `text`; no attachment bytes anywhere; `validateNdhmDoc` → `ok:true`; **round-trip** — the output through `normalizeNdhm` gives matching condition/medication/observation/document counts; a record with a `local`-only code → a `local` coding + preserved `text`; two serializations of the same record → two DIFFERENT `Bundle.identifier`s (uniqueness); an empty/missing record → `validateNdhmDoc` errors, no throw.

---

### Task 3 — Nonce-safe multi-entry Fidelius seal + multi-entry Known-Answer-Test (`hip-crypto.js`) — **REVIEW: DUAL-ADVERSARIAL — ⛔ HARD GATE (blocking pre-merge)**

**Files:** Create `functions/_connect/abdm/hip-crypto.js`; Test `test/connect/abdm/hip-crypto.test.mjs` + a KAT vector `test/connect/abdm/vectors/hip-seal-kat.mjs`. **This is the crypto-critical task. `fidelius.js` stays UNTOUCHED — this module is the caller that honors its no-batch contract.**

**Interfaces:**
- `sealForHiu(hiuKeyMaterial, plaintextStr, io={}) -> { content, checksum, keyMaterial }` — mints a **FRESH** ephemeral keypair (`fidelius.generateKeyPair`) + a **FRESH** 32-byte nonce (`fidelius.nonce`) **per call**, derives `secret = sharedSecret(ourPriv, unb64(hiuKeyMaterial.dhPublicKey))`, then `sealBundle(secret, ourNonce, unb64(hiuKeyMaterial.nonce), plaintextStr)` → EXACTLY ONE plaintext under the derived `(key,iv)`. Returns the ciphertext + the HIP's half `keyMaterial = { cryptoAlg:"ECDH", curve:"Curve25519", dhPublicKey:b64(ourPublicKeyRaw), nonce:b64(ourNonce) }`. `hiuKeyMaterial = { dhPublicKey, nonce }` (both base64) is the HIU's half. `io` optionally injects the ephemeral scalar+nonce for the deterministic KAT — production always uses the CSPRNG path.
- `sealEntries(hiuKeyMaterial, plaintexts[], io={}) -> transferPages[]` — the R1-safe multi-record path: returns **ONE transfer page per plaintext**, EACH with its OWN fresh `keyMaterial` (calls `sealForHiu` once per plaintext). **There is NO form that seals two plaintexts under one keyMaterial** (mirrors `fidelius.sealBundle`'s intentional no-batch contract). `// VERIFY` the exact ABDM `/health-information/transfer` wire-shape (see owner note): the plan **defaults to one entry per transfer page + fresh keyMaterial per page**, which is (a) nonce-safe by construction and (b) consume-compatible with the built Stage-4 `consumeTransfer`, which applies ONE keyMaterial across a page's `entries[]`.

**Invariant (R1 — the HARD GATE):** the derived AES-GCM `(key,iv)` is **never reused across two distinct plaintexts**. A fresh ephemeral keypair + fresh nonce per entry ⇒ distinct nonces ⇒ distinct `xorNonce` ⇒ distinct iv AND distinct key ⇒ distinct `(key,iv)`. The encrypt path is structurally incapable of emitting >1 plaintext under one keyMaterial. Fresh key material comes ONLY from `crypto.getRandomValues` (via `fidelius.generateKeyPair`/`nonce`), never `Math.random` (R13). Fail-closed: a low-order/malformed HIU pubkey → `FideliusError` before anything seals.

**Tests (the multi-entry Known-Answer-Test):** seal N=3 distinct plaintexts → **N pairwise-distinct `keyMaterial.dhPublicKey` AND N pairwise-distinct `keyMaterial.nonce`** AND N pairwise-distinct derived ivs (assert by re-deriving each via `fidelius.deriveKeyIv` — no two pages share `(key,iv)`); each page decrypts back to its OWN plaintext via `fidelius.openEntry(secret, hiuNonce, pageNonce, content, checksum)` (round-trip); a **fixed vector** (fixed HIU keyMaterial + fixed injected ephemeral scalars/nonces) reproduces exact known ciphertext + checksum bytes (deterministic KAT — the multi-entry vector `fidelius.test.mjs` was told to expect, now realized on the produce side); the checksum equals `sha256hex(plaintext)` and is verified post-decrypt; a low-order HIU pubkey → `FideliusError`; there is provably no API that reuses a keyMaterial. **Adversarial reviewers must probe: ANY path that seals >1 plaintext under one derived `(key,iv)`; a nonce collision across pages; a CSPRNG bypass / injected-`io` leaking into prod; an iv derived from attacker-controlled input; checksum-vs-ciphertext computed over the wrong bytes; a single shared ephemeral keypair reused across `sealEntries`.**

**⛔ HARD GATE:** the branch does NOT merge until this task's multi-entry KAT proves pairwise-distinct `(key,iv)` across all entries AND the two independent adversarial reviewers sign off. All of Tasks 4/9 depend on this module and MUST NOT be considered done while this gate is open.

---

### Task 4 — HIP transfer: guard → serialize → seal → push (`hip.js`: `serveTransfer`)

**Files:** Create `functions/_connect/abdm/hip.js`; Test `test/connect/abdm/hip-serve.test.mjs`.

**Interfaces:**
- `serveTransfer(env, deps, req) -> { pushed:boolean, pages:number, outcome }` where `deps = { db, secrets, gateway, fetch, audit, now, source, jwks }` and `req = { tenantId, consent, careContexts, hiuKeyMaterial, dataPushUrl, transactionId }`. Steps, all fail-closed and in this order:
  1. `assertServeAllowed(env, deps, { consent, careContexts, records, tenantId })` (Task 5) — refuse on ANY cross-patient / out-of-scope BEFORE any record is read into memory for sealing.
  2. For each allowed careContext: `source.loadRecord(...)` (Task 1) → `serializeNdhm(...)` (Task 2) → `validateNdhmDoc(...)`; a per-record serialize/validate failure → skip that record + `meta.warnings`, continue (contributes to `PARTIAL`).
  3. `sealEntries(hiuKeyMaterial, [ndhmJsonString], io)` (Task 3) → **one transfer page per record** (never batch).
  4. Validate the HIU-supplied `dataPushUrl` (https + host allow-list; no userinfo — anti-SSRF), then POST each page (`deps.fetch`, headers via the gateway seam, `no-store`). `// VERIFY` whether the real transfer routes via the CM gateway `/health-information/transfer` instead of a direct `dataPushUrl` POST (ADR-2H seam).
  5. Audit `hip.served` (metadata only: `consentId`, `transactionId`, `careContextHash`, page count). Any push error → stop + `hip.failed` audit.

**Invariant (ADR-2G/R5/R1):** serves ONLY guard-approved, consent-scoped, StewardMD-held records; **one entry per transfer page** (nonce-safe); never diagnoses/prescribes/alters; the NDHM plaintext is request-scoped (sealed immediately, never persisted/logged); `dataPushUrl` is validated https + host-allow-listed; a non-202 push is fail-closed. The pushed body carries ciphertext + the HIP `keyMaterial`, NEVER plaintext.

**Tests:** an in-scope consent over N care-contexts → N pages, each pushed with a DISTINCT `keyMaterial`, `hip.served` audited; a serialize/validate failure on one record → that page skipped + warning, the rest served (`PARTIAL`); a non-https or off-allow-list `dataPushUrl` → refuse, no push; the pushed body is ciphertext + keyMaterial only (grep the mock capture for the plaintext dx string → absent); flag OFF → no-op; a guard refusal (Task 5) → nothing sealed/pushed, `hip.denied` audited.

---

### Task 5 — Cross-patient over-share guardrail (`hip.js`: `assertServeAllowed`) — **REVIEW: DUAL-ADVERSARIAL**

**Files:** Edit `functions/_connect/abdm/hip.js` (add export + `OverShareError`); Test `test/connect/abdm/hip-guard.test.mjs`.

**Interfaces:**
- `assertServeAllowed(env, deps, { consent, careContexts, records, tenantId }) -> void` (throws `OverShareError`) — enforces R5 in FULL:
  - **(i)** the consent patient's per-tenant `hmacPseudonym(env, tenantId, consent.patientAbha)` **equals `patient_abha_hash` on EVERY served care-context row AND every record's subject** — a single mismatch → refuse (no cross-patient leak);
  - **(ii)** each served `careContextReference` is **explicitly ∈** the FRESHLY-verified artifact's `careContexts` (no wildcard, no registration-implied membership);
  - **(iii)** each record's `hiType` **⊆** `consent.hiTypes`;
  - **(iv)** bind to the **freshly verified** consent artifact — reuse `consent.js#verifyConsentArtifact` + `revalidateForRequest(consent, req, now)` so a since-`REVOKED`/`EXPIRED`/out-of-`dateRange` consent → refuse — NOT the stored registration linkage.
  Any single miss → `OverShareError` (no partial-open), `hip.denied` audited (metadata only). No cross-patient bytes ever reach the Task-3 seal.

**Invariant (R5):** a mismatch between the consent's patient and ANY served resource's subject → hard refuse; care-contexts must be explicitly enumerated in the fresh artifact; hiTypes are a subset check; the bind is to the fresh verified consent, never the registration row. Fail-closed on any unavailable JWKS / verify failure.

**Tests:** consent for patient A + a record whose subject is patient B → `OverShareError`, nothing sealed/pushed; a careContext NOT in the artifact → refuse; a record hiType outside `consent.hiTypes` → refuse; a since-`REVOKED` consent → refuse; the all-match happy path → returns (allows). **Adversarial reviewers must probe: an HMAC-collision / typed-vs-canonical ABHA mismatch (A@sbx vs a@sbx), careContext substring/prefix confusion, an hiType superset sneak, a registration-linkage bypass of the fresh-artifact bind, and the "one bad record poisons none vs must-refuse-the-whole-transfer" decision (Stage 5 refuses the whole transfer on any cross-patient record, never silently drops-and-serves-the-rest).**

---

### Task 6 — Discovery: exact-match, rate-limited, audited (`hip.js`: `handleDiscovery`)

**Files:** Edit `functions/_connect/abdm/hip.js` (add export); Test `test/connect/abdm/hip-discovery.test.mjs`.

**Interfaces:**
- `handleDiscovery(env, deps, { probe, sourceId, now }) -> { matched:boolean, careContexts:[] }` where `deps = { db, kv, audit }` and `probe = { abhaAddress?, demographics? }`. Steps:
  1. **Rate-limit** per `sourceId` via a KV counter (non-PHI key `connect:abdm:disco:<sourceId>`, fixed window TTL) — over-limit → `RateLimited` (no lookup), audited (R5 anti-enumeration).
  2. **Exact-identifier match ONLY** — HMAC the probe ABHA (`hmacPseudonym`) and look up `connect_abdm_carecontext` by `patient_abha_hash` **exact** equality (via `getServableCareContexts`, Task 8). **NEVER fuzzy / demographic-substring**: a demographic-only probe with no exact ABHA identifier → `matched:false`.
  3. **Audit EVERY probe** (`hip.discovery`, metadata only: `sourceId`, matched bool, count — never the raw ABHA/demographics).
  4. Return matching care-contexts on an exact hit, else `{ matched:false, careContexts:[] }` — a **constant-shape** no-match response to blunt the existence oracle. `// VERIFY` the exact discovery response contract + its **synchronous SLA** (R11 — V3 discovery is synchronous; a distinct concern) against the live Postman/Swagger.

**Invariant (R5):** discovery is an existence oracle → exact-identifier match only, never fuzzy; every probe is rate-limited AND audited; no partial-match leakage; the raw ABHA/demographics never touch a log/KV/audit (HMAC only).

**Tests:** an exact ABHA match → `matched:true` + care-contexts, audited; a near/fuzzy demographic probe (no exact identifier) → `matched:false`, audited; over the rate-limit → `RateLimited`, no lookup, audited; the audit event carries only ALLOW-listed keys (no raw ABHA); two different patients never cross-match; a probe for an un-registered patient → `matched:false` (constant shape).

---

### Task 7 — HIP ingress routing + flag gate (`hip-flags.js` + edit `ingress.js` + `[[path]].js`)

**Files:** Create `functions/_connect/abdm/hip-flags.js`; **edit** `functions/_connect/abdm/ingress.js` (HIP-event branches) + `functions/api/connect/[[path]].js` (HIP deps + registration route); Test `test/connect/abdm/hip-ingress.test.mjs`.

**Interfaces:**
- `hipFlagOn(env) -> boolean` = `flagOn(env) && String(env.CONNECT_HIP_FLAG) === "1"` (`// VERIFY` the env var name; HIP requires BOTH the base `smd_connect` flag AND the separate `smd_connect_hip` flag; default OFF).
- **`ingress.js` additions** — after the SAME fail-closed spine (verify-body-signature → replay-defend → correlate), gated on `hipFlagOn(env)` (a HIP event with the flag OFF → `404`, does not leak existence): `ev.type === "discovery"` → `handleDiscovery` (Task 6); `ev.type === "hip-consent-notify"` → store the HIP-side consent (monotonic, reuse `updateConsentStatus`/a HIP consent row, Task 8); `ev.type === "hip-hi-request"` → `serveTransfer` (Task 4) with the HIU `keyMaterial` + `dataPushUrl` + `transactionId` carried on the (signed) event. HIP correlation is by the care-context / consent row, tenant from the row, NEVER the body. The existing HIU-event branches (consent-notify / on-fetch / on-request / data-push) are untouched.
- **`[[path]].js` additions:** wire `deps.source = followcareSource` + the HIP handlers into the `/ingress/abdm` deps; add a server-derived-identity **`POST /hip/care-contexts`** registration route (`hipFlagOn`-gated) → `linkCareContext` (Task 8).

**Invariant:** HIP reuses the Stage-4 ingress spine (sig→replay→correlate) UNCHANGED; the second flag structurally gates every HIP surface; discovery/serve/registration all fail-closed + audited; the HIU consume path is unaffected by `smd_connect_hip`.

**Tests:** a signed `discovery` event with the HIP flag ON → discovery runs; the same event with the HIP flag OFF → `404`; a signed `hip-hi-request` → `serveTransfer` invoked with the ROW's tenant (a body-supplied tenant is ignored); an unknown correlation → `403`, no serve; a bad signature → `401`; a replayed REQUEST-ID → idempotent no-op; the base `smd_connect` OFF → `404` even with `smd_connect_hip` ON; a Stage-4 HIU data-push still works with `smd_connect_hip` OFF (zero regression).

---

### Task 8 — Care-context registration + HIP consent store (`hip.js`: `linkCareContext`, `getServableCareContexts`, `putHipConsent`/`getHipConsent`)

**Files:** Edit `functions/_connect/abdm/hip.js` (add exports); Test `test/connect/abdm/hip-carecontext.test.mjs`.

**Interfaces:**
- `linkCareContext(env, deps, req) -> { id }` — server-derive actor+tenant (`resolveActor`/`resolveTenant`); insert a `connect_abdm_carecontext` row `{ id, tenant_id, patient_abha_hash: await hmacPseudonym(env, tenant.id, abhaAddress), source:"followcare", ref, hi_type, display, linked_at }`. Owner/clinician-initiated, consent-noted, audited (`hip.linked`, metadata only). The **raw ABHA is POST-body only**, HMAC'd before it touches D1; a non-member `tenantId` → `PermissionError` before any write.
- `getServableCareContexts(db, tenantId, patientAbhaHash) -> row[]` — the **exact-match** lookup shared by discovery (Task 6) + serve (Task 4); per-tenant AND per-`patient_abha_hash` scoped (mock-safe `WHERE col=?` only).
- `putHipConsent(db, {...})` / `getHipConsent(db, ...)` — store a HIP-side GRANTED consent (reuse `connect_abdm_consent_req` or a HIP consent row), monotonic status (reuse `updateConsentStatus` semantics).

**Invariant:** care-contexts are per-tenant + `patient_abha_hash` scoped; only records StewardMD holds are registered; the raw ABHA is never persisted (HMAC only); registration is server-identity-gated. Idempotent: a repeat link of the same `(tenant, patient, ref)` does not duplicate.

**Tests:** `linkCareContext` → a row keyed by the HMAC, the raw ABHA absent from EVERY persisted/audited field; a non-member tenant → `PermissionError`, no row; `getServableCareContexts` returns only that tenant+patient's rows (never another tenant's / another patient's); a second identical link is idempotent; `putHipConsent` then a replayed older status → refused (monotonic).

---

### Task 9 — End-to-end HIP serve vs the mock HIU (`hip-flow.test.mjs` + extend `mock-gateway.mjs`)

**Files:** Extend `test/connect/abdm/mock-gateway.mjs` (the mock now plays a **HIU**); Test `test/connect/abdm/hip-flow.test.mjs`. Test-harness only — never shipped.

**Interfaces:**
- The mock HIU: sends a `discovery` probe → receives care-contexts; fires a `hip-consent-notify` (a **JWS-signed** synthetic artifact) + a `hip-hi-request` carrying its OWN `keyMaterial` (a fresh HIU keypair+nonce) + a `dataPushUrl` + a `transactionId` into `handleIngress`; captures the HIP's pushed transfer pages at that `dataPushUrl` and **DECRYPTS** each page with `fidelius.openEntry(secret, hiuNonce, pageKeyMaterial.nonce, content, checksum)` (the mirror roles). Behavior knobs: `crossPatient`, `fuzzyProbe`, `multiRecord`, `flagOff`, `tamper`.
- The test drives `linkCareContext → (discovery) → (hip-consent-notify + verify) → (hip-hi-request) → serveTransfer → (push) → mock-HIU decrypt → normalizeNdhm` and asserts the round-trip NDHM Bundle + the audit trail + one entry per keyMaterial.

**Invariant:** the whole HIP serve path is correct AND nonce-safe under adversarial probes; the invariants of Tasks 3–8 hold **composed**, not just in isolation.

**Tests:** happy path → the mock HIU decrypts every page to the expected NDHM Bundle (Composition-first, unique identifier, author/custodian tagged), re-`normalizeNdhm` matches the source SCCM counts, one entry per keyMaterial, `hip.served` audited; **cross-patient** `hip-hi-request` → `OverShareError`, nothing pushed; **fuzzy discovery** → no match, audited; **multi-record serve** → N pages, N distinct keyMaterials, **N distinct ivs** (assert no `(key,iv)` reuse — the composed nonce-safety proof); **flag OFF** → `404`, no push, HIU path still works; a **tampered** pushed ciphertext → the mock HIU's `openEntry` fails closed (GCM auth).

---

## Self-review

- **Spec coverage.** Stage-5 scope items map 1:1 → FollowCare source→NDHM Bundle (T1 source + T2 serializer, Composition-first / unique identifier / author+custodian / coded-with-text-fallback / no binary, round-trip vs the HIU normalizer), encrypt→push (T3 nonce-safe seal + T4 serve/push), cross-patient over-share guardrail R5 (T5, DUAL-ADVERSARIAL), discovery exact-match+rate-limit+audit (T6). R-items: **R1** per-entry fresh keyMaterial + multi-entry KAT + no-batch contract (T3, HARD GATE) and composed no-`(key,iv)`-reuse proof (T9); **R5** cross-patient guardrail (T5) + existence-oracle discovery (T6); **R11** author/custodian/provenance tag + NRCES-validation `// VERIFY` + discovery synchronous-SLA note (T2/T6); **R12** warn-don't-drop / no-binary on the produce side (T2); **R13** CSPRNG-only key material (T3); **R14** audit ALLOW-list reuse + HMAC'd careContext, raw ABHA POST-body-only (T4/T6/T8); **R16** KV non-PHI (rate-limit + nonce) only (T6/T7). ADR-2G HIP-renders-existing-data-only / never-diagnoses (T1/T4); ADR-2H field/endpoint + transfer-shape seam (T3/T4/T6/T7 `// VERIFY`). Flag `smd_connect_hip` separate + default OFF, HIU unaffected (T7/T9). **DUAL-ADVERSARIAL** on T3 (the HARD GATE) and T5 as required.
- **No placeholders.** Every task lists concrete signatures + the invariant + inline test scenarios. `// VERIFY` marks only genuinely-deferred owner values (the transfer wire-shape, the NRCES validator, the discovery response contract + SLA, the `CONNECT_HIP_FLAG` env-var name, the gateway-vs-dataPushUrl transfer route) — never a logic gap.
- **Type/signature consistency.** `fidelius` used exactly as exported and **untouched**: `generateKeyPair()→{privateKey,publicKeyRaw}`, `sharedSecret(privateKey,Uint8Array(32))→Uint8Array(32)`, `nonce()→Uint8Array(32)`, `deriveKeyIv(secret,ourNonce,theirNonce)→{key,iv}`, `sealBundle(secret,ourNonce,theirNonce,str)→{content,checksum}` (ONE plaintext per call — honored via one `sealForHiu` per entry), `openEntry(...)` for the mock-HIU decrypt. `consent.verifyConsentArtifact`/`revalidateForRequest`, `jws.verifyJws`/`getPinnedJwks`, `state.getConsentReq`/`updateConsentStatus` + the `connect_abdm_carecontext` table, `connectors/abdm/normalize.js#normalizeNdhm` (round-trip target), `audit.buildAuditEvent`/`hmacPseudonym`/ALLOW, `identity.resolveActor`/`resolveTenant`, `canonical/*` factories, `ingress.handleIngress` spine — all consumed as-built. The two controlled edits (`ingress.js`, `[[path]].js`) mirror Stage-4's controlled-edit discipline.

### Owner decisions / spec gaps noticed

1. **⭐ THE transfer-shape reconciliation (`// VERIFY`, nonce-safety-critical).** Stage-4's built `consumeTransfer` reviewed the ABDM `/health-information/transfer` as **one `keyMaterial` per transfer, applied across the page's `entries[]` with a shared iv** — the adversary concluded that matches the real wire shape, and it is SAFE to *consume* (re-deriving one iv to decrypt is fine). But it is a nonce-reuse **catastrophe** to *produce* if we seal >1 distinct plaintext under it. This plan **defaults to the nonce-safe design: one entry per transfer page + a FRESH keyMaterial (fresh ephemeral keypair + nonce) per page** (Task 3 `sealEntries`), which is simultaneously (a) nonce-safe by construction and (b) consume-compatible with `consumeTransfer` (each page's `entries[]` has exactly one real entry). **Owner must confirm against the live ABDM Postman/Swagger** whether the real transfer (i) carries one keyMaterial across a multi-entry `entries[]` page — in which case a well-behaved HIP MUST page one-entry-per-transfer (never batch), and our consume side already tolerates a hostile multi-entry-under-one-keyMaterial push by checksum-verifying each entry — or (ii) carries per-entry keyMaterial. **Either way the plan NEVER seals two plaintexts under one keyMaterial.** Also confirm whether the transfer is POSTed to the HIU-supplied `dataPushUrl` directly (spec §3 step 8) or routed via the CM gateway `/health-information/transfer` (ADR-2H seam, Task 4).
2. **NRCES/FHIR validation is an owner step (R11).** Task 2's `validateNdhmDoc` is a structural shape gate (Composition-first, unique identifier, author+custodian, text-fallbacks, no binary) + a round-trip vs the HIU normalizer — NOT full NRCES IG v6.5.0 profile conformance. **Owner must run the emitted synthetic bundles through the live NRCES/FHIR validator** before real serving (marked `// VERIFY`). The served bundle's `author`/`custodian`/provenance tagging (so a StewardMD decision-support summary is not ingested as a hospital's legal medical record) is asserted structurally now.
3. **Discovery response contract + synchronous SLA (`// VERIFY`, R11).** V3 discovery is synchronous; the exact response shape, the constant-shape no-match to blunt the existence oracle, and the SLA budget are unconfirmed (research WAF-blocked). Task 6 fails closed / exact-match-only until the owner pins the discovery contract; the synchronous SLA is flagged as a distinct concern.
4. **Second flag env-var name + rollout (`// VERIFY`).** `hipFlagOn` reads `env.CONNECT_HIP_FLAG` (default OFF); confirm the real env-var/flag name for `smd_connect_hip`. HIP requires BOTH the base connect flag AND the HIP flag.
5. **`dataPushUrl` SSRF surface.** The HIP POSTs to an HIU-supplied URL. Task 4 validates https + host allow-list + no-userinfo before any push; **owner should confirm the ABDM-registered HIU push-host allow-list** (or that the transfer instead routes via the trusted CM gateway, per gap #1).
6. **Immunization SCCM gap (carried from Stage 4).** The wired source is the FollowCare discharge summary (Condition/MedicationStatement/Observation/DocumentReference — no immunization), so this stage does not hit the missing `Immunization` SCCM key; if a future HIP source needs it, it inherits the Stage-4 owner decision (extend SCCM in a hardening stage vs warn-don't-drop). No new SCCM key is added this stage (keeps the additive surface tight).

## Execution handoff

Create the recovery tag `pre-connect-stage5` off `feat/connect-phase1-stage4-hiu`, then build on a branch `feat/connect-phase1-stage5-hip`. Build order = Task 1 → 9 (each: failing test → code → refactor → commit). Tasks 1 and 2 are pure data primitives with no cross-dependency and may be built in parallel; **Task 3 is the HARD GATE and blocks Tasks 4 and 9** — its multi-entry KAT must prove pairwise-distinct `(key,iv)` AND both independent adversarial reviewers must sign off before the branch can merge. **Task 3 and Task 5 each require a DUAL-ADVERSARIAL review** (two independent reviewers probing the nonce-safety and the cross-patient guardrail, respectively) before they count as done — do not merge those tasks on a single reviewer. Task 9 is the composed integration + round-trip proof and must pass every adversarial-probe scenario (cross-patient, fuzzy discovery, multi-record no-`(key,iv)`-reuse, flag-off, tamper). Stage 6 (hardening: `dataEraseAt`/REVOKE erasure via `state.sweep`, the full no-PHI guard sweep, owner-onboarding docs, real-endpoint pinning) follows.
