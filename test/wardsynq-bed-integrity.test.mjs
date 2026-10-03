import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-bed-integrity.test.mjs - Codex audit 2026-10-02, F1 and F7, through the real routes.
 *
 * F1: admission and transfer take ONE destination-bed claim (migrate-inpatient.js claimBed()). Two
 * transfers, or an admission and a transfer, racing for one empty bed leave exactly one occupant, a
 * 409 for the loser and a master bed that agrees. A transfer releases its source bed's claim, and a
 * transfer whose Encounter write fails leaves no claim behind.
 * F7: a Ward/Bed master read that throws is "could not read" (503), never "not configured".
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-bed-integrity.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let masterDown = false;   // F7: the Ward/Bed master read fails while this is set
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      if (masterDown && (coll === "q_wards" || coll === "q_beds")) throw new Error("firestore unavailable (test)");
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

const { MemoryRepository, VersionConflictError } = await import("../functions/_wardsynq/repository.js");
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

const CLAIM = "_wardsynq_bed_claim";
const claimId = (ward, bed) => `wsq-bedclaim-${ward.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${bed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
async function masterBed(name) { const w = await ORG_STORE.getWardByName(undefined, ORG, "Medical A"); return ORG_STORE.getBedByName(undefined, ORG, w.id, name); }
async function occupantsOf(bed) {
  const board = await as(DOCTOR, `/ward/beds?orgId=${ORG}`);
  const row = board.wards.find((x) => x.ward === "Medical A");
  return ((row && row.occupied) || []).filter((o) => o.bed === bed);
}
async function hospitalWithBeds(...names) {
  seedHospital();
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  for (const name of names) await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name }, "actor-1");
}

/* Holds every request at the open-census read until two have arrived, and at the bed-claim read until
 * two have arrived (or 500 ms pass: code that never reads the claim must not hang the test), so neither
 * request can see the other's write. Counts claim appends refused by the repository's own uniqueness. */
async function raced(requests) {
  const realPage = RECORD.pageByType.bind(RECORD), realLatest = RECORD.latest.bind(RECORD), realAppend = RECORD.append.bind(RECORD);
  let arrived = 0, claimReads = 0, claimConflicts = 0, openCensus, openClaims;
  const census = new Promise((r) => { openCensus = r; }), claims = new Promise((r) => { openClaims = r; });
  const timer = setTimeout(() => openClaims(), 500);
  RECORD.pageByType = async (t, type, o) => { if (type === "Encounter") { if (++arrived === 2) openCensus(); await census; } return realPage(t, type, o); };
  RECORD.latest = async (t, type, id) => { if (type === CLAIM) { if (++claimReads === 2) openClaims(); await claims; } return realLatest(t, type, id); };
  RECORD.append = async (t, records, ctx) => {
    try { return await realAppend(t, records, ctx); }
    catch (e) { if (e instanceof VersionConflictError && records.some((r) => r.resourceType === CLAIM)) claimConflicts += 1; throw e; }
  };
  try { return { out: await Promise.all(requests.map((f) => f())), arrived, claimConflicts }; }
  finally { clearTimeout(timer); RECORD.pageByType = realPage; RECORD.latest = realLatest; RECORD.append = realAppend; }
}

test("F1: two transfers racing for one empty bed - exactly one lands, the loser gets 409, the master beds agree", async () => {
  await hospitalWithBeds("T1", "T2", "T3");
  const p1 = await registerAndAdmit("Medical A", "T1"), p2 = await registerAndAdmit("Medical A", "T2");
  assert.equal(p1.adm.__status, 200, JSON.stringify(p1.adm)); assert.equal(p2.adm.__status, 200, JSON.stringify(p2.adm));

  const { out, arrived, claimConflicts } = await raced([
    () => as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p1.adm.encounterId, ward: "Medical A", bed: "T3" }),
    () => as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p2.adm.encounterId, ward: "Medical A", bed: "T3" }),
  ]);
  assert.equal(arrived, 2, "both transfers passed the census read before either wrote");
  const won = out.filter((r) => r.__status === 200 && r.written === 1), lost = out.filter((r) => r.__status === 409 && r.error === "bed_occupied");
  assert.equal(won.length, 1, JSON.stringify(out)); assert.equal(lost.length, 1, JSON.stringify(out));
  assert.equal(claimConflicts, 1, "the shared bed claim, not the census, refused the loser");

  const occ = await occupantsOf("T3");
  assert.equal(occ.length, 1, "exactly one patient in T3: " + JSON.stringify(occ));
  assert.equal(occ[0].encounterId || won[0].encounterId, won[0].encounterId);
  const winnerFrom = won[0].encounterId === p1.adm.encounterId ? "T1" : "T2", loserBed = winnerFrom === "T1" ? "T2" : "T1";
  assert.equal((await masterBed("T3")).state, "occupied");
  assert.equal((await masterBed(winnerFrom)).state, "available", "the winner's old bed is freed");
  assert.equal((await masterBed(loserBed)).state, "occupied", "the loser never moved");
  assert.equal((await occupantsOf(loserBed)).length, 1);
});

test("F1: an admission racing a transfer for one empty bed - exactly one lands, the loser gets 409, the master beds agree", async () => {
  await hospitalWithBeds("T1", "T3");
  const p1 = await registerAndAdmit("Medical A", "T1");
  assert.equal(p1.adm.__status, 200, JSON.stringify(p1.adm));
  n++;
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Race Admit " + n, mobile: "98765019" + String(n).padStart(2, "0"), gender: "male", ageYears: 50 });

  const { out, arrived, claimConflicts } = await raced([
    () => as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p1.adm.encounterId, ward: "Medical A", bed: "T3" }),
    () => as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "Medical A", bed: "T3" }),
  ]);
  assert.equal(arrived, 2, "both requests passed the census read before either wrote");
  const won = out.filter((r) => r.__status === 200 && r.written === 1), lost = out.filter((r) => r.__status === 409 && r.error === "bed_occupied");
  assert.equal(won.length, 1, JSON.stringify(out)); assert.equal(lost.length, 1, JSON.stringify(out));
  assert.equal(claimConflicts, 1, "the shared bed claim, not the census, refused the loser");

  assert.equal((await occupantsOf("T3")).length, 1, "exactly one patient in T3");
  assert.equal((await masterBed("T3")).state, "occupied");
  const transferWon = won[0] === out[0];
  assert.equal((await masterBed("T1")).state, transferWon ? "available" : "occupied");
  assert.equal((await occupantsOf("T1")).length, transferWon ? 0 : 1);
});

test("F1: a transfer releases its source bed's claim, so the bed it left is admittable at once", async () => {
  await hospitalWithBeds("T1", "T3");
  const p1 = await registerAndAdmit("Medical A", "T1");
  const moved = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p1.adm.encounterId, ward: "Medical A", bed: "T3" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  const src = await RECORD.latest(TENANT_ROW.id, CLAIM, claimId("Medical A", "T1"));
  assert.equal(src.encounterId, null, "the source claim no longer names the patient who left");
  const dst = await RECORD.latest(TENANT_ROW.id, CLAIM, claimId("Medical A", "T3"));
  assert.equal(dst.encounterId, p1.adm.encounterId, "the destination is claimed by the patient now in it");

  const next = await registerAndAdmit("Medical A", "T1");
  assert.equal(next.adm.__status, 200, JSON.stringify(next.adm));
  // And the moved patient's new bed is held against a second admission.
  const clash = await registerAndAdmit("Medical A", "T3");
  assert.equal(clash.adm.__status, 409, JSON.stringify(clash.adm));
});

test("F1: a transfer whose Encounter write fails leaves no claim on the destination and no master-bed change", async () => {
  await hospitalWithBeds("T1", "T3");
  const p1 = await registerAndAdmit("Medical A", "T1");
  const realAppend = RECORD.append.bind(RECORD);
  let failed = 0;
  RECORD.append = async (t, records, ctx) => {
    if (!failed && records.some((r) => r.resourceType === "Encounter")) { failed += 1; throw new Error("storage down (test)"); }
    return realAppend(t, records, ctx);
  };
  let r;
  try { r = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p1.adm.encounterId, ward: "Medical A", bed: "T3" }); }
  finally { RECORD.append = realAppend; }
  assert.equal(failed, 1, "the Encounter write was the one that failed");
  assert.equal(r.__status, 502, JSON.stringify(r));
  assert.equal(r.written, 0);

  const dst = await RECORD.latest(TENANT_ROW.id, CLAIM, claimId("Medical A", "T3"));
  assert.ok(!dst || dst.encounterId == null, "no orphaned claim on T3: " + JSON.stringify(dst));
  const src = await RECORD.latest(TENANT_ROW.id, CLAIM, claimId("Medical A", "T1"));
  assert.equal(src.encounterId, p1.adm.encounterId, "the patient still holds the bed they never left");
  assert.equal((await masterBed("T3")).state, "available");
  assert.equal((await masterBed("T1")).state, "occupied");

  const other = await registerAndAdmit("Medical A", "T3");
  assert.equal(other.adm.__status, 200, "T3 is free for the next admission: " + JSON.stringify(other.adm));
});

test("F7: a bed-list read that throws refuses admission and transfer with 503, never bypassing a configured restriction", async () => {
  await hospitalWithBeds("T1");
  const w = await ORG_STORE.getWardByName(undefined, ORG, "Medical A");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "M1", state: "maintenance" }, "actor-1");
  const p1 = await registerAndAdmit("Medical A", "T1");
  assert.equal(p1.adm.__status, 200, JSON.stringify(p1.adm));
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bed List Down " + n, mobile: "98765029" + String(n).padStart(2, "0"), gender: "female", ageYears: 33 });

  masterDown = true;
  let adm, tr, wardOnly;
  try {
    adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "M1" });
    tr = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p1.adm.encounterId, ward: "Medical A", bed: "M1" });
    // A patient can still be admitted to the ward awaiting a bed: no bed is named, so no bed is checked.
    wardOnly = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A" });
  } finally { masterDown = false; }
  for (const r of [adm, tr]) {
    assert.equal(r.__status, 503, JSON.stringify(r));
    assert.equal(r.error, "bed_list_unavailable");
    assert.equal(r.written, 0);
  }
  assert.equal(wardOnly.__status, 200, JSON.stringify(wardOnly));
  assert.equal((await RECORD.latest(TENANT_ROW.id, CLAIM, claimId("Medical A", "M1"))), null, "a refused request took no claim");
  assert.equal((await masterBed("M1")).state, "maintenance");

  // Once the read works the restriction it was hiding answers as itself.
  const back = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: p1.adm.encounterId, ward: "Medical A", bed: "M1" });
  assert.equal(back.__status, 409, JSON.stringify(back));
  assert.equal(back.error, "bed_not_available");
});

test("F7: a declared emergency's bed override does not stand in for an unreadable bed list", async () => {
  await hospitalWithBeds("T1");
  const declared = await as(ADMIN, "/ward/emergency-declare", "POST", {
    orgId: ORG, kind: "mass-casualty", reason: "Multi-vehicle collision, every bed is needed now.",
    relaxations: ["bed-assignment-conflict-override"],
  });
  assert.equal(declared.__status, 200, JSON.stringify(declared));
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Override Down " + n, mobile: "98765039" + String(n).padStart(2, "0"), gender: "male", ageYears: 61 });
  masterDown = true;
  let r;
  try { r = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "T1", emergencyOverride: true }); }
  finally { masterDown = false; }
  assert.equal(r.__status, 503, JSON.stringify(r));
  assert.equal(r.error, "bed_list_unavailable");
});

test("F7: an org with no master ward is still 'not configured' and admits as before", async () => {
  seedHospital();
  const { adm } = await registerAndAdmit("Unlisted Ward", "U1");
  assert.equal(adm.__status, 200, JSON.stringify(adm));
});
