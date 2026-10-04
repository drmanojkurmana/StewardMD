/* edge-router.js — StewardMD Edge, Wave 1: typed, read-only request router (window.SMD_EDGE).
 * ---------------------------------------------------------------------------
 * Flag smd_edge (default ON for all users since 2026-10-04, owner; "0" turns it off). Five read-only workflows (Edge-Master-Plan section 1):
 *   calculator (open, optionally prefilled) · tool/module · KB topic · drug · ICD search.
 *
 * How a request is handled:
 *   1. CANDIDATES (deterministic): existing matchers propose at most 5 options: MEDCALC.find and
 *      SMD_SEARCH.rank over calculators and tools (on the words left after attributed values are
 *      removed), MaiKKB.resolveTarget, SMD_DRUGLINK.drugsIn, and an ICD search when the text asks for
 *      a code. The right answer must be in this list; recall@5 is measured separately.
 *   2. LAYER 0: one exact calculator name and nothing else -> answered by rules, no model call.
 *   3. MODEL: the engine sees the request plus the numbered options and calls ONE fixed tool,
 *      choose_option(option 0..5). The schema never changes, so the engine never rebinds tools.
 *      0 means "none of these".
 *   4. VALIDATION: the option must exist; the model never supplies a number. Calculator values come
 *      from the shared parser (SMD_CPARAMS) and calc-prefill, with evidence records.
 *   5. Every non-answer (no candidates, skipped, timeout, stale, 0, invalid) returns null, and the
 *      caller continues on its normal path (rule S4: never a dead end).
 * The engine is pluggable: Needle (capacitor-needle), a grammar-capable llama pack, or a test mock.
 * window.SMD_EDGE + module.exports. ES5. No network calls.
 */
(function (root) {
  "use strict";
  var G = root || {};
  var MAX_OPTIONS = 5;
  var TOOL_SCHEMA = [{
    name: "choose_option",
    description: "Pick the numbered StewardMD option that does what the clinician asked. Use 0 when none of the options fits.",
    parameters: { type: "object", properties: { option: { type: "integer", minimum: 0, maximum: MAX_OPTIONS, description: "number of the chosen option, 0 if none fits" } }, required: ["option"] }
  }];
  var SYSTEM = "user: clinician; assistant: StewardMD app router";

  function flagOn() { try { return !(G.localStorage && G.localStorage.getItem("smd_edge") === "0"); } catch (e) { return true; } }
  function lower(s) { return String(s == null ? "" : s).toLowerCase(); }

  // ---- 1. candidates -----------------------------------------------------------------------
  var STOP = { open: 1, show: 1, me: 1, the: 1, a: 1, an: 1, go: 1, to: 1, take: 1, please: 1, pls: 1, can: 1, you: 1, i: 1, want: 1,
    need: 1, for: 1, of: 1, on: 1, in: 1, with: 1, and: 1, is: 1, what: 1, whats: 1, calculate: 1, calc: 1, check: 1, find: 1, get: 1, my: 1,
    this: 1, pull: 1, up: 1, work: 1, out: 1, see: 1, look: 1, bring: 1, launch: 1, run: 1, use: 1, screen: 1, page: 1, app: 1, where: 1,
    would: 1, like: 1, let: 1, lets: 1, do: 1, it: 1, there: 1, here: 1, now: 1, be: 1, at: 1, from: 1, by: 1, or: 1 };
  function content(s) { return lower(s).replace(/[^a-z0-9.\s-]/g, " ").split(/\s+/).filter(function (w) { return w.length >= 2 && !STOP[w]; }); }
  // Navigation words in any of the three languages: never a search term on their own.
  var NAV = { search: 1, where: 1, khol: 1, kholo: 1, dikhao: 1, teruvu: 1, chupinchu: 1, cheyyi: 1, screen: 1, page: 1, lookup: 1, codes: 1, code: 1 };
  // The navigation words that ask for a page (English, Hinglish, Tenglish); a KB option is exact only with one.
  var KB_NAV_RE = /\b(open|show|page|screen|khol|kholo|dikhao|teruvu|chupinchu)\b/;
  var GENERIC = { calculator: 1, calc: 1, score: 1, scores: 1, index: 1, criteria: 1, tool: 1 };
  function norm(s) { return lower(s).replace(/[^a-z0-9]+/g, " ").trim(); }
  // "don't open the ICU", "stop metformin": never act on a negated or stop request.
  // Hinglish "mat kholo" / "nahi chahiye" and Tenglish "vaddu" / "teravaddu": a bare "nahi" is not one
  // ("fever nahi utar raha"), only "nahi chahiye" (do not want) and "mat" before a verb.
  var NEGATION = /\b(don'?t|do not|dont|never|no need to|not now|stop|cancel|hold|discontinue)\b|\b(nahi|nahin|nahii|nai|nhi)\s+chahi(y|e)e?\b|\bmat\s+(khol|kholo|kholna|dikha|dikhao|dikhana|karo|kar|chalao|chala|lagao|bhejo|do)\b|\b\w*(vaddu|vadhu)\b/i;
  var ICD_CUE = /\b(icd(?:\s*-?\s*1[01])?|icd10|icd11|diagnosis code|code for)\b/i;
  // The Search ICD tool's own name ("navigate to search icd", "icd search kholo"): only a term after
  // "for" / "of" is a lookup ("search icd for sepsis"); the rest is navigation, never an ICD term.
  var ICD_TOOL = /\b(search\s+icd|icd\s+search)\b/i;
  /* Government scheme package asks (owner, 2026-10-04: "What is the arogyasri code for pancreatitis" got
   * an ICD list, and the scheme answer showed Nagaland). A request that names a scheme, or asks for a
   * package/scheme code, is a scheme lookup: never ICD. Each entry maps a scheme's spoken names to the
   * jurisdictions (and scheme ids) of the govschemes database (functions/db/govschemes_seed_jurisdictions.sql).
   * Aarogyasri is two schemes: Dr YSR Aarogyasri, now Dr NTR Vaidya Seva (Andhra Pradesh), and Rajiv
   * Aarogyasri (Telangana); a bare "Aarogyasri" shows both, labelled. "ars" counts only next to code or
   * package ("ars codes for malaria"), so ARDS and "ars" elsewhere are untouched. */
  var SCHEMES = [
    { key: "aarogyasri", label: "Aarogyasri", re: /\ba{1,2}rogy?a\s*-?\s*s(?:h)?ri\b|\bars\s+(?:package\s+|scheme\s+)?(?:codes?|packages?|rates?)\b|\b(?:codes?|packages?)\s+(?:in|under|for|of)\s+ars\b/i,
      targets: [{ state: "andhra-pradesh", scheme: "ap-ntr-vaidya-seva", name: "Dr NTR Vaidya Seva (YSR Aarogyasri), Andhra Pradesh" },
                { state: "telangana", scheme: "telangana-aarogyasri", name: "Rajiv Aarogyasri, Telangana" }] },
    { key: "ap", label: "Dr NTR Vaidya Seva", re: /\b(?:dr\.?\s*)?(?:ntr\s*)?vaidya\s*seva\b|\bysr\b/i,
      targets: [{ state: "andhra-pradesh", scheme: "ap-ntr-vaidya-seva", name: "Dr NTR Vaidya Seva (YSR Aarogyasri), Andhra Pradesh" }] },
    { key: "pmjay", label: "AB PM-JAY", re: /\b(?:ab\s*-?\s*)?pm\s*-?\s*jay\b|\bpmjay\b|\bayushman(?:\s+bharat)?\b/i,
      targets: [{ state: "central", scheme: null, name: "AB PM-JAY (central package list)" }] },
    { key: "cmchis", label: "CMCHIS", re: /\bcmchis\b/i, targets: [{ state: "tamil-nadu", scheme: null, name: "CMCHIS, Tamil Nadu" }] },
    { key: "mjpjay", label: "MJPJAY", re: /\bmjpjay\b|\bmahatma\s+jyotiba\s+phule\b/i, targets: [{ state: "maharashtra", scheme: null, name: "MJPJAY, Maharashtra" }] }
  ];
  // A scheme or package code asked for without naming the scheme ("package code for malaria").
  var SCHEME_GENERIC = /\b(?:govt?\.?|government|health|insurance)\s+schemes?\b|\bschemes?\s+(?:codes?|packages?|rates?)\b|\bpackage\s+(?:codes?|rates?|amount|price)\b/i;
  var SCHEME_STRIP = /\b(what(?:'?s| is| are)?|whats|the|a|an|please|pls|tell|me|give|find|search|show|look\s*up|for|of|in|under|is|are|its|it|which|and|icd|codes?|coding|number|no|package|packages|rates?|amount|price|cost|schemes?|govt?|government|health|insurance|ars|ab|dr)\b/gi;
  function schemeAsk(text) {
    var s = String(text || "");
    if (!s || s.length > 200) return null;
    var hit = null;
    for (var i = 0; i < SCHEMES.length && !hit; i++) if (SCHEMES[i].re.test(s)) hit = SCHEMES[i];
    if (!hit && !SCHEME_GENERIC.test(s)) return null;
    var t = s;
    SCHEMES.forEach(function (x) { t = t.replace(new RegExp(x.re.source, "gi"), " "); });
    t = t.replace(/[?.,!:;"'()]/g, " ").replace(SCHEME_STRIP, " ").replace(/\s+/g, " ").trim();
    return { key: hit ? hit.key : null, label: hit ? hit.label : "Scheme", targets: hit ? hit.targets.slice() : [], term: t };
  }

  /* Conservative spelling fix for disease words ("absccess" -> "abscess", "pneumoniacns" -> "pneumonia").
   * vocab: { word: 1 } of known words (KB page names, ICD-10 titles). Only a word of 6+ letters that is
   * not in vocab is touched: one edit (two from 9 letters) to exactly ONE nearest known word, or a known
   * word of 6+ letters run together with a tail of at most 3 letters, which is dropped. Short words
   * ("hello", "ards") are never changed. Returns { text, changed }. */
  function editDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var lo = i;
      for (j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)); if (cur[j] < lo) lo = cur[j]; }
      if (lo > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function spell(text, vocab) {
    var words = lower(text).replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean), changed = false;
    if (!vocab) return { text: words.join(" "), changed: false };
    var keys = null;
    var out = words.map(function (w) {
      if (w.length < 6 || vocab[w] || STOP[w] || NAV[w] || /\d/.test(w)) return w;
      keys = keys || Object.keys(vocab);
      var max = w.length >= 9 ? 2 : 1, best = null, bestD = max + 1, tie = false;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i]; if (k.length < 5) continue;
        var d = editDist(w, k, max);
        if (d < bestD) { best = k; bestD = d; tie = false; } else if (d === bestD && d <= max && k !== best) tie = true;
      }
      if (best && bestD <= max && !tie) { changed = true; return best; }
      for (var n = w.length - 1; n >= 6 && w.length - n <= 3; n--) if (vocab[w.slice(0, n)]) { changed = true; return w.slice(0, n); }
      return w;
    });
    return { text: out.join(" "), changed: changed };
  }
  // An explicit request to open something ("open antibiogram", "antibiogram kholo", "icu teruvu").
  var OPEN_RE = /\b(open|launch|kholo|khol|kholna|teruvu|teravu|terichu|chupinchu)\b|\b(go|take me)\s+to\b/i;

  function candidates(text, _retry) {
    var out = [], seen = {}, q = String(text || "");
    var P = G.SMD_CPARAMS, M = G.MEDCALC, S = G.SMD_SEARCH;
    var bare = P && P.stripValues ? P.stripValues(q) : q;
    function add(c) { var k = c.kind + ":" + c.id; if (seen[k] || out.length >= MAX_OPTIONS) return; seen[k] = 1; out.push(c); }

    // Words that are kept ("s/f", "r-ipi", "phq-2" keep their single letters and digits).
    var pw = norm(bare).split(" ").filter(function (w) { return w && !STOP[w]; });
    // A scheme package ask holds the first place an ICD request would, and there is no ICD option.
    var sa = schemeAsk(q);
    if (sa && sa.term && content(sa.term).length) add({ kind: "scheme", id: sa.term, title: sa.label + " packages for " + sa.term, exact: true, scheme: sa });
    else if (ICD_CUE.test(q)) {
      var src = bare;
      if (ICD_TOOL.test(bare)) { var tm = bare.match(/\b(?:for|of)\b([\s\S]*)$/i); src = tm ? tm[1] : ""; }
      var term = src.replace(ICD_CUE, " ").replace(/\b(what(?:'s| is)?|the|of|for|please|give|me)\b/gi, " ").replace(/\s+/g, " ").trim();
      // "search icd", "take me to icd search": the request is for the screen, not a code lookup.
      // Stop words only decide whether a term is left; they are never removed from it ("open
      // fracture of tibia" is not "fracture tibia": an open fracture has its own codes).
      term = term.split(/\s+/).filter(function (w) { return w && !NAV[lower(w)]; }).join(" ");
      if (!content(term).length) term = "";
      if (term) add({ kind: "icd", id: term, title: "ICD-10 codes for " + term, exact: true });
    }
    var hit = null, ranked = null, exactTool = null, calcItems = [], toolItems = [], calcNamed = false;
    try { hit = M && M.find ? (M.find(bare) || (pw.length ? M.find(pw.join(" ")) : null)) : null; } catch (e) {}
    // An exact title goes first; a near title competes in the ranked list below an own name.
    if (hit && hit.exact) add({ kind: "calculator", id: hit.id, title: hit.title, exact: true });
    if (S && S.rank && S.providers) {
      var provs = S.providers();
      provs.forEach(function (p) {
        try {
          if (p.cat === "calcs" && p.items) calcItems = p.items();
          if (p.cat === "tools" && p.items) toolItems = p.items();
        } catch (e) {}
      });
      // Search ranking needs EVERY term to hit, so a whole request ("show me the resistance patterns
      // antibiogram") finds nothing. Rank the content words; fall back to each word on its own.
      var words = content(bare);
      // Score every item by the content words it matches, each word ranked on its own and weighted by
      // rarity (a word that matches 20 items says little), plus a bonus when the whole phrase matches.
      // Calculators and tools compete on one scale, so the strongest options fill the five slots.
      var scored = function (items, kind) {
        var score = {}, byId = {};
        words.forEach(function (w) {
          var hits = []; try { hits = S.rank(w, items, { limit: 25 }); } catch (e) { hits = []; }
          if (!hits.length || hits.length > 20) return;
          var wgt = 1 / hits.length;
          hits.forEach(function (it, r) { byId[it.id] = it; score[it.id] = (score[it.id] || 0) + wgt + (25 - r) / 10000; });
        });
        if (words.length) { try { S.rank(words.join(" "), items, { limit: 5 }).forEach(function (it) { byId[it.id] = it; score[it.id] = (score[it.id] || 0) + 0.5; }); } catch (e) {} }
        return Object.keys(score).map(function (k) { return { kind: kind, it: byId[k], s: score[k] }; });
      };
      var ranked = scored(calcItems, "calculator").concat(scored(toolItems, "tool"));
      // A request that IS one of a calculator's own names ("s/f ratio", "egfr") outranks word overlap.
      // Single letters are kept here ("s/f" is "s f"), so it is compared over every calculator.
      var phrases = [pw.join(" "), pw.filter(function (w) { return !GENERIC[w]; }).join(" ")].filter(Boolean);
      if (phrases.length && M && M.get) calcItems.forEach(function (it) {
        var c = M.get(it.id), names = [it.id.replace(/_/g, " "), String(it.title || "").replace(/\s*\(.*$/, "")].concat((c && c.kw) || []);
        if (!names.some(function (k) { return phrases.indexOf(norm(k)) > -1; })) return;
        calcNamed = true;   // the request IS a calculator's own name ("disseminated intravascular coagulation")
        var x = null; ranked.forEach(function (r) { if (r.kind === "calculator" && r.it.id === it.id) x = r; });
        if (!x) { x = { kind: "calculator", it: it, s: 0 }; ranked.push(x); }
        x.s += 2;
      });
      if (hit && !hit.exact) {
        var hx = null; ranked.forEach(function (r) { if (r.kind === "calculator" && r.it.id === hit.id) hx = r; });
        if (!hx) { hx = { kind: "calculator", it: { id: hit.id, title: hit.title }, s: 0 }; ranked.push(hx); }
        hx.s += 1;
      }
      ranked.sort(function (x, y) { return y.s - x.s; });
    }
    // A drug the request names, and a reference topic, get their slots before the ranked list,
    // which would otherwise fill all five with weak word overlaps.
    // The request minus navigation words ("antibiogram kholo", "icu open cheyyi", "show me the icu"):
    // when what is left IS one tool's title or one drug's name, that option is exact (rules, no model).
    var named = pw.filter(function (w) { return !NAV[w] && !GENERIC[w]; }).join(" ");
    // Title and request are reduced the SAME way, so "dose calculator teruvu" matches "Dose calculator"
    // and "search icd teruvu" matches "Search ICD" (navigation and generic words dropped from both).
    function keys(str) {
      var w = norm(str).split(" ").filter(function (x) { return x && !STOP[x] && !NAV[x]; });
      return [w.join(" "), w.filter(function (x) { return !GENERIC[x]; }).join(" ")];
    }
    var reqKeys = keys(bare);
    if (reqKeys[0] && ranked) {
      var toolHits = toolItems.filter(function (it) {
        var tk = keys(it.title);
        return (tk[0] && tk[0] === reqKeys[0]) || (tk[1] && tk[1] === reqKeys[1]);
      });
      if (toolHits.length === 1) {
        ranked.forEach(function (r) { if (r.kind === "tool" && r.it.id === toolHits[0].id) r.s += 3; });
        if (!ranked.some(function (r) { return r.kind === "tool" && r.it.id === toolHits[0].id; })) ranked.push({ kind: "tool", it: toolHits[0], s: 3 });
        exactTool = toolHits[0].id;
      }
    }
    try {
      var DL = G.SMD_DRUGLINK;
      if (DL && DL.drugsIn) DL.drugsIn(q, { fuzzy: true }).slice(0, 2).forEach(function (d) {
        // Only the generic name is exact. A brand goes to the model or the doctor: drug-lexicon.js maps
        // some combination brands to one ingredient (Entresto -> valsartan, Combiflam -> ibuprofen),
        // so a brand must not open a drug card by rule until that lexicon is reviewed.
        var ex = !d.fuzzy && !!named && norm(d.generic) === named && norm(d.typed) === named;
        add({ kind: "drug", id: d.generic, title: d.name || d.generic, drug: d, exact: ex });
      });
    } catch (e) {}
    try {
      var KB = G.MaiKKB, R = G.SMD_REASON;
      var t = KB && KB.resolveTarget ? KB.resolveTarget(lower(bare), { question: lower(bare), grounding: [], topicMatch: { matched: false } }) : null;
      // A clear request for a disease page ("open pneumonia page", "sepsis kholo", "tb chupinchu") is exact:
      // a navigation word, and the words left are the disease's own name or a listed alias, resolved
      // confidently. Anything more ("open pneumonia antibiotics") goes to the model.
      // Also exact with NO navigation word when the whole request is that name ("pneumonia", "sepsis");
      // "what is sepsis" keeps its question words, so it stays a MaiK question.
      var rest = pw.filter(function (w) { return !NAV[w]; }).join(" "), kbEx = false, group = null;
      // A name that is also a calculator's own name ("dic") is one name, two things: never exact.
      if (rest && !calcNamed && KB && KB.resolveTarget && (KB_NAV_RE.test(norm(q)) || norm(q) === rest)) {
        var t2 = KB.resolveTarget(rest, { question: rest, grounding: [], topicMatch: { matched: false } });
        var own = !!(t2 && t2.match === "exact" && KB._diseasePhrase && KB._diseasePhrase(rest) === rest);
        var alias = !!(t2 && KB._alias && Object.prototype.hasOwnProperty.call(KB._alias, rest) && norm(KB._alias[rest]) === norm(t2.name));
        if (t2 && t2.confident && (own || alias)) { t = t2; kbEx = true; }
        // An umbrella term with no page of its own ("pneumonia": CAP, HAP, VAP...): one card listing the
        // pages whose name ends with it (MaiKKB.kbPages). A presenting symptom ("fever", "headache") is a
        // MaiK question, never a list of diseases.
        else if (KB.kbPages && !(G.MAIK_SYMPTOMS && G.MAIK_SYMPTOMS._find && G.MAIK_SYMPTOMS._find(rest, true))) {
          var pages = KB.kbPages(rest).filter(function (p) { return R && R.hasDiseaseRef && R.hasDiseaseRef(p.id); });
          // ponytail: over 24 pages ("cancer"-sized) is a category, not a disease; raise if owners want it.
          if (pages.length >= 2 && pages.length <= 24) group = { kind: "kb", id: "group:" + rest, title: rest.charAt(0).toUpperCase() + rest.slice(1), pages: pages, exact: true };
        }
      }
      if (group) add(group);
      // Fails closed: no reference module to confirm the page, no KB option.
      else if (t && t.id && R && R.hasDiseaseRef && R.hasDiseaseRef(t.id)) add({ kind: "kb", id: t.id, title: t.name || t.id, exact: kbEx });
    } catch (e) {}
    // Never offer a tool the MaiK card cannot open (home.js SMD_MAIK_TOOL_OPENABLE: ACT or a neonatal tool).
    var openable = G.SMD_MAIK_TOOL_OPENABLE;
    if (typeof openable === "function" && ranked) ranked = ranked.filter(function (x) { return x.kind !== "tool" || openable(x.it.id); });
    /* Adult or neonatal normal values (2026-10-04): "normal adult potassium range?" was offered the neonatal
     * page. The neonatal one only when the request names a newborn / child; otherwise the adult one.
     * "normal values" alone is the neonatal page's title, but adult is the default (owner, 2026-10-04). */
    var neoAsk = /\b(neonat\w*|newborns?|new-born|nicu|preterm|premature|infants?|bab(?:y|ies)|paediatric|pediatric|child(?:ren)?)\b/i.test(q);
    if (ranked) ranked = ranked.filter(function (x) { return x.kind !== "tool" || (neoAsk ? x.it.id !== "adultref" : x.it.id !== "neo:ref"); });
    (ranked || []).forEach(function (x) { add({ kind: x.kind, id: x.it.id, title: x.it.title, exact: x.kind === "tool" && x.it.id === exactTool }); });
    // One name, two things ("insulin" is a drug AND a tool): nothing is exact, the model or doctor picks.
    var exacts = out.filter(function (c) { return c.exact && !CODE_KIND[c.kind]; });
    if (exacts.length > 1) out.forEach(function (c) { if (!CODE_KIND[c.kind]) c.exact = false; });
    // Otherwise the one exactly named option goes first, unless an ICD or scheme request holds that place.
    for (var k = 1; k < out.length; k++) if (out[k].exact) {
      if (!CODE_KIND[out[0].kind]) { var x0 = out.splice(k, 1)[0]; out.unshift(x0); } else out[k].exact = false;
      break;
    }
    // Nothing found and a disease word looks misspelt ("pneumoniacns"): the Knowledge pages for the
    // corrected words, marked so the card says what it searched for. KB options only, never a tool.
    if (!out.length && !_retry) {
      var KBv = G.MaiKKB, fx = KBv && KBv.vocab ? spell(bare, KBv.vocab()) : null;
      if (fx && fx.changed) out = candidates(fx.text, true).filter(function (c) { return c.kind === "kb"; }).map(function (c) { c.corrected = fx.text; return c; });
    }
    return out;
  }

  // ---- 3. prompt for the fixed tool --------------------------------------------------------
  var KIND_LABEL = { calculator: "calculator", tool: "open", kb: "reference", drug: "drug", icd: "ICD codes", scheme: "scheme packages" };
  var CODE_KIND = { icd: 1, scheme: 1 };
  function promptFor(text, cands) {
    var lines = cands.map(function (c, i) { return (i + 1) + ". " + KIND_LABEL[c.kind] + ": " + c.title; });
    return String(text || "").slice(0, 300) + "\nOptions:\n" + lines.join("\n") + "\n0. none of these";
  }

  // Engine replies come in two shapes: Needle's { function_calls:[{name, arguments}], confidence }
  // and a grammar-constrained JSON { option } from a llama pack. Anything else is invalid.
  function optionFrom(res) {
    if (!res) return { ok: false, reason: "empty" };
    var calls = res.function_calls || [];
    if (calls.length) {
      var c = calls[0];
      if (c.name !== "choose_option" || !c.arguments) return { ok: false, reason: "wrong tool" };
      return { ok: true, option: c.arguments.option, confidence: res.confidence == null ? null : res.confidence };
    }
    if (typeof res.option === "number") return { ok: true, option: res.option, confidence: res.confidence == null ? null : res.confidence };
    if (res.type === "call" || res.suppressed_calls) return { ok: true, option: 0, confidence: res.confidence == null ? null : res.confidence };
    return { ok: false, reason: "unparseable" };
  }

  // ---- state ---------------------------------------------------------------------------------
  var engine = null, runtime = null, minConfidence = 0.5;
  var stats = { requests: 0, rules: 0, model: 0, chosen: 0, none: 0, passed: 0 };

  /* Back-off (Edge-Master-Plan A0.5): skip Edge, so the rules answer, when memory is low
   * (lowMemory, or under 250 MB available), the phone is at thermal SEVERE or above (Android
   * THERMAL_STATUS_SEVERE = 3; the Needle plugin maps iOS .serious to 3), or MaiK is generating or
   * Whisper is decoding, or the Android WebView render process has died (device.rendererGone: the plugin
   * keeps it set until the app process ends; folded into memoryOk, as memory pressure is the usual cause).
   * The device numbers arrive asynchronously from Needle.available(), so the last
   * reading is kept and refreshed on every routed request; the first model-routed request waits for one.
   * SMD_EDGE_ENV, when set (tests, harnesses), replaces this whole object. */
  var device = { lowMemory: false, availMB: null, thermal: 0, rendererGone: false };
  var firstRead = null;   // the first device reading (route() waits for it once)
  function refreshDevice() {
    var p = null;
    try { p = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Needle; } catch (e) {}
    if (!p || !p.available) return Promise.resolve(device);
    return Promise.resolve().then(function () { return p.available(); }).then(function (a) {
      if (a) {
        if (typeof a.lowMemory === "boolean") device.lowMemory = a.lowMemory;
        if (typeof a.availMB === "number") device.availMB = a.availMB;
        if (typeof a.thermal === "number") device.thermal = a.thermal;
        if (typeof a.rendererGone === "boolean") device.rendererGone = a.rendererGone;
      }
      return device;
    }, function () { return device; });
  }
  var DEFAULT_ENV = {
    memoryOk: function () { return !device.rendererGone && !device.lowMemory && !(device.availMB != null && device.availMB < 250); },
    // Owner 2026-10-04: a hot phone no longer skips the model; MaiK shows "Phone is hot" in its footer (hot()).
    thermalOk: function () { return true; },
    othersBusy: function () {
      var L = G.SMD_MAIK_LOCAL, N = G.SMD_NATIVE;
      var q = L && L.queueState ? L.queueState() : null;
      return !!((q && q.running) || (N && N.whisperBusy && N.whisperBusy()));
    }
  };
  function makeRuntime() {
    var RT = G.SMD_EDGE_RUNTIME || (typeof require !== "undefined" ? tryReq("./edge-runtime.js") : null);
    if (!RT || !engine) return null;
    return RT.create({ engine: engine, deadlineMs: 1200, coldMs: 8000, env: G.SMD_EDGE_ENV || DEFAULT_ENV });
  }
  function tryReq(p) { try { return require(p); } catch (e) { return null; } }

  function setEngine(eng, opts) {
    if (runtime && runtime.release) runtime.release();
    engine = eng || null; runtime = makeRuntime();
    if (opts && typeof opts.minConfidence === "number") minConfidence = opts.minConfidence;
    scheduleWarm();
  }

  /* Background warm-up (FunctionGemma only). Its first load on an iPhone 15 Pro takes 17.2 s (Metal
   * compiles its shaders on first use), past the 8 s cold budget, so the first request fell back to
   * rules. When the choice is functiongemma, the file is installed (engine is the llama adapter) and the
   * app is idle, load it and run one throwaway pick outside any request's budget.
   * Triggers: engine set (choice set, app start, download done), app back in the foreground, MaiK
   * releasing the plugin (maik-local.js release()). Rules: never while MaiK generates or holds the
   * plugin (holder must be null; the runtime's othersBusy/memory back-off applies too); never evicts
   * MaiK; at most once per trigger, and only when FunctionGemma is not already resident. */
  var WARM_DELAY_MS = 4000, warmTimer = null, warming = null, warmLog = [];
  function logWarm(x) { warmLog.push(x); if (warmLog.length > 20) warmLog.shift(); }
  function scheduleWarm(delayMs) {
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
    if (!engine || engine.name !== "llama") return;
    warmTimer = setTimeout(function () { warmTimer = null; warmNow(); }, delayMs == null ? WARM_DELAY_MS : delayMs);
    if (warmTimer && warmTimer.unref) warmTimer.unref();
  }
  function warmNow() {
    function skip(why) { logWarm({ at: Date.now(), skipped: why }); return Promise.resolve(false); }
    if (warming) return warming;
    if (!flagOn() || engineChoice() !== "functiongemma") return skip("choice");
    if (!engine || engine.name !== "llama" || !runtime || !runtime.warm) return skip("no engine");
    // "edge" with nothing resident (idle/background release) is safe; "maik" (or anyone else) is not.
    if (G.SMD_LLAMA_HOLDER != null && G.SMD_LLAMA_HOLDER !== "edge") return skip("holder " + G.SMD_LLAMA_HOLDER);
    if (engine.resident && engine.resident()) return skip("resident");
    var t0 = Date.now(), cands = [{ kind: "tool", title: "Antibiogram" }, { kind: "calculator", title: "CURB-65" }];
    warming = runtime.warm({ prompt: promptFor("open antibiogram", cands), tools: TOOL_SCHEMA, system: SYSTEM, maxTokens: 48, nOptions: cands.length }, 60000)
      .then(function (ok) { logWarm({ at: t0, ok: ok, ms: Date.now() - t0 }); try { console.log("[edge] warm " + (ok ? "ok" : "skipped") + " " + (Date.now() - t0) + " ms"); } catch (e) {} return ok; },
        function () { return false; })
      .then(function (ok) { warming = null; return ok; });
    return warming;
  }
  try {
    if (G.document && G.document.addEventListener) G.document.addEventListener("visibilitychange", function () {
      if (G.document.visibilityState === "visible") scheduleWarm();
    });
  } catch (e) {}
  function available() { return !!(flagOn() && engine && engine.available && engine.available()); }

  function resultFor(c, text, source, conf, ms) {
    var r = { kind: c.kind, id: c.id, title: c.title, source: source, confidence: conf, ms: ms || 0 };
    if (c.kind === "calculator") {
      var F = G.SMD_CALC_PREFILL;
      try { r.prefill = F && F.forText ? F.forText(c.id, text) : null; } catch (e) { r.prefill = null; }
    }
    if (c.drug) r.drug = c.drug;
    if (c.pages) r.pages = c.pages;
    if (c.scheme) r.scheme = c.scheme;
    if (c.corrected) r.corrected = c.corrected;
    return r;
  }

  /* route(text, { patient_session_id }) -> Promise<result | null>. Never rejects. */
  function layer0(cands) { var c = cands && cands[0]; return !!(c && (CODE_KIND[c.kind] || c.exact)); }
  // Layer 0 alone, synchronous: an exact name or an explicit ICD request, else null. MaiK calls this BEFORE
  // its follow-up logic, so "antibiogram kholo" opens the tool even while an earlier topic is live.
  function rules(text) {
    if (!flagOn() || NEGATION.test(String(text || ""))) return null;
    var cands; try { cands = candidates(text); } catch (e) { return null; }
    if (!layer0(cands)) return null;
    stats.requests++; stats.rules++;
    return resultFor(cands[0], text, "rules", null);
  }
  function route(text, ctx) {
    stats.requests++;
    if (!flagOn()) return Promise.resolve(null);
    if (NEGATION.test(String(text || ""))) { stats.passed++; return Promise.resolve(null); }
    var cands;
    try { cands = candidates(text); } catch (e) { cands = []; }
    if (!cands.length) { stats.passed++; return Promise.resolve(null); }
    // Layer 0: the first option is exact (a calculator's or tool's own name, a named drug, an explicit
    // ICD request) -> rules answer, no model.
    if (layer0(cands)) { stats.rules++; return Promise.resolve(resultFor(cands[0], text, "rules", null)); }
    if (!available() || !runtime) { stats.passed++; return Promise.resolve(null); }
    if (ctx && ctx.patient_session_id != null) runtime.setSession(ctx.patient_session_id);
    // The first model-routed request waits for one device reading, so a state set before it (the
    // renderer died and the activity recreated, low memory) is already seen. Later requests read the
    // last known state and refresh it for the NEXT request (no wait on the hot path).
    var first = !firstRead;
    if (first) firstRead = refreshDevice(); else refreshDevice();
    stats.model++;
    return firstRead.then(function () {
      return runtime.run({ prompt: promptFor(text, cands), tools: TOOL_SCHEMA, system: SYSTEM, maxTokens: 48, nOptions: cands.length });
    }).then(function (r) {
      if (!r || r.status !== "ok") { stats.passed++; return null; }
      var o = optionFrom(r.result);
      if (!o.ok || typeof o.option !== "number" || o.option !== Math.floor(o.option)) { stats.passed++; return null; }
      if (o.option === 0) { stats.none++; return null; }
      if (o.option < 1 || o.option > cands.length) { stats.passed++; return null; }
      if (o.confidence != null && o.confidence < minConfidence) { stats.passed++; return null; }
      var pick = cands[o.option - 1];
      if (!engine.agree || cands.length < 2) { stats.chosen++; return resultFor(pick, text, "edge", o.confidence, r.ms); }
      // Self-consistency (engine.agree; Edge-Runbook 5b): ask again with the options rotated by one and act
      // only if the same option comes back. A local LoRA build has no usable confidence; this is its floor.
      var rot = cands.slice(1).concat(cands.slice(0, 1));
      return runtime.run({ prompt: promptFor(text, rot), tools: TOOL_SCHEMA, system: SYSTEM, maxTokens: 48, nOptions: rot.length }).then(function (r2) {
        var o2 = r2 && r2.status === "ok" ? optionFrom(r2.result) : null;
        if (!o2 || !o2.ok || rot[o2.option - 1] !== pick) { stats.passed++; return null; }
        stats.chosen++;
        return resultFor(pick, text, "edge", o.confidence, r.ms + r2.ms);
      });
    }).then(null, function () { stats.passed++; return null; });
  }

  // ---- engine adapters -----------------------------------------------------------------------
  /* Needle through the native capacitor-needle plugin (local-plugins/capacitor-needle). The tool
   * list is fixed, so init happens once per load. Expected plugin API (see the plugin's README):
   *   load({ path? }) · configure({ system, tools }) · complete({ text, maxTokens }) -> { json } · reset() · kill()? · release()
   * ("configure", not "init": a Swift plugin cannot expose a method named init.) */
  // opts.weightsPath: a tuned .cact on the device (else the plugin's bundled weights).
  // opts.calibrated === false (a local LoRA build: its confidence head was not trained) drops the
  // confidence, as Needle's own Python binding does, so the floor is not judged on noise.
  // Every complete() runs needle_init first (2-10 ms on a Pixel 9). The engine keeps state across
  // needle_complete calls that needle_reset does not clear: on 2026-10-04 a loaded Pixel 9 engine never
  // returned from its ~49th-57th call (2 cores spinning for 10+ min; 80/80 fine with init before each).
  function needleAdapter(plugin, opts) {
    var o = opts || {};
    var loadArgs = o.weightsPath ? { path: o.weightsPath } : {};
    // Capacitor's plugin proxy answers ANY method name, so "plugin.kill exists" proves nothing. Only
    // Android runs Needle in its own process (":edge"), which is what makes a stuck call killable.
    var killable = o.killable != null ? !!o.killable : (function () {
      try { var C = G.Capacitor; return !!(C && C.getPlatform && C.getPlatform() === "android"); } catch (e) { return false; }
    })();
    return {
      name: "needle",
      agree: !!o.agree,   // opts.agree: act only when a second call with rotated options agrees (route())
      available: function () { return !!plugin; },
      load: function () { return Promise.resolve(plugin.load(loadArgs)).then(function () { return plugin.configure({ system: SYSTEM, tools: JSON.stringify(TOOL_SCHEMA) }); }); },
      complete: function (task) {
        return Promise.resolve(plugin.configure({ system: SYSTEM, tools: JSON.stringify(TOOL_SCHEMA) })).then(function () {
          return plugin.complete({ text: task.prompt, maxTokens: task.maxTokens || 48 });
        }).then(function (r) {
          var out = r && typeof r.json === "string" ? JSON.parse(r.json) : r;
          if (out && o.calibrated === false) out.confidence = null;
          return out;
        }, function (e) {
          // A :edge process that died outside the runtime (low-memory killer) restarts with no weights,
          // and configure fails "needle_init: no model loaded". Tag it so edge-runtime.js reloads.
          if (/no model loaded/i.test(String((e && e.message) || e))) {
            if (!e || typeof e !== "object") e = new Error(String(e));
            e.notLoaded = true;
          }
          throw e;
        });
      },
      reset: function () { return plugin.reset ? plugin.reset() : null; },
      kill: killable ? function () { return plugin.kill(); } : undefined,
      release: function () { return plugin.release ? plugin.release() : null; }
    };
  }
  /* A grammar-capable llama.cpp pack (capacitor-llama with the `grammar` option, gate A0.3), e.g. a
   * FunctionGemma. The llama plugin holds ONE model per process, so load() evicts MaiK's pack. Who holds
   * it is G.SMD_LLAMA_HOLDER ("edge" here, "maik" in maik-local.js): MaiK reloads its pack when it sees
   * another holder, and this adapter never picks with a model it did not load. autoEngine() builds it
   * when smd_edge_engine is "functiongemma"; the bake-off harness builds it too.
   * The grammar admits exactly {"option":n} for n in 0..number of options offered. */
  function grammarFor(n) {
    var k = Math.max(0, Math.min(MAX_OPTIONS, n | 0));
    return 'root ::= "{\\"option\\":" [0-' + k + '] "}"';
  }
  /* FunctionGemma load args (memory, 2026-10-04). A pick prompt is <= ~300 tokens + 4 output, so a
   * 512-token context is enough, and 64-token batches shrink the compute buffers, which hold logits
   * over the 262k-token vocabulary for every token of a ubatch (512 x 262k x f32 = 512 MB reserved).
   * q8_0 KV (the plugin default, explicit here). Prefill is chunked to nBatch on both platforms. */
  function fgLoadArgs(path, o) {
    return { path: path, nCtx: o.nCtx || 512, nBatch: o.nBatch || 64, nUbatch: o.nUbatch || 64,
             nThreadsBatch: o.nThreadsBatch || 4, kvQ8: true };
  }
  function llamaAdapter(plugin, opts) {
    var o = opts || {}, loaded = false;
    function mine() { return G.SMD_LLAMA_HOLDER === "edge"; }
    // The plugin drops its model on idle/background; load again on the next call.
    try { if (plugin && typeof plugin.addListener === "function") plugin.addListener("llamaReleased", function () { loaded = false; }); } catch (e) {}
    return {
      name: "llama",
      available: function () { return !!(plugin && o.modelPath); },
      load: function () {
        loaded = false;
        G.SMD_LLAMA_HOLDER = "edge";
        // modelPath: a path, or a function returning one (a downloaded pack's path is only known async).
        return Promise.resolve(typeof o.modelPath === "function" ? o.modelPath() : o.modelPath).then(function (path) {
          if (!path) throw new Error("no model file");
          // Prompt threads = the plugin's own decode threads (4 on an 8-core phone). Its default prefills on
          // EVERY core, the efficiency cores too: 3.6-4.1 s per call on a Pixel 9 vs 1.1-1.4 s with 4
          // (Edge-Runbook A0.3 Android, 2026-10-02). iOS ignores the key (Metal).
          return plugin.load(fgLoadArgs(path, o));
        }).then(function () { loaded = true; });
      },
      complete: function (task) {
        var n = Math.max(0, Math.min(MAX_OPTIONS, (task.nOptions == null ? MAX_OPTIONS : task.nOptions) | 0)), choices = [];
        for (var d = 0; d <= n; d++) choices.push(String(d));
        return Promise.resolve(loaded && mine() ? null : this.load()).then(function () {
          // MaiK loaded its pack while ours was loading: never pick with MaiK's model.
          if (!mine()) { loaded = false; throw new Error("llama plugin taken by MaiK"); }
          // `pick`: forced prefix {"option": + ONE prefill + the most likely digit (no decode loop, no grammar
          // over the whole vocabulary). A plugin without it ignores the key and runs the grammar instead.
          return plugin.generate({ system: task.system || SYSTEM, prompt: task.prompt, nPredict: 8, temperature: 0, stream: false,
            pick: { prefix: '{"option":', choices: choices, suffix: "}" }, grammar: grammarFor(n) });
        }).then(function (r) {
          var t = r && r.text, o = typeof t === "string" ? JSON.parse(t) : r;
          if (o && typeof r.p === "number") o.confidence = r.p;
          return o;
        });
      },
      // FunctionGemma is loaded and still ours (not evicted by MaiK, not dropped on idle/background).
      resident: function () { return loaded && mine(); },
      reset: function () { return null; },
      kill: plugin.cancel ? function () { return mine() ? plugin.cancel() : null; } : undefined,
      // Never unload MaiK's pack: release only what this adapter loaded.
      release: function () {
        var had = loaded && mine(); loaded = false;
        if (!had) return null;
        G.SMD_LLAMA_HOLDER = null;
        return plugin.release ? plugin.release() : null;
      }
    };
  }

  /* Device bake-off (Edge-Master-Plan 7, Day 5): run the exported test prompts through an engine
   * under the SAME runtime contract as production (deadline, cold load), one at a time, and return
   * the {id, option, confidence, ms, status} lines scripts/edge/score.mjs --pred reads. A timeout or
   * error is recorded as no option, which the scorer counts as a pass to the safe path. */
  function bakeoff(rows, eng, opts) {
    var o = opts || {}, RT = G.SMD_EDGE_RUNTIME || (typeof require !== "undefined" ? tryReq("./edge-runtime.js") : null);
    if (!RT || !eng) return Promise.reject(new Error("no runtime or engine"));
    var rt = RT.create({ engine: eng, deadlineMs: o.deadlineMs || 1200, coldMs: o.coldMs || 8000, env: o.env || {} });
    var out = [], i = 0, list = rows || [];
    function next() {
      if (i >= list.length) return Promise.resolve(rt.release()).then(function () { return out; }, function () { return out; });
      var row = list[i++], t0 = Date.now();
      return rt.run({ prompt: row.prompt, tools: row.tools || TOOL_SCHEMA, system: row.system || SYSTEM, maxTokens: 48, nOptions: row.n_options }).then(function (r) {
        var line = { id: row.id, option: null, confidence: null, ms: Date.now() - t0, status: r && r.status };
        if (r && r.status === "ok") {
          var op = optionFrom(r.result);
          if (op.ok) { line.option = op.option; line.confidence = op.confidence; } else line.status = "invalid:" + op.reason;
        }
        out.push(line);
        if (o.onProgress) { try { o.onProgress(i, list.length, line); } catch (e) {} }
        // A timed-out call may still hold a non-killable engine; wait it out so one slow row does not
        // turn the rows after it into "busy" (production would simply pass those to the safe path).
        return settle(Date.now()).then(next);
      });
    }
    function settle(t0) {
      var st = rt.status();
      if (!(st.stuck || st.running) || Date.now() - t0 > (o.coldMs || 8000)) return Promise.resolve();
      return new Promise(function (r) { setTimeout(r, 25); }).then(function () { return settle(t0); });
    }
    return next();
  }

  /* Engine choice (owner, 2026-10-04): smd_edge_engine = "needle" (default), "functiongemma" or "rules"
   * (no model; Layer 0 still answers). smd_edge "0" still turns Edge off entirely. */
  var ENGINE_CHOICES = ["needle", "functiongemma", "rules"];
  var FG_PACK = "edge-functiongemma";   // maik-models.js EDGE_FG_ID
  function engineChoice() {
    var v = null; try { v = G.localStorage && G.localStorage.getItem("smd_edge_engine"); } catch (e) {}
    return ENGINE_CHOICES.indexOf(v) >= 0 ? v : "needle";
  }
  // Switches at once, no restart: the old engine is released, the new one loads on its first call.
  function setEngineChoice(v) {
    if (ENGINE_CHOICES.indexOf(v) < 0) v = "needle";
    try { G.localStorage.setItem("smd_edge_engine", v); } catch (e) {}
    setEngine(flagOn() ? autoEngine() : null);
    return v;
  }
  function autoEngine() {
    try {
      var C = G.Capacitor, P = C && C.Plugins, choice = engineChoice();
      if (choice === "rules" || !P || !(C.isNativePlatform && C.isNativePlatform())) return null;
      if (choice === "functiongemma") {
        // No file on the phone: no engine, so the rules answer (silently).
        var M = G.SMD_MAIK_MODELS;
        if (!P.Llama || !M || !M.installedCached || !M.installedCached(FG_PACK)) return null;
        return llamaAdapter(P.Llama, { modelPath: function () { return M.pathFor(FG_PACK); } });
      }
      if (P.Needle) return needleAdapter(P.Needle);
    } catch (e) {}
    return null;
  }

  var API = {
    route: route, rules: rules, candidates: candidates, schemeAsk: schemeAsk, spell: spell, openVerb: function (t) { return OPEN_RE.test(String(t || "")); }, layer0: layer0, negated: function (t) { return NEGATION.test(String(t || "")); }, enabled: flagOn, available: available, setEngine: setEngine,
    needleAdapter: needleAdapter, llamaAdapter: llamaAdapter, grammarFor: grammarFor, bakeoff: bakeoff, autoEngine: autoEngine,
    engineChoice: engineChoice, setEngineChoice: setEngineChoice, engineName: function () { return engine ? engine.name : null; }, promptFor: promptFor, SYSTEM: SYSTEM, optionFrom: optionFrom,
    TOOL_SCHEMA: TOOL_SCHEMA, stats: function () { return JSON.parse(JSON.stringify(stats)); },
    session: function (id) { if (runtime) runtime.setSession(id); }, refreshDevice: refreshDevice,
    warmSoon: scheduleWarm, warmNow: warmNow, warmLog: function () { return warmLog.slice(-10); },
    hot: function () { return device.thermal >= 3; },
    backoff: function () { return { memoryOk: DEFAULT_ENV.memoryOk(), thermalOk: DEFAULT_ENV.thermalOk(), othersBusy: DEFAULT_ENV.othersBusy(), device: JSON.parse(JSON.stringify(device)) }; },
    _version: "1.0"
  };
  if (root) {
    root.SMD_EDGE = API;
    try { if (flagOn()) { var a = autoEngine(); if (a) setEngine(a); } } catch (e) {}
    // FunctionGemma downloaded (or deleted) while chosen: pick it up without a restart.
    try {
      var MM = root.SMD_MAIK_MODELS;
      if (MM && MM.subscribe) MM.subscribe(function (id, st) {
        if (id === FG_PACK && st && !st.downloading && engineChoice() === "functiongemma" && flagOn()) setEngine(autoEngine());
      });
    } catch (e) {}
  }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
