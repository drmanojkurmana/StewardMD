/* FollowCare AI — Enterprise integration core (Phase 4). PURE, deterministic, no I/O, no network.
 *
 * The buildable heart of Phase 4: turn an episode into an EMR write-back payload (FHIR R4-ish), turn a
 * hospital's discharge CSV into enroll payloads (for sites with no API — MODULE 3), and run no-code
 * automation rules over episode events (MODULE 16/19). The actual EMR/HL7/ADT/WhatsApp CONNECTORS are
 * env-configured adapters that stay OFF until the hospital provides endpoints + credentials — this module
 * is the transport-agnostic logic they carry. window.FollowCareIntegration + module.exports.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  // ---- discharge CSV → enroll payloads (MODULE 3, CSV import) -----------------------------
  // Legacy keyword → pathway table. Kept ONLY as a safety net for environments where the centralized
  // DiagnosisMapper (followcare-diagnosis.js) isn't loaded; the mapper is the real, extensible engine.
  var DX_MAP = [
    [/pneumonia|lrti|chest infection/i, "pneumonia"], [/heart failure|chf|cardiac failure|hfref|hfpef/i, "heart_failure"],
    [/copd|emphysema|chronic bronchitis/i, "copd"], [/dengue/i, "dengue"], [/post.?op|surgery|surgical|laparotomy|arthroplasty/i, "post_op"],
    [/aki|acute kidney|renal failure/i, "aki"], [/stroke|cva|infarct.*brain|tia/i, "stroke"],
    [/diabet|dka|hyperglyc/i, "diabetes"], [/hypertens|htn|bp crisis/i, "hypertension"]
  ];
  // Free-text (+ optional ICD-10) → pathway id. Delegates to the centralized deterministic DiagnosisMapper
  // (ICD-10 first, then normalized text) when present, which falls back to the "generic" pathway so a
  // discharge is NEVER left unmapped — Generic Follow-up must never block enrolment. Returns a concrete
  // pathway id (never null); the legacy table is used only if the mapper module isn't loaded.
  function diagnosisToPathway(text, icd) {
    if (G.FollowCareDiagnosis && G.FollowCareDiagnosis.map) return G.FollowCareDiagnosis.map(text, icd);
    var s = String(text || ""); for (var i = 0; i < DX_MAP.length; i++) if (DX_MAP[i][0].test(s)) return DX_MAP[i][1];
    return "generic";
  }

  // Minimal RFC-4180-ish CSV parser (handles quoted fields + commas/newlines in quotes).
  function parseCSV(text) {
    var rows = [], row = [], field = "", i = 0, inQ = false, s = String(text || "");
    for (; i < s.length; i++) {
      var ch = s[i];
      if (inQ) { if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch === "\r") { /* skip */ }
      else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length && !(r.length === 1 && r[0] === ""); });
  }
  // Parse a discharge CSV → { rows:[enroll payload], errors:[{line,reason}] }. Recognised headers (case/space
  // -insensitive): name, phone/mobile, diagnosis/dx, discharge_date/discharge, mrn, language/lang.
  function fromDischargeCSV(text) {
    var grid = parseCSV(text); if (!grid.length) return { rows: [], errors: [{ line: 0, reason: "empty" }] };
    var head = grid[0].map(function (h) { return String(h).trim().toLowerCase().replace(/\s+/g, "_"); });
    function col(names) { for (var i = 0; i < names.length; i++) { var idx = head.indexOf(names[i]); if (idx >= 0) return idx; } return -1; }
    var cName = col(["name", "patient_name", "patient"]), cPhone = col(["phone", "mobile", "phone_number", "contact"]),
        cDx = col(["diagnosis", "dx", "condition", "disease"]), cDisch = col(["discharge_date", "discharge", "dod", "discharged_on"]),
        cMrn = col(["mrn", "uhid", "hospital_no", "ip_no"]), cLang = col(["language", "lang", "preferred_language"]),
        cIcd = col(["icd", "icd10", "icd_10", "icd_code", "icd10_code"]);
    var out = [], errors = [];
    for (var r = 1; r < grid.length; r++) {
      var g = grid[r], phone = String(cPhone >= 0 ? g[cPhone] : "").replace(/[^\d]/g, ""), dxText = cDx >= 0 ? g[cDx] : "", icd = cIcd >= 0 ? g[cIcd] : "";
      // Every diagnosis resolves to a pathway (specific match or the safe Generic fallback), so an
      // unmapped diagnosis never blocks enrolment — only a missing/invalid phone does.
      var pathwayId = diagnosisToPathway(dxText, icd);
      if (phone.length < 10) { errors.push({ line: r + 1, reason: "missing/invalid phone" }); continue; }
      var dMs = null; if (cDisch >= 0 && g[cDisch]) { var t = Date.parse(g[cDisch]); if (!isNaN(t)) dMs = t; }
      out.push({ pathwayId: pathwayId, name: cName >= 0 ? String(g[cName]).trim() : "", phone: phone, mrn: cMrn >= 0 ? String(g[cMrn]).trim() : "", dischargeMs: dMs, lang: cLang >= 0 ? String(g[cLang]).trim().toLowerCase() : "en" });
    }
    return { rows: out, errors: errors };
  }

  // ---- episode → EMR write-back (MODULE 3, FHIR R4-ish Bundle) ----------------------------
  // A transaction Bundle: CarePlan (the recovery pathway) + Observation per completed check-in (recovery
  // score + escalation) + RiskAssessment (readmission) + Communication (the recommendation). The hospital's
  // EMR already holds the patient identity, so `subjectRef` is a reference the connector fills; we emit no
  // phone/name here. LOINC/SNOMED coding is left as `code.text` in v1 (MODULE 19 coding = later).
  function toFHIR(episode, timeline, opts) {
    opts = opts || {}; episode = episode || {};
    var subject = { reference: opts.subjectRef || ("Patient/" + (opts.emrPatientId || "unknown")) };
    var entries = [];
    entries.push({ resource: { resourceType: "CarePlan", status: episode.status === "recovered" ? "completed" : "active", intent: "plan",
      title: "FollowCare recovery: " + (episode.disease || episode.pathwayId), subject: subject,
      identifier: [{ system: "https://stewardmd.in/followcare/episode", value: episode.episodeId }] } });
    (timeline || []).forEach(function (a) {
      entries.push({ resource: { resourceType: "Observation", status: "final",
        code: { text: "FollowCare recovery score (day " + a.dayOffset + ")" },
        valueInteger: a.score, subject: subject,
        interpretation: [{ text: a.escalation }],
        component: (a.redFlags || []).map(function (f) { return { code: { text: "red flag" }, valueString: f.reason || f.id }; }) } });
    });
    entries.push({ resource: { resourceType: "RiskAssessment", status: "final", subject: subject,
      prediction: [{ outcome: { text: "Readmission" }, qualitativeRisk: { text: episode.risk || "low" } }] } });
    if (opts.recommendation) entries.push({ resource: { resourceType: "Communication", status: "completed", subject: subject, payload: [{ contentString: opts.recommendation }] } });
    return { resourceType: "Bundle", type: "transaction", entry: entries };
  }

  // ---- no-code automation rules (MODULE 16/19) --------------------------------------------
  // A rule = { id, when:{ event, escalationIn?, missedAtLeast?, pathwayIn?, riskIn? }, then:[action] }.
  // evalRules returns the de-duped list of actions whose rule matched the event. Deterministic + data-driven,
  // so a hospital can configure workflows without code (stored per-tenant; falls back to defaultRules()).
  function evalRules(rules, event) {
    event = event || {}; var actions = [], seen = {};
    (rules || []).forEach(function (rule) {
      var w = rule.when || {};
      if (w.event && w.event !== event.type) return;
      if (w.escalationIn && w.escalationIn.indexOf(event.escalation) < 0) return;
      if (w.riskIn && w.riskIn.indexOf(event.risk) < 0) return;
      if (w.pathwayIn && w.pathwayIn.indexOf(event.pathwayId) < 0) return;
      if (typeof w.missedAtLeast === "number" && !((event.missedCount || 0) >= w.missedAtLeast)) return;
      (rule.then || []).forEach(function (a) { if (!seen[a]) { seen[a] = 1; actions.push(a); } });
    });
    return actions;
  }
  function defaultRules() {
    return [
      { id: "red-urgent", when: { event: "assessment", escalationIn: ["red"] }, then: ["notify_doctor", "advise_urgent_care"] },
      { id: "orange-review", when: { event: "assessment", escalationIn: ["orange"] }, then: ["notify_doctor", "book_teleconsult"] },
      { id: "yellow-watch", when: { event: "assessment", escalationIn: ["yellow"] }, then: ["notify_nurse"] },
      { id: "high-risk", when: { event: "assessment", riskIn: ["high", "very_high"] }, then: ["book_teleconsult"] },
      { id: "missed-1", when: { event: "missed", missedAtLeast: 1 }, then: ["send_reminder"] },
      { id: "missed-2", when: { event: "missed", missedAtLeast: 2 }, then: ["create_nurse_task"] },
      { id: "missed-3", when: { event: "missed", missedAtLeast: 3 }, then: ["notify_doctor"] }
    ];
  }

  var API = { diagnosisToPathway: diagnosisToPathway, fromDischargeCSV: fromDischargeCSV, parseCSV: parseCSV, toFHIR: toFHIR, evalRules: evalRules, defaultRules: defaultRules, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareIntegration = API;
})();
