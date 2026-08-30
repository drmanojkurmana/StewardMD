# StewardMD Connect — Track C: Connector SDK + Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task is test-first (write the failing `node --test` spec, watch it fail, implement, watch it pass). Steps use checkbox (`- [ ]`) syntax for tracking. **This plan file contains NO implementation/test code — it specifies signatures, shapes, and assertions; the executing worker writes the code per task.**

**Goal:** Formalize the ad-hoc Phase-0/1 connector wiring into a documented, testable **Connector SDK** — a per-request connector **registry** (register/resolve, fail-closed), a profile-aware **conformance kit** (SCCM-valid, deterministic ids, no-PHI, fail-closed), a **lifecycle/capability descriptor**, and **developer docs** — so a new connector is pluggable **without touching the engine**, and the two existing connectors (`fhir-r4`, `abdm`) pass the kit **as-is**.

**Architecture:** New pure ES-module code under `functions/_connect/sdk/*`, unit-tested with `node --test`. Reuses `interfaces.js` (`assertConnector`, `makeCtx`), `canonical/validate.js` (`validateBundle`), `audit.js` (`ALLOW`), `permission.js` (`UpstreamError`). The registry produces the plain `deps.connectors` map the engine already consumes (`engine.js` unchanged). One optional, behavior-preserving router edit (Task 5) is the only existing-file touch. Additive; **no new flag** (gated by the connectors it hosts). See `docs/superpowers/specs/2026-08-01-connect-sdk-design.md`.

**Tech Stack:** Plain ES modules (no build, no TypeScript), `node:test` + `node:assert/strict`, Cloudflare Pages Functions runtime semantics. **No new npm dependencies.**

## Global Constraints

- **No new dependencies; buildless; plain ES modules; `node --test`.** (spec §1)
- **Additive-only.** New files under `functions/_connect/sdk/*`, `test/connect/sdk/*`, `docs/connect/*`. The **only** existing-file edit is the optional router rewire (Task 5), and it is behavior-preserving and owner-gated (D1). No edit to `engine.js`, `interfaces.js`, `validate.js`, `audit.js`, `model.js`, or either connector. (spec §1, §6.2)
- **No behavior change to existing connectors.** `fhir-r4` and `abdm` pass the new kit as-is (Task 6 proves it). No shim. (spec §5.4)
- **Reuse, don't fork.** Import `assertConnector`/`makeCtx` from `interfaces.js`, `validateBundle` from `canonical/validate.js`, `ALLOW` from `audit.js`, `UpstreamError` from `permission.js`. Do not copy them. (ADR-C5)
- **Fail-closed registration.** A non-conforming/duplicate/`sccmVersion!=1.0` connector is refused at `register()`; an unknown id at `resolve()`/via the map throws `UpstreamError`. Never silently used. (spec §4.3)
- **Per-request, no global mutable state.** The only module-level state is the frozen built-in catalog (immutable code refs). `createRegistry()`/`defaultRegistry()` return fresh, frozen instances; `asConnectorMap()` is frozen. No per-request connector/config/token/bundle is stored on the registry. (ADR-C3, Part-1 C11)
- **No crypto in this track → NO task is DUAL-ADVERSARIAL.** (spec §1)
- **Owner `// VERIFY` defaults** (spec §9): D1 adopt-router-now, D2 infer-descriptor-defaults, D3 CI-gates-behavioral, D4 reuse-`UpstreamError`+add-`ConformanceError`, D5 ship-internal-stable. The plan proceeds on these; the owner can override before merge.

---

## File structure

```
functions/_connect/sdk/
  descriptor.js      # Task 1 — describe(connector) + assertDescriptor(d)
  conformance.js     # Task 2 — runConformance/assertConforms (profile-aware) + ConformanceError
  registry.js        # Task 3 — createRegistry + Registry{register,resolve,has,list,asConnectorMap}
  catalog.js         # Task 4 — frozen built-in list + defaultRegistry()
  index.js           # Task 4 — public export barrel
test/connect/sdk/
  descriptor.test.mjs                    # Task 1
  conformance.test.mjs                   # Task 2
  registry.test.mjs                      # Task 3
  catalog.test.mjs                       # Task 4
  existing-connectors-conform.test.mjs   # Task 6
docs/connect/
  connector-sdk.md                       # Task 7
```

(Router rewire in Task 5 touches the one existing file `functions/api/connect/[[path]].js`.)

---

### Task 1: Lifecycle / capability descriptor

**Files:** create `functions/_connect/sdk/descriptor.js`; test `test/connect/sdk/descriptor.test.mjs`.

**Interfaces (produce):**
- `describe(connector) -> ConnectorDescriptor` — builds the descriptor from `connector.meta`, applying the inference defaults (spec §3.1): pull → `lifecycle:"ga"`, `emitsBundle:true`; event → `lifecycle:"skeleton"`, `emitsBundle:false`; both overridable via `meta.lifecycle` / `meta.capabilities`.
- `assertDescriptor(d) -> void` — shape guard; throws on a missing/mistyped field, `profile ∉ {pull,event}`, or `sccmVersion !== "1.0"` (mirrors `assertConnector` strictness).
- Descriptor shape per spec §3 (id, name, version, profile, kinds, sccmVersion, lifecycle, capabilities{resources,operations,authKinds,eventTypes,emitsBundle}).

**Consumes:** nothing (reads `connector.meta` only; may optionally call a connector's synchronous `capabilities` shape but must not require network).

- [ ] **Step 1 — Write failing tests.** Assert: `describe(fhirR4Connector)` yields `profile:"pull"`, `lifecycle:"ga"`, `capabilities.emitsBundle === true`; `describe(abdmConnector)` yields `profile:"event"`, `lifecycle:"skeleton"`, `emitsBundle === false`; a `meta.lifecycle`/`meta.capabilities` override wins over the default; `assertDescriptor` throws on `sccmVersion:"2.0"`, on `profile:"push"`, and on a missing `id`. (Import the two real connectors read-only; do not modify them.)
- [ ] **Step 2 — Run, confirm fail** (`node --test test/connect/sdk/descriptor.test.mjs`) — module not found.
- [ ] **Step 3 — Implement `descriptor.js`** per the signatures above. Pure; no `env`, no fetch, no global state.
- [ ] **Step 4 — Run, confirm pass.**
- [ ] **Step 5 — Commit.** `feat(connect-sdk): connector lifecycle/capability descriptor (describe + assertDescriptor)`.

**Acceptance:** spec §13.1.

---

### Task 2: Profile-aware conformance kit

**Files:** create `functions/_connect/sdk/conformance.js`; test `test/connect/sdk/conformance.test.mjs`.

**Interfaces (produce):**
- `runConformance(connector, opts?) -> { passed, checks:[{name,ok,detail}], descriptor }` — a **superset** of `interfaces.runConformance`, dispatching on `descriptor.profile`. Implements checks 1–10 (spec §5.1). Checks 6 (normalize→valid SCCM) and 7 (deterministic ids) run **only when `descriptor.capabilities.emitsBundle`**.
- `assertConforms(connector, opts?) -> void` — throws `ConformanceError` (new; extends `Error`, defined here) enumerating failed checks. Used by `register(strict)` behavioral opt-in and by CI/self-cert.
- `opts`: `{ fixtures:{patientRef, raw, rawEvent}, fetch }` — **synthetic only**.

**Consumes:** `makeCtx`, `assertConnector` (interfaces.js); `validateBundle` (canonical/validate.js); `ALLOW` (audit.js); `describe`/`assertDescriptor` (Task 1); `UpstreamError`/`AuthError` (permission.js).

**Check implementation notes (spec §5):**
- **3 authenticate-retryable:** call `authenticate` with a `ctx.fetch` that rejects; a typed return/`AuthError` is OK, an uncontrolled throw fails the check.
- **6 normalize→valid SCCM:** `validateBundle(await normalize(ctx, raw)).ok === true`.
- **7 deterministic ids:** normalize the SAME `raw` twice → identical multiset of `{type,id}`; and normalize under two different `tenantId`s → same id-set (ids are source-derived, not tenant-salted, C5).
- **8 no-PHI-in-audit:** reuse the existing mechanism — every recorded `ctx.audit` event has only `ALLOW` keys.
- **9 no-secret-in-logs/errors:** inject `secrets` returning a unique sentinel; assert the sentinel appears in no `logger.warn/error` argument and no thrown `.message`.
- **10 fail-closed on upstream error:** with a rejecting `fetch`, the connector throws a typed error OR degrades to `meta.warnings` — never returns a partial-as-complete bundle, never leaks the raw error/stack.

- [ ] **Step 1 — Write failing tests.** Provide four in-test mock connectors (do not ship them): (a) a clean **pull** connector → `passed === true`; (b) a clean **event** skeleton connector (`emitsBundle:false`, `ingest` → `{handle,bundle:null}`) → `passed === true` with checks 6–7 marked skipped/not-applicable; (c) a **leaky** connector that calls `ctx.audit({patientName})` → check 8 fails, `passed === false`; (d) a **fail-open** connector whose `fetchPatient` swallows a rejecting fetch and returns a partial bundle → check 10 fails. Also assert `assertConforms` throws `ConformanceError` for (c)/(d) and lists the failing check names.
- [ ] **Step 2 — Run, confirm fail.**
- [ ] **Step 3 — Implement `conformance.js`** (profile dispatch, the 10 checks, `ConformanceError`). Reuse imports; add no dependency.
- [ ] **Step 4 — Run, confirm pass.**
- [ ] **Step 5 — Commit.** `feat(connect-sdk): profile-aware conformance kit (SCCM-valid, deterministic ids, no-PHI/secret, fail-closed)`.

**Acceptance:** spec §13.2.

---

### Task 3: The registry (fail-closed, per-request, no global state)

**Files:** create `functions/_connect/sdk/registry.js`; test `test/connect/sdk/registry.test.mjs`.

**Interfaces (produce):**
- `createRegistry(opts?) -> Registry` — `opts.strict?` (default true) gates whether `register` runs the fast structural gate (it always runs `assertConnector`+`assertDescriptor`+sccmVersion+dup-check; `strict` may additionally reserve a hook for a synchronous descriptor-level check — **not** the async behavioral kit, which stays in CI, spec §4.3). Fresh instance, no shared state.
- `Registry.register(connector) -> Registry` — fail-closed: any throw refuses the connector (not added); chainable on success. Refuses duplicate `id`, `sccmVersion!=1.0`, structural non-conformance.
- `Registry.resolve(id, profile?) -> Connector` — throws `UpstreamError` on unknown id (matches `engine.js` today) and on `profile` mismatch.
- `Registry.has(id) -> boolean`.
- `Registry.list() -> ConnectorDescriptor[]` — descriptors only; never the connector code, never secrets.
- `Registry.asConnectorMap() -> frozen { [id]: connector }` — the engine-compat bridge; contains only registered (conformant) connectors; `Object.freeze`d.

**Consumes:** `assertConnector` (interfaces.js); `describe`/`assertDescriptor` (Task 1); `UpstreamError` (permission.js); optionally `ConformanceError` (Task 2) — see D4.

- [ ] **Step 1 — Write failing tests.** Assert: `register` accepts a clean connector and refuses (throws) a broken one (missing method), a duplicate id, and `sccmVersion:"2.0"`; `resolve("nope")` throws `UpstreamError`; `resolve(id,"event")` on a pull connector throws; `asConnectorMap()` is frozen (`Object.isFrozen`) and mutating it throws in strict mode / is a no-op; **isolation:** build registry A, register X; build registry B; assert B does not have X and the two share no mutable structure (mutating A's index does not affect B); `list()` returns descriptors, not connector functions.
- [ ] **Step 2 — Run, confirm fail.**
- [ ] **Step 3 — Implement `registry.js`.** Internal `Map` created **inside** `createRegistry` (never at module scope). No caching of anything but `id → connector`. Freeze the map returned by `asConnectorMap()`.
- [ ] **Step 4 — Run, confirm pass.**
- [ ] **Step 5 — Commit.** `feat(connect-sdk): per-request connector registry (fail-closed register/resolve, frozen map, no global state)`.

**Acceptance:** spec §13.3.

---

### Task 4: Built-in catalog + `defaultRegistry()` + public barrel

**Files:** create `functions/_connect/sdk/catalog.js`, `functions/_connect/sdk/index.js`; test `test/connect/sdk/catalog.test.mjs`.

**Interfaces (produce):**
- `catalog.js`: `BUILTIN = Object.freeze([ fhirR4Connector, abdmConnector ])` (immutable module const — code refs only, no per-request data); `defaultRegistry() -> Registry` — builds a **fresh** registry per call, registers each built-in fail-closed, returns it frozen.
- `index.js`: re-export `describe`, `assertDescriptor`, `runConformance`, `assertConforms`, `ConformanceError`, `createRegistry`, `defaultRegistry` — the single import surface (spec §5/§7).

**Consumes:** the two real connectors (read-only import); `createRegistry` (Task 3).

- [ ] **Step 1 — Write failing tests.** Assert: `defaultRegistry().has("fhir-r4") && has("abdm")`; `resolve("fhir-r4").meta.profile === "pull"` and `resolve("abdm").meta.profile === "event"`; two `defaultRegistry()` calls return **distinct** instances (per-request isolation); `asConnectorMap()` has exactly the two ids; `index.js` re-exports the expected symbols.
- [ ] **Step 2 — Run, confirm fail.**
- [ ] **Step 3 — Implement `catalog.js` + `index.js`.** `defaultRegistry` builds fresh each call; no module-level registry instance.
- [ ] **Step 4 — Run, confirm pass.**
- [ ] **Step 5 — Commit.** `feat(connect-sdk): built-in connector catalog + defaultRegistry + public barrel`.

**Acceptance:** contributes to spec §13.3/§13.7.

---

### Task 5: Router adoption — feed the engine from the registry (D1; behavior-preserving)

> Owner-gated by D1 (spec §9). If the owner defers adoption, skip this task — the SDK is fully usable/tested without it. If adopting, this is the **only** existing-file edit and it is behavior-preserving.

**Files:** edit `functions/api/connect/[[path]].js` (the `/context` `deps` construction only); the existing `test/connect/router.test.mjs` and `test/connect/scaffold.test.mjs` must remain green **unchanged** (that is the regression proof).

**Change:** replace the inline `connectors: { "fhir-r4": fhirR4Connector }` with `connectors: defaultRegistry().asConnectorMap()` (called per request — fresh/frozen). The `/context` path continues to resolve `fhir-r4` identically; `abdm` becomes available to the event path via the same conformance-gated map. No route, status code, or response shape changes.

- [ ] **Step 1 — Confirm the guard tests exist and pass BEFORE the edit** (`node --test test/connect/router.test.mjs test/connect/scaffold.test.mjs`) — baseline green.
- [ ] **Step 2 — Make the two-line swap** (import `defaultRegistry` from `../../_connect/sdk/index.js`; build `connectors` from it). Do not change identity/scope/error handling.
- [ ] **Step 3 — Re-run the same guard tests unchanged** — still green (zero behavioral regression). If any test needed editing to pass, STOP: the change was not behavior-preserving.
- [ ] **Step 4 — Run the full connect suite** (`node --test test/connect/*.test.mjs test/connect/**/*.test.mjs`) — green.
- [ ] **Step 5 — Commit.** `refactor(connect): router resolves connectors via the SDK registry (behavior-preserving)`.

**Acceptance:** spec §13.6.

---

### Task 6: Prove the existing connectors conform **as-is**

**Files:** test `test/connect/sdk/existing-connectors-conform.test.mjs`. **No connector edits.**

- [ ] **Step 1 — Write the test.** Import `fhirR4Connector` and `abdmConnector` read-only + `runConformance` (Task 2) + the existing synthetic fixtures (`test/connect/fixtures/fhir-synthetic.mjs`; an NDHM-synthetic fixture from `test/connect/abdm/fixtures/` for the event path). Assert: `runConformance(fhirR4Connector, {fixtures, fetch})` → `passed === true` (checks 1–10, with 6–7 active). Assert: `runConformance(abdmConnector, {fixtures})` → `passed === true`, with checks 6–7 reported as **skipped** (`emitsBundle:false`) and 1–5, 8–10 green. Add an explicit assertion/comment that neither connector file was modified (the "as-is" claim).
- [ ] **Step 2 — Run.** If either fails, do **not** edit the connector first — diagnose whether it is a real kit bug (fix the kit) vs a genuine connector defect (escalate; the spec claims as-is, so a real defect is a finding for the owner, per D2). Record the outcome.
- [ ] **Step 3 — Confirm pass.**
- [ ] **Step 4 — Commit.** `test(connect-sdk): prove fhir-r4 (pull) and abdm (event skeleton) conform as-is`.

**Acceptance:** spec §13.4.

---

### Task 7: Developer docs

**Files:** create `docs/connect/connector-sdk.md` (slot reserved in Part-1 §9).

**Contents (spec §8):** concepts (injected `ctx`, two profiles, SCCM-only, ephemeral/PHI-free); "write a connector in 6 steps"; the 10-check conformance checklist with one-line rationales; the lifecycle table (`experimental→skeleton→beta→ga→deprecated`); registry usage (`defaultRegistry().asConnectorMap()` for the engine, `resolve(id,profile)` direct, per-request/no-global rule, fail-closed semantics); a "do-not" list (no global caching of tokens/config/PHI; never audit/log outside `ALLOW`; never emit vendor fields downstream; never `mode:live` without consent — cross-ref Part-1 C6/C7).

- [ ] **Step 1 — Write the doc** per §8; no em-dash in prose (repo convention); reference real symbol names from the SDK.
- [ ] **Step 2 — Cross-check** every referenced symbol/path against the shipped `sdk/*` files (no drift).
- [ ] **Step 3 — Commit.** `docs(connect): connector SDK developer guide`.

**Acceptance:** spec §13.5.

---

### Final: full-suite + review

- [ ] `node --test test/connect/sdk/*.test.mjs` green.
- [ ] `npm test` green (existing suite unaffected — additive; the only existing-file edit, Task 5, is behavior-preserving and its guard tests are unchanged).
- [ ] Confirm: no new dependency (unchanged `package.json` deps), no new flag, all new files under `sdk/`, `test/connect/sdk/`, `docs/connect/`.
- [ ] Run the reviewer panel (spec §10): platform, appsec, redteam, preprod, dataflow. **No DUAL-ADVERSARIAL** (no crypto surface).

---

## Self-review

**Spec coverage** — descriptor + inference defaults (T1), profile-aware conformance with all 10 checks incl. deterministic-ids and no-PHI/no-secret and fail-closed (T2), fail-closed per-request registry with frozen map + no global state (T3), built-in catalog + `defaultRegistry` + barrel (T4), behavior-preserving router adoption gated by D1 (T5), existing-connectors-pass-as-is proof (T6), developer docs (T7). Every spec §13 acceptance criterion maps to a task (13.1→T1, 13.2→T2, 13.3→T3/T4, 13.4→T6, 13.5→T7, 13.6→T5, 13.7→Final, 13.8→Final).

**Constraint check** — additive (only new `sdk/*`, `test/connect/sdk/*`, `docs/connect/*`; the single existing-file edit is Task 5, optional + behavior-preserving); reuse (`assertConnector`/`makeCtx`/`validateBundle`/`ALLOW`/`UpstreamError` imported, not forked); fail-closed (register + resolve + two-layer, §4.3); per-request/no-global-state (T3/T4 isolation tests, ADR-C3); no new dep; no new flag; NO code/tests written in this plan file (signatures + assertions only).

**No-shim claim** — abdm passes as an event `skeleton` (`emitsBundle:false`) because checks 6–7 are conditional; T6 proves it and T2 exercises the skeleton path with a mock, so the claim is tested twice, not assumed. If T6 surfaces a real abdm defect, the plan routes it to the owner (D2) rather than silently editing the connector.

**DUAL-ADVERSARIAL** — none. No task touches cryptography, signatures, or key handling (the SDK reuses non-crypto `validateBundle`/`ALLOW`). Security-relevant checks (no-PHI, fail-closed) are gate/test logic covered by the normal panel.

**Owner-decision gates** — D1 (router adoption) is isolated in T5 so deferral costs nothing; D2 (infer vs declare) and D4 (error types) are defaulted with a one-line override path; D3/D5 are policy, not blockers. All are called out in-task where they bite.

## Task count

**7 tasks** (T5 owner-gated by D1; skippable without affecting the rest). **DUAL-ADVERSARIAL tasks: none.**
