# StewardMD Connect — Part 1: Foundation & Walking Skeleton (Design)

**Date:** 2026-07-31
**Status:** Draft for owner review (no implementation until approved)
**Author:** Claude (acting Principal/Interoperability Architect)
**Supersedes assumptions in:** `~/Downloads/StewardMD Connect Design.rtf` (the product vision doc) where they conflict with the StewardMD stack — see "Reframe" and ADRs.

---

## 1. What StewardMD Connect is (and is not)

StewardMD Connect is the **interoperability and normalization layer** between a hospital's
existing systems and the StewardMD ecosystem. It is **not** an EMR and it is **not** a data
store. Its single job: take clinical data from any supported source and produce one
**canonical, versioned, vendor-neutral clinical model** that MaiK and every StewardMD module
consume — so MaiK never sees a vendor schema and hospitals never replace their EMR.

The architectural spine (from the vision doc, kept intact):

```
Hospital system → Connector → Parser → Normalizer → Validator
                → Canonical Clinical Model → Permission/Consent gate → MaiK / Modules
```

The Canonical Clinical Model is the **anti-corruption layer** (DDD). Everything upstream of it
is vendor-specific and quarantined inside a connector; everything downstream speaks only SCCM
(StewardMD Canonical Clinical Model). This separation is the whole product.

### Locked decisions (owner-approved 2026-07-31)

| Decision | Choice | ADR |
|---|---|---|
| First thing Phase 0 proves | **Generic FHIR R4 read**, then ABDM | ADR-006 |
| PHI handling | **Ephemeral pass-through — no PHI at rest** | ADR-002 |
| Deployment target | **Cloudflare-native only** (clean boundaries for later self-host) | ADR-001 |

---

## 2. The reframe (why this differs from the vision doc)

StewardMD is a **buildless, zero-backend-dependency, Cloudflare-edge** platform: `functions/*.js`
Pages Functions + a `stewardmd-api` Worker + D1/KV/R2 + Firestore, wrapped in Capacitor. It is
**not** a Java/Kubernetes enterprise stack. Several vision-doc items assume the latter. Decisions:

| Vision-doc item | Decision (Part 1) | Rationale |
|---|---|---|
| FHIR R4/R5, SMART on FHIR, ABDM/ABHA | **Core — build** | Native to HTTPS/edge; the bulk of real value, esp. India |
| Canonical Clinical Model + Connector SDK | **Core — build** | The anti-corruption layer; the product |
| HL7 v2 | Phase 2 (lightweight parser) | Real but less common than FHIR for greenfield connections |
| DICOM | Interface only in Phase 1; images via reference, not pixel transport | Pixel data does not belong in an ephemeral edge layer |
| On-prem / air-gapped / hybrid | **Defer** (keep runtime boundaries clean) | Cloudflare is the platform; on-prem is a bespoke sale, not v1 |
| LDAP / Active Directory (direct) | **Defer** — OIDC/SMART SSO instead | Raw LDAP from the edge is a non-starter; OIDC covers real hospitals |
| Direct Postgres/Oracle/SQL Server read replicas | **Defer behind the SDK** | Workers cannot reach a hospital's internal DB; genuinely blocked at the edge |
| GraphQL connector | **Defer** | Almost nonexistent in healthcare |

Cutting these is not lowering ambition — it is refusing to design around one hospital's plumbing,
which is the vision doc's own stated principle.

**Reuse, don't reinvent.** Connect builds on existing primitives, it does not duplicate them:
`identify()` (`_fbauth.js` / `_usage.js`) for identity/org, `ownerOK()` (`_adminauth.js`) for the
admin gate, existing `_entitlements`/`_features` for flags, D1/KV bindings already in
`wrangler.toml`. A Connect **tenant** maps onto the existing org/account concept.

**Additive & reversible.** Everything ships behind flag `smd_connect` (default **OFF**). All new
code lives under new paths (`functions/api/connect/*`, `functions/_connect/*`, `test/connect/*`,
new D1 tables only). Zero change to any existing endpoint, table, or behavior. Rollback = revert
the commit; no migration touches existing data.

---

## 3. Part-1 scope: the Walking Skeleton

The vision doc's Part 1 is "diagrams + interfaces, zero connectors." For a pragmatic team that is
a trap — abstractions that never meet a real server rot. Part 1 here delivers the **same
foundation** but proven end-to-end with **one thin, working connector** (ADR-003, walking
skeleton pattern).

**In scope for Part 1:**
1. **SCCM v1** — the canonical model (6 core resource types below; `Observation` carries both labs
   and vitals) + shared value types + validator.
2. **Connector contract** — the plugin interface + the shared conformance test suite.
3. **ConnectEngine** — the pipeline (auth → permission stub → fetch → normalize → validate →
   permission filter → audit → return), stateless, PHI-ephemeral.
4. **FHIR R4 read connector** — capabilities/auth/fetch against a public FHIR sandbox
   (HAPI `hapi.fhir.org` or the SMART sandbox), plus its FHIR→SCCM normalizer.
5. **MaiK context stub** — a function that hands a `CanonicalBundle` to MaiK's existing context
   input, proving MaiK consumes SCCM only. (No orchestration yet — that is Phase 4.)
6. **Tenant + config + audit** — D1 schema (tenant, connector_config, audit_event), secrets via
   Workers secrets / encrypted KV (never in D1/config/git).
7. **HTTP surface** — `functions/api/connect/[[path]].js`, flag-gated, owner/admin-gated.
8. **Tests + benchmarks** — node `--test` unit + contract + pipeline tests, synthetic fixtures,
   perf harness.
9. **ADRs + docs** — this spec split into `docs/connect/` on implementation.

**Explicitly NOT in Part 1:** real consent workflows (ABDM), SMART/HL7/DICOM connectors,
the onboarding portal UI, RBAC/ABAC beyond a scope allow-list, module orchestration, analytics.
Those are Phases 1–4.

---

## 4. StewardMD Canonical Clinical Model (SCCM) v1

Versioned (`sccmVersion: "1.0"`). Downstream code pins a major version; connectors declare the
version they emit. New fields are additive within a major; breaking changes bump the major and are
adapted at the boundary, isolating downstream from standards churn (ADR-008 goal).

### 4.1 Shared value types

```jsonc
Coding            { "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }
CodeableConcept   { "coding": [Coding, ...], "text": "Hemoglobin" }
Quantity          { "value": 9.2, "unit": "g/dL", "system": "http://unitsofmeasure.org", "code": "g/dL" }  // UCUM
Period            { "start": "2026-07-30T10:00:00Z", "end": null }                     // ISO-8601 UTC
Identifier        { "system": "https://healthid.abdm.gov.in", "value": "…", "type": "ABHA" } // type ∈ ABHA|MRN|…
Reference         { "type": "Encounter", "id": "enc-123" }                              // intra-bundle only
Provenance        { "resource": "Observation", "sourceConnector": "fhir-r4", "sourceId": "Obs/9" } // audit, no PHI
```

Coding systems referenced (values, not full terminologies, in Part 1): LOINC (labs), SNOMED CT +
ICD-10/ICD-11 (conditions), RxNorm/ATC (meds), UCUM (units). Part 1 passes codes **through**
faithfully; it does not do terminology mapping/translation (that is a later, optional service).

### 4.2 Resources (Part 1 set)

Chosen because they are the minimum for a useful MaiK clinical context and are the highest-yield
FHIR resources. Every field is optional unless marked **required**; connectors emit what they have.

```jsonc
Patient {
  "id": "…",                       // required, tenant-scoped opaque id (NOT a raw MRN)
  "identifiers": [Identifier],     // ABHA / MRN etc.
  "name": { "text": "…", "given": ["…"], "family": "…" },
  "gender": "male|female|other|unknown",
  "birthDate": "1975-04-12",
  "deceased": false
  // Deliberately minimal: no address/contact unless a module needs it (minimum-necessary).
}

Encounter {
  "id": "…",                       // required
  "status": "planned|in-progress|finished|cancelled|unknown",
  "class": "IP|OP|ER|VR",          // inpatient/outpatient/emergency/virtual
  "period": Period,
  "reason": CodeableConcept,
  "practitioners": [ { "name": "…", "role": "…" } ]   // display-only in Part 1 (no separate Practitioner resource)
}

Condition {                        // diagnosis / problem
  "id": "…",                       // required
  "code": CodeableConcept,         // required (SNOMED / ICD-10 / ICD-11)
  "clinicalStatus": "active|recurrence|relapse|inactive|remission|resolved|unknown",
  "category": "problem-list-item|encounter-diagnosis",
  "onset": "…", "recordedDate": "…",
  "encounter": Reference
}

MedicationStatement {
  "id": "…",                       // required
  "medication": CodeableConcept,   // required (RxNorm / ATC + text)
  "status": "active|completed|stopped|on-hold|unknown",
  "dosage": { "text": "500 mg PO BID", "route": CodeableConcept, "dose": Quantity, "frequency": "…" },
  "effectivePeriod": Period,
  "reason": [Reference]
}

AllergyIntolerance {
  "id": "…",                       // required
  "code": CodeableConcept,         // required (substance / SNOMED)
  "clinicalStatus": "active|inactive|resolved",
  "criticality": "low|high|unable-to-assess",
  "reactions": [ { "manifestation": [CodeableConcept], "severity": "mild|moderate|severe" } ]
}

Observation {                      // labs AND vitals
  "id": "…",                       // required
  "category": "laboratory|vital-signs",   // required
  "code": CodeableConcept,         // required (LOINC)
  "value": Quantity | { "text": "…" } | CodeableConcept,   // exactly one
  "referenceRange": { "low": Quantity, "high": Quantity, "text": "…" },
  "interpretation": "normal|high|low|critical|abnormal",
  "effectiveDateTime": "…",
  "status": "final|preliminary|amended|entered-in-error|unknown"
}
```

### 4.3 The bundle (what crosses the boundary to MaiK)

```jsonc
CanonicalBundle {
  "sccmVersion": "1.0",
  "tenantId": "…",
  "patient": Patient,                         // required
  "encounters": [Encounter],
  "conditions": [Condition],
  "medications": [MedicationStatement],
  "allergies": [AllergyIntolerance],
  "observations": [Observation],
  "meta": {
    "generatedAt": "…ISO…",
    "sourceConnector": "fhir-r4",
    "scope": ["Patient","Condition","MedicationStatement","AllergyIntolerance","Observation"],
    "provenance": [Provenance],               // per-resource source, for audit
    "warnings": ["…non-fatal normalization notes…"]
  }
}
```

The bundle is produced on demand, handed to MaiK, and **discarded** (ADR-002). It is never written
to D1/R2/KV.

---

## 5. The Connector contract (the plugin boundary)

Every connector — first-party or SDK-built — implements the **same** interface. Dependencies are
**injected** via `ctx` (dependency inversion) so connectors are pure, edge-safe, and unit-testable
with no direct `env` access.

```jsonc
ctx = {
  tenant: { id, settings },
  config: { …non-secret connector config from D1… },
  secrets: async (name) => "…",   // resolves a Workers secret / encrypted-KV value; never logged
  scope: ["Patient","Condition",…],// what this call is authorized to fetch
  now: () => Date,                 // injected clock (deterministic tests)
  fetch: fetch,                    // injected (mockable) HTTP
  audit: (event) => void,          // metadata-only sink; PHI is rejected by the sink
  logger: { warn, error }          // no PHI
}
```

```jsonc
Connector {
  meta: { id, name, version, kinds: ["fhir-r4"], sccmVersion: "1.0" },

  capabilities(ctx)  → Promise<{ resources:[…], operations:[…], authKinds:[…], fhirVersion? }>
      // Standards-based auto-discovery (e.g. FHIR CapabilityStatement). Non-fatal if unavailable.

  authenticate(ctx)  → Promise<{ token, expiresAt } | { ok:true }>
      // Acquire/refresh credentials. Token cached per-tenant in KV with TTL; never persisted plaintext.

  validate(ctx)      → Promise<ValidationReport>
      // Self-test: auth ok? patient/observation/condition reachable? latency? Produces a report;
      // engine refuses activation until it passes (perf target: < 30 s).

  fetchPatient(ctx, patientRef) → Promise<RawBundle>
      // Returns VENDOR-SHAPED raw data for the authorized scope. No normalization here.

  normalize(ctx, raw) → Promise<CanonicalBundle>
      // The anti-corruption map: vendor raw → SCCM. Pure. The ONLY place vendor field names appear.
}
```

`RawBundle` is opaque to the engine — only the connector's own `normalize` understands it. This is
what keeps vendor schemas out of everything downstream.

### Conformance suite (`test/connect/connector-contract.test.mjs`)

A single shared test every connector must pass, run against synthetic fixtures:
- `meta` well-formed; declares a supported `sccmVersion`.
- `authenticate` returns a token/ok and never throws on transient network error (retryable).
- `capabilities` degrades gracefully when discovery is unavailable.
- `fetchPatient` for a known fixture returns a `RawBundle`.
- `normalize(raw)` returns a `CanonicalBundle` that **passes the SCCM validator**.
- Partial/missing source fields → valid bundle with `meta.warnings`, never a crash.
- **No PHI** appears in any `audit`/`logger` call (asserted by scanning emitted events).

Passing this suite is the definition of "a valid connector." The SDK (Phase 2) ships it so third
parties self-certify.

---

## 6. ConnectEngine pipeline

`ConnectEngine.loadPatientContext(env, { tenantId, connectorId, patientRef, scope, actor })
 → Promise<CanonicalBundle>`

1. **Resolve tenant + connector config** from D1 (scoped by `tenantId`; cross-tenant refs refused).
2. **authenticate** (token cached in tenant-scoped KV; refresh on expiry).
3. **Permission/consent gate** (Part 1: enforce `scope ⊆ tenant.grantedScopes` allow-list; real
   consent artifacts = Phase 1/3). Deny → typed error, audited, no fetch.
4. **fetchPatient(scope)** → `RawBundle`.
5. **normalize(raw)** → `CanonicalBundle`.
6. **validate** the bundle (SCCM validator). Hard failures reject; soft issues → `meta.warnings`.
7. **Permission filter** — drop any resource/field outside the granted scope (defense in depth,
   even if a connector over-fetched).
8. **Audit** — emit metadata only: `{ ts, tenantId, actor, connectorId, action, resourceCounts,
   scope, latencyMs, outcome }`. **No PHI, no patient identifiers in cleartext** (patientRef is
   hashed).
9. **Return** the bundle to the caller (MaiK context builder). Nothing is persisted.

Failure handling: typed errors (`AuthError`, `PermissionError`, `UpstreamError`, `ValidationError`),
never silent; connector failure returns a structured error and never crashes MaiK (the context
builder treats "no context" as a valid state).

---

## 7. Multi-tenancy & security architecture

### Tenancy
A **tenant** = a hospital/org, mapped to the existing org/account identity (`identify()`), not a new
identity system. Every D1 row and KV key is tenant-scoped; the engine refuses any reference that
crosses tenants. Secrets, config, audit, and tokens are all isolated per tenant.

### D1 schema (new tables only; dedicated `stewardmd-connect` DB — owner provisions the binding)
```sql
CREATE TABLE connect_tenant (
  id TEXT PRIMARY KEY, name TEXT, status TEXT,        -- active|suspended
  granted_scopes TEXT,                                 -- JSON array (allow-list)
  settings TEXT, created_at TEXT, updated_at TEXT );

CREATE TABLE connect_connector_config (
  tenant_id TEXT, connector_id TEXT, kind TEXT,        -- 'fhir-r4'
  base_url TEXT, config TEXT,                           -- JSON, NON-SECRET only
  secret_ref TEXT,                                      -- name of a Workers secret / KV key; NEVER the secret
  scope TEXT, status TEXT,                              -- draft|validated|active|disabled
  PRIMARY KEY (tenant_id, connector_id) );

CREATE TABLE connect_audit_event (                       -- metadata only, NO PHI
  id TEXT PRIMARY KEY, tenant_id TEXT, ts TEXT, actor TEXT,
  connector_id TEXT, action TEXT, resource_counts TEXT, scope TEXT,
  patient_ref_hash TEXT, latency_ms INTEGER, outcome TEXT );
```
No table stores clinical/patient content — enforced by schema and by the audit sink rejecting PHI-
shaped payloads.

### Security invariants
- **Ephemeral PHI** (ADR-002): patient data lives only in request memory; never written anywhere.
- **Secrets**: only in Workers secrets or encrypted KV; `config`/D1/git never hold a credential; the
  secret scanner (`stewardmd-secret-scan-reviewer`) runs on every Connect PR.
- **Least privilege / consent-first**: fetches are gated by an explicit per-tenant scope allow-list
  (real consent artifacts layer in later); minimum-necessary resource set.
- **Zero trust between layers**: the validator rejects malformed/oversized bundles; the permission
  filter re-checks scope after normalization.
- **Auditability**: every context load and every denial emits a metadata audit event.
- **Tenant isolation**: every query is tenant-scoped; cross-tenant reference = hard error.

---

## 8. HTTP surface (Part 1)

`functions/api/connect/[[path]].js` (mirrors the existing `[[path]].js` router + `onRequest`
pattern), flag-gated (`smd_connect` OFF → 404), owner/admin-gated (`ownerOK`) for config, tenant-
scoped for context:

| Method + path | Purpose | Gate |
|---|---|---|
| `POST /api/connect/tenants` | create/update a tenant | owner |
| `POST /api/connect/connectors` | register/configure a connector (secret via `secret_ref`) | owner |
| `POST /api/connect/connectors/:id/validate` | run connection self-test → report | owner |
| `POST /api/connect/context` | load canonical patient context (ephemeral) | tenant actor + scope |
| `GET  /api/connect/audit` | read audit metadata (no PHI) | owner/auditor |

---

## 9. Folder structure

```
functions/
  api/connect/[[path]].js          # router (flag + admin gated)
  _connect/
    engine.js                      # ConnectEngine pipeline
    interfaces.js                  # JSDoc contracts + runtime shape guards
    permission.js                  # scope/consent gate (Part-1 allow-list; extensible)
    audit.js                       # metadata-only audit sink (rejects PHI-shaped input)
    tenant.js                      # tenant + connector-config resolution (D1); secret_ref → secrets()
    canonical/
      model.js                     # SCCM factories + type guards
      validate.js                  # SCCM validator
      coding.js                    # Coding/CodeableConcept/Quantity(UCUM) helpers
    connectors/
      fhir-r4/
        connector.js               # capabilities/authenticate/validate/fetchPatient
        normalize.js               # FHIR R4 → SCCM
  db/connect_schema.sql            # new D1 tables (additive)
test/connect/
  canonical-model.test.mjs
  fhir-r4-normalize.test.mjs
  engine-pipeline.test.mjs
  connector-contract.test.mjs      # the shared conformance suite
  fixtures/                        # SYNTHETIC / de-identified FHIR responses (no real PHI in git)
docs/connect/
  adr/                             # ADR-001 … ADR-008 (split from §12)
  canonical-model.md               # SCCM reference
  connector-sdk.md                 # contract + how to build a connector (grows in Phase 2)
```

---

## 10. Testing & benchmark strategy

- **Unit** — SCCM factories/validator; coding helpers (UCUM parse, code passthrough); FHIR→SCCM
  normalizer against captured synthetic fixtures (happy path, partial data, missing fields,
  malformed input).
- **Contract** — `connector-contract.test.mjs` (§5) — every connector passes the identical suite.
- **Pipeline** — `engine-pipeline.test.mjs` with a mock connector + injected `fetch`: auth →
  permission (allow & deny) → normalize → validate → filter → audit; asserts **no PHI in audit**,
  ephemeral (nothing persisted), typed errors on each failure mode.
- **Fixtures** — synthetic FHIR bundles only; a guard test fails if a fixture contains a value
  matching common real-PHI patterns.
- **Runner** — `node --test`, wired into the existing `npm test` loop and CI.

### Performance targets (Part 1)
| Metric | Target |
|---|---|
| FHIR → SCCM normalize (typical patient) | < 50 ms CPU |
| End-to-end context load (network-permitting) | < 500 ms |
| Connection validation (onboarding self-test) | < 30 s |
| Concurrency | stateless per request → scales with Workers; no shared mutable state |

A bench harness (`test/connect/bench.mjs`) measures normalize throughput on a fixed fixture set and
prints ops/sec; regressions are visible in review.

---

## 11. Reviewer panel (run after each phase)

Your 9 requested reviewers map onto the existing `.claude/agents/` framework:

| Requested | Agent(s) |
|---|---|
| Architecture | `stewardmd-platform-reviewer` |
| Security | `stewardmd-security-reviewer`, `stewardmd-appsec-reviewer`, `stewardmd-redteam-reviewer`, `stewardmd-secret-scan-reviewer` |
| Performance | `stewardmd-performance-reviewer` |
| API / Data | `stewardmd-dataflow-reviewer` |
| Database | (schema reviewed within platform + dataflow) |
| Testing | `stewardmd-preprod-reviewer` |
| Compliance | `stewardmd-dpdp-reviewer`, `stewardmd-hipaa-reviewer` |
| Clinical correctness | `stewardmd-clinical-reviewer` (SCCM semantics) |

For Part 1 the design itself is reviewed by **platform + security + dpdp/hipaa** before
implementation; the full panel runs on the implemented code.

---

## 12. Architecture Decision Records (summary)

- **ADR-001 — Cloudflare-native runtime.** Build on Pages Functions/Worker/D1/KV/R2. Keep runtime
  boundaries clean (injected `ctx`, no direct `env` in connectors) so a portable node runtime is
  possible later. *Rejected:* build a portable/on-prem runtime now (large infra + test cost before
  a single connection; no current demand).
- **ADR-002 — Ephemeral pass-through PHI.** Connect persists no patient data; only audit metadata,
  tenant config, and field mappings. *Rejected:* cache normalized PHI (larger breach/retention/DPDP
  surface from day one; caching becomes an explicit per-tenant opt-in later).
- **ADR-003 — Canonical-model-first + walking skeleton.** Define SCCM + the connector contract, and
  prove them with one real read-only FHIR connector end-to-end. *Rejected:* paper-only foundation
  (abstractions rot without contact with a real server); *rejected:* connector-first (produces
  one-off integrations, the exact failure mode to avoid).
- **ADR-004 — Uniform injected connector contract.** One interface, dependencies injected via `ctx`.
  Enables purity, edge-safety, testability, and a third-party SDK.
- **ADR-005 — Reuse existing identity/tenant/flags.** `identify`, `ownerOK`, `_entitlements`,
  `_features`, existing D1/KV. *Rejected:* a parallel auth/tenant system.
- **ADR-006 — FHIR-first, then ABDM.** Prove the abstraction cheaply on public FHIR sandboxes before
  the ABDM crypto/consent workstream. *Rejected:* ABDM-first (front-loads ECDH + async consent
  webhooks before the model is validated).
- **ADR-007 — Flag-gated, additive rollout.** `smd_connect` default OFF; new paths/tables only; zero
  regression; rollback = revert.
- **ADR-008 — SCCM is versioned; standards isolated at the boundary.** Downstream pins a major
  version; standard/version upgrades (R4→R5, ABDM profile changes) are absorbed in connectors, not
  propagated to MaiK/modules.

---

## 13. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| PHI accidentally persisted/logged | High | Ephemeral-by-design; audit sink rejects PHI shapes; secret+dpdp reviewers on every PR; fixture PHI-pattern guard |
| Over-abstracting the connector interface | Medium | Walking skeleton forces the interface to satisfy one real connector before generalizing |
| SCCM v1 misses a field a module needs | Medium | Additive within a major version; `meta.warnings` surfaces gaps; start from the 7 highest-yield resources |
| Public FHIR sandbox instability during dev | Low | Captured synthetic fixtures make tests deterministic and offline |
| Scope creep from the vision doc (on-prem/LDAP/DB) | Medium | Explicit defer table (§2) + ADRs; interface stubs only |
| Cloudflare edge limits (CPU time, subrequests) | Low/Med | Minimum-necessary fetch; measured in the bench harness; large exports deferred to a queued path later |

---

## 14. Part-1 acceptance criteria

Part 1 is done when:
1. SCCM v1 + validator exist with tests (happy/partial/malformed).
2. The FHIR R4 connector passes the shared conformance suite against synthetic fixtures.
3. `ConnectEngine.loadPatientContext` returns a valid `CanonicalBundle` end-to-end for a sandbox
   patient, with permission allow/deny both tested.
4. A MaiK context stub consumes the bundle (SCCM only; no vendor fields reach MaiK).
5. Nothing persists PHI; audit events carry metadata only (asserted by tests).
6. All new code is behind `smd_connect` (OFF); `npm test` green; zero regression to existing tests.
7. platform + security + dpdp/hipaa reviewers pass on the implementation.

---

## 15. Roadmap (Parts → Phases)

- **Phase 0 (this spec)** — Foundation + FHIR R4 walking skeleton.
- **Phase 1** — ABDM: ABHA onboarding, consent-request init + webhook, ECDH X25519 payload
  crypto, HIP/HIU FHIR bundle ingest → SCCM. (Sandbox V3.)
- **Phase 2** — SMART on FHIR, HL7 v2 (lightweight), file imports (CSV/JSON), the Connector SDK
  (contract + CLI + mock server + conformance suite shipped for third parties).
- **Phase 3** — Enterprise: self-service onboarding portal, RBAC/ABAC, per-tenant consent, tenant
  isolation hardening, audit search/export, monitoring dashboard.
- **Phase 4** — MaiK orchestration: unified context engine, clinical timeline, module orchestrator,
  proactive alerts, analytics (operational only, never trains on PHI).

Each phase: implemented → tested → benchmarked → reviewed (panel) → documented, before the next.
