/* PrepNucleus revision timetable (owner 2026-10-30). window.PREP_TT. ES5. Loaded by prep-loader.js before prep-plan.js
   (optional: without it Today's plan works as before); draws through PREP._host. prep.js forwards every data-act
   starting "tt-" here and asks back() first.

   The student builds it: which subjects and in what order, when the first reading should be finished, and which
   weekdays are rest days. Each subject gets study days in proportion to its module count (at least one), laid end to
   end over the study days between the start and the finish date; the days from the finish to the exam are revision and
   mocks. The blocks are worked out when the timetable is saved and kept, so they never shift under the student.
   A subject is ticked done by the student; ticking today's subject moves the rest up to start today. A subject whose days
   have passed while it is not done is "behind"; "Re-plan from today" lays the subjects not yet done over the days left,
   so missed days roll forward. Done subjects keep their past dates.

   Today's plan (prep-plan.js makePlan) asks today(): on a study day the new questions and the lesson come from that
   day's subject, a rest day keeps only due reviews, and the revision stretch plans like the last two weeks (mocks, no
   new chapters). Nothing here calls a server.

   Store (smd_prep_v1, synced by prep-sync.js as one value): tt = { v: 1, ex, start, end, off: [weekday 0-6, 0 = Sunday],
   order: [subject ids], done: { subject id: day }, blocks: [{ sid, from, to, days }] } or null. Days are local day numbers (specialty-core dayNum), so a
   weekday is (day + 4) % 7 (day 0 was a Thursday). Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DEFAULT_SPAN = 120, MIN_REV = 7, MAX_REV = 45;

  /* ================= pure ================= */
  function weekday(day) { return ((day + 4) % 7 + 7) % 7; }
  function isOff(day, off) { return (off || []).indexOf(weekday(day)) >= 0; }
  function studyDays(from, to, off) { var n = 0; for (var d = from; d <= to; d++) if (!isOff(d, off)) n++; return n; }
  // The day of the n-th study day (1-based) from `from`, skipping rest days.
  function nthStudyDay(from, n, off) { var d = from - 1, k = 0; while (k < n) { d++; if (!isOff(d, off)) k++; if (d - from > 3660) break; } return d; }
  function dayOfIso(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; }
  function isoOfDay(d) { return new Date(d * 864e5).toISOString().slice(0, 10); }
  // Revision days before an exam: a quarter of the time left, 7 to 45 days.
  function revDays(span) { return Math.max(MIN_REV, Math.min(MAX_REV, Math.round(span * 0.25))); }
  // The finish date suggested for the first reading: the exam minus the revision days, else 120 days out.
  function suggestEnd(today, examDay) {
    if (examDay == null || examDay <= today + MIN_REV) return today + DEFAULT_SPAN;
    return examDay - revDays(examDay - today) - 1;
  }

  /* split(total, weights) -> whole days per subject, each at least 1, summing to max(total, count): largest remainder. */
  function split(total, w) {
    var n = w.length; if (!n) return [];
    if (total <= n) return w.map(function () { return 1; });
    var sum = w.reduce(function (a, b) { return a + Math.max(1, b); }, 0), spare = total - n;
    var raw = w.map(function (x) { return spare * Math.max(1, x) / sum; }), out = raw.map(function (x) { return 1 + Math.floor(x); });
    var left = total - out.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (x, i) { return [x - Math.floor(x), i]; }).sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; }).slice(0, left).forEach(function (p) { out[p[1]]++; });
    return out;
  }

  /* schedule(o) -> { blocks: [{ sid, from, to, days }], end, short }
     o = { subjects: [{ id, w }] in timetable order, start, end, off, done: { sid: day } }. Done subjects are kept where
     they fall only when keepDone; otherwise left out (Re-plan). short = more subjects than study days (each still gets
     one, so the last block ends after o.end). */
  function schedule(o) {
    var subs = (o.subjects || []).filter(function (x) { return o.keepDone || !(o.done && o.done[x.id]); });
    var total = o.end >= o.start ? studyDays(o.start, o.end, o.off) : 0, days = split(total, subs.map(function (x) { return x.w; }));
    var blocks = [], k = 0, last = o.start - 1;
    subs.forEach(function (x, i) {
      var from = nthStudyDay(o.start, k + 1, o.off), to = nthStudyDay(o.start, k + days[i], o.off);
      blocks.push({ sid: x.id, from: from, to: to, days: days[i] }); k += days[i]; last = to;
    });
    return { blocks: blocks, end: Math.max(last, o.end), short: subs.length > total };
  }

  /* where(tt, blocks, today) -> what today is:
       { k: "before" }  the timetable starts later       { k: "rest" }  a rest day
       { k: "study", sid, n, of }  day n of `of` of a subject's block
       { k: "rev" }  past the last block (revision and mocks until the exam)
     A done subject's block still counts as its own days (the student moves on early by re-planning). */
  function where(tt, blocks, today) {
    if (!tt || !blocks || !blocks.length) return null;
    if (today < tt.start) return { k: "before" };
    if (isOff(today, tt.off)) return { k: "rest" };
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (today >= b.from && today <= b.to) return { k: "study", sid: b.sid, n: studyDays(b.from, today, tt.off), of: b.days };
    }
    return today > blocks[blocks.length - 1].to ? { k: "rev" } : { k: "rest" };
  }
  /* lay(o) -> blocks: the done subjects' old blocks cut to end before o.start, then the subjects not done laid from
     o.start. o = { subjects, start, end, off, done, old: previous blocks }. */
  function lay(o) {
    var kept = [];
    (o.old || []).forEach(function (b) {
      if (!(o.done && o.done[b.sid]) || b.from >= o.start) return;
      var to = Math.min(b.to, o.start - 1);
      kept.push({ sid: b.sid, from: b.from, to: to, days: studyDays(b.from, to, o.off) });
    });
    return kept.concat(schedule({ subjects: o.subjects, start: o.start, end: o.end, off: o.off, done: o.done }).blocks);
  }
  // Subjects whose days are over but not ticked done, in order.
  function behind(blocks, done, today) { return (blocks || []).filter(function (b) { return b.to < today && !(done && done[b.sid]); }).map(function (b) { return b.sid; }); }
  // Move one subject up (-1) or down (+1) in the order.
  function move(order, sid, dir) {
    var o = order.slice(), i = o.indexOf(sid), j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return o;
    o[i] = o[j]; o[j] = sid; return o;
  }
  // The next module to study in a subject: the first one in tree order with questions not yet started, else the one
  // with the lowest accuracy that is not finished, else the first.
  function nextModule(topics, mod, countFor) {
    var list = (topics || []).filter(function (t) { return t.group !== "mixed" && (!countFor || countFor(t) > 0); });
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) if (!(mod && mod[list[i].id] && mod[list[i].id].t)) return list[i].id;
    var best = null;
    list.forEach(function (t) { var m = mod[t.id], acc = m && m.t ? m.ok / m.t : 1; if (!best || acc < best.acc) best = { id: t.id, acc: acc }; });
    return best ? best.id : list[0].id;
  }

  var PURE = { weekday: weekday, isOff: isOff, studyDays: studyDays, nthStudyDay: nthStudyDay, dayOfIso: dayOfIso, isoOfDay: isoOfDay, revDays: revDays,
    suggestEnd: suggestEnd, split: split, schedule: schedule, lay: lay, where: where, behind: behind, move: move, nextModule: nextModule };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  // Flag smd_prep_tt, default ON (owner 2026-10-30): localStorage "0" or ?tt=0 leaves PREP_TT undefined, so Today's
  // plan and home render exactly as before (a stored timetable is kept and comes back when the flag is on again).
  try { var qf = (G.location.search.match(/[?&]tt=([^&]+)/) || [])[1]; if (qf === "0" || (qf == null && G.localStorage.getItem("smd_prep_tt") === "0")) return; } catch (e) {}
  var D = G.document, H = null;
  var T = { d: null };   // the draft while the student edits
  function esc(s) { return H.esc(s); }
  function store() { return H.store(); }
  function tt() { var s = store(), t = s.tt; return t && t.v === 1 && t.ex === H.exam().id ? t : null; }
  function name(sid) { var sb = H.subjectById(sid); return sb ? H.tx(sb.name) : sid; }
  function fmtDay(d, long) { try { return new Date(d * 864e5).toLocaleDateString("en-IN", long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", timeZone: "UTC" }); } catch (e) { return isoOfDay(d); } }
  function examDay() { var pl = store().pl; return pl && pl.date ? dayOfIso(pl.date) : null; }
  // The subjects the timetable can hold: the plan's scope (NEET-SS group, INI-SS course) or the whole exam tab, with
  // their module counts from the tree (always on the phone).
  function pool() {
    var subs = (H.planSubjects && H.planSubjects()) || [];
    if (!subs.length) subs = H.subjectsOf(H.exam().id);
    return subs.map(function (sb) { var n = 0; (sb.sections || []).forEach(function (sec) { n += (sec.modules || []).length; }); return { id: sb.id, w: n || 1 }; });
  }
  function subjectsOf(t) { var w = {}; pool().forEach(function (x) { w[x.id] = x.w; }); return (t.order || []).filter(function (id) { return w[id]; }).map(function (id) { return { id: id, w: w[id] }; }); }
  function blocksOf(t) { return { blocks: t.blocks || [] }; }
  // A timetable from its settings, laid from `start`, keeping the done subjects' past blocks.
  function build(ex, start, end, off, order, done, old) {
    var t = { v: 1, ex: ex, start: start, end: end, off: off.slice(), order: order.slice(), done: done || {} };
    t.blocks = lay({ subjects: subjectsOf(t), start: start, end: end, off: off, done: t.done, old: old });
    return t;
  }
  function saveTt(t) { var s = store(); s.tt = t; s.pt = null; H.save(); if (G.PREP_NATIVE) G.PREP_NATIVE.changed(); }

  /* For prep-plan.js: what today asks of the plan, or null without a timetable.
     { k, sid?, n?, of?, mods?: [{ s, m }] } (mods: the next module of today's subject when its index is loaded). */
  function today(h) {
    H = h || H; if (!H) return null;
    var t = tt(); if (!t) return null;
    var w = where(t, blocksOf(t).blocks, H.today()); if (!w) return null;
    if (w.k === "study") {
      var ix = H.ix()[w.sid], ex = H.exam().id, s = store();
      var m = ix && ix.topics ? nextModule(ix.topics, s.mod || {}, function (x) { return H.pure.countFor(x, ex); }) : null;
      w.mods = m ? [{ s: w.sid, m: m }] : [];
      w.name = name(w.sid);
    }
    return w;
  }
  // One line under "Today's plan" on home.
  function lineHtml(h) {
    var w = today(h); if (!w) return "";
    var tx = w.k === "study" ? "Timetable: " + esc(w.name) + ", day " + w.n + " of " + w.of : w.k === "rest" ? "Timetable: rest day. Due reviews only." : w.k === "rev" ? "Timetable: revision and mocks" : "Timetable starts " + esc(fmtDay(tt().start, true));
    var lag = w.k !== "before" ? behind(blocksOf(tt()).blocks, tt().done, H.today()).length : 0;
    return '<button type="button" class="pn-link tt-line" data-act="tt-open">' + H.ico("cal") + "<span>" + tx + (lag ? " · " + lag + " behind" : "") + "</span></button>";
  }
  function homeRow(h) {
    H = h; var t = tt(), w = t ? today(h) : null;
    return H.row("tt-open", H.ico("cal"), "Revision timetable", !t ? "Your subjects, your dates, rest days" : w && w.k === "study" ? "Today: " + esc(w.name) : w && w.k === "rest" ? "Today is a rest day" : w && w.k === "rev" ? "Revision and mocks" : "Set up");
  }

  /* ---------- screens ---------- */
  function open() { T.d = null; H.push(tt() ? renderView : renderEdit); }
  function draft() {
    if (T.d) return T.d;
    var t = tt(), td = H.today(), ids = pool().map(function (x) { return x.id; });
    if (t) {
      var order = t.order.filter(function (id) { return ids.indexOf(id) >= 0; });
      T.d = { start: Math.max(td, t.start), end: t.end, off: t.off.slice(), order: order, out: ids.filter(function (id) { return order.indexOf(id) < 0; }), done: t.done || {} };
    } else T.d = { start: td, end: suggestEnd(td, examDay()), off: [0], order: ids, out: [], done: {} };
    // Editing keeps what is done: those subjects keep their past days and get none from the new start.
    T.d.old = t ? t.blocks : null;
    return T.d;
  }
  function renderEdit() {
    var d = draft(), td = H.today(), ex = examDay();
    var sch = schedule({ subjects: subjectsOf({ order: d.order }), start: d.start, end: d.end, off: d.off, done: d.done, keepDone: false });
    var nStudy = d.end >= d.start ? studyDays(d.start, d.end, d.off) : 0;
    var wdChips = WD.map(function (n, i) { var on = d.off.indexOf(i) >= 0; return '<button type="button" class="pn-chip sm' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="tt-off" data-v="' + i + '">' + n + "</button>"; }).join("");
    var rows = d.order.map(function (id, i) {
      var b = sch.blocks.filter(function (x) { return x.sid === id; })[0];
      return '<li class="tt-sr"><span class="tt-sn"><b>' + (i + 1) + ". " + esc(name(id)) + "</b><small>" + (d.done[id] ? "Done" : b ? b.days + (b.days === 1 ? " day" : " days") + " · " + esc(fmtDay(b.from)) + " to " + esc(fmtDay(b.to)) : "") + "</small></span>" +
        '<button type="button" class="pn-ib" data-act="tt-up" data-v="' + esc(id) + '" aria-label="Move ' + esc(name(id)) + ' up"' + (i ? "" : " disabled") + ">" + arrow(-1) + "</button>" +
        '<button type="button" class="pn-ib" data-act="tt-dn" data-v="' + esc(id) + '" aria-label="Move ' + esc(name(id)) + ' down"' + (i < d.order.length - 1 ? "" : " disabled") + ">" + arrow(1) + "</button>" +
        '<button type="button" class="pn-ib" data-act="tt-rm" data-v="' + esc(id) + '" aria-label="Leave out ' + esc(name(id)) + '">' + H.ico("x") + "</button></li>";
    }).join("");
    var outs = d.out.length ? '<h3 class="pn-sec">Left out</h3><div class="pn-wrap">' + d.out.map(function (id) { return '<button type="button" class="pn-chip" data-act="tt-add" data-v="' + esc(id) + '">' + H.ico("plus") + " " + esc(name(id)) + "</button>"; }).join("") + "</div>" : "";
    var revLine = ex != null && ex > d.end ? (ex - d.end) + " days of revision and mocks before the exam on " + esc(fmtDay(ex, true)) + "." : ex != null ? "The finish date is on or after your exam: there is no time left to revise." : "No exam date set. Add it in Exam and plan to count the revision days.";
    H.paint(H.bar("Revision timetable", tt() ? "Edit" : "New", "back") + '<div class="pn-body tt-edit">' +
      '<section class="pn-panel"><h2 class="pn-sec">Dates</h2><div class="tt-dates">' +
      '<label><span>Start</span><input type="date" class="pn-in" id="ttStart" value="' + isoOfDay(d.start) + '" min="' + isoOfDay(td) + '"></label>' +
      '<label><span>Finish first reading by</span><input type="date" class="pn-in" id="ttEnd" value="' + isoOfDay(d.end) + '" min="' + isoOfDay(td) + '"></label></div>' +
      '<button type="button" class="pn-btn" data-act="tt-dates">Apply dates</button>' +
      '<p class="pn-mut pn-small">' + nStudy + " study days. " + revLine + "</p></section>" +
      '<section class="pn-panel"><h2 class="pn-sec">Rest days</h2><div class="pn-wrap tt-wd" role="group" aria-label="Rest days">' + wdChips + "</div>" +
      '<p class="pn-mut pn-small">A rest day plans only your due reviews.</p></section>' +
      '<section class="pn-panel"><h2 class="pn-sec">Subjects, in study order</h2><p class="pn-mut pn-small">Days follow each subject\'s size. Reorder with the arrows.</p>' +
      (sch.short ? '<p class="tt-warn" role="note">More subjects than study days: each gets one day and the timetable runs past your finish date.</p>' : "") +
      '<ol class="tt-list">' + rows + "</ol>" + outs + "</section>" +
      '<button type="button" class="pn-btn pri" data-act="tt-save"' + (d.order.length ? "" : " disabled") + ">" + (tt() ? "Save timetable" : "Make timetable") + "</button>" +
      (tt() ? '<button type="button" class="pn-link tt-off" data-act="tt-stop">Turn the timetable off</button>' : "") + "</div>");
  }
  function arrow(dir) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (dir < 0 ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6") + '"/></svg>'; }
  function readDates() {
    var d = draft(), r = H.root(), a = r && r.querySelector("#ttStart"), b = r && r.querySelector("#ttEnd"), td = H.today();
    var s0 = a ? dayOfIso(a.value) : null, e0 = b ? dayOfIso(b.value) : null;
    if (s0 != null) d.start = Math.max(td, s0);
    if (e0 != null) d.end = e0;
    if (d.end < d.start) { d.end = d.start; H.toast("The finish date moved to the start date."); }
  }
  function renderView() {
    var t = tt(); if (!t) return renderEdit();
    var td = H.today(), sch = blocksOf(t), w = where(t, sch.blocks, td), lag = behind(sch.blocks, t.done, td), ex = examDay();
    var head = w && w.k === "study" ? "<b>" + esc(name(w.sid)) + "</b><small>Day " + w.n + " of " + w.of + "</small>" : w && w.k === "rest" ? "<b>Rest day</b><small>Due reviews only</small>" : w && w.k === "rev" ? "<b>Revision and mocks</b><small>" + (ex != null && ex >= td ? (ex - td) + " days to the exam" : "First reading finished") + "</small>" : "<b>Starts " + esc(fmtDay(t.start, true)) + "</b><small>&nbsp;</small>";
    var week = "";
    for (var i = 0; i < 7; i++) {
      var dd = td + i, ww = where(t, sch.blocks, dd);
      week += '<li class="' + (i ? "" : "now ") + (ww && ww.k === "rest" ? "rest" : "") + '"><span>' + esc(i ? WD[weekday(dd)] : "Today") + "</span><b>" + esc(!ww ? "" : ww.k === "study" ? name(ww.sid) : ww.k === "rest" ? "Rest" : ww.k === "rev" ? "Revision" : "") + "</b></li>";
    }
    var list = sch.blocks.slice().sort(function (x, y) { return x.from - y.from; }).map(function (b) {
      var st = t.done[b.sid] ? "done" : td >= b.from && td <= b.to ? "now" : b.to < td ? "late" : "next";
      var tag = { done: "Done", now: "Now", late: "Behind", next: "" }[st];
      return '<li class="tt-b ' + st + '"><span class="tt-bn"><b>' + esc(name(b.sid)) + "</b><small>" + esc(fmtDay(b.from)) + " to " + esc(fmtDay(b.to)) + " · " + b.days + (b.days === 1 ? " day" : " days") + "</small></span>" +
        (tag ? '<span class="tt-tag">' + tag + "</span>" : "") +
        (st === "done" ? '<button type="button" class="pn-link" data-act="tt-undone" data-v="' + esc(b.sid) + '">Undo</button>' : st === "now" || st === "late" ? '<button type="button" class="pn-btn sm" data-act="tt-done" data-v="' + esc(b.sid) + '">Mark done</button>' : "") + "</li>";
    }).join("");
    H.paint(H.bar("Revision timetable", "", "back", '<button type="button" class="pn-ib" data-act="tt-edit" aria-label="Edit the timetable">' + H.ico("gear") + "</button>") + '<div class="pn-body tt-view">' +
      '<section class="pn-panel tt-today"><p class="pn-eb">Today</p><p class="tt-now">' + head + "</p>" +
      (w && w.k === "study" ? '<button type="button" class="pn-btn pri" data-act="' + (w.mods && w.mods[0] ? 'module" data-m="' + esc(w.mods[0].m) + '"' : 'subject"') + ' data-s="' + esc(w.sid) + '">' + H.ico("play") + " Study " + esc(name(w.sid)) + "</button>" : "") + "</section>" +
      (lag.length ? '<section class="pn-panel tt-lag" role="note"><p><b>' + lag.length + (lag.length === 1 ? " subject is" : " subjects are") + " behind:</b> " + lag.map(function (id) { return esc(name(id)); }).join(", ") + ".</p>" +
        '<p class="pn-mut pn-small">Re-plan lays every subject not done over the days left, from today. Or mark one done if you finished it.</p><button type="button" class="pn-btn" data-act="tt-replan">Re-plan from today</button></section>' : "") +
      '<h2 class="pn-sec">This week</h2><ol class="tt-week">' + week + "</ol>" +
      '<h2 class="pn-sec">Subjects</h2><ol class="tt-blocks">' + list + "</ol>" +
      '<p class="pn-mut pn-small">First reading by ' + esc(fmtDay(t.end, true)) + (ex != null ? ", exam " + esc(fmtDay(ex, true)) : "") + ". Rest days: " + (t.off.length ? t.off.slice().sort().map(function (i) { return WD[i]; }).join(", ") : "none") + ".</p>" +
      (lag.length ? "" : '<button type="button" class="pn-link" data-act="tt-replan">Re-plan from today</button>') + "</div>");
  }
  // Re-plan: the subjects not done, in order, over the study days from today to the finish date.
  function replan(quiet) {
    var t = tt(); if (!t) return;
    var td = H.today();
    if (t.end < td) { H.toast("The finish date has passed. Pick a new one."); T.d = null; return H.push(renderEdit); }
    saveTt(build(t.ex, td, t.end, t.off, t.order, t.done, t.blocks));
    if (!quiet) H.toast("Re-planned from today");
    H.rerender();
  }

  function act(a, b, h) {
    H = h;
    var v = b.getAttribute("data-v"), d;
    if (a === "tt-open") return open();
    if (a === "tt-edit") { T.d = null; return H.push(renderEdit); }
    if (a === "tt-dates") { readDates(); return H.rerender(); }
    if (a === "tt-off") { readDates(); d = draft(); var i = Number(v), k = d.off.indexOf(i); if (k >= 0) d.off.splice(k, 1); else if (d.off.length < 6) d.off.push(i); else H.toast("Keep at least one study day a week."); return H.rerender(); }
    if (a === "tt-up" || a === "tt-dn") { readDates(); d = draft(); d.order = move(d.order, v, a === "tt-up" ? -1 : 1); return H.rerender(); }
    if (a === "tt-rm") { readDates(); d = draft(); d.order = d.order.filter(function (x) { return x !== v; }); d.out.push(v); return H.rerender(); }
    if (a === "tt-add") { readDates(); d = draft(); d.out = d.out.filter(function (x) { return x !== v; }); d.order.push(v); return H.rerender(); }
    if (a === "tt-save") {
      readDates(); d = draft(); if (!d.order.length) return;
      var t0 = tt(), done = {}; d.order.forEach(function (id) { if (d.done[id]) done[id] = d.done[id]; });
      saveTt(build(H.exam().id, d.start, d.end, d.off, d.order, done, d.old));
      T.d = null; H.toast(t0 ? "Timetable saved" : "Timetable made. Today's plan now follows it.");
      H.stack().pop(); if (!t0) H.stack().push(renderView);
      return H.rerender();
    }
    if (a === "tt-stop") { var s = store(); s.tt = null; s.pt = null; H.save(); T.d = null; H.toast("Timetable off"); H.stack().pop(); var top = H.stackTop(); if (top === renderView) H.stack().pop(); return H.rerender(); }
    if (a === "tt-done" || a === "tt-undone") {
      var t = tt(); if (!t) return; t.done = t.done || {};
      var td = H.today(), cur = (t.blocks || []).some(function (x) { return x.sid === v && td >= x.from && td <= x.to; });
      if (a === "tt-done") t.done[v] = td; else delete t.done[v];
      saveTt(t);
      // Today's subject finished early: the rest move up to start today.
      if (a === "tt-done" && cur && t.end >= td) { replan(true); return H.toast("Done. The next subject starts today."); }
      return H.rerender();
    }
    if (a === "tt-replan") return replan();
  }
  function back() { return false; }

  G.PREP_TT = { act: act, back: back, today: today, lineHtml: lineHtml, homeRow: homeRow, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
