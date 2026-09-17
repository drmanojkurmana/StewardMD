/* test/wardsynq-legacy-import.test.mjs - loading a replaced HIS's patients, Price list rows and suppliers (R2-5).
 *
 * Route: POST /api/queue/ward/legacy-import (kind patients, prices, vendors). No session 401; a role without staff.admin
 * 403; staff.admin without the kind's own door (hr: no queue.add, no stores.manage) 403; another hospital's admin 403;
 * each with nothing written. Dry run writes nothing, a commit that differs from the dry run writes nothing, patients go
 * through the desk's duplicate checks and are never merged, a taxable price without a GST rate is invalid.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-legacy-import.test.mjs
 */
import { as, seed, docs, H, ENV, ORG_ID, OTHER, ADMIN, NURSE, HR, CASHIER, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../functions/_wardsynq/legacy-import.js");
const { patientIdForMrn } = await import("../functions/_wardsynq/opd-identity.js");
ENV.CLINIC_BILLING_ENABLED = "1";

const R = "/ward/legacy-import";
const stored = (prefix) => [...docs.keys()].filter((k) => k.startsWith(prefix)).length;
const audits = (action) => [...docs.values()].filter((d) => d.fields && d.fields.action === action);

const PATIENTS = "HIS No,Patient Name,Mobile,Sex,DOB,Address\n" +
  "L-100,Asha Rao,9876500001,F,14/02/1980,Hyderabad\n" +
  "L-101,Ravi Kumar,9876500002,M,01/01/1975,Warangal\n" +
  "L-102,No Phone,,M,01/01/1990,\n" +
  "L-103,Sita Devi,9876500003,F,31/02/1990,\n" +
  "L-104,Card Holder,9876500004,F,01/01/1990,Aadhaar 1234 5678 9012\n" +
  "L-100,Asha Again,9876500005,F,14/02/1980,\n";
const PMAP = { legacyMrn: 0, name: 1, mobile: 2, gender: 3, birthDate: 4, address: 5, dateOrder: "dmy" };

test("dayOf: three orders, impossible days refused, never rolled over", () => {
  assert.equal(L.dayOf("14/02/1980", "dmy"), "1980-02-14");
  assert.equal(L.dayOf("02-14-1980", "mdy"), "1980-02-14");
  assert.equal(L.dayOf("1980.2.14", "ymd"), "1980-02-14");
  assert.equal(L.dayOf("31/02/1990", "dmy"), "");
  assert.equal(L.dayOf("14/02/80", "dmy"), "", "a two-digit year is not guessed");
});

test("POST /api/queue/ward/legacy-import: 401 without a session, 403 for nurse, cashier, hr without the kind's door and another hospital; nothing written", async () => {
  seed();
  const before = writesNow(), patients = stored("q_patients/"), tariff = stored("q_tariff/");
  const body = (kind, extra) => ({ orgId: ORG_ID, kind, csv: PATIENTS, mapping: PMAP, ...(extra || {}) });
  assert.equal((await as(null, R, "POST", body("patients"))).__status, 401);
  assert.equal((await as(NURSE, R, "POST", body("patients"))).__status, 403);
  assert.equal((await as(CASHIER, R, "POST", body("prices"))).__status, 403);
  assert.equal((await as(HR, R, "POST", body("patients", { commit: true, confirmCount: 2 }))).__status, 403, "hr holds staff.admin but not queue.add");
  assert.equal((await as(HR, R, "POST", body("vendors"))).__status, 403, "hr holds staff.admin but not stores.manage");
  assert.equal((await as(OTHER_ADMIN, R, "POST", body("patients"))).__status, 403, "another hospital's admin");
  assert.equal(writesNow(), before);
  assert.equal(stored("q_patients/"), patients);
  assert.equal(stored("q_tariff/"), tariff);
  assert.equal((await as(ADMIN, R, "POST", body("nothing"))).error, "unknown_kind");
});

test("patients: map, dry run row by row writes nothing, a changed commit writes nothing, the commit registers exactly the dry run and re-running matches", async () => {
  seed();
  // Someone already registered at the desk with Ravi's mobile.
  docs.set(`q_patient_index/${ORG_ID}__-919876500002`, { fields: { orgId: ORG_ID, mrn: "SMD-WARD01-00007" }, updateTime: "t1" });
  const map = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: PATIENTS });
  assert.equal(map.__status, 200, map.__text);
  assert.deepEqual([map.step, map.rowCount, map.rowCap], ["map", 6, 100]);
  assert.ok(!JSON.stringify(map.sample).includes("1234 5678 9012"), "an Aadhaar-shaped value is masked even in the sample");

  const rowsBefore = H.RECORD._rows.length, patientsBefore = stored("q_patients/");
  const dry = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: PATIENTS, mapping: PMAP });
  assert.equal(dry.__status, 200, dry.__text);
  assert.equal(dry.step, "preview");
  const st = Object.fromEntries(dry.rows.map((r) => [r.row, r]));
  assert.equal(st[2].status, "create");
  assert.equal(st[3].status, "duplicate"); assert.equal(st[3].existing.mrn, "SMD-WARD01-00007", "the MRN of the patient it may be is named");
  assert.equal(st[4].status, "invalid"); assert.equal(st[4].field, "mobile");
  assert.equal(st[5].status, "invalid"); assert.equal(st[5].field, "birthDate");
  assert.equal(st[6].status, "invalid"); assert.equal(st[6].field, "address"); assert.match(st[6].reason, /Aadhaar is not stored/);
  assert.equal(st[7].status, "invalid"); assert.match(st[7].reason, /Repeats row 2/);
  assert.deepEqual(dry.counts, { create: 1, matched: 0, duplicate: 1, invalid: 4 });
  assert.equal(H.RECORD._rows.length, rowsBefore, "a dry run writes no record");
  assert.equal(stored("q_patients/"), patientsBefore, "a dry run registers nobody");

  const wrong = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: PATIENTS, mapping: PMAP, commit: true, confirmCount: 2, planId: dry.planId });
  assert.equal(wrong.__status, 409); assert.equal(wrong.error, "preview_changed");
  const stale = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: PATIENTS, mapping: PMAP, commit: true, confirmCount: 1, planId: "0000000000000000" });
  assert.equal(stale.error, "preview_changed");
  assert.equal(H.RECORD._rows.length, rowsBefore); assert.equal(stored("q_patients/"), patientsBefore);

  const done = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: PATIENTS, mapping: PMAP, commit: true, confirmCount: 1, planId: dry.planId });
  assert.equal(done.__status, 200, done.__text);
  assert.equal(done.written, 1);
  const mrn = done.rows.find((r) => r.row === 2).mrn;
  assert.ok(mrn && mrn !== "L-100", "the hospital's own MR number is issued; the legacy one is kept beside it");
  const reg = docs.get(`q_patients/${ORG_ID}__${mrn}`.replace(/[^A-Za-z0-9_\/-]/g, "-"));
  assert.ok(reg, "registered through the desk's store");
  assert.equal(reg.fields.hospitalRef, "L-100");
  const rec = await H.RECORD.latest("tenant-wsq", "Patient", patientIdForMrn(mrn));
  assert.ok(rec, "a record master was written");
  assert.ok(rec.identifiers.some((i) => i.system === "legacy-mrn" && i.value === "L-100"));
  assert.equal(rec.dob, "1980-02-14");
  assert.equal(audits("legacy_import").length, 1, "the import is audited");
  assert.doesNotMatch(audits("legacy_import")[0].fields.meta, /Asha|9876/, "the audit line carries counts, not the patient");

  const again = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: PATIENTS, mapping: PMAP });
  const r2 = again.rows.find((r) => r.row === 2);
  assert.equal(r2.status, "matched"); assert.equal(r2.existing.mrn, mrn);
  assert.equal(again.counts.create, 0);

  // A different legacy number and mobile, same name and date of birth: a possible duplicate, never created or merged.
  const twin = "No,Name,Mobile,Sex,DOB\nL-900,Asha Rao,9876500099,F,14/02/1980\n";
  const tw = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv: twin, mapping: { legacyMrn: 0, name: 1, mobile: 2, gender: 3, birthDate: 4, dateOrder: "dmy" } });
  assert.equal(tw.rows[0].status, "duplicate", JSON.stringify(tw.rows));
  assert.equal(tw.rows[0].existing.mrn, mrn);
});

test("patients: with the hospital's own numbering an MR number already in use is a duplicate, never written over", async () => {
  seed({ externalMrn: true });
  docs.set(`q_patients/${ORG_ID}__L-500`, { fields: { orgId: ORG_ID, mrn: "L-500", mrSource: "stewardmd", encName: "", encMobile: "" }, updateTime: "t1" });
  const csv = "No,Name,Mobile,Sex,Age\nL-500,Someone Else,9876511111,M,40\n";
  const dry = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv, mapping: { legacyMrn: 0, name: 1, mobile: 2, gender: 3, ageYears: 4 } });
  assert.equal(dry.__status, 200, dry.__text);
  assert.equal(dry.rows[0].status, "duplicate"); assert.equal(dry.rows[0].existing.mrn, "L-500");
  assert.equal(dry.counts.create, 0);
});

test("prices: a taxable row without a GST rate and a bad HSN are invalid, a listed price is matched and unchanged, the commit goes to the Price list", async () => {
  seed();
  docs.set("q_tariff/trf_old", { fields: { orgId: ORG_ID, active: true, name: "CBC", code: "LAB1", kind: "investigation", price: 30000 }, updateTime: "t1" });
  const csv = "Item,Code,Type,Rate,HSN,GST\n" +
    "Complete blood count,LAB1,investigation,450,,\n" +
    "Paracetamol 500 mg,MED1,medication,2.50,3004,\n" +
    "Amoxicillin 500 mg,MED2,medication,12,3004,12\n" +
    "X-ray chest,RAD1,investigation,600,99,\n" +
    "General ward bed,BED1,bed,1500,,\n" +
    "Consult,,consult,300,,\n";
  const mapping = { name: 0, code: 1, kind: 2, price: 3, hsnSac: 4, gstRate: 5 };
  const dry = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "prices", csv, mapping });
  assert.equal(dry.__status, 200, dry.__text);
  const st = Object.fromEntries(dry.rows.map((r) => [r.row, r]));
  assert.equal(st[2].status, "matched"); assert.equal(st[2].existing.price, 30000);
  assert.equal(st[3].status, "invalid"); assert.equal(st[3].field, "gstRate");
  assert.equal(st[4].status, "create");
  assert.equal(st[5].status, "invalid"); assert.equal(st[5].field, "hsnSac");
  assert.equal(st[6].status, "create");
  assert.equal(st[7].status, "invalid"); assert.equal(st[7].field, "kind");
  assert.equal(stored("q_tariff/"), 1, "a dry run writes nothing");
  const done = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "prices", csv, mapping, commit: true, confirmCount: 2, planId: dry.planId });
  assert.equal(done.__status, 200, done.__text);
  assert.equal(done.written, 2);
  const list = await as(ADMIN, `/bill/tariff?orgId=${ORG_ID}`);
  assert.equal(list.items.length, 3);
  assert.equal(list.items.find((t) => t.code === "LAB1").price, 30000, "the listed price was not changed");
  assert.equal(list.items.find((t) => t.code === "MED2").gstRate, 12);
  assert.equal(list.items.find((t) => t.code === "BED1").price, 150000);
  assert.ok(audits("tariff_create").length === 2 && audits("legacy_import").length === 1);

  ENV.CLINIC_BILLING_ENABLED = "";
  try {
    const off = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "prices", csv, mapping });
    assert.equal(off.__status, 409); assert.equal(off.error, "price_list_off");
  } finally { ENV.CLINIC_BILLING_ENABLED = "1"; }
});

test("vendors: bad GSTIN invalid, repeats refused, commit writes Vendor records at the purchasing id, re-run matches", async () => {
  seed();
  const csv = "Supplier,GSTIN,Phone\nMedi Distributors,36AABCU9603R1ZM,040111\nBad Tax Co,12345,\nmedi distributors,,\n";
  const mapping = { name: 0, gstin: 1, phone: 2 };
  const before = H.RECORD._rows.length;
  const dry = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "vendors", csv, mapping });
  assert.equal(dry.__status, 200, dry.__text);
  assert.deepEqual(dry.rows.map((r) => r.status), ["create", "invalid", "invalid"]);
  assert.equal(dry.rows[1].field, "gstin");
  assert.equal(H.RECORD._rows.length, before);
  const done = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "vendors", csv, mapping, commit: true, confirmCount: 1, planId: dry.planId });
  assert.equal(done.__status, 200, done.__text);
  const v = await H.RECORD.latest("tenant-wsq", "Vendor", "wsq-vendor-medi-distributors");
  assert.equal(v.id, "wsq-vendor-medi-distributors"); assert.equal(v.gstin, "36AABCU9603R1ZM");
  const again = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "vendors", csv, mapping });
  assert.equal(again.rows[0].status, "matched");
});

test("a file over the row cap is refused with the cap named", async () => {
  seed();
  const csv = "No,Name,Mobile,Sex,Age\n" + Array.from({ length: 101 }, (_, i) => `L-${i},Person ${i},98765${String(i).padStart(5, "0")},M,30`).join("\n");
  const r = await as(ADMIN, R, "POST", { orgId: ORG_ID, kind: "patients", csv });
  assert.equal(r.__status, 413); assert.equal(r.rowCap, 100);
});
