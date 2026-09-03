/* kb/ai/maik-lite-rag.js — window.SMD_MAIK_RAG
 *
 * On-device port of ~/MedPsy/run/book_search.py's BM25 retrieval and
 * ~/MedPsy/run/pipeline.py's evidence gate, so MaiK Lite (the on-device fine-tune)
 * can ground its answers in the actual book text instead of its own possibly-wrong
 * recollection, and a post-hoc validator catches any dose/drug it still invents.
 *
 * WHY THIS EXISTS: on-device probes (2026-09-03) showed MaiK Lite confidently stating
 * a WRONG penicillin-allergy alternative (amoxicillin-clavulanate - itself a penicillin)
 * for "Treatment of Pneumonia?". The blank-answer bug was real and is fixed
 * (LlamaEngine prefillEmptyThink), but that fix does nothing for CONTENT accuracy - a
 * 1.7B answering from its own weights, ungrounded, will state a wrong regimen with
 * total confidence. Doctors expect textbook/guideline-accurate specifics, which only
 * comes from an answer built from retrieved text and checked against it - the same
 * architecture the server pipeline already uses. This is that architecture, on-device.
 *
 * PORTING DISCIPLINE: every constant and formula below is copied verbatim from the
 * Python source (same weights, same regexes, same order of operations) rather than
 * "reimplemented from memory" - the whole night was root causes hiding in exactly
 * that kind of drift between two supposedly-equivalent implementations.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SMD_MAIK_RAG = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MIN_SCORE = 6.0;
  var PAGE_CAP = 2;
  var MIN_CHUNK = 250;
  var TOPK = 3;

  var STOP = new Set(("a an the of for in on to and or is are was were be been being with without that this " +
    "these those it its as at by from what which who whom how why when where do does did can could may " +
    "might should would will shall have has had not no nor but if then than so such into onto about").split(" "));

  // Conversational filler, query side only (the index is untouched).
  var QSTOP = new Set(("tell me explain describe give please want know something regarding discuss " +
    "summarize summarise overview info information brief briefly quick detail details " +
    "name list some few mention examples example which used use").split(" "));

  // British -> American spelling. The book is American.
  var UK = [["ae", "e"], ["oe", "e"], ["our", "or"], ["isation", "ization"], ["ise", "ize"], ["yse", "yze"]];

  // Clinical shorthand -> book vocabulary. Order matches SYNONYMS.items() in book_search.py
  // (insertion order), preserved here in case any future overlap depends on it.
  var SYNONYMS = {
    "treatment": ["tx", "rx", "treat", "manage", "first line", "first-line", "give", "prescribe"],
    "diagnosis diagnostic": ["dx", "workup", "work up", "investigate", "investigation"],
    "pathogenesis mechanism": ["pathophys", "pathophysiology", "mechanism"],
    "clinical manifestations symptoms signs": ["presentation", "presents", "features", "sx"],
    "epidemiology incidence prevalence": ["how common", "frequency"],
    "complications": ["complication", "sequelae"],
    "prognosis": ["outcome", "survival"],
    "contraindications": ["contraindicated", "avoid"],
    "myocardial infarction": ["mi", "heart attack", "stemi", "nstemi"],
    "pulmonary embolism": ["pe"],
    "deep venous thrombosis": ["dvt"],
    "chronic obstructive pulmonary disease": ["copd"],
    "congestive heart failure": ["chf", "heart failure"],
    "chronic kidney disease": ["ckd"],
    "acute kidney injury": ["aki", "acute renal failure"],
    "diabetes mellitus": ["dm", "diabetes", "t2dm", "t1dm"],
    "hypertension": ["htn", "high blood pressure"],
    "antihypertensive": ["hypertension"],
    "tuberculosis": ["tb"],
    "hepatitis b": ["hep b", "hbv"], "hepatitis c": ["hep c", "hcv"], "hepatitis a": ["hep a"],
    "diabetic ketoacidosis": ["dka"], "end stage renal disease": ["esrd"], "pneumonia": ["pna"],
    "human immunodeficiency virus": ["hiv"],
    "rheumatoid arthritis": ["ra"],
    "systemic lupus erythematosus": ["sle", "lupus"],
    "inflammatory bowel disease": ["ibd"],
    "gastroesophageal reflux": ["gerd"],
    "atrial fibrillation": ["af", "afib"],
    "cerebrovascular accident stroke": ["cva"],
    "urinary tract infection": ["uti"],
    "pelvic inflammatory disease": ["pid"],
    "community acquired pneumonia": ["cap"],
    "gastrointestinal": ["gi"],
    "intravenous": ["iv"], "intramuscular": ["im"], "subcutaneous": ["sc", "subcut"],
    "lumbar puncture": ["lp"], "hemoglobin": ["hb", "hgb"], "blood pressure": ["bp"], "leukocyte count": ["tlc", "wbc"],
    "acute tubular necrosis": ["atn"], "electrocardiogram": ["ecg", "ekg"], "creatinine": ["cr"], "potassium": ["k+"],
    "transfusion": ["transfuse"]
  };
  var SYN = [];
  Object.keys(SYNONYMS).forEach(function (canon) {
    var words = canon.split(" ");
    SYNONYMS[canon].forEach(function (s) { SYN.push([s, words]); });
  });

  var INTENT = [
    [/\b(treat|treatment|therapy|manage|management|tx|rx|drug|dose|dosing|regimen|first.?line|prescribe|give)\b/i,
     /treatment|therapy|management|approach to/i],
    [/\b(diagnos|dx|workup|work up|test|investigat|criteria)\w*\b/i,
     /diagnosis|diagnostic|laboratory|evaluation|investigation/i],
    [/\b(cause|causes|etiolog|pathogen|mechanism|pathophys)\w*\b/i,
     /pathogenesis|etiology|cause|pathophysiology/i],
    [/\b(symptom|sign|present|manifest|feature)\w*\b/i,
     /clinical manifestation|symptom|sign|presentation/i],
    [/\b(complication|prognos|outcome|survival)\w*\b/i,
     /complication|prognosis|outcome|course/i]
  ];
  var NOISE = /further reading|references|bibliography|suggested reading/i;
  var GENERIC = /^\W*(treatment|therapy|management|diagnosis|diagnostic|clinical\s+manifestation|manifestations|pathogenesis|pathophysiology|etiology|epidemiology|complications|prevention|prognosis|introduction|definition|classification|laboratory|differential\s+diagnosis|evaluation|approach|further\s+reading|references|summary|conclusion|outcome|course|incidence|prevalence|screening|clinical\s+features|signs\s+and\s+symptoms|investigations?)\W*$/i;

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function inheritTopics(heads) {
    var out = [], cur = "";
    for (var i = 0; i < heads.length; i++) {
      var clean = heads[i].replace(/[■•▪]+/g, " ").trim();
      if (clean && !GENERIC.test(clean) && !NOISE.test(clean)) cur = clean;
      out.push(cur);
    }
    return out;
  }

  function toks(s) {
    var m = (s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    var out = [];
    for (var i = 0; i < m.length; i++) if (!STOP.has(m[i]) && m[i].length > 1) out.push(m[i]);
    return out;
  }

  function bigrams(ws) {
    var out = [];
    for (var i = 0; i < ws.length - 1; i++) out.push(ws[i] + "_" + ws[i + 1]);
    return out;
  }

  /** Substitute, do not append: an abbreviation left in place made a rare token the must-have term. */
  function expand(q) {
    var extra = [];
    for (var i = 0; i < SYN.length; i++) {
      var surface = SYN[i][0], canon = SYN[i][1];
      var pat = new RegExp("\\b" + escapeRegex(surface) + "\\b", "i");
      if (!pat.test(q)) continue;
      if (surface.length <= 4 || /\b\w\b/.test(surface)) {
        q = q.replace(new RegExp("\\b" + escapeRegex(surface) + "\\b", "gi"), canon.join(" "));
      } else {
        extra = extra.concat(canon);
      }
    }
    return [q, extra.join(" ")];
  }

  function Book(rows) {
    this.rows = rows;
    this.k1 = 1.5; this.b = 0.75;
    var rawHead = rows.map(function (r) { return (r.headings || []).join(" > "); });
    this.topic = inheritTopics(rawHead);
    this.head = this.topic.map(function (t, i) { return (t && t !== rawHead[i]) ? (t + " > " + rawHead[i]) : rawHead[i]; });
    this.noise = this.head.map(function (h) { return NOISE.test(h); });
    /* INVERTED index, built ONCE. The Python keeps one term->count dict per chunk and scans all
     * of them per query; the first port did the same with 42,176 JS Maps. A real jetsam report
     * (2026-09-03, owner's iPhone 15 Pro) showed the WebView's content process at 2.16 GB,
     * "per-process-limit", while the App process holding the 1.1 GB model sat at 0.6 GB: those
     * Maps are close to a gigabyte, and rebuilding them per question left the previous copy as
     * garbage, so two copies overlapped and the WebView's own ~2 GB cap was breached.
     *
     * Layout: the book has ~1.6 million distinct terms (bigrams dominate), so anything allocated
     * PER TERM (measured: one object + two typed arrays each = 955 MB, worse than the Maps) is out.
     * Instead: ONE term -> id Map, and flat typed arrays for everything else - per-term offset and
     * idf, and one global posting array of (chunk index, count) pairs. Built in a single
     * tokenization pass with only one transient per-chunk Map alive at a time. Scoring adds each
     * chunk's terms in query order, exactly as the per-chunk loop did, so scores are unchanged
     * (checked bit-exact against the previous implementation on the full book). */
    var topic = this.topic, n = rows.length;
    var tid = new Map(), df = [], cap = 1 << 20, dT = new Int32Array(cap), dF = new Uint16Array(cap), P = 0;
    var docStart = new Int32Array(n + 1), len = new Float64Array(n), totalLen = 0, i, e;
    for (i = 0; i < n; i++) {
      var d = topic[i] + " " + topic[i] + " " + rawHead[i] + " " + rows[i].text;
      var w = toks(d), c = new Map();
      for (var j = 0; j < w.length; j++) c.set(w[j], (c.get(w[j]) || 0) + 1);
      var bg = bigrams(w);
      for (var k = 0; k < bg.length; k++) c.set(bg[k], (c.get(bg[k]) || 0) + 1);
      len[i] = w.length; totalLen += w.length;
      docStart[i] = P;
      c.forEach(function (v, term) {
        var id = tid.get(term);
        if (id === undefined) { id = df.length; tid.set(term, id); df.push(0); }
        df[id]++;
        if (P === cap) {
          cap *= 2;
          var a = new Int32Array(cap); a.set(dT); dT = a;
          var b2 = new Uint16Array(cap); b2.set(dF); dF = b2;
        }
        dT[P] = id; dF[P] = v; P++;
      });
    }
    docStart[n] = P;
    var T = df.length, off = new Int32Array(T + 1), idf = new Float64Array(T), t2;
    for (t2 = 0; t2 < T; t2++) {
      off[t2 + 1] = off[t2] + df[t2];
      idf[t2] = Math.log(1 + (n - df[t2] + 0.5) / (df[t2] + 0.5));
    }
    var pd = new Int32Array(P), pf = new Uint16Array(P), cur = off.slice(0, T);
    for (i = 0; i < n; i++) {
      for (e = docStart[i]; e < docStart[i + 1]; e++) { var at = cur[dT[e]]++; pd[at] = i; pf[at] = dF[e]; }
    }
    this.tid = tid; this.off = off; this.idf = idf; this.pd = pd; this.pf = pf;
    this.len = len; this.n = n; this.avg = totalLen / Math.max(1, n);
  }

  Book.prototype.idfOf = function (w) { var id = this.tid.get(w); return id === undefined ? undefined : this.idf[id]; };

  /** Query token -> the spelling the book actually uses, if that one is commoner. */
  Book.prototype.us = function (w) {
    var i0 = this.idfOf(w), best = w, bi = i0 === undefined ? 1e9 : i0;
    for (var i = 0; i < UK.length; i++) {
      var a = UK[i][0], b = UK[i][1];
      if (w.indexOf(a) !== -1) {
        var v = w.split(a).join(b);
        var iv = this.idfOf(v), vi = iv === undefined ? 1e9 : iv;
        if (vi < bi) { best = v; bi = vi; }
      }
    }
    return best;
  };

  Book.prototype.search = function (q, k) {
    k = k || 5;
    var self = this;
    var want = [];
    for (var i = 0; i < INTENT.length; i++) if (INTENT[i][0].test(q)) want.push(INTENT[i][1]);
    var rawWords = q.split(/\s+/).filter(Boolean).filter(function (w) { return !QSTOP.has(w.toLowerCase()); });
    var usq = rawWords.map(function (w) { return self.us(w); }).join(" ");
    var pair = expand(usq), qExp = pair[0], extra = pair[1];
    var ql = " " + qExp.toLowerCase() + " ";
    var topicHit = this.topic.map(function (t) { return !!t && t.length > 4 && ql.indexOf(t.toLowerCase()) !== -1; });
    var qbase = toks(qExp + " " + extra);
    var qtBigrams = bigrams(toks(qExp)).filter(function (g) {
      var parts = g.split("_");
      return parts.every(function (w) { return (self.idfOf(w) || 0) > 3.0; });
    });
    var qt = qbase.concat(qtBigrams);
    var qw = new Map();
    for (var j = 0; j < qt.length; j++) qw.set(qt[j], this.idfOf(qt[j]) || 0.0);
    var totalIdf = 0; qw.forEach(function (v) { totalIdf += v; }); if (!totalIdf) totalIdf = 1.0;
    var mustCandidates = Array.from(qw.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (e) { return e[0]; });
    var must = qw.size ? mustCandidates.slice(0, 2) : null;
    // Posting-list scoring. Per chunk the additions happen in qt order (outer loop), which is the
    // order the old per-chunk loop used, so the floating-point sums are identical.
    var n = this.n, tid = this.tid, off = this.off, idfA = this.idf, pd = this.pd, pf = this.pf;
    var k1 = this.k1, b = this.b, avg = this.avg, len = this.len;
    var score = new Float64Array(n), coverArr = new Float64Array(n), mustHit = new Uint8Array(n), id, e, idx;
    for (var t2 = 0; t2 < qt.length; t2++) {
      id = tid.get(qt[t2]);
      if (id === undefined) continue;
      var w0 = idfA[id];
      for (e = off[id]; e < off[id + 1]; e++) {
        idx = pd[e];
        var f = pf[e], dl = len[idx] / avg;
        score[idx] += w0 * f * (k1 + 1) / (f + k1 * (1 - b + b * dl));
      }
    }
    qw.forEach(function (v, w2) { var i2 = tid.get(w2); if (i2 === undefined) return; for (var e2 = off[i2]; e2 < off[i2 + 1]; e2++) coverArr[pd[e2]] += v; });
    if (must) must.forEach(function (m) { var i3 = tid.get(m); if (i3 === undefined) return; for (var e3 = off[i3]; e3 < off[i3 + 1]; e3++) mustHit[pd[e3]] = 1; });
    var out = [];
    for (idx = 0; idx < n; idx++) {
      var s = score[idx];
      if (s <= 0 || this.rows[idx].text.length < MIN_CHUNK) continue;
      var cover = coverArr[idx] / totalIdf;
      s *= (0.4 + 0.6 * cover);
      if (must && !mustHit[idx] && !topicHit[idx]) s *= 0.35;
      if (this.noise[idx]) s *= 0.15;
      if (topicHit[idx]) s *= 1.3;
      for (var w3 = 0; w3 < want.length; w3++) { if (want[w3].test(this.head[idx])) { s *= 1.25; break; } }
      out.push([s, idx]);
    }
    out.sort(function (a, b) { return b[0] - a[0]; });
    var seen = new Map(), top = [];
    for (var o = 0; o < out.length; o++) {
      var s2 = out[o][0], i2 = out[o][1];
      var pages = this.rows[i2].pages;
      var pg = (pages && pages.length) ? Math.min.apply(null, pages) : (-1 - i2);
      var cnt = seen.get(pg) || 0;
      if (cnt >= PAGE_CAP) continue;
      seen.set(pg, cnt + 1); top.push([s2, i2]);
      if (top.length === k) break;
    }
    return top;
  };

  Book.prototype.cite = function (i) {
    var r = this.rows[i];
    var pages = r.pages || [];
    var mn = pages.length ? Math.min.apply(null, pages) : null, mx = pages.length ? Math.max.apply(null, pages) : null;
    var pg = mn == null ? "" : ("p." + mn + (pages.length > 1 && mx !== mn ? ("–" + mx) : ""));
    return { heading: this.head[i] || "(untitled)", page: pg, text: r.text, chunk: r.i != null ? r.i : i };
  };

  // ── evidence gate (pipeline.py's evidence_gate/citations, verbatim logic) ──────────────────────
  var CITE_MARKER = /\[\s*\d+(?:\s*[,;&]\s*\d+)*\s*\]/g;
  var DRUG_SUFFIX = /\b[a-z]{4,}(?:cillin|mycin|micin|cycline|azole|oxacin|floxacin|pril|sartan|statin|olol|dipine|parin|prazole|triptan|mab|nib|tinib|ciclovir|vir|navir|cept|gliptin|glitazone|barbital|azepam|zolam|caine|tidine|semide|thiazide)\b/gi;

  function drugsOf(t) {
    var out = new Set(), m;
    DRUG_SUFFIX.lastIndex = 0;
    while ((m = DRUG_SUFFIX.exec(t || "")) !== null) out.add(m[0].toLowerCase());
    return out;
  }

  /** Every number/drug the answer asserts must be in the evidence or the question - facts the
   * clinician supplied are not hallucinations, but anything else the model states must be backed
   * by the retrieved book text. Citation markers are stripped first: "[1,2]" is not the number 1,2. */
  function evidenceGate(answer, evidence, question) {
    question = (question || "").replace(/(\d+)k\b/gi, function (m, d) { return d + ",000 " + d + "000"; });
    var ev = (evidence || "") + "\n" + question;
    var ans = (answer || "").replace(CITE_MARKER, " ");
    var an = new Set(ans.match(/\d+(?:[.,]\d+)?/g) || []);
    var en = new Set(ev.match(/\d+(?:[.,]\d+)?/g) || []);
    var badN = Array.from(an).filter(function (x) { return !en.has(x); }).sort();
    var ad = drugsOf(ans), ed = drugsOf(ev);
    var badD = Array.from(ad).filter(function (x) { return !ed.has(x); }).sort();
    return { ok: badN.length === 0 && badD.length === 0, nums: badN, drugs: badD };
  }

  function citationsOf(answer, k) {
    var cited = new Set(), re = /\[(\d+)\]/g, m;
    while ((m = re.exec(answer || "")) !== null) cited.add(parseInt(m[1], 10));
    var arr = Array.from(cited).sort(function (a, b) { return a - b; });
    return { cited: arr, any: arr.length > 0, inRange: arr.length ? arr.every(function (c) { return c >= 1 && c <= k; }) : null };
  }

  return {
    Book: Book, MIN_SCORE: MIN_SCORE, TOPK: TOPK,
    toks: toks, expand: expand,
    evidenceGate: evidenceGate, citationsOf: citationsOf, drugsOf: drugsOf
  };
});
