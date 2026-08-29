/* test/verify-cert-recognition.test.mjs — why NMC/SMC certificates were not recognised.
 *
 * Reported: "i see nmc/smc certificate not being recognised". Two defects in the matching path,
 * both of which reject a doctor who IS on the register:
 *
 *   1. regCore() took the LAST digit group. Real certificates print the year after the number
 *      ("APMC/FMR/112487/2015"), so the core became 2015, the register lookup missed, and the
 *      certificate came back unrecognised.
 *   2. The name was compared against record.firstName ALONE. Registers that split a name across
 *      first/middle/last had half of it thrown away before the comparison.
 *
 * EVERY fixture here is synthetic. Real certificates are live registration documents belonging to
 * identifiable doctors - name, number, photograph - and are not test data. The formats below are
 * the shapes those documents use, with invented numbers and names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { regCandidates, nmcNameOf } from "../functions/api/verify-doctor.js";
import { regCore as searchRegCore } from "../functions/api/_nmc.js";

const core = (s) => { const c = regCandidates(s); return c.length ? c[0] : ""; };

test("a trailing YEAR is never mistaken for the registration number", () => {
  // The reported failure, in the shapes certificates actually use.
  assert.equal(core("APMC/FMR/112487/2015"), "112487");
  assert.equal(core("TSMC/54321/2018"), "54321");
  assert.equal(core("KMC 98765 / 2011"), "98765");
  assert.equal(core("Reg. No. 445566 (Year: 1998)"), "445566");
});

test("the plain formats keep working", () => {
  assert.equal(core("112487"), "112487");
  assert.equal(core("APMC/FMR/112487"), "112487");
  assert.equal(core("MCI-77281"), "77281");
});

test("a year-only string still yields something rather than giving up", () => {
  // Better to look up a doubtful core and miss than to return "" and skip the register entirely.
  assert.equal(core("2015"), "2015");
  assert.equal(core(""), "");
  assert.equal(core(null), "");
});

test("candidates are offered longest-first, so one guess is not the only guess", () => {
  const c = regCandidates("APMC/12/112487/2015");
  assert.equal(c[0], "112487", "the registration number leads");
  assert.ok(c.includes("12"), "the shorter fragment is still available as a fallback");
  assert.equal(c.includes("2015"), false, "the year is dropped while real candidates exist");
});

test("the search helper and the verifier agree on the core", () => {
  // Two copies of this logic exist. They must not drift: a number that verifies must also be
  // findable in the register search, and the reverse.
  for (const s of ["APMC/FMR/112487/2015", "TSMC/54321/2018", "112487", "MCI-77281"]) {
    assert.equal(searchRegCore(s), core(s), `cores disagree for ${s}`);
  }
});

test("a split name is read whole, not just its first field", () => {
  assert.equal(nmcNameOf({ firstName: "ASHA", middleName: "RANI", lastName: "IYER" }), "ASHA RANI IYER");
  assert.equal(nmcNameOf({ firstName: "ASHA RANI IYER" }), "ASHA RANI IYER");
  assert.equal(nmcNameOf({ name: "ASHA RANI IYER" }), "ASHA RANI IYER", "the offline mirror uses `name`");
  assert.equal(nmcNameOf({ doctorName: "ASHA RANI IYER" }), "ASHA RANI IYER");
});

test("nmcNameOf never throws on a malformed record", () => {
  for (const bad of [null, undefined, {}, { firstName: null }, { firstName: 42 }, []]) {
    assert.equal(typeof nmcNameOf(bad), "string");
  }
});
