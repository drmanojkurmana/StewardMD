/* kardiox-vertex.js — KardioX AI · Vertex AI (Gemini) fallback layer (SMD_KARDIOX_VERTEX).
 *
 * A SECONDARY opinion — NEVER the primary diagnostic engine. It is consulted ONLY when the specialist
 * ECG models are uncertain (fusion confidence < 0.70), disagree, the ECG is poor quality, or the pattern
 * is outside the supported diagnosis classes. It NEVER overwrites a high-confidence specialist consensus.
 * Responses are cached (dedupe API calls) and every invocation is logged (audit). If Vertex is
 * unavailable it degrades gracefully — the specialist result is returned with an uncertainty notice,
 * never a failure. The actual model call is backend-gated (Cloudflare Function → Vertex/Gemini, same as
 * MaiK); `caller` is injectable for tests. Additive; does not modify the ensemble/fusion. node + browser.
 */
(function () {
  "use strict";

  var CONFIDENCE_THRESHOLD = 0.70;   // below this fused confidence → consult
  var HIGH_CONSENSUS = 0.85;         // at/above this + agreement → protected, Vertex NOT consulted
  var POOR_QUALITY = 0.5;
  var LABEL = "AI Clinical Reasoning (Secondary Opinion)";

  // Decide whether Vertex should be consulted. Returns {consult, reasons[], protectedConsensus}.
  function shouldConsult(report, ctx) {
    ctx = ctx || {};
    report = report || {};
    var conf = report.confidence != null ? report.confidence : (report.primaryConfidence || 0);
    var quality = ctx.quality != null ? ctx.quality
      : (report.leadQuality && report.leadQuality.overall != null ? report.leadQuality.overall : 1.0);
    var hasFinding = !!(report.differentials && report.differentials.some(function (d) { return d.probability >= 0.5; }));
    var disagree = !!(report.disagreement && report.disagreement.length);
    var agreeStrong = !!(report.agreement && report.agreement.some(function (a) { return a.models && a.models.length >= 2; }));

    // Protect a high-confidence specialist consensus — never even consult (so it can't be second-guessed).
    // BUT poor quality defeats the protection: a consensus on a bad tracing is itself suspect.
    if (agreeStrong && conf >= HIGH_CONSENSUS && !disagree && quality >= 0.7) {
      return { consult: false, reasons: ["high-confidence specialist consensus (>=2 models, conf " + conf.toFixed(2) + ") — Vertex not consulted"], protectedConsensus: true };
    }

    var reasons = [];
    if (hasFinding && conf < CONFIDENCE_THRESHOLD) reasons.push("low fusion confidence in the leading finding (" + conf.toFixed(2) + " < " + CONFIDENCE_THRESHOLD + ")");
    if (disagree) reasons.push("specialist models disagree (" + report.disagreement.length + " diagnosis/es contested)");
    if (quality < POOR_QUALITY) reasons.push("poor ECG quality (leadQuality " + Number(quality).toFixed(2) + ")");
    // out-of-class: no specialist finding on a non-clean / suspected-abnormal ECG (a clean normal ECG is
    // NOT sent — that is a confident-normal, not an unknown pattern).
    if (!hasFinding && (quality < 0.7 || ctx.suspectAbnormal)) reasons.push("no specialist finding on a non-clean/suspicious ECG — possible pattern outside supported classes");

    return { consult: reasons.length > 0, reasons: reasons, protectedConsensus: false };
  }

  function summarizeWaveform(signal) {
    if (!signal || !signal.length) return null;
    var lead = signal[1] || signal[0] || [];          // lead II preferred
    var step = Math.max(1, Math.floor(lead.length / 250)), out = [];
    for (var i = 0; i < lead.length; i += step) out.push(Math.round(lead[i] * 1000) / 1000);
    return out;                                        // ~250-point downsample for the prompt
  }

  // Build the Vertex request: waveform + measurements + EVERY model's output/confidence + patient context.
  function buildRequest(report, ctx) {
    ctx = ctx || {};
    return {
      task: "ecg_secondary_opinion",
      instructions: [
        "Provide a ranked differential diagnosis.",
        "Explain your reasoning step by step.",
        "Identify missing information you would need.",
        "Recommend additional investigations.",
        "State your uncertainty explicitly."
      ],
      ecg: {
        waveformLeadII: summarizeWaveform(ctx.signal),
        measurements: ctx.measurements || report.measurements || null   // HR, PR, QRS, QT/QTc, axis, ST, T
      },
      specialistModels: (report.modelContributions || []).map(function (m) { return { model: m.model, weight: m.weight, diagnoses: m.diagnoses }; }),
      specialistConsensus: { primary: report.primaryDiagnosis, confidence: report.confidence, agreement: report.agreement, disagreement: report.disagreement, emergencyFlags: report.emergencyFlags },
      patient: { age: ctx.age, sex: ctx.sex, symptoms: ctx.symptoms, vitals: ctx.vitals, history: ctx.history }
    };
  }

  function cacheKey(req) {
    try { return JSON.stringify({ p: req.specialistConsensus, m: req.specialistModels, pt: req.patient, meas: req.ecg && req.ecg.measurements }); }
    catch (e) { return "nokey-" + (req && req.specialistConsensus && req.specialistConsensus.primary); }
  }

  function defaultCaller(opts) {
    var base = opts.baseUrl || "/api/kardiox", path = opts.path || "/v1/reason";
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    return function (req) {
      if (!fetchImpl) return Promise.reject(new Error("Vertex backend not configured (no network)"));
      return Promise.resolve(fetchImpl(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }))
        .then(function (r) { if (!r || !r.ok) throw new Error("Vertex HTTP " + (r && r.status)); return r.json(); });
    };
  }

  function makeVertexLayer(opts) {
    opts = opts || {};
    var caller = opts.caller || defaultCaller(opts);
    var cache = opts.cache || {};
    var log = opts.log || [];
    var now = opts.now || function () { return (typeof Date !== "undefined") ? new Date().toISOString() : "t"; };

    function consult(report, ctx) {
      ctx = ctx || {};
      var gate = shouldConsult(report, ctx);
      if (!gate.consult) return Promise.resolve({ consulted: false, reasons: gate.reasons, protectedConsensus: !!gate.protectedConsensus });
      var req = buildRequest(report, ctx), key = cacheKey(req);
      if (cache[key]) { log.push({ at: now(), event: "cache_hit", reasons: gate.reasons }); return Promise.resolve(Object.assign({}, cache[key], { cached: true })); }
      log.push({ at: now(), event: "invoke", reasons: gate.reasons });
      return Promise.resolve().then(function () { return caller(req); }).then(function (resp) {
        resp = resp || {};
        var out = {
          consulted: true, available: true, label: LABEL, source: "vertex-ai", reasons: gate.reasons,
          differential: resp.differential || resp.differentials || [],
          reasoning: resp.reasoning || "",
          missingInformation: resp.missingInformation || resp.missingInfo || [],
          recommendedInvestigations: resp.recommendedInvestigations || resp.investigations || [],
          uncertainty: resp.uncertainty || ""
        };
        cache[key] = out; log.push({ at: now(), event: "success" });
        return out;
      }).catch(function (err) {
        log.push({ at: now(), event: "unavailable", error: String((err && err.message) || err) });
        return {
          consulted: true, available: false, label: LABEL, source: "vertex-ai", reasons: gate.reasons,
          uncertaintyNotice: "Vertex AI secondary opinion unavailable (" + ((err && err.message) || "error") + "). Showing the specialist-model result only; interpret with added uncertainty."
        };
      });
    }

    // Attach the secondary opinion WITHOUT touching the specialist primary/differentials. Adds source
    // attribution to every specialist conclusion + surfaces an uncertainty notice if Vertex was down.
    function mergeIntoReport(report, vr) {
      report.primarySource = "specialist-ensemble";
      (report.differentials || []).forEach(function (d) { if (!d.source) d.source = "specialist:" + ((d.supportingModels || []).join(",") || "ensemble"); });
      if (vr && vr.consulted) report.secondaryOpinion = vr;
      else report.secondaryOpinion = { consulted: false, label: LABEL, source: "vertex-ai", note: (vr && vr.reasons && vr.reasons.join("; ")) || "not consulted (specialist result sufficient)", protectedConsensus: !!(vr && vr.protectedConsensus) };
      if (vr && vr.available === false && vr.uncertaintyNotice) report.uncertaintyNotice = vr.uncertaintyNotice;
      return report;
    }

    return { consult: consult, mergeIntoReport: mergeIntoReport, shouldConsult: shouldConsult, buildRequest: buildRequest, log: log, cache: cache };
  }

  var API = { makeVertexLayer: makeVertexLayer, shouldConsult: shouldConsult, buildRequest: buildRequest, summarizeWaveform: summarizeWaveform, LABEL: LABEL, CONFIDENCE_THRESHOLD: CONFIDENCE_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_VERTEX = API;
})();
