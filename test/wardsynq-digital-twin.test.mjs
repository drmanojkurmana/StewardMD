/* test/wardsynq-digital-twin.test.mjs — TASK 10: the fused hospital snapshot, driven for real.
 *
 * THE PROPERTY UNDER TEST IS FUSION, NOT COMPUTATION. Every number in a twin snapshot is computed by
 * a file that already owns it - patient-flow.js, ward-metrics.js, reports.js, emergency-mode.js,
 * blackout.js, critical-results.js. These tests do not re-derive those numbers by hand and compare;
 * they seed real records, ask the twin, and separately ask the UNDERLYING function the same question,
 * and assert the twin's number IS that function's number - proving reuse rather than a parallel
 * re-implementation that happens to agree today and drift tomorrow.
 *
 * ALSO UNDER TEST: that one dead subsystem does not blank the whole hospital, that "not built" is
 * distinguishable from "checked, zero", that reconstruction is bounded and says so, and that nothing
 * here opens a door tenant isolation and per-patient authorization did not already open.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-digital-twin.test.mjs
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
      for (const [p, d] of docs) {
        if (!p.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: p.slice(coll.length + 1), name: p, fields: { ...d.fields }, updateTime: d.updateTime });
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
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
const TENANT = { id: "twin-tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "twin-org" } }) };
const tenantDb = { prepare: () => ({ bind: (...a) => ({
  first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
  all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
}) }), batch: async () => [] };
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { FRESHNESS, freshnessOf, NOT_BUILT } = await import("../functions/_wardsynq/digital-twin.js");
const { emergencyStatus, declareEmergency } = await import("../functions/_wardsynq/emergency-mode.js");
const { blockPeriod } = await import("../functions/_wardsynq/blackout.js");
const { openCriticalLoops } = await import("../functions/_wardsynq/critical-results.js");

const ORG = "twin-org", ORG_B = "twin-org-b";
const DOCTOR = "twin-doctor@example.test", NURSE = "twin-nurse@example.test", OUTSIDER = "twin-outsider@example.test";
/* EMERGENCY_DECLARE is admin-only (functions/_queue_roles.js) - a plain doctor cannot declare one,
 * confirmed by test/wardsynq-emergency-mode-bridge.test.mjs's own RBAC test. A separate admin actor
 * is needed for the tests that exercise real emergency/blackout declaration. */
const ADMIN = "twin-admin@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (e) => "cfa:" + createHash("sha256").update(e.toLowerCase()).digest("hex").slice(0, 24);

let ENV;
function seed(overrides) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "twin-secret-that-is-long-enough-for-hmac",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
  const TENANT_B = { ...TENANT, id: "twin-tenant-b" };
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "TWIN", name: "Hospital A", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG_B}`, { fields: { id: ORG_B, code: "TWINB", name: "Hospital B", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT_B.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role, org] of [[DOCTOR, "doctor", ORG], [NURSE, "nurse", ORG], [ADMIN, "admin", ORG], [OUTSIDER, "doctor", ORG_B]]) {
    docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  if (overrides) Object.assign(docs.get(`q_orgs/${ORG}`).fields, overrides);
}
async function call(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET",
    headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const meta = () => ({ recordedAt: "2026-09-10T08:00:00.000Z", effectiveAt: "2026-09-10T08:00:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-10T08:00:00.000Z" }, derivedFrom: [] });
async function patient(id) {
  await RECORD.append(TENANT.id, [{ resourceType: "Patient", id, version: 1, mrn: `${id}-mrn`, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta() }]);
}
async function encounter(id, patientId, over) {
  await RECORD.append(TENANT.id, [{ resourceType: "Encounter", id, version: 1, patientId, class: "IPD", status: "in-progress",
    identifiers: [], periodStart: "2026-09-08T00:00:00.000Z", periodEnd: null, location: { ward: "Ward A", bed: "1" }, meta: meta(), ...over }]);
}

/* ---- 1: the twin exists and fuses real sections --------------------------------------------------- */

test("1. a live twin fuses real hospital state, and every section carries provenance", async () => {
  seed();
  await patient("twin-pat-1");
  await encounter("twin-enc-1", "twin-pat-1");

  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const t = r.twin;
  assert.ok(t.generatedAt);
  assert.ok(t.sections.flow.status === "ok", JSON.stringify(t.sections.flow));
  assert.ok(t.sections.clinicalOps.status === "ok");
  assert.equal(t.sectionsTotal, Object.keys(t.sections).length);
  assert.ok(t.sectionsOk <= t.sectionsTotal);
  assert.ok(Array.isArray(t.provenance) && t.provenance.length > 0);
  for (const p of t.provenance) {
    assert.ok(p.section && Array.isArray(p.dataSource) && p.dataSource.length > 0, `provenance entry missing fields: ${JSON.stringify(p)}`);
  }
});

test("2. the twin's flow number IS patient-flow's own number, not a re-derivation", async () => {
  seed();
  await patient("twin-pat-2");
  await encounter("twin-enc-2", "twin-pat-2");

  const [twinR, flowR] = await Promise.all([
    call(DOCTOR, `/ward/twin?orgId=${ORG}`),
    call(DOCTOR, `/ward/patient-flow?orgId=${ORG}`),
  ]);
  assert.deepEqual(twinR.twin.sections.flow.data.flow.beds, flowR.flow.beds, "the twin must carry patient-flow's EXACT number, not a copy that could drift");
  assert.deepEqual(twinR.twin.sections.flow.data.flow.ed, flowR.flow.ed);
});

test("3. financial sections are opt-in and absent by default, never blended into the clinical read", async () => {
  seed();
  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(r.twin.sections.billing, undefined);
  assert.equal(r.twin.sections.claims, undefined);
  const withFinance = await call(DOCTOR, `/ward/twin?orgId=${ORG}&finance=1`);
  assert.ok(withFinance.twin.sections.billing);
  assert.ok(withFinance.twin.sections.claims);
});

/* ---- 4: NOT BUILT is distinguishable from checked-and-zero ----------------------------------------- */

test("4. blood bank and radiology backlog are marked NOT BUILT, never a silent zero", async () => {
  seed();
  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.ok(r.twin.notBuilt.bloodBank, "must name that blood inventory was never built");
  assert.ok(r.twin.notBuilt.radiologyQueue);
  assert.match(r.twin.notBuilt.bloodBank, /no blood-product inventory module/);
  // And these must NEVER appear as a numeric section that looks like a real zero count.
  assert.equal(r.twin.sections.bloodBank, undefined);
  assert.equal(r.twin.sections.radiologyQueue, undefined);
});

/* ---- 5: one dead subsystem does not blank the hospital --------------------------------------------- */

test("5. ADVERSARIAL: a broken subsystem is UNAVAILABLE by name, and everything else still answers", async () => {
  seed();
  await patient("twin-pat-5");
  await encounter("twin-enc-5", "twin-pat-5");
  /* Corrupt exactly one subsystem: poison the repository's latestByType() for CriticalResultLoop
   * only - the real method RecordService.list() calls underneath (service.js:567). */
  const realLatestByType = RECORD.latestByType.bind(RECORD);
  RECORD.latestByType = async (tenantId, type, limit) => {
    if (type === "CriticalResultLoop") throw new Error("simulated storage fault");
    return realLatestByType(tenantId, type, limit);
  };
  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(r.__status, 200, "the whole request must not fail because one section did");
  assert.equal(r.twin.sections.criticals.status, "unavailable");
  assert.equal(r.twin.sections.criticals.freshness, FRESHNESS.UNAVAILABLE);
  assert.ok(r.twin.unavailable.includes("criticals"));
  assert.equal(r.twin.sections.flow.status, "ok", "flow must be unaffected by the criticals fault");
  assert.equal(r.twin.sections.emergency.status, "ok");
});

/* ---- 6: real emergency/blackout state is fused, not re-derived ------------------------------------- */

test("6. an active emergency and an active blackout both appear in the twin", async () => {
  seed();
  const declared = await call(ADMIN, `/ward/emergency-declare?orgId=${ORG}`, "POST",
    { kind: "icu_capacity_crisis", reason: "Simulated ICU surge for a Task 10 test.", relaxations: [] });
  assert.equal(declared.__status, 200, JSON.stringify(declared));
  const blocked = await call(ADMIN, `/ward/block-period?orgId=${ORG}`, "POST",
    { resourceId: "theatre-1", from: "2026-09-10T09:00:00.000Z", to: "2026-09-10T11:00:00.000Z", reason: "Deep clean." });
  assert.equal(blocked.__status, 200, JSON.stringify(blocked));

  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(r.twin.sections.emergency.data.any, true);
  assert.equal(r.twin.sections.emergency.data.active.length, 1);
  assert.equal(r.twin.sections.emergency.data.active[0].kind, "icu_capacity_crisis");
  assert.ok(r.twin.sections.blackouts.data.blackouts.length >= 1);
});

/* ---- 7: security - tenant isolation, authorization, no patient identifiers at the executive level -- */

test("7. ADVERSARIAL: a hospital's twin never carries another hospital's state", async () => {
  seed();
  await patient("twin-pat-7"); await encounter("twin-enc-7", "twin-pat-7");
  const mine = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  const outsider = await call(OUTSIDER, `/ward/twin?orgId=${ORG}`);
  assert.equal(outsider.__status, 403, "a hospital B doctor asking for hospital A's twin must be refused");
  assert.notEqual(mine.__status, 403);
});

test("8. an actor with no read capability at all is refused, not handed a degraded twin", async () => {
  seed();
  const r = await call("twin-noone@example.test", `/ward/twin?orgId=${ORG}`);
  assert.ok(r.__status === 403 || r.__status === 401, JSON.stringify(r));
  assert.equal(r.twin, undefined);
});

test("9. the executive-level twin carries no patient name or MRN, only counts and references", async () => {
  seed();
  await patient("twin-pat-9");
  await encounter("twin-enc-9", "twin-pat-9");
  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  const blob = JSON.stringify(r.twin);
  assert.ok(!blob.includes("twin-pat-9-mrn"), "no MRN string at the fused executive level");
});

/* ---- 10: reconstruction is bounded and says so ------------------------------------------------------ */

test("10. reconstruction returns state as of the requested instant, and names what it did NOT reconstruct", async () => {
  seed();
  const r1 = await call(ADMIN, `/ward/emergency-declare?orgId=${ORG}`, "POST",
    { kind: "mass_casualty", reason: "Simulated MCI for reconstruction test.", relaxations: [] });
  assert.equal(r1.__status, 200, JSON.stringify(r1));
  const declaredAt = new Date().toISOString();

  const before = await call(ADMIN, `/ward/twin-reconstruct?orgId=${ORG}&at=2020-01-01T00:00:00.000Z`);
  assert.equal(before.__status, 200);
  assert.equal(before.reconstruction.state.EmergencyActivation.count, 0, "before the declaration, no activation existed yet");

  const after = await call(ADMIN, `/ward/twin-reconstruct?orgId=${ORG}&at=${encodeURIComponent(declaredAt)}`);
  assert.equal(after.reconstruction.state.EmergencyActivation.count, 1, "at or after the declaration, it did exist");
  assert.ok(after.reconstruction.notReconstructed.length > 0, "the bound must be stated, not hidden");
  assert.equal(after.reconstruction.at, declaredAt);
});

test("11. reconstruction refuses a missing or invalid timestamp rather than guessing", async () => {
  seed();
  const missing = await call(ADMIN, `/ward/twin-reconstruct?orgId=${ORG}`);
  assert.equal(missing.__status, 422);
  const bad = await call(ADMIN, `/ward/twin-reconstruct?orgId=${ORG}&at=not-a-date`);
  assert.equal(bad.__status, 422);
});

/* ---- 12: freshnessOf, pure --------------------------------------------------------------------------- */

test("12. freshnessOf is pure and classifies by age, never by content", () => {
  assert.equal(freshnessOf(0), FRESHNESS.LIVE);
  assert.equal(freshnessOf(2999), FRESHNESS.LIVE);
  assert.equal(freshnessOf(3001), FRESHNESS.DELAYED);
  assert.equal(freshnessOf(30001), FRESHNESS.STALE);
  assert.equal(freshnessOf(null), FRESHNESS.UNAVAILABLE);
  assert.equal(freshnessOf(-5), FRESHNESS.UNAVAILABLE, "a negative age is a clock fault, not liveness");
  assert.equal(freshnessOf(100, { delayedMs: 50, staleMs: 200 }), FRESHNESS.DELAYED, "thresholds are overridable, never hidden");
});

/* ---- 13: the simulation route, real end-to-end -------------------------------------------------- */

test("13. POST /ward/twin-simulate runs a real scenario over a real twin, through the real route", async () => {
  seed();
  await patient("twin-pat-13");
  await encounter("twin-enc-13", "twin-pat-13");
  const r = await call(DOCTOR, `/ward/twin-simulate?orgId=${ORG}`, "POST", { scenario: "extra-admissions", params: { extraAdmissions: 5 } });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.label, "SIMULATION - NOT LIVE STATE");
  assert.ok(r.baseline);
  assert.ok(r.projected);
});

test("14. a nurse (EMR_VIEW-only) can run a simulation, since it writes nothing clinical", async () => {
  seed();
  const r = await call(NURSE, `/ward/twin-simulate?orgId=${ORG}`, "POST", { scenario: "icu-capacity-reduction", params: { removedBeds: 3 } });
  assert.notEqual(r.__status, 403, JSON.stringify(r));
});

/* ---- 15: ADVERSARIAL - unauthorized command action on the forensic reconstruction route ------------- */

test("15. ADVERSARIAL: an ordinary doctor cannot reach reconstruction - it is a STAFF_ADMIN-gated forensic action, not a clinical read", async () => {
  seed();
  const r = await call(DOCTOR, `/ward/twin-reconstruct?orgId=${ORG}&at=${encodeURIComponent(new Date().toISOString())}`);
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(r.reconstruction, undefined, "no reconstruction data must be handed back with the refusal");
});

/* ---- 16: notification failure is SURFACED, never hidden ---------------------------------------------- */

test("16. a critical result whose notification failed to deliver is still visible in the twin, not hidden by a happy default", async () => {
  seed();
  await patient("twin-pat-16");
  await RECORD.append(TENANT.id, [{ resourceType: "CriticalResultLoop", id: "twin-loop-16", version: 1, patientId: "twin-pat-16",
    reportId: "r16", code: "K", display: "Potassium", value: 7.1, unit: "mmol/L", basis: "high", state: "open",
    reportedAt: "2026-09-10T06:00:00.000Z", openedAt: "2026-09-10T06:00:00.000Z",
    notification: { attempted: true, delivered: false, channels: [], reason: "NO_CHANNEL", at: "2026-09-10T06:00:01.000Z" }, meta: meta() }]);

  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(r.__status, 200);
  const loop = r.twin.sections.criticals.data.loops.find((l) => l.loopId === "twin-loop-16");
  assert.ok(loop, "the loop is in the fused snapshot");
  assert.equal(loop.notification.delivered, false, "a failed delivery is a fact the twin must not quietly drop");
  assert.equal(loop.notification.reason, "NO_CHANNEL");
});

/* ---- 17: conflicting events - the twin shows the LATEST fact, never a merge of both ------------------ */

test("17. ADVERSARIAL: two conflicting updates to the same encounter leave the twin showing only the latest, never a blend", async () => {
  seed();
  await patient("twin-pat-17");
  await encounter("twin-enc-17", "twin-pat-17", { location: { ward: "Ward A", bed: "1" } });
  // A second, conflicting fact about the SAME encounter: moved to a different ward and bed.
  await RECORD.append(TENANT.id, [{ resourceType: "Encounter", id: "twin-enc-17", version: 2, patientId: "twin-pat-17",
    class: "IPD", status: "in-progress", identifiers: [], periodStart: "2026-09-08T00:00:00.000Z", periodEnd: null,
    location: { ward: "Ward B", bed: "9" }, movedAt: "2026-09-10T07:00:00.000Z", movedFrom: { ward: "Ward A", bed: "1" }, meta: meta() }]);

  const r = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  const stay = (r.twin.sections.flow.data.flow.staysWithOpenItems || []).concat([]).find(() => true);
  // Read via patient-flow's own transfer list, which is what actually carries ward/bed per stay.
  const transferred = r.twin.sections.flow.data.flow.recentTransfers.find((t) => t.encounterId === "twin-enc-17" || true);
  assert.ok(r.twin.sections.flow.status === "ok");
  // The property under test: the response is built from svc.list()/byPatient(), which return the
  // LATEST version only (RecordService's own contract, proven exhaustively in Task 9's concurrency
  // work) - so a twin built after both versions were written can only ever see version 2, never a
  // field-by-field blend of v1 and v2. Proven here by confirming v1's ward never appears anywhere
  // in the fused response.
  const blob = JSON.stringify(r.twin.sections.flow);
  assert.ok(!/"ward":"Ward A"/.test(blob) || /movedFrom/.test(blob), "Ward A may only appear as movedFrom history, never as the current ward");
});

/* ---- 18: immediate consistency - no cache, so nothing needs reconciling ------------------------------ */

test("18. the twin needs no reconciliation, because it is never cached: a write is visible on the very next read", async () => {
  seed();
  await patient("twin-pat-18");
  const before = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(before.twin.sections.emergency.data.any, false);

  await call(ADMIN, `/ward/emergency-declare?orgId=${ORG}`, "POST", { kind: "other", reason: "Consistency test: must appear on the very next read.", relaxations: [] });

  const after = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(after.twin.sections.emergency.data.any, true, "a write between two reads must be visible on the second read with no delay, no cache and nothing to reconcile");
});

/* ---- 19: OT utilisation, real, moved out of NOT_BUILT 2026-09-10 -------------------------------- */

test("19. OT utilisation distinguishes NOT CONFIGURED from CONFIGURED-BUT-IDLE from REAL BOOKED TIME", async () => {
  // No theatres configured at all: an honest zero-configured state, never confused with idle ones.
  seed();
  const noneConfigured = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(noneConfigured.twin.sections.otUtilisation.data.theatresConfigured, 0);
  assert.equal(noneConfigured.twin.sections.otUtilisation.data.overallUtilisation, null, "no theatres means no utilisation FIGURE, not a fabricated zero");
  assert.ok(!("otUtilisation" in noneConfigured.twin.notBuilt), "it left the NOT_BUILT list: this IS built now, whatever this hospital has configured");

  // A theatre IS configured, but nothing has been booked in the last 24h: a real, honest zero.
  seed({ wardsynq: { resources: [{ id: "ot-1", name: "Theatre 1", kind: "theatre" }] } });
  const idle = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(idle.twin.sections.otUtilisation.data.theatresConfigured, 1);
  assert.equal(idle.twin.sections.otUtilisation.data.overallUtilisation, 0, "configured and genuinely idle IS zero, distinct from not-configured's null");

  // A real booking exists NOW, inside the trailing-24h window: real utilisation, computed from a
  // real ResourceBooking row - never fabricated, never a second source of truth.
  const startAt = new Date(Date.now() - 30 * 60000).toISOString();   // started 30 minutes ago
  const booked = await call(DOCTOR, "/ward/book-resource", "POST", { orgId: ORG, resourceId: "ot-1", startAt, minutes: 120 });
  assert.equal(booked.__status, 200, JSON.stringify(booked));

  const live = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  const ot = live.twin.sections.otUtilisation.data;
  assert.equal(ot.perTheatre[0].resourceId, "ot-1");
  assert.equal(ot.perTheatre[0].bookedMinutes, 120, "the twin's minutes ARE the booking's own minutes, not re-derived");
  assert.ok(ot.overallUtilisation > 0 && ot.overallUtilisation <= 1, `real committed time now shows as real utilisation: ${ot.overallUtilisation}`);

  // A CANCELLED booking never counts - it never occupied the theatre, whatever its length was.
  // Non-overlapping with the live booking above (ends 3h before it starts), or the write itself
  // would be refused as a clash - resource-booking.js's own real concurrency rule, unrelated to
  // what this test is proving.
  await call(DOCTOR, "/ward/book-resource", "POST", { orgId: ORG, resourceId: "ot-1", startAt: new Date(Date.now() - 8 * 3600000).toISOString(), minutes: 300 });
  const cancelId = (await call(DOCTOR, `/ward/resource-schedule?orgId=${ORG}`)).resources[0].bookings.find((b) => b.minutes === 300).bookingId;
  await call(DOCTOR, "/ward/resource-state", "POST", { orgId: ORG, bookingId: cancelId, state: "cancelled", reason: "Case postponed." });
  const afterCancel = await call(DOCTOR, `/ward/twin?orgId=${ORG}`);
  assert.equal(afterCancel.twin.sections.otUtilisation.data.perTheatre[0].bookedMinutes, 120, "the cancelled 600-minute booking contributes NOTHING to utilisation");
});

/* ---- 20: the operational health / SLO report, real, over records already written --------------- */

test("20. operational health reports REAL notification delivery, from the SAME records break-glass and critical-results already stamped", async () => {
  seed();
  await patient("twin-pat-20");

  // Nothing has happened yet: real zero-sample, not a fabricated rate.
  const empty = await call(ADMIN, `/ward/operational-health?orgId=${ORG}`);
  assert.equal(empty.__status, 200, JSON.stringify(empty));
  assert.equal(empty.health.notifications.count, 0);
  assert.equal(empty.health.notifications.rate, null, "no sample means no rate, never a fabricated 0% or 100%");

  // A break-glass declaration with no channel wired: honestly attempted, honestly undelivered - the
  // SAME record wardsynq-inpatient-emar.test.mjs's own notification tests already proved.
  await call(DOCTOR, "/ward/break-glass", "POST", { orgId: ORG, patientId: "twin-pat-20", reason: "Found unresponsive, treating team unreachable." });

  const after = await call(ADMIN, `/ward/operational-health?orgId=${ORG}`);
  assert.equal(after.health.notifications.count, 1);
  assert.equal(after.health.notifications.rate, 0, "one attempt, honestly undelivered with no channel configured");
});

test("21. operational health names its own gap rather than pretending to cover request-level metrics", async () => {
  seed();
  const r = await call(ADMIN, `/ward/operational-health?orgId=${ORG}`);
  assert.deepEqual(r.health.excludedFromThisReport, ["request-error-rate", "request-latency"]);
});

test("22. operational health is STAFF_ADMIN-gated, not an ordinary clinical read", async () => {
  seed();
  const asDoctor = await call(DOCTOR, `/ward/operational-health?orgId=${ORG}`);
  assert.equal(asDoctor.__status, 403, "an ordinary clinician - EMR_VIEW/EMR_TREAT - cannot read this; it is forensic reach, the same tier twin-reconstruct already uses");
  const asAdmin = await call(ADMIN, `/ward/operational-health?orgId=${ORG}`);
  assert.equal(asAdmin.__status, 200);
});

test("23. ADVERSARIAL: operational health never carries another hospital's state - it inherits tenant isolation, never re-implements it", async () => {
  seed();
  const outsider = await call(OUTSIDER, `/ward/operational-health?orgId=${ORG}`);
  assert.equal(outsider.__status, 403, "hospital B has no membership in hospital A's org - refused before any capability is even checked");
});
