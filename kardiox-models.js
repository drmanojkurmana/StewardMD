/* kardiox-models.js — KardioX AI · value types + DTO normalizer (SMD_KARDIOX_MODELS).
 *
 * Serializable value types. `makeAnalysis(raw)` decodes an API/mock payload into a safe ECGAnalysis:
 * forward-compatible (ignores unknown fields; missing fields get sane defaults) per the Networking
 * contract. Also exports the canonical deterministic AF-with-RVR sample used by the mock analyzer and
 * the test suite (matches the README v1 API JSON and screens 06/07 exactly). Pure; node + browser.
 */
(function () {
  "use strict";

  var SEVERITIES = ["critical", "urgent", "warn", "stable", "info"];
  function sev(v) { return SEVERITIES.indexOf(v) >= 0 ? v : "info"; }
  function str(v, d) { return typeof v === "string" ? v : (d || ""); }
  // null/undefined/"" are ABSENT, not zero — coercing them via +v would turn a missing
  // measurement into a fabricated "0 bpm / 0 ms". Only a real finite number passes through.
  function numOr(v, d) { if (v == null || v === "") return d == null ? null : d; v = +v; return isFinite(v) ? v : (d == null ? null : d); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (isFinite(n) ? n : 0); }

  function band(conf) { conf = clamp01(conf); return conf >= 0.85 ? "high" : conf >= 0.6 ? "medium" : "low"; }

  function makeEvidence(e) {
    e = e || {};
    return { lead: str(e.lead), region: Array.isArray(e.region) && e.region.length === 2 ? [+e.region[0], +e.region[1]] : null,
             ruleId: str(e.ruleId), measuredValue: str(e.measuredValue) };
  }
  function makeFinding(f) {
    f = f || {};
    return { id: str(f.id), title: str(f.title), detail: str(f.detail),
             matched: !!f.matched, weight: f.weight == null ? null : +f.weight,
             severity: sev(f.severity), evidence: arr(f.evidence).map(makeEvidence) };
  }
  function makeMorph(m) { m = m || {}; return { label: str(m.label), value: str(m.value) }; }
  function makeDiff(d) { d = d || {}; return { label: str(d.label), probability: clamp01(d.probability) }; }

  function makeMeasurements(m) {
    m = m || {};
    return { ventRateBpm: numOr(m.ventRateBpm, null), rhythm: str(m.rhythm),
             prMs: m.prMs == null ? null : numOr(m.prMs, null), qrsMs: numOr(m.qrsMs, null),
             qtcMs: numOr(m.qtcMs, null), axisDeg: m.axisDeg == null ? null : numOr(m.axisDeg, null),
             perLead: (m.perLead && typeof m.perLead === "object") ? m.perLead : undefined };
  }

  // Normalize any payload → ECGAnalysis. Never throws on partial/unknown input (forward-compatible).
  function makeAnalysis(raw) {
    raw = raw || {};
    var conf = clamp01(raw.confidence);
    return {
      id: str(raw.id) || ("kx-" + (raw.sessionId || "local")),
      createdAt: str(raw.createdAt),
      context: raw.context == null ? undefined : str(raw.context),
      verdict: str(raw.verdict),
      verdictQualifier: raw.verdictQualifier == null ? undefined : str(raw.verdictQualifier),
      // "segmentation" = a technical on-device check (the digitiser ran + found leads) with NO diagnosis;
      // the report screen renders it as an honest validation card, not a diagnostic dashboard.
      reportMode: raw.reportMode === "segmentation" ? "segmentation" : "diagnosis",
      segmentation: raw.segmentation && typeof raw.segmentation === "object" ? {
        detected: numOr(raw.segmentation.detected, 0), total: numOr(raw.segmentation.total, 12),
        leads: arr(raw.segmentation.leads).map(str), hasRhythmStrip: !!raw.segmentation.hasRhythmStrip
      } : undefined,
      severity: sev(raw.severity),
      confidence: conf,
      confidenceBand: raw.confidenceBand && ["low", "medium", "high"].indexOf(raw.confidenceBand) >= 0 ? raw.confidenceBand : band(conf),
      image: raw.image || null,
      leadStripLabel: str(raw.leadStripLabel),
      measurements: makeMeasurements(raw.measurements),
      morphology: arr(raw.morphology).map(makeMorph),
      clinicalInterpretation: str(raw.clinicalInterpretation),
      findings: arr(raw.findings).map(makeFinding),
      differentials: arr(raw.differentials).map(makeDiff),
      redFlag: raw.redFlag && raw.redFlag.title ? { title: str(raw.redFlag.title), body: str(raw.redFlag.body) } : undefined,
      whatToVerify: raw.whatToVerify == null ? undefined : str(raw.whatToVerify),
      educationalRef: raw.educationalRef == null ? undefined : str(raw.educationalRef),
      physicianNote: raw.physicianNote == null ? undefined : str(raw.physicianNote),
      schemaVersion: str(raw.schemaVersion) || "1.0"
    };
  }

  // Canonical deterministic sample (README API spec / screens 06 & 07). Mock analyzer + tests use this.
  var AF_WITH_RVR = {
    schemaVersion: "1.0", sessionId: "mock-af-rvr", createdAt: "Today 08:12", context: "Bed 14 · 12-lead",
    verdict: "Atrial fibrillation", verdictQualifier: "with rapid ventricular response",
    severity: "urgent", confidence: 0.91, confidenceBand: "high",
    leadStripLabel: "LEAD II · 25 mm/s · 10 mm/mV",
    measurements: { ventRateBpm: 128, rhythm: "Irreg. irregular", prMs: null, qrsMs: 92, qtcMs: 468, axisDeg: 42 },
    morphology: [
      { label: "P waves", value: "Absent" },
      { label: "Fibrillatory waves", value: "Present (V1)" },
      { label: "ST-segment", value: "No acute change" },
      { label: "T waves", value: "Non-specific" }
    ],
    findings: [
      { id: "f1", title: "Irregularly irregular R-R", detail: "RR variance 0.31s · leads II, V1", matched: true, weight: 0.34, severity: "urgent",
        evidence: [{ lead: "II", region: [10, 160], ruleId: "RHY-AF-01", measuredValue: "RR variance 0.31s" }] },
      { id: "f2", title: "Absent P waves", detail: "No consistent atrial activity", matched: true, weight: 0.29, severity: "urgent", evidence: [] },
      { id: "f3", title: "Fibrillatory baseline", detail: "f-waves in V1", matched: true, weight: 0.19, severity: "info",
        evidence: [{ lead: "V1", ruleId: "MOR-FWAVE-01", measuredValue: "f-waves" }] }
    ],
    differentials: [
      { label: "Atrial fibrillation", probability: 0.91 },
      { label: "Atrial flutter (variable)", probability: 0.06 },
      { label: "MAT", probability: 0.03 }
    ],
    clinicalInterpretation: "Irregularly irregular narrow-complex tachycardia with absent P waves and a fibrillatory baseline — consistent with atrial fibrillation with RVR. No ST-segment elevation. Borderline QTc; review rate-control agents.",
    redFlag: { title: "Anticoagulation check", body: "New AF with RVR — assess CHA₂DS₂-VASc & rate control. Confirm onset <48h before cardioversion." },
    whatToVerify: "Confirm no flutter waves in inferior leads and correlate with pulse & symptoms.",
    educationalRef: "atrial-fibrillation-01"
  };

  var ANALYSIS_STAGES = ["upload", "enhancement", "digitization", "signalExtraction", "quality", "rhythm",
    "beats", "measurement", "morphology", "st", "ruleValidation", "clinicalExplanation", "report"];

  var API = {
    makeAnalysis: makeAnalysis, makeFinding: makeFinding, band: band,
    SEVERITIES: SEVERITIES, ANALYSIS_STAGES: ANALYSIS_STAGES,
    samples: { afWithRvr: AF_WITH_RVR }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_MODELS = API;
})();
