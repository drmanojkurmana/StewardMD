/* emoji-icons.js - window.SMD_EMOJI_ICONS
 *
 * No emoji in the app (owner, 2026-09-24: "remove emoji all over the app and replace with icons").
 * About 1,500 emoji live in 71 source files, in HTML, toasts, textContent, titles, <option> text and
 * PDF strings, so a source rewrite would break every place that is not HTML. Instead this runs on the
 * rendered page, like drug-link.js:
 *   - visible text: each emoji becomes the matching line icon from the app's own catalogue
 *     (window.ICONS, home.js), drawn in the text's colour at text size; status circles
 *     (green/red/orange...) become small solid dots of that colour; anything unmapped is removed
 *   - where markup cannot go (title, placeholder, aria-label, alt, <option>, document.title,
 *     alert/confirm/prompt) the emoji is removed
 *   - typographic symbols are kept on purpose: arrows, triangles, bullets, check/cross marks, stars,
 *     (c) (r) (tm). They are text, not emoji.
 * User input (textarea, input values, contenteditable) is never touched.
 * Flag: localStorage smd_noemoji, DEFAULT ON; "0" leaves every emoji as it was.
 * ES5 with a feature-detected Unicode regex (\p{Extended_Pictographic}); node + browser.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SMD_EMOJI_ICONS = api;
})(typeof window !== "undefined" ? window : null, function (W) {
  "use strict";

  function lget(k) { try { return W && W.localStorage ? W.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function enabled() { return lget("smd_noemoji") !== "0"; }

  // One emoji "cluster": a flag pair, a keycap, or a pictograph with its variation selector, skin tone
  // and any zero-width-joined parts ("health worker" = person + ZWJ + staff of Aesculapius).
  var CLUSTER = null;
  try {
    CLUSTER = new RegExp(
      "(?:[\\u{1F1E6}-\\u{1F1FF}]{2})" +
      "|(?:[#*0-9]\\uFE0F?\\u20E3)" +
      "|(?:\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*)*)",
      "gu");
  } catch (e) {
    // Old engine: surrogate-pair pictographs plus the Misc Symbols / Dingbats blocks.
    CLUSTER = /(?:[\uD83C-\uD83E][\uDC00-\uDFFF](?:\uFE0F|\uD83C[\uDFFB-\uDFFF])*(?:\u200D(?:[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF])\uFE0F?)*)|(?:[\u2600-\u27BF\u2B00-\u2BFF\u231A-\u23FF]\uFE0F?)/g;
  }

  // Text symbols that match Extended_Pictographic but are typography here, not emoji: keep them.
  var KEEP = {};
  ("\u00A9\u00AE\u2122\u203C\u2049\u2194\u2195\u2196\u2197\u2198\u2199\u21A9\u21AA\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FD\u25FE" +
   "\u2713\u2715\u2716\u2717\u2610\u2611\u2612\u2605\u2606\u2660\u2663\u2665\u2666\u27A4\u279C\u2794\u2B05\u2B06\u2B07\u27A1\u2934\u2935\u3030\u303D")
    .split("").forEach(function (c) { KEEP[c] = 1; });

  // Emoji (first code point, variation selector removed) to a window.ICONS name.
  var MAP = {
    "\u{1F514}": "bell", "\u{1F4E3}": "bell", "\u{1F4E2}": "bell", "\u{1F515}": "bell", "\u{1F6CE}": "bell",
    "\u{1FA7A}": "steth", "\u{1F9D1}\u200D\u2695": "steth", "\u{1F469}\u200D\u2695": "steth", "\u{1F468}\u200D\u2695": "steth",
    "\u{1F4CB}": "list", "\u{1F5D2}": "list", "\u{1F4DD}": "note", "\u{1F4C4}": "note", "\u{1F4C3}": "note", "\u{1F4DC}": "note", "\u{1F4D1}": "note",
    "\u270E": "edit", "\u270F": "edit", "\u{1F58A}": "edit", "\u{1F58B}": "edit", "\u{1F4DD}\uFE0F": "note",
    "\u{1F48A}": "pills", "\u{1F489}": "syringe", "\u{1FA78}": "droplet", "\u{1F4A7}": "droplet", "\u{1F4A6}": "droplet",
    "\u{1F3E5}": "hospital", "\u{1F3E8}": "hospital", "\u{1F691}": "siren", "\u{1F6A8}": "siren",
    "\u{1FAC1}": "lungs", "\u{1F32C}": "lungs", "\u{1FAC0}": "heart", "\u2764": "heart", "\u{1F497}": "heart", "\u{1F493}": "pulse", "\u{1F494}": "heart",
    "\u{1F9E0}": "brain", "\u{1FAD8}": "kidney", "\u{1F9B4}": "bone", "\u{1F441}": "eye", "\u{1F440}": "eye", "\u{1F9B7}": "bone",
    "\u{1F930}": "pregnant", "\u{1F931}": "baby", "\u{1F476}": "baby", "\u{1F9D2}": "baby",
    "\u{1F4F7}": "camera", "\u{1F4F8}": "camera", "\u{1F4F9}": "camera", "\u{1FA7B}": "xray",
    "\u{1F512}": "lock", "\u{1F513}": "lock", "\u{1F510}": "lock", "\u{1F511}": "lock", "\u{1F6E1}": "shield",
    "\u{1F5D1}": "trash", "\u{1F9F9}": "clear", "\u{1F50E}": "search", "\u{1F50D}": "search",
    "\u{1F9EA}": "flask", "\u2697": "flask", "\u{1F52C}": "microbe", "\u{1F9EB}": "microbe", "\u{1F9A0}": "microbe", "\u{1F9EC}": "dna",
    "\u{1F9EE}": "calc", "\u{1F522}": "keypad", "\u{1F4CA}": "trend", "\u{1F4C8}": "trend", "\u{1F4C9}": "trend",
    "\u{1F4E4}": "upload", "\u{1F4E5}": "download", "\u{1F4BE}": "save", "\u{1F5A8}": "print", "\u{1F517}": "link",
    "\u{1F4DA}": "book", "\u{1F4D6}": "book", "\u{1F4D8}": "book", "\u{1F4D5}": "book", "\u{1F4D7}": "book", "\u{1F4D9}": "book",
    "\u{1F4C1}": "folder", "\u{1F4C2}": "folder", "\u{1F5C2}": "folder", "\u{1F5C4}": "folder", "\u{1F9FE}": "receipt_long",
    "\u{1F9D1}": "user", "\u{1F464}": "user", "\u{1F465}": "user", "\u{1F468}": "user", "\u{1F469}": "user", "\u{1F9D1}\u200D\u{1F4BB}": "user",
    "\u{1F319}": "moon", "\u{1F313}": "moon", "\u{1F31C}": "moon", "\u2600": "sun", "\u{1F31E}": "sun", "\u{1F324}": "sun", "\u2601": "cloud",
    "\u2699": "settings", "\u{1F6E0}": "settings", "\u{1F527}": "settings", "\u{1F529}": "settings", "\u2696": "scales",
    "\u2728": "spark", "\u{1F389}": "spark", "\u{1F38A}": "spark", "\u{1F4A1}": "spark", "\u{1F31F}": "star", "\u2B50": "star", "\u{1F3C5}": "award", "\u{1F3C6}": "award", "\u{1F396}": "award",
    "\u26A1": "bolt", "\u{1F525}": "bolt", "\u{1F3AF}": "target", "\u{1F9ED}": "target", "\u{1F310}": "globe", "\u{1F30D}": "globe", "\u{1F30F}": "globe",
    "\u{1F41E}": "bug", "\u{1F41B}": "bug", "\u{1F99F}": "bug", "\u{1F3A4}": "mic", "\u{1F399}": "mic",
    "\u{1F4F1}": "device", "\u{1F4BB}": "device", "\u{1F5A5}": "device", "\u{1F4F6}": "device", "\u231A": "clock",
    "\u{1F3E0}": "home", "\u{1F3E1}": "home", "\u2709": "note", "\u{1F4E7}": "note", "\u{1F4E8}": "note", "\u{1F4E9}": "note",
    "\u{1F504}": "refresh", "\u{1F503}": "refresh", "\u{1F501}": "refresh", "\u{1F300}": "refresh",
    "\u{1F44D}": "thumbUp", "\u{1F44E}": "thumbDown", "\u{1F6A9}": "flag", "\u{1F3C1}": "flag",
    "\u23F1": "clock", "\u23F0": "clock", "\u{1F552}": "clock", "\u23F3": "hourglass", "\u231B": "hourglass",
    "\u26D4": "stop", "\u{1F6D1}": "stop", "\u{1F6AB}": "stop", "\u{1F321}": "pulse", "\u{1FA79}": "plus", "\u2795": "plus",
    "\u{1F4B0}": "bill", "\u{1F4B3}": "bill", "\u{1F4B5}": "bill", "\u{1F4B8}": "bill", "\u{1F4CC}": "target", "\u{1F4CD}": "target",
    "\u{1F4F0}": "note", "\u{1F4AC}": "note", "\u{1F5E8}": "note", "\u{1F4AD}": "note", "\u{1F9FE}\uFE0F": "receipt_long",
    "\u{1F393}": "award", "\u{1F9EA}\uFE0F": "flask", "\u{1F34E}": "heart", "\u{1F36C}": "droplet", "\u{1F95B}": "droplet",
    "\u{1F6BB}": "user", "\u{1F9CD}": "user", "\u{1F6B6}": "user", "\u{1F3C3}": "user", "\u{1F4AA}": "user", "\u{1F9D8}": "user",
    "\u{1F4E6}": "folder", "\u{1F5C3}": "folder", "\u{1F4C5}": "clock", "\u{1F4C6}": "clock", "\u{1F5D3}": "clock", "\u{1F4D2}": "note",
    "\u{1F4AF}": "award", "\u{1F4E1}": "hub", "\u{1F9E9}": "grid", "\u{1F6AA}": "logout", "\u{1F5DD}": "lock",
    "\u{1F39B}": "sliders", "\u{1F6F0}": "hub", "\u{1F3EB}": "hospital", "\u{1F680}": "bolt", "\u{1F916}": "ai", "\u{1F5E3}": "mic", "\u{1F397}": "ribbon", "\u{1F3A5}": "camera", "\u{1F4DE}": "device", "\u{1F4F2}": "device", "\u{1F4CE}": "link", "\u{1F451}": "award", "\u{1F551}": "clock", "\u{1F558}": "clock", "\u{1F550}": "clock", "\u{1F6A7}": "warn", "\u{1F91D}": "user",
    "\u2630": "menu", "\u{1F5C3}\uFE0F": "folder",
    // status meanings, coloured like the emoji they replace
    "\u2705": "check", "\u2714": "check", "\u2611": "check", "\u{1F197}": "check",
    "\u274C": "close", "\u274E": "close", "\u2716": "close", "\u2718": "close",
    "\u26A0": "warn", "\u2757": "warn", "\u2755": "warn", "\u2753": "help", "\u2754": "help", "\u2139": "info", "\u{1F6C8}": "info"
  };
  var TONE = { "\u2705": "ok", "\u2714": "ok", "\u{1F197}": "ok", "\u274C": "bad", "\u274E": "bad", "\u2716": "bad", "\u2718": "bad",
    "\u26A0": "warn", "\u2757": "bad", "\u{1F6A8}": "bad", "\u26D4": "bad", "\u{1F6D1}": "bad", "\u2764": "bad", "\u{1FAC0}": "bad" };
  // Coloured circles and squares mean a status colour, not a picture: keep the colour as a dot.
  var DOT = {
    "\u{1F7E2}": "#16a34a", "\u{1F534}": "#dc2626", "\u{1F7E0}": "#ea580c", "\u{1F7E1}": "#ca8a04", "\u{1F535}": "#2563eb",
    "\u{1F7E3}": "#7c3aed", "\u{1F7E4}": "#92400e", "\u26AB": "#111827", "\u26AA": "#d1d5db",
    "\u{1F7E9}": "#16a34a", "\u{1F7E5}": "#dc2626", "\u{1F7E7}": "#ea580c", "\u{1F7E8}": "#ca8a04", "\u{1F7E6}": "#2563eb", "\u{1F7EA}": "#7c3aed"
  };

  function keyOf(cluster) { return cluster.replace(/\uFE0F/g, "").replace(/[\u{1F3FB}-\u{1F3FF}]/gu, ""); }
  function firstCp(s) { var c = s.codePointAt ? s.codePointAt(0) : s.charCodeAt(0); return String.fromCodePoint ? String.fromCodePoint(c) : s.charAt(0); }
  /** What a cluster becomes: {keep}, {icon, tone}, {dot} or {drop}. */
  function classify(cluster) {
    var kc = /^([#*0-9])\uFE0F?\u20E3$/.exec(cluster);
    if (kc) return { text: kc[1] };                         // keycap "1" stays a digit
    var k = keyOf(cluster);
    if (k.length === 1 && KEEP[k]) return { keep: true };
    if (/\u2695/.test(k)) return { icon: "steth" };
    if (MAP[k]) return { icon: MAP[k], tone: TONE[k] };
    var f = firstCp(k);
    if (KEEP[f] && k === f) return { keep: true };
    if (DOT[f]) return { dot: DOT[f] };
    if (MAP[f]) return { icon: MAP[f], tone: TONE[f] };
    return { drop: true };
  }
  function has(text) { CLUSTER.lastIndex = 0; var m, s = String(text || ""); while ((m = CLUSTER.exec(s)) !== null) { if (!classify(m[0]).keep) { CLUSTER.lastIndex = 0; return true; } } CLUSTER.lastIndex = 0; return false; }
  /** Plain-text version: emoji removed, typography kept, the space an emoji leaves behind tidied. */
  function strip(text) {
    var s = String(text == null ? "" : text);
    if (!has(s)) return s;
    CLUSTER.lastIndex = 0;
    var out = s.replace(CLUSTER, function (m) { var c = classify(m); return c.keep ? m : (c.text != null ? c.text : "\u0000"); });
    return out.replace(/\u0000[ \u00A0]?/g, "").replace(/ {2,}/g, " ").replace(/^ +/, "");
  }
  // ── AI-style dashes (owner, 2026-09-24: "remove AI slop like -- AI dashes all over the app without
  // causing malfunction"). Flag smd_nodash, DEFAULT ON, "0" = dashes as authored. Rules keep meaning:
  //   5—10 / 5 \u2013 10          -> 5-10            (a range stays a range; a plain 7\u201310 en dash is untouched)
  //   "HR: —" / a lone "—"   -> "HR: \u2013" / "\u2013"   (an empty value stays visibly empty)
  //   X — Y, X—Y, X -- Y     -> X, Y            (the aside dash becomes a comma)
  //   leading/trailing dash  -> ", " when text continues in the next/previous element, else removed
  function dashOn() { return lget("smd_nodash") !== "0"; }
  var DASH = /[\u2014\u2015]|(^|\s)--(\s|$)|\s\u2013\s/;
  function hasDash(s) { return DASH.test(String(s || "")); }
  function tidy(text, ctx) {
    var t = String(text == null ? "" : text);
    if (!hasDash(t)) return t;
    ctx = ctx || {};
    // numeric ranges first: 5—10, 5 \u2013 10, 5 -- 10 -> 5-10 (a tight 7\u201310 en dash is not matched by DASH)
    t = t.replace(/(\d)\s*[\u2014\u2015]\s*(\d)/g, "$1-$2").replace(/(\d)\s+(?:\u2013|--)\s+(\d)/g, "$1-$2");
    // then every remaining dash token, judged by its neighbours (spaces skipped)
    var WORD = /[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0900-\u0D7F\)\]%+\u00B0"'\u2019\u201D]/;
    var TOK = /[\u2014\u2015]|(^|\s)--(?=\s|$)|\s\u2013(?=\s)/g;
    var out = "", at = 0, m;
    while ((m = TOK.exec(t)) !== null) {
      var st = m.index + (m[1] ? m[1].length : 0) + (m[0].charAt(0) === " " && m[0].charAt(1) === "\u2013" ? 1 : 0), en = m.index + m[0].length;
      var i = st - 1; while (i >= 0 && /\s/.test(t.charAt(i))) i--;
      var j = en; while (j < t.length && /\s/.test(t.charAt(j))) j++;
      var pc = i >= 0 ? t.charAt(i) : "", nc = j < t.length ? t.charAt(j) : "";
      var pw = !!pc && WORD.test(pc), nw = !!nc && (WORD.test(nc) || /[(\["'\u2018\u201C]/.test(nc));
      var rep;
      if (pw && nw) { out += t.slice(at, i + 1) + ", "; at = j; continue; }                         // X — Y
      if (pw && !nc) { out += t.slice(at, i + 1) + (ctx.next ? ", " : t.slice(en, j)); at = j; continue; }  // X —
      if (!pc && nw) { out += (ctx.prev ? ", " : ""); at = j; continue; }                              // — Y
      rep = "\u2013";                                                                                  // empty value
      out += t.slice(at, st) + rep; at = en;
    }
    out += t.slice(at);
    return out.replace(/,\s*([,.;:!?)])/g, "$1");
  }
  // ── Textbooks as sources, and page numbers (owner, 2026-09-24: "I shouldn't find Harrison or any text
  // book as source but reference, as copyright problem, and no page numbers anywhere"). Flag smd_nobooks,
  // DEFAULT ON. Specific citations become one generic line, GENERIC_REF (owner, 2026-09-24: "reference
  // standard textbooks: harrison, oxford, davidson"); the bare name in prose ("per Harrison")
  // becomes "the reference"; page / chapter / edition locators are removed. Clinical eponyms that share
  // an author's name are protected: Harrison's groove/sulcus/sign, Fitzpatrick skin type, Braunwald
  // classification, Kaplan-Meier, Brenner tumour, Nelson syndrome, Rockwood classification.
  function booksOn() { return lget("smd_nobooks") !== "0"; }
  var AP = "(?:'|\\u2019)";
  var EDN = "\\d{1,2}(?:st|nd|rd|th)?\\s*(?:e|ed\\.?|edn\\.?|edition)\\b";
  var ED = "(?:,?\\s*(?:\\(\\s*" + EDN + "\\s*\\)|" + EDN + ")(?:\\s*\\(\\d{4}\\))?)?";
  var BOOK_TITLES = [
    "Harrison" + AP + "?s?\\s+Principles\\s+of\\s+Internal\\s+Medicine",
    "Nelson\\s+Textbook\\s+of\\s+Pa?ediatrics",
    "Mandell,?\\s+Douglas,?\\s+(?:and|&)\\s+Bennett" + AP + "?s?\\s+Principles\\s+and\\s+Practice\\s+of\\s+Infectious\\s+Diseases",
    "Campbell[-\\s]Walsh(?:[-\\s]Wein)?\\s+Urology",
    "Sleisenger\\s+(?:and|&)\\s+Fordtran" + AP + "?s?\\s+Gastrointestinal\\s+and\\s+Liver\\s+Disease",
    "Adams\\s+(?:and|&)\\s+Victor" + AP + "?s?\\s+Principles\\s+of\\s+Neurology",
    "Williams\\s+Obstetrics", "Williams\\s+Textbook\\s+of\\s+Endocrinology",
    "Bailey\\s+(?:and|&)\\s+Love(?:" + AP + "?s?\\s+Short\\s+Practice\\s+of\\s+Surgery)?",
    "Murray\\s+(?:and|&)\\s+Nadel" + AP + "?s?\\s+Textbook\\s+of\\s+Respiratory\\s+Medicine",
    "Sabiston\\s+Textbook\\s+of\\s+Surgery", "Schwartz" + AP + "?s?\\s+Principles\\s+of\\s+Surgery",
    "Oxford\\s+Handbook\\s+of(?:\\s+[A-Z][A-Za-z]+)+", "Oxford\\s+Textbook\\s+of(?:\\s+[A-Z][A-Za-z]+)+",
    "Tintinalli" + AP + "?s?\\s+Emergency\\s+Medicine", "Rosen" + AP + "?s?\\s+Emergency\\s+Medicine",
    "Davidson" + AP + "?s?\\s+Principles\\s+and\\s+Practice\\s+of\\s+Medicine",
    "Robbins(?:\\s+(?:and|&)\\s+Cotran)?\\s+(?:Basic\\s+Pathology|Pathologic\\s+Basis\\s+of\\s+Disease)",
    "Guyton\\s+(?:and|&)\\s+Hall\\s+Textbook\\s+of\\s+Medical\\s+Physiology",
    "Goodman\\s+(?:and|&)\\s+Gilman" + AP + "?s?\\s+The\\s+Pharmacological\\s+Basis\\s+of\\s+Therapeutics",
    "(?:The\\s+)?Washington\\s+Manual(?:\\s+of\\s+Medical\\s+Therapeutics)?",
    "Kumar\\s+(?:and|&)\\s+Clark" + AP + "?s?\\s+Clinical\\s+Medicine",
    "Katzung" + AP + "?s?\\s+Basic\\s+(?:and|&)\\s+Clinical\\s+Pharmacology",
    "Braunwald" + AP + "s\\s+Heart\\s+Disease(?::\\s+A\\s+Textbook\\s+of\\s+Cardiovascular\\s+Medicine)?",
    "Fitzpatrick" + AP + "s\\s+Dermatology(?:\\s+in\\s+General\\s+Medicine)?",
    "Sherlock" + AP + "s\\s+Diseases\\s+of\\s+the\\s+Liver\\s+and\\s+Biliary\\s+System",
    "Brenner\\s+(?:and|&)\\s+Rector" + AP + "?s?\\s+The\\s+Kidney",
    "Rockwood\\s+(?:and|&)\\s+Green" + AP + "?s?\\s+Fractures\\s+in\\s+Adults",
    "(?:Berek\\s+(?:and|&)\\s+)?Novak" + AP + "s\\s+Gyn(?:a|ae)?ecology",
    "Cecil\\s+(?:Textbook\\s+of\\s+Medicine|Medicine)", "Current\\s+Medical\\s+Diagnosis\\s+(?:and|&)\\s+Treatment",
    "Grainger\\s+(?:and|&)\\s+Allison" + AP + "?s?\\s+Diagnostic\\s+Radiology"
  ];
  var BOOK_RE = new RegExp("(?:" + BOOK_TITLES.join("|") + ")" + ED, "gi");
  // Short forms seen in the knowledge base and in model answers: "Harrison 22e", "Harrison's", "Harrison".
  var HARRISON_RE = new RegExp("\\bHarrison(?:" + AP + "s)?(?!" + AP + "?s?\\s+(?:groove|sulcus|sign|line))\\b" + ED, "g");
  var NELSON_RE = /\bNelson(?:'s|\u2019s)?\s+(?:\d{1,2}(?:st|nd|rd|th)?\s*(?:e|ed\.?|edition)\b|Pa?ediatrics\b)/gi;
  // Locators: "p. 1234", "pp. 12-15", "pg 45", "page 123" (not "page 2 of 5"), "Chapter 45", "Ch. 12".
  var PAGE_RE = /\s*[,;(]?\s*\b(?:pp?\.|pg\.?)\s*\d{1,4}(?:\s*[-\u2013]\s*\d{1,4})?\)?|\s*[,;(]?\s*\bpages?\s+\d{1,4}(?:\s*[-\u2013]\s*\d{1,4})?(?!\s+of\b)\)?/gi;
  // Chapter locators are case-SENSITIVE: "CH50" (complement assay) must never read as "Ch 50".
  var CHAP_RE = /\s*[,;(]?\s*\b(?:[Cc]hapter|[Cc]hap\.|Ch\.|Ch(?= \d))\s*\d{1,4}[A-Za-z]?\)?/g;
  var BOOKS_TEST = new RegExp(BOOK_RE.source + "|\\bSanford\\b|\\bHarrison\\b|\\bNelson(?:'s|\\u2019s)?\\s+(?:\\d|Pa?ediatrics)|\\b(?:pp?\\.|pg\\.?)\\s*\\d|\\bpages?\\s+\\d", "i");
  var BOOKS_TEST2 = /\b(?:[Cc]hapter|[Cc]hap\.|Ch\.)\s*\d|\bCh \d/;
  // Subject-appropriate standard textbooks (owner, 2026-09-24: "general medicine these three, genetics the
  // top genetics books, neuro a neuro book, cardio Braunwald"). Named as the standard texts of the field,
  // never with edition, chapter or page. A KB entry's `system` picks the subject (genetics first, so
  // "Cardiovascular / Genetics" gets the genetics texts); no context = general medicine.
  var SUBJECTS = [
    ["genetics", /genetic|dysmorpholog|ciliopath|inborn|chromosom/i, ["Thompson & Thompson Genetics and Genomics in Medicine", "Emery's Elements of Medical Genetics", "Harper's Practical Genetic Counselling"]],
    ["cardiology", /cardio|cardiac|heart|vascular/i, ["Braunwald's Heart Disease", "Hurst's The Heart", "Oxford Handbook of Cardiology"]],
    ["neurology", /neuro|nervous|cerebro|epilep|stroke|spastic|ataxia/i, ["Adams and Victor's Principles of Neurology", "Bradley and Daroff's Neurology in Clinical Practice", "Oxford Handbook of Neurology"]],
    ["respiratory", /respirat|pulmon|lung|thoracic/i, ["Murray and Nadel's Textbook of Respiratory Medicine", "Fishman's Pulmonary Diseases and Disorders", "Oxford Handbook of Respiratory Medicine"]],
    ["gastroenterology", /gastro|hepat|liver|biliar|pancrea|intestin|digestive/i, ["Sleisenger and Fordtran's Gastrointestinal and Liver Disease", "Sherlock's Diseases of the Liver and Biliary System", "Yamada's Textbook of Gastroenterology"]],
    ["nephrology", /renal|nephro|kidney/i, ["Brenner and Rector's The Kidney", "Comprehensive Clinical Nephrology", "Oxford Handbook of Nephrology and Hypertension"]],
    ["endocrinology", /endocrin|diabet|thyroid|adrenal|metabolic|nutrition/i, ["Williams Textbook of Endocrinology", "Greenspan's Basic and Clinical Endocrinology", "Oxford Handbook of Endocrinology and Diabetes"]],
    ["infectious", /infect|tropical|microb|parasit/i, ["Mandell, Douglas, and Bennett's Principles and Practice of Infectious Diseases", "Oxford Handbook of Infectious Diseases and Microbiology", "Harrison's Principles of Internal Medicine"]],
    ["oncology", /oncolog|cancer|sarcoma|tumou?r|breast/i, ["DeVita, Hellman, and Rosenberg's Cancer: Principles and Practice of Oncology", "Abeloff's Clinical Oncology", "Oxford Handbook of Oncology"]],
    ["haematology", /haemat|hemat|transfus|blood/i, ["Williams Hematology", "Hoffman's Hematology: Basic Principles and Practice", "Oxford Handbook of Clinical Haematology"]],
    ["paediatrics", /paediat|pediat|neonat|child/i, ["Nelson Textbook of Pediatrics", "Rudolph's Pediatrics", "Oxford Handbook of Paediatrics"]],
    ["obgyn", /obstet|gyna?ec|reproduct|pregnan/i, ["Williams Obstetrics", "Berek and Novak's Gynecology", "Dewhurst's Textbook of Obstetrics and Gynaecology"]],
    ["urology", /urolog|androlog|genitourin/i, ["Campbell-Walsh-Wein Urology", "Smith and Tanagho's General Urology", "Oxford Handbook of Urology"]],
    ["dermatology", /dermat|skin|integument|trichol|nail/i, ["Fitzpatrick's Dermatology", "Rook's Textbook of Dermatology", "Andrews' Diseases of the Skin"]],
    ["rheumatology", /rheumat|immunolog|autoimmun|connective/i, ["Kelley and Firestein's Textbook of Rheumatology", "Oxford Textbook of Rheumatology", "Hochberg's Rheumatology"]],
    ["psychiatry", /psychiat|mental|psycholog|behaviou?r/i, ["Kaplan and Sadock's Comprehensive Textbook of Psychiatry", "New Oxford Textbook of Psychiatry", "Oxford Handbook of Psychiatry"]],
    ["ophthalmology", /ophthal|\beye\b|retin|ocular/i, ["Kanski's Clinical Ophthalmology", "Parsons' Diseases of the Eye", "Oxford Handbook of Ophthalmology"]],
    ["ent", /\bENT\b|otorhino|otolaryng|audiolog|\bear\b/i, ["Scott-Brown's Otorhinolaryngology Head and Neck Surgery", "Cummings Otolaryngology", "Dhingra's Diseases of Ear, Nose and Throat"]],
    ["orthopaedics", /musculoskel|orthop|spine|fractur|bone|trauma/i, ["Rockwood and Green's Fractures in Adults", "Campbell's Operative Orthopaedics", "Apley and Solomon's System of Orthopaedics and Trauma"]],
    ["surgery", /surg/i, ["Bailey and Love's Short Practice of Surgery", "Sabiston Textbook of Surgery", "Schwartz's Principles of Surgery"]],
    ["dental", /dental|dentist|oral|maxillofac/i, ["Peterson's Principles of Oral and Maxillofacial Surgery", "Shafer's Textbook of Oral Pathology", "Burket's Oral Medicine"]],
    ["emergency", /emergen|toxicol|envenom|poison|environment|critical care/i, ["Tintinalli's Emergency Medicine", "Rosen's Emergency Medicine", "Goldfrank's Toxicologic Emergencies"]],
    ["pharmacology", /pharmacol/i, ["Goodman and Gilman's The Pharmacological Basis of Therapeutics", "Katzung's Basic and Clinical Pharmacology", "Rang and Dale's Pharmacology"]],
    ["general", /./, ["Harrison's Principles of Internal Medicine", "Oxford Handbook of Clinical Medicine", "Davidson's Principles and Practice of Medicine"]]
  ];
  function lineOf(books) { return "Standard textbooks: " + books.join("; "); }
  /** The standard-textbook line for a subject, chosen from a KB entry's system/class/name. */
  function refFor(system) {
    var s = String(system || "");
    for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i][1].test(s)) return lineOf(SUBJECTS[i][2]);
    return lineOf(SUBJECTS[SUBJECTS.length - 1][2]);
  }
  var GENERIC_REF = lineOf(SUBJECTS[SUBJECTS.length - 1][2]);
  // Every subject line is protected from re-scrubbing (its titles would otherwise match BOOK_RE).
  var LINES_RE = new RegExp(SUBJECTS.map(function (x) { return lineOf(x[2]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|"), "gi");
  function hasBooks(v) { var s = String(v || "").replace(LINES_RE, ""); LINES_RE.lastIndex = 0; return (BOOKS_TEST.test(s) || BOOKS_TEST2.test(s)) && !/^\s*page\s+\d+\s+of\s+\d+\s*$/i.test(s); }
  function scrubBooks(text, opts) {
    var t = String(text == null ? "" : text);
    if (!hasBooks(t)) return t;
    var o = t, REF = (opts && opts.ref) || GENERIC_REF, kept = [];
    t = t.replace(LINES_RE, function (m) { if (m === REF) return "\u0003"; kept.push(m); return "\u0004" + (kept.length - 1) + "\u0004"; });
    t = t.replace(/\bTinsley\s+R(?:andolph|\.)?\s+Harrison\b/g, function (m) { kept.push(m); return "\u0004" + (kept.length - 1) + "\u0004"; });   // the physician, not the book
    t = t.replace(/\bHarrison(?:'s|\u2019s)?\s+line\s+\d+/g, "\u0001");
    var unwrap = function (m) { var a = /^\s*\(/.test(m), z = /\)\s*$/.test(m); return a && z ? "" : a ? "(" : z ? ")" : ""; };
    t = t.replace(PAGE_RE, unwrap).replace(CHAP_RE, unwrap);
    t = t.replace(BOOK_RE, "\u0001").replace(NELSON_RE, "\u0001");
    t = t.replace(HARRISON_RE, function (m, off, str) {
      // "Source: Harrison 22e" / list item -> the generic source; prose "per Harrison" -> "the reference"
      // A name followed by a lowercase word is prose ("Harrison notes that ...") even at a slot.
      var before = str.slice(0, off), after = str.slice(off + m.length);
      var slot = /(?:^|[:;,(\u2022\u00B7|]\s*)$/.test(before) && !/\b(?:per|by|from|in|see|according to|instead)\s*$/i.test(before);
      return slot && !/^\s+[a-z]/.test(after) ? "\u0001" : "\u0002";
    });
    t = t.replace(/\bSanford[-\s]aligned\b/g, "Guideline-aligned").replace(/\bsanford[-\s]aligned\b/g, "guideline-aligned")
      .replace(/\b(?:The\s+)?Sanford\s+Guide(?:\s+to\s+Antimicrobial\s+Therapy)?(?:\s+\d{4})?/gi, "\u0001")
      .replace(/\bSanford\b(?:\s*\/\s*)?/g, function (m) { return /\//.test(m) ? "" : "\u0001"; });
    t = t.replace(/\(\s*[\u0001\u0002]\s*\)/g, "").replace(/\(\s*\)/g, "");   // a bracket that only held a citation goes
    // merge runs of generic sources ("Harrison; Nelson" -> one), then write them out
    t = t.replace(/\u0001(?:\s*(?:[;,&\u00B7|]|and)\s*\u0001)+/g, "\u0001");
    t = t.replace(/\u0003/g, "\u0001").replace(/\u0001(?:\s*(?:[;,&\u00B7|]|and)\s*\u0001)+/g, "\u0001");
    // The subject line goes where a source stands on its own: the whole text, or after a Source/Reference
    // label. A citation in the middle of a sentence is simply dropped (no book list inside prose).
    if (/^[\s\u0001;,&\u00B7|/.-]*$/.test(t.replace(/and/g, ""))) t = REF;
    else {
      t = t.replace(/^(\s*)\u0001/, "$1" + REF);                                    // a list that opens with the book
      t = t.replace(/((?:^|[\s(])(?:Sources?|References?|Refs?|Reference texts?|Based on|Adapted from|Evidence|Src)\s*:\s*)\u0001/gi, "$1" + REF);
      t = t.replace(/\s*[,;/&\u00B7|]?\s*\u0001\s*(?=[,;/&\u00B7|)]|$)/g, "").replace(/\u0001\s*[,;/&\u00B7|]\s*/g, "").replace(/\u0001/g, "");
      t = t.replace(/^[\s,;/&|\u00B7]+/, "").replace(/\(\s*[,;/]?\s*\)/g, "").replace(/\(\s*[,;/]\s*/g, "(").replace(/\s*[,;/]\s*\)/g, ")").replace(/[\s,;/&|\u00B7]+$/, function (m) { return /\n/.test(m) ? m : ""; });
    }
    t = t.replace(/\u0004(\d+)\u0004/g, function (m, i) { return kept[+i]; });
    t = t.replace(/(^|[.!?]\s+)\u0002/g, "$1The reference").replace(/\u0002/g, "the reference");
    t = t.replace(/\(\s*\)/g, "").replace(/\s+([,.;:)])/g, "$1").replace(/,\s*,/g, ",").replace(/ {2,}/g, " ");
    return t === o ? o : t;
  }
  /** What a string should read as on screen with the current flags: emoji removed, dashes tidied. */
  function display(text) {
    var s = String(text == null ? "" : text);
    if (enabled()) s = strip(s);
    if (dashOn()) s = tidy(s);
    if (booksOn()) s = scrubBooks(s);
    return s;
  }
  /** For code that reads screen text back and compares it with the string it rendered: both sides are
   *  normalised the way the screen shows them (emoji out, dashes tidied, whitespace collapsed). */
  function norm(v) { return display(v).replace(/\s+/g, " ").trim(); }
  function same(domText, expected) { return norm(domText) === norm(expected); }
  /** Rich version: [{t: text} | {icon, tone} | {dot}] for a text node. */
  function segments(text) {
    var s = String(text == null ? "" : text), out = [], at = 0, m;
    CLUSTER.lastIndex = 0;
    while ((m = CLUSTER.exec(s)) !== null) {
      var c = classify(m[0]);
      if (c.keep) continue;
      if (m.index > at) out.push({ t: s.slice(at, m.index) });
      var end = m.index + m[0].length;
      if (c.text != null) { out.push({ t: c.text }); at = m.index + m[0].length; continue; }
      if (c.drop) { if (s.charAt(end) === " " && (m.index === 0 || s.charAt(m.index - 1) === " ")) end++; }
      else out.push(c.icon ? { icon: c.icon, tone: c.tone } : { dot: c.dot });
      at = end;
    }
    CLUSTER.lastIndex = 0;
    if (at < s.length) out.push({ t: s.slice(at) });
    return out;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────────────────────────
  var SKIP = "script,style,textarea,code,pre,svg,[contenteditable],[contenteditable] *,.smd-emo-keep";
  var STRIP_ONLY = "option,optgroup,title,select";
  var ATTRS = ["title", "placeholder", "aria-label", "alt", "data-tip"];
  function css() {
    if (!W.document || W.document.getElementById("smd-emoji-css")) return;
    var st = W.document.createElement("style"); st.id = "smd-emoji-css";
    st.textContent =
      ".smd-emo{width:1.05em;height:1.05em;display:inline-block;vertical-align:-.17em;flex:none;margin:0 .08em}" +
      ".smd-emo.ok{color:#16a34a}.smd-emo.bad{color:#dc2626}.smd-emo.warn{color:#d97706}" +
      ".smd-emo-dot{display:inline-block;width:.62em;height:.62em;border-radius:50%;vertical-align:.02em;margin:0 .2em 0 .1em;flex:none}" +
      "@media (prefers-color-scheme:dark){.smd-emo.ok{color:#4ade80}.smd-emo.bad{color:#f87171}.smd-emo.warn{color:#fbbf24}}";
    W.document.head.appendChild(st);
  }
  function iconNode(seg) {
    var doc = W.document;
    if (seg.dot) {
      var d = doc.createElement("span"); d.className = "smd-emo-dot"; d.style.background = seg.dot; d.setAttribute("aria-hidden", "true");
      return d;
    }
    var I = W.ICONS;
    if (!I || !I.has || !I.has(seg.icon)) return null;
    var wrap = doc.createElement("span");
    wrap.innerHTML = I.get(seg.icon, "smd-ico smd-emo" + (seg.tone ? " " + seg.tone : ""));
    var svg = wrap.firstChild;
    if (svg && svg.setAttribute) svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  function needs(v) { return !!v && ((enabled() && has(v)) || (dashOn() && hasDash(v)) || (booksOn() && hasBooks(v))); }
  function fixText(tn) {
    var v = tn.nodeValue;
    if (!needs(v)) return;
    var p = tn.parentNode;
    if (!p || (p.closest && p.closest(SKIP))) return;
    if (dashOn() && hasDash(v)) {
      var nx = tn.nextSibling, pv = tn.previousSibling;
      var t2 = tidy(v, { next: !!(nx && (nx.nodeType === 1 || /\S/.test(nx.nodeValue || ""))), prev: !!(pv && (pv.nodeType === 1 || /\S/.test(pv.nodeValue || ""))) });
      if (t2 !== v) { tn.nodeValue = t2; v = t2; }
    }
    if (booksOn() && hasBooks(v)) { var b3 = scrubBooks(v); if (b3 !== v) { tn.nodeValue = b3; v = b3; } }
    if (!(enabled() && has(v))) return;
    if (p.closest && p.closest(STRIP_ONLY)) { tn.nodeValue = strip(v); return; }
    var segs = segments(v), doc = W.document, frag = doc.createDocumentFragment();
    segs.forEach(function (sg) {
      if (sg.t != null) { frag.appendChild(doc.createTextNode(sg.t)); return; }
      var n = iconNode(sg);
      if (n) frag.appendChild(n);
    });
    p.replaceChild(frag, tn);
  }
  function fixAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (a && needs(a)) { var d = display(a); if (d !== a) el.setAttribute(ATTRS[i], d); }
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && needs(el.value)) el.value = display(el.value);
  }
  function fixTree(rootEl) {
    if (!rootEl || !(enabled() || dashOn() || booksOn())) return;
    if (rootEl.nodeType === 3) { fixText(rootEl); return; }
    if (rootEl.nodeType !== 1 && rootEl.nodeType !== 9 && rootEl.nodeType !== 11) return;
    css();
    if (rootEl.nodeType === 1) {
      if (rootEl.closest && rootEl.closest(SKIP)) return;
      fixAttrs(rootEl);
    }
    var doc = W.document, tw = doc.createTreeWalker(rootEl, 5 /* ELEMENT | TEXT */, null, false), n, texts = [];
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) fixAttrs(n);
      else if (n.nodeValue && n.nodeValue.length && needs(n.nodeValue)) texts.push(n);
    }
    texts.forEach(fixText);
  }

  var pending = [], scheduled = false;
  function flush() {
    scheduled = false;
    var list = pending; pending = [];
    for (var i = 0; i < list.length; i++) { try { if (list[i].isConnected !== false) fixTree(list[i]); } catch (e) {} }
    try { if (needs(W.document.title)) W.document.title = display(W.document.title); } catch (e) {}
  }
  function queue(n) {
    pending.push(n);
    if (!scheduled) { scheduled = true; (W.requestAnimationFrame || W.setTimeout)(flush, 16); }
  }
  function wrapDialogs() {
    ["alert", "confirm", "prompt"].forEach(function (k) {
      var orig = W[k];
      if (typeof orig !== "function" || orig._smdNoEmoji) return;
      var f = function (msg) { var a = Array.prototype.slice.call(arguments); if (typeof msg === "string") a[0] = display(msg); return orig.apply(W, a); };
      f._smdNoEmoji = true; W[k] = f;
    });
  }
  // Text that leaves the page as a string, not DOM: PDFs, native share sheets, the clipboard and phone
  // notifications. Wrapped at their single shared entry points, so the 100+ callers need no change.
  function stripDeep(v, depth) {
    if (typeof v === "string") return display(v);
    if (!v || typeof v !== "object" || depth > 3) return v;
    if (Array.isArray(v)) return v.map(function (x) { return stripDeep(x, depth + 1); });
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = (k === "title" || k === "text" || k === "body" || k === "subject" || k === "dialogTitle" || k === "largeBody" || k === "summaryText" || k === "notifications") ? stripDeep(v[k], depth + 1) : v[k];
    return o;
  }
  function wrapMethod(obj, name, how) {
    try {
      if (!obj || typeof obj[name] !== "function" || obj[name]._smdNoEmoji) return;
      var orig = obj[name];
      var f = function () { var a = Array.prototype.slice.call(arguments); a = how(a); return orig.apply(this, a); };
      f._smdNoEmoji = true; obj[name] = f;
    } catch (e) {}
  }
  var html0 = function (a) { if (typeof a[0] === "string") a[0] = display(a[0]); if (typeof a[2] === "string") a[2] = display(a[2]); return a; };
  var obj0 = function (a) { a[0] = stripDeep(a[0], 0); return a; };
  function wrapOutbound() {
    wrapMethod(W.SMD_PDF, "fromHtml", html0);
    wrapMethod(W.SMD_NATIVE, "sharePdfFromHtml", html0);
    wrapMethod(W.navigator, "share", obj0);
    try { if (W.navigator && W.navigator.clipboard) wrapMethod(W.navigator.clipboard, "writeText", function (a) { a[0] = display(a[0]); return a; }); } catch (e) {}
    var P = W.Capacitor && W.Capacitor.Plugins;
    if (P) { wrapMethod(P.Share, "share", obj0); wrapMethod(P.LocalNotifications, "schedule", obj0); }
  }
  // SMD_PDF / SMD_NATIVE are assigned by native-bridge.js, possibly long after boot: wrap them the
  // moment they are assigned instead of polling.
  function trapGlobal(name, wrapFn) {
    try {
      if (W[name]) { wrapFn(W[name]); return; }
      var d = Object.getOwnPropertyDescriptor(W, name);
      if (d && !d.configurable) return;
      var val;
      Object.defineProperty(W, name, { configurable: true, enumerable: true,
        get: function () { return val; },
        set: function (v) { val = v; try { wrapFn(v); } catch (e) {} } });
    } catch (e) {}
  }
  function boot() {
    if (!(enabled() || dashOn() || booksOn()) || !W.document || !W.document.body) return;
    wrapDialogs();
    // the bridges load after this file (deferred): wrap now and again as they appear
    wrapOutbound(); [500, 2000, 6000, 15000].forEach(function (ms) { W.setTimeout(wrapOutbound, ms); });
    trapGlobal("SMD_PDF", function (o) { wrapMethod(o, "fromHtml", html0); });
    trapGlobal("SMD_NATIVE", function (o) { wrapMethod(o, "sharePdfFromHtml", html0); });
    var start = function () {
      fixTree(W.document.body);
      if (!W.MutationObserver) return;
      new W.MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === "childList") { for (var j = 0; j < m.addedNodes.length; j++) queue(m.addedNodes[j]); }
          else if (m.type === "characterData") queue(m.target);
          else if (m.type === "attributes") queue(m.target.nodeType === 1 ? { nodeType: 1, isConnected: true, _attrOnly: m.target } : m.target);
        }
      }).observe(W.document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    // The icon catalogue comes from home.js (deferred): wait for it so emoji become icons, not gaps.
    var tries = 0;
    (function wait() { if (W.ICONS && W.ICONS.has) return start(); if (++tries > 100) return start(); W.setTimeout(wait, 50); })();
  }
  // attribute-only records
  var _fixTree = fixTree;
  fixTree = function (n) { if (n && n._attrOnly) { fixAttrs(n._attrOnly); return; } return _fixTree(n); };

  if (W && W.document) {
    if (W.document.readyState === "loading") W.document.addEventListener("DOMContentLoaded", boot); else boot();
  }
  return { strip: strip, scrubBooks: scrubBooks, GENERIC_REF: GENERIC_REF, refFor: refFor, SUBJECTS: SUBJECTS, hasBooks: hasBooks, booksOn: booksOn, tidy: tidy, display: display, norm: norm, same: same, hasDash: hasDash, dashOn: dashOn, stripDeep: stripDeep, segments: segments, has: has, classify: classify, enabled: enabled, fixTree: function (n) { return fixTree(n); }, MAP: MAP };
});
