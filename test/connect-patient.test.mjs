// test/connect-patient.test.mjs — Connect patient pull mappers (window.CONNECTPT), P2 increment 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../connect-patient.js", import.meta.url), "utf8");

// Load the browser IIFE with stubbed globals; only the pure mappers are exercised (no DOM).
function load({ ICU, MEDLIST, SMD_CONNECT } = {}) {
  const win = { ICU, MEDLIST, SMD_CONNECT };
  const loc = { search: "" };
  const ls = { getItem: () => null };
  const doc = { getElementById: () => null };
  new Function("window", "location", "localStorage", "document", SRC)(win, loc, ls, doc);
  return win.CONNECTPT;
}

test("_age computes age from birthDate (TZ-safe boundaries)", () => {
  const now = Date.UTC(2026, 6, 2, 12);                 // 2026-07-02 noon UTC
  const CPT = load();
  assert.equal(CPT._age("1985-03-10", now), 41);        // birthday already passed
  assert.equal(CPT._age("1985-11-20", now), 40);        // birthday later this year
  assert.equal(CPT._age("garbage"), "");
});

test("_demographics maps SCCM patient + conditions", () => {
  const CPT = load();
  const b = { patient: { name: { text: "Asha Rao" }, gender: "female", birthDate: "1980-01-01", identifiers: [{ value: "MRN9" }] }, conditions: [{ code: { text: "Sepsis" } }, { code: { text: "AKI" } }] };
  const d = CPT._demographics(b);
  assert.equal(d.name, "Asha Rao");
  assert.equal(d.sex, "female");
  assert.equal(d.mrn, "MRN9");
  assert.equal(d.diagnosis, "Sepsis; AKI");
});

test("_demographics falls back to given+family; blanks unknown gender + missing MRN", () => {
  const CPT = load();
  const d = CPT._demographics({ patient: { name: { given: ["Ravi"], family: "Kumar" }, gender: "unknown", identifiers: [] } });
  assert.equal(d.name, "Ravi Kumar");
  assert.equal(d.sex, "");
  assert.equal(d.mrn, "");
});

test("_labRows maps Quantity + string observations, drops value-less / name-less", () => {
  const CPT = load();
  const b = { observations: [
    { code: { text: "Sodium" }, value: { value: 138, unit: "mmol/L" }, referenceRange: { low: { value: 135 }, high: { value: 145 } }, effectiveDateTime: "2026-08-01" },
    { code: { text: "Blood group" }, value: { text: "O+" } },
    { code: { text: "Empty" }, value: null },
    { code: { text: "" }, value: { value: 1 } },
  ] };
  const rows = CPT._labRows(b);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { test: "Sodium", result: 138, units: "mmol/L", low: 135, high: 145, date: "2026-08-01" });
  assert.equal(rows[1].test, "Blood group");
  assert.equal(rows[1].result, "O+");
});

test("_medText joins medication.text + dosage.text", () => {
  const CPT = load();
  assert.equal(CPT._medText({ medication: { text: "Aspirin" }, dosage: { text: "75 mg OD" } }), "Aspirin 75 mg OD");
  assert.equal(CPT._medText({ medication: { text: "Metformin" } }), "Metformin");
});

test("_pushToICU calls ICU.ingestPatient + ingestWardHistory with mapped labs (source=Connect EMR)", () => {
  let pt = null, ward = null;
  const CPT = load({ ICU: { ingestPatient: (o) => { pt = o; }, ingestWardHistory: (o) => { ward = o; } } });
  const b = { patient: { id: "P1", name: { text: "X" }, gender: "male", birthDate: "2000-01-01" }, conditions: [{ code: { text: "DKA" } }], observations: [{ code: { text: "Na" }, value: { value: 140, unit: "mmol/L" } }] };
  const out = CPT._pushToICU(b);
  assert.equal(out.labs, 1);
  assert.equal(pt.name, "X");
  assert.equal(pt.diagnosis, "DKA");
  assert.equal(ward.source, "Connect EMR");
  assert.equal(ward.labs.length, 1);
  assert.equal(ward.labs[0].test, "Na");
});

test("_sendMeds pushes each med through MEDLIST.parseEntry + add(_, 'connect')", () => {
  const added = [];
  const CPT = load({ MEDLIST: { parseEntry: (t) => ({ raw: t }), add: (e, src) => { added.push([e.raw, src]); } } });
  const n = CPT._sendMeds({ medications: [{ medication: { text: "Aspirin" }, dosage: { text: "75mg" } }, { medication: { text: "" } }] });
  assert.equal(n, 1);
  assert.deepEqual(added[0], ["Aspirin 75mg", "connect"]);
});
