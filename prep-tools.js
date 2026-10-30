/* PrepNucleus study tools (owner 2026-10-30): cross out options, a note on any question, My notebook (notes and
   questions marked in tests), how other students answered, anonymous practice statistics and Reset progress.
   window.PREP_TOOLS. ES5. Loaded by prep-loader.js after prep.js (optional: without it every screen renders as before);
   draws through PREP._host. prep.js forwards every data-act starting "x-" here and asks back() first.

   Store (smd_prep_v1; prep-sync.js syncs qn and mk as last-writer-wins maps, like bm):
     qn[id] = [subject, module, note text, saved ms, stem (first 140 chars)]   a note on any question
     mk[id] = [subject, module, marked ms, stem]                               a question marked for review in a test
   Run state: r.strike[i] = { optionIndex: 1 } (cross-outs, this run only; answering a struck option is allowed).

   How others answered: GET /api/prep/stats?pct=1&ids= (functions/api/prep/stats.js). The server returns an item only
   once PCT_MIN_N students have answered it, so nothing shows until the numbers are real. No estimates, no seeded data:
   the bars appear on their own as answers arrive. Practice answers are added (POST, no id of any kind) only when the
   student opted in to anonymous statistics (localStorage smd_prep_stats = "1", the same switch as Tests).

   Reset progress clears answers, memory (FSRS cards), mistakes, coaching and accuracy for one subject or every subject;
   bookmarks, notes, decks and settings stay. With sync on it is refused: sync merges cards by keeping the one further
   along, so a reset would come back from the other copy. Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var STATS = "smd_prep_stats", NOTE_MAX = 2000, MK_MAX = 500, QN_MAX = 2000, FLUSH_AT = 20, BATCH = 60;
  var L = ["A", "B", "C", "D", "E", "F", "G", "H"];

  /* ================= pure ================= */
  function stem(it) { return String((it && it.q) || "").replace(/\s+/g, " ").trim().slice(0, 140); }
  function cleanNote(t) { return String(t == null ? "" : t).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, NOTE_MAX); }
  // setNote(store, it, text, now): an empty text removes the note. -> true when something changed.
  function setNote(s, it, text, now) {
    if (!s || !it || it.id == null) return false;
    var qn = s.qn || (s.qn = {}), t = cleanNote(text), id = String(it.id), old = qn[id];
    if (!t) { if (!old) return false; delete qn[id]; return true; }
    if (old && old[2] === t) return false;
    qn[id] = [it._s || (old && old[0]) || "", it._m || it.t || (old && old[1]) || "", t, now, stem(it) || (old && old[4]) || ""];
    trim(qn, QN_MAX, 3);
    return true;
  }
  function noteOf(s, id) { var x = s && s.qn && s.qn[id]; return x ? x[2] : ""; }
  // Oldest out first when a map passes its cap (k = the index of the saved time).
  function trim(map, max, k) {
    var ids = Object.keys(map); if (ids.length <= max) return;
    ids.sort(function (a, b) { return (map[a][k] || 0) - (map[b][k] || 0); });
    ids.slice(0, ids.length - max).forEach(function (id) { delete map[id]; });
  }
  // The questions a finished test left marked for review. Own deck and previous-year items cannot be reloaded: skipped.
  function noteMarks(s, items, marks, now) {
    var mk = s.mk || (s.mk = {}), n = 0;
    (items || []).forEach(function (it, i) {
      if (!it || it._gone || !marks || !marks[i] || it._s === "deck" || it._py || !it._s) return;
      mk[it.id] = [it._s, it._m || it.t || "", now, stem(it)]; n++;
    });
    trim(mk, MK_MAX, 2);
    return n;
  }
  // One stats row for practice, or null (own deck, no option index the server accepts, a bad id).
  function statRow(it, chosen, ms) {
    if (!it || it.id == null || it._s === "deck" || it.qg) return null;
    var id = String(it.id);
    if (!/^[A-Za-z0-9_.:-]{2,100}$/.test(id)) return null;
    if (chosen > 3 || (it.o && it.o.length > 4)) return null;
    var secs = Math.max(0, Math.min(3600, Math.round((ms || 0) / 1000)));
    return chosen >= 0 ? [id, chosen === it.a ? 1 : 0, secs, chosen] : [id, null, secs, -1];
  }
  // The stats endpoint knows test profiles and the exam tabs; the two MRCP tabs share "mrcp".
  function statExam(tab) { tab = String(tab || ""); return tab.indexOf("mrcp") === 0 ? "mrcp" : tab; }

  /* resetPlan(store, mods | null) -> the keys a reset would clear, without touching the store. mods = { moduleId: 1 } for
     one subject, null for every subject. A card key is "p:<module>:<question>" or "p:<module>:c:<card>". */
  function resetPlan(s, mods, sid) {
    var out = { cards: [], mod: [], mt: [], conf: [], ky: [], coach: [], ra: 0 };
    var inMod = function (m) { return mods ? !!mods[m] : true; };
    Object.keys(s.cards || {}).forEach(function (k) { if (k.indexOf("p:") !== 0) return; if (inMod(k.split(":")[1])) out.cards.push(k); });
    Object.keys(s.conf || {}).forEach(function (k) { if (k.indexOf("p:") === 0 && inMod(k.slice(2))) out.conf.push(k); });
    Object.keys(s.mod || {}).forEach(function (m) { if (inMod(m)) out.mod.push(m); });
    Object.keys(s.mt || {}).forEach(function (id) { var x = s.mt[id]; if (!mods || (x && (x[0] === sid || mods[x[1]]))) out.mt.push(id); });
    Object.keys(s.coach_t || {}).forEach(function (k) { if (!mods || k.split("|")[0] === sid) out.coach.push(k); });
    (s.ra || []).forEach(function (e) { if (inMod(e[0])) out.ra++; });
    // IQoach question tallies are keyed by question id only: the subject's ids come from its cards and mistakes.
    if (s.ky_q) {
      var ids = {};
      out.cards.forEach(function (k) { var p = k.split(":"); if (p.length === 3) ids[p[2]] = 1; });
      out.mt.forEach(function (id) { ids[id] = 1; });
      Object.keys(s.ky_q).forEach(function (id) { if (!mods || ids[id]) out.ky.push(id); });
    }
    return out;
  }
  function resetApply(s, mods, sid, opts) {
    var p = resetPlan(s, mods, sid);
    p.cards.forEach(function (k) { delete s.cards[k]; });
    p.conf.forEach(function (k) { delete s.conf[k]; });
    p.mod.forEach(function (m) { delete s.mod[m]; });
    p.mt.forEach(function (id) { delete s.mt[id]; });
    p.coach.forEach(function (k) { delete s.coach_t[k]; if (s.coach_pairs) delete s.coach_pairs[k]; });
    p.ky.forEach(function (id) { delete s.ky_q[id]; });
    s.ra = (s.ra || []).filter(function (e) { return mods ? !mods[e[0]] : false; });
    if (!mods) { s.ky_ty = {}; s.ky_cal = {}; s.coach_pairs = {}; s.days = {}; s.last = null; if (opts && opts.tests) { s.mh = []; s.t2h = []; s.t2d = {}; } }
    else if (s.last && mods[s.last.m]) s.last = null;
    s.pt = null;   // today's plan is made again from what is left
    return p;
  }

  /* ================= browser ================= */
  if (NODE) {
    module.exports = { stem: stem, cleanNote: cleanNote, setNote: setNote, noteOf: noteOf, noteMarks: noteMarks, statRow: statRow, statExam: statExam,
      resetPlan: resetPlan, resetApply: resetApply, NOTE_MAX: NOTE_MAX };
    return;
  }
  // Flag smd_prep_tools, default ON (owner 2026-10-30): localStorage "0" or ?tools=0 leaves PREP_TOOLS undefined, so
  // every screen renders exactly as before.
  try { var qf = (G.location.search.match(/[?&]tools=([^&]+)/) || [])[1]; if (qf === "0" || (qf == null && G.localStorage.getItem("smd_prep_tools") === "0")) return; } catch (e) {}
  var D = G.document, H = null;
  var T = { sheet: null, prev: null, nb: "notes", rs: { sid: "", tests: false, ask: false }, peer: {}, asked: {}, q: {} };
  // The host is bound by every entry prep.js calls; a render before any tools action or home row binds it here.
  function h0() { if (!H && G.PREP && G.PREP._host) H = G.PREP._host; return H; }
  function esc(s) { return H.esc(s); }
  function ic(path, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>"; }
  var IC = { note: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>', strike: '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>', book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7"/><path d="M4 4v4.7h4.7"/>' };
  function store() { return H.store(); }
  function statsOn() { try { return G.localStorage.getItem(STATS) === "1"; } catch (e) { return false; } }
  function statsChoice() { try { return G.localStorage.getItem(STATS); } catch (e) { return null; } }
  function syncOn() { try { return !!(G.PREP_SYNC && G.PREP_SYNC.status().on); } catch (e) { return false; } }
  function subjName(sid) { var sb = H.subjectById(sid); return sb ? H.tx(sb.name) : sid === "pyq" ? "Previous year" : sid || ""; }
  function dayMonth(t) { try { return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) { return ""; } }

  /* ---------- cross out options ---------- */
  function struck(r, k) { return !!(r && r.strike && r.strike[r.i] && r.strike[r.i][k]); }
  // The small button beside an option, before the answer only. Inside the option's <li>, never inside its button.
  function strikeBtn(r, k, shown, locked) {
    if (shown || locked || !r || r.done) return "";
    var on = struck(r, k);
    return '<button type="button" class="pn-ib px-strike' + (on ? " on" : "") + '" data-act="x-strike" data-k="' + k + '" aria-pressed="' + on + '" aria-label="' + (on ? "Bring back option " : "Cross out option ") + L[k] + '">' + ic(IC.strike, 18) + "</button>";
  }
  function toggleStrike(k) {
    var r = H.run_(); if (!r || r.done) return;
    var m = r.strike || (r.strike = {}), row = m[r.i] || (m[r.i] = {});
    if (row[k]) delete row[k]; else row[k] = 1;
    H.rerender();
  }

  /* ---------- notes ---------- */
  function noteBtn(it) {
    if (!h0() || !it || it.id == null) return "";
    var has = !!noteOf(store(), it.id);
    return '<button type="button" class="pn-ib px-nb' + (has ? " on" : "") + '" data-act="x-note" aria-label="' + (has ? "Edit your note" : "Add a note to this question") + '">' + ic(IC.note) + "</button>";
  }
  function noteHtml(it) {
    if (!h0()) return "";
    var t = it && noteOf(store(), it.id);
    return t ? '<aside class="px-note" aria-label="Your note"><b>Your note</b><p>' + esc(t).replace(/\n/g, "<br>") + '</p><button type="button" class="pn-link" data-act="x-note">Edit note</button></aside>' : "";
  }
  function openNote(it, from) {
    if (!it) return;
    closeSheet(true);
    var t = noteOf(store(), it.id), el = D.createElement("div");
    el.className = "pn-sheet-wrap"; el.id = "pxSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="x-close"></div><section class="pn-sheet px-sheet" role="dialog" aria-modal="true" aria-labelledby="pxNoteT" tabindex="-1">' +
      '<span class="pn-grab" aria-hidden="true"></span><h2 id="pxNoteT">' + (t ? "Your note" : "Add a note") + "</h2>" +
      '<p class="pn-mut pn-small px-stem">' + esc(stem(it)) + "</p>" +
      '<label class="pn-sr" for="pxNoteIn">Note</label><textarea id="pxNoteIn" class="pn-in px-ta" rows="6" maxlength="' + NOTE_MAX + '" placeholder="A mnemonic, the trap, where you read it">' + esc(t) + "</textarea>" +
      '<p class="pn-mut pn-small">Kept on this phone, in My notebook. Synced with your account when sync is on.</p>' +
      '<div class="pn-sheet-act">' + (t ? '<button type="button" class="pn-btn" data-act="x-ndel">Delete</button>' : "") + '<button type="button" class="pn-btn pri" data-act="x-nsave">Save</button></div></section>';
    T.sheet = el; T.prev = from || D.activeElement; T.item = it;
    H.root().appendChild(el);
    var ta = el.querySelector("#pxNoteIn"); try { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
  }
  function saveNote(del) {
    var it = T.item, el = T.sheet; if (!it || !el) return;
    var t = del ? "" : el.querySelector("#pxNoteIn").value, s = store();
    if (setNote(s, it, t, Date.now())) { H.save(); H.toast(cleanNote(t) ? "Note saved" : "Note deleted"); }
    closeSheet(); H.rerender();
  }
  function closeSheet(quiet) {
    if (!T.sheet) return false;
    if (T.sheet.parentNode) T.sheet.parentNode.removeChild(T.sheet);
    T.sheet = null; T.item = null;
    if (!quiet) try { if (T.prev && T.prev.isConnected) T.prev.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }

  /* ---------- My notebook ---------- */
  function notebookRow(h) {
    H = h; var s = store(), n = Object.keys(s.qn || {}).length, m = Object.keys(s.mk || {}).length;
    return H.row("x-notebook", ic(IC.book), "My notebook", (n || m) ? H.fmt(n) + (n === 1 ? " note" : " notes") + " · " + H.fmt(m) + " marked in tests" : "Your notes and questions marked in tests");
  }
  function renderNotebook() {
    var s = store(), tab = T.nb, map = tab === "notes" ? (s.qn || {}) : (s.mk || {}), k = tab === "notes" ? 3 : 2;
    var ids = Object.keys(map).sort(function (a, b) { return (map[b][k] || 0) - (map[a][k] || 0); });
    var nN = Object.keys(s.qn || {}).length, nM = Object.keys(s.mk || {}).length;
    var tabs = '<div class="pn-wrap pn-seg4 px-tabs" role="tablist" aria-label="Notebook">' + [["notes", "Notes", nN], ["marked", "Marked in tests", nM]].map(function (x) {
      return '<button type="button" role="tab" class="pn-chip' + (tab === x[0] ? " on" : "") + '" aria-selected="' + (tab === x[0]) + '" data-act="x-nbtab" data-v="' + x[0] + '">' + x[1] + " (" + x[2] + ")</button>";
    }).join("") + "</div>";
    var list = ids.length ? '<ul class="px-list">' + ids.slice(0, 300).map(function (id) {
      var x = map[id], st = tab === "notes" ? x[4] : x[3];
      return '<li class="pn-panel"><p class="pn-mut pn-small">' + esc(subjName(x[0])) + " · " + esc(dayMonth(x[k])) + "</p>" + (st ? '<p class="px-q">' + esc(st) + "</p>" : "") +
        (tab === "notes" ? '<p class="px-nt">' + esc(x[2]).replace(/\n/g, "<br>") + "</p>" : "") +
        '<div class="pn-navrow"><button type="button" class="pn-btn sm" data-act="x-nbone" data-v="' + esc(id) + '">Practise</button><button type="button" class="pn-link" data-act="x-nbdel" data-v="' + esc(id) + '">' + (tab === "notes" ? "Delete note" : "Remove") + "</button></div></li>";
    }).join("") + "</ul>" : '<p class="pn-mut px-empty">' + (tab === "notes" ? "No notes yet. Tap the pencil on any question to write one." : "Nothing marked. Questions you mark for review in a timed test land here.") + "</p>";
    var can = ids.some(function (id) { return map[id][0] && map[id][0] !== "deck"; });
    H.paint(H.bar("My notebook", "", "back") + '<div class="pn-body px-nb-body">' + tabs +
      (can ? '<button type="button" class="pn-btn pri" data-act="x-nbrun">' + H.ico("play") + " Practise these (" + Math.min(50, ids.length) + ")</button>" : "") + list + "</div>");
  }
  // Practise notebook questions: reload them from their module files (like bookmarks), shuffled, 50 at most.
  function practise(ids, title) {
    var s = store(), by = {};
    ids.forEach(function (id) { var x = (s.qn && s.qn[id]) || (s.mk && s.mk[id]); if (!x || !x[0] || !x[1] || x[0] === "deck") return; (by[x[0] + "|" + x[1]] = by[x[0] + "|" + x[1]] || {})[id] = 1; });
    var keys = Object.keys(by);
    if (!keys.length) return H.toast("These questions cannot be reloaded.");
    H.loadingScreen(title, "Loading your questions…");
    Promise.all(keys.map(function (k) { var p = k.split("|"); return H.loadModule(p[0], p[1]).then(function (items) { return H.pool(items).filter(function (it) { return by[k][it.id]; }); }, function () { return []; }); }))
      .then(function (lists) {
        var all = []; lists.forEach(function (l) { all = all.concat(l); });
        if (!all.length) { H.toast("These questions need a connection to load once."); return H.rerender(); }
        H.run(H.shuffle(all).slice(0, 50), "study", title);
      });
  }

  /* ---------- how others answered ---------- */
  function prefetch(items) {
    if (!G.fetch || !h0()) return;
    var ids = (items || []).filter(function (it) { return it && it.id != null && it._s !== "deck" && !it.qg && T.peer[it.id] === undefined && !T.asked[it.id]; }).map(function (it) { return String(it.id); });
    for (var i = 0; i < ids.length; i += BATCH) fetchPeer(ids.slice(i, i + BATCH));
  }
  function fetchPeer(ids) {
    ids.forEach(function (id) { T.asked[id] = 1; });
    var url = (G.SMD_PREP_STATS_API || "/api/prep/stats") + "?pct=1&ids=" + ids.map(encodeURIComponent).join(",");
    G.fetch(url, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var got = (j && j.items) || {};
      ids.forEach(function (id) { T.peer[id] = got[id] && got[id].o ? got[id] : 0; });
      var r = H && H.run_ && H.run_(), it = r && !r.done && r.items[r.i];
      if (it && got[it.id] && r.ans[r.i] >= 0 && r.mode === "study") H.rerender();
    }, function () { ids.forEach(function (id) { delete T.asked[id]; }); });
  }
  function peerHtml(it, chosen) {
    if (!h0()) return "";
    var d = it && T.peer[it.id];
    if (!d || !d.o) return "";
    var n = Math.min(d.o.length, (it.o || []).length);
    var rows = "";
    for (var k = 0; k < n; k++) {
      var p = Math.max(0, Math.min(100, d.o[k] || 0)), cls = k === it.a ? " ok" : k === chosen ? " me" : "";
      rows += '<li class="px-pr' + cls + '"><span class="pn-l">' + L[k] + '</span><span class="px-pb" aria-hidden="true"><i style="transform:scaleX(' + (p / 100).toFixed(3) + ')"></i></span><span class="px-pv">' + p + "%</span>" +
        '<span class="pn-sr">Option ' + L[k] + ", " + p + " percent" + (k === it.a ? ", the right answer" : "") + (k === chosen ? ", your pick" : "") + "</span></li>";
    }
    return '<section class="px-peer" aria-label="How other students answered"><h3>How others answered</h3><ul>' + rows + '</ul><p class="pn-mut pn-small">' + H.fmt(d.n) + " PrepNucleus answers</p></section>";
  }
  // Practice answers into the anonymous statistics (only with the switch on). Tests 2 sends its own.
  function noteAnswer(it, chosen, ms, tab) {
    if (!statsOn() || !h0()) return;
    var row = statRow(it, chosen, ms); if (!row) return;
    var ex = statExam(tab), q = T.q[ex] || (T.q[ex] = []);
    q.push(row);
    if (q.length >= FLUSH_AT) flush();
  }
  function flush() {
    if (!G.fetch) return;
    Object.keys(T.q).forEach(function (ex) {
      var rows = T.q[ex]; delete T.q[ex];
      if (!rows || !rows.length) return;
      var seen = {}, uniq = rows.filter(function (x) { if (seen[x[0]]) return false; seen[x[0]] = 1; return true; });
      try { G.fetch((G.SMD_PREP_STATS_API || "/api/prep/stats"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, exam: ex, type: "practice", items: uniq }), keepalive: true, credentials: "omit" }).then(null, function () {}); } catch (e) {}
    });
  }

  /* ---------- progress and data: statistics switch and Reset progress ---------- */
  function dataRow(h) { H = h; return H.row("x-data", ic(IC.reset), "Progress and data", "Anonymous statistics, reset progress"); }
  function renderData() {
    var s = store(), subs = H.subjectsOf(s.exam), rs = T.rs, ch = statsChoice(), sync = syncOn();
    if (rs.sid && rs.sid !== "*" && !subs.some(function (sb) { return sb.id === rs.sid; })) rs.sid = "";
    var chip = function (v, label) { var on = rs.sid === v; return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="x-rsub" data-v="' + esc(v) + '">' + label + "</button>"; };
    H.paint(H.bar("Progress and data", "", "back") + '<div class="pn-body px-data">' +
      '<section class="pn-panel"><h2 class="pn-sec">Anonymous statistics</h2><p class="pn-mut pn-small">Share each answer\'s question number, right or wrong, the option picked and the time taken. Nothing that identifies you is sent. It feeds "How others answered" and test ranks for everyone.</p>' +
      '<button type="button" class="pn-btn' + (ch === "1" ? "" : " pri") + '" data-act="x-stats" aria-pressed="' + (ch === "1") + '">' + (ch === "1" ? "On: tap to stop sharing" : "Share anonymous statistics") + "</button></section>" +
      '<section class="pn-panel"><h2 class="pn-sec">Reset progress</h2><p class="pn-mut pn-small">Clears answers, memory schedule, mistakes, coaching and accuracy. Bookmarks, notes, your decks and settings stay. This cannot be undone.</p>' +
      (sync ? '<p class="px-warn" role="note">Sync is on. A reset here would come back from your synced copy. Turn sync off in Settings first.</p>' :
        '<div class="pn-wrap">' + chip("*", "Every subject") + subs.map(function (sb) { return chip(sb.id, H.tx(sb.name)); }).join("") + "</div>" +
        (rs.sid === "*" ? '<label class="px-chk"><input type="checkbox" data-act="x-rtests"' + (rs.tests ? " checked" : "") + "> Also clear test and mock history</label>" : "") +
        '<button type="button" class="pn-btn px-danger" data-act="x-rgo"' + (rs.sid ? "" : " disabled") + ">" + (rs.sid ? "Reset " + esc(rs.sid === "*" ? "every subject" : subjName(rs.sid)) : "Pick what to reset") + "</button>") +
      "</section></div>");
  }
  function askReset() {
    var rs = T.rs; if (!rs.sid || syncOn()) return;
    closeSheet(true);
    var what = rs.sid === "*" ? "every subject" : subjName(rs.sid), el = D.createElement("div");
    el.className = "pn-sheet-wrap"; el.id = "pxSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="x-close"></div><section class="pn-sheet px-sheet" role="alertdialog" aria-modal="true" aria-labelledby="pxRsT" aria-describedby="pxRsD" tabindex="-1">' +
      '<span class="pn-grab" aria-hidden="true"></span><h2 id="pxRsT">Reset ' + esc(what) + "?</h2>" +
      '<p id="pxRsD">Every answer, review date, mistake and accuracy figure for ' + esc(what) + " on this phone is cleared" + (rs.sid === "*" ? ", with your streak" + (rs.tests ? " and test history" : "") : "") + ". This cannot be undone.</p>" +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn" data-act="x-close">Cancel</button><button type="button" class="pn-btn px-danger" data-act="x-rdo">Reset</button></div></section>';
    T.sheet = el; T.prev = D.activeElement;
    H.root().appendChild(el);
    try { el.querySelector("[data-act=x-close].pn-btn").focus({ preventScroll: true }); } catch (e) {}
  }
  function doReset() {
    var rs = T.rs, s = store(); if (!rs.sid || syncOn()) return closeSheet();
    var fin = function (mods) {
      var p = resetApply(s, mods, rs.sid === "*" ? null : rs.sid, { tests: rs.tests });
      H.save(); closeSheet(true);
      H.toast(p.cards.length || p.mod.length || p.mt.length ? "Progress reset" : "Nothing to reset");
      rs.sid = ""; rs.tests = false;
      if (G.PREP_NATIVE) G.PREP_NATIVE.changed();
      H.rerender();
    };
    if (rs.sid === "*") return fin(null);
    H.loadIndex(rs.sid).then(function (ix) {
      var mods = {}; ((ix && ix.topics) || []).forEach(function (t) { mods[t.id] = 1; });
      // Modules this phone has answered in that the index no longer lists still belong to the subject by their mistakes.
      Object.keys(s.mt || {}).forEach(function (id) { var x = s.mt[id]; if (x && x[0] === rs.sid && x[1]) mods[x[1]] = 1; });
      fin(mods);
    }, function () { closeSheet(true); H.toast("The subject list needs a connection once. Try again online."); });
  }

  /* ---------- actions ---------- */
  function act(a, b, h) {
    H = h;
    var v = b.getAttribute("data-v"), r = H.run_();
    if (a === "x-strike") return toggleStrike(Number(b.getAttribute("data-k")));
    if (a === "x-note") { var it = r && r.items[r.i]; return openNote(it, b); }
    if (a === "x-nsave") return saveNote(false);
    if (a === "x-ndel") return saveNote(true);
    if (a === "x-close") return closeSheet();
    if (a === "x-notebook") return H.push(renderNotebook);
    if (a === "x-nbtab") { T.nb = v === "marked" ? "marked" : "notes"; return H.rerender(); }
    if (a === "x-nbdel") { var s = store(); if (T.nb === "notes") { if (s.qn) delete s.qn[v]; } else if (s.mk) delete s.mk[v]; H.save(); return H.rerender(); }
    if (a === "x-nbone") return practise([v], "My notebook");
    if (a === "x-nbrun") { var m = T.nb === "notes" ? store().qn || {} : store().mk || {}; return practise(Object.keys(m), T.nb === "notes" ? "My notes" : "Marked in tests"); }
    if (a === "x-data") return H.push(renderData);
    if (a === "x-stats") { try { G.localStorage.setItem(STATS, statsChoice() === "1" ? "0" : "1"); } catch (e) {} return H.rerender(); }
    if (a === "x-rsub") { T.rs.sid = T.rs.sid === v ? "" : v; if (v !== "*") T.rs.tests = false; return H.rerender(); }
    if (a === "x-rtests") { T.rs.tests = !!b.checked; return; }
    if (a === "x-rgo") return askReset();
    if (a === "x-rdo") return doReset();
  }
  function back() { return closeSheet(); }
  // Called by prep.js: a finished test's marks, and leaving PrepNucleus (send what is queued).
  function finished(h, r) {
    H = h;
    if (r && r.mode === "exam" && r.mark && noteMarks(store(), r.items, r.mark, Date.now())) H.save();
    flush();
  }
  function bind(h) { H = h; }

  G.PREP_TOOLS = { bind: bind, act: act, back: back, strikeBtn: strikeBtn, struck: struck, noteBtn: noteBtn, noteHtml: noteHtml, peerHtml: peerHtml, prefetch: prefetch,
    noteAnswer: noteAnswer, flush: flush, finished: finished, notebookRow: notebookRow, dataRow: dataRow,
    _pure: { stem: stem, cleanNote: cleanNote, setNote: setNote, noteOf: noteOf, noteMarks: noteMarks, statRow: statRow, statExam: statExam, resetPlan: resetPlan, resetApply: resetApply } };
})(typeof window !== "undefined" ? window : this);
