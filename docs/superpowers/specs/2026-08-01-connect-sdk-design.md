# StewardMD Connect — Track C: Connector SDK + Registry (Design)

**Date:** 2026-08-01
**Revision:** v1.0
**Status:** Draft for owner review (no implementation until approved)
**Author:** Claude (acting Principal/Interoperability Architect)
**Builds on:** `docs/superpowers/specs/2026-07-31-stewardmd-connect-part1-foundation-design.md` (the connector contract §5, `pull`+`event` profiles, SCCM §4, the engine pipeline §6). This is the concrete realization of the "Connector SDK" that Part-1 §15 parks in Phase 2 and §5 promises ("The SDK (Phase 2) ships this suite for third-party self-certification").

---

## 0. What this track is (and is not)

Track C turns the **ad-hoc Phase-0/1 connectors into a first-class, documented, testable extension point.**
Today a connector is added by editing a hard-coded object literal in the router
(`deps.connectors = { "fhir-r4": fhirR4Connector }`), and the only formalization is
`assertConnector()` (a shape guard) plus a **pull-only** `runConformance()` harness in
`functions/_connect/interfaces.js`. That is enough to prove the walking skeleton, not enough to let a
new connector be dropped in safely.

Track C delivers, **additively**, four things:

1. **A connector registry** — `register`/`resolve` by `id` (+ optional `profile` assertion), fail-closed,
   **per-request / no global mutable state**. It *produces* the plain `deps.connectors` map the engine
   already consumes, so new connectors are pluggable **without touching the engine**.
2. **A conformance test-kit** — a profile-aware superset of `runConformance()` that any connector MUST
   pass: `normalize` output validates against SCCM, **deterministic resource ids**, **no-PHI-by-construction**,
   and **fail-closed** on upstream error. Shipped so third parties can self-certify.
3. **A lifecycle / capability descriptor** — a small declarative `ConnectorDescriptor` derived from
   `meta` (with optional overrides) that says what a connector *is* (profile, kinds, maturity) and *does*
   (resources / event types, whether it currently emits a bundle). The descriptor is what the registry
   and the conformance kit read to decide which checks apply.
4. **Developer docs** — `docs/connect/connector-sdk.md` (a slot already reserved in Part-1 §9): "write a
   conforming connector in N steps" + the conformance checklist + the registry usage + the lifecycle table.

**NOT in Track C (explicit scope boundary, deferred to a later Phase-2 slice):** a connector CLI, a
standalone mock upstream server, a connector marketplace/discovery service, HL7/SMART/file connectors,
runtime hot-loading of third-party code, and any change to SCCM or the engine pipeline. Track C is the
**framework**; the connectors it hosts remain individually flag-gated (`smd_connect` and, for ABDM, its
own gates). **No new flag** is introduced.

---

## 1. Constraints (verbatim, carried from the caller)

- Buildless Cloudflare; plain ES modules; `node --test`; **no new dependencies**.
- **Additive-only** — new files under `functions/_connect/sdk/*`, `test/connect/sdk/*`, and `docs/connect/*`.
  Exactly **one** behavior-preserving edit to an existing file is contemplated (the router wiring, §6.2),
  and it is explicitly optional/owner-gated — the SDK lands and is fully tested with zero integration risk
  first.
- **No behavior change to existing connectors.** `fhir-r4` and `abdm` must pass the new conformance kit
  **as-is** (they do — see §5.4; no shim required).
- **Reuse** `interfaces.js` (`assertConnector`, `makeCtx`), `canonical/validate.js` (`validateBundle`),
  `audit.js` (`ALLOW`). No parallel copies.
- **Fail-closed registration** — an unregistered or non-conforming connector is refused, never silently used.
- **No new flag** — the registry is a framework; it is gated by the connectors it hosts.
- **Per-request / no-global-mutable-state** — Workers isolates are reused across requests; a module-level
  mutable registry Map would leak connector state/config across tenants and requests. Called out in §4.1
  and enforced by design + test.

**Crypto criticality:** none. The registry, descriptor, conformance kit, and docs contain **no cryptography,
no signature verification, no key handling** (they *reuse* `audit.ALLOW` and `validateBundle`, which are
themselves non-crypto). Therefore **no task in this track is DUAL-ADVERSARIAL.** The security-relevant
surface (no-PHI, fail-closed) is test/gate logic and is covered by the normal reviewer panel (§10).

---

## 2. Where this sits in the existing code

```
Part-1 today                                   Track C adds (additive)
------------                                   -----------------------
interfaces.js                                  sdk/descriptor.js    (describe + assertDescriptor)
  assertConnector()  (shape guard)  ──reuse──▶ sdk/conformance.js   (profile-aware runConformance++)
  makeCtx()          (injected ctx) ──reuse──▶ sdk/registry.js      (createRegistry / register / resolve)
  runConformance()   (pull-only)    ──super──▶ sdk/catalog.js       (frozen built-in list + defaultRegistry)
canonical/validate.js validateBundle ─reuse──▶ sdk/index.js         (public export barrel)
audit.js  ALLOW                     ──reuse──▶ docs/connect/connector-sdk.md

engine.js  deps.connectors[id]  ◀── fed by ── registry.asConnectorMap()   (the bridge; engine UNCHANGED)
router  [[path]].js  literal map ◀── replaced by ── defaultRegistry().asConnectorMap()  (§6.2, optional)
```

The engine's contract is unchanged: it still receives `deps.connectors` (a plain `{ [id]: connector }`)
and still does `deps.connectors[req.connectorId]` → `UpstreamError` on miss. The registry simply **becomes
the only thing that builds that map**, and it only ever puts conformant connectors into it.

---

## 3. The lifecycle / capability descriptor

A `ConnectorDescriptor` is a small, JSON-serializable, declarative record. It is the single source of
truth the registry and conformance kit consult, so behavior is driven by declaration, not by guessing at
runtime what a connector can do.

```jsonc
ConnectorDescriptor {
  id:          "fhir-r4",                 // from meta.id
  name:        "FHIR R4 (read-only)",     // from meta.name
  version:     "0.1",                     // from meta.version (connector build, not SCCM)
  profile:     "pull" | "event",          // from meta.profile
  kinds:       ["fhir-r4"],               // from meta.kinds
  sccmVersion: "1.0",                     // from meta.sccmVersion  (registry refuses != "1.0")

  lifecycle:   "experimental" | "skeleton" | "beta" | "ga" | "deprecated",
               // maturity of THIS connector. "skeleton" = shape-complete but not yet emitting bundles
               // (e.g. abdm until Stage-4 decrypt lands). Drives which behavioral checks are mandatory.

  capabilities: {
    // pull profile:
    resources:  ["Patient","Condition","Observation", ...],   // SCCM resource types it can surface
    operations: ["read","search"],
    authKinds:  ["oauth2","none"],
    // event profile:
    eventTypes: ["consent-notification","data-push", ...],    // inbound event `type`s it ingests
    // both:
    emitsBundle: true | false          // does normalize/ingest currently return a validated SCCM bundle?
                                       // false => a "skeleton" whose bundle-validity checks are deferred.
  }
}
```

### 3.1 Derivation (declare-with-inference, not guess)

`describe(connector)` builds the descriptor from `connector.meta`, applying defaults, and lets a connector
**override** by declaring `meta.lifecycle` and/or `meta.capabilities`:

| Field | Source | Default when absent |
|---|---|---|
| `id/name/version/profile/kinds/sccmVersion` | `meta.*` | — (required; missing → `assertDescriptor` throws) |
| `lifecycle` | `meta.lifecycle` | `pull` → `"ga"`; `event` → `"skeleton"`  *(// VERIFY default)* |
| `capabilities.resources/operations/authKinds` | `meta.capabilities` or `connector.capabilities(ctx)` (pull) | `[]` |
| `capabilities.eventTypes` | `meta.capabilities.eventTypes` | `[]` |
| `capabilities.emitsBundle` | `meta.capabilities.emitsBundle` | `pull` → `true`; `event` → `false` *(// VERIFY default)* |

The two `// VERIFY` defaults exist so the **existing connectors pass as-is**: `fhir-r4` (pull) infers
`ga`/`emitsBundle:true`; `abdm` (event) infers `skeleton`/`emitsBundle:false`. When ABDM's real Stage-4
normalizer lands, adding `meta.capabilities.emitsBundle:true` (one line, no SDK change) flips the full
bundle-validity + deterministic-id checks on automatically. The owner decides whether the SDK is allowed
to **infer** these defaults or must require every connector to **declare** them explicitly (§9, D2).

`assertDescriptor(d)` is a shape guard (throws on a missing/typed-wrong field or `profile ∉ {pull,event}`
or `sccmVersion != "1.0"`), mirroring the strictness of `assertConnector`.

---

## 4. The registry

### 4.1 Per-request, no global mutable state (the load-bearing invariant)

**Workers isolates are reused across requests.** A module-level `const REG = new Map()` that connectors
mutate (or that caches per-tenant connector config) would persist across requests and tenants and is exactly
the "no global caching of PHI/tokens/config" hazard Part-1 C11 forbids. Therefore:

- The **only** module-level state is a **frozen, immutable** array of built-in connector references
  (`sdk/catalog.js`) — code references, never per-request data.
- `createRegistry()` and `defaultRegistry()` each return a **fresh** registry object; the registry's
  internal index is created per call and **frozen** before it is handed out (`asConnectorMap()` returns a
  frozen object). There is no post-construction `register()` mutation on a shared instance in the request
  path.
- No connector config, token, tenant, or bundle is ever stored on the registry — the registry maps
  `id → connector code`, nothing else. All per-request state stays in the injected `ctx` (Part-1 §5), which
  the engine already builds per request.

This is stated as an ADR (ADR-C3) and enforced by a test that constructs two registries and asserts they
share no mutable state, and that `asConnectorMap()` is frozen.

### 4.2 API surface

```jsonc
createRegistry(opts?) -> Registry
   // opts.strict?: boolean  — if true, register() also runs the FAST structural conformance gate (default true)
   // Returns a builder-style registry. Fresh, no shared state.

Registry.register(connector) -> Registry
   // Fail-closed. Runs, in order:
   //   assertConnector(connector)            (reused from interfaces.js — shape/profile/method presence)
   //   d = describe(connector); assertDescriptor(d)
   //   sccmVersion === "1.0"                 (else refuse)
   //   duplicate id?                         (else refuse — no silent overwrite)
   // Any throw => the connector is REFUSED and NOT added. Chainable on success.

Registry.resolve(id, profile?) -> Connector
   // Fail-closed. Unknown id => throws (UpstreamError, matching engine.js today).
   // If `profile` given and descriptor.profile !== profile => throws (no cross-profile misuse).

Registry.has(id) -> boolean
Registry.list() -> ConnectorDescriptor[]       // descriptors only — never the connector code, never secrets
Registry.asConnectorMap() -> frozen { [id]: connector }
   // The engine-compat bridge: this is what becomes deps.connectors. Contains ONLY conformant connectors.

defaultRegistry() -> Registry
   // Builds a fresh registry from the frozen built-in catalog (fhir-r4 pull, abdm event), registers each
   // (fail-closed), and returns it frozen. This is the single call the router uses (§6.2).
```

### 4.3 Two-layer fail-closed (structural at runtime, behavioral at build time)

Full behavioral conformance (run `normalize` against a synthetic fixture, check SCCM validity, determinism,
fail-closed) needs fixtures and mock upstreams and is **too heavy to run on every request** in a Workers
isolate. So fail-closed is layered:

| Layer | When | What it checks | Enforcement |
|---|---|---|---|
| **Structural** | `register()` (runtime, per registry build) | `assertConnector` + `assertDescriptor` + sccmVersion + no-dup | throws → refused |
| **Behavioral** | CI / self-cert (`assertConforms`, offline) | normalize→valid SCCM, deterministic ids, no-PHI, fail-closed | CI red → connector never reaches the frozen catalog |

A connector cannot enter the built-in catalog (`sdk/catalog.js`) without a green
`test/connect/sdk/*` conformance run; and third parties gate their own connector with the shipped
`assertConforms()` in *their* test suite. This preserves "non-conforming is refused, never silently used"
without paying conformance cost on the hot path. *(// VERIFY — owner: is CI-gating the behavioral layer
sufficient, or do you also want an opt-in boot-time `assertConforms` behind a dev-only flag? §9 D3.)*

---

## 5. The conformance test-kit

`sdk/conformance.js` exports a **profile-aware superset** of `interfaces.runConformance` (the pull-only one
stays for back-compat; the new kit dispatches on `descriptor.profile`). It reuses `makeCtx` (interfaces.js),
`validateBundle` (validate.js), and `ALLOW` (audit.js). Two entry points:

```jsonc
runConformance(connector, opts?) -> { passed:boolean, checks:[{name,ok,detail}], descriptor }
assertConforms(connector, opts?) -> void        // throws ConformanceError listing failed checks; for register(strict)/CI
   // opts.fixtures: { patientRef, raw, rawEvent }  — SYNTHETIC only (Synthea/SMART/NDHM-synthetic)
   // opts.fetch:    injected upstream (mock)
```

### 5.1 The mandatory checks (the contract)

| # | Check | Applies to | How |
|---|---|---|---|
| 1 | **contract** | all | `assertConnector` (reused) — profile + required methods present |
| 2 | **descriptor** | all | `assertDescriptor(describe(connector))` — well-formed, sccmVersion 1.0 |
| 3 | **authenticate-retryable** | all | with a *rejecting* injected `fetch`, `authenticate` returns/`AuthError`s — never an uncontrolled throw (Part-1 §5) |
| 4 | **capabilities-graceful** | pull | `capabilities(ctx)` returns a shape, degrades (no throw) vs a degraded sandbox |
| 5 | **fetch/ingest returns raw** | pull / event | `fetchPatient` / `ingest` returns without crashing on the synthetic fixture |
| 6 | **normalize → valid SCCM** | when `emitsBundle` | `validateBundle(normalize(ctx, raw)).ok === true` |
| 7 | **deterministic ids** | when `emitsBundle` | `normalize` the SAME raw twice → identical resource-id sets (C5 stable-id); and id-set is independent of `tenantId` |
| 8 | **no-PHI-in-audit** | all | every `ctx.audit(e)` recorded event contains only `ALLOW` keys (reused; existing check) |
| 9 | **no-secret-in-logs/errors** | all | injected `secrets`→a sentinel token; assert the sentinel never appears in any `logger.warn/error` arg or thrown `.message` (extends the no-PHI posture to tokens) |
| 10 | **fail-closed on upstream error** | pull / event | with a rejecting `fetch`, the connector throws a **typed** error (`UpstreamError`/`AuthError`) or degrades to `meta.warnings` — it never returns a partial bundle presented as complete, and never leaks the raw error/stack |

Checks 6 and 7 are **conditional on `emitsBundle`** — a `skeleton` connector (e.g. abdm today) legitimately
returns `null`/`bundle:null` and is not failed for it, but is still held to 1–5 and 8–10. When it flips to
`emitsBundle:true`, 6–7 activate with no kit change.

### 5.2 What "no-PHI-by-construction" means here

Check 8 reuses the exact mechanism Part-1 relies on: the audit sink builds events field-by-field from
`audit.ALLOW`, so the kit asserts *the connector never hands audit a disallowed key*. Check 9 adds the token
dimension (a resolved bearer/secret must not surface in logs or error messages). Together they are the
"no-PHI-by-construction" contract-test named by the caller — structural, not a fragile PHI-regex (that
regex remains a Part-1 backstop, not the primary control).

### 5.3 What "deterministic ids" means here

Check 7 encodes SCCM C5: a connector's `normalize` MUST emit **stable, deterministic ids per source
resource** so a future timeline can dedupe/merge. The kit normalizes the same synthetic raw twice and
asserts the multiset of `{resource-type, id}` is identical, and that ids do **not** vary with `tenantId`
(ids are source-derived, not tenant-salted — tenant scoping lives in `patientRefHash`, not in resource ids).

### 5.4 The existing connectors pass **as-is** (no shim)

- **`fhir-r4` (pull):** real connector — passes 1–10. `describe` infers `ga`/`emitsBundle:true`, so 6–7 run
  against the existing synthetic FHIR fixture (`test/connect/fixtures/fhir-synthetic.mjs`, already stable-id).
- **`abdm` (event, skeleton):** `describe` infers `skeleton`/`emitsBundle:false`. It passes 1–5 (methods
  present; `ingest` returns `{handle, bundle:null}` without crashing) and 8–10 (its stubs touch no audit/log/
  secret and don't fetch). Checks 6–7 are deferred by `emitsBundle:false`. **No shim, no edit to `abdm`.**
  This is asserted directly in `test/connect/sdk/existing-connectors-conform.test.mjs` so the "as-is" claim
  is proven, not assumed.

---

## 6. Wiring the registry to the engine (without touching the engine)

### 6.1 The bridge

The engine already consumes `deps.connectors` (a plain map) and is **not modified**. The registry produces
that map: `deps.connectors = registry.asConnectorMap()`. Because `asConnectorMap()` contains only conformant
connectors, an unknown/non-conforming id is simply absent → the engine's existing
`UpstreamError("connector not registered")` fires → fail-closed, unchanged.

New callers may instead use `registry.resolve(id, profile)` directly (preferred; it also asserts profile).
Both paths are backed by the same internal index.

### 6.2 Router adoption (the one existing-file edit — optional, behavior-preserving)

The router `functions/api/connect/[[path]].js` today hard-codes
`connectors: { "fhir-r4": fhirR4Connector }`. Track C's adoption is a **two-line, behavior-preserving**
swap:

```
- connectors: { "fhir-r4": fhirR4Connector }
+ connectors: defaultRegistry().asConnectorMap()      // fhir-r4 (pull) + abdm (event), conformance-gated
```

`defaultRegistry()` is called **per request** (fresh, frozen — §4.1). This exposes the *same* `fhir-r4`
connector to the `/context` path (plus `abdm` for the event path, which the router already imports
separately today), so there is **no behavioral change** to any existing endpoint. It is presented as its
own task, clearly flagged, and is the only existing-file touch. The owner may defer adoption and keep the
literal — the SDK is fully usable and tested without it. *(// VERIFY — §9 D1: adopt now vs. keep the literal
until Phase-2.)*

---

## 7. File structure (all additive)

```
functions/_connect/sdk/
  descriptor.js      # describe(connector) + assertDescriptor(d) + lifecycle/capability shape
  conformance.js     # runConformance(connector, opts) + assertConforms(...) + ConformanceError (profile-aware)
  registry.js        # createRegistry(opts) + Registry{register,resolve,has,list,asConnectorMap} + defaultRegistry()
  catalog.js         # frozen built-in list: [fhirR4Connector, abdmConnector]  (immutable module const)
  index.js           # public barrel: re-exports describe/assertDescriptor/runConformance/assertConforms/
                     #   createRegistry/defaultRegistry — the single import surface for third parties
test/connect/sdk/
  descriptor.test.mjs
  conformance.test.mjs               # mock pull + mock event + a deliberately-leaky + a fail-open connector
  registry.test.mjs                  # fail-closed register/resolve, dup refusal, per-request isolation, frozen map
  existing-connectors-conform.test.mjs   # PROVES fhir-r4 + abdm pass as-is
docs/connect/
  connector-sdk.md                   # developer guide (§8)
```

Reused unchanged: `interfaces.js` (`assertConnector`, `makeCtx`), `canonical/validate.js`
(`validateBundle`), `audit.js` (`ALLOW`), `canonical/model.js` (`RESOURCE_KEYS`), `permission.js`
(`UpstreamError`).

---

## 8. Developer docs (`docs/connect/connector-sdk.md`)

Reader = an engineer (internal or, later, third-party) adding a connector. Contents:

1. **Concepts** — the injected `ctx` (Part-1 §5), the two profiles, SCCM as the only output, ephemeral/PHI-free.
2. **Write a connector in 6 steps** — (1) pick a profile; (2) implement the profile's methods; (3) map
   vendor→SCCM in `normalize` only (the anti-corruption boundary), every coded field carries a `text`
   fallback, ids are stable/deterministic; (4) declare `meta` (+ `lifecycle`/`capabilities` if overriding
   defaults); (5) run `assertConforms(connector, {fixtures})` in your test — green means valid; (6) add to
   the catalog (internal) or register at your edge (third-party).
3. **The conformance checklist** — the 10 checks (§5.1) with a one-line rationale each.
4. **The lifecycle table** — `experimental → skeleton → beta → ga → deprecated`, what each gate requires.
5. **Registry usage** — `defaultRegistry().asConnectorMap()` for the engine; `resolve(id, profile)` direct;
   the per-request/no-global-state rule; fail-closed semantics.
6. **Do-not** — no global caching of tokens/config/PHI; never log/audit outside `ALLOW`; never emit vendor
   fields downstream; never `mode:live` without consent (cross-refs Part-1 C6/C7).

---

## 9. Owner decisions / `// VERIFY` gaps

| # | Decision | Recommendation |
|---|---|---|
| **D1** | **Router adoption now vs later** (§6.2). Rewire the router to `defaultRegistry().asConnectorMap()` this track, or ship the SDK additive-only and adopt in Phase 2? | Adopt now — it is behavior-preserving and is the point of the track — but keep it a separate, revertable task. |
| **D2** | **Descriptor: infer vs declare** (§3.1). May the SDK infer `lifecycle`/`emitsBundle` defaults (so abdm passes as-is), or must every connector declare them explicitly? | Infer-with-override (keeps existing connectors zero-touch); revisit "require declare" when third parties onboard. |
| **D3** | **Behavioral fail-closed enforcement** (§4.3). Is CI/self-cert gating enough, or also an opt-in boot-time `assertConforms` behind a dev flag? | CI-gating is sufficient for built-ins; add a dev-only boot self-check only if third-party hot-registration is ever allowed (out of scope here). |
| **D4** | **Error-type surface.** Reuse `UpstreamError` for unknown-id (matches engine) + add `ConformanceError` for refused registration, or introduce one `RegistryError`? | Reuse `UpstreamError` for unknown-id; add a single `ConformanceError` (extends Error, in `conformance.js`) for refusals — minimal new surface, consistent with the engine. |
| **D5** | **Third-party/self-cert scope & API stability.** Is the shipped conformance kit a committed public API for external connector authors now, or internal-until-Phase-2? Part-1 §15 places the *full* SDK (CLI + mock server) in Phase 2. | Ship the kit + `index.js` barrel now as internal-stable; mark the public/third-party contract "stabilizing" until the Phase-2 CLI/mock-server land. |

All five are API-surface / policy choices, not implementation blockers — the plan can proceed on the
recommended defaults and the owner can override any before merge. None is crypto-related.

---

## 10. Reviewer panel

Same panel as Part-1 §11, scoped to a framework change:

| Requested | Agent(s) |
|---|---|
| Architecture | `stewardmd-platform-reviewer` (registry as extension point; no-global-state) |
| Security | `stewardmd-appsec-reviewer`, `stewardmd-redteam-reviewer` (fail-closed register/resolve; no-PHI/no-secret checks are real) |
| Testing | `stewardmd-preprod-reviewer` (conformance kit rigor; as-is proof) |
| API / Data | `stewardmd-dataflow-reviewer` (descriptor never leaks connector code/secrets) |

**No DUAL-ADVERSARIAL review** — no crypto/signature/key surface in this track (§1).

---

## 11. Architecture Decision Records

- **ADR-C1 — The registry produces the engine's map; the engine is untouched.** New connectors are pluggable
  by registering, not by editing the engine. *Rejected:* teaching the engine to import connectors (couples
  the pipeline to the catalog).
- **ADR-C2 — Descriptor-driven conformance (declare-with-inference).** A declarative `ConnectorDescriptor`
  (derived from `meta`, overridable) decides which checks apply, so a `skeleton` connector is held to the
  right subset and matures without kit edits. *Rejected:* runtime feature-sniffing of connector methods.
- **ADR-C3 — Per-request, frozen registry; no module-level mutable state.** Only immutable code references
  live at module scope; every registry instance is fresh and frozen. *Rejected:* a shared mutable Map
  (cross-request/tenant leakage on reused isolates — Part-1 C11).
- **ADR-C4 — Two-layer fail-closed.** Fast structural gate at `register()` (runtime); full behavioral
  conformance at CI/self-cert (build time). *Rejected:* running full conformance per request (edge CPU
  blowout) or trusting connectors without any gate (silent-use hazard).
- **ADR-C5 — Reuse, don't fork.** `assertConnector`/`makeCtx`/`validateBundle`/`ALLOW` are reused; the SDK
  adds only descriptor + registry + the profile-aware kit. *Rejected:* a second copy of the shape guard or
  audit allow-list (drift risk).
- **ADR-C6 — Additive, no new flag.** New `sdk/*`, `test/connect/sdk/*`, `docs/connect/*`; the registry is
  gated by the connectors it hosts (`smd_connect` + per-connector gates), not its own flag.

---

## 12. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Module-level mutable registry leaks connector/config across tenants on a reused isolate | High | ADR-C3: fresh+frozen per request; no per-request data on the registry; isolation test (§4.1) |
| A non-conforming connector silently reaches the engine | High | Fail-closed `register` (structural) + CI behavioral gate before catalog entry (§4.3); `asConnectorMap` exposes only registered |
| The kit passes a connector that leaks PHI/tokens | High | Checks 8–9 reuse `ALLOW` + a secret sentinel; leaky/fail-open mock connectors are asserted to FAIL in `conformance.test.mjs` |
| Existing connectors regress / need edits | Medium | Proven as-is by `existing-connectors-conform.test.mjs`; abdm handled via `skeleton`/`emitsBundle:false`, no shim |
| Router rewire changes behavior | Medium | Behavior-preserving 2-line swap exposing the same connectors; separate revertable task; owner-gated (D1) |
| "Deterministic ids" check is flaky for time/random-seeded normalizers | Medium | Check normalizes the SAME raw twice within one run; ids must be source-derived (C5) — a random id is a real bug the check should catch |
| Descriptor inference hides a real capability gap | Low | Inference defaults are conservative (event→skeleton, emitsBundle:false); override is one line; D2 lets owner require explicit declaration |

---

## 13. Acceptance criteria

1. `sdk/descriptor.js`: `describe()` derives a valid descriptor from `fhir-r4` (ga/emitsBundle:true) and
   `abdm` (skeleton/emitsBundle:false); `assertDescriptor` rejects malformed/`sccmVersion!=1.0`.
2. `sdk/conformance.js`: profile-aware `runConformance`/`assertConforms` implement checks 1–10; a **leaky**
   mock connector and a **fail-open** mock connector are asserted to FAIL; a clean mock pull and mock event
   connector PASS.
3. `sdk/registry.js`: `register` is fail-closed (refuses non-conforming, duplicate id, `sccmVersion!=1.0`);
   `resolve(id,profile)` throws `UpstreamError` on unknown id and on profile mismatch; two registries share
   no mutable state; `asConnectorMap()` is frozen and contains only registered connectors.
4. `existing-connectors-conform.test.mjs`: `fhir-r4` and `abdm` pass the kit **as-is** (no edits to either
   connector).
5. `docs/connect/connector-sdk.md` covers the 6-step guide + the 10-check checklist + lifecycle table +
   registry usage + do-not list.
6. (If D1 = adopt) the router uses `defaultRegistry().asConnectorMap()`; `router.test.mjs` and the existing
   `/context` tests are unchanged and green (zero behavioral regression).
7. `node --test test/connect/sdk/*.test.mjs` green; full `npm test` green; zero regression; no new dep; no
   new flag; all new files under `sdk/`, `test/connect/sdk/`, `docs/connect/`.
8. Reviewer panel (§10) passes; no DUAL-ADVERSARIAL required.

---

## 14. Relationship to the roadmap

Part-1 §15 places "the Connector SDK (contract + CLI + mock server + conformance suite for third parties)"
in Phase 2. Track C **pulls the registry + conformance kit + descriptor + docs forward** (the load-bearing
extension point), and **explicitly leaves the CLI and standalone mock server in Phase 2** (§0 scope
boundary). Delivering the registry now is what lets Phase-1's ABDM connector and any Phase-2 connector
(SMART/HL7/file) be added without re-touching the engine — which is the entire justification for the track.
