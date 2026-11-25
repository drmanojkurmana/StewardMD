/* Test suite for multi-layer PHI de-identification and privacy defenses.
 * Covers:
 * - Review finding 1: dates (shared regex), phones, labels, Aadhaar variants
 * - Review finding 2: second layer in prepareCaseText, redactPHI gaps, clinical values negative list
 * - Novelty query sanitization and findStudies phi_in_query rejection
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi-layers.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import RMDPhi from "../research-phi.js";
import { findStudies } from "../functions/api/research/_auto_studies.js";

const require = createRequire(import.meta.url);
const PI = require("../phi-india.js");

// Lift the exact redactPHI from reasoning.js as loaded in the mobile app bundle
const REASONING_SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const REDACT_FN_BODY = REASONING_SRC.slice(
  REASONING_SRC.indexOf("  function redactPHI(text) {"),
  REASONING_SRC.indexOf("  window.SMD_redactPHI = redactPHI;")
);

function createRedactPHI() {
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  const indiaApi = new Function(
    "module",
    "localStorage",
    readFileSync(new URL("../phi-india.js", import.meta.url), "utf8") + "; return module.exports;"
  )({ exports: {} }, localStorage);
  indiaApi.enabled = () => true;

  const sandbox = {
    SMD_PHI_INDIA: indiaApi,
    redactPHI: null
  };
  return new Function("window", REDACT_FN_BODY + "; return redactPHI;")(sandbox);
}

const redactPHI = createRedactPHI();

describe("Finding 1: Identifier recognition in research-phi.js", () => {
  test("all date patterns from Qwen and Gemini reviews are scanned", () => {
    const dates = [
      "12.03.2026",
      "14.08.2025",
      "12.03.26",
      "2.3.2026",
      "12-Mar-2026",
      "14-Aug-2025",
      "12-Mar-26",
      "12th March 2026",
      "March 12",
      "Aug 14, 2025",
      "14 Aug 2025",
      "March 2026",
      "Mar 2026",
      "2026/03/12",
      "2025-08-14",
      "2026-03-12",
      "12/03/2026",
      "14/08/2025"
    ];

    for (const d of dates) {
      const hits = RMDPhi.scan("Patient evaluated on " + d + " during morning rounds.");
      const dateHits = hits.filter((h) => h.kind === "date");
      assert.ok(dateHits.length >= 1, "Expected date scan hit for: " + d);
    }
  });

  test("all phone patterns from Qwen and Gemini reviews are scanned", () => {
    const phones = [
      "98765.43210",
      "098765 43210",
      "+91 98765 43210",
      "+91 9876543210",
      "9876543210",
      "98765-43210",
      "098765-43210",
      "(080) 2654 3210",
      "080-26543210",
      "080 2654 3210",
      "044-24567890",
      "080-23456789",
      "(080) 23456789"
    ];

    for (const p of phones) {
      const hits = RMDPhi.scan("Emergency contact: " + p + " documented.");
      const phoneHits = hits.filter((h) => h.kind === "phone");
      assert.ok(phoneHits.length >= 1, "Expected phone scan hit for: " + p);
    }
  });

  test("all identification labels from Qwen and Gemini reviews are scanned", () => {
    const labels = [
      "hospital number 445566",
      "Hospital No: 67890",
      "hosp no 445566",
      "UHID 123456",
      "UHID: 12345",
      "MRN 654321",
      "IP no 7890",
      "IPD: 9988",
      "OP no 482910",
      "OPD no 123456",
      "CR no 4321",
      "CR No: 54321",
      "Reg no 445566",
      "Registration number 445566"
    ];

    for (const lbl of labels) {
      const hits = RMDPhi.scan("Admitted under " + lbl + " on service.");
      const uhidHits = hits.filter((h) => h.kind === "uhid");
      assert.ok(uhidHits.length >= 1, "Expected UHID scan hit for label: " + lbl);
    }
  });

  test("Aadhaar 12-digit, 4-4-4, masked, and labelled variants are scanned", () => {
    const aadhaarList = [
      "9999 8888 7777",
      "1234 5678 9012",
      "111122223333",
      "XXXX XXXX 1234",
      "XXXX-XXXX-1234",
      "Aadhaar: 1234 5678 9012",
      "Aadhaar: 1234-5678-9012",
      "Aadhaar 1234 5678 9012"
    ];

    for (const a of aadhaarList) {
      const hits = RMDPhi.scan("Identity record " + a + " verified.");
      const aadhaarHits = hits.filter((h) => h.kind === "aadhaar" || h.kind === "uhid");
      assert.ok(aadhaarHits.length >= 1, "Expected scan hit for Aadhaar variant: " + a);
    }
  });

  test("replaceDatesWithDayN converts all date formats using shared date regex", () => {
    const sampleDates = [
      "12.03.2026",
      "14.08.2025",
      "12-Mar-2026",
      "12th March 2026",
      "2026-03-12",
      "12/03/2026"
    ];

    const baseDate = new Date("2026-03-12T00:00:00Z");
    for (const d of sampleDates) {
      const replaced = RMDPhi.replaceDatesWithDayN("Patient seen on " + d + ".", baseDate);
      assert.match(replaced, /Day -?\d+/, "Expected Day N replacement for " + d);
      assert.doesNotMatch(replaced, new RegExp(d.replace(/\./g, "\\.")), "Raw date string should be replaced");
    }
  });
});

describe("Finding 2: Negative clinical list and redactPHI defenses", () => {
  const CLINICAL_VALUES = [
    "troponin 5.3 ng/mL",
    "K 3.2",
    "BP 90/60",
    "Na 138",
    "pH 7.32",
    "HbA1c 6.5%",
    "2 mg/kg",
    "Day 3",
    "12 hours"
  ];

  test("clinical values negative list is never flagged as PHI by scan()", () => {
    for (const val of CLINICAL_VALUES) {
      const hits = RMDPhi.scan("Lab parameter recorded as " + val + " during stay.");
      assert.equal(hits.length, 0, "Clinical value flagged as PHI: " + val);
    }
  });

  test("clinical values negative list survives redactPHI unchanged", () => {
    for (const val of CLINICAL_VALUES) {
      const result = redactPHI("Assessment reveals " + val + ".");
      assert.ok(result.includes(val), "Clinical value was altered by redactPHI: " + val);
    }
  });

  test("clinical values survive prepareCaseText unblocked", () => {
    const caseObj = {
      age: 45,
      sex: "Male",
      presentingComplaint: "Chest pain and dyspnea for 12 hours.",
      history: "Blood pressure was BP 90/60 with K 3.2 and Na 138.",
      examination: "Cardiac exam normal. Arterial blood gas showed pH 7.32.",
      investigations: [
        { date: "Day 0", test: "troponin 5.3 ng/mL", value: "elevated", unit: "" },
        { date: "Day 1", test: "HbA1c 6.5%", value: "normal", unit: "" }
      ],
      diagnosis: "Toxic myocarditis",
      treatment: "Administered antidote at 2 mg/kg.",
      outcome: "Discharged on Day 3 in stable condition.",
      unusual: "Clinical course completed in 12 hours."
    };

    const res = RMDPhi.prepareCaseText(caseObj, {});
    assert.equal(res.blocked, false, "Clinical case should not be blocked: " + JSON.stringify(res.findings));
    assert.equal(res.findings.length, 0, "No findings expected for clean clinical case");
    for (const val of CLINICAL_VALUES) {
      assert.ok(res.text.includes(val), "Clean clinical value must survive in text: " + val);
    }
  });

  test("redactPHI gaps: hospital number, dd-Mon-yyyy, ordinal dates, dotted mobiles, (STD) landlines", () => {
    // Hospital number
    assert.match(redactPHI("Case hospital number 445566 reviewed"), /hospital number:?\s*\[redacted\]/i);

    // dd-Mon-yyyy and ordinal dates
    assert.match(redactPHI("Seen on 12-Mar-2026 in clinic"), /\[(?:date|redacted)\]/);
    assert.doesNotMatch(redactPHI("Seen on 12-Mar-2026 in clinic"), /12-Mar-2026/);
    assert.match(redactPHI("Event on 12th March 2026 noted"), /\[(?:date|redacted)\]/);
    assert.doesNotMatch(redactPHI("Event on 12th March 2026 noted"), /12th March 2026/);

    // Dotted mobile
    assert.match(redactPHI("Contact 98765.43210 immediately"), /\[redacted\]/);
    assert.doesNotMatch(redactPHI("Contact 98765.43210 immediately"), /98765\.43210/);

    // STD landline
    assert.match(redactPHI("Call (080) 2654 3210 for records"), /\[redacted\]/);
    assert.doesNotMatch(redactPHI("Call (080) 2654 3210 for records"), /2654\s*3210/);
    assert.match(redactPHI("Desk phone 080-26543210 active"), /\[redacted\]/);
    assert.doesNotMatch(redactPHI("Desk phone 080-26543210 active"), /26543210/);
  });

  test("Aadhaar leak fix: Aadhaar 1234 5678 9012 redacts all 12 digits", () => {
    const input = "Aadhaar 1234 5678 9012 on file";
    const redacted = redactPHI(input);
    assert.doesNotMatch(redacted, /1234/, "First 4 digits must not leak");
    assert.doesNotMatch(redacted, /5678/, "Middle 4 digits must not leak");
    assert.doesNotMatch(redacted, /9012/, "Last 4 digits must not leak");
    assert.equal(redacted, "Aadhaar: [redacted] on file");
  });

  test("second layer in prepareCaseText runs window.SMD_redactPHI and blocks on changes", () => {
    const originalWindow = globalThis.window;
    try {
      globalThis.window = {
        SMD_redactPHI: redactPHI
      };

      // Input containing an identifier that triggers redaction (e.g., hospital number)
      const dirtyCase = {
        age: 34,
        sex: "Male",
        presentingComplaint: "Abdominal pain",
        history: "Patient with hospital number 445566 admitted.",
        examination: "Abdomen soft.",
        investigations: [],
        diagnosis: "Gastritis",
        treatment: "Antacids",
        outcome: "Discharged",
        unusual: "None"
      };

      const res = RMDPhi.prepareCaseText(dirtyCase, {});
      assert.equal(res.blocked, true, "prepareCaseText must block when SMD_redactPHI modifies text");
      assert.ok(res.findings.length >= 1, "Findings should report the blocked identifier");
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

describe("Novelty & Server: findStudies query scrubbing", () => {
  const mockCtx = {
    env: { RESEARCH_CONTACT_EMAIL: "synthetic-research@hospital.org" },
    db: {},
    uid: "usr_synthetic_1",
    requestId: "req_synthetic_1",
    api: {
      json: (data) => ({ status: 200, data }),
      err: (status, code, message, reqId) => ({ status, error: { code, message, requestId: reqId } }),
      projectGate: async () => ({ role: "owner" }),
      gateErr: () => {}
    }
  };

  test("findStudies rejects query with phone number (400 phi_in_query)", async () => {
    const res = await findStudies(mockCtx, "prj_1", { q: "phosphide poisoning phone 98765.43210" });
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "phi_in_query");
    assert.match(res.error.message, /personal identifiers/i);
  });

  test("findStudies rejects query with email address (400 phi_in_query)", async () => {
    const res = await findStudies(mockCtx, "prj_1", { q: "phosphide poisoning doctor@synthetic.org" });
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "phi_in_query");
  });

  test("findStudies rejects query with 12-digit number (400 phi_in_query)", async () => {
    const res = await findStudies(mockCtx, "prj_1", { q: "phosphide poisoning 123456789012" });
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "phi_in_query");
  });

  test("findStudies rejects query with dd/mm/yyyy date (400 phi_in_query)", async () => {
    const res = await findStudies(mockCtx, "prj_1", { q: "phosphide poisoning 12/03/2026" });
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "phi_in_query");
  });

  test("findStudies rejects query with dotted date (400 phi_in_query)", async () => {
    const res = await findStudies(mockCtx, "prj_1", { q: "phosphide poisoning 14.08.2025" });
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "phi_in_query");
  });

  test("findStudies rejects query with hospital id label (400 phi_in_query)", async () => {
    const res = await findStudies(mockCtx, "prj_1", { q: "phosphide poisoning hospital number 445566" });
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "phi_in_query");
  });

  test("findStudies allows clean medical search query", async () => {
    // With env.RESEARCH_CONTACT_EMAIL unconfigured, clean query passes the PHI gate and reaches network config
    const unconfiguredCtx = {
      ...mockCtx,
      env: {} // no email configured
    };
    const res = await findStudies(unconfiguredCtx, "prj_1", { q: "zinc phosphide myocardial injury" });
    // The query passed the PHI gate and failed later on search_unconfigured
    assert.notEqual(res.error?.code, "phi_in_query", "Clean query must not be rejected as phi_in_query");
    assert.equal(res.status, 503);
    assert.equal(res.error.code, "search_unconfigured");
  });
});
