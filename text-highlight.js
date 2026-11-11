/* text-highlight.js: highlight and bold text while reading (owner, 2026-11-11).
 *
 * Any reading surface opts in by putting data-hl-key="<stable id>" on its text container. Select text
 * inside it and a small palette appears under the selection: seven colours, Bold, and Remove. Tap an
 * existing highlight to change its colour, toggle bold or remove it. The palette also lists the
 * highlights already on that page; tapping one scrolls to it.
 *
 * Users today: the PrepNucleus Learn lesson reader (prep-lessons.js, key "ls:<lesson>:<page>") and
 * the Knowledge Library disease reader (reasoning.js, key "kb:<disease id>").
 *
 * Anchoring is by text quote (exact text + up to 32 chars either side), so highlights survive a
 * re-render, drug-link wrapping or a changed DOM as long as the words are the same. Each highlight is
 * wrapped per text node in <mark class="smd-hl">, so it can cross bold terms and links.
 *
 * Storage: device-local, localStorage "smd_hl_v1" = { <key>: [{ id, q, pre, suf, c, b, t }] }.
 * Not synced. Study text only, never patient data.
 *
 * Flag: localStorage smd_hl, DEFAULT ON; "0" turns it off (no palette, saved highlights not drawn).
 */
(function (G) {
  "use strict";
  var D = G.document;
  var STORE = "smd_hl_v1", CTX = 32, MAX_PER_KEY = 400;
  var COLORS = [
    { id: 1, name: "Yellow" }, { id: 2, name: "Green" }, { id: 3, name: "Blue" }, { id: 4, name: "Pink" },
    { id: 5, name: "Violet" }, { id: 6, name: "Orange" }, { id: 7, name: "Red" }
  ];

  function lget(k) { try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lset(k, v) { try { G.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function enabled() { return lget("smd_hl") !== "0"; }

  /* ---------- pure helpers (exported for tests) ---------- */
  // Best occurrence of q in text: the one whose surrounding text matches pre/suf most. -1 if none.
  function locate(text, rec) {
    var q = rec && rec.q; if (!q) return -1;
    var best = -1, bestScore = -1, i = text.indexOf(q);
    while (i >= 0) {
      var sc = tailMatch(text.slice(Math.max(0, i - CTX), i), rec.pre || "") + headMatch(text.slice(i + q.length, i + q.length + CTX), rec.suf || "");
      if (sc > bestScore) { bestScore = sc; best = i; }
      i = text.indexOf(q, i + 1);
    }
    return best;
  }
  function tailMatch(a, b) { var n = 0; while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n)) n++; return n; }
  function headMatch(a, b) { var n = 0; while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++; return n; }
  function quote(text, s, e) { return { q: text.slice(s, e), pre: text.slice(Math.max(0, s - CTX), s), suf: text.slice(e, e + CTX) }; }
  function trimRange(text, s, e) {
    while (s < e && /\s/.test(text.charAt(s))) s++;
    while (e > s && /\s/.test(text.charAt(e - 1))) e--;
    return [s, e];
  }
  function newId() { return "h" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ---------- storage ---------- */
  var cache = null;
  function all() {
    if (cache) return cache;
    try { cache = JSON.parse(lget(STORE) || "{}") || {}; } catch (e) { cache = {}; }
    if (typeof cache !== "object" || Array.isArray(cache)) cache = {};
    return cache;
  }
  function list(key) { var a = all()[key]; return Array.isArray(a) ? a : []; }
  function put(key, arr) {
    var m = all();
    if (arr.length) m[key] = arr.slice(-MAX_PER_KEY); else delete m[key];
    lset(STORE, JSON.stringify(m));
  }

  /* ---------- DOM text model ---------- */
  function skip(n) {
    for (var p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      var t = p.nodeName;
      if (t === "SCRIPT" || t === "STYLE" || t === "BUTTON" || t === "svg" || t === "SVG" || t === "TEXTAREA" || t === "INPUT") return true;
      if (p.hasAttribute && (p.hasAttribute("data-hl-key") || p.hasAttribute("data-hl-skip"))) return p.hasAttribute("data-hl-skip");
    }
    return false;
  }
  // Text nodes of a container in order, with running offsets. Same walk for saving and restoring.
  function textMap(root) {
    var nodes = [], text = "", w = D.createTreeWalker(root, 4, null), n;
    while ((n = w.nextNode())) {
      if (skip(n)) continue;
      nodes.push({ n: n, s: text.length });
      text += n.nodeValue;
    }
    return { nodes: nodes, text: text };
  }
  function offsetOf(map, node, off) {
    if (node.nodeType === 3) {
      for (var i = 0; i < map.nodes.length; i++) if (map.nodes[i].n === node) return map.nodes[i].s + off;
      return -1;
    }
    // element boundary: the offset of the first text node at or after child[off]
    var child = node.childNodes[off], target = child || null;
    for (var j = 0; j < map.nodes.length; j++) {
      var tn = map.nodes[j].n;
      if (target ? (target === tn || target.contains(tn) || (target.compareDocumentPosition(tn) & 4)) : (node.contains(tn) ? false : (node.compareDocumentPosition(tn) & 4))) return map.nodes[j].s;
    }
    return map.text.length;
  }

  function wrap(map, s, e, rec) {
    var marks = [];
    for (var i = 0; i < map.nodes.length; i++) {
      var it = map.nodes[i], n = it.n, ns = it.s, ne = ns + n.nodeValue.length;
      if (ne <= s || ns >= e) continue;
      var a = Math.max(s, ns) - ns, b = Math.min(e, ne) - ns;
      var slice = n.nodeValue.slice(a, b);
      if (!slice || !/\S/.test(slice)) continue;
      var mid = n;
      if (a > 0) mid = n.splitText(a);
      if (b - a < mid.nodeValue.length) mid.splitText(b - a);
      var m = D.createElement("mark");
      m.className = "smd-hl" + (rec.b ? " smd-hl-b" : "");
      if (rec.c) m.setAttribute("data-hl-c", String(rec.c));
      m.setAttribute("data-hl-id", rec.id);
      mid.parentNode.insertBefore(m, mid);
      m.appendChild(mid);
      marks.push(m);
    }
    return marks;
  }
  function unwrap(root, id) {
    var ms = root.querySelectorAll('mark.smd-hl[data-hl-id="' + id + '"]');
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      if (p.normalize) p.normalize();
    }
  }
  function restyle(root, rec) {
    var ms = root.querySelectorAll('mark.smd-hl[data-hl-id="' + rec.id + '"]');
    for (var i = 0; i < ms.length; i++) {
      ms[i].className = "smd-hl" + (rec.b ? " smd-hl-b" : "");
      if (rec.c) ms[i].setAttribute("data-hl-c", String(rec.c)); else ms[i].removeAttribute("data-hl-c");
    }
  }

  /* ---------- apply saved highlights ---------- */
  var applying = false;
  function applyTo(root) {
    var key = root.getAttribute("data-hl-key"); if (!key) return;
    var recs = list(key); if (!recs.length) return;
    var map = null;
    applying = true;
    try {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (root.querySelector('mark.smd-hl[data-hl-id="' + r.id + '"]')) continue;
        if (!map) map = textMap(root);
        var at = locate(map.text, r);
        if (at < 0) continue;
        wrap(map, at, at + r.q.length, r);
        map = null;   // wrapping split nodes; rebuild before the next one
      }
    } catch (e) {} finally { applying = false; }
  }
  function applyAll() {
    if (!enabled()) return;
    var roots = D.querySelectorAll("[data-hl-key]");
    for (var i = 0; i < roots.length; i++) applyTo(roots[i]);
  }
  var pending = 0;
  function schedule() {
    if (pending) return;
    pending = (G.requestAnimationFrame || G.setTimeout)(function () { pending = 0; applyAll(); });
  }

  /* ---------- palette ---------- */
  var pal = null, cur = null;   // cur: { root, key, s, e } for a new selection, or { root, key, id } for a tapped highlight
  function icBold() { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4.5h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>'; }
  function icClear() { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 18 18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function ensurePal() {
    if (pal) return pal;
    pal = D.createElement("div");
    pal.className = "smd-hlp";
    pal.setAttribute("role", "toolbar");
    pal.setAttribute("aria-label", "Highlight");
    pal.setAttribute("data-hl-skip", "");
    // Keep the text selection alive while the palette is tapped.
    pal.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    pal.addEventListener("mousedown", function (e) { e.preventDefault(); });
    pal.addEventListener("click", onPalClick);
    D.body.appendChild(pal);
    return pal;
  }
  function drawPal(rec) {
    var key = cur.key, recs = list(key).slice().sort(function (a, b) { return (b.t || 0) - (a.t || 0); }).slice(0, 4);
    var html = '<div class="smd-hlp-grid">' + COLORS.map(function (c) {
      var on = rec && rec.c === c.id;
      return '<button type="button" class="smd-hlp-dot' + (on ? " on" : "") + '" data-hl-act="c" data-c="' + c.id + '" aria-label="Highlight ' + c.name.toLowerCase() + '" aria-pressed="' + !!on + '"><i data-hl-c="' + c.id + '"></i></button>';
    }).join("") +
      '<button type="button" class="smd-hlp-btn' + (rec && rec.b ? " on" : "") + '" data-hl-act="b" aria-label="Bold" aria-pressed="' + !!(rec && rec.b) + '">' + icBold() + "</button>" +
      '<button type="button" class="smd-hlp-btn" data-hl-act="x" aria-label="Remove highlight"' + (rec || hasOverlap() ? "" : " disabled") + ">" + icClear() + "</button></div>";
    if (recs.length) {
      html += '<div class="smd-hlp-list" aria-label="Highlights on this page">' + recs.map(function (r) {
        return '<button type="button" class="smd-hlp-item" data-hl-act="go" data-id="' + esc(r.id) + '"><i data-hl-c="' + (r.c || 0) + '"' + (r.b && !r.c ? ' class="b"' : "") + "></i><span>" + esc(r.q.length > 40 ? r.q.slice(0, 40) + "..." : r.q) + "</span></button>";
      }).join("") + "</div>";
    }
    ensurePal().innerHTML = html;
    pal.classList.toggle("has-list", !!recs.length);
  }
  function hasOverlap() {
    if (!cur || cur.id) return false;
    return overlapping(cur.root, cur.s, cur.e).length > 0;
  }
  function overlapping(root, s, e) {
    var map = textMap(root), out = {}, ms = root.querySelectorAll("mark.smd-hl");
    for (var i = 0; i < ms.length; i++) {
      var tn = ms[i].firstChild; if (!tn || tn.nodeType !== 3) continue;
      var o = offsetOf(map, tn, 0), oe = o + tn.nodeValue.length;
      if (o >= 0 && o < e && oe > s) out[ms[i].getAttribute("data-hl-id")] = 1;
    }
    return Object.keys(out);
  }
  function place(rect) {
    var p = ensurePal(), vw = G.innerWidth, vh = G.innerHeight;
    p.style.left = "0px"; p.style.top = "0px"; p.classList.add("on");
    var w = p.offsetWidth, h = p.offsetHeight, gap = 14;
    // Under the selection, so the system's own Copy / Look Up menu above it stays usable.
    var top = rect.bottom + gap + 14;
    if (top + h > vh - 12) top = rect.top - h - gap - 44;
    if (top < 12) top = Math.max(12, Math.min(vh - h - 12, rect.bottom + gap));
    var left = Math.round(rect.left + rect.width / 2 - w / 2);
    left = Math.max(12, Math.min(vw - w - 12, left));
    p.style.left = left + "px"; p.style.top = Math.round(top) + "px";
  }
  function hide() { if (pal) pal.classList.remove("on"); cur = null; }

  function recOf(key, id) { var a = list(key); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }

  function onPalClick(e) {
    var b = e.target.closest && e.target.closest("[data-hl-act]"); if (!b || !cur) return;
    var act = b.getAttribute("data-hl-act"), key = cur.key, root = cur.root, arr = list(key).slice();
    if (act === "go") {
      var m = root.querySelector('mark.smd-hl[data-hl-id="' + b.getAttribute("data-id") + '"]');
      hide(); clearSel();
      if (m) { try { m.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) { m.scrollIntoView(); } flash(m.getAttribute("data-hl-id"), root); }
      return;
    }
    if (G.SMD_HAPTICS && G.SMD_HAPTICS.selection) { try { G.SMD_HAPTICS.selection(); } catch (x) {} }
    if (cur.id) {   // editing a tapped highlight
      var r = recOf(key, cur.id); if (!r) return hide();
      if (act === "x") { arr = arr.filter(function (x) { return x.id !== r.id; }); unwrap(root, r.id); put(key, arr); return hide(); }
      if (act === "c") { var c = +b.getAttribute("data-c"); r.c = r.c === c ? 0 : c; }
      if (act === "b") r.b = !r.b;
      if (!r.c && !r.b) { arr = arr.filter(function (x) { return x.id !== r.id; }); unwrap(root, r.id); put(key, arr); return hide(); }
      r.t = Date.now();
      put(key, arr.map(function (x) { return x.id === r.id ? r : x; }));
      restyle(root, r); drawPal(r);
      return;
    }
    // new selection
    var ids = overlapping(root, cur.s, cur.e);
    if (act === "x") {
      ids.forEach(function (id) { unwrap(root, id); });
      put(key, arr.filter(function (x) { return ids.indexOf(x.id) < 0; }));
      clearSel(); return hide();
    }
    // A new mark replaces the ones it overlaps, so highlights never stack.
    ids.forEach(function (id) { unwrap(root, id); });
    arr = arr.filter(function (x) { return ids.indexOf(x.id) < 0; });
    var map = textMap(root), q = quote(map.text, cur.s, cur.e);
    var rec = { id: newId(), q: q.q, pre: q.pre, suf: q.suf, c: act === "c" ? +b.getAttribute("data-c") : 0, b: act === "b", t: Date.now() };
    if (!rec.q) return hide();
    applying = true;
    try { wrap(map, cur.s, cur.e, rec); } finally { applying = false; }
    arr.push(rec); put(key, arr);
    clearSel();
    cur = { root: root, key: key, id: rec.id, rect: markRect(root, rec.id) };   // stay open on the new highlight so bold + colour combine
    drawPal(rec);
  }
  function flash(id, root) {
    var ms = root.querySelectorAll('mark.smd-hl[data-hl-id="' + id + '"]');
    for (var i = 0; i < ms.length; i++) { ms[i].classList.remove("flash"); void ms[i].offsetWidth; ms[i].classList.add("flash"); }
  }
  function clearSel() { try { var s = G.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (e) {} }

  /* ---------- selection + taps ---------- */
  function rootOf(n) {
    for (var p = n && (n.nodeType === 1 ? n : n.parentNode); p && p.nodeType === 1; p = p.parentNode) {
      if (p.hasAttribute("data-hl-skip")) return null;
      if (p.hasAttribute("data-hl-key")) return p;
    }
    return null;
  }
  var selT = 0;
  function onSel() {
    if (!enabled()) return;
    clearTimeout(selT);
    selT = setTimeout(function () {
      var s = G.getSelection && G.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { if (cur && !cur.id) hide(); return; }
      var r = s.getRangeAt(0), root = rootOf(r.commonAncestorContainer);
      if (!root) { if (cur && !cur.id) hide(); return; }
      var map = textMap(root), a = offsetOf(map, r.startContainer, r.startOffset), z = offsetOf(map, r.endContainer, r.endOffset);
      if (a < 0 || z < 0) return;
      var t = trimRange(map.text, Math.min(a, z), Math.max(a, z));
      if (t[1] - t[0] < 1) return;
      cur = { root: root, key: root.getAttribute("data-hl-key"), s: t[0], e: t[1], rect: function () { return r.getBoundingClientRect(); } };
      drawPal(null);
      place(cur.rect());
    }, 220);
  }
  function markRect(root, id) {
    return function () {
      var ms = root.querySelectorAll('mark.smd-hl[data-hl-id="' + id + '"]'); if (!ms.length) return null;
      var r0 = ms[0].getBoundingClientRect(), rl = ms[ms.length - 1].getBoundingClientRect();
      return { top: r0.top, bottom: rl.bottom, left: Math.min(r0.left, rl.left), width: Math.max(r0.right, rl.right) - Math.min(r0.left, rl.left) };
    };
  }
  function onTap(e) {
    if (!enabled()) return;
    if (pal && pal.contains(e.target)) return;
    var m = e.target.closest && e.target.closest("mark.smd-hl");
    var s = G.getSelection && G.getSelection();
    // A drug name, link or control inside a highlight keeps its own tap.
    if (m && e.target.closest("a,button,[data-act],.smd-drug,[role=button]")) m = null;
    if (m && (!s || s.isCollapsed)) {
      var root = rootOf(m); if (!root) return;
      var key = root.getAttribute("data-hl-key"), rec = recOf(key, m.getAttribute("data-hl-id")); if (!rec) return;
      cur = { root: root, key: key, id: rec.id, rect: markRect(root, rec.id) };
      drawPal(rec);
      place(cur.rect());
      return;
    }
    if (cur && (!s || s.isCollapsed)) hide();
  }

  function init() {
    if (!D || !D.body) return;
    D.addEventListener("selectionchange", onSel);
    D.addEventListener("click", onTap, true);
    // Scrolling keeps the palette with its text; it closes once that text leaves the screen.
    var scT = 0;
    G.addEventListener("scroll", function (e) {
      if (!cur || !cur.rect || (pal && e.target === pal) || scT) return;
      scT = (G.requestAnimationFrame || G.setTimeout)(function () {
        scT = 0; if (!cur || !cur.rect) return;
        var r = cur.rect();
        if (!r || r.bottom < 0 || r.top > G.innerHeight) hide(); else place(r);
      });
    }, true);
    G.addEventListener("resize", function () { if (cur) hide(); });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && cur) hide(); });
    if (G.MutationObserver) {
      new MutationObserver(function (recs) {
        if (applying) return;
        for (var i = 0; i < recs.length; i++) if (recs[i].addedNodes && recs[i].addedNodes.length && !(pal && pal.contains(recs[i].target))) { schedule(); return; }
      }).observe(D.body, { childList: true, subtree: true });
    }
    applyAll();
  }

  G.SMD_HL = {
    enabled: enabled,
    apply: applyAll,
    list: function (key) { return list(key).slice(); },
    clear: function (key) {
      var roots = D.querySelectorAll("[data-hl-key]");
      for (var i = 0; i < roots.length; i++) if (roots[i].getAttribute("data-hl-key") === key) list(key).forEach(function (r) { unwrap(roots[i], r.id); });
      put(key, []);
    },
    _pure: { locate: locate, quote: quote, trimRange: trimRange },
    _reset: function () { cache = null; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = G.SMD_HL;
  if (D) { if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", init); else init(); }
})(typeof window !== "undefined" ? window : globalThis);
