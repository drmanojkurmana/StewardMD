/* Specialty engine Explore (host part). ES5. SPECIALTY.features.explore(host).
   Explorers are interactive screens with a custom UI, one per concept (a specialty's own files). Each registers on
   the host: host.registerExplorer({id, title:{en,hi}, line:{en,hi}, icon?, thumb?, lesson?, test?: {clinic | mcqTopic |
   sim | tool}, open(host, x)}). Its open() paints through host._exploreUI.frame(id, bodyHtml, focusSel), which draws the
   top bar, the language pill and a "Keep going" end (Test yourself, the matching lesson), and calls
   host._exploreUI.mark(id) after the learner's first real interaction. The Learn home lists every registered
   explorer with its explored state (store.explore[id] = the first day). The explorer models (pure logic) stay with
   each specialty and carry their own tests. */
(function (G) {
  "use strict";
  function bi(v) { return v && typeof v === "object" && typeof v.en === "string" && !!v.en.trim(); }
  function validateExplorer(x) {
    var e = [];
    if (!x || typeof x.id !== "string" || !/^[a-z0-9-]+$/.test(x.id)) e.push("id: lowercase letters, digits and hyphens");
    if (!x || !bi(x.title)) e.push("title: needs {en, hi}");
    if (!x || !bi(x.line)) e.push("line: needs {en, hi}");
    if (!x || typeof x.open !== "function") e.push("open: a function");
    return e;
  }
  function mark(store, id, day) {
    var m = store.explore || (store.explore = {});
    if (m[id] != null) return false;
    m[id] = day;
    return true;
  }
  function explored(store, list) { var m = store.explore || {}; return list.filter(function (x) { return m[x.id] != null; }).length; }
  var PURE = { validateExplorer: validateExplorer, mark: mark, explored: explored };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  var SP = G.SPECIALTY || (G.SPECIALTY = {});
  if (!SP.features) SP.features = {};
  SP.EXPLORE = PURE;

  SP.features.explore = function (host) {
    var I = host._internal, st = host._st, cfg = host.cfg, D = G.SPECIALTY_DATA, A = I.ACTIONS;
    var ico = I.ico, esc = I.esc;
    function T(en, hi) { return { en: en, hi: hi }; }
    var STR = {
      explore: T("Explore", "खोजें"), nExplored: T("{d} of {n} explored", "{n} में से {d} देखे"), explored: T("Explored", "देख लिया"), notYet: T("Not explored yet", "अभी नहीं देखा"),
      backLearn: T("Back to Learn", "सीखें पर वापस"), backExplore: T("Back to explorer", "एक्सप्लोरर पर वापस"), keepGoing: T("Keep going", "आगे बढ़ें"),
      testYourself: T("Test yourself", "खुद को परखें"), lessonL: T("Lesson: {t}", "पाठ: {t}")
    };
    function L() { return I.lang(); }
    function s(key, v) { return esc(D.t(STR[key], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? String(v[x]) : m; }); }
    function list() { return host._explore.filter(function (x) { return !validateExplorer(x).length; }); }
    function by(id) { var r = null; host._explore.forEach(function (x) { if (x.id === id) r = x; }); return r; }
    var EX = { id: null, painted: null };

    function homeHtml() {
      var xs = list();
      if (!xs.length) return "";
      var m = st.store.explore || {};
      return '<section class="ex-home" aria-labelledby="exHomeH"><div class="ex-home-h"><h2 class="sp-h2" id="exHomeH">' + s("explore") + '</h2><span class="sp-small">' +
        s("nExplored", { d: I.fmt(explored(st.store, xs)), n: I.fmt(xs.length) }) + '</span></div><ul class="sp-rows">' + xs.map(function (x) {
          var done = m[x.id] != null;
          var lead = x.thumb ? '<img src="' + esc(I.imgUrl(x.thumb)) + '" alt="" width="48" height="48" loading="lazy" decoding="async">' : I.tile(x.icon || "compass");
          return I.row("exopen", ' data-x="' + esc(x.id) + '"', lead, I.tx(x.title), I.tx(x.line),
            done ? '<span class="ex-done">' + ico("check") + s("explored") + "</span>" : '<span class="sp-sr">' + s("notYet") + "</span>");
        }).join("") + "</ul></section>";
    }
    function testOf(x) { return x.test || null; }
    function bankFor(t) { var b = null; if (t && t.mcqTopic) host._banks.forEach(function (y) { if (y.topic && (!y.hasTopic || y.hasTopic(t.mcqTopic))) b = y; }); return b; }
    function endHtml(x) {
      var t = testOf(x), les = x.lesson && host._learn && host._learn.meta(x.lesson);
      var can = t && ((t.clinic && I.clinic(t.clinic)) || bankFor(t) || (t.sim && host._sims.some(function (y) { return y.id === t.sim; })) || (t.tool && host._tools.some(function (y) { return y.id === t.tool; })));
      if (!can && !les) return "";
      return '<section class="ex-end" aria-labelledby="exEndH"><h2 class="sp-h2" id="exEndH">' + s("keepGoing") + "</h2>" +
        (can ? '<button type="button" class="sp-btn pri sp-wide" data-act="extest">' + ico("target") + " " + s("testYourself") + "</button>" : "") +
        (les ? '<button type="button" class="sp-btn sec sp-wide" data-act="lesson" data-l="' + esc(x.lesson) + '">' + ico("book") + " " + s("lessonL", { t: I.tx(les.title) }) + "</button>" : "") +
        "</section>";
    }
    // The explorer's frame: a repaint of the same explorer keeps the scroll position.
    function frame(id, body, focusSel) {
      var x = by(id), prev = G.document.getElementById("exScroll"), keep = prev && EX.painted === id ? prev.scrollTop : 0;
      st.view = "explore"; EX.id = id;
      st.again = function (f) { open(id, f); };
      I.paint(I.top(D.t(STR.backLearn, L()), I.tx(x.title), I.tx(x.line), I.langBtn()) +
        '<div class="sp-scroll sp-pad" id="exScroll"><div class="sp-col ex-wrap" data-x="' + esc(id) + '">' + body + endHtml(x) + "</div></div>", focusSel);
      EX.painted = id;
      var sc = G.document.getElementById("exScroll");
      if (sc) sc.scrollTop = keep;
      return sc;
    }
    function open(id, focusSel) {
      var x = by(id);
      if (!x) return;
      if (EX.id !== id) { I.leave(); EX.painted = null; }
      EX.id = id;
      st.onLeave = function () { EX.id = null; EX.painted = null; if (x.close) try { x.close(); } catch (e) {} };
      x.open(host, x, focusSel);
    }
    A.exopen = function (b) { open(b.getAttribute("data-x")); };
    A.extest = function () {
      var x = by(EX.id), t = x && testOf(x), id = EX.id, b = bankFor(t);
      if (!t) return;
      var ret = function () { open(id); };
      I.leave();
      if (t.clinic && I.clinic(t.clinic)) I.startClinic(t.clinic, { classes: t.classes });
      else if (b) b.topic(t.mcqTopic);
      else host._sims.concat(host._tools).forEach(function (y) { if (y.id === t.sim || y.id === t.tool) y.open(); });
      if (st.view === "explore") ret(); else if (st.view !== "hub") I.setRet(ret, D.t(STR.backExplore, L()));
    };
    host._exploreUI = { homeHtml: homeHtml, frame: frame, open: open, mark: function (id) { if (mark(st.store, id, I.today())) I.save(); }, _x: EX };
    return host._exploreUI;
  };
})(typeof window !== "undefined" ? window : this);
