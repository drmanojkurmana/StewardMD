/* fundx-clinical.js — FundX AI · Clinical Engine foundation (Phase C, rule-based).
 *
 * The Clinical Engine REASONS over the Vision Engine's structured RetinalFindings JSON
 * plus patient context. It NEVER analyses pixels, and its output is strictly ADVISORY —
 * never a diagnosis. Output is structured ClinicalAssessment JSON; every conclusion cites
 * the evidence that drove it, and confidence drops when the image or data is poor.
 *
 * This is a deterministic, evidence-based rule engine — a real (non-placeholder) Phase C
 * foundation that needs no external AI. It sits behind a provider seam identical in spirit
 * to the Vision AI Router: a richer LLM clinical provider (Gemini/GPT/Cerebras via the
 * FundX backend) can be registered and made active later with NO change to the UI, the
 * Vision Engine, or the data contracts. Until then the rule engine is the active provider.
 *
 * DOM-free ⇒ headless-testable. Exposed as window.SMD_FUNDX_CLINICAL.
 */
(function () {
  "use strict";
  var VERSION = "0.1.0", SCHEMA_VERSION = 1;
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (n !== n ? 0 : n); }
  var SEV = ["none", "mild", "moderate", "severe"];
  var URG = ["routine", "soon", "urgent", "emergency"];
  function maxRank(list, cur, val) { return list.indexOf(val) > list.indexOf(cur) ? val : cur; }
  var FOLLOWUP = { emergency: "immediate", urgent: "1 week", soon: "4 weeks", moderate: "3 months", mild: "6 months", none: "12 months" };

  // Rule engine: RetinalFindings JSON (the .findings payload) + patient → ClinicalAssessment.
  function assessRules(findingsWrap, patient) {
    patient = patient || {};
    var f = (findingsWrap && findingsWrap.findings) ? findingsWrap.findings : (findingsWrap || {});
    var od = f.optic_disc || {}, mac = f.macula || {};
    var ma = +f.microaneurysms || 0, hem = +f.hemorrhages || 0, exu = +f.hard_exudates || 0, cws = +f.cotton_wool_spots || 0;
    var cdr = od.cup_disc_ratio != null ? +od.cup_disc_ratio : null;
    var quality = f.quality != null ? +f.quality : null;
    var modelConf = f.confidence != null ? +f.confidence : 0.7;
    var dx = String(patient.dx || patient.diagnosis || "").toLowerCase();
    var hba1c = patient.hba1c != null ? +patient.hba1c : null;
    var diabetic = /diabet|t2dm|t1dm|dm\b/.test(dx) || (hba1c != null && hba1c >= 6.5);
    var hypertensive = /hypertension|htn/.test(dx) || (patient.sbp != null && +patient.sbp >= 160);

    var considerations = [], severity = "none", urgency = "routine", referral = null, investigations = [], safetyFlags = [], missingData = [], evidence = [];
    function raise(sev, urg) { severity = maxRank(SEV, severity, sev); urgency = maxRank(URG, urgency, urg); }
    function refer(to, priority, reason) { if (!referral || URG.indexOf(priority) > URG.indexOf(referral.priority)) referral = { to: to, priority: priority, reason: reason }; }

    // Diabetic retinopathy (proxy grading from lesion counts).
    if (f.neovascularization || hem >= 8 || (hem >= 5 && exu >= 5)) {
      considerations.push({ key: "pdr", label: "Proliferative-type diabetic retinopathy features", likelihood: "likely", severity: "severe", evidence: ["neovascularization/dense haemorrhage"] });
      raise("severe", "urgent"); refer("Retina specialist", "urgent", "Sight-threatening proliferative features"); investigations.push("OCT", "Fundus fluorescein angiography");
      evidence.push("haemorrhages=" + hem, "hard_exudates=" + exu);
    } else if (ma + hem >= 6 || exu >= 3 || cws >= 2) {
      considerations.push({ key: "npdr_mod", label: "Moderate non-proliferative diabetic retinopathy features", likelihood: "possible", severity: "moderate", evidence: ["microaneurysms/haemorrhages/exudates"] });
      raise("moderate", "soon"); refer("Ophthalmology", "soon", "Moderate NPDR features"); investigations.push("OCT");
      evidence.push("microaneurysms=" + ma, "haemorrhages=" + hem);
    } else if (ma >= 1 || hem >= 1) {
      considerations.push({ key: "npdr_mild", label: "Mild non-proliferative diabetic retinopathy features", likelihood: "possible", severity: "mild", evidence: ["microaneurysms present"] });
      raise("mild", "routine"); evidence.push("microaneurysms=" + ma);
    }
    if (diabetic && !considerations.length) considerations.push({ key: "dm_screen", label: "Diabetic — no retinopathy features detected this scan", likelihood: "possible", severity: "none", evidence: ["diabetic history"] });

    // Diabetic macular oedema.
    if (mac.edema) { considerations.push({ key: "dme", label: "Possible macular oedema", likelihood: "possible", severity: "moderate", evidence: ["macula oedema flag"] }); raise("moderate", "urgent"); refer("Retina specialist", "urgent", "Possible macular oedema (sight-threatening)"); if (investigations.indexOf("OCT") < 0) investigations.push("OCT"); }

    // Glaucoma suspicion from cup-disc ratio.
    if (cdr != null && cdr >= 0.7) { considerations.push({ key: "glaucoma_high", label: "Enlarged cup–disc ratio — glaucoma suspect", likelihood: "likely", severity: "moderate", evidence: ["cup_disc_ratio=" + cdr] }); raise("moderate", "soon"); refer("Ophthalmology", "soon", "Glaucoma suspect (CDR " + cdr + ")"); investigations.push("Intraocular pressure", "Visual field testing"); evidence.push("cup_disc_ratio=" + cdr); }
    else if (cdr != null && cdr >= 0.6) { considerations.push({ key: "glaucoma_borderline", label: "Borderline cup–disc ratio", likelihood: "possible", severity: "mild", evidence: ["cup_disc_ratio=" + cdr] }); raise("mild", "routine"); refer("Ophthalmology", "routine", "Borderline CDR — baseline glaucoma assessment"); }

    // Disc oedema — potential emergency (raised ICP / papilloedema).
    if (od.edema) { considerations.push({ key: "disc_edema", label: "Optic disc swelling — evaluate for raised intracranial pressure / papilloedema", likelihood: "possible", severity: "severe", evidence: ["optic disc oedema flag"] }); raise("severe", "emergency"); refer("Emergency / Neurology + Ophthalmology", "emergency", "Disc swelling — exclude raised ICP"); investigations.push("Blood pressure", "Neuroimaging (CT/MRI brain)"); safetyFlags.push("possible_emergency_evaluate_urgently"); }

    // Hypertensive retinopathy context.
    if (hypertensive && (hem >= 1 || cws >= 1)) { considerations.push({ key: "htn_retinopathy", label: "Hypertensive retinopathy features", likelihood: "possible", severity: "mild", evidence: ["haemorrhages/cotton-wool spots + hypertension"] }); raise("mild", "soon"); if (investigations.indexOf("Blood pressure") < 0) investigations.push("Blood pressure"); }

    // Missing data + investigation suggestions.
    if (diabetic && hba1c == null) missingData.push("HbA1c");
    if (patient.sbp == null && (hypertensive || considerations.some(function (c) { return c.key === "htn_retinopathy"; }))) missingData.push("Blood pressure");
    if (!patient.age && !patient.dob) missingData.push("Age");

    // Confidence engine (continuous): model × image-quality × data-completeness.
    var qFactor = quality == null ? 0.8 : clamp01(quality / 100);
    var completeness = clamp01(1 - missingData.length * 0.1);
    var confidence = clamp01(modelConf * (0.5 + 0.5 * qFactor) * (0.6 + 0.4 * completeness));
    if (quality != null && quality < 50) { safetyFlags.push("poor_image_quality"); confidence = clamp01(confidence * 0.6); }
    if (confidence < 0.5) safetyFlags.push("clinician_review_required");
    if (findingsWrap && findingsWrap.findings && findingsWrap.findings.is_mock) safetyFlags.push("simulated_findings_not_diagnostic");

    var followUp = { interval: FOLLOWUP[urgency] || FOLLOWUP[severity] || "12 months", reason: "Based on highest severity/urgency of detected features" };
    var primary = considerations.length ? considerations.slice().sort(function (a, b) { return SEV.indexOf(b.severity) - SEV.indexOf(a.severity); })[0] : null;

    return {
      schemaVersion: SCHEMA_VERSION, engine: "clinical", engineVersion: VERSION, advisory: true,
      provider: "rules", generatedAt: (typeof Date !== "undefined" ? Date.now() : 0),
      primaryConsideration: primary ? primary.key : "none", label: primary ? primary.label : "No significant features detected",
      considerations: considerations, severity: severity, urgency: urgency,
      referral: referral, followUp: followUp, investigations: investigations,
      safetyFlags: safetyFlags, missingData: missingData, confidence: +confidence.toFixed(2), evidence: evidence,
      disclaimer: "Advisory clinical decision support from a rule-based engine. Not a diagnosis. A qualified clinician must review all findings and recommendations."
    };
  }

  var rulesProvider = { id: "rules", provider: "rules", version: VERSION, available: function () { return true; }, assess: function (f, p) { return assessRules(f, p); } };
  // Cloud clinical provider — posts to the FundX backend (/api/fundx/clinical), which routes
  // to the active server-side LLM (Vertex/Gemini, Cerebras) and returns a schema-validated
  // ClinicalAssessment. Registered but INACTIVE (rules stay active) until enabled + the
  // backend has credentials; the router below validates + falls back to rules on any failure.
  var backendProvider = {
    id: "backend", provider: "backend", version: "server", available: function () { return typeof fetch === "function"; },
    assess: function (findingsWrap, patient) {
      var f = (findingsWrap && findingsWrap.findings) ? findingsWrap.findings : (findingsWrap || {});
      return fetch("/api/fundx/clinical", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ findings: f, patient: patient || {} }) })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { return j.assessment || j; });
    }
  };
  var providers = { rules: rulesProvider, backend: backendProvider }, activeId = "rules";

  function validate(a) {
    var errors = [];
    if (!a || typeof a !== "object") return { ok: false, errors: ["not_object"] };
    ["schemaVersion", "engine", "severity", "urgency", "confidence", "advisory", "disclaimer"].forEach(function (k) { if (a[k] == null) errors.push("missing:" + k); });
    if (a.engine !== "clinical") errors.push("engine");
    if (URG.indexOf(a.urgency) < 0) errors.push("urgency");
    if (SEV.indexOf(a.severity) < 0) errors.push("severity");
    return { ok: errors.length === 0, errors: errors };
  }

  // ---- Clinical report assembly (README 09) -------------------------------
  // Assembles a structured, exportable report from a ScanRecord + its ClinicalAssessment. Pure
  // presentation-of-data — NO new inference. If the record has no stored assessment, the rule
  // engine is run on its findings. Differential is ranked (most severe / most likely first).
  var LIKELY = ["unlikely", "possible", "likely"];
  function buildReport(record, opts) {
    record = record || {}; opts = opts || {};
    var vision = record.vision || {}, findings = vision.findings || {};
    var quality = record.quality || {};
    var assessment = record.clinical || (opts.assess === false ? null : assessRules(vision, record.patientContext || {}));
    var considerations = (assessment && assessment.considerations) || [];
    var differential = considerations.slice().sort(function (a, b) {
      var s = SEV.indexOf(b.severity) - SEV.indexOf(a.severity);
      return s !== 0 ? s : (LIKELY.indexOf(b.likelihood) - LIKELY.indexOf(a.likelihood));
    }).map(function (c, i) { return { rank: i + 1, key: c.key, label: c.label, likelihood: c.likelihood, severity: c.severity, reasoning: (c.evidence || []).join("; ") }; });
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: (typeof Date !== "undefined" ? Date.now() : 0),
      patient: record.patientContext || { ref: null, name: null },
      eye: record.eye || (record.acquisition && record.acquisition.eye) || null,
      timestamp: record.timestamp || null,
      acquisitionQuality: { score: quality.overall != null ? quality.overall : null, accepted: !!quality.accepted, retinalGate: quality.retinalGate !== false },
      findings: findings,
      differential: differential,
      severity: assessment ? assessment.severity : "none",
      urgency: assessment ? assessment.urgency : "routine",
      confidence: assessment ? assessment.confidence : null,
      recommendations: assessment ? { referral: assessment.referral, followUp: assessment.followUp, investigations: assessment.investigations || [] } : null,
      urgentFindings: ((assessment && assessment.safetyFlags) || []).filter(function (s) { return /emergency|urgent/.test(s); }),
      safetyFlags: assessment ? assessment.safetyFlags : [],
      evidence: assessment ? assessment.evidence : [],
      disclaimer: (assessment && assessment.disclaimer) || "For educational purposes only. Advisory only, not a diagnosis. A qualified clinician must review all findings.",
      clinicianReview: record.clinicianReview || null
    };
  }

  // ---- Clinician oversight (README 09: accept / reject / edit / comment) ---
  // The final record belongs to the clinician. Pure state transitions on a review object; the
  // caller persists the returned review onto the ScanRecord.
  function newReview() { return { status: "pending", note: "", editedConclusion: null, reviewedBy: null, reviewedAt: null, history: [] }; }
  function applyReview(review, action, payload, meta) {
    review = review || newReview(); payload = payload || {}; meta = meta || {};
    var now = (typeof Date !== "undefined" ? Date.now() : 0);
    var r = { status: review.status, note: review.note, editedConclusion: review.editedConclusion, reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt, history: (review.history || []).slice() };
    switch (action) {
      case "accept": r.status = "accepted"; break;
      case "reject": r.status = "rejected"; break;
      case "comment": r.note = String(payload.note || ""); break;
      case "edit": r.editedConclusion = String(payload.text || ""); r.status = "edited"; break;
      default: return review;
    }
    r.reviewedBy = meta.by || review.reviewedBy || "clinician"; r.reviewedAt = now;
    r.history.push({ action: action, at: now, by: r.reviewedBy });
    return r;
  }

  var API = {
    VERSION: VERSION, SCHEMA_VERSION: SCHEMA_VERSION,
    buildReport: buildReport, newReview: newReview, applyReview: applyReview,
    register: function (p) { if (p && p.id) providers[p.id] = p; return p; },
    list: function () { return Object.keys(providers); },
    get: function (id) { return providers[id] || null; },
    setActive: function (id) { if (providers[id]) { activeId = id; return true; } return false; },
    getActive: function () { return providers[activeId] || rulesProvider; },
    health: function () { return Object.keys(providers).map(function (id) { var p = providers[id]; return { id: id, provider: p.provider, version: p.version, available: !!(p.available && p.available()), active: id === activeId }; }); },
    validate: validate,
    // Route → active clinical provider → validate → fall back to rules. Always resolves
    // with a valid, advisory ClinicalAssessment.
    assess: function (findings, patient) {
      var active = API.getActive();
      function toRules(reason) { var a = assessRules(findings, patient); if (reason) a.fallback = { from: activeId, reason: reason }; return a; }
      try {
        if (activeId === "rules" || !active.available || !active.available()) return Promise.resolve(toRules(active.available && !active.available() ? "unavailable" : null));
        return Promise.resolve(active.assess(findings, patient)).then(function (a) {
          if (!validate(a).ok) return toRules("invalid_response");
          return a;
        }).catch(function (e) { return toRules(e && e.message || "error"); });
      } catch (e) { return Promise.resolve(toRules(e && e.message || "error")); }
    },
    // synchronous rule-based assessment (used by the UI when the active provider is rules)
    assessSync: function (findings, patient) { return assessRules(findings, patient); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_FUNDX_CLINICAL = API;
})();
