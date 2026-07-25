/* kardiox-acs.js — KardioX AI · optional ACS clinical-context (SMD_KARDIOX_ACS).
 *
 * OPTIONAL panel on the KardiQ X result: the clinician adds chest-pain characteristics, labs
 * (troponin), history + CAD risk factors; the module computes the validated HEART and TIMI
 * (UA/NSTEMI) scores, using the KardiQ X ECG read as the ECG component, and returns NSTEMI/STEMI
 * DECISION SUPPORT — never a diagnosis.
 *
 * Non-negotiable clinical rules encoded here:
 *   1. STEMI OVERRIDES everything — if the deterministic STEMI detector fired, that is a time-critical,
 *      cath-lab finding; NO score can downgrade or "reassure" past it.
 *   2. Troponin is the ARBITER for NSTEMI — a definitive MI dx needs troponin; ECG + scores are
 *      risk stratification. A single negative troponin does NOT exclude NSTEMI (serial required).
 *   3. Validated published scores (HEART, TIMI) — no proprietary "AI diagnosis" of NSTEMI.
 *   4. Decision-support framing throughout; cite the pathway; never definitive.
 *
 * ADDITIVE + non-breaking. Flag-gated by `smd_kardiox_acs` (DEFAULT OFF) — when off, this module is a
 * no-op. Pure scoring is DOM-free + testable in node; UI is defensive (try/catch, never throws into the
 * host). node + browser. Exposed as window.SMD_KARDIOX_ACS.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Scoring — validated point tables (keep exact; clinical-safety critical)
  // ---------------------------------------------------------------------------

  // HEART score (Six/Backus): History, ECG, Age, Risk factors, Troponin. Each 0–2, total 0–10.
  function heart(i) {
    i = i || {};
    var comp = {};
    // History: 0 slightly / 1 moderately / 2 highly suspicious
    comp.history = ({ slightly: 0, moderately: 1, highly: 2 })[i.history] || 0;
    // ECG: 0 normal / 1 non-specific repolarization / 2 significant ST deviation
    comp.ecg = ({ normal: 0, nonspecific: 1, stDeviation: 2 })[i.ecg] || 0;
    // Age: <45=0, 45–64=1, >=65=2
    var age = num(i.age);
    comp.age = age == null ? 0 : age >= 65 ? 2 : age >= 45 ? 1 : 0;
    // Risk factors: prior atherosclerotic disease -> 2; else 3+ factors -> 2; 1–2 -> 1; 0 -> 0
    var rf = countRiskFactors(i);
    comp.risk = i.atheroscleroticDisease ? 2 : rf >= 3 ? 2 : rf >= 1 ? 1 : 0;
    // Troponin: <=1x ULN = 0, 1–3x = 1, >3x = 2 (uses the ratio-to-ULN when supplied)
    comp.troponin = tropRatioBand(i);
    var total = comp.history + comp.ecg + comp.age + comp.risk + comp.troponin;
    var band = total <= 3 ? "low" : total <= 6 ? "moderate" : "high";
    var mace = { low: "~1.7% 6-wk MACE", moderate: "~16.6% 6-wk MACE", high: "~50% 6-wk MACE" }[band];
    return { total: total, band: band, components: comp, mace: mace };
  }

  // TIMI risk score for UA/NSTEMI (Antman): 7 criteria, 1 point each, 0–7.
  function timi(i) {
    i = i || {};
    var c = {};
    c.age65 = num(i.age) != null && num(i.age) >= 65 ? 1 : 0;
    c.risk3 = countRiskFactors(i) >= 3 ? 1 : 0;                 // >=3 CAD risk factors
    c.knownCAD = i.knownCAD ? 1 : 0;                            // stenosis >=50%
    c.aspirin = i.aspirin7d ? 1 : 0;                            // ASA in prior 7 days
    c.angina2 = i.angina2in24h ? 1 : 0;                         // >=2 anginal episodes / 24h
    c.stDev = i.stDeviation05 ? 1 : 0;                          // ST deviation >= 0.5mm
    c.marker = tropPositive(i) ? 1 : 0;                         // elevated troponin
    var total = c.age65 + c.risk3 + c.knownCAD + c.aspirin + c.angina2 + c.stDev + c.marker;
    var riskMap = ["4.7%", "4.7%", "8.3%", "13.2%", "19.9%", "26.2%", "40.9%", "40.9%"];
    return { total: total, components: c, risk14d: riskMap[total] + " 14-day death/MI/urgent-revasc" };
  }

  function countRiskFactors(i) {
    var keys = ["htn", "dyslipidemia", "diabetes", "smoker", "familyHx", "obesity"];
    var n = 0; keys.forEach(function (k) { if (i[k]) n++; });
    return n;
  }
  function num(x) { if (x === null || x === undefined || x === "") return null; x = +x; return isFinite(x) ? x : null; }
  // troponin ratio-to-ULN -> HEART band (0/1/2). Accepts i.tropRatio (value/ULN) or i.tropStatus.
  function tropRatioBand(i) {
    var r = num(i.tropRatio);
    if (r != null) return r > 3 ? 2 : r > 1 ? 1 : 0;
    if (i.tropStatus === "high") return 2;
    if (i.tropStatus === "mild") return 1;
    return 0; // normal or unknown -> 0 (documented; unknown is treated as not-elevated for the score)
  }
  function tropPositive(i) {
    var r = num(i.tropRatio);
    if (r != null) return r > 1;
    return i.tropStatus === "high" || i.tropStatus === "mild";
  }
  function tropStatus(i) {
    var r = num(i.tropRatio);
    if (r != null) return r > 1 ? "positive" : "negative";
    if (i.tropStatus === "high" || i.tropStatus === "mild") return "positive";
    if (i.tropStatus === "normal") return "negative";
    return "unknown";
  }

  // ---------------------------------------------------------------------------
  // ECG component from the KardiQ X read (auto-fill; clinician can override)
  // ---------------------------------------------------------------------------
  // ctx.verdict = the KardiQ X result object; ctx.stemi = SMD_KARDIOX_STEMI result (or null).
  function ecgComponent(ctx) {
    ctx = ctx || {};
    var stemi = ctx.stemi;
    if (stemi && stemi.fired) return "stDeviation"; // significant ST deviation (STEMI)
    var v = ctx.verdict || {};
    var text = ((v.verdict || "") + " " + (v.clinicalInterpretation || "") + " " +
      (v.findings || []).map(function (f) { return f.title || ""; }).join(" ")).toLowerCase();
    if (/st[ -]?elevation|st[ -]?depression|significant st|injury current/.test(text)) return "stDeviation";
    if (/ischaem|ischem|st-?t|t[ -]?wave|repolar|nonspecific|non-specific/.test(text)) return "nonspecific";
    return "normal";
  }

  // ---------------------------------------------------------------------------
  // Master assessment + SAFETY OVERRIDES
  // ---------------------------------------------------------------------------
  function assess(clinical, ctx) {
    clinical = clinical || {}; ctx = ctx || {};
    // ECG component: use the clinician's explicit choice if set, else auto from the AI read.
    if (!clinical.ecg) clinical.ecg = ecgComponent(ctx);
    var h = heart(clinical);
    var t = timi(clinical);
    var trop = tropStatus(clinical);
    var stemiFired = !!(ctx.stemi && ctx.stemi.fired);

    var category, severity, pathway, priority;
    if (stemiFired) {
      // RULE 1 — STEMI overrides everything.
      category = "Possible STEMI";
      severity = "urgent"; priority = 1;
      pathway = "Time-critical: this ECG meets STEMI criteria" +
        (ctx.stemi.territory ? " (" + ctx.stemi.territory + ")" : "") +
        ". Activate the STEMI / primary-PCI pathway per protocol. Clinical scores below do NOT downgrade this.";
    } else if (trop === "positive") {
      // RULE 2 — troponin positive + no STEMI -> NSTEMI consideration.
      category = "Possible NSTEMI";
      severity = "urgent"; priority = 2;
      pathway = "Troponin-positive without ST-elevation. Correlate with the troponin trend (serial/delta) and " +
        "clinical picture; manage as NSTE-ACS and involve cardiology per the ESC/ACC NSTE-ACS pathway.";
    } else if (h.band === "high" || t.total >= 5) {
      category = "High-risk chest pain";
      severity = "warn"; priority = 3;
      pathway = "High-risk (HEART " + h.total + "/" + t.total + " TIMI). Admit / early invasive consideration; " +
        "obtain SERIAL troponin — a single negative troponin does NOT exclude NSTEMI.";
    } else if (h.band === "moderate" || t.total >= 2) {
      category = "Moderate-risk chest pain";
      severity = "warn"; priority = 4;
      pathway = "Moderate risk (HEART " + h.total + ", TIMI " + t.total + "). Observe with serial troponin per the HEART pathway before disposition.";
    } else if (h.band === "low" && t.total <= 1 && trop !== "unknown") {
      category = "Low-risk chest pain";
      severity = "info"; priority = 5;
      pathway = "Low risk (HEART " + h.total + ", TIMI " + t.total + ", troponin " + trop + "). The HEART pathway supports " +
        "considering discharge with early follow-up — clinical judgment governs; safety-net advice given.";
    } else {
      category = "Indeterminate — clinical correlation";
      severity = "warn"; priority = 4;
      pathway = "Insufficient data for confident stratification (troponin " + trop + "). Correlate clinically; obtain/repeat troponin.";
    }

    return {
      category: category, severity: severity, priority: priority, pathway: pathway,
      stemiOverride: stemiFired, troponin: trop, heart: h, timi: t,
      disclaimer: "DECISION SUPPORT, not a diagnosis. NSTEMI requires troponin; STEMI is time-critical and " +
        "overrides these scores. Confirm on the original 12-lead ECG and correlate clinically."
    };
  }

  // ---------------------------------------------------------------------------
  // UI — optional dialog + result panel + self-mount (all defensive)
  // ---------------------------------------------------------------------------
  function flagOn() {
    try {
      var F = window.SMD_KARDIOX_FLAGS;
      if (!F) return false;
      var v = typeof F.get === "function" ? F.get("smd_kardiox_acs") : F.smd_kardiox_acs;
      return !!v;
    } catch (e) { return false; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function openDialog(ctx, onDone) {
    if (typeof document === "undefined") return;
    try {
      var pre = ecgComponent(ctx);
      var wrap = document.createElement("div");
      wrap.className = "kx-acs-sheet"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Add clinical context");
      wrap.innerHTML =
        '<div class="kx-acs-card">' +
        '<h3>Clinical context (optional)</h3>' +
        '<p class="kx-acs-note">Improves ACS risk stratification. NSTEMI needs troponin; STEMI on ECG overrides all scores. Decision support, not a diagnosis.</p>' +
        field("Chest pain", sel("history", [["slightly", "Slightly suspicious"], ["moderately", "Moderately suspicious"], ["highly", "Highly suspicious"]])) +
        field("ECG read (auto from AI)", sel("ecg", [["normal", "Normal"], ["nonspecific", "Non-specific ST-T"], ["stDeviation", "Significant ST deviation"]], pre)) +
        field("Age", '<input type="number" data-k="age" min="0" max="120" inputmode="numeric">') +
        field("Troponin (× upper limit of normal)", '<input type="number" data-k="tropRatio" step="0.1" min="0" inputmode="decimal" placeholder="e.g. 0.5 = normal, 4 = >3x">') +
        '<div class="kx-acs-checks">' +
        chk("htn", "Hypertension") + chk("dyslipidemia", "Dyslipidaemia") + chk("diabetes", "Diabetes") +
        chk("smoker", "Smoker") + chk("familyHx", "Family hx CAD") + chk("obesity", "Obesity") +
        chk("atheroscleroticDisease", "Prior CAD/MI/PCI/CABG/stroke/PAD") + chk("knownCAD", "Known CAD ≥50%") +
        chk("aspirin7d", "Aspirin ≤7d") + chk("angina2in24h", "≥2 angina /24h") + chk("stDeviation05", "ST deviation ≥0.5mm") +
        '</div>' +
        '<div class="kx-acs-actions"><button data-act="cancel" class="kx-acs-btn">Cancel</button><button data-act="calc" class="kx-acs-btn kx-acs-btn--go">Assess</button></div>' +
        '</div>';
      function collect() {
        var o = {};
        wrap.querySelectorAll("[data-k]").forEach(function (el) {
          if (el.type === "checkbox") o[el.getAttribute("data-k")] = el.checked;
          else if (el.value !== "") o[el.getAttribute("data-k")] = el.value;
        });
        return o;
      }
      wrap.addEventListener("click", function (e) {
        var act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
        if (act === "cancel" || e.target === wrap) { close(); }
        else if (act === "calc") {
          var res = assess(collect(), ctx);
          close();
          if (typeof onDone === "function") onDone(res);
        }
      });
      function close() { try { wrap.remove(); } catch (e) { } }
      document.body.appendChild(wrap);
    } catch (e) { /* never break the host */ }
  }
  function field(label, inner) { return '<label class="kx-acs-field"><span>' + esc(label) + '</span>' + inner + '</label>'; }
  function sel(k, opts, val) {
    return '<select data-k="' + k + '">' + opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === val ? " selected" : "") + '>' + esc(o[1]) + '</option>';
    }).join("") + '</select>';
  }
  function chk(k, label) { return '<label class="kx-acs-chk"><input type="checkbox" data-k="' + k + '">' + esc(label) + '</label>'; }

  function renderResult(res) {
    if (typeof document === "undefined" || !res) return null;
    var el = document.createElement("div");
    el.className = "kx-acs-result kx-acs-result--" + res.severity;
    el.innerHTML =
      (res.stemiOverride ? '<div class="kx-acs-stemi">⚠ ' + esc(res.category) + '</div>' : '<div class="kx-acs-cat">' + esc(res.category) + '</div>') +
      '<div class="kx-acs-scores">HEART ' + res.heart.total + '/10 (' + esc(res.heart.band) + ', ' + esc(res.heart.mace) + ') · TIMI ' + res.timi.total + '/7 (' + esc(res.timi.risk14d) + ') · troponin ' + esc(res.troponin) + '</div>' +
      '<div class="kx-acs-path">' + esc(res.pathway) + '</div>' +
      '<div class="kx-acs-disc">' + esc(res.disclaimer) + '</div>';
    return el;
  }

  // Self-mount: when the flag is on, inject an "Add clinical context" button beside the verdict strip.
  function mount(root, ctx) {
    if (typeof document === "undefined" || !flagOn()) return;
    try {
      var strip = (root || document).querySelector(".kx-verdict-strip, .kx-verdict");
      // Guard on the strip element itself (the button is a SIBLING, not a child, so a
      // querySelector INTO strip never matches — that caused an infinite re-insert loop under
      // the MutationObserver). Marking an attribute is a childList no-op, so it won't refire us.
      if (!strip || strip.getAttribute("data-acs-mounted")) return;
      strip.setAttribute("data-acs-mounted", "1");
      var btn = document.createElement("button");
      btn.className = "kx-acs-btn kx-acs-btn--add";
      btn.textContent = "＋ Add clinical context (HEART / TIMI)";
      btn.addEventListener("click", function () {
        openDialog(ctx || currentCtx(), function (res) {
          var out = renderResult(res);
          if (out) { var old = strip.parentNode.querySelector(".kx-acs-result"); if (old) old.remove(); strip.parentNode.insertBefore(out, strip.nextSibling); }
        });
      });
      strip.parentNode.insertBefore(btn, strip.nextSibling);
    } catch (e) { /* no-op */ }
  }
  // Best-effort current-verdict context (host may also pass ctx explicitly to mount()).
  function currentCtx() {
    try { return { verdict: (window.SMD_KARDIOX_STORE && window.SMD_KARDIOX_STORE.last && window.SMD_KARDIOX_STORE.last()) || null, stemi: window.__kx_lastStemi || null }; }
    catch (e) { return {}; }
  }

  var API = { heart: heart, timi: timi, ecgComponent: ecgComponent, assess: assess, openDialog: openDialog, renderResult: renderResult, mount: mount, flagOn: flagOn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") {
    window.SMD_KARDIOX_ACS = API;
    // Auto-mount opportunistically when a verdict appears (flag-gated; observer is cheap + defensive).
    try {
      if (flagOn() && typeof MutationObserver !== "undefined") {
        var obs = new MutationObserver(function () { mount(document); });
        document.addEventListener("DOMContentLoaded", function () { mount(document); obs.observe(document.body, { childList: true, subtree: true }); });
      }
    } catch (e) { }
  }
})();
