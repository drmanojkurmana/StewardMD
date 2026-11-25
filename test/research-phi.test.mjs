/* Plan v2 item 2: case text de-identification (research-phi.js).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const P = require("../research-phi.js");
const SRC = readFileSync(new URL("../research-phi.js", import.meta.url), "utf8");

const CASE = {
  name: "Ravi Kumar", uhid: "GIMS/2026/1234", age: "92", sex: "Male",
  presentationDate: "2026-03-01",
  presenting: "Chest pain 6 hours after zinc phosphide ingestion",
  examination: "BP 90/60 mmHg, pulse 118 per minute",
  investigations: [
    { date: "03/03/2026", test: "Ejection fraction", value: "35", unit: "%" },
    { date: "2026-03-01", test: "Troponin I", value: "2.4", unit: "ng/mL" },
    { date: "", test: "Potassium", value: "3.1", unit: "mmol/L" }
  ],
  diagnosis: "Toxic myocarditis",
  outcome: "Discharged on day 9, well at 3 months"
};

test("source is ES5 and pure", () => {
  assert.ok(!/=>/.test(SRC) && !/\b(let|const|class)\s/.test(SRC));
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(SRC));
  assert.ok(!/[–—]/.test(SRC));
});

test("scan finds dates, phones, email, Aadhaar, hospital numbers and labelled PIN codes", () => {
  const hits = P.scan("Seen 12/03/2026, 2026-03-14, 3 March 2026 and March 5, 2026. Call 98765 43210 or +91-9876543210, mail a.b@x.in, Aadhaar 2345 6789 0123, UHID: GIMS/2026/1234, IP No 556677, PIN 530045.");
  const kinds = hits.map((h) => h.kind);
  assert.deepEqual(kinds, ["date", "date", "date", "date", "phone", "phone", "email", "aadhaar", "uhid", "uhid", "pin"]);
});

test("scan leaves lab values alone", () => {
  assert.deepEqual(P.scan("Platelets 1,50,000 per microlitre, Hb 9.8 g/dL, K 3.5, sodium 128, creatinine 1.2, 6 hours, day 9"), []);
});

test("CR1: timeline is built in date order with Day 0 at presentation", () => {
  const tl = P.timeline(CASE);
  assert.deepEqual(tl.rows.map((r) => r.label + " " + r.text), ["Day 0 Troponin I 2.4 ng/mL", "Day 2 Ejection fraction 35 %"]);
});

test("prepareCaseText drops identifiers, turns dates into days and ages of 90 or more into 90 or older", () => {
  const r = P.prepareCaseText(CASE);
  assert.equal(r.blocked, false, r.findings.join(", "));
  assert.ok(!/Ravi|GIMS|2026|92/.test(r.text), r.text);
  assert.match(r.text, /90 or older/);
  assert.match(r.text, /Day 2: Ejection fraction 35 %/);
  assert.match(r.text, /Potassium 3\.1 mmol\/L/);
  assert.deepEqual(r.removed.map((x) => x.field).sort(), ["age", "dates", "name", "uhid"]);
});

test("a date left in free text blocks sending", () => {
  const r = P.prepareCaseText({ ...CASE, outcome: "Discharged on 10/03/2026" });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.findings, ["date: 10/03/2026"]);
});

test("CR3: a number in the draft that is not in the case file is flagged", () => {
  const src = P.prepareCaseText(CASE).text;
  const draft = "Troponin I was 2.40 ng/mL and ejection fraction 35%. Potassium was 2.9 mmol/L on day 2. Blood pressure 90/60 mmHg.";
  assert.deepEqual(P.numbersNotIn(draft, src), ["2.9"]);
});
