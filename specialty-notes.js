/* Specialty engine notes: short cited study notes, optionally illustrated. ES5. SPECIALTY.features.notes(host).
   Content: <base>notes.json = {v: 1, review: "ai_drafted", reviewNote, groups: [{id, title}], notes: [{id, title, sub, topic,
   minutes, practise: {topic, clinic?}, blocks: [{h} | {p} | {ul: [...]} | {pearl} | {img: {src, alt, caption, credit, w, h}}],
   sources: [...]}]}. Text is {en, hi} or plain English. Only **bold** survives in text, applied after escaping.
   A host without notes.json has no Notes row (a 404 hides it). Layers: list -> reader -> enlarged image; back unwinds
   one at a time. Read state: store.read[id] = the day the note was read to its sources. Pure checks load under node. */
(function (G) {
  "use strict";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function md(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }
  function en(v) { return v && typeof v === "object" ? v.en : v; }
  var KINDS = ["h", "p", "ul", "img", "pearl"];
  function validateNotes(N) {
    if (!N || N.v !== 1 || !Array.isArray(N.notes)) return ["notes: needs {v: 1, notes: [...]}"];
    var e = [], ids = {}, groups = null;
    if (N.review !== "ai_drafted" && N.review !== "reviewed") e.push("review: ai_drafted until approved");
    if (Array.isArray(N.groups)) { groups = {}; N.groups.forEach(function (g) { groups[g.id] = 1; }); }
    N.notes.forEach(function (n, i) {
      var w = n && n.id ? n.id : "notes[" + i + "]";
      if (!n || typeof n.id !== "string" || !/^[a-z0-9-]+$/.test(n.id)) e.push(w + ": id lowercase letters, digits and hyphens");
      else if (ids[n.id]) e.push("duplicate id " + n.id);
      if (n && n.id) ids[n.id] = 1;
      if (!n || !en(n.title)) e.push(w + ": title");
      if (groups && !groups[n && n.topic]) e.push(w + ": unknown group " + (n && n.topic));
      if (!n || !(n.minutes >= 1)) e.push(w + ": minutes");
      (n && n.blocks || []).forEach(function (b, j) {
        var ks = Object.keys(b || {});
        if (ks.length !== 1 || KINDS.indexOf(ks[0]) < 0) e.push(w + ".blocks[" + j + "]: one kind per block (h, p, ul, img, pearl)");
        else if (ks[0] === "img" && !(b.img.src && b.img.alt && b.img.caption && b.img.credit && b.img.w > 0 && b.img.h > 0)) e.push(w + ".blocks[" + j + "]: img needs src, alt, caption, credit, w, h");
      });
      if (!n || !Array.isArray(n.blocks) || !n.blocks.length) e.push(w + ": blocks");
      if (!n || !Array.isArray(n.sources) || n.sources.length < 2) e.push(w + ": sources: at least 2");
      else n.sources.forEach(function (x) { var t = en(x); if (!t || t.length < 20 || /\[verify\]/i.test(t)) e.push(w + ": source too short or unverified: " + t); });
    });
    return e;
  }
  var PURE = { validateNotes: validateNotes, md: md };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  var SP = G.SPECIALTY || (G.SPECIALTY = {});
  if (!SP.features) SP.features = {};
  SP.NOTES = PURE;

  SP.features.notes = function (host) {
    var I = host._internal, st = host._st, cfg = host.cfg, D = G.SPECIALTY_DATA, S = G.SPECIALTY_STAGE, A = I.ACTIONS;
    var ico = I.ico, fmt = I.fmt;
    function T(en2, hi) { return { en: en2, hi: hi }; }
    var STR = {
      title: T("Study notes", "अध्ययन नोट्स"), sub: T("Signs, grading, next steps", "लक्षण, ग्रेडिंग, आगे क्या करें"),
      nRead: T("{d} of {n} read", "{n} में से {d} पढ़े"), read: T("Read", "पढ़ा"), min: T("{n} min read", "{n} मिनट"),
      back: T("Back", "वापस"), backNotes: T("Back to notes", "नोट्स पर वापस"), sources: T("Sources", "स्रोत"), next: T("Next note", "अगला नोट"),
      pearl: T("Pearl.", "सूत्र।"), practise: T("Practise this topic in the question bank", "इस विषय का अभ्यास प्रश्न बैंक में करें"),
      practiseClinic: T("Practise in {c}", "{c} में अभ्यास करें"), enlarge: T("Enlarge: {x}", "बड़ा करें: {x}"),
      enlarged: T("Enlarged image", "बड़ी तस्वीर"), closeImg: T("Close image", "तस्वीर बंद करें"), zoomHint: T("Pinch, double-tap or + and -", "पिंच, डबल-टैप या + और -"),
      zoomIn: T("Zoom in", "ज़ूम करें"), fit: T("Fit image", "पूरी तस्वीर"), imgErr: T("Image did not load. ", "तस्वीर लोड नहीं हुई। "), lede: T("Short notes, each cited to the guideline it follows.", "छोटे नोट्स, हर एक उस दिशानिर्देश के हवाले से जिस पर वह आधारित है।")
    };
    function L() { return I.lang(); }
    function s(key, v) { return I.esc(D.t(STR[key], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? I.esc(v[x]) : m; }); }
    function tt(v) { return md(D.t(v, L())); } // bold-capable content text
    var N = null, cur = null, zoomEl = null, io = null;

    function load() { return I.getJSON("notes.json").then(function (d) { N = validateNotes(d).length ? null : d; }, function () { N = null; }); }
    function reads() { return st.store.read || (st.store.read = {}); }
    function readCount() { var r = reads(); return N.notes.filter(function (n) { return r[n.id]; }).length; }
    function groups() { return N.groups || [{ id: "_", title: STR.title }]; }
    function inGroup(n, g) { return g.id === "_" || n.topic === g.id; }
    function ordered() { var out = []; groups().forEach(function (g) { N.notes.forEach(function (x) { if (inGroup(x, g)) out.push(x); }); }); return out; }
    function imgCount(n) { return n.blocks.filter(function (b) { return b.img; }).length; }

    function openList(focusId) {
      I.leave();
      st.view = "notes"; st.again = function () { openList(); };
      var r = reads();
      var body = groups().map(function (g) {
        var list = N.notes.filter(function (x) { return inGroup(x, g); });
        if (!list.length) return "";
        return '<h2 class="sp-h2">' + I.tx(g.title) + '</h2><ul class="sp-rows">' + list.map(function (x) {
          return I.row("note", ' data-n="' + I.esc(x.id) + '"', I.tile("book"), I.tx(x.title), I.tx(x.sub), (r[x.id] ? '<span class="nt-done">' + ico("check") + s("read") + "</span> · " : "") + s("min", { n: x.minutes }));
        }).join("") + "</ul>";
      }).join("");
      I.paint(I.top(D.t(STR.back, L()), s("title"), s("nRead", { d: fmt(readCount()), n: fmt(N.notes.length) }), I.langBtn()) +
        '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="sp-lede">' + s("lede") + "</p>" + body +
        (N.reviewNote ? '<p class="sp-note">' + I.tx(N.reviewNote) + "</p>" : "") + "</div></div>", focusId ? '[data-n="' + focusId + '"]' : null);
    }

    function block(b, k) {
      if (b.h) return '<h2 class="nt-h">' + tt(b.h) + "</h2>";
      if (b.p) return "<p>" + tt(b.p) + "</p>";
      if (b.ul) return "<ul>" + b.ul.map(function (x) { return "<li>" + tt(x) + "</li>"; }).join("") + "</ul>";
      if (b.pearl) return '<p class="nt-pearl"><b>' + s("pearl") + "</b> " + tt(b.pearl) + "</p>";
      if (b.img) {
        var m = b.img;
        return '<figure class="nt-fig"><button type="button" class="nt-fig-b" data-act="zoomfig" data-k="' + k + '" aria-label="' + s("enlarge", { x: D.t(m.alt, L()) }) + '">' +
          '<img src="' + I.esc(I.imgUrl(m.src)) + '" alt="' + I.esc(D.t(m.alt, L())) + '" width="' + m.w + '" height="' + m.h + '" loading="lazy" decoding="async"></button>' +
          "<figcaption>" + tt(m.caption) + ' <span class="sp-credit" lang="en">' + I.esc(D.t(m.credit, "en")) + "</span></figcaption></figure>";
      }
      return "";
    }
    function practiseHtml(n) {
      var p = n.practise || {}, spec = p.clinic && I.clinic(p.clinic);
      if (spec) return '<button type="button" class="sp-btn pri sp-wide" data-act="ntpractise" data-t="' + I.esc(p.clinic) + '">' + ico("play") + " " + s("practiseClinic", { c: D.t(spec.title, L()) }) + "</button>";
      var bank = null;
      host._banks.forEach(function (b) { if (b.topic && (!b.hasTopic || b.hasTopic(p.topic))) bank = b; });
      return bank && p.topic ? '<button type="button" class="sp-btn sec sp-wide" data-act="ntpractise" data-q="' + I.esc(p.topic) + '">' + ico("target") + " " + s("practise") + "</button>" : "";
    }
    function openNote(id) {
      var all = ordered(), i = all.map(function (x) { return x.id; }).indexOf(id);
      if (i < 0) return openList();
      var ret = st.ret, retLabel = st.retLabel;
      I.leave();
      var n = all[i], nx = all[i + 1];
      cur = n; st.view = "note"; st.again = function () { openNote(n.id); };
      I.paint(I.top(D.t(STR.backNotes, L()), s("title"), "", I.langBtn()) +
        '<div class="sp-scroll sp-pad" id="ntRead"><div class="sp-col"><article class="nt-article" aria-labelledby="ntT">' +
        '<h1 id="ntT">' + I.tx(n.title) + "</h1>" +
        '<p class="nt-meta">' + s("min", { n: n.minutes }) + "</p>" +
        n.blocks.map(block).join("") +
        '<section class="nt-practise">' + practiseHtml(n) + "</section>" +
        '<h2 class="nt-h" id="ntSrc">' + s("sources") + '</h2><ol class="nt-refs">' + n.sources.map(function (x) { return "<li>" + I.esc(D.t(x, L())) + "</li>"; }).join("") + "</ol>" +
        (nx ? '<button type="button" class="sp-nextnote" data-act="note" data-n="' + I.esc(nx.id) + '"><span class="sp-small">' + s("next") + "</span><b>" + I.tx(nx.title) + "</b>" +
          '<span class="sp-chev" aria-hidden="true">' + ico("chev") + "</span></button>" : "") +
        "</article></div></div>");
      if (ret) I.setRet(ret, retLabel && retLabel.t);
      var sc = G.document.getElementById("ntRead");
      Array.prototype.forEach.call(sc.querySelectorAll(".nt-fig img"), function (im) {
        im.addEventListener("error", function () {
          var f = im.parentNode.parentNode;
          f.classList.add("err");
          f.querySelector("figcaption").insertAdjacentHTML("afterbegin", '<span class="nt-fig-err">' + s("imgErr") + "</span>");
        });
      });
      // Read means reaching the sources, the end of the note. Without IntersectionObserver, opening counts.
      var end = G.document.getElementById("ntSrc");
      if (G.IntersectionObserver) { io = new G.IntersectionObserver(function (es) { if (es[0].isIntersecting) markRead(n.id); }, { root: sc }); io.observe(end); }
      else markRead(n.id);
      st.onBack = function () { if (zoomEl) { closeZoom(); return true; } if (st.ret) return false; openList(n.id); return true; };
      st.onLeave = function () { if (io) io.disconnect(); io = null; if (zoomEl) { zoomEl.remove(); zoomEl = null; } };
    }
    function markRead(id) { var r = reads(); if (r[id]) return; r[id] = I.today(); I.save(); }

    function zoom(k) {
      var m = cur && cur.blocks[k] && cur.blocks[k].img, root = I.root();
      if (!m || zoomEl) return;
      zoomEl = G.document.createElement("div");
      zoomEl.className = "sp-zoom pre";
      zoomEl.setAttribute("role", "dialog");
      zoomEl.setAttribute("aria-label", D.t(STR.enlarged, L()));
      zoomEl.innerHTML = I.top(D.t(STR.closeImg, L()), s("enlarged"), s("zoomHint"),
          '<button type="button" class="sp-icon" data-act="ntzin" aria-label="' + s("zoomIn") + '">' + (ico("plus") || "+") + "</button>" +
          '<button type="button" class="sp-icon" data-act="ntzfit" aria-label="' + s("fit") + '">' + (ico("target") || "=") + "</button>") +
        '<div class="sp-stage" id="ntZStage"><img id="ntZImg" src="' + I.esc(I.imgUrl(m.src)) + '" alt="' + I.esc(D.t(m.alt, L())) + '" width="' + m.w + '" height="' + m.h + '" decoding="async"></div>' +
        '<p class="sp-zcap">' + tt(m.caption) + "</p>";
      Array.prototype.forEach.call(root.children, function (c) { c.inert = true; });
      root.appendChild(zoomEl);
      zoomEl._z = S.attach(G.document.getElementById("ntZStage"), G.document.getElementById("ntZImg"));
      zoomEl._from = k;
      G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { if (zoomEl) zoomEl.classList.remove("pre"); }); });
      try { zoomEl.querySelector(".sp-back").focus({ preventScroll: true }); } catch (e) {}
    }
    function closeZoom() {
      var z = zoomEl;
      zoomEl = null;
      Array.prototype.forEach.call(z.parentNode.children, function (c) { if (c !== z) c.inert = false; });
      z.classList.add("pre", "out");
      G.setTimeout(function () { z.remove(); }, 150);
      var b = G.document.querySelector('#' + cfg.rootId + ' [data-act=zoomfig][data-k="' + z._from + '"]');
      try { if (b) b.focus({ preventScroll: true }); } catch (e) {}
    }

    A.note = function (b) { openNote(b.getAttribute("data-n")); };
    A.zoomfig = function (b) { zoom(+b.getAttribute("data-k")); };
    A.ntzin = function () { if (zoomEl) zoomEl._z.zoomBy(1.5); };
    A.ntzfit = function () { if (zoomEl) zoomEl._z.reset(); };
    A.ntpractise = function (b) {
      var c = b.getAttribute("data-t"), q = b.getAttribute("data-q");
      I.leave();
      if (c) I.startClinic(c);
      else host._banks.forEach(function (x) { if (x.topic && (!x.hasTopic || x.hasTopic(q))) x.topic(q); });
    };
    I.KEYS.note = function (e) {
      if (!zoomEl) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomEl._z.zoomBy(1.25); }
      else if (e.key === "-") { e.preventDefault(); zoomEl._z.zoomBy(0.8); }
      else if (e.key === "0") { e.preventDefault(); zoomEl._z.reset(); }
    };
    var read = {
      id: "notes", title: STR.title, sub: STR.sub, icon: "book", load: load, ready: function () { return !!N; },
      open: function () { openList(); },
      find: function (id) { return N ? N.notes.filter(function (x) { return x.id === id; })[0] || null : null; }, // a lesson's "Go deeper"
      line: function () { return N ? s("nRead", { d: fmt(readCount()), n: fmt(N.notes.length) }) : ""; }
    };
    host._reads.push(read);
    return read;
  };
})(typeof window !== "undefined" ? window : this);
