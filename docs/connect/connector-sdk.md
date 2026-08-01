# StewardMD Connect — Connector SDK

The Connector SDK formalizes the Phase-0/1 connector wiring into a documented, testable surface so a new
connector is pluggable **without touching the engine**. It is pure ES modules under
`functions/_connect/sdk/*`, no new dependency, no new flag (a connector is gated by whatever hosts it).

## Concepts

- **Injected `ctx`.** A connector never sees `env`, the master key, or a raw binding. The engine (the
  composition root) hands it a `ctx`: `{ tenant, config, secrets(name), scope, now, fetch, audit, logger,
  budget }` (see `interfaces.js#makeCtx`). This keeps connectors pure and edge-safe.
- **Two profiles.** `pull` (synchronous, e.g. FHIR/SMART) implements `capabilities/authenticate/validate/
  fetchPatient/normalize`. `event` (async push, e.g. ABDM/HL7) implements `authenticate/validate/initiate/
  ingest/normalize`. `assertConnector` (reused) enforces the method set per profile.
- **SCCM only.** A connector's `normalize` is the anti-corruption map: the ONLY place vendor fields appear.
  Everything downstream (MaiK, modules) consumes the canonical SCCM bundle, never a vendor schema.
- **Ephemeral, PHI-free.** The bundle + patient ref live only in request memory. Audit events carry only
  the `ALLOW`-listed metadata keys (`audit.js#ALLOW`); the patient ref is an HMAC pseudonym.

## Write a connector in 6 steps

1. Pick a profile (`pull` or `event`) and declare `meta = { id, name, version, profile, kinds, sccmVersion:"1.0" }`.
2. Implement the profile's methods against the injected `ctx` (no `env`, no globals, no module-level cache).
3. Write `normalize(ctx, raw) -> CanonicalBundle` using the `canonical/*` factories; every coded field gets a
   `text` fallback; emit **stable, source-derived** resource ids (not tenant-salted); resolve intra-bundle
   references or null them.
4. Fail closed: on an upstream error, throw a typed error (`UpstreamError`/`AuthError`) OR degrade to
   `bundle.meta.warnings`. Never return a complete-looking bundle on failure; never leak a secret/stack.
5. Run the conformance kit: `assertConforms(myConnector, { fetch, fixtures })` with synthetic fixtures.
6. Register it: `createRegistry().register(myConnector)` (or add it to `catalog.js#BUILTIN`).

## The 10-check conformance kit (`sdk/conformance.js`)

`runConformance(connector, opts) -> { passed, checks, descriptor }`; `assertConforms(...)` throws
`ConformanceError` listing the failed checks. Profile-aware; checks 6 and 7 run only when
`descriptor.capabilities.emitsBundle`.

| # | Check | Why |
|---|---|---|
| 1 | contract | methods per profile + `sccmVersion:"1.0"` (via `assertConnector`/`assertDescriptor`) |
| 2 | authenticate | does not throw uncontrolled on a healthy `ctx` |
| 3 | authenticate-retryable | a rejecting `fetch` yields a typed error or resolves, never an uncontrolled throw |
| 4 | capabilities (pull) | returns a capability object, degrades gracefully |
| 5 | validate | returns a report object without throwing |
| 6 | normalize -> valid SCCM | `validateBundle(normalize(...)).ok` (emits only) |
| 7 | deterministic ids | same input -> same ids; ids do not change by tenant (source-derived, not salted) (emits only) |
| 8 | no PHI in audit | every `ctx.audit` event has only `ALLOW` keys |
| 9 | no secret in logs/errors | an injected secret sentinel appears in no log/error/stack |
| 10 | fail-closed on upstream error | a rejecting `fetch` -> typed throw or a degraded/null bundle, never a complete bundle with no warnings |

## Lifecycle

`experimental -> skeleton -> beta -> ga -> deprecated`. Inferred by `describe(connector)`: `pull` defaults
to `ga` + `emitsBundle:true`; `event` defaults to `skeleton` + `emitsBundle:false`. Override via
`meta.lifecycle` / `meta.capabilities`. An event `skeleton` (e.g. `abdm` today) emits no bundle, so
conformance checks 6-7 are skipped, not failed.

## Registry usage (`sdk/registry.js`, `sdk/catalog.js`)

- **Engine wiring:** `defaultRegistry().asConnectorMap()` produces the frozen `{ id: connector }` map the
  engine's `deps.connectors` consumes. Call it **per request** (fresh + frozen; no global state).
- **Direct resolve:** `registry.resolve(id, profile?)` throws `UpstreamError` on an unknown id or a profile
  mismatch (matching the engine's existing behavior). `has(id)`, `list()` (descriptors only).
- **Fail-closed registration:** `register()` refuses a structurally non-conforming connector, a duplicate
  id, or `sccmVersion != "1.0"`; any throw means the connector is not added. Two-layer: this fast structural
  gate at `register()`, plus the full behavioral kit (`assertConforms`) at build/CI time.
- **Per-request, no global state:** the internal map is created inside `createRegistry()`; two registries
  share nothing; `asConnectorMap()` is `Object.freeze`d.

## Do-not list

- Do not cache tokens, config, or PHI in a module-level/global variable (Workers isolates are reused).
- Do not write anything outside `ALLOW` to `ctx.audit`, and never log a secret, token, or patient value.
- Do not emit vendor fields downstream; `normalize` is the only place a vendor schema exists.
- Do not fetch a `mode:"live"` source without a consent artifact (Part-1 C6/C7); the sandbox-only gate is
  the technical enforcement.
