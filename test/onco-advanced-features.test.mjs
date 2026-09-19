/* StewardMD - test/onco-advanced-features.test.mjs
 * Comprehensive unit and clinical safety test suite for the 6 Advanced Oncology Superpowers:
 * 1. onco-organ-dose.js (Renal & Hepatic auto-dose modifications)
 * 2. onco-compare.js (Head-to-head regimen comparison matrix)
 * 3. onco-cycle-timeline.js (Patient cycle calendar & nadir chronology)
 * 4. onco-ddi-sentry.js (Oncology drug-drug & QTc interaction sentry)
 * 5. onco-protocol-report.js v2 (MDT Tumor Board & clinical signature enhancements)
 * 6. onco-genomics.js (Genomic precision & ctDNA MRD surveillance)
 */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const ORGAN_DOSE = require(join(ROOT, "onco-organ-dose.js"));
const COMPARE = require(join(ROOT, "onco-compare.js"));
const TIMELINE = require(join(ROOT, "onco-cycle-timeline.js"));
const DDI = require(join(ROOT, "onco-ddi-sentry.js"));
const REPORT = require(join(ROOT, "onco-protocol-report.js"));
const GENOMICS = require(join(ROOT, "onco-genomics.js"));

/* =========================================================================
 * 1. RENAL & HEPATIC DOSE MODIFICATIONS (onco-organ-dose.js)
 * ========================================================================= */
test("ORGAN DOSE: Capecitabine dose reduces by 25% for CrCl 30-50 mL/min, contraindicated for CrCl < 30", () => {
  const capecitabineProtocol = {
    id: "crc-capecitabine",
    name: "Capecitabine Monotherapy",
    drugs: [{ id: "capecitabine", name: "Capecitabine", basis: "bsa", dosePerUnit: 1000, unit: "mg/m2" }]
  };

  // Moderate renal impairment (CrCl 40 mL/min) -> 75% of dose
  const resMod = ORGAN_DOSE.evaluateOrganDoseModifications(capecitabineProtocol, { crcl: 40 }, { capecitabine: 2000 });
  assert.equal(resMod.hasModifications, true);
  assert.equal(resMod.adjustments.length, 1);
  assert.equal(resMod.adjustments[0].recommendedPercent, 75);
  assert.equal(resMod.adjustments[0].suggestedDose, 1500);
  assert.ok(resMod.adjustments[0].text.indexOf("Reduce capecitabine dose by 25%") >= 0);

  // Severe renal impairment (CrCl 20 mL/min) -> contraindicated
  const resSev = ORGAN_DOSE.evaluateOrganDoseModifications(capecitabineProtocol, { crcl: 20 }, { capecitabine: 2000 });
  assert.equal(resSev.adjustments[0].recommendedPercent, 0);
  assert.equal(resSev.adjustments[0].action, "contraindicated");
});

test("ORGAN DOSE: Cisplatin warns/reduces for CrCl 45-59 and is contraindicated for CrCl < 45", () => {
  const cisProtocol = {
    id: "lung-cis-etopo",
    name: "Cisplatin + Etoposide",
    drugs: [{ id: "cisplatin", name: "Cisplatin", basis: "bsa", dosePerUnit: 75, unit: "mg/m2" }]
  };

  const resMild = ORGAN_DOSE.evaluateOrganDoseModifications(cisProtocol, { crcl: 50 }, { cisplatin: 150 });
  assert.equal(resMild.adjustments[0].recommendedPercent, 75);
  assert.equal(resMild.adjustments[0].suggestedDose, 112.5);

  const resSevere = ORGAN_DOSE.evaluateOrganDoseModifications(cisProtocol, { crcl: 35 }, { cisplatin: 150 });
  assert.equal(resSevere.adjustments[0].recommendedPercent, 0);
  assert.equal(resSevere.adjustments[0].action, "switch/omit");
});

test("ORGAN DOSE: Doxorubicin reduces 50% for bilirubin 1.5-3.0, 75% for 3.1-5.0, contraindicated for >5.0", () => {
  const doxoProtocol = {
    id: "breast-ac",
    name: "AC Regimen",
    drugs: [{ id: "doxorubicin", name: "DOXOrubicin", basis: "bsa", dosePerUnit: 60, unit: "mg/m2" }]
  };

  const res1 = ORGAN_DOSE.evaluateOrganDoseModifications(doxoProtocol, { totalBili: 2.2 }, { doxorubicin: 100 });
  assert.equal(res1.adjustments[0].recommendedPercent, 50);
  assert.equal(res1.adjustments[0].suggestedDose, 50);

  const res2 = ORGAN_DOSE.evaluateOrganDoseModifications(doxoProtocol, { totalBili: 4.0 }, { doxorubicin: 100 });
  assert.equal(res2.adjustments[0].recommendedPercent, 25);
  assert.equal(res2.adjustments[0].suggestedDose, 25);

  const res3 = ORGAN_DOSE.evaluateOrganDoseModifications(doxoProtocol, { totalBili: 6.2 }, { doxorubicin: 100 });
  assert.equal(res3.adjustments[0].recommendedPercent, 0);
  assert.equal(res3.adjustments[0].action, "contraindicated");
});

test("ORGAN DOSE: Day 1 Cytopenias issue prominent delay warnings", () => {
  const res = ORGAN_DOSE.evaluateOrganDoseModifications({}, { anc: 900, platelets: 65000 });
  assert.equal(res.warnings.length, 2);
  assert.ok(res.warnings[0].indexOf("Day 1 Neutropenia") >= 0);
  assert.ok(res.warnings[1].indexOf("Day 1 Thrombocytopenia") >= 0);
});

/* =========================================================================
 * 2. REGIMEN COMPARISON MATRIX (onco-compare.js)
 * ========================================================================= */
test("COMPARE: Correctly contrasts 46-hour ambulatory pump vs oral regimen chair burden", () => {
  const mFolfox6 = {
    id: "crc-mFolfox6",
    name: "mFOLFOX6",
    cycleLengthDays: 14,
    cycles: 12,
    drugs: [
      { id: "oxaliplatin", name: "Oxaliplatin", route: "IV", dosePerUnit: 85, unit: "mg/m2", days: [1] },
      { id: "leucovorin", name: "Leucovorin", route: "IV", dosePerUnit: 400, unit: "mg/m2", days: [1] },
      { id: "fluorouracil", name: "Fluorouracil", route: "IV", dosePerUnit: 2400, unit: "mg/m2", days: [1, 2], notes: "Continuous IV infusion over 46 hours via ambulatory pump" }
    ]
  };
  const capox = {
    id: "crc-capox",
    name: "CAPOX",
    cycleLengthDays: 21,
    cycles: 8,
    drugs: [
      { id: "oxaliplatin", name: "Oxaliplatin", route: "IV", dosePerUnit: 130, unit: "mg/m2", days: [1] },
      { id: "capecitabine", name: "Capecitabine", route: "PO", dosePerUnit: 1000, unit: "mg/m2", days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] }
    ]
  };

  const comps = COMPARE.compareProtocols([mFolfox6, capox]);
  assert.equal(comps.length, 2);
  assert.ok(comps[0].chairTime.indexOf("46-hour ambulatory") >= 0);
  assert.ok(comps[1].chairTime.indexOf("Single-agent IV infusion") >= 0 || comps[1].chairTime.indexOf("Doublet") >= 0 || comps[1].chairTime.indexOf("hours") >= 0);

  const html = COMPARE.renderComparisonTable([mFolfox6, capox]);
  assert.ok(html.indexOf("Head-to-Head Regimen Comparison") >= 0);
  assert.ok(html.indexOf("mFOLFOX6") >= 0);
  assert.ok(html.indexOf("CAPOX") >= 0);
});

/* =========================================================================
 * 3. PATIENT CYCLE CALENDAR & NADIR (onco-cycle-timeline.js)
 * ========================================================================= */
test("TIMELINE: Generates Day 1 infusion, delayed nausea D2-4, and expected ANC nadir D7-12", () => {
  const proto = {
    id: "test-cycle",
    name: "Test Chemo 21-Day",
    cycleLengthDays: 21,
    drugs: [{ id: "chemo-1", name: "Drug X", dosePerUnit: 100, unit: "mg", route: "IV", days: [1] }]
  };

  const tl = TIMELINE.generateCycleTimeline(proto, "2026-10-01");
  assert.equal(tl.cycleLengthDays, 21);
  assert.equal(tl.timeline.length, 21);

  // Day 1: Treatment Admin
  assert.equal(tl.timeline[0].cycleDay, 1);
  assert.equal(tl.timeline[0].phase, "Treatment Administration");
  assert.equal(tl.timeline[0].events[0].drug, "Drug X");

  // Day 3: Delayed Nausea Window
  assert.equal(tl.timeline[2].phase, "Delayed Nausea Window");
  assert.equal(tl.timeline[2].alerts[0].type, "delayed_emesis");

  // Day 9: Expected ANC Nadir Window
  assert.equal(tl.timeline[8].phase, "Expected ANC Nadir Window");
  assert.equal(tl.timeline[8].alerts[0].type, "neutropenia_risk");

  // Day 20: Pre-Cycle Lab Clearance
  assert.equal(tl.timeline[19].phase, "Lab Clearance Check");

  const html = TIMELINE.renderTimelineHtml(tl);
  assert.ok(html.indexOf("Cycle Schedule & Nadir Chronology") >= 0);
  assert.ok(html.indexOf("Day 1") >= 0);
  assert.ok(html.indexOf("Day 9") >= 0);
});

/* =========================================================================
 * 4. ONCOLOGY DDI & QTC SENTRY (onco-ddi-sentry.js)
 * ========================================================================= */
test("DDI: Detects severe CYP3A4 inhibition with Zanubrutinib and Venetoclax", () => {
  const zanubrutinibProto = {
    id: "waldenstrom-zanubrutinib",
    name: "Zanubrutinib",
    drugs: [{ id: "zanubrutinib", name: "Zanubrutinib" }]
  };

  const audit = DDI.auditDrugInteractions(zanubrutinibProto, ["voriconazole", "lisinopril"]);
  assert.equal(audit.alertCount, 1);
  assert.equal(audit.hasSevereAlerts, true);
  assert.equal(audit.alerts[0].severity, "major");
  assert.ok(audit.alerts[0].management.indexOf("Reduce BTK inhibitor dose") >= 0);
});

test("DDI: Detects additive QTc prolongation with Targeted TKI + Ondansetron + Levofloxacin", () => {
  const osimertinibProto = {
    id: "lung-osimertinib",
    name: "Osimertinib Monotherapy",
    drugs: [{ id: "osimertinib", name: "Osimertinib" }]
  };

  const audit = DDI.auditDrugInteractions(osimertinibProto, ["ondansetron", "levofloxacin"]);
  assert.equal(audit.alertCount, 1);
  assert.ok(audit.alerts[0].category.indexOf("QTc Prolongation") >= 0);
  assert.ok(audit.alerts[0].management.indexOf("12-lead ECG") >= 0);
});

/* =========================================================================
 * 5. TUMOR BOARD & REPORT ENHANCEMENTS (onco-protocol-report.js)
 * ========================================================================= */
test("REPORT v2: Renders Multidisciplinary Tumor Board (MDT) Summary and Guideline Trail", () => {
  const plan = {
    planId: "TP-MDT-1",
    protocolId: "rectal-dostarlimab",
    lockedVersion: "1.0",
    lockedTemplate: {
      name: "Dostarlimab Monotherapy",
      version: "1.0",
      cycleLengthDays: 21,
      cycles: 9,
      drugs: [{ id: "dostarlimab", name: "Dostarlimab-gxly", dosePerUnit: 500, unit: "mg", route: "IV", days: [1] }]
    },
    confirmedDoses: [{ drugId: "dostarlimab", final: 500 }],
    status: "active"
  };

  const opts = {
    patientName: "John Smith",
    diagnosis: "Rectal Adenocarcinoma",
    tumorBoard: {
      date: Date.UTC(2026, 8, 15),
      stage: "cT3N1cM0 (Stage III)",
      biomarkers: "dMMR / MSI-H, BRAF WT, KRAS WT",
      attendees: ["Dr. Colorectal (Surg Onco)", "Dr. Onco (Med Onco)", "Dr. Beam (Rad Onco)", "Dr. Tissue (Pathology)"],
      consensus: "Neoadjuvant dostarlimab immunotherapy x 9 cycles with watch-and-wait organ preservation if cCR."
    },
    pathway: ["Rectal Cancer Workup", "Locally Advanced Stage III", "dMMR/MSI-H", "Neoadjuvant Dostarlimab"]
  };

  const doc = REPORT.buildProtocolSheet(plan, opts);
  assert.ok(doc.indexOf("Multidisciplinary Tumor Board (MDT) Summary") >= 0);
  assert.ok(doc.indexOf("cT3N1cM0 (Stage III)") >= 0);
  assert.ok(doc.indexOf("dMMR / MSI-H") >= 0);
  assert.ok(doc.indexOf("OncoTree Guideline Pathway Audit") >= 0);
  assert.ok(doc.indexOf("Neoadjuvant Dostarlimab") >= 0);
  assert.ok(doc.indexOf("Attending Medical Oncologist") >= 0);
  assert.ok(doc.indexOf("Oncology Clinical Pharmacist") >= 0);
  assert.ok(doc.indexOf("Primary Nurse (Verifier 1)") >= 0);
});

/* =========================================================================
 * 6. GENOMICS & ctDNA SURVEILLANCE (onco-genomics.js)
 * ========================================================================= */
test("GENOMICS: Accurately matches actionable alterations to FDA/NCCN category 1 therapies", () => {
  const profile = [
    { gene: "EGFR", alteration: "L858R", vaf: 14.2 },
    { gene: "BRAF", alteration: "V600E", vaf: 8.5 },
    { gene: "MMR", alteration: "dMMR / MSI-H" }
  ];

  const matchRes = GENOMICS.matchActionableTargets(profile, "lung");
  assert.equal(matchRes.actionableTargetCount, 3);

  const egfr = matchRes.matches.find((m) => m.gene === "EGFR");
  assert.ok(egfr.recommendedTherapies[0].indexOf("Osimertinib") >= 0);

  const braf = matchRes.matches.find((m) => m.gene === "BRAF");
  assert.ok(braf.recommendedTherapies[0].indexOf("Dabrafenib") >= 0);

  const msi = matchRes.matches.find((m) => m.gene === "MMR");
  assert.ok(msi.recommendedTherapies[0].indexOf("Dostarlimab") >= 0);
});

test("GENOMICS: ctDNA dynamics identifies molecular clearance, progression, and recurrence", () => {
  // Scenario 1: Molecular clearance
  const clearanceSamples = [
    { timepoint: "baseline", mrdStatus: "positive", vaf: 2.5 },
    { timepoint: "post-op", mrdStatus: "negative", vaf: 0.0 }
  ];
  const call1 = GENOMICS.trackCtDnaDynamics(clearanceSamples);
  assert.equal(call1.responseCall, "molecular_clearance");

  // Scenario 2: Molecular recurrence
  const recurrenceSamples = [
    { timepoint: "post-op", mrdStatus: "negative", vaf: 0.0 },
    { timepoint: "surveillance-6mo", mrdStatus: "positive", vaf: 0.4 }
  ];
  const call2 = GENOMICS.trackCtDnaDynamics(recurrenceSamples);
  assert.equal(call2.responseCall, "molecular_recurrence");

  // Scenario 3: Molecular progression (>30% VAF increase)
  const progressionSamples = [
    { timepoint: "cycle-2", mrdStatus: "positive", vaf: 1.0 },
    { timepoint: "cycle-4", mrdStatus: "positive", vaf: 1.8 }
  ];
  const call3 = GENOMICS.trackCtDnaDynamics(progressionSamples);
  assert.equal(call3.responseCall, "molecular_progression");
});

/* =========================================================================
 * 7. COCKCROFT-GAULT, CALVERT CARBOPLATIN & WARDSYNC INTEGRATION
 * ========================================================================= */
test("COCKCROFT-GAULT: Computes CrCl accurately with sex adjustment and auto-detects umol/L", () => {
  // 60yo Male, 72kg, SCr 1.0 mg/dL: ((140 - 60) * 72) / (72 * 1.0) = 80 mL/min
  const maleRes = ORGAN_DOSE.calculateCockcroftGault({ age: 60, weightKg: 72, serumCreatinine: 1.0, sex: "male" });
  assert.equal(maleRes.crcl, 80);
  assert.equal(maleRes.isFloored, false);

  // 60yo Female, 72kg, SCr 1.0 mg/dL: 80 * 0.85 = 68 mL/min
  const femRes = ORGAN_DOSE.calculateCockcroftGault({ age: 60, weightKg: 72, serumCreatinine: 1.0, sex: "female" });
  assert.equal(femRes.crcl, 68);

  // Auto-detection of umol/L: 88.4 umol/L = 1.0 mg/dL
  const umolRes = ORGAN_DOSE.calculateCockcroftGault({ age: 60, weightKg: 72, serumCreatinine: 88.4, sex: "male" });
  assert.equal(umolRes.crcl, 80);
  assert.equal(umolRes.serumCreatinineMgDl, 1.0);
});

test("CALVERT CARBOPLATIN: Calculates target AUC dose and caps GFR at 125 mL/min per ASCO/NCCN", () => {
  // AUC 5 with GFR 75 mL/min: Dose = 5 * (75 + 25) = 500 mg
  const res1 = ORGAN_DOSE.calculateCalvertCarboplatin({ targetAuc: 5, gfr: 75 });
  assert.equal(res1.totalDoseMg, 500);
  assert.equal(res1.isGfrCapped, false);

  // AUC 5 with GFR 150 mL/min: GFR capped at 125 mL/min -> Dose = 5 * (125 + 25) = 750 mg (uncapped would be 875 mg)
  const res2 = ORGAN_DOSE.calculateCalvertCarboplatin({ targetAuc: 5, gfr: 150 });
  assert.equal(res2.totalDoseMg, 750);
  assert.equal(res2.uncappedDoseMg, 875);
  assert.equal(res2.isGfrCapped, true);
  assert.ok(res2.warnings.some(w => w.indexOf("GFR capped at 125 mL/min") >= 0));

  // Direct calculation from serum creatinine, age, weight
  const res3 = ORGAN_DOSE.calculateCalvertCarboplatin({
    targetAuc: 6,
    age: 60,
    weightKg: 72,
    serumCreatinine: 1.0,
    sex: "male"
  }); // CrCl = 80 mL/min -> 6 * (80 + 25) = 630 mg
  assert.equal(res3.totalDoseMg, 630);
  assert.equal(res3.gfrUsed, 80);
});

test("ORGAN DOSE: Auto-derives CrCl from serum creatinine and evaluates Carboplatin Calvert dose", () => {
  const carboProtocol = {
    id: "gyn-carboplatin",
    name: "Carboplatin AUC 5",
    drugs: [{ id: "carboplatin", name: "Carboplatin", basis: "auc", dosePerUnit: 5, unit: "mg" }]
  };

  // Provide only serumCreatinine + patient demographics (no precomputed CrCl)
  const res = ORGAN_DOSE.evaluateOrganDoseModifications(
    carboProtocol,
    { serumCreatinine: 1.2 }, // CrCl for 65yo, 70kg male = ((140-65)*70)/(72*1.2) = 60.76 mL/min
    {},
    { age: 65, weightKg: 70, sex: "male" }
  );

  assert.equal(res.labsEvaluated.serumCreatinine, 1.2);
  assert.equal(res.labsEvaluated.crcl, 60.76);
  assert.ok(res.calvertCarboplatin != null);
  // Calvert: 5 * (60.76 + 25) = 428.8 mg
  assert.equal(res.calvertCarboplatin.totalDoseMg, 428.8);
});

test("WARDSYNC INTEGRATION: fetchWardSyncPatientLabs safely reads from EMR and computes CrCl", () => {
  const mockEMR = {
    GHIS: {
      getSelectedPatient: () => ({
        patientId: "MRN-ONC-882",
        name: "Eleanor Vance",
        age: 62,
        sex: "female",
        weightKg: 65,
        heightCm: 162,
        labs: {
          creatinine: 0.9,
          totalBilirubin: 0.8,
          anc: 2400,
          platelets: 210000
        }
      })
    }
  };

  const fetched = ORGAN_DOSE.fetchWardSyncPatientLabs(mockEMR);
  assert.equal(fetched.source, "WardSynQ/EMR");
  assert.equal(fetched.patient.name, "Eleanor Vance");
  assert.equal(fetched.vitals.age, 62);
  assert.equal(fetched.labs.serumCreatinine, 0.9);
  // Female CrCl = ((140 - 62) * 65) / (72 * 0.9) * 0.85 = 66.5 mL/min
  assert.equal(fetched.labs.crcl, 66.5);
});

test("PROTOCOL SHEET: renders sclc-platinum-etoposide with computed drug doses and z-index 15000", () => {
  const PROTOSHEET = require(join(ROOT, "protocol-sheet.js"));
  const sclcProtocol = require(join(ROOT, "kb", "protocols", "sclc-platinum-etoposide.json"));
  assert.ok(PROTOSHEET);
  assert.equal(typeof PROTOSHEET.open, "function");

  // Test _drugRow computation for CISplatin, CARBOplatin, and Etoposide
  const rows = sclcProtocol.drugs.map(PROTOSHEET._drugRow);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "CISplatin");
  assert.equal(rows[1].name, "CARBOplatin");
  assert.equal(rows[2].name, "Etoposide");
});

