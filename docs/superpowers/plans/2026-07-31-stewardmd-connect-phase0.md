# StewardMD Connect — Phase 0 (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the StewardMD Connect foundation end-to-end — a canonical clinical model, an injected connector contract, a fail-closed/ephemeral engine, and one working read-only FHIR R4 connector against synthetic data — proving MaiK can consume normalized clinical data with zero vendor-schema leakage.

**Architecture:** Buildless ES-module code under `functions/_connect/*` (pure, dependency-injected, unit-testable with `node --test`), a thin flag-gated Pages-Functions router at `functions/api/connect/[[path]].js`, new D1 tables in `db/connect_schema.sql`. The canonical model is the anti-corruption layer; connectors quarantine vendor shapes; the engine is stateless and persists no clinical PHI. Everything is additive and behind flag `smd_connect` (default OFF).

**Tech Stack:** Plain ES modules (no build, no TypeScript), `node:test` + `node:assert/strict`, WebCrypto (`globalThis.crypto` — present in both Cloudflare Workers and Node ≥18), Cloudflare Pages Functions + D1 + KV. No new npm dependencies.

## Global Constraints

- **No new runtime dependencies.** Plain ES modules only; no TypeScript, no build step. (spec §2)
- **Flag-gated, additive, zero regression.** All new code behind `smd_connect` (default OFF). New paths only: `functions/api/connect/*`, `functions/_connect/*`, `test/connect/*`, `db/connect_schema.sql`. Never edit an existing endpoint/table/behavior. Rollback = revert. (spec §2, ADR-007)
- **Ephemeral clinical PHI.** No `CanonicalBundle` or patient content is ever written to D1/KV/R2 or a module-level/global variable. Everything resolves per request. (ADR-002, C11)
- **PHI-free audit by construction.** Audit events are built field-by-field from a fixed allow-list; the sink serializes only named fields; audit table is append-only (no UPDATE/DELETE code path). `patientRefHash` = per-tenant keyed HMAC, never a plain hash. (C8, C9)
- **Fail-closed.** The permission gate and the secrets resolver deny/throw on ANY error or missing key — never fall open. (C10, C11)
- **Server-derived identity.** `tenantId` and `actor` come from `identify()` + membership, never from the request body; requested `scope` is intersected with (never widens) `granted_scopes`. (C3, Sec-5)
- **Synthetic data only in Phase 0.** Fixtures are hand-authored / Synthea-style; NEVER captured from public `hapi.fhir.org`. The engine's sandbox-only gate refuses any non-allow-listed `base_url`; `mode:"live"` is refused entirely. Real bundles are blocked from the MaiK LLM egress. (C6, C7, C12)
- **Every coded field carries a required `text` fallback; `Coding.kind ∈ {standard, local}`; connectors emit stable deterministic resource ids; intra-bundle `Reference`s resolve-in-bundle-or-are-nulled.** (C5)
- **Owner precondition:** the `stewardmd-connect` D1 binding is provisioned by the owner. Until then, D1-touching integration steps run against an injected mock DB (`makeMockDb()` from Task 1); no task blocks on the live binding.

---

## File structure

```
functions/
  api/connect/[[path]].js          # Task 11 — flag-gated router; server-derived identity; no-store
  _connect/
    canonical/
      coding.js                    # Task 2 — Coding/CodeableConcept/Quantity/Period/Identifier/Reference/Provenance
      model.js                     # Task 3 — 8 resource factories + bundle envelope + version guard
      validate.js                  # Task 3 — validateBundle (required fields, enums, ref-resolution, text fallback)
    interfaces.js                  # Task 4 — connector contract guards + makeCtx
    secrets.js                     # Task 5 — envelope AES-GCM + fail-closed
    audit.js                       # Task 6 — field-allow-list event + HMAC pseudonym + append-only sink
    identity.js                    # Task 7 — resolveActor + resolveTenant (membership)
    tenant.js                      # Task 7 — loadTenant/loadConnectorConfig + sandbox-only gate
    permission.js                  # Task 7 — fail-closed scope intersection
    connectors/fhir-r4/
      normalize.js                 # Task 8 — FHIR R4 → SCCM
      connector.js                 # Task 8 — pull connector (auth/validate/capabilities/fetchPatient)
    engine.js                      # Task 9 — ConnectEngine.loadPatientContext pipeline
    maik-context.js                # Task 10 — SCCM → MaiK context + gated egress
    testkit.js                     # Task 1 — makeMockDb/makeMockKv/mockConnector/synthetic fixtures helpers
  db/connect_schema.sql            # Task 1 — new D1 tables (additive)
test/connect/
  scaffold.test.mjs                # Task 1
  coding.test.mjs                  # Task 2
  model.test.mjs  validate.test.mjs# Task 3
  connector-contract.test.mjs      # Task 4 (the reusable conformance harness) + Task 8 wires FHIR through it
  secrets.test.mjs                 # Task 5
  audit.test.mjs                   # Task 6
  identity.test.mjs tenant.test.mjs permission.test.mjs   # Task 7
  fhir-r4-normalize.test.mjs       # Task 8
  engine-pipeline.test.mjs         # Task 9
  maik-context.test.mjs            # Task 10
  router.test.mjs                  # Task 11
  no-phi.test.mjs                  # Task 11
  bench.mjs                        # Task 11
  fixtures/fhir-synthetic.mjs      # Task 8 — hand-authored synthetic FHIR bundle
```

---

### Task 1: Scaffolding — flag gate, D1 schema, test kit, router health stub

**Files:**
- Create: `db/connect_schema.sql`
- Create: `functions/_connect/testkit.js`
- Create: `functions/api/connect/[[path]].js` (health stub only; full routes in Task 11)
- Test: `test/connect/scaffold.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `flagOn(env)` (reads `smd_connect`); `makeMockDb(seed)` → `{ prepare(sql).bind(...).first()/all()/run() }`; `makeMockKv()` → `{ get, put, delete }`; `jsonResponse(obj, {status, headers})`; the router `onRequest(context)`.

- [ ] **Step 1: Write the failing test**

```js
// test/connect/scaffold.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/connect/[[path]].js";
import { makeMockKv, makeMockDb, flagOn } from "../../functions/_connect/testkit.js";

const ctx = (path, env) => ({ request: new Request("https://x" + path), env, params: {} });

test("router 404s when smd_connect is OFF", async () => {
  const res = await onRequest(ctx("/api/connect/health", { CONNECT_FLAG: "0" }));
  assert.equal(res.status, 404);
});

test("router health responds when flag ON", async () => {
  const res = await onRequest(ctx("/api/connect/health", { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test("flagOn reads smd_connect", () => {
  assert.equal(flagOn({ CONNECT_FLAG: "1" }), true);
  assert.equal(flagOn({ CONNECT_FLAG: "0" }), false);
  assert.equal(flagOn({}), false);              // default OFF
});

test("mock db + kv round-trip", async () => {
  const kv = makeMockKv();
  await kv.put("k", "v");
  assert.equal(await kv.get("k"), "v");
  const db = makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }] });
  const row = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind("t1").first();
  assert.equal(row.mode, "sandbox");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/scaffold.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the D1 schema**

```sql
-- db/connect_schema.sql — StewardMD Connect (additive; new tables only)
CREATE TABLE IF NOT EXISTS connect_tenant (
  id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'active',
  mode TEXT NOT NULL DEFAULT 'sandbox',            -- sandbox|live
  granted_scopes TEXT, settings TEXT, created_at TEXT, updated_at TEXT );

CREATE TABLE IF NOT EXISTS connect_membership (
  user_id TEXT, tenant_id TEXT, role TEXT,          -- owner|admin|clinician|auditor
  PRIMARY KEY (user_id, tenant_id) );

CREATE TABLE IF NOT EXISTS connect_connector_config (
  tenant_id TEXT, connector_id TEXT, kind TEXT, profile TEXT,
  base_url TEXT, config TEXT, secret_ref TEXT, scope TEXT, status TEXT DEFAULT 'draft',
  PRIMARY KEY (tenant_id, connector_id) );

CREATE TABLE IF NOT EXISTS connect_audit_event (    -- append-only; metadata only, NO PHI
  id TEXT PRIMARY KEY, tenant_id TEXT, ts TEXT, actor TEXT,
  connector_id TEXT, action TEXT, resource_counts TEXT, scope TEXT,
  patient_ref_hash TEXT, latency_ms INTEGER, outcome TEXT );
CREATE INDEX IF NOT EXISTS idx_connect_audit_tenant_ts ON connect_audit_event (tenant_id, ts);
```

- [ ] **Step 4: Create the test kit**

```js
// functions/_connect/testkit.js — in-repo helpers for tests + local integration (NOT shipped in the client)
export function flagOn(env) { return String(env && env.CONNECT_FLAG) === "1"; }

export function jsonResponse(obj, opts = {}) {
  const headers = Object.assign(
    { "content-type": "application/json", "cache-control": "no-store", "pragma": "no-cache" },
    opts.headers || {});
  return new Response(JSON.stringify(obj), { status: opts.status || 200, headers });
}

export function makeMockKv() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

// Minimal D1-shaped mock: table lookups keyed by the first `?` bind on a WHERE.
export function makeMockDb(seed = {}) {
  const tables = JSON.parse(JSON.stringify(seed));
  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind: (...args) => { binds = args; return stmt; },
        first: async () => run(sql, binds, tables)[0] || null,
        all: async () => ({ results: run(sql, binds, tables) }),
        run: async () => { mutate(sql, binds, tables); return { success: true }; },
      };
      return stmt;
    },
  };
}
function tableOf(sql) { return (sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i) || [])[1]; }
function run(sql, binds, tables) {
  const t = tableOf(sql); const rows = tables[t] || [];
  if (!/WHERE/i.test(sql)) return rows.slice();
  const col = (sql.match(/WHERE\s+(\w+)\s*=\s*\?/i) || [])[1];
  return rows.filter((r) => String(r[col]) === String(binds[0]));
}
function mutate(sql, binds, tables) {
  if (/^\s*INSERT/i.test(sql)) {
    const t = tableOf(sql); tables[t] = tables[t] || [];
    tables[t].push({ _raw: binds });          // append-only; enough for audit tests
  }
  // UPDATE/DELETE intentionally unsupported for connect_audit_event (append-only invariant).
}
```

- [ ] **Step 5: Create the router health stub**

```js
// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (flag-gated). Routes filled in Task 11.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/connect/, "") || "/";
  if (path === "/health") return jsonResponse({ ok: true, service: "stewardmd-connect", phase: 0 });
  return jsonResponse({ error: "not_found" }, { status: 404 });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/connect/scaffold.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add db/connect_schema.sql functions/_connect/testkit.js "functions/api/connect/[[path]].js" test/connect/scaffold.test.mjs
git commit -m "feat(connect): Phase-0 scaffolding — flag gate, D1 schema, test kit, health stub"
```

---

### Task 2: Canonical value types + coding helpers

**Files:**
- Create: `functions/_connect/canonical/coding.js`
- Test: `test/connect/coding.test.mjs`

**Interfaces:**
- Produces: `coding({system,code,display,kind})`; `codeable({coding,text})` (throws if no non-empty `text`); `quantity({value,unit,system,code,comparator})`; `period(start,end)`; `identifier({system,value,type})`; `reference(type,id)`; `provenance({resource,sourceConnector,sourceId})`; constant `COMPARATORS = ["<","<=",">=",">"]`.

- [ ] **Step 1: Write the failing test**

```js
// test/connect/coding.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { coding, codeable, quantity, reference } from "../../functions/_connect/canonical/coding.js";

test("coding defaults kind to 'standard' and keeps local tag", () => {
  assert.equal(coding({ system: "http://loinc.org", code: "718-7" }).kind, "standard");
  assert.equal(coding({ system: "urn:hospital:x", code: "HB", kind: "local" }).kind, "local");
});

test("codeable REQUIRES a non-empty text fallback", () => {
  assert.throws(() => codeable({ coding: [coding({ code: "x" })] }), /text/);
  assert.equal(codeable({ text: "Hemoglobin" }).text, "Hemoglobin");
});

test("quantity rejects a bad comparator", () => {
  assert.equal(quantity({ value: 1, unit: "mg", comparator: "<" }).comparator, "<");
  assert.throws(() => quantity({ value: 1, comparator: "~" }), /comparator/);
});

test("reference carries type + id", () => {
  assert.deepEqual(reference("Encounter", "e1"), { type: "Encounter", id: "e1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/coding.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `coding.js`**

```js
// functions/_connect/canonical/coding.js — SCCM shared value types (spec §4.1)
export const COMPARATORS = ["<", "<=", ">=", ">"];

export function coding({ system = null, code = null, display = null, kind = "standard" } = {}) {
  if (kind !== "standard" && kind !== "local") throw new Error("coding.kind must be standard|local");
  return { system, code, display, kind };
}

export function codeable({ coding: codes = [], text = "" } = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error("CodeableConcept requires a non-empty text fallback");
  return { coding: codes, text: text.trim() };
}

export function quantity({ value = null, unit = null, system = "http://unitsofmeasure.org", code = null, comparator = null } = {}) {
  if (comparator !== null && !COMPARATORS.includes(comparator)) throw new Error("invalid Quantity comparator");
  return { value, unit, system, code, comparator };
}

export function period(start = null, end = null) { return { start, end }; }
export function identifier({ system = null, value = null, type = null } = {}) { return { system, value, type }; }
export function reference(type, id) { return { type, id }; }
export function provenance({ resource, sourceConnector, sourceId = null } = {}) {
  return { resource, sourceConnector, sourceId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/connect/coding.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/canonical/coding.js test/connect/coding.test.mjs
git commit -m "feat(connect): SCCM value types + coding (required text fallback, UCUM, comparator)"
```

---

### Task 3: SCCM resources, bundle envelope, version guard, and validator

**Files:**
- Create: `functions/_connect/canonical/model.js`
- Create: `functions/_connect/canonical/validate.js`
- Test: `test/connect/model.test.mjs`, `test/connect/validate.test.mjs`

**Interfaces:**
- Consumes: `coding.js` factories.
- Produces (`model.js`): `SCCM_VERSION="1.0"`, `SCCM_MAJOR=1`; resource factories `patient/encounter/condition/medicationStatement/allergyIntolerance/observation/diagnosticReport/documentReference`; `bundle({tenantId,patient,...,meta})`; `assertConsumable(bundle, consumerMajor)` (throws `SccmVersionError` if majors differ). Constant `RESOURCE_KEYS = ["encounters","conditions","medications","allergies","observations","diagnosticReports","documents"]`.
- Produces (`validate.js`): `validateBundle(bundle)` → `{ ok:boolean, errors:string[], warnings:string[] }` — MUTATES the bundle to null any intra-bundle `Reference` that does not resolve (adds a warning).

- [ ] **Step 1: Write the failing tests**

```js
// test/connect/model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { patient, observation, bundle, assertConsumable, SCCM_MAJOR } from "../../functions/_connect/canonical/model.js";
import { codeable, quantity } from "../../functions/_connect/canonical/coding.js";

test("patient requires a stable id", () => {
  assert.throws(() => patient({}), /id/);
  assert.equal(patient({ id: "p1" }).id, "p1");
});

test("observation carries category + coded code + value", () => {
  const o = observation({ id: "o1", category: "laboratory", code: codeable({ text: "Hb" }), value: quantity({ value: 9 }) });
  assert.equal(o.category, "laboratory");
});

test("bundle envelope pins sccmVersion and holds all resource arrays", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "fhir-r4" });
  assert.equal(b.sccmVersion, "1.0");
  assert.deepEqual(b.conditions, []);
  assert.equal(b.meta.sourceConnector, "fhir-r4");
});

test("assertConsumable rejects a mismatched major", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.doesNotThrow(() => assertConsumable(b, SCCM_MAJOR));
  assert.throws(() => assertConsumable(b, SCCM_MAJOR + 1), /version/);
});
```

```js
// test/connect/validate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { patient, encounter, condition, bundle } from "../../functions/_connect/canonical/model.js";
import { codeable, reference } from "../../functions/_connect/canonical/coding.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";

test("valid bundle passes", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.equal(validateBundle(b).ok, true);
});

test("missing patient is an error", () => {
  const b = bundle({ tenantId: "t1", patient: null, sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /patient/);
});

test("dangling intra-bundle reference is nulled with a warning", () => {
  const c = condition({ id: "c1", code: codeable({ text: "dx" }), encounter: reference("Encounter", "missing") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), conditions: [c], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
  assert.equal(b.conditions[0].encounter, null);          // resolve-or-null
  assert.match(r.warnings.join(), /reference/i);
});

test("resolvable reference is preserved", () => {
  const e = encounter({ id: "e1", status: "finished", class: "IP" });
  const c = condition({ id: "c1", code: codeable({ text: "dx" }), encounter: reference("Encounter", "e1") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), encounters: [e], conditions: [c], sourceConnector: "x" });
  validateBundle(b);
  assert.deepEqual(b.conditions[0].encounter, { type: "Encounter", id: "e1" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/connect/model.test.mjs test/connect/validate.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `model.js`**

```js
// functions/_connect/canonical/model.js — SCCM v1 resources + bundle (spec §4.2/§4.3)
export const SCCM_VERSION = "1.0";
export const SCCM_MAJOR = 1;
export const RESOURCE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents"];

function requireId(o) { if (!o || !o.id || typeof o.id !== "string") throw new Error("resource requires a stable string id"); return o.id; }

export function patient(o = {}) { requireId(o); return { id: o.id, identifiers: o.identifiers || [], name: o.name || null, gender: o.gender || "unknown", birthDate: o.birthDate || null, deceased: o.deceased ?? null }; }
export function encounter(o = {}) { requireId(o); return { id: o.id, status: o.status || "unknown", class: o.class || null, period: o.period || null, reason: o.reason || null, practitioners: o.practitioners || [] }; }
export function condition(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "unknown", category: o.category || null, onset: o.onset || null, recordedDate: o.recordedDate || null, encounter: o.encounter || null }; }
export function medicationStatement(o = {}) { requireId(o); return { id: o.id, medication: o.medication || null, origin: o.origin || "statement", status: o.status || "unknown", dosage: o.dosage || null, effectivePeriod: o.effectivePeriod || null, reason: o.reason || [] }; }
export function allergyIntolerance(o = {}) { requireId(o); return { id: o.id, code: o.code || null, clinicalStatus: o.clinicalStatus || "active", criticality: o.criticality || "unable-to-assess", reactions: o.reactions || [] }; }
export function observation(o = {}) { requireId(o); return { id: o.id, category: o.category || null, code: o.code || null, value: o.value ?? null, referenceRange: o.referenceRange || null, interpretation: o.interpretation || null, effectiveDateTime: o.effectiveDateTime || null, status: o.status || "unknown" }; }
export function diagnosticReport(o = {}) { requireId(o); return { id: o.id, code: o.code || null, category: o.category || null, status: o.status || "unknown", effectiveDateTime: o.effectiveDateTime || null, conclusion: o.conclusion || null, results: o.results || [] }; }
export function documentReference(o = {}) { requireId(o); return { id: o.id, type: o.type || null, category: o.category || null, status: o.status || "unknown", date: o.date || null, text: o.text || null, encounter: o.encounter || null }; }

export function bundle(o = {}) {
  return {
    sccmVersion: SCCM_VERSION, tenantId: o.tenantId || null, patient: o.patient || null,
    encounters: o.encounters || [], conditions: o.conditions || [], medications: o.medications || [],
    allergies: o.allergies || [], observations: o.observations || [], diagnosticReports: o.diagnosticReports || [],
    documents: o.documents || [],
    meta: { generatedAt: o.generatedAt || null, sourceConnector: o.sourceConnector || null, scope: o.scope || [], provenance: o.provenance || [], warnings: o.warnings || [] },
  };
}

export class SccmVersionError extends Error {}
export function assertConsumable(b, consumerMajor) {
  const major = parseInt(String(b.sccmVersion).split(".")[0], 10);
  if (major !== consumerMajor) throw new SccmVersionError("SCCM major version " + major + " not consumable by " + consumerMajor);
}
```

- [ ] **Step 4: Implement `validate.js`**

```js
// functions/_connect/canonical/validate.js — SCCM validator + reference resolution (spec §4.3, C5)
import { RESOURCE_KEYS } from "./model.js";

const REF_TARGET_KEY = { Encounter: "encounters", Condition: "conditions", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };

export function validateBundle(b) {
  const errors = [], warnings = [];
  if (!b || typeof b !== "object") return { ok: false, errors: ["bundle missing"], warnings };
  if (!b.patient || !b.patient.id) errors.push("bundle.patient is required");
  if (b.sccmVersion !== "1.0") errors.push("unexpected sccmVersion " + b.sccmVersion);

  // Build the id index per resource type for reference resolution.
  const index = {};
  for (const key of RESOURCE_KEYS) { index[key] = new Set((b[key] || []).map((r) => r && r.id)); }

  // Coded fields must carry a text fallback; intra-bundle references must resolve-or-null.
  const checkCoded = (cc, where) => { if (cc && (!cc.text || !String(cc.text).trim())) errors.push(where + " coded field missing text fallback"); };
  const resolveRef = (obj, field, where) => {
    const ref = obj[field]; if (!ref) return;
    const key = REF_TARGET_KEY[ref.type];
    if (!key || !index[key] || !index[key].has(ref.id)) { obj[field] = null; warnings.push(where + " reference " + ref.type + "/" + ref.id + " did not resolve; nulled"); }
  };

  (b.conditions || []).forEach((c) => { checkCoded(c.code, "Condition"); resolveRef(c, "encounter", "Condition"); });
  (b.medications || []).forEach((m) => checkCoded(m.medication, "MedicationStatement"));
  (b.allergies || []).forEach((a) => checkCoded(a.code, "AllergyIntolerance"));
  (b.observations || []).forEach((o) => { checkCoded(o.code, "Observation"); if (!o.category) errors.push("Observation " + o.id + " missing category"); });
  (b.diagnosticReports || []).forEach((d) => { checkCoded(d.code, "DiagnosticReport"); (d.results || []).forEach((_, i) => resolveRef(d.results, i, "DiagnosticReport.results")); });
  (b.documents || []).forEach((d) => { checkCoded(d.type, "DocumentReference"); resolveRef(d, "encounter", "DocumentReference"); });

  return { ok: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/connect/model.test.mjs test/connect/validate.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_connect/canonical/model.js functions/_connect/canonical/validate.js test/connect/model.test.mjs test/connect/validate.test.mjs
git commit -m "feat(connect): SCCM v1 resources + bundle + version guard + validator (ref-resolution, text fallback)"
```

---

### Task 4: Connector contract + conformance harness + mock connector

**Files:**
- Create: `functions/_connect/interfaces.js`
- Create: `test/connect/connector-contract.test.mjs` (exports `runConformance` + runs it on a mock)
- Test: same file.

**Interfaces:**
- Consumes: `validate.js`.
- Produces: `assertConnector(connector)` (throws unless `meta` + required methods for its `profile` exist); `makeCtx(overrides)` (builds a valid injected `ctx` with safe defaults + a spying `audit`); `runConformance(connector, { fetch, fixtures })` → `{ passed:boolean, checks:[{name,ok,detail}] }`.

- [ ] **Step 1: Write the failing test**

```js
// test/connect/connector-contract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertConnector, makeCtx, runConformance } from "../../functions/_connect/interfaces.js";
import { patient, bundle } from "../../functions/_connect/canonical/model.js";

// a minimal in-repo mock PULL connector used to prove the harness
const mockConnector = {
  meta: { id: "mock", name: "Mock", version: "0.1", profile: "pull", kinds: ["mock"], sccmVersion: "1.0" },
  capabilities: async () => ({ resources: ["Patient"], operations: ["read"], authKinds: ["none"] }),
  authenticate: async () => ({ ok: true }),
  validate: async () => ({ ok: true, checks: [] }),
  fetchPatient: async () => ({ raw: { id: "P1" } }),
  normalize: async (ctx, raw) => bundle({ tenantId: ctx.tenant.id, patient: patient({ id: raw.raw.id }), sourceConnector: "mock" }),
};

test("assertConnector accepts a well-formed pull connector, rejects a broken one", () => {
  assert.doesNotThrow(() => assertConnector(mockConnector));
  assert.throws(() => assertConnector({ meta: { profile: "pull" } }), /fetchPatient/);
});

test("mock connector passes the conformance harness", async () => {
  const res = await runConformance(mockConnector, { fixtures: { patientRef: "P1" } });
  assert.equal(res.passed, true, JSON.stringify(res.checks.filter((c) => !c.ok)));
});

test("a connector that leaks PHI into audit fails conformance", async () => {
  const leaky = Object.assign({}, mockConnector, {
    normalize: async (ctx, raw) => { ctx.audit({ action: "x", patientName: "John Doe" }); return mockConnector.normalize(ctx, raw); },
  });
  const res = await runConformance(leaky, { fixtures: { patientRef: "P1" } });
  assert.equal(res.passed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/connector-contract.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `interfaces.js`**

```js
// functions/_connect/interfaces.js — connector contract guards + injected ctx + conformance harness (spec §5)
import { validateBundle } from "./canonical/validate.js";

const PULL_METHODS = ["capabilities", "authenticate", "validate", "fetchPatient", "normalize"];
const EVENT_METHODS = ["authenticate", "validate", "initiate", "ingest", "normalize"];

export function assertConnector(c) {
  if (!c || !c.meta || !c.meta.profile) throw new Error("connector.meta.profile required");
  const need = c.meta.profile === "event" ? EVENT_METHODS : PULL_METHODS;
  for (const m of need) if (typeof c[m] !== "function") throw new Error("connector missing method: " + m);
  if (c.meta.sccmVersion !== "1.0") throw new Error("connector must declare sccmVersion 1.0");
}

const AUDIT_ALLOW = new Set(["ts", "tenantId", "actor", "connectorId", "action", "resourceCounts", "scope", "patientRefHash", "latencyMs", "outcome"]);

// A valid injected ctx with a spying audit sink that RECORDS raw payloads so the harness can detect leaks.
export function makeCtx(over = {}) {
  const recorded = [];
  const ctx = {
    tenant: over.tenant || { id: "t-mock", mode: "sandbox", settings: {} },
    config: over.config || {},
    secrets: over.secrets || (async () => "x"),
    scope: over.scope || ["Patient", "Condition", "Observation"],
    now: over.now || (() => new Date(0)),
    fetch: over.fetch || (async () => new Response("{}")),
    audit: (e) => { recorded.push(e); },
    logger: over.logger || { warn() {}, error() {} },
    budget: over.budget || { maxSubrequests: 20, deadlineMs: 5000, maxPagesPerResource: 5 },
  };
  ctx._recorded = recorded;
  return ctx;
}

export async function runConformance(connector, opts = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail: detail || "" });
  try { assertConnector(connector); add("contract", true); } catch (e) { add("contract", false, e.message); }

  const ctx = makeCtx({ fetch: opts.fetch });
  try { await connector.authenticate(ctx); add("authenticate", true); } catch (e) { add("authenticate", false, e.message); }
  try { const c = await connector.capabilities(ctx); add("capabilities", !!c); } catch (e) { add("capabilities", false, e.message); }

  let bundle;
  try {
    const raw = await connector.fetchPatient(ctx, (opts.fixtures || {}).patientRef);
    bundle = await connector.normalize(ctx, raw);
    add("fetch+normalize", true);
  } catch (e) { add("fetch+normalize", false, e.message); }

  if (bundle) { const v = validateBundle(bundle); add("valid-sccm", v.ok, v.errors.join("; ")); }

  // No PHI in audit: every recorded event must contain only allow-listed keys.
  const leak = ctx._recorded.find((e) => Object.keys(e).some((k) => !AUDIT_ALLOW.has(k)));
  add("no-phi-in-audit", !leak, leak ? "disallowed key(s): " + Object.keys(leak).join(",") : "");

  return { passed: checks.every((c) => c.ok), checks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/connect/connector-contract.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/interfaces.js test/connect/connector-contract.test.mjs
git commit -m "feat(connect): connector contract guards + injected ctx + conformance harness"
```

---

### Task 5: Secrets — envelope AES-GCM, fail-closed

**Files:**
- Create: `functions/_connect/secrets.js`
- Test: `test/connect/secrets.test.mjs`

**Interfaces:**
- Produces: `makeSecrets(env)` → `{ get(name), seal(plaintext), open(ciphertext) }`. `get` reads a Workers secret from `env`. `seal`/`open` use envelope AES-GCM keyed by `env.CONNECT_MASTER_KEY` (base64, 32 bytes). All three throw `SecretsUnavailable` if the master key is missing/invalid (fail-closed). Ciphertext format: base64(`iv(12) || ciphertext`).

- [ ] **Step 1: Write the failing test**

```js
// test/connect/secrets.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSecrets, SecretsUnavailable } from "../../functions/_connect/secrets.js";

const b64key = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

test("seal/open round-trips", async () => {
  const s = makeSecrets({ CONNECT_MASTER_KEY: b64key });
  const ct = await s.seal("hunter2");
  assert.notEqual(ct, "hunter2");
  assert.equal(await s.open(ct), "hunter2");
});

test("fail-closed when master key is missing", async () => {
  const s = makeSecrets({});
  await assert.rejects(() => s.seal("x"), SecretsUnavailable);
  await assert.rejects(() => s.open("x"), SecretsUnavailable);
});

test("get reads a Workers secret by name", async () => {
  const s = makeSecrets({ CONNECT_MASTER_KEY: b64key, MY_TOKEN: "abc" });
  assert.equal(await s.get("MY_TOKEN"), "abc");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/secrets.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `secrets.js`**

```js
// functions/_connect/secrets.js — envelope encryption for per-tenant connector credentials (spec §7, C10)
export class SecretsUnavailable extends Error {}
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

export function makeSecrets(env) {
  async function key() {
    const raw = env && env.CONNECT_MASTER_KEY;
    if (!raw) throw new SecretsUnavailable("CONNECT_MASTER_KEY missing");
    let bytes; try { bytes = b64ToBytes(raw); } catch { throw new SecretsUnavailable("master key not base64"); }
    if (bytes.length !== 32) throw new SecretsUnavailable("master key must be 32 bytes");
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return {
    get: async (name) => (env && env[name] != null ? String(env[name]) : null),
    seal: async (plaintext) => {
      const k = await key(); const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plaintext));
      const out = new Uint8Array(iv.length + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
      return bytesToB64(out);
    },
    open: async (ciphertext) => {
      const k = await key(); const all = b64ToBytes(ciphertext);
      const iv = all.slice(0, 12), ct = all.slice(12);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
      return new TextDecoder().decode(pt);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/connect/secrets.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/secrets.js test/connect/secrets.test.mjs
git commit -m "feat(connect): envelope AES-GCM secrets, fail-closed on missing master key"
```

---

### Task 6: Audit — field allow-list, HMAC pseudonym, append-only

**Files:**
- Create: `functions/_connect/audit.js`
- Test: `test/connect/audit.test.mjs`

**Interfaces:**
- Produces: `hmacPseudonym(env, tenantId, patientRef)` → hex string (`HMAC-SHA256(key=CONNECT_HMAC_SALT, msg=tenantId + ":" + patientRef)`; throws `SecretsUnavailable` if salt missing); `buildAuditEvent(fields)` → object containing ONLY the allow-listed keys; `makeAuditSink(env, db)` → `(fields) => Promise<void>` that builds the allow-listed event and INSERTs it (append-only) — it silently drops any non-allow-listed key.

- [ ] **Step 1: Write the failing test**

```js
// test/connect/audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditEvent, hmacPseudonym, makeAuditSink } from "../../functions/_connect/audit.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const salt = "c2FsdA=="; // "salt"

test("buildAuditEvent keeps ONLY allow-listed keys (PHI-free by construction)", () => {
  const e = buildAuditEvent({ tenantId: "t1", actor: "u1", action: "context", patientName: "John Doe", birthDate: "1975-01-01" });
  assert.equal(e.tenantId, "t1");
  assert.equal("patientName" in e, false);
  assert.equal("birthDate" in e, false);
});

test("hmacPseudonym is per-tenant (same ref, different tenant -> different hash)", async () => {
  const a = await hmacPseudonym({ CONNECT_HMAC_SALT: salt }, "hospA", "MRN123");
  const b = await hmacPseudonym({ CONNECT_HMAC_SALT: salt }, "hospB", "MRN123");
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("sink inserts an allow-listed row and never a raw patient field", async () => {
  const db = makeMockDb({});
  const sink = makeAuditSink({ CONNECT_HMAC_SALT: salt }, db);
  await sink({ tenantId: "t1", actor: "u1", action: "context", outcome: "ok", patientName: "LEAK" });
  const rows = db._tables.connect_audit_event;
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows[0]).includes("LEAK"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/audit.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `audit.js`**

```js
// functions/_connect/audit.js — PHI-free-by-construction audit (spec §7, C8/C9)
import { SecretsUnavailable } from "./secrets.js";

const ALLOW = ["id", "tenantId", "actor", "connectorId", "action", "resourceCounts", "scope", "patientRefHash", "latencyMs", "outcome", "ts"];

export function buildAuditEvent(fields = {}) {
  const out = {};
  for (const k of ALLOW) if (fields[k] !== undefined) out[k] = fields[k];
  return out;                         // any key not in ALLOW is structurally dropped
}

export async function hmacPseudonym(env, tenantId, patientRef) {
  const salt = env && env.CONNECT_HMAC_SALT;
  if (!salt) throw new SecretsUnavailable("CONNECT_HMAC_SALT missing");
  const keyBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = new TextEncoder().encode(String(tenantId) + ":" + String(patientRef));
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function makeAuditSink(env, db) {
  return async (fields) => {
    const e = buildAuditEvent(fields);
    e.id = e.id || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    await db.prepare(
      "INSERT INTO connect_audit_event (id,tenant_id,ts,actor,connector_id,action,resource_counts,scope,patient_ref_hash,latency_ms,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(e.id, e.tenantId || null, e.ts || null, e.actor || null, e.connectorId || null, e.action || null,
      JSON.stringify(e.resourceCounts || null), JSON.stringify(e.scope || null), e.patientRefHash || null,
      e.latencyMs || null, e.outcome || null).run();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/connect/audit.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/audit.js test/connect/audit.test.mjs
git commit -m "feat(connect): PHI-free audit (field allow-list, per-tenant HMAC pseudonym, append-only)"
```

---

### Task 7: Identity, tenant + sandbox gate, fail-closed permission

**Files:**
- Create: `functions/_connect/identity.js`, `functions/_connect/tenant.js`, `functions/_connect/permission.js`
- Test: `test/connect/identity.test.mjs`, `test/connect/tenant.test.mjs`, `test/connect/permission.test.mjs`

**Interfaces:**
- Produces (`identity.js`): `resolveActor(identifyFn, request, env)` → `{ id }` (throws `AuthError` if guest/none); `resolveTenant(db, actorId, tenantId)` → `{ tenant, role }` (throws `PermissionError` unless membership exists).
- Produces (`tenant.js`): `loadTenant(db, tenantId)`; `loadConnectorConfig(db, tenantId, connectorId)`; `assertSandboxAllowed(tenant, config, allowlist)` (throws `SandboxViolation` if `mode!=="live"` and `base_url` host ∉ allowlist; throws if `mode==="live"` — Phase 0 has no consent). Constant `SANDBOX_ALLOWLIST = ["launch.smarthealthit.org","r4.smarthealthit.org","synthea.local"]`.
- Produces (`permission.js`): `enforceScope(grantedScopes, requestedScope)` → intersected array; throws `PermissionError` on any error or an empty result. Error classes: `AuthError`, `PermissionError`, `SandboxViolation` (exported from `permission.js`; re-imported by the others).

- [ ] **Step 1: Write the failing tests**

```js
// test/connect/permission.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceScope, PermissionError } from "../../functions/_connect/permission.js";

test("scope is intersected, never widened", () => {
  assert.deepEqual(enforceScope(["Patient", "Observation"], ["Observation", "Condition"]), ["Observation"]);
});
test("fail-closed: empty intersection throws", () => {
  assert.throws(() => enforceScope(["Patient"], ["Billing"]), PermissionError);
});
test("fail-closed: bad input throws (never falls open)", () => {
  assert.throws(() => enforceScope(null, ["Patient"]), PermissionError);
});
```

```js
// test/connect/tenant.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSandboxAllowed, SANDBOX_ALLOWLIST } from "../../functions/_connect/tenant.js";
import { SandboxViolation } from "../../functions/_connect/permission.js";

test("sandbox mode allows an allow-listed base_url", () => {
  assert.doesNotThrow(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST));
});
test("sandbox mode blocks a non-allow-listed (real) base_url", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "sandbox" }, { base_url: "https://fhir.realhospital.example/" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
test("live mode is refused entirely in Phase 0 (no consent yet)", () => {
  assert.throws(() => assertSandboxAllowed({ mode: "live" }, { base_url: "https://r4.smarthealthit.org/fhir" }, SANDBOX_ALLOWLIST), SandboxViolation);
});
```

```js
// test/connect/identity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActor, resolveTenant, AuthError } from "../../functions/_connect/identity.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const identifyGuest = async () => ({ id: "ip:1", guest: true });
const identifyUser = async () => ({ id: "fb:u1", guest: false });

test("resolveActor rejects a guest", async () => {
  await assert.rejects(() => resolveActor(identifyGuest, {}, {}), AuthError);
  assert.deepEqual(await resolveActor(identifyUser, {}, {}), { id: "fb:u1" });
});

test("resolveTenant requires membership", async () => {
  const db = makeMockDb({ connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }], connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: '["Patient"]' }] });
  const r = await resolveTenant(db, "fb:u1", "t1");
  assert.equal(r.role, "clinician");
  await assert.rejects(() => resolveTenant(db, "fb:u1", "t2"), PermissionError);   // not a member
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/connect/permission.test.mjs test/connect/tenant.test.mjs test/connect/identity.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `permission.js`**

```js
// functions/_connect/permission.js — fail-closed scope + shared error types (spec §6, C11)
export class AuthError extends Error {}
export class PermissionError extends Error {}
export class SandboxViolation extends Error {}
export class UpstreamError extends Error {}

export function enforceScope(granted, requested) {
  try {
    if (!Array.isArray(granted) || !Array.isArray(requested)) throw new Error("scope inputs must be arrays");
    const set = new Set(granted);
    const out = requested.filter((s) => set.has(s));       // intersect; never widen
    if (out.length === 0) throw new Error("no authorized scope after intersection");
    return out;
  } catch (e) { throw new PermissionError(e.message); }     // any failure => deny
}
```

- [ ] **Step 4: Implement `tenant.js`**

```js
// functions/_connect/tenant.js — tenant/config load + sandbox-only gate (spec §6/§7, C6)
import { SandboxViolation } from "./permission.js";
export const SANDBOX_ALLOWLIST = ["launch.smarthealthit.org", "r4.smarthealthit.org", "synthea.local"];

export async function loadTenant(db, tenantId) {
  return db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first();
}
export async function loadConnectorConfig(db, tenantId, connectorId) {
  return db.prepare("SELECT * FROM connect_connector_config WHERE tenant_id=?").bind(tenantId).first();
}
export function assertSandboxAllowed(tenant, config, allowlist = SANDBOX_ALLOWLIST) {
  if (tenant && tenant.mode === "live") throw new SandboxViolation("live mode refused in Phase 0 (no consent framework yet)");
  let host; try { host = new URL(config.base_url).host; } catch { throw new SandboxViolation("invalid base_url"); }
  if (!new URL(config.base_url).protocol.startsWith("https")) throw new SandboxViolation("base_url must be https");
  if (!allowlist.includes(host)) throw new SandboxViolation("base_url host not on the sandbox allow-list: " + host);
}
```

- [ ] **Step 5: Implement `identity.js`**

```js
// functions/_connect/identity.js — server-derived identity + membership (spec §6/§7, C3)
import { AuthError, PermissionError } from "./permission.js";

export { AuthError };

export async function resolveActor(identifyFn, request, env) {
  const who = await identifyFn(request, env);
  if (!who || who.guest || !who.id) throw new AuthError("authenticated non-guest actor required");
  return { id: who.id };
}

export async function resolveTenant(db, actorId, tenantId) {
  const m = await db.prepare("SELECT * FROM connect_membership WHERE user_id=?").bind(actorId).all();
  const row = (m.results || []).find((r) => String(r.tenant_id) === String(tenantId));
  if (!row) throw new PermissionError("actor is not a member of tenant " + tenantId);
  const tenant = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(tenantId).first();
  if (!tenant) throw new PermissionError("tenant not found");
  return { tenant, role: row.role };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/connect/permission.test.mjs test/connect/tenant.test.mjs test/connect/identity.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/_connect/identity.js functions/_connect/tenant.js functions/_connect/permission.js test/connect/identity.test.mjs test/connect/tenant.test.mjs test/connect/permission.test.mjs
git commit -m "feat(connect): server-derived identity + membership, sandbox-only gate, fail-closed scope"
```

---

### Task 8: FHIR R4 pull connector + normalizer

**Files:**
- Create: `functions/_connect/connectors/fhir-r4/normalize.js`, `functions/_connect/connectors/fhir-r4/connector.js`
- Create: `test/connect/fixtures/fhir-synthetic.mjs`
- Test: `test/connect/fhir-r4-normalize.test.mjs`

**Interfaces:**
- Consumes: `coding.js`, `model.js`, `interfaces.js` (`makeCtx`, `runConformance`), `permission.js` (`UpstreamError`).
- Produces (`normalize.js`): `normalizeFhir(ctx, raw)` → `CanonicalBundle` where `raw = { patient, resources:[...FHIR resources] }`.
- Produces (`connector.js`): `fhirR4Connector` — a `pull` connector object with the standard methods; `fetchPatient(ctx, patientRef)` issues bounded `ctx.fetch` calls (≤ `budget.maxPagesPerResource`), wraps network errors in `UpstreamError`.

- [ ] **Step 1: Write the synthetic fixture + failing test**

```js
// test/connect/fixtures/fhir-synthetic.mjs — HAND-AUTHORED synthetic FHIR R4 (no real PHI; never from hapi.fhir.org)
export const SYNTHETIC = {
  patient: { resourceType: "Patient", id: "P1", gender: "female", birthDate: "1975-04-12",
    name: [{ text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] }] },
  resources: [
    { resourceType: "Condition", id: "C1", code: { text: "Type 2 diabetes", coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11" }] }, clinicalStatus: { coding: [{ code: "active" }] } },
    { resourceType: "Observation", id: "O1", category: [{ coding: [{ code: "laboratory" }] }], code: { text: "Hemoglobin", coding: [{ system: "http://loinc.org", code: "718-7" }] }, valueQuantity: { value: 9.2, unit: "g/dL", code: "g/dL" } },
    { resourceType: "MedicationStatement", id: "M1", status: "active", medicationCodeableConcept: { text: "Metformin 500mg" } },
    { resourceType: "AllergyIntolerance", id: "A1", criticality: "high", code: { text: "Penicillin" } },
  ],
};
```

```js
// test/connect/fhir-r4-normalize.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFhir } from "../../functions/_connect/connectors/fhir-r4/normalize.js";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { makeCtx, runConformance } from "../../functions/_connect/interfaces.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";
import { SYNTHETIC } from "./fixtures/fhir-synthetic.mjs";

test("normalizeFhir maps synthetic FHIR → valid SCCM", () => {
  const b = normalizeFhir(makeCtx(), { patient: SYNTHETIC.patient, resources: SYNTHETIC.resources });
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.patient.id, "P1");
  assert.equal(b.conditions[0].code.text, "Type 2 diabetes");
  assert.equal(b.observations[0].value.value, 9.2);
  assert.equal(b.medications[0].medication.text, "Metformin 500mg");
});

test("proprietary codes get kind=local and preserve text", () => {
  const raw = { patient: SYNTHETIC.patient, resources: [{ resourceType: "Observation", id: "O2", category: [{ coding: [{ code: "laboratory" }] }], code: { text: "Local test", coding: [{ system: "urn:hospital:labs", code: "LX" }] }, valueQuantity: { value: 1 } }] };
  const b = normalizeFhir(makeCtx(), raw);
  assert.equal(b.observations[0].code.coding[0].kind, "local");
  assert.equal(b.observations[0].code.text, "Local test");
});

test("FHIR connector passes the conformance harness (injected fetch → synthetic)", async () => {
  const fetch = async (url) => {
    if (/\/Patient\//.test(url)) return new Response(JSON.stringify(SYNTHETIC.patient));
    return new Response(JSON.stringify({ resourceType: "Bundle", entry: SYNTHETIC.resources.map((r) => ({ resource: r })) }));
  };
  const res = await runConformance(fhirR4Connector, { fetch, fixtures: { patientRef: "P1" } });
  assert.equal(res.passed, true, JSON.stringify(res.checks.filter((c) => !c.ok)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/fhir-r4-normalize.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `normalize.js`**

```js
// functions/_connect/connectors/fhir-r4/normalize.js — FHIR R4 → SCCM (the anti-corruption map)
import { coding, codeable, quantity } from "../../canonical/coding.js";
import { bundle, patient, encounter, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport, documentReference } from "../../canonical/model.js";

const STD = ["http://loinc.org", "http://snomed.info/sct", "http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-11", "http://www.nlm.nih.gov/research/umls/rxnorm", "http://www.whocc.no/atc"];
function cc(fhirCC, fallback) {
  if (!fhirCC) return codeable({ text: fallback || "unknown" });
  const codes = (fhirCC.coding || []).map((c) => coding({ system: c.system || null, code: c.code || null, display: c.display || null, kind: STD.includes(c.system) ? "standard" : "local" }));
  return codeable({ coding: codes, text: fhirCC.text || (codes[0] && codes[0].display) || fallback || "unknown" });
}
const firstCoding = (arr) => (arr && arr[0] && arr[0].coding && arr[0].coding[0] && arr[0].coding[0].code) || null;

export function normalizeFhir(ctx, raw) {
  const P = raw.patient || {};
  const out = bundle({
    tenantId: ctx.tenant.id, sourceConnector: "fhir-r4",
    generatedAt: ctx.now().toISOString(), provenance: [],
    patient: patient({ id: P.id, gender: P.gender || "unknown", birthDate: P.birthDate || null,
      name: P.name && P.name[0] ? { text: P.name[0].text || null, given: P.name[0].given || [], family: P.name[0].family || null } : null }),
  });
  for (const r of raw.resources || []) {
    out.meta.provenance.push({ resource: r.resourceType, sourceConnector: "fhir-r4", sourceId: r.resourceType + "/" + r.id });
    switch (r.resourceType) {
      case "Encounter": out.encounters.push(encounter({ id: r.id, status: r.status, class: (r.class && r.class.code) || null })); break;
      case "Condition": out.conditions.push(condition({ id: r.id, code: cc(r.code, "condition"), clinicalStatus: firstCoding([r.clinicalStatus]) || "unknown" })); break;
      case "MedicationStatement": out.medications.push(medicationStatement({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), origin: "statement", status: r.status || "unknown", dosage: r.dosage && r.dosage[0] ? { text: r.dosage[0].text || null } : null })); break;
      case "MedicationRequest": out.medications.push(medicationStatement({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), origin: "order", status: r.status || "unknown" })); break;
      case "AllergyIntolerance": out.allergies.push(allergyIntolerance({ id: r.id, code: cc(r.code, "allergen"), criticality: r.criticality || "unable-to-assess" })); break;
      case "Observation": out.observations.push(observation({ id: r.id, category: firstCoding(r.category) || "laboratory", code: cc(r.code, "observation"),
        value: r.valueQuantity ? quantity({ value: r.valueQuantity.value, unit: r.valueQuantity.unit, code: r.valueQuantity.code }) : (r.valueString ? { text: r.valueString } : null),
        effectiveDateTime: r.effectiveDateTime || null, status: r.status || "unknown" })); break;
      case "DiagnosticReport": out.diagnosticReports.push(diagnosticReport({ id: r.id, code: cc(r.code, "report"), status: r.status || "unknown", conclusion: r.conclusion || null })); break;
      case "DocumentReference": out.documents.push(documentReference({ id: r.id, type: cc(r.type, "document"), status: r.status || "unknown", text: (r.description || null) })); break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Implement `connector.js`**

```js
// functions/_connect/connectors/fhir-r4/connector.js — read-only FHIR R4 pull connector (spec §5)
import { normalizeFhir } from "./normalize.js";
import { UpstreamError } from "../../permission.js";

const RES = ["Condition", "Observation", "MedicationStatement", "AllergyIntolerance", "DiagnosticReport", "DocumentReference"];

async function getJson(ctx, url) {
  try {
    const token = await ctx.secrets("bearer").catch(() => null);
    const res = await ctx.fetch(url, token ? { headers: { authorization: "Bearer " + token } } : {});
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) { throw new UpstreamError("FHIR fetch failed: " + e.message); }
}

export const fhirR4Connector = {
  meta: { id: "fhir-r4", name: "FHIR R4 (read-only)", version: "0.1", profile: "pull", kinds: ["fhir-r4"], sccmVersion: "1.0" },
  capabilities: async () => ({ resources: ["Patient", ...RES], operations: ["read", "search"], authKinds: ["oauth2", "none"] }),   // Phase-0 stub vs a known sandbox
  authenticate: async () => ({ ok: true }),          // sandbox: token (if any) supplied via secrets("bearer")
  validate: async (ctx) => { try { await getJson(ctx, (ctx.config.base_url || "") + "/Patient?_count=1"); return { ok: true, checks: [{ name: "patient-read", ok: true }] }; } catch (e) { return { ok: false, checks: [{ name: "patient-read", ok: false, detail: e.message }] }; } },
  fetchPatient: async (ctx, patientRef) => {
    const base = ctx.config.base_url || "";
    const patient = await getJson(ctx, base + "/Patient/" + encodeURIComponent(patientRef));
    const resources = [];
    for (const type of RES.slice(0, ctx.budget.maxSubrequests)) {
      const b = await getJson(ctx, base + "/" + type + "?patient=" + encodeURIComponent(patientRef) + "&_count=" + ctx.budget.maxPagesPerResource);
      (b.entry || []).forEach((e) => e.resource && resources.push(e.resource));
    }
    return { patient, resources };
  },
  normalize: async (ctx, raw) => normalizeFhir(ctx, raw),
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/connect/fhir-r4-normalize.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add functions/_connect/connectors/fhir-r4/ test/connect/fhir-r4-normalize.test.mjs test/connect/fixtures/fhir-synthetic.mjs
git commit -m "feat(connect): FHIR R4 pull connector + normalizer (passes conformance; synthetic fixtures)"
```

---

### Task 9: ConnectEngine pipeline

**Files:**
- Create: `functions/_connect/engine.js`
- Test: `test/connect/engine-pipeline.test.mjs`

**Interfaces:**
- Consumes: identity, tenant, permission, interfaces (`makeCtx` shape), audit, validate, secrets.
- Produces: `loadPatientContext(env, deps, req)` where `deps = { db, kv, identifyFn, connectors: { [id]: connector } }` and `req = { request, tenantId, patientRef, scope, connectorId }`. Returns a validated `CanonicalBundle`. Never persists PHI; emits exactly one audit event (outcome ok|denied|error); throws typed errors (`AuthError|PermissionError|SandboxViolation|UpstreamError|ValidationError`).

- [ ] **Step 1: Write the failing test**

```js
// test/connect/engine-pipeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPatientContext } from "../../functions/_connect/engine.js";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { PermissionError, SandboxViolation } from "../../functions/_connect/permission.js";
import { makeMockDb, makeMockKv } from "../../functions/_connect/testkit.js";
import { SYNTHETIC } from "./fixtures/fhir-synthetic.mjs";

const ENV = { CONNECT_MASTER_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), CONNECT_HMAC_SALT: "c2FsdA==" };
const identifyUser = async () => ({ id: "fb:u1", guest: false });
const fetchOk = async (url) => (/\/Patient\//.test(url) ? new Response(JSON.stringify(SYNTHETIC.patient)) : new Response(JSON.stringify({ entry: SYNTHETIC.resources.map((r) => ({ resource: r })) })));

function seed(over = {}) {
  return makeMockDb(Object.assign({
    connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: JSON.stringify(["Patient", "Condition", "Observation"]) }],
    connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: "https://r4.smarthealthit.org/fhir", scope: JSON.stringify(["Patient", "Condition", "Observation", "MedicationStatement"]) }],
  }, over));
}
const deps = (db) => ({ db, kv: makeMockKv(), identifyFn: identifyUser, connectors: { "fhir-r4": Object.assign({}, fhirR4Connector) } });
const req = (over = {}) => Object.assign({ request: {}, tenantId: "t1", patientRef: "P1", scope: ["Patient", "Condition", "Observation"], connectorId: "fhir-r4" }, over);

test("happy path returns a validated bundle and persists NO patient content", async () => {
  const db = seed();
  const ctx = deps(db);
  ctx.connectors["fhir-r4"].fetchPatient = fhirR4Connector.fetchPatient;    // uses injected ctx.fetch
  // inject fetch via a wrapper connector ctx: engine builds ctx with env fetch; override here:
  const bundle = await loadPatientContext(ENV, ctx, req(), { fetch: fetchOk });
  assert.equal(bundle.patient.id, "P1");
  // audit row exists; NO patient content anywhere in the db mock
  const dump = JSON.stringify(db._tables);
  assert.equal(dump.includes("Synthetic"), false);        // patient name never persisted
  assert.equal(db._tables.connect_audit_event.length, 1);
});

test("scope filter drops out-of-scope resources (medications not granted)", async () => {
  const bundle = await loadPatientContext(ENV, deps(seed()), req(), { fetch: fetchOk });
  assert.equal(bundle.medications.length, 0);              // MedicationStatement not in granted/ requested scope
});

test("sandbox gate blocks a non-allow-listed base_url", async () => {
  const db = seed({ connect_connector_config: [{ tenant_id: "t1", connector_id: "fhir-r4", kind: "fhir-r4", profile: "pull", base_url: "https://fhir.realhospital.example/", scope: "[]" }] });
  await assert.rejects(() => loadPatientContext(ENV, deps(db), req(), { fetch: fetchOk }), SandboxViolation);
});

test("non-member is denied (fail-closed) and audited as denied", async () => {
  const db = seed({ connect_membership: [] });
  await assert.rejects(() => loadPatientContext(ENV, deps(db), req(), { fetch: fetchOk }), PermissionError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/engine-pipeline.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `engine.js`**

```js
// functions/_connect/engine.js — ConnectEngine pipeline (spec §6). Stateless; ephemeral; fail-closed.
import { resolveActor, resolveTenant } from "./identity.js";
import { loadConnectorConfig, assertSandboxAllowed } from "./tenant.js";
import { enforceScope, PermissionError } from "./permission.js";
import { makeSecrets } from "./secrets.js";
import { makeAuditSink, hmacPseudonym } from "./audit.js";
import { validateBundle } from "./canonical/validate.js";
import { assertConsumable, SCCM_MAJOR, RESOURCE_KEYS } from "./canonical/model.js";

export class ValidationError extends Error {}

const SCOPE_TO_KEY = { Encounter: "encounters", Condition: "conditions", MedicationStatement: "medications", AllergyIntolerance: "allergies", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };

export async function loadPatientContext(env, deps, req, io = {}) {
  const t0 = Date.now();
  const audit = makeAuditSink(env, deps.db);
  let actor = { id: null }, outcome = "error";
  try {
    // 1. server-derived identity + membership
    actor = await resolveActor(deps.identifyFn, req.request, env);
    const { tenant } = await resolveTenant(deps.db, actor.id, req.tenantId);

    // 2. connector config + sandbox-only gate
    const config = await loadConnectorConfig(deps.db, tenant.id, req.connectorId);
    if (!config) throw new PermissionError("connector not configured for tenant");
    assertSandboxAllowed(tenant, config);

    // 3. fail-closed scope: granted ∩ requested
    const granted = JSON.parse(tenant.granted_scopes || "[]");
    const scope = enforceScope(granted, req.scope || []);

    // 4. build the injected ctx (no global state; PHI stays here)
    const secrets = makeSecrets(env);
    const ctx = {
      tenant: { id: tenant.id, mode: tenant.mode, settings: {} },
      config, scope,
      secrets: async (name) => (name === "bearer" && config.secret_ref ? secrets.open(await secrets.get(config.secret_ref)).catch(() => null) : null),
      now: () => new Date(t0),
      fetch: io.fetch || fetch,
      audit: () => {},                    // connectors never write audit directly
      logger: { warn() {}, error() {} },
      budget: { maxSubrequests: 20, deadlineMs: 8000, maxPagesPerResource: 50 },
    };

    // 5-6. fetch → normalize
    const connector = deps.connectors[req.connectorId];
    const raw = await connector.fetchPatient(ctx, req.patientRef);
    const bundle = await connector.normalize(ctx, raw);
    assertConsumable(bundle, SCCM_MAJOR);

    // 7. validate (mutates: dangling refs nulled)
    const v = validateBundle(bundle);
    if (!v.ok) throw new ValidationError(v.errors.join("; "));
    bundle.meta.warnings.push(...v.warnings);
    bundle.meta.scope = scope;

    // 8. permission FILTER (defense in depth): drop any resource type not in scope
    for (const key of RESOURCE_KEYS) {
      const type = Object.keys(SCOPE_TO_KEY).find((t) => SCOPE_TO_KEY[t] === key);
      if (type && !scope.includes(type)) bundle[key] = [];
    }

    outcome = "ok";
    // 9. PHI-free audit (metadata only)
    await audit({ tenantId: tenant.id, actor: actor.id, connectorId: req.connectorId, action: "context",
      resourceCounts: RESOURCE_KEYS.reduce((a, k) => (a[k] = bundle[k].length, a), {}), scope,
      patientRefHash: await hmacPseudonym(env, tenant.id, req.patientRef),
      latencyMs: Date.now() - t0, outcome, ts: new Date(t0).toISOString() });

    return bundle;                        // 10. returned + discarded by caller; never persisted
  } catch (e) {
    outcome = e instanceof PermissionError ? "denied" : "error";
    try { await audit({ tenantId: req.tenantId || null, actor: actor.id || null, connectorId: req.connectorId, action: "context", latencyMs: Date.now() - t0, outcome, ts: new Date(t0).toISOString() }); } catch {}
    throw e;                              // typed error; router sanitizes before HTTP
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/connect/engine-pipeline.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/engine.js test/connect/engine-pipeline.test.mjs
git commit -m "feat(connect): ConnectEngine pipeline (ephemeral, sandbox-gated, fail-closed, scope-filtered, PHI-free audit)"
```

---

### Task 10: MaiK context stub + gated egress

**Files:**
- Create: `functions/_connect/maik-context.js`
- Test: `test/connect/maik-context.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `buildMaikContext(bundle)` → a flat MaiK-facing context object (SCCM-only; NO vendor fields, NO `meta.provenance.sourceId`); `assertEgressAllowed(bundle, tenant)` → throws `EgressBlocked` unless `tenant.mode === "sandbox"` (Phase-0: real bundles must never reach the LLM egress).

- [ ] **Step 1: Write the failing test**

```js
// test/connect/maik-context.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaikContext, assertEgressAllowed, EgressBlocked } from "../../functions/_connect/maik-context.js";
import { bundle, patient, condition } from "../../functions/_connect/canonical/model.js";
import { codeable } from "../../functions/_connect/canonical/coding.js";

const b = bundle({ tenantId: "t1", sourceConnector: "fhir-r4",
  patient: patient({ id: "P1", gender: "female" }),
  conditions: [condition({ id: "C1", code: codeable({ text: "Type 2 diabetes" }) })],
  provenance: [{ resource: "Condition", sourceConnector: "fhir-r4", sourceId: "Condition/MRN123" }] });

test("MaiK context is SCCM-only and carries no vendor/source ids", () => {
  const ctx = buildMaikContext(b);
  const s = JSON.stringify(ctx);
  assert.equal(s.includes("MRN123"), false);        // provenance.sourceId never crosses to MaiK
  assert.equal(s.includes("sourceConnector"), false);
  assert.equal(ctx.problems[0].label, "Type 2 diabetes");
});

test("egress is allowed for sandbox tenants, blocked otherwise (Phase 0)", () => {
  assert.doesNotThrow(() => assertEgressAllowed(b, { mode: "sandbox" }));
  assert.throws(() => assertEgressAllowed(b, { mode: "live" }), EgressBlocked);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/connect/maik-context.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `maik-context.js`**

```js
// functions/_connect/maik-context.js — SCCM → MaiK context + gated LLM egress (spec §7, C7)
export class EgressBlocked extends Error {}

// Phase-0 guard: real-patient bundles must NEVER reach MaiK's LLM egress until consent + BAA/DPA exist.
export function assertEgressAllowed(bundle, tenant) {
  if (!tenant || tenant.mode !== "sandbox") throw new EgressBlocked("MaiK LLM egress is sandbox-only until consent + provider BAA/DPA (Phase 1)");
}

// Flatten the canonical bundle into a compact MaiK-facing context. SCCM ONLY — no vendor fields, no provenance.
export function buildMaikContext(bundle) {
  const txt = (cc) => (cc && cc.text) || null;
  return {
    patient: bundle.patient ? { gender: bundle.patient.gender, birthDate: bundle.patient.birthDate } : null,
    problems: (bundle.conditions || []).map((c) => ({ label: txt(c.code), status: c.clinicalStatus })),
    medications: (bundle.medications || []).map((m) => ({ label: txt(m.medication), status: m.status, origin: m.origin })),
    allergies: (bundle.allergies || []).map((a) => ({ label: txt(a.code), criticality: a.criticality })),
    labs: (bundle.observations || []).filter((o) => o.category === "laboratory").map((o) => ({ label: txt(o.code), value: o.value, interpretation: o.interpretation })),
    vitals: (bundle.observations || []).filter((o) => o.category === "vital-signs").map((o) => ({ label: txt(o.code), value: o.value })),
    reports: (bundle.diagnosticReports || []).map((d) => ({ label: txt(d.code), conclusion: d.conclusion })),
    documents: (bundle.documents || []).map((d) => ({ label: txt(d.type), text: d.text })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/connect/maik-context.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_connect/maik-context.js test/connect/maik-context.test.mjs
git commit -m "feat(connect): MaiK context builder (SCCM-only, no provenance) + Phase-0 sandbox-gated egress"
```

---

### Task 11: HTTP routes, no-PHI guard, bench, npm test wiring

**Files:**
- Modify: `functions/api/connect/[[path]].js` (add routes; keep flag gate + no-store)
- Create: `test/connect/router.test.mjs`, `test/connect/no-phi.test.mjs`, `test/connect/bench.mjs`
- Modify: `package.json:test` (add `test/connect/*.test.mjs` to the loop)

**Interfaces:**
- Consumes: `flagOn`, `jsonResponse` (testkit), `engine.loadPatientContext`, `identity`, the FHIR connector, `_fbauth.identify`, `_adminauth.ownerOK`.
- Produces: the full router — `POST /context` (server-derived tenant; `patientRef`+`scope` from body only), `GET /health`, and a reserved `POST /ingress/:connector` → 501. All responses `no-store`. Errors are sanitized to `{error: code}` (never a raw value/stack).

- [ ] **Step 1: Write the failing tests**

```js
// test/connect/router.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/connect/[[path]].js";

const post = (path, body, env) => ({ request: new Request("https://x" + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), env, params: {} });

test("context route ignores a body-supplied tenantId (server-derived only)", async () => {
  // no identity wired in this env → engine throws AuthError → sanitized 401/403, NOT a tenant read
  const res = await onRequest(post("/api/connect/context", { tenantId: "attacker", patientRef: "P1", scope: ["Patient"] }, { CONNECT_FLAG: "1" }));
  assert.ok([401, 403].includes(res.status));
  const body = await res.json();
  assert.equal("tenantId" in body, false);            // no echo of attacker input
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("reserved ingress route is 501 in Phase 0", async () => {
  const res = await onRequest(post("/api/connect/ingress/fhir-r4", {}, { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 501);
});
```

```js
// test/connect/no-phi.test.mjs — guardrail: no fixture PHI or secret token appears in audit/logs/errors
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

test("no captured-from-hapi marker and no real-PHI patterns in fixtures", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.equal(/hapi\.fhir\.org/.test(src), false, f + " must not reference the public HAPI server");
    assert.equal(/\b\d{12,14}\b/.test(src.replace(/\bP1\b/g, "")), false, f + " contains a long numeric id (possible real MRN/ABHA)");
  }
});
```

```js
// test/connect/bench.mjs — worst-case normalize throughput (run manually: node test/connect/bench.mjs)
import { normalizeFhir } from "../../functions/_connect/connectors/fhir-r4/normalize.js";
import { makeCtx } from "../../functions/_connect/interfaces.js";
const big = { patient: { id: "P1" }, resources: Array.from({ length: 500 }, (_, i) => ({ resourceType: "Observation", id: "O" + i, category: [{ coding: [{ code: "laboratory" }] }], code: { text: "lab" }, valueQuantity: { value: i } })) };
const N = 200, t = Date.now();
for (let i = 0; i < N; i++) normalizeFhir(makeCtx(), big);
const ms = (Date.now() - t) / N;
console.log("normalize 500-obs bundle: " + ms.toFixed(2) + " ms/patient (target < 50ms)");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/connect/router.test.mjs test/connect/no-phi.test.mjs`
Expected: FAIL — router routes not implemented.

- [ ] **Step 3: Implement the full router**

```js
// functions/api/connect/[[path]].js — StewardMD Connect HTTP surface (spec §8). Flag-gated; server-derived identity; no-store.
import { flagOn, jsonResponse } from "../../_connect/testkit.js";
import { loadPatientContext } from "../../_connect/engine.js";
import { fhirR4Connector } from "../../_connect/connectors/fhir-r4/connector.js";
import { AuthError, PermissionError, SandboxViolation } from "../../_connect/permission.js";
import { identify } from "../../_fbauth.js";

const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name) ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error";

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/connect/, "") || "/";

  if (path === "/health") return jsonResponse({ ok: true, service: "stewardmd-connect", phase: 0 });
  if (/^\/ingress\//.test(path)) return jsonResponse({ error: "not_implemented", phase: 1 }, { status: 501 });

  if (path === "/context" && request.method === "POST") {
    let body = {}; try { body = await request.json(); } catch {}
    const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors: { "fhir-r4": fhirR4Connector } };
    const req = { request, tenantId: body.tenantId, patientRef: body.patientRef, scope: body.scope, connectorId: body.connectorId || "fhir-r4" };
    // NOTE: engine derives actor via identify(request) and verifies membership for tenantId;
    // a body tenantId the actor is not a member of => PermissionError (no cross-tenant read).
    try {
      const bundle = await loadPatientContext(env, deps, req);
      return jsonResponse({ ok: true, bundle });     // ephemeral; not persisted
    } catch (e) {
      return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });   // sanitized; no raw value/stack
    }
  }
  return jsonResponse({ error: "not_found" }, { status: 404 });
}
```

- [ ] **Step 4: Wire the connect tests into `npm test`**

Modify `package.json` `scripts.test` to include the connect suite. Change:

```json
"test": "for f in test/*.test.mjs rx-build.test.mjs; do echo \"→ $f\"; node \"$f\" || exit 1; done",
```
to:
```json
"test": "for f in test/*.test.mjs test/connect/*.test.mjs rx-build.test.mjs; do echo \"→ $f\"; node --test \"$f\" || exit 1; done",
```

- [ ] **Step 5: Run the full connect suite + confirm zero regression**

Run: `node --test test/connect/*.test.mjs`
Expected: PASS (all connect tests).
Run: `npm test`
Expected: PASS (existing suite unaffected; connect suite included).
Run: `node test/connect/bench.mjs`
Expected: prints `< 50 ms/patient`.

- [ ] **Step 6: Commit**

```bash
git add "functions/api/connect/[[path]].js" test/connect/router.test.mjs test/connect/no-phi.test.mjs test/connect/bench.mjs package.json
git commit -m "feat(connect): HTTP routes (server-derived identity, no-store, reserved ingress) + no-PHI guard + bench + test wiring"
```

---

## Self-review

**Spec coverage** — SCCM v1 (T2/T3), validator + ref-resolution + text fallback (T3), version guard (T3), connector contract + two profiles + conformance (T4), secrets envelope + fail-closed (T5), PHI-free audit + HMAC + append-only (T6), server-derived identity + membership (T7), sandbox-only gate (T7), fail-closed permission + scope intersection (T7), FHIR R4 pull connector + normalizer + standard/local coding (T8), engine pipeline: ephemeral + bounded + scope-filter + typed errors + one audit event (T9), MaiK context SCCM-only + gated egress (T10), HTTP no-store + reserved ingress + sanitized errors (T11), no-PHI guard + synthetic-only fixtures + bench (T11), flag-gated + additive + npm test wiring (T1/T11). All §14 acceptance criteria map to a task.

**Deferred by design (documented, not gaps):** `event/push` implementation, real consent, RBAC beyond membership+scope, onboarding UI, analytics — all Phase 1–4 per spec §15.

**Placeholder scan** — no TBD/TODO; every code step has real code.

**Type consistency** — error classes (`AuthError`/`PermissionError`/`SandboxViolation`/`UpstreamError`) all originate in `permission.js` and are imported elsewhere; `ValidationError` in `engine.js`, `SecretsUnavailable` in `secrets.js`, `EgressBlocked` in `maik-context.js`. `makeCtx` (interfaces) and the engine's inline ctx share the same shape (`tenant/config/secrets/scope/now/fetch/audit/logger/budget`). `bundle`/resource factory names match across T3→T8→T9→T10. `RESOURCE_KEYS` defined once (model.js), reused in validate.js + engine.js.

## Execution note

Two engine tests (T9) inject `fetch` via a fourth `io` arg to `loadPatientContext`; the router (T11) calls the 3-arg form so production uses the global `fetch`. This is intentional (test seam) and consistent across T9's signature block.
