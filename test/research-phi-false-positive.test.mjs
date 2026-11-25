/* Test suite for false-positive prevention across all PHI layers.
 * Covers:
 * - Negative clinical corpus (at least 60 sentences with NO identifiers)
 * - Positive identifier corpus (20 synthetic identifiers)
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi-false-positive.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import RMDPhi from "../research-phi.js";

// Lift redactPHI from reasoning.js and wire phi-india.js exactly as done on device
const REASONING_SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const REDACT_FN_BODY = REASONING_SRC.slice(
  REASONING_SRC.indexOf("  function redactPHI(text) {"),
  REASONING_SRC.indexOf("  window.SMD_redactPHI = redactPHI;")
);

const PI_SRC = readFileSync(new URL("../phi-india.js", import.meta.url), "utf8");
const indiaApi = new Function("module", "localStorage", PI_SRC + "; return module.exports;")({ exports: {} }, { getItem: () => null });
indiaApi.enabled = () => true;

const redactPHI = new Function("window", REDACT_FN_BODY + "; return redactPHI;")({ SMD_PHI_INDIA: indiaApi });

// Lift hasPhiInQuery from functions/api/research/_auto_studies.js
const AUTO_SRC = readFileSync(new URL("../functions/api/research/_auto_studies.js", import.meta.url), "utf8");
const HAS_PHI_FN_BODY = AUTO_SRC.slice(
  AUTO_SRC.indexOf("function hasPhiInQuery(q) {"),
  AUTO_SRC.indexOf("export async function findStudies")
);
const hasPhiInQuery = new Function("return " + HAS_PHI_FN_BODY)();

describe("False-positive prevention across all PHI layers", () => {
  const CLINICAL_CORPUS = [
    // 7 review sentences
    "Creatinine 1.2 mg/dL",
    "Regular rhythm",
    "Hospital stay was 5 days",
    "Operation was uneventful",
    "Opioid analgesia",
    "Crepitations heard",
    "Ipsilateral weakness",

    // Lab, diagnostic, and clinical term sentences
    "Creatinine 1.2",
    "CRP 48 mg/L",
    "CR 1.4",
    "IP joint swelling",
    "OP poisoning",
    "Operated on Day 3",
    "Regimen changed",
    "Hospital course",
    "Hosp stay 5 days",
    "Opd follow up advised",
    "Ipratropium nebulisation",
    "Crohn disease",
    "Reg ular rhythm noted on monitor",
    "May be due to sepsis",
    "March of disease",
    "Day 3",
    "12 hours",
    "2 mg/kg",
    "BP 90/60",
    "pH 7.32",
    "HbA1c 6.5%",
    "troponin 5.3 ng/mL",
    "K 3.2",
    "Na 138",
    "SpO2 92%",
    "GCS 15/15",
    "1.5 L/min",
    "T2 hyperintense",
    "C5-C6 disc",
    "L4-L5",
    "G6PD deficiency",
    "BRCA1",
    "HLA-B27",
    "CD4 count 200",
    "IgG4",
    "ECOG 2",
    "NYHA class III",
    "grade 3/6 murmur",
    "2.5 x 3.0 cm lesion",
    "10 to 12 per hpf",
    "INR 1.2",
    "eGFR 45",
    "1 in 10,000",
    "WHO 2021 classification",
    "ICD-10 K35.8",

    // Search query phrases
    "PMID 12345678",
    "case series 2015 to 2024",

    // Additional ordinary clinical sentences to exceed 60
    "Patient presented with acute onset shortness of breath.",
    "Bilateral breath sounds equal with vesicular character.",
    "Abdomen soft non-tender without palpable organomegaly.",
    "Pupils equal round and reactive to light bilaterally.",
    "Serum albumin 3.8 g/dL and total bilirubin 0.8 mg/dL.",
    "Platelet count 250,000 per microliter.",
    "White blood cell count 8,500 cells per cubic millimeter.",
    "Electrocardiogram showed sinus rhythm with normal axis.",
    "Chest radiograph showed clear lung fields without consolidation.",
    "Empiric antibiotics initiated with ceftriaxone 2 g IV once daily.",
    "Serial neurological examinations remained completely unchanged.",
    "Urine output maintained at greater than 0.5 mL/kg/h.",
    "Patient tolerated oral intake well on subsequent evaluation.",
    "Discharged home with advice for lifestyle modification.",
    "Surgical incision clean and dry without erythema or discharge.",
    "Follow up in surgical outpatient department recommended in two weeks."
  ];

  test("negative corpus has at least 60 distinct clinical sentences", () => {
    assert.ok(CLINICAL_CORPUS.length >= 60, "Corpus length: " + CLINICAL_CORPUS.length);
  });

  test("RMDPhi.scan flags 0 hits across all clinical sentences", () => {
    for (const sentence of CLINICAL_CORPUS) {
      const hits = RMDPhi.scan(sentence);
      assert.equal(hits.length, 0, "scan() unexpectedly flagged: " + sentence + " => " + JSON.stringify(hits));
    }
  });

  test("RMDPhi.prepareCaseText does not block any clinical sentence", () => {
    for (const sentence of CLINICAL_CORPUS) {
      const resObj = RMDPhi.prepareCaseText({ presentingComplaint: sentence });
      assert.equal(resObj.blocked, false, "prepareCaseText({ presentingComplaint }) blocked: " + sentence + " findings: " + JSON.stringify(resObj.findings));
      assert.equal(resObj.findings.length, 0, "prepareCaseText has unexpected findings for: " + sentence);

      const resStr = RMDPhi.prepareCaseText(sentence);
      assert.equal(resStr.blocked, false, "prepareCaseText(string) blocked: " + sentence + " findings: " + JSON.stringify(resStr.findings));
      assert.equal(resStr.findings.length, 0, "prepareCaseText string findings for: " + sentence);
    }
  });

  test("SMD_redactPHI leaves clinical sentences completely untouched (output === input)", () => {
    for (const sentence of CLINICAL_CORPUS) {
      const redacted = redactPHI(sentence);
      assert.equal(redacted, sentence, "SMD_redactPHI altered: " + sentence + " => " + redacted);
    }
  });

  test("hasPhiInQuery returns false for all clinical and search sentences", () => {
    for (const sentence of CLINICAL_CORPUS) {
      const hasPhi = hasPhiInQuery(sentence);
      assert.equal(hasPhi, false, "hasPhiInQuery returned true for: " + sentence);
    }
  });

  const POSITIVE_CORPUS = [
    // 10 identifier examples from review
    "OP No 482910",
    "OPD No: 12345",
    "IP No 2026/1234",
    "CR No 778899",
    "UHID ABC12345",
    "MRN 00123",
    "Reg no 4567",
    "Hospital number 8899",
    "Hosp No 1234",
    "Registration number 2026-55",

    // Dates, phones, Aadhaar, email
    "14.08.2025",
    "12th March 2026",
    "12-Mar-2026",
    "044-24567890",
    "(080) 2654 3210",
    "98765.43210",
    "+91 98765 43210",
    "1234 5678 9012",
    "XXXX XXXX 1234",
    "name@example.com"
  ];

  test("positive corpus: every identifier is flagged by scan()", () => {
    for (const item of POSITIVE_CORPUS) {
      const hits = RMDPhi.scan(item);
      assert.ok(hits.length > 0, "scan() missed identifier: " + item);
    }
  });

  test("positive corpus: every identifier is blocked by prepareCaseText()", () => {
    for (const item of POSITIVE_CORPUS) {
      const resStr = RMDPhi.prepareCaseText(item);
      assert.equal(resStr.blocked, true, "prepareCaseText(string) failed to block: " + item);
      assert.ok(resStr.findings.length > 0, "prepareCaseText(string) has no findings for: " + item);

      const resObj = RMDPhi.prepareCaseText({ presentingComplaint: item });
      assert.equal(resObj.blocked, true, "prepareCaseText(obj) failed to block: " + item);
      assert.ok(resObj.findings.length > 0, "prepareCaseText(obj) has no findings for: " + item);
    }
  });

  test("positive corpus: every identifier is altered by SMD_redactPHI()", () => {
    for (const item of POSITIVE_CORPUS) {
      const redacted = redactPHI(item);
      assert.notEqual(redacted, item, "SMD_redactPHI failed to redact: " + item);
    }
  });

  test("positive corpus: every identifier is flagged by hasPhiInQuery()", () => {
    for (const item of POSITIVE_CORPUS) {
      const hasPhi = hasPhiInQuery(item);
      assert.equal(hasPhi, true, "hasPhiInQuery failed to flag: " + item);
    }
  });
});
