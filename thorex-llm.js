/* thorex-llm.js — ThoreX AI · "explain & correlate" LLM client (SMD_THOREX_LLM).
 *
 * Client half of the server-side proxy at functions/api/thorex/[[path]].js (POST /api/thorex/llm).
 * Keys NEVER touch the client — this module only ever sends de-identified TEXT to the server, which
 * routes Groq -> Google/Gemini -> deterministic offline and returns { ok, provider, text }.
 *
 * DE-IDENTIFICATION GUARANTEE (read before changing this file):
 *   This module sends ONLY:
 *     - finding label / band / severity / relevance (short strings; no free text from the image)
 *     - the list of ALL findings' labels/bands (same fields, plural)
 *     - any values EXPLICITLY passed in via the `clinicalData` argument to correlate() — the caller
 *       is responsible for those already being de-identified (e.g. lab/ABG bands, not raw reports)
 *   It NEVER sends: the image/blob/dataURL, patient name/MRN/DOB/age-as-identifier, device/location
 *   info, or the raw analysis object as-is (it is always reduced to the safe shape above first).
 *   If you add a new field to what's posted, it MUST go through the same reduction — never spread a
 *   whole object from `analysis` or `clinicalData` directly into the request body.
 *
 * Every function ALWAYS resolves (never rejects) — on any network/HTTP/offline-provider failure it
 * falls back to a deterministic, always-available local explanation so ThoreX never shows a dead end.
 *
 * Public API:
 *   learnMore(finding, analysis, opts) -> Promise({text, provider})
 *   impressionNarrative(analysis)      -> Promise({text, provider})
 *   correlate(analysis, clinicalData)  -> Promise({text, provider})
 *
 * Dual export: window.SMD_THOREX_LLM in the browser, module.exports in node (for the test suite —
 * the network call is injectable via opts.fetchImpl / a global override so tests never hit the network).
 */
(function () {
  "use strict";

  var ENDPOINT = "/api/thorex/llm";

  function str(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
  function clip(s, n) { return str(s).slice(0, n || 200); }

  // Reduce a raw finding (thorex-models.js shape: {label, band, severity, relevance, heatmap}) to the
  // safe, de-identified subset this module is allowed to transmit. Drops `heatmap` (image data) always.
  function safeFinding(f) {
    f = f || {};
    return { label: clip(f.label, 160), band: f.band == null ? null : clip(f.band, 20), severity: clip(f.severity, 20), relevance: clip(f.relevance, 200) };
  }

  // Pull every finding's safe fields out of a CxrAnalysis across ALL engines (label/band only carries
  // no PHI per thorex-models.js — the image itself is never part of this shape).
  function safeFindingsFromAnalysis(analysis) {
    var engines = (analysis && Array.isArray(analysis.engines)) ? analysis.engines : [];
    var out = [];
    engines.forEach(function (e) {
      (Array.isArray(e && e.findings) ? e.findings : []).forEach(function (f) { out.push(safeFinding(f)); });
    });
    return out;
  }

  // Reduce an arbitrary clinicalData object to short de-identified string/number values only — never
  // forwards nested blobs, and truncates aggressively. Caller is expected to have already stripped
  // identifiers; this is a defence-in-depth clamp, not the only guarantee.
  function safeClinicalData(clinicalData) {
    if (!clinicalData || typeof clinicalData !== "object") return null;
    var out = {}, keys = Object.keys(clinicalData).slice(0, 30);
    keys.forEach(function (k) {
      var v = clinicalData[k];
      var key = clip(k, 60);
      out[key] = (v && typeof v === "object") ? clip(JSON.stringify(v), 200) : clip(v, 200);
    });
    return out;
  }

  function idToken() {
    try {
      var u = window.firebase && firebase.auth && firebase.auth().currentUser;
      if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; });
    } catch (e) {}
    return Promise.resolve(null);
  }

  function doFetch(fetchImpl, body, tok) {
    var f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) return Promise.reject(new Error("no fetch available"));
    var headers = { "Content-Type": "application/json" };
    if (tok) headers.Authorization = "Bearer " + tok;
    return f(ENDPOINT, { method: "POST", headers: headers, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
      });
  }

  // POST { kind, finding?, findings?, context? } — ALWAYS the reduced, de-identified shape.
  // Resolves { ok, provider, text } from the server, or throws so the caller can fall back.
  function post(kind, payload, opts) {
    opts = opts || {};
    var body = Object.assign({ kind: kind }, payload);
    return idToken().then(function (tok) {
      return doFetch(opts.fetchImpl, body, tok);
    }).then(function (res) {
      if (res.status !== 200 || !res.data || res.data.ok !== true) throw new Error("thorex-llm HTTP " + res.status);
      return { provider: res.data.provider, text: res.data.text || null };
    });
  }

  /* ══════════════════════════ Deterministic offline fallbacks (ALWAYS available) ══════════════════
   * These never depend on the network or the server — learnMore's fallback is built purely from the
   * finding's own relevance/band; impressionNarrative's/correlate's fall back to the existing
   * deterministic report generator (thorex-report.js) so ThoreX is never left with nothing to show. */
  var BAND_TEXT = {
    High: "the AI flagged this with high confidence",
    Medium: "the AI flagged this with moderate confidence",
    Low: "the AI flagged this with low confidence — treat as a weak signal"
  };
  function offlineLearnMoreText(finding) {
    finding = finding || {};
    var label = finding.label || "This finding";
    var bandText = finding.band && BAND_TEXT[finding.band] ? BAND_TEXT[finding.band] : "the AI's confidence band was not reported";
    var relevance = finding.relevance ? (" It was flagged as " + finding.relevance + ".") : "";
    return label + ": " + bandText + "." + relevance +
      " As with any AI-derived chest X-ray finding, this must be correlated with the patient's history, examination, and other investigations before acting on it — it is educational decision support, not a diagnosis.";
  }
  function reportModule() {
    try { return (typeof window !== "undefined" && window.SMD_THOREX_REPORT) || (typeof require === "function" ? require("./thorex-report.js") : null); } catch (e) { return null; }
  }
  function offlineImpressionText(analysis) {
    var R = reportModule();
    try {
      if (R && R.buildReport) { var rep = R.buildReport(analysis); if (rep && rep.sections && rep.sections.impression) return rep.sections.impression.text; }
    } catch (e) {}
    return "No AI impression is available offline for this analysis.";
  }
  function offlineCorrelateText(analysis, clinicalData) {
    var impression = offlineImpressionText(analysis);
    var ctx = safeClinicalData(clinicalData);
    var ctxLine = (ctx && Object.keys(ctx).length) ? (" Provided clinical context: " + Object.keys(ctx).map(function (k) { return k + "=" + ctx[k]; }).join(", ") + ".") : "";
    return impression + ctxLine + " Correlate the imaging findings with the clinical picture before acting — this is decision support only.";
  }

  /* ══════════════════════════════════════ Public API ═══════════════════════════════════════════ */

  // learnMore(finding, analysis, opts) -> Promise({text, provider})
  //   finding  — a single finding object (thorex-models.js shape); only label/band/severity/relevance
  //              are ever transmitted.
  //   analysis — the full CxrAnalysis, used ONLY to build the de-identified `findings` context list
  //              (labels/bands across every engine) — the image itself never leaves this function.
  function learnMore(finding, analysis, opts) {
    opts = opts || {};
    var safeF = safeFinding(finding);
    var findings = safeFindingsFromAnalysis(analysis);
    return post("learn", { finding: safeF, findings: findings }, opts)
      .then(function (res) {
        var text = res.text;
        if (!text) text = offlineLearnMoreText(safeF);   // offline provider or empty text -> deterministic fallback
        return { text: text, provider: res.provider };
      })
      .catch(function () {
        return { text: offlineLearnMoreText(safeF), provider: "offline" };
      });
  }

  // impressionNarrative(analysis) -> Promise({text, provider})
  function impressionNarrative(analysis, opts) {
    opts = opts || {};
    var findings = safeFindingsFromAnalysis(analysis);
    return post("impression", { findings: findings }, opts)
      .then(function (res) {
        var text = res.text || offlineImpressionText(analysis);
        return { text: text, provider: res.provider };
      })
      .catch(function () {
        return { text: offlineImpressionText(analysis), provider: "offline" };
      });
  }

  // correlate(analysis, clinicalData, opts) -> Promise({text, provider})
  //   clinicalData — OPTIONAL, caller-supplied de-identified values (e.g. lab/ABG bands). This
  //   function reduces it defensively (safeClinicalData) before it is ever included in the request.
  //   Full data-gathering (pulling real de-identified labs/ABG automatically) is a later task; for now
  //   this simply accepts whatever de-identified object the caller already has.
  function correlate(analysis, clinicalData, opts) {
    opts = opts || {};
    var findings = safeFindingsFromAnalysis(analysis);
    var context = safeClinicalData(clinicalData);
    var payload = { findings: findings };
    if (context) payload.context = context;
    return post("correlate", payload, opts)
      .then(function (res) {
        var text = res.text || offlineCorrelateText(analysis, clinicalData);
        return { text: text, provider: res.provider };
      })
      .catch(function () {
        return { text: offlineCorrelateText(analysis, clinicalData), provider: "offline" };
      });
  }

  var API = {
    learnMore: learnMore,
    impressionNarrative: impressionNarrative,
    correlate: correlate,
    // exposed for tests / debugging only — not part of the documented public surface
    _safeFinding: safeFinding,
    _safeFindingsFromAnalysis: safeFindingsFromAnalysis,
    _safeClinicalData: safeClinicalData,
    _offlineLearnMoreText: offlineLearnMoreText
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_LLM = API;
})();
