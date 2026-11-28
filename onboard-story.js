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
   API: SMD_STORY.enabled(), seen(track), play(track) -> Promise<{ done, skipped, answers }>. Pure helpers under node. */
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
  // The scene list of a track. answers: { patients, hours }. Each scene: { id, lines, sub?, shape, pal, hap, ask?, hold?, cta? }.
  var STATS = { prepAppeared: 230114, prepSeats: 52244, src: "NBEMS result notice (Aug 2025) and NMC seat matrix (Nov 2025)" };
  function scenes(track, a) {
    a = a || {};
    if (track === "prep") {
      var h = a.hours || 3, mo = monthsFrom(h);
      return [
        { id: "crowd", lines: ["<em>" + fmtIN(STATS.prepAppeared) + "</em>\u00a0doctors sat NEET-PG 2025."], count: STATS.prepAppeared, shape: "crowd", pal: "night", hap: "heavy", hold: 3200, src: "Source: NBEMS result notice, Aug 2025" },
        { id: "seats", lines: ["<em>" + fmtIN(STATS.prepSeats) + "</em>\u00a0PG seats.", "Roughly one for every four or five."], shape: "seats", pal: "night", hap: "medium", hold: 3400, src: "Source: NMC seat matrix for 2025 counselling" },
        { id: "phone", lines: ["How many hours a day does your phone take?"], shape: "phone", pal: "night", ask: { key: "hours", opts: [[1, "1 hour"], [3, "3 hours"], [5, "5 hours"], [7, "7 or more"]] } },
        { id: "months", lines: ["<em>" + h + (h === 1 ? " hour" : " hours") + "</em> a day is <em>" + mo + " months</em> a year.", "Time you can take back."], shape: "calendar", months: mo, pal: "amber", hap: "warning", hold: 3600 },
        { id: "turn", lines: ["PrepNucleus turns that time into practice."], shape: "logo-prep", pal: "prussian", hap: "success", hold: 2800 },
        { id: "adapt", lines: ["Questions that adapt to what you miss."], shape: "target", pal: "prussian", hap: "medium", hold: 2400 },
        { id: "focus", lines: ["A focus timer that keeps distractions out."], shape: "lock", pal: "prussian", hap: "medium", hold: 2400 },
        { id: "plan", lines: ["A plan that counts down to your exam."], shape: "check", pal: "prussian", hap: "medium", hold: 2400 },
        { id: "go", lines: ["Let's build your plan."], shape: "logo-prep", pal: "prussian", hap: "success", cta: "Build my plan" }
      ];
    }
    var n = a.patients || 25, d = n * 4;
    return [
      { id: "ward", lines: ["Every shift starts with patients.", "How many do you see on a typical day?"], shape: "ward", wardN: 40, pal: "night", ask: { key: "patients", opts: [[10, "About 10"], [25, "About 25"], [50, "About 50"], [100, "100 or more"]] } },
      { id: "ward2", lines: ["<em>" + n + "</em> patients today."], shape: "ward", wardN: n, pal: "night", hap: "heavy", hold: 2200 },
      { id: "decide", lines: ["At four decisions each, that is <em>" + fmtIN(d) + "</em>.", "Doses, interactions, antibiotics, renal adjustments, scores."], count: d, shape: "clusters", wardN: n, pal: "night", hap: "heavy", hold: 3600 },
      { id: "hunt", lines: ["Most of them get looked up.", "Across apps, books and memory."], shape: "phone", pal: "grey", hap: "warning", hold: 3000 },
      { id: "turn", lines: ["One place for all of them."], shape: "logo-smd", pal: "teal", hap: "success", hold: 2600 },
      { id: "dose", lines: ["Doses, adjusted for the kidney."], shape: "pill", pal: "teal", hap: "medium", hold: 2300 },
      { id: "abx", lines: ["Antibiotics, from your hospital's own antibiogram."], shape: "bug", pal: "teal", hap: "medium", hold: 2500 },
      { id: "icu", lines: ["ICU, Code Blue and the ward, on one screen."], shape: "wave", pal: "teal", hap: "medium", hold: 2500 },
      { id: "go", lines: ["Let's show you around."], shape: "logo-smd", pal: "teal", hap: "success", cta: "Start the tour" }
    ];
  }
  var PURE = { fmtIN: fmtIN, monthsFrom: monthsFrom, limiter: limiter, sampleMask: sampleMask, scenes: scenes, STATS: STATS };
  if (NODE) { module.exports = PURE; return; }

  /* ================= app ================= */
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

  // Palettes: background, then point colours [main, accent, dim].
  var PAL = {
    night: { bg: "#0b1016", c: ["#e9eef3", "#efc07b", "#3a4552"] },
    grey: { bg: "#0f1317", c: ["#7b8794", "#9aa5b1", "#2b333c"] },
    amber: { bg: "#17120a", c: ["#efc07b", "#f6d7a6", "#4a3d2c"] },
    teal: { bg: "#06231f", c: ["#e6f4f1", "#4fd1bf", "#1d4a44"] },
    prussian: { bg: "#0f2240", c: ["#f5f3ee", "#efc07b", "#2a3d63"] }
  };

  var CSS = "#smdStory{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;color:#f5f3ee;background:#0b1016;transition:background-color .9s ease;--ss-f:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif;font-family:var(--ss-f);-webkit-user-select:none;user-select:none;touch-action:manipulation}" +
    "#smdStory canvas{position:absolute;inset:0;width:100%;height:100%}" +
    "#smdStory .ss-top{position:relative;display:flex;justify-content:flex-end;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 0;min-height:52px}" +
    "#smdStory .ss-skip{min-height:44px;padding:0 14px;border:0;border-radius:22px;background:rgba(255,255,255,.1);color:inherit;font:600 15px/1 var(--ss-f);opacity:0;pointer-events:none;transition:opacity .4s ease}" +
    "#smdStory .ss-skip.on{opacity:1;pointer-events:auto}" +
    "#smdStory .ss-text{position:relative;padding:8px 28px 0;text-align:center;min-height:120px}" +
    "#smdStory .ss-l{margin:0 auto 6px;max-width:30ch;font:700 clamp(21px,6vw,27px)/1.28 var(--ss-f);letter-spacing:-.015em;opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .6s cubic-bezier(.23,1,.32,1)}" +
    "#smdStory .ss-l + .ss-l{font-weight:500;font-size:clamp(16px,4.4vw,19px);opacity:0;color:rgba(245,243,238,.72)}" +
    "#smdStory .ss-l.in{opacity:1;transform:none}#smdStory .ss-l + .ss-l.in{opacity:1}" +
    "#smdStory .ss-l em{font-style:normal;color:var(--ss-acc,#efc07b);font-variant-numeric:tabular-nums}" +
    "#smdStory .ss-fill{flex:1 1 auto}" +
    "#smdStory .ss-bot{position:relative;display:flex;flex-direction:column;gap:10px;padding:0 20px calc(env(safe-area-inset-bottom,0px) + 18px)}" +
    "#smdStory .ss-src{margin:0;text-align:center;font-size:12px;color:rgba(245,243,238,.55)}" +
    "#smdStory .ss-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
    "#smdStory .ss-opt{min-height:52px;border-radius:16px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:inherit;font:600 16px/1.2 var(--ss-f);transition:background-color .2s ease,transform .15s ease}" +
    "#smdStory .ss-opt:active{transform:scale(.97)}#smdStory .ss-opt.on{background:#f5f3ee;color:#0b1016;border-color:#f5f3ee}" +
    "#smdStory .ss-cta{min-height:56px;border:0;border-radius:18px;background:#f5f3ee;color:#0b1016;font:700 17px/1 var(--ss-f)}" +
    "#smdStory .ss-dots{display:flex;justify-content:center;gap:6px;padding-top:4px}#smdStory .ss-dots i{width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.25);transition:width .3s ease,background-color .3s ease}#smdStory .ss-dots i.on{width:18px;background:rgba(255,255,255,.85)}" +
    "#smdStory .ss-l:focus{outline:none}#smdStory :focus-visible{outline:2px solid #efc07b;outline-offset:2px}" +
    "@media (prefers-reduced-motion:reduce){#smdStory,#smdStory .ss-l{transition:none}}";

  var S = null; // the running story

  /* ---------- shapes: draw on an offscreen canvas, sample the alpha ---------- */
  var IMG = {};
  function loadImg(src) {
    if (IMG[src]) return IMG[src];
    IMG[src] = new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
    return IMG[src];
  }
  // Region the shape lives in (CSS px): the middle of the screen between the text and the buttons.
  function region(W, H) { var top = H * 0.30, bot = H * 0.78, size = Math.min(W * 0.84, bot - top); return { cx: W / 2, cy: (top + bot) / 2, s: size }; }
  function drawShape(name, sc, W, H, img) {
    var c = D.createElement("canvas"); c.width = Math.ceil(W); c.height = Math.ceil(H);
    var x = c.getContext("2d"), R = region(W, H), s = R.s, cx = R.cx, cy = R.cy, i, j;
    x.fillStyle = "#fff"; x.strokeStyle = "#fff"; x.lineCap = "round"; x.lineJoin = "round";
    function dot(px, py, r) { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); }
    if (name === "ward" || name === "clusters") {
      var n = Math.max(1, Math.min(sc.wardN || 25, 100)), cols = Math.ceil(Math.sqrt(n * 1.3)), rows = Math.ceil(n / cols), g = s / Math.max(cols, rows);
      for (i = 0; i < n; i++) {
        var gx = cx - (cols - 1) * g / 2 + (i % cols) * g, gy = cy - (rows - 1) * g / 2 + Math.floor(i / cols) * g;
        if (name === "ward") dot(gx, gy, g * 0.26);
        else for (j = 0; j < 4; j++) dot(gx + Math.cos(j * Math.PI / 2 + .6) * g * .2, gy + Math.sin(j * Math.PI / 2 + .6) * g * .2, g * 0.11);
      }
    } else if (name === "crowd" || name === "seats") {
      for (i = 0; i < 1600; i++) { var a = i * 2.39996, rr = Math.sqrt(i / 1600) * s * 0.5; dot(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92, 2.2); }
    } else if (name === "phone") {
      var pw = s * 0.42, ph = s * 0.78; x.lineWidth = 5; roundRect(x, cx - pw / 2, cy - ph / 2, pw, ph, 26); x.stroke();
      var r2 = rng(11);
      for (i = 0; i < 14; i++) { var ix = cx + (r2() - .5) * s * 0.95, iy = cy + (r2() - .5) * s * 0.95; if (Math.abs(ix - cx) < pw / 2 + 14 && Math.abs(iy - cy) < ph / 2 + 14) continue; roundRect(x, ix - 13, iy - 13, 26, 26, 7); x.fill(); }
    } else if (name === "calendar") {
      var cw = s / 4, chh = s / 3.4;
      for (i = 0; i < 12; i++) { var mx = cx - 1.5 * cw + (i % 4) * cw, my = cy - chh + Math.floor(i / 4) * chh; for (j = 0; j < 30; j++) dot(mx - cw * .34 + (j % 6) * cw * .136, my - chh * .3 + Math.floor(j / 6) * chh * .15, 2.4); }
    } else if (name === "pill") {
      x.save(); x.translate(cx, cy); x.rotate(-0.6); roundRect(x, -s * .36, -s * .14, s * .72, s * .28, s * .14); x.fill(); x.restore();
    } else if (name === "bug") {
      x.beginPath(); x.ellipse(cx, cy, s * .2, s * .3, 0, 0, Math.PI * 2); x.fill(); x.lineWidth = 6;
      for (i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(cx - s * .18, cy + i * s * .14); x.lineTo(cx - s * .38, cy + i * s * .2); x.moveTo(cx + s * .18, cy + i * s * .14); x.lineTo(cx + s * .38, cy + i * s * .2); x.stroke(); }
    } else if (name === "wave") {
      x.lineWidth = 9; x.beginPath(); var L = cx - s * .48;
      x.moveTo(L, cy); x.lineTo(L + s * .3, cy); x.lineTo(L + s * .36, cy - s * .08); x.lineTo(L + s * .42, cy); x.lineTo(L + s * .48, cy + s * .05); x.lineTo(L + s * .54, cy - s * .38); x.lineTo(L + s * .61, cy + s * .2); x.lineTo(L + s * .67, cy); x.lineTo(L + s * .96, cy); x.stroke();
    } else if (name === "target") {
      x.lineWidth = 7; for (i = 1; i <= 3; i++) { x.beginPath(); x.arc(cx, cy, s * .14 * i, 0, Math.PI * 2); x.stroke(); } dot(cx, cy, s * .05);
    } else if (name === "lock") {
      roundRect(x, cx - s * .26, cy - s * .04, s * .52, s * .4, 18); x.fill(); x.lineWidth = s * .07; x.beginPath(); x.arc(cx, cy - s * .04, s * .17, Math.PI, 0); x.stroke();
    } else if (name === "check") {
      x.lineWidth = 8; x.beginPath(); x.arc(cx, cy, s * .38, 0, Math.PI * 2); x.stroke(); x.lineWidth = 14; x.beginPath(); x.moveTo(cx - s * .17, cy); x.lineTo(cx - s * .04, cy + s * .14); x.lineTo(cx + s * .2, cy - s * .13); x.stroke();
    } else if (img) {
      var k = s * 0.8; x.drawImage(img, cx - k / 2, cy - k / 2, k, k);
    }
    var d = x.getImageData(0, 0, c.width, c.height).data, al = new Uint8Array(c.width * c.height);
    for (i = 0; i < al.length; i++) al[i] = d[i * 4 + 3];
    return { alpha: al, w: c.width, h: c.height };
  }
  function roundRect(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
  // Point targets and colour index per point for a scene.
  function targetsFor(sc, W, H) {
    var name = sc.shape, src = name === "logo-smd" ? "/mark-white.png" : name === "logo-prep" ? "/prepnucleus-logo.png" : null;
    return Promise.resolve(src ? loadImg(src) : null).then(function (img) {
      var m = drawShape(name, sc, W, H, img), N = S.N, step = name === "crowd" || name === "seats" || name === "calendar" ? 2 : 3;
      var pts = sampleMask(m.alpha, m.w, m.h, step, N, 1 + sc.id.length), col = new Array(N), R = region(W, H);
      if (!pts.length) for (var z = 0; z < N; z++) pts.push([R.cx, R.cy]);
      for (var i = 0; i < N; i++) col[i] = 0;
      if (name === "seats") {          // about 23% of the crowd stays bright (seats / appeared), the rest dims
        var keep = STATS.prepSeats / STATS.prepAppeared;
        for (i = 0; i < N; i++) col[i] = (i / N) < keep ? 0 : 2;
      } else if (name === "calendar") { // highlighted months, left to right, top to bottom
        var mo = Math.min(12, sc.months || 0), cw = R.s / 4, chh = R.s / 3.4;
        for (i = 0; i < N; i++) { var p = pts[i], ci = Math.max(0, Math.min(3, Math.round((p[0] - (R.cx - 1.5 * cw)) / cw))), ri = Math.max(0, Math.min(2, Math.round((p[1] - (R.cy - chh)) / chh))); var mi = ri * 4 + ci, part = (p[0] - (R.cx - 1.5 * cw - cw * .4)) / (cw * .8); col[i] = mi < Math.floor(mo) || (mi === Math.floor(mo) && part < mo - Math.floor(mo)) ? 1 : 2; }
      } else if (name === "phone") {
        for (i = 0; i < N; i++) col[i] = i % 5 === 0 ? 2 : 0;
      }
      if (name === "crowd" || name === "seats") { var you = Math.floor(N * 0.11); col[you] = 1; S.you = you; } else S.you = -1;
      return { pts: pts, col: col };
    });
  }

  /* ---------- the particle field ---------- */
  function initPoints(W, H) {
    var r = rng(99), P = [];
    for (var i = 0; i < S.N; i++) P.push({ x: r() * W, y: r() * H, vx: 0, vy: 0, tx: r() * W, ty: r() * H, c: 2, j: r() * 6.28 });
    return P;
  }
  function frame(t) {
    if (!S) return;
    S.raf = G.requestAnimationFrame(frame);
    var dt = Math.min(2.5, (t - (S.lt || t)) / 16.67); S.lt = t;
    var ctx = S.ctx, W = S.W, H = S.H, P = S.P, pal = PAL[S.pal] || PAL.night, k = 0.055 * dt, damp = Math.pow(0.8, dt), mo = S.reduced;
    ctx.clearRect(0, 0, W, H);
    var buckets = [[], [], []];
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (mo) { p.x = p.tx; p.y = p.ty; }
      else {
        p.vx = (p.vx + (p.tx - p.x) * k) * damp; p.vy = (p.vy + (p.ty - p.y) * k) * damp;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      buckets[p.c].push(p);
    }
    var breathe = mo ? 0 : 0.6;
    for (var b = 0; b < 3; b++) {
      ctx.fillStyle = pal.c[b]; ctx.beginPath();
      var sz = b === 1 ? 2.6 : 2;
      for (var q = 0; q < buckets[b].length; q++) { var o = buckets[b][q], wob = breathe * Math.sin(t / 900 + o.j); ctx.rect(o.x + wob - sz / 2, o.y - wob - sz / 2, sz, sz); }
      ctx.fill();
    }
    if (S.you >= 0 && P[S.you]) { var y = P[S.you]; ctx.fillStyle = pal.c[1]; ctx.beginPath(); ctx.arc(y.x, y.y, 5, 0, 6.283); ctx.fill(); ctx.font = "600 13px -apple-system,Segoe UI,Roboto,sans-serif"; ctx.textAlign = "center"; ctx.fillText("You", y.x, y.y - 12); }
    // Count-up: selection ticks while the number climbs.
    if (S.count) {
      var c = S.count, f = Math.min(1, (t - c.t0) / c.ms), v = Math.round(c.to * (1 - Math.pow(1 - f, 3)));
      if (c.el) c.el.textContent = fmtIN(v);
      if (f < 1) { if (S.tick(t)) hap("selection"); } else { S.count = null; hap("heavy"); }
    }
  }

  /* ---------- scenes ---------- */
  function show(i) {
    if (!S) return;
    G.clearTimeout(S.hold);
    var list = scenes(S.track, S.answers), sc = list[i];
    if (!sc) return end(false);
    S.i = i; S.sc = sc; S.pal = sc.pal;
    S.el.style.backgroundColor = (PAL[sc.pal] || PAL.night).bg;
    S.el.style.setProperty("--ss-acc", (PAL[sc.pal] || PAL.night).c[1]);
    // Text: lines rise in one after another.
    var tx = S.el.querySelector(".ss-text");
    tx.innerHTML = sc.lines.map(function (l) { return '<p class="ss-l">' + l + "</p>"; }).join("");
    var ls = tx.querySelectorAll(".ss-l");
    for (var k = 0; k < ls.length; k++) (function (el, d) { G.setTimeout(function () { el.classList.add("in"); }, S.reduced ? 0 : d); })(ls[k], 80 + k * 650);
    try { tx.querySelector(".ss-l").setAttribute("tabindex", "-1"); tx.querySelector(".ss-l").focus({ preventScroll: true }); } catch (e) {}
    // Bottom: source, answers or the call to action, progress dots.
    var bot = "";
    if (sc.src) bot += '<p class="ss-src">' + sc.src + "</p>";
    if (sc.ask) bot += '<div class="ss-opts" role="group" aria-label="' + sc.lines[sc.lines.length - 1].replace(/<[^>]+>/g, "") + '">' + sc.ask.opts.map(function (o) { return '<button type="button" class="ss-opt" data-ss="ans" data-v="' + o[0] + '">' + o[1] + "</button>"; }).join("") + "</div>";
    if (sc.cta) bot += '<button type="button" class="ss-cta" data-ss="done">' + sc.cta + "</button>";
    bot += '<div class="ss-dots" aria-hidden="true">' + list.map(function (x, j) { return "<i" + (j === i ? ' class="on"' : "") + "></i>"; }).join("") + "</div>";
    S.el.querySelector(".ss-bot").innerHTML = bot;
    // Shape.
    var my = ++S.gen;
    targetsFor(sc, S.W, S.H).then(function (tg) {
      if (!S || S.gen !== my) return;
      var r = rng(5 + i);
      for (var q = 0; q < S.P.length; q++) { var p = S.P[q], t = tg.pts[q]; p.tx = t[0] + (r() - .5) * 1.4; p.ty = t[1] + (r() - .5) * 1.4; p.c = tg.col[q]; }
      G.setTimeout(function () { if (S && S.gen === my && sc.hap && !sc.count) hap(sc.hap); }, S.reduced ? 0 : 450);
      if (sc.count) { var em = tx.querySelector("em"); S.count = { to: sc.count, t0: G.performance.now(), ms: S.reduced ? 1 : 1600, el: em }; }
    });
    if (sc.hold) S.hold = G.setTimeout(function () { next(); }, sc.hold);
  }
  function next() { if (S && S.sc && !S.sc.ask && !S.sc.cta) show(S.i + 1); }
  function onTap(e) {
    var b = e.target.closest && e.target.closest("[data-ss]");
    if (!b) { if (!e.target.closest(".ss-top")) next(); return; }
    var a = b.getAttribute("data-ss");
    if (a === "skip") return end(true);
    if (a === "done") return end(false);
    if (a === "ans") {
      var v = Number(b.getAttribute("data-v")); S.answers[S.sc.ask.key] = v;
      var all = S.el.querySelectorAll(".ss-opt"); for (var i = 0; i < all.length; i++) all[i].classList.remove("on");
      b.classList.add("on"); hap("light");
      G.setTimeout(function () { show(S.i + 1); }, 320);
    }
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
    G.cancelAnimationFrame(s.raf); G.clearTimeout(s.hold); G.clearTimeout(s.skipT);
    G.removeEventListener("resize", onResize);
    markSeen(s.track);
    if (!skipped) hap("success");
    s.el.style.transition = "opacity .45s ease"; s.el.style.opacity = "0";
    G.setTimeout(function () { if (s.el.parentNode) s.el.parentNode.removeChild(s.el); }, s.reduced ? 0 : 460);
    try { if (G.SMD_TOUR && G.SMD_TOUR.emit) G.SMD_TOUR.emit(skipped ? "story_skipped" : "story_done", { track: s.track, at: s.i }); } catch (e) {}
    s.resolve({ done: !skipped, skipped: !!skipped, answers: s.answers, at: s.i });
  }

  function play(track) {
    track = track === "prep" ? "prep" : "clinician";
    if (S) return Promise.resolve({ done: false, skipped: true, busy: true, answers: {} });
    return new Promise(function (resolve) {
      if (!D.getElementById("smdStoryCss")) { var st = D.createElement("style"); st.id = "smdStoryCss"; st.textContent = CSS; D.head.appendChild(st); }
      var el = D.createElement("div"); el.id = "smdStory"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", track === "prep" ? "PrepNucleus introduction" : "StewardMD introduction");
      el.innerHTML = '<canvas aria-hidden="true"></canvas><div class="ss-top"><button type="button" class="ss-skip" data-ss="skip">Skip</button></div><div class="ss-text" aria-live="polite"></div><div class="ss-fill"></div><div class="ss-bot"></div>';
      D.body.appendChild(el);
      var small = Math.min(G.innerWidth, G.innerHeight) < 360;
      S = { track: track, el: el, cv: el.querySelector("canvas"), answers: {}, i: 0, gen: 0, N: small ? 900 : 1400, reduced: reduced(), tick: limiter(90), resolve: resolve, you: -1 };
      S.ctx = S.cv.getContext("2d");
      size(); S.P = initPoints(S.W, S.H);
      el.addEventListener("click", onTap);
      G.addEventListener("resize", onResize);
      S.skipT = G.setTimeout(function () { var k = el.querySelector(".ss-skip"); if (k) k.classList.add("on"); }, 3000);
      S.raf = G.requestAnimationFrame(frame);
      show(0);
    });
  }

  G.SMD_STORY = { enabled: enabled, seen: seen, play: play, playing: function () { return !!S; }, _pure: PURE, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
