/* Tokós explorers: the six interactive screens on the specialty engine's explorer registry. ES5.
   Each explorer is drawn from its pure model in window.TOKOS_MODELS (tokos-models/explorer-<id>.js) and registers
   with host.registerExplorer once its model has loaded (the engine's model syncers run after tokos/models.json).
   Screens paint through host._exploreUI.frame; clicks go through the engine's data-act actions (a full repaint that
   keeps focus and scroll), sliders and selects update their live region in place so the control keeps focus.
   Every screen shows its level (MBBS or Resident), the "AI draft" review mark, "Learn this" links to the lessons that
   exist in the Learn index, and the model's sources and notes. Clinical numerals stay ASCII in Hindi.
   Node: module.exports = the pure view-model helpers (test/tokos-explore-ui.test.mjs). */
(function (G) {
  "use strict";
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure view-model helpers ================= */
  // ASCII signed number: "+2", "-2.5", "0".
  function signed(n) { return n > 0 ? "+" + String(n) : String(n); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  // Lessons for an explorer: the fixed list first, then any lesson whose test names the explorer; only lessons the
  // Learn index has, each with its unit's level.
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
  // Cycle chart: one SVG path per hormone over the plot box, x = day 1..L, y = relative level 0..1.
  var HORMONES = ["fsh", "lh", "e2", "p4"];
  function cycleX(day, L, box) { return box.x + (L > 1 ? (day - 1) / (L - 1) : 0) * box.w; }
  function cyclePaths(points, L, box) {
    var out = {};
    HORMONES.forEach(function (h) {
      out[h] = points.map(function (p, i) {
        var x = cycleX(p.day, L, box), y = box.y + (1 - p.levels[h]) * box.h;
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join("");
    });
    return out;
  }
  // POP-Q: the conventional 3 x 3 grid (Aa Ba C / gh pb tvl / Ap Bp D).
  var POPQ_GRID = [["Aa", "Ba", "C"], ["gh", "pb", "tvl"], ["Ap", "Bp", "D"]];
  // The UI's stepper bounds per point (the model's ranges; gh, pb and tvl have none in the model, 15 cm caps the UI).
  function popqBounds(id, tvl) {
    if (id === "Aa" || id === "Ap") return [-3, 3];
    if (id === "Ba" || id === "Bp") return [-3, tvl];
    if (id === "C" || id === "D") return [-tvl, tvl];
    if (id === "tvl") return [1, 15];
    return [0, 15];
  }
  function popqInput(pts, noD) {
    var p = {}, k;
    for (k in pts) if (Object.prototype.hasOwnProperty.call(pts, k)) p[k] = pts[k];
    if (noD) delete p.D;
    return p;
  }
  // Mechanism: the step at index i of the sequence for a start position.
  function mechStep(model, start, persistentOP, i) {
    var seq = model.sequence(start, { persistentOP: !!persistentOP });
    if (!seq.ok) return seq;
    var k = clamp(i, 0, seq.steps.length - 1);
    return { ok: true, i: k, n: seq.steps.length, step: seq.steps[k], movement: model.movements[k], seq: seq };
  }
  // Cervical pathway: path = [{step, result}] where the last entry has no result yet.
  function cxAdvance(path, result) { var p = path.slice(0, -1), cur = path[path.length - 1]; p.push({ step: cur.step, result: result }); return p; }
  function cxBack(path) { if (path.length < 2) return path.slice(); var p = path.slice(0, -2); p.push({ step: path[path.length - 2].step }); return p; }
  var PURE = { signed: signed, clamp: clamp, lessonsFor: lessonsFor, cycleX: cycleX, cyclePaths: cyclePaths, POPQ_GRID: POPQ_GRID,
    popqBounds: popqBounds, popqInput: popqInput, mechStep: mechStep, cxAdvance: cxAdvance, cxBack: cxBack };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  G.TOKOS_EXPLORE_UI = PURE;

  /* ================= browser: the six screens ================= */
  var host = G.TOKOS;
  if (!host || !host._internal || !host._exploreUI || !host.registerExplorer) return;
  var I = host._internal, A = I.ACTIONS, esc = I.esc, ico = I.ico, EXUI = host._exploreUI, D = G.SPECIALTY_DATA;
  function M(id) { var m = G.TOKOS_MODELS; return m && m[id]; }
  function L() { return I.lang(); }
  function t(o) { return D.t(o, L()); }

  var STR = {
    mbbs: T("MBBS", "MBBS"), resident: T("Resident", "रेज़िडेंट"),
    draft: T("AI draft, awaiting specialist review", "AI ड्राफ़्ट, विशेषज्ञ समीक्षा बाकी"),
    learnThis: T("Learn this", "यह सीखें"), min: T("{n} min", "{n} मिनट"),
    sources: T("Sources and notes", "स्रोत और टिप्पणियाँ"),
    loading: T("Loading\u2026", "लोड हो रहा है\u2026"), retry: T("Try again", "फिर कोशिश करें"),
    loadErr: T("This could not load. Check your connection and try again.", "यह लोड नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।"),
    // mechanism
    mvStep: T("Movement {i} of {n}", "चरण {i} / {n}"), prev: T("Previous", "पिछला"), next: T("Next", "अगला"),
    engagesAs: T("Head engages as", "सिर इस स्थिति में engage होता है"), stayOP: T("Occiput stays posterior", "Occiput पीछे ही रहता है"),
    stayOPHint: T("Pick a posterior start (LOP, OP or ROP) to try a persistent occiput posterior.", "Persistent occiput posterior देखने के लिए पीछे की स्थिति (LOP, OP या ROP) चुनें।"),
    what: T("What happens", "क्या होता है"), why: T("Why", "क्यों"), parts: T("Show a part", "कोई हिस्सा दिखाएँ"),
    noTurn: T("The head does not turn at this step: {p}.", "इस कदम पर सिर नहीं घूमता: {p}।"),
    turn: T("The occiput turns {d} degrees, {dir} as seen from below: {a} to {b}.", "Occiput {d} डिग्री घूमता है, नीचे से देखने पर {dir}: {a} से {b}।"),
    clockwise: T("clockwise", "घड़ी की दिशा में"), anticlockwise: T("anticlockwise", "घड़ी की उलटी दिशा में"), either: T("either way", "किसी भी दिशा में"),
    bornAs: T("Born as {p}.", "जन्म {p} स्थिति में।"),
    station: T("Station", "Station"), stationLine: T("0 is the level of the ischial spines; each step is 1 cm. +5 is the head visible at the introitus.", "0 ischial spines का स्तर है; हर कदम 1 cm है। +5 पर सिर introitus पर दिखता है।"),
    figAlt: T("{m}: side view and view from below", "{m}: बगल से और नीचे से दृश्य"),
    // cycle
    day: T("Day", "दिन"), dayOf: T("Day {d} of {n}", "दिन {d} / {n}"), cycleLen: T("Cycle length", "चक्र की लंबाई"), days: T("{n} days", "{n} दिन"),
    shorter: T("Shorter cycle", "छोटा चक्र"), longer: T("Longer cycle", "लंबा चक्र"),
    relTitle: T("Relative levels", "सापेक्ष स्तर"),
    relShort: T("Each line is scaled to its own peak. Not lab values.", "हर रेखा अपने ही सबसे ऊँचे बिंदु के पैमाने पर है। Lab मान नहीं।"),
    ovulation: T("Ovulation about day {d}", "Ovulation लगभग दिन {d}"), ovary: T("Ovary", "अंडाशय"), lining: T("Lining", "Endometrium"),
    phase: T("Phase", "चरण"), follicular: T("Follicular", "Follicular"), ovulationP: T("Ovulation", "Ovulation"), luteal: T("Luteal", "Luteal"),
    growing: T("Several follicles growing", "कई follicles बढ़ रहे हैं"), dominant: T("One dominant follicle", "एक dominant follicle"), ovulating: T("Follicle releasing the egg", "Follicle अंडा छोड़ रहा है"),
    "corpus-luteum": T("Corpus luteum working", "Corpus luteum काम कर रहा है"), "corpus-luteum-regressing": T("Corpus luteum fading", "Corpus luteum घट रहा है"),
    menstrual: T("Menstrual: shedding", "Menstrual: झड़ रहा है"), proliferative: T("Proliferative: building up", "Proliferative: बढ़ रहा है"), secretory: T("Secretory: ready for implantation", "Secretory: implantation के लिए तैयार"),
    ofPeak: T("{p}% of its own peak", "अपने शिखर का {p}%"),
    // palm-coein
    caseOf: T("Case {i} of {n}", "केस {i} / {n}"), pickAll: T("Pick every cause that fits", "हर उपयुक्त कारण चुनें"),
    structural: T("PALM: structural", "PALM: संरचनात्मक"), nonStructural: T("COEIN: not structural", "COEIN: गैर-संरचनात्मक"),
    fibroidGroup: T("Fibroid group", "फाइब्रॉइड समूह"), sm: T("Submucosal (SM)", "Submucosal (SM)"), o: T("Other (O)", "Other (O)"),
    check: T("Check", "जाँचें"), nextCase: T("Next case", "अगला केस"), prevCase: T("Previous case", "पिछला केस"), tryAgain: T("Try again", "फिर कोशिश करें"),
    right: T("Correct", "सही"), notQuite: T("Not quite", "पूरी तरह सही नहीं"), missed: T("Missed: {x}", "छूट गया: {x}"), extra: T("Not supported by this case: {x}", "इस केस में आधार नहीं: {x}"),
    leioWant: T("Fibroid group: {x}", "फाइब्रॉइड समूह: {x}"), answer: T("Answer: {x}", "उत्तर: {x}"),
    score: T("{c} of {n} right this session", "इस सत्र में {n} में से {c} सही"), noCases: T("No cases to practise yet.", "अभ्यास के लिए अभी कोई केस नहीं।"),
    // popq
    points: T("The nine points", "नौ points"), gridHint: T("Tap a point, then set it in cm against the hymen (negative is inside).", "कोई point चुनें, फिर hymen के सापेक्ष cm में सेट करें (negative अंदर है)।"),
    less: T("Decrease {p}", "{p} घटाएँ"), more: T("Increase {p}", "{p} बढ़ाएँ"), noD: T("No cervix (after hysterectomy)", "Cervix नहीं (hysterectomy के बाद)"),
    none: T("none", "नहीं"), stage: T("Stage {s}", "Stage {s}"), leading: T("Leading edge: {p} at {v} cm", "Leading edge: {p}, {v} cm पर"),
    anterior: T("Anterior", "Anterior"), apical: T("Apical", "Apical"), posterior: T("Posterior", "Posterior"),
    illustrative: T("Starting values are illustrative, not a patient.", "शुरुआती मान केवल उदाहरण हैं, कोई मरीज़ नहीं।"), reset: T("Reset", "रीसेट"),
    // ovarian
    benignF: T("Benign features (B)", "Benign features (B)"), malignantF: T("Malignant features (M)", "Malignant features (M)"),
    pickF: T("Tick every feature the scan shows.", "Scan में दिखने वाला हर feature चुनें।"),
    benign: T("Benign", "Benign"), malignant: T("Malignant", "Malignant"), inconclusive: T("Inconclusive", "Inconclusive"),
    result: T("Result", "परिणाम"), nothingYet: T("No feature ticked yet. With none, the rules are inconclusive.", "अभी कोई feature नहीं चुना। कोई न हो तो rules inconclusive रहते हैं।"),
    rmi: T("Risk of malignancy index calculator", "Risk of malignancy index कैलकुलेटर"),
    perf: T("In the IOTA validation ({p} patients) the rules gave a result in {c}; sensitivity {s}, specificity {sp}.", "IOTA validation ({p} मरीज़) में rules ने {c} में परिणाम दिया; sensitivity {s}, specificity {sp}।"),
    clear: T("Clear", "साफ़ करें"), backExplore: T("Back to explorer", "एक्सप्लोरर पर वापस"),
    // cervical
    decision: T("Decision", "निर्णय"), action: T("Action", "कार्य"), end: T("End of pathway", "Pathway का अंत"),
    so: T("So far", "अब तक"), backStep: T("Back one step", "एक कदम पीछे"), restart: T("Start again", "फिर से शुरू करें"),
    cryoCheck: T("Is the lesion eligible for cryotherapy?", "क्या घाव cryotherapy के योग्य है?"), quadrants: T("Quadrants involved", "प्रभावित quadrants"),
    eligible: T("Eligible for cryotherapy", "Cryotherapy के योग्य"), notEligible: T("Not eligible for cryotherapy", "Cryotherapy के योग्य नहीं"), suggested: T("matches your check", "आपकी जाँच से मेल खाता है"),
    ectocervixOnly: T("Confined to the ectocervix", "केवल ectocervix तक सीमित"), fullyVisible: T("Visible in its entire extent", "पूरा दिखाई देता है"),
    coverableByProbe: T("The largest probe covers it", "सबसे बड़ी probe इसे ढक लेती है"), suspectInvasive: T("Invasive cancer suspected", "Invasive cancer का संदेह"),
    postcoitalBleeding: T("Postcoital bleeding", "Postcoital bleeding"), postmenopausalBleeding: T("Postmenopausal bleeding", "Postmenopausal bleeding"),
    overtGrowth: T("Overt cervical growth", "Cervix पर दिखता growth"), irregularSurface: T("Irregular surface", "अनियमित सतह"), bleedsOnTouch: T("Bleeds on touch", "छूने पर खून आता है"),
    guideline: T("Guideline: {g}, {v}", "Guideline: {g}, {v}")
  };
  function s(key, v) { return esc(t(STR[key])).replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
  function raw(key, v) { return t(STR[key]).replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? String(v[x]) : m; }); }
  function tx(o) { return I.tx(o); }
  function $(id) { return G.document.getElementById(id); }
  function curId() { return EXUI._x && EXUI._x.id; }

  /* ---- shared parts ---- */
  function metaHtml(level) {
    return '<p class="tkx-meta"><span class="tkx-lv">' + s(level === "resident" ? "resident" : "mbbs") + '</span><span class="tkx-draft">' + s("draft") + "</span></p>";
  }
  var FIXED_LESSONS = {
    mechanism: ["ob3-mechanism", "ob3-pelvis-head"], cycle: ["gy7-ovulation"], "palm-coein": ["gyr2-adolescent-hmb"], popq: ["gyr4-popq-pessary"],
    "ovarian-triage": ["gy11-ultrasound-iota", "gy11-rmi", "gyr5-adnexal-triage"], "cervical-screening": ["gy10-who-when", "gy10-three-tests", "gy10-positive-result"]
  };
  function learnHtml(id) {
    var w = host._learn && host._learn._w, list = lessonsFor(id, w && w.ix, FIXED_LESSONS[id]);
    if (!list.length) return "";
    return '<section class="tkx-sec" aria-labelledby="tkxLearnH"><h2 class="sp-h2" id="tkxLearnH">' + s("learnThis") + '</h2><ul class="sp-rows">' + list.map(function (l) {
      return I.row("lesson", ' data-l="' + esc(l.id) + '"', I.tile("book"), tx(l.title), (l.minutes ? s("min", { n: I.fmt(l.minutes) }) + " · " : "") + s(l.level), "");
    }).join("") + "</ul></section>";
  }
  function srcHtml(m, extra) {
    var notes = m.notes || {}, keys = Object.keys(notes);
    return '<details class="tkx-src"><summary>' + s("sources") + '</summary><div class="tkx-src-b">' + (extra || "") +
      (keys.length ? '<ul class="tkx-notes">' + keys.map(function (k) { return notes[k] && notes[k].en ? "<li>" + tx(notes[k]) + "</li>" : ""; }).join("") + "</ul>" : "") +
      '<ol class="tkx-refs">' + (m.sources || []).map(function (x) {
        return "<li>" + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.label || x.url) + "</a>" : esc(x.label)) + "</li>";
      }).join("") + "</ol></div></details>";
  }
  function loadingHtml() { return '<div class="tkx-sk" aria-busy="true"><span class="sp-sr" role="status">' + s("loading") + "</span></div>"; }
  function errHtml(act) { return '<div class="sp-err" role="alert"><p>' + s("loadErr") + '</p><button type="button" class="sp-btn pri" data-act="' + act + '">' + ico("refresh") + " " + s("retry") + "</button></div>"; }
  function touched(id) { EXUI.mark(id); }

  var X = {}; // id -> {test, body(), live?(), input?(el), key?(e), after?()}
  function paint(id, focusSel) {
    var x = X[id];
    if (!x) return;
    var m = M(id);
    EXUI.frame(id, '<div class="tkx" data-tkx="' + id + '">' + metaHtml(m.level) + x.body(m) + learnHtml(id) + srcHtml(m, x.srcExtra ? x.srcExtra(m) : "") + "</div>", focusSel);
    if (x.after) x.after(m);
  }
  function repaintLive(id) { var x = X[id], el = $("tkxLive"); if (x && x.live && el) { el.innerHTML = x.live(M(id)); if (x.after) x.after(M(id)); } }
  function again() { var id = curId(); if (id) paint(id); }

  /* ================= mechanism ================= */
  var MS = { start: "LOT", op: false, i: 0, station: 0, part: null, svg: {}, err: {}, busy: {} };
  function frameUrl(file) { return I.BASE + String(file).replace(/^tokos\//, ""); }
  function loadSvg(file) {
    if (MS.svg[file] || MS.busy[file]) return;
    MS.busy[file] = 1; MS.err[file] = 0;
    G.fetch(frameUrl(file)).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.text(); }).then(function (txt) {
      MS.svg[file] = txt;
    }, function () { MS.err[file] = 1; }).then(function () { MS.busy[file] = 0; if (curId() === "mechanism") paint("mechanism"); });
  }
  X.mechanism = {
    test: { mcqTopic: "ob-labour" },
    body: function (m) {
      var r = mechStep(m, MS.start, MS.op, MS.i), st = r.step, mv = r.movement, file = mv.file, pos = m.positions;
      var fam = pos[MS.start].family, fig = MS.svg[file]
        ? '<div class="tkx-fig" role="img" aria-label="' + esc(raw("figAlt", { m: t(mv.title) })) + '">' + MS.svg[file] + "</div>"
        : MS.err[file] ? errHtml("tkxmsvg") : '<div class="tkx-fig tkx-fig-sk" aria-busy="true"><span class="sp-sr" role="status">' + s("loading") + "</span></div>";
      if (!MS.svg[file] && !MS.err[file]) loadSvg(file);
      var segs = r.seq.steps.map(function (x, k) {
        return '<button type="button" class="tkx-segn" data-act="tkxmgo" data-v="' + k + '"' + (k === r.i ? ' aria-current="step"' : "") + ' aria-label="' + esc(t(m.movements[k].title)) + '">' + (k + 1) + "</button>";
      }).join("");
      var turn = st.degrees ? s("turn", { d: st.degrees, dir: raw(st.direction), a: st.before, b: st.after }) : s("noTurn", { p: st.before });
      var notes = r.i === r.n - 1 ? [raw("bornAs", { p: r.seq.bornAs })].concat(r.seq.notes.map(t)) : [];
      return '<section class="tkx-sec tkx-first" aria-labelledby="tkxMvH">' +
        '<div class="tkx-steps" role="group" aria-label="' + s("mvStep", { i: r.i + 1, n: r.n }) + '">' + segs + "</div>" +
        '<h2 class="tkx-h" id="tkxMvH"><span class="sp-small">' + s("mvStep", { i: r.i + 1, n: r.n }) + "</span>" + tx(mv.title) + "</h2>" +
        fig +
        '<div class="tkx-pair"><button type="button" class="sp-btn sec" data-act="tkxmstep" data-v="-1"' + (r.i ? "" : " disabled") + ">" + s("prev") + '</button><button type="button" class="sp-btn pri" data-act="tkxmstep" data-v="1"' + (r.i < r.n - 1 ? "" : " disabled") + ">" + s("next") + "</button></div>" +
        '<p class="tkx-lead">' + tx(mv.what) + "</p>" + (mv.why ? '<p class="tkx-p"><b>' + s("why") + ".</b> " + tx(mv.why) + "</p>" : "") +
        '<p class="tkx-p tkx-turn">' + turn + "</p>" + notes.map(function (n) { return '<p class="tkx-p">' + esc(n) + "</p>"; }).join("") +
        (mv.parts && mv.parts.length ? '<h3 class="tkx-h3">' + s("parts") + '</h3><div class="tkx-chips">' + mv.parts.map(function (p) {
          return '<button type="button" class="tkx-chip" data-act="tkxmpart" data-v="' + esc(p) + '" aria-pressed="' + (MS.part === p) + '">' + tx(m.parts[p]) + "</button>";
        }).join("") + "</div>" : "") + "</section>" +
        '<section class="tkx-sec" aria-labelledby="tkxPosH"><h2 class="sp-h2" id="tkxPosH">' + s("engagesAs") + "</h2>" +
        '<label class="tkx-field"><span class="sp-sr">' + s("engagesAs") + '</span><select class="tkx-select" data-xin="start">' + m.positionOrder.map(function (p) {
          return '<option value="' + p + '"' + (p === MS.start ? " selected" : "") + ">" + tx(pos[p].name) + "</option>";
        }).join("") + "</select></label>" +
        '<button type="button" class="tkx-toggle" data-act="tkxmop" aria-pressed="' + (MS.op && fam === "posterior") + '"' + (fam === "posterior" ? "" : ' disabled aria-describedby="tkxOpHint"') + '><span class="tkx-box" aria-hidden="true"></span>' + s("stayOP") + "</button>" +
        (fam === "posterior" ? "" : '<p class="sp-small" id="tkxOpHint">' + s("stayOPHint") + "</p>") + "</section>" +
        '<section class="tkx-sec" aria-labelledby="tkxStH"><h2 class="sp-h2" id="tkxStH">' + s("station") + "</h2>" +
        '<div id="tkxLive">' + this.live(m) + "</div>" +
        '<input type="range" class="tkx-range" data-xin="station" min="' + m.stationScale.min + '" max="' + m.stationScale.max + '" step="1" value="' + MS.station + '" aria-label="' + s("station") + '" aria-valuetext="' + esc(signed(MS.station) + " cm") + '">' +
        '<div class="tkx-ticks" aria-hidden="true"><span>-5</span><span>0</span><span>+5</span></div><p class="sp-small">' + s("stationLine") + "</p></section>";
    },
    live: function (m) {
      var r = m.station(MS.station);
      return '<p class="tkx-out"><output class="tkx-num">' + esc(signed(MS.station)) + ' cm</output><span>' + tx(r.label) + "</span></p>";
    },
    input: function (el) {
      var k = el.getAttribute("data-xin");
      if (k === "station") { MS.station = +el.value; el.setAttribute("aria-valuetext", signed(MS.station) + " cm"); repaintLive("mechanism"); }
      else if (k === "start") { MS.start = el.value; if (M("mechanism").positions[MS.start].family !== "posterior") MS.op = false; paint("mechanism", '[data-xin="start"]'); }
      touched("mechanism");
    },
    after: function () {
      var box = G.document.querySelector(".tkx-fig");
      if (!box) return;
      [].forEach.call(box.querySelectorAll("[data-part]"), function (el) { el.classList.toggle("tkx-hl", el.getAttribute("data-part") === MS.part); });
      var svg = box.querySelector("svg");
      if (svg) { svg.setAttribute("aria-hidden", "true"); svg.removeAttribute("width"); svg.removeAttribute("height"); }
    },
    key: function (e) {
      var tg = e.target && e.target.tagName;
      if (tg === "INPUT" || tg === "SELECT" || tg === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); mstep(e.key === "ArrowRight" ? 1 : -1); }
    }
  };
  function mstep(d) { var n = M("mechanism").movements.length, k = clamp(MS.i + d, 0, n - 1); if (k === MS.i) return; MS.i = k; MS.part = null; touched("mechanism"); paint("mechanism", '[data-act="tkxmstep"][data-v="' + d + '"]:not([disabled])'); }
  A.tkxmstep = function (b) { mstep(+b.getAttribute("data-v")); };
  A.tkxmgo = function (b) { MS.i = +b.getAttribute("data-v"); MS.part = null; touched("mechanism"); again(); };
  A.tkxmpart = function (b) { var p = b.getAttribute("data-v"); MS.part = MS.part === p ? null : p; touched("mechanism"); again(); };
  A.tkxmop = function () { MS.op = !MS.op; touched("mechanism"); again(); };
  A.tkxmsvg = function () { MS.err = {}; again(); };

  /* ================= cycle ================= */
  var CS = { len: 28, day: 14, curves: {} };
  var BOX = { x: 6, y: 8, w: 328, h: 140 }, VB = "0 0 340 156";
  function curveOf(m, len) { return CS.curves[len] || (CS.curves[len] = m.curve(len, 0.25)); }
  X.cycle = {
    test: { mcqTopic: "gy-menstrual" },
    body: function (m) {
      var c = m.constants;
      return '<section class="tkx-sec tkx-first" aria-labelledby="tkxCyH"><h2 class="tkx-h" id="tkxCyH">' + s("relTitle") + '<span class="sp-small">' + s("relShort") + "</span></h2>" +
        '<div id="tkxLive">' + this.live(m) + "</div>" +
        '<label class="tkx-field tkx-dayfield"><span class="tkx-lbl">' + s("day") + '</span><input type="range" class="tkx-range" data-xin="day" min="1" max="' + CS.len + '" step="1" value="' + CS.day + '" aria-valuetext="' + esc(raw("dayOf", { d: CS.day, n: CS.len })) + '"></label>' +
        '<div class="tkx-stepper" role="group" aria-label="' + s("cycleLen") + '"><span class="tkx-lbl">' + s("cycleLen") + "</span>" +
        '<button type="button" class="tkx-icon" data-act="tkxclen" data-v="-1" aria-label="' + s("shorter") + '"' + (CS.len > c.minLength ? "" : " disabled") + ">\u2212</button>" +
        '<output class="tkx-num" aria-live="polite">' + s("days", { n: CS.len }) + "</output>" +
        '<button type="button" class="tkx-icon" data-act="tkxclen" data-v="1" aria-label="' + s("longer") + '"' + (CS.len < c.maxLength ? "" : " disabled") + ">+</button></div></section>";
    },
    live: function (m) {
      var cv = curveOf(m, CS.len), p = cyclePaths(cv.points, CS.len, BOX), a = m.at(CS.day, CS.len);
      var x = cycleX(CS.day, CS.len, BOX), ox = cycleX(a.ovulationDay, CS.len, BOX), mx = cycleX(Math.min(m.constants.menstrualDays, CS.len), CS.len, BOX);
      var svg = '<svg class="tkx-chart" viewBox="' + VB + '" aria-hidden="true" focusable="false" preserveAspectRatio="none">' +
        '<rect class="tkx-menses" x="' + BOX.x + '" y="' + BOX.y + '" width="' + (mx - BOX.x).toFixed(1) + '" height="' + BOX.h + '"/>' +
        '<line class="tkx-base" x1="' + BOX.x + '" y1="' + (BOX.y + BOX.h) + '" x2="' + (BOX.x + BOX.w) + '" y2="' + (BOX.y + BOX.h) + '"/>' +
        '<line class="tkx-ovl" x1="' + ox.toFixed(1) + '" y1="' + BOX.y + '" x2="' + ox.toFixed(1) + '" y2="' + (BOX.y + BOX.h) + '"/>' +
        HORMONES.map(function (h) { return '<path class="tkx-c tkx-' + h + '" d="' + p[h] + '"/>'; }).join("") +
        '<line class="tkx-cur" x1="' + x.toFixed(1) + '" y1="2" x2="' + x.toFixed(1) + '" y2="' + (BOX.y + BOX.h + 6) + '"/></svg>';
      var pct = function (v) { return Math.round(v * 100); };
      var legend = '<ul class="tkx-legend">' + HORMONES.map(function (h) {
        return '<li><svg class="tkx-key" viewBox="0 0 24 8" aria-hidden="true"><path class="tkx-c tkx-' + h + '" d="M1 4H23"/></svg><b>' + tx(m.hormones[h].name) +
          '</b><span class="tkx-bar tkx-' + h + '" style="width:' + pct(a.levels[h]) + '%" aria-hidden="true"></span><span class="sp-sr">' + s("ofPeak", { p: pct(a.levels[h]) }) + "</span></li>";
      }).join("") + "</ul>";
      var ov = a.ovarian === "ovulation" ? "ovulationP" : a.ovarian;
      return '<div class="tkx-chartwrap">' + svg + '<div class="tkx-axis" aria-hidden="true"><span>1</span><span style="left:' + ((ox - BOX.x) / BOX.w * 100).toFixed(1) + '%">' + a.ovulationDay + "</span><span>" + CS.len + "</span></div></div>" +
        legend +
        '<p class="tkx-daybig" aria-live="polite"><b>' + s("dayOf", { d: CS.day, n: CS.len }) + "</b> " + s("ovulation", { d: a.ovulationDay }) + "</p>" +
        '<dl class="tkx-kv"><div><dt>' + s("phase") + "</dt><dd>" + s(ov) + "</dd></div><div><dt>" + s("ovary") + "</dt><dd>" + s(a.follicle) + "</dd></div><div><dt>" + s("lining") + "</dt><dd>" + s(a.endometrium) + "</dd></div></dl>" +
        '<p class="tkx-p">' + tx(a.phaseText) + "</p>";
    },
    input: function (el) {
      CS.day = +el.value; el.setAttribute("aria-valuetext", raw("dayOf", { d: CS.day, n: CS.len }));
      repaintLive("cycle"); touched("cycle");
    }
  };
  A.tkxclen = function (b) {
    var c = M("cycle").constants; CS.len = clamp(CS.len + +b.getAttribute("data-v"), c.minLength, c.maxLength); CS.day = Math.min(CS.day, CS.len);
    touched("cycle"); again();
  };

  /* ================= palm-coein ================= */
  var PC = { status: "idle", i: 0, sel: [], leio: null, graded: null, n: 0, c: 0 };
  function pcLoad() {
    PC.status = "loading";
    I.getJSON("explorer/palm-coein.json").then(function (d) {
      var r = M("palm-coein").setVignettes((d && d.vignettes) || []);
      PC.status = r.ok ? "ok" : "err";
    }, function () { PC.status = "err"; }).then(function () { if (curId() === "palm-coein") paint("palm-coein"); });
  }
  X["palm-coein"] = {
    test: { mcqTopic: "gy-menstrual" },
    body: function (m) {
      if (PC.status === "idle") pcLoad();
      if (PC.status === "loading" || PC.status === "idle") return loadingHtml();
      if (PC.status === "err") return errHtml("tkxpcretry");
      var vs = m.vignettes || [];
      if (!vs.length) return '<p class="tkx-p">' + s("noCases") + "</p>";
      var v = vs[PC.i], g = PC.graded, hasL = PC.sel.indexOf("L") >= 0;
      function chip(c) {
        return '<button type="button" class="tkx-toggle" data-act="tkxpc" data-v="' + c.code + '" aria-pressed="' + (PC.sel.indexOf(c.code) >= 0) + '"' + (g ? " disabled" : "") +
          '><span class="tkx-box" aria-hidden="true"></span><span class="tkx-tg-b"><b><span class="tkx-code" translate="no">' + c.code + "</span> " + tx(c.name) + '</b><span class="sp-small">' + tx(c.def) + "</span></span></button>";
      }
      var cats = m.categories, fb = "";
      if (g) {
        var names = function (codes) { return codes.map(function (k) { for (var i = 0; i < cats.length; i++) if (cats[i].code === k) return k + " " + t(cats[i].name); return k; }).join(", "); };
        fb = '<div class="tkx-result ' + (g.correct ? "is-ok" : "is-bad") + '" role="status"><p class="tkx-rt">' + s(g.correct ? "right" : "notQuite") + "</p>" +
          (g.missing.length ? '<p class="tkx-p">' + s("missed", { x: names(g.missing) }) + "</p>" : "") +
          (g.extra.length ? '<p class="tkx-p">' + s("extra", { x: names(g.extra) }) + "</p>" : "") +
          (g.leiomyoma && !g.leiomyoma.ok ? '<p class="tkx-p">' + s("leioWant", { x: g.leiomyoma.expected }) + "</p>" : "") +
          '<p class="tkx-p"><b>' + s("answer", { x: g.expected.notation }) + "</b></p><p class=\"tkx-p\">" + tx(v.teach) + "</p></div>";
      }
      return '<section class="tkx-sec tkx-first" aria-labelledby="tkxPcH">' +
        '<p class="tkx-caseline"><span class="sp-small">' + s("caseOf", { i: PC.i + 1, n: vs.length }) + " · " + s(v.level === "resident" ? "resident" : "mbbs") + '</span><span class="sp-small">' + (PC.n ? s("score", { c: PC.c, n: PC.n }) : "") + "</span></p>" +
        '<h2 class="tkx-h" id="tkxPcH">' + tx(v.title) + '</h2><p class="tkx-stem">' + tx(v.stem) + "</p></section>" +
        '<section class="tkx-sec" aria-labelledby="tkxPcP"><h2 class="sp-h2" id="tkxPcP">' + s("pickAll") + "</h2>" +
        '<h3 class="tkx-h3">' + s("structural") + '</h3><div class="tkx-list">' + cats.filter(function (c) { return c.group === "structural"; }).map(chip).join("") + "</div>" +
        (hasL ? '<div class="tkx-sub"><span class="tkx-lbl" id="tkxLeioL">' + s("fibroidGroup") + '</span><div class="sp-seg" role="group" aria-labelledby="tkxLeioL">' +
          ["SM", "O"].map(function (k) { return '<button type="button" data-act="tkxpcleio" data-v="' + k + '" aria-pressed="' + (PC.leio === k) + '"' + (g ? " disabled" : "") + ">" + s(k.toLowerCase()) + "</button>"; }).join("") + "</div></div>" : "") +
        '<h3 class="tkx-h3">' + s("nonStructural") + '</h3><div class="tkx-list">' + cats.filter(function (c) { return c.group !== "structural"; }).map(chip).join("") + "</div>" +
        '<div id="tkxLive">' + fb + "</div>" +
        (g ? '<div class="tkx-pair"><button type="button" class="sp-btn sec" data-act="tkxpcagain">' + s("tryAgain") + '</button><button type="button" class="sp-btn pri" data-act="tkxpcnext" data-v="1">' + s("nextCase") + "</button></div>"
          : '<button type="button" class="sp-btn pri sp-wide tkx-go" data-act="tkxpccheck"' + (PC.sel.length ? "" : " disabled") + ">" + s("check") + "</button>") +
        '<div class="tkx-pair tkx-quiet"><button type="button" class="sp-btn sec" data-act="tkxpcnext" data-v="-1"' + (PC.i ? "" : " disabled") + ">" + s("prevCase") + "</button>" +
        (g ? "" : '<button type="button" class="sp-btn sec" data-act="tkxpcnext" data-v="1"' + (PC.i < vs.length - 1 ? "" : " disabled") + ">" + s("nextCase") + "</button>") + "</div></section>";
    }
  };
  A.tkxpcretry = function () { PC.status = "idle"; again(); };
  A.tkxpc = function (b) { var c = b.getAttribute("data-v"), k = PC.sel.indexOf(c); if (k >= 0) PC.sel.splice(k, 1); else PC.sel.push(c); if (c === "L" && k >= 0) PC.leio = null; touched("palm-coein"); again(); };
  A.tkxpcleio = function (b) { PC.leio = b.getAttribute("data-v"); again(); };
  A.tkxpccheck = function () {
    var m = M("palm-coein"), v = m.vignettes[PC.i];
    PC.graded = m.grade(v, { codes: PC.sel.slice(), leiomyoma: PC.leio || undefined });
    PC.n++; if (PC.graded.correct) PC.c++;
    touched("palm-coein"); I.haptic(PC.graded.correct ? "success" : "warning");
    paint("palm-coein", '[data-act="tkxpcnext"][data-v="1"]');
  };
  A.tkxpcagain = function () { PC.graded = null; again(); };
  A.tkxpcnext = function (b) {
    var n = M("palm-coein").vignettes.length; PC.i = clamp(PC.i + +b.getAttribute("data-v"), 0, n - 1); PC.sel = []; PC.leio = null; PC.graded = null;
    paint("palm-coein", "#tkxPcH");
    var sc = $("exScroll"); if (sc) sc.scrollTop = 0;
  };

  /* ================= popq ================= */
  function popqStart() { return { Aa: -3, Ba: -3, C: -8, D: -10, Ap: -3, Bp: -3, gh: 3, pb: 3, tvl: 10 }; }
  var PQ = { pts: popqStart(), noD: false, sel: "Ba" };
  X.popq = {
    test: { mcqTopic: "gy-urogyn" },
    body: function (m) {
      var byId = {};
      m.points.forEach(function (p) { byId[p.id] = p; });
      var grid = '<div class="tkx-grid" role="group" aria-label="' + s("points") + '">' + POPQ_GRID.map(function (row) {
        return row.map(function (id) {
          var off = id === "D" && PQ.noD, v = off ? s("none") : esc(signed(PQ.pts[id]));
          return '<button type="button" class="tkx-cell" data-act="tkxpq" data-v="' + id + '" aria-pressed="' + (PQ.sel === id) + '"' + (off ? " disabled" : "") +
            ' aria-label="' + esc(id + ", " + (off ? raw("none") : signed(PQ.pts[id]) + " cm")) + '"><span>' + id + "</span><b>" + v + "</b></button>";
        }).join("");
      }).join("") + "</div>";
      var sel = byId[PQ.sel], bd = popqBounds(PQ.sel, PQ.pts.tvl), val = PQ.pts[PQ.sel];
      return '<section class="tkx-sec tkx-first" aria-labelledby="tkxPqH"><h2 class="tkx-h" id="tkxPqH">' + s("points") + '<span class="sp-small">' + s("gridHint") + "</span></h2>" + grid +
        '<div class="tkx-edit"><p class="tkx-p"><b>' + tx(sel.name) + "</b></p>" +
        '<div class="tkx-stepper"><button type="button" class="tkx-icon" data-act="tkxpqstep" data-v="-0.5" aria-label="' + s("less", { p: PQ.sel }) + '"' + (val > bd[0] ? "" : " disabled") + ">\u2212</button>" +
        '<output class="tkx-num tkx-big">' + esc(signed(val)) + ' cm</output><button type="button" class="tkx-icon" data-act="tkxpqstep" data-v="0.5" aria-label="' + s("more", { p: PQ.sel }) + '"' + (val < bd[1] ? "" : " disabled") + ">+</button></div></div>" +
        '<button type="button" class="tkx-toggle" data-act="tkxpqnod" aria-pressed="' + PQ.noD + '"><span class="tkx-box" aria-hidden="true"></span>' + s("noD") + "</button></section>" +
        '<section class="tkx-sec" aria-labelledby="tkxPqR"><h2 class="sp-h2" id="tkxPqR">' + s("result") + '</h2><div id="tkxLive" aria-live="polite">' + this.live(m) + "</div>" +
        '<p class="sp-small tkx-foot">' + s("illustrative") + ' <button type="button" class="tkx-link" data-act="tkxpqreset">' + s("reset") + "</button></p></section>";
    },
    live: function (m) {
      var r = m.stage(popqInput(PQ.pts, PQ.noD));
      if (!r.ok) return '<div class="tkx-result is-bad" role="alert"><p class="tkx-rt">' + tx(r.error) + '</p><ul class="tkx-ul">' + (r.errors || []).map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul></div>";
      var c = r.compartments;
      return '<div class="tkx-result"><p class="tkx-stage">' + s("stage", { s: r.roman }) + "</p>" +
        '<p class="tkx-p">' + s("leading", { p: r.leadingEdge.point, v: signed(r.leadingEdge.value) }) + "</p><p class=\"tkx-p\">" + tx(r.rule) + "</p>" +
        '<dl class="tkx-kv"><div><dt>' + s("anterior") + "</dt><dd>" + esc(signed(c.anterior)) + "</dd></div><div><dt>" + s("apical") + "</dt><dd>" + esc(signed(c.apical)) + "</dd></div><div><dt>" + s("posterior") + "</dt><dd>" + esc(signed(c.posterior)) + "</dd></div></dl>" +
        r.warnings.map(function (w) { return '<p class="tkx-p tkx-warn">' + tx(w) + "</p>"; }).join("") + "</div>";
    }
  };
  A.tkxpq = function (b) { PQ.sel = b.getAttribute("data-v"); again(); };
  A.tkxpqstep = function (b) {
    var bd = popqBounds(PQ.sel, PQ.pts.tvl);
    PQ.pts[PQ.sel] = clamp(Math.round((PQ.pts[PQ.sel] + +b.getAttribute("data-v")) * 2) / 2, bd[0], bd[1]);
    touched("popq"); again();
  };
  A.tkxpqnod = function () { PQ.noD = !PQ.noD; if (PQ.noD && PQ.sel === "D") PQ.sel = "C"; touched("popq"); again(); };
  A.tkxpqreset = function () { PQ.pts = popqStart(); PQ.noD = false; again(); };

  /* ================= ovarian triage ================= */
  var OT = { sel: [] };
  X["ovarian-triage"] = {
    test: { mcqTopic: "gy-benign" },
    body: function (m) {
      function row(id) {
        return '<button type="button" class="tkx-toggle" data-act="tkxot" data-v="' + id + '" aria-pressed="' + (OT.sel.indexOf(id) >= 0) + '"><span class="tkx-box" aria-hidden="true"></span><span class="tkx-tg-b"><b><span class="tkx-code" translate="no">' + id + "</span> " + tx(m.features[id].name) + "</b></span></button>";
      }
      var rmi = host._tools.some(function (x) { return x.id === "rmi"; });
      return '<section class="tkx-sec tkx-first" aria-labelledby="tkxOtB"><p class="tkx-p">' + s("pickF") + "</p>" +
        '<h2 class="sp-h2" id="tkxOtB">' + s("benignF") + '</h2><div class="tkx-list">' + m.featureIds.filter(function (k) { return k[0] === "B"; }).map(row).join("") + "</div>" +
        '<h2 class="sp-h2">' + s("malignantF") + '</h2><div class="tkx-list">' + m.featureIds.filter(function (k) { return k[0] === "M"; }).map(row).join("") + "</div></section>" +
        '<section class="tkx-sec" aria-labelledby="tkxOtR"><h2 class="sp-h2" id="tkxOtR">' + s("result") + '</h2><div id="tkxLive" aria-live="polite">' + this.live(m) + "</div>" +
        (OT.sel.length ? '<button type="button" class="sp-btn sec sp-wide" data-act="tkxotclear">' + s("clear") + "</button>" : "") +
        (rmi ? '<button type="button" class="sp-btn sec sp-wide tkx-go" data-act="tkxrmi">' + ico("calc") + " " + s("rmi") + "</button>" : "") + "</section>";
    },
    live: function (m) {
      if (!OT.sel.length) return '<p class="tkx-p">' + s("nothingYet") + "</p>";
      var r = m.fromFeatures(OT.sel), cls = r.outcome === "benign" ? "ok" : r.outcome === "malignant" ? "bad" : "warn";
      return '<div class="tkx-result is-' + cls + '"><p class="tkx-stage">' + s(r.outcome) + '</p><p class="tkx-p">' + tx(r.rule) + "</p>" +
        '<p class="sp-small">B: ' + esc(r.B.join(", ") || "0") + " · M: " + esc(r.M.join(", ") || "0") + "</p></div>";
    },
    srcExtra: function (m) {
      var v = m.performance && m.performance.validation2010;
      return v ? '<p class="tkx-p">' + s("perf", { p: I.fmt(v.patients), c: v.conclusive, s: v.sensitivity, sp: v.specificity }) + "</p>" : "";
    }
  };
  A.tkxot = function (b) { var id = b.getAttribute("data-v"), k = OT.sel.indexOf(id); if (k >= 0) OT.sel.splice(k, 1); else OT.sel.push(id); touched("ovarian-triage"); again(); };
  A.tkxotclear = function () { OT.sel = []; paint("ovarian-triage", '[data-act="tkxot"]'); };
  A.tkxrmi = function () {
    var tool = null, id = curId();
    host._tools.forEach(function (x) { if (x.id === "rmi") tool = x; });
    if (!tool) return;
    I.leave(); tool.open();
    I.setRet(function () { EXUI.open(id); }, raw("backExplore"));
  };

  /* ================= cervical screening ================= */
  var CX = { path: [{ step: "start" }], f: null };
  function cryoStart() { return { quadrants: 1, ectocervixOnly: true, fullyVisible: true, coverableByProbe: true, suspectInvasive: false, postcoitalBleeding: false, postmenopausalBleeding: false, overtGrowth: false, irregularSurface: false, bleedsOnTouch: false }; }
  var CRYO_BOOLS = ["ectocervixOnly", "fullyVisible", "coverableByProbe", "suspectInvasive", "postcoitalBleeding", "postmenopausalBleeding", "overtGrowth", "irregularSurface", "bleedsOnTouch"];
  X["cervical-screening"] = {
    test: { mcqTopic: "gy-oncology" },
    body: function (m) {
      var cur = CX.path[CX.path.length - 1], v = m.view(cur.step), past = CX.path.slice(0, -1), sug = null, cryo = "";
      if (cur.step === "refer-gyn") {
        if (!CX.f) CX.f = cryoStart();
        var e = m.cryotherapyEligibility(CX.f);
        sug = e.ok ? e.result : null;
        cryo = '<div class="tkx-sub"><h3 class="tkx-h3" id="tkxCryoH">' + s("cryoCheck") + "</h3>" +
          '<span class="tkx-lbl" id="tkxQL">' + s("quadrants") + '</span><div class="sp-seg" role="group" aria-labelledby="tkxQL">' + [1, 2, 3, 4].map(function (q) {
            return '<button type="button" data-act="tkxcxq" data-v="' + q + '" aria-pressed="' + (CX.f.quadrants === q) + '">' + q + "</button>";
          }).join("") + '</div><div class="tkx-list">' + CRYO_BOOLS.map(function (k) {
            return '<button type="button" class="tkx-toggle" data-act="tkxcxf" data-v="' + k + '" aria-pressed="' + CX.f[k] + '"><span class="tkx-box" aria-hidden="true"></span>' + s(k) + "</button>";
          }).join("") + "</div>" +
          (e.ok ? '<div class="tkx-result is-' + (e.eligible ? "ok" : "warn") + '" aria-live="polite"><p class="tkx-rt">' + s(e.eligible ? "eligible" : "notEligible") + "</p>" +
            (e.reasons.length ? '<ul class="tkx-ul">' + e.reasons.map(function (r) { return "<li>" + tx(r) + "</li>"; }).join("") + "</ul>" : "") + "</div>" : "") + "</div>";
      }
      var trail = past.length ? '<h2 class="sp-h2">' + s("so") + '</h2><ol class="tkx-trail">' + past.map(function (p) {
        return "<li><b>" + tx(m.steps[p.step].title) + "</b><span>" + tx(m.resultLabels[p.result]) + "</span></li>";
      }).join("") + "</ol>" : "";
      var kind = v.kind === "end" ? "end" : v.kind === "action" ? "action" : "decision";
      return '<section class="tkx-sec tkx-first">' + trail +
        '<div class="tkx-step is-' + kind + '"><p class="sp-small">' + s(kind) + '</p><h2 class="tkx-h" id="tkxCxH" tabindex="-1">' + tx(v.title) + '</h2><p class="tkx-p">' + tx(v.text) + "</p>" + cryo +
        '<div class="tkx-choices">' + v.results.map(function (r) {
          var on = sug && r.result === sug;
          return '<button type="button" class="sp-btn ' + (on ? "pri" : "sec") + ' sp-wide" data-act="tkxcx" data-v="' + esc(r.result) + '">' + tx(r.label) + (on ? '<span class="tkx-sug">' + s("suggested") + "</span>" : "") + "</button>";
        }).join("") + "</div></div>" +
        (past.length ? '<div class="tkx-pair tkx-quiet"><button type="button" class="sp-btn sec" data-act="tkxcxback">' + s("backStep") + '</button><button type="button" class="sp-btn sec" data-act="tkxcxreset">' + s("restart") + "</button></div>" : "") + "</section>";
    },
    srcExtra: function (m) {
      var g = m.guideline, o = m.otherTests || {};
      return (g ? '<p class="tkx-p">' + s("guideline", { g: g.algorithm.title, v: g.algorithm.version }) + "</p>" : "") +
        Object.keys(o).map(function (k) { return '<p class="tkx-p">' + tx(o[k]) + "</p>"; }).join("");
    }
  };
  A.tkxcx = function (b) {
    var m = M("cervical-screening"), cur = CX.path[CX.path.length - 1], r = m.next(cur.step, b.getAttribute("data-v"));
    if (!r.ok) return;
    CX.path = cxAdvance(CX.path, b.getAttribute("data-v")); CX.path.push({ step: r.step.id });
    touched("cervical-screening"); paint("cervical-screening", "#tkxCxH");
  };
  A.tkxcxback = function () { CX.path = cxBack(CX.path); paint("cervical-screening", "#tkxCxH"); };
  A.tkxcxreset = function () { CX.path = [{ step: "start" }]; CX.f = null; paint("cervical-screening", "#tkxCxH"); };
  A.tkxcxq = function (b) { CX.f.quadrants = +b.getAttribute("data-v"); touched("cervical-screening"); again(); };
  A.tkxcxf = function (b) { var k = b.getAttribute("data-v"); CX.f[k] = !CX.f[k]; touched("cervical-screening"); again(); };

  /* ================= wiring ================= */
  function onInput(e) {
    var el = e.target, id = curId();
    if (!el || !el.getAttribute || !el.getAttribute("data-xin") || !id || !X[id] || !X[id].input) return;
    if (el.tagName === "SELECT" ? e.type !== "change" : e.type !== "input") return;
    X[id].input(el);
  }
  var prevKey = I.KEYS.explore;
  I.KEYS.explore = function (e) { var id = curId(); if (id && X[id] && X[id].key) X[id].key(e); if (prevKey) prevKey(e); };
  function wire() {
    var el = I.root();
    if (el._tkx) return;
    el._tkx = 1;
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
          // The Learn index gives the "Learn this" links: load it once if the learner came here another way.
          var w = host._learn && host._learn._w;
          if (w && !w.ix && !w.err && host._learn.load) host._learn.load().then(function () { if (curId() === id) paint(id); });
          paint(id, focusSel);
        } });
    });
  }
  if (host._syncers) host._syncers.push(register);
  register();
})(typeof window !== "undefined" ? window : this);
