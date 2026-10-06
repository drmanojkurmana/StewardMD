/* Narkē reading clinics: two clinic plugins on the specialty engine (host.registerClinic). ES5.
   capno:   name the capnogram pattern on a synthetic capnograph screen.
   monitor: name the crisis from a synthetic multiparameter monitor (ECG II, pleth, capnogram, NIBP, EtCO2 trend).
   Signals come from NARKE_MODELS.signals (narke-models/signals.js) by each deck case's seed, so a case always looks the
   same. MBBS sees MBBS cases; Resident sees all. Four options: the truth and three from the level's pool. The engine runs
   the session (FSRS deck key <clinic>.<level>), the Resident trial gate, the done screen and NARKE.openCase.
   Every screen says "teaching signal, not patient data"; the trace has a measured screen-reader description. */
(function (G) {
  "use strict";
  var host = G.NARKE;
  if (!host || !host.registerClinic || !G.document) return;
  var I = host._internal, st = host._st, C = G.SPECIALTY_CORE, D = G.SPECIALTY_DATA;
  var nk = { done: null, fresh: false };

  var L10N = {
    en: {
      backHub: "Back to Narkē", caseOf: "Case {i} of {n}", askCapno: "Which capnogram is this?", askMon: "What is the most likely problem?",
      teaching: "Teaching signal, not patient data", right: "Correct", wrong: "Not this one", answer: "Answer", yours: "Yours",
      see: "What the trace shows", points: "Teaching points", sources: "Sources", nextReview: "Next review in", day: "day", days: "days",
      next: "Next case", capAria: "Capnograph screen, synthetic teaching signal", monAria: "Monitor screen, synthetic teaching signal",
      noModel: "The teaching signals did not load. Close Narkē, check your connection and open it again.", close: "Close Narkē",
      notConn: "Not connected", trend: "EtCO2, last 15 min", co2: "CO2 mmHg", ecg: "ECG II", pleth: "Pleth", nibp: "NIBP", hr: "HR",
      spo2: "SpO2 %", etco2: "EtCO2", rr: "RR", sweepFast: "8 s", sweepSlow: "24 s", keys: "Keys 1 to 4 choose an answer.",
      maikCap: "I am learning to read capnograms. This synthetic teaching trace shows: {t}. I chose: {m}. Explain the features that identify it and how to tell it from my choice.",
      maikMon: "I am learning to read anaesthesia monitors. This synthetic teaching case is: {t}. I chose: {m}. Explain the monitor clues that point to it and the first actions."
    },
    hi: {
      backHub: "नार्के पर वापस", caseOf: "{n} में से केस {i}", askCapno: "यह कौन सा कैपनोग्राम है?", askMon: "सबसे संभावित समस्या क्या है?",
      teaching: "शिक्षण सिग्नल, मरीज़ का डेटा नहीं", right: "सही", wrong: "यह नहीं", answer: "उत्तर", yours: "आपका",
      see: "ट्रेस क्या दिखाता है", points: "मुख्य बातें", sources: "स्रोत", nextReview: "अगला दोहराव", day: "दिन में", days: "दिन में",
      next: "अगला केस", capAria: "कैपनोग्राफ़ स्क्रीन, कृत्रिम शिक्षण सिग्नल", monAria: "मॉनिटर स्क्रीन, कृत्रिम शिक्षण सिग्नल",
      noModel: "शिक्षण सिग्नल लोड नहीं हुए। नार्के बंद करें, कनेक्शन जांचें और फिर खोलें।", close: "नार्के बंद करें",
      notConn: "जुड़ा नहीं", trend: "EtCO2, पिछले 15 मिनट", co2: "CO2 mmHg", ecg: "ECG II", pleth: "Pleth", nibp: "NIBP", hr: "HR",
      spo2: "SpO2 %", etco2: "EtCO2", rr: "RR", sweepFast: "8 s", sweepSlow: "24 s", keys: "उत्तर चुनने के लिए 1 से 4 कुंजियाँ।",
      maikCap: "I am learning to read capnograms. This synthetic teaching trace shows: {t}. I chose: {m}. Explain the features that identify it and how to tell it from my choice.",
      maikMon: "I am learning to read anaesthesia monitors. This synthetic teaching case is: {t}. I chose: {m}. Explain the monitor clues that point to it and the first actions."
    }
  };
  function W() { return L10N[I.lang()]; }
  function esc(s) { return I.esc(s); }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] == null ? m : o[k]; }); }
  function M() { return G.NARKE_MODELS && G.NARKE_MODELS.signals; }
  function item() { var s = st.session; return s && s.list[s.i] ? s.list[s.i] : null; }
  function spec() { return st.session && st.session.clinic === "monitor" ? mon : cap; }
  function set(id) { var m = M(); return id === "monitor" ? m.MONITOR : m.CAPNO; }
  function dash(v) { return v == null ? "?" : String(v); } // "--" would be rewritten to a dash by the app's text tidy

  /* ---------- drawing: SVG paths in a 1000 x H box stretched to the column (strokes keep their width) ---------- */
  function path(y, lo, hi, h) {
    var n = y.length, d = "", i, v;
    for (i = 0; i < n; i++) {
      v = h - (Math.max(lo, Math.min(hi, y[i])) - lo) / (hi - lo) * h;
      d += (i ? "L" : "M") + Math.round(i * 1000 / (n - 1)) + " " + (Math.round(v * 10) / 10);
    }
    return d;
  }
  function wave(cls, y, lo, hi, h, grid) {
    var g = (grid || []).map(function (v) { var gy = Math.round((h - (v - lo) / (hi - lo) * h) * 10) / 10; return '<line class="nkc-grid" x1="0" x2="1000" y1="' + gy + '" y2="' + gy + '"/>'; }).join("");
    return '<svg class="nkc-svg" viewBox="0 0 1000 ' + h + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + g +
      '<path class="nkc-line ' + cls + '" d="' + path(y, lo, hi, h) + '"/></svg>';
  }
  function scaleLabels(grid, lo, hi) {
    return grid.map(function (v) { return '<span class="nkc-tick" style="top:' + Math.round((1 - (v - lo) / (hi - lo)) * 1000) / 10 + '%">' + v + "</span>"; }).join("");
  }
  function co2Range(sig) { var mx = 0; sig.y.forEach(function (v) { if (v > mx) mx = v; }); return Math.max(50, Math.ceil((mx + 6) / 10) * 10); }
  function co2Grid(hi) { var g = [], v; for (v = 0; v <= hi; v += 20) g.push(v); return g; }
  function chan(key, label, sweep, body, num, tall) {
    return '<div class="nkc-ch nkc-' + key + (tall ? " tall" : "") + '"><div class="nkc-wave"><span class="nkc-tag">' + esc(label) +
      (sweep ? ' <i>' + esc(sweep) + "</i>" : "") + '</span><div class="nkc-plot">' + body + "</div></div>" + '<div class="nkc-num">' + num + "</div></div>";
  }
  function big(label, v, sub) { return '<span class="nkc-k">' + esc(label) + '</span><b class="nkc-v">' + esc(v) + "</b>" + (sub ? '<span class="nkc-sub">' + esc(sub) + "</span>" : ""); }
  function trendSvg(t) {
    if (!t) return "";
    var w = W(), y = t.map(function (v) { return v; });
    return '<div class="nkc-trend"><span class="nkc-tag">' + esc(w.trend) + "</span>" + wave("co2", y, -3, 80, 40, [20, 40, 60]) +
      '<span class="nkc-tends"><b>' + t[0] + "</b><b>" + t[t.length - 1] + "</b></span></div>";
  }
  function capnoScreen(sig) {
    var w = W(), hi = co2Range(sig), g = co2Grid(hi);
    return chan("co2", w.co2, w.sweepSlow, wave("co2", sig.y, -3, hi, 160, g) + scaleLabels(g, -3, hi),
      big(w.etco2, dash(sig.etco2)) + big(w.rr, dash(sig.rr)), true) + trendSvg(sig.trend);
  }
  function monitorScreen(m) {
    var w = W(), n = m.nums, co2 = m.co2, hi = co2 ? co2Range(co2) : 50;
    return chan("ecg", w.ecg, w.sweepFast, wave("ecg", m.ecg.y, -0.8, 1.4, 80), big(w.hr, dash(n.hr))) +
      chan("spo2", w.pleth, w.sweepFast, wave("spo2", m.pleth.y, -0.1, 1.25, 56), big(w.spo2, dash(n.spo2))) +
      chan("co2", w.co2, w.sweepSlow, co2 ? wave("co2", co2.y, -3, hi, 64, co2Grid(hi)) : '<span class="nkc-off">' + esc(w.notConn) + "</span>",
        big(w.etco2, dash(n.etco2)) + big(w.rr, dash(n.rr))) + trendSvg(m.trend) +
      '<div class="nkc-ch nkc-art nkc-nibp"><span class="nkc-k">' + esc(w.nibp) + '</span><span class="nkc-bp"><b class="nkc-v">' +
      esc(n.sys == null ? "?" : n.sys + "/" + n.dia) + "</b>" + (n.map == null ? "" : '<span class="nkc-sub">(' + esc(n.map) + ")</span>") + "</span></div>";
  }

  /* ---------- one case: question, then the reveal below it ---------- */
  function render(focusSel) {
    var it = item(), w = W(), sp = spec(), m = M();
    if (!it) return;
    if (!m) {
      I.paint(I.top(w.backHub, I.tx(sp.title), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col"><div class="sp-err" role="alert"><p>' + esc(w.noModel) +
        '</p><button type="button" class="sp-btn sec" data-act="back">' + esc(w.backHub) + "</button></div></div></div>");
      return;
    }
    var c = it.c, isMon = sp.id === "monitor", p = set(sp.id)[c.pattern], r = st.session.result, lv = I.level();
    var sig = isMon ? m.monitor(c.pattern, c.seed) : m.capnogram(c.pattern, c.seed);
    var opts = m.options(sp.id, c.pattern, c.seed, lv), letters = ["A", "B", "C", "D"];
    var srText = isMon ? m.describeMonitor(sig, I.lang()) : m.describeCapno(sig, I.lang());
    var ans = opts.map(function (o, j) {
      var state = !r ? "" : o === c.pattern ? "right" : o === r.pick ? "wrong" : "dim";
      return '<button type="button" class="sp-ans" data-act="nkc-ans" data-o="' + esc(o) + '"' + (state ? ' data-state="' + state + '" aria-disabled="true"' : "") +
        '><span class="k" aria-hidden="true">' + (state === "right" ? I.ico("check") || letters[j] : state === "wrong" ? I.ico("close") || letters[j] : letters[j]) + "</span>" + I.tx(set(sp.id)[o].title) + "</button>";
    }).join("");
    var s = st.session;
    var html = I.top(w.backHub, I.tx(sp.title), esc(fmt(w.caseOf, { i: s.i + 1, n: s.list.length })), I.langBtn()) +
      '<div class="sp-scroll sp-pad nkc-view"><div class="sp-col">' +
      '<p class="nkc-scene" tabindex="-1">' + I.tx(p.scene) + "</p>" +
      '<figure class="nkc-mon' + (nk.fresh ? " nkc-new" : "") + '" role="img" aria-label="' + esc(isMon ? w.monAria : w.capAria) + '" aria-describedby="nkcDesc">' +
        (isMon ? monitorScreen(sig) : capnoScreen(sig)) + "</figure>" +
      '<p id="nkcDesc" class="sp-sr">' + esc(srText) + "</p>" +
      '<p class="nkc-label">' + (I.ico("info") ? '<span aria-hidden="true">' + I.ico("info") + "</span>" : "") + esc(w.teaching) + "</p>" +
      '<h2 class="sp-h3 nkc-q" id="nkcQ">' + esc(isMon ? w.askMon : w.askCapno) + "</h2>" +
      '<div class="sp-answers' + (r ? " done" : "") + '" role="group" aria-labelledby="nkcQ" aria-describedby="nkcKeys">' + ans + "</div>" +
      '<p id="nkcKeys" class="sp-sr">' + esc(w.keys) + "</p>" + (r ? reveal(sp, c, p, r) : "") + "</div></div>" +
      (r ? '<div class="sp-foot"><button type="button" class="sp-btn pri sp-wide" data-act="nkc-next">' + esc(w.next) + "</button></div>" : "");
    I.paint(html, focusSel || (r ? ".nkc-verdict" : null));
    nk.fresh = false;
    if (r && focusSel === ".nkc-verdict") {
      var v = I.root().querySelector(".nkc-verdict");
      try { if (v) v.scrollIntoView({ block: "start", behavior: G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } catch (e) {}
    }
  }
  function reveal(sp, c, p, r) {
    var w = W(), m = M(), mine = set(sp.id)[r.pick];
    var les = !r.ok && host._learn && host._learn.lessonFor ? host._learn.lessonFor(sp.id, c.pattern) : null;
    var maikQ = fmt(sp.id === "monitor" ? w.maikMon : w.maikCap, { t: p.title.en, m: mine.title.en });
    return '<div class="sp-reveal nkc-reveal">' +
      '<p class="sp-verdict nkc-verdict ' + (r.ok ? "ok" : "bad") + '" tabindex="-1">' + (I.ico(r.ok ? "check" : "close") || "") + "<span>" + esc(r.ok ? w.right : w.wrong) + "</span></p>" +
      '<p class="nkc-key"><span>' + esc(w.answer) + "</span><b>" + I.tx(p.title) + "</b></p>" +
      (r.ok ? "" : '<p class="nkc-key mine"><span>' + esc(w.yours) + "</span>" + I.tx(mine.title) + "</p>") +
      '<h3 class="sp-h3">' + esc(w.see) + '</h3><p class="nkc-desc">' + I.tx(p.describe) + "</p>" +
      '<h3 class="sp-h3">' + esc(w.points) + '</h3><ul class="nkc-points">' + p.points.map(function (x) { return "<li>" + I.tx(x) + "</li>"; }).join("") + "</ul>" +
      '<details class="nkc-src"><summary>' + esc(w.sources) + "</summary><ul>" + p.src.map(function (k) { return "<li>" + esc(m.SOURCES[k].label) + "</li>"; }).join("") + "</ul></details>" +
      '<p class="sp-small nkc-ivl">' + esc(w.nextReview) + " <b>" + r.ivl + "</b> " + esc(r.ivl === 1 ? w.day : w.days) + "</p>" +
      (les ? '<button type="button" class="sp-btn sec sp-wide" data-act="lesson" data-l="' + esc(les.id) + '">' + esc(typeof les.title === "string" ? les.title : I.t(les.title)) + "</button>" : "") +
      I.maikBtn(maikQ) + "</div>";
  }
  function answer(pick) {
    var it = item(), sp = spec(), s = st.session;
    if (!it || s.result || !M()) return;
    var truth = it.c.pattern, ok = pick === truth, today = I.today(), key = D.levelKey(sp.id, I.level());
    var card = C.review(st.store, key, it.id, C.gradeFor(ok), today);
    C.recordAnswer(st.store, key, truth, pick);
    I.save();
    I.haptic(ok ? "success" : "error");
    s.result = { pick: pick, ok: ok, ivl: card[3] - today };
    render(".nkc-verdict");
  }
  function start(done) {
    nk.done = done; nk.fresh = true;
    st.session.result = null;
    st.view = "nkc"; st.again = function (f) { render(typeof f === "string" ? f : null); };
    render(st.session.i > 0 ? ".nkc-scene" : null); // keep focus inside the clinic so keys 1 to 4 still answer
  }
  function items(id) {
    return function (d) {
      var lv = I.level();
      return (d.cases || []).filter(function (c) { return lv === "resident" || c.level === "mbbs"; }).map(function (c) { return { id: c.id, a: c.pattern, c: c }; });
    };
  }

  var cap = { id: "capno", icon: "lungs", deck: "decks/capno.json", size: 8, newCap: 8,
    title: { en: "Capnography", hi: "कैपनोग्राफ़ी" }, sub: { en: "Name the waveform pattern", hi: "तरंग का पैटर्न पहचानें" },
    items: items("capno"), render: function (h, it, done) { start(done); } };
  var mon = { id: "monitor", icon: "pulse", deck: "decks/monitor.json", size: 8, newCap: 8,
    title: { en: "Monitor reading", hi: "मॉनिटर पढ़ना" }, sub: { en: "Read ECG, SpO2, BP and CO2 together", hi: "ECG, SpO2, BP और CO2 एक साथ पढ़ें" },
    items: items("monitor"), render: function (h, it, done) { start(done); } };
  host.registerClinic(cap);
  host.registerClinic(mon);

  var A = I.ACTIONS;
  A["nkc-ans"] = function (b) { if (st.view === "nkc") answer(b.getAttribute("data-o")); };
  A["nkc-next"] = function () { if (nk.done) nk.done(); };
  // Keys 1 to 4 (or A to D) answer while the question is open.
  I.KEYS.nkc = function (e) {
    if (!st.session || st.session.result) return;
    var k = String(e.key || "").toUpperCase(), j = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : "ABCD".indexOf(k);
    if (j < 0 || k === "") return;
    var b = I.root().querySelectorAll("[data-act=nkc-ans]")[j];
    if (b) { e.preventDefault(); answer(b.getAttribute("data-o")); }
  };
  host.NKC_L10N = L10N;
})(typeof window !== "undefined" ? window : this);
