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

  /* CLINICAL WORDS ARE NEVER DRUG CANDIDATES.
   * Indian brand names are coined from the conditions they treat, so an ordinary consult word sits a
   * couple of edits from a real brand: "vomiting" is 2 from "Vomikind", which resolves unambiguously
   * to Ondansetron. The ambiguity guard never fires, because there is nothing ambiguous about it - the
   * word simply is not a drug. Correcting it DELETED a cardinal symptom from the text sent for
   * structuring: "no vomiting" became "no Ondansetron", and the negation the note depends on was gone.
   * These words are excluded outright. */
  ("vomiting vomit vomits vomited nausea nauseated fever fevers febrile cough coughing cold chills " +
   "rigors pain pains painful ache aches aching burning itching itch swelling swollen rash rashes " +
   "loose motions stools stool diarrhoea diarrhea constipation giddiness dizziness headache migraine " +
   "weakness tired tiredness fatigue breathless breathlessness wheeze wheezing chest abdomen abdominal " +
   "stomach throat sneezing running nose bleeding bleed discharge appetite sleep sleeping weight " +
   "urine urination burning micturition palpitations sweating anxiety depression tremor numbness " +
   "tingling blurring vision hearing balance seizure fits fainting swelling oedema edema jaundice " +
   "itching allergy allergic reaction infection infected inflammation ulcer wound injury fracture " +
   "pregnancy pregnant periods menstrual bleeding delivery feeding vaccination immunisation " +
   "diabetes diabetic hypertension hypertensive asthma asthmatic thyroid epilepsy seizures " +
   "history examination diagnosis treatment medicine medicines medication tablets advised advice " +
   "symptoms symptom complaint complaints duration since morning evening improving worsening").split(" ")
    .forEach(function (w) { STOP[w] = 1; });

  /* A FUZZY HIT NEEDS MEDICINE CONTEXT.
   * An exact hit in the app's own drug table stands on its own. A near-miss does not: it is a guess,
   * and the STOP list above can only cover words somebody thought of. So an inexact correction is
   * accepted only where the sentence is actually prescribing - a form word before it, or a dose,
   * unit or frequency after it. Prose keeps its words. */
  var FORM_BEFORE = {};
  ("tab tabs tablet tablets cap caps capsule capsules syp syr syrup inj injection susp suspension drop " +
   "drops ointment cream lotion gel puff puffs inhaler neb sachet start started stop stopped give given " +
   "take taking taken continue continued prescribe prescribed add added switch switched on").split(" ")
    .forEach(function (w) { FORM_BEFORE[w] = 1; });
  var FREQ_AFTER = {};
  ("od bd bid tds tid qid hs sos prn stat daily twice thrice once nocte mane weekly monthly").split(" ")
    .forEach(function (w) { FREQ_AFTER[w] = 1; });
  var UNIT_AFTER = /^[\s\-]*\d+(\.\d+)?\s*(mg|mcg|g|gm|gram|grams|ml|iu|units?|%)?\b/i;

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // drug-fuzzy.js refuses anything shorter than this outright, so a shorter token can never produce
  // a match and must never pay for a vocabulary scan. Kept in step with its `minLen` default.
  var FUZZY_MIN_LEN = 6;
  // Its threshold for a token of length n. A vocabulary key whose length differs by more than this
  // is pruned by drug-fuzzy itself, so pre-selecting by length changes no result - it only stops us
  // handing over keys that are arithmetically incapable of matching.
  function maxDistFor(n) { return Math.min(3, Math.max(1, Math.round(n * 0.2))); }

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

  // The vocabulary depends only on the injected lists, which are the app's static drug tables. It was
  // being rebuilt on every call, and every token was then compared against every key - so the cost
  // grew with transcript length AND vocabulary size, reaching seconds on a phone for a long consult.
  // Cached by list identity, with the keys bucketed by length so a query only ever sees the keys that
  // could possibly match it. Nothing here changes which corrections come out.
  var _cache = null;   // { drugs, names, vocab, keys, buckets }
  function vocabFor(opts) {
    if (_cache && _cache.drugs === opts.drugs && _cache.names === opts.names) return _cache;
    var vocab = buildVocab(opts);
    var keys = [], buckets = {};
    for (var k in vocab) {
      if (vocab[k] === null) continue;
      keys.push(k);
      (buckets[k.length] || (buckets[k.length] = [])).push(k);
    }
    // The memo rides with the vocabulary: a refine re-scans the whole growing transcript, so without
    // it every earlier word is resolved again on every pass (the O(n squared) cost over a consult).
    _cache = { drugs: opts.drugs, names: opts.names, vocab: vocab, keys: keys, buckets: buckets, memo: {} };
    return _cache;
  }
  // Only the keys whose length is within the matcher's own threshold of this query.
  function candidates(buckets, len) {
    var d = maxDistFor(len), out = [];
    for (var n = len - d; n <= len + d; n++) { var b = buckets[n]; if (b) out = out.concat(b); }
    return out;
  }

  function correct(text, opts) {
    var src = String(text == null ? "" : text);
    opts = opts || {};
    var out = { text: src, corrections: [] };
    if (!src) return out;

    var cached = vocabFor(opts);
    var vocab = cached.vocab, keys = cached.keys;
    if (!keys.length) return out;

    var fuzzy = opts.fuzzy || FUZZY;
    // A consult transcript repeats the same words constantly, and each refine re-scans the whole of
    // it; resolve each distinct span once and keep that for the life of the vocabulary.
    var memo = cached.memo;

    // Alphabetic spans only — digits, doses and units are structurally out of reach.
    var toks = [], re = /[A-Za-z][A-Za-z'’]*/g, m;
    while ((m = re.exec(src))) toks.push({ s: m.index, e: m.index + m[0].length, w: m[0] });

    function resolveMemo(span) {
      var q = norm(span);
      if (Object.prototype.hasOwnProperty.call(memo, q)) return memo[q];
      var r = resolve(span, vocab, cached.buckets, fuzzy);
      memo[q] = r;
      return r;
    }

    // Prescribing context around a span: a form word before it, or a dose/unit/frequency after it.
    function prescribed(startTok, endTok) {
      var prev = startTok > 0 ? norm(toks[startTok - 1].w) : "";
      if (FORM_BEFORE[prev]) return true;
      var after = src.slice(toks[endTok].e);
      if (UNIT_AFTER.test(after)) return true;
      var next = endTok + 1 < toks.length ? norm(toks[endTok + 1].w) : "";
      return !!FREQ_AFTER[next];
    }
    // An exact table hit stands alone; a near-miss must be in a prescribing sentence (see above).
    function accept(got, startTok, endTok) {
      if (!got) return null;
      if (got.confidence >= 1) return got;
      return prescribed(startTok, endTok) ? got : null;
    }

    var hits = [], i = 0;
    while (i < toks.length) {
      var got = accept(resolveMemo(toks[i].w), i, i);
      if (got) { hits.push({ s: toks[i].s, e: toks[i].e, hit: got }); i += 1; continue; }
      // Two-word fallback ("amoxy clav", "tranexamic acid"): both words must be candidates.
      if (i + 1 < toks.length && !STOP[norm(toks[i].w)] && !STOP[norm(toks[i + 1].w)] &&
          /^[\s\-]*$/.test(src.slice(toks[i].e, toks[i + 1].s))) {
        got = accept(resolveMemo(src.slice(toks[i].s, toks[i + 1].e)), i, i + 1);
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

  function resolve(span, vocab, buckets, fuzzy) {
    var q = norm(span);
    if (!q || STOP[q]) return null;
    if (Object.prototype.hasOwnProperty.call(vocab, q)) {
      var canon = vocab[q];
      if (canon === null) return null;                 // ambiguous alias — leave the transcript alone
      if (norm(canon) === q) return null;              // already the canonical name
      return { to: canon, confidence: 1 };
    }
    if (!fuzzy || !fuzzy.bestGenericMatch) return null;
    if (q.length < FUZZY_MIN_LEN) return null;         // the matcher would refuse it anyway - don't scan
    var near = candidates(buckets, q.length);
    if (!near.length) return null;
    var best = fuzzy.bestGenericMatch(q, near);        // refuses short, far and ambiguous matches
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
