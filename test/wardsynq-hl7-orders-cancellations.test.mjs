/* test/wardsynq-hl7-orders-cancellations.test.mjs — TASK 7.6: the HL7 v2 messages this gateway
 * could not previously accept, and the one clinical trap they carry.
 *
 * A11 cancel-admit, A12 cancel-transfer, A13 cancel-discharge, ORM^O01 and OML^O21 orders. Every
 * test drives the REAL gateway (onRequest -> /ward/hl7) with a REAL ER7 message and asserts on the
 * ACK the sender receives AND on what is actually on the chart afterwards - never on a helper.
 *
 * THE TRAP. A cancellation says "what I told you before did not happen". It can only take something
 * back. A gateway that treats A13 as an ordinary encounter update will CREATE an in-progress
 * encounter when it has never seen the admission - a patient apparently on a ward they were never
 * admitted to - and A11 will leave behind a cancelled ghost visit nobody ordered. Both are held for
 * a person here, and the tests prove nothing is written.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-hl7-orders-cancellations.test.mjs
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
let RECORD = new MemoryRepository();
const TENANT = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-a";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const SENDER = "HIS", FACILITY = "GENHOSP";
const SOURCE = "his-genhosp";                 // MSH-3 + MSH-4, which is the claim the grant authorises
const SYSTEM = `hl7v2-${SOURCE}`;             // what the adapter writes ids under

function seed() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { fhir: { inbound: { enabled: true } }, hl7: { inbound: { enabled: true }, profile: { sendingApplications: [] } } } }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const grantSource = (system) => as(ADMIN, `/ward/source-grant?orgId=${ORG}`, "POST", { actorId: idFor(DOCTOR), sourceSystem: system });
const exceptions = () => as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);

/** The real HL7 door. Returns the parsed ACK: MSA-1 (AA/AE/AR) and the sentence in MSA-3. */
async function hl7(text) {
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/hl7?orgId=${ORG}`, { method: "POST",
    headers: { "Cf-Access-Authenticated-User-Email": DOCTOR, "Content-Type": "x-application/hl7-v2+er7" }, body: text }), env: ENV });
  const body = await res.text();
  const msa = /^MSA\|(\w+)\|([^|\r\n]*)\|?([^\r\n]*)/m.exec(body) || [];
  return { status: res.status, raw: body, code: msa[1] || null, text: msa[3] || "" };
}

/* ---- message builders. Segments are built as ARRAYS so a field number is an array index and the
 * test cannot silently miscount pipes - which is the classic way an HL7 fixture lies. ------------ */
const seg7 = (id, n) => Array.from({ length: n + 1 }, (_, i) => (i === 0 ? id : ""));

const msh = (type, event, control) => ["MSH", "^~\\&", SENDER, FACILITY, "WARDSYNQ", "WSQ", "20260808101500", "", `${type}^${event}^${type}_${event}`, control, "P", "2.5.1"].join("|");
const pidSeg = (mrn) => { const s = seg7("PID", 8); s[1] = "1"; s[3] = `${mrn}^^^${FACILITY}^MR`; s[5] = "Testcase^Feed"; s[7] = "19800101"; s[8] = "F"; return s.join("|"); };
function pv1Seg(visit, opts) {
  const o = opts || {};
  const s = seg7("PV1", 45);
  s[1] = "1"; s[2] = o.class || "I"; s[3] = o.location || `MED-A^12^01^${FACILITY}`;
  s[19] = `${visit}^^^${FACILITY}`;
  if (o.admit) s[44] = o.admit;
  if (o.discharge) s[45] = o.discharge;
  return s.join("|");
}
const evn = (event) => ["EVN", event, "20260808101500"].join("|");
function orc(control, placer, filler, opts) {
  const o = opts || {};
  const s = seg7("ORC", 12);
  s[1] = control; s[2] = placer ? `${placer}^${SENDER}` : ""; s[3] = filler ? `${filler}^${FACILITY}` : "";
  if (o.orderStatus) s[5] = o.orderStatus;
  if (o.priority) s[7] = `^^^^^${o.priority}`;          // ORC-7.6, quantity/timing priority
  s[9] = "20260808101000"; s[12] = "DOC123^Whoever^Ordering";
  return s.join("|");
}
const obr = (placer, filler, code) => { const s = seg7("OBR", 6); s[1] = "1"; s[2] = placer ? `${placer}^${SENDER}` : ""; s[3] = filler ? `${filler}^${FACILITY}` : ""; s[4] = code || "2823-3^Potassium^LN"; s[6] = "20260808101000"; return s.join("|"); };

const adt = (event, control, mrn, visit, opts) => [msh("ADT", event, control), evn(event), pidSeg(mrn), pv1Seg(visit, opts)].join("\r");
const orderMsg = (type, event, control, mrn, visit, segments) => [msh(type, event, control), pidSeg(mrn), pv1Seg(visit, { admit: "20260808100000" }), ...segments].join("\r");

const encId = (visit) => `${SYSTEM}-enc-${String(visit).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const srId = (placer) => `${SYSTEM}-sr-${String(placer).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const stored = (type, id) => RECORD.latest(TENANT.id, type, id);

/* ---- 1: the cancellations do what they say ------------------------------------------------------ */

test("1. A11 cancel-admit: the visit this hospital was told about is marked cancelled, not deleted", async () => {
  seed();
  await grantSource(SOURCE);
  const admit = await hl7(adt("A01", "C1", "MRN-1", "V-1", { admit: "20260808100000" }));
  assert.equal(admit.code, "AA", admit.raw);
  const before = await stored("Encounter", encId("V-1"));
  assert.ok(before, "the admission landed");
  assert.equal(before.status, "in-progress");

  const cancel = await hl7(adt("A11", "C2", "MRN-1", "V-1", { admit: "20260808100000" }));
  assert.equal(cancel.code, "AA", cancel.raw);
  const after = await stored("Encounter", encId("V-1"));
  assert.equal(after.status, "cancelled", "the admission was taken back");
  assert.equal(after.version, 2, "a new version - the earlier one is still in the history, nothing was deleted");
  const history = await RECORD.history(TENANT.id, "Encounter", encId("V-1"));
  assert.equal(history.length, 2, "both versions are on the record");
  assert.equal(history[0].status, "in-progress", "what the hospital was told first is still readable");
});

test("2. A11 for a visit this hospital never had is HELD, and no ghost encounter is created", async () => {
  seed();
  await grantSource(SOURCE);
  const cancel = await hl7(adt("A11", "C1", "MRN-9", "V-NEVER", {}));
  assert.equal(cancel.code, "AE", cancel.raw);
  assert.match(cancel.text, /nothing was written/);
  assert.match(cancel.text, /conflict-cancels-unknown-encounter/);
  assert.equal(await stored("Encounter", encId("V-NEVER")), null, "no encounter was invented to cancel");

  const ex = await exceptions();
  const held = ex.open.find((e) => String(e.reason).includes("cancels-unknown-encounter"));
  assert.ok(held, `expected a cancels-unknown-encounter exception, got ${JSON.stringify(ex.open.map((e) => e.reason))}`);
  assert.match(held.detail, /A11 cancels an admission/);
});

test("3. A13 cancel-discharge: the patient is on the ward again AND the discharge time is gone", async () => {
  seed();
  await grantSource(SOURCE);
  await hl7(adt("A01", "C1", "MRN-3", "V-3", { admit: "20260808100000" }));
  const discharge = await hl7(adt("A03", "C2", "MRN-3", "V-3", { admit: "20260808100000", discharge: "20260809090000" }));
  assert.equal(discharge.code, "AA", discharge.raw);
  const gone = await stored("Encounter", encId("V-3"));
  assert.equal(gone.status, "finished");
  assert.ok(gone.periodEnd, "the discharge time was filed");

  // The discharge is taken back. The message still CARRIES PV1-45 - the trap - and it must not stick.
  const cancel = await hl7(adt("A13", "C3", "MRN-3", "V-3", { admit: "20260808100000", discharge: "20260809090000" }));
  assert.equal(cancel.code, "AA", cancel.raw);
  const back = await stored("Encounter", encId("V-3"));
  assert.equal(back.status, "in-progress", "the patient is on the ward again");
  assert.equal(back.periodEnd, null, "the discharge time was taken back with the discharge; a chart that keeps it says the patient left");
  assert.equal(back.periodStart, gone.periodStart, "the admission itself is untouched");
});

test("4. A13 for a visit this hospital never had is HELD; it does not put a patient on a ward", async () => {
  seed();
  await grantSource(SOURCE);
  const cancel = await hl7(adt("A13", "C1", "MRN-4", "V-PHANTOM", { discharge: "20260809090000" }));
  assert.equal(cancel.code, "AE", cancel.raw);
  assert.equal(await stored("Encounter", encId("V-PHANTOM")), null, "no in-progress encounter was created out of a cancellation");
  const ex = await exceptions();
  assert.ok(ex.open.some((e) => String(e.reason).includes("cancels-unknown-encounter")), JSON.stringify(ex.open));
});

test("5. A12 cancel-transfer files the location the sender corrected to, and infers no earlier one", async () => {
  seed();
  await grantSource(SOURCE);
  await hl7(adt("A01", "C1", "MRN-5", "V-5", { admit: "20260808100000" }));
  await hl7(adt("A02", "C2", "MRN-5", "V-5", { admit: "20260808100000", location: `ICU^3^01^${FACILITY}` }));
  const moved = await stored("Encounter", encId("V-5"));
  assert.equal(moved.location.ward, "ICU");

  const cancel = await hl7(adt("A12", "C3", "MRN-5", "V-5", { admit: "20260808100000", location: `MED-A^12^01^${FACILITY}` }));
  assert.equal(cancel.code, "AA", cancel.raw);
  const back = await stored("Encounter", encId("V-5"));
  assert.equal(back.location.ward, "MED-A", "the corrected location the sender gave is what is filed");
  assert.equal(back.status, "in-progress", "cancelling a transfer does not end the visit");
});

/* ---- 6: orders ---------------------------------------------------------------------------------- */

test("6. ORM^O01 NW: an order placed elsewhere is filed as a ServiceRequest with both order numbers", async () => {
  seed();
  await grantSource(SOURCE);
  const r = await hl7(orderMsg("ORM", "O01", "O1", "MRN-6", "V-6", [orc("NW", "P-1001", "F-2001", { priority: "S" }), obr("P-1001", "F-2001")]));
  assert.equal(r.code, "AA", r.raw);
  const sr = await stored("ServiceRequest", srId("P-1001"));
  assert.ok(sr, "the order is on the chart");
  assert.equal(sr.code, "2823-3");
  assert.equal(sr.externalStatus, "active", "ORC-1 NW is a live order");
  assert.equal(sr.priority, "stat", "ORC-7.6 S is stat, and it was not flattened to routine");
  assert.deepEqual(sr.externalIdentifiers.map((i) => `${i.type}:${i.value}`), ["PLAC:P-1001", "FILL:F-2001"]);
  assert.equal(sr.externalRequester, "Whoever");
  assert.equal(sr.encounterId, encId("V-6"), "the order is attached to the visit it was placed on");
});

test("7. ORM^O01 CA: cancelling an order updates the SAME row rather than filing a second order", async () => {
  seed();
  await grantSource(SOURCE);
  await hl7(orderMsg("ORM", "O01", "O1", "MRN-7", "V-7", [orc("NW", "P-1002", "F-2002"), obr("P-1002", "F-2002")]));
  const live = await stored("ServiceRequest", srId("P-1002"));
  assert.equal(live.externalStatus, "active");

  const cancel = await hl7(orderMsg("ORM", "O01", "O2", "MRN-7", "V-7", [orc("CA", "P-1002", "F-2002"), obr("P-1002", "F-2002")]));
  assert.equal(cancel.code, "AA", cancel.raw);
  const off = await stored("ServiceRequest", srId("P-1002"));
  assert.equal(off.version, 2, "the same order, a new version - not a second order with the same number");
  assert.equal(off.externalStatus, "revoked", "the sender cancelled it and the chart says so");
});

test("8. an ORC-1 this gateway does not map takes its status from ORC-5 rather than being guessed", async () => {
  seed();
  await grantSource(SOURCE);
  const r = await hl7(orderMsg("ORM", "O01", "O1", "MRN-8", "V-8", [orc("ZZ", "P-1003", "F-2003", { orderStatus: "IP" }), obr("P-1003", "F-2003")]));
  assert.equal(r.code, "AA", r.raw);
  const sr = await stored("ServiceRequest", srId("P-1003"));
  assert.equal(sr.externalStatus, "active", "ORC-5 IP (in progress) settled it");
});

test("9. OML^O21 is accepted, and a segment this gateway does not file does not stop the order", async () => {
  seed();
  await grantSource(SOURCE);
  const spm = ["SPM", "1", "SPEC-1", "", "BLD^Blood^HL70487"].join("|");
  const r = await hl7(orderMsg("OML", "O21", "O1", "MRN-10", "V-10", [orc("NW", "P-1010", "F-2010"), obr("P-1010", "F-2010"), spm]));
  assert.equal(r.code, "AA", r.raw);
  const sr = await stored("ServiceRequest", srId("P-1010"));
  assert.ok(sr, "the order landed");
  assert.equal(sr.meta.source.system, SYSTEM, "it is attributed to the sender, like every other imported row");
});

/* ---- 10: the refusals ---------------------------------------------------------------------------- */

test("10. an order message with no ORC is rejected by the profile before any content is considered", async () => {
  seed();
  await grantSource(SOURCE);
  const r = await hl7([msh("ORM", "O01", "O1"), pidSeg("MRN-11"), pv1Seg("V-11", {}), obr("P-1", "F-1")].join("\r"));
  assert.equal(r.code, "AR", r.raw);
  assert.match(r.text, /required segment ORC is missing/);
  assert.equal(await stored("ServiceRequest", srId("P-1")), null, "nothing was written");
});

test("11. an ungranted sender cannot place an order here, whatever MSH-3 says", async () => {
  seed();
  // No grant at all: the sending application names itself and is refused.
  const r = await hl7(orderMsg("ORM", "O01", "O1", "MRN-12", "V-12", [orc("NW", "P-1012", "F-2012"), obr("P-1012", "F-2012")]));
  assert.equal(r.code, "AR", r.raw);
  assert.equal(await stored("ServiceRequest", srId("P-1012")), null);
});

test("12. the same order message sent twice is filed once and the sender is TOLD it was a replay", async () => {
  seed();
  await grantSource(SOURCE);
  const msg = orderMsg("ORM", "O01", "O1", "MRN-13", "V-13", [orc("NW", "P-1013", "F-2013"), obr("P-1013", "F-2013")]);
  const first = await hl7(msg);
  assert.equal(first.code, "AA", first.raw);
  const second = await hl7(msg);
  assert.equal(second.code, "AA", second.raw);
  assert.match(second.text, /already processed/);
  const sr = await stored("ServiceRequest", srId("P-1013"));
  assert.equal(sr.version, 1, "one version: the replay wrote nothing");
});
