/* Tokós labour room simulator screen: the custom UI for the time-stepped model window.TOKOS_MODELS.labour
   (tokos-models/drill-labour.js). ES5. Registers with the engine's sim registry (host.registerSim), replacing the
   "screen in the next update" placeholder the drills feature lists for a model with init/step and no stages.
   Screens: scenario picker (MBBS free; Resident scenarios Pro with one trial, feature id drill.labour, checked before
   the run starts), the run (labour chart, observations, what happened, actions from model.actions(state), time
   advance in a thumb-reach footer), and the debrief (grade, teaching points from model.outcome, sources).
   A finished run is recorded like the other drills: store.sims.labour and the FSRS card drill:labour.
   The chart is original geometry in the spirit of a labour care chart (cervix and head over time, contractions,
   CTG class strip in the CTG clinic's FIGO colours); no WHO artwork. Numerals stay ASCII in Hindi.
   Node (tests): module.exports = the pure view-model helpers. */
(function (G) {
  "use strict";

  function T(en, hi) { return { en: en, hi: hi }; }
  var TICK = 5;
  var FIGO = ["normal", "suspicious", "pathological"];

  /* ================= pure view-model helpers (unit-tested) ================= */
  // One chart sample from a model state.
  function sample(s) {
    return { t: s.t, dil: s.dil, station: s.station, uc: s.contractions, figo: s.fhr.figo, oxy: s.oxytocin.on };
  }
  // Advance in 5-minute steps so every tick lands on the chart; same result as one model step (same tick loop).
  function advance(M, s, minutes, samples) {
    var n = Math.max(0, Math.round((minutes || 0) / TICK));
    for (var i = 0; i < n && !s.delivered; i++) { s = M.step(s, "observe", TICK); samples.push(sample(s)); }
    return s;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // Elapsed time since admission, ASCII digits in both languages.
  function clockText(min, lang) {
    var h = Math.floor(min / 60), m = pad2(min % 60);
    return lang === "hi" ? h + " घंटे " + m + " मिनट" : h + " h " + m + " min";
  }
  // Grade from model.outcome -> FSRS grade (1 Again, 2 Hard, 3 Good); a run counts as right only when "good".
  function fsrsGrade(grade) { return grade === "good" ? 3 : grade === "ok" ? 2 : 1; }
  function eventsSince(s, from) { return s.events.slice(from); }

  // Chart geometry in a 360-wide viewBox. Cervix 4 to 10 cm (top panel), head station -3 (top) to +3 (bottom),
  // contractions per 10 minutes as bars (0 to 6), CTG class as a strip. Hours grow with the run, at least 4.
  var GEO = { W: 360, X0: 34, X1: 350, dTop: 8, dBot: 98, sTop: 114, sBot: 156, uBase: 186, uUnit: 4, fTop: 194, fH: 9, H: 214 };
  function chartModel(samples) {
    var g = GEO, last = samples[samples.length - 1], hours = Math.max(4, Math.ceil(((last ? last.t : 0) + 1) / 60));
    var span = hours * 60;
    function x(t) { return Math.round((g.X0 + (g.X1 - g.X0) * t / span) * 10) / 10; }
    function yd(d) { return Math.round((g.dBot - (Math.max(4, Math.min(10, d)) - 4) * (g.dBot - g.dTop) / 6) * 10) / 10; }
    function ys(st) { return Math.round((g.sTop + (Math.max(-3, Math.min(3, st)) + 3) * (g.sBot - g.sTop) / 6) * 10) / 10; }
    var dil = [], st = [], uc = [], fhr = [], bins = {}, i;
    samples.forEach(function (p) {
      dil.push([x(p.t), yd(p.dil)]);
      st.push([x(p.t), ys(p.station)]);
      var b = Math.floor(Math.max(0, p.t - 1) / 10);
      bins[b] = Math.max(bins[b] || 0, p.uc);
    });
    var bw = (g.X1 - g.X0) * 10 / span;
    Object.keys(bins).forEach(function (k) {
      var n = bins[k];
      uc.push({ x: Math.round((g.X0 + (+k) * bw + bw * 0.2) * 10) / 10, w: Math.round(bw * 0.6 * 10) / 10, h: n * g.uUnit, n: n, over: n > 5 });
    });
    // CTG strip: one segment per run of the same class (the class holds until the next sample).
    for (i = 0; i < samples.length; i++) {
      var p = samples[i], nx = samples[i + 1], t1 = nx ? nx.t : p.t + TICK;
      var seg = fhr[fhr.length - 1];
      if (seg && seg.c === p.figo) seg.x2 = x(t1); else fhr.push({ c: p.figo, x1: x(p.t), x2: x(t1) });
    }
    var ticks = [];
    for (i = 0; i <= hours; i++) ticks.push({ h: i, x: x(i * 60) });
    return { g: g, hours: hours, dil: dil, st: st, uc: uc, fhr: fhr, ticks: ticks, yd: yd, ys: ys };
  }

  var PURE = { sample: sample, advance: advance, clockText: clockText, fsrsGrade: fsrsGrade, eventsSince: eventsSince, chartModel: chartModel, GEO: GEO, FIGO: FIGO };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  G.TOKOS_LABOUR_UI = PURE;

  /* ================= screen ================= */
  var host = G.TOKOS;
  if (!host || !host.registerSim || !host._internal || !G.document) return;
  var I = host._internal, st = host._st, C = G.SPECIALTY_CORE, esc = I.esc;

  var STR = {
    title: T("Labour room", "लेबर रूम"), sub: T("Simulator", "सिम्युलेटर"),
    line: T("Run a labour hour by hour: watch the chart, act when it needs you.", "प्रसव को घंटे-दर-घंटे चलाएँ: चार्ट देखें, ज़रूरत हो तब कार्रवाई करें।"),
    pickH: T("Choose a labour", "एक प्रसव चुनें"), mbbs: T("MBBS", "MBBS"), resident: T("Resident", "रेज़िडेंट"),
    how: T("Time moves only when you wait. Each wait is watched in 5-minute steps; act between waits.", "समय केवल इंतज़ार करने पर बढ़ता है। हर इंतज़ार 5-मिनट के चरणों में देखा जाता है; इंतज़ारों के बीच कार्रवाई करें।"),
    delayNote: T("This simulator marks delay at Zhang's 95th percentile for each centimetre. Indian labour rooms use the partograph or the WHO Labour Care Guide 2020. Their time limits per centimetre are longer. Follow your unit's chart.", "यह सिम्युलेटर हर सेंटीमीटर के लिए ज़ांग के 95वें पर्सेंटाइल पर देरी मानता है। भारतीय लेबर रूम पार्टोग्राफ़ या WHO लेबर केयर गाइड 2020 का उपयोग करते हैं। उनकी हर सेंटीमीटर की समय-सीमा लंबी है। अपनी यूनिट का चार्ट मानें।"),
    sources: T("Sources", "स्रोत"), learnOnly: T("For learning, not for clinical decisions. Rule-based, pending specialist review.", "सीखने के लिए, क्लिनिकल निर्णय के लिए नहीं। नियम-आधारित, विशेषज्ञ समीक्षा बाकी।"),
    backTest: T("Back to Test", "टेस्ट पर वापस"), backPick: T("Back to the labours", "प्रसवों पर वापस"),
    since: T("Since admission", "भर्ती से"), stage1: T("First stage", "पहला चरण"), stage2: T("Second stage", "दूसरा चरण"),
    chartAria: T("Labour chart: cervix {d} cm, head station {s}, {u} contractions in 10 minutes, CTG {f}, at {t}.", "प्रसव चार्ट: गर्भाशय-ग्रीवा {d} cm, सिर स्टेशन {s}, 10 मिनट में {u} संकुचन, CTG {f}, {t} पर।"),
    lgCervix: T("Cervix (cm)", "गर्भाशय-ग्रीवा (cm)"), lgHead: T("Head station", "सिर स्टेशन"), lgUc: T("Contractions /10 min", "संकुचन /10 मिनट"), lgCtg: T("CTG class", "CTG वर्ग"),
    hours: T("hours", "घंटे"),
    obs: T("Now", "अभी"), cervix: T("Cervix", "गर्भाशय-ग्रीवा"), head: T("Head", "सिर"), uc: T("Contractions", "संकुचन"), per10: T("/10 min", "/10 मिनट"),
    oxy: T("Oxytocin", "ऑक्सीटोसिन"), off: T("Off", "बंद"), fhr: T("Fetal heart", "भ्रूण हृदय गति"), decels: T("Decelerations", "डिसेलेरेशन"),
    pulse: T("Pulse", "नाड़ी"), bp: T("BP", "BP"), membranes: T("Membranes", "झिल्ली"),
    intact: T("Intact", "अक्षुण्ण"), clear: T("Ruptured, clear", "फटी, साफ़"), meconium: T("Ruptured, meconium", "फटी, मेकोनियम"),
    dNone: T("None", "कोई नहीं"), dLate: T("Late", "लेट"), dProlonged: T("Prolonged", "लंबा"),
    delay: T("Beyond Zhang's 95th percentile for this centimetre", "इस सेंटीमीटर के लिए ज़ांग के 95वें पर्सेंटाइल से आगे"),
    ctg: T("CTG", "CTG"), seeCtg: T("See a CTG like this", "ऐसा CTG देखें"), backSim: T("Back to the labour", "प्रसव पर वापस"),
    happened: T("What happened", "क्या हुआ"), act: T("Act", "कार्रवाई"), wait: T("Wait and watch", "रुकें और देखें"),
    w15: T("15 min", "15 मिनट"), w30: T("30 min", "30 मिनट"), w60: T("1 hour", "1 घंटा"),
    waitAria: T("Wait {x}", "{x} रुकें"), confirm: T("Confirm: {x}", "पक्का करें: {x}"), notNow: T("Not available now", "अभी उपलब्ध नहीं"),
    done: T("Debrief", "समीक्षा"), good: T("Well managed", "अच्छा प्रबंधन"), ok: T("Safe, with avoidable steps", "सुरक्षित, पर कुछ कदम टाले जा सकते थे"), poor: T("Harm was likely", "नुकसान की संभावना थी"),
    born: T("Born at {t}", "{t} पर जन्म"), learn: T("What to take away", "क्या सीखें"), timeline: T("Timeline", "समयरेखा"),
    again: T("Another labour", "दूसरा प्रसव"), run: T("Run again", "फिर चलाएँ"),
    maikQ: T("I ran a labour room simulation", "मैंने लेबर रूम सिमुलेशन चलाया"),
    runs: T("{ok} of {n} runs well managed", "{n} में से {ok} बार अच्छा प्रबंधन"), none: T("Not started", "अभी शुरू नहीं")
  };
  var NAMES = {
    "normal-primi": T("Normal labour, first baby", "सामान्य प्रसव, पहला शिशु"),
    "normal-multi": T("Normal labour, second baby", "सामान्य प्रसव, दूसरा शिशु"),
    "slow-primi": T("Slow progress, weak contractions", "धीमी प्रगति, कमज़ोर संकुचन"),
    "epidural-multi": T("She asks for an epidural", "वह एपिड्यूरल माँगती है"),
    "obstructed": T("Obstructed labour", "अवरुद्ध प्रसव"),
    "compromise": T("Fetal compromise", "भ्रूण संकट"),
    "tachysystole": T("Tachysystole on oxytocin", "ऑक्सीटोसिन पर टैकीसिस्टोल")
  };
  var ACT = {
    amniotomy: T("Rupture membranes", "झिल्ली फोड़ें"), oxytocin_start: T("Start oxytocin", "ऑक्सीटोसिन शुरू करें"),
    oxytocin_stop: T("Stop oxytocin", "ऑक्सीटोसिन बंद करें"), analgesia: T("Epidural", "एपिड्यूरल"), position: T("Left lateral", "बाईं करवट"),
    fluids: T("IV fluid bolus", "IV फ़्लूइड बोलस"), instrumental: T("Vacuum birth", "वैक्यूम प्रसव"), caesarean: T("Caesarean", "सिज़ेरियन")
  };
  var FIGO_T = { normal: T("Normal", "सामान्य"), suspicious: T("Suspicious", "संदिग्ध"), pathological: T("Pathological", "पैथोलॉजिकल") };

  function L() { return I.lang(); }
  function t(o) { return (o && (o[L()] || o.en)) || ""; }
  function s(key, v) { return esc(t(STR[key])).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
  function tx(o) { return esc(t(o)); }
  function M() { return (G.TOKOS_MODELS || {}).labour; }
  function icoH(n) { var i = I.ico(n); return i ? '<span class="lb-i" aria-hidden="true">' + i + "</span>" : ""; }
  function stationText(x) { return (x > 0 ? "+" : x < 0 ? "−" : "") + I.fmt(Math.abs(x)); }
  function srcList(m) {
    return '<ol class="tl-refs">' + (m.sources || []).map(function (x) {
      return "<li>" + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.label) + "</a>" : esc(x.label)) + "</li>";
    }).join("") + "</ol>";
  }

  var R = null; // the run: {id, s, samples, seen, fresh}

  /* ---------- picker ---------- */
  function picker(focusSel) {
    var m = M();
    if (!m) return;
    I.leave();
    st.view = "labour"; st.again = picker;
    var row = function (id) {
      var sc = m.SCENARIOS[id], res = sc.level === "resident";
      return '<li><button type="button" class="sp-row lb-scn" data-act="labgo" data-s="' + esc(id) + '"><span class="sp-row-b"><b>' + tx(NAMES[id]) + "</b>" +
        "<span>" + tx(sc.brief) + "</span>" + (res && I.lockBadge("drill.labour") ? '<span class="sp-small">' + I.lockBadge("drill.labour") + "</span>" : "") + "</span>" +
        '<span class="sp-chev" aria-hidden="true">' + I.ico("chev") + "</span></button></li>";
    };
    var ids = Object.keys(m.SCENARIOS);
    var group = function (lv) { return ids.filter(function (id) { return m.SCENARIOS[id].level === lv; }).map(row).join(""); };
    I.paint(I.top(t(STR.backTest), s("title"), s("sub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col lb-pick"><p class="lb-lede">' + s("line") + "</p>" +
      '<h2 class="sp-h2">' + s("mbbs") + '</h2><ul class="sp-rows">' + group("mbbs") + "</ul>" +
      '<h2 class="sp-h2">' + s("resident") + '</h2><ul class="sp-rows">' + group("resident") + "</ul>" +
      '<p class="sp-small lb-how">' + s("how") + "</p>" + '<p class="sp-small lb-how">' + s("delayNote") + "</p>" +
      '<h2 class="sp-h2">' + s("sources") + "</h2>" + srcList(m) + '<p class="sp-note">' + s("learnOnly") + "</p></div></div>",
      typeof focusSel === "string" ? focusSel : null);
  }
  function start(id) {
    var m = M(), seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    var s0 = m.init(seed, id);
    R = { id: id, s: s0, samples: [sample(s0)], seen: 0, fresh: 0 };
    run();
  }
  function choose(id) {
    var m = M();
    if (!m || !m.SCENARIOS[id]) return;
    if (m.SCENARIOS[id].level === "resident") return I.gate("drill.labour", function () { start(id); });
    start(id);
  }

  /* ---------- chart ---------- */
  function pts(a) { return a.map(function (p) { return p[0] + "," + p[1]; }).join(" "); }
  function chartSvg(samples) {
    var c = chartModel(samples), g = c.g, out = [], i;
    // grid: cervix 4 to 10, station -3..+3, hour ticks
    for (i = 4; i <= 10; i++) out.push('<line class="lb-grid' + (i === 10 ? " lb-grid-k" : "") + '" x1="' + g.X0 + '" x2="' + g.X1 + '" y1="' + c.yd(i) + '" y2="' + c.yd(i) + '"/>' +
      '<text class="lb-ax" x="' + (g.X0 - 6) + '" y="' + (c.yd(i) + 3.5) + '" text-anchor="end">' + i + "</text>");
    for (i = -3; i <= 3; i += 1) out.push('<line class="lb-grid' + (i === 0 ? " lb-grid-k" : "") + '" x1="' + g.X0 + '" x2="' + g.X1 + '" y1="' + c.ys(i) + '" y2="' + c.ys(i) + '"/>' +
      (i % 3 === 0 ? '<text class="lb-ax" x="' + (g.X0 - 6) + '" y="' + (c.ys(i) + 3.5) + '" text-anchor="end">' + (i > 0 ? "+" : i < 0 ? "-" : "") + Math.abs(i) + "</text>" : ""));
    var every = c.hours > 8 ? 2 : 1;
    c.ticks.forEach(function (k) {
      out.push('<line class="lb-grid lb-grid-v" x1="' + k.x + '" x2="' + k.x + '" y1="' + g.dTop + '" y2="' + (g.fTop + g.fH) + '"/>');
      if (k.h % every === 0) out.push('<text class="lb-ax" x="' + k.x + '" y="' + g.H + '" text-anchor="middle">' + k.h + "</text>");
    });
    // contractions
    out.push('<line class="lb-grid" x1="' + g.X0 + '" x2="' + g.X1 + '" y1="' + (g.uBase - 5 * g.uUnit) + '" y2="' + (g.uBase - 5 * g.uUnit) + '" stroke-dasharray="3 3"/>');
    c.uc.forEach(function (b) { out.push('<rect class="lb-uc' + (b.over ? " over" : "") + '" x="' + b.x + '" y="' + (g.uBase - b.h) + '" width="' + b.w + '" height="' + b.h + '" rx="1"/>'); });
    // CTG strip
    c.fhr.forEach(function (f) { out.push('<rect class="lb-f ' + f.c + '" x="' + f.x1 + '" y="' + g.fTop + '" width="' + Math.max(0.5, Math.round((f.x2 - f.x1) * 10) / 10) + '" height="' + g.fH + '" rx="2"/>'); });
    // head descent, then cervix on top (the lead line)
    out.push('<polyline class="lb-st" points="' + pts(c.st) + '"/>');
    out.push('<polyline class="lb-dil" points="' + pts(c.dil) + '"/>');
    var ld = c.dil[c.dil.length - 1], ls = c.st[c.st.length - 1];
    out.push('<circle class="lb-st-dot" cx="' + ls[0] + '" cy="' + ls[1] + '" r="3.5"/><circle class="lb-dil-dot" cx="' + ld[0] + '" cy="' + ld[1] + '" r="4"/>');
    var p = samples[samples.length - 1];
    var aria = t(STR.chartAria).replace("{d}", I.fmt(p.dil)).replace("{s}", stationText(p.station).replace("−", "-")).replace("{u}", I.fmt(p.uc))
      .replace("{f}", t(FIGO_T[p.figo])).replace("{t}", clockText(p.t, L()));
    return '<figure class="lb-chart"><svg viewBox="0 0 ' + g.W + " " + (g.H + 4) + '" role="img" aria-label="' + esc(aria) + '" preserveAspectRatio="xMidYMid meet">' + out.join("") + "</svg>" +
      '<figcaption class="lb-legend"><span><i class="lb-k dil"></i>' + s("lgCervix") + '</span><span><i class="lb-k st"></i>' + s("lgHead") + "</span>" +
      '<span><i class="lb-k uc"></i>' + s("lgUc") + '</span><span><i class="lb-k f"></i>' + s("lgCtg") + '</span><span class="lb-hrs">' + s("hours") + "</span></figcaption></figure>";
  }

  /* ---------- run ---------- */
  function vitals(x, m) {
    var ox = x.oxytocin.on ? I.fmt(m.OXY_STEPS[Math.max(0, x.oxytocin.step)]) + " <small>mIU/min</small>" : s("off");
    var dec = x.fhr.decels === "late" ? s("dLate") : x.fhr.decels === "prolonged" ? s("dProlonged") : s("dNone");
    var mem = x.membranes === "intact" ? s("intact") : x.liquor === "meconium" ? s("meconium") : s("clear");
    var cell = function (k, v, cls) { return '<div' + (cls ? ' class="' + cls + '"' : "") + "><dt>" + s(k) + "</dt><dd>" + v + "</dd></div>"; };
    return '<dl class="dr-vitals lb-vitals">' +
      cell("cervix", I.fmt(x.dil) + " <small>cm</small>") + cell("head", esc(stationText(x.station))) +
      cell("uc", I.fmt(x.contractions) + " <small>" + s("per10") + "</small>", x.contractions > 5 ? "lb-bad" : x.contractions < 3 ? "lb-warn" : "") +
      cell("oxy", ox) + cell("fhr", I.fmt(x.fhr.baseline) + " <small>bpm</small>") + cell("decels", dec, x.fhr.decels !== "none" ? "lb-warn" : "") +
      cell("pulse", I.fmt(x.maternal.pulse) + " <small>/min</small>", x.maternal.pulse > 110 ? "lb-bad" : "") +
      cell("bp", I.fmt(x.maternal.sbp) + "/" + I.fmt(x.maternal.dbp) + " <small>mmHg</small>", x.maternal.hypotension ? "lb-bad" : "") +
      cell("membranes", mem, x.liquor === "meconium" ? "lb-warn" : "") + "</dl>";
  }
  function evText(e, m) { return tx(m.TEXT[e.code] || { en: e.code, hi: e.code }) + (e.action && ACT[e.action] ? " (" + tx(ACT[e.action]) + ")" : ""); }
  function feed(x, m) {
    var ev = x.events, from = Math.max(0, ev.length - 6), rows = [];
    for (var i = ev.length - 1; i >= from; i--) {
      rows.push('<li class="' + (i >= R.fresh ? "new" : "") + '"><time>' + esc(clockText(ev[i].t, L())) + "</time><span>" + evText(ev[i], m) + "</span></li>");
    }
    return '<ol class="lb-feed">' + rows.join("") + "</ol>";
  }
  function ctgLink(fig) {
    var spec = I.clinic("ctg");
    if (!spec || !I.clinicItems(spec).some(function (x) { return x.a === fig; })) return "";
    return '<button type="button" class="lb-link" data-act="labctg">' + s("seeCtg") + "</button>";
  }
  function run(focusSel) {
    var m = M(), x = R.s;
    I.leave();
    st.view = "labour-run"; st.again = run;
    st.onBack = function () { picker('[data-act=labgo][data-s="' + R.id + '"]'); return true; };
    var allowed = m.actions(x), fig = x.fhr.figo;
    var acts = Object.keys(ACT).map(function (a) {
      var on = allowed.indexOf(a) >= 0, risky = a === "caesarean" || a === "instrumental";
      var armed = risky && on && R.arm === a;
      return '<button type="button" class="sp-btn ' + (armed ? "pri" : "sec") + " lb-act" + (risky ? " lb-deliver" : "") + '" data-act="labact" data-k="' + a + '"' + (on ? "" : ' disabled aria-describedby="lbNotNow"') + ">" +
        (armed ? s("confirm", { x: t(ACT[a]) }) : tx(ACT[a])) + "</button>";
    }).join("");
    var newest = x.events.slice(R.fresh).map(function (e) { return evText(e, m).replace(/<[^>]+>/g, ""); }).join(" ");
    I.paint(I.top(t(STR.backPick), tx(NAMES[R.id]), s("sub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad lb-run"><div class="sp-col">' +
      '<div class="lb-status"><div class="lb-clock"><span>' + s("since") + "</span><b>" + esc(clockText(x.t, L())) + "</b></div>" +
      '<div class="lb-stage"><span>' + s(x.stage === 2 ? "stage2" : "stage1") + '</span><b class="lb-fig ' + fig + '">' + s("ctg") + " " + tx(FIGO_T[fig]) + "</b></div></div>" +
      (m.delayed(x) ? '<p class="lb-delay" role="note">' + icoH("clock") + "<span>" + s("delay") + "</span></p>" : "") +
      chartSvg(R.samples) + ctgLink(fig) +
      '<h2 class="sp-h2">' + s("obs") + "</h2>" + vitals(x, m) +
      '<h2 class="sp-h2">' + s("happened") + "</h2>" + feed(x, m) +
      '<p class="lb-sr" aria-live="polite">' + esc(newest) + "</p>" +
      '<h2 class="sp-h2">' + s("act") + '</h2><div class="lb-acts">' + acts + '</div><p class="lb-sr" id="lbNotNow">' + s("notNow") + "</p>" +
      "</div></div>" +
      '<div class="sp-foot lb-foot"><p class="lb-wait-h" id="lbWaitH">' + s("wait") + '</p><div class="lb-waits" role="group" aria-labelledby="lbWaitH">' +
      [["15", "w15"], ["30", "w30"], ["60", "w60"]].map(function (w) {
        return '<button type="button" class="sp-btn pri" data-act="labwait" data-k="' + w[0] + '" aria-label="' + s("waitAria", { x: t(STR[w[1]]) }) + '">' + s(w[1]) + "</button>";
      }).join("") + "</div></div>", typeof focusSel === "string" ? focusSel : null);
  }
  function after(prevLen) {
    R.fresh = prevLen;
    if (R.s.delivered) return finish();
    I.haptic("tap");
  }
  I.ACTIONS.labgo = function (b) { choose(b.getAttribute("data-s")); };
  I.ACTIONS.labwait = function (b) {
    if (!R || R.s.delivered) return;
    var n = R.s.events.length, k = b.getAttribute("data-k");
    R.arm = null;
    R.s = advance(M(), R.s, +k, R.samples);
    after(n);
    if (!R.s.delivered) run('[data-act=labwait][data-k="' + k + '"]');
  };
  I.ACTIONS.labact = function (b) {
    if (!R || R.s.delivered) return;
    var n = R.s.events.length, a = b.getAttribute("data-k");
    // A birth decision ends the labour: the first tap arms it, the second confirms; anything else disarms.
    if ((a === "caesarean" || a === "instrumental") && R.arm !== a) { R.arm = a; return run('[data-act=labact][data-k="' + a + '"]'); }
    R.arm = null;
    R.s = M().step(R.s, a, 0);
    R.samples.push(sample(R.s));
    after(n);
    if (!R.s.delivered) run('[data-act=labwait][data-k="15"]');
  };
  // "See a CTG like this": a short CTG clinic session of cases in the same FIGO class; Back returns to this labour.
  I.ACTIONS.labctg = function () {
    if (!R) return;
    var keep = R, fig = R.s.fhr.figo;
    I.startClinic("ctg", { classes: [fig], size: 3, name: t(FIGO_T[fig]) });
    if (st.view !== "labour-run") I.setRet(function () { R = keep; run(); }, t(STR.backSim));
  };

  /* ---------- debrief ---------- */
  function finish() {
    var m = M(), o = m.outcome(R.s), today = I.today();
    R.o = o;
    if (C && st.store) {
      C.recordSim(st.store, "labour", o.grade === "good", o.grade === "good" ? null : o.grade, today);
      C.review(st.store, "drill", "labour", fsrsGrade(o.grade), today);
      I.save();
    }
    I.haptic(o.grade === "good" ? "success" : "error");
    debrief(".lb-verdict");
  }
  function debrief(focusSel) {
    var m = M(), o = R.o, x = R.s;
    I.leave();
    st.view = "labour-done"; st.again = debrief;
    st.onBack = function () { picker(); return true; };
    var cls = o.grade === "good" ? "ok" : o.grade === "poor" ? "bad" : "mid";
    var tl = x.events.map(function (e) { return "<li><time>" + esc(clockText(e.t, L())) + "</time><span>" + evText(e, m) + "</span></li>"; }).join("");
    I.paint(I.top(t(STR.backPick), s("done"), tx(NAMES[R.id]), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col lb-done">' +
      '<p class="sp-verdict lb-verdict ' + cls + '" tabindex="-1">' + (I.ico(cls === "ok" ? "check" : "alert") || "") + "<span>" + s(o.grade) + "</span></p>" +
      '<p class="lb-born">' + tx(m.TEXT[o.mode]) + " " + s("born", { t: clockText(o.t, L()) }) + "</p>" +
      chartSvg(R.samples) +
      '<h2 class="sp-h2">' + s("learn") + '</h2><ul class="dr-lines lb-learn">' + o.lines.slice(1).map(function (l) { return "<li>" + tx(l) + "</li>"; }).join("") + "</ul>" +
      '<details class="lb-tl"><summary>' + s("timeline") + '</summary><ol class="lb-feed">' + tl + "</ol></details>" +
      I.maikBtn(STR.maikQ.en + ": " + NAMES[R.id].en + ". " + o.lines.map(function (l) { return l.en; }).join(" ") + " Explain what the best management would have been and why.") +
      '<h2 class="sp-h2">' + s("sources") + "</h2>" + srcList(m) + "</div></div>" +
      '<div class="sp-foot"><div class="mcq-foot2"><button type="button" class="sp-btn sec" data-act="labagain">' + s("again") + '</button>' +
      '<button type="button" class="sp-btn pri" data-act="labrerun">' + s("run") + "</button></div></div>", typeof focusSel === "string" ? focusSel : null);
  }
  I.ACTIONS.labagain = function () { picker(); };
  I.ACTIONS.labrerun = function () { if (R) choose(R.id); };

  /* ---------- registration: replaces the drills feature's placeholder once the model is loaded ---------- */
  function register() {
    var m = M();
    if (!m || !m.init) return;
    host.registerSim({ id: "labour", title: m.title, sub: STR.sub, icon: "pulse", level: "mbbs",
      line: function (r) { return r && r.n ? s("runs", { ok: I.fmt(r.ok), n: I.fmt(r.n) }) : s("none"); },
      open: function () { picker(); } });
  }
  if (host._syncers) host._syncers.push(register);
  register();
})(typeof window !== "undefined" ? window : this);
