/* test/opd-mrn-alloc.test.mjs — the MR allocator must never issue the same number twice.
 *
 * The bug this replaces (queue.js, before 24 Aug 2026):
 *     var seq = padSeq((((store.listPatients && store.listPatients()) || []).length) + 1);
 * The sequence came from a collection LENGTH, so deleting or discharging a patient made the next
 * registration reuse a real patient's MR number. Two desks registering at the same moment also both
 * saw the same length and got the same id.
 *
 * nextSeq() now reads a per-org counter and writes it back with an updateTime precondition
 * (compare-and-set). This drives a fake Firestore that behaves like the real one: a write whose
 * precondition no longer matches FAILS, exactly as Firestore's fsCommit throws { code:"precondition" }.
 *
 * Run: node --experimental-test-module-mocks --test test/opd-mrn-alloc.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ---- a fake Firestore with real compare-and-set semantics ------------------------------------
const docs = new Map();          // path -> { fields, updateTime }
let clock = 1;
function reset() { docs.clear(); clock = 1; }

mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_env, path) => {
      const d = docs.get(path);
      return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null;
    },
    fsCommit: async (_env, writes) => {
      // Validate every precondition BEFORE applying anything (all-or-nothing, like the real commit).
      for (const w of writes || []) {
        const path = w.update.name;
        const cd = w.currentDocument;
        const cur = docs.get(path);
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) {
          throw Object.assign(new Error("stale"), { code: "precondition" });
        }
      }
      for (const w of writes || []) {
        const path = w.update.name;
        const prev = docs.get(path);
        docs.set(path, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_env, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_env, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_env, path) => ({ delete: path })
  }
});
mock.module("../functions/_queue_engine.js", { namedExports: { qAudit: async () => {} } });
mock.module("../functions/_queue.js", {
  namedExports: { encPHI: async (_e, v) => "enc:" + v, decPHI: async (_e, v) => String(v || "").replace(/^enc:/, "") }
});

const { nextSeq, registerPatient, getPatient, linkHospitalMrn } = await import("../functions/_opd_patient_store.js");
const ENV = {};
const ORG = { id: "org1", code: "SMD-CZWRWH", mode: "native" };
const GOOD = { name: "Asha Kumar", mobile: "9876543210", gender: "female", ageYears: 34 };

test("nextSeq counts up and never repeats", async () => {
  reset();
  const seen = [];
  for (let i = 0; i < 25; i++) seen.push(await nextSeq(ENV, "org1", "mrn"));
  assert.deepEqual(seen, Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(new Set(seen).size, 25, "no repeats");
});

test("REGRESSION: concurrent registrations never collide on the same number", async () => {
  reset();
  // 20 desks hitting the counter at the same instant. The old length-based scheme gave them all the
  // same value; compare-and-set forces the losers to re-read and take the next one.
  const out = await Promise.all(Array.from({ length: 20 }, () => nextSeq(ENV, "org1", "mrn")));
  assert.equal(new Set(out).size, 20, "every allocation is unique: " + JSON.stringify(out.sort((a, b) => a - b)));
  assert.equal(Math.max(...out), 20, "and they are dense, not sparse");
});

test("counters are per-org and per-series", async () => {
  reset();
  assert.equal(await nextSeq(ENV, "orgA", "mrn"), 1);
  assert.equal(await nextSeq(ENV, "orgB", "mrn"), 1, "another clinic starts at 1");
  assert.equal(await nextSeq(ENV, "orgA", "mrn"), 2);
  assert.equal(await nextSeq(ENV, "orgA", "tmp"), 1, "provisional ids are a separate series");
});

test("a deleted patient can never free their MR back into circulation", async () => {
  reset();
  const a = await nextSeq(ENV, "org1", "mrn");
  const b = await nextSeq(ENV, "org1", "mrn");
  docs.delete("q_patients/org1__SMD-CZWRWH-00001");   // discharge / delete the first patient
  const c = await nextSeq(ENV, "org1", "mrn");
  assert.equal(a, 1); assert.equal(b, 2);
  assert.equal(c, 3, "the counter does not care how many patients still exist");
});

/* ---------------------------------------------------------------- registration */
test("a personal-clinic registration is issued OUR MR", async () => {
  reset();
  const r = await registerPatient(ENV, ORG, GOOD, "doc1");
  assert.ok(r.ok, JSON.stringify(r.errors || r));
  assert.equal(r.mrn, "SMD-CZWRWH-00001");
  assert.equal(r.mrSource, "stewardmd");
  assert.equal(r.pending, false);
  const p = await getPatient(ENV, "org1", r.mrn);
  assert.equal(p.name, "Asha Kumar");
  assert.equal(p.mobile, "+919876543210");
  assert.equal(p.gender, "female");
});

test("a hospital workplace with no MR yet gets a provisional id, not one of ours", async () => {
  reset();
  const r = await registerPatient(ENV, { id: "org1", code: "SMD-CZWRWH", mode: "connect" }, GOOD, "doc1");
  assert.ok(r.ok);
  assert.equal(r.mrn, "TMP-000001");
  assert.equal(r.mrSource, "provisional");
  assert.equal(r.pending, true);
  assert.equal(r.mrn.startsWith("SMD-"), false, "we must never mint a clinic MR in a hospital workplace");
});

test("a hospital-issued MR is recorded as-is", async () => {
  reset();
  const r = await registerPatient(ENV, { id: "org1", code: "SMD-CZWRWH", mode: "ghis" }, { ...GOOD, mrn: "MRN-4471" }, "doc1");
  assert.ok(r.ok);
  assert.equal(r.mrn, "MRN-4471");
  assert.equal(r.mrSource, "ghis");
});

test("linking swaps the provisional for the real hospital MR and keeps the trail", async () => {
  reset();
  const r = await registerPatient(ENV, { id: "org1", code: "SMD-CZWRWH", mode: "ghis" }, GOOD, "doc1");
  assert.equal(r.mrn, "TMP-000001");
  const l = await linkHospitalMrn(ENV, "org1", "TMP-000001", "MRN-4471", "ghis", "doc1");
  assert.ok(l.ok);
  const p = await getPatient(ENV, "org1", "MRN-4471");
  assert.ok(p, "the patient is now reachable by the hospital MR");
  assert.equal(p.pending, false);
  assert.equal(p.mrSource, "ghis");
  const old = docs.get("q_patients/org1__TMP-000001");
  assert.equal(old.fields.supersededBy, "MRN-4471", "the old id still traces to the new one");
});

test("a repeat mobile is reported as a possible duplicate, not silently merged or blocked", async () => {
  reset();
  const first = await registerPatient(ENV, ORG, GOOD, "doc1");
  assert.ok(first.ok);
  const again = await registerPatient(ENV, ORG, GOOD, "doc1");
  assert.equal(again.ok, false);
  assert.equal(again.error, "duplicate");
  assert.equal(again.duplicateOf.mrn, "SMD-CZWRWH-00001");
  // The desk confirms (twins, shared family phone) and it goes through with a NEW mrn.
  const confirmed = await registerPatient(ENV, ORG, { ...GOOD, confirmDuplicate: true }, "doc1");
  assert.ok(confirmed.ok);
  assert.equal(confirmed.mrn, "SMD-CZWRWH-00002");
});

test("an invalid registration is rejected before any number is burned", async () => {
  reset();
  const r = await registerPatient(ENV, ORG, { name: "A", mobile: "123", gender: "", ageYears: "" }, "doc1");
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid");
  assert.ok(r.errors.name && r.errors.mobile && r.errors.gender && r.errors.age);
  const seq = await nextSeq(ENV, "org1", "mrn");
  assert.equal(seq, 1, "a failed registration must not consume an MR number");
});

test("ABHA is stored with its consent flag", async () => {
  reset();
  const r = await registerPatient(ENV, ORG, { ...GOOD, abhaNumber: "12345678901282", abhaConsent: true }, "doc1");
  assert.ok(r.ok, JSON.stringify(r.errors || r));
  const p = await getPatient(ENV, "org1", r.mrn);
  assert.equal(p.abhaNumber, "12345678901282");
  assert.equal(p.abhaConsent, true);
});
