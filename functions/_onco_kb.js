/* StewardMD - ONCQIS Phase J-a: Knowledge Center INGESTION core. PURE: no DOM, no fetch, no I/O,
 * deterministic. Fully unit-tested. This module holds the two pieces that MUST be verifiable in
 * isolation:
 *   J5  the AI-extraction prompt + payload builder + output sanitizer, and
 *   J6  the batch impact categorization (protocolUpdateJob) over an analyzed guideline vs the ACTIVE
 *       Standard Protocols.
 *
 * THE HARD SAFETY RULE (structural, spec, non-negotiable):
 *   UPLOAD -> AI ANALYSIS -> PROPOSED artifacts only. Nothing here EVER mutates an ACTIVE Standard
 *   Protocol, a Treatment Plan, or a live dose. protocolUpdateJob deep-reads the protocols and returns
 *   a fresh Update Impact Report object; the input protocols are never written to (a unit test proves
 *   deep-equality of the inputs before/after). No PHI is ever placed in the AI payload: analyzePayload
 *   carries ONLY { guidelineText, protocolText } - guideline PDF text + Standard Protocol text, never a
 *   patient name/MRN/clinical field (a guard test proves the exact key set + the PHI-field denylist).
 *   Anything the source does not establish becomes the literal "VERIFY" (never invented).
 *
 * window.SMD_ONCOKB + module.exports (UMD; used by the admin route and node --test).
 */
(function (root) {
  "use strict";

  // ---- constants -----------------------------------------------------------------------------
  // Canonical change categories. The five the spec counts explicitly, plus the extra kinds the
  // extractor is asked to surface (supportive care / monitoring / biomarker). "no_material_change"
  // is the honest "nothing actionable" bucket.
  var CHANGE_CATEGORIES = [
    "dose_change", "schedule_change", "new_treatment_option", "indication_change",
    "drug_withdrawal", "supportive_care_change", "monitoring_change", "biomarker_change",
    "no_material_change"
  ];
  // Per-protocol impact statuses (spec J6). Ordered by SEVERITY (highest first) - the resolver picks
  // the most severe status that any relevant change produces.
  var IMPACT_STATUSES = [
    "CLINICAL REVIEW REQUIRED", "EVIDENCE DIVERGENCE", "NEW DRUG", "UPDATE AVAILABLE", "NO CHANGE"
  ];
  // Fields that must NEVER appear in an AI payload. The guard test asserts none of these are present.
  var PHI_DENYLIST = [
    "patientName", "name", "mrn", "ghisPatientId", "patientId", "dob", "dateOfBirth", "age", "sex",
    "gender", "phone", "mobile", "email", "address", "nhsNumber", "aadhaar", "ssn"
  ];

  function _s(v) { return String(v == null ? "" : v); }
  function _clip(v, n) { return _s(v).slice(0, n || 240); }
  function _lc(v) { return _s(v).toLowerCase().trim(); }

  // A value the source does not establish becomes the literal VERIFY - never invented, never dropped.
  function _verify(v) { var s = _s(v).trim(); return s ? s : "VERIFY"; }

  // ---- J5: AI extraction -----------------------------------------------------------------------

  // The EXACT payload sent to the AI. ONLY guideline text + (optional) Standard Protocol text. No
  // other key is ever added here - the whole PHI guarantee rests on this object's shape.
  function analyzePayload(guidelineText, protocolText) {
    return { guidelineText: _s(guidelineText), protocolText: _s(protocolText) };
  }

  // Extraction prompt. Built ONLY from the two payload strings (never a patient field). Asks for a
  // strict JSON object; every change MUST carry an exact sourceLocation (page/section) or the model
  // is told to emit "VERIFY"; anything the document does not establish is "VERIFY", never guessed.
  function extractionPrompt(payload) {
    payload = payload || {};
    var L = [];
    L.push("You are extracting structured facts from an oncology treatment GUIDELINE for a clinical");
    L.push("knowledge-governance system. You are NOT giving medical advice and NOT writing a protocol.");
    L.push("Return ONLY a single JSON object (no prose, no code fence) with this shape:");
    L.push('{ "title": str, "org": str, "version": str, "date": str, "diseaseAreas": [str],');
    L.push('  "changes": [ { "category": one of ' + JSON.stringify(CHANGE_CATEGORIES) + ',');
    L.push('     "description": str, "drug": str|"", "from": str|"", "to": str|"",');
    L.push('     "sourceLocation": "page/section where THIS is stated" } ] }');
    L.push("RULES (non-negotiable):");
    L.push("1. Every change MUST carry an exact sourceLocation (e.g. 'p.42, Table 3' or 'Section 4.2').");
    L.push("   If you cannot cite the exact location, set sourceLocation to \"VERIFY\".");
    L.push("2. Extract ONLY what the document explicitly states: regimens, doses, schedules,");
    L.push("   indications, biomarker criteria, new drugs, discontinued options, supportive-care and");
    L.push("   monitoring changes. Anything the document does not establish => the literal \"VERIFY\".");
    L.push("3. NEVER invent a value, dose, date, org, or citation. Prefer \"VERIFY\" over a guess.");
    L.push("4. This text contains NO patient data; do not fabricate any.");
    L.push("");
    L.push("=== GUIDELINE TEXT ===");
    L.push(_clip(payload.guidelineText, 60000));
    if (payload.protocolText) {
      L.push("");
      L.push("=== CURRENT STEWARDMD STANDARD PROTOCOL (context only; do not modify) ===");
      L.push(_clip(payload.protocolText, 20000));
    }
    return L.join("\n");
  }

  function _normCategory(c) {
    var v = _lc(c).replace(/[\s-]+/g, "_");
    // Tolerate a few common synonyms the model may emit.
    var fix = {
      dose: "dose_change", dosing: "dose_change", schedule: "schedule_change",
      new_drug: "new_treatment_option", new_option: "new_treatment_option",
      withdrawal: "drug_withdrawal", discontinued: "drug_withdrawal", discontinuation: "drug_withdrawal",
      indication: "indication_change", biomarker: "biomarker_change",
      supportive_care: "supportive_care_change", monitoring: "monitoring_change",
      none: "no_material_change", no_change: "no_material_change"
    };
    v = fix[v] || v;
    return CHANGE_CATEGORIES.indexOf(v) > -1 ? v : "no_material_change";
  }

  function _sanitizeChange(c) {
    c = c || {};
    return {
      category: _normCategory(c.category),
      description: _clip(c.description, 400),
      drug: _clip(c.drug, 120),
      from: c.from == null || c.from === "" ? "" : _clip(c.from, 200),
      to: c.to == null || c.to === "" ? "" : _clip(c.to, 200),
      // A change with no cited location is UNVERIFIED - "VERIFY", never silently trusted.
      sourceLocation: _verify(c.sourceLocation)
    };
  }

  // Turn raw (already JSON-parsed) model output into a stored extraction object. Never throws; any
  // missing field becomes "VERIFY"; changes are always an array; each carries a source location.
  function sanitizeExtraction(raw) {
    raw = (raw && typeof raw === "object") ? raw : {};
    var diseases = Array.isArray(raw.diseaseAreas) ? raw.diseaseAreas.map(function (d) { return _clip(d, 120); }).filter(Boolean).slice(0, 40) : [];
    var changes = Array.isArray(raw.changes) ? raw.changes.slice(0, 200).map(_sanitizeChange) : [];
    return {
      title: _verify(raw.title),
      org: _verify(raw.org),
      version: _verify(raw.version),
      date: _verify(raw.date),
      diseaseAreas: diseases,
      changes: changes
    };
  }

  // ---- J6: batch impact (protocolUpdateJob) ---------------------------------------------------

  function _protocolDrugNames(p) {
    p = p || {};
    var drugs = (p.regimen && p.regimen.drugs) || p.drugs || [];
    var out = [];
    for (var i = 0; i < drugs.length; i++) { var n = _lc(drugs[i] && drugs[i].name); if (n) out.push(n); }
    return out;
  }
  function _protocolHasDrug(p, drug) {
    var d = _lc(drug); if (!d) return false;
    var names = _protocolDrugNames(p);
    for (var i = 0; i < names.length; i++) { if (names[i] === d || names[i].indexOf(d) > -1 || d.indexOf(names[i]) > -1) return true; }
    return false;
  }
  // Does this extraction's disease scope touch this protocol? Matches on disease id or a substring of
  // the disease name. Empty diseaseAreas => not disease-scoped (matches nothing on disease alone).
  function _diseaseMatch(extraction, p) {
    p = p || {};
    var pd = [_lc(p.diseaseId), _lc(p.disease)].filter(Boolean);
    var da = (extraction.diseaseAreas || []).map(_lc).filter(Boolean);
    for (var i = 0; i < da.length; i++) for (var j = 0; j < pd.length; j++) {
      if (da[i] === pd[j] || da[i].indexOf(pd[j]) > -1 || pd[j].indexOf(da[i]) > -1) return true;
    }
    return false;
  }
  // A change is RELEVANT to a protocol if it names a drug the protocol uses, OR it is disease-scoped
  // to the protocol's disease (a disease-scoped new drug is relevant even though the protocol doesn't
  // use it yet - that is exactly the NEW DRUG signal).
  function _relevant(extraction, change, p) {
    if (change.drug && _protocolHasDrug(p, change.drug)) return true;
    return _diseaseMatch(extraction, p);
  }
  function _isUnverified(change) {
    return change.sourceLocation === "VERIFY" || change.to === "VERIFY" || change.from === "VERIFY";
  }
  // Status a SINGLE relevant change implies for a protocol (severity order lives in IMPACT_STATUSES).
  function _statusForChange(extraction, change, p) {
    if (change.category === "no_material_change") return "NO CHANGE";
    // Unverified source, or withdrawing a drug the protocol actively uses => a human MUST decide.
    if (_isUnverified(change)) return "CLINICAL REVIEW REQUIRED";
    if (change.category === "drug_withdrawal" && change.drug && _protocolHasDrug(p, change.drug)) return "CLINICAL REVIEW REQUIRED";
    // A verified change that alters a value on a drug/disease the protocol already covers => the
    // guideline DIVERGES from our current protocol; surfaced, never auto-reconciled.
    if ((change.category === "dose_change" || change.category === "schedule_change" ||
         change.category === "indication_change" || change.category === "biomarker_change")) {
      if ((change.drug && _protocolHasDrug(p, change.drug)) || _diseaseMatch(extraction, p)) return "EVIDENCE DIVERGENCE";
    }
    // A new drug/option for this protocol's disease that the protocol does not yet include.
    if (change.category === "new_treatment_option" && !(change.drug && _protocolHasDrug(p, change.drug))) return "NEW DRUG";
    return "UPDATE AVAILABLE";
  }
  function _mostSevere(statuses) {
    for (var i = 0; i < IMPACT_STATUSES.length; i++) { if (statuses.indexOf(IMPACT_STATUSES[i]) > -1) return IMPACT_STATUSES[i]; }
    return "NO CHANGE";
  }

  // Impact of ONE analyzed guideline on ONE protocol. PURE read - never mutates the protocol.
  function impactForProtocol(extraction, p) {
    extraction = extraction || { changes: [] };
    p = p || {};
    var relevant = [], statuses = [];
    (extraction.changes || []).forEach(function (ch) {
      if (!_relevant(extraction, ch, p)) return;
      relevant.push(ch);
      statuses.push(_statusForChange(extraction, ch, p));
    });
    var status = relevant.length ? _mostSevere(statuses) : "NO CHANGE";
    return {
      protocolId: _s(p.id),
      name: _s(p.name),
      disease: _s(p.disease),
      protocolVersion: _s(p.protocolVersion),
      protocolStatus: _s(p.status),
      status: status,
      relevantChanges: relevant
    };
  }

  // J6 batch job: an analyzed guideline vs ALL supplied ACTIVE Standard Protocols -> an Update Impact
  // Report. Only protocols whose status is ACTIVE are compared (never a DRAFT/RETIRED). PURE: the
  // input protocols array + objects are never mutated; a fresh report object is returned. `now` is
  // injectable (Date.now() is not available in some hosts / makes tests deterministic).
  function protocolUpdateJob(extraction, protocols, opts) {
    extraction = sanitizeExtraction(extraction);   // defensive: always operate on a clean shape
    opts = opts || {};
    var all = Array.isArray(protocols) ? protocols : [];
    var active = all.filter(function (p) { return p && _s(p.status).toUpperCase() === "ACTIVE"; });
    var per = active.map(function (p) { return impactForProtocol(extraction, p); });

    // Category counts across the whole extraction (not just matched ones) - spec J6.
    var categoryCounts = {};
    CHANGE_CATEGORIES.forEach(function (c) { categoryCounts[c] = 0; });
    (extraction.changes || []).forEach(function (ch) { categoryCounts[ch.category] = (categoryCounts[ch.category] || 0) + 1; });

    // Per-status protocol tallies.
    var statusCounts = {};
    IMPACT_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
    per.forEach(function (r) { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });

    return {
      kind: "onco-update-impact-report",   // marks this as a PROPOSED artifact, never a protocol
      generatedAt: opts.now || 0,
      extractionId: opts.extractionId != null ? _s(opts.extractionId) : null,
      evidenceId: opts.evidenceId != null ? _s(opts.evidenceId) : null,
      guideline: { title: extraction.title, org: extraction.org, version: extraction.version, date: extraction.date },
      protocolsCompared: active.length,
      protocols: per,
      categoryCounts: categoryCounts,
      statusCounts: statusCounts,
      // A convenience flag the dashboard reads: any protocol needs a human.
      clinicalReviewRequired: statusCounts["CLINICAL REVIEW REQUIRED"] > 0
    };
  }

  var API = {
    CHANGE_CATEGORIES: CHANGE_CATEGORIES,
    IMPACT_STATUSES: IMPACT_STATUSES,
    PHI_DENYLIST: PHI_DENYLIST,
    analyzePayload: analyzePayload,
    extractionPrompt: extractionPrompt,
    sanitizeExtraction: sanitizeExtraction,
    impactForProtocol: impactForProtocol,
    protocolUpdateJob: protocolUpdateJob,
    _version: "1.0"
  };
  if (root) root.SMD_ONCOKB = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
