/* MaiK Evidence Engine (Part 2) — answer generation & knowledge synthesis.
 *
 * window.MaiKEvidence turns the raw evidence gathered by MaiKBrain.execute() into a ranked,
 * deduped, cited, confidence-scored bundle ready for the synthesizer — so every answer reads
 * like an expert consultant using multiple trusted references, never a copied chunk or a
 * generic LLM reply. Deterministic + token-efficient; Gemini is only ever the medical writer.
 *
 * Modules (spec Part 2): rank (Stage 2), bundle/dedupe-merge (Stage 3), personalize (Stage 5),
 * guideline (Stage 8), confidence (Stage 9), contradictions (Stage 10), citations (Stage 11).
 * (Aggregator/templates/calculators/follow-up/token-opt already live in MaiKBrain.)
 *
 * NOT wired into the app until the Part 1 + Part 2 integration pass (flag smd_maik_brain).
 */
(function (root) {
  "use strict";
  var VERSION = "1.0.0";
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim(); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { var k = norm(x); if (x && !s[k]) { s[k] = 1; o.push(x); } }); return o; }

  // ── Stage 2 — evidence ranking by source hierarchy ─────────────────────────
  // Tier 1 = StewardMD validated content; then national → international guidelines → society
  // → systematic reviews → textbooks → trials → expert opinion. Lower tier = higher authority.
  var INTL = /\b(who|cdc|nice|idsa|esc|aha\/acc|aha|acc|kdigo|gold|gina|ada|surviving sepsis|uptodate|cochrane)\b/;
  var NATIONAL = /\b(icmr|ntep|moh|national)\b/;
  var TIER_LABEL = { 1: "StewardMD", 2: "National guideline", 3: "International guideline", 4: "Society", 5: "Systematic review", 6: "Textbook", 7: "Trial", 8: "Expert opinion" };
  function tierOf(ev) {
    var s = norm(ev.source), meta = norm((ev.ref || "") + " " + (ev.publisher || "") + " " + (ev.title || "") + " " + JSON.stringify(ev.data || ""));
    if (/stewardmd|^kb$|treatment|drugdb|calculator/.test(s)) return 1;                 // internal validated
    if (NATIONAL.test(s) || NATIONAL.test(meta)) return 2;
    if (INTL.test(s) || INTL.test(meta)) return 3;
    if (/society|association|college/.test(meta)) return 4;
    if (/systematic review|meta.?analysis|cochrane/.test(meta)) return 5;
    if (/textbook|harrison|davidson|oxford handbook/.test(meta)) return 6;
    if (/\btrial\b|\brct\b|randomi/.test(meta)) return 7;
    if (/expert|opinion|consensus statement/.test(meta)) return 8;
    return ev.source === "guideline" ? 3 : 6;                                            // sensible defaults
  }
  function rank(evidence) {
    return (evidence || []).map(function (e) { var t = tierOf(e); return Object.assign({}, e, { tier: t, tierLabel: TIER_LABEL[t], authority: 100 - t * 10 }); })
      .sort(function (a, b) { return a.tier - b.tier || (b.authority - a.authority); });
  }

  // ── Stage 3 — synthesis bundle: dedupe + merge overlapping recommendations ──
  // Turns ranked evidence into one coherent, non-duplicated claim set for the writer. Never
  // concatenates chunks; never invents. Each claim keeps its supporting sources + top tier.
  function claimText(e) {
    if (!e || !e.data) return "";
    if (typeof e.data === "string") return e.data;
    return e.data.text || e.data.recommendation || e.data.interpretation || (e.data.recommendations && e.data.recommendations.join ? e.data.recommendations.join("; ") : "") || "";
  }
  function bundle(rankedEvidence, opts) {
    var ranked = rank(rankedEvidence);
    var byClaim = {}, order = [];
    ranked.forEach(function (e) {
      var text = claimText(e); if (!text) return;
      // split multi-recommendation blobs into atomic claims so dedupe/merge is meaningful
      String(text).split(/\n+|(?:^|\s)[•\-]\s+|;\s+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 3; }).forEach(function (c) {
        var k = norm(c).replace(/\b(the|a|an|of|for|in|to|is|are)\b/g, " ").replace(/\s+/g, " ").trim();
        if (!k) return;
        if (!byClaim[k]) { byClaim[k] = { text: c, tier: e.tier, sources: [] }; order.push(k); }
        byClaim[k].tier = Math.min(byClaim[k].tier, e.tier);
        byClaim[k].sources.push({ source: e.source, tier: e.tier, ref: e.ref || e.tierLabel });
      });
    });
    var claims = order.map(function (k) { return byClaim[k]; }).sort(function (a, b) { return a.tier - b.tier; });
    return { claims: claims, sources: uniq(ranked.map(function (e) { return e.tierLabel + (e.ref ? " · " + e.ref : ""); })), topTier: ranked.length ? ranked[0].tier : null, count: claims.length };
  }

  // ── Stage 5 — clinical personalization (infer audience; never ask) ──────────
  function personalize(ctx) {
    ctx = ctx || {};
    if (ctx.audience) return audienceProfile(ctx.audience);
    var h = norm((ctx.query && ctx.query.raw || "") + " " + (ctx.hint || ""));
    if (ctx.patient || /\b(explain simply|in simple terms|to the patient|patient (handout|leaflet|friendly)|layman)\b/.test(h)) return audienceProfile("patient");
    if (ctx.icu || /\b(icu|ventilat|vasopressor|titrat|infusion rate|protocol|nbm|bundle)\b/.test(h)) return audienceProfile("icu");
    if (ctx.student || /\b(mnemonic|for exam|why does|explain the mechanism|mbbs|usmle|neet)\b/.test(h)) return audienceProfile("student");
    return audienceProfile("clinician");
  }
  function audienceProfile(a) {
    var P = {
      student: { audience: "student", verbosity: "high", style: "explanatory (mechanisms + reasoning)" },
      clinician: { audience: "clinician", verbosity: "concise", style: "concise management-first" },
      icu: { audience: "icu", verbosity: "concise", style: "protocol/parameter-focused" },
      patient: { audience: "patient", verbosity: "medium", style: "plain language, no jargon" }
    };
    return P[a] || P.clinician;
  }

  // ── Stage 8 — guideline intelligence ───────────────────────────────────────
  // Reads the structured treatment KB (KB_RAG.treatments: precedence/recommendations/year) for
  // the concept and returns a normalized guideline view. Deterministic; empty if none.
  function guideline(conceptId) {
    var KR = root.KB_RAG; if (!KR || !KR.treatments || !conceptId) return null;
    var t = KR.treatments[conceptId]; if (!t) return null;
    return {
      conceptId: conceptId,
      recommendation: (t.recommendations && t.recommendations[0]) || (t.precedence && t.precedence[0]) || null,
      recommendations: t.recommendations || [],
      precedence: t.precedence || [],
      year: t.year || (t.source && (String(t.source).match(/\b(19|20)\d\d\b/) || [])[0]) || null,
      society: t.society || t.source || null,
      drugRefs: t.drugRefs || []
    };
  }

  // ── Stage 9 — multi-factor evidence confidence + low-confidence policy ──────
  // Each signal is 0-1 (default 0.5 when unknown). Low confidence never answers confidently —
  // it recommends retry / trusted-search / one clarification instead.
  var W = { retrieval: 0.25, agreement: 0.2, guideline: 0.15, drug: 0.1, calculator: 0.05, ontology: 0.15, gemini: 0.1 };
  function confidence(sig) {
    sig = sig || {}; var num = 0, den = 0;
    Object.keys(W).forEach(function (k) { var v = (typeof sig[k] === "number") ? sig[k] : 0.5; num += v * W[k]; den += W[k]; });
    var score = den ? num / den : 0.5;
    var action = score >= 0.72 ? "answer" : score >= 0.5 ? "retrieve_more" : (sig.ambiguous ? "ask" : "search_trusted");
    return { score: Math.round(score * 100) / 100, action: action, low: score < 0.72 };
  }

  // ── Stage 10 — contradiction detection (never hide disagreement) ────────────
  // Compares the top recommendation of the ranked sources; if authoritative sources disagree
  // on the primary action/drug, surface BOTH with the reason, rather than silently choosing.
  function firstDrug(text) { var m = norm(text).match(/\b([a-z]{5,}(?:cillin|mycin|pril|sartan|statin|azole|parin|dipine|olol|prazole|floxacin|penem|cycline|conazole|tinib|mab))\b/); return m ? m[1] : null; }
  function contradictions(evidence) {
    var ranked = rank(evidence).filter(function (e) { return claimText(e); });
    var recs = ranked.map(function (e) { return { source: e.source, tier: e.tier, ref: e.ref || e.tierLabel, drug: firstDrug(claimText(e)), text: claimText(e) }; }).filter(function (r) { return r.drug; });
    var out = [];
    for (var i = 0; i < recs.length; i++) for (var j = i + 1; j < recs.length; j++) {
      if (recs[i].drug !== recs[j].drug) {
        out.push({ conflict: true, a: recs[i], b: recs[j], reason: "sources recommend different first-line agents (" + recs[i].drug + " vs " + recs[j].drug + ")", consensus: recs[i].tier <= recs[j].tier ? recs[i] : recs[j] });
      }
    }
    return out;
  }

  // ── Stage 11 — citation engine (precise, one citation ↔ one source) ─────────
  function citations(evidence) {
    var ranked = rank(evidence);
    var seen = {}, list = [];
    ranked.forEach(function (e) {
      var label = null;
      if (e.source === "kb" || e.tier === 1) label = e.ref || (e.data && e.data.disease ? "StewardMD KB · " + e.data.disease : "StewardMD Knowledge Base");
      else if (e.source === "guideline") label = (e.society || e.ref || e.tierLabel) + (e.year ? " (" + e.year + ")" : "");
      else label = e.ref || e.tierLabel;
      if (!label || /^(various|multiple|several|general)\b/i.test(String(label).trim())) return;   // reject generic citations
      var k = norm(label); if (label && !seen[k]) { seen[k] = 1; list.push({ n: list.length + 1, label: label, source: e.source, tier: e.tier }); }
    });
    return list;
  }

  var api = { version: VERSION, rank: rank, bundle: bundle, personalize: personalize, guideline: guideline, confidence: confidence, contradictions: contradictions, citations: citations, tierOf: tierOf, _norm: norm };
  try { root.MaiKEvidence = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
