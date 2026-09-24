/* drug-link.js - window.SMD_DRUGLINK
 *
 * Every drug name on a reading surface is highlighted (bold, yellow) and opens that drug's
 * monograph in the Drugs Database on tap (MEDDB.openComposition, the same page "Open in Drug Index"
 * opens). In MaiK, a question that names a drug first offers the monograph (home.js send()).
 *
 * Detection is local and deterministic, so it works offline and today:
 *   - drug-lexicon.js   2,200+ generics + brands from data/interaction-rules.json (public domain)
 *   - MEDDRUGS._list    the Drug Index formulary (generic + brand names)
 *   - SMD_BRANDS        the app's brand-to-generic map
 *   - learn(names)      names from the OpenMed drug tagger (openmed-ner.js) once that pack is enabled
 *   - fuzzy (opt-in, questions only): one misspelled word of 6+ letters, e.g. "paracetomol", via
 *     DrugFuzzy.bestGenericMatch against single-word generics (unique best match, 1-2 edits)
 *
 * Flags (localStorage): smd_druglink  DEFAULT ON, "0" = no highlighting and no MaiK prompt.
 *                       smd_druglink_ask DEFAULT ON, "0" = keep highlighting, skip the MaiK prompt
 *                       ("Don't ask again" on the prompt card sets it).
 * ES5, node + browser (find() is pure; highlight()/watch() need a DOM).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SMD_DRUGLINK = api;
})(typeof window !== "undefined" ? window : null, function (W) {
  "use strict";

  function lget(k) { try { return W && W.localStorage ? W.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function enabled() { return lget("smd_druglink") !== "0"; }
  function askEnabled() { return enabled() && lget("smd_druglink_ask") !== "0"; }
  function title(s) { return String(s || "").replace(/(^|[\s\-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }

  // Brand words that are also everyday or clinical English: never highlighted as a drug.
  var STOP = { pan: 1, ppi: 1, acid: 1, relief: 1, total: 1, cold: 1, "stop": 1, calm: 1, rest: 1, flow: 1, "clear": 1,
    "active": 1, "rapid": 1, "fresh": 1, "sleep": 1, "focus": 1, "boost": 1, "cough": 1, "fever": 1, "plain": 1,
    "tablet": 1, "tablets": 1, "capsule": 1, "syrup": 1, "injection": 1, "drops": 1, "cream": 1, "patients": 1,
    // drug CLASSES the formulary lists as search aliases: not one drug, so no single monograph to open
    steroid: 1, steroids: 1, statin: 1, statins: 1, nsaid: 1, nsaids: 1, antiemetic: 1, antiemetics: 1, laxative: 1,
    laxatives: 1, antibiotic: 1, antibiotics: 1, "beta blocker": 1, "h2 blocker": 1, diuretic: 1, anticoagulant: 1 };

  // ── Index: first word -> phrases (longest first) ────────────────────────────────────────────────
  var idx = null, fuzzyVocab = [], learned = {}, sig = "";
  function sources() {
    var L = (W && W.SMD_DRUG_LEXICON) || null, M = (W && W.MEDDRUGS && W.MEDDRUGS._list) || [], B = (W && W.SMD_BRANDS && W.SMD_BRANDS.BRANDS) || {};
    return { L: L, M: M, B: B, s: (L ? L.generics.length : 0) + "|" + M.length + "|" + Object.keys(B).length + "|" + Object.keys(learned).length };
  }
  function build() {
    var S = sources();
    if (idx && S.s === sig) return idx;
    var map = {}, seen = {}, single = {};
    function add(name, generic) {
      var n = String(name || "").toLowerCase().replace(/\s*\(.*$/, "").replace(/[^a-z0-9\- ]+/g, " ").replace(/\s+/g, " ").trim();
      var g = String(generic || "").toLowerCase().replace(/\s*\(.*$/, "").trim();
      if (n.length < 4 || !g || STOP[n] || seen[n]) return;
      seen[n] = 1;
      var words = n.split(/[ \-]+/);
      (map[words[0]] = map[words[0]] || []).push({ words: words, generic: g });
      if (words.length === 1 && n.length >= 6) single[n] = g;
    }
    if (S.L) {
      S.L.generics.forEach(function (g) { add(g, g); });
      for (var b in S.L.brands) if (Object.prototype.hasOwnProperty.call(S.L.brands, b)) add(b, S.L.brands[b]);
    }
    S.M.forEach(function (d) {
      add(d.generic, d.generic);
      (d.brands || []).forEach(function (br) { if (String(br).length >= 5) add(br, d.generic); });
    });
    for (var k in S.B) if (Object.prototype.hasOwnProperty.call(S.B, k)) {
      var v = [].concat(S.B[k]); if (v.length === 1 && String(k).length >= 5) add(k, v[0]);
    }
    for (var ln in learned) if (Object.prototype.hasOwnProperty.call(learned, ln)) add(ln, learned[ln]);
    for (var f in map) map[f].sort(function (a, c) { return c.words.length - a.words.length; });
    fuzzyVocab = Object.keys(single); fuzzyVocab.gen = single;
    idx = map; sig = S.s;
    return idx;
  }
  /** Names from the OpenMed drug tagger (or any trusted source). They become exact matches. */
  function learn(names) {
    (names || []).forEach(function (n) { n = String(n || "").toLowerCase().trim(); if (n.length >= 4 && !STOP[n]) learned[n] = n; });
  }

  // ── Detection ───────────────────────────────────────────────────────────────────────────────────
  var WORD = /[A-Za-z][A-Za-z0-9]*/g;   // hyphens separate words; multi-word names match across " " or "-"
  /** Drug mentions in text: [{start, end, text, generic, fuzzy}] in order, non-overlapping. */
  function find(text, opts) {
    opts = opts || {};
    var s = String(text == null ? "" : text), out = [];
    if (!s) return out;
    var map = build(), toks = [], m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(s)) !== null) toks.push({ w: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length });
    for (var i = 0; i < toks.length; i++) {
      var cands = map[toks[i].w], hit = null;
      if (cands) {
        for (var c = 0; c < cands.length && !hit; c++) {
          var ws = cands[c].words, ok = i + ws.length <= toks.length;
          for (var j = 1; ok && j < ws.length; j++) ok = toks[i + j].w === ws[j] && /^[\s\-]+$/.test(s.slice(toks[i + j - 1].e, toks[i + j].s));
          if (ok) hit = { n: ws.length, generic: cands[c].generic };
        }
      }
      if (hit) {
        out.push({ start: toks[i].s, end: toks[i + hit.n - 1].e, text: s.slice(toks[i].s, toks[i + hit.n - 1].e), generic: hit.generic, fuzzy: false });
        i += hit.n - 1;
        continue;
      }
      if (opts.fuzzy && toks[i].w.length >= 6 && /^[a-z]+$/.test(toks[i].w)) {
        var DF = W && W.DrugFuzzy;
        var bm = DF && DF.bestGenericMatch ? DF.bestGenericMatch(toks[i].w, fuzzyVocab, { minLen: 6, maxDist: 2 }) : null;
        if (bm && bm.distance > 0) out.push({ start: toks[i].s, end: toks[i].e, text: s.slice(toks[i].s, toks[i].e), generic: fuzzyVocab.gen[bm.generic] || bm.generic, fuzzy: true });
      }
    }
    return out;
  }
  /** Unique generics named in text, in order (for the MaiK prompt). */
  function drugsIn(text, opts) {
    var seen = {}, out = [];
    find(text, opts).forEach(function (h) { if (!seen[h.generic]) { seen[h.generic] = 1; out.push({ generic: h.generic, name: title(h.generic), typed: h.text, fuzzy: h.fuzzy }); } });
    return out;
  }

  // ── DOM: highlight, open, watch ─────────────────────────────────────────────────────────────────
  var SKIP = "script,style,textarea,input,select,option,button,a,code,pre,mark,canvas,[contenteditable],.smd-drug,.maik-thinking,.maik-dosecard,svg,.no-druglink";
  function css() {
    if (!W || !W.document || W.document.getElementById("smd-druglink-css")) return;
    var st = W.document.createElement("style"); st.id = "smd-druglink-css";
    // At rest a drug name is only BOLD. When it scrolls into view (and on hover) a band of light
    // FLOWS through its letters, left to right, for GLOW_MS (two slow passes, multicolour), then it rests as plain bold again: no box,
    // no permanent yellow (owner, 2026-09-24: "letters to glow in a flow"). The letters keep their own
    // ink colour (currentColor) outside the moving band, so the word stays readable throughout.
    // Multicolour light (teal, sky, violet, rose): mid-tones, so the word stays readable on white and dark.
    var SWEEP = "linear-gradient(100deg,currentColor 0%,currentColor 30%,#14b8a6 38%,#0ea5e9 45%,#8b5cf6 52%,#ec4899 59%,currentColor 68%,currentColor 100%)";
    st.textContent =
      ".smd-drug{font-weight:700;color:inherit;cursor:pointer;-webkit-box-decoration-break:clone;box-decoration-break:clone}" +
      ".smd-drug.smd-glow{background-image:" + SWEEP + ";background-size:250% 100%;background-repeat:no-repeat;" +
        "-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;" +
        "animation:smdDrugFlow 2.5s cubic-bezier(.45,.05,.35,1) 2,smdDrugHalo " + (GLOW_MS / 1000) + "s ease-out 1}" +
      "@keyframes smdDrugFlow{0%{background-position:100% 0}100%{background-position:0 0}}" +
      "@keyframes smdDrugHalo{0%{filter:drop-shadow(0 0 0 rgba(139,92,246,0))}" +
        "20%{filter:drop-shadow(0 0 5px rgba(56,189,248,.45)) drop-shadow(0 0 9px rgba(139,92,246,.3))}" +
        "70%{filter:drop-shadow(0 0 4px rgba(236,72,153,.28)) drop-shadow(0 0 7px rgba(20,184,166,.22))}" +
        "100%{filter:drop-shadow(0 0 0 rgba(139,92,246,0))}}" +
      "@media (hover:hover){.smd-drug:hover{background-image:" + SWEEP + ";background-size:250% 100%;background-repeat:no-repeat;" +
        "-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;" +
        "animation:smdDrugFlow 2.5s cubic-bezier(.45,.05,.35,1) infinite;filter:drop-shadow(0 0 5px rgba(139,92,246,.35))}}" +
      ".smd-drug:focus-visible{outline:2px solid #0e6e63;outline-offset:1px;border-radius:3px}" +
      // Reduced motion: no moving light, a still gold word for the same 5 s.
      "@media (prefers-reduced-motion:reduce){.smd-drug.smd-glow,.smd-drug:hover{animation:none;background-image:none;" +
        "-webkit-text-fill-color:#7c3aed;filter:none}}" +
      // Printed protocol sheets, discharge notes and PDFs: plain text.
      "@media print{.smd-drug{background:none!important;animation:none!important;filter:none!important;" +
        "-webkit-text-fill-color:currentColor!important;color:inherit!important;font-weight:inherit!important}}";
    W.document.head.appendChild(st);
  }
  // ── Glow on view: an IntersectionObserver per page. A name glows when it comes into view, and is
  // re-armed only after it has fully left the view, so small scroll jitter does not re-flash it.
  var GLOW_MS = 5000;
  var io = null, seenEls = (typeof WeakSet !== "undefined") ? new WeakSet() : null;
  function glow(el) {
    if (el._smdGlowT) return;
    el.classList.remove("smd-glow"); void el.offsetWidth;   // restart the animation cleanly
    el.classList.add("smd-glow");
    el._smdGlowT = W.setTimeout(function () { el.classList.remove("smd-glow"); el._smdGlowT = null; }, GLOW_MS);
  }
  function observeGlow(el) {
    if (seenEls) { if (seenEls.has(el)) return; seenEls.add(el); }
    el.classList.remove("smd-glow");                         // a saved thread may carry a mid-glow class
    el._smdArmed = true;
    if (!W.IntersectionObserver) return;
    if (!io) io = new W.IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var t = en.target;
        if (en.isIntersecting) { if (t._smdArmed) { t._smdArmed = false; glow(t); } }
        else t._smdArmed = true;
      });
    }, { threshold: 0.6 });
    io.observe(el);
  }
  function highlight(rootEl) {
    if (!enabled() || !rootEl || !W || !W.document || !W.document.createTreeWalker) return 0;
    css();
    var doc = W.document, tw = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, null, false), nodes = [], n, count = 0, made = [];
    while ((n = tw.nextNode())) {
      if (!n.nodeValue || n.nodeValue.length < 4) continue;
      var p = n.parentNode;
      if (!p || (p.closest && p.closest(SKIP))) continue;
      nodes.push(n);
    }
    nodes.forEach(function (tn) {
      // The doctor's own question is matched with fuzzy spelling too ("paracetomol"); answer text,
      // which the app or the model wrote, is exact only.
      var mine = tn.parentNode.closest && tn.parentNode.closest(".maik-b.you");
      var text = tn.nodeValue, hits = find(text, { fuzzy: !!mine });
      if (!hits.length) return;
      var frag = doc.createDocumentFragment(), at = 0;
      hits.forEach(function (h) {
        if (h.start > at) frag.appendChild(doc.createTextNode(text.slice(at, h.start)));
        // A <span>, not a <mark>: exported HTML that copies this DOM without our stylesheet must not
        // come out yellow (a bare <mark> is yellow in every browser by default).
        var mk = doc.createElement("span");
        mk.className = "smd-drug";
        mk.setAttribute("data-smd-drug", h.generic);
        mk.setAttribute("data-maik-drugidx", title(h.generic));   // MaiK's own handler opens it inside the sheet
        mk.setAttribute("role", "button"); mk.setAttribute("tabindex", "0");
        mk.setAttribute("title", "Open the " + title(h.generic) + " monograph");
        mk.textContent = h.text;
        frag.appendChild(mk); at = h.end; count++; made.push(mk);
      });
      if (at < text.length) frag.appendChild(doc.createTextNode(text.slice(at)));
      tn.parentNode.replaceChild(frag, tn);
    });
    // New names, plus any restored from a saved MaiK thread, glow as they come into view.
    made.forEach(observeGlow);
    try { var old = rootEl.querySelectorAll ? rootEl.querySelectorAll(".smd-drug") : []; for (var oi = 0; oi < old.length; oi++) observeGlow(old[oi]); } catch (e) {}
    return count;
  }
  // Opened from a surface that may sit above the Drugs Database (protocol sheet, reader modes): lift the
  // database to the top while it is open, and put its z-index back when it closes.
  function lift() {
    var db = W.document && W.document.getElementById("dbOverlay");
    if (!db || db.getAttribute("data-druglink-lift")) return;
    db.setAttribute("data-druglink-lift", db.style.zIndex || "-");
    db.style.zIndex = "2147480000";
    if (!W.MutationObserver) return;
    var mo = new W.MutationObserver(function () {
      if (db.classList.contains("on")) return;
      var prev = db.getAttribute("data-druglink-lift");
      db.style.zIndex = prev === "-" ? "" : prev; db.removeAttribute("data-druglink-lift"); mo.disconnect();
    });
    mo.observe(db, { attributes: true, attributeFilter: ["class"] });
  }
  function openMonograph(generic) {
    var name = title(generic);
    try {
      if (W.MEDDB && W.MEDDB.openComposition && name) { var r = W.MEDDB.openComposition(name); lift(); return r; }
      if (W.MEDDB && W.MEDDB.openList) return W.MEDDB.openList();
      if (W.toast) W.toast("Drugs Database loading...");
    } catch (e) {}
  }
  function onActivate(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest(".smd-drug") : null;
    if (!t) return;
    if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
    if (t.closest(".maik-b") && ev.type === "click") return;   // MaiK's sheet handler owns taps inside MaiK
    ev.preventDefault();
    openMonograph(t.getAttribute("data-smd-drug"));
  }
  // Reading surfaces: where drug names are read. Editors (prescription pad, OPD assessment, protocol
  // maker) are deliberately absent, and the Drugs Database (#dbOverlay) is the monograph itself.
  var SURFACES = [
    "maikBody",                                                        // MaiK questions and replies
    "icuAskSheet", "icuDeepSheet", "icuDisAiSheet", "icuEvSheet",      // ICU MaiK / evidence / AI discharge
    "sbrefBody",                                                       // Knowledge Library + Syndromes, Antibiogram, AWaRe, Guidelines tabs
    "dxOverlay", "refOverlay",                                         // disease reader, management, references
    "abgBody",                                                         // antibiogram
    "smdProtoSheet", "smdOncoHome",                                    // chemotherapy protocols, oncology home
    "clinixScroll", "surgxScroll"                                      // CliniX learning, SURGX protocols and procedures
  ];
  var watched = [];
  function watch(el) {
    if (!el || watched.indexOf(el) >= 0 || !W.MutationObserver) return;
    watched.push(el);
    var t = null;
    function run() { t = null; try { highlight(el); } catch (e) {} }
    new W.MutationObserver(function () { if (!t) t = W.setTimeout(run, 250); }).observe(el, { childList: true, subtree: true, characterData: true });
    run();
  }
  function scan() { SURFACES.forEach(function (id) { var el = W.document.getElementById(id); if (el) watch(el); }); }
  function boot() {
    if (!W || !W.document || !W.document.addEventListener) return;
    W.document.addEventListener("click", onActivate, false);
    W.document.addEventListener("keydown", onActivate, false);
    if (!enabled() || !W.MutationObserver) return;
    scan();
    // Overlays are appended to <body> when first opened: a childList-only observer on <body> is cheap.
    new W.MutationObserver(function () { scan(); }).observe(W.document.body, { childList: true });
  }
  if (W && W.document) {
    if (W.document.readyState === "loading") W.document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  return { find: find, drugsIn: drugsIn, highlight: highlight, watch: watch, learn: learn, openMonograph: openMonograph,
    enabled: enabled, askEnabled: askEnabled, SURFACES: SURFACES, _title: title };
});
