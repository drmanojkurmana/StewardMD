# StewardMD Connect — Track A: Hospital EMR Connector (FHIR R4 + SMART-on-FHIR Backend Services) Design

**Date:** 2026-08-01
**Status:** Draft for owner review (no implementation until approved)
**Builds on:** Part-1 v1.1 (`2026-07-31-stewardmd-connect-part1-foundation-design.md`) — Phase 0 MERGED to main (commit 54b1b949), flag `smd_connect` OFF; this Track productionizes the Phase-0 `pull` skeleton (`functions/_connect/connectors/fhir-r4/{connector,normalize}.js`).
**Sibling of:** Part-2 / Phase 1 ABDM (`2026-07-31-stewardmd-connect-part2-abdm-design.md`) — the `event`/push twin. Track A is the synchronous `pull` twin: a real hospital EMR over FHIR R4 + SMART-on-FHIR.
**Author:** Claude (acting Principal / Interoperability Architect)
**Flag:** `smd_connect_fhir` (default **OFF**, separate from `smd_connect`; a FHIR surface with either flag OFF is a `404`, no existence leak).

---

## 0. What Track A is (and what it realizes)

Part 1 built the canonical model, the injected `pull` connector contract (`interfaces.js` `PULL_METHODS = capabilities, authenticate, validate, fetchPatient, normalize`), the ephemeral fail-closed engine (`engine.js#loadPatientContext`), and a **Phase-0 FHIR skeleton** whose `authenticate` was a stub (`{ ok:true }`) and whose token, if any, came from a static `secrets("bearer")`. Track A makes that skeleton a **production pull connector to a real hospital FHIR R4 server**:

- **Authenticate for real** via **SMART-on-FHIR Backend Services** (OAuth 2.0 `client_credentials` with an asymmetric **`private_key_jwt`** client assertion) — no user, no browser, server-to-server: discover the token endpoint, sign a short-lived client-assertion JWT with the tenant's envelope-encrypted private key, exchange it for a scoped access token, cache it (non-PHI) with skew.
- **Fetch** the patient's clinical resources — `Patient`, `Condition`, `MedicationRequest`/`MedicationStatement`, `Observation` (labs **and** vitals), `AllergyIntolerance`, `DiagnosticReport`, `DocumentReference` — bounded by the edge budget and **paginated** by following `Bundle.link[next]` (same-origin only).
- **Normalize** vendor FHIR R4 → **SCCM** through the existing anti-corruption map (`connectors/fhir-r4/normalize.js`), enriched so MaiK consumes normalized clinical data and **never** the vendor FHIR schema.

Everything runs against a **mock FHIR server + a synthetic SMART token endpoint** first — no real credentials, no real endpoints. Every real endpoint / JWKS / client-registration value is marked `// VERIFY`.

The spine is unchanged from Part 1:

```
Hospital FHIR R4 server → [SMART-on-FHIR auth] → fhir-r4 pull connector → normalize → SCCM validator
                        → permission/scope filter → PHI-free audit → MaiK context (ephemeral)
```

### Locked decisions inherited from Part 1 (unchanged here)

| Decision | Choice | ADR |
|---|---|---|
| PHI handling | **Ephemeral pass-through — no clinical-PHI content at rest** (request memory only) | ADR-002 |
| Deployment target | **Cloudflare-native** (Pages Functions; injected `ctx`) | ADR-001 |
| Auth secrets | **Envelope-encrypted per tenant** (`secrets.js`, AES-GCM, master key in Workers secrets, fail-closed) | ADR-010/C10 |
| Identity | **Server-derived** (`identify()` → `resolveActor`/`resolveTenant`); never from the request body | ADR-010/C3 |

---

## 1. Scope

**In scope (Track A):**
1. **SMART-on-FHIR Backend Services auth** — new `functions/_connect/smart/*`: discovery (`.well-known/smart-configuration` + CapabilityStatement `oauth-uris` fallback) with a **token-endpoint trust gate**, an **asymmetric-only client-assertion JWT signer** (the signing mirror of `abdm/jws.js`'s asymmetric-only verifier), and **token acquisition + envelope-cached access token**.
2. **Productionized `fhir-r4` pull connector** — `authenticate` runs the SMART flow; `validate` is a real self-test (< 30 s); `capabilities` reads the server's CapabilityStatement/`smart-configuration` (graceful stub fallback, C14); `fetchPatient` fetches the 7 resource families, **bounded + paginated**.
3. **Enriched FHIR R4 → SCCM normalizer** — labs vs vitals category, medication dosage/origin (`order`|`statement`), observation reference-range/interpretation, diagnostic-report result references (resolve-in-bundle-or-null), document narrative; warn-don't-drop on partial/unknown.
4. **Mock-first tests** — an **adversarial** mock FHIR server + a **synthetic SMART token endpoint** (poisoned discovery, replayed/expired token, over-broad scope, paginated + dangling-ref bundles, tampered token), synthetic keys/fixtures, and a no-PHI / no-secret backstop.
5. **Wiring** — `smd_connect_fhir` flag gate; sandbox-only host allow-list extended for the SMART sandbox; the connector registered with SMART-wired deps.

**NOT in scope (deferred):** SMART **App Launch** (browser / user-facing `authorization_code` + `launch` context) — Backend Services only here; **Bulk Data ($export/NDJSON)** — the deferred queued path (Part-1 §6 step 5); symmetric `client_secret_basic` client auth (SMART Backend Services mandates asymmetric — noted as a `// VERIFY` fallback only); `mode:live` (still refused until the consent/BAA gate of a later phase — Track A is **sandbox-only**, C6); write-back (`create`/`update`) — read-only, like Phase 0; terminology translation (codes passed through with the required `text` fallback, C5).

---

## 2. SMART-on-FHIR Backend Services — the flow + the security boundary

SMART Backend Services (server-to-server, no user) is a 4-hop dance. **The whole security surface is that we mint a bearer-grade signed credential (the client assertion) and must send it to — and only to — the genuine authorization server.**

```
0. Register (owner, out-of-band, // VERIFY): the tenant's PUBLIC key (JWKS or jwks_url) is registered
   with the hospital's FHIR authorization server; the client_id is issued. StewardMD holds the PRIVATE
   key JWK (envelope-encrypted per tenant, secrets.js).

1. Discover        GET {fhirBase}/.well-known/smart-configuration
   → { token_endpoint, token_endpoint_auth_methods_supported:["private_key_jwt"],
       token_endpoint_auth_signing_alg_values_supported:["RS384","ES384"], scopes_supported, ... }
   Fallback: CapabilityStatement.rest[].security.extension "…/oauth-uris" → token/authorize URIs.
   ⛔ GATE: the discovered token_endpoint MUST be https + host ∈ SMART_HOST_ALLOWLIST + no userinfo,
     validated BEFORE it is used — a poisoned smart-configuration must NOT be able to redirect our
     signed assertion to an attacker host (credential exfil / SSRF).

2. Sign assertion  a compact JWS (the client-authentication JWT), signed with the tenant private key:
   header { alg:"RS384"|"ES384", kid, typ:"JWT" }
   claims { iss:client_id, sub:client_id, aud:<the EXACT token_endpoint from step 1>,
            exp:now+≤300s, iat:now, nbf:now, jti:<fresh unique> }
   ⛔ aud MUST equal the token endpoint we POST to (anti-forwarding). alg is asymmetric-ONLY.

3. Exchange        POST {token_endpoint}  (application/x-www-form-urlencoded)
     grant_type=client_credentials
     scope=system/Patient.rs system/Condition.rs … (SMART v2 .rs = read+search; // VERIFY v1 .read)
     client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
     client_assertion=<the JWS from step 2>
   → { access_token, token_type:"bearer", expires_in, scope }
   grantedScopes = response.scope (may be NARROWER than requested — never widen).

4. Access          GET {fhirBase}/Patient/{ref}      Authorization: Bearer <access_token>
                   GET {fhirBase}/{Type}?patient={ref}&_count=…   (paginate Bundle.link[next])
   On 401 → the token is stale/revoked → re-authenticate ONCE (step 1–3), retry once, else fail-closed.
```

The connector orchestrates; the `smart/*` modules own steps 1–3; the engine's ephemeral, fail-closed pipeline owns everything after step 4 (normalize → validate → filter → audit → discard), unchanged.

---

## 3. Module architecture

New `smart/*` is a **shared auth mechanism** (sibling of `abdm/*`), consumed by the connector — parallel to how `abdm/*` owns the ABDM machinery. The `fhir-r4` connector is the orchestrator; the engine is the composition root.

```
functions/_connect/
  smart/                                   # NEW — SMART-on-FHIR Backend Services auth (shared mechanism)
    flags.js        # fhirFlagOn(env): requires BOTH smd_connect AND smd_connect_fhir; default OFF
    discovery.js    # discoverSmart(): smart-configuration + CapabilityStatement fallback + token-endpoint trust gate
    assertion.js    # signClientAssertion(): asymmetric-ONLY private_key_jwt signer (DUAL-ADVERSARIAL)
    token.js        # acquireAccessToken(): discover→sign→exchange→narrow-scope→envelope-cache (DUAL-ADVERSARIAL)
  connectors/fhir-r4/
    connector.js    # (productionize) authenticate=SMART flow; real validate; capabilities; bounded fetchPatient
    normalize.js    # (enrich) FHIR R4 → SCCM: labs+vitals, med dosage/origin, report result refs, docs, warnings
    paginate.js     # NEW — searchPaged(): follow Bundle.link[next] (same-origin only) under the edge budget
  engine.js         # (controlled edit) inject ctx.kv + generalized ctx.secrets(name) + ctx.envelope{seal,open}
  tenant.js         # (controlled edit) SANDBOX_ALLOWLIST += the SMART sandbox FHIR/token/auth hosts (// VERIFY)
functions/api/connect/[[path]].js  # (controlled edit) fhirFlagOn gate + register the SMART-wired fhir-r4 deps
test/connect/
  smart/mock-fhir-server.mjs        # NEW — adversarial mock FHIR server + synthetic SMART token endpoint (harness only)
  smart/fixtures/smart-keys.mjs     # NEW — synthetic RS384/ES384 keypairs + JWKS (never real)
  smart/discovery.test.mjs  smart/assertion.test.mjs  smart/token.test.mjs
  fhir-r4-paginate.test.mjs  fhir-r4-connector-smart.test.mjs  fhir-r4-smart-flow.test.mjs
  fixtures/fhir-synthetic.mjs       # (extend) add MedicationRequest, vitals, DiagnosticReport results, DocumentReference, paged
```

### 3.1 Controlled edits to the Phase-0 engine (the composition-root surface)

The connector must not hold the master key or the raw KV binding. The engine (the composition root that owns `env`) injects a **minimal, connector-safe** surface into `ctx` — the ONLY edit to `engine.js`:

| ctx addition | Purpose | Safety |
|---|---|---|
| `ctx.kv` | the dedicated `connect:*` KV namespace | NON-PHI only (discovery + token cache); tenant-scoped keys |
| `ctx.secrets(name)` **generalized** | `name==="smart"` → envelope-decrypt `config.secret_ref` → `{ clientId, kid, alg, privateKeyJwk }`; `name==="bearer"` unchanged (back-compat) | private key only in request memory; never logged |
| `ctx.envelope = { seal, open }` | envelope-encrypt/decrypt the **cached access token** to KV | connector never sees the master key; cache is ciphertext |

`ctx.now`, `ctx.fetch`, `ctx.config`, `ctx.tenant`, `ctx.budget`, `ctx.logger`, `ctx.scope` already exist and are reused as-is. No change to the `interfaces.js` `PULL_METHODS` contract or the `makeCtx` test harness beyond the three additive fields.

---

## 4. Security invariants (Track A)

These extend the Part-1 invariants (§7 of the foundation). The two SMART crypto/acquisition tasks are **DUAL-ADVERSARIAL**.

- **S1 — Token-endpoint trust gate (anti-exfil / anti-SSRF).** The token endpoint is taken from discovery, which is attacker-influenceable. It MUST be `https`, host ∈ `SMART_HOST_ALLOWLIST`, no `userinfo`, validated **before** the signed assertion is POSTed. A `smart-configuration` pointing `token_endpoint` at an off-allow-list host → refuse, no signing, no POST. The host allow-list is `// VERIFY` (the real hospital auth-server host(s)); sandbox hosts are pinned.
- **S2 — `aud` binding.** The client-assertion `aud` claim MUST equal the exact validated token endpoint we POST to. Sign-with-one-`aud`-send-to-another is structurally impossible: `acquireAccessToken` derives both from one validated URL.
- **S3 — Asymmetric-only signing (no confusion, no `alg:none`).** `signClientAssertion` accepts `alg ∈ { RS384, ES384 }` ONLY (a frozen table like `jws.js#ALG`); there is no symmetric/`none` path, so an HMAC-confusion or `alg:none` downgrade is structurally impossible. SMART Backend Services mandates RS384/ES384 (`// VERIFY` if a target server needs RS256/ES256 — additive to the frozen table, still asymmetric-only).
- **S4 — Short-lived, replay-resistant assertion.** `exp ≤ now + 300s`; `iat`/`nbf` set; `jti` is a **fresh** `crypto.randomUUID()` per call (the AS tracks jti for replay; we never reuse one). Clock is injected (`ctx.now`), never `Date.now()`/global.
- **S5 — Secrets never leak.** The private key JWK is envelope-decrypted into a request-scoped variable, used to `importKey`, never logged, never returned, never persisted, never in an error message. The signed assertion and the access token are **bearer-grade** and are equally never logged / never in a URL / never in audit.
- **S6 — Access token cache is NON-PHI, envelope-encrypted, tenant-scoped.** Cached under `connect:smart:tok:{tenantId}:{connectorId}` in KV as `ctx.envelope.seal(token)` ciphertext with an `expires_in − skew` TTL (min-TTL guarded like `gateway.js`). No global/module-level token cache (Workers isolates are reused → would leak across tenants). On 401, evict + re-auth once.
- **S7 — Scope never widens.** Requested SMART scopes are derived from the engine-granted `ctx.scope` (SCCM types → `system/{Resource}.rs`); the granted access-token scope is intersected with the request; the engine's post-normalize permission filter (Part-1 §6 step 8) still drops any out-of-scope resource (defense in depth even if the server over-returns).
- **S8 — PHI discipline (unchanged, restated for the FHIR wire).** `patientRef` is PHI-in-transit: it necessarily appears in the **upstream** FHIR search URL over TLS (the FHIR API contract) — but it MUST NEVER appear in **our** logs, KV, audit, or error bodies (audit carries only `patientRefHash` = per-tenant HMAC, C9). No `console.*` in the shipped path; a top-level catch sanitizes to a typed error code. Next-page URLs from `Bundle.link` are validated **same-origin** as `base_url` before fetch (an upstream cannot redirect our authenticated, PHI-bearing request to an exfil host).
- **S9 — Fail-closed everywhere.** Any discovery / sign / exchange / parse / cache / fetch / paginate error → refuse + PHI-free audit `outcome:"error"|"denied"`; never partial-open, never a silent unauthenticated fetch. Missing master key / missing `secret_ref` → `SecretsUnavailable` (fail-closed, inherited from `secrets.js`). Sandbox-only gate (`tenant.js#assertSandboxAllowed`) still refuses any non-allow-listed `base_url` and refuses `mode:live` (Track A is sandbox-only).
- **S10 — Bounded edge.** Per-upstream timeout; page cap (`budget.maxPagesPerResource`); subrequest budget (`budget.maxSubrequests`) across all resource families + pagination + the token round-trip; wall-time deadline (`budget.deadlineMs`). A history-heavy patient does not blow the edge budget — it degrades to a partial bundle + `meta.warnings`, never a crash.

---

## 5. Data mapping: FHIR R4 → SCCM (the anti-corruption map, enriched)

The Phase-0 `normalize.js` already maps the core shapes; Track A enriches it and adds the missing families. Every coded field carries the required `text` fallback (C5); every `Coding` is tagged `standard|local` against the `STD` terminology set; every intra-bundle `Reference` resolves-in-bundle-or-is-nulled (validator, C5); ids are the stable source `resourceType/id`.

| FHIR R4 resource | SCCM target | Track-A enrichment |
|---|---|---|
| `Patient` | `patient` | unchanged (id, gender, birthDate, name) |
| `Condition` | `conditions[]` | `clinicalStatus`, `category` (problem-list vs encounter-dx), `recordedDate`, `encounter` Reference (resolve-or-null) |
| `MedicationRequest` | `medications[]` `origin:"order"` | `dosageInstruction[0].text` → `dosage.text`; status |
| `MedicationStatement` | `medications[]` `origin:"statement"` | `dosage[0].text`; status |
| `Observation` (**laboratory**) | `observations[]` `category:"laboratory"` | `valueQuantity`→`Quantity` / `valueString`/`valueCodeableConcept`; `referenceRange`; `interpretation`; `effectiveDateTime` |
| `Observation` (**vital-signs**) | `observations[]` `category:"vital-signs"` | **category correctly derived** from the standard `observation-category` code (NOT defaulted to `laboratory`) so `maik-context.js` buckets vitals right; BP components noted as future (`// VERIFY`) |
| `AllergyIntolerance` | `allergies[]` | `criticality`, `clinicalStatus`, reactions (best-effort) |
| `DiagnosticReport` | `diagnosticReports[]` | `conclusion` narrative; `result[]` → `results:[Reference]` (resolve-in-bundle-or-null) |
| `DocumentReference` | `documents[]` | `type`, `status`, `date`, narrative `description`/text — **by-reference / narrative ONLY, NO binary/attachment bytes** (C4) |
| `Encounter` (already supported) | `encounters[]` | fetched only if in scope; referenced by Condition/Document |

Category derivation is the one clinically load-bearing enrichment (mis-bucketing vitals as labs silently corrupts the MaiK context). Partial/unknown/malformed → a valid bundle + a `meta.warnings` entry, never a throw (conformance-suite invariant, §5 of Part 1).

---

## 6. Config, D1, secrets

No new D1 tables — Track A reuses `connect_connector_config` (Part-1 §7). The SMART-specific fields live in its existing columns:

| Column | Track-A use |
|---|---|
| `base_url` | the FHIR **base** (`{fhirBase}`) — `https`, no userinfo, sandbox-allow-listed |
| `config` (JSON, NON-SECRET) | `{ smart:{ clientId, kid, alg:"RS384"|"ES384", tokenEndpointHint?, requestedScopes?, authHostAllowlist? } }` — clientId is a public identifier, safe here; the private key is NOT |
| `secret_ref` | name of the envelope-encrypted secret holding `{ clientId, kid, alg, privateKeyJwk }` (the private key **never** in `config` / D1 / git / logs) |
| `scope` | granted SCCM resource types (intersected per request) |

**Secrets (reuse `secrets.js`, C10):** the tenant's SMART **private key JWK** is sealed (AES-GCM, master key `CONNECT_MASTER_KEY` in Workers secrets) and stored under `secret_ref`; `makeSecrets(env).open(...)` decrypts it in request memory; **fail-closed** if the master key is missing. The cached access token is likewise envelope-sealed before it touches KV (S6). No secret ever lands in `config`/D1/URL/log.

**Audit:** reuses the existing PHI-free allow-list (`audit.js#ALLOW`) unchanged — `outcome` carries the auth result, `scope` carries the granted scopes, `patientRefHash` the per-tenant HMAC. **No `audit.js` edit** (no new non-PHI id is needed; the SMART flow adds no PHI-bearing correlation id worth auditing beyond the existing keys).

---

## 7. Mock-first test strategy

Everything is built against a harness — **no real credentials, no real endpoints** — and every real value is `// VERIFY`.

- **Adversarial mock FHIR server + synthetic SMART token endpoint** (`test/connect/smart/mock-fhir-server.mjs`, harness only, never shipped): an injectable `fetch` that serves `.well-known/smart-configuration`, the token endpoint (verifies the client assertion: `aud` == its own URL, `exp` sane, `alg` asymmetric, signature against the synthetic client JWKS; issues a scoped token), and the FHIR resource reads/searches with real pagination. **Adversarial knobs (probe, don't confirm):** `poisonDiscovery` (token_endpoint → an evil host), `narrowScope`, `expireToken` (short `expires_in` → refresh path), `revokeThenReissue` (first fetch 401 → re-auth once), `bigPage`/`extraPages` (budget), `danglingRef` (DiagnosticReport.result → an out-of-scope Observation → resolve-or-null), `tamperToken`, `replayJti`, `algNone`.
- **Synthetic keys** (`smart/fixtures/smart-keys.mjs`): hand-authored RS384 + ES384 keypairs + the matching JWKS — never real, never captured.
- **Synthetic FHIR fixtures**: extend `fixtures/fhir-synthetic.mjs` with a `MedicationRequest`, a **vital-signs** Observation, a `DiagnosticReport` + result Observations, a `DocumentReference` (narrative), and a paged search Bundle.
- **no-PHI / no-secret backstop**: reuse `test/connect/no-phi.test.mjs`'s posture — assert no fixture PHI, **no private key, no client assertion, no access token** appears in any audit event, log line, or error body.
- **Runner:** `node --test`; performance still targeted at Part-1 §10 (normalize < 50 ms CPU; end-to-end < 500 ms network-permitting; validation self-test < 30 s; max-size bench).

---

## 8. Global Constraints (verbatim — carried into the plan)

- **Buildless Cloudflare; plain ES modules; `node --test`; NO new deps.**
- **Additive-only.** New files under `functions/_connect/smart/*`, `functions/_connect/connectors/fhir-r4/*` (new `paginate.js`), and `test/connect/*`. The ONLY edits to existing runtime files are the spec-mandated controlled edits: (a) productionize the two Phase-0 files `connectors/fhir-r4/{connector,normalize}.js`; (b) `engine.js` — inject `ctx.kv` + generalize `ctx.secrets(name)` + add `ctx.envelope{seal,open}` (§3.1); (c) `tenant.js` — extend `SANDBOX_ALLOWLIST` with the SMART sandbox host(s); (d) `functions/api/connect/[[path]].js` — `fhirFlagOn` gate + register the SMART-wired `fhir-r4` deps. Touch nothing else (`interfaces.js`/`audit.js`/`identity.js`/`permission.js`/`secrets.js`/`canonical/*` stay as-built).
- **Flag `smd_connect_fhir` default OFF**, separate from `smd_connect`. `fhirFlagOn(env)` requires BOTH; a FHIR surface with either flag OFF returns `404` (no existence leak). Zero regression: all Phase-0/ABDM tests stay green.
- **Mock-FHIR-server-first — no real creds.** An **adversarial** mock FHIR server + a **synthetic** SMART token endpoint. Every real endpoint / JWKS host / client-registration / scope-syntax value is `// VERIFY`.
- **Server-derived identity** (`identify()` → `resolveActor`/`resolveTenant`); tenant/actor never from the request body.
- **Ephemeral pass-through PHI.** The `CanonicalBundle` and `patientRef` live only in request memory; never persisted, never logged, never in KV.
- **Envelope-encrypted per-tenant SMART client secrets** (reuse `secrets.js`): the private key JWK is sealed under `secret_ref`; fail-closed on a missing master key; the private key only in request memory.
- **No PHI in URLs / logs / KV.** (The upstream FHIR request URL necessarily carries `patientRef` over TLS — that is the FHIR contract; the constraint governs OUR logs/KV/audit, which carry only the per-tenant HMAC.) The access token / client assertion / private key are never in a URL / log / KV / audit.
- **Fail-closed.** Any auth / fetch / normalize / validate error → refuse + PHI-free audit; never partial-open; sandbox-only (no `mode:live`).
- **SMART token acquisition (signed JWT client assertion → access token) is security-critical → DUAL-ADVERSARIAL** (the assertion signer AND the token-acquisition/exchange task — the two halves of "signed JWT client assertion → access token").

---

## 9. `// VERIFY` gaps / owner decisions

1. **⭐ Token-endpoint / auth-server host allow-list (`SMART_HOST_ALLOWLIST`) — the anti-exfil boundary.** The token endpoint comes from discovery. The owner must pin the **real hospital FHIR base host(s) AND their authorization-server host(s)** (often a distinct host, e.g. a hospital's Keycloak/Okta/Auth0 vs its FHIR gateway). Until pinned, only the SMART sandbox hosts are allow-listed and everything else fails closed. `// VERIFY`.
2. **Client registration is an out-of-band owner step (`// VERIFY`).** The tenant's **public** key (JWKS/`jwks_url`) must be registered with the hospital AS and a `client_id` issued; the matching **private** key JWK is envelope-sealed into `secret_ref`. StewardMD cannot self-issue these.
3. **Signing alg (`// VERIFY`).** SMART Backend Services mandates **RS384/ES384**; some servers accept RS256/ES256. The signer's frozen alg table pins RS384/ES384; the owner confirms per target server (any addition stays asymmetric-only — never HMAC/`none`).
4. **Scope syntax (`// VERIFY`).** SMART v2 system scopes = `system/{Resource}.rs` (read+search); v1 = `system/{Resource}.read`. `scopes_supported` from discovery disambiguates; the owner confirms the target server's SMART version. `.rs` is the default.
5. **Discovery contract (`// VERIFY`).** `.well-known/smart-configuration` is preferred; the CapabilityStatement `oauth-uris` extension is the fallback. Confirm the target server exposes one; confirm `token_endpoint` and the auth-method (`private_key_jwt`).
6. **Flag env-var name (`// VERIFY`).** `fhirFlagOn` reads `env.CONNECT_FHIR_FLAG` (default OFF); confirm the real env-var / Flagship name for `smd_connect_fhir`.
7. **`mode:live` stays refused (carried).** Track A is sandbox-only. Enabling a real hospital pull needs the consent/DPA gate and the MaiK-egress control (C6/C7) — a later phase; the sandbox-only gate is the technical enforcement now.
8. **Bulk Data ($export) deferred.** History-heavy / population loads route to the deferred queued path (Part-1 §6 step 5), not a single synchronous request — not built here.

---

## 10. ADRs (Track-A additions)

- **ADR-A1 — SMART Backend Services (`private_key_jwt`), asymmetric-only.** Server-to-server; no user; no browser. Private-key JWT client auth, RS384/ES384 only — no symmetric secret, no `alg:none` (mirrors `jws.js`'s asymmetric-only verifier on the signing side). *Rejected:* `client_secret_basic` (SMART Backend Services forbids it; a shared symmetric secret is a weaker credential at the edge); SMART App Launch (needs a browser/user — not a backend pull).
- **ADR-A2 — Token-endpoint trust gate from discovery.** Discovery is attacker-influenceable → the token endpoint is `https` + host-allow-listed + `aud`-bound before the assertion is signed or sent. *Rejected:* trusting the discovered `token_endpoint` verbatim (credential-exfil via a poisoned `smart-configuration`).
- **ADR-A3 — SMART is a shared mechanism (`smart/*`), the connector orchestrates.** Parallel to `abdm/*`; a future SMART App Launch or a second FHIR connector reuses `smart/*`. *Rejected:* burying the OAuth flow inside `fhir-r4/connector.js` (not reusable; harder to adversarially review the crypto in isolation).
- **ADR-A4 — Minimal connector-safe engine surface (`ctx.kv`/generalized `ctx.secrets`/`ctx.envelope`).** The composition root injects exactly enough for the connector to auth + cache without ever holding the master key or raw bindings. *Rejected:* passing `env`/the full secrets object into the connector (breaks the injected-`ctx` purity + widens the PHI/secret surface).
- **ADR-A5 — Non-PHI, envelope-encrypted, tenant-scoped token cache; no global cache.** `connect:smart:tok:{tenant}:{connector}`, sealed, TTL with skew. *Rejected:* a module-level token cache (leaks across tenants in a reused isolate); an unencrypted KV token (bearer credential at rest).
- **ADR-A6 — Same-origin pagination.** `Bundle.link[next]` is followed only if same-origin as `base_url`, under the page/subrequest/wall-time budget. *Rejected:* following arbitrary `next` URLs (SSRF / PHI-bearing-request redirection; unbounded fan-out).

---

## 11. Acceptance criteria

1. `smart/assertion.js` signs a valid RS384 **and** ES384 `private_key_jwt` the mock token endpoint accepts; `alg:none`/HMAC/symmetric are structurally impossible; `aud`==endpoint, `exp`≤300 s, fresh `jti` — proven, and the private key never appears in any output. **(DUAL-ADVERSARIAL)**
2. `smart/token.js` completes discover→sign→exchange→narrow-scope→envelope-cache against the mock; a **poisoned discovery** (off-allow-list `token_endpoint`) is refused with **nothing signed or sent**; a 401 triggers exactly one re-auth+retry; the token is cached encrypted (non-PHI) with skew and re-used within TTL. **(DUAL-ADVERSARIAL)**
3. The productionized `fhir-r4` connector passes the shared conformance suite (`connector-contract.test.mjs`) SMART-wired against the mock; `validate` self-test < 30 s; `capabilities` degrades gracefully.
4. `fetchPatient` fetches all 7 resource families, paginates `Bundle.link[next]` **same-origin only**, and stays within the edge budget on a max-size bench (partial + `meta.warnings`, never a crash).
5. The enriched normalizer maps labs vs **vitals** correctly, medication `order`/`statement` origin + dosage, DiagnosticReport result references (resolve-or-null), and DocumentReference narrative (no binary); output passes `validateBundle`.
6. `no-phi.test.mjs` green: no PHI, **no private key, no client assertion, no access token** in any audit event, log, or error body; nothing persisted; no cross-request global cache leak.
7. All new code behind `smd_connect_fhir` (OFF); `smart` requires BOTH flags; `node --test` green; **zero regression** (Phase-0 + ABDM suites pass).
8. platform + security (appsec/redteam/secret-scan) + dpdp/hipaa reviewers pass on the implementation; the two DUAL-ADVERSARIAL tasks each cleared by two independent adversarial reviewers.
```
