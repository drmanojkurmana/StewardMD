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
  function fixText(tn) {
    var v = tn.nodeValue;
    if (!v || !has(v)) return;
    var p = tn.parentNode;
    if (!p || (p.closest && p.closest(SKIP))) return;
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
      if (a && has(a)) el.setAttribute(ATTRS[i], strip(a));
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && has(el.value)) el.value = strip(el.value);
  }
  function fixTree(rootEl) {
    if (!rootEl || !enabled()) return;
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
      else if (n.nodeValue && n.nodeValue.length && has(n.nodeValue)) texts.push(n);
    }
    texts.forEach(fixText);
  }

  var pending = [], scheduled = false;
  function flush() {
    scheduled = false;
    var list = pending; pending = [];
    for (var i = 0; i < list.length; i++) { try { if (list[i].isConnected !== false) fixTree(list[i]); } catch (e) {} }
    try { if (has(W.document.title)) W.document.title = strip(W.document.title); } catch (e) {}
  }
  function queue(n) {
    pending.push(n);
    if (!scheduled) { scheduled = true; (W.requestAnimationFrame || W.setTimeout)(flush, 16); }
  }
  function wrapDialogs() {
    ["alert", "confirm", "prompt"].forEach(function (k) {
      var orig = W[k];
      if (typeof orig !== "function" || orig._smdNoEmoji) return;
      var f = function (msg) { var a = Array.prototype.slice.call(arguments); if (enabled() && typeof msg === "string") a[0] = strip(msg); return orig.apply(W, a); };
      f._smdNoEmoji = true; W[k] = f;
    });
  }
  // Text that leaves the page as a string, not DOM: PDFs, native share sheets, the clipboard and phone
  // notifications. Wrapped at their single shared entry points, so the 100+ callers need no change.
  function stripDeep(v, depth) {
    if (typeof v === "string") return strip(v);
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
      var f = function () { var a = Array.prototype.slice.call(arguments); if (enabled()) a = how(a); return orig.apply(this, a); };
      f._smdNoEmoji = true; obj[name] = f;
    } catch (e) {}
  }
  var html0 = function (a) { if (typeof a[0] === "string") a[0] = strip(a[0]); if (typeof a[2] === "string") a[2] = strip(a[2]); return a; };
  var obj0 = function (a) { a[0] = stripDeep(a[0], 0); return a; };
  function wrapOutbound() {
    wrapMethod(W.SMD_PDF, "fromHtml", html0);
    wrapMethod(W.SMD_NATIVE, "sharePdfFromHtml", html0);
    wrapMethod(W.navigator, "share", obj0);
    try { if (W.navigator && W.navigator.clipboard) wrapMethod(W.navigator.clipboard, "writeText", function (a) { a[0] = strip(a[0]); return a; }); } catch (e) {}
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
    if (!enabled() || !W.document || !W.document.body) return;
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
  return { strip: strip, stripDeep: stripDeep, segments: segments, has: has, classify: classify, enabled: enabled, fixTree: function (n) { return fixTree(n); }, MAP: MAP };
});
