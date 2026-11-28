/* StewardMD onboarding story (onboard-story.js, owner 2026-11-28). window.SMD_STORY. ES5, no library.
   A short particle story before setup, in the spirit of Regain's onboarding and in StewardMD's voice: competence, not
   fear. One canvas of points morphs from shape to shape (a ward, clusters of decisions, a phone of scattered lookups,
   the StewardMD mark, a pill, a bug, a waveform). Haptics through SMD_HAPTICS mark each beat. Two tracks:
     "clinician"  after the welcome role picker (onboarding.js), then the guided tour.
     "prep"       on the first PrepNucleus open (prep.js), over the plan onboarding (prep-plan.js).
   Every number on screen is the user's own answer, arithmetic on it, or a sourced figure with its source shown
   (NEET-PG 2025: 2,30,114 appeared, NBEMS result notice, 19 Aug 2025; 52,244 PG seats for 2025 counselling after the
   NMC added 2,337, as reported by Careers360 on 20 Nov 2025). No timers, no offers, Skip after 3 s.
   Flag smd_onboard_story, default OFF: localStorage "1" or ?story=1 turns it on; "0" or ?story=0 off. Each track plays
   once per device (smd_story_seen_<track>); ?story=1 replays. Reduced motion: each scene is a still, crossfaded.
   First win (owner 2026-11-28: yes): after the clinician story (not after Skip) demoDose() opens the real renal dose
   tool (renal-dose.js) for piperacillin-tazobactam filled with that tool's own placeholder example (70 years, 60 kg,
   creatinine 2.0 mg/dL, male), under a banner that says it is an example and not a patient. Nothing is saved; the
   next open starts empty. Closing it resolves, and onboarding.js starts the tour.
   API: SMD_STORY.enabled(), seen(track), play(track) -> Promise<{ done, skipped, answers }>, demoDose() -> Promise.
   Pure helpers under node. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  /* ================= pure ================= */
  // Indian digit grouping: 230114 -> "2,30,114".
  function fmtIN(n) {
    n = Math.round(Number(n) || 0);
    var s = String(Math.abs(n)), last = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last = "," + last;
    return (n < 0 ? "-" : "") + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + last;
  }
  // Hours a day on the phone -> whole months a year (365 days, 30.4 days a month).
  function monthsFrom(hours) { return Math.round((Number(hours) || 0) * 365 / 24 / 30.4 * 10) / 10; }
  // A rate limiter for haptic ticks: returns true at most once per ms window.
  function limiter(ms) { var last = -1e9; return function (t) { if (t - last >= ms) { last = t; return true; } return false; }; }
  function rng(seed) { var x = (seed >>> 0) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  // Pick n target points from an alpha mask (Uint8 alpha per pixel, width w, height h), sampling every step px.
  // Fewer filled pixels than n: points repeat (with a small jitter added by the caller). -> [[x, y], ...]
  function sampleMask(alpha, w, h, step, n, seed) {
    var cand = [], r = rng(seed || 7);
    for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) if (alpha[y * w + x] > 128) cand.push([x, y]);
    if (!cand.length) return [];
    for (var i = cand.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
    var out = [];
    for (var k = 0; k < n; k++) out.push(cand[k % cand.length]);
    return out;
  }
  // The scene list of a track. answers: { patients, hours }. Each scene: { id, lines, shape, pal, hap (a haptic pattern
  // name, see PATTERNS), fx (the transition into it: "wave" default, "burst", "swirl", "rain"), ask?, hold?, cta?, src? }.
  var STATS = { prepAppeared: 230114, prepSeats: 52244, src: "NBEMS result notice (Aug 2025) and NMC seat matrix (Nov 2025)" };
  function scenes(track, a) {
    a = a || {};
    if (track === "prep") {
      var h = a.hours || 3, mo = monthsFrom(h);
      return [
        { id: "crowd", lines: ["<em>" + fmtIN(STATS.prepAppeared) + "</em>\u00a0doctors sat NEET-PG 2025."], count: STATS.prepAppeared, shape: "crowd", pal: "night", hap: "land", fx: "rain", hold: 3400, src: "Source: NBEMS result notice, Aug 2025" },
        { id: "seats", lines: ["<em>" + fmtIN(STATS.prepSeats) + "</em>\u00a0PG seats.", "Roughly one for every four or five."], shape: "seats", pal: "night", hap: "fall", hold: 3600, src: "Source: NMC seat matrix for 2025 counselling" },
        { id: "phone", lines: ["How many hours a day does your phone take?"], shape: "phone", pal: "night", fx: "swirl", mascot: true, ask: { key: "hours", opts: [[1, "1 hour"], [3, "3 hours"], [5, "5 hours"], [7, "7 or more"]] } },
        { id: "months", lines: ["<em>" + h + (h === 1 ? " hour" : " hours") + "</em> a day is <em>" + mo + " months</em> a year.", "Time you can take back."], shape: "calendar", months: mo, pal: "amber", hap: "warn", hold: 3800 },
        { id: "turn", lines: ["PrepNucleus turns that time into practice."], shape: "logo-prep", pal: "prussian", hap: "bloom", fx: "burst", hold: 3000 },
        { id: "learn", lines: ["Lessons, questions and mocks for your exam."], shape: "book", pal: "prussian", hap: "tap", hold: 2500 },
        { id: "adapt", lines: ["Questions that adapt to what you miss."], shape: "target", pal: "prussian", hap: "tap", fx: "swirl", hold: 2500 },
        { id: "focus", lines: ["A focus timer that keeps distractions out."], shape: "lock", pal: "prussian", hap: "lock", hold: 2500 },
        { id: "plan", lines: ["A plan that counts down to your exam."], shape: "check", pal: "prussian", hap: "done", hold: 2500 },
        { id: "go", lines: ["Let's build your plan."], shape: "logo-prep", pal: "prussian", hap: "bloom", fx: "burst", cta: "Build my plan" }
      ];
    }
    var n = a.patients || 25, d = n * 4;
    return [
      { id: "ward", lines: ["Every shift starts with patients.", "How many do you see on a typical day?"], shape: "ward", wardN: 40, pal: "night", fx: "rain", ask: { key: "patients", opts: [[10, "About 10"], [25, "About 25"], [50, "About 50"], [100, "100 or more"]] } },
      { id: "ward2", lines: ["<em>" + n + "</em> patients today."], shape: "ward", wardN: n, pal: "night", hap: "land", hold: 2400 },
      { id: "decide", lines: ["At four decisions each, that is <em>" + fmtIN(d) + "</em>.", "Doses, interactions, antibiotics, renal adjustments, scores."], count: d, shape: "clusters", wardN: n, pal: "night", hap: "land", hold: 3800 },
      { id: "hunt", lines: ["Most of them get looked up.", "Across apps, books and memory."], shape: "phone", pal: "grey", hap: "scatter", fx: "burst", hold: 3200 },
      { id: "turn", lines: ["One place for all of them."], shape: "logo-smd", pal: "teal", hap: "bloom", fx: "swirl", hold: 2800 },
      { id: "dose", lines: ["Doses, adjusted for the kidney."], shape: "pill", pal: "teal", hap: "tap", hold: 2400 },
      { id: "abx", lines: ["Antibiotics, from your hospital's own antibiogram."], shape: "bug", pal: "teal", hap: "tap", hold: 2500 },
      { id: "icu", lines: ["ICU, Code Blue and the ward, on one screen."], shape: "wave", pal: "teal", hap: "heartbeat", hold: 2800 },
      { id: "maik", lines: ["Stuck on a case? Ask MaiK, the clinical assistant."], shape: "bubble", pal: "teal", hap: "tap", hold: 2600 },
      { id: "go", lines: ["Try one now, on an example patient."], shape: "logo-smd", pal: "teal", hap: "bloom", fx: "burst", cta: "Try a renal dose" }
    ];
  }
  // Haptic patterns: [[SMD_HAPTICS kind, ms after the shape lands], ...]. Short, few, never a continuous buzz.
  var PATTERNS = {
    tap: [["medium", 0]], land: [["heavy", 0]], warn: [["warning", 0]], done: [["success", 0]],
    lock: [["medium", 0], ["heavy", 120]],
    bloom: [["heavy", 0], ["light", 120], ["success", 300]],
    heartbeat: [["heavy", 0], ["light", 150], ["heavy", 950], ["light", 1100]],
    scatter: [["light", 0], ["light", 60], ["light", 130], ["light", 210], ["warning", 320]],
    fall: [["light", 0], ["light", 110], ["light", 240], ["light", 400], ["medium", 600]]
  };
  // The count-up tick interval: slow at first, faster as it nears the number (a crescendo), in ms.
  function tickGap(f) { return Math.round(150 - 100 * Math.max(0, Math.min(1, f))); }
  var PURE = { PATTERNS: PATTERNS, tickGap: tickGap, fmtIN: fmtIN, monthsFrom: monthsFrom, limiter: limiter, sampleMask: sampleMask, scenes: scenes, STATS: STATS };
  if (NODE) { module.exports = PURE; return; }

  /* ================= app ================= */
  /* Craft notes (owner 2026-11-28: "more graphics, more motion, more premium with haptics, best practices"):
     - Layers, back to front: the background colour (crossfades per scene), a soft glow in the scene's accent that
       breathes, the particle canvas (motion trails, a halo on accent points), the text, the controls.
     - Motion: every morph is a spring with a staggered start (a wave from the centre), and some scenes enter with a
       burst, a swirl or a rain of points. Points breathe a little at rest. Numbers count up and land with a pop.
       Words rise in one by one, from a blur to sharp.
     - Touch: the points flow away from a finger (a light tick as you sweep), tap the right side for next and the left
       for back, press and hold to pause (stories pattern). Buttons are 44 px or more.
     - Haptics: one short pattern per scene (PATTERNS), timed to the shape landing; a crescendo of ticks under a count.
       All through SMD_HAPTICS, so the user's haptics setting applies.
     - Budget: device pixel ratio capped at 2; the point count halves when frames run slow; drawing and timers stop
       while the app is in the background. Reduced motion: still frames, no trails, no burst, text without blur. */
  var D = G.document;
  function enabled() {
    try {
      var q = (G.location.search.match(/[?&]story=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem("smd_onboard_story") === "1";
    } catch (e) { return false; }
  }
  function forced() { try { return /[?&]story=1\b/.test(G.location.search); } catch (e) { return false; } }
  function seen(track) { if (forced()) return false; try { return G.localStorage.getItem("smd_story_seen_" + track) === "1"; } catch (e) { return false; } }
  function markSeen(track) { try { G.localStorage.setItem("smd_story_seen_" + track, "1"); } catch (e) {} }
  function reduced() { try { return G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function hap(k) { try { var h = G.SMD_HAPTICS; if (h && h[k]) h[k](); } catch (e) {} }

  // Palettes: background, glow, point colours [main, accent, dim].
  var PAL = {
    night: { bg: "#0b1016", glow: "rgba(120,150,190,.20)", c: ["#e9eef3", "#efc07b", "#3a4552"] },
    grey: { bg: "#0f1317", glow: "rgba(120,130,140,.12)", c: ["#7b8794", "#9aa5b1", "#2b333c"] },
    amber: { bg: "#17120a", glow: "rgba(239,192,123,.24)", c: ["#efc07b", "#f6d7a6", "#4a3d2c"] },
    teal: { bg: "#06231f", glow: "rgba(79,209,191,.26)", c: ["#e6f4f1", "#4fd1bf", "#1d4a44"] },
    prussian: { bg: "#0f2240", glow: "rgba(239,192,123,.20)", c: ["#f5f3ee", "#efc07b", "#2a3d63"] }
  };

  var F = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif";
  var CSS = "#smdStory{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;color:#f5f3ee;background:#0b1016;transition:background-color .9s ease;font-family:" + F + ";-webkit-user-select:none;user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent;overflow:hidden}" +
    "#smdStory .ss-glow{position:absolute;left:50%;top:53%;width:140vmin;height:140vmin;margin:-70vmin 0 0 -70vmin;border-radius:50%;background:radial-gradient(closest-side,var(--ss-glow,rgba(120,150,190,.2)),transparent 70%);transition:background .9s ease,transform 1.2s cubic-bezier(.23,1,.32,1);animation:ss-breathe 6s ease-in-out infinite;pointer-events:none}" +
    "#smdStory .ss-glow.kick{transform:scale(1.18)}" +
    "@keyframes ss-breathe{50%{opacity:.72}}" +
    "#smdStory canvas{position:absolute;inset:0;width:100%;height:100%}" +
    "#smdStory .ss-top{position:relative;display:flex;flex-direction:column;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 0}" +
    "#smdStory .ss-bars{display:flex;gap:4px}#smdStory .ss-bars i{flex:1 1 0;height:3px;border-radius:2px;background:rgba(255,255,255,.22);overflow:hidden}" +
    "#smdStory .ss-bars b{display:block;height:100%;width:0;background:rgba(255,255,255,.92);border-radius:2px}#smdStory .ss-bars i.past b{width:100%}" +
    "#smdStory .ss-bars i.now b{animation:ss-fill var(--ss-d,3s) linear forwards}#smdStory .ss-bars i.now.wait b{animation:none;width:100%;opacity:.55}" +
    "#smdStory.paused .ss-bars i.now b{animation-play-state:paused}" +
    "@keyframes ss-fill{from{width:0}to{width:100%}}" +
    "#smdStory .ss-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}" +
    "#smdStory .ss-skip{min-height:44px;padding:0 16px;border:0;border-radius:22px;background:rgba(255,255,255,.1);color:inherit;font:600 15px/1 " + F + ";opacity:0;pointer-events:none;transition:opacity .4s ease}" +
    "#smdStory .ss-skip.on{opacity:1;pointer-events:auto}" +
    "#smdStory .ss-text{position:relative;padding:6px 28px 0;text-align:center;min-height:124px;pointer-events:none}" +
    "#smdStory .ss-l{margin:0 auto 8px;max-width:30ch;font:700 clamp(22px,6.2vw,28px)/1.26 " + F + ";letter-spacing:-.018em}" +
    "#smdStory .ss-l + .ss-l{font-weight:500;font-size:clamp(16px,4.4vw,19px);letter-spacing:-.005em;color:rgba(245,243,238,.72)}" +
    "#smdStory .ss-w{display:inline-block;opacity:0;transform:translateY(10px);filter:blur(6px);transition:opacity .5s ease,transform .7s cubic-bezier(.23,1,.32,1),filter .6s ease;transition-delay:calc(var(--i,0) * 45ms + var(--l,0ms))}" +
    "#smdStory .ss-in .ss-w{opacity:1;transform:none;filter:none}" +
    "#smdStory .ss-l em{font-style:normal;color:var(--ss-acc,#efc07b);font-variant-numeric:tabular-nums;display:inline-block}" +
    "#smdStory .ss-l em.pop{animation:ss-pop .5s cubic-bezier(.34,1.56,.64,1)}@keyframes ss-pop{40%{transform:scale(1.14)}}" +
    "#smdStory .ss-fill{flex:1 1 auto}" +
    "#smdStory .ss-bot{position:relative;display:flex;flex-direction:column;gap:12px;padding:0 20px calc(env(safe-area-inset-bottom,0px) + 22px)}" +
    "#smdStory .ss-src{margin:0;text-align:center;font-size:12px;color:rgba(245,243,238,.55);pointer-events:none}" +
    "#smdStory .ss-mascot{position:relative;height:112px;display:flex;justify-content:center;pointer-events:none}" +
    "#smdStory .ss-mascot .pnm{position:relative !important;inset:auto !important;right:auto !important;bottom:auto !important;transform:scale(1.15)}" +
    "#smdStory .ss-mascot .pnm-tab{display:none}" +
    "#smdStory .ss-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
    "#smdStory .ss-opt{min-height:54px;border-radius:16px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:inherit;font:600 16px/1.2 " + F + ";opacity:0;transform:translateY(14px);transition:opacity .45s ease,transform .6s cubic-bezier(.23,1,.32,1),background-color .2s ease}" +
    "#smdStory .ss-in .ss-opt{opacity:1;transform:none}" +
    "#smdStory .ss-opt:active{transform:scale(.96)}#smdStory .ss-opt.on{background:#f5f3ee;color:#0b1016;border-color:#f5f3ee}" +
    "#smdStory .ss-cta{position:relative;overflow:hidden;min-height:58px;border:0;border-radius:18px;background:#f5f3ee;color:#0b1016;font:700 17px/1 " + F + ";opacity:0;transform:translateY(14px) scale(.98);transition:opacity .5s ease .5s,transform .7s cubic-bezier(.23,1,.32,1) .5s}" +
    "#smdStory .ss-in .ss-cta{opacity:1;transform:none}#smdStory .ss-cta:active{transform:scale(.97)}" +
    "#smdStory .ss-cta::after{content:'';position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.65),transparent);animation:ss-sheen 2.8s ease-in-out 1.4s infinite}" +
    "@keyframes ss-sheen{0%{left:-60%}45%,100%{left:130%}}" +
    "#smdStory :focus-visible{outline:2px solid #efc07b;outline-offset:2px}#smdStory .ss-l:focus{outline:none}" +
    "#smdStory .ss-hint{margin:0;font-size:12px;color:rgba(245,243,238,.45);pointer-events:none;transition:opacity .6s ease}" +
    "@media (prefers-reduced-motion:reduce){#smdStory,#smdStory .ss-w,#smdStory .ss-opt,#smdStory .ss-cta,#smdStory .ss-glow{transition:none;animation:none}#smdStory .ss-w{filter:none;transform:none}#smdStory .ss-cta::after{display:none}}";

  var S = null; // the running story

  /* ---------- shapes: draw on an offscreen canvas, sample the alpha ---------- */
  var IMG = {};
  function loadImg(src) {
    if (IMG[src]) return IMG[src];
    IMG[src] = new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
    return IMG[src];
  }
  // Region the shape lives in (CSS px): between the text and the buttons.
  function region(W, H) { var top = H * 0.30, bot = H * 0.76, size = Math.min(W * 0.84, bot - top); return { cx: W / 2, cy: (top + bot) / 2, s: size }; }
  function roundRect(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
  function drawShape(name, sc, W, H, img) {
    var c = D.createElement("canvas"); c.width = Math.ceil(W); c.height = Math.ceil(H);
    var x = c.getContext("2d"), R = region(W, H), s = R.s, cx = R.cx, cy = R.cy, i, j;
    x.fillStyle = "#fff"; x.strokeStyle = "#fff"; x.lineCap = "round"; x.lineJoin = "round";
    function dot(px, py, r) { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); }
    if (name === "ward" || name === "clusters") {
      var n = Math.max(1, Math.min(sc.wardN || 25, 100)), cols = Math.ceil(Math.sqrt(n * 1.3)), rows = Math.ceil(n / cols), g = s / Math.max(cols, rows);
      for (i = 0; i < n; i++) {
        var gx = cx - (cols - 1) * g / 2 + (i % cols) * g, gy = cy - (rows - 1) * g / 2 + Math.floor(i / cols) * g;
        if (name === "ward") { dot(gx, gy - g * .1, g * 0.14); x.beginPath(); x.ellipse(gx, gy + g * .2, g * .22, g * .14, 0, Math.PI, 0); x.fill(); }
        else for (j = 0; j < 4; j++) dot(gx + Math.cos(j * Math.PI / 2 + .6) * g * .2, gy + Math.sin(j * Math.PI / 2 + .6) * g * .2, g * 0.11);
      }
    } else if (name === "crowd" || name === "seats") {
      for (i = 0; i < 1600; i++) { var a = i * 2.39996, rr = Math.sqrt(i / 1600) * s * 0.5; dot(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92, 2.2); }
    } else if (name === "phone") {
      var pw = s * 0.42, ph = s * 0.78; x.lineWidth = 5; roundRect(x, cx - pw / 2, cy - ph / 2, pw, ph, 26); x.stroke();
      x.lineWidth = 4; x.beginPath(); x.moveTo(cx - pw * .15, cy - ph / 2 + 14); x.lineTo(cx + pw * .15, cy - ph / 2 + 14); x.stroke();
      var r2 = rng(11);
      for (i = 0; i < 16; i++) { var ix = cx + (r2() - .5) * s * 0.98, iy = cy + (r2() - .5) * s * 0.98; if (Math.abs(ix - cx) < pw / 2 + 14 && Math.abs(iy - cy) < ph / 2 + 14) continue; roundRect(x, ix - 13, iy - 13, 26, 26, 7); x.fill(); }
    } else if (name === "calendar") {
      var cw = s / 4, chh = s / 3.4;
      for (i = 0; i < 12; i++) { var mx = cx - 1.5 * cw + (i % 4) * cw, my = cy - chh + Math.floor(i / 4) * chh; for (j = 0; j < 30; j++) dot(mx - cw * .34 + (j % 6) * cw * .136, my - chh * .3 + Math.floor(j / 6) * chh * .15, 2.4); }
    } else if (name === "pill") {
      x.save(); x.translate(cx, cy); x.rotate(-0.6); roundRect(x, -s * .36, -s * .14, s * .72, s * .28, s * .14); x.fill(); x.globalCompositeOperation = "destination-out"; x.fillRect(-3, -s * .15, 6, s * .3); x.restore();
    } else if (name === "bug") {
      x.beginPath(); x.ellipse(cx, cy, s * .2, s * .3, 0, 0, Math.PI * 2); x.fill(); x.lineWidth = 6;
      for (i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(cx - s * .18, cy + i * s * .14); x.lineTo(cx - s * .38, cy + i * s * .2); x.moveTo(cx + s * .18, cy + i * s * .14); x.lineTo(cx + s * .38, cy + i * s * .2); x.stroke(); }
    } else if (name === "wave") {
      x.lineWidth = 9; x.beginPath(); var L = cx - s * .48;
      x.moveTo(L, cy); x.lineTo(L + s * .3, cy); x.lineTo(L + s * .36, cy - s * .08); x.lineTo(L + s * .42, cy); x.lineTo(L + s * .48, cy + s * .05); x.lineTo(L + s * .54, cy - s * .38); x.lineTo(L + s * .61, cy + s * .2); x.lineTo(L + s * .67, cy); x.lineTo(L + s * .96, cy); x.stroke();
    } else if (name === "bubble") {
      roundRect(x, cx - s * .38, cy - s * .26, s * .76, s * .44, s * .1); x.fill();
      x.beginPath(); x.moveTo(cx - s * .2, cy + s * .17); x.lineTo(cx - s * .28, cy + s * .34); x.lineTo(cx - s * .04, cy + s * .17); x.fill();
      x.globalCompositeOperation = "destination-out"; for (i = -1; i <= 1; i++) dot(cx + i * s * .14, cy - s * .04, s * .045); x.globalCompositeOperation = "source-over";
    } else if (name === "book") {
      x.lineWidth = 7;
      for (var side = -1; side <= 1; side += 2) { x.beginPath(); x.moveTo(cx, cy - s * .22); x.quadraticCurveTo(cx + side * s * .2, cy - s * .3, cx + side * s * .4, cy - s * .24); x.lineTo(cx + side * s * .4, cy + s * .24); x.quadraticCurveTo(cx + side * s * .2, cy + s * .18, cx, cy + s * .26); x.stroke(); for (j = 0; j < 4; j++) { x.beginPath(); x.moveTo(cx + side * s * .08, cy - s * .12 + j * s * .09); x.lineTo(cx + side * s * .32, cy - s * .14 + j * s * .09); x.stroke(); } }
      x.beginPath(); x.moveTo(cx, cy - s * .22); x.lineTo(cx, cy + s * .26); x.stroke();
    } else if (name === "target") {
      x.lineWidth = 7; for (i = 1; i <= 3; i++) { x.beginPath(); x.arc(cx, cy, s * .14 * i, 0, Math.PI * 2); x.stroke(); } dot(cx, cy, s * .05);
    } else if (name === "lock") {
      roundRect(x, cx - s * .26, cy - s * .04, s * .52, s * .4, 18); x.fill(); x.lineWidth = s * .07; x.beginPath(); x.arc(cx, cy - s * .04, s * .17, Math.PI, 0); x.stroke();
      x.globalCompositeOperation = "destination-out"; dot(cx, cy + s * .13, s * .05); x.fillRect(cx - s * .018, cy + s * .14, s * .036, s * .1); x.globalCompositeOperation = "source-over";
    } else if (name === "check") {
      x.lineWidth = 8; x.beginPath(); x.arc(cx, cy, s * .38, 0, Math.PI * 2); x.stroke(); x.lineWidth = 14; x.beginPath(); x.moveTo(cx - s * .17, cy); x.lineTo(cx - s * .04, cy + s * .14); x.lineTo(cx + s * .2, cy - s * .13); x.stroke();
    } else if (img) {
      var k = s * 0.8; x.drawImage(img, cx - k / 2, cy - k / 2, k, k);
    }
    var d = x.getImageData(0, 0, c.width, c.height).data, al = new Uint8Array(c.width * c.height);
    for (i = 0; i < al.length; i++) al[i] = d[i * 4 + 3];
    return { alpha: al, w: c.width, h: c.height };
  }
  // Point targets and colour index per point for a scene.
  function targetsFor(sc, W, H) {
    var name = sc.shape, src = name === "logo-smd" ? "/mark-white.png" : name === "logo-prep" ? "/prepnucleus-logo.png" : null;
    return Promise.resolve(src ? loadImg(src) : null).then(function (img) {
      var m = drawShape(name, sc, W, H, img), N = S.N, step = name === "crowd" || name === "seats" || name === "calendar" ? 2 : 3;
      var pts = sampleMask(m.alpha, m.w, m.h, step, N, 1 + sc.id.length), col = new Array(N), R = region(W, H), i;
      if (!pts.length) for (var z = 0; z < N; z++) pts.push([R.cx, R.cy]);
      for (i = 0; i < N; i++) col[i] = 0;
      if (name === "seats") {          // about 23% of the crowd stays bright (seats / appeared), the rest dims
        var keep = STATS.prepSeats / STATS.prepAppeared;
        for (i = 0; i < N; i++) col[i] = (i / N) < keep ? 0 : 2;
      } else if (name === "calendar") { // highlighted months, left to right, top to bottom, a partial month in part
        var mo = Math.min(12, sc.months || 0), cw = R.s / 4, chh = R.s / 3.4;
        for (i = 0; i < N; i++) { var p = pts[i], ci = Math.max(0, Math.min(3, Math.round((p[0] - (R.cx - 1.5 * cw)) / cw))), ri = Math.max(0, Math.min(2, Math.round((p[1] - (R.cy - chh)) / chh))); var mi = ri * 4 + ci, part = (p[0] - (R.cx - 1.5 * cw - cw * .4)) / (cw * .8); col[i] = mi < Math.floor(mo) || (mi === Math.floor(mo) && part < mo - Math.floor(mo)) ? 1 : 2; }
      } else if (name === "phone") {
        for (i = 0; i < N; i++) col[i] = i % 5 === 0 ? 2 : 0;
      } else if (name === "logo-smd" || name === "logo-prep" || name === "check") {
        for (i = 0; i < N; i++) col[i] = i % 7 === 0 ? 1 : 0;   // a few accent sparks in the mark
      }
      if (name === "crowd" || name === "seats") { var you = Math.floor(N * 0.11); col[you] = 1; S.you = you; } else S.you = -1;
      return { pts: pts, col: col, R: R };
    });
  }

  /* ---------- the particle field ---------- */
  function initPoints(W, H) {
    var r = rng(99), P = [];
    for (var i = 0; i < S.N; i++) P.push({ x: r() * W, y: r() * H, vx: 0, vy: 0, tx: r() * W, ty: r() * H, c: 2, j: r() * 6.28, at: 0 });
    return P;
  }
  // The transition into a scene: a staggered wave from the centre, plus an impulse for burst, swirl and rain.
  function retarget(tg, sc, now) {
    var R = tg.R, P = S.P, r = rng(5 + S.i), maxD = R.s * 0.75, fx = sc.fx || "wave";
    for (var q = 0; q < P.length; q++) {
      var p = P[q], t = tg.pts[q % tg.pts.length];
      p.tx = t[0] + (r() - .5) * 1.4; p.ty = t[1] + (r() - .5) * 1.4; p.c = tg.col[q] == null ? 0 : tg.col[q];
      if (S.reduced) { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; p.at = 0; continue; }
      var dx = p.x - R.cx, dy = p.y - R.cy, dd = Math.sqrt(dx * dx + dy * dy) || 1;
      p.at = now + Math.min(1, Math.hypot(p.tx - R.cx, p.ty - R.cy) / maxD) * 380 + r() * 60;
      if (fx === "burst") { var k = 6 + r() * 10; p.vx += dx / dd * k; p.vy += dy / dd * k; p.at += 140; }
      else if (fx === "swirl") { var w = 5 + r() * 5; p.vx += -dy / dd * w; p.vy += dx / dd * w; }
      else if (fx === "rain") { p.y = -10 - r() * S.H * 0.6; p.x = p.tx + (r() - .5) * 40; p.vx = 0; p.vy = 2 + r() * 3; p.at = now + r() * 500; }
    }
    if (!S.reduced) { var g = S.el.querySelector(".ss-glow"); if (g) { g.classList.add("kick"); G.setTimeout(function () { g.classList.remove("kick"); }, 420); } }
  }
  function frame(t) {
    if (!S || S.hidden) return;
    S.raf = G.requestAnimationFrame(frame);
    var raw = t - (S.lt || t), dt = Math.min(2.5, raw / 16.67); S.lt = t;
    // Adaptive budget: after a second of frames, a slow device draws half the points.
    if (raw > 0 && S.fc < 90) { S.fc++; S.fsum += raw; if (S.fc === 90 && S.fsum / 90 > 24 && S.P.length > 700) { S.P.length = Math.floor(S.P.length / 2); S.lite = true; } }
    var ctx = S.ctx, W = S.W, H = S.H, P = S.P, pal = PAL[S.pal] || PAL.night, k = 0.055 * dt, damp = Math.pow(0.8, dt), mo = S.reduced, slow = S.paused ? 0.25 : 1;
    if (mo) ctx.clearRect(0, 0, W, H);
    else { ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0," + (S.lite ? 0.6 : 0.36) + ")"; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = "source-over"; }
    var buckets = [[], [], []], ptr = S.ptr, pr = 76;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (!mo) {
        if (t >= p.at) { p.vx = (p.vx + (p.tx - p.x) * k * slow) * damp; p.vy = (p.vy + (p.ty - p.y) * k * slow) * damp; }
        else { p.vx *= 0.97; p.vy = p.vy * 0.97 + (S.fx === "rain" ? 0.25 * dt : 0); }
        if (ptr && ptr.on) { var ex = p.x - ptr.x, ey = p.y - ptr.y, e2 = ex * ex + ey * ey; if (e2 < pr * pr && e2 > 1) { var ed = Math.sqrt(e2), f = (1 - ed / pr) * 3.2; p.vx += ex / ed * f; p.vy += ey / ed * f; } }
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      buckets[p.c].push(p);
    }
    var breathe = mo ? 0 : 0.7;
    for (var b = 0; b < 3; b++) {
      var bk = buckets[b], sz = b === 1 ? 2.6 : b === 2 ? 1.8 : 2.1;
      if (b === 1 && !S.lite && !mo) {     // a soft halo on accent points
        ctx.globalAlpha = 0.16; ctx.fillStyle = pal.c[1]; ctx.beginPath();
        for (var h = 0; h < bk.length; h++) ctx.rect(bk[h].x - 4, bk[h].y - 4, 8, 8);
        ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pal.c[b]; ctx.beginPath();
      for (var q = 0; q < bk.length; q++) { var o = bk[q], wob = breathe * Math.sin(t / 900 + o.j); ctx.rect(o.x + wob - sz / 2, o.y - wob - sz / 2, sz, sz); }
      ctx.fill();
    }
    if (S.you >= 0 && P[S.you]) {
      var y = P[S.you], pulse = mo ? 0 : (Math.sin(t / 260) + 1) * 3;
      ctx.fillStyle = pal.c[1]; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(y.x, y.y, 9 + pulse, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(y.x, y.y, 5, 0, 6.283); ctx.fill();
      ctx.font = "600 13px " + F; ctx.textAlign = "center"; ctx.fillText("You", y.x, y.y - 14);
    }
    // Count-up: a crescendo of ticks while the number climbs, a pop and a thud when it lands.
    if (S.count && !S.paused) {
      var c = S.count, fr = Math.min(1, (t - c.t0) / c.ms), v = Math.round(c.to * (1 - Math.pow(1 - fr, 3)));
      if (c.el) c.el.textContent = fmtIN(v);
      if (fr < 1) { if (t - (S.lastTick || 0) >= tickGap(fr)) { S.lastTick = t; hap("selection"); } }
      else { S.count = null; if (c.el) { c.el.classList.remove("pop"); void c.el.offsetWidth; c.el.classList.add("pop"); } pattern(S.sc && S.sc.hap || "land"); }
    }
  }

  /* ---------- haptic patterns ---------- */
  function pattern(name) {
    var seq = PATTERNS[name] || PATTERNS.tap;
    seq.forEach(function (st) { S.pt.push(G.setTimeout(function () { if (S && !S.hidden) hap(st[0]); }, st[1])); });
  }
  function clearPattern() { (S.pt || []).forEach(function (x) { G.clearTimeout(x); }); S.pt = []; }

  /* ---------- text: words rise in one by one ---------- */
  function wrapWords(p, lineDelay) {
    p.style.setProperty("--l", lineDelay + "ms");
    var n = 0, walk = function (node) {
      [].slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) {
          var parts = ch.textContent.split(/(\s+)/), frag = D.createDocumentFragment();
          parts.forEach(function (w) { if (!w) return; if (/^\s+$/.test(w)) { frag.appendChild(D.createTextNode(w)); return; } var sp = D.createElement("span"); sp.className = "ss-w"; sp.style.setProperty("--i", n++); sp.textContent = w; frag.appendChild(sp); });
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1 && ch.tagName === "EM") { var wr = D.createElement("span"); wr.className = "ss-w"; wr.style.setProperty("--i", n++); node.replaceChild(wr, ch); wr.appendChild(ch); }
        else if (ch.nodeType === 1) walk(ch);
      });
    };
    walk(p);
    return n;
  }

  /* ---------- scenes ---------- */
  function holdStart(ms) { G.clearTimeout(S.hold); S.holdLeft = ms; S.holdAt = G.performance.now(); S.hold = G.setTimeout(next, ms); }
  function holdPause() { if (S.hold && S.holdLeft != null) { G.clearTimeout(S.hold); S.hold = 0; S.holdLeft = Math.max(0, S.holdLeft - (G.performance.now() - S.holdAt)); } }
  function holdResume() { if (!S.hold && S.holdLeft != null && S.sc && S.sc.hold) { S.holdAt = G.performance.now(); S.hold = G.setTimeout(next, S.holdLeft); } }
  function show(i) {
    if (!S) return;
    G.clearTimeout(S.hold); S.hold = 0; S.holdLeft = null; clearPattern(); S.count = null;
    if (S.mascot) { try { S.mascot.destroy(); } catch (e) {} S.mascot = null; }
    var list = scenes(S.track, S.answers), sc = list[i];
    if (!sc) return end(false);
    S.i = i; S.sc = sc; S.pal = sc.pal; S.fx = sc.fx || "wave";
    var pal = PAL[sc.pal] || PAL.night;
    S.el.style.backgroundColor = pal.bg;
    S.el.style.setProperty("--ss-acc", pal.c[1]); S.el.style.setProperty("--ss-glow", pal.glow);
    // Progress bars: past full, the current one fills over the hold (a question or the last screen waits).
    var bars = S.el.querySelector(".ss-bars");
    bars.innerHTML = list.map(function (x, j) { return '<i class="' + (j < i ? "past" : j === i ? "now" + (sc.hold ? "" : " wait") : "") + '"><b></b></i>'; }).join("");
    if (sc.hold) bars.style.setProperty("--ss-d", sc.hold + "ms");
    // Text.
    var tx = S.el.querySelector(".ss-text");
    tx.classList.remove("ss-in");
    tx.innerHTML = sc.lines.map(function (l) { return '<p class="ss-l">' + l + "</p>"; }).join("");
    var ls = tx.querySelectorAll(".ss-l"), delay = 0;
    for (var k = 0; k < ls.length; k++) { var nw = wrapWords(ls[k], delay); delay += nw * 45 + 260; }
    G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { if (S && S.i === i) tx.classList.add("ss-in"); }); });
    try { ls[0].setAttribute("tabindex", "-1"); ls[0].focus({ preventScroll: true }); } catch (e) {}
    // Bottom: source, mascot, answers or the call to action.
    var bot = S.el.querySelector(".ss-bot"), html = "";
    if (sc.src) html += '<p class="ss-src">' + sc.src + "</p>";
    if (sc.mascot && G.PREP_MASCOT && G.PREP_MASCOT.mount) html += '<div class="ss-mascot" aria-hidden="true"></div>';
    if (sc.ask) html += '<div class="ss-opts" role="group" aria-label="' + sc.lines[sc.lines.length - 1].replace(/<[^>]+>/g, "") + '">' + sc.ask.opts.map(function (o, j) { return '<button type="button" class="ss-opt" style="transition-delay:' + (delay + j * 60) + 'ms" data-ss="ans" data-v="' + o[0] + '">' + o[1] + "</button>"; }).join("") + "</div>";
    if (sc.cta) html += '<button type="button" class="ss-cta" data-ss="done">' + sc.cta + "</button>";
    bot.classList.remove("ss-in"); bot.innerHTML = html;
    G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { if (S && S.i === i) bot.classList.add("ss-in"); }); });
    var ms = bot.querySelector(".ss-mascot");
    if (ms) { try { S.mascot = G.PREP_MASCOT.mount(ms, { reduceMotion: S.reduced, hideKey: "smd_story_nucleo_off" }); } catch (e) { S.mascot = null; } }
    var hint = S.el.querySelector(".ss-hint"); if (hint && i > 1) hint.style.opacity = "0";
    // Shape.
    var my = ++S.gen;
    targetsFor(sc, S.W, S.H).then(function (tg) {
      if (!S || S.gen !== my) return;
      var now = G.performance.now();
      retarget(tg, sc, now);
      if (sc.count) { var em = tx.querySelector("em"); S.count = { to: sc.count, t0: now + 200, ms: S.reduced ? 1 : 1700, el: em }; }
      else if (sc.hap) S.pt.push(G.setTimeout(function () { if (S && S.gen === my) pattern(sc.hap); }, S.reduced ? 0 : 520));
    });
    if (sc.hold) holdStart(sc.hold);
  }
  function next() { if (S && S.sc && !S.sc.ask && !S.sc.cta) show(S.i + 1); }
  function prev() { if (S && S.i > 0) { hap("light"); show(S.i - 1); } }

  /* ---------- input: buttons, tap zones, hold to pause, the finger in the field ---------- */
  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-ss]");
    if (!b) return;
    var a = b.getAttribute("data-ss");
    if (a === "skip") return end(true);
    if (a === "done") return end(false);
    if (a === "ans") {
      var v = Number(b.getAttribute("data-v")); S.answers[S.sc.ask.key] = v;
      var all = S.el.querySelectorAll(".ss-opt"); for (var i = 0; i < all.length; i++) all[i].classList.remove("on");
      b.classList.add("on"); hap("medium");
      if (S.mascot) try { S.mascot.cue("quiz", { kind: "right", n: 1 }); } catch (x) {}
      G.setTimeout(function () { if (S) show(S.i + 1); }, S.mascot ? 650 : 360);
    }
  }
  function onDown(e) {
    if (e.target.closest && e.target.closest("button")) return;
    S.down = { x: e.clientX, y: e.clientY, t: G.performance.now(), moved: 0 };
    S.ptr = { x: e.clientX, y: e.clientY, on: true, lx: e.clientX, ly: e.clientY };
    S.holdT = G.setTimeout(function () { if (S && S.down && S.down.moved < 12) { S.paused = true; S.el.classList.add("paused"); holdPause(); hap("light"); } }, 320);
  }
  function onMove(e) {
    if (!S || !S.ptr || !S.ptr.on) return;
    var dx = e.clientX - S.ptr.lx, dy = e.clientY - S.ptr.ly;
    S.ptr.x = e.clientX; S.ptr.y = e.clientY;
    if (S.down) S.down.moved += Math.abs(dx) + Math.abs(dy);
    // A light tick as the finger sweeps through the field, at most every 110 ms and every 28 px.
    if (Math.abs(e.clientX - S.ptr.lx) + Math.abs(e.clientY - S.ptr.ly) > 28) { S.ptr.lx = e.clientX; S.ptr.ly = e.clientY; var t = G.performance.now(); if (t - (S.sweep || 0) > 110) { S.sweep = t; hap("selection"); } }
  }
  function onUp(e) {
    if (!S) return;
    G.clearTimeout(S.holdT);
    var d = S.down; S.down = null; if (S.ptr) S.ptr.on = false;
    if (S.paused) { S.paused = false; S.el.classList.remove("paused"); holdResume(); return; }
    if (!d || d.moved > 14 || G.performance.now() - d.t > 600) return;
    if (e.target.closest && e.target.closest("button")) return;
    if (d.x < S.W * 0.3) prev(); else next();
  }
  function onKey(e) {
    if (!S) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === "Escape") end(true);
  }
  function onVis() {
    if (!S) return;
    if (D.hidden) { S.hidden = true; G.cancelAnimationFrame(S.raf); holdPause(); clearPattern(); }
    else if (S.hidden) { S.hidden = false; S.lt = 0; holdResume(); S.raf = G.requestAnimationFrame(frame); }
  }
  function onResize() { if (!S) return; size(); show(S.i); }
  function size() {
    var dpr = Math.min(2, G.devicePixelRatio || 1);
    S.W = G.innerWidth; S.H = G.innerHeight;
    S.cv.width = Math.round(S.W * dpr); S.cv.height = Math.round(S.H * dpr);
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function end(skipped) {
    if (!S) return;
    var s = S; S = null;
    G.cancelAnimationFrame(s.raf); G.clearTimeout(s.hold); G.clearTimeout(s.skipT); G.clearTimeout(s.holdT);
    (s.pt || []).forEach(function (x) { G.clearTimeout(x); });
    if (s.mascot) try { s.mascot.destroy(); } catch (e) {}
    G.removeEventListener("resize", onResize); D.removeEventListener("visibilitychange", onVis); D.removeEventListener("keydown", onKey, true);
    markSeen(s.track);
    if (!skipped) hap("success");
    s.el.style.transition = "opacity .5s ease, transform .6s cubic-bezier(.23,1,.32,1)"; s.el.style.opacity = "0"; if (!s.reduced) s.el.style.transform = "scale(1.04)";
    G.setTimeout(function () { if (s.el.parentNode) s.el.parentNode.removeChild(s.el); }, s.reduced ? 0 : 520);
    s.resolve({ done: !skipped, skipped: !!skipped, answers: s.answers, at: s.i });
  }

  function play(track) {
    track = track === "prep" ? "prep" : "clinician";
    if (S) return Promise.resolve({ done: false, skipped: true, busy: true, answers: {} });
    return new Promise(function (resolve) {
      if (!D.getElementById("smdStoryCss")) { var st = D.createElement("style"); st.id = "smdStoryCss"; st.textContent = CSS; D.head.appendChild(st); }
      var el = D.createElement("div"); el.id = "smdStory"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", track === "prep" ? "PrepNucleus introduction" : "StewardMD introduction");
      el.innerHTML = '<div class="ss-glow" aria-hidden="true"></div><canvas aria-hidden="true"></canvas>' +
        '<div class="ss-top"><div class="ss-bars" aria-hidden="true"></div><div class="ss-row"><p class="ss-hint" aria-hidden="true">Tap to continue. Hold to pause.</p><button type="button" class="ss-skip" data-ss="skip">Skip</button></div></div>' +
        '<div class="ss-text" aria-live="polite"></div><div class="ss-fill"></div><div class="ss-bot"></div>';
      D.body.appendChild(el);
      var small = Math.min(G.innerWidth, G.innerHeight) < 360;
      S = { track: track, el: el, cv: el.querySelector("canvas"), answers: {}, i: 0, gen: 0, N: small ? 1000 : 1600, reduced: reduced(), resolve: resolve, you: -1, pt: [], fc: 0, fsum: 0 };
      S.ctx = S.cv.getContext("2d");
      size(); S.P = initPoints(S.W, S.H);
      el.addEventListener("click", onClick);
      el.addEventListener("pointerdown", onDown); el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp);
      G.addEventListener("resize", onResize); D.addEventListener("visibilitychange", onVis); D.addEventListener("keydown", onKey, true);
      S.skipT = G.setTimeout(function () { var k = el.querySelector(".ss-skip"); if (k) k.classList.add("on"); }, 3000);
      S.raf = G.requestAnimationFrame(frame);
      show(0);
    });
  }

  /* ---------- first win: a renal dose on an example ---------- */
  var DEMO = { drug: "Piperacillin-Tazobactam", age: 70, wt: 60, scr: 2.0 };
  function demoDose() {
    return new Promise(function (resolve) {
      var R = G.SMD_RENAL_DOSE;
      if (!R || !R.open) return resolve(false);
      try { R.open(DEMO.drug); } catch (e) { return resolve(false); }
      var el = D.querySelector(".rd-scrim");
      if (!el) return resolve(false);
      var sheet = el.querySelector(".rd-sheet");
      var ban = D.createElement("div"); ban.className = "rd-demo"; ban.setAttribute("role", "note");
      ban.innerHTML = "<b>Example patient, not a real person.</b> 70 years, 60 kg, creatinine 2.0 mg/dL. See how the dose changes, then close this to continue.";
      ban.style.cssText = "margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#fdf2de;color:#6b4a07;border:1px solid #f0d49b;font-size:13.5px;line-height:1.45";
      var hd = sheet && sheet.querySelector(".rd-h");
      if (hd && hd.parentNode) hd.parentNode.insertBefore(ban, hd.nextSibling); else if (sheet) sheet.insertBefore(ban, sheet.firstChild);
      // The values type in one after another, with a tick each, so the doctor sees what changed.
      var steps = [["rdAge", DEMO.age], ["rdWt", DEMO.wt], ["rdScr", DEMO.scr]], red = reduced();
      steps.forEach(function (st, k) {
        G.setTimeout(function () {
          var inp = el.querySelector("#" + st[0]); if (!inp) return;
          inp.value = String(st[1]); try { inp.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
          hap(k === steps.length - 1 ? "success" : "selection");
        }, red ? 0 : 450 + k * 380);
      });
      var mo = new MutationObserver(function () { if (!el.isConnected) { mo.disconnect(); resolve(true); } });
      mo.observe(D.body, { childList: true });
    });
  }

  G.SMD_STORY = { enabled: enabled, seen: seen, play: play, demoDose: demoDose, playing: function () { return !!S; }, _pure: PURE, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
