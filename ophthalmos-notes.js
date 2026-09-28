/* Ophthalmós notes: short cited study notes, illustrated with real images from the clinic decks. ES5.
   Registers in OPHTHALMOS._reads. Layers: hub -> notes list -> reader -> enlarged image; back()
   unwinds one at a time through st.onBack. Read state: store.read[id] = the day the note was read
   to the end. Content: ophthalmos/notes.json.
   Loaded after ophthalmos-screens.js. */
(function (G) {
  "use strict";
  var O = G.OPHTHALMOS, I = O._internal, st = O._st, S = G.OPHTHALMOS_STAGE, D = G.OPHTHALMOS_DATA;
  var esc = I.esc, ico = I.ico, fmt = I.fmt;
  var GROUPS = [
    ["retina", "Retina and vitreous"], ["glaucoma", "Glaucoma"], ["peds", "Children and ROP"],
    ["neuro", "Neuro-ophthalmology"], ["cornea", "Cornea and external eye"], ["lens", "Lens and cataract"],
    ["uveitis", "Uveitis"], ["orbit", "Orbit and trauma"], ["optics", "Optics and refraction"], ["fundamentals", "Imaging basics"]
  ];
  var TOPIC = {}; GROUPS.forEach(function (g) { TOPIC[g[0]] = g[1]; });
  var CLINIC = { oct: "Retina clinic", disc: "Glaucoma clinic", dr: "Diabetic eye screening", rop: "ROP screening" };
  var N = null, cur = null, zoomEl = null, io = null;

  function load() {
    return I.getJSON("notes.json").then(function (d) { N = d; }, function () { N = null; });
  }
  function reads() { return st.store.read || (st.store.read = {}); }
  function readCount() { var r = reads(); return N.notes.filter(function (n) { return r[n.id]; }).length; }
  // Reading order is the list order: grouped by subspecialty.
  function ordered() {
    var out = [];
    GROUPS.forEach(function (g) { N.notes.forEach(function (x) { if (x.topic === g[0]) out.push(x); }); });
    return out;
  }
  function firstImg(n) { for (var i = 0; i < n.blocks.length; i++) if (n.blocks[i].img) return n.blocks[i].img; return null; }
  function imgCount(n) { return n.blocks.filter(function (b) { return b.img; }).length; }
  // Only **bold** survives, applied after escaping.
  function md(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }

  /* ---------- list ---------- */
  function openList(focusId) {
    I.leave();
    st.view = "notes";
    if (!N) {
      return I.paint(I.top("Back", "Study notes", "Could not load") +
        '<div class="oph-scroll oph-pad"><p>The notes did not load. Check the connection and try again.</p>' +
        '<button class="oph-btn pri" data-act="notesretry">' + ico("refresh") + " Try again</button></div>");
    }
    var r = reads(), n = N.notes.length;
    var body = GROUPS.map(function (g) {
      var list = N.notes.filter(function (x) { return x.topic === g[0]; });
      if (!list.length) return "";
      return '<h2 class="oph-h2">' + esc(g[1]) + '</h2><ul class="oph-nlist">' + list.map(function (x) {
        var im = firstImg(x);
        return '<li><button class="oph-nrow" data-act="note" data-n="' + esc(x.id) + '">' +
          (im ? '<img src="' + esc(I.imgUrl(im.src)) + '" alt="" width="56" height="56" loading="lazy" decoding="async">' : "") +
          '<span class="oph-nrow-b"><b>' + esc(x.title) + "</b><span>" + esc(x.sub) + '</span><span class="oph-small">' +
          (r[x.id] ? '<span class="oph-done">' + ico("check") + "Read</span> · " : "") + x.minutes + " min · " +
          imgCount(x) + (imgCount(x) === 1 ? " image" : " images") + "</span></span>" +
          '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
      }).join("") + "</ul>";
    }).join("");
    I.paint(I.top("Back", "Study notes", fmt(readCount()) + " of " + fmt(n) + " read") +
      '<div class="oph-scroll oph-pad"><p class="oph-lede">What to look for, how it is graded and what to do next, each note illustrated with real images from the clinics and cited to the guideline it follows.</p>' +
      body + '<p class="oph-note">' + esc(N.reviewNote) + "</p></div>", focusId ? '[data-n="' + focusId + '"]' : null);
    var f = focusId && G.document.querySelector('[data-n="' + focusId + '"]');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: "center" });
  }

  /* ---------- reader ---------- */
  function block(b, k) {
    if (b.h) return '<h2 class="oph-nh">' + md(b.h) + "</h2>";
    if (b.p) return "<p>" + md(b.p) + "</p>";
    if (b.ul) return "<ul>" + b.ul.map(function (x) { return "<li>" + md(x) + "</li>"; }).join("") + "</ul>";
    if (b.pearl) return '<p class="oph-npearl"><b>Pearl.</b> ' + md(b.pearl) + "</p>";
    if (b.img) {
      var m = b.img;
      return '<figure class="oph-fig"><button class="oph-fig-b" data-act="zoomfig" data-k="' + k + '" aria-label="Enlarge: ' + esc(m.alt) + '">' +
        '<img src="' + esc(I.imgUrl(m.src)) + '" alt="' + esc(m.alt) + '" width="' + m.w + '" height="' + m.h + '" loading="lazy" decoding="async"></button>' +
        "<figcaption>" + md(m.caption) + ' <span class="oph-credit">' + esc(m.credit) + "</span></figcaption></figure>";
    }
    return "";
  }

  function practiseHtml(n) {
    var p = n.practise || {}, t = TOPIC[p.topic] || TOPIC[n.topic] || "";
    if (p.clinic === "cases" && p.cases && p.cases.length) {
      var pro = I.isPro(), d = st.decks.cases.items, open = p.cases.filter(function (id) {
        for (var i = 0; i < d.length; i++) if (d[i].id === id) return !D.caseLocked(st.cfg, i, pro);
        return false;
      }).length, k = open || p.cases.length;
      return '<button class="oph-btn ' + (open ? "pri" : "sec") + ' oph-wide" data-act="practise" data-c="' + esc(p.cases.join(",")) + '">' + ico("play") + " Work " +
        (k === 1 ? "this case" : "these " + k + " cases") + (open ? "" : ' <span class="oph-pro">' + ico("lock") + "Pro</span>") + "</button>" +
        '<p class="oph-small">Case conference: the cases shown above, ten questions each, expert answers to reveal.' +
        (open && open < p.cases.length ? " " + (p.cases.length - open) + " more with StewardMD Pro." : "") + "</p>";
    }
    if (CLINIC[p.clinic]) {
      return '<button class="oph-btn pri oph-wide" data-act="practise" data-t="' + esc(p.clinic) + '">' + ico("play") + " Practise in " + esc(CLINIC[p.clinic]) + "</button>" +
        '<p class="oph-small">Real images graded against the dataset labels, at your level.</p>';
    }
    return '<p class="oph-ptopic"><b>' + esc(t) + '</b><span class="oph-small">Practise this topic in the question bank.</span></p>';
  }

  function openNote(id) {
    var all = ordered(), i = all.map(function (x) { return x.id; }).indexOf(id);
    if (i < 0) return openList();
    I.leave();
    var n = all[i], nx = all[i + 1];
    cur = n; st.view = "note";
    var srcs = n.sources.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    I.paint(I.top("Back to notes", "Study notes", esc(TOPIC[n.topic] || "")) +
      '<div class="oph-scroll oph-pad" id="ophRead"><article class="oph-article" aria-labelledby="ophNT">' +
      '<h1 id="ophNT">' + esc(n.title) + "</h1>" +
      '<p class="oph-meta">' + n.minutes + " min read · " + imgCount(n) + (imgCount(n) === 1 ? " real image" : " real images") +
      "</p>" +
      n.blocks.map(block).join("") +
      '<section class="oph-practise" aria-label="Practise this">' + practiseHtml(n) + "</section>" +
      '<h2 class="oph-nh" id="ophSrc">Sources</h2><ol class="oph-refs">' + srcs + "</ol>" +
      (nx ? '<button class="oph-nextnote" data-act="note" data-n="' + esc(nx.id) + '"><span class="oph-small">Next note</span><b>' + esc(nx.title) + "</b>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button>" : "") +
      "</article></div>");
    var scroller = G.document.getElementById("ophRead");
    Array.prototype.forEach.call(scroller.querySelectorAll(".oph-fig img"), function (im) {
      im.addEventListener("error", function () {
        var f = im.parentNode.parentNode;
        f.classList.add("err");
        f.querySelector("figcaption").insertAdjacentHTML("afterbegin", '<span class="oph-fig-err">Image did not load. </span>');
      });
    });
    // Read means reaching the sources, the end of the note. Without IntersectionObserver, opening counts.
    var end = G.document.getElementById("ophSrc");
    if (G.IntersectionObserver) {
      io = new G.IntersectionObserver(function (es) { if (es[0].isIntersecting) markRead(n.id); }, { root: scroller });
      io.observe(end);
    } else markRead(n.id);
    st.onBack = function () { if (zoomEl) { closeZoom(); return true; } if (st.ret) return false; openList(n.id); return true; }; // st.ret: opened from a lesson
    st.onLeave = function () { if (io) io.disconnect(); io = null; if (zoomEl) { zoomEl.remove(); zoomEl = null; } };
  }

  function markRead(id) {
    var r = reads();
    if (r[id]) return;
    r[id] = I.today();
    I.save();
  }

  /* ---------- enlarged image: the clinic stage (pinch, double-tap, wheel zoom) ---------- */
  function zoom(k) {
    var m = cur && cur.blocks[k] && cur.blocks[k].img, root = G.document.getElementById("smdOphthalmos");
    if (!m || zoomEl) return;
    zoomEl = G.document.createElement("div");
    zoomEl.className = "oph-zoom pre";
    zoomEl.setAttribute("role", "dialog");
    zoomEl.setAttribute("aria-label", "Enlarged image");
    zoomEl.innerHTML = I.top("Close image", "Enlarged image", "Pinch, double-tap or + and -",
        '<button class="oph-icon" data-act="zoomin" aria-label="Zoom in">' + ico("plus") + "</button>" +
        '<button class="oph-icon" data-act="zoomfit" aria-label="Fit image">' + ico("target") + "</button>") +
      '<div class="oph-stage" id="ophZStage"><img id="ophZImg" src="' + esc(I.imgUrl(m.src)) + '" alt="' + esc(m.alt) +
      '" width="' + m.w + '" height="' + m.h + '" decoding="async"></div>' +
      '<p class="oph-zcap">' + md(m.caption) + "</p>";
    // Everything behind the enlarged image leaves the tab order and the accessibility tree.
    Array.prototype.forEach.call(root.children, function (c) { c.inert = true; });
    root.appendChild(zoomEl);
    zoomEl._z = S.attach(G.document.getElementById("ophZStage"), G.document.getElementById("ophZImg"));
    zoomEl._from = k;
    G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { if (zoomEl) zoomEl.classList.remove("pre"); }); });
    try { zoomEl.querySelector(".oph-back").focus({ preventScroll: true }); } catch (e) {}
  }
  function closeZoom() {
    var z = zoomEl;
    zoomEl = null;
    Array.prototype.forEach.call(z.parentNode.children, function (c) { if (c !== z) c.inert = false; });
    z.classList.add("pre", "out");
    G.setTimeout(function () { z.remove(); }, 150);
    var b = G.document.querySelector('[data-act=zoomfig][data-k="' + z._from + '"]');
    try { if (b) b.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- wiring ---------- */
  var A = I.ACTIONS;
  A.note = function (b) { openNote(b.getAttribute("data-n")); };
  A.zoomfig = function (b) { zoom(+b.getAttribute("data-k")); };
  A.zoomin = function () { if (zoomEl) zoomEl._z.zoomBy(1.5); };
  A.zoomfit = function () { if (zoomEl) zoomEl._z.reset(); };
  I.KEYS.note = function (e) {
    if (!zoomEl) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomEl._z.zoomBy(1.25); }
    else if (e.key === "-") { e.preventDefault(); zoomEl._z.zoomBy(0.8); }
    else if (e.key === "0") { e.preventDefault(); zoomEl._z.reset(); }
  };
  A.notesretry = function () { load().then(function () { openList(); }); };
  // Leave the reader first, so back from the clinic returns to the hub like any clinic.
  A.practise = function (b) { I.leave(); (b.getAttribute("data-c") ? A.cases : A.clinic)(b); };

  O._reads.push({
    id: "notes", title: "Study notes", icon: "book", load: load, open: function () { openList(); },
    find: function (id) { return N ? N.notes.filter(function (x) { return x.id === id; })[0] || null : null; }, // a lesson's "Go deeper"
    sub: "Signs, grading, next steps",
    line: function () { return N ? fmt(readCount()) + " of " + fmt(N.notes.length) + " read" : "Did not load. Open to try again"; },
    // One image from each of the first notes that use different decks: the row shows the range of modalities.
    thumbs: function () {
      if (!N) return [];
      var seen = {}, out = [];
      N.notes.forEach(function (x) { var m = firstImg(x); if (m && !seen[m.deck] && out.length < 3) { seen[m.deck] = 1; out.push(m.src); } });
      return out;
    }
  });
})(typeof window !== "undefined" ? window : this);
