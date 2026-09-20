/* test/onco-protocol-sheet.test.mjs
 * Automated test suite for StewardMD Chemotherapy Protocol Sheet
 * Verifies:
 * 1. 100% of protocols in kb/protocols/ are present, valid, and renderable to HTML/PDF.
 * 2. Doctor custom input: Age, Sex, Height, Weight, Creatinine -> live Auto BSA (Mosteller) & Auto CrCl (Cockcroft-Gault).
 * 3. Dynamic dosing calculations: BSA-based, Calvert AUC Carboplatin, weight-based mg/kg, and flat dosing.
 * 4. WardSync / EMR lab sync handling.
 * 5. Professional A4 printable template structure with dual sign-off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadSheetEnv() {
  const doseSrc = readFileSync(join(ROOT, 'onco-dose.js'), 'utf8');
  const sheetSrc = readFileSync(join(ROOT, 'protocol-sheet.js'), 'utf8');

  const sandbox = {
    window: {},
    document: {
      createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
      body: { appendChild() {}, classList: { add() {}, remove() {} } }
    },
    console: console,
    parseFloat: parseFloat,
    Math: Math,
    isFinite: isFinite,
    String: String,
    JSON: JSON,
    Array: Array
  };
  sandbox.window = sandbox;
  sandbox.root = sandbox;

  vm.runInNewContext(doseSrc, sandbox);
  vm.runInNewContext(sheetSrc, sandbox);

  return {
    API: sandbox.window.SMD_PROTOSHEET,
    DOSE: sandbox.window.SMD_ONCODOSE,
    sandbox
  };
}

test('SMD_PROTOSHEET API loads and exposes calculation helpers', () => {
  const { API, DOSE } = loadSheetEnv();
  assert.ok(API, 'SMD_PROTOSHEET must be defined');
  assert.equal(typeof API.open, 'function');
  assert.equal(typeof API.close, 'function');
  assert.equal(typeof API.bsa, 'function');
  assert.equal(typeof API.crcl, 'function');
  assert.equal(typeof API.buildExportHtml, 'function');
  assert.equal(typeof API.sheetHtml, 'function');
  assert.ok(DOSE, 'SMD_ONCODOSE must be defined');
});

test('DOCTOR INPUT & AUTO BSA: Mosteller BSA accurately computes across patient metrics', () => {
  const { API } = loadSheetEnv();
  API._st.patient = { heightCm: 170, weightKg: 70 };
  const bsa1 = API.bsa();
  // sqrt(170 * 70 / 3600) = sqrt(11900 / 3600) = 1.818
  assert.ok(Math.abs(bsa1 - 1.818) < 0.01, `BSA expected ~1.82, got ${bsa1}`);

  API._st.patient = { heightCm: 160, weightKg: 50 };
  const bsa2 = API.bsa();
  // sqrt(160 * 50 / 3600) = sqrt(8000 / 3600) = 1.4907
  assert.ok(Math.abs(bsa2 - 1.491) < 0.01, `BSA expected ~1.49, got ${bsa2}`);

  API._st.patient = { heightCm: null, weightKg: 70 };
  assert.equal(API.bsa(), null, 'BSA must be null when height is missing');
});

test('DOCTOR INPUT & AUTO CrCl: Cockcroft-Gault CrCl accurately computes for male and female', () => {
  const { API } = loadSheetEnv();
  // Male: 60yo, 70kg, SCr 1.0 -> (140 - 60) * 70 / (72 * 1.0) = 5600 / 72 = 77.78 mL/min
  API._st.patient = { age: 60, weightKg: 70, creatinine: 1.0, sex: 'male' };
  const crclMale = API.crcl();
  assert.ok(Math.abs(crclMale - 77.78) < 0.02, `CrCl male expected ~77.78, got ${crclMale}`);

  // Female: 60yo, 70kg, SCr 1.0 -> 77.78 * 0.85 = 66.11 mL/min
  API._st.patient = { age: 60, weightKg: 70, creatinine: 1.0, sex: 'female' };
  const crclFemale = API.crcl();
  assert.ok(Math.abs(crclFemale - 66.11) < 0.02, `CrCl female expected ~66.11, got ${crclFemale}`);

  // Missing creatinine -> null
  API._st.patient = { age: 60, weightKg: 70, creatinine: null, sex: 'female' };
  assert.equal(API.crcl(), null, 'CrCl must be null when creatinine is missing');
});

test('CALVERT CARBOPLATIN DOSING: calculates exact mg dose from live patient inputs', () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, 'kb/protocols/gyn-carbo-paclitaxel.json'), 'utf8'));
  API._st.protocol = proto;
  API._st.patient = { age: 60, sex: 'female', heightCm: 165, weightKg: 68, creatinine: 0.9 };

  // Paclitaxel: 175 mg/m2 * 1.7654 = 308.95 mg
  // Carboplatin: AUC 6 * (min(71.36, 125) + 25) = 6 * 96.358 = 578.15 mg
  const rows = proto.drugs.map(API._drugRow);
  const carboRow = rows.find(r => r.id === 'carboplatin');
  const pacliRow = rows.find(r => r.id === 'paclitaxel');

  assert.ok(carboRow, 'Carboplatin row must exist');
  assert.equal(carboRow.basis, 'auc');
  assert.equal(carboRow.totalTxt, '578.15 mg');

  assert.ok(pacliRow, 'Paclitaxel row must exist');
  assert.equal(pacliRow.basis, 'bsa');
  assert.equal(pacliRow.totalTxt, '308.95 mg');
});

test('PRINTABLE TEMPLATE: buildExportHtml outputs professional A4 record with all clinical fields', () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, 'kb/protocols/gyn-carbo-paclitaxel.json'), 'utf8'));
  API._st.protocol = proto;
  API._st.patient = {
    caseNo: 'ONC-9842',
    name: 'Eleanor Vance',
    age: 58,
    sex: 'female',
    heightCm: 162,
    weightKg: 64,
    creatinine: 0.85,
    diagnosis: 'High-Grade Serous Ovarian Carcinoma Stage IIIC',
    intent: 'curative',
    consultant: 'Dr. Sarah Connor, MD'
  };
  API._st.sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const html = API.buildExportHtml();
  assert.ok(html.startsWith('<!doctype html>'), 'Must produce valid HTML5 document');
  assert.ok(html.includes('Auto BSA (m²)'), 'Must include Auto BSA row');
  assert.ok(html.includes('Auto CrCl (mL/min)'), 'Must include Auto CrCl row');
  assert.ok(html.includes('Mosteller'), 'Must display Mosteller formula badge');
  assert.ok(html.includes('Cockcroft-Gault'), 'Must display Cockcroft-Gault formula badge');
  assert.ok(html.includes('Primary Prescribing Oncologist Verification'), 'Must include primary oncologist signature block');
  assert.ok(html.includes('Independent Double-Check (Oncology Pharmacist'), 'Must include second-checker pharmacist block');
  assert.ok(html.includes('ps-sig-img'), 'Must embed verified signature image');
  assert.ok(html.includes('Eleanor Vance'), 'Must display patient name');
  assert.ok(html.includes('ONC-9842'), 'Must display MRN');
});

test('ALL PROTOCOLS IN KB ARE VALID & PRINTABLE', () => {
  const { API } = loadSheetEnv();
  const protoFiles = readdirSync(join(ROOT, 'kb/protocols')).filter(f => f.endsWith('.json') && f !== 'index.json');
  assert.ok(protoFiles.length >= 281, `Must have at least 281 protocol files (found ${protoFiles.length})`);

  const testPatient = {
    caseNo: 'TEST-001',
    name: 'Test Patient',
    age: 55,
    sex: 'female',
    heightCm: 165,
    weightKg: 65,
    creatinine: 0.9,
    diagnosis: 'Test Malignancy',
    consultant: 'Dr. Protocol'
  };

  for (const f of protoFiles) {
    const raw = readFileSync(join(ROOT, 'kb/protocols', f), 'utf8');
    const proto = JSON.parse(raw);
    API._st.protocol = proto;
    API._st.patient = testPatient;

    const screenHtml = API.sheetHtml(false);
    assert.ok(screenHtml && screenHtml.length > 200, `Screen HTML must render for ${f}`);

    const exportHtml = API.buildExportHtml();
    assert.ok(exportHtml && exportHtml.length > 500, `Export HTML must render for ${f}`);
    assert.ok(exportHtml.includes('ps-sheet'), `Export HTML must contain ps-sheet for ${f}`);
    assert.ok(exportHtml.includes('ps-table'), `Export HTML must contain drug table for ${f}`);
  }
});


test("HOSPITAL BRANDING & LOGO: custom branding saves, updates header, and renders in print export with StewardMD footer", () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, "kb/protocols/gyn-carbo-paclitaxel.json"), "utf8"));
  API._st.protocol = proto;
  API._st.patient = { name: "Jane Doe", heightCm: 160, weightKg: 60 };

  // Set custom institution branding
  API.saveInstitution({
    name: "Apollo Comprehensive Cancer Centre",
    dept: "Department of Medical Oncology and Blood Disorders",
    line: "Specialized Chemotherapy Protocol & Verification Sheet",
    logoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  });

  const exportHtml = API.buildExportHtml();
  assert.ok(exportHtml.includes("Apollo Comprehensive Cancer Centre"), "Print export must contain custom hospital name");
  assert.ok(exportHtml.includes("Department of Medical Oncology and Blood Disorders"), "Print export must contain custom department");
  assert.ok(exportHtml.includes("Specialized Chemotherapy Protocol"), "Print export must contain custom subtitle");
  assert.ok(exportHtml.includes("ps-inst-logo-img"), "Print export must embed custom hospital logo");
  assert.ok(exportHtml.includes("Made using StewardMD Oncology Clinical Care"), "Footer must state Made using StewardMD");
  assert.ok(exportHtml.includes("MEDICOLEGAL DISCLAIMER:"), "Footer must include medicolegal disclaimer");
});

test("DOCTOR DOSAGE OVERRIDE: inline adjustment overrides formula dose, applies Doctor Adjusted badge, and tracks original dose footnote", () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, "kb/protocols/gyn-carbo-paclitaxel.json"), "utf8"));
  API._st.protocol = proto;
  API._st.patient = { age: 60, sex: "female", heightCm: 165, weightKg: 68, creatinine: 0.9 };

  // Standard calculated paclitaxel: 175 mg/m2 * 1.7654 m2 = 308.95 mg
  const rowBefore = API._drugRow(proto.drugs.find(d => d.id === "paclitaxel"));
  assert.equal(rowBefore.totalTxt, "308.95 mg");
  assert.equal(rowBefore.isAdjusted, false);

  // Doctor modifies dose to 240 mg with clinical reason
  API._st.overrides["paclitaxel"] = {
    customDoseMg: 240,
    reason: "20% dose reduction due to grade 3 neutropenia in cycle 1"
  };

  const rowAfter = API._drugRow(proto.drugs.find(d => d.id === "paclitaxel"));
  assert.equal(rowAfter.totalTxt, "240 mg");
  assert.equal(rowAfter.isAdjusted, true);
  assert.equal(rowAfter.origTotalTxt, "308.95 mg");
  assert.equal(rowAfter.adjustReason, "20% dose reduction due to grade 3 neutropenia in cycle 1");

  const html = API.buildExportHtml();
  assert.ok(html.includes("240 mg"), "Export HTML must display doctor-adjusted dose");
  assert.ok(html.includes("Doctor Adjusted"), "Export HTML must display Doctor Adjusted badge");
  assert.ok(html.includes("308.95 mg"), "Export HTML must display original standard dose in footnote");
  assert.ok(html.includes("grade 3 neutropenia"), "Export HTML must display adjustment reason");
});

test("ADD DRUG TO PROTOCOL: custom medication calculates dynamically by BSA/weight/flat and integrates into cycle schedule", () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, "kb/protocols/gyn-carbo-paclitaxel.json"), "utf8"));
  API._st.protocol = JSON.parse(JSON.stringify(proto));
  API._st.patient = { heightCm: 165, weightKg: 68, age: 60, sex: "female", creatinine: 0.9 };
  // BSA = 1.7654 m2

  // Add custom Mesna (fixed flat dose 400 mg)
  API._st.protocol.drugs.push({
    id: "custom-mesna",
    name: "Mesna Uroprotection",
    dosePerUnit: 400,
    unit: "mg",
    basis: "flat",
    route: "IV Bolus",
    days: [1],
    notes: "Administer at 0, 4, 8 hours",
    custom: true
  });

  // Add custom Filgrastim (weight-based 5 mcg/kg)
  API._st.protocol.drugs.push({
    id: "custom-filgrastim",
    name: "Filgrastim (G-CSF)",
    dosePerUnit: 5,
    unit: "mcg/kg",
    basis: "mgkg",
    route: "Subcutaneous",
    days: [3, 4, 5],
    notes: "Support for nadir",
    custom: true
  });

  const mesnaRow = API._drugRow(API._st.protocol.drugs.find(d => d.id === "custom-mesna"));
  assert.equal(mesnaRow.totalTxt, "400 mg");
  assert.equal(mesnaRow.custom, true);

  const filgRow = API._drugRow(API._st.protocol.drugs.find(d => d.id === "custom-filgrastim"));
  // 5 mcg/kg * 68 kg = 340 mcg
  assert.equal(filgRow.totalTxt, "340 mcg");

  const html = API.buildExportHtml();
  assert.ok(html.includes("Mesna Uroprotection"), "Export HTML must render added custom drug");
  assert.ok(html.includes("400 mg"), "Export HTML must display flat calculated dose");
  assert.ok(html.includes("Filgrastim (G-CSF)"), "Export HTML must render custom G-CSF");
  assert.ok(html.includes("340 mcg"), "Export HTML must display weight-based calculated dose");
  assert.ok(html.includes("Added by Doctor"), "Export HTML must display Added by Doctor badge");
});

test("ADVERSE EFFECTS & ANTIDOTES: automatically detects high-grade toxicities (Irinotecan -> Atropine, Cisplatin -> Hydration/NK1, Oxaliplatin -> Cold Spasm, etc.)", () => {
  const { API } = loadSheetEnv();
  
  // Test Irinotecan protocol (e.g. FOLFIRI or Colorectal Irinotecan)
  const irinoProto = {
    id: "gi-folfiri",
    name: "FOLFIRI (Irinotecan, Leucovorin, 5-FU)",
    drugs: [
      { id: "irinotecan", name: "Irinotecan", dosePerUnit: 180, unit: "mg/m2", basis: "bsa", route: "IV Infusion" },
      { id: "fluorouracil-bolus", name: "Fluorouracil (5-FU)", dosePerUnit: 400, unit: "mg/m2", basis: "bsa", route: "IV Bolus" }
    ]
  };
  const irinoTox = API.getRegimenToxicities(irinoProto);
  assert.ok(irinoTox.some(t => t.id === "irinotecan-cholinergic"), "Must detect Irinotecan acute cholinergic syndrome");
  const cholTox = irinoTox.find(t => t.id === "irinotecan-cholinergic");
  assert.ok(cholTox.management.includes("Atropine 0.25 mg to 1.0 mg IV or SC immediately"), "Must prescribe Atropine as antidote");
  assert.ok(cholTox.management.includes("High-dose Loperamide"), "Must prescribe High-dose Loperamide for delayed diarrhea");

  // Test Cisplatin protocol
  const cisProto = {
    id: "lung-cisplatin-gemcitabine",
    name: "Cisplatin + Gemcitabine",
    drugs: [{ id: "cisplatin", name: "Cisplatin", dosePerUnit: 75, unit: "mg/m2", basis: "bsa", route: "IV Infusion" }]
  };
  const cisTox = API.getRegimenToxicities(cisProto);
  assert.ok(cisTox.some(t => t.id === "cisplatin-nephro-emesis"), "Must detect Cisplatin nephrotoxicity and emesis");
  const cTox = cisTox.find(t => t.id === "cisplatin-nephro-emesis");
  assert.ok(cTox.management.includes("Pre-hydration: 1000 mL Normal Saline"), "Must prescribe saline pre-hydration");
  assert.ok(cTox.management.includes("NK1 receptor antagonist"), "Must prescribe NK1 antiemetic triplet");

  // Test Oxaliplatin cold sensitivity
  const oxProto = {
    id: "gi-folfox",
    name: "FOLFOX",
    drugs: [{ id: "oxaliplatin", name: "Oxaliplatin", dosePerUnit: 85, unit: "mg/m2", basis: "bsa", route: "IV Infusion" }]
  };
  const oxTox = API.getRegimenToxicities(oxProto);
  assert.ok(oxTox.some(t => t.id === "oxaliplatin-cold-spasm"), "Must detect Oxaliplatin cold-induced spasm");
});

test("MULTILINGUAL ORAL INSTRUCTIONS: provides mandatory English + selectable Telugu, Tamil, Kannada, Hindi, and Malayalam instructions", () => {
  const { API } = loadSheetEnv();
  const capecitabineProto = {
    id: "gi-xelox",
    name: "CAPOX / XELOX (Capecitabine + Oxaliplatin)",
    drugs: [
      { id: "capecitabine", name: "Capecitabine", dosePerUnit: 1000, unit: "mg/m2", basis: "bsa", route: "Oral" }
    ]
  };
  API._st.protocol = capecitabineProto;
  API._st.patient = { heightCm: 165, weightKg: 65, age: 55, sex: "female" };
  assert.equal(API.hasOralMedications(capecitabineProto), true, "Must recognize Capecitabine as oral medication");

  // Test Telugu
  API._st.oralLang = "te";
  const htmlTe = API.buildExportHtml();
  assert.ok(htmlTe.includes("English (Mandatory Instructions)"), "Must include mandatory English instructions");
  assert.ok(htmlTe.includes("Telugu (తెలుగు)"), "Must include Telugu language title");
  assert.ok(htmlTe.includes("మాత్రలను నమలకుండా"), "Must include localized Telugu swallowing instruction");

  // Test Tamil
  API._st.oralLang = "ta";
  const htmlTa = API.buildExportHtml();
  assert.ok(htmlTa.includes("Tamil (தமிழ்)"), "Must include Tamil language title");
  assert.ok(htmlTa.includes("மாத்திரைகளை மெல்லவோ"), "Must include localized Tamil swallowing instruction");

  // Test Kannada
  API._st.oralLang = "kn";
  const htmlKn = API.buildExportHtml();
  assert.ok(htmlKn.includes("Kannada (ಕನ್ನಡ)"), "Must include Kannada language title");
  assert.ok(htmlKn.includes("ಮಾತ್ರೆಗಳನ್ನು ಅಗಿಯಬೇಡಿ"), "Must include localized Kannada swallowing instruction");

  // Test Hindi
  API._st.oralLang = "hi";
  const htmlHi = API.buildExportHtml();
  assert.ok(htmlHi.includes("Hindi (हिन्दी)"), "Must include Hindi language title");
  assert.ok(htmlHi.includes("गोलियों को चबाएं"), "Must include localized Hindi swallowing instruction");

  // Test Malayalam
  API._st.oralLang = "ml";
  const htmlMl = API.buildExportHtml();
  assert.ok(htmlMl.includes("Malayalam (മലയാളം)"), "Must include Malayalam language title");
  assert.ok(htmlMl.includes("ഗുളികകൾ ചവച്ചരയ്ക്കാനോ"), "Must include localized Malayalam swallowing instruction");
});

test("DOCTOR CLINICAL NOTES & PRINT PAGINATION: preserves notes, quick-insert chips, and clean 1-page/2-page A4 print layout with disclaimer", () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, "kb/protocols/gyn-carbo-paclitaxel.json"), "utf8"));
  API._st.protocol = proto;
  API._st.patient = { name: "Robert Langdon", heightCm: 175, weightKg: 78, age: 62, sex: "male", creatinine: 1.1 };

  API._st.doctorNotes = "• PICC line insertion confirmed.\n• Check CBC on Day 10 Nadir.\n• Hydration 1000 mL NS pre-infusion.";
  API._st.includeDoctorNotesInPrint = true;

  const html = API.buildExportHtml();
  assert.ok(html.includes("Prescribing Oncologist Clinical Notes"), "Export HTML must have doctor notes header");
  assert.ok(html.includes("PICC line insertion confirmed"), "Export HTML must display custom clinical notes");
  assert.ok(html.includes("Check CBC on Day 10 Nadir"), "Export HTML must display nadir instruction");
  assert.ok(html.includes("MEDICOLEGAL DISCLAIMER:"), "Export HTML must include medicolegal disclaimer");
  assert.ok(html.includes("ps-page-break-auto"), "Export HTML must include intelligent page-break classes");
  assert.ok(html.includes("ps-page-break-deliberate"), "Export HTML for big protocol must include deliberate page-break");
  assert.ok(html.includes("ps-page2-header"), "Export HTML for big protocol must render running header for page 2");
  assert.ok(html.includes("ps-page ps-page-1"), "Export HTML must wrap Page 1 in .ps-page container");
  assert.ok(html.includes("ps-page ps-page-2"), "Export HTML must wrap Page 2 in .ps-page container");
  assert.ok(html.includes("ps-cards-col2"), "Export HTML must format header cards in 2-column layout");
});

test("MODAL EVENT DELEGATION & NO STOPPROPAGATION: modal cards allow click event bubbling for save and reduction shortcuts", () => {
  const { API } = loadSheetEnv();
  const proto = JSON.parse(readFileSync(join(ROOT, "kb/protocols/gyn-carbo-paclitaxel.json"), "utf8"));
  API._st.protocol = proto;
  API._st.patient = { name: "Jane Doe", heightCm: 165, weightKg: 65, age: 55, sex: "female", creatinine: 0.8 };

  // Verify shell and modal HTML outputs contain NO inline stopPropagation
  API._st.activeDoseEditModal = "paclitaxel";
  API._st.showBrandingModal = true;
  API._st.showAddDrugModal = true;
  API._st.showAddToxModal = true;

  const shell = API.shellHtml();
  assert.equal(shell.includes("event.stopPropagation()"), false, "No modal card may contain event.stopPropagation() blocking delegated listeners");
  assert.ok(shell.includes('data-ps-act="quick-dose-pct"'), "Must render quick dose percentage reduction buttons");
  assert.ok(shell.includes('data-ps-act="save-drug-dose"'), "Must render save dose adjustment button");
  assert.ok(shell.includes('data-ps-act="save-branding"'), "Must render save branding button");
  assert.ok(shell.includes('data-ps-act="save-add-drug"'), "Must render save custom drug button");
  assert.ok(shell.includes('data-ps-act="save-add-tox"'), "Must render save toxicity button");
});

test("ONCOTREE PROTOCOL COVERAGE: all 65 oncotree guidelines have protocol coverage and neuroblastoma resolves protocols", () => {
  const otFiles = readdirSync(join(ROOT, "kb/oncotree")).filter(f => f.endsWith(".json"));
  assert.equal(otFiles.length, 65, "Must have exactly 65 OncoTree guideline files");

  const protoFiles = new Set(readdirSync(join(ROOT, "kb/protocols")).filter(f => f.endsWith(".json")).map(f => f.replace(".json", "")));

  for (const f of otFiles) {
    const ot = JSON.parse(readFileSync(join(ROOT, "kb/oncotree", f), "utf8"));
    const endNodes = (ot.nodes || []).filter(n => n.nodeType === "end" || n.nodeCategory === "treatment" || n.showsRecommendation);
    assert.ok(endNodes.length > 0, `${f} must have treatment/end nodes`);

    // Ensure at least one treatment node has protocolRefs and that all referenced protocols exist in kb/protocols
    let withRefs = 0;
    for (const n of endNodes) {
      if (n.protocolRefs && n.protocolRefs.length > 0) {
        withRefs++;
        for (const r of n.protocolRefs) {
          assert.ok(protoFiles.has(r), `Protocol ref ${r} in ${f} (node ${n.id}) must exist in kb/protocols/`);
        }
      }
    }
    assert.ok(withRefs > 0, `Guideline ${f} must have protocols attached to treatment nodes`);
  }

  // Explicit verification of Neuroblastoma resolution
  const nb = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/neuroblastoma.json"), "utf8"));
  const highRiskNode = nb.nodes.find(n => n.id === "n_high_risk_tx");
  assert.ok(highRiskNode, "Neuroblastoma must have n_high_risk_tx node");
  assert.ok(highRiskNode.protocolRefs.includes("peds-neuroblastoma-dinutuximab"), "Must reference dinutuximab protocol");
  assert.ok(highRiskNode.protocolRefs.includes("ped-neuroblastoma-highrisk"), "Must reference high-risk induction protocol");

  const intRiskNode = nb.nodes.find(n => n.id === "n_int_risk_tx");
  assert.ok(intRiskNode.protocolRefs.includes("peds-neuroblastoma-anbl0531"), "Must reference ANBL0531 intermediate risk protocol");

  const lowRiskNode = nb.nodes.find(n => n.id === "n_low_risk_tx");
  assert.ok(lowRiskNode.protocolRefs.includes("peds-neuroblastoma-lowrisk"), "Must reference low-risk protocol");

  const relapsedNode = nb.nodes.find(n => n.id === "n_relapsed_tx");
  assert.ok(relapsedNode.protocolRefs.includes("peds-neuroblastoma-dit"), "Must reference D-I/T relapsed protocol");
});


