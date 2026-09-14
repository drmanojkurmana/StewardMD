/* test/wardsynq-region-in.test.mjs - India profile, GST, ABDM identifiers, Devanagari transliteration, and i18n. P2.6/P2.7.
 *
 * node --test test/wardsynq-region-in.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGstin, gstinCheckChar, isValidGstin,
  normalizeHfrId, isValidHfrId,
  normalizeHprId, isValidHprId,
  orgProfile, memberProfile,
  validateOrgProfile, validateMemberProfile,
  gstForLines,
} from "../functions/_region_in.js";

import {
  transliterateDevanagari, normalizeName, findCandidates,
} from "../wardsynq/wardsynq-mpi.js";

import { openInvoice, chargeTotal } from "../wardsynq/wardsynq-invoice.js";
import i18nPkg from "../wardsynq/site/i18n.js";
const { t, register, missingKeys } = i18nPkg;

test("GSTIN: normalization, check character, and format validation", () => {
  // Pinned against real GST portal formats: 2 digits, 5 letters, 4 digits, 1 letter, 1 entity, Z, check char
  const valid = "29AAAAA0000A1ZY";
  assert.equal(normalizeGstin(" 29aaaaa0000a1zy "), valid);
  assert.equal(gstinCheckChar("29AAAAA0000A1Z"), "Y");
  assert.equal(isValidGstin(valid), true);
  assert.equal(isValidGstin("29AAAAA0000A1Z4"), false, "wrong check character rejected");
  assert.equal(isValidGstin("29AAAAA0000A15"), false, "short length rejected");
  assert.equal(isValidGstin("INVALID"), false);
});

test("ABDM identifiers: HFR facility id and HPR professional id", () => {
  assert.equal(isValidHfrId("IN1234567890"), true);
  assert.equal(isValidHfrId("IN-1234-5678-90"), true);
  assert.equal(normalizeHfrId("in-1234-5678-90"), "IN1234567890");
  assert.equal(isValidHfrId("US1234567890"), false, "must start with IN");
  assert.equal(isValidHfrId("IN12345"), false, "must have 10 digits");

  assert.equal(isValidHprId("12345678901234"), true);
  assert.equal(isValidHprId("12-3456-7890-1234"), true);
  assert.equal(normalizeHprId("12-3456-7890-1234"), "12345678901234");
  assert.equal(isValidHprId("12345"), false, "must have 14 digits");
});

test("India region profile on org and membership: IN vs non-IN", () => {
  const inOrg = { gstin: "29AAAAA0000A1ZY", hfrId: "IN1234567890" };
  assert.deepEqual(orgProfile(inOrg, "IN"), inOrg);
  assert.deepEqual(validateOrgProfile(inOrg, "IN"), {});

  // A hospital outside India cannot have GSTIN or HFR
  assert.deepEqual(orgProfile(inOrg, "US"), {});
  assert.equal(Boolean(validateOrgProfile(inOrg, "US").region), true);

  const inMem = { hprId: "12345678901234" };
  assert.deepEqual(memberProfile(inMem, "IN"), inMem);
  assert.deepEqual(validateMemberProfile(inMem, "IN"), {});
  assert.deepEqual(memberProfile(inMem, "US"), {});
  assert.equal(Boolean(validateMemberProfile(inMem, "US").region), true);
});

test("GST line calculation: rates, exemptions, unconfigured items", () => {
  const lines = [
    { code: "SRV1", line: 1000 },
    { code: "SRV2", line: 500 },
    { code: "SRV3", line: 200 },
  ];
  const tariff = {
    SRV1: { gstRate: 18 },
    SRV2: { gstExempt: true },
    // SRV3 has no gstRate configured
  };

  const gst = gstForLines(lines, tariff, "IN");
  assert.equal(gst.applies, true);
  assert.equal(gst.lines.length, 2);
  assert.equal(gst.lines[0].tax, 180);
  assert.equal(gst.lines[0].gstRate, 18);
  assert.equal(gst.lines[1].tax, 0);
  assert.equal(gst.lines[1].gstExempt, true);
  assert.deepEqual(gst.unconfigured, ["SRV3"]);
  assert.equal(gst.totalTax, 180);

  // Non-IN hospital has no GST
  assert.equal(gstForLines(lines, tariff, "US").applies, false);
});

test("Devanagari transliteration maps phonetically to Latin comparison keys", () => {
  assert.equal(transliterateDevanagari("रमेश"), "ramesh");
  assert.equal(transliterateDevanagari("रमेश कुमार"), "ramesh kumar");
  assert.equal(transliterateDevanagari("लक्ष्मी"), "lakshmi");
  assert.equal(transliterateDevanagari("कमला"), "kamala");
  assert.equal(transliterateDevanagari("सीता"), "sita");
  assert.equal(transliterateDevanagari("संजय"), "sanjay");
  assert.equal(transliterateDevanagari("English"), "English");

  assert.equal(normalizeName("श्रीमती सुनीता देवी"), "sunita devi");
  assert.equal(normalizeName("डॉ. राजेश"), "rajesh");
});

test("MPI patient search matches across Devanagari and Latin", () => {
  const register = [
    { id: "p1", mrn: "1001", name: "Ramesh Kumar" },
    { id: "p2", mrn: "1002", name: "लक्ष्मी देवी" },
  ];
  const candidates1 = findCandidates({ name: "रमेश कुमार" }, register);
  assert.equal(candidates1.length > 0, true);
  assert.equal(candidates1[0].patient.id, "p1");

  const candidates2 = findCandidates({ name: "Lakshmi" }, register);
  assert.equal(candidates2.length > 0, true);
  assert.equal(candidates2[0].patient.id, "p2");
});

test("Invoices carry line tax and chargeTotal sums base plus tax", () => {
  const inv = openInvoice({
    id: "inv-1", patientId: "p1", encounterId: "enc-1", currency: "INR",
    lines: [
      { code: "C1", line: 100, taxKind: "GST", taxRate: 18, tax: 18 },
      { code: "C2", line: 200, taxKind: "GST", taxExempt: true, tax: 0 },
    ],
    actorId: "staff-1", at: new Date().toISOString(),
  });
  assert.equal(chargeTotal(inv), 318);
});

test("i18n: translation lookup, fallback, and non-translation of clinical facts", () => {
  assert.equal(t("portal.title.yours", {}, "en"), "Your record");
  assert.equal(t("portal.title.yours", {}, "hi"), "आपका रिकॉर्ड");
  assert.equal(t("portal.title.proxy", { name: "Rohan" }, "hi"), "Rohan का रिकॉर्ड");
  assert.equal(t("unknown.test.key", {}, "hi"), "unknown.test.key");
  assert.equal(Array.isArray(missingKeys("hi")), true);
});
