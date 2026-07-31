# StewardMD Connect — Part 1: Foundation & Walking Skeleton (Design)

**Date:** 2026-07-31
**Revision:** v1.1 (revised after architecture + security/DPDP/HIPAA design reviews)
**Status:** Draft for owner review (no implementation until approved)
**Author:** Claude (acting Principal/Interoperability Architect)
**Supersedes assumptions in:** `~/Downloads/StewardMD Connect Design.rtf` where they conflict with the StewardMD stack — see "Reframe" and ADRs.

---

## 0. Revision v1.1 — what changed after review (changelog)

Two design reviews (architecture; security + DPDP/HIPAA) ran against v1.0. Every accepted
finding is folded in below. Summary of the material changes:

| # | Change | Addresses |
|---|---|---|
| C1 | **Two connector capability profiles** — `pull` (FHIR/SMART, synchronous) **and** `event/push` (ABDM/HL7/file, async) — defined now; a signature-gated **ingress route** reserved. Phase 0 implements only `pull`. | Arch-1 |
| C2 | **ADR-002 reframed**: "no clinical-PHI *content* at rest **by default**" (Phase-0 posture), not "no state at rest ever." Consent artifacts, ECDH keys, correlation, and a transient push buffer are non-clinical state that *will* need a durable home (Durable Object) in Phase 1; a flag-gated, consent-scoped, retention-bounded context/timeline store is reserved as the Phase-4 boundary. | Arch-2, Sec-2/10 |
| C3 | **Identity/tenant model made real.** There is *no* org/tenant entity in the code today and `identify()` exists in two forms — corrected. Connect adds `connect_membership(user_id, tenant_id, role)` + `resolveTenant(actor)`; the canonical `identify()` is `_usage.js` (object form). `tenantId`/`actor` are **derived server-side**, never from the request body. | Arch-3, Sec-5 |
| C4 | **SCCM v1 expanded** to 8 resources (+ `DiagnosticReport`, `DocumentReference` by-reference/narrative) — ABDM's core payloads are FHIR Documents. Added `origin: order\|statement\|dispense` to medications. | Arch-5 |
| C5 | **Semantic anti-corruption rules** in SCCM: every coded field MUST carry a `text` fallback; `Coding` is tagged `standard\|local`; downstream MUST NOT use `provenance.sourceId` as a join/identity key; intra-bundle `Reference`s must resolve-in-bundle-or-be-nulled; connectors MUST emit **stable, deterministic resource ids** (enables future timeline merge). | Arch-4, Arch-2 |
| C6 | **Sandbox-only is a hard, enforced invariant** (not an assumption). Per-tenant `mode: sandbox\|live`; the engine refuses any `base_url` not on a synthetic-sandbox allow-list while consent is absent, and refuses `mode: live` until a consent artifact exists (Phase 1). This is what makes "defer consent" defensible. | Sec-1 |
| C7 | **The MaiK hand-off is where the ephemeral guarantee ends** — stated explicitly and gated. Part-1's MaiK stub is fed synthetic data only; a documented control blocks real-patient bundles from reaching MaiK's LLM egress (Vertex/Gemini) until a no-retention/no-training provider tier + BAA/DPA are signed off. | Sec-2 |
| C8 | **Audit is PHI-free by construction**: events are built field-by-field from a fixed allow-list and the sink serializes only those named fields (never the bundle / an arbitrary object). The prior "reject PHI-shaped input" heuristic is demoted to a secondary test. Audit table is **append-only** (no UPDATE/DELETE path). | Sec-3, Sec-10 |
| C9 | **`patientRefHash` = per-tenant keyed HMAC** (salt in Workers secrets), documented as an access-controlled tenant-scoped **pseudonym** (still personal data), not "de-identified." Prevents brute-force reversal and cross-tenant linkage. | Sec-4, Arch-7 |
| C10 | **Secrets, precisely.** "Encrypted KV" = **envelope encryption** (AES-GCM; master key in Workers secrets; **fail-closed** if key missing). Split: Workers secrets for global secrets (master key, HMAC salt); envelope-encrypted KV for per-tenant connector credentials. `base_url` must be `https` with **no `userinfo`** component. Dedicated KV namespace `connect:*`; tenant ids restricted to `[a-z0-9-]`. | Sec-6, Sec-8 |
| C11 | **Fail-closed everywhere it matters.** The permission/consent gate denies on *any* error (the house KV default is fail-*open* — explicitly not copied here). Per-upstream timeout + bounded retry/circuit-breaker. Per-resource pagination cap + subrequest/wall-time budget on the edge. **No module-level/global caching** of PHI/tokens/config (Workers isolates are reused). | Arch-6/7, Sec-11 |
| C12 | **Transport + errors.** Context endpoint reuses the `/api/ghis` PHI-transport posture (`Cache-Control: no-store`); errors carry codes + non-PHI context only, a top-level catch sanitizes before the platform logger, no `console.*` in the shipped path. Fixtures are **synthetic (Synthea/SMART)** — never captured from public `hapi.fhir.org`. | Sec-7, Sec-9, Sec-11 |
| C13 | **DPDP role stated**: for a pull from a hospital EMR the **hospital is the Data Fiduciary and StewardMD Connect is a Data Processor** — requires a processor contract and shapes who owes consent/notice. Data inventory + India data-residency posture documented. | Sec-10, Sec-deferred |
| C14 | Minor: `capabilities()` is a **stub in Phase 0** (no full CapabilityStatement parser — YAGNI vs a known sandbox); named **SCCM version-adapter** for major-coexistence; `Quantity.comparator` added. | Arch-8 |

**Deferred (tracked):** secret/master-key rotation mechanism (Phase 1; fail-closed-on-missing-key is in Part 1); cross-border/residency enforcement (Phase 1 with ABDM; posture documented now); element-level de-identified MaiK "clinical-only" context mode (Phase 3); tenant-scoped auditor reads + RBAC (Phase 3); consent-artifact id in audit (Phase 1); tamper-evident audit hash-chaining + anomaly alerting (Phase 3; append-only is the Part-1 minimum); BAA/DPA governance (hard precondition before real PHI, gated by C6/C7).

---

## 1. What StewardMD Connect is (and is not)

StewardMD Connect is the **interoperability and normalization layer** between a hospital's
existing systems and the StewardMD ecosystem. It is **not** an EMR and (by default) **not** a data
store. Its single job: take clinical data from any supported source and produce one **canonical,
versioned, vendor-neutral clinical model** that MaiK and every StewardMD module consume — so MaiK
never sees a vendor schema and hospitals never replace their EMR.

The architectural spine (kept intact):

```
Hospital system → Connector → Parser → Normalizer → Validator
                → Canonical Clinical Model → Permission/Consent gate → MaiK / Modules
```

The Canonical Clinical Model is the **anti-corruption layer** (DDD). Everything upstream is vendor-
specific and quarantined inside a connector; everything downstream speaks only SCCM.

### Locked decisions (owner-approved 2026-07-31)

| Decision | Choice | ADR |
|---|---|---|
| First thing Phase 0 proves | **Generic FHIR R4 read**, then ABDM | ADR-006 |
| PHI handling | **Ephemeral pass-through — no clinical-PHI content at rest by default** | ADR-002 |
| Deployment target | **Cloudflare-native only** (clean boundaries for later self-host) | ADR-001 |

---

## 2. The reframe (why this differs from the vision doc)

StewardMD is a **buildless, Cloudflare-edge, zero-backend-dependency** platform (`functions/*.js`
Pages Functions + `stewardmd-api` Worker + D1/KV/R2 + Firestore, Capacitor shell; `node --test`).
Several vision-doc items assume a Java/Kubernetes enterprise stack. Decisions:

| Vision-doc item | Decision (Part 1) | Rationale |
|---|---|---|
| FHIR R4/R5, SMART on FHIR, ABDM/ABHA | **Core — build** | Native to HTTPS/edge; the bulk of value, esp. India |
| Canonical model + Connector SDK | **Core — build** | The anti-corruption layer; the product |
| HL7 v2 | Phase 2 (lightweight parser, `event` profile) | Real but less common for greenfield connections |
| DICOM | Interface only; images by **reference**, never pixel transport | Pixels do not belong in an ephemeral edge layer |
| On-prem / air-gapped / hybrid | **Defer** (keep runtime boundaries clean) | Cloudflare is the platform; on-prem is a bespoke sale |
| LDAP / Active Directory (direct) | **Defer** — OIDC/SMART SSO instead | Raw LDAP from the edge is a non-starter |
| Postgres/Oracle/SQL Server read replicas | **Defer behind the SDK** | Workers cannot reach a hospital's internal DB |
| GraphQL connector | **Defer** | Almost nonexistent in healthcare |

Cutting these is not lowering ambition — it is refusing to design around one hospital's plumbing.

**Reuse, don't reinvent — corrected.** There is **no org/tenant entity** in the code today, and
`identify()` exists in two divergent forms (`_fbauth.js:58` returns a string user id; `_usage.js:79`
returns `{id, guest, email}`). Connect therefore **adds** a minimal tenant layer rather than
"mapping onto an existing org concept": it standardizes on the `_usage.js` `identify()`, and adds a
`connect_membership(user_id, tenant_id, role)` table + a `resolveTenant(actor)` helper. It still
reuses `ownerOK` (`_adminauth.js`), `_features`/entitlements for flags, and the existing D1/KV
bindings — it does not build a parallel auth system.

**Additive & reversible.** Everything ships behind flag `smd_connect` (default **OFF**). New paths/
tables only (`functions/api/connect/*`, `functions/_connect/*`, `test/connect/*`, new D1 tables).
Zero change to any existing endpoint, table, or behavior. Rollback = revert.

---

## 3. Part-1 scope: the Walking Skeleton

Part 1 delivers the foundation **proven end-to-end with one working `pull` connector** (ADR-003),
not paper.

**In scope:**
1. **SCCM v1** — 8 resource types (§4) + shared value types + validator + the semantic rules (C5).
2. **Connector contract** — the `pull` + `event/push` profiles (§5) + the shared conformance suite.
   Phase 0 implements only `pull`.
3. **ConnectEngine** — the pipeline (§6): resolve tenant (server-side) → sandbox-only gate →
   auth → fail-closed permission gate → bounded fetch → normalize → validate → permission filter →
   PHI-free audit → return. Stateless; no clinical PHI persisted; no global caching.
4. **FHIR R4 `pull` connector** — capabilities(stub)/authenticate/validate/fetchPatient against a
   **synthetic** sandbox (SMART/Synthea), + FHIR→SCCM normalizer.
5. **MaiK context stub** — hands a `CanonicalBundle` (synthetic only in Part 1) to MaiK's context
   input, proving MaiK consumes SCCM only. The real-PHI→MaiK-LLM path stays gated (C7).
6. **Tenant + membership + config + audit** — D1 schema (§7); secrets via Workers secrets +
   envelope-encrypted KV (C10); append-only PHI-free audit (C8).
7. **HTTP surface** — `functions/api/connect/[[path]].js`, flag-gated, server-derived identity,
   `no-store`; plus the reserved (unimplemented) `ingress` route shape for Phase 1.
8. **Tests + benchmarks** — `node --test` unit/contract/pipeline, synthetic fixtures, max-size bench.
9. **ADRs + docs** — split into `docs/connect/` on implementation.

**NOT in Part 1:** real consent workflows, `event/push` implementation, SMART/HL7/DICOM connectors,
onboarding portal UI, RBAC/ABAC beyond membership + scope allow-list, module orchestration,
analytics. Those are Phases 1–4.

---

## 4. StewardMD Canonical Clinical Model (SCCM) v1

Versioned (`sccmVersion: "1.0"`). Downstream pins a **major**; connectors declare the version they
emit; a named **version-adapter** (C14) lets 1.x emitters coexist with a future 2.x. New fields are
additive within a major; breaking changes bump the major and are absorbed at the connector boundary
(ADR-008) — standards churn (R4→R5, ABDM profile drift) never propagates to MaiK.

### 4.1 Shared value types

```jsonc
Coding            { "system":"http://loinc.org", "code":"718-7", "display":"Hemoglobin",
                    "kind":"standard" }          // kind ∈ standard|local  (C5: tag proprietary codes)
CodeableConcept   { "coding":[Coding,...], "text":"Hemoglobin" }   // text is REQUIRED (C5 fallback)
Quantity          { "value":9.2, "unit":"g/dL", "system":"http://unitsofmeasure.org",
                    "code":"g/dL", "comparator":null }   // comparator ∈ <|<=|>=|>|null  (C14)
Period            { "start":"2026-07-30T10:00:00Z", "end":null }        // ISO-8601 UTC
Identifier        { "system":"https://healthid.abdm.gov.in", "value":"…", "type":"ABHA" }
Reference         { "type":"Encounter", "id":"enc-123" }   // intra-bundle only; resolve-or-null (C5)
Provenance        { "resource":"Observation", "sourceConnector":"fhir-r4", "sourceId":"Obs/9" }
                    // audit context ONLY; MUST NOT be used downstream as a join/identity key (C5);
                    // sourceId may embed an MRN → stays in the ephemeral bundle, never copied to audit.
```

Coding systems referenced (values, not full terminologies): LOINC, SNOMED CT, ICD-10/11, RxNorm/ATC,
UCUM. Part 1 passes codes through faithfully (no terminology translation) — hence the required `text`
fallback and `kind` tag so downstream never hard-depends on a resolvable/standard code.

### 4.2 Resources (Part 1 set — 8)

Every field optional unless **required**. Every `id` MUST be **stable & deterministic per source
resource** (C5) so a future timeline can dedupe/merge.

```jsonc
Patient { id*, identifiers:[Identifier], name:{text,given[],family}, gender, birthDate, deceased }
   // Deliberately minimal; a Phase-3 "clinical-only" mode may strip direct identifiers by purpose.

Encounter { id*, status, class:"IP|OP|ER|VR", period:Period, reason:CodeableConcept,
            practitioners:[{name,role}] }        // display-only; no separate Practitioner resource in v1

Condition { id*, code:CodeableConcept*, clinicalStatus, category:"problem-list-item|encounter-diagnosis",
            onset, recordedDate, encounter:Reference }

MedicationStatement { id*, medication:CodeableConcept*, origin:"order|statement|dispense",  // C4
                      status, dosage:{text,route:CodeableConcept,dose:Quantity,frequency},
                      effectivePeriod:Period, reason:[Reference] }

AllergyIntolerance { id*, code:CodeableConcept*, clinicalStatus, criticality:"low|high|unable-to-assess",
                     reactions:[{manifestation:[CodeableConcept], severity:"mild|moderate|severe"}] }

Observation { id*, category:"laboratory|vital-signs"*, code:CodeableConcept*,        // LOINC
              value:(Quantity | {text} | CodeableConcept),
              referenceRange:{low:Quantity,high:Quantity,text}, interpretation, effectiveDateTime, status }

DiagnosticReport { id*, code:CodeableConcept*, category, status, effectiveDateTime,     // C4
                   conclusion:"…narrative impression…", results:[Reference] }           // groups Observations

DocumentReference { id*, type:CodeableConcept*, category, status, date,                 // C4
                    text:"…narrative content…",        // by-reference / narrative only — NO binary/pixel
                    encounter:Reference }
```

### 4.3 The bundle (what crosses the boundary to MaiK)

```jsonc
CanonicalBundle {
  sccmVersion:"1.0", tenantId, patient:Patient*,
  encounters:[…], conditions:[…], medications:[…], allergies:[…],
  observations:[…], diagnosticReports:[…], documents:[…],
  meta:{ generatedAt, sourceConnector, scope:[…], provenance:[Provenance], warnings:[…] }
}
```

Produced on demand, validated, handed to the caller (MaiK context builder), then **discarded**
(ADR-002). Never written to D1/R2/KV. **All `Reference`s must resolve within the bundle or be
nulled** (a `Condition.encounter` cannot dangle if Encounters were out of scope).

---

## 5. The Connector contract (the plugin boundary)

Every connector implements **one interface with two capability profiles**. Dependencies are
injected via `ctx` (dependency inversion) → pure, edge-safe, unit-testable, no direct `env`.

```jsonc
ctx = {
  tenant:{id, mode:"sandbox|live", settings},     // mode enforced by the engine (C6)
  config:{ …non-secret connector config from D1… },
  secrets: async (name) => "…",   // resolves Workers secret / decrypts envelope-KV; never logged
  scope:[…],                      // resource types this call is authorized to fetch
  now:()=>Date, fetch,            // injected clock + HTTP (mockable; NO global cache — C11)
  audit:(evt)=>void,              // metadata-only sink built from a field allow-list (C8)
  logger:{warn,error},            // codes + non-PHI context only (C12)
  budget:{ maxSubrequests, deadlineMs, maxPagesPerResource }   // edge budget (C11)
}

Connector {
  meta:{ id, name, version, profile:"pull|event", kinds:["fhir-r4"], sccmVersion:"1.0" },

  // ── shared ──
  authenticate(ctx) → { token, expiresAt } | { ok:true }   // token cached per-tenant in KV (C10 key ns)
  validate(ctx)     → ValidationReport                     // self-test; engine blocks activation until pass (<30 s)
  normalize(ctx, raw) → CanonicalBundle                    // the anti-corruption map (the ONLY place vendor fields appear)

  // ── profile: "pull" (FHIR/SMART; Phase 0) ──
  capabilities(ctx)  → { resources[], operations[], authKinds[] }   // Phase-0: STUB vs known sandbox (C14)
  fetchPatient(ctx, patientRef) → RawBundle                // bounded by ctx.budget; patientRef is PHI-in-transit

  // ── profile: "event" (ABDM/HL7/file; Phase 1+, RESERVED now) ──
  initiate(ctx, request) → { handle }                      // e.g. consent-request init; returns a correlation handle
  ingest(ctx, rawEvent) → { handle, bundle:CanonicalBundle }  // async inbound (webhook/push/batch) → SCCM
}
```

`RawBundle`/`rawEvent` are opaque to the engine — only the connector's `normalize` understands them.

### Conformance suite (`test/connect/connector-contract.test.mjs`)

One shared suite every connector passes against **synthetic** fixtures: `meta` well-formed;
`authenticate` retryable, never throws on transient error; `capabilities` degrades gracefully;
`fetchPatient`/`ingest` returns raw; `normalize` output **passes the SCCM validator**; partial/
missing fields → valid bundle + `meta.warnings`, never a crash; **no PHI and no resolved secret/token
appears in any `audit`/`logger`/error output**. Passing = "a valid connector." The SDK (Phase 2)
ships this suite for third-party self-certification.

---

## 6. ConnectEngine pipeline

`ConnectEngine.loadPatientContext(env, request) → Promise<CanonicalBundle>` where `request`
carries only client-supplied `patientRef` + requested `scope`; **`tenantId` and `actor` are derived
server-side from `identify()`** and never trusted from the body (C3/Sec-5).

1. **Resolve actor + tenant** via `identify()` + `resolveTenant()`; verify membership. (IDOR-safe.)
2. **Sandbox-only gate (C6):** if `tenant.mode !== "live"`, refuse any connector `base_url` not on
   the synthetic-sandbox allow-list; `mode:"live"` is refused entirely until a consent artifact
   exists (Phase 1). `base_url` must be `https` with no `userinfo`.
3. **authenticate** (token in envelope-encrypted KV under `connect:tok:{tenantId}:{connectorId}`;
   refresh on expiry; tolerate KV eventual-consistency with a short re-auth on miss).
4. **Permission/consent gate — FAIL-CLOSED (C11):** `scope` is *intersected* with (never widens)
   `granted_scopes`; **any error (D1/KV/logic) → deny**, audited, no fetch.
5. **fetchPatient(scope)** → `RawBundle`, bounded by `ctx.budget` (page cap + subrequest/wall-time
   budget + per-upstream timeout + bounded retry/circuit-breaker). History-heavy loads route to a
   deferred queued path (Phase 2), not a single request.
6. **normalize(raw)** → `CanonicalBundle`.
7. **validate** (SCCM validator + reference-resolution). Hard fail → reject; soft → `meta.warnings`.
8. **Permission filter** — drop any resource/field outside granted scope (defense in depth even if a
   connector over-fetched).
9. **Audit (C8)** — construct field-by-field from the allow-list `{ts, tenantId, actor, connectorId,
   action, resourceCounts, scope, patientRefHash, latencyMs, outcome}`; `patientRefHash` = per-tenant
   HMAC (C9); the sink serializes only these named fields. Append-only.
10. **Return** to the caller. Nothing persisted. A top-level catch converts any throw into a
    sanitized typed error (`AuthError|PermissionError|UpstreamError|ValidationError`) — never a raw
    value/stack to the logger or HTTP body. Connector failure never crashes MaiK ("no context" is a
    valid state; the Capacitor client degrades gracefully with a client-side timeout).

**No module-level/global caching** of PHI, tokens, or config — everything resolves per request
(Workers isolates are reused across requests; a global cache would leak across tenants).

---

## 7. Multi-tenancy, security & compliance

### Tenancy & identity
A **tenant** = a hospital/org. Membership is explicit (`connect_membership`); `identify()` (the
`_usage.js` object form) is the sole server-side identity source; tenant/actor are never client-
supplied. Every row/key is tenant-scoped; cross-tenant references are a hard error. Tenant ids are
restricted to `[a-z0-9-]` so they cannot inject delimiters into KV keys.

### D1 schema (new tables only; dedicated `stewardmd-connect` DB — owner provisions the binding)
```sql
CREATE TABLE connect_tenant (
  id TEXT PRIMARY KEY, name TEXT, status TEXT,          -- active|suspended
  mode TEXT NOT NULL DEFAULT 'sandbox',                 -- sandbox|live  (C6)
  granted_scopes TEXT, settings TEXT, created_at TEXT, updated_at TEXT );

CREATE TABLE connect_membership (                        -- C3: real user↔tenant model
  user_id TEXT, tenant_id TEXT, role TEXT,               -- owner|admin|clinician|auditor
  PRIMARY KEY (user_id, tenant_id) );

CREATE TABLE connect_connector_config (
  tenant_id TEXT, connector_id TEXT, kind TEXT, profile TEXT,   -- 'fhir-r4','pull'
  base_url TEXT,                                          -- https, no userinfo; sandbox-allowlisted unless live
  config TEXT,                                            -- JSON, NON-SECRET only
  secret_ref TEXT,                                        -- name of Workers secret / envelope-KV key; NEVER the secret
  scope TEXT, status TEXT,                                -- draft|validated|active|disabled
  PRIMARY KEY (tenant_id, connector_id) );

CREATE TABLE connect_audit_event (                        -- append-only; metadata only, NO PHI (C8)
  id TEXT PRIMARY KEY, tenant_id TEXT, ts TEXT, actor TEXT,
  connector_id TEXT, action TEXT, resource_counts TEXT, scope TEXT,
  patient_ref_hash TEXT,                                  -- per-tenant HMAC pseudonym (C9), NOT de-identified
  latency_ms INTEGER, outcome TEXT );
```
No table stores clinical content. Code path has **no UPDATE/DELETE** on `connect_audit_event`.

### Data inventory (C13)
| Data | Retention | Classification |
|---|---|---|
| `CanonicalBundle` (patient content) | **Not retained** (request memory only) | Clinical PHI |
| Audit events | Retained (period set on impl) | Pseudonymous personal data (actor + patientRefHash) |
| Connector credentials | Retained, envelope-encrypted | Secret |
| Tenant/connector config, mappings | Retained | Config (non-secret) |

### Security invariants
- **Ephemeral clinical PHI by default** (ADR-002) — patient content only in request memory.
- **The ephemeral guarantee ends at the MaiK hand-off (C7).** Real-patient bundles are blocked from
  MaiK's LLM egress (Vertex/Gemini) until a no-retention/no-training provider tier + BAA/DPA are
  signed off; Part-1's stub uses synthetic data only.
- **Secrets (C10):** Workers secrets for global secrets (envelope master key, HMAC salt);
  envelope-encrypted KV (AES-GCM) for per-tenant credentials; **fail-closed if the master key is
  missing**; secret never in D1/config/git/logs; the secret-scan reviewer runs on every Connect PR.
- **Sandbox-only enforced (C6)** until consent exists; `base_url` `https` + no `userinfo`.
- **Least privilege / consent-first:** scope intersected, never widened; minimum-necessary resources.
- **Fail-closed** permission gate; **zero trust** between layers (validator + post-normalize filter).
- **Auditability:** every load and denial emits a PHI-free append-only audit event.
- **Tenant isolation:** every query tenant-scoped; dedicated `connect:*` KV namespace; cross-tenant = error.
- **Transport (C12):** context endpoint returns `Cache-Control: no-store` (reuses the `/api/ghis`
  PHI-transport posture; SW already skips `/api/*`).
- **DPDP role (C13):** for an EMR pull the hospital is Data Fiduciary, Connect is **Data Processor**
  (§8(2)) — requires a processor contract; consent/notice is owed by the hospital. India data-
  residency: pin D1/KV to an India region where available; document that Workers compute is global-
  edge but transient (the ephemeral design strengthens this). Full residency work lands in Phase 1.

---

## 8. HTTP surface (Part 1)

`functions/api/connect/[[path]].js` (mirrors the existing `[[path]].js` + `onRequest` pattern),
flag-gated (`smd_connect` OFF → 404), identity derived server-side, `no-store`:

| Method + path | Purpose | Gate |
|---|---|---|
| `POST /api/connect/tenants` | create/update tenant (incl. `mode`) | owner |
| `POST /api/connect/connectors` | register/configure a connector (secret via `secret_ref`) | owner |
| `POST /api/connect/connectors/:id/validate` | connection self-test → report | owner |
| `POST /api/connect/context` | load canonical context (ephemeral); `patientRef`+`scope` in body only | member (tenant derived) |
| `GET  /api/connect/audit` | read audit metadata (tenant-filtered even for owner) | owner/auditor |
| `POST /api/connect/ingress/:connector` | **RESERVED (Phase 1)** async inbound (ABDM/HL7) | connector signature, no StewardMD actor |

---

## 9. Folder structure

```
functions/
  api/connect/[[path]].js          # router (flag + server-derived-identity gated)
  _connect/
    engine.js                      # ConnectEngine pipeline (§6)
    interfaces.js                  # JSDoc contracts + runtime shape guards
    identity.js                    # resolveTenant(actor) + membership checks (wraps identify())
    permission.js                  # fail-closed scope/consent gate
    audit.js                       # field-allow-list, append-only, PHI-free sink
    secrets.js                     # Workers-secret + envelope-KV (AES-GCM) resolver; fail-closed
    tenant.js                      # tenant + connector-config resolution (D1); sandbox-only gate
    canonical/
      model.js                     # SCCM factories + stable-id + type guards
      validate.js                  # SCCM validator + reference-resolution
      coding.js                    # Coding/CodeableConcept(text-required)/Quantity(UCUM,comparator)
      version.js                   # SCCM version-adapter (major coexistence)
    connectors/
      fhir-r4/ connector.js normalize.js   # pull profile (Phase 0)
  db/connect_schema.sql            # new D1 tables (additive)
test/connect/
  canonical-model.test.mjs  fhir-r4-normalize.test.mjs  engine-pipeline.test.mjs
  connector-contract.test.mjs  no-phi.test.mjs  bench.mjs  fixtures/   # SYNTHETIC only
docs/connect/ adr/  canonical-model.md  connector-sdk.md  security.md
```

---

## 10. Testing & benchmark strategy

- **Unit** — SCCM factories/validator (incl. reference-resolution + required-`text`); coding helpers;
  FHIR→SCCM normalizer (happy/partial/missing/malformed).
- **Contract** — `connector-contract.test.mjs` (§5).
- **Pipeline** — mock connector + injected `fetch`/clock/KV: server-derived identity, sandbox-only
  gate (allow/deny), permission (allow/deny, **fail-closed on injected KV/D1 error**), normalize,
  validate, filter, audit; asserts nothing persisted and no global cache leak across requests.
- **`no-phi.test.mjs`** — asserts no fixture PHI and **no resolved secret/bearer token** appears in
  any audit event, log line, or HTTP error body; fixture PHI-pattern scan as backstop.
- **Fixtures** — **synthetic** (Synthea / SMART sandbox), authored/checked in; never captured from
  public `hapi.fhir.org`.
- **Runner** — `node --test`, wired into `npm test` + CI.

### Performance targets
| Metric | Target |
|---|---|
| FHIR → SCCM normalize (typical patient) | < 50 ms CPU |
| End-to-end context load (network-permitting) | < 500 ms |
| Connection validation (onboarding self-test) | < 30 s |
| Worst-case bundle | measured (bench a **max-size** patient, not just typical) — must stay within edge subrequest/wall-time budget |

---

## 11. Reviewer panel (run after each phase)

| Requested | Agent(s) |
|---|---|
| Architecture | `stewardmd-platform-reviewer` |
| Security | `stewardmd-security-reviewer`, `stewardmd-appsec-reviewer`, `stewardmd-redteam-reviewer`, `stewardmd-secret-scan-reviewer` |
| Performance | `stewardmd-performance-reviewer` |
| API / Data | `stewardmd-dataflow-reviewer` |
| Testing | `stewardmd-preprod-reviewer` |
| Compliance | `stewardmd-dpdp-reviewer`, `stewardmd-hipaa-reviewer` |
| Clinical correctness | `stewardmd-clinical-reviewer` (SCCM semantics) |

Design reviewed by platform + security + dpdp/hipaa (v1.1 folds their findings); full panel runs on the implementation.

---

## 12. Architecture Decision Records (summary)

- **ADR-001 — Cloudflare-native runtime.** Build on Pages Functions/Worker/D1/KV/R2; keep boundaries
  clean (injected `ctx`) for a later portable runtime. *Rejected:* portable/on-prem now.
- **ADR-002 — Ephemeral clinical-PHI by default (reframed, C2).** No clinical-PHI *content* at rest
  by default; audit/config/mappings + (Phase 1) consent artifacts/ECDH keys/correlation/transient
  push buffer are non-clinical state with a durable home (Durable Object). A flag-gated, consent-
  scoped, retention-bounded context/timeline store is the reserved Phase-4 boundary. *Rejected:*
  treating "no state at rest ever" as a platform invariant (undeliverable for ABDM push + Phase-4
  timeline); *rejected:* default PHI caching (breach/retention surface).
- **ADR-003 — Canonical-model-first + walking skeleton.** Prove SCCM + contract with one real `pull`
  connector. *Rejected:* paper-only; connector-first (one-off integrations).
- **ADR-004 — Uniform injected connector contract, two profiles (C1).** One interface, `pull` +
  `event/push`; dependencies injected. Enables purity, edge-safety, SDK.
- **ADR-005 — Reuse `ownerOK`/flags/D1/KV; add a real tenant layer (C3).** No parallel auth; but the
  org/tenant + membership model is *new* (it did not exist).
- **ADR-006 — FHIR-first, then ABDM.** Prove cheaply on synthetic sandboxes before ABDM crypto/consent.
- **ADR-007 — Flag-gated, additive rollout.** `smd_connect` OFF; new paths/tables only; rollback = revert.
- **ADR-008 — Versioned SCCM; standards isolated at the boundary (+ version-adapter, C14).**
- **ADR-009 — Sandbox-only + gated MaiK egress (C6/C7).** The engine technically enforces sandbox-only
  until consent exists, and real-patient bundles are blocked from MaiK's LLM egress until a
  no-retention provider tier + BAA/DPA exist. This is what makes deferring consent safe.
- **ADR-010 — Server-derived identity; PHI-free audit by construction (C3/C8/C9).** tenant/actor from
  `identify()`; audit built from a field allow-list; `patientRefHash` = per-tenant HMAC pseudonym.
- **ADR-011 — Fail-closed + bounded edge (C11).** Permission gate denies on any error (not the house
  fail-open default); per-upstream timeout + bounded retry; pagination/subrequest/wall-time budget;
  no global caching.

---

## 13. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| A real EMR wired up in Phase 0 (no consent) | High | Enforced sandbox-only gate (C6); `mode:live` refused until consent |
| PHI leaves ephemeral edge at MaiK hand-off | High | Gated egress (C7); synthetic-only stub in Part 1; BAA/DPA precondition |
| PHI persisted/logged despite intent | High | Field-allow-list audit (C8); HMAC pseudonym (C9); no-PHI test; secret-scan reviewer; no global cache (C11) |
| Cross-tenant leak (IDOR / KV collision) | High | Server-derived tenant (C3); membership check; `connect:*` ns + `[a-z0-9-]` ids |
| Credential compromise in KV | High | Envelope encryption (C10); fail-closed on missing key; `https`+no-userinfo |
| Connector interface can't absorb ABDM/HL7 | High→Low | Two profiles + reserved ingress route defined now (C1) |
| SCCM misses a field (esp. ABDM documents) | Medium | +DiagnosticReport/DocumentReference (C4); additive-within-major; `meta.warnings` |
| Proprietary codes break MaiK silently | Medium | Required `text` fallback + `kind` tag (C5) |
| Edge CPU/subrequest blowout | Medium | Pagination cap + budget (C11); max-size bench; queued path for history |
| Fail-open copied from house KV idiom | Medium | Fail-closed stated as an invariant + tested (C11) |
| Real PHI committed via captured fixtures | Medium | Synthetic-only fixtures + PHI-pattern guard (C12) |

---

## 14. Part-1 acceptance criteria

1. SCCM v1 (8 resources) + validator (incl. required-`text`, stable-id, reference-resolution) with
   happy/partial/malformed tests.
2. FHIR R4 `pull` connector passes the shared conformance suite against **synthetic** fixtures.
3. `loadPatientContext` returns a valid `CanonicalBundle` end-to-end for a sandbox patient, with:
   server-derived identity, sandbox-only gate, and permission allow/deny (incl. **fail-closed on
   injected error**) all tested.
4. MaiK context stub consumes the bundle (SCCM only; no vendor fields; **synthetic data only**).
5. `no-phi.test.mjs` green: no PHI/secret/token in any audit event, log, or error body; nothing
   persisted; no cross-request global cache leak.
6. Envelope-encrypted secret resolver fails **closed** without the master key.
7. All new code behind `smd_connect` (OFF); `npm test` green; zero regression.
8. platform + security + dpdp/hipaa reviewers pass on the implementation.

---

## 15. Roadmap (Parts → Phases)

- **Phase 0 (this spec)** — Foundation + FHIR R4 `pull` walking skeleton (synthetic only).
- **Phase 1** — ABDM: `event` profile live — ABHA onboarding, consent init + **webhook ingress**,
  **ECDH X25519** payload crypto, HIP/HIU FHIR bundle ingest → SCCM; consent artifacts + push buffer
  in a Durable Object; `mode:live` enabled behind consent; India residency + processor contract.
- **Phase 2** — SMART on FHIR, HL7 v2 (lightweight, `event`), file imports, the Connector SDK
  (contract + CLI + mock server + conformance suite for third parties).
- **Phase 3** — Enterprise: self-service onboarding portal, RBAC/ABAC, per-tenant consent UI, audit
  search/export + hash-chaining, monitoring dashboard, tenant-scoped auditor reads, clinical-only
  context mode.
- **Phase 4** — MaiK orchestration: unified context engine, clinical timeline (needs the reserved
  retention store + stable ids), module orchestrator, proactive alerts, operational analytics
  (never trains on PHI).

Each phase: implemented → tested → benchmarked → reviewed (panel) → documented, before the next.
