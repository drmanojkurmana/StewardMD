/* test/opd-patient-search.test.mjs: the check-in sheet's "Find existing patient" (functions/_opd_patient_store.js searchPatients).
 * By name (every word, any order), by phone (exact or partial digits), by MRN. Names and numbers are stored encrypted, so
 * partial matches decrypt this org's rows; another org's patients are never returned. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const docs = new Map();
mock.module("../functions/_fbfirestore.js", { namedExports: {
  fsGet: async (_e, p) => (docs.has(p) ? { id: p, name: p, fields: { ...docs.get(p) } } : null),
  fsQuery: async (_e, col, o) => { const w = [].concat(o.where || []); return [...docs.entries()].filter(([p, f]) => p.startsWith(col + "/") && w.every((x) => String(f[x.field]) === String(x.value))).map(([p, f]) => ({ name: p, fields: { ...f } })); },
  fsCommit: async () => ({ ok: true }), wCreate: () => ({}), wUpdate: () => ({}),
} });
mock.module("../functions/_queue_engine.js", { namedExports: { qAudit: async () => {} } });
mock.module("../functions/_queue.js", { namedExports: { encPHI: async (_e, v) => v, decPHI: async (_e, v) => v } });
const { searchPatients } = await import("../functions/_opd_patient_store.js");
const { duplicateKey } = await import("../functions/_opd_patient.js");

function add(org, mrn, name, mobile, extra) {
  docs.set("q_patients/" + org + "__" + mrn, { orgId: org, mrn, encName: name, encMobile: mobile, gender: "female", ageYears: 30, ...(extra || {}) });
  docs.set("q_patient_index/" + (duplicateKey(org, mobile) || "").replace(/[^A-Za-z0-9_-]/g, "-"), { mrn });
}
add("clinicA", "SMD-AAA-00001", "Asha Kumar", "+919876543210");
add("clinicA", "SMD-AAA-00002", "Ravi Kumar Singh", "+919812345678");
add("clinicA", "SMD-AAA-00003", "Old Merged", "+919800000001", { supersededBy: "SMD-AAA-00001" });
add("clinicB", "SMD-BBB-00001", "Asha Kumar", "+919000011111");

test("by name: every word, any order, case-insensitive, this clinic only", async () => {
  const r = await searchPatients({}, "clinicA", "kumar asha");
  assert.deepEqual(r.results.map((x) => x.mrn), ["SMD-AAA-00001"]);
  assert.equal((await searchPatients({}, "clinicA", "KUMAR")).results.length, 2);
});
test("by full phone number (exact index) and by the last digits", async () => {
  assert.equal((await searchPatients({}, "clinicA", "98765 43210")).results[0].mrn, "SMD-AAA-00001");
  assert.equal((await searchPatients({}, "clinicA", "+91 9876543210")).results[0].name, "Asha Kumar");
  assert.deepEqual((await searchPatients({}, "clinicA", "45678")).results.map((x) => x.mrn), ["SMD-AAA-00002"]);
});
test("by MRN; merged records and another clinic's patients never come back", async () => {
  assert.equal((await searchPatients({}, "clinicA", "SMD-AAA-00002")).results[0].name, "Ravi Kumar Singh");
  assert.equal((await searchPatients({}, "clinicA", "Old Merged")).results.length, 0);
  assert.equal((await searchPatients({}, "clinicA", "11111")).results.length, 0);
  assert.equal((await searchPatients({}, "clinicA", "SMD-BBB-00001")).results.length, 0);
});
test("one character is not a search", async () => {
  assert.deepEqual((await searchPatients({}, "clinicA", "a")).results, []);
});
