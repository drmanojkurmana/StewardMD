/* FollowCare AI — DiagnosisMapper (Phase 2 enhancement). DETERMINISTIC, no LLM, no network, no PHI.
 *
 * Maps a discharge diagnosis to ONE curated clinical pathway. NEVER generates or stores AI pathways.
 * Resolution order (first hit wins):
 *   1. ICD-10 code (when present) → pathway, via ICD10_MAP (code-prefix regexes; the reliable path).
 *   2. Normalized free-text → pathway, via TEXT_MAP (curated synonym regexes; many names → one pathway).
 *   3. Fallback → "generic" (a safe recovery pathway that must NEVER block enrolment).
 *
 * Both tables are plain DATA, ordered specific-before-general, so a hospital can extend mapping without
 * code changes. Targets the pathway ids in followcare-pathways.js. window.FollowCareDiagnosis + exports.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  // Normalize free-text: lowercase, drop diacritics + punctuation, collapse whitespace.
  function normalize(s) {
    var str = String(s == null ? "" : s).toLowerCase();
    try { str = str.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return str.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  // Normalize an ICD-10 code for prefix matching: uppercase, keep A-Z 0-9 and the dot.
  function normIcd(c) { return String(c == null ? "" : c).toUpperCase().replace(/[^A-Z0-9.]/g, ""); }

  // ICD-10 → pathway (code-prefix regexes). Specific ranges before general.
  var ICD10_MAP = [
    [/^A1[5-9]/, "tuberculosis"],
    [/^A(40|41)/, "sepsis"],
    [/^A9[01]/, "dengue"],
    [/^B(5[0-4])/, "malaria"],
    [/^B(1[5-9])/, "hepatitis"],
    [/^J1[2-8]/, "pneumonia"],
    [/^J44/, "copd"],
    [/^J4[56]/, "asthma"],
    [/^J9[01]|^J94/, "pleural_effusion"],
    [/^I21|^I20\.?0|^I214|^I24/, "acs"],
    [/^I50/, "heart_failure"],
    [/^I1[0-5]/, "hypertension"],
    [/^I4[7-9]|^R000/, "arrhythmia"],
    [/^I6[0-9]|^G45/, "stroke"],
    [/^G4[01]|^R56/, "seizure"],
    [/^N17/, "aki"],
    [/^N18/, "ckd"],
    [/^N04/, "nephrotic"],
    [/^K7[0-4]|^K76|^I85/, "cld"],
    [/^K75|^K77/, "hepatitis"],
    [/^K85/, "pancreatitis"],
    [/^K92[012]|^K25|^K26|^K27|^K28/, "ugib"],
    [/^E1[0-4]/, "diabetes"],
    [/^L0[123]/, "cellulitis"],
    [/^T3[6-9]|^T4[0-9]|^T5[0-9]|^T6[0-5]/, "poisoning"],
    [/^Z48|^Z98/, "post_op"]
  ];

  // Normalized free-text → pathway (curated synonyms). ORDER MATTERS: more specific patterns first so e.g.
  // "acute LV failure" hits heart_failure before any generic "failure", and DKA hits diabetes.
  var TEXT_MAP = [
    [/\b(nstemi|stemi|acute coronary|acs|unstable angina|myocardial infarct|\bmi\b|acute mi|troponin)/, "acs"],
    [/\b(acute lv failure|lv failure|heart failure|\bchf\b|\bhfref\b|\bhfpef\b|cardiac failure|decompensated heart|pulmonary oedema|pulmonary edema|cardiac decompensation)/, "heart_failure"],
    [/\b(atrial fibrill|\baf\b|\bafib\b|arrhythmia|svt|ventricular tachy|\bvt\b|heart block|palpitation|bradycard|tachyarrhythmia)/, "arrhythmia"],
    [/\b(hypertens|\bhtn\b|high blood pressure|bp crisis|hypertensive)/, "hypertension"],
    [/\b(aspiration pneumonia|community acquired pneumonia|\bcap\b|\bhap\b|\blrti\b|pneumonia|lower resp.* infection|bronchopneumonia|lung infection|chest infection)/, "pneumonia"],
    [/\b(copd|emphysema|chronic bronchitis|aecopd|obstructive airway)/, "copd"],
    [/\b(asthma|reactive airway|bronchial asthma|status asthmaticus)/, "asthma"],
    [/\b(tuberculosis|\btb\b|\bptb\b|koch|mycobacter|\beptb\b)/, "tuberculosis"],
    [/\b(pleural effusion|empyema|hydrothorax|pleural fluid)/, "pleural_effusion"],
    [/\b(stroke|\bcva\b|cerebrovascular|cerebral infarct|brain infarct|intracerebral|\btia\b|ischemic stroke|haemorrhagic stroke|hemorrhagic stroke)/, "stroke"],
    [/\b(seizure|epilep|convuls|status epilepticus|\bgtcs\b|fits)/, "seizure"],
    [/\b(acute kidney injury|\baki\b|acute renal failure|\barf\b|acute tubular)/, "aki"],
    [/\b(chronic kidney|\bckd\b|esrd|end stage renal|chronic renal failure|\bckd5\b|dialysis dependent)/, "ckd"],
    [/\b(nephrotic)/, "nephrotic"],
    [/\b(alcoholic liver|\bcld\b|chronic liver|cirrhos|decompensated cld|decompensated liver|hcv cirrhosis|hbv cirrhosis|portal hypertension|ascites|hepatic encephalopathy)/, "cld"],
    [/\b(hepatitis|acute liver|viral hepatit|\bhav\b|\bhbv\b|\bhcv\b|jaundice)/, "hepatitis"],
    [/\b(pancreatit|acute pancreas)/, "pancreatitis"],
    [/\b(upper gi bleed|\bugib\b|hematemesis|haematemesis|melena|melaena|variceal bleed|peptic ulcer bleed|gi hemorrhage|gi haemorrhage)/, "ugib"],
    [/\b(dka|diabetic ketoacid|hhs|hyperosmolar|diabetes|diabetic|\bt2dm\b|\bt1dm\b|hyperglycemi|hyperglycaemi)/, "diabetes"],
    [/\b(dengue|dhf|dss)/, "dengue"],
    [/\b(malaria|falciparum|vivax|plasmodium)/, "malaria"],
    [/\b(cellulit|erysipel|skin.*infection|soft tissue infection|abscess)/, "cellulitis"],
    [/\b(sepsis|septic|septicemia|septicaemia|bacteremia|septic shock)/, "sepsis"],
    [/\b(poison|overdose|\bod\b|ingestion|organophosphate|\bop\b compound|snake bite|envenomation|toxicity)/, "poisoning"],
    [/\b(post op|post-op|postoperative|post surgery|surgical|laparotomy|arthroplasty|appendicectomy|cholecystectomy|hernioplasty|s\/p )/, "post_op"]
  ];

  // Map a diagnosis to a pathway id. icd optional. Returns the pathway id (never null — falls back to generic).
  function map(diagnosisText, icd, opts) {
    return mapDetail(diagnosisText, icd, opts).pathwayId;
  }
  // Same, with provenance: { pathwayId, matchedBy:"icd"|"text"|"fallback", matched }.
  function mapDetail(diagnosisText, icd, opts) {
    var fallback = (opts && opts.fallback) || "generic";
    var code = normIcd(icd);
    if (code) { for (var i = 0; i < ICD10_MAP.length; i++) if (ICD10_MAP[i][0].test(code)) return { pathwayId: ICD10_MAP[i][1], matchedBy: "icd", matched: code }; }
    var text = normalize(diagnosisText);
    if (text) { for (var j = 0; j < TEXT_MAP.length; j++) if (TEXT_MAP[j][0].test(text)) return { pathwayId: TEXT_MAP[j][1], matchedBy: "text", matched: TEXT_MAP[j][0].source }; }
    return { pathwayId: fallback, matchedBy: "fallback", matched: null };
  }

  var API = { map: map, mapDetail: mapDetail, normalize: normalize, normIcd: normIcd, ICD10_MAP: ICD10_MAP, TEXT_MAP: TEXT_MAP, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareDiagnosis = API;
})();
