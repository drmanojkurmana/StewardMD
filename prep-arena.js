/* PrepNucleus Arena client and My stats: window.PREP_ARENA. ES5. Loaded by prep-loader.js after prep.js and drawn
   through PREP._host (the same overlay, back stack, runner and store). Plan: vault/plans/PrepNucleus-Arena.md.

   Flag smd_prep_arena: default ON (owner 2026-10-06). localStorage smd_prep_arena = "0" or ?arena=0 turns it off.
   With it off the home has no Compete section and nothing here calls the network; My stats (practice on this phone)
   works either way.

   Server: /api/prep/arena/* (Bearer Firebase ID token on every call) and the battle WebSocket at SMD_PREP_ARENA_WS
   (token in Sec-WebSocket-Protocol: "smd-arena", <token>). Event items arrive without keys; the key comes back only
   with the marked submit, and in a battle only in each round's result. Pure helpers load under node for tests. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  function enabled(search, get) {
    try { var q = (String(search || "").match(/[?&]arena=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return get("smd_prep_arena") !== "0"; } catch (e) { return true; }
  }
  // Server times may be seconds or milliseconds; everything here works in milliseconds.
  function ms(t) { t = Number(t); return !isFinite(t) || t <= 0 ? 0 : t < 1e12 ? t * 1000 : t; }
  // One event as the client uses it, from either snake_case (D1 rows) or camelCase fields.
  function normEvent(e) {
    if (!e || !e.id) return null;
    // entry: the caller's state from the server, null | "started" | "submitted".
    return { id: String(e.id), kind: e.kind === "weekly" ? "weekly" : "daily", exam: e.exam || "", start: ms(e.starts_at != null ? e.starts_at : e.startsAt),
      end: ms(e.ends_at != null ? e.ends_at : e.endsAt), n: Number(e.n) || 0, secs: Number(e.secs) || 0, done: e.entry === "submitted", started: e.entry === "started" };
  }
  // GET events answers { events: [{ role, id, kind, startsAt, endsAt, n, secs, status, entry }] } (current and next per
  // kind); { daily, weekly } is read too.
  function eventsFrom(j) {
    var raw = [];
    if (j && j.events) raw = [].concat(j.events);
    else if (j) ["daily", "weekly", "current", "next"].forEach(function (k) { if (j[k]) raw = raw.concat(j[k]); });
    return raw.map(normEvent).filter(Boolean);
  }
  function phase(ev, now) { return !ev ? "none" : now < ev.start ? "soon" : now < ev.end ? "live" : "closed"; }
  // The event of a kind to show: the live one, else the soonest coming one.
  function pickEvent(events, kind, now) {
    var live = null, soon = null;
    (events || []).forEach(function (e) {
      if (e.kind !== kind) return;
      var p = phase(e, now);
      if (p === "live" && (!live || e.end < live.end)) live = e;
      if (p === "soon" && (!soon || e.start < soon.start)) soon = e;
    });
    return live || soon;
  }
  // 3725000 -> "1:02:05"; 65000 -> "1:05"; 2 days and more -> "2 d 4 h".
  function countdown(msLeft) {
    var s = Math.max(0, Math.floor(msLeft / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    if (d >= 1) return d + " d " + h + " h";
    var two = function (v) { return (v < 10 ? "0" : "") + v; };
    return h ? h + ":" + two(m) + ":" + two(x) : m + ":" + two(x);
  }
  function eventLine(ev, now) {
    var p = phase(ev, now);
    if (p === "none") return "No event scheduled";
    if (ev.done) return "Submitted. See the leaderboard";
    if (ev.started && p === "live") return "In progress, ends in " + countdown(ev.end - now);
    if (p === "soon") return "Starts in " + countdown(ev.start - now);
    if (p === "live") return "Live now, ends in " + countdown(ev.end - now);
    return "Closed";
  }
  // Attempts per day for the last n days, oldest first; days is the store's { dayNum: count }.
  function lastDays(days, today, n) { var out = []; for (var i = n - 1; i >= 0; i--) out.push(Number((days || {})[today - i]) || 0); return out; }
  // Share right per subject from the per-module tallies (store.mod), weakest first; resolve(moduleId) -> subject id.
  function accuracyBySubject(mod, resolve) {
    var by = {};
    Object.keys(mod || {}).forEach(function (m) {
      var x = mod[m], sid = resolve(m); if (!sid || !x || !x.t) return;
      var b = by[sid] || (by[sid] = { sid: sid, t: 0, ok: 0 }); b.t += x.t; b.ok += x.ok || 0;
    });
    return Object.keys(by).map(function (k) { var b = by[k]; b.pct = Math.round(b.ok * 100 / b.t); return b; })
      .sort(function (a, b) { return a.pct - b.pct || b.t - a.t || (a.sid < b.sid ? -1 : 1); });
  }
  /* heatWeeks(days, today, weeks) -> [{ d, n }] in columns of Monday to Sunday, oldest week first, ending with this
     week; days after today carry n = -1. dayNum 0 (1970-01-01) was a Thursday, so (d + 3) % 7 is 0 on a Monday. */
  function heatWeeks(days, today, weeks) {
    var start = today - (today + 3) % 7 - 7 * (weeks - 1), out = [];
    for (var d = start; d < start + 7 * weeks; d++) out.push({ d: d, n: d > today ? -1 : Number((days || {})[d]) || 0 });
    return out;
  }
  function heatLevel(n) { return n <= 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4; }
  // The longest run of consecutive study days in the store.
  function bestStreak(days) {
    var ks = Object.keys(days || {}).filter(function (k) { return days[k] > 0; }).map(Number).sort(function (a, b) { return a - b; }), best = 0, run = 0;
    ks.forEach(function (d, i) { run = i && d === ks[i - 1] + 1 ? run + 1 : 1; if (run > best) best = run; });
    return best;
  }
  function signed(n) { n = Math.round(Number(n) || 0); return (n > 0 ? "+" : n < 0 ? "minus " : "") + Math.abs(n); }
  // The answers map an event submit sends: { itemId: optionIndex } for answered items only.
  function answersOf(items, ans) { var out = {}; items.forEach(function (it, i) { if (ans[i] >= 0) out[it.id] = ans[i]; }); return out; }

  /* Battle state from the server's messages (protocol in the plan). Unknown or malformed messages leave it unchanged.
     phase: queue (connecting or waiting) -> match -> q (a question) -> r (its result) -> ... -> end; or nobody, or lost
     (the socket closed before the end). */
  function battleNew() { return { phase: "queue", waiting: false, opp: null, n: 7, secs: 20, i: -1, q: "", o: [], deadline: 0, got: 0, pick: -1, a: -1, you: null, them: null, score: [0, 0], result: null, rating: null, forfeit: null }; }
  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }
  function battleStep(b, m, now) {
    if (!m || typeof m !== "object" || typeof m.t !== "string") return b;
    var x = {}, k; for (k in b) x[k] = b[k];
    if (b.phase === "end" || b.phase === "nobody") return b;
    if (m.t === "waiting" && b.phase === "queue") { x.waiting = true; return x; }
    // nobody (30 s, no opponent), busy (already in a battle elsewhere), slow (over 10 queue joins a minute): only while queueing
    if ((m.t === "nobody" || m.t === "busy" || m.t === "slow") && b.phase === "queue") { x.phase = m.t; return x; }
    // match; with resume:true (a reconnect, also after "lost") it carries the score so far and the open question follows.
    if (m.t === "match" && m.opp && (b.phase === "queue" || b.phase === "lost" || m.resume)) {
      x.phase = "match"; x.opp = { name: String(m.opp.name || "Doctor").slice(0, 40), rating: Number(m.opp.rating) || 0 };
      x.n = isInt(m.n) && m.n > 0 ? m.n : 7; x.secs = Number(m.secs) > 0 ? Number(m.secs) : 20; x.id = String(m.id || ""); x.resumed = !!m.resume;
      if (m.resume && Array.isArray(m.score) && m.score.length === 2) x.score = [Number(m.score[0]) || 0, Number(m.score[1]) || 0];
      return x;
    }
    if (m.t === "q" && isInt(m.i) && m.i >= 0 && Array.isArray(m.o) && m.o.length >= 2 && m.o.length <= 6 && (b.phase === "match" || b.phase === "r" || b.phase === "q")) {
      x.phase = "q"; x.i = m.i; x.q = String(m.q || ""); x.o = m.o.map(String); x.pick = -1; x.a = -1; x.you = null; x.them = null;
      // The round's time on this phone: the server deadline, held to the round length so a skewed clock cannot stretch it.
      var left = Number(m.deadline) - now, full = x.secs * 1000;
      x.got = now; x.deadline = now + (left > 0 && left <= full ? left : full); return x;
    }
    if (m.t === "r" && m.i === b.i && isInt(m.a) && b.phase === "q") {
      x.phase = "r"; x.a = m.a;
      x.you = { k: isInt(m.you && m.you.k) ? m.you.k : -1, pts: Number(m.you && m.you.pts) || 0 };
      x.them = { k: isInt(m.opp && m.opp.k) ? m.opp.k : -1, pts: Number(m.opp && m.opp.pts) || 0 };
      if (Array.isArray(m.score) && m.score.length === 2) x.score = [Number(m.score[0]) || 0, Number(m.score[1]) || 0];
      return x;
    }
    if (m.t === "end" && (m.result === "win" || m.result === "loss" || m.result === "draw")) {
      x.phase = "end"; x.result = m.result; x.forfeit = m.forfeit === "you" || m.forfeit === "opp" || m.forfeit === "both" ? m.forfeit : null;
      if (Array.isArray(m.score) && m.score.length === 2) x.score = [Number(m.score[0]) || 0, Number(m.score[1]) || 0];
      x.rating = m.rating && isFinite(m.rating.before) && isFinite(m.rating.after) ? { before: Number(m.rating.before), after: Number(m.rating.after) } : null;
      return x;
    }
    return b;
  }
  // The socket closed: before an end (or nobody, busy, slow) that is a lost connection. live: a battle was under way, so
  // the client reconnects once (the server resumes it within its 10 s grace).
  function liveBattle(b) { return b.phase === "match" || b.phase === "q" || b.phase === "r"; }
  function battleClosed(b) { if (b.phase === "end" || b.phase === "nobody" || b.phase === "busy" || b.phase === "slow") return b; var x = {}, k; for (k in b) x[k] = b[k]; x.phase = "lost"; return x; }
  // A pick is sent once, only while the question is open.
  function canPick(b, k, now) { return b.phase === "q" && b.pick < 0 && isInt(k) && k >= 0 && k < b.o.length && now < b.deadline; }

  // Plain words for the server's refusals (status and error code from the Arena API).
  function errWord(status, code) {
    if (status === 401) return "Sign in to compete. Practice works without an account.";
    if (status === 403) return "Join the Arena first.";
    if (status === 425) return "This event has not opened yet.";
    if (status === 409 && code === "not-started") return "Start the event before submitting.";
    if (status === 409) return "You have already taken this event. Only the first entry counts.";
    if (status === 410) return code === "too-late" ? "Too late: the event closed before your answers arrived." : "This event has closed.";
    if (status === 503) return "Coming soon: questions for this exam are still being prepared.";
    return "The Arena did not answer. Try again in a moment.";
  }
  var PURE = { enabled: enabled, ms: ms, normEvent: normEvent, eventsFrom: eventsFrom, phase: phase, pickEvent: pickEvent, countdown: countdown, eventLine: eventLine,
    lastDays: lastDays, heatWeeks: heatWeeks, heatLevel: heatLevel, bestStreak: bestStreak, accuracyBySubject: accuracyBySubject, signed: signed, answersOf: answersOf, battleNew: battleNew, battleStep: battleStep, battleClosed: battleClosed, canPick: canPick, liveBattle: liveBattle, errWord: errWord };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var API = G.SMD_PREP_ARENA_API || "/api/prep/arena/";
  var WS = G.SMD_PREP_ARENA_WS || "wss://prep-arena.drmanojkurmana.workers.dev";
  // room: a private battle code (a friend challenge from prep-social.js); null is public matchmaking.
  var A = { consent: null, events: null, evAt: 0, cd: 0, sheet: null, battle: null, ws: null, bTimer: 0, board: "event", ev: null, room: null };
  var H = null;

  function on() { try { return enabled(G.location.search, function (k) { return G.localStorage.getItem(k); }); } catch (e) { return false; } }
  function user() { try { var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function online() { return !(G.navigator && G.navigator.onLine === false); }
  function token() { var u = user(); try { return u && u.getIdToken ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function exam() { return H.exam().id; }
  function esc(s) { return H.esc(s); }
  function api(method, path, body) {
    return token().then(function (tok) {
      if (!tok) { var e0 = new Error("signin"); e0.status = 401; throw e0; }
      var o = { method: method, headers: { Authorization: "Bearer " + tok }, cache: "no-store" };
      if (body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
      return G.fetch(API + path, o);
    }).then(function (r) {
      return r.json().then(null, function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.error) || "HTTP " + r.status); e.status = r.status; e.body = j; throw e; } return j; });
    });
  }
  function errText(e) {
    if (!online()) return "Needs a connection. Practice works offline.";
    if (e && e.status === 403) A.consent = null;   // consent gone (left on another phone): ask again next time
    return errWord(e && e.status, e && e.body && e.body.error);
  }
  // Exams whose Arena is not open yet, with the reason: NEET-SS until its bank is filled (the server answers 503
  // bank-empty); FMGE has no Arena events on the server yet.
  var SOON = { "neet-ss": "open once this exam's question bank is ready", "fmge": "for FMGE come in a later update" };

  /* ---------- home: Compete ---------- */
  function homeHtml(host) {
    H = host;
    if (!online()) return '<div class="pn-group">' + H.row("a-retryhome", H.ico("off"), "Needs a connection", "Arena events and battles run online. Practice works offline.") + "</div>";
    if (!user()) return '<div class="pn-group"><div class="pn-row static"><span class="pn-ri" aria-hidden="true">' + H.ico("user") + '</span><span class="pn-rb"><b>Sign in to compete</b><small>Daily sprints, the weekly grand test and 1v1 battles need a StewardMD account. Practice works without one.</small></span></div></div>';
    if (SOON[exam()]) return '<div class="pn-group"><div class="pn-row static"><span class="pn-ri" aria-hidden="true">' + H.ico("trophy") + '</span><span class="pn-rb"><b>' + esc(H.exam().label) + " Arena: coming soon</b><small>Sprints, grand tests and battles " + SOON[exam()] + ". NEET-PG and USMLE are open.</small></span></div></div>";
    var now = Date.now(), ev = A.events || [], d = pickEvent(ev, "daily", now), w = pickEvent(ev, "weekly", now);
    var line = function (e) { return A.events ? eventLine(e || null, now) : "Loading…"; };
    var cdAttr = function (e) { return e ? ' data-cd="' + esc(e.id) + '"' : ""; };
    return '<div class="pn-group">' +
      H.row("a-event", H.ico("bolt"), "Daily sprint", '<span class="pn-cd"' + cdAttr(d) + ">" + esc(line(d)) + "</span>", ' data-k="daily"') +
      H.row("a-event", H.ico("cal"), "Weekly grand test", '<span class="pn-cd"' + cdAttr(w) + ">" + esc(line(w)) + "</span>", ' data-k="weekly"') +
      H.row("a-battle", H.ico("versus"), "1v1 battle", "7 questions, 20 seconds each, live") +
      H.row("a-boards", H.ico("trophy"), "Leaderboard", "Today's sprint, this week, all time") + "</div>";
  }
  function homeMounted(host) {
    H = host;
    if (!online() || !user() || SOON[exam()]) return;
    if (!A.events || Date.now() - A.evAt > 60e3) loadEvents().then(function () { var box = root() && root().querySelector("#pnCompete"); if (box) box.innerHTML = homeHtml(H); tick(); }, function () {
      var box = root() && root().querySelector("#pnCompete");
      if (box) box.innerHTML = '<div class="pn-group">' + H.row("a-retryhome", H.ico("off"), "Arena did not load", "Tap to try again") + "</div>";
    });
    tick();
  }
  function root() { return H && H.root(); }
  function loadEvents() { return api("GET", "events?exam=" + encodeURIComponent(exam())).then(function (j) { A.events = eventsFrom(j); A.evAt = Date.now(); return A.events; }); }
  function evById(id) { return (A.events || []).filter(function (e) { return e.id === id; })[0] || null; }
  // One second clock for every countdown on screen; stops itself when none is left.
  function tick() {
    if (A.cd) return;
    A.cd = G.setInterval(function () {
      var r = root(), els = r ? r.querySelectorAll("[data-cd]") : [];
      if (!els.length) { G.clearInterval(A.cd); A.cd = 0; return; }
      var now = Date.now();
      for (var i = 0; i < els.length; i++) { var ev = evById(els[i].getAttribute("data-cd")); if (ev) els[i].textContent = eventLine(ev, now); }
    }, 1000);
  }

  /* ---------- consent ---------- */
  // Remembered on this phone (smd_prep_arena_in) so prep-nudges.js can mention the sprint only to players.
  function consentIs(c) { A.consent = c; try { if (c.joined) G.localStorage.setItem("smd_prep_arena_in", "1"); else G.localStorage.removeItem("smd_prep_arena_in"); } catch (e) {} }
  function displayName() { var u = user(), n = (A.consent && A.consent.name) || (u && u.displayName) || ""; n = String(n).trim().slice(0, 40); return n || "Doctor"; }
  // Runs then() once the player has joined: guests and offline get a message, others the consent sheet first.
  function joined(then) {
    if (!online()) return H.toast("Needs a connection. Practice works offline.");
    if (!user()) return H.toast("Sign in to compete. Practice works without an account.");
    if (A.consent && A.consent.joined) return then();
    api("GET", "consent").then(function (j) { consentIs({ joined: !!j.joined, name: j.name || "" }); if (A.consent.joined) then(); else openSheet(then); }, function (e) { H.toast(errText(e)); });
  }
  function openSheet(then) {
    var r = root(); if (!r) return;
    closeSheet();
    A.sheet = { then: then, prev: G.document.activeElement };
    var el = G.document.createElement("div");
    el.className = "pn-sheet-wrap"; el.id = "pnSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="a-nojoin"></div><section class="pn-sheet" role="dialog" aria-modal="true" aria-labelledby="pnSheetT" tabindex="-1">' +
      '<span class="pn-grab" aria-hidden="true"></span><span class="pn-shart pn-shart-arena" aria-hidden="true"></span><h2 id="pnSheetT">Join PrepNucleus Arena</h2>' +
      "<p>Your name (<b>" + esc(displayName()) + "</b>), scores and answers in Arena events are sent to StewardMD and shown to other players. Practice stays on this phone.</p>" +
      '<ul class="pn-facts"><li><span class="pn-ic xs" style="--h:200" aria-hidden="true">' + H.ico("lock") + '</span><span><b>Never shown</b><small>Your email and StewardMD ID.</small></span></li>' +
      '<li><span class="pn-ic xs" style="--h:20" aria-hidden="true">' + H.ico("leave") + '</span><span><b>Leave at any time</b><small>Leaving deletes your Arena results.</small></span></li></ul>' +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn pri" data-act="a-join">Join Arena</button><button type="button" class="pn-btn" data-act="a-nojoin">Not now</button></div></section>';
    r.appendChild(el);
    try { el.querySelector("[data-act=a-join]").focus(); } catch (e) {}
  }
  function closeSheet() {
    var el = root() && root().querySelector("#pnSheet");
    if (el) el.parentNode.removeChild(el);
    var s = A.sheet; A.sheet = null;
    try { if (s && s.prev && s.prev.isConnected) s.prev.focus(); } catch (e) {}
    return s;
  }
  function join(btn) {
    btn.disabled = true; btn.textContent = "Joining…";
    api("POST", "consent", {}).then(function (j) {
      consentIs({ joined: true, name: (j && j.name) || displayName() });
      var s = closeSheet(); if (s && s.then) s.then();
    }, function (e) { btn.disabled = false; btn.textContent = "Join Arena"; H.toast(errText(e)); });
  }
  function leaveArena() {
    if (G.confirm && !G.confirm("Leave the Arena? Your Arena results, leaderboard places, friends, challenges, college tag and study groups are deleted. Practice on this phone is kept.")) return;
    api("DELETE", "consent").then(function () {
      consentIs({ joined: false, name: "" }); A.events = null;
      H.toast("You left the Arena. Your results, friends and groups were deleted.");
      H.back();
    }, function (e) { H.toast(errText(e)); });
  }

  /* ---------- events: lobby, runner, result ---------- */
  function openEvent(kind) {
    joined(function () {
      var go = function () {
        var ev = pickEvent(A.events, kind, Date.now());
        A.ev = ev;
        H.push(function () { renderLobby(kind); });
      };
      if (A.events) go(); else loadEvents().then(go, function (e) { H.toast(errText(e)); });
    });
  }
  function rulesLine(ev) {
    var m = H.mockOf(exam(), exam()), mins = Math.round((ev.secs || 0) / 60), third = Math.abs(m.minus - 1 / 3) < 1e-9;
    return ev.n + " questions, " + mins + " min. Right +" + m.plus + (m.minus ? ", wrong minus " + (third ? "1/3" : m.minus) : ", no negative marking") + ", unanswered 0.";
  }
  function renderLobby(kind) {
    var now = Date.now(), ev = A.ev && A.ev.kind === kind ? A.ev : pickEvent(A.events, kind, now), title = kind === "weekly" ? "Weekly grand test" : "Daily sprint";
    if (!ev) {
      H.paint(H.bar(title, H.exam().label, "back") + '<div class="pn-body"><p class="pn-empty pn-art-sc">No ' + (kind === "weekly" ? "weekly test" : "sprint") + " is scheduled for this exam yet.</p></div>");
      return;
    }
    A.ev = ev;
    var p = phase(ev, now), when = new Date(ev.start), end = new Date(ev.end);
    var t = function (d) { try { return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); } catch (e) { return d.toTimeString().slice(0, 5); } };
    var day = function (d) { try { return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return ""; } };
    H.paint(H.bar(title, H.exam().label, "back") + '<div class="pn-body"><section class="pn-panel pn-lobby">' +
      '<p class="pn-lobby-when">' + esc(day(when)) + ", " + esc(t(when)) + " to " + esc(t(end)) + "</p>" +
      '<p class="pn-big pn-cdbig" data-cd="' + esc(ev.id) + '" role="timer" aria-live="off">' + esc(eventLine(ev, now)) + "</p>" +
      '<p class="pn-mut">' + esc(rulesLine(ev)) + "</p>" +
      (ev.done ? '<button type="button" class="pn-btn pri" data-act="a-board" data-v="' + esc(ev.id) + '">' + H.ico("trophy") + " See the leaderboard</button>"
        : '<button type="button" class="pn-btn pri" data-act="a-start"' + (p === "live" ? "" : " disabled") + ">" + H.ico("play") + (p === "soon" ? " Opens at " + esc(t(when)) : p === "live" ? (ev.started ? " Resume" : " Start") : " Closed") + "</button>") +
      '<p class="pn-err" id="pnLobbyErr" role="alert" hidden></p></section>' +
      '<ul class="pn-rules"><li>One attempt. Answers are marked when you submit or when the time runs out.</li><li>Questions come from the screened bank, spread across subjects. Answer keys stay hidden until you submit.</li>' +
      "<li>Your name and score appear on the leaderboard.</li></ul>" +
      '<button type="button" class="pn-link" data-act="a-board" data-v="' + esc(ev.id) + '">' + H.ico("trophy") + " Leaderboard</button></div>");
    tick();
  }
  function startEvent(btn) {
    var ev = A.ev; if (!ev) return;
    btn.disabled = true; btn.textContent = "Loading questions…";
    api("POST", "events/" + encodeURIComponent(ev.id) + "/start", {}).then(function (j) {
      var items = (j.items || []).filter(function (it) { return it && it.id && it.q && Array.isArray(it.o); }).map(function (it) {
        return { id: String(it.id), q: String(it.q), o: it.o.map(String), _s: "arena", _m: ev.id };
      });
      if (!items.length) throw new Error("empty");
      var endsAt = ms(j.endsAt || j.ends_at) || ev.end, secs = Number(j.secs) || ev.secs || items.length * 60;
      var limit = Math.max(1, Math.min(secs, Math.floor((endsAt - Date.now()) / 1000)));
      H.run(items, "exam", ev.kind === "weekly" ? "Weekly grand test" : "Daily sprint", { limit: limit, custom: { submit: submitEvent, render: renderEventResult } });
    }).then(null, function (e) {
      var el = root() && root().querySelector("#pnLobbyErr");
      btn.textContent = "Start";
      // closed, already taken or not ready: Start stays off; a network hiccup or "not open yet" can be tried again.
      btn.disabled = !!(e && (e.status === 409 || e.status === 410 || e.status === 503));
      if (e && e.status === 409) { ev.done = true; }
      if (el) { el.textContent = errText(e); el.hidden = false; } else H.toast(errText(e));
    });
  }
  function submitEvent(r) {
    var ev = A.ev;
    r.arena = { state: "sending" }; H.rerender();
    api("POST", "events/" + encodeURIComponent(ev.id) + "/submit", { ans: answersOf(r.items, r.ans), ms: Math.round(r.secs * 1000) }).then(function (j) {
      var key = j.key || {};
      r.items.forEach(function (it) { if (key[it.id] != null) it.a = Number(key[it.id]); });
      ev.done = true;
      r.arena = { state: "done", res: j }; H.rerender();
      api("GET", "events/" + encodeURIComponent(ev.id) + "/board?around=me").then(function (b) { r.arena.board = b; if (H.run_() === r) H.rerender(); }, function () {});
    // 409 (already in) and 410 (too late) are final; anything else keeps the answers for "Send again".
    }, function (e) { r.arena = { state: e && (e.status === 409 || e.status === 410) ? "dup" : "fail", msg: errText(e) }; H.rerender(); });
  }
  function renderEventResult(r) {
    var a = r.arena || { state: "sending" }, head = H.bar(esc(r.title), "Result", "back");
    if (a.state === "sending") return H.paint(head + '<div class="pn-body"><p class="pn-load" role="status">Submitting your answers…</p></div>');
    if (a.state === "fail") return H.paint(head + '<div class="pn-body"><p class="pn-err" role="alert">' + esc(a.msg) + ' Your answers are kept on this screen.</p><button type="button" class="pn-btn pri" data-act="a-resubmit">Send again</button></div>');
    if (a.state === "dup") return H.paint(head + '<div class="pn-body"><p class="pn-empty">' + esc(a.msg) + '</p><button type="button" class="pn-btn pri" data-act="donerun">Done</button></div>');
    var x = a.res, missed = [];
    r.items.forEach(function (it, i) { if (it.a != null && r.ans[i] !== it.a) missed.push(i); });
    H.paint(head + '<div class="pn-body"><section class="pn-panel pn-score"><p class="pn-big">' + esc(String(x.score)) + "</p>" +
      (x.rank ? '<p class="pn-rank">Rank ' + H.fmt(x.rank) + (x.of ? " of " + H.fmt(x.of) : "") + "</p>" : "") +
      '<p class="pn-mut">' + (x.right || 0) + " right · " + (x.wrong || 0) + " wrong · " + (x.blank || 0) + " unanswered · " + H.fmtTime(x.ms != null ? x.ms / 1000 : r.secs) + "</p></section>" +
      '<h2 class="pn-h">Leaderboard</h2>' + boardHtml(a.board, "score", 10) +
      (missed.length ? '<h2 class="pn-h">Review the missed</h2><ol class="pn-missed">' + missed.map(function (i) {
        var it = r.items[i];
        return '<li><button type="button" class="pn-mod" data-act="reviewq" data-i="' + i + '"><span class="pn-mb"><b>' + esc(it.q.length > 120 ? it.q.slice(0, 116) + "\u2026" : it.q) + "</b><small>Answer: " + esc(it.o[it.a]) + (r.ans[i] >= 0 ? " · you chose " + esc(it.o[r.ans[i]]) : " · not answered") + "</small></span></button></li>";
      }).join("") + "</ol>" : "") +
      '<div class="pn-navrow"><button type="button" class="pn-btn pri" data-act="donerun">Done</button></div></div>');
  }

  /* ---------- leaderboards ---------- */
  // rows: [{ rank, name, score | rating, ms }]; me: the caller's row (also marked when it is in rows).
  function boardHtml(b, field, max) {
    if (!b) return '<p class="pn-load" role="status">Loading the leaderboard…</p>';
    var rows = (b.rows || []).slice(0, max || 50), me = b.me || null, meIn = false;
    if (!rows.length) return '<p class="pn-empty">No one on this board yet.</p>';
    var li = function (x, mine) {
      var v = x[field] != null ? x[field] : x.score != null ? x.score : x.rating;
      return '<li class="pn-lb' + (mine ? " me" : "") + '"><span class="pn-lb-r">' + H.fmt(x.rank) + '</span><span class="pn-lb-n">' + esc(String(x.name || "Doctor").slice(0, 40)) + (mine ? " <small>You</small>" : "") + '</span><span class="pn-lb-v">' + esc(v == null ? "" : String(v)) + "</span></li>";
    };
    var html = rows.map(function (x) { var m = !!(x.me || (me && x.rank === me.rank && x.name === me.name)); if (m) meIn = true; return li(x, m); }).join("");
    if (me && !meIn) html += '<li class="pn-lb-gap" aria-hidden="true"></li>' + li(me, true);
    return '<ol class="pn-board" aria-label="Leaderboard">' + html + "</ol>";
  }
  function openBoards(tab, evId) {
    joined(function () {
      A.board = tab || "event"; if (evId) A.boardEv = evId;
      H.push(renderBoards);
    });
  }
  function renderBoards() {
    var tabs = [["event", "Today's sprint"], ["week", "This week"], ["all", "All time"]];
    H.paint(H.bar("Leaderboard", H.exam().label, "back") + '<div class="pn-tabs" role="tablist" aria-label="Board">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="pn-tab' + (A.board === t[0] ? " on" : "") + '" aria-selected="' + (A.board === t[0]) + '" data-act="a-tab" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + '</div><div class="pn-body"><p class="pn-mut pn-small" id="pnBoardNote">' + (A.board === "event" ? "Score in the sprint, ties to the faster entry." : "Battle rating. Everyone starts at 1200.") + '</p><div id="pnBoard">' + boardHtml(null) + "</div>" +
      '<button type="button" class="pn-link pn-danger" data-act="a-leave">' + H.ico("leave") + " Leave the Arena</button></div>");
    var tab = A.board, put = function (html) { var el = root() && root().querySelector("#pnBoard"); if (el && A.board === tab) el.innerHTML = html; };
    var p;
    if (tab === "event") {
      var evId = A.boardEv;
      if (!evId) { var ev = pickEvent(A.events, "daily", Date.now()); evId = ev && ev.id; }
      p = evId ? api("GET", "events/" + encodeURIComponent(evId) + "/board?around=me").then(function (b) { put(boardHtml(b, "score")); }) : (loadEvents().then(function () { var e2 = pickEvent(A.events, "daily", Date.now()); if (!e2) return put('<p class="pn-empty">No sprint today yet.</p>'); A.boardEv = e2.id; return api("GET", "events/" + encodeURIComponent(e2.id) + "/board?around=me").then(function (b) { put(boardHtml(b, "score")); }); }));
    } else p = api("GET", "board?exam=" + encodeURIComponent(exam()) + "&period=" + tab).then(function (b) { put(boardHtml(b, "rating")); });
    p.then(null, function (e) { put('<p class="pn-err" role="alert">' + esc(errText(e)) + "</p>"); });
  }

  /* ---------- battle ---------- */
  function openBattle() { joined(function () { H.push(renderBattle); startBattle(); }); }
  function startBattle() {
    stopBattle();
    A.battle = battleNew(); A.retry = 0; A.lastScore = null; A.ptsFor = -1;
    connect(false);
    paintBattle();
  }
  // resume: reconnecting to a battle under way; the server sends match (resume) and the open question on its own, so
  // nothing is queued.
  function connect(resume) {
    token().then(function (tok) {
      if (!tok || !A.battle) { if (A.battle) { A.battle = battleClosed(A.battle); paintBattle(); } return; }
      var ws;
      try { ws = new G.WebSocket(WS.replace(/\/$/, "") + "/battle?exam=" + encodeURIComponent(A.room && A.roomExam ? A.roomExam : exam()) + (A.room ? "&room=" + encodeURIComponent(A.room) : ""), ["smd-arena", tok]); } catch (e) { A.battle = battleClosed(A.battle); return paintBattle(); }
      A.ws = ws;
      ws.onopen = function () { if (!resume) try { ws.send(JSON.stringify({ t: "queue" })); } catch (e) {} };
      ws.onmessage = function (e) {
        if (A.ws !== ws) return;
        var m = null; try { m = JSON.parse(e.data); } catch (x) { return; }
        var before = A.battle;
        A.battle = battleStep(A.battle, m, Date.now());
        if (A.battle !== before) { A.retry = 0; paintBattle(); }
        var ph = A.battle.phase;
        if (ph === "end" || ph === "nobody" || ph === "busy" || ph === "slow") { A.ws = null; try { ws.close(); } catch (x) {} }
      };
      ws.onclose = ws.onerror = function () {
        if (A.ws !== ws) return;
        A.ws = null;
        var live = liveBattle(A.battle);
        A.battle = battleClosed(A.battle);
        // one quiet reconnect per drop, inside the server's 10 s grace
        if (live && A.retry < 1) { A.retry++; A.battle.reconnecting = true; A.rTimer = G.setTimeout(function () { A.rTimer = 0; if (A.battle && A.battle.phase === "lost") connect(true); }, 1000); }
        else if (A.battle) A.battle.reconnecting = false;
        paintBattle();
      };
    });
  }
  function stopBattle() { var ws = A.ws; A.ws = null; if (A.rTimer) { G.clearTimeout(A.rTimer); A.rTimer = 0; } if (A.bTimer) { G.clearInterval(A.bTimer); A.bTimer = 0; } if (ws) try { ws.close(); } catch (e) {} }
  function pick(k) {
    var b = A.battle, now = Date.now();
    if (!b || !canPick(b, k, now) || !A.ws) return;
    try { A.ws.send(JSON.stringify({ t: "a", i: b.i, k: k })); } catch (e) { return; }
    var x = {}, f; for (f in b) x[f] = b[f]; x.pick = k; A.battle = x; paintBattle();
  }
  // Initials in a gradient ring, the hue fixed by the name (so a player keeps their colour across battles).
  function initials(name) { var w = String(name || "").trim().split(/\s+/).filter(Boolean); return ((w[0] || "?").charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase(); }
  function hueOf(name) { var h = 0, t = String(name || ""); for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360; return h; }
  function avatar(name, cls) { return '<span class="pn-av' + (cls ? " " + cls : "") + '" style="--h:' + hueOf(name) + '" aria-hidden="true"><span>' + esc(initials(name)) + "</span></span>"; }
  // The score bar. A score that changed since the last paint rolls in (.tick); a round's points float up once.
  function versus(b) {
    var me = displayName(), last = A.lastScore || [b.score[0], b.score[1]], pts = "";
    if (b.phase === "r" && A.ptsFor !== b.i) {
      A.ptsFor = b.i;
      if (b.you && b.you.pts > 0) pts += '<span class="pn-pts l" aria-hidden="true">+' + b.you.pts + "</span>";
      if (b.them && b.them.pts > 0) pts += '<span class="pn-pts r" aria-hidden="true">+' + b.them.pts + "</span>";
    }
    A.lastScore = [b.score[0], b.score[1]];
    return '<div class="pn-vs" aria-label="Score: you ' + b.score[0] + ", " + esc(b.opp.name) + " " + b.score[1] + '">' +
      '<div class="pn-vs-p">' + avatar(me, "sm") + "<span><b>" + esc(me) + "</b><small>You</small></span></div>" +
      '<div class="pn-vs-s" aria-hidden="true"><span' + (b.score[0] !== last[0] ? ' class="tick"' : "") + ">" + b.score[0] + "</span><i></i><span" + (b.score[1] !== last[1] ? ' class="tick"' : "") + ">" + b.score[1] + "</span></div>" +
      '<div class="pn-vs-p r"><span><b>' + esc(b.opp.name) + "</b><small>" + (b.opp.rating ? "Rating " + b.opp.rating : "Opponent") + "</small></span>" + avatar(b.opp.name, "sm") + "</div>" + pts + "</div>";
  }
  // The match moment: both players, their ratings, and a bolt between them (prep-motion.js plays it in once).
  var BOLT = '<svg class="pn-bolt" viewBox="0 0 24 48" aria-hidden="true"><path d="M15 1L3 27h8l-3 20L21 18h-8z"/></svg>';
  function vsIntroHtml(b) {
    var me = displayName();
    return '<section class="pn-vs pn-vsi" role="status" aria-label="' + esc(me) + " versus " + esc(b.opp.name) + '">' +
      '<div class="pn-vsi-p l">' + avatar(me) + "<b>" + esc(me) + "</b><small>You</small></div>" +
      '<div class="pn-vsi-mid" aria-hidden="true"><span class="pn-flash"></span>' + BOLT + "</div>" +
      '<div class="pn-vsi-p r">' + avatar(b.opp.name) + "<b>" + esc(b.opp.name) + "</b><small>" + (b.opp.rating ? "Rating " + b.opp.rating : "Opponent") + "</small></div>" +
      '<p class="pn-vsi-sub"><b>' + (b.resumed ? "Back in the battle" : "Matched") + "</b> " + b.n + " questions, " + b.secs + " seconds each. Faster right answers score more.</p></section>";
  }
  function battleTitle(b) { return b.phase === "q" || b.phase === "r" ? "Round " + (b.i + 1) + " of " + b.n : "1v1 battle"; }
  function paintBattle() {
    var b = A.battle; if (!b || !root() || H.stackTop() !== renderBattle) return;
    renderBattle();
  }
  function renderBattle() {
    var b = A.battle || battleNew(), L = ["A", "B", "C", "D", "E", "F"], body = "", focus = null;
    if (A.bTimer) { G.clearInterval(A.bTimer); A.bTimer = 0; }
    if (b.phase === "queue") body = '<section class="pn-panel pn-mm" role="status"><span class="pn-mm-bar" aria-hidden="true"><i></i></span><p class="pn-mid">' + (A.room ? "Waiting for your friend" : "Finding an opponent") + '</p><p class="pn-mut">' +
      (A.room ? "The battle starts when both of you are in." : esc(H.exam().label) + ", nearest rating first. This takes up to 30 seconds.") + "</p></section><button type=\"button\" class=\"pn-btn\" data-act=\"back\">Cancel</button>";
    else if (b.phase === "nobody") body = '<section class="pn-panel pn-score"><p class="pn-mid">' + (A.room ? "Your friend did not join in time" : "Nobody is free right now") + '</p><p class="pn-mut">' + (A.room ? "A challenge room waits 3 minutes. Send a new challenge from Friends." : "No opponent joined in 30 seconds. Battles are only against real players. Try again in a few minutes, or practise meanwhile.") + "</p></section>" +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="back">Back</button><button type="button" class="pn-btn pri" data-act="a-again">Try again</button></div>';
    else if (b.phase === "busy" || b.phase === "slow") body = '<section class="pn-panel pn-score"><p class="pn-mid">' + (b.phase === "busy" ? "You are already in a battle" : "Too many tries") + '</p><p class="pn-mut">' +
      (b.phase === "busy" ? "A battle of yours is still running, perhaps on another phone. It ends on its own within a few minutes." : "Battles allow 10 joins a minute. Wait a minute, then try again.") + "</p></section>" +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="back">Back</button><button type="button" class="pn-btn pri" data-act="a-again">Try again</button></div>';
    else if (b.phase === "lost" && b.reconnecting) body = (b.opp ? versus(b) : "") + '<section class="pn-panel pn-mm" role="status"><span class="pn-mm-bar" aria-hidden="true"><i></i></span><p class="pn-mid">Reconnecting</p><p class="pn-mut">The connection dropped. Your battle is held for 10 seconds.</p></section>';
    else if (b.phase === "lost") body = (b.opp ? versus(b) : "") + '<section class="pn-panel pn-score" role="alert"><p class="pn-mid">Connection lost</p><p class="pn-mut">' + (b.opp ? "A player away for more than 10 seconds loses the battle." : "The battle server could not be reached.") + " Check the connection and try again.</p></section>" +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="back">Back</button><button type="button" class="pn-btn pri" data-act="a-again">Try again</button></div>';
    else if (b.phase === "match") { body = vsIntroHtml(b); A.lastScore = [b.score[0], b.score[1]]; }
    else if (b.phase === "q" || b.phase === "r") {
      var shown = b.phase === "r", now = Date.now(), total = Math.max(1, b.deadline - b.got), left = Math.max(0, b.deadline - now);
      body = versus(b) +
        '<div class="pn-tbar' + (shown ? " stop" : "") + '" role="timer" aria-label="' + Math.ceil(left / 1000) + ' seconds left"><i style="animation-duration:' + total + "ms;animation-delay:-" + (total - left) + 'ms"></i></div>' +
        '<p class="pn-q">' + esc(b.q) + '</p><ol class="pn-opts">' + b.o.map(function (o, k) {
          var cls = "pn-opt";
          if (shown) { if (k === b.a) cls += " right"; else if (k === b.you.k) cls += " wrong"; } else if (k === b.pick) cls += " sel";
          var them = shown && b.them && b.them.k === k ? '<span class="pn-them">' + esc(b.opp.name.split(" ")[0]) + "</span>" : "";
          return '<li><button type="button" class="' + cls + '" data-act="a-pick" data-k="' + k + '"' + (shown || b.pick >= 0 ? ' aria-disabled="true"' : "") + ' aria-pressed="' + (k === b.pick) + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span>" + them + "</button></li>";
        }).join("") + "</ol>" +
        (shown ? '<section class="pn-round" role="status"><p><b>' + (b.you.k === b.a ? "Right, +" + b.you.pts : b.you.k < 0 ? "No answer, 0" : "Wrong, 0") + "</b> for you</p><p>" + esc(b.opp.name) + ": " + (b.them.k === b.a ? "right, +" + b.them.pts : b.them.k < 0 ? "no answer" : "wrong") + '</p><p class="pn-mut pn-small">' + (b.i + 1 < b.n ? "Next round in a moment" : "Final result in a moment") + "</p></section>"
          : b.pick >= 0 ? '<p class="pn-mut pn-small pn-wait" role="status">Answer locked. Waiting for the round to close.</p>' : "");
      focus = shown ? ".pn-round" : b.pick < 0 ? ".pn-opt" : null;
      if (!shown) A.bTimer = G.setInterval(function () { var el = root() && root().querySelector(".pn-tbar"); if (!el || !A.battle || A.battle.phase !== "q") { G.clearInterval(A.bTimer); A.bTimer = 0; return; } var l = Math.max(0, A.battle.deadline - Date.now()); el.setAttribute("aria-label", Math.ceil(l / 1000) + " seconds left"); el.classList.toggle("low", l < 5000); }, 500);
    } else if (b.phase === "end") {
      var head = b.result === "win" ? "You won" : b.result === "loss" ? "You lost" : "A draw", rt = b.rating;
      var why = b.forfeit === "opp" ? esc(b.opp.name) + " left the battle." : b.forfeit === "you" ? "You were away for more than 10 seconds." : b.forfeit === "both" ? "Both players left, so it is a draw." : "";
      body = versus(b) + '<section class="pn-panel pn-score pn-final ' + b.result + '"><p class="pn-big">' + head + '</p><p class="pn-final-s">' + b.score[0] + " to " + b.score[1] + "</p>" + (why ? '<p class="pn-mut">' + why + "</p>" : "") +
        (rt ? '<p class="pn-mut pn-rtl">Rating ' + rt.before + ' to <b class="pn-rtick" data-from="' + rt.before + '" data-to="' + rt.after + '">' + rt.after + '</b> <span class="pn-dchip' + (rt.after >= rt.before ? " up" : " down") + '">(' + signed(rt.after - rt.before) + ")</span></p>" : "") + "</section>" +
        '<div class="pn-navrow"><button type="button" class="pn-btn' + (A.room ? " pri" : "") + '" data-act="back">Done</button>' + (A.room ? "" : '<button type="button" class="pn-btn pri" data-act="a-again">Play again</button>') + "</div>";
    }
    H.paint(H.bar(battleTitle(b), b.opp ? "vs " + esc(b.opp.name) : esc(H.exam().label), "back") + '<div class="pn-body pn-run pn-battle">' + body + "</div>", focus);
  }

  /* ---------- My stats ---------- */
  function renderStats() {
    var s = H.store(), td = H.today(), days = lastDays(s.days, td, 30), max = Math.max.apply(null, days.concat([1])), sum = days.reduce(function (a, b) { return a + b; }, 0);
    var acc = accuracyBySubject(s.mod, function (m) { return H.subjectOfModule(m); });
    var mh = (s.mh || []).slice().reverse();
    var arena = on() && user() && online();
    H.paint(H.bar("My stats", "Practice on this phone", "back") + '<div class="pn-body">' + profileHtml(s, td, acc) +
      '<h2 class="pn-h">Last 30 days</h2><section class="pn-panel"><p class="pn-stat-n"><b>' + H.fmt(sum) + "</b> questions answered</p>" +
      '<div class="pn-days" role="img" aria-label="Questions answered per day, last 30 days, ' + H.fmt(sum) + ' in all">' + days.map(function (n, i) {
        return '<i class="' + (n ? "" : "z") + (i === days.length - 1 ? " t" : "") + '" style="height:' + (n ? Math.max(8, Math.round(n * 100 / max)) : 4) + '%"></i>';
      }).join("") + '</div><p class="pn-days-ax" aria-hidden="true"><span>30 days ago</span><span>Today</span></p></section>' +
      '<p class="pn-eb" aria-hidden="true">Share right, weakest first</p><h2 class="pn-h">Subject mastery</h2>' + (acc.length ? '<ul class="pn-acc pn-mast">' + acc.map(function (x) {
        var sb = H.subjectById(x.sid);
        return '<li><span class="pn-ic sm" aria-hidden="true" style="--h:' + (H.subjHue ? H.subjHue(x.sid) : 172) + '">' + H.subjIco(x.sid) + '</span><span class="pn-acc-b"><span class="pn-acc-h"><b>' + (sb ? H.tx(sb.name) : esc(x.sid)) + "</b><span>" + x.pct + '%</span></span><span class="pn-meter" aria-hidden="true"><i data-p="' + (x.pct / 100).toFixed(3) + '" style="transform:scaleX(' + (x.pct / 100).toFixed(3) + ')"></i></span><small>' + H.fmt(x.ok) + " of " + H.fmt(x.t) + " right</small></span></li>";
      }).join("") + "</ul>" : '<p class="pn-empty">Answer a few questions and each subject shows its share right here.</p>') +
      '<h2 class="pn-h">Mock exams</h2>' + (mh.length ? '<ul class="pn-mods">' + mh.map(function (m) {
        var d = new Date(m.ts), ds = ""; try { ds = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) {}
        return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + esc(m.label) + "</b><small>" + esc(ds) + " · " + m.n + ' questions</small></span><span class="pn-st">' + esc(String(m.marks)) + " / " + m.max + "</span></div></li>";
      }).join("") + "</ul>" : '<p class="pn-empty">Finished mock exams are listed here with their marks.</p>') +
      (arena ? '<h2 class="pn-h">Arena</h2><div id="pnArenaStats"><p class="pn-load" role="status">Loading your Arena record…</p></div>' : "") + "</div>");
    if (!arena) return;
    var put = function (html) { var el = root() && root().querySelector("#pnArenaStats"); if (el) el.innerHTML = html; };
    api("GET", "consent").then(function (c) {
      consentIs({ joined: !!c.joined, name: c.name || "" });
      if (!c.joined) return put('<div class="pn-group">' + H.row("a-boards", H.ico("trophy"), "Not in the Arena", "Join to enter daily sprints and battles") + "</div>");
      return api("GET", "me/stats").then(function (j) { put(arenaStatsHtml(j)); });
    }).then(null, function (e) { put('<p class="pn-err" role="alert">' + esc(errText(e)) + "</p>"); });
  }
  /* ---------- profile: level, streaks, the 12-week calendar, a shareable card ---------- */
  function totals(s) { var t = 0, ok = 0; Object.keys(s.mod || {}).forEach(function (m) { t += s.mod[m].t || 0; ok += s.mod[m].ok || 0; }); return { t: t, ok: ok, pct: t ? Math.round(ok * 100 / t) : 0 }; }
  function levelNow(s) { var P = G.PREP_PLAN && G.PREP_PLAN._pure; return P && P.levelOf ? P.levelOf(P.xpOf(s)) : null; }
  function streakNow(s, td) { var C = H.core && H.core(); return C && C.streak ? C.streak(s, td) : 0; }
  function profileHtml(s, td) {
    var cur = streakNow(s, td), best = Math.max(cur, bestStreak(s.days)), tot = totals(s), lv = levelNow(s);
    var cells = heatWeeks(s.days, td, 12), active = cells.filter(function (c) { return c.n > 0; }).length, top = cells.reduce(function (a, c) { return Math.max(a, c.n); }, 0);
    var p = lv ? Math.max(0, Math.min(1, lv.p)) : 0;
    return (lv ? '<section class="pn-panel pn-lvb" aria-label="Level ' + lv.n + ", " + esc(lv.rank) + ", " + H.fmt(lv.xp - lv.lo) + " of " + H.fmt(lv.hi - lv.lo) + " XP to level " + (lv.n + 1) + '">' +
        '<div class="pn-lvb-h" aria-hidden="true"><span class="pn-lvb-n"><small>Level</small><b>' + lv.n + '</b></span><span class="pn-lvb-t"><b>' + esc(lv.rank) + "</b><small>" + H.fmt(lv.xp) + " XP in all</small></span></div>" +
        '<span class="pn-lvbar" aria-hidden="true"><i data-p="' + p.toFixed(3) + '" style="transform:scaleX(' + p.toFixed(3) + ')"></i></span>' +
        '<p class="pn-lvb-x" aria-hidden="true">' + H.fmt(lv.xp - lv.lo) + " / " + H.fmt(lv.hi - lv.lo) + " XP to level " + (lv.n + 1) + "</p>" +
        '<button type="button" class="pn-btn pri" data-act="a-share">' + SHARE + " Share my progress</button></section>" : "") +
      '<section class="pn-panel pn-rec pn-streaks"><div><b>' + cur + "</b><small>Day streak</small></div><div><b>" + best + "</b><small>Best streak</small></div><div><b>" + H.fmt(tot.t) + "</b><small>Answered</small></div><div><b>" + tot.pct + "%</b><small>Right</small></div></section>" +
      '<p class="pn-eb" aria-hidden="true">The last 12 weeks</p><h2 class="pn-h">Study calendar</h2><section class="pn-panel pn-cal">' +
      '<div class="pn-heat" role="img" aria-label="Study calendar, last 12 weeks: ' + active + " active " + (active === 1 ? "day" : "days") + (top ? ", the busiest with " + top + " answers" : "") + '">' +
      '<span class="pn-heat-d" aria-hidden="true"><i>M</i><i></i><i>W</i><i></i><i>F</i><i></i><i>S</i></span><span class="pn-heat-g">' +
      cells.map(function (c) { var l = heatLevel(c.n), cls = c.n < 0 ? "f" : (l ? "l" + l : "") + (c.d === td ? " t" : ""); cls = cls.trim(); return "<i" + (cls ? ' class="' + cls + '"' : "") + "></i>"; }).join("") + "</span></div>" +
      '<p class="pn-heat-k" aria-hidden="true"><span>' + active + " active " + (active === 1 ? "day" : "days") + '</span><span class="pn-heat-l">Less<i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>More</span></p></section>';
  }
  var SHARE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  /* The share card: 1080 x 1350, the night sky art, the level, the streak, the calendar and the totals. Only the
     student's own counts from this phone; no name, email or ID. */
  function img(src) { return new Promise(function (res) { var i = new G.Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  function rr(x, cx, y, w, h, r) { x.beginPath(); x.moveTo(cx + r, y); x.arcTo(cx + w, y, cx + w, y + h, r); x.arcTo(cx + w, y + h, cx, y + h, r); x.arcTo(cx, y + h, cx, y, r); x.arcTo(cx, y, cx + w, y, r); x.closePath(); }
  // The share image (1080 x 1350) in the app's own system (2026-10-10, owner palette): a Midnight page, the amber mark
  // and name, the level on a Prussian card with an amber bar, the streak as the large figure, the 12-week calendar in
  // amber steps and three counts. Solid surfaces only: no painted art, no glow.
  function drawCard(s, td) {
    var W = 1080, HT = 1350, cv = G.document.createElement("canvas"); cv.width = W; cv.height = HT;
    var x = cv.getContext("2d"), F = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
    var cur = streakNow(s, td), tot = totals(s), lv = levelNow(s), cells = heatWeeks(s.days, td, 12), M = 84;
    var INK = "#f5f3ee", MUT = "#a9b1c7", AMB = "#efc07b";
    return img("/prep/art/logo-mark-amber-96.webp").then(function (mark) {
      x.fillStyle = "#1a1a2e"; x.fillRect(0, 0, W, HT);
      if (mark) x.drawImage(mark, M, 72, 60, 60);
      x.fillStyle = INK; x.font = "650 38px " + F; x.fillText("PrepNucleus", M + (mark ? 80 : 0), 116);
      // the level card
      rr(x, M - 24, 176, W - 2 * M + 48, 300, 48); x.fillStyle = "#0f3460"; x.fill();
      if (lv) {
        x.fillStyle = INK; x.font = "700 92px " + F; x.fillText("Level " + lv.n, M + 24, 300);
        x.fillStyle = AMB; x.font = "600 44px " + F; x.fillText(lv.rank, M + 24, 366);
        rr(x, M + 24, 410, W - 2 * M - 48, 16, 8); x.fillStyle = "rgba(255,255,255,.14)"; x.fill();
        rr(x, M + 24, 410, Math.max(16, (W - 2 * M - 48) * Math.max(0, Math.min(1, lv.p))), 16, 8); x.fillStyle = AMB; x.fill();
      } else { x.fillStyle = INK; x.font = "700 80px " + F; x.fillText("Getting started", M + 24, 350); }
      // the streak
      x.fillStyle = INK; x.font = "700 168px " + F; x.fillText(String(cur), M, 700);
      var sw = x.measureText(String(cur)).width;
      x.fillStyle = AMB; x.font = "600 46px " + F; x.fillText("day streak", M + sw + 26, 688);
      // twelve weeks, one cell a day
      var cw = 62, ch = 34, gx = M + (W - 2 * M - 12 * cw - 11 * 12) / 2, gy = 770;
      cells.forEach(function (c, i) {
        if (c.n < 0) return;
        rr(x, gx + Math.floor(i / 7) * (cw + 12), gy + (i % 7) * (ch + 8), cw, ch, 9);
        x.fillStyle = ["rgba(255,255,255,.07)", "rgba(239,192,123,.32)", "rgba(239,192,123,.56)", "rgba(239,192,123,.8)", AMB][heatLevel(c.n)]; x.fill();
      });
      [[H.fmt(tot.t), "answered"], [tot.pct + "%", "right"], [lv ? H.fmt(lv.xp) : "0", "XP"]].forEach(function (st, i) {
        var cx = M + i * ((W - 2 * M) / 3);
        x.fillStyle = INK; x.font = "700 66px " + F; x.fillText(st[0], cx, 1196);
        x.fillStyle = MUT; x.font = "600 32px " + F; x.fillText(st[1], cx, 1242);
      });
      x.fillStyle = "#8c95ae"; x.font = "600 28px " + F; x.fillText("StewardMD", M, 1306);
      return cv;
    });
  }
  function shareProgress(btn) {
    var s = H.store(), td = H.today();
    btn.disabled = true;
    drawCard(s, td).then(function (cv) {
      var P = G.Capacitor && G.Capacitor.Plugins, data = cv.toDataURL("image/png"), name = "prepnucleus-progress.png";
      if (G.SMD_IS_NATIVE && P && P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share)
        return P.Filesystem.writeFile({ path: name, data: data.split(",")[1], directory: "CACHE" }).then(function (w) { return P.Share.share({ title: "My PrepNucleus progress", url: w.uri, dialogTitle: "Share progress" }); });
      return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, "image/png"); }).then(function (b) {
        var f = null; try { f = new G.File([b], name, { type: "image/png" }); } catch (e) {}
        if (f && G.navigator.canShare && G.navigator.canShare({ files: [f] })) return G.navigator.share({ files: [f], title: "My PrepNucleus progress" });
        var a = G.document.createElement("a"); a.href = data; a.download = name; G.document.body.appendChild(a); a.click(); a.remove();
      });
    }).then(null, function (e) { if (!(e && e.name === "AbortError")) H.toast("The progress card could not be shared."); }).then(function () { btn.disabled = false; });
  }
  A.drawCard = function (s, td) { return drawCard(s || H.store(), td || H.today()); };

  // me/stats: { player: { rating, battles, wins }, events: [{ kind, score, right, wrong, blank, at }], battles: [{ opp,
  // score, result, rating, endedAt }] (latest 60), trend }. Losses and draws come from the listed battles.
  function arenaStatsHtml(j) {
    var pl = j.player || {}, bl = j.battles || [], w = Number(pl.wins) || 0, d = bl.filter(function (x) { return x.result === "draw"; }).length;
    var l = Math.max(0, (Number(pl.battles) || bl.length) - w - d), evs = (j.events || []).slice(0, 10);
    var day = function (t) { try { return new Date(ms(t)).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (x) { return ""; } };
    return '<section class="pn-panel pn-rec"><div><b>' + esc(String(pl.rating != null ? pl.rating : 1200)) + "</b><small>Battle rating</small></div><div><b>" + w + "</b><small>Won</small></div><div><b>" + l + "</b><small>Lost</small></div><div><b>" + d + "</b><small>Drawn</small></div></section>" +
      (bl.length ? '<h2 class="pn-sec">Recent battles</h2><ul class="pn-mods">' + bl.slice(0, 5).map(function (x) {
        var sc = x.score || [0, 0];
        return '<li><div class="pn-mod static"><span class="pn-mb"><b>vs ' + esc(String(x.opp || "Former player").slice(0, 40)) + "</b><small>" + esc(day(x.endedAt)) + " · " + sc[0] + " to " + sc[1] + (x.rating != null ? " · rating " + x.rating : "") + '</small></span><span class="pn-st' + (x.result === "win" ? " done" : "") + '">' + (x.result === "win" ? "Won" : x.result === "loss" ? "Lost" : "Draw") + "</span></div></li>";
      }).join("") + "</ul>" : "") +
      '<h2 class="pn-sec">Sprints and grand tests</h2>' + (evs.length ? '<ul class="pn-mods">' + evs.map(function (e) {
        return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + (e.kind === "weekly" ? "Weekly grand test" : "Daily sprint") + "</b><small>" + esc(day(e.at)) + (e.right != null ? " · " + e.right + " right, " + (e.wrong || 0) + " wrong" : "") + '</small></span><span class="pn-st">' + esc(String(e.score != null ? e.score : "")) + "</span></div></li>";
      }).join("") + "</ul>" : '<p class="pn-empty">Your sprints and grand tests are listed here.</p>') +
      '<button type="button" class="pn-link pn-danger" data-act="a-leave">' + H.ico("leave") + " Leave the Arena</button>";
  }

  /* ---------- wiring ---------- */
  function act(a, b, host) {
    H = host;
    var v = b.getAttribute("data-v");
    if (a === "a-stats") return H.push(renderStats);
    if (a === "a-share") return shareProgress(b);
    // A battle or consent sheet opened from prep-social.js (friend challenge) works with the Arena flag off.
    if (!on() && !A.sheet && !A.battle) return;
    if (a === "a-retryhome") { A.events = null; return H.rerender(); }
    if (a === "a-event") return openEvent(b.getAttribute("data-k"));
    if (a === "a-start") return startEvent(b);
    if (a === "a-resubmit") { var r = H.run_(); if (r) submitEvent(r); return; }
    if (a === "a-board") return openBoards("event", v);
    if (a === "a-boards") return openBoards("event");
    if (a === "a-tab") { A.board = v; if (v !== "event") A.boardEv = null; if (H.nav) H.nav(0); return H.rerender(); }
    if (a === "a-leave") return leaveArena();
    if (a === "a-join") return join(b);
    if (a === "a-nojoin") { closeSheet(); return; }
    if (a === "a-battle") return openBattle();
    if (a === "a-again") return startBattle();
    if (a === "a-pick") return pick(Number(b.getAttribute("data-k")));
  }
  // PREP.back() asks first: true when this module handled the back (the sheet closed, or the player stayed).
  function back() {
    if (A.sheet) { closeSheet(); return true; }
    if (H && H.stackTop() === renderBattle) {
      var b = A.battle;
      if (b && A.ws && (b.phase === "match" || b.phase === "q" || b.phase === "r") && G.confirm && !G.confirm("Leave the battle? It counts as a loss.")) return true;
      stopBattle(); A.battle = null; A.room = null;
    }
    return false;
  }
  function leave() { stopBattle(); A.battle = null; A.room = null; A.sheet = null; if (A.cd) { G.clearInterval(A.cd); A.cd = 0; } }

  /* For prep-social.js (friends, challenges): host defaults to PREP._host. joined(then) runs then() after Arena consent
     (the same sheet); startBattle({ room, exam }) opens a private battle, room and exam riding on the battle socket's URL;
     leaveArena() is the Leave the Arena confirm and DELETE, which the server also uses to delete every social record. */
  function useHost(host) { H = host || H || (G.PREP && G.PREP._host); return H; }
  function joinedFor(then, host) { if (useHost(host)) joined(then); }
  function startRoomBattle(opts, host) {
    if (!useHost(host)) return;
    joined(function () { A.room = (opts && opts.room) ? String(opts.room) : null; A.roomExam = (opts && opts.exam) ? String(opts.exam) : null; H.push(renderBattle); startBattle(); });
  }
  function leaveFor(host) { if (useHost(host)) leaveArena(); }
  G.PREP_ARENA = { enabled: on, homeHtml: homeHtml, homeMounted: homeMounted, act: act, back: back, leave: leave, joined: joinedFor, startBattle: startRoomBattle, leaveArena: leaveFor, _pure: PURE, _a: A };
})(typeof window !== "undefined" ? window : this);
