/* PrepNucleus MaiK buddy: the MaiK companion (maik-companion.js) stands in the corner of a practice set and reacts to
   each answer. window.PREP_BUDDY. ES5.
   Owner 2026-11-20: "mascot to celebrate user if gets correct mcq or three in a row correct, motivate user, feel sad if
   wrong mcqs, more wrongs asking to prepare topic again". Tapping him opens a small quick-ask bubble (owner's pick)
   that hands the question to the existing Ask MaiK sheet (prep-ask.js) with the student's words filled in.
   - Practice only (study mode). A timed test or mock shows no answers, so he is not drawn there (he would give them away).
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
    slump: ["A few misses on {t}. Revise it and come back stronger?", "{t} needs a little more work. Revise it now?"],
    slumpNoT: ["A few misses in a row. Take a quick look at the topic?"],
    // No module screen to open (a deck, a paper, a topic not loaded): the same thought, for after the set.
    later: ["A few misses on {t}. Worth revising after this set."],
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
      return { kind: "slump", n: wrongRun, revise: true, say: t ? fill(pick(L.slump, rnd), { t: t }) : pick(L.slumpNoT, rnd),
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
  function lateNow(d) { var h = (d || new Date()).getHours(); return h >= 23 || h < 4; }
  var PURE = { decide: decide, doneLine: doneLine, lines: L, fill: fill, isMs: isMs, lateNow: lateNow };
  if (typeof document === "undefined") { G.PREP_BUDDY = { _pure: PURE }; return; }

  /* ================= DOM ================= */
  var D = document, S = { box: null, mk: null, run: null, host: null, bub: null, bubT: 0, lateSaid: false };
  function on() { try { return G.localStorage.getItem("smd_prep_buddy") !== "0"; } catch (e) { return true; } }
  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function styleOf() { var v = ""; try { v = G.localStorage.getItem("smd_maik_doc_style") || ""; } catch (e) {} return v === "oncall" || v === "bot" ? v : "attending"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // --pnb-lift: the height of the sticky Next bar when it is on screen (place()), so he stands on it, never over it.
  var CSS = "#pnBuddy{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:calc(var(--pnb-lift,0px) + 8px + var(--pnb-safe,env(safe-area-inset-bottom,0px)));width:150px;height:36px;z-index:886;pointer-events:none;transition:bottom .22s cubic-bezier(.23,1,.32,1)}" +
    "#pnBuddy .mkc{top:0}" +
    "#pnBuddy .mkc-tab{left:auto;right:0;bottom:2px;border-left:1px solid var(--pn-edge,#d5dde6);border-right:0;border-radius:10px 0 0 10px;pointer-events:auto}" +
    "body:has(#pnAsk) #pnBuddy,body:has(.pn-zoom) #pnBuddy{display:none}" +
    ".pnb-bub{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:calc(var(--pnb-lift,0px) + 76px + var(--pnb-safe,env(safe-area-inset-bottom,0px)));z-index:887;max-width:min(300px,calc(100vw - 24px));box-sizing:border-box;padding:10px 12px;border-radius:14px;" +
    "background:var(--pn-card,#fff);color:var(--pn-ink,#14202a);border:1px solid var(--pn-edge,#d5dde6);box-shadow:0 6px 24px rgba(8,19,26,.16);font:500 14.5px/1.4 Inter,system-ui,sans-serif;pointer-events:auto;" +
    "transform-origin:90% 100%;animation:pnb-in .22s cubic-bezier(.23,1,.32,1)}" +
    ".pnb-bub:after{content:'';position:absolute;right:30px;bottom:-6px;width:10px;height:10px;background:inherit;border-right:1px solid var(--pn-edge,#d5dde6);border-bottom:1px solid var(--pn-edge,#d5dde6);transform:rotate(45deg)}" +
    ".pnb-bub p{margin:0}" +
    ".pnb-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}" +
    ".pnb-row button{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--pn-edge,#d5dde6);background:transparent;color:inherit;font:600 14px/1 Inter,system-ui,sans-serif;cursor:pointer}" +
    ".pnb-row button.pri{background:var(--pn-acc,#0e6e63);border-color:transparent;color:#fff}" +
    ".pnb-chips{display:flex;flex-direction:column;gap:6px;margin-top:8px}" +
    ".pnb-chips button{min-height:44px;text-align:left;padding:0 12px;border-radius:12px;border:1px solid var(--pn-edge,#d5dde6);background:transparent;color:inherit;font:500 14px/1.2 Inter,system-ui,sans-serif;cursor:pointer}" +
    ".pnb-in{display:flex;gap:6px;margin-top:8px}" +
    ".pnb-in input{flex:1;min-width:0;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--pn-edge,#d5dde6);background:var(--pn-bg,#fff);color:inherit;font:16px/1.2 Inter,system-ui,sans-serif}" +
    ".pnb-in button{min-width:64px;min-height:44px;border-radius:12px;border:0;background:var(--pn-acc,#0e6e63);color:#fff;font:600 14px/1 Inter,system-ui,sans-serif}" +
    "body.dark .pnb-bub{background:#16222b;color:#e8eef2;border-color:#2a3a46}" +
    "body.dark .pnb-bub:after,body.dark .pnb-row button,body.dark .pnb-chips button{border-color:#2a3a46}" +
    "body.dark .pnb-in input{background:#0e171d;border-color:#2a3a46;color:#e8eef2}" +
    "body.dark .pnb-in input::placeholder{color:#8a9aa5}" +
    "#pnBuddy,.pnb-bub{transition:bottom .22s cubic-bezier(.23,1,.32,1)}" +
    ".pn-root.pnb-on .pn-run{padding-bottom:calc(64px + env(safe-area-inset-bottom,0px))}" +
    "@keyframes pnb-in{from{opacity:0;transform:translateY(6px) scale(.96)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion: reduce){.pnb-bub{animation:none}#pnBuddy,.pnb-bub{transition:none}}";
  function css() { if (D.getElementById("pnb-css")) return; var s = D.createElement("style"); s.id = "pnb-css"; s.textContent = CSS; (D.head || D.documentElement).appendChild(s); }

  function mount() {
    if (S.box) return true;
    var MC = G.MaiKCompanion; if (!MC || !MC.mount) return false;
    css();
    var box = D.createElement("div"); box.id = "pnBuddy"; D.body.appendChild(box); S.box = box;
    try {
      S.mk = MC.mount(box, { style: styleOf(), reduceMotion: reduced(), greet: false, hideKey: "smd_prep_buddy_off", sleepMs: 60000, onTap: quickAsk });
    } catch (e) { S.mk = null; }
    if (!S.mk) { box.remove(); S.box = null; return false; }
    return true;
  }
  function unmount() {
    bubble(null);
    if (S.mk) { try { S.mk.destroy(); } catch (e) {} S.mk = null; }
    if (S.box && S.box.parentNode) S.box.parentNode.removeChild(S.box);
    S.box = null;
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
  function hiddenByUser() { try { return G.localStorage.getItem("smd_prep_buddy_off") === "1"; } catch (e) { return false; } }
  function cue(kind, n) { if (S.mk) try { S.mk.cue("quiz", { kind: kind, n: n }); } catch (e) {} }

  /* bubble(html, life, onClick): one bubble at a time; life 0 = stays until tapped away or replaced. */
  function bubble(html, life, onClick) {
    G.clearTimeout(S.bubT);
    if (S.bub && S.bub.parentNode) S.bub.parentNode.removeChild(S.bub);
    S.bub = null;
    if (!html || !S.box || hiddenByUser()) return null;
    var b = D.createElement("div"); b.className = "pnb-bub"; b.setAttribute("role", "status"); b.innerHTML = html;
    D.body.appendChild(b); S.bub = b;
    if (onClick) b.addEventListener("click", onClick);
    if (life) S.bubT = G.setTimeout(function () { if (S.bub === b) bubble(null); }, life);
    return b;
  }
  function say(text, life) { if (text) bubble("<p>" + esc(text) + "</p>", life || 3400); }

  /* sync(run, host): called after every PrepNucleus paint with the run when the set's own screen is on top, else null. */
  function sync(r, host) {
    if (host) S.host = host;
    var want = !!(r && on() && r.mode === "study" && r.items && r.items.length);
    if (!want) { if (S.box) unmount(); S.run = null; return; }
    if (S.run !== r) { bubble(null); S.run = r; }
    if (!mount()) return;
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
      var b = bubble("<p>" + esc(d.say) + '</p><div class="pnb-row"><button type="button" class="pri" data-b="rev">Revise topic</button><button type="button" data-b="go">Keep going</button></div>', 0, function (e) {
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
  }
  /* Tap: a small quick-ask bubble about the question on screen. Chips or a typed line open the Ask MaiK sheet for this
     question with the words filled in (prep-ask.js does the asking, on the phone or online, with its own rules). */
  function quickAsk() {
    if (S.bub && S.bub.querySelector(".pnb-in")) { bubble(null); return; }
    var r = S.run, it = r && r.items[r.i]; if (!it || !S.host || !S.host.buddyAsk) return;
    var shown = r.ans[r.i] >= 0, chips = shown ? ["Explain this simply", "Why are the others wrong?", "Give me a memory trick"] : ["Give me a hint", "What is this question testing?"];
    var b = bubble("<p>Ask MaiK about this question</p>" +
      '<div class="pnb-chips">' + chips.map(function (c) { return '<button type="button" data-q="' + esc(c) + '">' + esc(c) + "</button>"; }).join("") + "</div>" +
      '<form class="pnb-in"><input type="text" enterkeyhint="send" aria-label="Your question" placeholder="Or type a question"><button type="submit">Ask</button></form>', 0, function (e) {
      var c = e.target && e.target.closest && e.target.closest("[data-q]"); if (c) go(c.getAttribute("data-q"));
    });
    if (!b) return;
    var form = b.querySelector("form");
    form.addEventListener("submit", function (e) { e.preventDefault(); var v = String(form.querySelector("input").value || "").trim(); if (v) go(v); });
    function go(q) { bubble(null); try { S.host.buddyAsk(r, q); } catch (x) {} }
  }
  function leave() { unmount(); S.run = null; }
  // A tap outside the bubble (not on him) closes it; Escape too.
  D.addEventListener("pointerdown", function (e) { if (S.bub && !S.bub.contains(e.target) && !(S.box && S.box.contains(e.target))) bubble(null); }, true);
  D.addEventListener("keydown", function (e) { if (S.bub && e.key === "Escape") bubble(null); });
  // The Next bar sticks or unsticks as the set's page scrolls.
  D.addEventListener("scroll", placeSoon, true);
  G.addEventListener("resize", placeSoon);

  G.PREP_BUDDY = { sync: sync, answered: answered, finished: finished, leave: leave, quickAsk: quickAsk, _pure: PURE, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
