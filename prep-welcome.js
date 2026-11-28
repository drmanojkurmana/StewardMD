/* PrepNucleus welcome (prep-welcome.js, owner 2026-11-28): the first win after the plan onboarding. window.PREP_WELCOME.
   ES5. Part of the onboarding story work (onboard-story.js); same flag smd_onboard_story, default OFF ("1" or ?story=1).
   After the last plan step (prep-plan.js finishOnboard, not on Skip) one screen offers:
     - a 5-question warm-up, one question from each of up to 5 of the plan's subjects, in Learning Mode, so the
       readiness score has real answers to start from (prep-plan.js counts them through noteAnswer);
     - Focus setup when PrepNucleus Focus is on (prep-focus.js): block distracting apps (native SmdFocus plugin present)
       or open Focus (no plugin: a timer only);
     - "Later", which goes to Home.
   Shown once per device (smd_prep_welcome_seen). prep.js forwards data-act "wl-" here. Pure helpers under node. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  /* ================= pure ================= */
  // Pick up to n [subjectId, moduleId] pairs, one per subject first, from indexes { sid: { topics: [{ id, count }] } }.
  // A subject without questions is skipped; short of n subjects, more modules come from the subjects that have them.
  function pickPairs(subjects, ixs, n, rnd) {
    rnd = rnd || Math.random;
    var lists = subjects.map(function (sid) {
      var t = ((ixs[sid] || {}).topics || []).filter(function (x) { return (x.count || 0) > 0; }).map(function (x) { return x.id; });
      for (var i = t.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), k = t[i]; t[i] = t[j]; t[j] = k; }
      return { s: sid, mods: t };
    }).filter(function (x) { return x.mods.length; });
    var out = [], round = 0;
    while (out.length < n && lists.some(function (l) { return l.mods.length > round; })) {
      for (var q = 0; q < lists.length && out.length < n; q++) if (lists[q].mods[round]) out.push({ s: lists[q].s, m: lists[q].mods[round] });
      round++;
    }
    return out;
  }
  // From loaded modules [{ s, m, items }], n questions, one per module in turn, then more from the same modules.
  function pickItems(lists, n) {
    var out = [], used = {}, round = 0, more = true;
    while (out.length < n && more) {
      more = false;
      for (var i = 0; i < lists.length && out.length < n; i++) {
        var it = (lists[i].items || [])[round];
        if (it) { more = true; if (!used[it.id]) { used[it.id] = 1; out.push(it); } }
      }
      round++;
    }
    return out;
  }
  var PURE = { pickPairs: pickPairs, pickItems: pickItems };
  if (NODE) { module.exports = PURE; return; }

  /* ================= app ================= */
  function on() {
    try {
      var q = (G.location.search.match(/[?&]story=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem("smd_onboard_story") === "1";
    } catch (e) { return false; }
  }
  var KEY = "smd_prep_welcome_seen", H = null, N = 5;
  function seen() { try { return G.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function mark() { try { G.localStorage.setItem(KEY, "1"); } catch (e) {} }
  function focusRow() {
    var F = G.PREP_FOCUS; if (!F) return "";
    var nat = F.nativeAvailable && F.nativeAvailable();
    return H.row("wl-focus", H.ico("clock"), nat ? "Block distracting apps while you study" : "Try a focus session",
      nat ? "Pick the apps once. They stay blocked only while a session runs." : "A timer that counts the questions you answer");
  }
  function render() {
    H.paint('<div class="pn-sky" aria-hidden="true"></div>' + H.bar("PrepNucleus", "", "close") +
      '<div class="pn-body pl-ob wl-body"><h2 class="pl-q" id="wlQ" tabindex="-1">Your plan is ready.</h2>' +
      '<p class="pn-mut">Start with a ' + N + "-question warm-up across your subjects. Your readiness score starts from these answers.</p>" +
      '<button type="button" class="pn-btn pri wl-go" data-act="wl-warm">' + H.ico("play") + " Start the warm-up</button>" +
      (G.PREP_FOCUS ? '<div class="pn-group wl-more">' + focusRow() + "</div>" : "") +
      '<button type="button" class="pn-link wl-later" data-act="wl-later">Later</button></div>', "#wlQ");
  }
  function warmUp() {
    var subs = (H.planSubjects ? H.planSubjects() : []).map(function (s) { return s.id || s; });
    if (!subs.length) subs = H.subjectsOf(H.exam().id).map(function (s) { return s.id; });
    subs = subs.slice(0, 12);
    H.loadingScreen("Warm-up", "Loading questions…");
    Promise.all(subs.map(function (sid) { return H.loadIndex(sid).then(function (ix) { return [sid, ix]; }, function () { return [sid, null]; }); })).then(function (rows) {
      var ixs = {}; rows.forEach(function (r) { if (r[1]) ixs[r[0]] = r[1]; });
      var pairs = pickPairs(subs, ixs, N);
      return H.loadMany(pairs, H.stepMsg);
    }).then(function (lists) {
      var exam = H.exam().id, hid = H.hidden ? H.hidden() : {};
      lists.forEach(function (l) { l.items = H.poolFor ? H.poolFor(l.items || [], exam, hid) : (l.items || []); l.items = H.shuffle ? H.shuffle(l.items) : l.items; });
      var items = pickItems(lists, N);
      if (!items.length) { H.toast("Questions need a connection. Try the warm-up from Home later."); return home(); }
      var stk = H.stack(); stk.length = 0; stk.push(H.home);
      H.run(items, "study", "Warm-up");
    }, function () { H.toast("Questions need a connection. Try the warm-up from Home later."); home(); });
  }
  function home() { var stk = H.stack(); stk.length = 0; stk.push(H.home); H.home(); }
  function act(a, b, h) {
    H = h;
    if (a === "wl-warm") { try { G.SMD_HAPTICS && G.SMD_HAPTICS.medium(); } catch (e) {} return warmUp(); }
    if (a === "wl-later") return home();
    if (a === "wl-focus") {
      var F = G.PREP_FOCUS; if (!F) return home();
      home();
      if (F.nativeAvailable && F.nativeAvailable()) return F.setup(H);
      return F.open(H);
    }
  }
  // Called by prep-plan.js after the last plan step. Returns true when the screen took over.
  function open(h) {
    H = h;
    if (!on() || seen()) return false;
    mark();
    var stk = H.stack(); stk.length = 0; stk.push(H.home); stk.push(render);
    render();
    return true;
  }
  G.PREP_WELCOME = { open: open, act: act, on: on, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
