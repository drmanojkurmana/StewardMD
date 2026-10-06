/* Narkē Ventilator Lab: the real-ventilator bridge. ES5. Loaded by narke-loader.js after narke-vent.js.
   Takes a junior doctor from the simulator to safely STARTING on a real ventilator under supervision:
   "Walk up to the bed" (first five minutes checklist), "Reading a real ventilator screen" (an interactive
   generic panel in three layout styles: SET vs MEASURED, the alarm bar, the keys on the frame (silence, hold,
   freeze, oxygen 100%) and the alarm limits page with sensible starting limits; tap anything to learn it;
   brand label names as text only; a set-or-measured quiz and a tap-the-number quiz across the three styles),
   "Mode names you will meet" (one plain line each, the closest lab modes, never change alone), "3 am drill"
   (put the alarm steps in order; feedback puts the learner's order next to the safe order; SBAR script),
   "Daily care checks" (sedation, head up, VAP bundle), "Handover to the next doctor" and "Never change
   settings alone on day one".
   Content: narke/vent/bridge.json (review: ai_drafted). The lab home lists these through
   NARKE_VENT_BRIDGE.homeBlock(level), the one hook in narke-vent.js. Back returns to the lab home.
   Node (tests): module.exports = { STR, verdict, order, safeOrder }. */
(function (G) {
  "use strict";
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure helpers ================= */
  // A seeded shuffle of the drill's step pool. The content lists steps in the safe order; the pool must not
  // give that away: no step in its own place and no two steps next to each other in their safe order.
  // The same seed always gives the same pool (stable within one attempt).
  function order(steps, seed) {
    var n = steps.length, h = 7, str = String(seed || ""), j;
    if (n < 2) return steps.slice();
    for (j = 0; j < str.length; j++) h = (h * 31 + str.charCodeAt(j)) % 2147483647;
    if (!h) h = 1;
    function rnd() { h = (h * 16807) % 2147483647; return (h - 1) / 2147483646; }
    var best = null, bestBad = Infinity;
    for (var t = 0; t < 400 && bestBad > 0; t++) {
      var a = steps.slice(), i, k, x, bad = 0;
      for (i = n - 1; i > 0; i--) { k = Math.floor(rnd() * (i + 1)); x = a[i]; a[i] = a[k]; a[k] = x; }
      for (i = 0; i < n; i++) {
        if (a[i] === steps[i]) bad++;
        if (i < n - 1 && steps.indexOf(a[i + 1]) === steps.indexOf(a[i]) + 1) bad++;
      }
      if (bad < bestBad) { best = a; bestBad = bad; }
    }
    return best;
  }
  function req(s) { return s.rank != null && !s.flex && !s.opt; }
  // The learner's order against the ranks. rank null = a trap (should be left out); flex = right at any point;
  // opt = right at any point and fine to leave out. A step is "late" when it comes after a step that belongs later
  // (only the later-placed one is marked); before = the first step it should have come before.
  // Returns {ok, items: [{id, state: ok|late|trap|missed|skipped|optional, pos, before?, opt?}], right, of, optMissed}
  // in the content's order. "optional" = an optional step left out: not wrong, and not counted in right / of.
  function verdict(steps, picked) {
    var by = {}, pos = {};
    steps.forEach(function (s) { by[s.id] = s; });
    picked.forEach(function (id, i) { pos[id] = i; });
    var maxRank = -1, state = {}, before = {};
    picked.forEach(function (id, i) {
      var s = by[id];
      if (!s) return;
      if (s.rank == null) { state[id] = "trap"; return; }
      if (s.flex || s.opt) { state[id] = "ok"; return; }
      if (s.rank < maxRank) {
        state[id] = "late";
        for (var j = 0; j < i; j++) { var e = by[picked[j]]; if (e && req(e) && e.rank > s.rank) { before[id] = e.id; break; } }
      } else state[id] = "ok";
      if (s.rank > maxRank) maxRank = s.rank;
    });
    var items = steps.map(function (s) {
      var st = state[s.id] || (s.rank == null ? "skipped" : s.opt ? "optional" : "missed");
      var o = { id: s.id, state: st, pos: pos[s.id] != null ? pos[s.id] : null };
      if (before[s.id]) o.before = before[s.id];
      if (s.opt) o.opt = true;
      return o;
    });
    var counted = items.filter(function (x) { return x.state !== "optional"; });
    var ok = items.every(function (x) { return x.state === "ok" || x.state === "skipped" || x.state === "optional"; });
    return { ok: ok, items: items, of: counted.length, optMissed: items.length - counted.length,
      right: counted.filter(function (x) { return x.state === "ok" || x.state === "skipped"; }).length };
  }
  // The safe order to show next to the learner's: required steps by rank (steps that share a rank share a
  // number: any order between them), then the any-time steps, the optional ones and the traps.
  // Returns [{id, n}] where n is a group number, "any", "opt" or "never".
  function safeOrder(steps) {
    var ranks = [];
    steps.forEach(function (s) { if (req(s) && ranks.indexOf(s.rank) < 0) ranks.push(s.rank); });
    ranks.sort(function (a, b) { return a - b; });
    var main = steps.filter(req).slice().sort(function (a, b) { return a.rank - b.rank; }).map(function (s) { return { id: s.id, n: ranks.indexOf(s.rank) + 1 }; });
    return main.concat(steps.filter(function (s) { return s.rank != null && s.flex && !s.opt; }).map(function (s) { return { id: s.id, n: "any" }; }),
      steps.filter(function (s) { return s.rank != null && s.opt; }).map(function (s) { return { id: s.id, n: "opt" }; }),
      steps.filter(function (s) { return s.rank == null; }).map(function (s) { return { id: s.id, n: "never" }; }));
  }

  var STR = {
    homeH: T("Before your first real ventilator", "पहले असली ventilator से पहले"),
    homeNote: T("For the ward at night. You look, check and call; you do not change settings alone.", "रात के ward के लिए। आप देखते, जाँचते और call करते हैं; अकेले settings नहीं बदलते।"),
    bed: T("Walk up to the bed", "Bed तक जाएँ"), bedSub: T("Your first five minutes with a ventilated patient", "Ventilated मरीज़ के साथ आपके पहले पाँच मिनट"),
    screen: T("Reading a real ventilator screen", "असली ventilator screen पढ़ना"), screenSub: T("SET vs MEASURED, alarms, silence and limits", "SET बनाम MEASURED, alarms, silence और limits"),
    modes: T("Mode names you will meet", "Mode के नाम जो आप देखेंगे"), modesSub: T("Read only. Know the name, do not change it", "सिर्फ़ पढ़ने के लिए। नाम जानें, बदलें नहीं"),
    drills: T("3 am drill", "रात 3 बजे की drill"), drillsSub: T("Put the steps in order, then check", "Steps को क्रम में रखें, फिर जाँचें"),
    care: T("Daily care checks", "रोज़ की care जाँच"), careSub: T("Sedation, head up and the VAP bundle", "Sedation, सिर ऊपर और VAP bundle"),
    hand: T("Handover to the next doctor", "अगले doctor को handover"), handSub: T("What to say about a ventilated patient", "Ventilated मरीज़ के बारे में क्या बताएँ"),
    never: T("Never change settings alone on day one", "पहले दिन कभी अकेले settings न बदलें"), neverSub: T("What you may do, and when to call", "आप क्या कर सकते हैं, और कब call करें"),
    backLab: T("Back to the lab", "Lab पर वापस"), backDrills: T("Back to the drills", "Drills पर वापस"), backScreen: T("Back to the screen map", "Screen map पर वापस"),
    loading: T("Loading…", "लोड हो रहा है…"), loadErr: T("This part did not load. Check your connection and try again.", "यह हिस्सा लोड नहीं हुआ। कनेक्शन जाँचें और फिर कोशिश करें।"), retry: T("Try again", "फिर कोशिश करें"),
    nOfM: T("{n} of {m} checked", "{m} में से {n} जाँचे"), clear: T("Clear the ticks", "सारे tick हटाएँ"),
    allDone: T("All checked", "सब जाँच लिया"),
    set: T("SET", "SET"), meas: T("MEASURED", "MEASURED"), kAlarm: T("ALARM", "ALARM"), kKey: T("KEY", "KEY"), kLim: T("LIMIT", "LIMIT"),
    setL: T("Set by you", "आप set करते हैं"), measL: T("Measured by the machine", "Machine मापती है"),
    alarmL: T("The alarm message", "Alarm का message"), keyL: T("A key on the machine", "Machine पर एक key"), limL: T("An alarm limit", "एक alarm limit"),
    qSet: T("set", "set"), qMeas: T("measured", "मापा"),
    rowSet: T("your orders", "आपके आदेश"), rowMeas: T("what happened", "जो हुआ"), rowKeys: T("Keys on the frame", "Frame पर keys"),
    styleH: T("Panel style", "Panel style"), pageH: T("Page", "Page"), pMain: T("Main screen", "Main screen"), pLim: T("Alarm limits page", "Alarm limits page"),
    legendSet: T("your orders, on the keys", "आपके आदेश, keys पर"), legendMeas: T("what happened, beside the waves", "जो हुआ, waves के पास"),
    limLow: T("Low", "Low"), limHigh: T("High", "High"), limNow: T("Now", "अभी"), limAlarm: T("Alarm", "Alarm"),
    limNote: T("Sensible starting limits for this patient. Your unit's policy first.", "इस मरीज़ के लिए समझदार शुरुआती limits। पहले आपके unit की policy।"),
    tapHint: T("Tap any number, the alarm bar or a key to learn it.", "सीखने के लिए किसी number, alarm bar या key पर tap करें।"),
    opened: T("{n} of {m} learned", "{m} में से {n} सीखे"),
    tileAria: T("{x} {v}, {k}. Learn it", "{x} {v}, {k}। सीखें"),
    panelAria: T("A generic ventilator screen, {x}: the alarm bar at the top, measured values beside the waveforms, set values on the keys at the bottom, keys on the frame below.", "एक generic ventilator screen, {x}: ऊपर alarm bar, waveforms के पास measured values, नीचे keys पर set values, उसके नीचे frame पर keys।"),
    whatH: T("What it is", "यह क्या है"), watchH: T("What to watch", "किस पर ध्यान दें"),
    labelsH: T("Label names by brand, trigger and I:E terms", "Brand के अनुसार label नाम, trigger और I:E शब्द"),
    quizH: T("Quick check: set or measured?", "जल्दी जाँच: set या measured?"), qOf: T("Question {i} of {n}", "{n} में से प्रश्न {i}"),
    right: T("Right", "सही"), wrong: T("Not quite", "पूरी तरह सही नहीं"), nextQ: T("Next question", "अगला प्रश्न"),
    score: T("{n} of {m} right", "{m} में से {n} सही"), again: T("Try again", "फिर से करें"), best: T("Best {n} of {m}", "सबसे अच्छा {m} में से {n}"),
    findH: T("Find it on the screen", "Screen पर ढूँढें"), findSub: T("Three panel styles, with limits", "तीन panel styles, limits के साथ"),
    findGo: T("Find it: tap-the-number quiz", "ढूँढें: number पर tap वाली quiz"), findWrong: T("Not that one. The right one is marked.", "यह नहीं। सही वाला चिह्नित है।"),
    closest: T("Closest in the lab", "Lab में सबसे नज़दीक"),
    yourOrder: T("Your order", "आपका क्रम"), pool: T("Steps", "Steps"), pickHint: T("Tap the steps in the order you would do them. Leave out anything you should not do.", "Steps को उसी क्रम में tap करें जिसमें आप करेंगे। जो नहीं करना चाहिए उसे छोड़ दें।"),
    empty: T("Nothing yet. Tap the first thing you would do.", "अभी कुछ नहीं। जो पहले करेंगे उसे tap करें।"),
    undo: T("Undo last", "पिछला हटाएँ"), check: T("Check my order", "मेरा क्रम जाँचें"),
    addAria: T("Add: {x}", "जोड़ें: {x}"), yourStep: T("your step {n}", "आपका step {n}"),
    st_ok: T("In a safe place", "सही जगह पर"), st_okAny: T("Right at any point", "किसी भी समय सही"), st_okOpt: T("Optional, and fine where you put it", "वैकल्पिक, और जहाँ रखा वहाँ ठीक"),
    st_late: T("Do this sooner: before “{x}”", "इसे पहले करें: “{x}” से पहले"), st_trap: T("Leave this out", "इसे छोड़ दें"),
    st_missed: T("Missing: this step is needed", "छूट गया: यह step ज़रूरी है"), st_skipped: T("Rightly left out", "सही छोड़ा"), st_optional: T("Optional: fine to leave out", "वैकल्पिक: छोड़ना ठीक है"),
    allRight: T("Safe order. This is what you do at 3 am.", "सुरक्षित क्रम। रात 3 बजे यही करना है।"),
    optLeft: T("Safe order. You left out an optional step: read why below.", "सुरक्षित क्रम। आपने एक वैकल्पिक step छोड़ा: नीचे कारण पढ़ें।"),
    someWrong: T("{n} of {m} right. Compare with the safe order, then try again.", "{m} में से {n} सही। सुरक्षित क्रम से मिलाएँ, फिर दोबारा करें।"),
    cmpAria: T("Your order next to the safe order", "आपका क्रम, सुरक्षित क्रम के साथ"),
    safeH: T("Safe order", "सुरक्षित क्रम"), sameNote: T("Same number: any order between them.", "एक जैसा number: उनके बीच कोई भी क्रम।"),
    g_any: T("Any time", "कभी भी"), g_opt: T("Optional", "वैकल्पिक"), g_never: T("Never", "कभी नहीं"),
    whyH: T("Why, step by step", "क्यों, step दर step"),
    sbarH: T("What to say to your senior (SBAR)", "Senior से क्या कहें (SBAR)"),
    nextDrill: T("Next drill", "अगली drill"), done: T("Done", "पूरा"),
    neverRow: T("Never change settings alone on day one", "पहले दिन कभी अकेले settings न बदलें"),
    mayH: T("You may", "आप कर सकते हैं"), mayNotH: T("Not alone, call first", "अकेले नहीं, पहले call करें"), callH: T("Call your senior now if", "Senior को अभी call करें अगर"),
    toDrills: T("Practise the 3 am drill", "रात 3 बजे की drill का अभ्यास करें"), toSilence: T("Practise: it keeps alarming", "अभ्यास: alarm बार बार बज रहा है"),
    drillsDone: T("{n} of {m} drills safe", "{m} में से {n} drill सुरक्षित"),
    alarm: T("Alarm", "Alarm"), modeL: T("Mode", "Mode"), bedS: T("First five minutes", "पहले पाँच मिनट"),
    safeOrder: T("The safe order, and why", "सुरक्षित क्रम, और क्यों"),
    screenT: T("Real ventilator screen", "असली ventilator screen"), screenS: T("SET, MEASURED, alarms and limits", "SET, MEASURED, alarms और limits"),
    neverT: T("Never alone on day one", "पहले दिन अकेले नहीं"), modesT: T("Mode names", "Mode के नाम"),
    careT: T("Daily care checks", "रोज़ की care जाँच"), handT: T("Handover", "Handover"), handS: T("To the next doctor", "अगले doctor को")
  };
  var PURE = { STR: STR, verdict: verdict, order: order, safeOrder: safeOrder };
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
    ["bed", "care", "tiles", "drills"].forEach(function (k) { if (!B.p[k] || typeof B.p[k] !== "object") B.p[k] = {}; });
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
  function ckItems(key) { var o = []; ((D()[key] || {}).groups || []).forEach(function (g) { (g.items || []).forEach(function (x) { o.push(x); }); }); return o; }
  function nCk(key) { var b = prefs()[key]; return ckItems(key).filter(function (x) { return b[x.id]; }).length; }
  function drillList() { return ((D().drills || {}).items) || []; }

  /* ---------- lab home rows ---------- */
  function homeBlock() {
    if (!B.data && !B.ready && !B.err) load().then(null, function () {});
    var d = D(), p = prefs(), tl = ((d.screen || {}).tiles || []), dl = drillList();
    var nT = tl.filter(function (x) { return p.tiles[x.id]; }).length, nD = dl.filter(function (x) { return p.drills[x.id]; }).length;
    function line(n, m, key) { return m && n ? s(key, { n: I.fmt(n), m: I.fmt(m) }) : ""; }
    var rows = I.row("vbopen", ' data-k="bed"', I.tile("steth"), s("bed"), s("bedSub"), line(nCk("bed"), ckItems("bed").length, "nOfM")) +
      I.row("vbopen", ' data-k="screen"', I.tile("device"), s("screen"), s("screenSub"), line(nT, tl.length, "opened")) +
      I.row("vbopen", ' data-k="modes"', I.tile("list"), s("modes"), s("modesSub"), "") +
      I.row("vbopen", ' data-k="drills"', I.tile("siren"), s("drills"), s("drillsSub"), line(nD, dl.length, "drillsDone")) +
      I.row("vbopen", ' data-k="care"', I.tile("rounds"), s("care"), s("careSub"), line(nCk("care"), ckItems("care").length, "nOfM")) +
      I.row("vbopen", ' data-k="hand"', I.tile("note"), s("hand"), s("handSub"), "") +
      I.row("vbopen", ' data-k="never"', I.tile("shield"), s("never"), s("neverSub"), "");
    return '<h2 class="sp-h2" id="vbHomeH">' + s("homeH") + '</h2><p class="vl-lvintro vb-homenote">' + s("homeNote") + '</p><ul class="sp-rows vb-rows" aria-labelledby="vbHomeH">' + rows + "</ul>";
  }
  G.NARKE_VENT_BRIDGE.homeBlock = homeBlock;

  function toLab(k) {
    host._ventLab.open();
    if (k) focus('[data-act=vbopen][data-k="' + k + '"]');
  }
  // Each screen: leave the old one, set view, back and repaint; wait for the content first.
  // back: the row key on the lab home that focus returns to, or a function for an inner back.
  function screen(view, again, back, title, sub, body, focusSel, backLabel) {
    I.leave();
    st.view = view; st.again = again;
    st.onBack = function () { if (typeof back === "function") back(); else toLab(back); return true; };
    I.paint(I.top(t(backLabel || STR.backLab), title, sub, I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col vb-wrap">' + body + "</div></div>", typeof focusSel === "string" ? focusSel : null);
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

  /* ---------- checklists: walk up to the bed, daily care ---------- */
  var CK = "bed";
  function ckProg() {
    var n = nCk(CK), m = ckItems(CK).length;
    return '<div class="vb-prog"><p class="vb-prog-t" id="vbProgT" aria-live="polite">' + (n === m && m ? s("allDone") : s("nOfM", { n: I.fmt(n), m: I.fmt(m) })) + "</p>" +
      '<span class="vb-bar" aria-hidden="true"><i style="transform:scaleX(' + (m ? (n / m).toFixed(3) : 0) + ')"></i></span></div>';
  }
  function checklist(key, title, sub, focusSel) {
    var view = "vb-" + key, again = function (f) { checklist(key, title, sub, f); };
    withData(view, again, title, sub, function () {
      CK = key;
      var d = D()[key] || {}, p = prefs()[key];
      var groups = (d.groups || []).map(function (g, gi) {
        return '<h2 class="sp-h2 vb-gh" id="vbG' + gi + '">' + tx(g.title) + '</h2><ul class="vb-chks" aria-labelledby="vbG' + gi + '">' + (g.items || []).map(function (x) {
          var on = !!p[x.id];
          return '<li><button type="button" class="vb-chk" data-act="vbchk" data-k="' + esc(x.id) + '" aria-pressed="' + on + '">' +
            '<span class="vb-box" aria-hidden="true">' + ico("check") + '</span><span class="vb-chk-b"><b>' + tx(x.label) + "</b><span>" + tx(x.why) + "</span></span></button></li>";
        }).join("") + "</ul>";
      }).join("");
      var all = nCk(key) === ckItems(key).length;
      screen(view, again, key, title, sub,
        '<p class="vl-lede vb-lede">' + tx(d.intro) + "</p>" + ckProg() + groups +
        '<div class="vl-card vb-done' + (all ? " on" : "") + '" id="vbBedDone" role="status"' + (all ? "" : " hidden") + "><p>" + (ico("check") ? '<span aria-hidden="true">' + ico("check") + "</span>" : "") + "<span>" + tx(d.done) + "</span></p></div>" +
        '<button type="button" class="sp-btn sec vb-clear" data-act="vbclear">' + s("clear") + "</button>" + foot(), focusSel);
    });
  }
  OPEN.bed = function () { checklist("bed", s("bed"), s("bedS")); };
  OPEN.care = function () { checklist("care", s("careT"), s("careSub")); };
  A.vbchk = function (b) {
    var k = b.getAttribute("data-k"), p = prefs()[CK], on = !p[k];
    if (on) p[k] = 1; else delete p[k];
    save();
    b.setAttribute("aria-pressed", String(on));
    var pr = q(".vb-prog"), n = nCk(CK), m = ckItems(CK).length;
    if (pr) { pr.querySelector("#vbProgT").textContent = n === m ? t(STR.allDone) : t(STR.nOfM).replace("{n}", I.fmt(n)).replace("{m}", I.fmt(m)); pr.querySelector(".vb-bar i").style.transform = "scaleX(" + (n / m).toFixed(3) + ")"; }
    var dn = q("#vbBedDone");
    if (dn) { if (n === m) { dn.hidden = false; G.requestAnimationFrame(function () { dn.classList.add("on"); }); if (on) I.haptic("success"); } else { dn.classList.remove("on"); dn.hidden = true; } }
  };
  A.vbclear = function () { prefs()[CK] = {}; save(); if (CK === "care") checklist("care", s("careT"), s("careSub"), ".vb-chk"); else checklist("bed", s("bed"), s("bedS"), ".vb-chk"); };

  /* ---------- reading a real ventilator screen ---------- */
  var SC = { style: "drager", page: "main", sel: null, qi: 0, ans: null, right: 0, fin: false };
  var MEAS_ORDER = ["ppeak", "pplat", "peepm", "vte", "vti", "mve", "ftot"], SET_ORDER = ["vtset", "fset", "peepset", "fio2", "ie"], KEY_ORDER = ["silence", "limits", "hold", "freeze", "o2"];
  var KIND = { set: "set", measured: "meas", alarm: "alm", key: "key", limit: "lim" };
  var KTAG = { set: "set", meas: "meas", alm: "kAlarm", key: "kKey", lim: "kLim" }, KLAB = { set: "setL", meas: "measL", alm: "alarmL", key: "keyL", lim: "limL" };
  function kindOf(x) { return KIND[x.kind] || "meas"; }
  function lab(x, style) { return x.id === "mode" ? t(STR.modeL) : x.id === "abar" ? t(STR.alarm) : (x.labels && (x.labels[style] || x.labels.generic)) || ""; }
  function val(x, style) { return x.id === "mode" || x.id === "abar" ? (x.labels && x.labels[style]) || x.value : x.value; }
  // Set and measured numbers with the same label on this style (PEEP, and VT on a Dräger-style panel) carry
  // a small "set" / "measured" mark so they never read as the same number.
  function dupes(tl, style) {
    var o = {};
    SET_ORDER.forEach(function (a) { MEAS_ORDER.forEach(function (b) { if (tl[a] && tl[b] && lab(tl[a], style) === lab(tl[b], style)) { o[a] = "qSet"; o[b] = "qMeas"; } }); });
    return o;
  }
  // One tile. o: {style, act, sel, mark: "right"|"wrong", lock, q}
  function tile(x, o) {
    if (!x) return "";
    var k = kindOf(x), lb = lab(x, o.style), v = val(x, o.style), learned = prefs().tiles[x.id];
    var name = lb + (x.labels && x.id !== "mode" && x.id !== "abar" && x.labels.generic !== lb ? " (" + x.labels.generic + ")" : "") + (o.q ? " " + t(STR[o.q]) : "");
    var aria = t(STR.tileAria).replace("{x}", name).replace("{v}", v ? v + (x.unit ? " " + x.unit : "") : "").replace("{k}", t(STR[KLAB[k]]));
    var state = o.mark ? ' data-state="' + o.mark + '"' : "";
    return '<button type="button" class="vb-t vb-' + k + (learned && o.act === "vbtile" ? " seen" : "") + '" data-act="' + o.act + '" data-k="' + esc(x.id) + '"' +
      (o.act === "vbtile" ? ' aria-pressed="' + (o.sel === x.id) + '"' : "") + state + (o.lock ? ' aria-disabled="true"' : "") + ' aria-label="' + esc(aria) + '">' +
      (x.id === "abar" ? '<span class="vb-ai" aria-hidden="true">' + ico("siren") + "</span>" : "") +
      '<span class="vb-tl" translate="no">' + esc(lb) + (o.q ? '<span class="vb-tq">' + s(o.q) + "</span>" : "") + "</span>" +
      (v ? '<span class="vb-tv">' + esc(v) + (x.unit ? "<i>" + esc(x.unit) + "</i>" : "") + "</span>" : "") + "</button>";
  }
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
  function styleName(id) { var x = ((D().screen || {}).styles || []).filter(function (y) { return y.id === id; })[0]; return x ? t(x.name) : ""; }
  // The panel. o: {style, page, act, sel, marks: {id: state}, lock}
  function panel(o) {
    var tl = tiles(), dup = dupes(tl, o.style), mk = o.marks || {};
    function T1(id) { return tile(tl[id], { style: o.style, act: o.act, sel: o.sel, mark: mk[id], lock: o.lock, q: dup[id] }); }
    var mid;
    if (o.page === "limits") {
      mid = '<div class="vb-lim" role="table" aria-label="' + s("pLim") + '"><div class="vb-lh" role="row"><span role="columnheader">' + s("limAlarm") + '</span><span role="columnheader">' + s("limNow") + '</span><span role="columnheader">' + s("limLow") + '</span><span role="columnheader">' + s("limHigh") + "</span></div>" +
        ((D().screen || {}).limitRows || []).map(function (r) {
          var nw = r.now && tl[r.now], nm = r.label ? t(r.label) : nw ? lab(nw, o.style) : r.id;
          return '<div class="vb-lr" role="row"><span class="vb-ln" role="rowheader" translate="no">' + esc(nm) + '</span><span class="vb-lnow" role="cell">' + (nw ? esc(nw.value) : "") + '</span><span role="cell">' + (r.low ? T1(r.low) : "") + '</span><span role="cell">' + (r.high ? T1(r.high) : "") + "</span></div>";
        }).join("") + '<p class="vb-lnote">' + s("limNote") + "</p></div>";
    } else {
      mid = '<div class="vb-waves" aria-hidden="true">' + waveSvg() + "</div>" +
        '<div class="vb-mcol"><span class="vb-rtag"><span class="vb-kind vb-meas">' + s("meas") + "</span></span>" + MEAS_ORDER.map(T1).join("") + "</div>";
    }
    return '<figure class="vl-plate vb-panel vb-L-' + esc(o.style) + " vb-P-" + esc(o.page) + '" role="group" aria-label="' + esc(t(STR.panelAria).replace("{x}", styleName(o.style))) + '">' +
      '<div class="vb-top">' + T1("mode") + T1("abar") + "</div>" + mid +
      '<div class="vb-setrow"><span class="vb-rtag"><span class="vb-kind vb-set">' + s("set") + "</span> " + s("rowSet") + "</span>" + SET_ORDER.map(T1).join("") + "</div>" +
      '<div class="vb-keys"><span class="vb-rtag"><span class="vb-kind vb-key">' + s("kKey") + "</span> " + s("rowKeys") + "</span>" + KEY_ORDER.map(T1).join("") + "</div></figure>";
  }
  function infoHtml() {
    var x = SC.sel && tiles()[SC.sel];
    if (!x) return '<p class="vb-hint">' + s("tapHint") + "</p>";
    var k = kindOf(x), lb = lab(x, SC.style), v = val(x, SC.style);
    return '<div class="vb-info-h"><b>' + tx(x.name) + '</b><span class="vb-kind vb-' + k + '">' + s(KTAG[k]) + "</span></div>" +
      '<p class="vb-info-l"><span translate="no">' + esc(lb) + "</span>" + (v && v !== lb ? " " + esc(v) + (x.unit ? " " + esc(x.unit) : "") : "") + " · " + s(KLAB[k]) + "</p>" +
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
        return "<li><b>" + tx(r.term) + "</b>" + (r.plain ? '<p class="vb-lplain">' + tx(r.plain) + "</p>" : "") + "<dl>" + st0.map(function (x) { return "<div><dt>" + tx(x.name) + "</dt><dd translate=\"no\">" + esc(r[x.id] || "") + "</dd></div>"; }).join("") + "</dl></li>";
      }).join("") + "</ul></details>";
  }
  function segs(act, attr, list, cur, label) {
    return '<div class="sp-seg vb-styles" role="group" aria-label="' + label + '">' + list.map(function (x) {
      return '<button type="button" data-act="' + act + '" ' + attr + '="' + esc(x.id) + '" aria-pressed="' + (x.id === cur) + '">' + x.name + "</button>";
    }).join("") + "</div>";
  }
  function pageSeg() { return segs("vbpage", "data-v", [{ id: "main", name: s("pMain") }, { id: "limits", name: s("pLim") }], SC.page, s("pageH")); }
  function scr(focusSel) {
    withData("vb-screen", scr, s("screenT"), s("screenS"), function () {
      var sc = D().screen || {};
      screen("vb-screen", scr, "screen", s("screenT"), s("screenS"),
        '<p class="vl-lede vb-lede">' + tx(sc.intro) + "</p>" +
        segs("vbstyle", "data-v", (sc.styles || []).map(function (x) { return { id: x.id, name: tx(x.name) }; }), SC.style, s("styleH")) +
        '<div id="vbPageSeg">' + pageSeg() + "</div>" +
        '<p class="vb-legend"><span><span class="vb-kind vb-set">' + s("set") + "</span> " + s("legendSet") + '</span><span><span class="vb-kind vb-meas">' + s("meas") + "</span> " + s("legendMeas") + "</span></p>" +
        '<div id="vbPanel">' + panel({ style: SC.style, page: SC.page, act: "vbtile", sel: SC.sel }) + "</div>" +
        '<div class="vl-card vb-info" id="vbInfo" aria-live="polite">' + infoHtml() + "</div>" +
        '<p class="sp-small vb-opened" id="vbOpened">' + openedLine() + "</p>" +
        '<button type="button" class="sp-btn pri vb-tofind" data-act="vbopen" data-k="find">' + s("findGo") + "</button>" +
        labelsHtml() + '<p class="vb-brand">' + tx(D().brandNote) + "</p>" +
        '<h2 class="sp-h2">' + s("quizH") + '</h2><div class="vb-quiz" id="vbQuiz">' + quizHtml() + "</div>" + foot(), focusSel);
    });
  }
  OPEN.screen = function () { SC.sel = null; SC.page = "main"; SC.qi = 0; SC.ans = null; SC.right = 0; SC.fin = false; scr(); };
  function repaintPanel() {
    [].forEach.call(I.root().querySelectorAll("[data-act=vbstyle]"), function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-v") === SC.style)); });
    var pn = q("#vbPanel"), ps = q("#vbPageSeg");
    if (pn) pn.innerHTML = panel({ style: SC.style, page: SC.page, act: "vbtile", sel: SC.sel });
    if (ps) ps.innerHTML = pageSeg();
  }
  A.vbstyle = function (b) {
    var v = b.getAttribute("data-v");
    if (v === SC.style) return;
    SC.style = v; repaintPanel();
    var inf = q("#vbInfo"); if (inf) inf.innerHTML = infoHtml();
  };
  A.vbpage = function (b) {
    var v = b.getAttribute("data-v");
    if (v === SC.page) return;
    SC.page = v; repaintPanel(); focus('[data-act=vbpage][data-v="' + v + '"]');
  };
  A.vbtile = function (b) {
    var k = b.getAttribute("data-k");
    SC.sel = k; prefs().tiles[k] = 1; save();
    if (k === "limits" && SC.page !== "limits") { SC.page = "limits"; repaintPanel(); focus("[data-act=vbtile][data-k=limits]"); }
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

  /* ---------- find it on the screen: a tap-the-number quiz across the three styles ---------- */
  var FQ = { i: 0, ans: null, right: 0, fin: false };
  function findItems() { return (((D().screen || {}).find || {}).items) || []; }
  function findBody() {
    var it = findItems(), n = it.length, F = findItems()[FQ.i];
    if (FQ.fin || !F) {
      var best = prefs().findBest || 0;
      return '<div class="vb-qend"><p class="sp-verdict ' + (FQ.right === n ? "ok" : "bad") + ' vb-fscore" tabindex="-1">' + (ico(FQ.right === n ? "check" : "info") || "") + "<span>" + s("score", { n: I.fmt(FQ.right), m: I.fmt(n) }) + "</span></p>" +
        '<p class="sp-small">' + s("best", { n: I.fmt(best), m: I.fmt(n) }) + '</p><button type="button" class="sp-btn sec" data-act="vbfagain">' + s("again") + "</button></div>";
    }
    var marks = {}, ok = FQ.ans === F.target;
    if (FQ.ans) { marks[F.target] = "right"; if (!ok) marks[FQ.ans] = "wrong"; }
    var rev = FQ.ans ? '<p class="sp-verdict vb-fv ' + (ok ? "ok" : "bad") + '" tabindex="-1">' + (ico(ok ? "check" : "close") || "") + "<span>" + s(ok ? "right" : "findWrong") + '</span></p><p class="vb-why">' + tx(F.why) + "</p>" +
      '<button type="button" class="sp-btn pri vb-qnext" data-act="vbfnext">' + s(FQ.i < n - 1 ? "nextQ" : "done") + "</button>" : "";
    return '<p class="sp-small vb-qof">' + s("qOf", { i: I.fmt(FQ.i + 1), n: I.fmt(n) }) + '</p><p class="vb-fstyle"><span>' + esc(styleName(F.style)) + "</span><span>" + s(F.page === "limits" ? "pLim" : "pMain") + "</span></p>" +
      '<h2 class="sp-h3 vl-q vb-fq" id="vbFQ">' + tx(F.q) + "</h2>" +
      panel({ style: F.style, page: F.page, act: "vbfind", marks: marks, lock: !!FQ.ans }) + '<div class="vb-fres" aria-live="polite">' + rev + "</div>";
  }
  function find(focusSel) {
    withData("vb-find", find, s("findH"), s("findSub"), function () {
      screen("vb-find", find, function () { scr(".vb-tofind"); }, s("findH"), s("findSub"),
        '<p class="vl-lede vb-lede">' + tx(((D().screen || {}).find || {}).intro) + '</p><div id="vbFind">' + findBody() + "</div>" + foot(), focusSel, STR.backScreen);
    });
  }
  OPEN.find = function () { FQ.i = 0; FQ.ans = null; FQ.right = 0; FQ.fin = false; find(); };
  function repaintFind(sel) { var el = q("#vbFind"); if (!el) return; el.innerHTML = findBody(); if (sel) focus("#vbFind " + sel); }
  A.vbfind = function (b) {
    var F = findItems()[FQ.i];
    if (!F || FQ.ans) return;
    FQ.ans = b.getAttribute("data-k");
    var ok = FQ.ans === F.target;
    if (ok) FQ.right++;
    prefs().tiles[F.target] = 1; save();
    I.haptic(ok ? "success" : "error");
    repaintFind(".vb-fv");
  };
  A.vbfnext = function () {
    var n = findItems().length;
    if (FQ.i < n - 1) { FQ.i++; FQ.ans = null; repaintFind(".vb-fq"); var f = q("#vbFind .vb-fq"); if (f) { f.setAttribute("tabindex", "-1"); focus("#vbFind .vb-fq"); } return; }
    FQ.fin = true;
    if (FQ.right > (prefs().findBest || 0)) { prefs().findBest = FQ.right; save(); }
    repaintFind(".vb-fscore");
  };
  A.vbfagain = function () { FQ.i = 0; FQ.ans = null; FQ.right = 0; FQ.fin = false; repaintFind(".vb-t"); };

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
            '<div class="vb-ml"><span>' + s("closest") + '</span><ul class="vb-mlabs">' + labs.map(function (m) { return "<li>" + engMode(m) + "</li>"; }).join("") + "</ul></div>" +
            '<p class="vb-never"><span aria-hidden="true">' + ico("lock") + "</span>" + tx(d.never) + "</p></li>";
        }).join("") + "</ul>" + foot(), focusSel);
    });
  }
  OPEN.modes = function () { modes(); };

  /* ---------- 3 am drill ---------- */
  var DR = { id: null, picked: [], res: null, tries: 0 };
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
  function short(x) { return x.short ? tx(x.short) : tx(x.text); }
  function backDrills() { var id = DR.id; drills('[data-act=vbdrill][data-k="' + id + '"]'); }
  function stateLabel(dr, it) {
    var x = stepBy(dr, it.id);
    if (it.state === "ok") return s(x.opt ? "st_okOpt" : x.flex ? "st_okAny" : "st_ok");
    if (it.state === "late") { var b = it.before && stepBy(dr, it.before); return esc(t(STR.st_late)).replace("{x}", b ? short(b) : ""); }
    return s("st_" + it.state);
  }
  function compare(dr, res) {
    var by = {}; res.items.forEach(function (it) { by[it.id] = it; });
    var mine = DR.picked.map(function (id, i) {
      var it = by[id], good = it.state === "ok";
      return '<li class="vb-c ' + it.state + '"><span class="vb-n" aria-hidden="true">' + (i + 1) + "</span><span class=\"vb-ct\">" + short(stepBy(dr, id)) + '</span><span class="vb-ci" aria-hidden="true">' + ico(good ? "check" : "close") + '</span><span class="sp-sr">' + stateLabel(dr, it) + "</span></li>";
    }).join("");
    var so = safeOrder(dr.steps || []), shared = false, cnt = {};
    so.forEach(function (g) { if (typeof g.n === "number") { cnt[g.n] = (cnt[g.n] || 0) + 1; if (cnt[g.n] > 1) shared = true; } });
    var safe = so.map(function (g) {
      var badge = typeof g.n === "number" ? '<span class="vb-n" aria-hidden="true">' + g.n + "</span>" : '<span class="vb-g vb-g-' + g.n + '">' + s("g_" + g.n) + "</span>";
      return '<li class="vb-c' + (g.n === "never" ? " never" : "") + '">' + badge + '<span class="vb-ct">' + short(stepBy(dr, g.id)) + "</span></li>";
    }).join("");
    return '<div class="vb-cmp" role="group" aria-label="' + s("cmpAria") + '"><section><h3 class="vb-ch">' + s("yourOrder") + '</h3><ol class="vb-cl">' + mine + "</ol></section>" +
      '<section><h3 class="vb-ch">' + s("safeH") + '</h3><ol class="vb-cl">' + safe + "</ol>" + (shared ? '<p class="vb-cnote">' + s("sameNote") + "</p>" : "") + "</section></div>";
  }
  function drill(focusSel) {
    var dr = curDrill();
    if (!dr) return drills();
    var pool = order(dr.steps || [], dr.id + (DR.tries ? ":" + DR.tries : "")).filter(function (x) { return DR.picked.indexOf(x.id) < 0; }), res = DR.res, body;
    var head = '<div class="vl-acard danger vb-scene"><p class="vb-scene-h"><span aria-hidden="true">' + ico("siren") + "</span><b>" + tx(dr.title) + "</b></p><p>" + tx(dr.scene) + "</p></div>";
    if (!res) {
      var ord = DR.picked.length ? '<ol class="vb-ord">' + DR.picked.map(function (id, i) { return '<li><span class="vb-n" aria-hidden="true">' + (i + 1) + "</span><span>" + tx(stepBy(dr, id).text) + "</span></li>"; }).join("") + "</ol>"
        : '<p class="vb-empty">' + s("empty") + "</p>";
      body = '<p class="vb-pick">' + s("pickHint") + '</p><h2 class="sp-h2" id="vbOrdH">' + s("yourOrder") + '</h2><div class="vb-ordw" aria-labelledby="vbOrdH" aria-live="polite">' + ord + "</div>" +
        (pool.length ? '<h2 class="sp-h2" id="vbPoolH">' + s("pool") + '</h2><ul class="vb-pool" aria-labelledby="vbPoolH">' + pool.map(function (x) {
          return '<li><button type="button" class="vb-step" data-act="vbpick" data-k="' + esc(x.id) + '" aria-label="' + esc(t(STR.addAria).replace("{x}", t(x.text))) + '"><span class="vb-plus" aria-hidden="true">' + ico("plus") + "</span><span>" + tx(x.text) + "</span></button></li>";
        }).join("") + "</ul>" : "");
    } else {
      var cls = res.ok ? (res.optMissed ? "vb-neutral" : "ok") : "bad";
      body = '<p class="sp-verdict ' + cls + ' vb-dv" tabindex="-1">' + (ico(res.ok && !res.optMissed ? "check" : "info") || "") + "<span>" + (res.ok ? s(res.optMissed ? "optLeft" : "allRight") : s("someWrong", { n: I.fmt(res.right), m: I.fmt(res.of) })) + "</span></p>" +
        compare(dr, res) +
        '<h2 class="sp-h2">' + s("whyH") + '</h2><ol class="vb-res">' + res.items.map(function (it) {
          var x = stepBy(dr, it.id), good = it.state === "ok" || it.state === "skipped" || it.state === "optional";
          return '<li class="vb-r ' + it.state + '"><span class="vb-r-i" aria-hidden="true">' + ico(good ? "check" : "close") + '</span><div><p class="vb-r-s">' + stateLabel(dr, it) + (it.pos != null ? " · " + s("yourStep", { n: it.pos + 1 }) : "") + "</p>" +
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
  function openDrill(id) { DR.id = id; DR.picked = []; DR.res = null; DR.tries = 0; drill(); }
  A.vbdrill = function (b) { var id = b.getAttribute("data-k"); if (!B.data) { load().then(function () { openDrill(id); }, function () {}); return; } openDrill(id); };
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
  // Try again reshuffles the pool, so the order is learned, not the positions.
  A.vbdagain = function () { DR.picked = []; DR.res = null; DR.tries++; drill(".vb-step"); };
  A.vbdnext = function () { var l = drillList(), i = l.indexOf(curDrill()); if (i >= 0 && i < l.length - 1) openDrill(l[i + 1].id); };

  /* ---------- handover to the next doctor ---------- */
  function hand(focusSel) {
    withData("vb-hand", hand, s("handT"), s("handS"), function () {
      var d = D().handover || {};
      screen("vb-hand", hand, "hand", s("handT"), s("handS"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + '</p><ol class="vb-ho">' + (d.rows || []).map(function (r, i) {
          return '<li class="vl-card vb-hr"><span class="vb-n" aria-hidden="true">' + (i + 1) + '</span><div><h2 class="vb-hl">' + tx(r.label) + '</h2><p class="vb-hw">' + tx(r.what) + "</p>" +
            '<p class="vb-hx"><span class="vb-hxk">' + tx(d.exH) + "</span>" + tx(r.example) + "</p></div></li>";
        }).join("") + "</ol>" +
        '<section class="vl-card vb-nv vb-docs"><h2 class="sp-h2">' + tx(d.docH) + '</h2><ul class="vb-list ok">' + (d.doc || []).map(function (x) { return '<li><span aria-hidden="true">' + ico("note") + "</span><span>" + tx(x) + "</span></li>"; }).join("") + "</ul></section>" +
        '<button type="button" class="sp-btn pri vb-todr" data-act="vbdrill" data-k="silence">' + s("toSilence") + "</button>" + foot(), focusSel);
    });
  }
  OPEN.hand = function () { hand(); };

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
