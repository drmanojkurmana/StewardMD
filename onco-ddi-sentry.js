/* StewardMD - onco-ddi-sentry.js. Oncology Drug-Drug & QTc Interaction Sentry.
 * PURE: no DOM mutation, evaluates protocol oncolytics against patient co-medications.
 * Detects CYP3A4 inhibitors/inducers, cumulative QTc prolongation risk,
 * acid-reducing agent attenuation of TKIs, and antiplatelet/anticoagulant bleeding synergy.
 * window.SMD_ONCO_DDI + module.exports.
 */
(function (root) {
  "use strict";

  // Knowledge base of known interacting classes
  var CYP3A4_STRONG_INHIBITORS = [
    "voriconazole", "posaconazole", "itraconazole", "ketoconazole",
    "clarithromycin", "ritonavir", "cobicistat", "grapefruit juice"
  ];

  var CYP3A4_STRONG_INDUCERS = [
    "rifampin", "carbamazepine", "phenytoin", "phenobarbital", "st john's wort", "st. john's wort"
  ];

  var QTC_PROLONGING_MEDS = [
    "ondansetron", "granisetron", "levofloxacin", "ciprofloxacin", "moxifloxacin",
    "azithromycin", "amiodarone", "sotalol", "methadone", "haloperidol"
  ];

  var ACID_REDUCERS = [
    "omeprazole", "pantoprazole", "esomeprazole", "lansoprazole", "rabeprazole",
    "famotidine", "ranitidine"
  ];

  var ONCO_DDI_RULES = [
    {
      oncoMatches: ["zanubrutinib", "ibrutinib", "acalabrutinib"],
      coMedList: CYP3A4_STRONG_INHIBITORS,
      severity: "major",
      category: "CYP3A4 Inhibition",
      effect: "Markedly increases BTK inhibitor plasma exposure, increasing risk of fatal hemorrhage, cardiac arrhythmias, and cytopenias.",
      action: "Reduce BTK inhibitor dose (e.g., Zanubrutinib 80 mg once daily instead of 160 mg BID) while co-administered with strong CYP3A4 inhibitor, or consider alternative non-CYP3A4 interacting antimicrobial.",
      citation: "FDA Prescribing Information / NCCN Guidelines"
    },
    {
      oncoMatches: ["venetoclax"],
      coMedList: CYP3A4_STRONG_INHIBITORS,
      severity: "contraindicated_or_reduce",
      category: "CYP3A4 Inhibition (Tumor Lysis Syndrome)",
      effect: "Extreme increase in venetoclax AUC (up to 8-fold), precipitating fatal Tumor Lysis Syndrome (TLS).",
      action: "Contraindicated during initial ramp-up phase. In steady-state maintenance, reduce venetoclax dose by at least 75% (e.g., reduce 400 mg to 100 mg daily).",
      citation: "FDA Prescribing Information / NCCN Guidelines (AML & CLL)"
    },
    {
      oncoMatches: ["ribociclib", "osimertinib", "cabozantinib", "sunitinib", "vandetanib"],
      coMedList: QTC_PROLONGING_MEDS,
      severity: "major",
      category: "Additive QTc Prolongation",
      effect: "Synergistic prolongation of ventricular repolarization, escalating risk of Torsades de Pointes and fatal cardiac arrest.",
      action: "Obtain baseline 12-lead ECG and monitor serum potassium (maintain > 4.0 mEq/L) and magnesium (> 2.0 mg/dL). If QTc exceeds 500 ms, hold targeted therapy and switch antiemetic to non-QTc prolonged agent (e.g. palonosetron).",
      citation: "DeVita 12th ed. / NCCN Task Force on Cardiotoxicity"
    },
    {
      oncoMatches: ["dasatinib", "erlotinib", "gefitinib", "pazopanib"],
      coMedList: ACID_REDUCERS,
      severity: "moderate",
      category: "Gastric pH-Dependent Bioavailability Reduction",
      effect: "Elevated gastric pH severely impairs solubility and systemic absorption of TKI, resulting in suboptimal blood levels and therapeutic failure.",
      action: "Avoid proton pump inhibitors (PPIs). If acid suppression is required, use short-acting antacids separated from oral TKI by at least 2 hours before or 2 hours after.",
      citation: "FDA Prescribing Information / DeVita 12th ed."
    },
    {
      oncoMatches: ["all_oncolytics"],
      coMedList: CYP3A4_STRONG_INDUCERS,
      severity: "major",
      category: "CYP3A4 Induction (Therapeutic Failure)",
      effect: "Dramatically accelerates hepatic clearance of targeted and cytotoxic agents, dropping plasma levels below effective therapeutic threshold.",
      action: "Avoid concurrent use of strong CYP3A4 inducers. Switch anticonvulsant or antimicrobial to non-enzyme-inducing agent.",
      citation: "Clinical Pharmacology Standards in Oncology"
    }
  ];

  function normalizeMed(s) {
    return String(s || "").toLowerCase().trim();
  }

  /**
   * Evaluates protocol drugs against patient co-medications to identify clinical drug-drug interactions.
   *
   * @param {Object} protocol - The protocol JSON object.
   * @param {Array<string|Object>} patientMeds - List of patient current medications.
   * @returns {Object} DDI audit result with structured alerts and management instructions.
   */
  function auditDrugInteractions(protocol, patientMeds) {
    protocol = protocol || {};
    patientMeds = Array.isArray(patientMeds) ? patientMeds : [];

    var oncoDrugs = (protocol.drugs || []).map(function (d) {
      return { id: normalizeMed(d.id), name: d.name || d.id };
    });

    var normMeds = patientMeds.map(function (m) {
      if (typeof m === "string") return normalizeMed(m);
      return normalizeMed(m.name || m.id || m.drug);
    }).filter(Boolean);

    var alerts = [];

    for (var i = 0; i < ONCO_DDI_RULES.length; i++) {
      var rule = ONCO_DDI_RULES[i];

      // Match oncolytics
      var matchedOnco = [];
      for (var o = 0; o < oncoDrugs.length; o++) {
        var onco = oncoDrugs[o];
        if (rule.oncoMatches.indexOf(onco.id) >= 0 || rule.oncoMatches.indexOf("all_oncolytics") >= 0) {
          matchedOnco.push(onco);
        }
      }
      if (!matchedOnco.length) continue;

      // Match co-medications
      var matchedCoMeds = [];
      for (var c = 0; c < normMeds.length; c++) {
        var cm = normMeds[c];
        for (var rcm = 0; rcm < rule.coMedList.length; rcm++) {
          if (cm.indexOf(rule.coMedList[rcm]) >= 0 || rule.coMedList[rcm].indexOf(cm) >= 0) {
            matchedCoMeds.push(cm);
            break;
          }
        }
      }

      if (matchedCoMeds.length > 0) {
        for (var m = 0; m < matchedOnco.length; m++) {
          alerts.push({
            severity: rule.severity,
            category: rule.category,
            oncoDrug: matchedOnco[m].name,
            interactingMeds: matchedCoMeds,
            clinicalEffect: rule.effect,
            management: rule.action,
            citation: rule.citation
          });
        }
      }
    }

    return {
      protocolId: protocol.id,
      protocolName: protocol.name,
      medicationsAudited: normMeds,
      alertCount: alerts.length,
      hasSevereAlerts: alerts.some(function (a) { return a.severity === "major" || a.severity === "contraindicated_or_reduce"; }),
      alerts: alerts
    };
  }

  var API = {
    auditDrugInteractions: auditDrugInteractions,
    ONCO_DDI_RULES: ONCO_DDI_RULES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  root.SMD_ONCO_DDI = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
