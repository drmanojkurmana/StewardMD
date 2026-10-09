/* kb-search.js - Knowledge Library disease search core (pure ES5, no DOM).
 *
 * Used by reasoning.js (Library Discover search + global search) and unit-tested in node
 * (test/kb-search.test.mjs). Exposes window.SMD_KBSEARCH.
 *
 * What it does
 *  - Spelling: British and American forms collapse to one form on both sides (haem/hem, oe/e, ae/e,
 *    tumour/tumor, labour/labor ...), plural endings are stemmed, apostrophes and accents are dropped.
 *  - Abbreviations: a curated table (MI, CAP, DKA, PE, TB ...) plus the ambiguous ones from
 *    kb/ai/ambig-abbrev.js (window.MAIK_AMBIG), plus initialisms built from each entry name.
 *  - Typos: tokens of 5+ characters that match no name/alias word are matched against the name/alias
 *    vocabulary at edit distance 1 (5 to 7 chars) or 2 (8+ chars). Transposition counts as one edit.
 *  - Ranking: exact name 1000 > exact alias 900 > name prefix 800 > alias prefix 650 > name words
 *    (700 phrase, 600 all tokens) > alias words 520 > name-initialism 500 > typo 350 > partly body
 *    250 > body 100. Ties: core (non reference-only) entries first, then shorter name, then A-Z.
 *  - Built once (buildIndex), cached by the caller.
 */
(function (root) {
  "use strict";

  /* ---- normalisation --------------------------------------------------------------------- */
  var SPELL = [
    [/haem/g, "hem"], [/ae/g, "e"], [/oe/g, "e"],
    [/(tum|hum|rum|col|odo|vap|fav|lab|hon|behavi)our/g, "$1or"],
    [/leuc/g, "leuk"], [/sulph/g, "sulf"]
  ];

  function norm(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    s = s.replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");
    for (var i = 0; i < SPELL.length; i++) s = s.replace(SPELL[i][0], SPELL[i][1]);
    return s.replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
  }
  // Cheaper normaliser for the long clinical text (no accent folding: bodies are plain ASCII English).
  var BODY_SPELL = /haem|ae|oe|leuc|sulph|(?:tum|hum|rum|col|odo|vap|fav|lab|hon|behavi)our/g;
  function bodySpell(m) {
    if (m === "haem") return "hem"; if (m === "ae" || m === "oe") return "e";
    if (m === "leuc") return "leuk"; if (m === "sulph") return "sulf";
    return m.slice(0, -2) + "r";
  }
  function normBody(s) {
    return " " + String(s).toLowerCase().replace(/['\u2019`]/g, "").replace(/[^a-z0-9]+/g, " ").replace(BODY_SPELL, bodySpell) + " ";
  }
  function stem(t) {
    var n = t.length;
    if (n <= 3) return t;
    if (n > 4 && t.slice(-3) === "ies") return t.slice(0, -3) + "y";
    if (/(ss|us|is)$/.test(t)) return t;
    if (n > 4 && /(x|ch|sh|z)es$/.test(t)) return t.slice(0, -2);
    if (t.charAt(n - 1) === "s") return t.slice(0, -1);
    return t;
  }
  function tokens(normed) {
    if (!normed) return [];
    var raw = normed.split(" "), out = [];
    for (var i = 0; i < raw.length; i++) if (raw[i]) out.push(stem(raw[i]));
    return out;
  }
  var STOP = { of: 1, the: 1, and: 1, in: 1, due: 1, to: 1, with: 1, a: 1, an: 1, by: 1, for: 1, from: 1, or: 1, on: 1, type: 1 };

  /* ---- abbreviations --------------------------------------------------------------------- */
  // abbreviation -> { p: phrases the user may mean, i: core ids that are the best answer }
  var ABBR = {
    tb: { p: ["tuberculosis"], i: ["PULMONARY_TB"] },
    ptb: { p: ["pulmonary tuberculosis"], i: ["PULMONARY_TB"] },
    copd: { p: ["chronic obstructive pulmonary disease"], i: ["copd_exac_ni", "COPD_EXACERBATION"] },
    uti: { p: ["urinary tract infection"], i: ["COMPLICATED_UTI", "CYSTITIS"] },
    cauti: { p: ["catheter associated urinary tract infection"], i: ["CA_UTI"] },
    urti: { p: ["upper respiratory tract infection"], i: ["URTI"] },
    cap: { p: ["community acquired pneumonia"], i: ["CAP", "SEVERE_CAP"] },
    hap: { p: ["hospital acquired pneumonia"], i: ["HAP"] },
    vap: { p: ["ventilator associated pneumonia"], i: ["VAP"] },
    mi: { p: ["myocardial infarction"], i: ["acs"] },
    stemi: { p: ["st segment elevation myocardial infarction"], i: ["st_segment_elevation_myocardial_infarction"] },
    nstemi: { p: ["non st elevation myocardial infarction"], i: ["nstemi"] },
    acs: { p: ["acute coronary syndrome"], i: ["acs"] },
    chf: { p: ["congestive heart failure", "heart failure"], i: ["heart_failure"] },
    hf: { p: ["heart failure"], i: ["heart_failure"] },
    af: { p: ["atrial fibrillation"], i: ["atrial_fib"] },
    afib: { p: ["atrial fibrillation"], i: ["atrial_fib"] },
    dm: { p: ["diabetes mellitus"], i: [] },
    dka: { p: ["diabetic ketoacidosis"], i: ["dka"] },
    hhs: { p: ["hyperosmolar hyperglycemic state"], i: ["hhs"] },
    htn: { p: ["hypertension"], i: ["htn_emergency"] },
    ckd: { p: ["chronic kidney disease"], i: ["ckd"] },
    aki: { p: ["acute kidney injury"], i: ["aki"] },
    arf: { p: ["acute renal failure", "acute kidney injury"], i: ["aki"] },
    pe: { p: ["pulmonary embolism"], i: ["pe"] },
    dvt: { p: ["deep vein thrombosis", "deep venous thrombosis"], i: ["dvt"] },
    vte: { p: ["venous thromboembolism"], i: ["dvt", "pe"] },
    sah: { p: ["subarachnoid hemorrhage"], i: ["sah"] },
    ich: { p: ["intracerebral hemorrhage"], i: ["ich"] },
    tia: { p: ["transient ischemic attack"], i: ["tia"] },
    cva: { p: ["stroke", "ischemic stroke"], i: ["ischemic_stroke"] },
    gbs: { p: ["guillain barre syndrome"], i: ["gbs"] },
    ms: { p: ["multiple sclerosis"], i: ["ms"] },
    ra: { p: ["rheumatoid arthritis"], i: ["rheumatoid"] },
    sle: { p: ["systemic lupus erythematosus", "lupus"], i: ["sle_flare"] },
    ibd: { p: ["inflammatory bowel disease"], i: ["ibd_flare"] },
    ibs: { p: ["irritable bowel syndrome"], i: ["ibs"] },
    uc: { p: ["ulcerative colitis"], i: [] },
    gerd: { p: ["gastroesophageal reflux disease"], i: ["gerd_chest"] },
    pud: { p: ["peptic ulcer disease"], i: ["peptic_ulcer"] },
    ugib: { p: ["upper gi bleed"], i: ["peptic_ulcer", "variceal_bleed"] },
    sbp: { p: ["spontaneous bacterial peritonitis"], i: ["SBP"] },
    ie: { p: ["infective endocarditis"], i: ["IE"] },
    puo: { p: ["pyrexia of unknown origin"], i: ["PUO"] },
    fuo: { p: ["fever of unknown origin"], i: ["PUO"] },
    ards: { p: ["acute respiratory distress syndrome"], i: [] },
    dic: { p: ["disseminated intravascular coagulation"], i: ["dic"] },
    ttp: { p: ["thrombotic thrombocytopenic purpura"], i: ["ttp_hus"] },
    hus: { p: ["hemolytic uremic syndrome"], i: ["ttp_hus"] },
    itp: { p: ["immune thrombocytopenia"], i: ["itp"] },
    hlh: { p: ["hemophagocytic lymphohistiocytosis"], i: [] },
    nms: { p: ["neuroleptic malignant syndrome"], i: ["serotonin_nms"] },
    sjs: { p: ["stevens johnson syndrome"], i: ["sjs_ten"] },
    ten: { p: ["toxic epidermal necrolysis"], i: ["sjs_ten"] },
    pmr: { p: ["polymyalgia rheumatica"], i: ["pmr"] },
    gca: { p: ["giant cell arteritis"], i: ["temporal_arteritis"] },
    ild: { p: ["interstitial lung disease"], i: ["ild"] },
    pth: { p: ["pneumothorax"], i: ["pneumothorax"] },
    ptx: { p: ["pneumothorax"], i: ["pneumothorax"] },
    siadh: { p: ["syndrome of inappropriate antidiuretic hormone", "hyponatremia"], i: ["hyponatremia"] },
    hepc: { p: ["hepatitis c"], i: [] },
    he: { p: ["hepatic encephalopathy"], i: ["hepatic_enceph"] },
    hocm: { p: ["hypertrophic cardiomyopathy"], i: [] },
    pcos: { p: ["polycystic ovary syndrome"], i: [] },
    // plain-language phrases a ward clinician or a patient hand-out would use
    "heart attack": { p: ["myocardial infarction"], i: ["acs"] },
    "high blood pressure": { p: ["hypertension"], i: ["htn_emergency"] },
    "high bp": { p: ["hypertension"], i: ["htn_emergency"] },
    "low sugar": { p: ["hypoglycemia"], i: ["hypoglycemia"] },
    "blood clot": { p: ["thrombosis", "embolism"], i: ["dvt", "pe"] },
    "kidney failure": { p: ["acute kidney injury", "chronic kidney disease"], i: ["aki", "ckd"] },
    "liver failure": { p: ["acute liver failure"], i: ["ACUTE_LIVER_FAILURE"] },
    gi: { p: ["gastrointestinal"], i: [] },
    cns: { p: ["central nervous system"], i: [] }
  };
  function ambigLookup(key) {
    var A = null;
    try { A = root.MAIK_AMBIG; } catch (e) {}
    var v = A && Object.prototype.hasOwnProperty.call(A, key) ? A[key] : null;
    return Array.isArray(v) ? v : null;
  }
  function stripParens(s) { return String(s || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(); }
  // phrases (already normalised) a query may stand for; empty for most queries
  function expansions(nq) {
    var out = [], ids = [], a = Object.prototype.hasOwnProperty.call(ABBR, nq) ? ABBR[nq] : null, i;
    if (a) { for (i = 0; i < a.p.length; i++) out.push(norm(a.p[i])); ids = a.i; }
    var amb = ambigLookup(nq);
    if (amb) for (i = 0; i < amb.length; i++) { var p = norm(stripParens(amb[i])); if (p && out.indexOf(p) < 0) out.push(p); }
    return { phrases: out, ids: ids };
  }

  /* ---- typo tolerance -------------------------------------------------------------------- */
  // Optimal string alignment distance (insert, delete, substitute, adjacent swap), bounded by max.
  function dist(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j, best;
    for (j = 0; j <= lb; j++) prev.push(j);
    for (i = 1; i <= la; i++) {
      cur = [i]; best = i;
      for (j = 1; j <= lb; j++) {
        var c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
        cur.push(v); if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }
  function maxEdits(len) { return len >= 8 ? 2 : len >= 5 ? 1 : 0; }

  /* ---- index ----------------------------------------------------------------------------- */
  function initialism(name) {
    var words = stripParens(name).split(/\s+/), out = "";
    if (words.length < 2) return "";
    for (var i = 0; i < words.length; i++) {
      var w = norm(words[i]);
      if (!w) continue;
      if (STOP[w] && i > 0) continue;
      out += w.charAt(0);
    }
    return out.length >= 2 && out.length <= 7 ? out : "";
  }
  function addVocab(vocab, byLen, toks) {
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i];
      if (w.length >= 4 && !vocab[w]) { vocab[w] = 1; (byLen[w.length] || (byLen[w.length] = [])).push(w); }
    }
  }
  function joinKnow(d) {
    return [].concat(d.clinicalPearls || [], d.pathophysiology || [], d.additionalDifferentials || [],
      d.redFlags || [], d.pitfalls || [], d.prognosis || []).join(" ");
  }
  function branchOf(fn, sys) { return fn ? fn(sys) : ""; }
  // H = KB_ENRICHMENT.byId. opts.branch = kbBranch function. Returns an array (sorted by name) with
  // helper maps hung on it. Safe to build once and keep.
  function buildIndex(H, opts) {
    opts = opts || {};
    var arr = [], vocab = {}, byLen = {}, byId = {}, id;
    for (id in H) {
      var d = H[id]; if (!d) continue;
      var name = d.name || id, nameN = norm(name), baseN = norm(stripParens(name));
      var idN = norm(id.replace(/_/g, " "));
      var aliasN = [], aliasSet = {}, aliasToks = [], nameToks = tokens(baseN.length ? baseN : nameN), k;
      var fullToks = tokens(nameN);
      var al = d.aliases || [];
      for (k = 0; k < al.length; k++) {
        var a = norm(al[k]); if (!a || aliasSet[a]) continue;
        aliasSet[a] = 1; aliasN.push(a);
        var at = tokens(a); for (var q = 0; q < at.length; q++) aliasToks.push(at[q]);
      }
      // the id itself is an alias ("dka", "pe", "aki"); a multi-word id only feeds the id words
      if (id.indexOf("_") < 0 && idN.length <= 8 && !aliasSet[idN] && idN !== nameN) { aliasSet[idN] = 1; aliasN.push(idN); }
      var auto = initialism(name);
      var idToks = tokens(idN);
      addVocab(vocab, byLen, fullToks); addVocab(vocab, byLen, aliasToks);
      // lowercase only for now: normBody() runs later in small slices (warmStep) so opening the Library
      // never blocks on 16 MB of text. Until an entry is warmed, its body is matched in raw form.
      var body = joinKnow(d).toLowerCase();
      var e = { id: id, name: name, sys: d.system || "", branch: branchOf(opts.branch, d.system),
        cls: d.class === "infective" ? "inf" : "ni", ref: !!d.referenceOnly,
        nameN: nameN, baseN: baseN, nameToks: fullToks, nameBaseToks: nameToks, aliasN: aliasN, aliasSet: aliasSet,
        aliasToks: aliasToks, idToks: idToks, auto: auto, body: body, bn: false };
      arr.push(e); byId[id] = e;
    }
    arr.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    arr.byId = byId; arr.vocab = vocab; arr.byLen = byLen; arr.fuzzyCache = {}; arr.warmAt = 0;
    return arr;
  }
  function nowMs() { try { return root.performance && root.performance.now ? root.performance.now() : Date.now(); } catch (e) { return Date.now(); } }
  // Normalise entry bodies for at most `ms` milliseconds. Returns true once every body is done.
  function warmStep(idx, ms) {
    var t0 = nowMs();
    while (idx.warmAt < idx.length) {
      var e = idx[idx.warmAt++];
      if (!e.bn) { e.body = normBody(e.body); e.bn = true; }
      if (nowMs() - t0 >= ms) break;
    }
    return idx.warmAt >= idx.length;
  }
  // Keep warming in idle slices (browser) until done; calls done() once. Never throws.
  function warm(idx, done) {
    if (idx.warming) return;
    idx.warming = true;
    var ric = root.requestIdleCallback;
    function tick(dl) {
      var budget = dl && dl.timeRemaining ? Math.max(4, Math.min(12, dl.timeRemaining() - 2)) : 8;
      var fin = false;
      try { fin = warmStep(idx, budget); } catch (e) { fin = true; }
      if (fin) { if (done) { try { done(); } catch (e2) {} } return; }
      if (ric) ric(tick, { timeout: 500 }); else setTimeout(tick, 16);
    }
    if (ric) ric(tick, { timeout: 500 }); else setTimeout(tick, 50);
  }

  /* ---- search ---------------------------------------------------------------------------- */
  function startsWith(s, p) { return s.lastIndexOf(p, 0) === 0; }
  function hasWord(list, t) {
    for (var i = 0; i < list.length; i++) { var w = list[i]; if (w === t || (t.length >= 2 && startsWith(w, t))) return true; }
    return false;
  }
  var RAW_WORD = {};
  function inBody(e, t) {
    var body = e.body;
    if (t.length > 3) return body.indexOf(t) >= 0;
    if (e.bn) return body.indexOf(" " + t + " ") >= 0;
    var re = RAW_WORD[t] || (RAW_WORD[t] = new RegExp("(^|[^a-z0-9])" + t.replace(/[^a-z0-9]/g, "") + "([^a-z0-9]|$)"));
    return re.test(body);
  }
  // vocabulary words within the allowed edit distance of t, or null when t is already a word/prefix
  // of the vocabulary or too short to correct
  function fuzzyFor(idx, t) {
    if (t.length < 5) return null;
    var c = idx.fuzzyCache;
    if (Object.prototype.hasOwnProperty.call(c, t)) return c[t];
    var found = null, w;
    // a vocabulary word that starts with t means t is a (partial) real word: do not "correct" it
    var hit = !!idx.vocab[t];
    if (!hit) for (w in idx.vocab) { if (startsWith(w, t)) { hit = true; break; } }
    if (!hit) {
      var max = maxEdits(t.length), cands = [], len, bucket, i;
      for (len = t.length - max; len <= t.length + max + 3; len++) {
        bucket = idx.byLen[len]; if (!bucket) continue;
        for (i = 0; i < bucket.length; i++) {
          w = bucket[i]; if (w.charAt(0) !== t.charAt(0)) continue;
          var dd = dist(t, w, max);
          if (dd > max && w.length > t.length) { var dp = dist(t, w.slice(0, t.length), max); if (dp < dd) dd = dp; }
          if (dd <= max) cands.push([dd, w]);
        }
      }
      if (cands.length) {
        cands.sort(function (a, b) { return a[0] - b[0]; });
        found = {}; for (i = 0; i < cands.length && i < 8; i++) found[cands[i][1]] = 1;
      }
    }
    if (Object.keys(idx.fuzzyCache).length > 400) idx.fuzzyCache = {};
    idx.fuzzyCache[t] = found;
    return found;
  }
  function fuzzyWord(list, fz) {
    for (var i = 0; i < list.length; i++) if (fz[list[i]]) return true;
    return false;
  }
  // Score one entry against one normalised phrase. vt = stemmed tokens, fzs = per-token fuzzy sets.
  function scorePhrase(e, v, vt, fzs) {
    if (e.nameN === v || e.baseN === v) return 1000;
    if (e.aliasSet[v]) return 900;
    if (v.length >= 2) {
      if (startsWith(e.nameN, v)) return 800;
      for (var a = 0; a < e.aliasN.length; a++) if (v.length >= 3 && startsWith(e.aliasN[a], v)) return 650;
    }
    var allName = true, allNA = true, anyF = false, anyB = false, anyNA = false, t, i;
    for (i = 0; i < vt.length; i++) {
      t = vt[i];
      if (hasWord(e.nameToks, t) || hasWord(e.idToks, t)) { anyNA = true; continue; }
      allName = false;
      if (hasWord(e.aliasToks, t)) { anyNA = true; continue; }
      allNA = false;
      var fz = fzs[i];
      if (fz && (fuzzyWord(e.nameToks, fz) || fuzzyWord(e.aliasToks, fz))) { anyF = true; anyNA = true; continue; }
      if (inBody(e, t)) { anyB = true; continue; }
      return -1;   // gate: this token is nowhere in the entry
    }
    if (allName) return e.nameN.indexOf(v) >= 0 ? 700 : 600;
    if (allNA) return 520;
    if (anyF) return anyB ? 300 : 350;
    return anyNA ? 250 : 100;
  }

  // idx from buildIndex. opts.filter(e) -> bool; opts.limit; opts.minLen (default 2).
  // Returns [{ d: entry, s: score }] best first.
  function search(idx, q, opts) {
    opts = opts || {};
    var nq = norm(q);
    if (nq.length < (opts.minLen || 2)) return [];
    var vt = tokens(nq), i, k, fzs = [];
    for (i = 0; i < vt.length; i++) fzs.push(fuzzyFor(idx, vt[i]));
    var ex = expansions(nq), vars = [{ v: nq, vt: vt, fz: fzs, pen: 0 }];
    for (i = 0; i < ex.phrases.length; i++) {
      if (ex.phrases[i] === nq) continue;
      var pt = tokens(ex.phrases[i]);
      vars.push({ v: ex.phrases[i], vt: pt, fz: pt.map(function () { return null; }), pen: 10 });
    }
    var boost = {}; for (i = 0; i < ex.ids.length; i++) boost[ex.ids[i]] = 995 - i;
    var out = [], filter = opts.filter;
    for (k = 0; k < idx.length; k++) {
      var e = idx[k];
      if (filter && !filter(e)) continue;
      var best = -1, s;
      for (i = 0; i < vars.length; i++) {
        s = scorePhrase(e, vars[i].v, vars[i].vt, vars[i].fz);
        if (s >= 0) { s -= vars[i].pen; if (s > best) best = s; }
      }
      if (best < 500 && e.auto && e.auto === nq && nq.length >= 2) best = Math.max(best, 500);
      if (boost[e.id] && boost[e.id] > best) best = boost[e.id];
      if (best >= 0) out.push({ d: e, s: best });
    }
    out.sort(function (a, b) {
      return b.s - a.s || (a.d.ref === b.d.ref ? 0 : a.d.ref ? 1 : -1) || a.d.name.length - b.d.name.length ||
        (a.d.name < b.d.name ? -1 : a.d.name > b.d.name ? 1 : 0);
    });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /* ---- related topics -------------------------------------------------------------------- */
  function ddxItems(d) {
    return [].concat(d.additionalDifferentials || [], d.infectionMimics || [], d.nonInfectiousMimics || []);
  }
  // normalised leading name of a differential line: "Dengue fever (myalgia ... p.1763)" -> "dengue fever"
  function ddxNames(item) {
    var parts = stripParens(item).split(/\s+\/\s+|;|,\s+(?=[A-Z])/), out = [];
    for (var i = 0; i < parts.length; i++) { var n = norm(parts[i]); if (n) out.push(n); }
    return out;
  }
  function ddxGraph(idx, H) {
    if (idx.ddx) return idx.ddx;
    var byName = {}, id, e;
    for (var k = 0; k < idx.length; k++) {
      e = idx[k];
      var keys = [e.nameN, e.baseN];
      for (var j = 0; j < keys.length; j++) if (keys[j]) (byName[keys[j]] || (byName[keys[j]] = [])).push(e.id);
    }
    var out = {}, inn = {};
    for (id in H) {
      var items = ddxItems(H[id] || {}), seen = {};
      for (var i = 0; i < items.length; i++) {
        var nm = ddxNames(items[i]);
        for (var n = 0; n < nm.length; n++) {
          var ids = byName[nm[n]]; if (!ids) continue;
          for (var q = 0; q < ids.length; q++) {
            var to = ids[q]; if (to === id || seen[to]) continue;
            seen[to] = 1; (out[id] || (out[id] = [])).push(to); (inn[to] || (inn[to] = [])).push(id);
          }
        }
      }
    }
    idx.ddx = { out: out, inn: inn };
    return idx.ddx;
  }
  // 3 to 6 ids related to `id`: crossLinks, then diseases that list each other in their differentials,
  // then one-way differential links, then same system and class. Core entries before reference ones.
  function related(idx, H, id, limit) {
    limit = limit || 6;
    var d = H[id]; if (!d) return [];
    var picked = [], seen = {}; seen[id] = 1;
    function add(x) { if (!seen[x] && idx.byId[x] && picked.length < limit) { seen[x] = 1; picked.push(x); } }
    function coreFirst(list) {
      return list.slice().sort(function (a, b) {
        var ea = idx.byId[a], eb = idx.byId[b]; if (!ea || !eb) return 0;
        return (ea.ref === eb.ref ? 0 : ea.ref ? 1 : -1) || (ea.name < eb.name ? -1 : ea.name > eb.name ? 1 : 0);
      });
    }
    var x = d.crossLinks || [], i;
    for (i = 0; i < x.length && picked.length < 3; i++) add(x[i]);
    var g = ddxGraph(idx, H), outL = g.out[id] || [], inL = g.inn[id] || [];
    var mutual = outL.filter(function (o) { return inL.indexOf(o) >= 0; });
    coreFirst(mutual).forEach(add);
    for (i = 3; i < x.length; i++) add(x[i]);
    coreFirst(outL).forEach(function (o) { if (picked.length < 5) add(o); });
    coreFirst(inL).forEach(function (o) { if (picked.length < 5) add(o); });
    if (picked.length < limit) {
      var me = idx.byId[id], sameSys = [];
      for (i = 0; i < idx.length; i++) {
        var e = idx[i];
        if (e.id !== id && !seen[e.id] && e.sys === me.sys && e.cls === me.cls) sameSys.push(e);
      }
      // closer in name first (shared words), then core first
      var mine = {}; me.nameToks.forEach(function (t) { mine[t] = 1; });
      function overlap(e2) { var c = 0; e2.nameToks.forEach(function (t) { if (mine[t]) c++; }); return c; }
      sameSys.sort(function (a, b) {
        return overlap(b) - overlap(a) || (a.ref === b.ref ? 0 : a.ref ? 1 : -1) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      });
      for (i = 0; i < sameSys.length; i++) add(sameSys[i].id);
    }
    return picked;
  }

  var API = { norm: norm, stem: stem, tokens: tokens, dist: dist, buildIndex: buildIndex, warm: warm, warmStep: warmStep, search: search, related: related,
    expansions: expansions, ABBR: ABBR, initialism: initialism };
  try { if (typeof module !== "undefined" && module.exports) module.exports = API; } catch (e) {}
  try { root.SMD_KBSEARCH = API; } catch (e2) {}
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
