/* Narkē Ventilator Lab: the real-ventilator bridge. ES5. Loaded by narke-loader.js after narke-vent.js.
   Takes a junior doctor from the simulator to safely STARTING on a real ventilator under supervision:
   "Walk up to the bed" (first five minutes checklist), "Reading a real ventilator screen" (an interactive
   generic panel in three layout styles: SET vs MEASURED, tap a number to learn it, brand label names as text
   only, then a short quiz), "Mode names you will meet" (one plain line each, the closest lab mode, never
   change alone), "3 am drill" (put the alarm steps in order, feedback on the order, SBAR script) and "Never
   change settings alone on day one".
   Content: narke/vent/bridge.json (review: ai_drafted). The lab home lists these through
   NARKE_VENT_BRIDGE.homeBlock(level), the one hook in narke-vent.js. Back returns to the lab home.
   Node (tests): module.exports = { STR, verdict, order }. */
(function (G) {
  "use strict";
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure helpers ================= */
  // A fixed shuffle so a drill always starts from the same pool (no answer in the original order).
  function order(steps, seed) {
    var a = steps.map(function (x, i) { return { x: x, k: 0, i: i }; }), h = 7, s = String(seed || "");
    for (var j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) % 9973;
    a.forEach(function (o) { o.k = (o.i * 7919 + h * 31) % 101; });
    a.sort(function (p, q) { return p.k - q.k || p.i - q.i; });
    var out = a.map(function (o) { return o.x; });
    var same = out.every(function (x, i) { return x === steps[i]; });
    if (same && out.length > 1) out.push(out.shift());
    return out;
  }
  // The learner's order against the ranks. rank null = a trap (should be left out); flex = right at any point.
  // A step is "late" when it comes after a step that belongs later (only the later-placed one is marked).
  // Returns {ok, items: [{id, state: ok|late|trap|missed|skipped, pos}]} in the content's order.
  function verdict(steps, picked) {
    var by = {}, pos = {};
    steps.forEach(function (s) { by[s.id] = s; });
    picked.forEach(function (id, i) { pos[id] = i; });
    var maxRank = -1, state = {};
    picked.forEach(function (id) {
      var s = by[id];
      if (!s) return;
      if (s.rank == null) { state[id] = "trap"; return; }
      if (s.flex) { state[id] = "ok"; return; }
      state[id] = s.rank < maxRank ? "late" : "ok";
      if (s.rank > maxRank) maxRank = s.rank;
    });
    var items = steps.map(function (s) {
      var st = state[s.id] || (s.rank == null ? "skipped" : "missed");
      return { id: s.id, state: st, pos: pos[s.id] != null ? pos[s.id] : null };
    });
    var ok = items.every(function (x) { return x.state === "ok" || x.state === "skipped"; });
    return { ok: ok, items: items, right: items.filter(function (x) { return x.state === "ok" || x.state === "skipped"; }).length };
  }

  var STR = {
    homeH: T("Before your first real ventilator", "पहले असली ventilator से पहले"),
    homeNote: T("For the ward at night. You look, check and call; you do not change settings alone.", "रात के ward के लिए। आप देखते, जाँचते और call करते हैं; अकेले settings नहीं बदलते।"),
    bed: T("Walk up to the bed", "Bed तक जाएँ"), bedSub: T("Your first five minutes with a ventilated patient", "Ventilated मरीज़ के साथ आपके पहले पाँच मिनट"),
    screen: T("Reading a real ventilator screen", "असली ventilator screen पढ़ना"), screenSub: T("SET by you, MEASURED by the machine", "SET आप करते हैं, MEASURED machine करती है"),
    modes: T("Mode names you will meet", "Mode के नाम जो आप देखेंगे"), modesSub: T("Read only. Know the name, do not change it", "सिर्फ़ पढ़ने के लिए। नाम जानें, बदलें नहीं"),
    drills: T("3 am drill", "रात 3 बजे की drill"), drillsSub: T("Put the steps in order, then check", "Steps को क्रम में रखें, फिर जाँचें"),
    never: T("Never change settings alone on day one", "पहले दिन कभी अकेले settings न बदलें"), neverSub: T("What you may do, and when to call", "आप क्या कर सकते हैं, और कब call करें"),
    backLab: T("Back to the lab", "लैब पर वापस"), backDrills: T("Back to the drills", "drills पर वापस"),
    loading: T("Loading…", "लोड हो रहा है…"), loadErr: T("This part did not load. Check your connection and try again.", "यह हिस्सा लोड नहीं हुआ। कनेक्शन जांचें और फिर कोशिश करें।"), retry: T("Try again", "फिर कोशिश करें"),
    nOfM: T("{n} of {m} checked", "{m} में से {n} जाँचे"), clear: T("Clear the ticks", "सारे tick हटाएँ"),
    allDone: T("All checked", "सब जाँच लिया"),
    set: T("SET", "SET"), meas: T("MEASURED", "MEASURED"), setL: T("Set by you", "आप set करते हैं"), measL: T("Measured by the machine", "Machine मापती है"),
    styleH: T("Panel style", "Panel style"), legendSet: T("your orders, on the keys", "आपके आदेश, keys पर"), legendMeas: T("what happened, beside the waves", "जो हुआ, waves के पास"),
    tapHint: T("Tap any number on the panel to learn it.", "Panel पर किसी भी number को सीखने के लिए tap करें।"),
    opened: T("{n} of {m} numbers learned", "{m} में से {n} numbers सीखे"),
    tileAria: T("{x} {v}, {k}. Learn it", "{x} {v}, {k}। सीखें"),
    panelAria: T("A generic ventilator screen, {x}. Set values on the keys at the bottom, measured values beside the waveforms.", "एक generic ventilator screen, {x}। Set values नीचे keys पर, measured values waveforms के पास।"),
    whatH: T("What it is", "यह क्या है"), watchH: T("What to watch", "किस पर ध्यान दें"),
    waves: T("Pressure and flow", "Pressure और flow"),
    labelsH: T("Label names by brand", "Brand के अनुसार label नाम"),
    quizH: T("Quick check: set or measured?", "जल्दी जाँच: set या measured?"), qOf: T("Question {i} of {n}", "{n} में से प्रश्न {i}"),
    right: T("Right", "सही"), wrong: T("Not quite", "पूरी तरह सही नहीं"), nextQ: T("Next question", "अगला प्रश्न"),
    score: T("{n} of {m} right", "{m} में से {n} सही"), again: T("Try again", "फिर से करें"), best: T("Best {n} of {m}", "सबसे अच्छा {m} में से {n}"),
    closest: T("Closest in the lab", "Lab में सबसे नज़दीक"),
    yourOrder: T("Your order", "आपका क्रम"), pool: T("Steps", "Steps"), pickHint: T("Tap the steps in the order you would do them. Leave out anything you should not do.", "Steps को उसी क्रम में tap करें जिसमें आप करेंगे। जो नहीं करना चाहिए उसे छोड़ दें।"),
    empty: T("Nothing yet. Tap the first thing you would do.", "अभी कुछ नहीं। जो पहले करेंगे उसे tap करें।"),
    undo: T("Undo last", "पिछला हटाएँ"), check: T("Check my order", "मेरा क्रम जाँचें"),
    addAria: T("Add: {x}", "जोड़ें: {x}"), stepN: T("Step {n}", "Step {n}"),
    st_ok: T("In order", "सही क्रम"), st_late: T("This comes earlier", "यह पहले आता है"), st_trap: T("Leave this out", "इसे छोड़ दें"),
    st_missed: T("You left this out", "यह छूट गया"), st_skipped: T("Rightly left out", "सही छोड़ा"),
    allRight: T("Safe order. This is what you do at 3 am.", "सुरक्षित क्रम। रात 3 बजे यही करना है।"),
    someWrong: T("{n} of {m} right. Read why, then try again.", "{m} में से {n} सही। कारण पढ़ें, फिर दोबारा करें।"),
    sbarH: T("What to say to your senior (SBAR)", "Senior से क्या कहें (SBAR)"),
    nextDrill: T("Next drill", "अगली drill"), done: T("Done", "पूरा"),
    neverRow: T("Never change settings alone on day one", "पहले दिन कभी अकेले settings न बदलें"),
    mayH: T("You may", "आप कर सकते हैं"), mayNotH: T("Not alone, call first", "अकेले नहीं, पहले call करें"), callH: T("Call your senior now if", "Senior को अभी call करें अगर"),
    toDrills: T("Practise the 3 am drill", "रात 3 बजे की drill का अभ्यास करें"),
    drillsDone: T("{n} of {m} drills safe", "{m} में से {n} drills सुरक्षित"),
    alarm: T("Alarm", "Alarm"), modeL: T("Mode", "मोड"), bedS: T("First five minutes", "पहले पाँच मिनट"),
    safeOrder: T("The safe order, and why", "सुरक्षित क्रम, और क्यों"),
    screenT: T("Real ventilator screen", "असली ventilator screen"), screenS: T("SET vs MEASURED", "SET बनाम MEASURED"),
    neverT: T("Never alone on day one", "पहले दिन अकेले नहीं"), modesT: T("Mode names", "Mode के नाम")
  };
  var PURE = { STR: STR, verdict: verdict, order: order };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  G.NARKE_VENT_BRIDGE = PURE;

  /* ================= browser ================= */
  var host = G.NARKE;
  if (!host || !host._internal || !host._ventLab || !G.document) return;
  var I = host._internal, st = host._st, esc = I.esc, A = I.ACTIONS;
  var PK = "smd_narke_vbridge", B = { data: null, ready: null, err: null, p: null };

  function L() { return I.lang(); }
  function t(o) { return o == null ? "" : typeof o === "string" ? o : (o[L()] || o.en || ""); }
  function tx(o) { return o == null ? "" : typeof o === "string" ? esc(o) : I.tx(o); }
  function s(key, v) { return esc(t(STR[key])).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
  function ico(n) { return I.ico(n) || ""; }
  function reduced() { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function base() { return G.SMD_NARKE_VENT_BASE || I.BASE + "vent/"; }
  function load() {
    if (B.data) return Promise.resolve(B.data);
    if (B.ready) return B.ready;
    B.err = null;
    B.ready = G.fetch(base() + "bridge.json").then(function (r) { if (!r.ok) throw new Error("bridge " + r.status); return r.json(); })
      .then(function (d) { B.data = d; return d; }, function (e) { B.ready = null; B.err = e; throw e; });
    return B.ready;
  }
  function prefs() {
    if (B.p) return B.p;
    var o = null;
    try { o = JSON.parse(I.ls().getItem(PK)); } catch (e) {}
    B.p = o && typeof o === "object" ? o : {};
    ["bed", "tiles", "drills"].forEach(function (k) { if (!B.p[k] || typeof B.p[k] !== "object") B.p[k] = {}; });
    return B.p;
  }
  function save() { try { I.ls().setItem(PK, JSON.stringify(B.p)); } catch (e) {} }
  function D() { return B.data || {}; }
  function q(sel) { var r = I.root(); return r ? r.querySelector(sel) : null; }
  function focus(sel) { var el = q(sel); try { if (el) el.focus({ preventScroll: false }); } catch (e) {} }
  function foot() {
    var d = D();
    return '<p class="vl-disc vl-disc-end vb-review" role="note"><span>' + tx(d.reviewNote) + "</span></p>";
  }
  function bedItems() { var o = []; ((D().bed || {}).groups || []).forEach(function (g) { (g.items || []).forEach(function (x) { o.push(x); }); }); return o; }
  function nBed() { var b = prefs().bed; return bedItems().filter(function (x) { return b[x.id]; }).length; }
  function drillList() { return ((D().drills || {}).items) || []; }

  /* ---------- lab home rows ---------- */
  function homeBlock() {
    if (!B.data && !B.ready && !B.err) load().then(null, function () {});
    var d = D(), p = prefs(), bi = bedItems(), tl = ((d.screen || {}).tiles || []), dl = drillList();
    var nT = tl.filter(function (x) { return p.tiles[x.id]; }).length, nD = dl.filter(function (x) { return p.drills[x.id]; }).length;
    function line(n, m, key) { return m && n ? s(key, { n: I.fmt(n), m: I.fmt(m) }) : ""; }
    var rows = I.row("vbopen", ' data-k="bed"', I.tile("steth"), s("bed"), s("bedSub"), line(nBed(), bi.length, "nOfM")) +
      I.row("vbopen", ' data-k="screen"', I.tile("device"), s("screen"), s("screenSub"), line(nT, tl.length, "opened")) +
      I.row("vbopen", ' data-k="modes"', I.tile("list"), s("modes"), s("modesSub"), "") +
      I.row("vbopen", ' data-k="drills"', I.tile("siren"), s("drills"), s("drillsSub"), line(nD, dl.length, "drillsDone")) +
      I.row("vbopen", ' data-k="never"', I.tile("shield"), s("never"), s("neverSub"), "");
    return '<h2 class="sp-h2" id="vbHomeH">' + s("homeH") + '</h2><p class="vl-lvintro vb-homenote">' + s("homeNote") + '</p><ul class="sp-rows vb-rows" aria-labelledby="vbHomeH">' + rows + "</ul>";
  }
  G.NARKE_VENT_BRIDGE.homeBlock = homeBlock;

  function toLab(k) {
    host._ventLab.open();
    if (k) focus('[data-act=vbopen][data-k="' + k + '"]');
  }
  // Each screen: leave the old one, set view, back and repaint; wait for the content first.
  // back: the row key on the lab home that focus returns to.
  function screen(view, again, back, title, sub, body, focusSel) {
    I.leave();
    st.view = view; st.again = again;
    st.onBack = function () { toLab(back); return true; };
    I.paint(I.top(t(STR.backLab), title, sub, I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col vb-wrap">' + body + "</div></div>", typeof focusSel === "string" ? focusSel : null);
  }
  function withData(view, again, title, sub, render) {
    if (B.data) return render();
    screen(view, again, view.slice(3), title, sub, B.err ? '<div class="sp-err" role="alert"><p>' + s("loadErr") + '</p><button type="button" class="sp-btn pri" data-act="vbretry">' + ico("refresh") + " " + s("retry") + "</button></div>"
      : '<div class="sp-loading" aria-busy="true"><span class="sp-sk sp-sk-a"></span><span class="sp-sk sp-sk-b"></span><span class="sp-sk sp-sk-c"></span><span class="sp-sr" role="status">' + s("loading") + "</span></div>", B.err ? "[data-act=vbretry]" : null);
    if (!B.err) load().then(function () { if (st.view === view) again(); }, function () { if (st.view === view) again(); });
  }
  A.vbretry = function () { B.err = null; if (st.again) st.again(); };
  var OPEN = {};
  A.vbopen = function (b) { var k = b.getAttribute("data-k"); if (OPEN[k]) OPEN[k](); };

  /* ---------- walk up to the bed ---------- */
  function bedProg() {
    var n = nBed(), m = bedItems().length;
    return '<div class="vb-prog"><p class="vb-prog-t" id="vbProgT" aria-live="polite">' + (n === m && m ? s("allDone") : s("nOfM", { n: I.fmt(n), m: I.fmt(m) })) + "</p>" +
      '<span class="vb-bar" aria-hidden="true"><i style="transform:scaleX(' + (m ? (n / m).toFixed(3) : 0) + ')"></i></span></div>';
  }
  function bed(focusSel) {
    withData("vb-bed", bed, s("bed"), s("bedS"), function () {
      var d = D().bed || {}, p = prefs().bed;
      var groups = (d.groups || []).map(function (g, gi) {
        return '<h2 class="sp-h2 vb-gh" id="vbG' + gi + '">' + tx(g.title) + '</h2><ul class="vb-chks" aria-labelledby="vbG' + gi + '">' + (g.items || []).map(function (x) {
          var on = !!p[x.id];
          return '<li><button type="button" class="vb-chk" data-act="vbchk" data-k="' + esc(x.id) + '" aria-pressed="' + on + '">' +
            '<span class="vb-box" aria-hidden="true">' + ico("check") + '</span><span class="vb-chk-b"><b>' + tx(x.label) + "</b><span>" + tx(x.why) + "</span></span></button></li>";
        }).join("") + "</ul>";
      }).join("");
      var all = nBed() === bedItems().length;
      screen("vb-bed", bed, "bed", s("bed"), s("bedS"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + "</p>" + bedProg() + groups +
        '<div class="vl-card vb-done' + (all ? " on" : "") + '" id="vbBedDone" role="status"' + (all ? "" : " hidden") + "><p>" + (ico("check") ? '<span aria-hidden="true">' + ico("check") + "</span>" : "") + "<span>" + tx(d.done) + "</span></p></div>" +
        '<button type="button" class="sp-btn sec vb-clear" data-act="vbclear">' + s("clear") + "</button>" + foot(), focusSel);
    });
  }
  OPEN.bed = function () { bed(); };
  A.vbchk = function (b) {
    var k = b.getAttribute("data-k"), p = prefs().bed, on = !p[k];
    if (on) p[k] = 1; else delete p[k];
    save();
    b.setAttribute("aria-pressed", String(on));
    var pr = q(".vb-prog"), n = nBed(), m = bedItems().length;
    if (pr) { pr.querySelector("#vbProgT").textContent = n === m ? t(STR.allDone) : t(STR.nOfM).replace("{n}", I.fmt(n)).replace("{m}", I.fmt(m)); pr.querySelector(".vb-bar i").style.transform = "scaleX(" + (n / m).toFixed(3) + ")"; }
    var dn = q("#vbBedDone");
    if (dn) { if (n === m) { dn.hidden = false; G.requestAnimationFrame(function () { dn.classList.add("on"); }); if (on) I.haptic("success"); } else { dn.classList.remove("on"); dn.hidden = true; } }
  };
  A.vbclear = function () { prefs().bed = {}; save(); bed(".vb-chk"); };

  /* ---------- reading a real ventilator screen ---------- */
  var SC = { style: "drager", sel: null, qi: 0, ans: null, right: 0, fin: false };
  var MEAS_ORDER = ["ppeak", "pplat", "peepm", "vte", "vti", "mve", "ftot"], SET_ORDER = ["vtset", "fset", "peepset", "fio2", "ie"];
  function tile(x) {
    if (!x) return "";
    var lab = tlab(x), val = tval(x), learned = prefs().tiles[x.id];
    var kind = x.kind === "set" ? "set" : "meas";
    return '<button type="button" class="vb-t vb-' + kind + (learned ? " seen" : "") + '" data-act="vbtile" data-k="' + esc(x.id) + '" aria-pressed="' + (SC.sel === x.id) + '"' +
      ' aria-label="' + esc(t(STR.tileAria).replace("{x}", lab + (x.labels && x.id !== "mode" && x.labels.generic !== lab ? " (" + x.labels.generic + ")" : "")).replace("{v}", val + (x.unit ? " " + x.unit : "")).replace("{k}", t(x.kind === "set" ? STR.setL : STR.measL))) + '">' +
      '<span class="vb-tl" translate="no">' + esc(lab) + '</span><span class="vb-tv">' + esc(val) + (x.unit ? '<i>' + esc(x.unit) + "</i>" : "") + "</span></button>";
  }
  // The mode key reads "Mode" with the brand's mode name as its value; every other number keeps its value.
  function tlab(x) { return x.id === "mode" ? t(STR.modeL) : (x.labels && (x.labels[SC.style] || x.labels.generic)) || ""; }
  function tval(x) { return x.id === "mode" ? (x.labels && x.labels[SC.style]) || x.value : x.value; }
  function tiles() { var o = {}; ((D().screen || {}).tiles || []).forEach(function (x) { o[x.id] = x; }); return o; }
  function waveSvg() {
    // Decorative square-flow volume breaths: pressure (rise, peak, plateau) and flow (square in, decaying out).
    var p = "M0 46", f = "M0 30", x, i;
    for (i = 0; i < 3; i++) {
      x = i * 80;
      p += "L" + (x + 4) + " 46L" + (x + 8) + " 22L" + (x + 22) + " 10L" + (x + 25) + " 18L" + (x + 30) + " 18L" + (x + 33) + " 46L" + (x + 80) + " 46";
      f += "L" + (x + 4) + " 30L" + (x + 5) + " 14L" + (x + 25) + " 14L" + (x + 26) + " 30L" + (x + 33) + " 30L" + (x + 34) + " 52Q" + (x + 44) + " 33 " + (x + 66) + " 30L" + (x + 80) + " 30";
    }
    return '<svg class="vb-wv" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="vb-wp" d="' + p + '"/></svg>' +
      '<svg class="vb-wv" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line class="vb-wz" x1="0" x2="240" y1="30" y2="30"/><path class="vb-wf" d="' + f + '"/></svg>';
  }
  function panel() {
    var tl = tiles(), st0 = ((D().screen || {}).styles || []).filter(function (x) { return x.id === SC.style; })[0];
    return '<figure class="vl-plate vb-panel vb-L-' + esc(SC.style) + '" role="group" aria-label="' + esc(t(STR.panelAria).replace("{x}", st0 ? t(st0.name) : "")) + '">' +
      '<div class="vb-top">' + tile(tl.mode) + '<span class="vb-pt" aria-hidden="true">' + s("waves") + "</span></div>" +
      '<div class="vb-waves" aria-hidden="true">' + waveSvg() + "</div>" +
      '<div class="vb-mcol">' + MEAS_ORDER.map(function (k) { return tile(tl[k]); }).join("") + "</div>" +
      '<div class="vb-setrow">' + SET_ORDER.map(function (k) { return tile(tl[k]); }).join("") + "</div></figure>";
  }
  function infoHtml() {
    var x = SC.sel && tiles()[SC.sel];
    if (!x) return '<p class="vb-hint">' + s("tapHint") + "</p>";
    var lab = tlab(x);
    return '<div class="vb-info-h"><b>' + tx(x.name) + '</b><span class="vb-kind vb-' + (x.kind === "set" ? "set" : "meas") + '">' + s(x.kind === "set" ? "set" : "meas") + "</span></div>" +
      '<p class="vb-info-l">' + esc(lab) + " " + esc(tval(x)) + (x.unit ? " " + esc(x.unit) : "") + " · " + s(x.kind === "set" ? "setL" : "measL") + "</p>" +
      '<h3 class="vl-h3">' + s("whatH") + "</h3><p>" + tx(x.what) + '</p><h3 class="vl-h3">' + s("watchH") + "</h3><p>" + tx(x.watch) + "</p>";
  }
  function openedLine() { var tl = (D().screen || {}).tiles || [], p = prefs().tiles; return s("opened", { n: I.fmt(tl.filter(function (x) { return p[x.id]; }).length), m: I.fmt(tl.length) }); }
  function quizHtml() {
    var qs = (D().screen || {}).quiz || [], n = qs.length;
    if (!n) return "";
    if (SC.fin) {
      var best = prefs().quizBest || 0;
      return '<div class="vb-qend"><p class="sp-verdict ' + (SC.right === n ? "ok" : "bad") + ' vb-qscore" tabindex="-1">' + (ico(SC.right === n ? "check" : "info") || "") + "<span>" + s("score", { n: I.fmt(SC.right), m: I.fmt(n) }) + "</span></p>" +
        '<p class="sp-small">' + s("best", { n: I.fmt(best), m: I.fmt(n) }) + '</p><button type="button" class="sp-btn sec" data-act="vbqagain">' + s("again") + "</button></div>";
    }
    var Q = qs[SC.qi], ans = SC.ans;
    var opts = '<div class="sp-answers' + (ans != null ? " done" : "") + '" role="group" aria-labelledby="vbQ">' + (Q.options || []).map(function (o, j) {
      var state = ans == null ? "" : j === Q.answer ? "right" : j === ans ? "wrong" : "dim";
      return '<button type="button" class="sp-ans" data-act="vbqans" data-o="' + j + '"' + (state ? ' data-state="' + state + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + (state === "right" ? ico("check") || "A" : state === "wrong" ? ico("close") || "x" : "ABCD".charAt(j)) + "</span>" + tx(o) + "</button>";
    }).join("") + "</div>";
    var rev = ans == null ? "" : '<p class="sp-verdict vb-qv ' + (ans === Q.answer ? "ok" : "bad") + '" tabindex="-1">' + (ico(ans === Q.answer ? "check" : "close") || "") + "<span>" + s(ans === Q.answer ? "right" : "wrong") + '</span></p><p class="vb-why">' + tx(Q.why) + "</p>" +
      '<button type="button" class="sp-btn pri vb-qnext" data-act="vbqnext">' + s(SC.qi < n - 1 ? "nextQ" : "done") + "</button>";
    return '<p class="sp-small vb-qof">' + s("qOf", { i: I.fmt(SC.qi + 1), n: I.fmt(n) }) + '</p><h3 class="sp-h3 vl-q" id="vbQ">' + tx(Q.q) + "</h3>" + opts + rev;
  }
  function labelsHtml() {
    var sc = D().screen || {}, st0 = sc.styles || [];
    return '<details class="vl-card vb-labels"><summary>' + s("labelsH") + "</summary>" +
      '<ul class="vb-lrows">' + (sc.labelRows || []).map(function (r) {
        return '<li><b>' + tx(r.term) + "</b><dl>" + st0.map(function (x) { return "<div><dt>" + tx(x.name) + "</dt><dd translate=\"no\">" + esc(r[x.id] || "") + "</dd></div>"; }).join("") + "</dl></li>";
      }).join("") + "</ul></details>";
  }
  function scr(focusSel) {
    withData("vb-screen", scr, s("screenT"), s("screenS"), function () {
      var sc = D().screen || {};
      var seg = '<div class="sp-seg vb-styles" role="group" aria-label="' + s("styleH") + '">' + (sc.styles || []).map(function (x) {
        return '<button type="button" data-act="vbstyle" data-v="' + esc(x.id) + '" aria-pressed="' + (x.id === SC.style) + '">' + tx(x.name) + "</button>";
      }).join("") + "</div>";
      screen("vb-screen", scr, "screen", s("screenT"), s("screenS"),
        '<p class="vl-lede vb-lede">' + tx(sc.intro) + "</p>" + seg +
        '<p class="vb-legend"><span><span class="vb-kind vb-set">' + s("set") + "</span> " + s("legendSet") + '</span><span><span class="vb-kind vb-meas">' + s("meas") + "</span> " + s("legendMeas") + "</span></p>" +
        '<div id="vbPanel">' + panel() + "</div>" +
        '<div class="vl-card vb-info" id="vbInfo" aria-live="polite">' + infoHtml() + "</div>" +
        '<p class="sp-small vb-opened" id="vbOpened">' + openedLine() + "</p>" +
        labelsHtml() + '<p class="vb-brand">' + tx(D().brandNote) + "</p>" +
        '<h2 class="sp-h2">' + s("quizH") + '</h2><div class="vb-quiz" id="vbQuiz">' + quizHtml() + "</div>" + foot(), focusSel);
    });
  }
  OPEN.screen = function () { SC.sel = null; SC.qi = 0; SC.ans = null; SC.right = 0; SC.fin = false; scr(); };
  A.vbstyle = function (b) {
    var v = b.getAttribute("data-v");
    if (v === SC.style) return;
    SC.style = v;
    [].forEach.call(I.root().querySelectorAll("[data-act=vbstyle]"), function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-v") === v)); });
    var pn = q("#vbPanel"), inf = q("#vbInfo");
    if (pn) pn.innerHTML = panel();
    if (inf) inf.innerHTML = infoHtml();
  };
  A.vbtile = function (b) {
    var k = b.getAttribute("data-k");
    SC.sel = k; prefs().tiles[k] = 1; save();
    [].forEach.call(I.root().querySelectorAll("[data-act=vbtile]"), function (x) { var on = x.getAttribute("data-k") === k; x.setAttribute("aria-pressed", String(on)); if (on) x.classList.add("seen"); });
    var inf = q("#vbInfo"), op = q("#vbOpened");
    if (inf) {
      inf.innerHTML = infoHtml();
      if (!reduced()) { inf.classList.remove("vb-in"); void inf.offsetWidth; inf.classList.add("vb-in"); }
      // Keep the explanation in view on a phone without moving the panel the finger is on.
      var sc = q(".sp-scroll");
      if (sc) { var r = inf.getBoundingClientRect(), bb = sc.getBoundingClientRect(); if (r.top > bb.bottom - 80) try { sc.scrollTo({ top: sc.scrollTop + r.top - bb.bottom + Math.min(r.height, bb.height * 0.45), behavior: reduced() ? "auto" : "smooth" }); } catch (e) {} }
    }
    if (op) op.innerHTML = openedLine();
  };
  function repaintQuiz(focusSel) { var el = q("#vbQuiz"); if (!el) return; el.innerHTML = quizHtml(); if (focusSel) focus("#vbQuiz " + focusSel); }
  A.vbqans = function (b) {
    if (SC.ans != null) return;
    var Q = ((D().screen || {}).quiz || [])[SC.qi], j = +b.getAttribute("data-o"), ok = Q && j === Q.answer;
    SC.ans = j; if (ok) SC.right++;
    I.haptic(ok ? "success" : "error");
    repaintQuiz(".vb-qv");
  };
  A.vbqnext = function () {
    var n = ((D().screen || {}).quiz || []).length;
    if (SC.qi < n - 1) { SC.qi++; SC.ans = null; repaintQuiz(".sp-ans"); return; }
    SC.fin = true;
    if (SC.right > (prefs().quizBest || 0)) { prefs().quizBest = SC.right; save(); }
    repaintQuiz(".vb-qscore");
  };
  A.vbqagain = function () { SC.qi = 0; SC.ans = null; SC.right = 0; SC.fin = false; repaintQuiz(".sp-ans"); };

  /* ---------- mode names ---------- */
  function engMode(m) {
    var e = (G.NARKE_MODELS || {})["vent-engine"], x = e && e.MODES && e.MODES[m];
    return x && x.title ? tx(x.title) : esc(String(m).toUpperCase());
  }
  function modes(focusSel) {
    withData("vb-modes", modes, s("modesT"), s("modesSub"), function () {
      var d = D().modes || {};
      screen("vb-modes", modes, "modes", s("modesT"), s("modesSub"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + '</p><ul class="vb-modes">' + (d.items || []).map(function (x) {
          var labs = [].concat(x.lab || []);
          return '<li class="vl-card vb-mode"><h2 class="vb-mn" translate="no">' + esc(x.names) + "</h2><p>" + tx(x.plain) + "</p>" +
            '<p class="vb-ml"><span>' + s("closest") + ":</span> " + labs.map(engMode).join(", ") + "</p>" +
            '<p class="vb-never"><span aria-hidden="true">' + ico("lock") + "</span>" + tx(d.never) + "</p></li>";
        }).join("") + "</ul>" + foot(), focusSel);
    });
  }
  OPEN.modes = function () { modes(); };

  /* ---------- 3 am drill ---------- */
  var DR = { id: null, picked: [], res: null };
  function drills(focusSel) {
    withData("vb-drills", drills, s("drills"), s("drillsSub"), function () {
      var d = D().drills || {}, p = prefs().drills;
      var rows = I.row("vbopen", ' data-k="never"', I.tile("shield"), s("neverRow"), s("neverSub"), "") + drillList().map(function (x) {
        return I.row("vbdrill", ' data-k="' + esc(x.id) + '"', I.tile("siren"), tx(x.title), tx(x.scene), p[x.id] ? '<span class="vl-solved">' + ico("check") + s("done") + "</span>" : "");
      }).join("");
      screen("vb-drills", drills, "drills", s("drills"), s("drillsSub"), '<p class="vl-lede vb-lede">' + tx(d.intro) + '</p><ul class="sp-rows vb-drows">' + rows + "</ul>" + foot(), focusSel);
    });
  }
  OPEN.drills = function () { drills(); };
  function curDrill() { return drillList().filter(function (x) { return x.id === DR.id; })[0] || null; }
  function stepBy(dr, id) { return (dr.steps || []).filter(function (x) { return x.id === id; })[0]; }
  function backDrills() { var id = DR.id; drills('[data-act=vbdrill][data-k="' + id + '"]'); }
  function drill(focusSel) {
    var dr = curDrill();
    if (!dr) return drills();
    var pool = order(dr.steps || [], dr.id).filter(function (x) { return DR.picked.indexOf(x.id) < 0; }), res = DR.res, body;
    var head = '<div class="vl-acard danger vb-scene"><p class="vb-scene-h"><span aria-hidden="true">' + ico("siren") + "</span><b>" + tx(dr.title) + "</b></p><p>" + tx(dr.scene) + "</p></div>";
    if (!res) {
      var ord = DR.picked.length ? '<ol class="vb-ord">' + DR.picked.map(function (id, i) { return '<li><span class="vb-n" aria-hidden="true">' + (i + 1) + "</span><span>" + tx(stepBy(dr, id).text) + "</span></li>"; }).join("") + "</ol>"
        : '<p class="vb-empty">' + s("empty") + "</p>";
      body = '<p class="vb-pick">' + s("pickHint") + '</p><h2 class="sp-h2" id="vbOrdH">' + s("yourOrder") + '</h2><div class="vb-ordw" aria-labelledby="vbOrdH" aria-live="polite">' + ord + "</div>" +
        (pool.length ? '<h2 class="sp-h2" id="vbPoolH">' + s("pool") + '</h2><ul class="vb-pool" aria-labelledby="vbPoolH">' + pool.map(function (x) {
          return '<li><button type="button" class="vb-step" data-act="vbpick" data-k="' + esc(x.id) + '" aria-label="' + esc(t(STR.addAria).replace("{x}", t(x.text))) + '"><span class="vb-plus" aria-hidden="true">' + ico("plus") + "</span><span>" + tx(x.text) + "</span></button></li>";
        }).join("") + "</ul>" : "");
    } else {
      var m = res.items.length;
      body = '<p class="sp-verdict ' + (res.ok ? "ok" : "bad") + ' vb-dv" tabindex="-1">' + (ico(res.ok ? "check" : "info") || "") + "<span>" + (res.ok ? s("allRight") : s("someWrong", { n: I.fmt(res.right), m: I.fmt(m) })) + "</span></p>" +
        '<h2 class="sp-h2">' + s("safeOrder") + '</h2><ol class="vb-res">' + res.items.map(function (it) {
          var x = stepBy(dr, it.id);
          return '<li class="vb-r ' + it.state + '"><span class="vb-r-i" aria-hidden="true">' + ico(it.state === "ok" || it.state === "skipped" ? "check" : "close") + '</span><div><p class="vb-r-s">' + s("st_" + it.state) + (it.pos != null ? " · " + s("stepN", { n: it.pos + 1 }) : "") + "</p>" +
            "<p><b>" + tx(x.text) + '</b></p><p class="vb-why">' + tx(x.why) + "</p></div></li>";
        }).join("") + "</ol>" +
        '<div class="vl-card vb-sbar"><h2 class="sp-h2">' + s("sbarH") + "</h2><dl>" + ["s", "b", "a", "r"].map(function (k) {
          return '<div><dt><span class="vb-sb">' + k.toUpperCase() + "</span></dt><dd>" + tx((dr.sbar || {})[k]) + "</dd></div>";
        }).join("") + "</dl></div>";
    }
    var list = drillList(), i = list.indexOf(dr), footer;
    if (!res) footer = '<button type="button" class="sp-btn sec" data-act="vbundo"' + (DR.picked.length ? "" : ' disabled aria-disabled="true"') + ">" + s("undo") + '</button><button type="button" class="sp-btn pri" data-act="vbcheck"' + (DR.picked.length ? "" : ' disabled aria-disabled="true"') + ">" + s("check") + "</button>";
    else footer = '<button type="button" class="sp-btn sec" data-act="vbdagain">' + s("again") + "</button>" + (i < list.length - 1 ? '<button type="button" class="sp-btn pri" data-act="vbdnext">' + s("nextDrill") + "</button>" : '<button type="button" class="sp-btn pri" data-act="vbopen" data-k="never">' + s("neverRow") + "</button>");
    I.leave();
    st.view = "vb-drill"; st.again = drill;
    st.onBack = function () { backDrills(); return true; };
    I.paint(I.top(t(STR.backDrills), tx(dr.title), s("drills"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vb-wrap">' + head + body + foot() + "</div></div>" +
      '<div class="sp-foot vb-dfoot">' + footer + "</div>", typeof focusSel === "string" ? focusSel : null);
  }
  A.vbdrill = function (b) { DR.id = b.getAttribute("data-k"); DR.picked = []; DR.res = null; drill(); };
  A.vbpick = function (b) {
    var k = b.getAttribute("data-k");
    if (DR.res || DR.picked.indexOf(k) >= 0) return;
    DR.picked.push(k);
    drill(".vb-step, [data-act=vbcheck]");
  };
  A.vbundo = function () { if (DR.res || !DR.picked.length) return; DR.picked.pop(); drill(".vb-step"); };
  A.vbcheck = function () {
    var dr = curDrill();
    if (!dr || !DR.picked.length) return;
    DR.res = verdict(dr.steps || [], DR.picked);
    if (DR.res.ok) { prefs().drills[dr.id] = 1; save(); }
    I.haptic(DR.res.ok ? "success" : "error");
    drill(".vb-dv");
  };
  A.vbdagain = function () { DR.picked = []; DR.res = null; drill(".vb-step"); };
  A.vbdnext = function () { var l = drillList(), i = l.indexOf(curDrill()); if (i >= 0 && i < l.length - 1) { DR.id = l[i + 1].id; DR.picked = []; DR.res = null; drill(); } };

  /* ---------- never alone ---------- */
  function never(focusSel) {
    withData("vb-never", never, s("neverT"), s("neverSub"), function () {
      var d = D().never || {};
      function ul(arr, icon, cls) { return '<ul class="vb-list ' + cls + '">' + (arr || []).map(function (x) { return '<li><span aria-hidden="true">' + ico(icon) + "</span><span>" + tx(x) + "</span></li>"; }).join("") + "</ul>"; }
      screen("vb-never", never, "never", s("neverT"), s("neverSub"),
        '<section class="vl-card vb-nv"><h2 class="sp-h2">' + s("mayH") + "</h2>" + ul(d.may, "check", "ok") + "</section>" +
        '<section class="vl-card vb-nv"><h2 class="sp-h2">' + s("mayNotH") + "</h2>" + ul(d.mayNot, "lock", "no") + "</section>" +
        '<section class="vl-card vb-nv vb-call"><h2 class="sp-h2">' + s("callH") + "</h2>" + ul(d.callNow, "siren", "call") + "</section>" +
        '<section class="vl-card vb-sbar"><h2 class="sp-h2">' + tx(d.sbarH) + "</h2><dl>" + (d.sbar || []).map(function (x) {
          return '<div><dt><span class="vb-sb">' + esc(x.k) + "</span>" + tx(x.label) + "</dt><dd>" + tx(x.text) + "</dd></div>";
        }).join("") + "</dl></section>" +
        '<button type="button" class="sp-btn pri vb-todr" data-act="vbopen" data-k="drills">' + s("toDrills") + "</button>" + foot(), focusSel);
    });
  }
  OPEN.never = function () { never(); };

  load().then(null, function () {});
})(typeof window !== "undefined" ? window : this);
