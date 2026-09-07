/* test/verify-match.test.mjs — why auto-verification said "no" to doctors who are on the register.
 *
 * Reported 2026-09-02: "auto verification of doctors doesn't work as intended (1/10 of expected)".
 * Every case here is a doctor who IS on the register and was being sent to manual review anyway.
 * Fixtures are synthetic: real certificates are live documents belonging to identifiable people.
 *
 * node --test test/verify-match.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nmcQueriesFor, nameAgrees, regAgrees, pickMatch, uniqueNameMatch, councilAgrees,
  autoVerifyOk, AUTO_VERIFY_MIN_CONFIDENCE, normName,
} from "../functions/_verify_match.js";

// ── 1. the register is asked the question it can answer ────────────────────────────────────────
test("the digit core is asked FIRST, the printed form last", () => {
  assert.deepEqual(nmcQueriesFor("APMC/FMR/112487/2015"), ["112487", "APMC/FMR/112487/2015"]);
  assert.deepEqual(nmcQueriesFor("TSMC/54321/2018"), ["54321", "TSMC/54321/2018"]);
  assert.deepEqual(nmcQueriesFor("112487"), ["112487"], "a plain number is asked once, not twice");
  assert.deepEqual(nmcQueriesFor(""), []);
});
test("a 2-digit fragment is never sent as a query on its own", () => {
  const q = nmcQueriesFor("APMC/12/112487/2015");
  assert.equal(q[0], "112487");
  assert.ok(!q.includes("12"), "12 would return half the register");
});

// ── 2. names: the same person, printed differently ─────────────────────────────────────────────
test("word order does not matter (surname-first vs surname-last)", () => {
  assert.equal(nameAgrees("MANOJ KUMAR KURMANA", "KURMANA MANOJ KUMAR"), true);
});
test("initials agree with the word they abbreviate, in both directions", () => {
  assert.equal(nameAgrees("K MANOJ KUMAR", "KURMANA MANOJ KUMAR"), true, "certificate carries an initial");
  assert.equal(nameAgrees("KURMANA MANOJ KUMAR", "K MANOJ KUMAR"), true, "register carries an initial");
  assert.equal(nameAgrees("M K KURMANA", "KURMANA MANOJ KUMAR"), true, "two initials and the surname");
});
test("honorifics and degrees are not part of the name", () => {
  assert.equal(nameAgrees("Dr. Manoj Kumar Kurmana, MBBS, MD", "KURMANA MANOJ KUMAR"), true);
  assert.equal(normName("Dr. Asha Rani Iyer MBBS"), "ASHA RANI IYER");
});
test("a joined name still agrees", () => {
  assert.equal(nameAgrees("MANOJKUMAR KURMANA", "KURMANA MANOJ KUMAR"), true);
});
test("bare initials alone can never agree with anyone", () => {
  assert.equal(nameAgrees("M K K", "KURMANA MANOJ KUMAR"), false, "no full word matched");
  assert.equal(nameAgrees("A B", "ASHA BANERJEE"), false);
});
test("a different person does not agree", () => {
  assert.equal(nameAgrees("PRIYA SHARMA", "KURMANA MANOJ KUMAR"), false);
  assert.equal(nameAgrees("MANOJ SHARMA", "MANOJ KUMAR KURMANA"), false, "one shared first name is not enough for a 2-word name");
});
test("empty names never agree", () => {
  assert.equal(nameAgrees("", "KURMANA MANOJ KUMAR"), false);
  assert.equal(nameAgrees("KURMANA", ""), false);
});

// ── 3. numbers: printed with prefix and year, registered bare ───────────────────────────────────
test("a bare register number agrees with the prefixed, dated form on the certificate", () => {
  assert.equal(regAgrees("112487", "APMC/FMR/112487/2015"), true);
  assert.equal(regAgrees("APMC/112487", "112487"), true);
  assert.equal(regAgrees("TN 54321", "54321/2018"), true);
});
test("a shared 2-digit fragment is NOT agreement", () => {
  assert.equal(regAgrees("12", "APMC/12/112487"), false);
});
test("different numbers do not agree", () => {
  assert.equal(regAgrees("112488", "APMC/FMR/112487/2015"), false);
});

// ── 4. the whole decision ───────────────────────────────────────────────────────────────────────
const AP = { registrationNo: "112487", firstName: "KURMANA MANOJ KUMAR", smcName: "Andhra Pradesh Medical Council" };
const TN = { registrationNo: "112487", firstName: "MANOJ KUMAR", smcName: "Tamil Nadu Medical Council" };
const OTHER = { registrationNo: "112487", firstName: "PRIYA SHARMA", smcName: "Andhra Pradesh Medical Council" };

test("THE REPORTED CASE: prefixed number + initialled name + bare register row -> a match", () => {
  const m = pickMatch([OTHER, AP], "APMC/FMR/112487/2015", "Dr K Manoj Kumar", "APMC");
  assert.equal(m, AP);
});
test("the same number from two councils: the certificate's council wins", () => {
  assert.equal(pickMatch([TN, AP], "112487", "MANOJ KUMAR", "Andhra Pradesh Medical Council"), AP);
  assert.equal(pickMatch([AP, TN], "112487", "MANOJ KUMAR", "TNMC"), TN);
});
test("no council read: the first agreeing row", () => {
  assert.equal(pickMatch([TN, AP], "112487", "MANOJ KUMAR", ""), TN);
});
test("a number match with a different name is NOT a match", () => {
  assert.equal(pickMatch([OTHER], "112487", "MANOJ KUMAR KURMANA", ""), null);
});
test("pickMatch is safe on junk", () => {
  assert.equal(pickMatch(null, "1", "x", ""), null);
  assert.equal(pickMatch([null, {}], "112487", "MANOJ", ""), null);
});

// ── 5. councils (a preference, never a gate) ────────────────────────────────────────────────────
test("councilAgrees: abbreviation vs long form, and a shared word", () => {
  assert.equal(councilAgrees("APMC", "Andhra Pradesh Medical Council"), true);
  assert.equal(councilAgrees("Andhra Pradesh Medical Council", "APMC"), true);
  assert.equal(councilAgrees("Telangana State Medical Council", "Andhra Pradesh Medical Council"), false);
  assert.equal(councilAgrees("", "APMC"), false);
});

// ── 6. name-only fallback: exactly one row, or a human ──────────────────────────────────────────
test("name-only: one agreeing row is accepted", () => {
  assert.equal(uniqueNameMatch([OTHER, AP], "Manoj Kumar Kurmana", ""), AP);
});
test("name-only: two agreeing rows is a guess, so null", () => {
  assert.equal(uniqueNameMatch([TN, AP], "Manoj Kumar", ""), null);
});
test("name-only: the council can narrow two rows to one", () => {
  assert.equal(uniqueNameMatch([TN, AP], "Manoj Kumar", "APMC"), AP);
});
test("name-only: a single-word name is never enough", () => {
  assert.equal(uniqueNameMatch([AP], "Kurmana", ""), null);
});

// ── 7. confidence is a floor once the register has agreed ───────────────────────────────────────
test("an ordinary phone-photo confidence no longer goes to a human", () => {
  assert.equal(AUTO_VERIFY_MIN_CONFIDENCE, 0.5);
  assert.equal(autoVerifyOk(0.62), true, "0.62 was routed to manual review under the 0.85 gate");
  assert.equal(autoVerifyOk(0.85), true);
  assert.equal(autoVerifyOk(0.3), false, "a genuinely poor read still gets a human");
  assert.equal(autoVerifyOk(0), false);
  assert.equal(autoVerifyOk(undefined), true, "no number at all is not treated as zero");
});
