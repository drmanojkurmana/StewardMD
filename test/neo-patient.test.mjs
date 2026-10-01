/* Neonatal baby record engine (neo-patient.js): PNA, day of life, PMA, corrected age, guards.
 * Worked examples come from data/neo/age.json (quoted PedCRIN tool), so the test checks the
 * engine against the source, not against numbers typed here.
 *
 * node --test test/neo-patient.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../neo-patient.js", import.meta.url), "utf8");
const mod = { exports: {} };
new Function("module", "window", SRC)(mod, undefined);
const E = mod.exports;
const AGE = JSON.parse(readFileSync(new URL("../data/neo/age.json", import.meta.url), "utf8"));
const ex = (id) => AGE.examples.find((x) => x.id === id);
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const addDays = (dob, days) => iso(Date.UTC(+dob.slice(0, 4), +dob.slice(5, 7) - 1, +dob.slice(8, 10)) + days * 864e5);

test("PMA example from the source: 27+3 GA and 12 weeks 6 days postnatal = 40+2", () => {
  const e = ex("pma_example");
  const d = E.derive({ gaW: e.ga_w, gaD: e.ga_d, dob: "2026-01-10", tob: "08:00" }, addDays("2026-01-10", e.pna_w * 7 + e.pna_d).replace("T00:00", "T09:00"));
  assert.equal(d.pnaDays, e.pna_w * 7 + e.pna_d);
  assert.deepEqual(d.pma, { w: e.pma_w, d: e.pma_d });
});

test("corrected age before the due date equals PMA (source example 31+3 with 4 weeks 6 days = 36+2)", () => {
  const e = ex("ca_before_edd");
  const d = E.derive({ gaW: e.ga_w, gaD: e.ga_d, dob: "2026-03-01" }, addDays("2026-03-01", e.pna_w * 7 + e.pna_d));
  assert.equal(d.corrected.beforeTerm, true);
  assert.deepEqual(d.corrected.asPma, { w: e.ca_w, d: e.ca_d });
});

test("corrected age after the due date subtracts weeks of prematurity (source: 50 weeks, born 25 = 35)", () => {
  const e = ex("ca_after_edd");
  const d = E.derive({ gaW: e.ga_w, gaD: 0, dob: "2025-01-01" }, addDays("2025-01-01", e.pna_w * 7));
  assert.equal(d.corrected.beforeTerm, false);
  assert.deepEqual(d.corrected.weeks, { w: e.ca_w, d: 0 });
});

test("PNA and day of life across month and year ends, and a leap day", () => {
  let d = E.derive({ dob: "2026-01-31", tob: "23:30" }, "2026-02-01T00:29");
  assert.equal(d.pnaHours, 0); assert.equal(d.pnaDays, 0); assert.equal(d.dol, 1);
  d = E.derive({ dob: "2026-01-31", tob: "23:30" }, "2026-02-01T23:30");
  assert.equal(d.pnaHours, 24); assert.equal(d.pnaDays, 1); assert.equal(d.dol, 2);
  d = E.derive({ dob: "2025-12-31", tob: "12:00" }, "2026-01-03T11:59");
  assert.equal(d.pnaDays, 2); assert.equal(d.pnaHours, 71);
  d = E.derive({ dob: "2028-02-28", tob: "06:00" }, "2028-03-01T06:00");
  assert.equal(d.pnaDays, 2, "2028 is a leap year: 28 Feb to 1 Mar is 2 days");
  d = E.derive({ dob: "2027-02-28", tob: "06:00" }, "2027-03-01T06:00");
  assert.equal(d.pnaDays, 1);
});

test("PMA across a month end: 29+6 born 30 Apr, 3 days later = 30+2", () => {
  const d = E.derive({ gaW: 29, gaD: 6, dob: "2026-04-30", tob: "10:00" }, "2026-05-03T10:00");
  assert.equal(d.pnaDays, 3); assert.equal(E.fmtWD(d.pma), "30+2");
});

test("neonatal period flag uses the sourced boundary (below 28 days)", () => {
  const rule = AGE.rules.find((r) => r.id === "neonatal_period");
  assert.equal(E.NEONATAL_DAYS, rule.days_lt);
  assert.equal(E.derive({ dob: "2026-01-01" }, addDays("2026-01-01", rule.days_lt - 1)).neonate, true);
  assert.equal(E.derive({ dob: "2026-01-01" }, addDays("2026-01-01", rule.days_lt)).neonate, false);
  assert.equal(E.TERM_DAYS, AGE.rules.find((r) => r.id === "corrected").term_wk * 7);
});

test("guards: GA range, grams only, impossible dates, future birth", () => {
  assert.match(E.check({ gaW: 21 }).join(" "), /outside 22 to 44/);
  assert.match(E.check({ gaW: 45 }).join(" "), /outside 22 to 44/);
  assert.equal(E.check({ gaW: 22, gaD: 0 }).length, 0);
  assert.match(E.check({ gaD: 7 }).join(" "), /0 to 6/);
  assert.match(E.check({ weightG: 1.2 }).join(" "), /looks like kilograms.*1200 g/);
  assert.match(E.check({ weightG: 250 }).join(" "), /outside 300 to 8,000 g/);
  assert.match(E.check({ birthWeightG: 9000 }).join(" "), /Birth weight/);
  assert.equal(E.check({ weightG: 300 }).length + E.check({ weightG: 8000 }).length, 0);
  assert.match(E.check({ dob: "2026-02-31" }).join(" "), /date and time of birth/);
  const f = E.derive({ dob: "2026-05-02", tob: "10:00" }, "2026-05-01T10:00");
  assert.equal(f.future, true); assert.equal(f.pnaDays, null);
});

test("summary line and missing inputs", () => {
  const d = E.derive({ gaW: 30, gaD: 2, dob: "2026-06-01", tob: "08:00", weightG: 1250, sex: "F" }, "2026-06-05T14:00");
  assert.equal(E.summary(d), "GA 30+2 · DOL 5 (4 d) · PMA 30+6 · 1,250 g · Female");
  const e = E.derive({}, "2026-06-05T14:00");
  assert.equal(e.pma, null); assert.equal(e.pnaDays, null); assert.equal(e.corrected, null);
});
