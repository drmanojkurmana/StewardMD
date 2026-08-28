/* test/opd-patient.test.mjs — OPD patient identity: registration, ABDM fields, MR numbers.
 *
 * The rules this locks down:
 *   • Required at the desk: name + mobile + gender + age (owner's call, 24 Aug 2026).
 *   • ABHA is captured and validated OFFLINE now (Verhoeff check digit, address shape) so the record
 *     is correct long before the ABDM gateway is wired up. Linkage requires recorded CONSENT.
 *   • MR numbers: StewardMD/personal clinic -> WE issue SMD-<CLINIC>-NNNNN. Hospital/GHIS/Connect ->
 *     the HOSPITAL issues it; we never mint one, and an un-issued patient carries an obviously
 *     temporary TMP- id that is swapped on link.
 *
 * node --test test/opd-patient.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMobile, isValidMobile, formatMobile,
  verhoeffOk, normalizeAbhaNumber, isValidAbhaNumber, formatAbhaNumber, normalizeAbhaAddress,
  birthDateFromAge, ageFromBirthDate, isValidBirthDate,
  makeClinicMrn, makeProvisionalMrn, isProvisionalMrn, isClinicMrn, mrSourceFor, resolveMrn,
  validateRegistration, abhaLinkable, duplicateKey, REQUIRED_FIELDS
} from "../functions/_opd_patient.js";

const NOW = Date.parse("2026-08-24T06:00:00Z");

/* ---------------------------------------------------------------- mobile */
test("mobile normalises to one canonical E.164 shape", () => {
  for (const raw of ["9876543210", "09876543210", "+91 98765 43210", "91-9876543210", " +919876543210 "]) {
    assert.equal(normalizeMobile(raw), "+919876543210", raw);
  }
  assert.equal(formatMobile("+919876543210"), "+91 98765 43210");
});

test("mobile rejects what would silently break the queue's WhatsApp notify", () => {
  assert.equal(isValidMobile("12345"), false, "too short");
  assert.equal(isValidMobile("1234567890"), false, "Indian mobiles start 6-9");
  assert.equal(isValidMobile("5876543210"), false);
  assert.equal(isValidMobile(""), false);
  assert.equal(isValidMobile("98765 4321O"), false, "letter O is not zero");
});

/* ---------------------------------------------------------------- ABHA */
test("ABHA number: 14 digits with a valid Verhoeff check digit", () => {
  // Verhoeff-valid by construction: the algorithm returns 0 for a correct number.
  const good = "12345678901282";
  assert.equal(verhoeffOk(good), true, "fixture must be a valid Verhoeff number");
  assert.equal(isValidAbhaNumber(good), true);
  assert.equal(formatAbhaNumber(good), "12-3456-7890-1282");
});

test("ABHA number rejects a mistyped digit — the whole point of validating offline", () => {
  const good = "12345678901282";
  const typo = "12345678901283";                 // last digit wrong
  assert.equal(verhoeffOk(typo), false);
  assert.equal(isValidAbhaNumber(typo), false);
  assert.equal(isValidAbhaNumber("1234567890"), false, "wrong length");
  assert.equal(normalizeAbhaNumber("12-3456-7890-1282"), good, "display form is accepted");
});

test("ABHA address shape", () => {
  assert.equal(normalizeAbhaAddress("Asha.Kumar@abdm"), "asha.kumar@abdm");
  assert.equal(normalizeAbhaAddress("12345678@sbx"), "12345678@sbx");
  assert.equal(normalizeAbhaAddress("no-at-sign"), "");
  assert.equal(normalizeAbhaAddress("@abdm"), "");
  assert.equal(normalizeAbhaAddress("a@"), "");
});

/* ---------------------------------------------------------------- age / dob */
test("age converts to a birth date, flagged approximate", () => {
  const dob = birthDateFromAge(34, 0, NOW);
  assert.equal(dob, "1992-08-01");
  const back = ageFromBirthDate(dob, NOW);
  assert.equal(back.years, 34);
});

test("infants are handled in months, not rounded to zero years", () => {
  const dob = birthDateFromAge(0, 7, NOW);
  const a = ageFromBirthDate(dob, NOW);
  assert.equal(a.years, 0);
  assert.equal(a.months, 7);
});

test("birth dates in the future or absurdly old are rejected", () => {
  assert.equal(isValidBirthDate("2030-01-01", NOW), false);
  assert.equal(isValidBirthDate("1850-01-01", NOW), false);
  assert.equal(isValidBirthDate("1992-08-01", NOW), true);
});

/* ---------------------------------------------------------------- MR numbers */
test("the clinic MR is padded, prefixed with the clinic code, and never recycled by construction", () => {
  assert.equal(makeClinicMrn("SMD-CZWRWH", 1), "SMD-CZWRWH-00001");
  assert.equal(makeClinicMrn("czwrwh", 42), "SMD-CZWRWH-00042");
  assert.equal(isClinicMrn("SMD-CZWRWH-00042"), true);
  // Sequence comes from a counter, so two consecutive allocations can never collide.
  assert.notEqual(makeClinicMrn("SMD-CZWRWH", 7), makeClinicMrn("SMD-CZWRWH", 8));
});

test("a provisional id is obviously temporary and never mistaken for a hospital MR", () => {
  const t = makeProvisionalMrn(3);
  assert.equal(t, "TMP-000003");
  assert.equal(isProvisionalMrn(t), true);
  assert.equal(isClinicMrn(t), false);
  assert.equal(isProvisionalMrn("SMD-CZWRWH-00042"), false);
  assert.equal(isProvisionalMrn("MRN-99"), false);
});

test("WHO issues the MR is decided by the workplace", () => {
  assert.equal(mrSourceFor("native"), "stewardmd");
  assert.equal(mrSourceFor(""), "stewardmd");
  assert.equal(mrSourceFor("ghis"), "ghis");
  assert.equal(mrSourceFor("connect"), "connect");
});

test("personal clinic: we allocate, and a typed hospital number is kept only as a reference", () => {
  const r = resolveMrn("native", "");
  assert.equal(r.mrSource, "stewardmd");
  assert.equal(r.needsAllocation, true);

  // The exact case that caused the GHIS-redirect bug: a clinic patient with a hospital-looking number.
  const r2 = resolveMrn("native", "12345");
  assert.equal(r2.mrSource, "stewardmd", "still OUR patient");
  assert.equal(r2.needsAllocation, true, "we still issue our own MR");
  assert.equal(r2.hospitalRef, "12345", "the typed number is kept as a reference, not as the identity");

  // Re-registering someone who already has our MR keeps it.
  const r3 = resolveMrn("native", "SMD-CZWRWH-00042");
  assert.equal(r3.needsAllocation, false);
  assert.equal(r3.mrn, "SMD-CZWRWH-00042");
});

test("hospital workplace: we NEVER mint an MR; no number yet means provisional", () => {
  const withMr = resolveMrn("ghis", "MRN-99");
  assert.equal(withMr.mrSource, "ghis");
  assert.equal(withMr.needsAllocation, false);
  assert.equal(withMr.mrn, "MRN-99");
  assert.equal(withMr.pending, false);

  const pending = resolveMrn("ghis", "");
  assert.equal(pending.mrSource, "provisional");
  assert.equal(pending.pending, true, "queue them now, swap the id when the EMR issues one");
  assert.equal(pending.mrn, "", "nothing minted here - the store assigns TMP-");

  const conn = resolveMrn("connect", "");
  assert.equal(conn.pending, true);
});

/* ---------------------------------------------------------------- registration */
const GOOD = { name: "Asha Kumar", mobile: "9876543210", gender: "female", ageYears: 34, visitType: "new" };

test("a complete registration passes and is normalised", () => {
  const r = validateRegistration(GOOD, NOW);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.patient.mobile, "+919876543210");
  assert.equal(r.patient.gender, "female");
  assert.equal(r.patient.ageYears, 34);
  assert.equal(r.patient.approxDob, true, "an age-derived DOB must be flagged approximate");
  assert.ok(r.patient.birthDate);
});

test("the four required fields are each enforced, with a field-keyed message", () => {
  assert.deepEqual(REQUIRED_FIELDS, ["name", "mobile", "gender", "age"]);
  assert.equal(validateRegistration({ ...GOOD, name: "" }, NOW).errors.name !== undefined, true);
  assert.equal(validateRegistration({ ...GOOD, mobile: "" }, NOW).errors.mobile !== undefined, true);
  assert.equal(validateRegistration({ ...GOOD, gender: "" }, NOW).errors.gender !== undefined, true);
  assert.equal(validateRegistration({ ...GOOD, ageYears: "" }, NOW).errors.age !== undefined, true);
  // errors are keyed so the form can render them inline, not in one modal alert
  const r = validateRegistration({ name: "", mobile: "", gender: "", ageYears: "" }, NOW);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["age", "gender", "mobile", "name"]);
});

test("optional fields are validated only when supplied", () => {
  assert.ok(validateRegistration(GOOD, NOW).ok, "no ABHA is fine");
  const bad = validateRegistration({ ...GOOD, abhaNumber: "12345678901283" }, NOW);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.abhaNumber);
  const badPin = validateRegistration({ ...GOOD, pincode: "1234" }, NOW);
  assert.equal(badPin.ok, false);
  assert.ok(badPin.errors.pincode);
  const okPin = validateRegistration({ ...GOOD, pincode: "530045" }, NOW);
  assert.ok(okPin.ok);
  assert.equal(okPin.patient.pincode, "530045");
});

test("SAFETY: ABHA identifiers without recorded consent are never linkable", () => {
  const noConsent = validateRegistration({ ...GOOD, abhaNumber: "12345678901282" }, NOW);
  assert.ok(noConsent.ok, "the patient still registers");
  assert.equal(noConsent.patient.abhaConsent, false);
  assert.equal(abhaLinkable(noConsent.patient), false, "ABDM linkage without consent is unlawful");

  const consented = validateRegistration({ ...GOOD, abhaNumber: "12345678901282", abhaConsent: true }, NOW);
  assert.equal(consented.patient.abhaConsent, true);
  assert.equal(abhaLinkable(consented.patient), true);

  // Consent ticked but no ABHA given is not linkable either.
  const empty = validateRegistration({ ...GOOD, abhaConsent: true }, NOW);
  assert.equal(abhaLinkable(empty.patient), false);
});

test("visit type falls back to new rather than storing rubbish", () => {
  assert.equal(validateRegistration({ ...GOOD, visitType: "followup" }, NOW).patient.visitType, "followup");
  assert.equal(validateRegistration({ ...GOOD, visitType: "nonsense" }, NOW).patient.visitType, "new");
});

test("duplicate key catches the same person returning to the same clinic", () => {
  assert.equal(duplicateKey("org1", "98765 43210"), duplicateKey("org1", "+919876543210"));
  assert.notEqual(duplicateKey("org1", "9876543210"), duplicateKey("org2", "9876543210"), "scoped per clinic");
  assert.equal(duplicateKey("org1", "bad"), "", "no key without a usable mobile");
});
