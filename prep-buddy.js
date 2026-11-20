/* PrepNucleus buddy: Nucleo (prep-mascot.js, default since 2026-11-20 "create new mascot to suit prepnucleus"), or with
   smd_prep_mascot = "maik" the MaiK companion (maik-companion.js), stands in the corner of a practice set and reacts to
   each answer. window.PREP_BUDDY. ES5.
   Owner 2026-11-20: "mascot to celebrate user if gets correct mcq or three in a row correct, motivate user, feel sad if
   wrong mcqs, more wrongs asking to prepare topic again". Tapping him opens a small quick-ask bubble (owner's pick)
   that hands the question to the existing Ask MaiK sheet (prep-ask.js) with the student's words filled in.
   - Practice sets, and timed tests (2026-11-20, "get tensed, turn red when time is almost up"): in a test he reacts only
     to the clock (tension(), buddyClock), never to answers, and tapping him asks nothing (no help in a test). An untimed
     test or mock has nothing for him, so he is not drawn there.
   - He does not speak on every answer: a right answer gets a line about one time in three, milestones and misses more.
   - A slump (3 wrong in a row, or 3 wrong in one topic in this set) offers "Revise topic" (opens that topic's module,
     back returns to the set) or "Keep going". Once per topic per set.
   - Flag smd_prep_buddy: default ON, "0" off. Swipe him left to hide him (kept in smd_prep_buddy_off; MaiK unaffected).
   - Decorative motion respects reduced motion (the companion stands still). The bubble is role="status".
   Pure helpers (decide, lines) load under node for tests. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var L = {
    right: ["Spot on.", "Nicely done.", "Correct. Keep going.", "That's the one.", "Sharp thinking.", "Right again. Good."],
    fast: ["Quick and correct.", "Fast and right. Nice."],
    streak3: ["Three in a row!", "Three straight. You're warming up."],
    streak5: ["Five in a row! Exam form.", "Five straight. Keep the rhythm."],
    streakN: ["{n} in a row. Outstanding.", "{n} straight. You own this topic."],
    back: ["There you go. Back on track.", "That's the comeback.", "Back on form. Keep going."],
    wrong: ["Not this time. Read why, it will stick.", "Close one. The explanation is worth a look.",
      "A miss now saves marks later.", "Every miss teaches something. Keep going."],
    slump: ["{t} is tripping you up. Revise it now?", "{t} needs another look. Revise it now?"],
    slumpNoT: ["A few misses in a row. Take a quick look at the topic?"],
    // No module screen to open (a deck, a paper, a topic not loaded): the same thought, for after the set.
    later: ["{t} needs another look. Revise it after this set."],
    laterNoT: ["A few misses in a row. Worth a look at the topic after this set."],
    hi80: ["Excellent set, {p}%.", "{p}%. Superb work."],
    hi50: ["Good work, {p}%. Review the misses once.", "{p}%. Solid. Go over the misses."],
    lo: ["Tough set, {p}%. Revise the misses and try again.", "{p}% this time. Revise, then retry. You'll get there."],
    perfect: ["Every one right. Brilliant."],
    late: ["Late study session. Short breaks help it stick."]
  };
  function fill(s, o) { return String(s).replace(/\{(\w)\}/g, function (m, k) { return o && o[k] != null ? o[k] : ""; }); }
  function pick(list, rnd) { return list[Math.min(list.length - 1, Math.floor((rnd == null ? Math.random() : rnd) * list.length))]; }
  function modOf(it) { return it ? String((it._s || "") + "|" + (it._m || it.t || "")) : ""; }
  function isMs(n) { return n === 3 || n === 5 || (n >= 10 && n % 10 === 0); }
  /* decide(r, i, o) -> { kind, n, say, revise } or null, for the answer just given at index i.
     r: { items, ans, buddy? } (buddy is this set's memory: said count, revised topics). o: { rnd, ms, topic }. */
  function decide(r, i, o) {
    o = o || {};
    var items = r.items || [], ans = r.ans || [], it = items[i];
    if (!it || !(ans[i] >= 0)) return null;
    var mem = r.buddy || (r.buddy = { rv: {}, quiet: 0 }), rnd = o.rnd == null ? Math.random() : o.rnd;
    var ok = ans[i] === it.a, k, rightRun = 0, wrongRun = 0;
    for (k = i; k >= 0 && ans[k] >= 0 && ans[k] === items[k].a; k--) rightRun++;
    for (k = i; k >= 0 && ans[k] >= 0 && ans[k] !== items[k].a; k--) wrongRun++;
    if (ok) {
      // Misses just before this one: the comeback.
      var before = 0;
      for (k = i - 1; k >= 0 && ans[k] >= 0 && ans[k] !== items[k].a; k--) before++;
      if (before >= 2) return { kind: "back", say: pick(L.back, rnd) };
      if (isMs(rightRun)) return { kind: "streak", n: rightRun, say: fill(pick(rightRun === 3 ? L.streak3 : rightRun === 5 ? L.streak5 : L.streakN, rnd), { n: rightRun }) };
      // A plain right answer speaks about one time in three (never twice running), else only the body says it.
      var talk = mem.quiet >= 2 || (mem.quiet >= 1 && rnd < 0.34);
      mem.quiet = talk ? 0 : mem.quiet + 1;
      return { kind: "right", say: talk ? (o.ms > 0 && o.ms < 8000 ? pick(L.fast, rnd) : pick(L.right, rnd)) : "" };
    }
    // Wrong: a topic slump first (once per topic per set), else a plain miss.
    var m = modOf(it), inMod = 0;
    for (k = 0; k <= i; k++) if (ans[k] >= 0 && ans[k] !== items[k].a && modOf(items[k]) === m) inMod++;
    if ((wrongRun >= 3 || inMod >= 3) && m !== "|" && !mem.rv[m]) {
      mem.rv[m] = 1;
      var t = String(o.topic || "").trim();
      return { kind: "slump", n: wrongRun, revise: true, topic: t, say: t ? fill(pick(L.slump, rnd), { t: t }) : pick(L.slumpNoT, rnd),
        later: t ? fill(pick(L.later, rnd), { t: t }) : pick(L.laterNoT, rnd) };
    }
    // A miss speaks on the first of a run and then every other one, so a bad patch is not a lecture.
    return { kind: "wrong", say: wrongRun === 1 || wrongRun % 2 === 0 ? pick(L.wrong, rnd) : "" };
  }
  /* doneLine(ok, n, rnd) -> { kind, n (percent), say } for a finished practice set (5 or more answered). */
  function doneLine(ok, n, rnd) {
    if (!n) return null;
    var p = Math.round(ok * 100 / n);
    if (ok === n && n >= 5) return { kind: "perfect", n: 100, say: pick(L.perfect, rnd) };
    return { kind: "done", n: p, say: fill(pick(p >= 80 ? L.hi80 : p >= 50 ? L.hi50 : L.lo, rnd), { p: p }) };
  }
  /* tension(left, total, perQ) -> 0 calm, 1 tense, 2 panic, for the clock on screen (seconds).
     A clock per question (perQ): tense at 30% left (5 to 15 s), panic at 12% (3 to 5 s); 60 s a question = 15 s / 5 s.
     The whole test: tense in the last 10% (30 s to 5 min), panic in the last 3% (10 s to 1 min); 1 hour = 5 min / 1 min. */
  function tension(left, total, perQ) {
    if (!(total > 0) || left == null || !isFinite(left)) return 0;
    if (left <= 0) return 2;
    var t1 = perQ ? Math.max(5, Math.min(15, total * 0.3)) : Math.max(30, Math.min(300, total * 0.1));
    var t2 = perQ ? Math.max(3, Math.min(5, total * 0.12)) : Math.max(10, Math.min(60, total * 0.03));
    return left <= t2 ? 2 : left <= t1 ? 1 : 0;
  }
  function lateNow(d) { var h = (d || new Date()).getHours(); return h >= 23 || h < 4; }
  var PURE = { decide: decide, doneLine: doneLine, lines: L, fill: fill, isMs: isMs, lateNow: lateNow, tension: tension };
  if (typeof document === "undefined") { G.PREP_BUDDY = { _pure: PURE }; return; }

  /* ================= DOM ================= */
  var D = document, S = { box: null, mk: null, run: null, host: null, bub: null, bubT: 0, lateSaid: false, tick: 0, lvl: 0, lvlI: -1, lastI: -1, booms: {}, panicSaid: false };
  function on() { try { return G.localStorage.getItem("smd_prep_buddy") !== "0"; } catch (e) { return true; } }
  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  // Which character: "nucleo" (prep-mascot.js, PrepNucleus's own, default) or "maik" (the MaiK companion). smd_prep_mascot.
  function charOf() { var v = ""; try { v = G.localStorage.getItem("smd_prep_mascot") || ""; } catch (e) {} return v === "maik" || !G.PREP_MASCOT ? "maik" : "nucleo"; }
  function styleOf() { var v = ""; try { v = G.localStorage.getItem("smd_maik_doc_style") || ""; } catch (e) {} return v === "oncall" || v === "bot" ? v : "attending"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // --pnb-lift: the height of the sticky Next bar when it is on screen (place()), so he stands on it, never over it.
  var CSS = "#pnBuddy{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:calc(var(--pnb-lift,0px) + 8px + var(--pnb-safe,env(safe-area-inset-bottom,0px)));width:150px;height:36px;z-index:886;pointer-events:none;transition:bottom .22s cubic-bezier(.23,1,.32,1)}" +
    "#pnBuddy .mkc{top:0}" +
    "#pnBuddy.pnb-nuc{width:64px;height:76px}" +
    "body.pnb-nucleo .pn-root.pnb-on > .pn-body{padding-bottom:calc(100px + env(safe-area-inset-bottom,0px))}" +
    "#pnBuddy .mkc-tab{left:auto;right:0;bottom:2px;border-left:1px solid var(--pn-edge,#d5dde6);border-right:0;border-radius:10px 0 0 10px;pointer-events:auto}" +
    "body:has(#pnAsk) #pnBuddy,body:has(.pn-zoom) #pnBuddy{display:none}" +
    /* The bubble lives on <body> (the set repaints #smdPrep), so it carries PrepNucleus's own tokens copied from the root
       (tokens()): the same card, ink, hairline, radii and springs as the screen behind it, light and dark. */
    ".pnb-bub{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:calc(var(--pnb-lift,0px) + 76px + var(--pnb-safe,env(safe-area-inset-bottom,0px)));z-index:887;" +
    "width:max-content;max-width:min(288px,calc(100vw - 24px));box-sizing:border-box;padding:14px 16px;border-radius:var(--pn-r-lg,16px);" +
    "background:var(--pn-card,#fff);color:var(--pn-text,#13203d);border:1px solid var(--pn-edge,#e3e1da);" +
    "box-shadow:0 1px 2px rgba(19,32,61,.08),0 18px 40px -16px rgba(19,32,61,.38);" +
    "font:400 15px/1.45 var(--sans,-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif);letter-spacing:-.005em;-webkit-font-smoothing:antialiased;pointer-events:auto;" +
    "transform-origin:calc(100% - var(--pnb-tail,32px)) calc(100% + 8px);animation:pnb-in var(--pn-d-enter,280ms) var(--pn-ease,cubic-bezier(.23,1,.32,1)) both}" +
    ".pnb-bub.out{animation:pnb-out .14s ease-in forwards;pointer-events:none}" +
    "body.dark .pnb-bub{box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 22px 44px -14px rgba(0,0,0,.7)}" +
    // the tail: a rotated square in the card's own fill and hairline, aimed at the mascot's centre (--pnb-tail)
    ".pnb-bub:after{content:'';position:absolute;right:calc(var(--pnb-tail,32px) - 6px);bottom:-6.5px;width:11px;height:11px;background:inherit;border:solid var(--pn-edge,#e3e1da);border-width:0 1px 1px 0;border-bottom-right-radius:3px;transform:rotate(45deg)}" +
    ".pnb-bub p{margin:0;text-wrap:pretty}.pnb-bub b{font-weight:650}" +
    ".pnb-bub :focus{outline:none}.pnb-bub :focus-visible{outline:2px solid var(--pn-pri,#0f3460);outline-offset:2px}" +
    // slump: one tonal primary, a quiet text secondary
    ".pnb-row{display:flex;align-items:center;gap:4px;margin:12px -6px -6px 0}" +
    ".pnb-row button{min-height:44px;padding:0 16px;border:0;border-radius:var(--pn-r-md,12px);font-weight:600;font-size:15px;line-height:1;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color var(--pn-d-press,120ms) ease,transform var(--pn-d-press,120ms) var(--pn-ease,ease)}" +
    ".pnb-row button.pri{background:var(--pn-pri-soft,#e4eaf3);color:var(--pn-pri-ink,#0f3460)}" +
    ".pnb-row button.txt{background:none;color:var(--pn-mut,#556079);font-weight:550}" +
    ".pnb-row button:active{transform:scale(.97)}.pnb-row button.txt:active{background:var(--pn-s1,#ebe9e3)}" +
    // quick ask: a title, the suggestions as one hairline-divided list, and one field with a send button inside it
    ".pnb-ask{width:min(288px,calc(100vw - 24px));padding:14px 16px 12px}" +
    ".pnb-ask .pnb-t{font-weight:650}" +
    ".pnb-list{margin:8px -16px 0;border-top:1px solid var(--pn-line,#e9e7e1)}" +
    ".pnb-list button{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;padding:0 14px 0 16px;border:0;border-bottom:1px solid var(--pn-line,#e9e7e1);background:none;color:inherit;font-weight:500;font-size:15px;line-height:1.25;font-family:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    ".pnb-list button span{flex:1}.pnb-list button svg{flex:0 0 auto;color:var(--pn-mut2,#6f7890)}" +
    ".pnb-list button:active{background:var(--pn-s1,#ebe9e3)}" +
    ".pnb-endb{padding-bottom:0}.pnb-endb .pnb-list button:last-child{border-bottom:0;border-radius:0 0 calc(var(--pn-r-lg,16px) - 1px) calc(var(--pn-r-lg,16px) - 1px)}" +
    ".pnb-in{display:flex;align-items:center;gap:4px;margin-top:12px;padding:4px 4px 4px 12px;border-radius:var(--pn-r-md,12px);background:var(--pn-s1,#ebe9e3);border:1px solid transparent;transition:border-color var(--pn-d-quick,180ms) ease}" +
    ".pnb-in:focus-within{border-color:var(--pn-edge,#e3e1da)}" +
    ".pnb-in input{flex:1;min-width:0;height:36px;padding:0;border:0;background:none;color:inherit;font-size:16px;line-height:1.2;font-family:inherit;caret-color:var(--pn-fill,#efc07b)}" +
    ".pnb-in input::placeholder{color:var(--pn-mut2,#6f7890)}.pnb-in input:focus-visible{outline:none}" +
    ".pnb-in button{flex:0 0 auto;display:grid;place-items:center;width:40px;height:40px;border:0;border-radius:10px;background:var(--pn-fill,#efc07b);color:var(--pn-on-fill,#1a1a2e);cursor:pointer;transition:opacity var(--pn-d-quick,180ms) ease,transform var(--pn-d-press,120ms) var(--pn-ease,ease)}" +
    ".pnb-in button:disabled{background:transparent;color:var(--pn-mut2,#6f7890);cursor:default}.pnb-in button:not(:disabled):active{transform:scale(.94)}" +
    "body.pnb-nucleo .pnb-bub{bottom:calc(var(--pnb-lift,0px) + 92px + var(--pnb-safe,env(safe-area-inset-bottom,0px)))}" +
    "#pnBuddy,.pnb-bub{transition:bottom .22s cubic-bezier(.23,1,.32,1)}" +
    ".pn-root.pnb-on > .pn-body{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))}" +
    "@keyframes pnb-in{from{opacity:0;transform:translateY(8px) scale(.9)}to{opacity:1;transform:none}}" +
    "@keyframes pnb-out{to{opacity:0;transform:translateY(4px) scale(.97)}}" +
    "@media (prefers-reduced-motion: reduce){.pnb-bub,.pnb-bub.out{animation:none}#pnBuddy,.pnb-bub{transition:none}}";
  function css() { if (D.getElementById("pnb-css")) return; var s = D.createElement("style"); s.id = "pnb-css"; s.textContent = CSS; (D.head || D.documentElement).appendChild(s); }

  function mount() {
    if (S.box) return true;
    var who = charOf(), MC = who === "nucleo" ? G.PREP_MASCOT : G.MaiKCompanion; if (!MC || !MC.mount) return false;
    css();
    var box = D.createElement("div"); box.id = "pnBuddy"; if (who === "nucleo") box.className = "pnb-nuc"; D.body.appendChild(box); S.box = box;
    D.body.classList.toggle("pnb-nucleo", who === "nucleo");
    try {
      S.mk = MC.mount(box, { style: styleOf(), reduceMotion: reduced(), greet: false, hideKey: "smd_prep_buddy_off", sleepMs: 60000, onTap: quickAsk });
    } catch (e) { S.mk = null; }
    if (!S.mk) { box.remove(); S.box = null; return false; }
    return true;
  }
  function unmount() {
    bubble(null); clockOn(false); S.lvl = 0;
    if (S.mk) { try { S.mk.destroy(); } catch (e) {} S.mk = null; }
    if (S.box && S.box.parentNode) S.box.parentNode.removeChild(S.box);
    S.box = null;
    D.body.classList.remove("pnb-nucleo");
    try { D.documentElement.style.removeProperty("--pnb-lift"); D.documentElement.style.removeProperty("--pnb-safe"); } catch (e) {}
    var rt = S.host && S.host.root && S.host.root(); if (rt) rt.classList.remove("pnb-on");
  }
  /* place(): the sticky Next bar (prep.css: .pn-fb + .pn-navrow, sticky at the bottom once answered) carries its own
     safe-area padding. While it sits on the bottom edge he stands on top of it; otherwise on the screen's bottom edge. */
  var placeRaf = 0;
  function place() {
    placeRaf = 0;
    if (!S.box) return;
    var rt = S.host && S.host.root && S.host.root(), bar = rt && rt.querySelector(".pn-qw > .pn-fb + .pn-navrow"), lift = 0;
    if (bar) {
      var r = bar.getBoundingClientRect(), z = (rt.offsetWidth ? rt.getBoundingClientRect().width / rt.offsetWidth : 1) || 1;
      if (r.height && r.bottom >= G.innerHeight - 4) lift = Math.max(0, Math.round((G.innerHeight - r.top) / z));
    }
    var v = lift ? lift + "px" : "0px", st = D.documentElement.style;
    if (st.getPropertyValue("--pnb-lift") !== v) { st.setProperty("--pnb-lift", v); st.setProperty("--pnb-safe", lift ? "0px" : "env(safe-area-inset-bottom,0px)"); }
  }
  function placeSoon() { if (S.box && !placeRaf) placeRaf = G.requestAnimationFrame(place); }
  function timed(r) { return !!(r && (r.limit || r.qsec)); }
  /* The clock, read twice a second while a timed set is on screen: tension changes are cues; reaching 0 in panic is the
     time-up moment, once a question (a clock per question) or once a test. */
  function clockOn(on) {
    if (on && !S.tick) S.tick = G.setInterval(clockTick, 500);
    else if (!on && S.tick) { G.clearInterval(S.tick); S.tick = 0; if (S.lvl) { S.lvl = 0; cue("tense", 0); } }
  }
  function clockTick() {
    var r = S.run; if (!r || !S.mk || !S.host || !S.host.buddyClock) return;
    if (r.done) return clockOn(false);
    var c = null; try { c = S.host.buddyClock(r); } catch (e) {}
    var key = c && c.perQ ? r.i : "all";
    if (S.lvlI !== key) { S.lvlI = key; if (S.lvl) { S.lvl = 0; cue("tense", 0); } }
    var n = c ? tension(c.left, c.total, c.perQ) : 0;
    if (c && c.left <= 0) {
      if (!S.booms[key]) { S.booms[key] = 1; cue("timeout"); S.lvl = 0; }
      return;
    }
    if (n !== S.lvl) {
      S.lvl = n; cue("tense", n);
      // One word in the whole set's last stretch (not per question: that would be every few seconds).
      if (n === 2 && !c.perQ && !S.panicSaid) { S.panicSaid = true; say(r.mode === "study" ? "Clock's almost out. Trust your first read." : "Last minute. Answer what you know, skip the rest.", 3200); }
    }
  }
  function hiddenByUser() { try { return G.localStorage.getItem("smd_prep_buddy_off") === "1"; } catch (e) { return false; } }
  // Every cue goes to the character as cue("quiz", { kind, n }); the MaiK companion ignores the kinds it does not know.
  function cue(kind, n) { if (S.mk) try { S.mk.cue("quiz", { kind: kind, n: n }); } catch (e) {} }

  /* bubble(html, life, onClick): one bubble at a time; life 0 = stays until tapped away or replaced. */
  // PrepNucleus tokens the bubble needs, read from the root (theme-correct, dark included) onto the bubble.
  var TOK = ["--pn-card", "--pn-text", "--pn-mut", "--pn-mut2", "--pn-edge", "--pn-line", "--pn-s1", "--pn-pri", "--pn-pri-soft", "--pn-pri-ink",
    "--pn-fill", "--pn-on-fill", "--pn-r-md", "--pn-r-lg", "--pn-ease", "--pn-d-enter", "--pn-d-press", "--pn-d-quick"];
  function tokens(b) {
    var rt = S.host && S.host.root && S.host.root(); if (!rt) return;
    try { var cs = G.getComputedStyle(rt); TOK.forEach(function (k) { var v = cs.getPropertyValue(k).trim(); if (v) b.style.setProperty(k, v); }); } catch (e) {}
  }
  // The tail points at the mascot's middle, wherever he stands (the MaiK companion walks; Nucleo stays put).
  function aim(b) {
    try {
      // Layout sizes, not getBoundingClientRect: the bubble is mid-entrance (scaled) when this runs.
      var who = S.box && (S.box.querySelector(".pnm-hit") || S.box.querySelector(".mkc-a")), w = b.offsetWidth;
      if (!who || !w) return;
      var right = D.documentElement.clientWidth - (parseFloat(G.getComputedStyle(b).right) || 0);
      var r = who.getBoundingClientRect(), off = right - (r.left + r.width / 2);
      b.style.setProperty("--pnb-tail", Math.round(Math.max(22, Math.min(w - 22, off))) + "px");
    } catch (e) {}
  }
  function drop(b) {
    if (!b || !b.parentNode) return;
    if (S.mk && S.mk.hold) try { S.mk.hold(false); } catch (e) {}
    if (reduced()) { b.parentNode.removeChild(b); return; }
    b.classList.add("out");
    G.setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 160);
  }
  function bubble(html, life, onClick, cls) {
    G.clearTimeout(S.bubT);
    drop(S.bub);
    S.bub = null;
    if (!html || !S.box || hiddenByUser()) return null;
    var b = D.createElement("div"); b.className = "pnb-bub" + (cls ? " " + cls : ""); b.setAttribute("role", "status"); b.innerHTML = html;
    tokens(b);
    D.body.appendChild(b); S.bub = b;
    if (S.mk && S.mk.hold) try { S.mk.hold(true); } catch (e) {}
    aim(b);
    if (onClick) b.addEventListener("click", onClick);
    if (life) S.bubT = G.setTimeout(function () { if (S.bub === b) bubble(null); }, life);
    return b;
  }
  function say(text, life) { if (text) bubble("<p>" + esc(text) + "</p>", life || 3400); }

  /* sync(run, host): called after every PrepNucleus paint with the run when the set's own screen is on top, else null. */
  function sync(r, host) {
    if (host) S.host = host;
    // Practice sets, and timed tests too: in a test he never reacts to answers (they are hidden), only to the clock.
    var want = !!(r && on() && r.items && r.items.length && !r.done && (r.mode === "study" || timed(r))) || !!(r && r.done && S.run === r && S.box);
    if (!want) { if (S.box) unmount(); S.run = null; return; }
    if (S.run !== r) { bubble(null); S.run = r; S.lvl = 0; S.lvlI = -1; S.lastI = r.i; S.booms = {}; S.panicSaid = false; }
    if (!mount()) return;
    if (r.i !== S.lastI) { S.lastI = r.i; if (!r.done) cue("newq"); }
    clockOn(timed(r) && !r.done);
    var rt = S.host && S.host.root && S.host.root(); if (rt) rt.classList.add("pnb-on");
    place();
    if (!S.lateSaid && lateNow()) { S.lateSaid = true; G.setTimeout(function () { if (S.run === r && !S.bub) say(pick(L.late), 4200); }, 900); }
  }
  /* answered(r): after an answer in practice. */
  function answered(r) {
    if (!S.mk || r !== S.run || r.mode !== "study") return;
    var it = r.items[r.i], topic = "";
    try { topic = S.host && S.host.buddyTopic ? S.host.buddyTopic(it) : ""; } catch (e) {}
    var d = decide(r, r.i, { ms: Date.now() - (r.qt0 || r.t0 || Date.now()), topic: topic });
    if (!d) return;
    cue(d.kind, d.n);
    var canRev = false; try { canRev = !!(d.revise && S.host && S.host.buddyCanRevise && S.host.buddyCanRevise(it)); } catch (e) {}
    if (d.revise && !canRev) { say(d.later, 4600); return; }
    if (canRev) {
      var line = esc(d.say); if (d.topic) line = line.replace(esc(d.topic), "<b>" + esc(d.topic) + "</b>");
      var b = bubble("<p>" + line + '</p><div class="pnb-row"><button type="button" class="pri" data-b="rev">Revise topic</button><button type="button" class="txt" data-b="go">Keep going</button></div>', 0, function (e) {
        var t = e.target && e.target.closest && e.target.closest("[data-b]"); if (!t) return;
        bubble(null);
        if (t.getAttribute("data-b") === "rev") { try { S.host.buddyRevise(it); } catch (x) {} }
        else cue("back");
      });
      if (b) { var f = b.querySelector("button"); try { f.focus({ preventScroll: true }); } catch (x) {} }
      return;
    }
    if (d.say) say(d.say, d.kind === "streak" ? 3000 : 3400);
  }
  /* finished(r): the practice set is done. Speaks once, over the result. */
  function finished(r) {
    if (!S.mk || r !== S.run || r.mode !== "study" || r.buddyDone) return;
    var ok = 0, n = 0;
    r.items.forEach(function (it, i) { if (r.ans[i] >= 0) { n++; if (r.ans[i] === it.a) ok++; } });
    if (n < 5) return;
    r.buddyDone = true;
    var d = doneLine(ok, n);
    // A perfect set already plays "You are the boss" (prep.js perfectCele); he bows under it and keeps quiet.
    G.setTimeout(function () { cue(d.kind, d.n); if (d.kind !== "perfect") say(d.say, 4200); }, d.kind === "perfect" ? 1600 : 500);
    // A tough set: after the thought, a fist pump. Then a nudge that he has ideas for what next.
    if (d.kind === "done" && d.n < 50) G.setTimeout(function () { if (S.run === r) cue("pep"); }, 3600);
    G.setTimeout(function () { if (S.run === r && !S.bub) cue("beckon"); }, 5200);
  }
  /* Tap: a small quick-ask bubble about the question on screen. Chips or a typed line open the Ask MaiK sheet for this
     question with the words filled in (prep-ask.js does the asking, on the phone or online, with its own rules). */
  function quickAsk() {
    if (S.bub && (S.bub.querySelector(".pnb-in") || S.bub.querySelector(".pnb-end"))) { bubble(null); return; }
    if (S.run && S.run.done) return endAsk();
    var r = S.run, it = r && r.items[r.i]; if (!it || !S.host || !S.host.buddyAsk || r.mode !== "study") return;
    var shown = r.ans[r.i] >= 0, chips = shown ? ["Explain this simply", "Why are the others wrong?", "Give me a memory trick"] : ["Give me a hint", "What is this question testing?"];
    var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    var SEND = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    var b = bubble('<p class="pnb-t">Ask MaiK about this question</p>' +
      '<div class="pnb-list">' + chips.map(function (c) { return '<button type="button" data-q="' + esc(c) + '"><span>' + esc(c) + "</span>" + CHEV + "</button>"; }).join("") + "</div>" +
      '<form class="pnb-in"><input type="text" enterkeyhint="send" aria-label="Your question" placeholder="Or type your own"><button type="submit" aria-label="Ask MaiK" disabled>' + SEND + "</button></form>", 0, function (e) {
      var c = e.target && e.target.closest && e.target.closest("[data-q]"); if (c) go(c.getAttribute("data-q"));
    }, "pnb-ask");
    if (!b) return;
    var form = b.querySelector("form"), inp = form.querySelector("input"), sendB = form.querySelector("button");
    inp.addEventListener("input", function () { sendB.disabled = !String(inp.value || "").trim(); });
    form.addEventListener("submit", function (e) { e.preventDefault(); var v = String(form.querySelector("input").value || "").trim(); if (v) go(v); });
    function go(q) { bubble(null); try { S.host.buddyAsk(r, q); } catch (x) {} }
  }
  /* After the set: what next, from this set's own result (practise the missed, ask MaiK what the misses share, revise
     the topic most of them came from, show the mistakes). The words above say where the set stands. */
  function endAsk() {
    var r = S.run, acts = []; try { acts = S.host && S.host.buddyEnd ? S.host.buddyEnd(r) : []; } catch (e) {}
    if (!acts.length) return;
    var ok = 0, n = 0; r.items.forEach(function (it, i) { if (it._gone) return; n++; if (r.ans[i] === it.a) ok++; });
    var miss = n - ok, head = !miss ? "Every one right. What next?" : ok * 2 >= n ? "Nice. Let's fix the " + miss + " you missed." : "Let's turn the " + miss + " misses around.";
    var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    bubble('<p class="pnb-t">' + esc(head) + '</p><div class="pnb-list pnb-end">' + acts.map(function (a) { return '<button type="button" data-e="' + esc(a[0]) + '"><span>' + esc(a[1]) + "</span>" + CHEV + "</button>"; }).join("") + "</div>", 0, function (e) {
      var b = e.target && e.target.closest && e.target.closest("[data-e]"); if (!b) return;
      bubble(null); cue("right");
      try { S.host.buddyEndDo(r, b.getAttribute("data-e")); } catch (x) {}
    }, "pnb-ask pnb-endb");
  }
  function leave() { unmount(); S.run = null; }
  // A tap outside the bubble (not on him) closes it; Escape too.
  D.addEventListener("pointerdown", function (e) { if (S.bub && !S.bub.contains(e.target) && !(S.box && S.box.contains(e.target))) bubble(null); }, true);
  D.addEventListener("keydown", function (e) { if (S.bub && e.key === "Escape") bubble(null); });
  // Light/dark switched while a bubble is open: it takes the new theme's tokens.
  try { new G.MutationObserver(function () { if (S.bub) tokens(S.bub); }).observe(D.body, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
  // The Next bar sticks or unsticks as the set's page scrolls.
  D.addEventListener("scroll", placeSoon, true);
  G.addEventListener("resize", placeSoon);

  G.PREP_BUDDY = { sync: sync, answered: answered, finished: finished, leave: leave, quickAsk: quickAsk, _pure: PURE, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
