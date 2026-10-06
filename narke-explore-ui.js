/* Narkē explorers: the six interactive screens on the specialty engine's explorer registry. ES5.
   Each explorer is drawn from its pure model in window.NARKE_MODELS (narke-models/explorer-<id>.js) and registers with
   host.registerExplorer once its model has loaded (the engine's model syncers run after narke/models.json).
   Screens paint through host._exploreUI.frame; taps go through the engine's data-act actions (a full repaint that keeps
   focus and scroll); sliders update their live region in place so the slider keeps focus.
   Waveforms sit on a monitor plate (black in both themes, the usual channel colours), as on an anaesthesia workstation.
   Every screen shows its level, the "AI draft" review mark, "Learn this" links to lessons that exist in the Learn index,
   and the model's sources and notes. Clinical numerals stay ASCII in Hindi. Pictures are original SVG with no text.
   Node: module.exports = the pure view-model helpers (test/narke-explore-ui.test.mjs). */
(function (G) {
  "use strict";
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure view-model helpers ================= */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lin(v, d0, d1, r0, r1) { return r0 + (d1 === d0 ? 0 : (v - d0) / (d1 - d0)) * (r1 - r0); }
  function f1(n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""); }
  // SVG path through points mapped into a box: x from xd[0]..xd[1], y from yd[0]..yd[1] (y up).
  function pathOf(points, xk, yk, box, xd, yd) {
    return points.map(function (p, i) {
      var x = lin(p[xk], xd[0], xd[1], box.x, box.x + box.w), y = lin(clamp(p[yk], yd[0], yd[1]), yd[0], yd[1], box.y + box.h, box.y);
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join("");
  }
  // Two breaths end to end, t shifted for the second.
  function twoBreaths(points) {
    var T0 = points[points.length - 1].t, out = points.slice();
    points.forEach(function (p, i) { if (i) out.push({ t: p.t + T0, paw: p.paw, flow: p.flow, volume: p.volume }); });
    return out;
  }
  // Lessons for an explorer: the fixed list first, then any lesson whose test names the explorer.
  function lessonsFor(id, ix, fixed) {
    var les = (ix && ix.lessons) || {}, out = [], seen = {};
    function add(lid) { if (seen[lid] || !les[lid]) return; seen[lid] = 1; out.push(lid); }
    (fixed || []).forEach(add);
    Object.keys(les).forEach(function (lid) { var t = les[lid].test; if (t && t.explorer === id) add(lid); });
    return out.map(function (lid) {
      var lv = les[lid].level || null;
      ((ix && ix.units) || []).forEach(function (u) { if (!lv && u.lessons && u.lessons.indexOf(lid) >= 0) lv = u.level || null; });
      return { id: lid, title: les[lid].title, minutes: les[lid].minutes, level: lv === "resident" ? "resident" : "mbbs" };
    });
  }
  // Dermatome map: top of each level's band on the 200 x 360 body (front view). C5 to T1 run down the arms.
  var DERM_Y = { C2: 50, C3: 58, C4: 66, C5: 72, C6: 72, C7: 72, C8: 72, T1: 72, T2: 76, T3: 86, T4: 96, T5: 106, T6: 116, T7: 126, T8: 136, T9: 146,
    T10: 156, T11: 168, T12: 180, L1: 192, L2: 210, L3: 250, L4: 272, L5: 300, S1: 328, S2: 352, S3: 352, S4: 352, S5: 352 };
  // Fresh gas flow steps for the slider (L/min).
  var FGF_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];
  var PURE = { clamp: clamp, lin: lin, f1: f1, pathOf: pathOf, twoBreaths: twoBreaths, lessonsFor: lessonsFor, DERM_Y: DERM_Y, FGF_STEPS: FGF_STEPS };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  G.NARKE_EXPLORE_UI = PURE;

  /* ================= browser: the six screens ================= */
  var host = G.NARKE;
  if (!host || !host._internal || !host._exploreUI || !host.registerExplorer) return;
  var I = host._internal, A = I.ACTIONS, esc = I.esc, EXUI = host._exploreUI, D = G.SPECIALTY_DATA;
  function M(id) { var m = G.NARKE_MODELS; return m && m[id]; }
  function L() { return I.lang(); }
  function t(o) { return D.t(o, L()); }

  var STR = {
    mbbs: T("MBBS", "MBBS"), resident: T("Resident", "रेज़िडेंट"),
    draft: T("AI draft, awaiting specialist review", "AI ड्राफ़्ट, विशेषज्ञ समीक्षा बाकी"),
    learnThis: T("Learn this", "यह सीखें"), min: T("{n} min", "{n} मिनट"),
    sources: T("Sources and notes", "स्रोत और टिप्पणियाँ"), reset: T("Reset", "रीसेट"),
    // odc
    pao2: T("PaO2", "PaO2"), sat: T("Saturation", "Saturation"), p50: T("P50", "P50"), shifts: T("What shifts the curve", "Curve को क्या खिसकाता है"),
    ph: T("pH", "pH"), temp: T("Temperature", "तापमान"), pco2: T("PaCO2", "PaCO2"), dpg: T("2,3-DPG", "2,3-DPG"),
    low: T("Low", "कम"), normal: T("Normal", "सामान्य"), high: T("High", "अधिक"), hbf: T("Fetal haemoglobin (HbF)", "Fetal haemoglobin (HbF)"),
    odcSay: T("At PaO2 {p} mmHg, saturation is {s}%. P50 is {q} mmHg.", "PaO2 {p} mmHg पर saturation {s}% है। P50 {q} mmHg है।"),
    stdCurve: T("Dashed line: the standard curve", "टूटी रेखा: standard curve"),
    // mac
    age: T("Age", "उम्र"), years: T("{n} years", "{n} वर्ष"), agents: T("The agents at this age", "इस उम्र पर agents"),
    macAt: T("MAC", "MAC"), bg: T("Blood:gas", "Blood:gas"), faster: T("Shorter bar: faster on and off", "छोटी पट्टी: जल्दी असर और जल्दी वापसी"),
    combine: T("Add agents together", "Agents जोड़ें"), volatile: T("Volatile agent", "Volatile agent"), etPct: T("End-tidal {a}", "End-tidal {a}"),
    n2o: T("End-tidal N2O", "End-tidal N2O"), totalMac: T("{m} MAC in total", "कुल {m} MAC"), fracOf: T("{a}: {f} MAC", "{a}: {f} MAC"),
    // tof
    count: T("Twitches seen (TOF count)", "दिखे twitches (TOF count)"), ratio: T("TOF ratio (T4/T1)", "TOF ratio (T4/T1)"), ptc: T("Post-tetanic count", "Post-tetanic count"),
    fewer: T("Fewer", "कम"), more: T("More", "ज़्यादा"), family: T("Blocker given", "दी गई blocker"),
    amino: T("Rocuronium or vecuronium", "Rocuronium या vecuronium"), benzyl: T("Atracurium or cisatracurium", "Atracurium या cisatracurium"),
    weight: T("Weight", "वज़न"), kg: T("{n} kg", "{n} kg"), depth: T("Depth of block", "Block की depth"), plan: T("Reversal", "Reversal"),
    sugDose: T("Sugammadex {d} mg/kg: {m} mg", "Sugammadex {d} mg/kg: {m} mg"),
    neoDose: T("Neostigmine 40 to 50 mcg/kg: {a} to {b} mg (at most 5 mg)", "Neostigmine 40 से 50 mcg/kg: {a} से {b} mg (अधिकतम 5 mg)"),
    residual: T("Residual block: do not extubate on this reading.", "Residual block: इस reading पर extubate न करें।"),
    tofSay: T("{n}. {r}", "{n}। {r}"),
    // dermatomes
    level: T("Sensory level", "Sensory level"), operation: T("Operation", "Operation"), none: T("No operation chosen", "कोई operation नहीं चुना"),
    higher: T("Higher", "ऊपर"), lower: T("Lower", "नीचे"),
    symp: T("Sympathetic about {l}", "Sympathetic लगभग {l}"), motor: T("Motor about {l}", "Motor लगभग {l}"),
    enough: T("Enough: {op} needs {l}.", "पर्याप्त: {op} के लिए {l} चाहिए।"), notEnough: T("Not enough: {op} needs {l}, {g} segments higher.", "पर्याप्त नहीं: {op} के लिए {l} चाहिए, {g} segment ऊपर।"),
    landmarks: T("Landmarks", "पहचान बिंदु"), covered: T("covered", "ढका"), notCovered: T("not covered", "नहीं ढका"),
    bodyAlt: T("Front of the body, shaded from {l} down", "शरीर का सामने का भाग, {l} से नीचे तक छायांकित"),
    // ventilator
    mode: T("Mode", "Mode"), vc: T("Volume control", "Volume control"), pc: T("Pressure control", "Pressure control"), lung: T("Lung", "फेफड़ा"),
    compliance: T("Compliance", "Compliance"), resistance: T("Resistance", "Resistance"), peep: T("PEEP", "PEEP"), vt: T("Tidal volume", "Tidal volume"),
    pinsp: T("Inspiratory pressure above PEEP", "PEEP के ऊपर inspiratory pressure"), rate: T("Rate", "Rate"), ie: T("I:E", "I:E"),
    paw: T("Pressure", "Pressure"), flow: T("Flow", "Flow"), volume: T("Volume", "Volume"),
    peak: T("Peak", "Peak"), plat: T("Plateau", "Plateau"), drive: T("Driving", "Driving"), totPeep: T("Total PEEP", "Total PEEP"), vtOut: T("Tidal volume", "Tidal volume"), mv: T("Minute volume", "Minute volume"),
    ventSay: T("Peak {a}, plateau {b}, driving pressure {c} cmH2O. Tidal volume {v} mL.", "Peak {a}, plateau {b}, driving pressure {c} cmH2O। Tidal volume {v} mL।"),
    waveAlt: T("Pressure, flow and volume against time for two breaths", "दो साँसों के लिए समय के साथ pressure, flow और volume"),
    settings: T("Settings", "Settings"),
    // circuit
    fgf: T("Fresh gas flow", "Fresh gas flow"), lmin: T("{n} L/min", "{n} L/min"), ve: T("Minute ventilation", "Minute ventilation"), absorber: T("Absorber", "Absorber"),
    parts: T("Parts of the circle", "Circle के हिस्से"), insp: T("Inspired CO2", "Inspired CO2"), et: T("End-tidal CO2", "End-tidal CO2"), reb: T("Rebreathed", "दोबारा साँस में"),
    rising: T("above 100, still rising", "100 से ऊपर, बढ़ रहा है"), mmhg: T("{n} mmHg", "{n} mmHg"),
    circSay: T("Inspired CO2 {i}, end-tidal {e}.", "Inspired CO2 {i}, end-tidal {e}।"),
    circuitAlt: T("Circle system: fresh gas inlet, valves, limbs, Y-piece, APL valve, bag and absorber", "Circle system: fresh gas inlet, valves, limbs, Y-piece, APL valve, bag और absorber"),
    capno: T("Capnogram, one breath", "Capnogram, एक साँस"), washout: T("Fresh gas at or above minute ventilation washes CO2 out even with no absorber.", "Fresh gas minute ventilation के बराबर या ज़्यादा हो तो absorber के बिना भी CO2 बाहर निकल जाता है।")
  };
  function s(key, v) { return esc(t(STR[key])).replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
  function raw(key, v) { return t(STR[key]).replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? String(v[x]) : m; }); }
  function tx(o) { return I.tx(o); }
  function $(id) { return G.document.getElementById(id); }
  function curId() { return EXUI._x && EXUI._x.id; }
  function touched(id) { EXUI.mark(id); }

  /* ---- shared parts ---- */
  function metaHtml(level) {
    return '<p class="nkx-meta"><span class="nkx-lv">' + s(level === "resident" ? "resident" : "mbbs") + '</span><span class="nkx-draft">' + s("draft") + "</span></p>";
  }
  function learnHtml(id) {
    var w = host._learn && host._learn._w, list = lessonsFor(id, w && w.ix, []);
    if (!list.length) return "";
    return '<section class="nkx-sec" aria-labelledby="nkxLearnH"><h2 class="sp-h2" id="nkxLearnH">' + s("learnThis") + '</h2><ul class="sp-rows">' + list.map(function (l) {
      return I.row("lesson", ' data-l="' + esc(l.id) + '"', I.tile("book"), tx(l.title), (l.minutes ? s("min", { n: I.fmt(l.minutes) }) + " · " : "") + s(l.level), "");
    }).join("") + "</ul></section>";
  }
  function srcHtml(m) {
    var notes = m.notes || {}, keys = Object.keys(notes);
    return '<details class="nkx-src"><summary>' + s("sources") + '</summary><div class="nkx-src-b">' +
      (keys.length ? '<ul class="nkx-notes">' + keys.map(function (k) { return "<li>" + tx(notes[k]) + "</li>"; }).join("") + "</ul>" : "") +
      '<ol class="nkx-refs">' + (m.sources || []).map(function (x) {
        return "<li>" + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.label) + "</a>" : esc(x.label)) + "</li>";
      }).join("") + "</ol></div></details>";
  }
  // A labelled slider with its value shown beside the label. key = data-xin, vt = spoken value.
  function range(key, label, min, max, step, val, vt, shown) {
    return '<label class="nkx-field"><span class="nkx-fl"><span class="nkx-lbl">' + label + '</span><output class="nkx-val" data-out="' + key + '">' + esc(shown) + "</output></span>" +
      '<input type="range" class="nkx-range" data-xin="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" aria-valuetext="' + esc(vt) + '"></label>';
  }
  function setOut(el, txt) {
    el.setAttribute("aria-valuetext", txt);
    var o = el.parentNode && el.parentNode.querySelector("[data-out]");
    if (o) o.textContent = txt;
  }
  // A segmented control of aria-pressed buttons.
  function seg(act, label, items, cur, labelId) {
    return '<div class="nkx-segrow"><span class="nkx-lbl" id="' + labelId + '">' + label + '</span><div class="sp-seg nkx-seg" role="group" aria-labelledby="' + labelId + '">' +
      items.map(function (it) { return '<button type="button" data-act="' + act + '" data-v="' + esc(it[0]) + '" aria-pressed="' + (String(cur) === String(it[0])) + '">' + it[1] + "</button>"; }).join("") + "</div></div>";
  }
  function alertsHtml(list) {
    return (list || []).map(function (a) { return '<p class="nkx-alert">' + tx(a.text || a) + "</p>"; }).join("");
  }

  var X = {}; // id -> {test, body(m), live?(m), input?(el)}
  function paint(id, focusSel) {
    var x = X[id], m = M(id);
    if (!x || !m) return;
    EXUI.frame(id, '<div class="nkx" data-nkx="' + id + '">' + metaHtml(m.level) + x.body(m) + learnHtml(id) + srcHtml(m) + "</div>", focusSel);
  }
  function repaintLive(id) { var x = X[id], el = $("nkxLive"); if (x && x.live && el) el.innerHTML = x.live(M(id)); }
  function again(focusSel) { var id = curId(); if (id) paint(id, focusSel); }

  /* ================= odc ================= */
  var OD = { po2: 60, ph: 7.4, temp: 37, pco2: 40, dpg: "normal", hbf: false };
  var OBOX = { x: 34, y: 10, w: 296, h: 170 }, OVB = "0 0 340 208";
  function odCond() { return { ph: OD.ph, temp: OD.temp, pco2: OD.pco2, dpg: OD.dpg, hbf: OD.hbf }; }
  X.odc = {
    test: { mcqTopic: "basic-science" },
    body: function (m) {
      return '<section class="nkx-sec nkx-first" aria-labelledby="nkxOdH"><h2 class="nkx-h" id="nkxOdH">' + tx(m.title) + '<span class="sp-small">' + s("stdCurve") + "</span></h2>" +
        '<div id="nkxLive">' + this.live(m) + "</div>" +
        range("po2", s("pao2"), 0, 120, 1, OD.po2, OD.po2 + " mmHg", OD.po2 + " mmHg") + "</section>" +
        '<section class="nkx-sec" aria-labelledby="nkxOdS"><h2 class="sp-h2" id="nkxOdS">' + s("shifts") + "</h2>" +
        range("ph", s("ph"), 7.0, 7.7, 0.05, OD.ph, OD.ph.toFixed(2), OD.ph.toFixed(2)) + '<p class="sp-small nkx-hint">' + tx(m.factors.ph.line) + "</p>" +
        range("temp", s("temp"), 30, 42, 0.5, OD.temp, f1(OD.temp) + " \u00b0C", f1(OD.temp) + " \u00b0C") + '<p class="sp-small nkx-hint">' + tx(m.factors.temp.line) + "</p>" +
        range("pco2", s("pco2"), 20, 80, 5, OD.pco2, OD.pco2 + " mmHg", OD.pco2 + " mmHg") + '<p class="sp-small nkx-hint">' + tx(m.factors.pco2.line) + "</p>" +
        seg("nkxoddpg", s("dpg"), [["low", s("low")], ["normal", s("normal")], ["high", s("high")]], OD.dpg, "nkxDpgL") + '<p class="sp-small nkx-hint">' + tx(m.factors.dpg.line) + "</p>" +
        '<button type="button" class="nkx-toggle" data-act="nkxodhbf" aria-pressed="' + OD.hbf + '"><span class="nkx-box" aria-hidden="true"></span><span class="nkx-tg-b"><b>' + s("hbf") + '</b><span class="sp-small">' + tx(m.factors.hbf.line) + "</span></span></button>" +
        '<button type="button" class="nkx-link" data-act="nkxodreset">' + s("reset") + "</button></section>";
    },
    live: function (m) {
      var std = m.curve({}, 120, 2), cur = m.curve(odCond(), 120, 2), r = m.at(OD.po2, odCond());
      var xd = [0, 120], yd = [0, 100];
      var cx = lin(OD.po2, 0, 120, OBOX.x, OBOX.x + OBOX.w), cy = lin(r.so2Exact, 0, 100, OBOX.y + OBOX.h, OBOX.y);
      var px = lin(Math.min(120, r.p50), 0, 120, OBOX.x, OBOX.x + OBOX.w), py = lin(50, 0, 100, OBOX.y + OBOX.h, OBOX.y);
      var grid = "";
      [0, 25, 50, 75, 100].forEach(function (v) { var y = lin(v, 0, 100, OBOX.y + OBOX.h, OBOX.y).toFixed(1); grid += '<line class="nkx-grid" x1="' + OBOX.x + '" y1="' + y + '" x2="' + (OBOX.x + OBOX.w) + '" y2="' + y + '"/>'; });
      [0, 20, 40, 60, 80, 100, 120].forEach(function (v) { var x = lin(v, 0, 120, OBOX.x, OBOX.x + OBOX.w).toFixed(1); grid += '<line class="nkx-grid" x1="' + x + '" y1="' + OBOX.y + '" x2="' + x + '" y2="' + (OBOX.y + OBOX.h) + '"/>'; });
      var svg = '<svg class="nkx-chart" viewBox="' + OVB + '" width="340" height="208" aria-hidden="true" focusable="false">' + grid +
        '<path class="nkx-ref" d="' + pathOf(std.points, "po2", "so2", OBOX, xd, yd) + '"/>' +
        '<path class="nkx-line nkx-spo2" d="' + pathOf(cur.points, "po2", "so2", OBOX, xd, yd) + '"/>' +
        '<line class="nkx-cross" x1="' + cx.toFixed(1) + '" y1="' + (OBOX.y + OBOX.h) + '" x2="' + cx.toFixed(1) + '" y2="' + cy.toFixed(1) + '"/>' +
        '<line class="nkx-cross" x1="' + OBOX.x + '" y1="' + cy.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + cy.toFixed(1) + '"/>' +
        '<circle class="nkx-p50" cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.5"/>' +
        '<circle class="nkx-dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="6"/></svg>';
      var axis = '<div class="nkx-axx" aria-hidden="true"><span>0</span><span>40</span><span>80</span><span>120 mmHg</span></div>';
      return '<div class="nkx-plate">' + '<div class="nkx-yl" aria-hidden="true"><span>100</span><span>50</span><span>0</span></div>' + svg + axis + "</div>" +
        '<div class="nkx-readout" role="status" aria-live="polite"><p class="nkx-big"><output>' + f1(r.so2) + '</output><span>%</span></p>' +
        '<p class="sp-small">' + s("odcSay", { p: OD.po2, s: f1(r.so2), q: f1(r.p50) }) + "</p></div>" +
        '<p class="nkx-p nkx-shift is-' + r.shift + '">' + tx(r.shiftText) + "</p>";
    },
    input: function (el) {
      var k = el.getAttribute("data-xin"), v = +el.value;
      OD[k] = v;
      setOut(el, k === "ph" ? v.toFixed(2) : k === "temp" ? f1(v) + " \u00b0C" : v + " mmHg");
      repaintLive("odc"); touched("odc");
    }
  };
  A.nkxoddpg = function (b) { OD.dpg = b.getAttribute("data-v"); touched("odc"); again(); };
  A.nkxodhbf = function () { OD.hbf = !OD.hbf; touched("odc"); again(); };
  A.nkxodreset = function () { OD = { po2: 60, ph: 7.4, temp: 37, pco2: 40, dpg: "normal", hbf: false }; again('[data-xin="po2"]'); };

  /* ================= mac ================= */
  var MC = { age: 40, agent: "sevoflurane", et: 1.2, n2o: 0 };
  var VOLATILES = ["sevoflurane", "isoflurane", "desflurane", "halothane"];
  X.mac = {
    test: { mcqTopic: "inhalational" },
    body: function (m) {
      var mx = Math.round(m.agents[MC.agent].mac40 * 2 * 10) / 10;
      return '<section class="nkx-sec nkx-first" aria-labelledby="nkxMcH"><h2 class="nkx-h" id="nkxMcH">' + s("agents") + '<span class="sp-small">' + s("faster") + "</span></h2>" +
        range("age", s("age"), 1, 90, 1, MC.age, raw("years", { n: MC.age }), raw("years", { n: MC.age })) +
        '<div id="nkxLive">' + this.live(m) + "</div></section>" +
        '<section class="nkx-sec" aria-labelledby="nkxMcC"><h2 class="sp-h2" id="nkxMcC">' + s("combine") + "</h2>" +
        '<div class="sp-seg nkx-seg nkx-wrap" role="group" aria-label="' + s("volatile") + '">' + VOLATILES.map(function (k) {
          return '<button type="button" data-act="nkxmcag" data-v="' + k + '" aria-pressed="' + (MC.agent === k) + '">' + tx(m.agents[k].name) + "</button>";
        }).join("") + "</div>" +
        range("et", s("etPct", { a: t(m.agents[MC.agent].name) }), 0, mx, 0.1, MC.et, f1(MC.et) + "%", f1(MC.et) + "%") +
        range("n2o", s("n2o"), 0, 70, 5, MC.n2o, MC.n2o + "%", MC.n2o + "%") +
        '<div id="nkxLive2">' + this.live2(m) + "</div></section>";
    },
    live: function (m) {
      var maxBg = 2.4;
      return '<ul class="nkx-agents">' + m.order.map(function (k) {
        var a = m.agents[k], mac = m.macForAge(k, MC.age).mac;
        return '<li><div class="nkx-ag-h"><b>' + tx(a.name) + '</b><span class="nkx-ag-mac"><output>' + (k === "n2o" ? Math.round(mac) : mac.toFixed(2)) + '%</output><span class="sp-small">' + s("macAt") + "</span></span></div>" +
          '<div class="nkx-ag-bg"><span class="nkx-lbl">' + s("bg") + " " + a.bloodGas + '</span><span class="nkx-meter" aria-hidden="true"><span style="width:' + Math.round(a.bloodGas / maxBg * 100) + '%"></span></span></div>' +
          '<p class="sp-small">' + tx(a.line) + "</p></li>";
      }).join("") + "</ul>";
    },
    live2: function (m) {
      var mix = {}; mix[MC.agent] = MC.et; mix.n2o = MC.n2o;
      var r = m.combine(MC.age, mix), pct = Math.min(100, r.totalExact / 2 * 100);
      return '<div class="nkx-readout" role="status" aria-live="polite"><p class="nkx-big"><output>' + r.total.toFixed(2) + '</output><span>MAC</span></p>' +
        '<div class="nkx-gauge" aria-hidden="true"><span class="nkx-gauge-f" style="width:' + pct.toFixed(1) + '%"></span><i style="left:50%"></i><i style="left:65%"></i></div>' +
        '<div class="nkx-gauge-t" aria-hidden="true"><span>0</span><span style="left:50%">1.0</span><span style="left:65%">1.3</span><span>2.0</span></div>' +
        '<p class="sp-small">' + r.parts.map(function (p) { return esc(raw("fracOf", { a: t(m.agents[p.agent].name), f: p.fraction.toFixed(2) })); }).join(" + ") + "</p></div>" +
        '<p class="nkx-p">' + tx(r.band.text) + "</p>" + alertsHtml(r.warnings);
    },
    input: function (el) {
      var k = el.getAttribute("data-xin"), v = +el.value;
      MC[k] = v;
      setOut(el, k === "age" ? raw("years", { n: v }) : (k === "et" ? f1(v) : v) + "%");
      if (k === "age") repaintLive("mac");
      var l2 = $("nkxLive2"); if (l2) l2.innerHTML = X.mac.live2(M("mac"));
      touched("mac");
    }
  };
  A.nkxmcag = function (b) {
    var m = M("mac"), k = b.getAttribute("data-v"), was = m.agents[MC.agent].mac40;
    MC.agent = k; MC.et = Math.round(MC.et / was * m.agents[k].mac40 * 10) / 10; // keep the same MAC fraction
    touched("mac"); again('[data-act="nkxmcag"][data-v="' + k + '"]');
  };

  /* ================= tof ================= */
  var TF = { count: 4, ratio: 0.6, ptc: 5, family: "aminosteroid", kg: 60 };
  function tofReading() { return { count: TF.count, ratio: TF.count === 4 ? TF.ratio : undefined, ptc: TF.count === 0 ? TF.ptc : undefined }; }
  X.tof = {
    test: { mcqTopic: "nmb" },
    body: function (m) {
      return '<section class="nkx-sec nkx-first" aria-labelledby="nkxTfH"><h2 class="nkx-h" id="nkxTfH">' + s("depth") + "</h2>" +
        '<div id="nkxLive">' + this.live(m) + "</div></section>" +
        '<section class="nkx-sec" aria-labelledby="nkxTfR"><h2 class="sp-h2" id="nkxTfR">' + s("count") + "</h2>" +
        '<div class="sp-seg nkx-seg nkx-fill" role="group" aria-labelledby="nkxTfR">' + [0, 1, 2, 3, 4].map(function (n) {
          return '<button type="button" data-act="nkxtfc" data-v="' + n + '" aria-pressed="' + (TF.count === n) + '">' + n + "</button>";
        }).join("") + "</div>" +
        (TF.count === 4 ? range("ratio", s("ratio"), 0, 1, 0.05, TF.ratio, TF.ratio.toFixed(2), TF.ratio.toFixed(2)) : "") +
        (TF.count === 0 ? '<div class="nkx-stepper" role="group" aria-label="' + s("ptc") + '"><span class="nkx-lbl">' + s("ptc") + "</span>" +
          '<button type="button" class="nkx-icon" data-act="nkxtfp" data-v="-1" aria-label="' + s("fewer") + '"' + (TF.ptc > 0 ? "" : " disabled") + ">−</button>" +
          '<output class="nkx-num" aria-live="polite">' + TF.ptc + "</output>" +
          '<button type="button" class="nkx-icon" data-act="nkxtfp" data-v="1" aria-label="' + s("more") + '"' + (TF.ptc < 15 ? "" : " disabled") + ">+</button></div>" : "") +
        seg("nkxtff", s("family"), [["aminosteroid", s("amino")], ["benzyl", s("benzyl")]], TF.family, "nkxTfF") +
        range("kg", s("weight"), 30, 150, 5, TF.kg, raw("kg", { n: TF.kg }), raw("kg", { n: TF.kg })) +
        '<p class="sp-small nkx-hint">' + tx(m.notes.weight) + "</p></section>";
    },
    live: function (m) {
      var d = m.depth(tofReading()), tw = m.twitches(tofReading()), rv = m.reverse(d.depth, TF.family, TF.kg);
      var bars = tw.map(function (h, i) {
        var bh = Math.max(0, h) * 96, x = 28 + i * 52;
        return h > 0 ? '<rect class="nkx-tw" x="' + x + '" y="' + (112 - bh).toFixed(1) + '" width="22" height="' + bh.toFixed(1) + '" rx="3"/>' : '<line class="nkx-tw0" x1="' + x + '" y1="111" x2="' + (x + 22) + '" y2="111"/>';
      }).join("");
      var ptc = "";
      if (TF.count === 0) for (var i = 0; i < TF.ptc; i++) ptc += '<rect class="nkx-ptc" x="' + (232 + (i % 5) * 18) + '" y="' + (40 + Math.floor(i / 5) * 24) + '" width="10" height="16" rx="2"/>';
      var svg = '<svg class="nkx-chart nkx-tof" viewBox="0 0 340 124" width="340" height="124" aria-hidden="true" focusable="false">' +
        '<line class="nkx-grid" x1="16" y1="112" x2="324" y2="112"/><line class="nkx-grid nkx-dash" x1="16" y1="16" x2="220" y2="16"/>' + bars + ptc + "</svg>";
      var scale = '<ol class="nkx-depths" aria-hidden="true">' + m.depths.map(function (k) { return '<li class="' + (k === d.depth ? "is-on" : "") + '">' + tx(m.names[k]) + "</li>"; }).join("") + "</ol>";
      var plan = "";
      function dose(p) {
        if (!p) return "";
        if (p.drug === "sugammadex") return '<p class="nkx-dose">' + (p.doseMg != null ? s("sugDose", { d: p.mgPerKg, m: p.doseMg }) : esc("Sugammadex " + p.mgPerKg + " mg/kg")) + "</p>";
        return '<p class="nkx-dose">' + (p.doseMg ? s("neoDose", { a: f1(p.doseMg[0]), b: f1(p.doseMg[1]) }) : esc("Neostigmine 40 to 50 mcg/kg")) + '</p><p class="sp-small">' + tx(p["with"]) + "</p>";
      }
      plan = '<h3 class="nkx-h3">' + s("plan") + '</h3><p class="nkx-p">' + tx(rv.text) + "</p>" + dose(rv.plan) + dose(rv.alt);
      return '<div class="nkx-plate nkx-plate-s">' + svg + "</div>" + scale +
        '<div class="nkx-readout" role="status" aria-live="polite"><p class="nkx-stage">' + tx(d.name) + '</p><p class="nkx-p">' + tx(d.reads) + "</p></div>" +
        (d.residual ? '<p class="nkx-alert">' + s("residual") + (d.qualitativeBlind ? " " + tx(m.notes.feel) : "") + "</p>" : "") + plan;
    },
    input: function (el) {
      var k = el.getAttribute("data-xin"), v = +el.value;
      TF[k] = v;
      setOut(el, k === "kg" ? raw("kg", { n: v }) : v.toFixed(2));
      repaintLive("tof"); touched("tof");
    }
  };
  A.nkxtfc = function (b) { TF.count = +b.getAttribute("data-v"); touched("tof"); again('[data-act="nkxtfc"][data-v="' + TF.count + '"]'); };
  A.nkxtfp = function (b) { TF.ptc = clamp(TF.ptc + +b.getAttribute("data-v"), 0, 15); touched("tof"); again('[data-act="nkxtfp"][data-v="' + b.getAttribute("data-v") + '"]:not([disabled])'); };
  A.nkxtff = function (b) { TF.family = b.getAttribute("data-v"); touched("tof"); again(); };

  /* ================= dermatomes ================= */
  var DM = { level: "T10", op: "hip" };
  // Original front-view figure: trunk and legs share one clip (shaded by height); the arms are shaded only for C5 to T1.
  var BODY = {
    head: '<ellipse cx="100" cy="28" rx="17" ry="21"/>',
    neck: '<path d="M91 46h18v16H91z"/>',
    trunk: '<path d="M60 70Q100 58 140 70L144 80Q148 124 138 162L138 196H62L62 162Q52 124 56 80Z"/>',
    legs: '<path d="M62 196H98L96 300 95 346H75L73 300Z"/><path d="M102 196H138L127 300 125 346H105L104 300Z"/>',
    arms: '<path d="M58 74 38 150 30 212 42 214 52 154 64 104Z"/><path d="M142 74 162 150 170 212 158 214 148 154 136 104Z"/>'
  };
  X.dermatomes = {
    test: { mcqTopic: "local-regional" },
    body: function (m) {
      var k = m.index(DM.level);
      return '<section class="nkx-sec nkx-first" aria-labelledby="nkxDmH"><h2 class="nkx-h" id="nkxDmH">' + s("level") + "</h2>" +
        '<div id="nkxLive">' + this.live(m) + "</div>" +
        range("level", s("level"), 0, m.levels.length - 1, 1, k, DM.level, DM.level) + "</section>" +
        '<section class="nkx-sec" aria-labelledby="nkxDmO"><h2 class="sp-h2" id="nkxDmO">' + s("operation") + "</h2>" +
        '<label class="nkx-field"><span class="sp-sr">' + s("operation") + '</span><select class="nkx-select" data-xin="op"><option value=""' + (DM.op ? "" : " selected") + ">" + s("none") + "</option>" +
        m.operations.map(function (o) { return '<option value="' + o.id + '"' + (o.id === DM.op ? " selected" : "") + ">" + tx(o.name) + " (" + o.level + ")</option>"; }).join("") + "</select></label>" +
        '<div id="nkxLive2">' + this.live2(m) + "</div></section>";
    },
    live: function (m) {
      var b = m.block(DM.level), y = DERM_Y[DM.level], sy = DERM_Y[b.sympathetic], armOn = b.index <= m.index("T1");
      var marks = m.landmarks.map(function (lm) { var ly = DERM_Y[lm.level]; return '<line class="nkx-lm' + (b.index <= m.index(lm.level) ? " is-on" : "") + '" x1="56" y1="' + ly + '" x2="144" y2="' + ly + '"/>'; }).join("");
      var svg = '<svg class="nkx-body" viewBox="0 0 200 360" width="200" height="360" aria-hidden="true" focusable="false">' +
        '<defs><clipPath id="nkxBodyClip">' + BODY.trunk + BODY.legs + "</clipPath></defs>" +
        '<g class="nkx-skin">' + BODY.head + BODY.neck + BODY.arms + BODY.trunk + BODY.legs + "</g>" +
        '<g class="nkx-blk' + (armOn ? " is-on" : "") + '">' + BODY.arms + "</g>" +
        '<rect class="nkx-blk is-on" clip-path="url(#nkxBodyClip)" x="40" y="' + y + '" width="120" height="' + (360 - y) + '"/>' +
        '<path class="nkx-blk is-on" d="M92 196 100 206 108 196Z"/>' +
        '<g class="nkx-outline">' + BODY.head + BODY.neck + BODY.arms + BODY.trunk + BODY.legs + "</g>" +
        '<circle class="nkx-pt" cx="82" cy="96" r="2.5"/><circle class="nkx-pt" cx="118" cy="96" r="2.5"/><path class="nkx-pt" d="M97 113 103 113 100 119Z"/><circle class="nkx-pt" cx="100" cy="156" r="2.5"/>' +
        marks + (sy < y ? '<line class="nkx-symp" x1="50" y1="' + sy + '" x2="150" y2="' + sy + '"/>' : "") +
        '<line class="nkx-lvl" x1="44" y1="' + y + '" x2="156" y2="' + y + '"/></svg>';
      var lm = '<ul class="nkx-lms">' + m.landmarks.map(function (x) {
        var on = b.index <= m.index(x.level);
        return '<li class="' + (on ? "is-on" : "") + '"><b>' + x.level + "</b><span>" + tx(x.name) + '</span><span class="sp-small">' + s(on ? "covered" : "notCovered") + "</span></li>";
      }).join("") + "</ul>";
      return '<div class="nkx-bodyrow"><figure class="nkx-fig" role="img" aria-label="' + esc(raw("bodyAlt", { l: DM.level })) + '">' + svg + "</figure>" +
        '<div class="nkx-bodyside"><div class="nkx-readout" role="status" aria-live="polite"><p class="nkx-big"><output>' + DM.level + "</output></p>" +
        '<p class="sp-small">' + s("symp", { l: b.sympathetic }) + "<br>" + s("motor", { l: b.motor }) + "</p></div>" +
        '<h3 class="nkx-h3">' + s("landmarks") + "</h3>" + lm + "</div></div>" + alertsHtml(b.warnings);
    },
    live2: function (m) {
      if (!DM.op) return "";
      var b = m.block(DM.level, DM.op), op = null;
      m.operations.forEach(function (o) { if (o.id === DM.op) op = o; });
      var o = b.operation;
      return '<div class="nkx-result is-' + (o.enough ? "ok" : "bad") + '" role="status"><p class="nkx-rt">' +
        (o.enough ? s("enough", { op: t(op.name), l: o.needs }) : s("notEnough", { op: t(op.name), l: o.needs, g: o.gap })) + "</p></div>";
    },
    input: function (el) {
      var m = M("dermatomes"), k = el.getAttribute("data-xin");
      if (k === "op") { DM.op = el.value; var l2 = $("nkxLive2"); if (l2) l2.innerHTML = X.dermatomes.live2(m); touched("dermatomes"); return; }
      DM.level = m.levels[+el.value];
      setOut(el, DM.level);
      repaintLive("dermatomes");
      var l3 = $("nkxLive2"); if (l3) l3.innerHTML = X.dermatomes.live2(m);
      touched("dermatomes");
    }
  };

  /* ================= ventilator ================= */
  function vStart() { return { mode: "vc", compliance: 50, resistance: 10, peep: 5, vt: 500, pinsp: 10, rate: 12, ie: 2 }; }
  var VS = vStart();
  var WBOX = { x: 4, y: 6, w: 332, h: 64 }, WVB = "0 0 340 76";
  function presetOf(m) { var r = null; Object.keys(m.presets).forEach(function (k) { var p = m.presets[k]; if (p.compliance === VS.compliance && p.resistance === VS.resistance) r = k; }); return r; }
  var VSL = { compliance: [10, 100, 5, " mL/cmH2O"], resistance: [2, 50, 1, " cmH2O/L/s"], peep: [0, 20, 1, " cmH2O"], vt: [200, 800, 10, " mL"], pinsp: [5, 35, 1, " cmH2O"], rate: [6, 35, 1, " /min"] };
  function vRange(k) { var c = VSL[k]; return range(k, s(k), c[0], c[1], c[2], VS[k], VS[k] + c[3], VS[k] + c[3]); }
  X.ventilator = {
    test: { mcqTopic: "icu-ventilation" },
    body: function (m) {
      var pre = presetOf(m);
      return '<section class="nkx-sec nkx-first" aria-labelledby="nkxVnH"><h2 class="nkx-h" id="nkxVnH">' + tx(m.title) + "</h2>" +
        seg("nkxvmode", s("mode"), [["vc", s("vc")], ["pc", s("pc")]], VS.mode, "nkxVmL") +
        '<div class="nkx-segrow"><span class="nkx-lbl" id="nkxVlL">' + s("lung") + '</span><div class="nkx-chips" role="group" aria-labelledby="nkxVlL">' + Object.keys(m.presets).map(function (k) {
          return '<button type="button" class="nkx-chip" data-act="nkxvpre" data-v="' + k + '" aria-pressed="' + (pre === k) + '">' + tx(m.presets[k].name) + "</button>";
        }).join("") + "</div></div>" +
        '<div id="nkxLive">' + this.live(m) + "</div></section>" +
        '<section class="nkx-sec" aria-labelledby="nkxVnS"><h2 class="sp-h2" id="nkxVnS">' + s("settings") + "</h2>" +
        vRange("compliance") + vRange("resistance") + vRange("peep") + vRange(VS.mode === "vc" ? "vt" : "pinsp") + vRange("rate") +
        seg("nkxvie", s("ie"), [[1, "1:1"], [2, "1:2"], [3, "1:3"], [4, "1:4"]], VS.ie, "nkxVieL") +
        '<button type="button" class="nkx-link" data-act="nkxvreset">' + s("reset") + "</button></section>";
    },
    live: function (m) {
      var r = m.breath(VS, 90), pts = twoBreaths(r.points), tmax = pts[pts.length - 1].t, xd = [0, tmax];
      var pmax = Math.max(40, Math.ceil(r.peak / 10) * 10), fmax = 0, vmax = Math.max(800, Math.ceil(r.vt / 100) * 100);
      pts.forEach(function (p) { fmax = Math.max(fmax, Math.abs(p.flow)); });
      fmax = Math.max(30, Math.ceil(fmax / 10) * 10);
      function wave(cls, key, yd, zero) {
        var z = zero != null ? '<line class="nkx-mz" x1="' + WBOX.x + '" y1="' + lin(zero, yd[0], yd[1], WBOX.y + WBOX.h, WBOX.y).toFixed(1) + '" x2="' + (WBOX.x + WBOX.w) + '" y2="' + lin(zero, yd[0], yd[1], WBOX.y + WBOX.h, WBOX.y).toFixed(1) + '"/>' : "";
        return '<svg class="nkx-wave" viewBox="' + WVB + '" width="340" height="76" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + z +
          '<path class="nkx-line ' + cls + '" d="' + pathOf(pts, "t", key, WBOX, xd, yd) + '"/></svg>';
      }
      var pp = r.peak, pl = r.plateau;
      function ch(cls, name, unit, top, svg) { return '<div class="nkx-ch ' + cls + '"><div class="nkx-ch-h"><span>' + name + '</span><span class="nkx-ch-u">' + esc(unit) + "</span></div>" + svg + "</div>"; }
      var monitor = '<div class="nkx-plate nkx-mon">' +
        ch("nkx-c-paw", s("paw"), "0 to " + pmax + " cmH2O", pmax, wave("nkx-art", "paw", [0, pmax])) +
        ch("nkx-c-flow", s("flow"), "±" + fmax + " L/min", fmax, wave("nkx-ecg", "flow", [-fmax, fmax], 0)) +
        ch("nkx-c-vol", s("volume"), "0 to " + vmax + " mL", vmax, wave("nkx-spo2", "volume", [0, vmax])) +
        '<dl class="nkx-num6"><div><dt>' + s("peak") + "</dt><dd>" + f1(pp) + '</dd></div><div><dt>' + s("plat") + "</dt><dd>" + f1(pl) + "</dd></div><div><dt>" + s("drive") + "</dt><dd>" + f1(r.driving) +
        "</dd></div><div><dt>" + s("totPeep") + "</dt><dd>" + f1(r.totalPeep) + "</dd></div><div><dt>" + s("vtOut") + "</dt><dd>" + r.vt + "</dd></div><div><dt>" + s("mv") + "</dt><dd>" + f1(r.minuteVolume) + "</dd></div></dl>" +
        '<p class="nkx-mon-u" aria-hidden="true">cmH2O · mL · L/min</p></div>';
      var pre = presetOf(m), lesson = pre && pre !== "normal" ? '<p class="nkx-p nkx-lesson">' + tx(m.lessons[VS.mode][pre]) + "</p>" : "";
      return '<figure class="nkx-figw" role="img" aria-label="' + esc(raw("waveAlt")) + '">' + monitor + "</figure>" +
        '<p class="sp-sr" role="status" aria-live="polite">' + s("ventSay", { a: f1(pp), b: f1(pl), c: f1(r.driving), v: r.vt }) + "</p>" + lesson + alertsHtml(r.alerts);
    },
    input: function (el) {
      var k = el.getAttribute("data-xin"), v = +el.value, wasPre = presetOf(M("ventilator"));
      VS[k] = v; setOut(el, v + VSL[k][3]);
      // the lung chips follow the sliders
      var pre = presetOf(M("ventilator"));
      if (pre !== wasPre) [].forEach.call(G.document.querySelectorAll('[data-act="nkxvpre"]'), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === pre)); });
      repaintLive("ventilator"); touched("ventilator");
    }
  };
  A.nkxvmode = function (b) { VS.mode = b.getAttribute("data-v"); touched("ventilator"); again('[data-act="nkxvmode"][data-v="' + VS.mode + '"]'); };
  A.nkxvpre = function (b) { var p = M("ventilator").presets[b.getAttribute("data-v")]; VS.compliance = p.compliance; VS.resistance = p.resistance; touched("ventilator"); again('[data-act="nkxvpre"][data-v="' + b.getAttribute("data-v") + '"]'); };
  A.nkxvie = function (b) { VS.ie = +b.getAttribute("data-v"); touched("ventilator"); again(); };
  A.nkxvreset = function () { VS = vStart(); again('[data-act="nkxvmode"][data-v="vc"]'); };

  /* ================= circuit ================= */
  var CI = { fgfI: 3, ve: 6, absorber: "fresh", part: null };
  // Original schematic: the circle runs clockwise from the absorber, up the inspiratory side to the patient and back.
  function circuitSvg(m, st) {
    var hl = function (p) { return CI.part === p ? " nkx-hl" : ""; };
    var co2In = st.inspiredCO2 > 0 ? " has-co2" : "", abs = CI.absorber;
    return '<svg class="nkx-circ" viewBox="0 0 340 244" width="340" height="244" aria-hidden="true" focusable="false">' +
      '<path class="nkx-tube nkx-tube-i' + co2In + hl("insp") + '" data-part="insp" d="M52 70V40H280V96"/>' +
      '<path class="nkx-tube nkx-tube-e' + hl("exp") + '" data-part="exp" d="M280 124V180H52V150"/>' +
      '<path class="nkx-flowline" d="M52 150V40H280V180H52Z"/>' +
      '<g data-part="fgf" class="nkx-part' + hl("fgf") + '"><rect x="82" y="4" width="16" height="20" rx="3"/><path d="M90 24V40"/><path class="nkx-arrow" d="M85 32 90 39 95 32"/></g>' +
      '<g data-part="insp" class="nkx-part' + hl("insp") + '"><circle cx="150" cy="40" r="11"/><path d="M143 47 157 33"/></g>' +
      '<g data-part="exp" class="nkx-part' + hl("exp") + '"><circle cx="200" cy="180" r="11"/><path d="M207 187 193 173"/></g>' +
      '<g data-part="y" class="nkx-part' + hl("y") + '"><path d="M280 96 292 110 280 124M292 110H306"/><ellipse class="nkx-lungs" cx="316" cy="104" rx="8" ry="14"/><ellipse class="nkx-lungs" cx="330" cy="104" rx="8" ry="14"/></g>' +
      '<g data-part="apl" class="nkx-part' + hl("apl") + '"><path d="M134 180V204"/><rect x="124" y="204" width="20" height="14" rx="3"/><path d="M129 211 133 207 137 215 141 211"/><path class="nkx-arrow" d="M134 218V236M129 230 134 237 139 230"/></g>' +
      '<g data-part="bag" class="nkx-part' + hl("bag") + '"><path d="M92 180V196"/><ellipse cx="92" cy="216" rx="14" ry="20"/></g>' +
      '<g data-part="absorber" class="nkx-part nkx-abs is-' + abs + hl("absorber") + '"><rect x="30" y="70" width="44" height="80" rx="6"/>' +
      '<rect class="nkx-gran" x="34" y="74" width="36" height="72" rx="3"/><rect class="nkx-used" x="34" y="' + (abs === "exhausted" ? 74 : abs === "partial" ? 110 : 146) + '" width="36" height="' + (abs === "exhausted" ? 72 : abs === "partial" ? 36 : 0) + '" rx="3"/></g></svg>';
  }
  X.circuit = {
    test: { mcqTopic: "monitoring-equipment" },
    body: function (m) {
      return '<section class="nkx-sec nkx-first" aria-labelledby="nkxCiH"><h2 class="nkx-h" id="nkxCiH">' + tx(m.title) + "</h2>" +
        '<div id="nkxLive">' + this.live(m) + "</div>" +
        '<h3 class="nkx-h3" id="nkxCiP">' + s("parts") + '</h3><div class="nkx-chips" role="group" aria-labelledby="nkxCiP">' + m.partOrder.map(function (p) {
          return '<button type="button" class="nkx-chip" data-act="nkxcipart" data-v="' + p + '" aria-pressed="' + (CI.part === p) + '">' + tx(m.parts[p].name) + "</button>";
        }).join("") + "</div>" + (CI.part ? '<p class="nkx-p nkx-role">' + tx(m.parts[CI.part].role) + "</p>" : "") + "</section>" +
        '<section class="nkx-sec" aria-labelledby="nkxCiS"><h2 class="sp-h2" id="nkxCiS">' + s("settings") + "</h2>" +
        range("fgf", s("fgf"), 0, FGF_STEPS.length - 1, 1, CI.fgfI, raw("lmin", { n: FGF_STEPS[CI.fgfI] }), raw("lmin", { n: FGF_STEPS[CI.fgfI] })) +
        range("ve", s("ve"), 3, 15, 0.5, CI.ve, raw("lmin", { n: CI.ve }), raw("lmin", { n: CI.ve })) +
        seg("nkxciabs", s("absorber"), Object.keys(m.absorbers).map(function (k) { return [k, tx(m.absorbers[k].name)]; }), CI.absorber, "nkxCiAL") + "</section>";
    },
    live: function (m) {
      var st = m.state({ fgf: FGF_STEPS[CI.fgfI], ve: CI.ve, absorber: CI.absorber }), cap = m.capnogram(st, 80);
      var top = st.runaway ? 400 : Math.max(50, Math.ceil((st.endTidalCO2 || 0) / 10) * 10 + 10);
      var cbox = { x: 4, y: 6, w: 332, h: 58 }, both = cap.concat(cap.slice(1).map(function (p) { return { x: p.x + 1, co2: p.co2 }; }));
      var capSvg = '<svg class="nkx-wave" viewBox="0 0 340 70" width="340" height="70" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<line class="nkx-mz" x1="4" y1="64" x2="336" y2="64"/><path class="nkx-line nkx-co2" d="' + pathOf(both, "x", "co2", cbox, [0, 2], [0, top]) + '"/></svg>';
      var iv = st.runaway ? raw("rising") : raw("mmhg", { n: f1(st.inspiredCO2) }), ev = st.runaway ? raw("rising") : raw("mmhg", { n: f1(st.endTidalCO2) });
      return '<figure class="nkx-fig nkx-figc" role="img" aria-label="' + esc(raw("circuitAlt")) + '">' + circuitSvg(m, st) + "</figure>" +
        '<div class="nkx-plate nkx-mon"><div class="nkx-ch nkx-c-co2"><div class="nkx-ch-h"><span>' + s("capno") + '</span><span class="nkx-ch-u">0 to ' + top + " mmHg</span></div>" + capSvg + "</div>" +
        '<dl class="nkx-num6 nkx-num3"><div><dt>' + s("insp") + "</dt><dd>" + (st.runaway ? "&gt;100" : f1(st.inspiredCO2)) + "</dd></div><div><dt>" + s("et") + "</dt><dd>" + (st.runaway ? "&gt;100" : f1(st.endTidalCO2)) +
        "</dd></div><div><dt>" + s("reb") + "</dt><dd>" + Math.round(st.rebreathedFraction * 100) + "%</dd></div></dl></div>" +
        '<p class="sp-sr" role="status" aria-live="polite">' + s("circSay", { i: iv, e: ev }) + "</p>" +
        '<p class="nkx-p"><b>' + tx(st.flowClass.name) + "</b> · " + s("lmin", { n: FGF_STEPS[CI.fgfI] }) + "</p>" +
        (st.washout && CI.absorber !== "fresh" ? '<p class="nkx-p">' + s("washout") + "</p>" : "") + alertsHtml(st.alerts);
    },
    input: function (el) {
      var k = el.getAttribute("data-xin"), v = +el.value;
      if (k === "fgf") { CI.fgfI = v; setOut(el, raw("lmin", { n: FGF_STEPS[v] })); } else { CI.ve = v; setOut(el, raw("lmin", { n: v })); }
      repaintLive("circuit"); touched("circuit");
    }
  };
  A.nkxcipart = function (b) { var p = b.getAttribute("data-v"); CI.part = CI.part === p ? null : p; touched("circuit"); again('[data-act="nkxcipart"][data-v="' + p + '"]'); };
  A.nkxciabs = function (b) { CI.absorber = b.getAttribute("data-v"); touched("circuit"); again('[data-act="nkxciabs"][data-v="' + CI.absorber + '"]'); };

  /* ================= wiring ================= */
  function onInput(e) {
    var el = e.target, id = curId();
    if (!el || !el.getAttribute || !el.getAttribute("data-xin") || !id || !X[id] || !X[id].input) return;
    if (el.tagName === "SELECT" ? e.type !== "change" : e.type !== "input") return;
    X[id].input(el);
  }
  function wire() {
    var el = I.root();
    if (!el || el._nkx) return;
    el._nkx = 1;
    el.addEventListener("input", onInput);
    el.addEventListener("change", onInput);
  }
  function register() {
    Object.keys(X).forEach(function (id) {
      var m = M(id);
      if (!m || host._explore.some(function (y) { return y.id === id; })) return;
      host.registerExplorer({ id: id, title: m.title, line: m.subtitle || m.title, icon: "compass", test: X[id].test,
        open: function (h, x, focusSel) {
          wire();
          var w = host._learn && host._learn._w;
          if (w && !w.ix && !w.err && host._learn.load) host._learn.load().then(function () { if (curId() === id) paint(id); });
          paint(id, focusSel);
        } });
    });
  }
  if (host._syncers) host._syncers.push(register);
  register();
})(typeof window !== "undefined" ? window : this);
