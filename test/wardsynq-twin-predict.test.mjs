/* test/wardsynq-twin-predict.test.mjs — TASK 10.12: governed predictions, real data, never facts.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-twin-predict.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, p) => { const d = docs.get(p); return d ? { id: p, name: p, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, out = [];
      for (const [p, d] of docs) { if (!p.startsWith(coll + "/")) continue; if (where && String(d.fields[where.field]) !== String(where.value)) continue; out.push({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime }); }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) { if (w.delete) { docs.delete(w.delete); continue; } const prev = docs.get(w.update.name); docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) }); }
      return { ok: true };
    },
    wCreate: (_e, p, f) => ({ update: { name: p, fields: f }, currentDocument: { exists: false } }),
    wUpdate: (_e, p, f) => ({ update: { name: p, fields: f } }),
    wDelete: (_e, p) => ({ delete: p }),
    fsProject: () => "t", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT = { id: "predict-tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "predict-org" } }) };
const tenantDb = { prepare: () => ({ bind: (...a) => ({ first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }), batch: async () => [] };
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { governedPrediction, PREDICTORS } = await import("../functions/_wardsynq/twin-predict.js");

const ORG = "predict-org";
const DOCTOR = "predict-doctor@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (e) => "cfa:" + createHash("sha256").update(e.toLowerCase()).digest("hex").slice(0, 24);

let ENV;
function seed() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "predict-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "PRED", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
}
async function call(email, path) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: "GET", headers: { "Cf-Access-Authenticated-User-Email": email } }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const meta = () => ({ recordedAt: "2026-09-10T08:00:00.000Z", effectiveAt: "2026-09-10T08:00:00.000Z", amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-10T08:00:00.000Z" }, derivedFrom: [] });

/* ---- 1: the primitive is pure and never fabricates ------------------------------------------------- */

test("1. governedPrediction refuses rather than fabricates a number with under 2 samples", () => {
  const zero = governedPrediction({ metric: "x", samples: [] });
  assert.equal(zero.ok, false);
  assert.equal(zero.prediction, null);
  const one = governedPrediction({ metric: "x", samples: [{ atIso: "2026-09-01T00:00:00Z", value: 5 }] });
  assert.equal(one.ok, false);
});

test("2. every prediction carries model/version, horizon, uncertainty, generation time and the label", () => {
  const r = governedPrediction({ metric: "discharge-volume", samples: [{ atIso: "2026-09-01T00:00:00Z", value: 10 }, { atIso: "2026-09-02T00:00:00Z", value: 14 }], horizonDays: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.prediction.modelId, "wardsynq-moving-average-v1");
  assert.ok(r.prediction.generatedAt);
  assert.equal(r.prediction.horizonDays, 3);
  assert.ok(Number.isFinite(r.prediction.pointEstimate));
  assert.ok(r.prediction.uncertainty && Number.isFinite(r.prediction.uncertainty.stddev));
  assert.equal(r.prediction.label, "PREDICTION - NOT AN OBSERVED FACT");
  assert.equal(r.prediction.inputWindow.sampleSize, 2);
});

test("3. the shape never resembles a twin snapshot 'sections' object - a caller cannot mistake it for a fact", () => {
  const r = governedPrediction({ metric: "x", samples: [{ atIso: "2026-09-01T00:00:00Z", value: 1 }, { atIso: "2026-09-02T00:00:00Z", value: 2 }] });
  assert.equal(r.sections, undefined);
  assert.equal(r.twin, undefined);
  assert.ok(r.prediction);
});

/* ---- 4: honest inventory ----------------------------------------------------------------------------- */

test("4. only two of the seven named metrics are wired, and the other five say so honestly", () => {
  assert.equal(PREDICTORS["discharge-volume"].wired, true);
  assert.equal(PREDICTORS["critical-backlog"].wired, true);
  for (const key of ["bed-demand", "ed-load", "diagnostic-workload", "pharmacy-workload", "blood-demand", "ot-delays"]) {
    assert.equal(PREDICTORS[key].wired, false, key);
    assert.ok(PREDICTORS[key].reason, key);
  }
});

/* ---- 5: real route, real data --------------------------------------------------------------------- */

test("5. discharge-volume is predicted from REAL Encounter periodEnd dates, through the real route", async () => {
  seed();
  const now = Date.parse("2026-09-10T08:00:00.000Z");
  for (let d = 0; d < 10; d++) {
    const dischargedAt = new Date(now - d * 86400000).toISOString();
    await RECORD.append(TENANT.id, [{ resourceType: "Encounter", id: `predict-enc-${d}`, version: 1, patientId: `predict-pat-${d}`, class: "IPD", status: "discharged", identifiers: [], periodStart: dischargedAt, periodEnd: dischargedAt, meta: meta() }]);
  }
  const r = await call(DOCTOR, `/ward/twin-predict?orgId=${ORG}&metric=discharge-volume&lookbackDays=14`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.ok, true);
  assert.ok(r.prediction.pointEstimate >= 0);
  assert.equal(r.prediction.inputWindow.sampleSize > 0, true);
});

test("6. an unknown metric is refused, never silently answered by the nearest wired one", async () => {
  seed();
  const r = await call(DOCTOR, `/ward/twin-predict?orgId=${ORG}&metric=made-up-metric`);
  assert.equal(r.__status, 422);
  assert.equal(r.error, "unknown_metric");
});

test("7. a named-but-unwired metric returns 501, not a fabricated number", async () => {
  seed();
  const r = await call(DOCTOR, `/ward/twin-predict?orgId=${ORG}&metric=blood-demand`);
  assert.equal(r.__status, 501);
  assert.equal(r.error, "not_built");
  assert.match(r.detail, /no blood-inventory data source/);
});

test("8. ADVERSARIAL: cross-tenant data cannot leak into a prediction", async () => {
  seed();
  const OTHER_TENANT = "predict-tenant-b";
  await RECORD.append(OTHER_TENANT, [{ resourceType: "Encounter", id: "leak-enc", version: 1, patientId: "leak-pat", class: "IPD", status: "discharged", identifiers: [], periodStart: "2026-09-09T00:00:00.000Z", periodEnd: "2026-09-09T00:00:00.000Z", meta: meta() }]);
  const r = await call(DOCTOR, `/ward/twin-predict?orgId=${ORG}&metric=discharge-volume`);
  assert.equal(r.__status, 200);
  // Nothing in tenant A, so no sample - proves the OTHER tenant's record did not leak in as data.
  assert.equal(r.ok, false);
  assert.equal(r.error, "insufficient_data");
});
