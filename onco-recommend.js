/* StewardMD - onco-recommend.js. ONCQIS Phase B: the protocol RECOMMENDATION engine.
 *
 * DECISION SUPPORT ONLY. recommend() suggests which published Standard Protocols are APPLICABLE to a
 * clinical phenotype and WHY. It NEVER auto-selects, ranks a single "chosen" protocol, or prescribes -
 * it always returns the FULL applicable list with reviewRequired:true, even when exactly one applies.
 *
 * PURE function (mirrors onco-dose.js / onco-protocols.js builders): no DOM, no fetch, no window read,
 * no Date.now(), no Math.random() - same phenotype + protocols in => same result out. The server route
 * (functions/api/queue/[[path]].js, GET onco/recommend) loads ACTIVE protocols and calls this.
 *
 * Matching (Standard Protocol schema, kb/schema/standard-protocol.schema.json):
 *   - only status === "ACTIVE" protocols are ever considered;
 *   - a protocol is EXCLUDED only when a CONCRETE (non-VERIFY) eligibility field CONTRADICTS the
 *     phenotype (e.g. protocol.diseaseId dlbcl vs phenotype nsclc);
 *   - a field that is the literal "VERIFY", or absent, or that the phenotype does not supply, is
 *     NEITHER silently matched NOR silently excluded: the protocol stays in the list with that field
 *     named in `unconfirmed`, so the physician sees it needs verification before it can be confirmed.
 *
 * Flag smd_onco_recommend (queue-flags.js), default OFF. window.SMD_ONCORECOMMEND + module.exports. */
(function (root) {
  "use strict";

  // Normalize a scalar for comparison. Never invents: null/undefined stay null.
  function norm(v) { return v == null ? null : String(v).trim().toLowerCase(); }
  function isVerify(v) { return v === "VERIFY"; }

  // Per-dimension verdict: "match" (concrete + phenotype-supplied + equal), "exclude" (concrete +
  // phenotype-supplied + contradicts), "unconfirmed" (VERIFY / absent / phenotype-missing => cannot
  // confirm), or "nc" (protocol places no constraint on this dimension).
  function scalarDim(protoVal, phenoVal) {
    if (isVerify(protoVal) || protoVal == null) return "unconfirmed";
    if (phenoVal == null) return "unconfirmed";
    return norm(protoVal) === norm(phenoVal) ? "match" : "exclude";
  }

  // Array-membership dimension (stage[], treatmentIntent[]). [] = not scoped (no constraint).
  function listDim(arr, phenoVal) {
    if (arr == null) return "unconfirmed";
    if (!arr.length) return "nc";
    if (arr.indexOf("VERIFY") >= 0) return "unconfirmed";
    if (phenoVal == null) return "unconfirmed";
    var lower = arr.map(norm);
    return lower.indexOf(norm(phenoVal)) >= 0 ? "match" : "exclude";
  }

  // evidenceStatus summary across evidence.core[] + evidence.guideline[] provenance. Safety-forward:
  // any "superseded" surfaces as "superseded"; else "current" if any current; else "unknown".
  function evidenceStatusOf(ev) {
    ev = ev || {};
    var provs = (ev.core || []).concat(ev.guideline || []);
    var seen = provs.map(function (p) { return (p && p.evidenceStatus) || "unknown"; });
    if (seen.indexOf("superseded") >= 0) return "superseded";
    if (seen.indexOf("current") >= 0) return "current";
    return "unknown";
  }
  function coreSources(ev) {
    ev = ev || {};
    var names = (ev.core || []).map(function (p) { return p && p.source; }).filter(Boolean);
    return names.length ? names.join(", ") : "not specified";
  }

  // Evaluate one protocol against the phenotype. Returns null if the protocol is contradicted
  // (excluded); otherwise the applicable entry (no auto-selection - reviewRequired lives on the wrapper).
  function evaluate(proto, ph) {
    proto = proto || {}; ph = ph || {};
    var unconfirmed = [];
    var matched = { disease: false, stage: false, biomarkers: false, setting: false, intent: false, line: false };
    var matchedCount = 0;

    function apply(name, verdict) {
      if (verdict === "exclude") return true;           // signal: protocol contradicted
      if (verdict === "unconfirmed") unconfirmed.push(name);
      else if (verdict === "match") { matched[name] = true; matchedCount++; }
      return false;
    }

    if (apply("disease", scalarDim(proto.diseaseId, ph.diseaseId))) return null;
    if (apply("stage", listDim(proto.stage, ph.stage))) return null;
    if (apply("setting", scalarDim(proto.treatmentSetting, ph.setting))) return null;
    if (apply("intent", listDim(proto.treatmentIntent, ph.intent))) return null;
    if (apply("line", scalarDim(proto.lineOfTherapy, ph.line))) return null;

    // biomarkers: a per-marker object; each concrete marker is its own confirmable/unconfirmable dim.
    var bm = proto.biomarkers || {};
    var phBm = ph.biomarkers || {};
    var bmKeys = Object.keys(bm);
    var bmMatched = 0, bmUnconfirmed = 0, bmExcluded = false;
    bmKeys.forEach(function (k) {
      var verdict = scalarDim(bm[k], phBm[k]);
      if (verdict === "exclude") bmExcluded = true;
      else if (verdict === "unconfirmed") { bmUnconfirmed++; unconfirmed.push("biomarkers." + k); }
      else if (verdict === "match") bmMatched++;
    });
    if (bmExcluded) return null;
    if (bmKeys.length && bmMatched && !bmUnconfirmed) { matched.biomarkers = true; matchedCount++; }

    var evidenceStatus = evidenceStatusOf(proto.evidence);
    return {
      id: proto.id,
      name: proto.name || proto.id,
      protocolVersion: proto.protocolVersion || "",
      matched: matched,
      unconfirmed: unconfirmed,
      rationale: buildRationale(proto, ph, matched, unconfirmed, evidenceStatus),
      evidenceStatus: evidenceStatus,
      _matchedCount: matchedCount
    };
  }

  // Deterministic "Why suggested" string: phenotype + confirmed matched criteria + evidence status +
  // core sources + the standing review caveat. No em/en dashes (app-facing text rule).
  function buildRationale(proto, ph, matched, unconfirmed, evidenceStatus) {
    var pheno = [];
    if (ph.diseaseId) pheno.push("disease " + ph.diseaseId);
    if (ph.stage) pheno.push("stage " + ph.stage);
    if (ph.setting) pheno.push(ph.setting + " setting");
    if (ph.intent) pheno.push(ph.intent + " intent");
    if (ph.line) pheno.push("line " + ph.line);
    var bmk = ph.biomarkers ? Object.keys(ph.biomarkers) : [];
    bmk.forEach(function (k) { pheno.push(k + " " + ph.biomarkers[k]); });
    var phenoTxt = pheno.length ? pheno.join(", ") : "the supplied phenotype";

    var confirmed = Object.keys(matched).filter(function (k) { return matched[k]; });
    var matchTxt = confirmed.length ? confirmed.join(", ") : "none fully confirmed";

    var s = "Suggested for " + phenoTxt + ". Confirmed matches: " + matchTxt + ".";
    if (unconfirmed.length) s += " Needs verification: " + unconfirmed.join(", ") + ".";
    s += " Evidence status: " + evidenceStatus + ". Core sources: " + coreSources(proto.evidence) + ".";
    s += " Decision support only; physician review required, not auto-selected.";
    return s;
  }

  // recommend(phenotype, protocols) -> { applicable: [...], reviewRequired: true }.
  // Only ACTIVE protocols considered. Always the FULL applicable list (never a single "selected"),
  // even when exactly one applies. Ranked by confirmed-match count desc, then fewer unconfirmed,
  // then id (stable, deterministic).
  function recommend(phenotype, protocols) {
    var ph = phenotype || {};
    var list = (protocols || []).filter(function (p) { return p && p.status === "ACTIVE"; });
    var applicable = [];
    list.forEach(function (p) { var e = evaluate(p, ph); if (e) applicable.push(e); });

    applicable.sort(function (a, b) {
      if (b._matchedCount !== a._matchedCount) return b._matchedCount - a._matchedCount;
      if (a.unconfirmed.length !== b.unconfirmed.length) return a.unconfirmed.length - b.unconfirmed.length;
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    applicable.forEach(function (e) { delete e._matchedCount; });

    return { applicable: applicable, reviewRequired: true };
  }

  var API = { recommend: recommend, _evaluate: evaluate, _evidenceStatusOf: evidenceStatusOf, _version: "1.0" };
  if (root) root.SMD_ONCORECOMMEND = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
