/* kardia-practice.js - Kardia Practice: view drills, exam, knobology,
 * POCUS protocols and spot diagnosis (WP10, plan sections 1.8, 1.9, 2, 5).
 *
 * ES5 IIFE, window.KARDIA_PRACTICE, module.exports under node for the
 * pure scoring helpers. All UI lives in the Practice tab mount that
 * kardia.js provides (#krdPracticeMount); this file owns no other host
 * surface. The probe is the Echo Lab probe through
 * window.KARDIA._kardia.echoLab when present; otherwise a self
 * contained probe (window.KARDIA_PROBE) with a schematic sector.
 *
 * Design contract (Operate mode, existing Kardia tokens only):
 * purpose: graded practice against the clock. First screenful per
 * screen: the task, the timer and the primary action. Composition: one
 * scroll column inside the Practice tab; section rows first, then one
 * runner at a time with a Back control at the top. States: loading
 * (catalogue, protocols or credits fetching, plain status line), error
 * (did not load, retry button), empty (no views at this level, no clip
 * for a spot question, knobology unavailable without the ultrasound
 * model, each said plainly), offline (real clips show the clips module
 * note instead of a player), long view and protocol names wrap, never
 * truncate. Motion: meter width and button press only, 140ms on
 * --kd-ease, transform and opacity, off under reduced motion. Timers
 * are text and never block input. Every control is a real button or
 * labelled range input, 44px tall, with the engine focus ring. No new
 * palette, no glow. All clinical text is ai_drafted.
 *
 * Recording: every finished attempt goes to the engine store with
 * SPECIALTY_CORE.recordSim and an FSRS card with SPECIALTY_CORE.review
 * (deck "drill"), the same pattern as specialty-tools drills. A view
 * drill records one card per view.
 *
 * Code Blue and Narkē links (status, checked 2026-10-25):
 * - Code Blue exposes window.CodeBlueLive.open(opts) at boot (see
 *   codeblue-live.js). The pulse check protocol calls
 *   CodeBlueLive.open({ training: true, mode: "adult" }) for "Open in
 *   Code Blue". Code Blue has no pulse check specific hook, so no Code
 *   Blue file is changed.
 * - Inbound hook for Code Blue (documented, no Code Blue change
 *   needed): when this file is loaded, a Code Blue practice case may
 *   call window.KARDIA_PRACTICE.openPulseCheckEcho() or dispatch a
 *   "kardia:pulse-check" CustomEvent on window; Kardia opens on the
 *   pulse check protocol.
 * - Narkē exposes window.NARKE.open() through narke-loader.js at boot.
 *   The protocol screen links "Open Narkē" for perioperative POCUS
 *   context. Narkē has no POCUS specific entry point, so no Narkē file
 *   is changed.
 */
(function (G) {
  "use strict";

  /* ================= pure helpers (node tested) ================= */
  var DRILL_LIMIT_SEC = 20;
  var EXAM_LIMIT_SEC = 60;
  var EXAM_PASS_MARK = 60;
  var ORIENTATION_CRITICAL_DEG = 20;
  var MBBS_VIEWS = ["tte_plax", "tte_psax_papillary", "tte_a4c", "tte_subcostal_4c"];
  var EXAM_VIEWS = ["tte_plax", "tte_psax_papillary", "tte_a4c", "tte_subcostal_4c", "tte_subcostal_ivc"];
  var LEVELS = ["mbbs", "resident", "fellow", "sonographer"];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Counts read as words next to their number ("1 second", "2 seconds",
   * "1 degree", "0 seconds"): every count shown in this file goes through
   * one of these, so a 1 never reads as "1 seconds". */
  function unitWord(n, one, many) { return Math.round(n) === 1 ? one : many; }
  function countUnit(n, unit) { var r = Math.round(n); return r + " " + unit + (r === 1 ? "" : "s"); }
  /* Angle readouts: a proper minus sign (U+2212, never the hyphen-minus, so it
   * cannot strand apart from its digits and read as "- 180") with the degree
   * sign (U+00B0): -180 renders as U+2212 + "180" + U+00B0. degText is the
   * screen-reader wording for aria-valuetext ("minus 180 degrees"). */
  function degStr(v) { var r = Math.round(v); return (r < 0 ? "−" + (-r) : "" + r) + "°"; }
  function degText(v) {
    var r = Math.round(v), a = r < 0 ? -r : r;
    return (r < 0 ? "minus " + a : "" + a) + " " + (a === 1 ? "degree" : "degrees");
  }

  /* Drill sets by level, filtered from the views catalogue. MBBS is
   * the four named views; resident adds the rest of TTE; fellow adds
   * TEE; sonographer is the full catalogue (knobology is separate). */
  function drillViewsForLevel(level, catalogue) {
    var views = (catalogue && catalogue.views) || catalogue || [];
    if (!views || !views.length) return [];
    if (level === "mbbs") {
      return views.filter(function (v) { return MBBS_VIEWS.indexOf(v.id) >= 0; });
    }
    if (level === "resident") return views.filter(function (v) { return v.modality === "tte"; });
    return views.filter(function (v) { return v.modality === "tte" || v.modality === "tee"; });
  }
  function examViews(catalogue) {
    var views = (catalogue && catalogue.views) || catalogue || [];
    return EXAM_VIEWS.map(function (id) {
      for (var i = 0; i < views.length; i++) if (views[i].id === id) return views[i];
      return { id: id, name: id };
    });
  }
  function scoreDrill(input) {
    input = input || {};
    var limit = input.limitSec || DRILL_LIMIT_SEC;
    var elapsed = Math.max(0, input.elapsedSec || 0);
    var quality = clamp(Math.round(input.quality || 0), 0, 100);
    var achieved = !!input.achieved;
    var pct;
    if (achieved) {
      var timePart = clamp(1 - elapsed / limit, 0, 1);
      pct = clamp(Math.round(quality * 0.7 + timePart * 30), 0, 100);
    } else {
      pct = Math.round(quality * 0.4);
    }
    var grade = pct >= 90 ? 4 : pct >= 70 ? 3 : pct >= 50 ? 2 : 1;
    return {
      pct: pct, grade: grade, achieved: achieved, quality: quality,
      elapsedSec: Math.round(elapsed * 10) / 10, ok: achieved && quality >= 70,
      line: achieved
        ? "View achieved in " + countUnit(elapsed, "second") + " at quality " + quality + "."
        : "View not achieved within " + countUnit(limit, "second") + ". Best quality " + quality + "."
    };
  }
  /* Exam marking, app marked like the CliniX OSCE exam: a station
   * critical fails when the view was not achieved or the final
   * orientation is wrong, whatever the numeric score says. */
  function markExam(stations) {
    stations = stations || [];
    var marked = stations.map(function (s) {
      var achieved = !!s.achieved;
      var angle = s.angleDeg == null ? 0 : s.angleDeg;
      var wrongOrientation = angle > ORIENTATION_CRITICAL_DEG;
      var criticalFail = !achieved || wrongOrientation;
      var quality = clamp(Math.round(s.quality || 0), 0, 100);
      var pct = achieved && !wrongOrientation ? quality : Math.round(quality * 0.4);
      return {
        viewId: s.viewId, achieved: achieved, quality: quality, pct: pct,
        elapsedSec: Math.round((s.elapsedSec || 0) * 10) / 10, angleDeg: angle,
        criticalFail: criticalFail, passed: !criticalFail && pct >= 50,
        reason: !achieved ? "View not achieved" : wrongOrientation ? "Wrong orientation" : ""
      };
    });
    var total = marked.reduce(function (a, s) { return a + s.pct; }, 0);
    var pct = marked.length ? Math.round(total / marked.length) : 0;
    var criticals = marked.filter(function (s) { return s.criticalFail; });
    return {
      stations: marked, pct: pct, passMark: EXAM_PASS_MARK,
      criticalFails: criticals, passed: pct >= EXAM_PASS_MARK && !criticals.length,
      line: criticals.length
        ? "Not passed: " + criticals.length + " critical fail" + (criticals.length > 1 ? "s" : "") + " (" +
          criticals.map(function (s) { return s.viewId + ": " + s.reason.toLowerCase(); }).join("; ") + ")."
        : pct >= EXAM_PASS_MARK ? "Passed at " + pct + " percent." : "Not passed: " + pct + " percent, below the " + EXAM_PASS_MARK + " percent pass mark."
    };
  }

  /* Knobology: knob state in the KARDIA_US shape (gain dB, depth mm,
   * focus mm, three TGC bands in dB, frequency MHz). */
  var KNOB_TARGET = { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 };
  var KNOB_TOLERANCE = { gainDb: 6, depthMm: 15, focusMm: 20, tgcNearDb: 5, tgcMidDb: 5, tgcFarDb: 5, frequencyMHz: 0.6 };
  var KNOB_SCENARIOS = [
    { id: "gain-high", title: "Gain too high", fault: "The whole image is burnt white and blood looks grey. Bring the overall gain back so blood is black and myocardium is mid grey.",
      start: { gainDb: 24, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 },
      target: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 } },
    { id: "depth-wrong", title: "Depth too deep", fault: "The heart fills only the top third of the screen and looks small. Set the depth so the heart fills the sector without cropping the far wall.",
      start: { gainDb: 0, depthMm: 240, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 },
      target: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 } },
    { id: "focus-off", title: "Focus in the wrong place", fault: "The focal zone sits at the bottom of the screen, so the valves are blurred. Move the focus to the depth of the valves, about 70 mm here.",
      start: { gainDb: 0, depthMm: 160, focusMm: 185, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 },
      target: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 } },
    { id: "tgc-banding", title: "TGC banding", fault: "Bright and dark bands run across the image because the time gain compensation sliders are uneven. Level the near, mid and far bands.",
      start: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: -14, tgcMidDb: 12, tgcFarDb: -10, frequencyMHz: 3.0 },
      target: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 } },
    { id: "frequency-wrong", title: "Frequency too low", fault: "A low frequency penetrates but blurs fine detail, so the leaflets look thick. Raise the frequency for this depth: about 3 MHz suits a 160 mm sector.",
      start: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 1.4 },
      target: { gainDb: 0, depthMm: 160, focusMm: 70, tgcNearDb: 0, tgcMidDb: 0, tgcFarDb: 0, frequencyMHz: 3.0 } }
  ];
  function scoreKnob(current, scenario) {
    var target = (scenario && scenario.target) || KNOB_TARGET;
    var keys = Object.keys(KNOB_TOLERANCE);
    var per = {}, fixedCount = 0, errSum = 0;
    keys.forEach(function (k) {
      var err = Math.abs((current && current[k] != null ? current[k] : target[k]) - target[k]);
      var fixed = err <= KNOB_TOLERANCE[k];
      per[k] = { error: Math.round(err * 10) / 10, fixed: fixed, tolerance: KNOB_TOLERANCE[k] };
      if (fixed) fixedCount++;
      errSum += KNOB_TOLERANCE[k] ? clamp(err / (KNOB_TOLERANCE[k] * 3), 0, 1) : 0;
    });
    var pct = Math.round(clamp(1 - errSum / keys.length, 0, 1) * 100);
    return { perKnob: per, fixedCount: fixedCount, totalKnobs: keys.length, allFixed: fixedCount === keys.length, pct: pct };
  }
  /* Spot diagnosis: one pathology with clips, four options drawn from
   * the catalogue names. Deterministic for a given seed. */
  function seededShuffle(list, seed) {
    var out = (list || []).slice(), s = 0;
    var str = String(seed == null ? "" : seed);
    for (var i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0;
    function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    for (var j = out.length - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1)), t = out[j]; out[j] = out[k]; out[k] = t;
    }
    return out;
  }
  function buildSpotQuestion(pathologyIds, names, seed) {
    var pool = (pathologyIds || []).filter(Boolean);
    if (pool.length < 4) return null;
    var ordered = seededShuffle(pool, seed == null ? "spot" : seed);
    var answerId = ordered[0];
    var optionIds = seededShuffle([answerId].concat(ordered.slice(1, 4)), String(seed) + ":opts");
    var options = optionIds.map(function (id) { return { id: id, name: (names && names[id]) || id }; });
    var answer = -1;
    options.forEach(function (o, i) { if (o.id === answerId) answer = i; });
    return { pathology: answerId, options: options, answer: answer };
  }
  function validateProtocol(p) {
    var errors = [];
    if (!p || typeof p !== "object") return ["protocol is not an object"];
    if (!p.id) errors.push("missing id");
    if (!p.title) errors.push("missing title");
    if (!p.scenario) errors.push("missing scenario");
    if (!Array.isArray(p.sources) || !p.sources.length) errors.push("missing sources");
    if (!Array.isArray(p.steps) || !p.steps.length) errors.push("missing steps");
    (p.steps || []).forEach(function (s, i) {
      var at = "step " + (i + 1);
      if (!s.view) errors.push(at + ": missing view");
      if (!s.finding) errors.push(at + ": missing finding");
      var d = s.decision || {};
      if (!d.prompt) errors.push(at + ": missing decision prompt");
      if (!Array.isArray(d.options) || d.options.length < 2) errors.push(at + ": needs at least two options");
      if (typeof d.answer !== "number" || d.answer < 0 || d.answer >= (d.options || []).length) errors.push(at + ": answer out of range");
      if (!d.explanation) errors.push(at + ": missing explanation");
    });
    return errors;
  }

  var PURE = {
    DRILL_LIMIT_SEC: DRILL_LIMIT_SEC, EXAM_LIMIT_SEC: EXAM_LIMIT_SEC, EXAM_PASS_MARK: EXAM_PASS_MARK,
    ORIENTATION_CRITICAL_DEG: ORIENTATION_CRITICAL_DEG, MBBS_VIEWS: MBBS_VIEWS, EXAM_VIEWS: EXAM_VIEWS,
    KNOB_TARGET: KNOB_TARGET, KNOB_TOLERANCE: KNOB_TOLERANCE, KNOB_SCENARIOS: KNOB_SCENARIOS,
    drillViewsForLevel: drillViewsForLevel, examViews: examViews, scoreDrill: scoreDrill,
    markExam: markExam, scoreKnob: scoreKnob, buildSpotQuestion: buildSpotQuestion,
    seededShuffle: seededShuffle, validateProtocol: validateProtocol,
    unitWord: unitWord, countUnit: countUnit, degStr: degStr, degText: degText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
  if (!G || !G.document) return;

  /* ================= browser layer ================= */
  var P = {
    host: null, screen: "home", views: null, viewsErr: false, viewsLoading: false,
    protocols: null, protoErr: false, catalogue: null,
    drill: null, exam: null, knob: null, proto: null, spot: null, timer: null, ownProbe: null
  };
  function I() { return P.host._internal; }
  function esc(s) { return I().esc(s); }
  function txo(en) { return I().tx({ en: en, hi: en }); }
  function base() { return (P.host.cfg && P.host.cfg.base) || G.SMD_KARDIA_BASE || "/kardia/"; }
  function level() {
    try {
      var prefs = P.host._st.prefs;
      var lv = prefs && prefs.klevel;
      return LEVELS.indexOf(lv) >= 0 ? lv : "mbbs";
    } catch (e) { return "mbbs"; }
  }
  function mountEl() { return G.document.getElementById("krdPracticeMount"); }
  function stopTimer() { if (P.timer) { try { G.clearInterval(P.timer); } catch (e) {} P.timer = null; } }
  function record(simId, ok, grade, itemId) {
    try {
      var C = G.SPECIALTY_CORE, st = P.host._st;
      if (!C || !st || !st.store) return;
      C.recordSim(st.store, simId, !!ok, ok ? null : "score", I().today());
      if (itemId && grade) C.review(st.store, "drill", itemId, grade, I().today());
      I().save();
    } catch (e) {}
  }
  function render(html) {
    var m = mountEl();
    if (m) m.innerHTML = html;
  }
  function head(title, sub) {
    return '<div class="krdp-head"><button type="button" class="sp-btn sec krdp-back" data-pact="home">Back to Practice</button>' +
      "<h3 class=\"sp-h3 krdp-title\">" + esc(title) + "</h3>" +
      (sub ? '<p class="sp-small">' + esc(sub) + "</p>" : "") + "</div>";
  }
  function draftNote() {
    return '<p class="krdp-note">Draft teaching material, to be verified before clinical use.</p>';
  }

  /* ---------- data ---------- */
  function loadViews(cb) {
    if (P.views) { cb(P.views); return; }
    if (P.viewsLoading) return;
    P.viewsLoading = true;
    function done(d) { P.viewsLoading = false; P.views = d && d.views ? d : null; if (!P.views) P.viewsErr = true; cb(P.views); }
    try {
      if (!G.fetch) throw new Error("no fetch");
      G.fetch(base() + "views.json").then(function (r) { return r.json(); }).then(done, function () { P.viewsLoading = false; P.viewsErr = true; cb(null); });
    } catch (e) { P.viewsLoading = false; P.viewsErr = true; cb(null); }
  }
  function loadProtocols(cb) {
    if (P.protocols) { cb(P.protocols); return; }
    try {
      if (!G.fetch) throw new Error("no fetch");
      G.fetch(base() + "practice/protocols.json").then(function (r) {
        if (!r.ok) throw new Error("protocols " + r.status);
        return r.json();
      }).then(function (d) { P.protocols = d; cb(d); }, function () { P.protoErr = true; cb(null); });
    } catch (e) { P.protoErr = true; cb(null); }
  }
  function loadCatalogue(cb) {
    if (P.catalogue) { cb(P.catalogue); return; }
    try {
      if (!G.fetch) throw new Error("no fetch");
      G.fetch(base() + "pathology/catalogue.json").then(function (r) { return r.json(); })
        .then(function (d) { P.catalogue = d; cb(d); }, function () { cb(null); });
    } catch (e) { cb(null); }
  }
  function viewById(id) {
    var vs = (P.views && P.views.views) || [];
    for (var i = 0; i < vs.length; i++) if (vs[i].id === id) return vs[i];
    return { id: id, name: id };
  }

  /* ---------- probe adapter ---------- */
  function echoLab() {
    try { return (G.KARDIA && G.KARDIA._kardia && G.KARDIA._kardia.echoLab) || null; } catch (e) { return null; }
  }
  function adapter() {
    var lab = echoLab();
    if (lab && lab.probe) {
      return {
        kind: "echolab",
        setView: function (id) { return lab.setView(id); },
        setState: function (s) { return lab.setProbeState(s); },
        getState: function () { return lab.getProbeState(); },
        score: function () { return lab.getScore(); },
        stateForView: function (id) { return lab.stateForView(id); }
      };
    }
    if (G.KARDIA_PROBE && P.views) {
      if (!P.ownProbe) P.ownProbe = G.KARDIA_PROBE.create({ views: P.views });
      var probe = P.ownProbe;
      return {
        kind: "own",
        setView: function (id) { var s = probe.stateForView(viewById(id)); if (s) probe.setState(s); return !!s; },
        setState: function (s) { return probe.setState(s); },
        getState: function () { return probe.getState(); },
        score: function () { var v = P._adapterView; return v ? probe.score(v) : null; },
        stateForView: function (id) { return probe.stateForView(viewById(id)); }
      };
    }
    return null;
  }
  function offsetFromTarget(ad, viewId) {
    var s = ad.stateForView(viewId);
    if (!s) return;
    var st = JSON.parse(JSON.stringify(s));
    st.rotationDeg = (st.rotationDeg || 0) - 24;
    st.tiltDeg = (st.tiltDeg || 0) + 14;
    if (st.position) st.position.x = (st.position.x || 0) - 16;
    ad.setState(st);
  }
  function drawSchematic(canvas, quality, label) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#0b1114"; ctx.fillRect(0, 0, W, H);
    var cx = W / 2, top = 18, radius = Math.min(W, H) * 0.88;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(cx, top);
    ctx.arc(cx, top, radius, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62);
    ctx.closePath(); ctx.clip();
    ctx.fillStyle = "#10181d"; ctx.fillRect(0, 0, W, H);
    var q = clamp(quality || 0, 0, 100) / 100;
    ctx.strokeStyle = "rgba(220,235,230,0.5)"; ctx.lineWidth = 1.5;
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, top, radius * (0.25 + i * 0.22), Math.PI / 2 - 0.6, Math.PI / 2 + 0.6);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(200,220,215," + (0.08 + q * 0.22).toFixed(2) + ")";
    ctx.beginPath(); ctx.ellipse(cx - radius * 0.18, top + radius * 0.55, radius * (0.1 + q * 0.14), radius * (0.18 + q * 0.18), 0.2, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + radius * 0.22, top + radius * 0.5, radius * (0.08 + q * 0.11), radius * (0.14 + q * 0.15), -0.15, 0, 6.29); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(220,235,230,0.7)";
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.arc(cx, top, radius, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62); ctx.closePath(); ctx.stroke();
    if (label) {
      ctx.fillStyle = "#a3adb3"; ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(label, cx, H - 10);
    }
  }

  /* ================= home ================= */
  function homeHtml() {
    var lv = level();
    var rows = [
      ["drills", "View drills", "Get the view in " + countUnit(DRILL_LIMIT_SEC, "second") + ", scored by time and quality. Set for " + lv.toUpperCase() + "."],
      ["exam", "Exam mode", "Five views in fixed protocol order, app marked. Critical fail for a missed view or wrong orientation."],
      ["knobology", "Knobology drills", "Fix a degraded image: gain, depth, focus, TGC banding or frequency, each within tolerance."],
      ["protocols", "POCUS protocols", "FAST, eFAST, RUSH, BLUE, IVC collapsibility and the ten second pulse check, as timed scenarios."],
      ["spot", "Spot diagnosis", "A real clip or simulated pathology view. Choose the diagnosis from four options."],
      ["credits", "Real patient credits", "Every real clip, its author and its licence."]
    ];
    return '<section class="krdp" aria-label="Kardia practice drills">' +
      '<h3 class="sp-h3">Drills and protocols</h3>' +
      '<p class="sp-small">Graded practice. Results are recorded and weak views come back through spaced repetition.</p>' +
      '<ul class="sp-rows">' + rows.map(function (r) {
        return '<li><button type="button" class="krdp-row" data-pact="' + r[0] + '"><span class="krdp-row-b"><b>' + esc(r[1]) + "</b><span>" + esc(r[2]) + '</span></span><span class="krdp-chev" aria-hidden="true">›</span></button></li>';
      }).join("") + "</ul>" +
      '<div id="krdRealPatientSlot" data-krd-real-patient-slot></div>' +
      draftNote() + "</section>";
  }
  function fillRealPatientSlot() {
    var slot = G.document.getElementById("krdRealPatientSlot");
    if (!slot) return;
    if (slot.getAttribute("data-filled") && slot.querySelector("option")) return;
    slot.setAttribute("data-filled", "1");
    var lvViews = P.views ? drillViewsForLevel(level(), P.views) : [];
    var first = lvViews[0];
    slot.innerHTML = '<div class="krdp-real"><h3 class="sp-h3">Real patient</h3>' +
      '<p class="sp-small">Compare a simulated view with a real patient clip for the same view.</p>' +
      '<label class="krdp-label" for="krdpRealView">View</label>' +
      '<select id="krdpRealView" class="krdp-select">' +
      lvViews.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>"; }).join("") +
      "</select>" +
      '<p><button type="button" class="sp-btn sec sp-wide" data-pact="real-open" ' + (first ? "" : "disabled") + '>Compare with a real patient</button></p>' +
      '<div id="krdpRealPanel"></div></div>';
  }

  /* ================= view drills ================= */
  function showDrillPick() {
    P.screen = "drillPick"; stopTimer();
    if (!P.views) {
      render(head("View drills", "Loading views.") + '<p class="sp-mut" role="status">Loading views.</p>');
      loadViews(function () { if (P.screen === "drillPick") showDrillPick(); });
      return;
    }
    if (P.viewsErr) {
      render(head("View drills") + '<p class="krdp-err" role="alert">Views did not load. Check the connection and try again.</p><p><button type="button" class="sp-btn pri" data-pact="drills-retry">Retry</button></p>');
      return;
    }
    var list = drillViewsForLevel(level(), P.views);
    var body = !list.length
      ? '<p class="sp-small">No views at this level yet.</p>'
      : '<ul class="sp-rows">' + list.map(function (v) {
          return '<li><button type="button" class="krdp-row" data-pact="drill-start" data-v="' + esc(v.id) + '"><span class="krdp-row-b"><b>' + esc(v.name) + "</b><span>Get this view in " + countUnit(DRILL_LIMIT_SEC, "second") + '.</span></span><span class="krdp-chev" aria-hidden="true">›</span></button></li>';
        }).join("") + "</ul>";
    render(head("View drills", "Level: " + level().toUpperCase() + ". Each drill starts a little off target. Hold the view inside tolerance to finish.") + body + draftNote());
  }
  function startDrill(viewId) {
    var ad = adapter();
    var view = viewById(viewId);
    P._adapterView = view;
    P.drill = { viewId: viewId, view: view, startedAt: Date.now(), achievedSince: null, bestQuality: 0, done: false, result: null, ad: ad };
    P.screen = "drillRun";
    if (ad) { ad.setView(viewId); offsetFromTarget(ad, viewId); }
    render(drillRunHtml());
    wireDrillControls();
    pollDrill();
    stopTimer();
    P.timer = G.setInterval(pollDrill, 250);
  }
  function drillRunHtml() {
    var d = P.drill;
    return head("Get the view in " + countUnit(DRILL_LIMIT_SEC, "second"), d.view.name) +
      '<div class="krdp-run">' +
      '<div class="krdp-timer" role="timer" aria-label="Time remaining"><span id="krdpDrillTime">' + DRILL_LIMIT_SEC + '</span><span class="krdp-timer-lab" id="krdpDrillUnits">seconds left</span></div>' +
      '<canvas id="krdpSector" width="640" height="480" aria-label="Simulated ultrasound sector"></canvas>' +
      '<p class="krdp-simnote" id="krdpProbeKind">' + (d.ad ? (d.ad.kind === "echolab" ? "Using the Echo Lab probe. Adjust it here or in Echo Lab; both move the same probe." : "Echo Lab probe not loaded, so a standalone probe is in use with a schematic sector.") : "Probe not available on this device. The drill cannot run.") + "</p>" +
      '<div class="krd-quality"><div class="krd-score-row"><span class="krd-score" id="krdpScore">0</span><span class="krd-score-label">quality</span>' +
      '<span class="krd-achieved" id="krdpAchieved" hidden>View achieved</span></div>' +
      '<div class="krd-meter" role="meter" aria-label="View quality" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="krdpMeter"><span id="krdpMeterFill"></span></div>' +
      '<ul class="krd-hints" id="krdpHints"></ul></div>' +
      probeControlsHtml(d.ad) +
      '<p><button type="button" class="sp-btn sec sp-wide" data-pact="drill-giveup">End drill</button></p>' +
      '<div id="krdpDrillResult"></div></div>';
  }
  function probeControlsHtml(ad) {
    if (!ad) return "";
    var st = ad.getState() || { rotationDeg: 0, tiltDeg: 0, rockDeg: 0, position: { x: 0, y: 0 } };
    function range(id, label, min, max, val, unit) {
      var isDeg = unit === " deg";
      var text = isDeg ? degStr(val) : Math.round(val) + unit;
      var vt = isDeg ? ' aria-valuetext="' + degText(val) + '"' : "";
      return '<div class="krd-ctl"><label for="' + id + '">' + label + ' <span class="krd-ctl-val" id="' + id + 'Val">' + text + '</span></label>' +
        '<input type="range" id="' + id + '" data-krdp-range="' + id + '" min="' + min + '" max="' + max + '" step="1" value="' + Math.round(val) + '" aria-label="' + label + '"' + vt + '></div>';
    }
    return '<div class="krd-controls krdp-controls">' +
      range("krdpSlideX", "Slide across window", -45, 45, st.position ? st.position.x : 0, " mm") +
      range("krdpRot", "Rotation", -180, 180, st.rotationDeg || 0, " deg") +
      range("krdpTilt", "Tilt (fan)", -80, 80, st.tiltDeg || 0, " deg") +
      range("krdpRock", "Rock", -60, 60, st.rockDeg || 0, " deg") + "</div>";
  }
  function wireDrillControls() {
    var ad = P.drill && P.drill.ad;
    if (!ad) return;
    Array.prototype.forEach.call(G.document.querySelectorAll("[data-krdp-range]"), function (el) {
      el.addEventListener("input", function () {
        var id = el.getAttribute("data-krdp-range"), val = parseFloat(el.value);
        var lbl = G.document.getElementById(id + "Val");
        if (id === "krdpSlideX") { var s = ad.getState(); ad.setState({ position: { x: val, y: s.position ? s.position.y : 0 } }); }
        else if (id === "krdpRot") ad.setState({ rotationDeg: val });
        else if (id === "krdpTilt") ad.setState({ tiltDeg: val });
        else if (id === "krdpRock") ad.setState({ rockDeg: val });
        if (id === "krdpSlideX") { if (lbl) lbl.textContent = Math.round(val) + " mm"; }
        else { if (lbl) lbl.textContent = degStr(val); el.setAttribute("aria-valuetext", degText(val)); }
      });
    });
  }
  function pollDrill() {
    var d = P.drill;
    if (!d || d.done || P.screen !== "drillRun") return;
    var elapsed = (Date.now() - d.startedAt) / 1000;
    var left = Math.max(0, Math.ceil(DRILL_LIMIT_SEC - elapsed));
    var timeEl = G.document.getElementById("krdpDrillTime");
    if (timeEl) timeEl.textContent = String(left);
    var drillUnits = G.document.getElementById("krdpDrillUnits");
    if (drillUnits) drillUnits.textContent = unitWord(left, "second left", "seconds left");
    var score = d.ad ? d.ad.score() : null;
    var quality = score ? score.score : 0;
    if (quality > d.bestQuality) d.bestQuality = quality;
    var scoreEl = G.document.getElementById("krdpScore");
    if (scoreEl) scoreEl.textContent = String(quality);
    var fill = G.document.getElementById("krdpMeterFill");
    if (fill) fill.style.width = quality + "%";
    var meter = G.document.getElementById("krdpMeter");
    if (meter) meter.setAttribute("aria-valuenow", String(quality));
    var hints = G.document.getElementById("krdpHints");
    if (hints && score) hints.innerHTML = score.hints.slice(0, 3).map(function (h) { return "<li>" + esc(h) + "</li>"; }).join("");
    drawSchematic(G.document.getElementById("krdpSector"), quality, "Schematic sector");
    var now = Date.now();
    if (score && score.withinTolerance) { if (!d.achievedSince) d.achievedSince = now; }
    else d.achievedSince = null;
    var held = d.achievedSince ? now - d.achievedSince : 0;
    var ach = G.document.getElementById("krdpAchieved");
    if (ach) ach.hidden = held < 1000;
    if (held >= 1000) finishDrill(true, elapsed, quality);
    else if (elapsed >= DRILL_LIMIT_SEC) finishDrill(false, elapsed, d.bestQuality);
  }
  function finishDrill(achieved, elapsed, quality) {
    var d = P.drill;
    if (!d || d.done) return;
    d.done = true; stopTimer();
    var res = scoreDrill({ elapsedSec: elapsed, quality: quality, achieved: achieved, limitSec: DRILL_LIMIT_SEC });
    d.result = res;
    record("kardia-view-drill", res.ok, res.grade, "kardia-view-" + d.viewId);
    var box = G.document.getElementById("krdpDrillResult");
    if (box) {
      box.innerHTML = '<div class="krdp-result" role="status"><h3 class="sp-h3">' + (res.achieved ? "View achieved" : "Time up") + "</h3>" +
        "<p>" + esc(res.line) + " Score " + res.pct + " percent. This view is scheduled to come back through spaced repetition.</p>" +
        '<p><button type="button" class="sp-btn pri sp-wide" data-pact="drill-again" data-v="' + esc(d.viewId) + '">Try again</button></p>' +
        '<p><button type="button" class="sp-btn sec sp-wide" data-pact="drills">All view drills</button></p></div>';
      var b = box.querySelector("[data-pact]");
      if (b) b.focus();
    }
  }

  /* ================= exam ================= */
  function showExamIntro() {
    P.screen = "examIntro"; stopTimer();
    if (!P.views) { render(head("Exam mode", "Loading views.") + '<p class="sp-mut" role="status">Loading views.</p>'); loadViews(function () { if (P.screen === "examIntro") showExamIntro(); }); return; }
    var list = examViews(P.views);
    render(head("Exam mode", "App marked, like an OSCE station. Five views in fixed protocol order, " + countUnit(EXAM_LIMIT_SEC, "second") + " each.") +
      '<ol class="krdp-list">' + list.map(function (v) { return "<li>" + esc(v.name) + "</li>"; }).join("") + "</ol>" +
      '<p class="sp-small">A station critical fails if the view is not achieved or the final orientation is wrong (more than ' + countUnit(ORIENTATION_CRITICAL_DEG, "degree") + ' off). The report at the end is final.</p>' +
      '<p><button type="button" class="sp-btn pri sp-wide" data-pact="exam-start">Start exam</button></p>' + draftNote());
  }
  function startExam() {
    var list = examViews(P.views);
    P.exam = { stations: list, i: 0, results: [], startedAt: null, achievedSince: null, bestQuality: 0, done: false };
    P.screen = "examRun";
    startExamStation();
  }
  function startExamStation() {
    var ex = P.exam, view = ex.stations[ex.i];
    var ad = adapter();
    P._adapterView = view;
    ex.ad = ad; ex.startedAt = Date.now(); ex.achievedSince = null; ex.bestQuality = 0; ex.done = false;
    if (ad) { ad.setView(view.id); offsetFromTarget(ad, view.id); }
    render(head("Exam: station " + (ex.i + 1) + " of " + ex.stations.length, view.name) +
      '<div class="krdp-timer" role="timer"><span id="krdpExamTime">' + EXAM_LIMIT_SEC + '</span><span class="krdp-timer-lab" id="krdpExamUnits">seconds left</span></div>' +
      '<canvas id="krdpSector" width="640" height="480" aria-label="Simulated ultrasound sector"></canvas>' +
      '<div class="krd-quality"><div class="krd-score-row"><span class="krd-score" id="krdpScore">0</span><span class="krd-score-label">quality</span>' +
      '<span class="krd-achieved" id="krdpAchieved" hidden>View achieved</span></div>' +
      '<div class="krd-meter" role="meter" aria-label="View quality" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="krdpMeter"><span id="krdpMeterFill"></span></div>' +
      '<ul class="krd-hints" id="krdpHints"></ul></div>' +
      probeControlsHtml(ad) +
      '<p><button type="button" class="sp-btn sec sp-wide" data-pact="exam-next">Finish this station</button></p>');
    P.drill = { ad: ad };
    wireDrillControls();
    stopTimer();
    P.timer = G.setInterval(pollExam, 250);
  }
  function pollExam() {
    var ex = P.exam;
    if (!ex || P.screen !== "examRun") return;
    var elapsed = (Date.now() - ex.startedAt) / 1000;
    var left = Math.max(0, Math.ceil(EXAM_LIMIT_SEC - elapsed));
    var t = G.document.getElementById("krdpExamTime");
    if (t) t.textContent = String(left);
    var examUnits = G.document.getElementById("krdpExamUnits");
    if (examUnits) examUnits.textContent = unitWord(left, "second left", "seconds left");
    var score = ex.ad ? ex.ad.score() : null;
    var quality = score ? score.score : 0;
    if (quality > ex.bestQuality) ex.bestQuality = quality;
    ex.lastScore = score;
    var sEl = G.document.getElementById("krdpScore");
    if (sEl) sEl.textContent = String(quality);
    var fill = G.document.getElementById("krdpMeterFill");
    if (fill) fill.style.width = quality + "%";
    var hints = G.document.getElementById("krdpHints");
    if (hints && score) hints.innerHTML = score.hints.slice(0, 3).map(function (h) { return "<li>" + esc(h) + "</li>"; }).join("");
    drawSchematic(G.document.getElementById("krdpSector"), quality, "Schematic sector");
    var now = Date.now();
    if (score && score.withinTolerance) { if (!ex.achievedSince) ex.achievedSince = now; } else ex.achievedSince = null;
    var held = ex.achievedSince ? now - ex.achievedSince : 0;
    var ach = G.document.getElementById("krdpAchieved");
    if (ach) ach.hidden = held < 1000;
    ex.achieved = held >= 1000;
    if (elapsed >= EXAM_LIMIT_SEC) finishExamStation();
  }
  function finishExamStation() {
    var ex = P.exam;
    if (!ex || ex.done) return;
    ex.done = true; stopTimer();
    var elapsed = (Date.now() - ex.startedAt) / 1000;
    var score = ex.lastScore || (ex.ad ? ex.ad.score() : null);
    ex.results.push({
      viewId: ex.stations[ex.i].id, achieved: !!ex.achieved,
      quality: ex.bestQuality, elapsedSec: elapsed,
      angleDeg: score ? score.angleDeg : 0
    });
    ex.i++;
    if (ex.i < ex.stations.length) { startExamStation(); return; }
    var report = markExam(ex.results);
    ex.report = report;
    record("kardia-exam", report.passed, report.passed ? 3 : 1, "kardia-exam");
    P.screen = "examReport";
    render(head("Exam report", report.line) +
      '<ul class="krdp-report">' + report.stations.map(function (s, i) {
        var v = viewById(s.viewId);
        return "<li><b>" + (i + 1) + ". " + esc(v.name) + "</b> " +
          '<span class="' + (s.criticalFail ? "krdp-bad" : "krdp-ok") + '">' + (s.criticalFail ? "Critical fail: " + esc(s.reason) : "Passed") + "</span>" +
          '<span class="krdp-meta">Quality ' + s.quality + ", " + Math.round(s.elapsedSec) + " " + unitWord(s.elapsedSec, "second", "seconds") + ", orientation " + s.angleDeg + " " + unitWord(s.angleDeg, "degree", "degrees") + " off.</span></li>";
      }).join("") + "</ul>" +
      "<p>Total " + report.pct + " percent. Pass mark " + report.passMark + " percent with no critical fails.</p>" +
      '<p><button type="button" class="sp-btn pri sp-wide" data-pact="exam">Back to exam start</button></p>' + draftNote());
  }

  /* ================= knobology ================= */
  function showKnobPick() {
    P.screen = "knobPick"; stopTimer();
    var hasUs = !!G.KARDIA_US;
    var intro = hasUs
      ? "Each drill starts from a degraded image setting. Adjust the knobs until every one is within tolerance of the target image."
      : "Knobology needs the ultrasound image model, which is not loaded on this device, so these drills are unavailable here.";
    var body = hasUs
      ? '<ul class="sp-rows">' + KNOB_SCENARIOS.map(function (s) {
          return '<li><button type="button" class="krdp-row" data-pact="knob-start" data-v="' + esc(s.id) + '"><span class="krdp-row-b"><b>' + esc(s.title) + "</b><span>" + esc(s.fault) + '</span></span><span class="krdp-chev" aria-hidden="true">›</span></button></li>';
        }).join("") + "</ul>"
      : '<p class="krdp-note" role="status">' + esc(intro) + "</p>";
    render(head("Knobology drills", hasUs ? intro : "") + (hasUs ? body : "") + draftNote());
  }
  function startKnob(id) {
    var sc = null;
    KNOB_SCENARIOS.forEach(function (s) { if (s.id === id) sc = s; });
    if (!sc) return;
    P.knob = { scenario: sc, current: JSON.parse(JSON.stringify(sc.start)), startedAt: Date.now(), done: false };
    P.screen = "knobRun";
    renderKnobRun();
  }
  function knobControlsHtml(cur) {
    function range(id, label, min, max, step, val, unit) {
      return '<div class="krd-ctl"><label for="' + id + '">' + label + ' <span class="krd-ctl-val" id="' + id + 'Val">' + (Math.round(val * 10) / 10) + unit + '</span></label>' +
        '<input type="range" id="' + id + '" data-krdp-knob="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" aria-label="' + label + '"></div>';
    }
    return '<div class="krd-controls krdp-controls">' +
      range("krdpGain", "Overall gain", -30, 30, 1, cur.gainDb, " dB") +
      range("krdpDepth", "Depth", 80, 240, 5, cur.depthMm, " mm") +
      range("krdpFocus", "Focus depth", 20, 200, 5, cur.focusMm, " mm") +
      range("krdpTgcN", "TGC near", -20, 20, 1, cur.tgcNearDb, " dB") +
      range("krdpTgcM", "TGC mid", -20, 20, 1, cur.tgcMidDb, " dB") +
      range("krdpTgcF", "TGC far", -20, 20, 1, cur.tgcFarDb, " dB") +
      range("krdpFreq", "Frequency", 1, 6, 0.1, cur.frequencyMHz, " MHz") + "</div>";
  }
  function renderKnobRun() {
    var k = P.knob;
    render(head(k.scenario.title, k.scenario.fault) +
      '<canvas id="krdpSector" width="640" height="480" aria-label="Simulated ultrasound sector with the current knob settings"></canvas>' +
      '<p class="krdp-status" id="krdpKnobStatus" role="status"></p>' +
      knobControlsHtml(k.current) +
      '<p><button type="button" class="sp-btn pri sp-wide" data-pact="knob-check">Check the image</button></p>' +
      '<div id="krdpKnobResult"></div>');
    Array.prototype.forEach.call(G.document.querySelectorAll("[data-krdp-knob]"), function (el) {
      el.addEventListener("input", function () {
        var id = el.getAttribute("data-krdp-knob"), val = parseFloat(el.value);
        var map = { krdpGain: "gainDb", krdpDepth: "depthMm", krdpFocus: "focusMm", krdpTgcN: "tgcNearDb", krdpTgcM: "tgcMidDb", krdpTgcF: "tgcFarDb", krdpFreq: "frequencyMHz" };
        if (map[id]) P.knob.current[map[id]] = val;
        var lbl = G.document.getElementById(id + "Val");
        if (lbl) lbl.textContent = (Math.round(val * 10) / 10) + (id === "krdpDepth" || id === "krdpFocus" ? " mm" : id === "krdpFreq" ? " MHz" : " dB");
        drawKnobImage();
      });
    });
    drawKnobImage();
  }
  function drawKnobImage() {
    var k = P.knob;
    if (!k) return;
    var res = scoreKnob(k.current, k.scenario);
    drawSchematic(G.document.getElementById("krdpSector"), res.pct, "Knob image quality " + res.pct + " percent");
    var st = G.document.getElementById("krdpKnobStatus");
    if (st) st.textContent = res.fixedCount + " of " + res.totalKnobs + " knobs within tolerance.";
  }
  function checkKnob() {
    var k = P.knob;
    if (!k || k.done) return;
    var res = scoreKnob(k.current, k.scenario);
    var box = G.document.getElementById("krdpKnobResult");
    if (!res.allFixed) {
      if (box) box.innerHTML = '<p class="krdp-err" role="status">Not yet: ' + res.fixedCount + " of " + res.totalKnobs + " knobs are within tolerance. Adjust the ones that are off and check again.</p>";
      return;
    }
    k.done = true;
    var elapsed = Math.round((Date.now() - k.startedAt) / 1000);
    record("kardia-knobology", true, res.pct >= 90 ? 4 : 3, "kardia-knob-" + k.scenario.id);
    if (box) box.innerHTML = '<div class="krdp-result" role="status"><h3 class="sp-h3">Image fixed</h3><p>Every knob is within tolerance in ' + countUnit(elapsed, "second") + '. Score ' + res.pct + ' percent.</p>' +
      '<p><button type="button" class="sp-btn pri sp-wide" data-pact="knobology">All knobology drills</button></p></div>';
  }

  /* ================= protocols ================= */
  function showProtoPick() {
    P.screen = "protoPick"; stopTimer();
    if (!P.protocols) {
      render(head("POCUS protocols", "Loading protocols.") + '<p class="sp-mut" role="status">Loading protocols.</p>');
      loadProtocols(function () { if (P.screen === "protoPick") showProtoPick(); });
      loadViews(function () {});
      return;
    }
    if (P.protoErr) {
      render(head("POCUS protocols") + '<p class="krdp-err" role="alert">Protocols did not load. Check the connection and try again.</p><p><button type="button" class="sp-btn pri" data-pact="protocols-retry">Retry</button></p>');
      return;
    }
    var list = P.protocols.protocols || [];
    render(head("POCUS protocols", "Timed scenarios. Each step names the view, the finding to look for and a decision.") +
      '<ul class="sp-rows">' + list.map(function (p) {
        return '<li><button type="button" class="krdp-row" data-pact="proto-start" data-v="' + esc(p.id) + '"><span class="krdp-row-b"><b>' + esc(p.title) + "</b><span>" + esc(p.scenario) + '</span></span><span class="krdp-chev" aria-hidden="true">›</span></button></li>';
      }).join("") + "</ul>" + draftNote());
  }
  function startProtocol(id) {
    var proto = null;
    (P.protocols.protocols || []).forEach(function (p) { if (p.id === id) proto = p; });
    if (!proto) return;
    P.proto = { data: proto, i: 0, correct: 0, startedAt: Date.now(), stepStartedAt: Date.now(), answers: [], done: false, timedOut: false };
    P.screen = "protoRun";
    renderProtoStep();
    stopTimer();
    P.timer = G.setInterval(pollProto, 250);
  }
  function renderProtoStep() {
    var pr = P.proto, step = pr.data.steps[pr.i];
    var view = viewById(step.view);
    var isPulse = pr.data.id === "pulse_check";
    var linkHtml = "";
    if (isPulse && pr.i === 0) {
      linkHtml = '<div class="krdp-links"><p><button type="button" class="sp-btn sec sp-wide" data-pact="proto-codeblue">Open in Code Blue</button></p>' +
        '<p><button type="button" class="sp-btn sec sp-wide" data-pact="proto-narke">Open Narkē for perioperative context</button></p></div>';
    }
    render(head(pr.data.title, pr.data.scenario) +
      '<p class="krdp-step">Step ' + (pr.i + 1) + " of " + pr.data.steps.length + ": " + esc(step.title) + "</p>" +
      (isPulse
        ? '<div class="krdp-timer krdp-pause" role="timer" aria-label="Pause time remaining"><span id="krdpPauseTime">10</span><span class="krdp-timer-lab" id="krdpPauseUnits">seconds of pause left: lift the probe at zero</span></div>'
        : '<div class="krdp-timer" role="timer"><span id="krdpProtoTime">0</span><span class="krdp-timer-lab" id="krdpProtoUnits">seconds elapsed</span></div>') +
      '<div class="krdp-viewbox"><h3 class="sp-h3">' + esc(view.name || step.view) + '</h3>' +
      '<p><b>Finding to look for.</b> ' + esc(step.finding) + "</p>" +
      "<p><b>Decision.</b> " + esc(step.decision.prompt) + "</p></div>" +
      '<div class="krdp-options" role="group" aria-label="Decision options">' +
      step.decision.options.map(function (o, i) {
        return '<button type="button" class="sp-btn sec sp-wide krdp-opt" data-pact="proto-answer" data-v="' + i + '">' + esc(o) + "</button>";
      }).join("") + "</div>" +
      '<div id="krdpProtoFeedback"></div>' + linkHtml + draftNote());
  }
  function pollProto() {
    var pr = P.proto;
    if (!pr || P.screen !== "protoRun" || pr.done) return;
    if (pr.data.id === "pulse_check") {
      var stepElapsed = (Date.now() - pr.stepStartedAt) / 1000;
      var left = Math.max(0, Math.ceil((pr.data.pauseLimitSec || 10) - stepElapsed));
      var el = G.document.getElementById("krdpPauseTime");
      if (el) el.textContent = String(left);
      var pauseUnits = G.document.getElementById("krdpPauseUnits");
      if (pauseUnits) pauseUnits.textContent = unitWord(left, "second of pause left: lift the probe at zero", "seconds of pause left: lift the probe at zero");
      if (stepElapsed >= (pr.data.pauseLimitSec || 10) && !pr.timedOut) {
        pr.timedOut = true;
        answerProtocol(-1);
      }
    } else {
      var elapsed = Math.floor((Date.now() - pr.startedAt) / 1000);
      var t = G.document.getElementById("krdpProtoTime");
      if (t) t.textContent = String(elapsed);
      var protoUnits = G.document.getElementById("krdpProtoUnits");
      if (protoUnits) protoUnits.textContent = unitWord(elapsed, "second elapsed", "seconds elapsed");
    }
  }
  function answerProtocol(chosen) {
    var pr = P.proto;
    if (!pr || pr.done) return;
    var step = pr.data.steps[pr.i];
    var correct = chosen === step.decision.answer;
    if (correct) pr.correct++;
    pr.answers.push({ step: pr.i, chosen: chosen, correct: correct });
    var box = G.document.getElementById("krdpProtoFeedback");
    var last = pr.i === pr.data.steps.length - 1;
    if (box) {
      box.innerHTML = '<div class="krdp-result" role="status"><p><b>' + (chosen < 0 ? "Pause over: the probe lifts now." : correct ? "Correct." : "Not the protocol call.") + "</b> " + esc(step.decision.explanation) + "</p>" +
        '<p><button type="button" class="sp-btn pri sp-wide" data-pact="proto-next">' + (last ? "See the report" : "Next step") + "</button></p></div>";
      var nb = box.querySelector("[data-pact]");
      if (nb) nb.focus();
    }
    /* Disable the options until Next, so one step gets one answer. */
    Array.prototype.forEach.call(G.document.querySelectorAll("[data-pact='proto-answer']"), function (b) { b.disabled = true; });
    pr.answered = true;
  }
  function nextProtocolStep() {
    var pr = P.proto;
    if (!pr) return;
    pr.i++; pr.timedOut = false; pr.answered = false; pr.stepStartedAt = Date.now();
    if (pr.i < pr.data.steps.length) { renderProtoStep(); return; }
    pr.done = true; stopTimer();
    var elapsed = Math.round((Date.now() - pr.startedAt) / 1000);
    var pct = pr.data.steps.length ? Math.round(pr.correct / pr.data.steps.length * 100) : 0;
    var withinTime = !pr.data.timeLimitSec || elapsed <= pr.data.timeLimitSec;
    var ok = pct >= 75 && withinTime;
    record("kardia-protocol", ok, pct >= 90 ? 4 : pct >= 75 ? 3 : pct >= 50 ? 2 : 1, "kardia-protocol-" + pr.data.id);
    P.screen = "protoReport";
    render(head(pr.data.title + ": report", pr.correct + " of " + pr.data.steps.length + " decisions correct in " + countUnit(elapsed, "second") + (pr.data.timeLimitSec ? " (limit " + countUnit(pr.data.timeLimitSec, "second") + ")" : "") + ".") +
      '<ul class="krdp-report">' + pr.data.steps.map(function (s, i) {
        var a = pr.answers[i];
        return "<li><b>" + (i + 1) + ". " + esc(s.title) + "</b> " +
          '<span class="' + (a && a.correct ? "krdp-ok" : "krdp-bad") + '">' + (a && a.correct ? "Correct" : "Missed") + "</span>" +
          '<span class="krdp-meta">' + esc(s.decision.explanation) + "</span></li>";
      }).join("") + "</ul>" +
      (pr.data.id === "pulse_check"
        ? '<p><button type="button" class="sp-btn sec sp-wide" data-pact="proto-codeblue">Open in Code Blue</button></p>'
        : "") +
      '<p class="sp-small">Sources: ' + pr.data.sources.map(function (s) { return esc(s); }).join("; ") + ".</p>" +
      '<p><button type="button" class="sp-btn pri sp-wide" data-pact="protocols">All protocols</button></p>' + draftNote());
  }
  function openCodeBlue() {
    try {
      if (G.CodeBlueLive && G.CodeBlueLive.open) { G.CodeBlueLive.open({ training: true, mode: "adult" }); return true; }
    } catch (e) {}
    try { if (G.toast) G.toast("Code Blue is not available on this device."); } catch (e) {}
    return false;
  }
  function openNarke() {
    try {
      if (G.NARKE && G.NARKE.open) { G.NARKE.open(); return true; }
    } catch (e) {}
    try { if (G.toast) G.toast("Narkē is not available on this device."); } catch (e) {}
    return false;
  }
  function openPulseCheckEcho() {
    try { if (G.KARDIA && G.KARDIA.open) G.KARDIA.open(); } catch (e) {}
    var tries = 0;
    function go() {
      tries++;
      if (mountEl()) {
        showProtoPick();
        loadProtocols(function () { startProtocol("pulse_check"); });
        return;
      }
      if (tries < 20) G.setTimeout(go, 250);
    }
    G.setTimeout(go, 250);
    return true;
  }
  try { G.addEventListener("kardia:pulse-check", function () { openPulseCheckEcho(); }); } catch (e) {}

  /* ================= spot diagnosis ================= */
  var SPOT_NAMES = {
    mitral_stenosis: "Mitral stenosis", aortic_stenosis: "Aortic stenosis",
    mitral_regurgitation: "Mitral regurgitation", aortic_regurgitation: "Aortic regurgitation",
    pericardial_effusion: "Pericardial effusion", cardiac_tamponade: "Cardiac tamponade",
    hcm_obstructive_sam: "Hypertrophic cardiomyopathy with obstruction",
    hcm_non_obstructive: "Hypertrophic cardiomyopathy without obstruction",
    dilated_cardiomyopathy: "Dilated cardiomyopathy", atrial_septal_defect: "Atrial septal defect",
    ventricular_septal_defect: "Ventricular septal defect",
    infective_endocarditis_vegetation: "Infective endocarditis with vegetation",
    lv_thrombus: "Left ventricular thrombus",
    regional_wall_motion_abnormality_mi: "Regional wall motion abnormality after infarction"
  };
  function showSpot() {
    P.screen = "spot"; stopTimer();
    render(head("Spot diagnosis", "Loading a case.") + '<p class="sp-mut" role="status">Loading a case.</p>');
    var clipsReady = G.KARDIA_CLIPS ? G.KARDIA_CLIPS.load() : Promise.reject(new Error("no clips"));
    var catReady = new Promise(function (res) { loadCatalogue(res); });
    Promise.all([clipsReady.catch(function () { return null; }), catReady]).then(function () {
      if (P.screen !== "spot") return;
      var names = {};
      Object.keys(SPOT_NAMES).forEach(function (k) { names[k] = SPOT_NAMES[k]; });
      if (P.catalogue && P.catalogue.conditions) P.catalogue.conditions.forEach(function (c) { names[c.id] = c.name; });
      var pool = [];
      if (G.KARDIA_CLIPS && G.KARDIA_CLIPS.credits) {
        Object.keys(G.KARDIA_CLIPS.credits.byPathology).forEach(function (k) { pool.push(k); });
      }
      if (pool.length < 4) {
        /* Simulated fallback: no clip pool on this device. */
        pool = Object.keys(SPOT_NAMES);
        P.spot = { simulated: true, names: names, pool: pool };
        renderSpotQuestion();
        return;
      }
      P.spot = { simulated: false, names: names, pool: pool };
      renderSpotQuestion();
    });
  }
  function renderSpotQuestion() {
    var sp = P.spot;
    var q = buildSpotQuestion(sp.pool, sp.names, "spot-" + Date.now());
    if (!q) {
      render(head("Spot diagnosis") + '<p class="sp-small">Not enough cases to build a four option question yet.</p>');
      return;
    }
    sp.question = q;
    var media = "";
    if (!sp.simulated && G.KARDIA_CLIPS) {
      media = G.KARDIA_CLIPS.compareHtml({ pathology: q.pathology }, sp.names[q.pathology]);
    } else {
      media = '<canvas id="krdpSector" width="640" height="480" aria-label="Simulated pathology view"></canvas>' +
        '<p class="krdp-simnote">Simulated view. No real clip pool is loaded on this device, so the simulated pathology view stands in.</p>';
    }
    render(head("Spot diagnosis", "What is the diagnosis?") +
      media +
      '<div class="krdp-options" role="group" aria-label="Diagnosis options">' +
      q.options.map(function (o, i) {
        return '<button type="button" class="sp-btn sec sp-wide krdp-opt" data-pact="spot-answer" data-v="' + i + '">' + esc(o.name) + "</button>";
      }).join("") + "</div>" +
      '<div id="krdpSpotFeedback"></div>' + draftNote());
    if (sp.simulated) drawSchematic(G.document.getElementById("krdpSector"), 60, "Simulated pathology view");
    if (G.KARDIA_CLIPS) G.KARDIA_CLIPS.wirePanel(mountEl());
  }
  function answerSpot(chosen) {
    var sp = P.spot, q = sp && sp.question;
    if (!q) return;
    var correct = chosen === q.answer;
    record("kardia-spot", correct, correct ? 3 : 1, "kardia-spot-" + q.pathology);
    var box = G.document.getElementById("krdpSpotFeedback");
    var explanation = "The correct diagnosis is " + sp.names[q.pathology] + ".";
    if (P.catalogue && P.catalogue.conditions) {
      P.catalogue.conditions.forEach(function (c) {
        if (c.id === q.pathology && c.echo_findings && c.echo_findings.length) {
          explanation += " Look for: " + c.echo_findings.slice(0, 2).join("; ") + ".";
        }
      });
    }
    if (box) {
      box.innerHTML = '<div class="krdp-result" role="status"><p><b>' + (correct ? "Correct." : "Not this one.") + "</b> " + esc(explanation) + "</p>" +
        '<p><button type="button" class="sp-btn pri sp-wide" data-pact="spot-next">Next case</button></p>' +
        '<p><button type="button" class="sp-btn sec sp-wide" data-pact="home">Back to Practice</button></p></div>';
    }
    Array.prototype.forEach.call(G.document.querySelectorAll("[data-pact='spot-answer']"), function (b) { b.disabled = true; });
  }

  /* ================= credits ================= */
  function showCredits() {
    P.screen = "credits"; stopTimer();
    render(head("Real patient credits", "Every real clip in Kardia, with its author and licence.") + '<div id="krdpCredits"><p class="sp-mut" role="status">Loading credits.</p></div>');
    if (G.KARDIA_CLIPS) {
      G.KARDIA_CLIPS.attach(P.host);
      G.KARDIA_CLIPS.load().then(function () {
        var box = G.document.getElementById("krdpCredits");
        if (box && P.screen === "credits") box.innerHTML = G.KARDIA_CLIPS.creditsHtml() +
          ((G.KARDIA_SCANLAB && G.KARDIA_SCANLAB.bodyCreditsHtml) ? '<h3 class="sp-h3">Body models</h3>' + G.KARDIA_SCANLAB.bodyCreditsHtml() : "");
      }, function () {
        var box = G.document.getElementById("krdpCredits");
        if (box) box.innerHTML = '<p class="krdp-err" role="alert">Credits did not load. Check the connection and try again.</p>';
      });
    }
  }

  /* ================= mount and actions ================= */
  function showHome() {
    P.screen = "home"; stopTimer();
    render(homeHtml());
    fillRealPatientSlot();
    if (!P.views) loadViews(function () { if (P.screen === "home") fillRealPatientSlot(); });
  }
  function onMountClick(e) {
    var b = e.target;
    while (b && b !== mountEl() && !(b.getAttribute && b.getAttribute("data-pact"))) b = b.parentNode;
    if (!b || !b.getAttribute) return;
    var act = b.getAttribute("data-pact");
    if (!act) return;
    if (act === "home") showHome();
    else if (act === "drills") showDrillPick();
    else if (act === "drills-retry") { P.views = null; P.viewsErr = false; showDrillPick(); }
    else if (act === "drill-start") startDrill(b.getAttribute("data-v"));
    else if (act === "drill-again") startDrill(b.getAttribute("data-v"));
    else if (act === "drill-giveup") { if (P.drill) finishDrill(false, (Date.now() - P.drill.startedAt) / 1000, P.drill.bestQuality); }
    else if (act === "exam") showExamIntro();
    else if (act === "exam-start") startExam();
    else if (act === "exam-next") finishExamStation();
    else if (act === "knobology") showKnobPick();
    else if (act === "knob-start") startKnob(b.getAttribute("data-v"));
    else if (act === "knob-check") checkKnob();
    else if (act === "protocols") showProtoPick();
    else if (act === "protocols-retry") { P.protocols = null; P.protoErr = false; showProtoPick(); }
    else if (act === "proto-start") startProtocol(b.getAttribute("data-v"));
    else if (act === "proto-answer") answerProtocol(parseInt(b.getAttribute("data-v"), 10));
    else if (act === "proto-next") nextProtocolStep();
    else if (act === "proto-codeblue") openCodeBlue();
    else if (act === "proto-narke") openNarke();
    else if (act === "spot") showSpot();
    else if (act === "spot-answer") answerSpot(parseInt(b.getAttribute("data-v"), 10));
    else if (act === "spot-next") showSpot();
    else if (act === "credits") showCredits();
    else if (act === "real-open") {
      var sel = G.document.getElementById("krdpRealView");
      var panel = G.document.getElementById("krdpRealPanel");
      if (!sel || !panel || !G.KARDIA_CLIPS) return;
      var view = viewById(sel.value);
      G.KARDIA_CLIPS.attach(P.host);
      panel.innerHTML = G.KARDIA_CLIPS.compareHtml({ view: sel.value }, view.name);
      G.KARDIA_CLIPS.load().then(function () {
        panel.innerHTML = G.KARDIA_CLIPS.compareHtml({ view: sel.value }, view.name);
        G.KARDIA_CLIPS.wirePanel(panel);
      }, function () {
        panel.innerHTML = G.KARDIA_CLIPS.compareHtml({ view: sel.value }, view.name);
      });
      G.KARDIA_CLIPS.wirePanel(panel);
    }
  }
  function mount(host) {
    if (!host) return false;
    P.host = host;
    var m = mountEl();
    if (!m) return false;
    if (G.KARDIA_CLIPS) G.KARDIA_CLIPS.attach(host);
    if (!m.getAttribute("data-krdp-bound")) {
      m.setAttribute("data-krdp-bound", "1");
      m.addEventListener("click", onMountClick);
    }
    showHome();
    return true;
  }

  var api = {
    mount: mount, attach: mount, openPulseCheckEcho: openPulseCheckEcho,
    openCodeBlue: openCodeBlue, openNarke: openNarke,
    _pure: PURE, _state: P
  };
  Object.keys(PURE).forEach(function (k) { api[k] = PURE[k]; });
  G.KARDIA_PRACTICE = api;
  try { if (G.KARDIA && G.KARDIA._internal && mountEl()) mount(G.KARDIA); } catch (e) {}
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
