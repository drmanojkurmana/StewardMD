/* thorex-correlate.js — ThoreX AI · clinical correlation (SMD_THOREX_CORRELATE).
 *
 * Correlates the CXR findings from the CLINICAL (non-educational) engine with clinician-supplied
 * ECG/ABG/labs/vitals to sharpen the differential (e.g. cardiogenic pulmonary edema vs pneumonia vs
 * ARDS). VALIDATION-RELIABLE: a clinician can always enter every value manually (see the "Correlate
 * (ECG/ABG/labs)" section wired into thorex-screens.js's result screen); gather() below is only a
 * best-effort, defensive auto-read that a clinician can freely edit or ignore.
 *
 * De-identification: the `clinicalData` object handled throughout this file is ALWAYS a small set of
 * numeric/enum VALUES (EF %, BNP/NT-proBNP, PCT, CRP, WBC, troponin, ABG, Na/K, temp, SpO2, a short
 * free-text history) — never a name/MRN/DOB/age-as-identifier. That is enforced structurally (the
 * clinicalData model below simply has no identifier-shaped field to fill in), and thorex-llm.js's
 * safeClinicalData() clamps it again defensively before anything is ever POSTed.
 *
 * Educational-engine guarantee: the rule-reasoning engine (reason(), below) reads ONLY the clinical
 * (educational:false) engine's findings — mirrors thorex-report.js's clinicalEngineOf()/
 * clinicalEngine() predicate exactly, duplicated here so this module stays dependency-free/pure.
 * Educational (X-Raydar) findings NEVER drive the differential.
 *
 * Public API:
 *   gather()                              -> clinicalData   (sync, best-effort, NEVER throws)
 *   reason(analysis, clinicalData)         -> { reasoning, differential, insufficientData }  (pure)
 *   correlate(analysis, clinicalData, opts) -> Promise({ reasoning, differential, insufficientData,
 *                                                         narrative, narrativeProvider })
 *
 * Dual export: window.SMD_THOREX_CORRELATE in the browser, module.exports in node (test suite).
 */
(function () {
  "use strict";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function num(v) { if (v == null || v === "") return null; v = +v; return isFinite(v) ? v : null; }

  /* ══════════════════════ Clinical-engine extraction (dependency-free, mirrors thorex-report.js) ═══ */
  function clinicalEngineOf(a) {
    var engines = Array.isArray(a && a.engines) ? a.engines : [];
    for (var i = 0; i < engines.length; i++) if (engines[i] && engines[i].educational === false) return engines[i];
    return null;
  }
  // Every clinical-engine finding label, lower-cased text preserved as-is for regex matching. The
  // educational engine is never consulted here — that IS the "clinical-only" guarantee.
  function clinicalFindingLabels(a) {
    var eng = clinicalEngineOf(a);
    var findings = (eng && Array.isArray(eng.findings)) ? eng.findings : [];
    return findings.map(function (f) { return str(f && f.label); }).filter(Boolean);
  }

  /* ══════════════════════════════ Finding-pattern matchers (pure) ═══════════════════════════════════
   * Small, well-established radiology text patterns — same style/spirit as thorex-report.js's
   * RECOMMENDATION_RULES regex table. */
  var RE_CONSOLIDATION = /pneumonia|consolidation|infiltrate|airspace opacity|lung opacity|air bronchogram/i;
  var RE_EDEMA_WORD = /\bo?edema\b/i;
  var RE_BILATERAL = /\bbilateral\b/i;
  var RE_DIFFUSE_OPACITY = /(opacit|infiltrat|interstitial|ground.?glass|haz(e|iness)|airspace)/i;
  var RE_EFFUSION = /\beffusion\b/i;
  var RE_ARDS_WORD = /\bards\b|diffuse alveolar damage/i;

  function isConsolidation(l) { return RE_CONSOLIDATION.test(l); }
  function isEdemaWord(l) { return RE_EDEMA_WORD.test(l); }
  function isBilateralDiffuse(l) { return RE_BILATERAL.test(l) && RE_DIFFUSE_OPACITY.test(l); }
  function isEffusion(l) { return RE_EFFUSION.test(l); }
  function isARDSWord(l) { return RE_ARDS_WORD.test(l); }

  /* ══════════════════════════════════════ gather() ══════════════════════════════════════════════════
   * Best-effort, SYNCHRONOUS auto-read of a small clinicalData object from whichever other StewardMD
   * modules happen to be loaded, so a clinician opening "Correlate" doesn't have to re-type values that
   * already live elsewhere on the device. Every single access is independently try/catch-guarded —
   * a missing module, a missing field, or a differently-shaped global degrades that ONE field to
   * "just omitted", never to a thrown error and never to a fabricated value.
   *
   * Sources actually wired up today:
   *   - window.ICU_STATE (icu.js) — a real, synchronous, always-present global once the ICU module has
   *     loaded: .vitals[] (temp/spo2, most recent entry), .labs.recent{} (wbc/crp/pct/na/k), .abg{}
   *     (ph/paco2/pao2/hco3/lactate). This is the one module that genuinely exposes readable last-value
   *     state synchronously.
   *
   * Sources probed defensively but currently NO-OP (kept for forward-compatibility, not fabricated):
   *   - window.SMD_KARDIOX_STORE (kardiox-store.js) — an async/IndexedDB-backed encrypted store with NO
   *     synchronous accessor and NO ejection-fraction field in kardiox-models.js today; the probe below
   *     only fires if a future version adds a synchronous `peekLastSync()` returning a plain (non-
   *     Promise) object with an `ef`/`ejectionFraction` number.
   *   - window.ELYTE (electrolytes.js) — exposes only pure analyze*() functions (Na/K/Ca/Mg/etc.
   *     correction math given explicit inputs), not a store of the last-entered values, so there is
   *     nothing safe to auto-read from it; ICU_STATE.labs.recent already carries Na/K for the same
   *     patient in this app, so it is not duplicated here.
   */
  function gather() {
    var out = {};
    try {
      var S = (typeof window !== "undefined") ? window.ICU_STATE : null;
      if (S && typeof S === "object") {
        try {
          var vitals = Array.isArray(S.vitals) ? S.vitals : [];
          var lastV = vitals.length ? vitals[vitals.length - 1] : null;
          if (lastV) {
            if (isNum(lastV.temp)) out.temp = lastV.temp;
            if (isNum(lastV.spo2)) out.spo2 = lastV.spo2;
          }
        } catch (e) {}
        try {
          var L = (S.labs && S.labs.recent) || {};
          if (isNum(L.wbc)) out.wbc = L.wbc;
          if (isNum(L.crp)) out.crp = L.crp;
          if (isNum(L.pct)) out.pct = L.pct;
          if (isNum(L.na)) out.na = L.na;
          if (isNum(L.k)) out.k = L.k;
        } catch (e) {}
        try {
          var G = S.abg || {};
          var abg = {};
          if (isNum(G.ph)) abg.ph = G.ph;
          if (isNum(G.pao2)) abg.po2 = G.pao2;
          if (isNum(G.paco2)) abg.pco2 = G.paco2;
          if (isNum(G.hco3)) abg.hco3 = G.hco3;
          if (isNum(G.lactate)) abg.lactate = G.lactate;
          if (Object.keys(abg).length) out.abg = abg;
        } catch (e) {}
      }
    } catch (e) {}

    // Forward-compatible, best-effort hook — currently a no-op (see doc-comment above).
    try {
      var KX = (typeof window !== "undefined") ? window.SMD_KARDIOX_STORE : null;
      if (KX && typeof KX.peekLastSync === "function") {
        var last = KX.peekLastSync();
        if (last && typeof last === "object" && typeof last.then !== "function") {
          var ef = isNum(last.ef) ? last.ef : (isNum(last.ejectionFraction) ? last.ejectionFraction : null);
          if (isNum(ef)) out.ef = ef;
        }
      }
    } catch (e) {}

    return out;
  }

  /* ══════════════════════════════════════ reason() ══════════════════════════════════════════════════
   * Deterministic, load-bearing rule reasoning. Pure (no DOM, no network, no randomness). Reads CXR
   * finding text ONLY from the clinical engine (see clinicalFindingLabels above) and reasons over
   * whatever clinicalData values were actually supplied — never fabricates a missing value.
   *
   * Encoded rules (each cites the exact values it used):
   *   1. Bilateral/edema-pattern opacities + ↑BNP/NT-proBNP + ↓EF + normal PCT
   *        -> favors cardiogenic pulmonary edema over pneumonia.
   *   2. Consolidation + ↑WBC/CRP/PCT (+fever)
   *        -> favors pneumonia / infective etiology.
   *   3. Effusion + ↓EF
   *        -> consider cardiac (heart failure) contribution.
   *   4. Bilateral diffuse opacities + preserved EF + normal natriuretic peptide
   *        -> consider ARDS.
   * If none of the above find enough supporting values, returns the mandated
   * "Insufficient correlating data — enter labs/ABG to refine." message with an empty differential.
   */
  function reason(analysis, clinicalData) {
    var cd = (clinicalData && typeof clinicalData === "object") ? clinicalData : {};
    var labels = clinicalFindingLabels(analysis);

    var candidates = {};
    function add(cond, score, text) {
      if (!candidates[cond]) candidates[cond] = { score: 0, texts: [] };
      candidates[cond].score += score;
      candidates[cond].texts.push(text);
    }

    var hasConsolidation = labels.some(isConsolidation);
    var hasEdemaWord = labels.some(isEdemaWord);
    var hasBilateralDiffuse = labels.some(isBilateralDiffuse) || labels.some(isARDSWord);
    var hasEdemaPattern = hasEdemaWord || hasBilateralDiffuse;
    var hasEffusion = labels.some(isEffusion);

    var ef = num(cd.ef), bnp = num(cd.bnp), ntProBnp = num(cd.ntProBnp), pct = num(cd.pct),
        crp = num(cd.crp), wbc = num(cd.wbc), temp = num(cd.temp);

    // Rule 1 — cardiogenic pulmonary edema vs pneumonia
    if (hasEdemaPattern) {
      var cites1 = [], score1 = 0;
      if (isNum(bnp) && bnp >= 400) { score1 += 2; cites1.push("BNP " + bnp + " pg/mL (elevated)"); }
      if (isNum(ntProBnp) && ntProBnp >= 900) { score1 += 2; cites1.push("NT-proBNP " + ntProBnp + " pg/mL (elevated)"); }
      if (isNum(ef) && ef < 40) { score1 += 2; cites1.push("EF " + ef + "% (reduced)"); }
      if (isNum(pct) && pct < 0.25) { score1 += 1; cites1.push("PCT " + pct + " ng/mL (normal — argues against bacterial infection)"); }
      if (score1 > 0) {
        add("Cardiogenic pulmonary edema", score1,
          "Bilateral/edema-pattern opacities with " + cites1.join(", ") + " favor cardiogenic pulmonary edema over pneumonia.");
      }
    }

    // Rule 2 — pneumonia / infective consolidation
    if (hasConsolidation) {
      var cites2 = [], score2 = 0;
      if (isNum(wbc) && wbc >= 11) { score2 += 1; cites2.push("WBC " + wbc + " x10⁹/L (elevated)"); }
      if (isNum(crp) && crp >= 50) { score2 += 1; cites2.push("CRP " + crp + " mg/L (elevated)"); }
      if (isNum(pct) && pct >= 0.5) { score2 += 2; cites2.push("PCT " + pct + " ng/mL (elevated — supports bacterial infection)"); }
      if (isNum(temp) && temp >= 38) { score2 += 1; cites2.push("temp " + temp + "°C (fever)"); }
      if (score2 > 0) {
        add("Pneumonia / infective consolidation", score2,
          "Consolidation with " + cites2.join(", ") + " favors pneumonia / infective etiology over cardiogenic edema.");
      }
    }

    // Rule 3 — effusion + reduced EF -> consider cardiac
    if (hasEffusion && isNum(ef) && ef < 40) {
      add("Cardiac contribution to effusion", 2,
        "Pleural effusion with EF " + ef + "% (reduced) — consider cardiac (heart failure) contribution.");
    }

    // Rule 4 — ARDS pattern: bilateral diffuse opacities with preserved EF and no elevated natriuretic peptide
    if (hasBilateralDiffuse) {
      var efPreserved = isNum(ef) && ef >= 50;
      var bnpNotElevated = (!isNum(bnp) || bnp < 400) && (!isNum(ntProBnp) || ntProBnp < 900);
      var haveAnyCardiacValue = isNum(ef) || isNum(bnp) || isNum(ntProBnp);
      if (efPreserved && bnpNotElevated && haveAnyCardiacValue) {
        var cites4 = [];
        if (isNum(ef)) cites4.push("EF " + ef + "% (preserved)");
        if (isNum(bnp)) cites4.push("BNP " + bnp + " pg/mL (not elevated)");
        if (isNum(ntProBnp)) cites4.push("NT-proBNP " + ntProBnp + " pg/mL (not elevated)");
        add("ARDS", 2,
          "Bilateral diffuse opacities with " + cites4.join(", ") + " — preserved EF/normal natriuretic peptide argues against cardiogenic edema; consider ARDS.");
      }
    }

    var conditions = Object.keys(candidates);
    if (!conditions.length) {
      return {
        reasoning: ["Insufficient correlating data — enter labs/ABG to refine."],
        differential: [],
        insufficientData: true
      };
    }

    var differential = conditions.map(function (cond) {
      var c = candidates[cond];
      return {
        condition: cond,
        score: c.score,
        confidence: c.score >= 4 ? "High" : c.score >= 2 ? "Medium" : "Low",
        justification: c.texts.join(" ")
      };
    }).sort(function (a, b) { return b.score - a.score; });

    return {
      reasoning: differential.map(function (d) { return d.justification; }),
      differential: differential,
      insufficientData: false
    };
  }

  /* ══════════════════════════════════════ narrative + correlate() ══════════════════════════════════
   * Narrative asks SMD_THOREX_LLM.correlate() for a richer, clinician-readable explanation of the same
   * clinicalData (server routes Groq -> Gemini -> deterministic offline, same as the rest of ThoreX AI).
   * If that module is unavailable, the call itself fails, or the server reports it is running the
   * offline provider, the narrative falls back to the deterministic RULE reasoning text produced above
   * (never thorex-llm.js's own generic offline text) — so a clinician always sees a correlation-specific
   * explanation, never a dead end. Educational findings never reach this path either: the `analysis`
   * passed through is reduced to de-identified finding labels/bands by thorex-llm.js itself, and the
   * differential/reasoning it is explaining were computed from the clinical engine only. */
  function llmModule() {
    try {
      if (typeof window !== "undefined" && window.SMD_THOREX_LLM) return window.SMD_THOREX_LLM;
      if (typeof require === "function") return require("./thorex-llm.js");
    } catch (e) {}
    return null;
  }
  function ruleReasoningText(ruleResult) { return (ruleResult && ruleResult.reasoning || []).join(" "); }

  function narrativeFor(analysis, clinicalData, ruleResult, opts) {
    var fallback = { text: ruleReasoningText(ruleResult), provider: "offline" };
    var LLM = llmModule();
    if (!LLM || typeof LLM.correlate !== "function") return Promise.resolve(fallback);
    return LLM.correlate(analysis, clinicalData, opts)
      .then(function (res) {
        if (!res || !res.text || res.provider === "offline") return fallback;
        return res;
      })
      .catch(function () { return fallback; });
  }

  // correlate(analysis, clinicalData, opts) -> Promise({ reasoning, differential, insufficientData,
  //   narrative, narrativeProvider }). ALWAYS resolves (never rejects) — the rule reasoning is computed
  // synchronously first (so it is always present even if the narrative step fails), then the narrative
  // is layered on top.
  function correlate(analysis, clinicalData, opts) {
    opts = opts || {};
    var ruleResult = reason(analysis, clinicalData);
    return narrativeFor(analysis, clinicalData, ruleResult, opts).then(function (nres) {
      return {
        reasoning: ruleResult.reasoning,
        differential: ruleResult.differential,
        insufficientData: ruleResult.insufficientData,
        narrative: nres.text,
        narrativeProvider: nres.provider
      };
    });
  }

  var API = {
    gather: gather,
    reason: reason,
    correlate: correlate,
    // exposed for tests / debugging only — not part of the documented public surface
    _isConsolidation: isConsolidation,
    _isEdemaWord: isEdemaWord,
    _isBilateralDiffuse: isBilateralDiffuse,
    _isEffusion: isEffusion,
    _clinicalFindingLabels: clinicalFindingLabels
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_CORRELATE = API;
})();
