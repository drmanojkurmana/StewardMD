/* Kardia: the Echo and ECG learning module, a StewardMD specialty host on the specialty engine
   (specialty-*.js). Tabs: Echo Lab, Learn, Practice, Cases, KardiQ X. Echo Lab, Practice and Cases are
   coming soon (WP8: honest placeholder panels, no fake content). Learn opens the existing Learn ECG
   lesson atlas in place, unchanged (KARDIOX.openLearn). KardiQ X opens the existing AI reading screen,
   still behind SMD_XACCESS.gate("kardiox"), untouched.
   Loaded on first open by kardia-loader.js, which is the only Kardia file the app loads at boot.
   Flag: smd_kardia, DEFAULT OFF for everyone; a tester turns it on per device with ?kardia=1 or
   localStorage smd_kardia = "1" (same tester mechanism as the other module flags, no early-access tier).
   Levels (engine pattern): MBBS free; Resident, Fellow and Sonographer are StewardMD Pro. The free
   preview is the first KARDIA_FREE_LESSONS Learn ECG lessons; everything else is Pro.
   Content is ai_drafted: every screen carries the "To be verified, draft" footer until clinical review. */
(function (G) {
  "use strict";
  var SP = G.SPECIALTY;
  if (!SP || !SP.createHost) return;

  /* Free preview: the first few Learn ECG lessons. Owner decision 2026-10-25 (about 5 to 10 percent):
     a few Echo Lab views and lessons, and a few Learn ECG lessons. Everything else is Pro. */
  var FREE_LESSONS = 5;
  var FREE_ECHO_PER_AREA = 3;
  var FREE_BANK_QUESTIONS = 20;
  var TABS = ["echo", "learn", "practice", "cases", "kardiox"];
  var LEVELS = ["mbbs", "resident", "fellow", "sonographer"];

  function T(en, hi) { return { en: en, hi: hi }; }
  var TAB_T = {
    echo: T("Echo Lab", "इको लैब"), learn: T("Learn", "सीखें"), practice: T("Practice", "अभ्यास"),
    cases: T("Cases", "केस"), kardiox: T("KardiQ X", "KardiQ X")
  };
  var TAB_SUB = {
    echo: T("Probe lab and views", "प्रोब लैब और व्यू"),
    learn: T("Learn ECG: the ECG atlas and quiz", "Learn ECG: ECG एटलस और प्रश्नोत्तरी"),
    practice: T("Drills and protocols", "ड्रिल और प्रोटोकॉल"),
    cases: T("Whole patient cases", "पूरे मरीज़ के केस"),
    kardiox: T("AI ECG reading", "AI ECG रीडिंग")
  };

  var host = SP.createHost({
    id: "kardia", global: "KARDIA", base: G.SMD_KARDIA_BASE || "/kardia/", rootId: "smdKardia", rootClass: "krd-root",
    storeKey: "smd_kardia_v1", prefKey: "smd_kardia_prefs", flag: "smd_kardia",
    title: T("Kardia", "कार्डिया"), subtitle: T("Echo and ECG learning", "इको और ECG सीखना"),
    levels: { free: ["mbbs"] }, proFeature: "kardia",
    statusBg: "#06090b", draft: true
  });
  if (SP.features && SP.features.learn) SP.features.learn(host);
  if (SP.features && SP.features.bank) SP.features.bank(host, { id: "mcq", index: "decks/mcq/index.json" });
  var I = host._internal, st = host._st;

  /* The engine's enabled() is a kill switch (absent flag reads ON). Kardia is opt-in: absent flag
     reads OFF, the same tester mechanism (?kardia=1, localStorage "1") as the other module flags. */
  function on() {
    try { if (G.SMD_KARDIA_FLAGS && G.SMD_KARDIA_FLAGS.bool) return !!G.SMD_KARDIA_FLAGS.bool("smd_kardia"); } catch (e) {}
    try {
      var q = (G.location.search.match(/[?&]kardia=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem("smd_kardia") === "1";
    } catch (e) { return false; }
  }

  function tab() { var t = st.prefs && st.prefs.ktab; return TABS.indexOf(t) >= 0 ? t : "echo"; }
  function klevel() { var l = st.prefs && st.prefs.klevel; return LEVELS.indexOf(l) >= 0 ? l : "mbbs"; }
  function levelLockedK(lv) { return lv !== "mbbs" && !I.isPro(); }

  function tabsHtml(cur) {
    return '<div class="krd-tabs" role="tablist" aria-label="' + I.esc(I.t(host.cfg.title)) + '">' + TABS.map(function (id) {
      return '<button type="button" role="tab" class="krd-tab" data-act="ktab" data-t="' + id + '"' +
        ' aria-selected="' + (id === cur) + '">' + I.tx(TAB_T[id]) + "</button>";
    }).join("") + "</div>";
  }

  function levelsHtml(lv) {
    var seg = LEVELS.map(function (l) {
      var locked = levelLockedK(l);
      var label = l === "mbbs" ? "MBBS" : l === "resident" ? I.s("resident") : l === "fellow" ? "Fellow" : "Sonographer";
      return '<button type="button" data-act="klevel" data-v="' + l + '" aria-pressed="' + (lv === l) + '">' + I.esc(label) +
        (locked ? ' <span class="sp-pro">' + I.ico("lock") + I.s("pro") + "</span>" : "") + "</button>";
    }).join("");
    var note = lv === "mbbs" ? I.s("mbbsSub") : I.s("residentSub");
    return '<div class="sp-levelrow"><div class="sp-seg" role="group" aria-label="' + I.s("level") + '">' + seg + "</div>" +
      '<span class="sp-small">' + note + "</span></div>";
  }

  /* Coming soon: an honest panel. What the trainer will hold, in plain words; no fake lessons,
     no demo buttons, nothing that looks finished before it is. */
  var SOON = {
    echo: {
      icon: "pulse",
      lines: T("The probe lab opens here: a beating 3D heart with a live ultrasound sector, the ECG strip and the heart sounds running off the same cycle. Target views with a quality score, from parasternal to apical, then knobology, Doppler and measurements with a known right answer.",
        "यहाँ प्रोब लैब खुलेगी: धड़कता 3D दिल, लाइव अल्ट्रासाउंड सेक्टर, ECG स्ट्रिप और हृदय ध्वनियाँ एक ही चक्र पर। पैरास्टर्नल से एपिकल तक लक्ष्य व्यू, फिर नॉबोलॉजी, डॉप्लर और ज्ञात सही उत्तर वाली माप।")
    },
    practice: {
      icon: "target",
      lines: T("Graded drills open here: view acquisition against the clock, measurement and Doppler drills, knobology drills, POCUS protocols, and ECG spot diagnosis.",
        "यहाँ ग्रेडेड ड्रिल खुलेंगी: समय पर व्यू पकड़ना, माप और डॉप्लर ड्रिल, नॉबोलॉजी ड्रिल, POCUS प्रोटोकॉल और ECG स्पॉट निदान।")
    },
    cases: {
      icon: "folder",
      lines: T("Whole patient cases open here: history, examination with heart sounds, ECG, echo acquisition and measurement, a structured report, then diagnosis and management.",
        "यहाँ पूरे मरीज़ के केस खुलेंगे: हिस्ट्री, हृदय ध्वनियों के साथ जाँच, ECG, इको, संरचित रिपोर्ट, फिर निदान और उपचार।")
    }
  };

  function soonHtml(id) {
    var s = SOON[id];
    return '<div class="sp-scroll sp-pad"><div class="sp-col"><div class="krd-soon">' +
      '<div class="krd-soon-hero"><span class="krd-soon-lead" aria-hidden="true">' + I.tile(s.icon) + "</span>" +
      "<div><h2>" + I.tx(TAB_T[id]) + '</h2><p class="krd-soon-sub">' + I.tx(TAB_SUB[id]) + "</p></div></div>" +
      '<p class="krd-note">' + I.ico("info") + "<span><b>" +
      I.tx(T("Coming soon.", "जल्द आ रहा है।")) + "</b> " + I.tx(s.lines) + "</span></p>" +
      '<p class="krd-note">' + I.ico("lock") + "<span>" +
      I.tx(T("This trainer is part of StewardMD Pro.", "यह ट्रेनर StewardMD Pro का हिस्सा है।")) + "</span></p>" +
      "</div></div></div>";
  }

  /* ================= Echo Lab (WP4) =================
   * Design contract (Operate mode, existing Kardia tokens only):
   * purpose: find the target view with the probe. First screenful:
   * target name, live sector, quality score. Composition: one scroll
   * column; target chips in a horizontal scroll row; sector; quality
   * meter and hints; chest map beside the tilt and rock drag strips
   * (stacked under 560px); rotation and TEE sliders; knobs drawer;
   * ECG strip. States: loading (skeleton text), error (retry), empty
   * (no views at this level), simulator loading (schematic sector
   * with a plain note when the renderer is not on the window yet),
   * gyro permission denied, long view names wrap, never truncate.
   * Motion: meter width and drawer only, 140ms on --kd-ease,
   * transform and opacity, off under reduced motion. Every control
   * is a real button or labelled range input, 44px tall, with a
   * visible focus ring from the engine. No new palette, no glow. */
  var FREE_ECHO_VIEWS = ["tte_plax", "tte_psax_papillary", "tte_a4c"];
  var EL = {
    views: null, loading: false, err: false, viewId: null, probe: null,
    geom: null, heart: null, timer: null, unbind: [], knobsOpen: false,
    knobs: { gain: 55, depth: 180, focus: 55 }, holdSince: null, gyroMsg: "",
    lastCutAt: 0, polys: null, phase: 0
  };

  function echoBase() { return (host.cfg && host.cfg.base) || G.SMD_KARDIA_BASE || "/kardia/"; }
  function echoViewsForLevel(lv) {
    if (!EL.views) return [];
    return EL.views.views.filter(function (v) { return v.level && v.level.indexOf(lv) >= 0; });
  }
  function echoViewLocked(v, lv, pro) {
    if (pro) return false;
    return !(lv === "mbbs" && FREE_ECHO_VIEWS.indexOf(v.id) >= 0);
  }
  function echoCurrentView() {
    var list = echoViewsForLevel(klevel());
    for (var i = 0; i < list.length; i++) if (list[i].id === EL.viewId) return list[i];
    return list[0] || null;
  }
  function ensureEchoProbe() {
    if (EL.probe) {
      /* Target states derive from the CURRENT views.json: re-point a
       * surviving probe when the catalogue reloaded under it. */
      try {
        if (EL.views && EL.probe.getViews && EL.probe.getViews() !== EL.views) EL.probe.setViews(EL.views);
      } catch (e) {}
      return EL.probe;
    }
    if (!G.KARDIA_PROBE || !EL.views) return EL.probe;
    try {
      if (G.KARDIA_HEART && G.KARDIA_GEOM && !EL.geom) {
        EL.heart = G.KARDIA_HEART.create(G.KARDIA_HEART.presets.normal);
        for (var t = 0; t < 4000; t += 20) EL.heart.step(20);
        EL.geom = G.KARDIA_GEOM.create({ heart: EL.heart, views: EL.views });
      }
    } catch (e) { EL.geom = null; EL.heart = null; }
    EL.probe = G.KARDIA_PROBE.create({ views: EL.views, geom: EL.geom || undefined });
    return EL.probe;
  }
  function startEchoTarget(v, keepProbe) {
    var p = ensureEchoProbe();
    EL.viewId = v.id; EL.holdSince = null;
    if (p && !keepProbe) {
      var s = p.stateForView(v);
      if (s) {
        /* Start a little off target so there is something to find. */
        s.rotationDeg -= 18; s.tiltDeg += 10;
        s.position.x -= 14; s.omniplaneDeg = Math.max(0, s.omniplaneDeg - 15);
        p.setState(s);
      } else p.setState({ window: v.window });
    }
  }
  function loadEchoViews() {
    if (EL.views || EL.loading || EL.err) return;
    EL.loading = true; EL.err = false;
    function done(data) {
      EL.loading = false;
      if (!data || !data.views) { EL.err = true; }
      else {
        EL.views = data;
        try { if (EL.probe && EL.probe.setViews) EL.probe.setViews(data); } catch (e) {}
        var first = echoViewsForLevel(klevel())[0];
        if (first) startEchoTarget(first, false);
      }
      if (host.isOpen() && tab() === "echo") showTab("echo");
    }
    function fail() { EL.loading = false; EL.err = true; if (host.isOpen() && tab() === "echo") showTab("echo"); }
    try {
      if (G.KARDIA_ECHO_VIEWS) { done(G.KARDIA_ECHO_VIEWS); return; }
      if (!G.fetch) { fail(); return; }
      G.fetch(echoBase() + "views.json").then(function (r) { return r.json(); }).then(done, fail);
    } catch (e) { fail(); }
  }

  function echoLabHtml() {
    var lv = klevel(), pro = I.isPro();
    var head = '<h2 class="sp-h2">' + I.tx(T("Echo Lab", "Echo Lab")) + '</h2><p class="sp-small">' +
      I.tx(T("Find the target view with the probe. Slide on the chest map, twist with two fingers to rotate, fan with the tilt strip and rock with the rock strip.",
        "Find the target view with the probe. Slide on the chest map, twist with two fingers to rotate, fan with the tilt strip and rock with the rock strip.")) + "</p>";
    if (EL.err) return head + '<div class="sp-err krd-err" role="alert"><p>' +
      I.tx(T("Echo Lab did not load. Check the connection and try again.", "Echo Lab did not load. Check the connection and try again.")) +
      '</p><button type="button" class="sp-btn pri" data-act="kecho-retry">' + I.ico("refresh") + " " + I.s("retry") + "</button></div>";
    if (!EL.views) {
      if (!EL.loading) loadEchoViews();
      return head + '<p class="sp-mut" role="status">' + I.tx(T("Loading Echo Lab.", "Loading Echo Lab.")) + "</p>";
    }
    var list = echoViewsForLevel(lv);
    if (!list.length) return head + '<p class="sp-small">' + I.tx(T("No echo views at this level yet.", "No echo views at this level yet.")) + "</p>";
    var cur = echoCurrentView();
    if (!cur || cur.id !== EL.viewId) { EL.viewId = cur.id; }
    if (echoViewLocked(cur, lv, pro)) {
      var free = list.filter(function (v) { return !echoViewLocked(v, lv, pro); })[0];
      if (free) { cur = free; EL.viewId = free.id; }
    }
    var chips = list.map(function (v) {
      var locked = echoViewLocked(v, lv, pro);
      return '<button type="button" class="krd-chip" data-act="kecho-view" data-v="' + I.esc(v.id) + '" aria-pressed="' + (v.id === cur.id) + '">' +
        I.esc(v.name) + (locked ? ' <span class="sp-pro">' + I.ico("lock") + I.s("pro") + "</span>" : "") + "</button>";
    }).join("");
    var tee = cur.window === "oesophageal" || cur.window === "gastric";
    var p = ensureEchoProbe();
    var cl = p ? p.clampsFor(cur.window) : null;
    var st8 = p ? p.getState() : null;
    function range(id, label, min, max, step, val, unit) {
      return '<div class="krd-ctl"><label for="' + id + '">' + label + ' <span class="krd-ctl-val" id="' + id + 'Val">' + Math.round(val) + unit + '</span></label>' +
        '<input type="range" id="' + id + '" data-krange="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + Math.round(val) + '" aria-label="' + label + '"></div>';
    }
    var controls = "";
    if (tee && st8 && cl) {
      controls = range("krdDepth", I.tx(T("Depth from incisors", "Depth from incisors")), cl.depthCm[0], cl.depthCm[1], 1, st8.depthCm, " cm") +
        range("krdTurn", I.tx(T("Probe shaft turn", "Probe shaft turn")), cl.rotationDeg[0], cl.rotationDeg[1], 1, st8.rotationDeg, " deg") +
        range("krdOmni", I.tx(T("Omniplane angle", "Omniplane angle")), 0, 180, 1, st8.omniplaneDeg, " deg") +
        range("krdFlex", I.tx(T("Flex (anteflex positive)", "Flex (anteflex positive)")), cl.flexDeg[0], cl.flexDeg[1], 1, st8.flexDeg, " deg");
    } else if (st8 && cl) {
      controls = range("krdRot", I.tx(T("Rotation", "Rotation")), cl.rotationDeg[0], cl.rotationDeg[1], 1, st8.rotationDeg, " deg") +
        range("krdTiltR", I.tx(T("Tilt (fan)", "Tilt (fan)")), cl.tiltDeg[0], cl.tiltDeg[1], 1, st8.tiltDeg, " deg") +
        range("krdRockR", I.tx(T("Rock", "Rock")), cl.rockDeg[0], cl.rockDeg[1], 1, st8.rockDeg, " deg");
    }
    var gyroOn = !!(st8 && st8.gyroOn);
    return head +
      '<div class="krd-lab" id="krdLab">' +
      '<div class="krd-chips" role="group" aria-label="' + I.tx(T("Target views", "Target views")) + '">' + chips + "</div>" +
      '<h3 class="sp-h3 krd-target-name" id="krdTargetName">' + I.esc(cur.name) + '</h3>' +
      '<p class="sp-small" id="krdTargetPos">' + I.esc(cur.probe.position) + " " + I.esc(cur.probe.marker) + ".</p>" +
      '<div class="krd-sector-wrap"><canvas id="krdSector" width="640" height="480" aria-label="' + I.tx(T("Ultrasound sector image", "Ultrasound sector image")) + '"></canvas>' +
      '<p class="krd-sim-note" id="krdSimNote" role="status"></p></div>' +
      '<div class="krd-quality" aria-live="polite"><div class="krd-score-row"><span class="krd-score" id="krdScore">0</span>' +
      '<span class="krd-score-label">' + I.tx(T("quality", "quality")) + '</span>' +
      '<span class="krd-achieved" id="krdAchieved" hidden>' + I.tx(T("View achieved", "View achieved")) + "</span></div>" +
      '<div class="krd-meter" role="meter" aria-label="' + I.tx(T("View quality", "View quality")) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="krdMeter"><span id="krdMeterFill"></span></div>' +
      '<ul class="krd-hints" id="krdHints"></ul>' +
      '<p class="krd-comp" id="krdComp"></p></div>' +
      (tee
        ? '<div class="krd-tee-note"><h3 class="sp-h3">' + I.tx(T("TEE probe", "TEE probe")) + '</h3><p class="sp-small">' +
          I.tx(T("The probe sits in the oesophagus. Set the depth, turn the shaft and the omniplane, and use flex to find the plane.",
            "The probe sits in the oesophagus. Set the depth, turn the shaft and the omniplane, and use flex to find the plane.")) + "</p></div>"
        : '<div class="krd-chest-row"><div class="krd-chest" id="krdChest" data-mm-per-px="0.6" role="application" aria-label="' +
          I.tx(T("Chest map. Drag to slide the probe, twist with two fingers to rotate.", "Chest map. Drag to slide the probe, twist with two fingers to rotate.")) + '">' +
          '<span class="krd-chest-label">' + I.esc(cur.window) + '</span><span class="krd-probe-dot" id="krdProbeDot" aria-hidden="true"><span class="krd-probe-marker"></span></span></div>' +
          '<div class="krd-strip krd-strip-v" id="krdTiltStrip" role="slider" aria-label="' + I.tx(T("Tilt. Drag up or down.", "Tilt. Drag up or down.")) + '" aria-valuemin="-80" aria-valuemax="80" aria-valuenow="0" tabindex="0"><span>Tilt</span></div></div>' +
          '<div class="krd-strip krd-strip-h" id="krdRockStrip" role="slider" aria-label="' + I.tx(T("Rock. Drag left or right.", "Rock. Drag left or right.")) + '" aria-valuemin="-60" aria-valuemax="60" aria-valuenow="0" tabindex="0"><span>Rock</span></div>') +
      '<div class="krd-controls">' + controls + "</div>" +
      '<div class="krd-gyro"><button type="button" class="sp-btn sec" data-act="kecho-gyro" aria-pressed="' + gyroOn + '">' +
        I.tx(T("Use phone as probe", "Use phone as probe")) + '</button>' +
        '<button type="button" class="sp-btn sec" data-act="kecho-cal" id="krdCalBtn"' + (gyroOn ? "" : " disabled") + '>' +
        I.tx(T("Calibrate", "Calibrate")) + '</button>' +
        '<p class="sp-small" id="krdGyroStatus">' + I.esc(EL.gyroMsg || (gyroOn ? I.tx(T("Phone motion is driving the probe. Hold the phone as the probe and tap Calibrate at the starting pose.", "Phone motion is driving the probe.")) : I.tx(T("Off. Touch controls are in use. Turn this on only if you want to hold the phone as the probe.", "Off. Touch controls are in use.")))) + "</p></div>" +
      '<div class="krd-knobs-head"><button type="button" class="sp-btn sec sp-wide" data-act="kecho-knobs" aria-expanded="' + EL.knobsOpen + '">' +
        I.tx(T("Knobs", "Knobs")) + '</button></div>' +
      '<div class="krd-knobs" id="krdKnobs"' + (EL.knobsOpen ? "" : " hidden") + ">" +
        range("krdGain", I.tx(T("Gain", "Gain")), 0, 100, 1, EL.knobs.gain, "") +
        range("krdDepthK", I.tx(T("Depth", "Depth")), 120, 240, 5, EL.knobs.depth, " mm") +
        range("krdFocus", I.tx(T("Focus", "Focus")), 0, 100, 1, EL.knobs.focus, "") +
      "</div>" +
      '<h3 class="sp-h3">' + I.tx(T("ECG", "ECG")) + '</h3>' +
      '<canvas id="krdEcg" width="640" height="90" aria-label="' + I.tx(T("ECG strip, same cardiac cycle as the sector", "ECG strip")) + '"></canvas>' +
      '<p class="krd-note">' + I.ico("info") + "<span>" +
        I.tx(T("Free preview: parasternal long axis, parasternal short axis at the papillary muscles and apical four chamber at MBBS. The rest are part of StewardMD Pro.",
          "Free preview: parasternal long axis, parasternal short axis at the papillary muscles and apical four chamber at MBBS. The rest are part of StewardMD Pro.")) + "</span></p>" +
      "</div>";
  }

  function stopEchoLab() {
    if (EL.timer) { try { G.clearInterval(EL.timer); } catch (e) {} EL.timer = null; }
    EL.unbind.forEach(function (fn) { try { fn(); } catch (e) {} });
    EL.unbind = [];
  }
  function ecgValue(phase) {
    /* One beat, phase 0 to 1: small P, sharp QRS, rounded T. */
    function bump(c, w, a) { var d = (phase - c) / w; return a * Math.exp(-d * d); }
    return bump(0.12, 0.03, 0.12) + bump(0.30, 0.008, -0.18) + bump(0.33, 0.006, 1) + bump(0.36, 0.009, -0.28) + bump(0.55, 0.045, 0.22);
  }
  function drawEchoSector() {
    var cv = G.document && G.document.getElementById("krdSector");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    var dark = G.document.body && (G.document.body.classList.contains("dark") || G.document.body.classList.contains("v3-dark"));
    ctx.fillStyle = dark ? "#04070a" : "#0b1114";
    ctx.fillRect(0, 0, W, H);
    var p = EL.probe, cur = echoCurrentView();
    var cx = W / 2, top = 26, radius = Math.min(W, H) * 0.92 * (EL.knobs.depth / 240 + 0.35);
    if (radius > H - 30) radius = H - 30;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.arc(cx, top, radius, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#10181d"; ctx.fillRect(0, 0, W, H);
    var drawn = false;
    if (G.KARDIA_US && typeof G.KARDIA_US.render === "function" && p) {
      try { drawn = !!G.KARDIA_US.render(cv, p.plane(), { knobs: EL.knobs }); } catch (e) { drawn = false; }
    }
    if (!drawn && EL.geom && p && cur) {
      try {
        var now = Date.now();
        if (now - EL.lastCutAt > 180 || !EL.polys) {
          EL.lastCutAt = now;
          if (EL.heart) { EL.heart.step(90); EL.geom.update(); }
          var pl = p.plane();
          EL.polys = EL.geom.cut(pl.origin, pl.normal, pl.up, 260, 260);
        }
        var gain = 0.45 + EL.knobs.gain / 100;
        var scale = radius / 300;
        EL.polys.forEach(function (poly) {
          if (!poly.points || poly.points.length < 2) return;
          var e = poly.acoustic ? poly.acoustic.echogenicity : 0.4;
          if (poly.acoustic && poly.acoustic.isBlood) e = 0.04;
          var g = Math.max(8, Math.min(235, Math.round(e * 235 * gain)));
          ctx.fillStyle = "rgb(" + g + "," + g + "," + Math.min(255, g + 6) + ")";
          ctx.beginPath();
          poly.points.forEach(function (pt, i) {
            var x = cx + pt[0] * scale, y = H * 0.52 - pt[1] * scale;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath(); ctx.fill();
        });
        drawn = true;
      } catch (e) { drawn = false; }
    }
    if (!drawn) {
      /* Schematic sector: fan outline and chamber arcs, honestly a
       * placeholder picture, labelled below the canvas. */
      ctx.strokeStyle = "rgba(220,235,230,0.55)"; ctx.lineWidth = 1.5;
      for (var i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, top, radius * (0.25 + i * 0.22), Math.PI / 2 - 0.6, Math.PI / 2 + 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(200,220,215,0.20)";
      ctx.beginPath(); ctx.ellipse(cx - radius * 0.18, top + radius * 0.55, radius * 0.22, radius * 0.34, 0.2, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + radius * 0.22, top + radius * 0.5, radius * 0.17, radius * 0.27, -0.15, 0, 6.29); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(220,235,230,0.7)";
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.arc(cx, top, radius, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62); ctx.closePath(); ctx.stroke();
    var note = G.document.getElementById("krdSimNote");
    if (note) note.textContent = drawn && EL.geom ? "" :
      (G.KARDIA_US ? "" : I.tx(T("Simulator loading. The schematic sector is a placeholder until the live image arrives.", "Simulator loading.")));
    /* ECG strip on the same beat. */
    var ec = G.document.getElementById("krdEcg");
    if (ec && ec.getContext) {
      var ex = ec.getContext("2d"), EW = ec.width, EH = ec.height;
      ex.fillStyle = dark ? "#04070a" : "#ffffff"; ex.fillRect(0, 0, EW, EH);
      ex.strokeStyle = dark ? "#3ee07a" : "#0c6b4f"; ex.lineWidth = 2; ex.beginPath();
      var cyc = EL.heart && EL.heart.state ? EL.heart.state().cycleTimeMs / EL.heart.state().cycleMs : (Date.now() % 857) / 857;
      for (var x = 0; x < EW; x++) {
        var ph = (x / EW * 2 + cyc) % 1;
        var y = EH * 0.62 - ecgValue(ph) * EH * 0.48;
        if (x === 0) ex.moveTo(x, y); else ex.lineTo(x, y);
      }
      ex.stroke();
    }
  }
  function updateEchoLab() {
    var p = EL.probe, cur = echoCurrentView();
    if (!p || !cur) return;
    var doc = G.document, st8 = p.getState();
    var dot = doc.getElementById("krdProbeDot");
    if (dot) {
      var cl = p.clampsFor(cur.window);
      var fx = (st8.position.x - cl.positionX[0]) / Math.max(1, cl.positionX[1] - cl.positionX[0]);
      var fy = (st8.position.y - cl.positionY[0]) / Math.max(1, cl.positionY[1] - cl.positionY[0]);
      dot.style.transform = "translate(" + Math.round(fx * 220 - 110) + "px," + Math.round((1 - fy) * 110 - 55) + "px) rotate(" + Math.round(st8.rotationDeg) + "deg)";
    }
    var r;
    try { r = p.score(cur, { noCut: false }); } catch (e) { r = null; }
    if (!r) return;
    var scoreEl = doc.getElementById("krdScore");
    if (scoreEl) scoreEl.textContent = String(r.score);
    var fill = doc.getElementById("krdMeterFill");
    if (fill) fill.style.width = r.score + "%";
    var meter = doc.getElementById("krdMeter");
    if (meter) meter.setAttribute("aria-valuenow", String(r.score));
    var hints = doc.getElementById("krdHints");
    if (hints) hints.innerHTML = r.hints.slice(0, 4).map(function (h) { return "<li>" + I.esc(h) + "</li>"; }).join("");
    var comp = doc.getElementById("krdComp");
    if (comp) comp.textContent = I.tx(T("Plane " + r.distanceMm + " mm off, angle " + r.angleDeg + " deg off, landmarks " + r.landmarksPresent + " of " + r.landmarksTotal + (r.hasForeshortening ? ", foreshortening " + r.foreshorteningMm + " mm" : "") + ".",
      "Plane " + r.distanceMm + " mm off, angle " + r.angleDeg + " deg off."));
    var now = Date.now();
    if (r.withinTolerance) { if (!EL.holdSince) EL.holdSince = now; } else EL.holdSince = null;
    var ach = doc.getElementById("krdAchieved");
    if (ach) ach.hidden = !(EL.holdSince && now - EL.holdSince >= 1000);
    /* Sync sliders without stealing focus from the one being used. */
    [["krdRot", st8.rotationDeg], ["krdTiltR", st8.tiltDeg], ["krdRockR", st8.rockDeg],
     ["krdDepth", st8.depthCm], ["krdTurn", st8.rotationDeg], ["krdOmni", st8.omniplaneDeg], ["krdFlex", st8.flexDeg]].forEach(function (pair) {
      var el = doc.getElementById(pair[0]);
      if (el && doc.activeElement !== el) el.value = Math.round(pair[1]);
      var val = doc.getElementById(pair[0] + "Val");
      if (val && doc.activeElement !== el) val.textContent = Math.round(pair[1]) + (pair[0] === "krdDepth" ? " cm" : " deg");
    });
    drawEchoSector();
  }
  function mountEchoLab() {
    stopEchoLab();
    var p = ensureEchoProbe(), cur = echoCurrentView();
    if (!p || !cur) { drawEchoSector(); return; }
    if (p.getState().window !== cur.window || EL.viewId !== cur.id) startEchoTarget(cur, false);
    else if (!EL._mountedFor) startEchoTarget(cur, false);
    EL._mountedFor = cur.id;
    var doc = G.document;
    var chest = doc.getElementById("krdChest");
    if (chest) EL.unbind.push(p.bindTouchSurface(chest, { mmPerPx: 0.6 }));
    var tiltStrip = doc.getElementById("krdTiltStrip");
    if (tiltStrip) EL.unbind.push(p.bindDragControl(tiltStrip, "tilt", { degPerPx: 0.5 }));
    var rockStrip = doc.getElementById("krdRockStrip");
    if (rockStrip) EL.unbind.push(p.bindDragControl(rockStrip, "rock", { degPerPx: 0.5 }));
    if (!EL._changeBound) { EL._changeBound = true; p.onChange(function () { updateEchoLab(); }); }
    doc.querySelectorAll("[data-krange]").forEach(function (el) {
      el.addEventListener("input", function () {
        var id = el.getAttribute("data-krange"), val = parseFloat(el.value);
        var lbl = doc.getElementById(id + "Val");
        if (id === "krdGain") { EL.knobs.gain = val; if (lbl) lbl.textContent = Math.round(val); drawEchoSector(); return; }
        if (id === "krdDepthK") { EL.knobs.depth = val; if (lbl) lbl.textContent = Math.round(val) + " mm"; drawEchoSector(); return; }
        if (id === "krdFocus") { EL.knobs.focus = val; if (lbl) lbl.textContent = Math.round(val); drawEchoSector(); return; }
        if (id === "krdRot") p.setState({ rotationDeg: val });
        else if (id === "krdTiltR") p.setState({ tiltDeg: val });
        else if (id === "krdRockR") p.setState({ rockDeg: val });
        else if (id === "krdDepth") p.setState({ depthCm: val });
        else if (id === "krdTurn") p.setState({ rotationDeg: val });
        else if (id === "krdOmni") p.setState({ omniplaneDeg: val });
        else if (id === "krdFlex") p.setState({ flexDeg: val });
        if (lbl) lbl.textContent = Math.round(val) + (id === "krdDepth" ? " cm" : " deg");
      });
    });
    /* Keyboard on the drag strips: arrows move by two degrees. */
    [["krdTiltStrip", "tiltDeg"], ["krdRockStrip", "rockDeg"]].forEach(function (pair) {
      var el = doc.getElementById(pair[0]);
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 2 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -2 : 0;
        if (!d) return;
        e.preventDefault();
        var patch = {}; patch[pair[1]] = p.getState()[pair[1]] + d; p.setState(patch);
      });
    });
    st.onLeave = stopEchoLab;
    updateEchoLab();
    EL.timer = G.setInterval(function () { EL.lastCutAt = 0; updateEchoLab(); }, 450);
  }

  function learnList() {
    try {
      var C = G.SMD_KARDIOX_CONTENT;
      if (C && C.ecgs && C.ecgs.length) return C.ecgs;
    } catch (e) {}
    return null;
  }

  function lessonRows(list, n) {
    return list.slice(0, n).map(function (e) {
      return I.row("klearn", ' data-id="' + I.esc(e.id) + '"', I.tile("book"), I.esc(e.title),
        e.category ? I.esc(e.category) : "", "");
    }).join("");
  }

  function echoHtml() {
    var W = host._learn && host._learn._w, ix = W && W.ix, lv = klevel(), pro = I.isPro();
    var head = '<h2 class="sp-h2">' + I.tx(T("Echo", "Echo")) + '</h2><p class="sp-small">' +
      I.tx(T("Echo lessons for the level above. The first three lessons in each area are free at MBBS; the rest are part of StewardMD Pro.", "Echo lessons for the level above. The first three lessons in each area are free at MBBS; the rest are part of StewardMD Pro.")) + "</p>";
    if (!ix) {
      if (W && W.err) return head + '<div class="sp-err krd-err" role="alert"><p>' +
        I.tx(T("Echo lessons did not load. Check the connection and try again.", "Echo lessons did not load. Check the connection and try again.")) +
        '</p><button type="button" class="sp-btn pri" data-act="kretry">' + I.ico("refresh") + " " + I.s("retry") + "</button></div>";
      return head + '<p class="sp-mut" role="status">' + I.tx(T("Loading echo lessons.", "Loading echo lessons.")) + "</p>";
    }
    if (!ix.units || !ix.units.length) return head + '<p class="sp-small">' + I.tx(T("No echo lessons yet.", "No echo lessons yet.")) + "</p>";
    var out = head;
    ix.units.forEach(function (u) {
      var ids = (u.lessons || []).filter(function (id) {
        var m = ix.lessons[id];
        return m && m.levels && m.levels.indexOf(lv) >= 0;
      });
      out += '<h3 class="sp-h3">' + I.tx(u.title) + "</h3>";
      if (!ids.length) {
        out += '<p class="sp-small">' + I.tx(T("No lessons at this level in this area.", "No lessons at this level in this area.")) + "</p>";
        return;
      }
      out += '<ul class="sp-rows">' + ids.map(function (id, i) {
        var m = ix.lessons[id], free = pro || (lv === "mbbs" && i < FREE_ECHO_PER_AREA);
        var title = I.esc(I.t(m.title)), line = (m.minutes ? m.minutes + " min" : "") + (free ? "" : " · Pro");
        if (!free) return I.row("kpro", "", I.tile("lock"), title, line, "");
        return I.row("lesson", ' data-l="' + I.esc(id) + '"', I.tile("book"), title, line, "");
      }).join("") + "</ul>";
    });
    return out;
  }

  function practiceHtml() {
    var bank = host._banks && host._banks[0], pro = I.isPro();
    var line = bank ? bank.line() : "";
    var rows = bank ? '<ul class="sp-rows">' + I.row("kbank", ' data-b="' + I.esc(bank.id) + '"', I.tile("list"),
      I.tx(T("Question bank", "Question bank")), I.tx(T("Explained echo questions and the timed exam", "Explained echo questions and the timed exam")), line) + "</ul>" : "";
    var note = pro ? "" : '<div class="krd-note">' + I.ico("lock") + "<span>" +
      I.tx(T("Free preview: the first " + FREE_BANK_QUESTIONS + " bank questions in a study set. The full bank and the timed exam beyond the free try are part of StewardMD Pro.", "Free preview: the first " + FREE_BANK_QUESTIONS + " bank questions in a study set. The full bank and the timed exam beyond the free try are part of StewardMD Pro.")) + "</span></div>";
    var body = bank ? rows + note : '<p class="sp-mut" role="status">' + I.tx(T("Loading questions.", "Loading questions.")) + "</p>";
    return '<div class="sp-scroll sp-pad"><div class="sp-col"><h2 class="sp-h2">' + I.tx(T("Practice", "Practice")) + "</h2>" + body + "</div></div>";
  }

  function ecgHtml() {
    var list = learnList(), pro = I.isPro();
    var head = '<p class="sp-small">' + I.tx(T("The Learn ECG atlas and quiz, with no AI. Your progress stays in Learn ECG. Atlas pictures need a connection the first time.",
      "बिना AI वाला Learn ECG एटलस और प्रश्नोत्तरी। आपकी प्रगति Learn ECG में रहती है। एटलस की तस्वीरों को पहली बार कनेक्शन चाहिए।")) + "</p>";
    if (!list || !list.length) {
      return '<h2 class="sp-h2">' + I.tx(T("Learn ECG", "Learn ECG")) + "</h2>" + head +
        '<div class="sp-err krd-err" role="alert"><p>' +
        (!list
          ? I.tx(T("Learn ECG did not load. Check the connection and try again.", "Learn ECG लोड नहीं हुआ। कनेक्शन जाँचें और फिर कोशिश करें।"))
          : I.tx(T("No lessons yet. The atlas is being prepared.", "अभी कोई पाठ नहीं है। एटलस तैयार हो रहा है।"))) +
        '</p><button type="button" class="sp-btn pri" data-act="kretry">' + I.ico("refresh") + " " + I.s("retry") + "</button></div>";
    }
    var free = lessonRows(list, FREE_LESSONS);
    var rest = list.length > FREE_LESSONS
      ? '<div class="krd-note">' + I.ico("lock") + "<span>" +
        I.tx(T("Plus " + (list.length - FREE_LESSONS) + " more lessons in the full atlas. The full atlas is part of StewardMD Pro.",
          "पूरे एटलस में " + (list.length - FREE_LESSONS) + " और पाठ। पूरा एटलस StewardMD Pro का हिस्सा है।")) +
        '</span></div><p><button type="button" class="sp-btn sec sp-wide" data-act="kpro">' + I.ico("lock") + " " + I.s("seePro") + "</button></p>"
      : "";
    var openAll = pro
      ? '<p><button type="button" class="sp-btn pri sp-wide" data-act="klearn">' + I.ico("play") + " " +
        I.tx(T("Open the Learn ECG atlas", "Learn ECG एटलस खोलें")) + "</button></p>"
      : "";
    return '<h2 class="sp-h2">' + I.tx(T("Learn ECG", "Learn ECG")) + "</h2>" + head + openAll +
      '<h3 class="sp-h3">' + I.tx(T("Free preview", "मुफ़्त झलक")) + "</h3>" +
      '<ul class="sp-rows" aria-label="' + I.tx(T("Free preview lessons", "मुफ़्त झलक पाठ")) + '">' + free + "</ul>" +
      (pro ? "" : rest);
  }

  function learnHtml() {
    return '<div class="sp-scroll sp-pad"><div class="sp-col">' + echoHtml() + ecgHtml() + "</div></div>";
  }

  function kardioxHtml() {
    return '<div class="sp-scroll sp-pad"><div class="sp-col">' +
      '<div class="krd-soon-hero"><span class="krd-soon-lead" aria-hidden="true">' + I.tile("bolt") + "</span>" +
      "<div><h2>" + I.tx(TAB_T.kardiox) + '</h2><p class="krd-soon-sub">' + I.tx(TAB_SUB.kardiox) + "</p></div></div>" +
      '<p class="sp-small">' + I.tx(T("AI reading of the ECG. It stays behind its access code until clinical sign-off, exactly as before.",
        "ECG की AI रीडिंग। क्लिनिकल अनुमति तक यह अपने एक्सेस कोड के पीछे ही रहेगी, बिल्कुल पहले जैसी।")) + "</p>" +
      '<p><button type="button" class="sp-btn pri sp-wide" data-act="kx">' +
      I.tx(T("Open KardiQ X", "KardiQ X खोलें")) + "</button></p>" +
      "</div></div>";
  }

  function echoBodyHtml() {
    return '<div class="sp-scroll sp-pad"><div class="sp-col">' + echoLabHtml() + "</div></div>";
  }
  function showTab(id, focusSel) {
    if (TABS.indexOf(id) < 0) id = "echo";
    stopEchoLab();
    I.setPref("ktab", id);
    st.view = "hub"; st.again = function (f) { showTab(tab(), f || null); };
    I.leave();
    var lv = klevel();
    if (id === "cases" && G.KARDIA_CASES) {
      G.KARDIA_CASES.attach(host);
      G.KARDIA_CASES.setNavigator(function (f) { showTab("cases", typeof f === "string" ? f : null); });
      var cbody = G.KARDIA_CASES.html();
      /* A case in progress paints its own top bar and progress; the list keeps the tab chrome. */
      if (G.KARDIA_CASES._state && G.KARDIA_CASES._state.curId) { I.paint(cbody, focusSel); return; }
      I.paint(I.markTop(I.tx(host.cfg.subtitle)) + tabsHtml(id) + levelsHtml(lv) + cbody, focusSel);
      return;
    }
    var body = id === "learn" ? learnHtml() : id === "practice" ? practiceHtml() : id === "kardiox" ? kardioxHtml() : id === "echo" ? echoBodyHtml() : soonHtml(id);
    I.paint(I.markTop(I.tx(host.cfg.subtitle)) + tabsHtml(id) + levelsHtml(lv) + body, focusSel);
    if (id === "echo" && EL.views) mountEchoLab();
    else if (id === "echo" && !EL.err) { loadEchoViews(); drawEchoSectorSoon(); }
  }
  function drawEchoSectorSoon() { /* paint waits for views; nothing to draw yet */ }

  function openKardioX() {
    try { G.localStorage.setItem("smd_kardiox", "1"); } catch (e) {}
    if (G.KARDIOX && G.KARDIOX.open) G.KARDIOX.open();
    else I.toast("KardiQ X AI loading…");
  }

  I.ACTIONS.ktab = function (b) { showTab(b.getAttribute("data-t")); };
  I.ACTIONS.klevel = function (b) {
    var v = b.getAttribute("data-v");
    if (LEVELS.indexOf(v) < 0) return;
    if (v !== klevel() && levelLockedK(v)) { I.showPro(); return; }
    if (v === klevel()) return;
    I.setPref("klevel", v);
    I.setPref("level", v === "mbbs" ? "mbbs" : "resident");
    showTab(tab(), '[data-act=klevel][data-v="' + v + '"]');
  };
  I.ACTIONS.kbank = function (b) {
    var id = b.getAttribute("data-b");
    host._banks.forEach(function (x) { if (x.id === id) x.open(); });
    I.setRet(function () { showTab("practice"); }, "Back to Practice");
  };
  if (host._learn) I.ACTIONS.lnexit = function () { I.leave(); showTab("learn"); };
  I.ACTIONS.klearn = function (b) {
    var id = b.getAttribute && b.getAttribute("data-id");
    try {
      if (G.KARDIOX && G.KARDIOX.openLearn) { G.KARDIOX.openLearn(id || undefined); return; }
    } catch (e) {}
    I.toast("Learn ECG loading…");
  };
  I.ACTIONS.kx = function () {
    try {
      if (G.SMD_XACCESS && G.SMD_XACCESS.gate) { G.SMD_XACCESS.gate("kardiox", openKardioX); return; }
    } catch (e) {}
    openKardioX();
  };
  I.ACTIONS.kpro = function () { I.showPro(); };
  I.ACTIONS.kretry = function () { showTab(tab(), "[data-act=kretry]"); };
  I.ACTIONS["kecho-retry"] = function () { EL.err = false; EL.views = null; EL.loading = false; showTab("echo", "[data-act=kecho-retry]"); };
  I.ACTIONS["kecho-view"] = function (b) {
    var id = b.getAttribute("data-v");
    var list = echoViewsForLevel(klevel());
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
      if (echoViewLocked(list[i], klevel(), I.isPro())) { I.showPro(); return; }
      EL._mountedFor = null;
      startEchoTarget(list[i], false);
      showTab("echo", '[data-act=kecho-view][data-v="' + id + '"]');
      return;
    }
  };
  I.ACTIONS["kecho-knobs"] = function (b) {
    EL.knobsOpen = !EL.knobsOpen;
    var panel = G.document.getElementById("krdKnobs");
    if (panel) { panel.hidden = !EL.knobsOpen; b.setAttribute("aria-expanded", String(EL.knobsOpen)); }
  };
  I.ACTIONS["kecho-gyro"] = function (b) {
    var p = ensureEchoProbe();
    if (!p) return;
    if (p.getState().gyroOn) {
      p.disableGyro(); EL.gyroMsg = "";
      showTab("echo", "[data-act=kecho-gyro]"); return;
    }
    p.requestGyroPermission().then(function (ok2) {
      var status = G.document.getElementById("krdGyroStatus");
      if (!ok2) {
        EL.gyroMsg = I.tx(T("Motion permission was not given. Touch controls stay on.", "Motion permission was not given. Touch controls stay on."));
        if (status) status.textContent = EL.gyroMsg;
        return;
      }
      p.enableGyro(); EL.gyroMsg = "";
      showTab("echo", "[data-act=kecho-gyro]");
    }, function () {
      EL.gyroMsg = I.tx(T("Motion is not available on this device. Touch controls stay on.", "Motion is not available on this device. Touch controls stay on."));
      var status = G.document.getElementById("krdGyroStatus");
      if (status) status.textContent = EL.gyroMsg;
    });
  };
  I.ACTIONS["kecho-cal"] = function () {
    var p = ensureEchoProbe();
    if (!p || !p.getState().gyroOn) return;
    /* Calibrate at the pose the phone is in now: the next attitude
     * sample the probe sees becomes the zero. */
    if (p.resetGyroCalibration) p.resetGyroCalibration();
    else p.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 });
    var status = G.document.getElementById("krdGyroStatus");
    if (status) status.textContent = I.tx(T("Calibrated at this pose. Move the phone to move the probe.", "Calibrated at this pose. Move the phone to move the probe."));
  };

  /* Open on the engine host. The engine fetches kardia/tracks.json on first open; the tab screen does
     not need it, so paint after the load settles (first open) or at once ( later opens, config cached).
     Attached after the engine's own handlers, so the tab paint always wins, with no flash. */
  var baseOpen = host.open;
  host.open = function () {
    if (!on()) return false;
    var r = baseOpen();
    if (!r) return r;
    var L = st.loading;
    if (L && !st.cfg && !st.err) L.then(showReady, showReady);
    else showReady();
    return r;
  };
  function showReady() { if (host.isOpen()) showTab(tab()); }

  /* Review Desk style "Read it" hooks and tests read these; the atlas itself stays untouched. */
  host._kardia = { tabs: TABS.slice(), levels: LEVELS.slice(), freeLessons: FREE_LESSONS, freeEchoPerArea: FREE_ECHO_PER_AREA, freeBankQuestions: FREE_BANK_QUESTIONS, on: on, openKardioX: openKardioX,
    freeEchoViews: FREE_ECHO_VIEWS.slice(),
    echoLab: {
      get views() { return EL.views; },
      get probe() { return ensureEchoProbe(); },
      get viewId() { return EL.viewId; },
      setView: function (id) {
        var list = EL.views ? EL.views.views : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) { EL._mountedFor = null; startEchoTarget(list[i], false); if (host.isOpen() && tab() === "echo") showTab("echo"); return true; }
        return false;
      },
      setProbeState: function (s) { var p = ensureEchoProbe(); if (p) { p.setState(s); updateEchoLab(); } return p ? p.getState() : null; },
      getProbeState: function () { var p = ensureEchoProbe(); return p ? p.getState() : null; },
      getScore: function () { var p = ensureEchoProbe(), v = echoCurrentView(); return p && v ? p.score(v) : null; },
      stateForView: function (id) { var p = ensureEchoProbe(); return p ? p.stateForView(id) : null; }
    } };
})(typeof window !== "undefined" ? window : this);
