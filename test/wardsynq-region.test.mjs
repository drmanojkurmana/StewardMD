/* test/wardsynq-region.test.mjs — what a hospital's country actually implies.
 *
 * WardSynQ was India-first, which was right, but had become India-ONLY in places that are not a
 * matter of taste: a US hospital could not register a single patient, because the phone validator
 * rejects every number that is not a +91 mobile. These pin the region rules so the registration
 * desk, the ward and the prescription can never disagree about them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regionOf, DEFAULT_REGION, normalizePhone, isValidPhone, formatPhone,
  unitsFor, isValidPrescriberId, prescriberIdLabel, dateOrder, currency,
} from "../functions/_region.js";

test("an org with no region is India, so no existing hospital changes meaning", () => {
  assert.equal(DEFAULT_REGION, "IN");
  assert.equal(regionOf(null), "IN");
  assert.equal(regionOf({}), "IN");
  assert.equal(regionOf({ region: "" }), "IN");
  assert.equal(regionOf({ region: "ZZ" }), "IN", "an unrecognised region must not become a third behaviour");
  assert.equal(regionOf({ region: "us" }), "US", "case is not a different country");
});

test("India accepts the shapes a desk really types, and refuses a landline", () => {
  for (const raw of ["9876543210", "09876543210", "+91 98765 43210", "91-9876543210"]) {
    assert.equal(normalizePhone(raw, "IN"), "+919876543210", raw);
  }
  assert.equal(normalizePhone("5876543210", "IN"), "", "an Indian mobile never starts below 6");
  assert.equal(normalizePhone("98765", "IN"), "");
});

test("the US number that used to be impossible to register now works", () => {
  // This is the blocker: before the region existed, every one of these was refused outright.
  for (const raw of ["4155550142", "1-415-555-0142", "+1 (415) 555-0142"]) {
    assert.equal(normalizePhone(raw, "US"), "+14155550142", raw);
  }
  assert.equal(isValidPhone("4155550142", "US"), true);
  // ...and is still correctly refused for an Indian hospital, rather than silently stored as one.
  assert.equal(isValidPhone("4155550142", "IN"), false, "a US number is not a valid Indian mobile");
});

test("US numbering rules are enforced, not just the digit count", () => {
  assert.equal(normalizePhone("0155550142", "US"), "", "an area code may not start 0");
  assert.equal(normalizePhone("1155550142", "US"), "", "an area code may not start 1");
  assert.equal(normalizePhone("4150550142", "US"), "", "an exchange may not start 0");
  assert.equal(normalizePhone("9115550142", "US"), "", "N11 is a service code, never a subscriber");
});

test("a number is shown the way its country writes it", () => {
  assert.equal(formatPhone("+919876543210", "IN"), "+91 98765 43210");
  assert.equal(formatPhone("+14155550142", "US"), "+1 (415) 555-0142");
});

test("the units a clinician writes without thinking differ, and that is the dangerous part", () => {
  assert.deepEqual(unitsFor("IN"), { temp: "C", weight: "kg", height: "cm" });
  assert.deepEqual(unitsFor("US"), { temp: "F", weight: "lb", height: "in" });
  // 37.1 recorded as Fahrenheit is profound hypothermia. The two must never collapse to one default.
  assert.notEqual(unitsFor("IN").temp, unitsFor("US").temp);
});

test("a US prescriber id is checked offline; an Indian one is taken as written and said to be", () => {
  // Real NPI check digits (Luhn over 80840 + the 9-digit base).
  assert.equal(isValidPrescriberId("1245319599", "US"), true);
  assert.equal(isValidPrescriberId("1245319598", "US"), false, "a mistyped NPI is caught here, offline");
  assert.equal(isValidPrescriberId("12453195", "US"), false, "an NPI is ten digits");

  // India has no national check digit, so anything non-empty is accepted rather than guessed at:
  // refusing a real doctor's real council number would be worse than accepting it.
  assert.equal(isValidPrescriberId("TSMC-2019-44821", "IN"), true);
  assert.equal(isValidPrescriberId("  ", "IN"), false, "but blank is still nobody");
  assert.equal(isValidPrescriberId("", "US"), false);
});

test("the form asks for the right thing, and money is not converted", () => {
  assert.match(prescriberIdLabel("US"), /NPI/);
  assert.match(prescriberIdLabel("IN"), /council/i);
  assert.equal(dateOrder("US"), "MDY");
  assert.equal(dateOrder("IN"), "DMY");
  assert.equal(currency("US").code, "USD");
  assert.equal(currency("IN").code, "INR");
});
