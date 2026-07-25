/* thorex-correlate.js — ThoreX AI · clinical correlation (SMD_THOREX_CORRELATE).
 *
 * Correlates the CXR findings from the CLINICAL (non-educational) engine with clinician-supplied
 * ECG/ABG/labs/vitals to sharpen the differential (e.g. cardiogenic pulmonary edema vs pneumonia vs
 * ARDS). VALIDATION-RELIABLE: a clinician can always enter every value manually (see the "Correlate
 * (ECG/ABG/labs)" section wired into thorex-screens.js's result screen); gather() below is only a
 * best-effort, defensive auto-read that a clinician can freely edit or ignore.
 *
 * De-identification: the `clinicalData` object handled throughout this file is ALWAYS a small set of
 * numeric/enum/boolean VALUES (EF %, BNP/NT-proBNP, PCT, CRP, WBC, troponin, ABG, Na/K, temp, SpO2, a
 * short free-text history, plus the ECG-finding flags pPulmonale/rvh/rightAxisDeviation) — never a
 * name/MRN/DOB/age-as-identifier. That is enforced structurally (the clinicalData model below simply
 * has no identifier-shaped field to fill in), and thorex-llm.js's safeClinicalData() clamps it again
 * defensively before anything is ever POSTed.
 *
 * KardioX bridge (IMPORTANT — read before touching gather() or the rule engine): KardioX is ECG
 * INTERPRETATION, not echocardiography. Ejection fraction (EF) is an ECHO-derived measurement — KardioX
 * will NEVER produce it, so EF is manual-entry ONLY (there is deliberately no KardioX-EF auto-read
 * below; do not re-add one). The real, clinically-correct KardioX<->ThoreX bridge is ECG FINDINGS: P
 * pulmonale (right atrial enlargement), RVH, and right-axis deviation are the ECG correlates of chronic
 * right-heart strain, which — combined with hyperinflation/emphysema on the CXR — support a COPD with
 * cor pulmonale / pulmonary hypertension read (see the rule engine below). Those three flags are
 * manual-entry checkboxes by default and are also best-effort auto-read from KardioX in gather() below.
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
  // Full clinical-engine finding OBJECTS (label/band/severity), for rules that need to cite the exact
  // finding (e.g. "Emphysema (High)") rather than just its label text. Same clinical-only source as
  // clinicalFindingLabels above — the educational engine is never consulted here either.
  function clinicalFindings(a) {
    var eng = clinicalEngineOf(a);
    return (eng && Array.isArray(eng.findings)) ? eng.findings : [];
  }

  /* ══════════════════════════════ Finding-pattern matchers (pure) ═══════════════════════════════════
   * Small, well-established radiology/ECG text patterns — same style/spirit as thorex-report.js's
   * RECOMMENDATION_RULES regex table. */
  var RE_CONSOLIDATION = /pneumonia|consolidation|infiltrate|airspace opacity|lung opacity|air bronchogram/i;
  var RE_EDEMA_WORD = /\bo?edema\b/i;
  var RE_BILATERAL = /\bbilateral\b/i;
  var RE_DIFFUSE_OPACITY = /(opacit|infiltrat|interstitial|ground.?glass|haz(e|iness)|airspace)/i;
  var RE_EFFUSION = /\beffusion\b/i;
  var RE_ARDS_WORD = /\bards\b|diffuse alveolar damage/i;
  // CXR hyperinflation/emphysema — clinical-engine finding label only (e.g. "Emphysema"). NEVER matched
  // against the educational X-Raydar engine's "hyperexpanded_lungs" — clinicalFindings()/
  // clinicalFindingLabels() already restrict the source to the clinical engine, which is what makes
  // this clinical-only by construction.
  var RE_EMPHYSEMA = /emphysema|hyperinflat/i;
  // ECG right-heart-strain patterns (KardioX findings[].title/detail + morphology[] text) — P pulmonale
  // / right atrial enlargement, and RVH. Right-axis deviation is a numeric threshold on
  // measurements.axisDeg, not a text pattern (see gather() below).
  var RE_P_PULMONALE = /\bp[\s.-]?pulmonale\b|\bright atrial (enlargement|abnormality)\b|\brae\b/i;
  var RE_RVH = /\brvh\b|\bright ventricular hypertroph(y|ic)\b/i;

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
   *   - KardioX ECG findings (P pulmonale / RVH / right-axis deviation) — the correct KardioX<->ThoreX
   *     bridge (see the file-header comment). window.SMD_KARDIOX_STORE (kardiox-store.js) is a fully
   *     async/IndexedDB + WebCrypto-backed encrypted store with NO synchronous accessor at all today
   *     (every method returns a Promise — see kardiox-store.js), and kardiox.js exposes no last-analysis
   *     cache global either, so this is a genuine no-op on the current codebase. The probe below (see
   *     readKardioxAnalysisSync) only fires if a future version starts exposing a synchronous ECGAnalysis
   *     via EITHER (a) a plain cached global (e.g. window.__SMD_KARDIOX_LAST_ANALYSIS), OR (b) a future
   *     synchronous `SMD_KARDIOX_STORE.peekLastSync()`. It never awaits a Promise and never blocks.
   *   - window.ELYTE (electrolytes.js) — exposes only pure analyze*() functions (Na/K/Ca/Mg/etc.
   *     correction math given explicit inputs), not a store of the last-entered values, so there is
   *     nothing safe to auto-read from it; ICU_STATE.labs.recent already carries Na/K for the same
   *     patient in this app, so it is not duplicated here.
   *
   * NOTE — no EF-from-KardioX probe here (and there never should be one): EF is echo-derived and
   * KardioX (ECG interpretation) will never produce it. EF stays manual-entry only.
   */
  // Best-effort, defensive read of a synchronously-available ECGAnalysis (see doc-comment above for why
  // this is currently a no-op on the real app — kept ready for when a sync source exists). NEVER throws;
  // returns null if nothing sync-accessible is found.
  function readKardioxAnalysisSync() {
    try {
      if (typeof window === "undefined") return null;
    } catch (e) { return null; }
    try {
      var direct = window.__SMD_KARDIOX_LAST_ANALYSIS;
      if (direct && typeof direct === "object" && typeof direct.then !== "function") return direct;
    } catch (e) {}
    try {
      var KX = window.SMD_KARDIOX_STORE;
      if (KX && typeof KX.peekLastSync === "function") {
        var last = KX.peekLastSync();
        if (last && typeof last === "object" && typeof last.then !== "function") return last;
      }
    } catch (e) {}
    return null;
  }
  // Scan an ECGAnalysis (kardiox-models.js shape: findings[].{title,detail}, morphology[].{label,value})
  // for right-heart-strain text patterns. Pure text join + regex test — never throws, never fabricates
  // (returns false when nothing matches or the shape is missing/malformed).
  function ecgTextMatches(ecg, re) {
    try {
      var texts = [];
      var findings = Array.isArray(ecg && ecg.findings) ? ecg.findings : [];
      findings.forEach(function (f) {
        if (f && typeof f.title === "string") texts.push(f.title);
        if (f && typeof f.detail === "string") texts.push(f.detail);
      });
      var morph = Array.isArray(ecg && ecg.morphology) ? ecg.morphology : [];
      morph.forEach(function (m) {
        if (m && typeof m.label === "string") texts.push(m.label);
        if (m && typeof m.value === "string") texts.push(m.value);
      });
      return re.test(texts.join(" | "));
    } catch (e) { return false; }
  }
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

    // Forward-compatible, best-effort hook — currently a no-op on the real app (see doc-comment above).
    // The correct KardioX<->ThoreX bridge: ECG FINDINGS (P pulmonale / RVH / right-axis deviation), never
    // EF. Every access below is independently try/catch-guarded; missing/malformed data just omits that
    // one flag — the clinician's manual checkbox entry always fills the gap.
    try {
      var ecg = readKardioxAnalysisSync();
      if (ecg) {
        try { if (ecgTextMatches(ecg, RE_P_PULMONALE)) out.pPulmonale = true; } catch (e) {}
        try { if (ecgTextMatches(ecg, RE_RVH)) out.rvh = true; } catch (e) {}
        try {
          var axisDeg = ecg.measurements && isNum(ecg.measurements.axisDeg) ? ecg.measurements.axisDeg : null;
          if (isNum(axisDeg)) {
            out.axisDeg = axisDeg;
            if (axisDeg > 90) out.rightAxisDeviation = true;
          }
        } catch (e) {}
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
   *   5. Emphysema/hyperinflation (CLINICAL engine only) + P pulmonale / RVH / right-axis deviation
   *        -> consider COPD with cor pulmonale / pulmonary hypertension; recommend PFTs, echo (RV
   *           function / PH), ABG. The ECG flags are the KardioX bridge — see the file-header comment;
   *           EF is never part of this rule (EF is echo-derived, not an ECG finding).
   * If none of the above find enough supporting values, returns the mandated
   * "Insufficient correlating data — enter labs/ABG to refine." message with an empty differential.
   */
  function reason(analysis, clinicalData) {
    var cd = (clinicalData && typeof clinicalData === "object") ? clinicalData : {};
    var labels = clinicalFindingLabels(analysis);
    var findingsFull = clinicalFindings(analysis);

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
    // Clinical-engine-only, per RE_EMPHYSEMA's doc-comment — the educational X-Raydar "hyperexpanded
    // lungs" finding is structurally invisible here (clinicalFindings() only reads the clinical engine).
    var emphysemaFinding = findingsFull.filter(function (f) { return RE_EMPHYSEMA.test(str(f && f.label)); })[0] || null;
    var hasEmphysema = !!emphysemaFinding;

    var ef = num(cd.ef), bnp = num(cd.bnp), ntProBnp = num(cd.ntProBnp), pct = num(cd.pct),
        crp = num(cd.crp), wbc = num(cd.wbc), temp = num(cd.temp);
    // ECG-finding flags — the KardioX bridge (booleans; manual-entry checkboxes, best-effort auto-read
    // in gather()). axisDeg is an optional citation-only numeric (e.g. "axis +105°"); the boolean
    // rightAxisDeviation flag is what actually drives the rule, so a manually-checked box with no
    // axisDeg value still fires it.
    var pPulmonale = !!cd.pPulmonale, rvh = !!cd.rvh, rightAxisDeviation = !!cd.rightAxisDeviation;
    var axisDeg = num(cd.axisDeg);

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

    // Rule 5 — COPD with cor pulmonale / pulmonary hypertension: CXR hyperinflation/emphysema (clinical
    // engine only) + right-heart ECG changes from KardioX (P pulmonale / RVH / right-axis deviation).
    if (hasEmphysema && (pPulmonale || rvh || rightAxisDeviation)) {
      var cites5 = [emphysemaFinding.label + " (" + (emphysemaFinding.band || emphysemaFinding.severity) + ")"];
      var score5 = 2;
      if (pPulmonale) { score5 += 1; cites5.push("P pulmonale"); }
      if (rvh) { score5 += 1; cites5.push("RVH"); }
      if (rightAxisDeviation) {
        score5 += 1;
        cites5.push(isNum(axisDeg) ? ("axis " + (axisDeg > 0 ? "+" : "") + axisDeg + "°") : "right-axis deviation");
      }
      add("COPD with cor pulmonale / pulmonary hypertension", score5,
        "Hyperinflation/emphysema on CXR with right-heart ECG changes (" + cites5.join(", ") + ") suggest COPD with cor pulmonale / pulmonary hypertension. Recommend pulmonary function tests (PFTs), echocardiography (assess RV function / pulmonary hypertension), and arterial blood gas (ABG).");
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
    _clinicalFindingLabels: clinicalFindingLabels,
    _clinicalFindings: clinicalFindings,
    _ecgTextMatches: ecgTextMatches,
    _readKardioxAnalysisSync: readKardioxAnalysisSync
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_CORRELATE = API;
})();
