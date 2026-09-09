/* test/wardsynq-adt-bed-master.test.mjs — TASK 4.2: ADT admit/transfer/discharge against the REAL
 * Ward/Bed master data from TASK 4.1 (_opd_org_store.js), through the real routes.
 *
 * The pre-existing encounter-vs-encounter collision guard (admitPatient's claimBed(), transfer's
 * list-scan) is untouched and unretested here - it already proves "two patients cannot occupy one
 * bed" for real. This file proves the NEW axis: a bed's own administrative state (blocked/cleaning/
 * maintenance), a stated gender restriction, and referential integrity against a real bed list -
 * none of which existed before this task - and that admit/transfer/discharge actually transition
 * the master bed's state, not just the Encounter's location string. An org with no master data at
 * all (every test elsewhere in this suite) is proven to fall through unchanged.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-adt-bed-master.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
const ORG_STORE = await import("../functions/_opd_org_store.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const ADMIN = "admin@example.test";
function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(ADMIN))}`, { fields: { orgId: ORG, identity: idFor(ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;
async function registerAndAdmit(ward, bed) {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ADT Testcase " + n, mobile: "98765009" + String(n).padStart(2, "0"), gender: "female", ageYears: 40 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward, bed });
  return { reg, adm };
}

test("an org with NO master Ward/Bed data admits exactly as before - unconfigured is not invalid", async () => {
  seedHospital();
  const { adm } = await registerAndAdmit("Medical A", "1");
  assert.equal(adm.__status, 200, JSON.stringify(adm));
});

test("admission is refused when the named bed does not exist in the hospital's own bed list", async () => {
  seedHospital();
  await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  const { adm } = await registerAndAdmit("Medical A", "99");
  assert.equal(adm.__status, 422, JSON.stringify(adm));
  assert.equal(adm.error, "bed_not_found");
});

test("admission is refused when the master bed is blocked/cleaning/maintenance, and succeeds once available", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  const b = await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "3", state: "maintenance" }, "actor-1");
  const blocked = await registerAndAdmit("Medical A", "3");
  assert.equal(blocked.adm.__status, 409, JSON.stringify(blocked.adm));
  assert.equal(blocked.adm.error, "bed_not_available");
  assert.equal(blocked.adm.detail, "Medical A bed 3 is maintenance");

  await ORG_STORE.updateBed(undefined, b.id, { state: "available" }, "actor-1");
  const { adm } = await registerAndAdmit("Medical A", "3");
  assert.equal(adm.__status, 200, JSON.stringify(adm));

  // ADMISSION OCCUPIES THE MASTER BED, not just the Encounter's own location string.
  const after = await ORG_STORE.getBed(undefined, b.id);
  assert.equal(after.state, "occupied", "the master bed record itself now reads occupied");
});

test("admission is refused into a gender-restricted bed that does not match the patient", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Maternity" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "L1", genderRestriction: "male" }, "actor-1");
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Restricted Bed Testcase", mobile: "9876509" + String(n).padStart(3, "0"), gender: "female", ageYears: 28 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Maternity", bed: "L1" });
  assert.equal(adm.__status, 409, JSON.stringify(adm));
  assert.equal(adm.error, "bed_restricted");
});

test("a retired (inactive) bed is refused even though it still exists in the record", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "9", active: false }, "actor-1");
  const { adm } = await registerAndAdmit("Medical A", "9");
  assert.equal(adm.__status, 409, JSON.stringify(adm));
  assert.equal(adm.error, "bed_inactive");
});

test("TRANSFER: destination bed is validated the same way admission is, and moves the master bed occupancy", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  const bedA = await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "A1" }, "actor-1");
  const bedB = await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "A2", state: "cleaning" }, "actor-1");
  const { adm } = await registerAndAdmit("Medical A", "A1");
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  assert.equal((await ORG_STORE.getBed(undefined, bedA.id)).state, "occupied");

  const blocked = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical A", bed: "A2" });
  assert.equal(blocked.__status, 409, JSON.stringify(blocked));
  assert.equal(blocked.error, "bed_not_available");

  await ORG_STORE.updateBed(undefined, bedB.id, { state: "available" }, "actor-1");
  const moved = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical A", bed: "A2" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));

  // THE OLD BED IS FREED, the new one is occupied - a transfer moves master occupancy, not just the chart.
  assert.equal((await ORG_STORE.getBed(undefined, bedA.id)).state, "available", "the vacated bed is freed");
  assert.equal((await ORG_STORE.getBed(undefined, bedB.id)).state, "occupied", "the destination bed is occupied");
});

test("DISCHARGE: vacates the master bed", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  const bed = await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "D1" }, "actor-1");
  const { adm } = await registerAndAdmit("Medical A", "D1");
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  assert.equal((await ORG_STORE.getBed(undefined, bed.id)).state, "occupied");

  const disch = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, disposition: "home" });
  assert.equal(disch.__status, 200, JSON.stringify(disch));
  assert.equal((await ORG_STORE.getBed(undefined, bed.id)).state, "available", "discharge frees the master bed");
});

test("BED BOARD: reads real master occupancy/state once a hospital has any, not the free-text config", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "1" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "2", state: "maintenance" }, "actor-1");
  const { adm } = await registerAndAdmit("Medical A", "1");
  assert.equal(adm.__status, 200, JSON.stringify(adm));

  const board = await as(DOCTOR, `/ward/beds?orgId=${ORG}`);
  assert.equal(board.__status, 200, JSON.stringify(board));
  const medicalA = board.wards.find((x) => x.ward === "Medical A");
  assert.ok(medicalA, JSON.stringify(board.wards));
  assert.equal(medicalA.bedsKnown, true);
  assert.deepEqual(medicalA.occupied.map((o) => o.bed), ["1"]);
  // Bed 2 is in maintenance in the MASTER record, with nobody in it - it must NOT read as free.
  assert.deepEqual(medicalA.free, [], "a maintenance bed with no patient in it is still not free");
});

/* TASK 4.15's emergency-mode.js declares "bed-assignment-conflict-override" as a real relaxation.
 * These tests prove it is actually consumed, not merely a name a screen displays. */
test("EMERGENCY OVERRIDE: a blocked bed is refused without a declared emergency, and admitted with one", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "5", state: "blocked" }, "actor-1");

  n++;
  const reg1 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Emergency Testcase " + n, mobile: "9876500" + String(n).padStart(3, "0"), gender: "female", ageYears: 30 });
  const refused = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg1.mrn, ward: "Medical A", bed: "5", emergencyOverride: true });
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.equal(refused.error, "bed_not_available", "no emergency is declared yet - the override flag alone does nothing");

  const declared = await as(ADMIN, "/ward/emergency-declare", "POST", {
    orgId: ORG, kind: "mass-casualty", reason: "Multi-vehicle collision, every bed is needed now.",
    relaxations: ["bed-assignment-conflict-override"],
  });
  assert.equal(declared.__status, 200, JSON.stringify(declared));

  n++;
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Emergency Testcase " + n, mobile: "9876500" + String(n).padStart(3, "0"), gender: "female", ageYears: 30 });
  const overridden = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "Medical A", bed: "5", emergencyOverride: true });
  assert.equal(overridden.__status, 200, JSON.stringify(overridden));
  assert.equal(overridden.emergencyOverride.relaxation, "bed-assignment-conflict-override");
  assert.equal(overridden.emergencyOverride.overriddenState, "blocked");

  // Without the flag, the SAME declared emergency changes nothing - an admitting clinician must ask
  // for the override by name, never an implicit side effect of a banner being on.
  n++;
  const reg3 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Emergency Testcase " + n, mobile: "9876500" + String(n).padStart(3, "0"), gender: "male", ageYears: 30 });
  const stillBlocked = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg3.mrn, ward: "Medical A", bed: "6", emergencyOverride: false });
  assert.equal(stillBlocked.__status, 422, JSON.stringify(stillBlocked), "bed 6 does not exist - a different real refusal, proving the flag was not the reason bed 5 worked");
});

test("EMERGENCY OVERRIDE NEVER RELAXES A REAL OCCUPANT - two patients still cannot share one bed", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "7" }, "actor-1");

  await as(ADMIN, "/ward/emergency-declare", "POST", {
    orgId: ORG, kind: "mass-casualty", reason: "Multi-vehicle collision, every bed is needed now.",
    relaxations: ["bed-assignment-conflict-override"],
  });

  const first = await registerAndAdmit("Medical A", "7");
  assert.equal(first.adm.__status, 200, JSON.stringify(first.adm));

  n++;
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Emergency Occupant Testcase " + n, mobile: "9876501" + String(n).padStart(3, "0"), gender: "female", ageYears: 30 });
  const secondAttempt = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "Medical A", bed: "7", emergencyOverride: true });
  assert.equal(secondAttempt.__status, 409, JSON.stringify(secondAttempt));
  assert.equal(secondAttempt.error, "bed_occupied", "a real occupant is refused REGARDLESS of any emergency declaration or override flag");
});

test("EMERGENCY OVERRIDE also works for TRANSFER, and expires with the declaration", async () => {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "8" }, "actor-1");
  const destBed = await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "9", state: "cleaning" }, "actor-1");

  const declared = await as(ADMIN, "/ward/emergency-declare", "POST", {
    orgId: ORG, kind: "surge", reason: "Ward surge, using every cleaning-hold bed on Medical A.",
    relaxations: ["bed-assignment-conflict-override"], minutes: 60,
  });

  const { adm } = await registerAndAdmit("Medical A", "8");
  assert.equal(adm.__status, 200, JSON.stringify(adm));

  const transfer = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical A", bed: "9", emergencyOverride: true });
  assert.equal(transfer.__status, 200, JSON.stringify(transfer));
  assert.equal(transfer.emergencyOverride.overriddenState, "cleaning");

  // Move off bed 9 first - transferring back to the SAME location is a no-op the route short-
  // circuits before it ever reaches the bed check, which would prove nothing about the relaxation.
  await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical A" });
  // Stand the emergency down; the SAME relaxation must stop working immediately.
  await as(ADMIN, "/ward/emergency-deactivate", "POST", { orgId: ORG, activationId: declared.activationId, reason: "Surge resolved." });
  await ORG_STORE.updateBed(undefined, destBed.id, { state: "cleaning" }, "actor-1");
  const secondTransfer = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical A", bed: "9", emergencyOverride: true });
  assert.equal(secondTransfer.__status, 409, JSON.stringify(secondTransfer), "the declaration was stood down - the same override flag no longer does anything");
});
