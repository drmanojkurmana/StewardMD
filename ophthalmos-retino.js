/* Ophthalmós retinoscopy simulator: the screen. ES5. Loaded after ophthalmos-screens.js and
   ophthalmos-retino-model.js. Practice shows the patient and a coaching line that reads the reflex; a Case hides
   the patient: the learner neutralizes both principal meridians, records them and signs off a prescription that is
   graded with clinical tolerance. Every pixel on the stage comes from OPHTHALMOS_RETINO.reflex(). */
(function (G) {
  "use strict";
  var O = G.OPHTHALMOS, M = G.OPHTHALMOS_RETINO;
  if (!O || !O._internal || !M) return;
  var I = O._internal, st = O._st, C = G.OPHTHALMOS_CORE, A = I.ACTIONS, K = I.KEYS;
  var ico = I.ico, esc = I.esc, fmt = I.fmt;
  var VIEW = "sim-retino", DEG = Math.PI / 180, WDS = { 67: 1.5, 50: 2 };
  var R = null; // simulator state while open

  function $(id) { return G.document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function reduced() { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function dstr(v) { v = Math.round(v * 100) / 100; return Math.abs(v) < 0.005 ? "0.00" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(2); }
  function rxStr(r) { return dstr(r.s) + (r.c ? " / " + dstr(r.c) + " × " + r.ax : " DS"); }
  function wdD() { return WDS[R.wd]; }

  /* ---------- state ---------- */
  // res: a Resident patient. Practice uses Resident patients only when Resident is open (Pro); a graded
  // Resident case also runs on the one free trial (startCase).
  function resOpen() { return I.level() === "resident" && !I.levelLocked("resident"); }
  function newPatient(mode, res) {
    if (res == null) res = resOpen();
    var cs = M.makeCase(res ? "resident" : "foundation", (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    R.mode = mode; R.cs = cs; R.rx = cs.rx; R.lens = 0; R.streak = 90; R.s = 0;
    R.readings = []; R.layer = null; R.result = null; R.entry = { s: 0, c: 0, ax: 180 };
    if (mode === "case") { R.n++; R.wd = 67; }
  }
  function open() {
    R = { n: 0, wd: 67, auto: !reduced(), ptrs: {}, drag: null, rot: null, raf: 0, said: "" };
    newPatient("practice");
    render();
  }

  /* ---------- screen ---------- */
  function render(focusSel) {
    teardown();
    st.view = VIEW;
    var cse = R.mode === "case";
    var sub = cse ? "Patient " + R.n + " · " + esc(st.cfg.levels[R.cs.level].label) : "Practice";
    var ctx = "Pupil " + R.cs.pupil + " mm · " + (R.cs.haze ? "hazy media · " : "") + R.wd + " cm";
    var card = cse || R.layer === "result"
      ? '<div class="oph-card-l"><b>' + (R.layer === "result" ? "Patient " + esc(rxStr(R.rx)) : "Find the refraction") + "</b><span>" + ctx + "</span></div>"
      : '<div class="oph-card-l"><b>Patient ' + esc(rxStr(R.rx)) + "</b><span>" + ctx + "</span></div>" +
        '<button class="oph-btn sec ret-mini" data-act="retnew">New patient</button>';
    I.paint(I.top("Back to clinics", "Retinoscopy", sub) +
      '<div class="oph-enc ret-enc' + (R.layer ? " ret-done" : "") + '"><div class="oph-card">' + card + "</div>" +
      '<div class="oph-stage ret-stage" id="retStage"><canvas id="retCv" role="img"></canvas></div>' +
      '<div class="oph-panel oph-scroll" id="retPanel">' + panel() + "</div>" +
      '<div class="oph-foot">' + foot() + "</div></div>", focusSel);
    st.onLeave = teardown;
    // Back from the prescription returns to the patient; back from a signed case returns to practice.
    st.onBack = function () {
      if (!R || !R.layer) return false;
      if (R.layer === "result") newPatient("practice"); else R.layer = null;
      render(); return true;
    };
    bindStage();
    update();
  }

  function panel() {
    if (R.layer === "entry") return entryPanel();
    if (R.layer === "result") return resultPanel();
    var cse = R.mode === "case";
    return '<p class="ret-status' + (cse ? " ret-sr" : "") + '" id="retStatus" aria-live="polite"></p>' +
      '<div class="ret-row"><label for="retStreak">Streak</label><output id="retStreakV">' + R.streak + '°</output>' +
      '<input type="range" id="retStreak" min="0" max="180" step="1" value="' + R.streak + '" aria-valuetext="' + R.streak + ' degrees"></div>' +
      '<div class="ret-row"><span id="retLensL">Lens</span><output id="retLensV">' + dstr(R.lens) + " D</output>" +
      '<div class="ret-steps" role="group" aria-labelledby="retLensL">' + [-1, -0.25, 0.25, 1].map(function (d) {
        return '<button class="ret-step" data-act="retlens" data-d="' + d + '" aria-label="' + (d > 0 ? "Add plus " : "Add minus ") + Math.abs(d).toFixed(2) + '">' + dstr(d) + "</button>";
      }).join("") + "</div></div>" +
      '<div class="ret-acts"><button class="oph-btn sec" data-act="retrec">' + ico("check") + " Record neutral</button>" +
      '<button class="oph-btn sec ret-auto" data-act="retauto" aria-pressed="' + R.auto + '">Auto sweep</button></div>' +
      (guided() ? '<ol class="oph-guide" id="retGuide" aria-label="Next steps">' + guideHtml() + "</ol>" : "") +
      (cse ? "" : '<div class="ret-row ret-wd"><span id="retWdL">Distance</span><output>' + dstr(wdD()) + ' D</output><div class="oph-seg" role="group" aria-labelledby="retWdL">' +
        [67, 50].map(function (w) { return '<button data-act="retwd" data-w="' + w + '" aria-pressed="' + (R.wd === w) + '">' + w + " cm</button>"; }).join("") + "</div></div>") +
      '<div class="ret-cross" id="retCross">' + cross() + "</div>" +
      '<p class="oph-small ret-how">Drag across the pupil to sweep. Two fingers, the slider or the arrow keys turn the streak.</p>';
  }

  function foot() {
    if (R.layer === "result") return '<div class="ret-foot2"><button class="oph-btn sec" data-act="retpractice">Practice</button><button class="oph-btn pri" data-act="retcase">Next patient</button></div>';
    if (R.layer === "entry") return '<button class="oph-btn pri oph-wide" data-act="retsubmit">Sign off prescription</button>';
    if (R.mode === "case") return '<button class="oph-btn pri oph-wide" data-act="retsign">Write the prescription</button>';
    var badge = I.level() === "resident" ? I.lockBadge("sim.retino") : "";
    return '<button class="oph-btn pri oph-wide" data-act="retcase">Start a graded patient' + (badge ? " " + badge : "") + "</button>";
  }

  // The power cross the learner is building: one line per recorded meridian, labelled with the neutral lens.
  function cross() {
    if (!R.readings.length) return '<p class="oph-small">Neutralize a meridian, then record it. Your power cross builds here.</p>';
    var c = 90, r = 44, svg = '<svg viewBox="0 0 180 180" width="140" height="140" aria-hidden="true"><circle cx="90" cy="90" r="' + r + '" class="ret-ring"/>';
    R.readings.forEach(function (x) {
      var a = x.m * DEG, dx = Math.cos(a) * r, dy = -Math.sin(a) * r;
      svg += '<line x1="' + (c - dx).toFixed(1) + '" y1="' + (c - dy).toFixed(1) + '" x2="' + (c + dx).toFixed(1) + '" y2="' + (c + dy).toFixed(1) + '"/>' +
        '<text x="' + (c + dx * 1.5).toFixed(1) + '" y="' + (c + dy * 1.5 + 5).toFixed(1) + '" text-anchor="middle">' + dstr(x.lens) + "</text>";
    });
    return svg + '</svg><ul class="ret-reads">' + R.readings.map(function (x) {
      return "<li>" + x.m + "° meridian <b>" + dstr(x.lens) + " D</b></li>";
    }).join("") + "</ul>";
  }

  function stepper(f, label, val, steps) {
    return '<div class="ret-row"><span id="retL' + f + '">' + label + '</span><output id="retV' + f + '">' + val + "</output>" +
      '<div class="ret-steps" role="group" aria-labelledby="retL' + f + '">' + steps.map(function (d) {
        var txt = f === "ax" ? (d > 0 ? "+" : "−") + Math.abs(d) + "°" : dstr(d);
        return '<button class="ret-step" data-act="rstep" data-f="' + f + '" data-d="' + d + '" aria-label="' + label + (d > 0 ? " up " : " down ") + Math.abs(d) + '">' + txt + "</button>";
      }).join("") + "</div></div>";
  }
  function entryVal(f) { var e = R.entry; return f === "ax" ? e.ax + "°" : dstr(e[f]) + " D"; }
  function entryPanel() {
    return '<h2 class="oph-q" id="retEntryH" tabindex="-1">Prescription, minus cylinder</h2>' +
      stepper("s", "Sphere", entryVal("s"), [-1, -0.25, 0.25, 1]) +
      stepper("c", "Cylinder", entryVal("c"), [-1, -0.25, 0.25, 1]) +
      stepper("ax", "Axis", entryVal("ax"), [-15, -5, 5, 15]) +
      (R.readings.length ? '<button class="oph-link ret-fill" data-act="retfill">Fill from my neutral points (before the working distance)</button>' : "") +
      '<p class="oph-small">Working distance ' + R.wd + " cm, " + dstr(wdD()) + " D. Back returns to the patient.</p>";
  }

  var TEACH = {
    wd: function () { return "You found neutral but did not take off the working distance. At " + R.wd + " cm every neutralizing lens is " + dstr(wdD()) + " D more plus than the prescription, so subtract " + wdD().toFixed(2) + " D from both meridians."; },
    wd2: function () { return "The working distance went the wrong way. Subtract " + wdD().toFixed(2) + " D from the neutralizing lenses; do not add it."; },
    axis90: function () { return "The cylinder axis sits on the wrong meridian. In minus-cylinder form the axis is the more plus meridian: the one that needed the more plus lens."; },
    axis: function (g) { return "The cylinder power is right; the axis is " + Math.round(g.axisOff) + "° off. Turn the streak until the band lines up with it and the break disappears: that orientation is a principal meridian."; },
    cyl: function () { return "The spherical equivalent is right but the cylinder is not. Neutralize each principal meridian on its own; the cylinder is the difference between the two lenses."; },
    sph: function (g) { return "Your prescription is " + Math.abs(g.dM).toFixed(2) + " D " + (g.dM > 0 ? "too plus" : "too minus") + ". Check neutral from both sides: with motion just below the neutral lens, against just above it."; }
  };
  function resultPanel() {
    var g = R.result, t = R.rx, p = M.principal(M.mat(t.s, t.c, t.ax));
    var cls = g.ok ? "ok" : g.close ? "warn" : "bad", head = g.ok ? "Within tolerance" : g.close ? "Close, outside tolerance" : "Outside tolerance";
    var mers = t.c ? [{ m: M.axis(p.hiAx), v: p.hi }, { m: M.axis(p.loAx), v: p.lo }] : [{ m: 180, v: t.s }, { m: 90, v: t.s }];
    var rows = mers.map(function (x) {
      var mine = null;
      R.readings.forEach(function (r) { if (Math.abs(M.odiff(r.m, x.m)) <= 15) mine = r; });
      return "<tr><td>" + x.m + "°</td><td>" + (mine ? dstr(mine.lens) + " D" + (mine.m !== x.m ? " at " + mine.m + "°" : "") : "not recorded") + "</td><td>" + dstr(x.v + wdD()) + " D</td></tr>";
    }).join("");
    return '<p class="oph-verdict ' + cls + '" id="retVerdict" tabindex="-1">' + ico(g.ok ? "check" : "close") + " " + head + "</p>" +
      '<dl class="ret-dl"><dt>You</dt><dd>' + esc(rxStr(R.entry)) + "</dd><dt>Patient</dt><dd>" + esc(rxStr(t)) + "</dd>" +
      "<dt>Off by</dt><dd>" + (Math.abs(g.dM) < 0.005 ? "0.00 D" : Math.abs(g.dM).toFixed(2) + " D " + (g.dM > 0 ? "too plus" : "too minus")) + " in spherical equivalent, " + g.dJ.toFixed(2) + " D of astigmatism</dd></dl>" +
      '<p class="ret-teach">' + (g.ok ? "Both meridians neutralized and the working distance taken off." : TEACH[g.type](g)) + "</p>" +
      '<table class="ret-tab"><caption class="ret-sr">Neutral points</caption><thead><tr><th scope="col">Meridian</th><th scope="col">You recorded</th><th scope="col">Neutral lens</th></tr></thead><tbody>' + rows + "</tbody></table>" +
      '<p class="oph-small">Tolerance: spherical equivalent within 0.25 D and astigmatism within 0.20 D.</p>';
  }

  /* ---------- the reflex ---------- */
  function describe(rf) {
    if (rf.motion === "neutral") return "Neutral in the " + rf.meridian + "° meridian: the pupil fills.";
    var s = (rf.motion === "with" ? "With" : "Against") + " motion in the " + rf.meridian + "° meridian";
    if (Math.abs(rf.breakDeg) >= 5) s += ", band " + Math.round(Math.abs(rf.breakDeg)) + "° " + (rf.breakDeg > 0 ? "counterclockwise" : "clockwise") + " of the streak";
    return s + (rf.bright < 0.55 ? ", dull and slow." : ".");
  }
  // MBBS guided practice: a numbered next-step list read from the model state (recorded meridians, the
  // band against the streak, the reflex), the current step marked, earlier steps ticked.
  var GUIDE = ["Turn the streak until the band lines up with it", "Neutralize: with motion add plus, against add minus",
    "Record neutral", "Turn the streak 90° and neutralize the other meridian, then record it", "Write the prescription, taking off the working distance"];
  function guided() { return R.mode === "practice" && I.level() !== "resident"; }
  function guideStep() {
    var n = R.readings.length, rf = R.rf;
    if (n >= 2) return 4;
    if (n === 1) return 3;
    if (!rf) return 0;
    return rf.motion === "neutral" ? 2 : Math.abs(rf.breakDeg) >= 5 ? 0 : 1;
  }
  function guideHtml() {
    var at = guideStep();
    return GUIDE.map(function (t, i) {
      return '<li data-s="' + (i < at ? "done" : i === at ? "now" : "todo") + '"' + (i === at ? ' aria-current="step"' : "") + ">" + t + (i < at ? '<span class="oph-sr">, done</span>' : "") + "</li>";
    }).join("");
  }
  function coach(rf) {
    if (rf.motion === "neutral") return "Neutral in the " + rf.meridian + "° meridian at " + dstr(R.lens) + " D. Record it, then turn the streak 90°.";
    if (Math.abs(rf.breakDeg) >= 5) return "The band is " + Math.round(Math.abs(rf.breakDeg)) + "° off the streak. Turn the streak " + (rf.breakDeg > 0 ? "counterclockwise" : "clockwise") + " until they line up: that is a principal meridian.";
    return (rf.motion === "with" ? "With motion in the " + rf.meridian + "° meridian: add plus." : "Against motion in the " + rf.meridian + "° meridian: add minus.") +
      (rf.bright < 0.55 ? " The reflex is dull and slow, so the error is large: step by 1.00 D." : "");
  }

  function update() {
    R.F = M.effective(R.rx, { s: R.lens }, wdD());
    R.rf = M.reflex(R.F, R.streak);
    var sv = $("retStreakV"), lv = $("retLensV"), sl = $("retStreak"), cv = $("retCv"), so = $("retStatus");
    if (sv) sv.textContent = R.streak + "°";
    if (sl) { if (+sl.value !== R.streak) sl.value = R.streak; sl.setAttribute("aria-valuetext", R.streak + " degrees"); }
    if (lv) lv.textContent = dstr(R.lens) + " D";
    var said = describe(R.rf);
    if (cv) cv.setAttribute("aria-label", "Retinoscopic reflex. " + said);
    // Announce once the two-finger rotate ends, not at gesture rate.
    if (so && !R.rot) { var txt = R.mode === "case" ? said : coach(R.rf); if (txt !== R.said) { so.textContent = txt; R.said = txt; } }
    var gd = $("retGuide"); if (gd && gd.getAttribute("data-at") !== String(guideStep())) { gd.innerHTML = guideHtml(); gd.setAttribute("data-at", String(guideStep())); }
    if (!R.raf) draw();
  }

  function size() {
    var stage = $("retStage");
    if (!stage || !R.cv) return;
    var b = stage.getBoundingClientRect(), dpr = Math.min(G.devicePixelRatio || 1, 3);
    R.W = Math.max(1, b.width); R.H = Math.max(1, b.height); R.dpr = dpr;
    R.cv.width = Math.round(R.W * dpr); R.cv.height = Math.round(R.H * dpr);
  }

  function draw() {
    var x = R.ctx;
    if (!x || !R.W) return;
    var W = R.W, H = R.H, m = Math.min(W, H), cx = W / 2, cy = H / 2, rf = R.rf, k;
    var rp = m * 0.034 * R.cs.pupil, ri = m * 0.36, ps = R.streak * DEG;
    x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    x.fillStyle = "#050404"; x.fillRect(0, 0, W, H);
    // iris, limbus and the retinoscope sleeve's angle scale (15 degree ticks, long at 90 and 180)
    var gi = x.createRadialGradient(cx, cy, rp, cx, cy, ri);
    gi.addColorStop(0, "#3d2f25"); gi.addColorStop(0.65, "#2a2019"); gi.addColorStop(1, "#15100c");
    x.fillStyle = gi; x.beginPath(); x.arc(cx, cy, ri, 0, 2 * Math.PI); x.fill();
    x.strokeStyle = "rgba(0,0,0,.65)"; x.lineWidth = m * 0.012; x.stroke();
    x.strokeStyle = "rgba(168,168,176,.55)"; x.lineWidth = 1.5;
    for (k = 0; k < 360; k += 15) {
      var a = k * DEG, l = k % 90 === 0 ? m * 0.045 : m * 0.02, r0 = ri + m * 0.03;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
      x.lineTo(cx + Math.cos(a) * (r0 + l), cy - Math.sin(a) * (r0 + l)); x.stroke();
    }
    // streak intercept: moves with the sweep across the face and iris
    var nx = -Math.sin(ps), ny = -Math.cos(ps), tx = Math.cos(ps), ty = -Math.sin(ps), off = R.s * m * 0.42, L = W + H;
    var ix = cx + nx * off, iy = cy + ny * off;
    x.save();
    x.shadowColor = "rgba(255,232,196,.7)"; x.shadowBlur = m * 0.03;
    x.strokeStyle = "rgba(255,241,218,.9)"; x.lineWidth = m * 0.034; x.lineCap = "butt";
    x.beginPath(); x.moveTo(ix - tx * L, iy - ty * L); x.lineTo(ix + tx * L, iy + ty * L); x.stroke();
    x.restore();
    // pupil: the fundus reflex, clipped to the pupil
    x.save();
    x.beginPath(); x.arc(cx, cy, rp, 0, 2 * Math.PI); x.clip();
    x.fillStyle = "rgb(24,6,4)"; x.fillRect(cx - rp, cy - rp, 2 * rp, 2 * rp);
    var haze = R.cs.haze || 0, alpha = rf.bright * (1 - haze * 0.6);
    var glow = x.createRadialGradient(cx, cy, 0, cx, cy, rp);
    glow.addColorStop(0, "rgba(255,118,62," + (0.16 * alpha).toFixed(3) + ")"); glow.addColorStop(1, "rgba(255,118,62,0)");
    x.fillStyle = glow; x.fillRect(cx - rp, cy - rp, 2 * rp, 2 * rp);
    if (rf.mag >= M.NEUTRAL * 0.5) {
      // the band sits perpendicular to g = F n and moves along it, 1/|g| as fast as the sweep
      var gx = rf.gx / rf.mag, gy = -rf.gy / rf.mag, d = clamp(R.s * rp * 2.7 / rf.mag, -rp * 6, rp * 6);
      var bx = cx + gx * d, by = cy + gy * d, wb = clamp(rp * 0.8 / rf.mag, rp * 0.18, rp * 4);
      x.translate(bx, by); x.rotate(-rf.bandDeg * DEG);
      var gb = x.createLinearGradient(0, -wb / 2, 0, wb / 2);
      gb.addColorStop(0, "rgba(255,118,62,0)"); gb.addColorStop(0.3, "rgba(255,118,62," + alpha.toFixed(3) + ")");
      gb.addColorStop(0.7, "rgba(255,118,62," + alpha.toFixed(3) + ")"); gb.addColorStop(1, "rgba(255,118,62,0)");
      x.fillStyle = gb; x.fillRect(-rp * 3, -wb / 2, rp * 6, wb);
      x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    }
    if (rf.fill > 0) { x.fillStyle = "rgba(255,118,62," + (rf.fill * alpha * 0.85).toFixed(3) + ")"; x.fillRect(cx - rp, cy - rp, 2 * rp, 2 * rp); }
    if (haze) { x.fillStyle = "rgba(214,204,188," + (haze * 0.35).toFixed(3) + ")"; x.fillRect(cx - rp, cy - rp, 2 * rp, 2 * rp); }
    x.restore();
    x.strokeStyle = "rgba(0,0,0,.8)"; x.lineWidth = 1.5; x.beginPath(); x.arc(cx, cy, rp, 0, 2 * Math.PI); x.stroke();
  }

  /* ---------- motion and input ---------- */
  function loop() {
    if (!R || R.raf || !R.ctx) return;
    function step(ts) {
      R.raf = 0;
      if (!R.cv || !R.cv.isConnected) return;
      if (R.auto && !R.drag) R.s = Math.sin(ts / 1300 * 2 * Math.PI) * 0.9;
      draw();
      if (R.auto || R.drag) R.raf = G.requestAnimationFrame(step);
    }
    R.raf = G.requestAnimationFrame(step);
  }
  function teardown() {
    if (!R) return;
    if (R.raf) { G.cancelAnimationFrame(R.raf); R.raf = 0; }
    if (R.ro) { R.ro.disconnect(); R.ro = null; }
    R.ptrs = {}; R.drag = null; R.rot = null;
  }
  function setStreak(v) { v = Math.round(v) % 180; if (v < 0) v += 180; R.streak = v; update(); }
  function twoAngle() {
    var p = [], id;
    for (id in R.ptrs) p.push(R.ptrs[id]);
    return Math.atan2(-(p[1].y - p[0].y), p[1].x - p[0].x) / DEG;
  }
  function bindStage() {
    var stage = $("retStage"), cv = $("retCv"), sl = $("retStreak");
    R.cv = cv; R.ctx = null;
    try { R.ctx = cv && cv.getContext ? cv.getContext("2d") : null; } catch (e) {}
    if (!stage) return;
    if (!R.ctx) {
      stage.innerHTML = '<p class="ret-nocv">This device cannot draw the reflex. The line below describes it.</p>';
      var so = $("retStatus"); if (so) so.className = "ret-status";
      return;
    }
    size();
    if (G.ResizeObserver) { R.ro = new G.ResizeObserver(function () { size(); draw(); }); R.ro.observe(stage); }
    stage.addEventListener("pointerdown", function (e) {
      R.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch (er) {}
      var n = Object.keys(R.ptrs).length;
      if (n === 1) { R.drag = { x: e.clientX, y: e.clientY, s0: R.s }; loop(); }
      else if (n === 2) { R.drag = null; R.rot = { a: twoAngle(), s0: R.streak }; }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!R.ptrs[e.pointerId]) return;
      R.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (R.rot && Object.keys(R.ptrs).length === 2) { setStreak(R.rot.s0 + (twoAngle() - R.rot.a)); return; }
      if (!R.drag) return;
      var ps = R.streak * DEG, proj = (e.clientX - R.drag.x) * -Math.sin(ps) + (e.clientY - R.drag.y) * -Math.cos(ps);
      R.s = clamp(R.drag.s0 + proj / (Math.min(R.W, R.H) * 0.42), -1, 1);
    });
    function up(e) {
      delete R.ptrs[e.pointerId];
      if (!Object.keys(R.ptrs).length) { var rotated = !!R.rot; R.drag = null; R.rot = null; if (rotated) update(); else if (!R.auto) draw(); }
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    if (sl) sl.addEventListener("input", function () { setStreak(+sl.value); });
    loop();
  }

  /* ---------- actions ---------- */
  function lens(d) { R.lens = clamp(Math.round((R.lens + d) * 4) / 4, -15, 15); I.haptic("tap"); update(); }
  function record() {
    var m = M.axis(R.streak + 90), keep = R.readings.filter(function (r) { return Math.abs(M.odiff(r.m, m)) > 15; });
    keep.push({ m: m, lens: R.lens });
    R.readings = keep.slice(-2);
    I.haptic(R.rf.motion === "neutral" ? "success" : "light");
    var c = $("retCross"); if (c) c.innerHTML = cross();
    update();
    if (R.mode !== "case" && R.rf.motion !== "neutral") {
      var so = $("retStatus"); if (so) { so.textContent = "Recorded, but the " + m + "° meridian is not neutral yet: " + describe(R.rf); R.said = so.textContent; }
    }
  }
  function startCase() {
    if (I.level() !== "resident") { newPatient("case", false); return render(); }
    I.gate("sim.retino", function () { newPatient("case", true); render(); });
  }
  function fillFromReadings() {
    var r = R.readings.slice().sort(function (a, b) { return b.lens - a.lens; }), hi = r[0], lo = r[1] || r[0];
    R.entry = { s: hi.lens, c: Math.min(0, lo.lens - hi.lens), ax: M.axis(hi.m) };
    render("#retEntryH");
  }
  function submit() {
    var e = R.entry, g = M.grade(e, R.rx, wdD());
    R.result = g; R.layer = "result";
    C.recordSim(st.store, "retino", g.ok, g.type, I.today());
    I.save();
    I.haptic(g.ok ? "success" : "error");
    render("#retVerdict");
  }

  A.retnew = function () { newPatient("practice"); render(); };
  A.retlens = function (b) { lens(+b.getAttribute("data-d")); };
  A.retrec = record;
  A.retauto = function (b) { R.auto = !R.auto; b.setAttribute("aria-pressed", String(R.auto)); if (R.auto) loop(); };
  A.retwd = function (b) { R.wd = +b.getAttribute("data-w"); render(); };
  A.retcase = startCase;
  A.retpractice = function () { newPatient("practice"); render(); };
  A.retsign = function () { R.layer = "entry"; render("#retEntryH"); };
  A.retfill = fillFromReadings;
  A.retsubmit = submit;
  A.rstep = function (b) {
    var f = b.getAttribute("data-f"), d = +b.getAttribute("data-d"), e = R.entry;
    if (f === "ax") { e.ax = M.axis(e.ax + d); }
    else e[f] = clamp(Math.round((e[f] + d) * 4) / 4, f === "c" ? -8 : -20, f === "c" ? 0 : 20);
    var o = $("retV" + f); if (o) o.textContent = entryVal(f);
    I.haptic("tap");
  };

  K[VIEW] = function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || R.layer) return;
    var big = e.shiftKey;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setStreak(R.streak + (e.key === "ArrowRight" ? 1 : -1) * (big ? 1 : 5)); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); lens((e.key === "ArrowUp" ? 1 : -1) * (big ? 1 : 0.25)); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); record(); }
    else if (e.key === "a" || e.key === "A") { e.preventDefault(); var b = G.document.querySelector("[data-act=retauto]"); if (b) A.retauto(b); }
  };

  O._retinoState = function () { return R; }; // read-only hook for the headless UI test

  O._sims.push({
    id: "retino", title: "Retinoscopy", sub: "Streak retinoscope", icon: "target",
    line: function (r) { return r && r.n ? fmt(r.ok) + " of " + fmt(r.n) + " patients within tolerance" : "Practise, then graded patients"; },
    errs: { wd: "Working distance not subtracted", wd2: "Working distance added", axis90: "Axis on the wrong meridian",
      axis: "Axis off", cyl: "Cylinder power", sph: "Sphere" },
    open: open,
    startCase: function () { open(); startCase(); } // Today's plan: one graded patient
  });
})(typeof window !== "undefined" ? window : this);
