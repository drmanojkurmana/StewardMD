/* PrepNucleus friends, challenges, college boards, study groups and the public accuracy page: window.PrepSocial. ES5.
   Drawn through PREP._host (the same overlay and back stack as prep.js and prep-arena.js). Entry points (prep.js):
   PrepSocial.open(tab) with tab "friends" | "boards" | "groups", and PrepSocial.openAccuracy().

   Everything social needs Arena consent first (PREP_ARENA.joined shows the same Join sheet). Friend challenges play
   through PREP_ARENA.startBattle({ room }). Leave the Arena (PREP_ARENA.leaveArena) deletes friends, challenges, the
   college tag and group memberships with the Arena results; each one can also be removed on its own here.

   Server: /api/prep/social/* (Bearer Firebase ID token), SMD_PREP_SOCIAL_API overrides. Accuracy: prep/accuracy.json
   (tools/prep-accuracy.mjs), SMD_PREP_ACCURACY overrides; prep/accuracy.html renders the same accuracyHtml(). */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { n = Number(n) || 0; try { return n.toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function pct(x, dp) { return x == null ? "" : (x * 100).toFixed(dp || 0) + "%"; }
  function ms(t) { t = Number(t); return !isFinite(t) || t <= 0 ? 0 : t < 1e12 ? t * 1000 : t; }
  function initials(name) { var p = String(name || "?").trim().split(/\s+/); return ((p[0] || "?").charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase(); }
  function day(t) { try { return new Date(ms(t)).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) { return ""; } }
  // Minutes or hours left until t, for challenge invites.
  function left(t, now) { var m = Math.round((ms(t) - now) / 60000); return m <= 0 ? "expired" : m < 60 ? m + " min left" : Math.round(m / 60) + " h left"; }
  // A StewardMD ID or group code as typed: trimmed, inner spaces dropped, upper case.
  function cleanId(s) { return String(s || "").replace(/\s+/g, "").toUpperCase().slice(0, 40); }
  // Plain words for the server's refusals.
  function errWord(status, code) {
    if (status === 401) return "Sign in to use friends and groups.";
    if (status === 404 && !code) return "Friends and groups are not open yet. Try again later.";
    code = String(code || "").replace(/-/g, "_");
    var W = { not_found: "No one has that ID or code. Check it and try again.", self: "That is your own StewardMD ID.",
      consent_required: "Join the Arena first.", no_smd_id: "Your account does not have a StewardMD ID yet.", lookup_failed: "Could not look that up right now. Try again in a moment.",
      not_friends: "You can only challenge friends.", bad_exam: "Challenges are open for NEET-PG, NEET-SS and USMLE.", bad_request: "Check what you typed and try again.",
      already: "Already done: you are friends, or a request is waiting.", not_in_arena: "They have not joined the Arena yet. Friends need to join it too.",
      limit: "You have reached the limit. Remove one first.", full: "This group is full: 30 members.", expired: "This challenge has expired." };
    return W[code] || "That did not work. Check the connection and try again.";
  }

  /* The accuracy page body from accuracy.json; also used by prep/accuracy.html. Text carries every number, the bars
     only repeat them. */
  function accuracyHtml(j) {
    if (!j) return '<p class="pn-err" role="alert">The accuracy numbers did not load. Check the connection and try again.</p>';
    // Owner rule (2026-10-07): keys and reports only; how content is written and where it comes from is in the Terms.
    var NA = '<span class="ps-na">Not yet published</span>', k = j.keys;
    var max = 0, h = "";
    h += '<p class="ps-lede">Every number on this page is computed by a script from our own build records, not typed by hand. Where we have no record yet, we say so.</p>';
    // Round 4: the one figure first (keys that matched the independent check), then the detail.
    if (k && k.screened) h += '<section class="ps-hero" aria-label="Answer keys that matched"><b>' + pct(1 - k.rate, 1) + "</b><span>of answer keys matched an independent check</span><small>" + fmt(k.screened) + " questions checked</small></section>";
    h += '<h2 class="pn-h">Answer keys</h2>';
    if (k) {
      (k.subjects || []).forEach(function (s) { if (s.rate > max) max = s.rate; });
      h += '<p class="ps-say">An independent check answered all <b>' + fmt(k.screened) + "</b> questions in the bank without seeing the key. It chose a different answer on <b>" +
        fmt(k.disputed) + "</b> (" + pct(k.rate, 1) + "). Those questions are hidden from practice until they are reviewed.</p>" +
        '<section class="ps-chart" aria-labelledby="psKeysT"><h3 class="pn-sec" id="psKeysT">Disputed keys by subject</h3><p class="pn-mut pn-small">Share of each subject\'s questions where the check disagreed, highest first.</p>' +
        '<ol class="ps-bars">' + (k.subjects || []).map(function (s) {
          return '<li><span class="ps-bn">' + esc(s.name) + '</span><span class="ps-bv">' + pct(s.rate, 1) + '</span><span class="ps-bar" aria-hidden="true"><i style="width:' + (max ? Math.max(1, Math.round(s.rate * 1000 / max) / 10) : 0) + '%"></i></span>' +
            '<small class="ps-bs">' + fmt(s.disputed) + " of " + fmt(s.screened) + "</small></li>";
        }).join("") + "</ol></section>";
    } else h += "<p>" + NA + "</p>";
    h += '<h2 class="pn-h">Student reports</h2><dl class="ps-facts">' +
      "<div><dt>Questions reported as wrong or unclear</dt><dd>" + (j.reports && j.reports.reported != null ? fmt(j.reports.reported) : NA) + "</dd></div>" +
      "<div><dt>Hidden after " + esc(String((j.reports && j.reports.hideAfter) || 3)) + " separate reports</dt><dd>" + (j.reports && j.reports.autoHidden != null ? fmt(j.reports.autoHidden) : NA) + "</dd></div>" +
      "<div><dt>Median time from a report to its fix</dt><dd>" + (j.fixTime && j.fixTime.medianHours != null ? esc(String(j.fixTime.medianHours)) + " hours" : NA) + "</dd></div></dl>" +
      '<p class="pn-mut pn-small">Reports are stored on our server. These counts appear here once we export them.</p>';
    h += '<h2 class="pn-h">How these numbers are made</h2><ul class="ps-how">' +
      "<li>A script reads the records our build tools write. This page shows those numbers and nothing else.</li>" +
      "<li>Answer keys: the newest key screen" + (k && k.date ? " (" + esc(k.date) + ")" : "") + ". A different answer is a dispute, not proof the key is wrong; a person checks it before it returns.</li>" +
      "<li>Reports and fix times come from the report button on every question. Until we export them, they read “Not yet published”.</li></ul>" +
      '<p class="pn-note">Updated ' + esc(j.generated || "") + "</p>";
    return h;
  }
  var PURE = { esc: esc, initials: initials, left: left, cleanId: cleanId, errWord: errWord, accuracyHtml: accuracyHtml };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  if (G.PrepSocial) return;   // loaded twice: the first copy keeps the listeners
  var API = G.SMD_PREP_SOCIAL_API || "/api/prep/social/";
  var ACC = G.SMD_PREP_ACCURACY || "/prep/accuracy.json";
  var S = { tab: "friends", fr: null, ch: null, colleges: null, college: null, scope: "college", board: null, groups: null, gcode: null, gboard: null, acc: null, err: {} };
  var H = null;

  function host() { return (H = G.PREP && G.PREP._host); }
  function user() { try { var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function api(method, path, body) {
    var u = user(), tp; try { tp = u && u.getIdToken ? u.getIdToken() : Promise.resolve(null); } catch (e) { tp = Promise.resolve(null); }
    return tp.then(function (tok) {
      if (!tok) { var e0 = new Error("signin"); e0.status = 401; throw e0; }
      var o = { method: method, headers: { Authorization: "Bearer " + tok }, cache: "no-store" };
      if (body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
      return G.fetch(API + path, o);
    }).then(function (r) {
      return r.json().then(null, function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.error) || "HTTP " + r.status); e.status = r.status; e.code = j && j.error; throw e; } return j || {}; });
    });
  }
  function errText(e) { return G.navigator && G.navigator.onLine === false ? "Needs a connection." : errWord(e && e.status, e && e.code); }
  function root() { return H && H.root(); }
  function top(view) { return H && H.stackTop() === view; }
  function ico(n) { return H.ico(n); }
  function onScreen(view) { if (top(view)) view(); }

  /* ---------- open ---------- */
  // Runs then() with the overlay open: PrepNucleus opens first when it is closed (its home goes under this screen).
  // Runs then() with the overlay open: PrepNucleus opens first when it is closed (its home goes under this screen). Until
  // its first open, window.PREP is prep-loader.js's stub, which loads prep.js; so wait for the real host.
  function withOverlay(then) {
    if (!G.PREP) return;
    var ready = function () { return !!(G.PREP._host && G.PREP._st && G.PREP.isOpen() && G.PREP._st.stack.length); };
    if (ready()) { host(); return then(); }
    if (!G.PREP.isOpen()) G.PREP.open();
    var t0 = Date.now(), iv = G.setInterval(function () {
      if (ready()) { G.clearInterval(iv); host(); then(); } else if (Date.now() - t0 > 20000) G.clearInterval(iv);
    }, 60);
  }
  // open(tab) or open(host, tab): prep.js passes its host first.
  function open(a, b) {
    var tab = typeof a === "string" ? a : b;
    S.tab = tab === "boards" || tab === "groups" ? tab : "friends";
    withOverlay(function () {
      if (!G.PREP_ARENA || !G.PREP_ARENA.joined) return H.toast("Friends and groups are not available in this version.");
      G.PREP_ARENA.joined(function () { H.push(renderMain); progress(); load(); }, H);
    });
  }
  function openAccuracy() {
    withOverlay(function () {
      H.push(renderAccuracy);
      if (!S.acc) G.fetch(ACC, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { S.acc = j; onScreen(renderAccuracy); }, function () { S.acc = false; onScreen(renderAccuracy); });
    });
  }
  function renderAccuracy() {
    H.paint(H.bar("Accuracy", "How often our questions are wrong", "back") + '<div class="pn-body ps-acc">' +
      (S.acc == null ? '<p class="pn-load" role="status">Loading the numbers</p>' : accuracyHtml(S.acc || null)) + "</div>");
  }

  /* ---------- data ---------- */
  // Today's answered count from the practice store, for group targets and the weekly board (the server keeps the max).
  function progress() { try { var n = Number((H.store().days || {})[H.today()]) || 0; api("POST", "progress", { done: Math.min(5000, n) }).then(null, function () {}); } catch (e) {} }
  // The battle exam for a challenge: the current exam when the battle server has it, else the server's default.
  var BATTLE_EXAMS = { "neet-pg": "NEET-PG", "neet-ss": "NEET-SS", "usmle": "USMLE" };
  function battleExam() { var id = H.exam().id; return BATTLE_EXAMS[id] ? id : "neet-pg"; }
  function load() {
    var t = S.tab;
    if (t === "friends") {
      api("GET", "friends").then(function (j) { S.fr = j; S.err.friends = null; onScreen(renderMain); }, fail("friends"));
      api("GET", "challenges").then(function (j) { S.ch = j; onScreen(renderMain); }, function () { S.ch = { incoming: [], outgoing: [] }; });
    } else if (t === "boards") {
      api("GET", "college").then(function (j) {
        S.college = j && j.college ? { college: j.college, state: j.state || "", key: j.key || "", stateKey: j.stateKey || "" } : false; S.err.boards = null; onScreen(renderMain);
        if (S.college) loadBoard(); else if (!S.colleges) api("GET", "college-list").then(function (c) { S.colleges = c.colleges || []; onScreen(renderMain); }, function () { S.colleges = []; });
      }, fail("boards"));
    } else { progress(); api("GET", "groups").then(function (j) { S.groups = j.groups || []; S.err.groups = null; onScreen(renderMain); }, fail("groups")); }
  }
  function fail(tab) { return function (e) { S.err[tab] = errText(e); if (e && e.status === 403) return G.PREP_ARENA.joined(load, H); onScreen(renderMain); }; }
  function loadBoard() {
    var c = S.college; if (!c) return;
    S.board = null; onScreen(renderMain);
    var scope = S.scope;
    api("GET", "board?scope=" + scope + "&key=" + encodeURIComponent(scope === "state" ? c.stateKey || c.state : c.key || c.college)).then(function (b) { if (S.scope === scope) { S.board = b; onScreen(renderMain); } },
      function (e) { if (S.scope === scope) { S.board = { error: errText(e) }; onScreen(renderMain); } });
  }

  /* ---------- main: tabs ---------- */
  function renderMain() {
    var tabs = [["friends", "Friends"], ["boards", "College boards"], ["groups", "Study groups"]], body;
    if (S.err[S.tab]) body = '<p class="pn-err" role="alert">' + esc(S.err[S.tab]) + '</p><button type="button" class="pn-btn" data-act="s-reload">Try again</button>';
    else body = S.tab === "friends" ? friendsHtml() : S.tab === "boards" ? boardsHtml() : groupsHtml();
    var keep = keepFocus();
    H.paint(H.bar("Friends and groups", "PrepNucleus Arena", "back") + '<div class="pn-tabs" role="tablist" aria-label="Section">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="pn-tab' + (S.tab === t[0] ? " on" : "") + '" aria-selected="' + (S.tab === t[0]) + '" data-act="s-tab" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + '</div><div class="pn-body ps-body">' + body +
      '<p class="pn-note">Only your name, rating and these choices are shared. Leaving the Arena deletes your friends, challenges, college tag and groups along with your results.</p>' +
      '<button type="button" class="pn-link pn-danger" data-act="s-leave">' + ico("leave") + " Leave the Arena</button></div>", keep.sel);
    keep.restore();
  }
  // Repaints keep what is typed in the forms and where focus was.
  function keepFocus() {
    var r = root(), vals = {}, act = G.document.activeElement, sel = null;
    if (r) Array.prototype.forEach.call(r.querySelectorAll(".ps-body input[id]"), function (i) { vals[i.id] = i.value; });
    if (act && act.id && r && r.contains(act)) sel = "#" + act.id;
    else if (act && r && r.contains(act) && act.getAttribute("data-act") === "s-tab") sel = ".pn-tab.on";
    return { sel: sel, restore: function () { var r2 = root(); if (!r2) return; Object.keys(vals).forEach(function (id) { var i = r2.querySelector("#" + id); if (i && !i.value) i.value = vals[id]; }); } };
  }
  function msg(id) { var m = S.err[id]; return '<p class="ps-msg' + (m && m.ok ? " ok" : "") + '" id="' + id + '" role="status"' + (m ? "" : " hidden") + ">" + (m ? esc(m.t) : "") + "</p>"; }
  function person(name, sub, actions) {
    return '<li class="ps-item"><span class="ps-av" aria-hidden="true">' + esc(initials(name)) + '</span><span class="ps-ib"><b>' + esc(String(name || "Doctor").slice(0, 40)) + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + '</span><span class="ps-act">' + (actions || "") + "</span></li>";
  }
  function btn(act, label, v, cls, aria, exam) { return '<button type="button" class="pn-btn sm' + (cls ? " " + cls : "") + '" data-act="' + act + '" data-v="' + esc(v) + '"' + (exam ? ' data-x="' + esc(exam) + '"' : "") + (aria ? ' aria-label="' + esc(aria) + '"' : "") + ">" + label + "</button>"; }

  /* ---------- friends ---------- */
  function friendsHtml() {
    var f = S.fr, c = S.ch || { incoming: [], outgoing: [] }, now = Date.now(), h = "";
    var inc = (c.incoming || []).filter(function (x) { return ms(x.expiresAt) > now; }), out = (c.outgoing || []).filter(function (x) { return ms(x.expiresAt) > now && x.status !== "declined" && x.status !== "expired"; });
    if (inc.length) h += '<h2 class="pn-sec">Challenges for you</h2><ul class="ps-list">' + inc.map(function (x) {
      var n = (x.from && x.from.name) || "A friend";
      return person(n, esc(BATTLE_EXAMS[x.exam] || "NEET-PG") + " · " + left(x.expiresAt, now), btn("s-chno", "Decline", x.room, "", "Decline the challenge from " + n) + btn("s-chyes", "Play", x.room, "pri", "Accept the challenge from " + n, x.exam));
    }).join("") + "</ul>";
    if (out.length) h += '<h2 class="pn-sec">Challenges you sent</h2><ul class="ps-list">' + out.map(function (x) {
      var n = (x.to && x.to.name) || "your friend";
      return person(n, esc(BATTLE_EXAMS[x.exam] || "NEET-PG") + " · waiting for them · " + left(x.expiresAt, now), btn("s-chjoin", "Join", x.room, "", "Join the battle room for " + n, x.exam));
    }).join("") + "</ul>";
    if (!f) return h + '<p class="pn-load" role="status">Loading your friends</p>';
    if ((f.incoming || []).length) h += '<h2 class="pn-sec">Friend requests</h2><ul class="ps-list">' + f.incoming.map(function (x) {
      return person(x.name, "Asked " + esc(day(x.at)), btn("s-frno", "Decline", x.smdId, "", "Decline " + x.name) + btn("s-fryes", "Accept", x.smdId, "pri", "Accept " + x.name));
    }).join("") + "</ul>";
    h += '<h2 class="pn-sec">Friends</h2>' + ((f.friends || []).length ? '<ul class="ps-list">' + f.friends.map(function (x) {
      return person(x.name, "Since " + esc(day(x.since)), btn("s-chsend", "Challenge", x.smdId, "pri", "Challenge " + x.name + " to a 1v1 battle") +
        '<button type="button" class="pn-ib ps-x" data-act="s-frrm" data-v="' + esc(x.smdId) + '" data-n="' + esc(x.name) + '" aria-label="Remove ' + esc(x.name) + '">' + ico("x") + "</button>");
    }).join("") + "</ul>" : '<p class="ps-empty">No friends yet. Add one with their StewardMD ID, then challenge them to a 1v1 battle.</p>');
    if ((f.outgoing || []).length) h += '<ul class="ps-list ps-quiet">' + f.outgoing.map(function (x) {
      return person(x.name, "Request sent", btn("s-frrm", "Cancel", x.smdId, "", "Cancel the request to " + x.name));
    }).join("") + "</ul>";
    h += '<form class="ps-form" data-sform="s-fradd" novalidate><label for="psFrId">Add a friend by StewardMD ID</label><div class="ps-inrow">' +
      '<input class="pn-in" id="psFrId" name="id" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="40" aria-describedby="psFrMsg">' +
      '<button type="submit" class="pn-btn pri">Add</button></div><small class="pn-mut">They accept before anything is shared. They must be in the Arena too.</small>' + msg("psFrMsg") + "</form>";
    return h;
  }

  /* ---------- college boards ---------- */
  function boardsHtml() {
    var c = S.college;
    if (c == null) return '<p class="pn-load" role="status">Loading</p>';
    if (!c) {
      var list = S.colleges || [], states = {};
      list.forEach(function (x) { if (x.state) states[x.state] = 1; });
      return '<section class="pn-panel ps-intro"><h2 class="pn-sec">Compare with your college</h2><p>Add your college to see boards for your college and your state. Your name and battle rating appear on them. Remove the tag any time.</p></section>' +
        '<form class="ps-form" data-sform="s-colset" novalidate><label for="psCol">College</label><input class="pn-in" id="psCol" list="psColList" autocomplete="off" maxlength="120" name="college" placeholder="Pick from the list or type it…" enterkeyhint="next">' +
        '<datalist id="psColList">' + list.map(function (x) { return '<option value="' + esc(x.name) + '">' + esc(x.state || "") + "</option>"; }).join("") + "</datalist>" +
        '<label for="psState">State</label><input class="pn-in" id="psState" list="psStateList" autocomplete="off" maxlength="60" enterkeyhint="done" name="state" placeholder="Filled in for a college from the list…">' +
        '<datalist id="psStateList">' + Object.keys(states).sort().map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join("") + "</datalist>" +
        '<button type="submit" class="pn-btn pri">Show my college boards</button>' + msg("psColMsg") + "</form>";
    }
    var b = S.board, rows = "";
    if (!b) rows = '<p class="pn-load" role="status">Loading the board</p>';
    else if (b.error) rows = '<p class="pn-err" role="alert">' + esc(b.error) + "</p>";
    else if (!(b.rows || []).length) rows = '<p class="ps-empty">No one else from your ' + (S.scope === "state" ? "state" : "college") + " is on this board yet.</p>";
    else {
      var me = b.me, meIn = false, li = function (x, mine) {
        return '<li class="pn-lb' + (mine ? " me" : "") + '"><span class="pn-lb-r">' + fmt(x.rank) + '</span><span class="pn-lb-n">' + esc(String(x.name || "Doctor").slice(0, 40)) + (mine ? " <small>You</small>" : "") + '</span><span class="pn-lb-v">' + esc(String(x.rating != null ? x.rating : x.score != null ? x.score : "")) + "</span></li>";
      };
      rows = '<ol class="pn-board" aria-label="' + (S.scope === "state" ? "State" : "College") + ' board">' + b.rows.map(function (x) { var m = !!(x.me || (me && x.rank === me.rank && x.name === me.name)); if (m) meIn = true; return li(x, m); }).join("") +
        (me && !meIn ? '<li class="pn-lb-gap" aria-hidden="true"></li>' + li(me, true) : "") + "</ol>";
    }
    return '<div class="ps-seg" role="group" aria-label="Board">' + [["college", "My college"], ["state", "My state"]].map(function (t) {
      return '<button type="button" class="pn-chip' + (S.scope === t[0] ? " on" : "") + '" aria-pressed="' + (S.scope === t[0]) + '" data-act="s-scope" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + '</div><p class="pn-mut pn-small">' + esc(S.scope === "state" ? c.state || "Your state" : c.college) + " · battle rating</p>" + rows +
      '<div class="ps-tag"><span><small>Your college tag</small><b>' + esc(c.college) + (c.state ? ", " + esc(c.state) : "") + '</b></span><button type="button" class="pn-btn sm" data-act="s-coldel">Remove</button></div>';
  }

  /* ---------- study groups ---------- */
  function groupsHtml() {
    var g = S.groups;
    if (!g) return '<p class="pn-load" role="status">Loading your groups</p>';
    var h = '<h2 class="pn-sec">Your groups</h2>' + (g.length ? '<div class="pn-group">' + g.map(function (x) {
      var m = x.members || [], done = m.filter(function (y) { return (y.todayDone || 0) >= (x.dailyTarget || 1); }).length;
      return H.row("s-group", '<span class="ps-gi">' + esc(initials(x.name)) + "</span>", esc(x.name), (x.mine ? "Yours · " : "") + m.length + (m.length === 1 ? " member" : " members") + " · " + done + " hit " + fmt(x.dailyTarget) + " today", ' data-v="' + esc(x.code) + '"');
    }).join("") + "</div>" : '<p class="ps-empty">No groups yet. Make one for your batch, or join with a code a friend sends you.</p>');
    h += '<form class="ps-form" data-sform="s-gnew" novalidate><h2 class="pn-sec">Start a group</h2><label for="psGName">Group name</label><input class="pn-in" id="psGName" maxlength="40" autocomplete="off" enterkeyhint="next" name="group" placeholder="Batch 2021 PG prep…">' +
      '<label for="psGTarget">Daily target, questions each</label><input class="pn-in" id="psGTarget" name="target" type="number" inputmode="numeric" min="5" max="500" step="5" value="30" enterkeyhint="done">' +
      '<button type="submit" class="pn-btn pri">Create group</button>' + msg("psGNewMsg") + "</form>";
    h += '<form class="ps-form" data-sform="s-gjoin" novalidate><h2 class="pn-sec">Join a group</h2><label for="psGCode">Group code</label><div class="ps-inrow"><input class="pn-in ps-code-in" id="psGCode" name="code" maxlength="12" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go">' +
      '<button type="submit" class="pn-btn pri">Join</button></div><small class="pn-mut">Up to 30 members. Members see each other\'s names and how many questions they did today.</small>' + msg("psGJoinMsg") + "</form>";
    return h;
  }
  function groupOf(code) { return (S.groups || []).filter(function (x) { return x.code === code; })[0] || null; }
  function renderGroup() {
    var g = groupOf(S.gcode);
    if (!g) return H.back();
    var m = (g.members || []).slice().sort(function (a, b) { return (b.todayDone || 0) - (a.todayDone || 0); }), t = g.dailyTarget || 1, b = S.gboard;
    H.paint(H.bar(esc(g.name), "Study group", "back") + '<div class="pn-body ps-body">' +
      '<section class="pn-panel ps-share"><span><small>Group code</small><b class="ps-code" translate="no">' + esc(g.code) + '</b></span><button type="button" class="pn-btn sm pri" data-act="s-share" data-v="' + esc(g.code) + '">Share code</button></section>' +
      '<h2 class="pn-sec">Today</h2><p class="pn-mut pn-small">Target: ' + fmt(t) + " questions each</p>" +
      '<ul class="ps-members">' + m.map(function (x) {
        var d = x.todayDone || 0, ok = d >= t;
        return '<li class="' + (ok ? "ok" : "") + '"><span class="ps-mn">' + esc(String(x.name || "Doctor").slice(0, 40)) + '</span><span class="ps-mv">' + (ok ? ico("check") : "") + fmt(d) + '<small> / ' + fmt(t) + '</small></span><span class="pn-meter" aria-hidden="true"><i style="width:' + Math.min(100, Math.round(d * 100 / t)) + '%"></i></span></li>';
      }).join("") + "</ul>" +
      '<h2 class="pn-sec">This week\'s sprint</h2>' + (!b ? '<p class="pn-load" role="status">Loading the week</p>' : b.error ? '<p class="pn-err" role="alert">' + esc(b.error) + "</p>" : !(b.rows || []).length ? '<p class="ps-empty">No sprint scores this week yet.</p>' :
        '<ol class="pn-board" aria-label="This week">' + b.rows.map(function (x, i) { return '<li class="pn-lb"><span class="pn-lb-r">' + (i + 1) + '</span><span class="pn-lb-n">' + esc(String(x.name || "Doctor").slice(0, 40)) + '</span><span class="pn-lb-v">' + fmt(x.score) + "</span></li>"; }).join("") + "</ol>" +
        (b.week ? '<p class="pn-mut pn-small">Daily sprint scores added up, ' + esc(String(b.week)) + "</p>" : "")) +
      '<button type="button" class="pn-link pn-danger" data-act="s-gleave" data-v="' + esc(g.code) + '">' + ico("leave") + " Leave this group</button></div>");
  }
  function openGroup(code) {
    S.gcode = code; S.gboard = null; H.push(renderGroup);
    api("GET", "groups/board?code=" + encodeURIComponent(code)).then(function (b) { if (S.gcode === code) { S.gboard = b; onScreen(renderGroup); } },
      function (e) { if (S.gcode === code) { S.gboard = { error: errText(e) }; onScreen(renderGroup); } });
  }

  /* ---------- actions ---------- */
  function say(id, t, ok) { S.err[id] = t ? { t: t, ok: !!ok } : null; var el = root() && root().querySelector("#" + id); if (el) { el.textContent = t || ""; el.hidden = !t; el.className = "ps-msg" + (ok ? " ok" : ""); } }
  function busy(b, on, label) { if (!b) return; if (on) { b.setAttribute("data-l", b.innerHTML); b.disabled = true; b.textContent = label || "Wait"; } else { b.disabled = false; if (b.getAttribute("data-l")) b.innerHTML = b.getAttribute("data-l"); } }
  // POST, then reload the tab; failures show next to the control (msgId) or as a toast.
  function post(path, body, b, msgId, done) {
    busy(b, true);
    if (msgId) say(msgId, "");
    return api("POST", path, body).then(function (j) { busy(b, false); if (done) done(j); }, function (e) { busy(b, false); if (msgId) say(msgId, errText(e)); else H.toast(errText(e)); });
  }
  function battle(room, exam) { G.PREP_ARENA.startBattle({ room: room, exam: exam || "neet-pg" }, H); }
  function act(a, b) {
    var v = b.getAttribute("data-v");
    if (a === "s-tab") { S.tab = v; if (H && H.nav) H.nav(0); renderMain(); return load(); }
    if (a === "s-reload") { S.err[S.tab] = null; renderMain(); return load(); }
    if (a === "s-leave") return G.PREP_ARENA.leaveArena(H);
    if (a === "s-fryes") return post("friends/accept", { smdId: v }, b, null, function () { H.toast("Friend added."); load(); });
    if (a === "s-frno") return post("friends/decline", { smdId: v }, b, null, load);
    if (a === "s-frrm") {
      var n = b.getAttribute("data-n");
      if (n && G.confirm && !G.confirm("Remove " + n + " from your friends?")) return;
      return post("friends/remove", { smdId: v }, b, null, load);
    }
    if (a === "s-chsend") return post("challenge", { smdId: v, exam: battleExam() }, b, null, function (j) { if (j && j.room) battle(j.room, j.exam || battleExam()); else H.toast(errWord(0)); });
    if (a === "s-chyes") return post("challenge/accept", { room: v }, b, null, function (j) { S.ch = null; battle((j && j.room) || v, (j && j.exam) || b.getAttribute("data-x")); });
    if (a === "s-chno") return post("challenge/decline", { room: v }, b, null, function () { S.ch = null; load(); });
    if (a === "s-chjoin") return battle(v, b.getAttribute("data-x"));
    if (a === "s-scope") { S.scope = v; return loadBoard(); }
    if (a === "s-coldel") return api("DELETE", "college").then(function () { S.college = false; S.board = null; H.toast("College tag removed."); renderMain(); load(); }, function (e) { H.toast(errText(e)); });
    if (a === "s-group") return openGroup(v);
    if (a === "s-share") return share(v);
    if (a === "s-gleave") {
      var g = groupOf(v);
      if (G.confirm && !G.confirm("Leave " + (g ? g.name : "this group") + "? You can join again with its code.")) return;
      return post("groups/leave", { code: v }, b, null, function () { S.groups = (S.groups || []).filter(function (x) { return x.code !== v; }); H.back(); load(); });
    }
  }
  function submit(kind, f) {
    var b = f.querySelector("[type=submit]"), val = function (id) { var i = f.querySelector("#" + id); return i ? String(i.value || "").trim() : ""; };
    if (kind === "s-fradd") {
      var id = cleanId(val("psFrId"));
      if (!id) return say("psFrMsg", "Type your friend's StewardMD ID.");
      return post("friends/add", { smdId: id }, b, "psFrMsg", function () { f.querySelector("#psFrId").value = ""; say("psFrMsg", "Request sent.", true); api("GET", "friends").then(function (j) { S.fr = j; onScreen(renderMain); }); });
    }
    if (kind === "s-colset") {
      var col = val("psCol").slice(0, 120), st = val("psState").slice(0, 60);
      (S.colleges || []).forEach(function (x) { if (!st && x.name === col) st = x.state || ""; });
      if (!col) return say("psColMsg", "Type or pick your college.");
      return post("college", { college: col, state: st }, b, "psColMsg", function () { S.college = { college: col, state: st }; S.scope = "college"; renderMain(); loadBoard(); });
    }
    if (kind === "s-gnew") {
      var name = val("psGName").slice(0, 40), t = Math.round(Number(val("psGTarget")));
      if (!name) return say("psGNewMsg", "Give the group a name.");
      if (!(t >= 5 && t <= 500)) return say("psGNewMsg", "Pick a daily target from 5 to 500 questions.");
      return post("groups/create", { name: name, dailyTarget: t }, b, "psGNewMsg", function (j) {
        api("GET", "groups").then(function (x) { S.groups = x.groups || []; if (j && j.code && groupOf(j.code)) openGroup(j.code); else onScreen(renderMain); });
      });
    }
    if (kind === "s-gjoin") {
      var code = cleanId(val("psGCode"));
      if (!code) return say("psGJoinMsg", "Type the group code.");
      return post("groups/join", { code: code }, b, "psGJoinMsg", function () {
        api("GET", "groups").then(function (x) { S.groups = x.groups || []; if (groupOf(code)) openGroup(code); else onScreen(renderMain); });
      });
    }
  }
  function share(code) {
    var text = "Join my PrepNucleus study group in StewardMD. Group code: " + code;
    var copied = function () { H.toast("Code copied."); };
    try { if (G.navigator.share) return G.navigator.share({ text: text }).then(null, function () {}); } catch (e) {}
    try { if (G.navigator.clipboard) return G.navigator.clipboard.writeText(text).then(copied, function () { H.toast("Group code: " + code); }); } catch (e) {}
    H.toast("Group code: " + code);
  }

  /* ---------- wiring: prep.js routes nothing starting "s-", so the clicks and form submits are taken here ---------- */
  if (G.document) {
    G.document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-act^='s-']") : null;
      if (!b || !host() || !root() || !root().contains(b) || b.disabled || b.getAttribute("aria-disabled") === "true") return;
      act(b.getAttribute("data-act"), b);
    });
    G.document.addEventListener("submit", function (e) {
      var f = e.target, k = f && f.getAttribute && f.getAttribute("data-sform");
      if (!k) return;
      e.preventDefault();
      if (host() && root() && root().contains(f)) submit(k, f);
    });
  }

  G.PrepSocial = { open: open, openAccuracy: openAccuracy, api: api, accuracyHtml: accuracyHtml, _pure: PURE, _s: S };
})(typeof window !== "undefined" ? window : this);
