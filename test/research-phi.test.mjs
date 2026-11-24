/* Test suite for ResearchMD de-identification engine (research-phi.js).
 * Synthetic data only. No em or en dashes.
 * node --test test/research-phi.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import RMDPhi from "../research-phi.js";

describe("research-phi de-identification engine", () => {
  test("scan finds each required identifier kind with synthetic values", () => {
    // Dates
    const textDates = "Seen on 15/04/2026, 15-04-26, 2026-04-15, 12 March 2026, and March 12.";
    const hitsDates = RMDPhi.scan(textDates);
    const dateMatches = hitsDates.filter((h) => h.kind === "date").map((h) => h.match);
    assert.ok(dateMatches.includes("15/04/2026"), "dd/mm/yyyy date found");
    assert.ok(dateMatches.includes("15-04-26"), "dd-mm-yy date found");
    assert.ok(dateMatches.includes("2026-04-15"), "yyyy-mm-dd date found");
    assert.ok(dateMatches.includes("12 March 2026"), "dd Month yyyy date found");
    assert.ok(dateMatches.includes("March 12"), "Month dd date found");

    // Phones
    const textPhone = "Call +91 98765 43210 or 09876543210 or 9876543210.";
    const hitsPhone = RMDPhi.scan(textPhone);
    const phoneMatches = hitsPhone.filter((h) => h.kind === "phone").map((h) => h.match);
    assert.equal(phoneMatches.length, 3, "three phone matches found");
    assert.ok(phoneMatches.includes("+91 98765 43210"));
    assert.ok(phoneMatches.includes("09876543210"));
    assert.ok(phoneMatches.includes("9876543210"));

    // Email
    const textEmail = "Contact clinician at test.doctor@synthetic-hospital.org for query.";
    const hitsEmail = RMDPhi.scan(textEmail);
    const emailMatches = hitsEmail.filter((h) => h.kind === "email").map((h) => h.match);
    assert.ok(emailMatches.includes("test.doctor@synthetic-hospital.org"), "email found");

    // Aadhaar-shaped 12-digit numbers
    const textAadhaar = "ID values: 9999 8888 7777 and 111122223333.";
    const hitsAadhaar = RMDPhi.scan(textAadhaar);
    const aadhaarMatches = hitsAadhaar.filter((h) => h.kind === "aadhaar").map((h) => h.match);
    assert.ok(aadhaarMatches.includes("9999 8888 7777"), "4-4-4 Aadhaar found");
    assert.ok(aadhaarMatches.includes("111122223333"), "run of 12 Aadhaar found");

    // Hospital numbers
    const textHosp = "Records: UHID 123456, MRN: 654321, IP No 7890, CR No. 4321, Hospital No 5566.";
    const hitsHosp = RMDPhi.scan(textHosp);
    const uhidMatches = hitsHosp.filter((h) => h.kind === "uhid").map((h) => h.match);
    assert.ok(uhidMatches.some((m) => m.includes("UHID 123456")), "UHID found");
    assert.ok(uhidMatches.some((m) => m.includes("MRN: 654321")), "MRN found");
    assert.ok(uhidMatches.some((m) => m.includes("IP No 7890")), "IP No found");
    assert.ok(uhidMatches.some((m) => m.includes("CR No. 4321")), "CR No found");

    // PIN code after a place word
    const textPin = "Centres: Bengaluru 560001, PIN 500001, city 600001.";
    const hitsPin = RMDPhi.scan(textPin);
    const pinMatches = hitsPin.filter((h) => h.kind === "pin").map((h) => h.match);
    assert.ok(pinMatches.length >= 2, "PIN codes found after place words");
  });

  test("prepareCaseText converts dates to Day N and age 92 to 90 or older", () => {
    const casefile = {
      name: "Synthetic Patient",
      hospitalNumber: "UHID-999999",
      phone: "+91 98765 43210",
      address: "123 Sample Road, City",
      age: 92,
      sex: "Male",
      presentationDate: "2026-03-12",
      presentingComplaint: "Sudden onset chest pain on 12/03/2026.",
      history: "Symptoms started on 10/03/2026.",
      examination: "Blood pressure 90/60 mmHg.",
      investigations: [
        { date: "2026-03-12", test: "ECG", value: "ST changes", unit: "" },
        { date: "2026-03-15", test: "Troponin I", value: "5.3", unit: "ng/mL" }
      ],
      diagnosis: "Toxic myocarditis.",
      treatment: "Supportive care.",
      outcome: "Discharged on 20/03/2026 in stable condition."
    };

    const res = RMDPhi.prepareCaseText(casefile);
    // Allowlist removes name, hospitalNumber, phone, address
    assert.ok(res.removed.some((r) => r.field === "name"), "name removed");
    assert.ok(res.removed.some((r) => r.field === "hospitalNumber"), "hospital number removed");
    assert.ok(res.removed.some((r) => r.field === "phone"), "phone removed");
    assert.ok(res.removed.some((r) => r.field === "address"), "address removed");

    // Age 92 becomes 90 or older
    assert.ok(res.text.includes("90 or older"), "age 92 converted to 90 or older");
    assert.ok(!res.text.includes("Age 92"), "Age 92 is not present");

    // Dates become Day N from 2026-03-12 (Day 0)
    assert.ok(res.text.includes("Day 0"), "first presentation is Day 0");
    assert.ok(res.text.includes("Day 3"), "2026-03-15 becomes Day 3");
    assert.ok(res.text.includes("Day -2"), "2026-03-10 becomes Day -2");
    assert.ok(res.text.includes("Day 8"), "2026-03-20 becomes Day 8");

    // Clean text has no scan hits and is not blocked
    assert.equal(res.blocked, false, "prepared case text is not blocked");
    assert.equal(res.findings.length, 0, "no scan findings on clean prepared text");
  });

  test("prepareCaseText marks blocked true when text has an identifier hit", () => {
    const casefileWithPlantedPhone = {
      age: 45,
      sex: "Female",
      presentationDate: "2026-03-12",
      presentingComplaint: "Patient contacted helpline at 9876543210 after ingestion."
    };

    const res = RMDPhi.prepareCaseText(casefileWithPlantedPhone);
    assert.equal(res.blocked, true, "blocked is true when identifier present");
    assert.ok(res.findings.some((f) => f.includes("phone")), "phone finding flagged");
  });

  test("numbersNotIn flags 5.8 when source has 5.3 and treats 5.30 equal to 5.3", () => {
    const sourceText = "Troponin level was 5.3 ng/mL on Day 1. Potassium 4.5. Heart rate 88.";
    const draftText = "Troponin peaked at 5.30 ng/mL on Day 1. Later potassium was 5.8 mEq/L.";

    const missing = RMDPhi.numbersNotIn(draftText, sourceText);
    assert.ok(missing.includes("5.8"), "flags 5.8 as missing from source");
    assert.ok(!missing.includes("5.30"), "does not flag 5.30 because 5.3 is in source");
    assert.ok(!missing.includes("1"), "does not flag 1 because 1 is in source");
  });
});
