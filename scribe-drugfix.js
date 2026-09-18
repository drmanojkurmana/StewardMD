/* StewardMD — MaiK Scribe: misheard drug-name corrector.
 * ---------------------------------------------------------------------------
 * Speech recognition mangles drug names ("amoxy clav", "pan 40", "atorvastain").
 * This maps a mangled span back to a name the app actually knows — and NOTHING else.
 *
 * SAFETY BOUNDARY. Swapping one drug for another is worse than leaving the transcript
 * alone, so this biases hard toward doing nothing:
 *   • a span is corrected only when it resolves to exactly ONE generic. A name that
 *     several generics claim (a class alias such as "ppi" / "nsaid") is left alone.
 *   • fuzzy matching is delegated to kb/ai/drug-fuzzy.js, which already refuses short
 *     tokens (< 6 chars), distances over min(3, 20% of length), and ties.
 *   • numbers, doses, units and everything outside the matched alphabetic span are
 *     never touched — replacements are spliced in place.
 *   • common dictation words (tab, before, food, days, one …) are never candidates.
 *   • a two-word span is only tried when the single word matched nothing, so a real
 *     word is never swallowed into a neighbouring drug name.
 *   • every correction is reported so the doctor sees exactly what was changed.
 *
 * correct(text, opts) -> { text, corrections:[{from, to, confidence, index}] }
 *   opts.drugs = window.MEDDRUGS._list  [{generic, brands[], ...}]   (injected)
 *   opts.names = extra known names, e.g. Object.keys(SMD_BRANDS.BRANDS)  (optional)
 *   opts.fuzzy = window.DrugFuzzy       (optional; auto-resolved in browser + node)
 *   `index` is the character offset of `from` in the INPUT text.
 *
 * window.SMD_SCRIBEDRUGFIX + module.exports (Node-testable).
 */
(function (root) {
  "use strict";

  var FUZZY = (root && root.DrugFuzzy) || tryReq();
  function tryReq() {
    if (typeof require === "undefined") return null;
    try { return require("./kb/ai/drug-fuzzy.js"); } catch (e) { return null; }
  }

  // Dictation scaffolding + English filler. Never a drug, never a correction candidate.
  var STOP = {};
  ("tab tabs tablet tablets cap caps capsule capsules syp syr syrup inj injection susp suspension " +
   "drop drops ointment cream lotion gel puff puffs inhaler neb nebulisation nebulization sachet " +
   "before after with food meals meal empty stomach water milk night morning evening noon bedtime " +
   "daily twice thrice once times time day days week weeks month months hour hours hrs for and then " +
   "take taking give given continue start started stop stopped one two three four five half quarter " +
   "the a an of on at in to per next also plus patient please add same review reviewed clinic " +
   "od bd bid tds tid qid hs sos prn stat mg mcg gram grams ml iu unit units oral orally po iv im sc " +
   "sl pr topical local inhaled nebulised nebulized").split(" ").forEach(function (w) { STOP[w] = 1; });

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  /* normalized name -> canonical generic, or null when several generics claim it (ambiguous). */
  function buildVocab(opts) {
    var map = {};
    function add(name, canonical) {
      var k = norm(name);
      if (k.length < 2 || STOP[k]) return;
      if (!Object.prototype.hasOwnProperty.call(map, k)) { map[k] = canonical; return; }
      if (map[k] !== null && norm(map[k]) !== norm(canonical)) map[k] = null; // two generics claim it
    }
    (opts.drugs || []).forEach(function (d) {
      if (!d || !d.generic) return;
      add(d.generic, d.generic);
      (d.brands || []).forEach(function (b) { add(b, d.generic); });
    });
    (opts.names || []).forEach(function (n) { if (n) add(n, String(n)); });
    return map;
  }

  function correct(text, opts) {
    var src = String(text == null ? "" : text);
    opts = opts || {};
    var out = { text: src, corrections: [] };
    if (!src) return out;

    var vocab = buildVocab(opts);
    var keys = [];
    for (var k in vocab) if (vocab[k] !== null) keys.push(k);
    if (!keys.length) return out;

    var fuzzy = opts.fuzzy || FUZZY;

    // Alphabetic spans only — digits, doses and units are structurally out of reach.
    var toks = [], re = /[A-Za-z][A-Za-z'’]*/g, m;
    while ((m = re.exec(src))) toks.push({ s: m.index, e: m.index + m[0].length, w: m[0] });

    var hits = [], i = 0;
    while (i < toks.length) {
      var got = resolve(toks[i].w, vocab, keys, fuzzy);
      if (got) { hits.push({ s: toks[i].s, e: toks[i].e, hit: got }); i += 1; continue; }
      // Two-word fallback ("amoxy clav", "tranexamic acid"): both words must be candidates.
      if (i + 1 < toks.length && !STOP[norm(toks[i].w)] && !STOP[norm(toks[i + 1].w)] &&
          /^[\s\-]*$/.test(src.slice(toks[i].e, toks[i + 1].s))) {
        got = resolve(src.slice(toks[i].s, toks[i + 1].e), vocab, keys, fuzzy);
        if (got) { hits.push({ s: toks[i].s, e: toks[i + 1].e, hit: got }); i += 2; continue; }
      }
      i += 1;
    }

    var result = src;
    for (var h = hits.length - 1; h >= 0; h--) {
      var x = hits[h], from = src.slice(x.s, x.e);
      result = result.slice(0, x.s) + x.hit.to + result.slice(x.e);
      out.corrections.unshift({ from: from, to: x.hit.to, confidence: x.hit.confidence, index: x.s });
    }
    out.text = result;
    return out;
  }

  function resolve(span, vocab, keys, fuzzy) {
    var q = norm(span);
    if (!q || STOP[q]) return null;
    if (Object.prototype.hasOwnProperty.call(vocab, q)) {
      var canon = vocab[q];
      if (canon === null) return null;                 // ambiguous alias — leave the transcript alone
      if (norm(canon) === q) return null;              // already the canonical name
      return { to: canon, confidence: 1 };
    }
    if (!fuzzy || !fuzzy.bestGenericMatch) return null;
    var best = fuzzy.bestGenericMatch(q, keys);        // refuses short, far and ambiguous matches
    if (!best) return null;
    var canonical = vocab[norm(best.generic)];
    if (!canonical) return null;
    if (norm(canonical) === q) return null;
    var conf = Math.round((1 - best.distance / Math.max(q.length, 1)) * 100) / 100;
    return { to: canonical, confidence: conf };
  }

  var API = { correct: correct, _version: "1.0" };
  if (root) root.SMD_SCRIBEDRUGFIX = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
