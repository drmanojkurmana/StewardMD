/* kb/ai/maik-grounding.js — window.SMD_MAIK_GROUND
 *
 * Claim-level grounding for on-device RAG answers (owner directive, 2026-09-18).
 *
 * Replaces the whole-answer evidence gate as the arbiter of what reaches the screen. That gate
 * (kb/ai/maik-lite-rag.js evidenceGate, kept for webAnswer and as a fallback) failed an ENTIRE
 * answer when any number or drug-suffixed token in it was absent from the passages: "1 g" for
 * "1000 mg", "twice daily", "7-10 days", an alternative named in passing. Half of a larger model's
 * answers were thrown away for paraphrase, which is why grounding was switched off for every pack
 * but MaiK Lite. This module keeps the safety bar and drops the false rejections:
 *
 *   1. The answer is split into claims (sentences / bullets), citation markers parsed off.
 *   2. Each claim is checked on FACTS, not wording: every number (unit-normalised: 1 g == 1000 mg,
 *      "twice daily" == "bd" == "every 12 hours") and every drug must be present in a passage or in
 *      the clinician's own question; a drug+dose pair must co-occur in ONE passage (a dose from
 *      passage A spliced onto a drug from passage B is not support); prose claims need concept
 *      overlap with a passage, never phrase overlap.
 *   3. Outcomes are per claim: supported (with the passage numbers it rests on), clinician (rests on
 *      a figure the doctor supplied), contradicted (the evidence gives a DIFFERENT dose for that
 *      drug: removed, never qualified), unsupported (nothing in the evidence: removed, or moved to
 *      a clearly separated general-knowledge block when the product allows it), meta (the verify
 *      line, greetings, headings: kept, never cited).
 *   4. Nothing the passages do not support is ever presented as Knowledge-Base-backed.
 *
 * Deterministic and dependency-free: the same answer against the same passages always grounds the
 * same way, on a phone, in a test, or in the eval battery (bench/rag-grounding). ES5 on purpose.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SMD_MAIK_GROUND = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COV_MIN = 0.5;          // share of a prose claim's concept tokens that must appear in one passage
  var PAIR_WINDOW = 90;       // chars between a drug and its dose for them to count as one statement
  var CITE = /\[\s*(\d+(?:\s*[,;&]\s*\d+)*)\s*\]/g;

  var STOP = {};
  ("a an the of for in on to and or is are was were be been being with without that this these those it its as at by " +
   "from what which who whom how why when where do does did can could may might should would will shall have has had " +
   "not no nor but if then than so such into onto about also usually often typically generally commonly most more " +
   "very well both either each all any some other same first second next further given based include includes " +
   "including consider considered recommended recommend used use using patient patients adult adults dose doses " +
   "daily day days per orally oral iv im po mg g mcg ml").split(" ").forEach(function (w) { STOP[w] = 1; });

  var UK = [[/ae/g, "e"], [/oe/g, "e"], [/our\b/g, "or"], [/isation\b/g, "ization"], [/ise\b/g, "ize"], [/yse\b/g, "yze"]];

  // Frequencies and routes in bedside shorthand, book prose or abbreviation all normalise to one token
  // BEFORE numbers are read, so "every 12 hours" is the frequency q12h and not a stray 12.
  // Canonical tokens are LETTERS ONLY: a token like "q8h" would be read back as the figure 8 h.
  // Multi-word forms first: a bare "daily" rule run earlier would eat the "daily" in "three times daily".
  var FREQ = [
    [/\b(?:twice\s+daily|twice\s+a\s+day|two\s+times\s+daily|bd|bid|b\.?i\.?d\.?|every\s+12\s*(?:hours|hrs|h)|q12h|12[-\s]hourly)\b/gi, " twicedaily "],
    [/\b(?:three\s+times\s+daily|three\s+times\s+a\s+day|thrice\s+daily|tds|tid|t\.?i\.?d\.?|every\s+8\s*(?:hours|hrs|h)|q8h|8[-\s]hourly)\b/gi, " thricedaily "],
    [/\b(?:four\s+times\s+daily|four\s+times\s+a\s+day|qds|qid|q\.?i\.?d\.?|every\s+6\s*(?:hours|hrs|h)|q6h|6[-\s]hourly)\b/gi, " fourtimesdaily "],
    [/\b(?:every\s+4\s*(?:hours|hrs|h)|q4h|4[-\s]hourly)\b/gi, " sixtimesdaily "],
    [/\b(?:once\s+daily|once\s+a\s+day|one\s+time\s+daily|od|qd|q\.?d\.?|daily|every\s+24\s*(?:hours|hrs|h)|q24h|24[-\s]hourly)\b/gi, " oncedaily "],
    [/\b(?:once\s+weekly|weekly|every\s+week|qwk)\b/gi, " onceweekly "],
    [/\b(?:single\s+dose|one[-\s]time\s+dose|stat|once\s+only)\b/gi, " singledose "],
    [/\b(?:intravenous(?:ly)?|iv)\b/gi, " iv "],
    [/\b(?:intramuscular(?:ly)?|im)\b/gi, " im "],
    [/\b(?:by\s+mouth|orally|oral|po|p\.o\.)\b/gi, " po "],
    [/\b(?:subcutaneous(?:ly)?|subcut|sc|s\.c\.)\b/gi, " sc "]
  ];

  // value [- value] unit. Mass converts to mg so 1 g == 1000 mg; time and volume keep their own family.
  var NUM = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to|—)\s*(\d+(?:[.,]\d+)?))?\s*(mg\/kg\/day|mg\/kg|mcg\/kg|µg\/kg|ug\/kg|g\/kg|mg\/dl|mmol\/l|meq\/l|g\/dl|mmhg|mg|mcg|µg|ug|g|kg|ml|l|iu|units?|u|%|hours?|hrs?|h|days?|d|weeks?|wks?|months?|years?|yrs?|minutes?|mins?|min|times|x)?(?![a-z])/gi;
  var MASS = { g: 1000, mg: 1, mcg: 0.001, "µg": 0.001, ug: 0.001 };
  var TIME = { minute: 1, minutes: 1, mins: 1, min: 1, hour: 60, hours: 60, hrs: 60, h: 60, day: 1440, days: 1440, d: 1440,
               week: 10080, weeks: 10080, wks: 10080, month: 43200, months: 43200, year: 525600, years: 525600, yrs: 525600 };

  // Suffix families plus the prefix families (cef-, sulfa-) a suffix rule cannot see.
  var DRUG_SUFFIX = /\b(?:cef[a-z]{3,}|sulfa[a-z]{3,}|[a-z]{4,}(?:cillin|mycin|micin|cycline|azole|oxacin|floxacin|pril|sartan|statin|olol|dipine|parin|prazole|triptan|mab|nib|tinib|ciclovir|vir|navir|cept|gliptin|glitazone|barbital|azepam|zolam|caine|tidine|semide|thiazide|conazole|penem|oxetine|azosin|terol|profen|coxib|zosin|lukast|setron|dronate|afil|formin|glinide))\b/gi;
  var NOT_DRUG = { intercept: 1, concept: 1, precept: 1, percept: 1, receptor: 1, except: 1, accept: 1 };

  // A line that states nothing checkable: the verify footer, the source line, greetings, headings.
  var META = /^(?:verify against local protocol|source:|not (?:addressed|covered) in the (?:provided )?reference|i can only help with medical|hi\b|hello\b|here (?:is|are)\b|in summary\b|summary\b|note:?\s*$)/i;

  // Bedside abbreviations both sides are read through, so "PE" and "pulmonary embolism" are one concept.
  // The retrieval module's own richer table is used as well when the caller passes it (opts.expand).
  var ABBR = { pe: "pulmonary embolism", dvt: "deep venous thrombosis", mi: "myocardial infarction", cap: "community acquired pneumonia",
    uti: "urinary tract infection", copd: "chronic obstructive pulmonary disease", chf: "heart failure", ckd: "chronic kidney disease",
    aki: "acute kidney injury", dka: "diabetic ketoacidosis", tb: "tuberculosis", af: "atrial fibrillation", htn: "hypertension",
    lmwh: "low molecular weight heparin", ufh: "unfractionated heparin", nsaid: "nonsteroidal anti inflammatory", nsaids: "nonsteroidal anti inflammatory",
    ppi: "proton pump inhibitor", acei: "ace inhibitor", arb: "angiotensin receptor blocker", ssri: "serotonin reuptake inhibitor",
    hb: "hemoglobin", hgb: "hemoglobin", bp: "blood pressure", ecg: "electrocardiogram", ekg: "electrocardiogram", rx: "treatment", tx: "treatment", dx: "diagnosis" };
  function expandAbbr(t) { return t.replace(/\b[a-z]{2,6}\b/g, function (w) { return ABBR[w] || w; }); }
  var SUFFIX = ["ations", "ation", "tion", "ment", "ness", "ing", "ate", "ed", "ly", "es", "s"];
  function stem(x) {
    for (var i = 0; i < SUFFIX.length; i++) {
      var s = SUFFIX[i];
      if (x.length - s.length >= 4 && x.slice(-s.length) === s) return x.slice(0, -s.length);
    }
    return x;
  }

  function num(s) {
    s = String(s);
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    return parseFloat(s);
  }

  function norm(s) {
    var t = String(s || "").toLowerCase().replace(/[’']/g, "'");
    for (var i = 0; i < FREQ.length; i++) t = t.replace(FREQ[i][0], FREQ[i][1]);
    return t;
  }

  /** Every checkable fact in a piece of text, positions kept so a drug and its dose can be paired. */
  var _expand = null;   // optional richer expander from the retrieval module, set per groundAnswer call
  function facts(text) {
    var t = norm(text);
    if (_expand) { try { t = String(_expand(t) || t); } catch (e) {} }
    t = expandAbbr(t);
    var out = { nums: [], drugs: [], freq: [], terms: {}, t: t };
    var m;
    NUM.lastIndex = 0;
    while ((m = NUM.exec(t)) !== null) {
      var unit = (m[3] || "").toLowerCase();
      var vals = [num(m[1])]; if (m[2] != null) vals.push(num(m[2]));
      for (var k = 0; k < vals.length; k++) {
        var f = { v: vals[k], unit: unit, pos: m.index, raw: m[0].trim() };
        if (MASS[unit] != null) { f.fam = "mass"; f.key = "mass:" + (vals[k] * MASS[unit]); }
        else if (TIME[unit] != null) { f.fam = "time"; f.key = "time:" + (vals[k] * TIME[unit]); }
        else { f.fam = unit || "n"; f.key = f.fam + ":" + vals[k]; }
        out.nums.push(f);
      }
    }
    DRUG_SUFFIX.lastIndex = 0;
    while ((m = DRUG_SUFFIX.exec(t)) !== null) if (!NOT_DRUG[m[0]]) out.drugs.push({ name: m[0], pos: m.index });
    var fq = t.match(/\b(?:oncedaily|twicedaily|thricedaily|fourtimesdaily|sixtimesdaily|onceweekly|singledose|iv|im|po|sc)\b/g) || [];
    for (var j = 0; j < fq.length; j++) out.freq.push(fq[j]);
    var words = t.replace(/-/g, " ").match(/[a-z][a-z0-9]+/g) || [];   // "low-molecular-weight" == "low molecular weight"
    for (var w = 0; w < words.length; w++) {
      var x = words[w];
      if (x.length < 3 || STOP[x]) continue;
      for (var u = 0; u < UK.length; u++) x = x.replace(UK[u][0], UK[u][1]);
      x = stem(x.replace(/ies$/, "y"));   // light stem, applied to claim and passage alike
      if (x.length >= 3 && !STOP[x]) out.terms[x] = 1;
    }
    return out;
  }

  function hasNum(F, key) { for (var i = 0; i < F.nums.length; i++) if (F.nums[i].key === key) return true; return false; }
  function hasDrug(F, name) { for (var i = 0; i < F.drugs.length; i++) if (F.drugs[i].name === name) return true; return false; }

  /** Drug + dose pairs in a claim: a number within PAIR_WINDOW chars of a drug mention. */
  function pairs(F) {
    var out = [];
    for (var i = 0; i < F.drugs.length; i++) for (var j = 0; j < F.nums.length; j++) {
      if (F.nums[j].fam !== "mass" && F.nums[j].fam !== "mg/kg" && F.nums[j].fam !== "mcg/kg" && F.nums[j].fam !== "iu" && F.nums[j].fam !== "units" && F.nums[j].fam !== "unit" && F.nums[j].fam !== "u") continue;
      if (Math.abs(F.nums[j].pos - F.drugs[i].pos) <= PAIR_WINDOW) out.push({ drug: F.drugs[i].name, key: F.nums[j].key, fam: F.nums[j].fam });
    }
    return out;
  }

  /** Does passage P state drug `d` with a dose of the same family but a different value? */
  function conflictingDose(P, d, key, fam) {
    for (var i = 0; i < P.drugs.length; i++) {
      if (P.drugs[i].name !== d) continue;
      for (var j = 0; j < P.nums.length; j++) {
        var n = P.nums[j];
        if (n.fam === fam && Math.abs(n.pos - P.drugs[i].pos) <= PAIR_WINDOW && n.key !== key) return n.raw;
      }
    }
    return null;
  }
  function pairSupported(P, d, key) {
    for (var i = 0; i < P.drugs.length; i++) {
      if (P.drugs[i].name !== d) continue;
      for (var j = 0; j < P.nums.length; j++) if (P.nums[j].key === key && Math.abs(P.nums[j].pos - P.drugs[i].pos) <= PAIR_WINDOW) return true;
    }
    return false;
  }

  function coverage(claimTerms, P) {
    var keys = Object.keys(claimTerms), hit = 0;
    for (var i = 0; i < keys.length; i++) if (P.terms[keys[i]]) hit++;
    return { cov: keys.length ? hit / keys.length : 0, hit: hit, n: keys.length };
  }

  /** Sentences and bullets, with their [n] markers parsed off. No lookbehind: the WebView floor is ES5. */
  function splitClaims(text) {
    var out = [], lines = String(text || "").replace(/\r/g, "").split("\n");
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var mBullet = /^(\s*(?:[-*•]|\d+[.)])\s+)/.exec(line);
      var prefix = mBullet ? mBullet[1] : "";
      var body = line.slice(prefix.length).replace(/^#+\s*/, "").trim();
      if (!body) { out.push({ line: li, prefix: prefix, text: "", refs: [], kind: "blank" }); continue; }
      // sentence boundaries: terminator + space + capital/digit/quote; abbreviations like "e.g." stay whole
      var parts = [], start = 0;
      for (var i = 1; i < body.length - 1; i++) {
        if (/[.!?]/.test(body[i]) && /\s/.test(body[i + 1]) && i + 2 < body.length && /[A-Z0-9"(]/.test(body[i + 2]) &&
            !/\b(?:e\.g|i\.e|vs|etc|approx|dr|mr|mrs|no|ca)$/i.test(body.slice(Math.max(0, i - 6), i))) {
          parts.push(body.slice(start, i + 1)); start = i + 1;
        }
      }
      parts.push(body.slice(start));
      for (var p = 0; p < parts.length; p++) {
        var s = parts[p].trim(); if (!s) continue;
        var refs = [], mm; CITE.lastIndex = 0;
        while ((mm = CITE.exec(s)) !== null) mm[1].split(/[,;&\s]+/).forEach(function (x) { if (x) refs.push(parseInt(x, 10)); });
        var clean = s.replace(CITE, " ").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
        var plain = clean.replace(/\*\*|__|`/g, "");
        var kind = "claim";
        if (META.test(plain) || /\?\s*$/.test(plain)) kind = "meta";
        else if ((expandAbbr(plain.toLowerCase()).match(/[a-z]{3,}/g) || []).length < 3 && !/\d/.test(plain)) kind = "meta";
        out.push({ line: li, prefix: p === 0 ? prefix : "", text: clean, plain: plain, refs: refs, kind: kind, last: p === parts.length - 1 });
      }
    }
    return out;
  }

  /** One claim against the passages. passagesF: facts(passage.text) per passage, in order. */
  function verifyClaim(claim, passagesF, questionF) {
    if (claim.kind !== "claim") return { status: "meta", refs: [], why: [] };
    var F = facts(claim.plain), why = [], refs = {}, clinician = false, missing = 0, pairOk = false;
    // 1. drug + dose pairs must co-occur in one passage; a different dose for that drug in the evidence contradicts
    var prs = pairs(F), pairedDrug = {}, pairedKey = {};
    for (var i = 0; i < prs.length; i++) {
      var pr = prs[i], okIn = -1, conflict = null;
      for (var p = 0; p < passagesF.length; p++) {
        if (pairSupported(passagesF[p], pr.drug, pr.key)) { okIn = p; break; }
        var c = conflictingDose(passagesF[p], pr.drug, pr.key, pr.fam); if (c && !conflict) conflict = { p: p, dose: c };
      }
      // A matched pair anchors provenance to THAT passage; the drug and figure are not re-cited elsewhere.
      if (okIn >= 0) { refs[okIn] = 1; pairOk = true; pairedDrug[pr.drug] = 1; pairedKey[pr.key] = 1; }
      else if (conflict) return { status: "contradicted", refs: [conflict.p + 1], why: [pr.drug + " is dosed " + conflict.dose + " in the reference, not as stated"] };
      else if (hasDrug(questionF, pr.drug) && hasNum(questionF, pr.key)) clinician = true;
      else { missing++; why.push(pr.drug + " dose not in the reference"); }
    }
    // 2. every number: in some passage (any), else in the question (clinician-supplied), else missing
    for (var n = 0; n < F.nums.length; n++) {
      if (pairedKey[F.nums[n].key]) continue;
      var found = -1;
      for (var q = 0; q < passagesF.length; q++) if (hasNum(passagesF[q], F.nums[n].key)) { found = q; break; }
      if (found >= 0) refs[found] = 1;
      else if (hasNum(questionF, F.nums[n].key)) clinician = true;
      else { missing++; why.push("figure " + F.nums[n].raw + " not in the reference"); }
    }
    // 3. every drug: in some passage, else in the question, else missing
    for (var d = 0; d < F.drugs.length; d++) {
      if (pairedDrug[F.drugs[d].name]) continue;
      var fd = -1;
      for (var r = 0; r < passagesF.length; r++) if (hasDrug(passagesF[r], F.drugs[d].name)) { fd = r; break; }
      if (fd >= 0) refs[fd] = 1;
      else if (hasDrug(questionF, F.drugs[d].name)) clinician = true;
      else { missing++; why.push(F.drugs[d].name + " not in the reference"); }
    }
    if (missing) return { status: "unsupported", refs: [], why: why };
    // 4. concept overlap for the prose of the claim (paraphrase, never phrase match)
    var best = { cov: 0, hit: 0, n: 0 }, bestP = -1;
    for (var s = 0; s < passagesF.length; s++) { var cv = coverage(F.terms, passagesF[s]); if (cv.cov > best.cov || (cv.cov === best.cov && cv.hit > best.hit)) { best = cv; bestP = s; } }
    var factual = F.nums.length + F.drugs.length > 0;
    var conceptOk = best.cov >= COV_MIN || (best.n <= 4 && best.hit >= 2) || (best.n <= 2 && best.hit >= 1);
    // A drug name or a figure appearing SOMEWHERE in the evidence is not support for the statement made
    // about it: a factual claim needs a matched drug+dose pair, or concept overlap with a passage.
    if (factual && Object.keys(refs).length && (pairOk || conceptOk)) { if (bestP >= 0 && best.hit) refs[bestP] = 1; }
    else if (!factual && conceptOk && bestP >= 0) refs[bestP] = 1;
    else {
      if (clinician && !Object.keys(refs).length) return { status: "clinician", refs: [], why: ["rests on the question's own figures"] };
      return { status: "unsupported", refs: [], why: ["no matching statement in the reference"] };
    }
    var list = Object.keys(refs).map(function (k) { return parseInt(k, 10) + 1; }).sort(function (a, b) { return a - b; });
    return { status: clinician && !list.length ? "clinician" : "supported", refs: list, clinician: clinician, why: why, cov: best.cov };
  }

  /**
   * groundAnswer(answer, passages, question, opts) -> {
   *   text        the rewritten KB-supported answer (supported + meta claims, [n] provenance kept/added)
   *   general     text of claims the evidence did not support, only when opts.allowGeneral (else "")
   *   removed     claims dropped (contradicted always; unsupported unless allowGeneral)
   *   claims      every claim with its status/refs, in order
   *   stats       { supported, clinician, unsupported, contradicted, meta }
   *   verdict     "grounded" | "partial" | "ungrounded"
   *   citations   { n: passage } for the [n] markers in text
   * }
   * passages: [{ text, heading?, chunk? }] in the order they were numbered in the prompt.
   */
  function groundAnswer(answer, passages, question, opts) {
    opts = opts || {};
    _expand = typeof opts.expand === "function" ? opts.expand : null;
    var pf = (passages || []).map(function (p) { return facts(p && p.text || ""); });
    var qf = facts(question || "");
    var claims = splitClaims(answer), stats = { supported: 0, clinician: 0, unsupported: 0, contradicted: 0, meta: 0 };
    var kept = [], general = [], removed = [], cites = {};
    for (var i = 0; i < claims.length; i++) {
      var c = claims[i];
      if (c.kind === "blank") { kept.push(c); continue; }
      var v = verifyClaim(c, pf, qf);
      c.status = v.status; c.why = v.why; c.refsOut = v.refs;
      stats[v.status] = (stats[v.status] || 0) + 1;
      if (v.status === "supported" || v.status === "clinician" || v.status === "meta") {
        if (v.status === "supported" && opts.inlineRefs !== false && v.refs.length) {
          v.refs.slice(0, 2).forEach(function (n) { cites[n] = passages[n - 1]; });
          c.out = c.text + " [" + v.refs.slice(0, 2).join(",") + "]";
        } else c.out = c.text;
        kept.push(c);
      } else if (v.status === "unsupported" && opts.allowGeneral) { general.push(c); }
      else removed.push(c);
    }
    // rebuild lines: a bullet whose every sentence was removed disappears with it
    var lines = [], cur = null;
    for (var k = 0; k < kept.length; k++) {
      var kc = kept[k];
      if (kc.kind === "blank") { if (cur !== null) lines.push(cur); lines.push(""); cur = null; continue; }
      if (kc.prefix || cur === null) { if (cur !== null) lines.push(cur); cur = kc.prefix + kc.out; }
      else cur += " " + kc.out;
      if (kc.last) { lines.push(cur); cur = null; }
    }
    if (cur !== null) lines.push(cur);
    var text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    var supported = stats.supported + stats.clinician;
    var verdict = supported === 0 ? "ungrounded" : (stats.unsupported + stats.contradicted === 0 ? "grounded" : "partial");
    return {
      text: text,
      general: general.map(function (g) { return "- " + g.text; }).join("\n"),
      removed: removed.map(function (r) { return { text: r.text, status: r.status, why: r.why }; }),
      claims: claims.filter(function (c) { return c.kind !== "blank"; }).map(function (c) { return { text: c.text, status: c.status, refs: c.refsOut || [], why: c.why || [] }; }),
      stats: stats, verdict: verdict, citations: cites
    };
  }

  return { groundAnswer: groundAnswer, verifyClaim: verifyClaim, splitClaims: splitClaims, facts: facts, COV_MIN: COV_MIN };
});
