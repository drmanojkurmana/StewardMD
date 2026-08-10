/* test/nmc-search.test.mjs — NMC register search helpers (functions/api/_nmc.js).
 * Verifies name-vs-reg detection, reg-core extraction, and that result normalization keeps only
 * the PUBLIC subset (name/reg/council/year/qualification), dedupes, and drops private fields.
 * node --test test/nmc-search.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeReg, regCore, normalizeResults } from "../functions/api/_nmc.js";

test("looksLikeReg: digits => reg, names => name", () => {
  assert.equal(looksLikeReg("45678"), true);
  assert.equal(looksLikeReg("TN/12345"), true);      // council prefix is fine
  assert.equal(looksLikeReg("Rakesh Sharma"), false);
  assert.equal(looksLikeReg("Dr Sharma"), false);
  assert.equal(looksLikeReg("Sharma 12"), false);    // <3 digit run => name
});

test("regCore: last digit group", () => {
  assert.equal(regCore("TN/12345"), "12345");
  assert.equal(regCore("MMC-2011-45678"), "45678");
  assert.equal(regCore("no digits"), "");
});

test("normalizeResults: keeps public subset, drops private fields, dedupes", () => {
  const raw = [
    { // live-NMC shape, with private fields that MUST be dropped
      doctorId: 111, firstName: "Nirmal Kumar", middleName: "", lastName: "Basu",
      registrationNo: "4447", smcName: "Tamil Nadu Medical Council", yearOfPassing: "1938",
      doctorDegree: "M.B.  (CAL U)", university: "CAL U",
      phoneNo: "99999", emailId: "x@y.z", adharNo: "1234", address: "Brindavan Street"
    },
    { doctorId: 111, firstName: "Nirmal Kumar Basu", registrationNo: "4447", smcName: "Tamil Nadu Medical Council" }, // dup id
    { // D1 shape (name/council only)
      registrationNo: "21028", firstName: "Gurakesh Debansi", smcName: "West Bengal Medical Council"
    },
    { firstName: "", registrationNo: "" }   // empty -> dropped
  ];
  const out = normalizeResults(raw);
  assert.equal(out.length, 2, "deduped by doctorId + empty row dropped");
  const a = out[0];
  assert.equal(a.name, "Nirmal Kumar Basu");
  assert.equal(a.regNo, "4447");
  assert.equal(a.council, "Tamil Nadu Medical Council");
  assert.equal(a.year, "1938");
  assert.equal(a.degree, "M.B. (CAL U)");           // whitespace collapsed
  assert.equal(a.university, "CAL U");
  // private fields never surface
  assert.equal("phoneNo" in a, false);
  assert.equal("emailId" in a, false);
  assert.equal("adharNo" in a, false);
  assert.equal("address" in a, false);
  assert.equal(out[1].name, "Gurakesh Debansi");
});

test("normalizeResults: non-array input is safe", () => {
  assert.deepEqual(normalizeResults(null), []);
  assert.deepEqual(normalizeResults(undefined), []);
});
