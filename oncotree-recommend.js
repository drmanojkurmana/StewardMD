/* StewardMD - oncotree-recommend.js. ONCOTREE: phenotype -> APPLICABLE existing Standard Protocols.
 *
 * The navigator collects a phenotype (oncotree-engine.js); this maps it to the EXISTING protocol
 * library (kb/protocols/*.json) - it NEVER creates a protocol, never invents a dose, never selects one.
 * It returns the full applicable list, each badged with its lifecycle status, so a DRAFT/experimental
 * protocol is NEVER shown as an approved recommendation (spec: "Never present a DRAFT protocol as an
 * approved clinical recommendation"). Selection + dose stay with the existing protocol/dose engine.
 *
 * Reuses onco-recommend.js matching SEMANTICS (concrete-contradiction excludes; VERIFY/absent/missing
 * => unconfirmed, never silently matched or excluded) but corrected for the runtime protocol shape
 * (treatmentSetting scalar-or-array, intentOptions[], biomarker prose, stage granularity) and for the
 * draft/experimental library (onco-recommend only considers status:ACTIVE; this considers the library
 * the navigator is allowed to show and badges each by lifecycleState/experimental).
 *
 * PURE: no DOM/fetch/window-read/Date/Math.random. window.SMD_ONCOTREE_RECOMMEND + module.exports. */
(function (root) {
  "use strict";

  function asArr(v) { return v == null ? [] : (v instanceof Array ? v : [v]); }
  function norm(v) { return v == null ? null : String(v).trim().toLowerCase(); }

  // Scalar dimension. A protocol that simply does NOT model this field (null/absent) places no
  // constraint => "nc" (not "needs verification" - there is nothing to verify). Only an explicit
  // VERIFY, or a real constraint the phenotype hasn't supplied, is "unconfirmed".
  function scalarDim(protoVal, phenoVal) {
    if (protoVal === "VERIFY") return "unconfirmed";
    if (protoVal == null) return "nc";
    if (phenoVal == null) return "unconfirmed";
    return norm(protoVal) === norm(phenoVal) ? "match" : "exclude";
  }
  // List-membership dimension (stage / intent / setting-as-list). [] = no constraint (nc).
  function listDim(arr, phenoVal, tokenizer) {
    arr = asArr(arr);
    if (arr == null) return "unconfirmed";
    if (!arr.length) return "nc";
    if (arr.indexOf("VERIFY") >= 0) return "unconfirmed";
    if (phenoVal == null) return "unconfirmed";
    var t = tokenizer || norm;
    var want = t(phenoVal), have = arr.map(t);
    return have.indexOf(want) >= 0 ? "match" : "exclude";
  }

  // Coarse stage token so "I" is not falsely excluded by a protocol listing "I (high-risk)".
  function stageToken(s) {
    var n = norm(s); if (!n) return null;
    if (n.indexOf("dcis") >= 0 || /\b0\b/.test(n)) return "0";
    if (/\biv\b/.test(n) || n.indexOf("stage iv") >= 0) return "iv";
    if (/\biii\b/.test(n)) return "iii";
    if (/\bii\b/.test(n)) return "ii";
    if (/\bi\b/.test(n)) return "i";
    return n;
  }

  // Biomarker value -> "positive" | "negative" | null(no clean constraint). Conservative: prose that is
  // not clearly pos/neg (e.g. "tested") yields null so it becomes unconfirmed, never a wrong exclude.
  function normBio(v) {
    var s = norm(v); if (!s) return null;
    if (s.indexOf("negative") === 0) return "negative";
    if (s.indexOf("positive") === 0 || s.indexOf("positive required") >= 0) return "positive";
    return null;
  }
  // HR from an explicit HR key, else derived from ER/PR (either positive => HR+; both negative => HR-).
  function protoHR(bm) {
    if (bm.HR != null) { var h = normBio(bm.HR); if (h) return h; }
    var er = normBio(bm.ER), pr = normBio(bm.PR);
    if (er === "positive" || pr === "positive") return "positive";
    if (er === "negative" && pr === "negative") return "negative";
    return null;
  }
  // protoNorm null => the protocol places no clean constraint on this marker (nc). phenoVal null but a
  // real protocol constraint => unconfirmed (must be verified before it can be confirmed - never a
  // silent match or a silent exclude). Both present => compare.
  function bioDim(protoNorm, phenoVal) {
    if (protoNorm == null) return "nc";
    if (phenoVal == null) return "unconfirmed";
    return protoNorm === norm(phenoVal) ? "match" : "exclude";
  }

  function lifecycleBadge(p) {
    var ls = norm(p.lifecycleState) || (p.status ? norm(p.status) : null);
    // experimental is checked FIRST: a record flagged experimental is NEVER "approved", even if some
    // tool also set lifecycleState:"active" (defensive - a draft must never render as approved).
    if (p.experimental) return { badge: "EXPERIMENTAL DRAFT", approved: false };
    if (ls === "active") return { badge: "ACTIVE", approved: true };
    if (ls === "draft" || ls === null) return { badge: "DRAFT", approved: false };
    if (ls === "superseded") return { badge: "SUPERSEDED", approved: false };
    return { badge: String(ls).toUpperCase(), approved: false };
  }

  // Evaluate one protocol against the phenotype. Returns null if a CONCRETE field contradicts.
  function evaluate(proto, ph) {
    proto = proto || {}; ph = ph || {};
    var unconfirmed = [], matched = {}, count = 0;
    function apply(name, verdict) {
      if (verdict === "exclude") return true;
      if (verdict === "unconfirmed") unconfirmed.push(name);
      else if (verdict === "match") { matched[name] = true; count++; }
      return false;
    }
    if (apply("disease", scalarDim(proto.diseaseId, ph.diseaseId))) return null;
    if (apply("stage", listDim(proto.stage, ph.stage, stageToken))) return null;
    if (apply("setting", listDim(proto.treatmentSetting, ph.setting))) return null;   // scalar-or-array via asArr
    if (apply("intent", listDim(proto.intentOptions || proto.treatmentIntent, ph.intent))) return null;
    if (apply("line", scalarDim(proto.lineOfTherapy, ph.line))) return null;

    // Only the two phenotype axes the navigator supplies: HER2 and HR (HR folds ER/PR). Iterate the
    // PROTOCOL's constraint so a protocol that requires (say) HER2+ is flagged unconfirmed when the
    // phenotype has not supplied HER2 - it is neither silently matched nor silently dropped.
    var pbm = proto.biomarkers || {}, phbm = ph.biomarkers || {};
    var markers = ["HER2", "HR"];
    for (var m = 0; m < markers.length; m++) {
      var mk = markers[m];
      var protoNorm = mk === "HR" ? protoHR(pbm) : normBio(pbm.HER2);
      if (apply("biomarkers." + mk, bioDim(protoNorm, phbm[mk]))) return null;
    }

    var lc = lifecycleBadge(proto);
    return {
      id: proto.id, name: proto.name || proto.id, protocolVersion: proto.version || proto.protocolVersion || "",
      lifecycleState: proto.lifecycleState || proto.status || null, experimental: !!proto.experimental,
      badge: lc.badge, approved: lc.approved,
      matched: matched, unconfirmed: unconfirmed, _matchedCount: count,
      rationale: buildRationale(ph, matched, unconfirmed, lc)
    };
  }

  function buildRationale(ph, matched, unconfirmed, lc) {
    var pheno = [];
    if (ph.diseaseId) pheno.push("disease " + ph.diseaseId);
    if (ph.stage) pheno.push("stage " + ph.stage);
    if (ph.setting) pheno.push(ph.setting + " setting");
    if (ph.intent) pheno.push(ph.intent + " intent");
    var bmk = ph.biomarkers ? Object.keys(ph.biomarkers) : [];
    bmk.forEach(function (k) { pheno.push(k + " " + ph.biomarkers[k]); });
    var confirmed = Object.keys(matched);
    var s = "Suggested for " + (pheno.length ? pheno.join(", ") : "the supplied phenotype") + ". ";
    s += "Confirmed matches: " + (confirmed.length ? confirmed.join(", ") : "none fully confirmed") + ".";
    if (unconfirmed.length) s += " Needs verification: " + unconfirmed.join(", ") + ".";
    if (!lc.approved) s += " This protocol is " + lc.badge + " - not an approved clinical recommendation; physician review required.";
    s += " Decision support only; not auto-selected.";
    return s;
  }

  // recommend(phenotype, protocols) -> { applicable:[...], reviewRequired:true }. Full applicable list
  // (never a single "chosen"), ranked by confirmed matches then fewer unconfirmed then id. Approved
  // (ACTIVE) protocols rank above unapproved so a draft never sits at the top implying endorsement.
  function recommend(phenotype, protocols) {
    var ph = phenotype || {}, applicable = [];
    asArr(protocols).forEach(function (p) { var e = evaluate(p, ph); if (e) applicable.push(e); });
    applicable.sort(function (a, b) {
      if (a.approved !== b.approved) return a.approved ? -1 : 1;
      if (b._matchedCount !== a._matchedCount) return b._matchedCount - a._matchedCount;
      if (a.unconfirmed.length !== b.unconfirmed.length) return a.unconfirmed.length - b.unconfirmed.length;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    applicable.forEach(function (e) { delete e._matchedCount; });
    return { applicable: applicable, reviewRequired: true };
  }

  var API = { recommend: recommend, _evaluate: evaluate, _stageToken: stageToken, _protoHR: protoHR, _version: "1.0" };
  if (root) root.SMD_ONCOTREE_RECOMMEND = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
