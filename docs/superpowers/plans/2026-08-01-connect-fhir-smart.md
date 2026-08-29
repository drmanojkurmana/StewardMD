# StewardMD Connect — Track A: Hospital EMR Connector (FHIR R4 + SMART-on-FHIR Backend Services) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **TDD is mandatory** (superpowers:test-driven-development): write the failing test first, watch it fail, then the minimum code to pass, then refactor. **Two tasks are marked REVIEW: DUAL-ADVERSARIAL** — Task 3 (the `private_key_jwt` client-assertion signer) and Task 4 (SMART token acquisition/exchange) — the two halves of "signed JWT client assertion → access token." Each must be cleared by **two independent adversarial reviewers** before it counts as done, and both block Tasks 6 and 9.

**Goal:** Productionize the Phase-0 FHIR skeleton into a real **pull connector to a hospital FHIR R4 server**: authenticate via **SMART-on-FHIR Backend Services** (OAuth 2.0 `client_credentials` with an asymmetric `private_key_jwt` client assertion), fetch the patient's clinical resources (`Patient`, `Condition`, `MedicationRequest`/`MedicationStatement`, `Observation` [labs+vitals], `AllergyIntolerance`, `DiagnosticReport`, `DocumentReference`) bounded + paginated, and normalize FHIR R4 → **SCCM** so MaiK consumes normalized data and never the vendor schema. Everything runs offline against an **adversarial mock FHIR server + a synthetic SMART token endpoint** — no real creds, no real endpoints. Flag **`smd_connect_fhir`** is separate from `smd_connect` and default OFF.

**Architecture:** Track A is the synchronous `pull` twin of the ABDM `event`/push work. It **reuses the Part-1 foundation as-built** — the engine pipeline (`engine.js#loadPatientContext`: resolve identity → sandbox gate → auth → fail-closed scope → fetch → normalize → validate → filter → PHI-free audit → discard), the SCCM factories/validator (`canonical/*`), the injected `pull` contract + conformance harness (`interfaces.js`), envelope secrets (`secrets.js`), the PHI-free audit allow-list (`audit.js`), and the sandbox-only gate (`tenant.js`). It **adds** a shared SMART auth mechanism (`functions/_connect/smart/*`, sibling of `abdm/*`) that the connector orchestrates, and enriches the two Phase-0 FHIR files. The connector never holds the master key or a raw binding: the engine (composition root) injects a minimal connector-safe surface (`ctx.kv` + generalized `ctx.secrets(name)` + `ctx.envelope{seal,open}`). PHI is pass-through: the bundle + `patientRef` live only in request memory; audit carries only the per-tenant HMAC. The mock is **adversarial** — it poisons discovery, expires/revokes tokens, over-narrows scope, pages, dangles references, and tampers — to stress the invariants, not confirm them.

**Tech Stack:** Plain ES modules, D1, KV, WebCrypto (`crypto.subtle` importKey/sign; `crypto.randomUUID`), `node:test`. No new dependencies. Consumes: `interfaces.js` (`makeCtx`/`runConformance`/`assertConnector`, `PULL_METHODS`), `canonical/model.js`+`coding.js`+`validate.js` (`bundle`/`patient`/`condition`/`medicationStatement`/`observation`/`diagnosticReport`/`documentReference`/`allergyIntolerance`/`encounter`, `coding`/`codeable`/`quantity`, `validateBundle`), `secrets.js` (`makeSecrets`→`{seal,open,get}`, `SecretsUnavailable`), `audit.js` (`ALLOW`/`buildAuditEvent`/`hmacPseudonym`), `tenant.js` (`SANDBOX_ALLOWLIST`/`assertSandboxAllowed`), `permission.js` (`UpstreamError`/`PermissionError`/`enforceScope`), `testkit.js` (`flagOn`/`jsonResponse`/`makeMockKv`). The signing discipline **mirrors** `abdm/jws.js`'s asymmetric-only, frozen-alg-table pattern (this is the sign side of that verify primitive).

## Global Constraints

- **Buildless Cloudflare stack; plain ES modules; `node --test`; NO new deps.**
- **Additive-only.** New files under `functions/_connect/smart/*`, `functions/_connect/connectors/fhir-r4/*` (new `paginate.js`), and `test/connect/*`. The ONLY edits to existing runtime files are the spec-mandated controlled edits: (a) productionize the two Phase-0 files `connectors/fhir-r4/{connector,normalize}.js`; (b) `engine.js` — inject `ctx.kv` + generalize `ctx.secrets(name)` + add `ctx.envelope{seal,open}` (Task 8); (c) `tenant.js` — extend `SANDBOX_ALLOWLIST` (Task 8); (d) `functions/api/connect/[[path]].js` — `fhirFlagOn` gate + register the SMART-wired `fhir-r4` deps (Task 8). Do NOT touch `interfaces.js`/`audit.js`/`identity.js`/`permission.js`/`secrets.js`/`canonical/*`/`abdm/*`.
- **Flag `smd_connect_fhir` default OFF, separate from `smd_connect`.** `fhirFlagOn(env)` requires BOTH; a FHIR surface with either flag OFF returns `404` (does not leak existence). Zero regression: all Phase-0/ABDM tests stay green; the ABDM + `/context` paths are unaffected.
- **Mock-FHIR-server-first — no real creds.** An **adversarial** mock FHIR server + a **synthetic** SMART token endpoint; synthetic keypairs/fixtures only. Mark every real endpoint / JWKS host / client-registration / scope-syntax / flag-env value with `// VERIFY`.
- **Server-derived identity — never the request body.** `/context` derives actor+tenant via `identify()`→`resolveActor`/`resolveTenant` (unchanged); the connector receives only the derived `ctx`.
- **Envelope-encrypted per-tenant SMART client secrets (reuse `secrets.js`).** The private key JWK is sealed under `config.secret_ref`; decrypted only into a request-scoped variable; **fail-closed** on a missing master key; never logged/returned/persisted. The cached access token is envelope-sealed before it touches KV.
- **Ephemeral pass-through PHI.** The `CanonicalBundle` + `patientRef` live only in request memory. **No PHI in OUR URLs/logs/KV/audit** (audit carries only `patientRefHash`). The upstream FHIR request URL necessarily carries `patientRef` over TLS — that is the FHIR contract, not a leak; it must never reach a log/KV/audit.
- **No secret/token in URLs/logs/KV/audit.** The private key, the signed client assertion, and the access token are bearer-grade — never in a URL/log/KV(plaintext)/audit/error body. No `console.*` in the shipped path; a top-level catch sanitizes to a typed error code.
- **Fail-closed everywhere.** Any discovery/sign/exchange/parse/cache/fetch/paginate/normalize/validate error → refuse + PHI-free audit; never partial-open; never a silent unauthenticated fetch. Sandbox-only (`assertSandboxAllowed`); `mode:live` stays refused.
- **DUAL-ADVERSARIAL review** required for **Task 3 (client-assertion signer)** and **Task 4 (token acquisition/exchange)** — the security-critical "signed JWT → access token" path.

### Prerequisite (Phase 0 must be on the branch)

Track A consumes the Phase-0 foundation as-built (`engine.js`, `interfaces.js`, `canonical/*`, `secrets.js`, `audit.js`, `tenant.js`, `permission.js`, `connectors/fhir-r4/{connector,normalize}.js`, `test/connect/fixtures/fhir-synthetic.mjs`, `test/connect/no-phi.test.mjs`). Phase 0 is MERGED to main (commit 54b1b949). Create the recovery tag `pre-connect-fhir` off main, then build on `feat/connect-fhir-smart`. This plan **references** the Phase-0 exports by their built signatures and does not re-plan them.

---

## File structure

```
functions/_connect/smart/flags.js                     # fhirFlagOn(env) — requires BOTH smd_connect AND smd_connect_fhir; default OFF
functions/_connect/smart/discovery.js                 # discoverSmart + assertTokenEndpointAllowed + SMART_HOST_ALLOWLIST (SSRF/exfil gate)
functions/_connect/smart/assertion.js                 # signClientAssertion — asymmetric-ONLY private_key_jwt signer (DUAL-ADVERSARIAL)
functions/_connect/smart/token.js                     # acquireAccessToken — discover→sign→exchange→narrow-scope→envelope-cache (DUAL-ADVERSARIAL)
functions/_connect/connectors/fhir-r4/paginate.js     # searchPaged — follow Bundle.link[next] same-origin, under the edge budget
functions/_connect/connectors/fhir-r4/connector.js    # (productionize) authenticate=SMART; real validate; capabilities; bounded fetchPatient
functions/_connect/connectors/fhir-r4/normalize.js    # (enrich) labs+vitals, med dosage/origin, report result refs, docs, warnings
functions/_connect/engine.js                          # (edit) inject ctx.kv + generalize ctx.secrets(name) + ctx.envelope{seal,open}
functions/_connect/tenant.js                          # (edit) SANDBOX_ALLOWLIST += SMART sandbox FHIR/token/auth host(s) (// VERIFY)
functions/api/connect/[[path]].js                     # (edit) fhirFlagOn gate + register the SMART-wired fhir-r4 deps
test/connect/smart/mock-fhir-server.mjs               # adversarial mock FHIR server + synthetic SMART token endpoint (harness only, never shipped)
test/connect/smart/fixtures/smart-keys.mjs            # synthetic RS384/ES384 keypairs + JWKS (never real)
test/connect/smart/discovery.test.mjs  smart/assertion.test.mjs  smart/token.test.mjs
test/connect/fhir-r4-paginate.test.mjs  fhir-r4-connector-smart.test.mjs  fhir-r4-smart-flow.test.mjs
test/connect/fixtures/fhir-synthetic.mjs              # (extend) MedicationRequest, vitals Observation, DiagnosticReport+results, DocumentReference, paged Bundle
```

---

### Task 1 — Adversarial mock FHIR server + synthetic SMART token endpoint (`smart/mock-fhir-server.mjs` + `fixtures/smart-keys.mjs` + extend `fhir-synthetic.mjs`)

**Files:** Create `test/connect/smart/mock-fhir-server.mjs` + `test/connect/smart/fixtures/smart-keys.mjs`; extend `test/connect/fixtures/fhir-synthetic.mjs`. Test-harness only — never shipped in the client.

**Interfaces:**
- `makeMockFhir(opts = {}) -> { fetch, kv, calls }` — an injectable `fetch(url, init)` that routes by URL:
  - `GET {base}/.well-known/smart-configuration` → `{ token_endpoint, token_endpoint_auth_methods_supported:["private_key_jwt"], token_endpoint_auth_signing_alg_values_supported:["RS384","ES384"], scopes_supported:["system/*.rs"], capabilities:["client-confidential-asymmetric"] }` (or `opts.poisonDiscovery` → `token_endpoint` at an OFF-allow-list host);
  - `GET {base}/metadata` → a minimal CapabilityStatement with the `oauth-uris` extension (the discovery fallback);
  - `POST {token_endpoint}` → **verify the client assertion** (parse the JWS; `aud` === its own URL; `exp` within skew and ≤ now+300; `alg` ∈ {RS384,ES384}; signature verifies against `smart-keys` JWKS; `jti` unseen — else the `opts.replayJti` knob rejects a reused jti) → issue `{ access_token, token_type:"bearer", expires_in, scope }` (narrowed by `opts.narrowScope`; short-lived by `opts.expireToken`);
  - `GET {base}/Patient/{ref}` and `GET {base}/{Type}?patient={ref}&_count=…&_page=…` → a paged FHIR search Bundle with `link:[{relation:"next", url}]` (`opts.extraPages`/`opts.bigPage`), or `401` first-call (`opts.revokeThenReissue`), or a `DiagnosticReport` whose `result[]` points at an out-of-scope Observation (`opts.danglingRef`).
  - `calls` records method+path+**a redaction check** (records that no `Authorization`/assertion value leaked into a place the tests scan).
- `smart-keys.mjs`: `RS384_PRIVATE_JWK`, `RS384_PUBLIC_JWK`, `ES384_PRIVATE_JWK`, `ES384_PUBLIC_JWK`, `JWKS` — hand-authored synthetic keys (documented as generated once, non-secret, test-only).

**Invariant:** the mock is **adversarial** — it can serve a poisoned discovery, a scope-narrowed / short-lived / revoked token, an over-paged or dangling-reference bundle, and a tampered token; it verifies the client assertion the way a real AS would, so a broken signer is caught here. No real endpoint, key, or PHI anywhere.

**Tests:** `makeMockFhir()` self-check — a well-formed assertion → a token; a wrong-`aud` / expired / `alg:none` assertion → `400 invalid_client`; `poisonDiscovery` yields an off-allow-list `token_endpoint`; a paged search returns `link.next` then a terminal page; `smart-keys` JWKS verifies its own signatures.

---

### Task 2 — SMART discovery + token-endpoint trust gate (`smart/discovery.js` + `smart/flags.js`)

**Files:** Create `functions/_connect/smart/discovery.js` + `functions/_connect/smart/flags.js`; Test `test/connect/smart/discovery.test.mjs`.

**Interfaces:**
- `fhirFlagOn(env) -> boolean` = `flagOn(env) && String(env.CONNECT_FHIR_FLAG) === "1"` (`// VERIFY` the env-var name; requires BOTH the base `smd_connect` flag AND the separate `smd_connect_fhir`; default OFF).
- `export const SMART_HOST_ALLOWLIST = Object.freeze([ "launch.smarthealthit.org", "smart-mock.local" ]);` — `// VERIFY: the real hospital FHIR base host(s) AND their authorization-server host(s); the AS host is often DISTINCT from the FHIR host`.
- `assertTokenEndpointAllowed(tokenEndpoint, hostAllowlist = SMART_HOST_ALLOWLIST) -> void` (throws `SmartError`) — parse as `URL`; refuse non-`https`, any `userinfo`, or a host ∉ `hostAllowlist`. The anti-exfil boundary, reused by Task 4 on the exact URL it POSTs to.
- `discoverSmart(deps, { fhirBase, tokenEndpointHint, hostAllowlist }) -> { tokenEndpoint, scopesSupported, algsSupported, authMethods }` where `deps = { fetch, kv, now, logger }`. Steps: (1) if `tokenEndpointHint` set, use it; else `GET {fhirBase}/.well-known/smart-configuration`; on non-2xx/absent, fall back to `GET {fhirBase}/metadata` and read the CapabilityStatement `security.extension` `…/oauth-uris` `token` URI. (2) **`assertTokenEndpointAllowed(tokenEndpoint, hostAllowlist)` BEFORE returning** — a poisoned discovery is refused here, before anything is signed. (3) cache the NON-PHI discovery doc in `kv` under `connect:smart:disco:<fhirHost>` (TTL); corrupt cache → refetch. Fail-closed: any parse/fetch/allow-list failure → `SmartError` (never a partial "no endpoint, proceed").

**Invariant (S1):** the token endpoint is `https` + host-allow-listed + no-userinfo, validated BEFORE use; discovery I/O is `fetch`-injected (mockable, no globals); the cache holds only the NON-PHI discovery doc. Fail-closed on any error.

**Tests:** a well-formed `smart-configuration` → the token endpoint; the CapabilityStatement fallback path → the same endpoint; a **poisoned** `token_endpoint` (off-allow-list host) → `SmartError`, nothing returned; an `http://` or userinfo-bearing endpoint → `SmartError`; a second call hits the KV cache (one `fetch`); `fhirFlagOn` is true only with BOTH flags set.

---

### Task 3 — SMART client-assertion JWT signer (`smart/assertion.js`: `signClientAssertion`) — **REVIEW: DUAL-ADVERSARIAL**

**Files:** Create `functions/_connect/smart/assertion.js`; Test `test/connect/smart/assertion.test.mjs`. **This is the sign-side mirror of `abdm/jws.js` (verify side): the same asymmetric-only, frozen-alg-table discipline.**

**Interfaces:**
- `export const SIGN_ALG = Object.freeze({ RS384:{ importParams:{name:"RSASSA-PKCS1-v1_5",hash:"SHA-384"}, signParams:{name:"RSASSA-PKCS1-v1_5"} }, ES384:{ importParams:{name:"ECDSA",namedCurve:"P-384"}, signParams:{name:"ECDSA",hash:"SHA-384"} } });` — the ONLY algs this signer will EVER produce. Asymmetric-only by construction, so `alg:none` and the whole HMAC family can never be selected. `// VERIFY: some servers accept RS256/ES256 — additions stay in this table (still asymmetric-only, never HMAC/none)`.
- `signClientAssertion(deps, { clientId, tokenEndpoint, privateKeyJwk, kid, alg, jti, ttlSec }) -> string` (a compact JWS `h.p.s`) where `deps = { now, logger }`. Builds header `{ alg, kid, typ:"JWT" }` and claims `{ iss:clientId, sub:clientId, aud:tokenEndpoint, iat, nbf:iat, exp: iat + Math.min(ttlSec||300, 300), jti: jti || crypto.randomUUID() }`; base64url-encodes; `crypto.subtle.importKey("jwk", privateKeyJwk, SIGN_ALG[alg].importParams, false, ["sign"])`; `crypto.subtle.sign(SIGN_ALG[alg].signParams, key, data)`; returns the compact JWS. `alg` MUST be a key of `SIGN_ALG` (else `AssertionError` before any key touch); `clientId`/`tokenEndpoint`/`privateKeyJwk`/`kid` required. `now` is injected (`deps.now()` → ms), never `Date.now()`/global.

**Invariant (S2/S3/S4/S5):** `aud` === the token endpoint the caller will POST to (bound by Task 4 passing one validated URL); `alg` asymmetric-ONLY (structural — no `none`/HMAC path exists); `exp ≤ now+300s`; `jti` a fresh `crypto.randomUUID()`; the private key JWK is used only to `importKey` and is NEVER logged, returned, or embedded in the output or an error. Fail-closed: an unknown `alg` or a bad JWK → `AssertionError` before signing.

**Tests:** an RS384 sign → a 3-part JWS the mock token endpoint (Task 1) accepts + whose signature verifies against `RS384_PUBLIC_JWK`; the same for ES384; header `{alg,kid,typ:"JWT"}` and claims `{iss==sub==clientId, aud==tokenEndpoint, exp-iat ≤ 300, jti present}`; two calls → two DISTINCT `jti`s; `alg:"HS256"`/`alg:"none"`/`alg:"RS999"` → `AssertionError`, nothing signed; a malformed/absent `privateKeyJwk` → `AssertionError`; the private key string appears in NO return value, thrown message, or `deps.logger` call (assert by scanning). **Adversarial reviewers must probe: any path that emits a symmetric/`none`-signed assertion; an `aud` that differs from the endpoint Task 4 sends to; an over-long / absent `exp`; a reused/predictable `jti`; a private-key value leaking into the JWS, an error, or a log; a `Date.now()`/global-clock read defeating the injected clock.**

---

### Task 4 — SMART Backend Services token acquisition + envelope-cached access token (`smart/token.js`: `acquireAccessToken`) — **REVIEW: DUAL-ADVERSARIAL**

**Files:** Create `functions/_connect/smart/token.js`; Test `test/connect/smart/token.test.mjs`. Consumes Task 2 (`discoverSmart`/`assertTokenEndpointAllowed`) + Task 3 (`signClientAssertion`).

**Interfaces:**
- `acquireAccessToken(deps, { config, requestedScopes, forceRefresh }) -> { accessToken, expiresIn, grantedScopes, tokenEndpoint }` where `deps = { fetch, kv, secrets, envelope, now, logger, tenantId, connectorId }`. Steps, all fail-closed and in this order:
  1. `fhirBase = config.base_url`; `hints = JSON.parse(config.config||"{}").smart || {}`.
  2. **Token cache read** (unless `forceRefresh`): `kv.get("connect:smart:tok:"+tenantId+":"+connectorId)` → `envelope.open(ciphertext)` → `{ token, exp, scope }`; if `exp > now()` return it (no network). Corrupt/undecryptable → treat as miss.
  3. `{ tokenEndpoint } = await discoverSmart({fetch,kv,now,logger}, { fhirBase, tokenEndpointHint:hints.tokenEndpointHint, hostAllowlist:hints.authHostAllowlist })` — **SSRF-gated** (Task 2).
  4. `{ clientId, kid, alg, privateKeyJwk } = await secrets("smart")` (the engine envelope-decrypts `config.secret_ref`; **fail-closed** `SecretsUnavailable` if the master key / ref is missing).
  5. `assertion = await signClientAssertion({now,logger}, { clientId, tokenEndpoint, privateKeyJwk, kid, alg })` (Task 3) — `aud` === `tokenEndpoint`.
  6. **Re-assert `assertTokenEndpointAllowed(tokenEndpoint)`** then `POST tokenEndpoint` with `content-type: application/x-www-form-urlencoded`, body = `grant_type=client_credentials&scope=<requestedScopes joined>&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&client_assertion=<assertion>`. `// VERIFY` v1 vs v2 scope syntax + the exact form field names.
  7. Parse `{ access_token, expires_in, scope }`; `grantedScopes = intersect(parseScope(scope), requestedScopes)` (never widen); non-2xx / no `access_token` → `TokenError` (fail-closed).
  8. **Cache**: `ttl = Math.min(Math.max(0, expires_in - 30), 3600)`; if `ttl ≥ 60` → `kv.put(key, await envelope.seal(JSON.stringify({token,exp:now()+ttl*1000,scope})), { expirationTtl: ttl })` (envelope ciphertext only). Return.
- The private key, the assertion, and the access token are used only in request-scoped variables — never logged, never in a URL/path, never in KV plaintext, never in an error message.

**Invariant (S1/S2/S5/S6/S7/S9):** the assertion is signed for and sent to ONE validated token endpoint (gate re-asserted at POST); the private key is envelope-decrypted only in memory and never leaks; the cached token is envelope-encrypted, NON-PHI, tenant+connector-scoped, TTL-with-skew, no global/module cache; granted scope is intersected, never widened; every failure is fail-closed. A poisoned discovery → refuse **before** step 4/5 (nothing signed, nothing sent).

**Tests:** happy path vs the mock (Task 1) → an access token + `grantedScopes ⊆ requestedScopes`, cached encrypted; a second call within TTL → the cached token, **zero** `fetch` to the token endpoint; `forceRefresh` / expired-cache → a fresh exchange; a **poisoned discovery** → `SmartError`/`TokenError`, `signClientAssertion` NEVER called (spy), nothing POSTed; a missing master key → `SecretsUnavailable`, fail-closed; a `narrowScope` server response → `grantedScopes` narrowed; the KV value is ciphertext (the raw token string is absent from the KV bytes); the access token / assertion / private key appear in NO log, error, KV-plaintext, or return-side URL. **Adversarial reviewers must probe: sending the assertion to any host other than the validated token endpoint (SSRF/exfil); an `aud`≠POST-target mismatch; a token cached in plaintext or under a cross-tenant key; a module-level/global token cache leaking across isolates/tenants; a scope-widening from the server response; a 401 handled by silently proceeding unauthenticated instead of one bounded re-auth; the private key or token surfacing in a log/error/KV.**

---

### Task 5 — FHIR bounded, same-origin pagination (`connectors/fhir-r4/paginate.js`: `searchPaged`)

**Files:** Create `functions/_connect/connectors/fhir-r4/paginate.js`; Test `test/connect/fhir-r4-paginate.test.mjs`.

**Interfaces:**
- `searchPaged(deps, { base, resourceType, patientRef, count, extraParams }) -> resource[]` where `deps = { fetch, authHeader, budget, now, logger }` (`authHeader = { authorization: "Bearer <token>" }`; `budget = { maxSubrequests, maxPagesPerResource, deadlineMs }`). Steps: `GET {base}/{resourceType}?patient={enc(patientRef)}&_count={count}` with `authHeader`; collect `(bundle.entry||[]).map(e=>e.resource)`; follow `bundle.link.find(l=>l.relation==="next").url` **only if same-origin as `base`** (`new URL(next).origin === new URL(base).origin`; else stop + `logger.warn` a non-PHI note); stop at `maxPagesPerResource`, when the running subrequest count hits `maxSubrequests`, or when `now()` exceeds the deadline. A non-2xx page → `UpstreamError` (fail-closed) except a `401` which is surfaced distinctly so the connector can re-auth once (Task 6).
- No PHI in any `logger` line (log counts/status/resourceType only — never the URL or `patientRef`).

**Invariant (S8/S10/ADR-A6):** `next` links are followed **same-origin only** (an upstream can't redirect our authenticated, PHI-bearing request to an exfil host); pages, subrequests, and wall-time are budget-capped; over-budget → a partial result (the connector adds a `meta.warnings`), never a crash; `patientRef` is URL-encoded and never logged.

**Tests:** a 3-page search → all resources concatenated across `link.next`; a `next` pointing at a DIFFERENT origin → pagination stops (no fetch to the foreign host), returns page-1; `maxPagesPerResource=1` → only page 1; a subrequest-budget hit → stops early; a `500` page → `UpstreamError`; a `401` page → surfaced as the re-auth signal; the logger never contains `patientRef`.

---

### Task 6 — Productionize the `fhir-r4` pull connector (`connectors/fhir-r4/connector.js`)

**Files:** Edit `functions/_connect/connectors/fhir-r4/connector.js`; Test `test/connect/fhir-r4-connector-smart.test.mjs`. Depends on Tasks 2–5 (blocked by the DUAL-ADVERSARIAL Tasks 3+4). `meta` keeps `{ id:"fhir-r4", profile:"pull", kinds:["fhir-r4"], sccmVersion:"1.0" }` (version bump), so `assertConnector`/the conformance suite still pass.

**Interfaces (the `PULL_METHODS`, SMART-wired):**
- `authenticate(ctx) -> { token, expiresAt, grantedScopes }` — `requestedScopes = scopeToSmart(ctx.scope)` (SCCM type → `system/{Resource}.rs`, `// VERIFY` `.rs` vs `.read`); `deps = { fetch:ctx.fetch, kv:ctx.kv, secrets:ctx.secrets, envelope:ctx.envelope, now:ctx.now, logger:ctx.logger, tenantId:ctx.tenant.id, connectorId: ctx.config.connector_id || "fhir-r4" }`; `return acquireAccessToken(deps, { config: ctx.config, requestedScopes })` mapped to `{ token, expiresAt, grantedScopes }`. Never throws raw — wraps to `UpstreamError`/rethrows the typed `SmartError`/`TokenError`.
- `capabilities(ctx) -> { resources[], operations, authKinds }` — read the discovered `scopes_supported` / CapabilityStatement `rest[].resource[].type`; **graceful stub** fallback to the known resource list if absent (C14). No throw.
- `validate(ctx) -> ValidationReport` — self-test < 30 s: `discoverSmart` reachable + token-endpoint allow-listed → `authenticate` succeeds → a bounded `GET {base}/Patient?_count=1` returns 2xx. Each step a named check; any failure → `{ ok:false, checks:[…] }` (never throws).
- `fetchPatient(ctx, patientRef) -> { patient, resources }` — `const auth = await authenticate(ctx)` (memoized in a request-local); `const authHeader = { authorization: "Bearer " + auth.token }`; `GET {base}/Patient/{enc(patientRef)}`; then for each `type ∈ RES.filter(t => ctx.scope.includes(t))`: `searchPaged({fetch:ctx.fetch, authHeader, budget:ctx.budget, now:ctx.now, logger:ctx.logger}, { base, resourceType:type, patientRef, count:ctx.budget.maxPagesPerResource })`, pushing resources. On a `401` re-auth signal → re-`authenticate` ONCE (evict cache via `forceRefresh`) and retry that fetch once, else `UpstreamError`. `RES = ["Encounter","Condition","MedicationRequest","MedicationStatement","Observation","AllergyIntolerance","DiagnosticReport","DocumentReference"]` (adds `MedicationRequest` — the Phase-0 gap).
- `normalize(ctx, raw) -> normalizeFhir(ctx, raw)` (Task 7).

**Invariant:** the connector orchestrates SMART auth + bounded paginated fetch and hands raw FHIR to `normalize`; the engine owns the ephemeral fail-closed tail (validate → filter → audit → discard) unchanged; a 401 is one bounded re-auth, never an unauthenticated fetch; over-budget → a partial `resources[]` (the normalizer emits `meta.warnings`), never a crash. The connector never sees `env`, the master key, or a raw binding — only `ctx`.

**Tests:** SMART-wired against the mock (Task 1) via `runConformance` — the conformance suite passes (auth, capabilities, fetch+normalize, valid SCCM, no-PHI-in-audit); `fetchPatient` fetches all in-scope families incl. `MedicationRequest`, paginated; a scope excluding `Observation` → no Observation fetch (least privilege); a `revokeThenReissue` mock (first fetch 401) → one re-auth + success; `validate` returns `ok:true` in < 30 s vs the mock and `ok:false` (with checks) vs an unreachable base; `capabilities` degrades to the stub list when the server omits them.

---

### Task 7 — Enrich the FHIR R4 → SCCM normalizer (`connectors/fhir-r4/normalize.js`)

**Files:** Edit `functions/_connect/connectors/fhir-r4/normalize.js`; Test extend `test/connect/fhir-r4-normalize.test.mjs`. Reuses the `canonical/*` factories + the existing `cc()`/`firstCoding` helpers + the `STD` terminology set as-built.

**Interfaces (additions to `normalizeFhir(ctx, raw)`):**
- **Observation category** — a helper `obsCategory(r)` that reads the standard `observation-category` code from `r.category` (`laboratory` | `vital-signs`), defaulting sensibly (unknown → `laboratory` + a `meta.warnings` note) so `maik-context.js` buckets **vitals vs labs** correctly. Map `referenceRange` (`{low:Quantity, high:Quantity, text}`), `interpretation` (`cc`), and `valueString`/`valueCodeableConcept` in addition to `valueQuantity`.
- **MedicationRequest** — already emits `origin:"order"`; add `dosage: r.dosageInstruction?.[0]?.text ? { text } : null` and `status`. **MedicationStatement** — `origin:"statement"`, `dosage: r.dosage?.[0]?.text`.
- **DiagnosticReport** — map `result[]` → `results: r.result.map(x => reference("Observation", refId(x)))` (the validator resolves-in-bundle-or-nulls); keep `conclusion`, `status`, `effectiveDateTime`.
- **DocumentReference** — `type` (`cc`), `status`, `date`, narrative `text` from `description` — **NO binary/attachment bytes** (C4); a `content.attachment.data` present → dropped with a `meta.warnings` note (never emitted).
- Every added coded field routes through `cc(...)` (required `text` fallback + `standard|local` tag); every added `Reference` is intra-bundle (resolve-or-null); ids stay the stable source `resourceType/id`.

**Invariant (C4/C5):** labs vs vitals correctly derived; medication origin + dosage preserved; report result references resolve-in-bundle-or-null; documents are narrative-only (zero binary); partial/unknown/malformed → a valid bundle + `meta.warnings`, never a throw; output passes `validateBundle`.

**Tests:** a vital-signs Observation → `category:"vital-signs"` (NOT defaulted to laboratory) and surfaces in `buildMaikContext(...).vitals`; a lab Observation with `referenceRange`+`interpretation` → mapped; a `MedicationRequest` with `dosageInstruction[0].text` → `origin:"order"` + `dosage.text`; a `DiagnosticReport` whose `result` points at an in-bundle Observation → the reference resolves, and at an out-of-scope Observation → nulled + a warning; a `DocumentReference` with an inline attachment → narrative kept, bytes dropped + warning; the full enriched synthetic set → `validateBundle().ok === true`; a malformed resource → a warning, no throw.

---

### Task 8 — Wiring: engine ctx surface + sandbox allow-list + router flag gate (`engine.js`, `tenant.js`, `[[path]].js`)

**Files:** Edit `functions/_connect/engine.js`, `functions/_connect/tenant.js`, `functions/api/connect/[[path]].js`; Test `test/connect/fhir-r4-smart-flow.test.mjs` covers the wired path (+ the engine-pipeline test stays green).

**Interfaces (the controlled edits):**
- **`engine.js`** — in the `ctx` builder (Part-1 §6 step 4), ADD: `kv: env.MAIK_KV` (the dedicated `connect:*` KV, `// VERIFY` binding name); **generalize** `secrets` to `async (name) => name==="smart" ? JSON.parse(await secretsObj.open(await secretsObj.get(config.secret_ref))) : name==="bearer" ? (config.secret_ref ? secretsObj.open(await secretsObj.get(config.secret_ref)).catch(()=>null) : null) : null`; and `envelope: { seal: secretsObj.seal, open: secretsObj.open }`. No other engine change — the pipeline order, the fail-closed catch, the PHI-free audit, and the post-normalize scope filter are untouched.
- **`tenant.js`** — `SANDBOX_ALLOWLIST` += the SMART sandbox FHIR host(s) needed for the mock/integration (`"smart-mock.local"`; `launch.smarthealthit.org`/`r4.smarthealthit.org` already present). `// VERIFY: the real hospital FHIR base host(s)` before any non-sandbox use. `mode:live` stays refused (unchanged).
- **`[[path]].js`** — import `fhirFlagOn` (Task 2); the `/context` deps register `connectors: { "fhir-r4": fhirR4Connector }` as today, but the connector is now SMART-wired via `ctx` (no router change needed beyond the flag). Add the gate: a FHIR-connector context request when `!fhirFlagOn(env)` (base flag on but FHIR flag off) → `404` (no existence leak). The base `smd_connect` OFF → `404` as today.

**Invariant:** the connector-safe surface is minimal (`ctx.kv`/generalized `ctx.secrets`/`ctx.envelope`) — the connector never sees `env`/the master key; the SMART sandbox host is allow-listed (real hosts `// VERIFY`, `mode:live` still refused); `smd_connect_fhir` structurally gates every FHIR surface; the ABDM + generic `/context` paths are unaffected. Zero regression.

**Tests:** the engine builds a `ctx` exposing `kv`/`envelope`/`secrets("smart")` (a stubbed `secretsObj` → the decrypted `{clientId,kid,alg,privateKeyJwk}`); the sandbox gate still refuses an off-allow-list `base_url` and `mode:live`; `fhirFlagOn` OFF → `/context` for `fhir-r4` returns `404`; both flags ON → the pipeline runs; the Phase-0 `engine-pipeline.test.mjs` + `no-phi.test.mjs` + all ABDM tests stay green (zero regression).

---

### Task 9 — End-to-end SMART pull integration + adversarial + no-PHI proof (`fhir-r4-smart-flow.test.mjs`)

**Files:** Test `test/connect/fhir-r4-smart-flow.test.mjs`. Drives the whole path through the engine against the adversarial mock (Task 1). Test-only.

**Interfaces:**
- The test wires `loadPatientContext(env, deps, req)` with `io.fetch = makeMockFhir(opts).fetch`, `env.MAIK_KV = makeMockKv()`, a stubbed `secretsObj` returning the synthetic SMART key material + envelope seal/open, a seeded `makeMockDb` (a `connect_tenant` sandbox row, a `connect_membership`, a `connect_connector_config` with the FHIR base + `secret_ref` + `config.smart`, `granted_scopes`), and drives: identity → sandbox gate → `authenticate` (discover→sign→exchange→cache) → paginated `fetchPatient` → `normalizeFhir` → `validateBundle` → scope filter → PHI-free audit → returned bundle.

**Invariant:** the invariants of Tasks 2–8 hold **composed**, not just in isolation — the full ephemeral, fail-closed, sandbox-only, SMART-authenticated pull produces a valid SCCM bundle and leaks nothing.

**Tests:** happy path → a valid `CanonicalBundle` (Patient + the in-scope families incl. `MedicationRequest` + vitals + a resolved DiagnosticReport result + a narrative DocumentReference), `validateBundle().ok`, `buildMaikContext` buckets labs/vitals right, one PHI-free audit event (`patientRefHash`, `resourceCounts`, granted `scope`, `outcome:"ok"`), the token cached encrypted; **poisoned discovery** → the load fails closed (`outcome:"error"`), nothing signed/sent/persisted; **revoke-then-reissue** (first fetch 401) → one re-auth + success; **scope narrowed** (request excludes Observation) → no Observation in the bundle (engine filter + least-privilege fetch); **over-paged / max-size** → a bounded partial bundle + `meta.warnings`, within budget, no crash; **no-PHI/no-secret** → grep the audit rows + any captured log/error for the synthetic patient name, `patientRef`, the private key, the client assertion, and the access token → all absent; **flag OFF** → `404`; **zero regression** — the Phase-0 + ABDM suites still pass.

---

## Self-review

- **Spec coverage.** Track-A scope items map 1:1 → SMART Backend Services auth (T2 discovery + trust gate, T3 signer [DUAL-ADVERSARIAL], T4 acquisition/exchange/cache [DUAL-ADVERSARIAL]); productionized `fhir-r4` pull connector (T6 authenticate/validate/capabilities/fetchPatient + the 7 resource families incl. the `MedicationRequest` gap; T5 bounded same-origin pagination); enriched FHIR→SCCM normalizer with labs+vitals / med dosage+origin / report result refs / narrative docs (T7); mock-FHIR-server-first adversarial harness + synthetic keys/fixtures (T1); wiring + `smd_connect_fhir` flag + sandbox allow-list + connector-safe engine surface (T8); composed end-to-end + adversarial + no-PHI/no-secret proof (T9). Security invariants: **S1** token-endpoint trust gate (T2/T4), **S2** `aud`-binding (T3/T4), **S3** asymmetric-only signing (T3), **S4** short-lived+`jti` (T3), **S5** private key never leaks (T3/T4), **S6** envelope-encrypted NON-PHI tenant-scoped token cache, no global cache (T4), **S7** scope never widens (T4/T6 + engine filter), **S8** PHI discipline + same-origin pagination (T5/T7/T9), **S9** fail-closed (all), **S10** bounded edge (T5/T6). ADR-A1..A6 realized across T2–T8. Flag `smd_connect_fhir` separate + default OFF, ABDM/`/context` unaffected (T8/T9).
- **No placeholders.** Every task lists concrete signatures + the invariant + inline test scenarios. `// VERIFY` marks only genuinely-deferred owner values (the `SMART_HOST_ALLOWLIST` real FHIR+AS hosts, client registration [public key + `client_id`], the signing alg per server [RS384/ES384 vs RS256/ES256], the scope syntax [`.rs` vs `.read`] + token-form field names, the discovery contract, the `CONNECT_FHIR_FLAG` env-var name, the `MAIK_KV`/`connect:*` binding) — never a logic gap.
- **Type/signature consistency.** Phase-0 exports consumed as-built and untouched: `interfaces.js#{makeCtx,runConformance,assertConnector}` (`PULL_METHODS` unchanged), `canonical/model.js` + `coding.js` factories + `validate.js#validateBundle`, `secrets.js#makeSecrets→{seal,open,get}`+`SecretsUnavailable`, `audit.js#{ALLOW,buildAuditEvent,hmacPseudonym}` (no edit — existing keys suffice), `tenant.js#{SANDBOX_ALLOWLIST,assertSandboxAllowed}`, `permission.js#{UpstreamError,enforceScope}`, `testkit.js#{flagOn,jsonResponse,makeMockKv,makeMockDb}`. The signer mirrors `abdm/jws.js`'s asymmetric-only frozen-alg-table discipline on the sign side. The four controlled edits (`connectors/fhir-r4/{connector,normalize}.js`, `engine.js` ctx surface, `tenant.js` allow-list, `[[path]].js` flag) mirror the ABDM stages' controlled-edit discipline. Cross-doc: `discoverSmart`/`assertTokenEndpointAllowed`/`signClientAssertion`/`acquireAccessToken`/`searchPaged`/`fhirFlagOn`/`SMART_HOST_ALLOWLIST`/`SIGN_ALG` signatures match spec §3/§4/§9 exactly.

### Owner decisions / spec gaps noticed

1. **⭐ THE token-endpoint / auth-server host allow-list (`SMART_HOST_ALLOWLIST`, `// VERIFY`, anti-exfil-critical).** The token endpoint comes from attacker-influenceable discovery. The owner must pin the **real hospital FHIR base host(s) AND their authorization-server host(s)** — frequently a DISTINCT host (a hospital's Keycloak/Okta/Auth0 vs its FHIR gateway). Until pinned, only the SMART sandbox hosts are allow-listed and everything else fails closed (T2/T4). This is the single highest-value owner input.
2. **Client registration is out-of-band (`// VERIFY`).** The tenant's **public** key (JWKS/`jwks_url`) must be registered with the hospital AS and a `client_id` issued; the matching **private** key JWK is envelope-sealed into `secret_ref`. StewardMD cannot self-issue these — a per-tenant onboarding step.
3. **Signing alg per server (`// VERIFY`).** SMART Backend Services mandates RS384/ES384 (pinned in `SIGN_ALG`); some servers accept RS256/ES256. Confirm per target; any addition stays in the asymmetric-only frozen table (never HMAC/`none`).
4. **Scope syntax + token-form field names (`// VERIFY`).** SMART v2 `system/{Resource}.rs` (read+search) vs v1 `.read`; `scopes_supported` from discovery disambiguates. Confirm the target's SMART version + the exact token-request form field names (mirrors the ABDM `FIELDS` seam).
5. **Discovery contract (`// VERIFY`).** `.well-known/smart-configuration` preferred, CapabilityStatement `oauth-uris` fallback. Confirm the target exposes one and advertises `private_key_jwt`.
6. **`mode:live` stays refused (carried).** Track A is sandbox-only; a real hospital pull needs the consent/DPA gate + the MaiK-egress control (C6/C7) of a later phase. The sandbox-only gate is the technical enforcement now.
7. **Bulk Data ($export) deferred.** History-heavy / population loads route to the deferred queued path (Part-1 §6 step 5), not a single synchronous request — not built here; `searchPaged` is per-resource bounded pagination only.
8. **`MAIK_KV` reuse vs a dedicated `connect:*` namespace.** The plan reuses the existing KV binding (as ABDM does) for the NON-PHI SMART discovery + token cache under `connect:smart:*` keys. Confirm whether Track A should provision a dedicated Connect KV namespace (Part-1 C10 reserved `connect:*`) instead — a one-line binding swap.

## Execution handoff

Create the recovery tag `pre-connect-fhir` off main (Phase 0 @ 54b1b949), then build on `feat/connect-fhir-smart`. Build order = Task 1 → 9 (each: failing test → code → refactor → commit). Task 1 (the adversarial mock + synthetic keys) is the harness everything else tests against and comes first. Tasks 2 and 5 are independent primitives (discovery gate; pagination) and may be built in parallel. **Task 3 (the `private_key_jwt` signer) and Task 4 (token acquisition/exchange) are the DUAL-ADVERSARIAL "signed JWT → access token" path — each requires two independent adversarial reviewers (probing the exfil boundary, `aud`-binding, alg-confusion, replay, and secret/token leakage) before it counts as done, and both block Tasks 6 and 9.** Task 6 (connector) depends on 2–5; Task 7 (normalizer) is independent of the SMART tasks and may run alongside; Task 8 wires it into the engine/router behind `smd_connect_fhir`; Task 9 is the composed end-to-end + adversarial + no-PHI/no-secret proof and must pass every adversarial scenario (poisoned discovery, revoke-then-reissue, scope-narrowing, over-paged, flag-off) with zero regression. Run the full reviewer panel (platform + security [appsec/redteam/secret-scan] + dpdp/hipaa + performance + dataflow + preprod) on the implementation.
