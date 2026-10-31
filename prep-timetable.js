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


  /* ================= ReWise (timetable v2, owner 2026-10-31) =================
     Plans by topic (the modules of the tree), not by subject: a NEET-SS paper is one subject, so a subject plan put
     "Medical Oncology" on every day. Every day gets a kind and, where it applies, its topics:
       learn  first reading of t (topics, weakest first)      gt    a timed grand test (the full mock)
       gtr    the grand test's review and repair               rev   revision of whole sections g (mixed questions)
       mixed  timed mixed blocks over everything                taper the last days: errors, recall, no new topics
       rest   nothing planned                                   exam  the exam itself
     Topic priority (tier): 1 weak (ticked weak, under 60% right over 10+ answers, or a quarter or more guessed or
     confused over 10+), 2 barely started (under 10 answers), 3 the rest, 4 strong (80%+ over 30+: mixed practice only,
     no first-reading day). Days follow each topic's question count. Every reason shown is the student's own numbers. */
  var TAPER = 2, Q_MIN = 1.5, REV_Q_MIN = 0.5;
  // Each kind's blocks as [key, share of the day]. A rest day has none (due reviews stay optional on the plan).
  var SHARES = {
    learn: [["recall", 0.10], ["read", 0.30], ["topic", 0.25], ["mixed", 0.15], ["errors", 0.15], ["quick", 0.05]],
    gtr: [["recall", 0.15], ["errors", 0.40], ["repair", 0.35], ["quick", 0.10]],
    rev: [["recall", 0.10], ["mixed", 0.55], ["errors", 0.25], ["quick", 0.10]],
    mixed: [["recall", 0.10], ["mixed", 0.60], ["errors", 0.25], ["quick", 0.05]],
    taper: [["recall", 0.30], ["errors", 0.40], ["quick", 0.30]]
  };
  function accOf(tp) { return tp.t ? (tp.ok || 0) / tp.t : 0; }
  function tierOf(tp) {
    if (tp.weak) return 1;
    var t = tp.t || 0, acc = accOf(tp);
    if (t >= 10 && acc < 0.6) return 1;
    if (t >= 10 && (tp.cf || 0) >= 3 && tp.cf / t >= 0.25) return 1;
    if (t >= 30 && acc >= 0.8) return 4;
    return t < 10 ? 2 : 3;
  }
  // Why a topic sits where it does, from the student's own numbers.
  function whyOf(tp) {
    var tr = tierOf(tp), t = tp.t || 0, pc = Math.round(accOf(tp) * 100);
    if (tr === 1) return tp.weak ? "You marked it weak" : pc < 60 ? pc + "% right of " + t : tp.cf + " of " + t + " guessed or confused";
    if (tr === 2) return t ? "Only " + t + " answered so far" : "Not started";
    if (tr === 4) return pc + "% right of " + t + ", so mixed practice only";
    return pc + "% right of " + t;
  }
  // Topics in study order: tier, then the order given (subject order, then tree order). Stable.
  function priority(topics) {
    return (topics || []).map(function (x, i) { return { x: x, i: i, t: tierOf(x) }; }).sort(function (a, b) { return a.t - b.t || a.i - b.i; }).map(function (p) { return p.x; });
  }
  /* pack(items, n, w) -> n lists of ids. Laid end to end by weight w(item) over n equal days: an item longer than a day
     spans days, short items share one. Every day gets at least one item while there are items. */
  function pack(items, n, w) {
    var out = [], i; for (i = 0; i < n; i++) out.push([]);
    if (!n || !items.length) return out;
    var sum = items.reduce(function (a, x) { return a + w(x); }, 0), C = sum / n, a = 0;
    if (items.length >= n) {
      // At least one item a day: fill by weight, but never leave fewer items than days left.
      var d = 0, acc = 0;
      items.forEach(function (x, k) {
        var left = items.length - k, daysLeft = n - d;
        if (out[d].length && (acc + w(x) / 2 > C * (d + 1) || left <= daysLeft - 1) && d < n - 1) d++;
        out[d].push(x.id); acc += w(x);
      });
      return out;
    }
    items.forEach(function (x) {
      var b = a + w(x), d0 = Math.min(n - 1, Math.floor(a / C + 1e-9)), d1 = Math.min(n - 1, Math.max(d0, Math.ceil(b / C - 1e-9) - 1));
      for (var dd = d0; dd <= d1; dd++) if (out[dd].indexOf(x.id) < 0) out[dd].push(x.id);
      a = b;
    });
    return out;
  }
  /* kinds(o) -> [{ d, k }] from o.start to the exam (or the finish date without one). o = { start, end (first reading by),
     exam (day | null), off: [weekday], gt: weekday | -1 }. A grand test is never in the first 3 days nor the taper; the
     next study day after it is its review. Exam 10+ days out: the last TAPER days before it are light. */
  function kinds(o) {
    var last = o.exam != null ? o.exam : o.end, out = [], pend = false, taper = o.exam != null && o.exam - o.start >= 10;
    for (var d = o.start; d <= last; d++) {
      var k;
      if (o.exam != null && d === o.exam) k = "exam";
      else if (taper && d >= o.exam - TAPER) k = "taper";
      else if (isOff(d, o.off)) k = "rest";
      else if (o.gt >= 0 && weekday(d) === o.gt && d >= o.start + 3) { k = "gt"; pend = true; }
      else if (pend) { k = "gtr"; pend = false; }
      else k = d <= o.end ? "learn" : "rev";
      out.push({ d: d, k: k });
    }
    return out;
  }
  /* plan(o) -> { days: [{ d, k, t?: [topic ids], g?: [section ids] }], strong: [ids], unplaced: n }
     o = kinds' fields + topics: [{ id, g (section), n (questions), t, ok, cf, weak }] in subject and tree order,
     skip: { id: 1 } topics already read (Re-plan). First reading: tiers 1 to 3 over the learn days, weakest first.
     Revision: sections by their weakest topic, over the first three quarters of the revision days; the rest mixed. */
  function plan(o) {
    var days = kinds(o), topics = o.topics || [], skip = o.skip || {};
    var learn = days.filter(function (x) { return x.k === "learn"; }), rev = days.filter(function (x) { return x.k === "rev"; });
    var order = priority(topics), strong = order.filter(function (x) { return tierOf(x) === 4; }).map(function (x) { return x.id; });
    var toRead = order.filter(function (x) { return tierOf(x) < 4 && !skip[x.id]; });
    var w = function (x) { return Math.max(5, x.n || 0); };
    pack(toRead, learn.length, w).forEach(function (ids, i) { learn[i].t = ids; });
    // Sections: their topics, weight and best (lowest) tier; in that order, ties by first appearance.
    var secs = [], by = {};
    topics.forEach(function (x, i) {
      var g = by[x.g]; if (!g) { g = by[x.g] = { id: x.g, i: i, tier: 9, w: 0, t: [] }; secs.push(g); }
      g.t.push(x.id); g.w += w(x); g.tier = Math.min(g.tier, tierOf(x));
    });
    secs.sort(function (a, b) { return a.tier - b.tier || a.i - b.i; });
    var nSweep = rev.length <= 2 ? 0 : Math.max(1, Math.round(rev.length * 0.75));
    pack(secs, Math.min(nSweep, secs.length) || 0, function (g) { return g.w; }).forEach(function (ids, i) {
      rev[i].g = ids; var t = []; ids.forEach(function (gid) { t = t.concat(by[gid].t); }); rev[i].t = t;
    });
    rev.forEach(function (x) { if (!x.g) x.k = "mixed"; });
    return { days: days, strong: strong, unplaced: learn.length ? 0 : toRead.length };
  }
  /* blocks(k, minutes, o) -> [{ k, min, n? }]. o = { due (reviews due now), gtMin (the grand test's minutes) }. Minutes
     in steps of 5; questions at Q_MIN minutes each (with the explanation), reviews at REV_Q_MIN. */
  function r5(m) { return Math.max(5, Math.round(m / 5) * 5); }
  function blocks(k, minutes, o) {
    o = o || {};
    if (k === "gt") {
      var g = Math.min(minutes, o.gtMin || 180), out = [{ k: "gt", min: r5(g) }];
      if (minutes - g >= 20) out.push({ k: "first", min: r5(Math.min(60, minutes - g)) });
      return out;
    }
    var sh = SHARES[k]; if (!sh) return [];
    var M = k === "taper" ? minutes * 0.5 : minutes;
    return sh.map(function (p) {
      var b = { k: p[0], min: r5(M * p[1]) };
      if (p[0] === "topic" || p[0] === "mixed" || p[0] === "repair") b.n = Math.max(5, Math.round(b.min / Q_MIN));
      if (p[0] === "recall") b.n = Math.min(o.due || 0, Math.floor(b.min / REV_Q_MIN));
      return b;
    });
  }
  // Learn days in the past whose topics have not been touched since that day. studied(id, day) -> true when the topic
  // was answered on or after the day.
  function missed(days, today, studied) {
    return (days || []).filter(function (x) { return x.k === "learn" && x.d < today && x.t && x.t.length && !x.t.some(function (id) { return studied(id, x.d); }); });
  }
  // Topics read already: on a past learn day and answered on or after it.
  function readSet(days, today, studied) {
    var out = {};
    (days || []).forEach(function (x) { if (x.k === "learn" && x.d < today) (x.t || []).forEach(function (id) { if (studied(id, x.d)) out[id] = 1; }); });
    return out;
  }
  // The 3 weakest topics read so far (10+ answers), for a grand test's repair day.
  function weakest(topics, n) {
    return (topics || []).filter(function (x) { return (x.t || 0) >= 10; }).sort(function (a, b) { return accOf(a) - accOf(b) || b.t - a.t; }).slice(0, n || 3).map(function (x) { return x.id; });
  }
  // Counts for the editor's summary line.
  function summary(days) {
    var c = { learn: 0, gt: 0, rest: 0, rev: 0 };
    (days || []).forEach(function (x) { if (x.k === "learn") c.learn++; else if (x.k === "gt") c.gt++; else if (x.k === "rest") c.rest++; else if (x.k === "rev" || x.k === "mixed" || x.k === "gtr" || x.k === "taper") c.rev++; });
    return c;
  }

  var PURE = { weekday: weekday, isOff: isOff, studyDays: studyDays, nthStudyDay: nthStudyDay, dayOfIso: dayOfIso, isoOfDay: isoOfDay, revDays: revDays,
    suggestEnd: suggestEnd, split: split, schedule: schedule, lay: lay, where: where, behind: behind, move: move, nextModule: nextModule,
    tierOf: tierOf, whyOf: whyOf, priority: priority, pack: pack, kinds: kinds, plan: plan, blocks: blocks, missed: missed, readSet: readSet, weakest: weakest, summary: summary, TAPER: TAPER, Q_MIN: Q_MIN };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  // Flag smd_prep_tt, default ON (owner 2026-10-30): localStorage "0" or ?tt=0 leaves PREP_TT undefined, so Today's
  // plan and home render exactly as before (a stored timetable is kept and comes back when the flag is on again).
  try { var qf = (G.location.search.match(/[?&]tt=([^&]+)/) || [])[1]; if (qf === "0" || (qf == null && G.localStorage.getItem("smd_prep_tt") === "0")) return; } catch (e) {}
  var H = null;
  var T = { d: null, all: false, busy: false, topics: null };   // d: the draft while the student edits; topics: today's cache
  var HRS = [1, 2, 3, 4, 6, 8, 10, 12];
  var KIND = { learn: "Study", gt: "Grand test", gtr: "Grand test review", rev: "Revision", mixed: "Mixed timed practice", taper: "Light revision", rest: "Rest day", exam: "Exam day" };
  function esc(s) { return H.esc(s); }
  function store() { return H.store(); }
  // v2 (ReWise) for this exam tab, else null. v1 (the subject timetable) is read by tt1() until the student saves ReWise.
  function tt() { var s = store(), t = s.tt; return t && t.v === 2 && t.ex === H.exam().id ? t : null; }
  function tt1() { var s = store(), t = s.tt; return t && t.v === 1 && t.ex === H.exam().id ? t : null; }
  function name(sid) { var sb = H.subjectById(sid); return sb ? H.tx(sb.name) : sid; }
  function mname(mid) { return (H.moduleTitleOf && H.moduleTitleOf(mid)) || mid; }
  function fmtDay(d, long) { try { return new Date(d * 864e5).toLocaleDateString("en-IN", long ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" }); } catch (e) { return isoOfDay(d); } }
  function examDay() { var pl = store().pl; return pl && pl.date ? dayOfIso(pl.date) : null; }
  function plural(n, a, b) { return n + " " + (n === 1 ? a : b); }
  // The subjects the timetable can hold: the plan's scope (NEET-SS group, INI-SS course) or the whole exam tab.
  function poolSubs() { var subs = (H.planSubjects && H.planSubjects()) || []; if (!subs.length) subs = H.subjectsOf(H.exam().id); return subs; }
  function pool() { return poolSubs().map(function (sb) { var n = 0; (sb.sections || []).forEach(function (sec) { n += (sec.modules || []).length; }); return { id: sb.id, w: n || 1 }; }); }
  function subjectsOf(t) { var w = {}; pool().forEach(function (x) { w[x.id] = x.w; }); return (t.order || []).filter(function (id) { return w[id]; }).map(function (id) { return { id: id, w: w[id] }; }); }
  function secName(gid) {
    var r = null;
    poolSubs().forEach(function (sb) { (sb.sections || []).forEach(function (sec) { if (sec.id === gid) r = H.tx(sec.name); }); });
    return r || gid;
  }
  function subjOfMod(mid) { return H.subjectOfModule(mid); }
  // Topics of the ordered subjects from the tree, counts from the loaded indexes (a module without questions for this
  // exam is left out once its index is in), and the student's numbers. -> Promise.
  function topicsFor(order, weak) {
    var ex = H.exam().id;
    return Promise.all(order.map(function (sid) { return H.loadIndex(sid).then(null, function () { return null; }); })).then(function () {
      var s = store(), ix = H.ix(), out = [];
      order.forEach(function (sid) {
        var sb = H.subjectById(sid); if (!sb) return;
        var tix = ix[sid], cnt = {}, has = !!(tix && tix.topics && tix.topics.length);
        if (has) tix.topics.forEach(function (x) { cnt[x.id] = H.pure.countFor(x, ex); });
        (sb.sections || []).forEach(function (sec) {
          (sec.modules || []).forEach(function (m) {
            if (has && !(cnt[m.id] > 0)) return;
            var md = (s.mod || {})[m.id] || {}, cf = md.cf ? (md.cf.guessing || 0) + (md.cf.confused || 0) : 0;
            out.push({ id: m.id, sid: sid, g: sec.id, n: cnt[m.id] || 20, t: md.t || 0, ok: md.ok || 0, cf: cf, weak: !!(weak && weak[m.id]) });
          });
        });
      });
      return out;
    });
  }
  // A topic's numbers now (for reasons and the repair day), without the indexes.
  function topicNow(mid, weak) { var md = (store().mod || {})[mid] || {}; return { id: mid, t: md.t || 0, ok: md.ok || 0, cf: md.cf ? (md.cf.guessing || 0) + (md.cf.confused || 0) : 0, weak: !!(weak && weak[mid]) }; }
  function studied(mid, day) { var md = (store().mod || {})[mid]; return !!(md && md.t && md.last != null && md.last >= day); }
  function dayAt(t, d) { for (var i = 0; i < (t.days || []).length; i++) if (t.days[i].d === d) return t.days[i]; return null; }
  function hours(t) { return t && t.hrs ? t.hrs : Math.max(1, Math.round(((store().pl && store().pl.min) || 60) / 60)); }
  function gtMock() {
    var ex = H.exam(), pl = store().pl || {}, list = (H.pure.MOCKS && H.pure.MOCKS[ex.id]) || [], m = list[0];
    list.forEach(function (x) { if (x.id === pl.exam) m = x; });
    return m ? { id: m.id, label: m.label, min: m.min, n: m.n } : null;
  }
  function saveTt(t) { var s = store(); s.tt = t; s.pt = null; H.save(); if (G.PREP_NATIVE) G.PREP_NATIVE.changed(); }

  /* ---------- what a day asks for ----------
     info(day) -> null | { d, k, t: [topic ids], g, names, blocks: [{ k, min, n?, title, sub, act? }], read: lesson | null,
     head, line }. lessons: [{ m, k, s, title, minutes }] (prep-plan.js lessonList), or null when not loaded. */
  function info(d, lessons) {
    var t = tt(); if (!t) return null;
    var x = dayAt(t, d); if (!x) return d < t.start ? { d: d, k: "before" } : null;
    var s = store(), k = x.k, ids = (x.t || []).slice(), due = 0, td = H.today();
    if (k === "gtr") ids = weakest(t.topicsAll ? t.topicsAll.map(function (id) { return topicNow(id, t.weak); }) : [], 3);
    if (d === td && G.PREP_PLAN && G.PREP_PLAN._pure) due = G.PREP_PLAN._pure.dueNow(s, td);
    var mock = gtMock(), bl = blocks(k, hours(t) * 60, { due: due, gtMin: mock ? mock.min : 180 });
    var names = ids.map(mname), first = ids[0], fs = first ? subjOfMod(first) : null;
    var list = names.length > 3 ? names.slice(0, 3).join(", ") + " and " + (names.length - 3) + " more" : names.join(", ");
    var read = null;
    if (lessons && (k === "learn")) {
      var ls = s.ls || {};
      for (var i = 0; i < ids.length && !read; i++) for (var j = 0; j < lessons.length; j++) { var l = lessons[j]; if (l.m === ids[i] && !(ls[l.k || l.m] && ls[l.k || l.m].done)) { read = l; break; } }
      if (!read) for (var i2 = 0; i2 < ids.length && !read; i2++) for (var j2 = 0; j2 < lessons.length; j2++) if (lessons[j2].m === ids[i2]) { read = lessons[j2]; break; }
    }
    var secs = (x.g || []).map(secName), secList = secs.join(", ");
    var past = learnedBefore(t, d);
    bl.forEach(function (b) {
      if (b.k === "recall") { b.title = "Recall"; b.sub = b.n ? b.n + " due reviews, from your spaced repetition" : d === td ? (past.length ? "Nothing due. Recall " + mname(past[past.length - 1]) + " from memory, book closed" : "Nothing due yet. Reviews arrive as you answer") : "Your due reviews that day"; b.go = "rev"; }
      if (b.k === "read") { b.title = "Read"; b.sub = read ? "Lesson: " + read.title + ". Then a one-page table, not long notes" : "Notes on " + list + ". A one-page table, not long notes"; }
      if (b.k === "topic") { b.title = "Topic MCQs"; b.sub = b.n + " questions on " + list + ". Answer each before the explanation"; b.go = "prac"; }
      if (b.k === "mixed") { b.title = "Mixed MCQs"; b.sub = b.n + " questions " + (k === "rev" ? "across " + secList : past.length ? "across the topics you have studied" : "across the syllabus") + (k === "mixed" ? ", in timed blocks" : ""); b.go = "mix"; }
      if (b.k === "errors") { b.title = k === "taper" ? "Error notebook" : "Error review"; b.sub = k === "taper" ? "Only the mistakes that came back. No new topics" : "Every wrong, guessed and slow answer: what you thought, the clue you missed, the rule"; }
      if (b.k === "quick") { b.title = "Quick recall"; b.sub = first && k === "learn" ? "Flashcards for " + mname(first) : "Your flashcards due today"; }
      if (b.k === "repair") { b.title = "Repair"; b.sub = ids.length ? b.n + " questions on your weakest topics: " + list : "Your weakest topics show after 10 answers in a topic"; b.go = ids.length ? "prac" : null; }
      if (b.k === "gt") { b.title = "Grand test"; b.sub = (mock ? mock.label.replace(/ pattern$/, "") + ", " + mock.n + " questions, " : "") + "timed. Mark how sure you are on each answer"; b.go = "mock"; }
      if (b.k === "first") { b.title = "First review"; b.sub = "Straight after: tag every wrong, guessed and slow answer"; }
    });
    var head = k === "learn" ? list : k === "rev" ? secList : k === "gtr" ? "Review the grand test" : KIND[k] || "";
    // One line for home, reminders and the widget: what to read and what to practise.
    var tb = bl.filter(function (b) { return b.k === "topic" || b.k === "repair"; })[0], mb = bl.filter(function (b) { return b.k === "mixed"; })[0];
    var line = k === "learn" ? "Read " + (read ? read.title : names[0] || "") + ". Practise " + (tb ? tb.n : 0) + " questions on " + list + "." :
      k === "gt" ? "Grand test today, then review every wrong and guessed answer." :
      k === "gtr" ? "Review the grand test" + (ids.length ? ", then " + tb.n + " questions on " + list : "") + "." :
      k === "rev" ? "Revise " + secList + ": " + (mb ? mb.n : 0) + " mixed questions." :
      k === "mixed" ? (mb ? mb.n : 0) + " mixed questions in timed blocks, then your errors." :
      k === "taper" ? "Light day: your error notebook and quick recall. No new topics." :
      k === "rest" ? "Rest day. Nothing planned." : k === "exam" ? "Exam day. All the best." : "";
    return { d: d, k: k, t: ids, g: x.g || [], names: names, list: list, blocks: bl, read: read, head: head, line: line, fs: fs, past: past };
  }
  // Topics on learn days before d (studied first reading), newest last.
  function learnedBefore(t, d) { var out = []; (t.days || []).forEach(function (x) { if (x.k === "learn" && x.d < d) (x.t || []).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); }); return out; }

  /* For prep-plan.js (makePlan): today's plan items from ReWise, or null without one. o = { due, lessons, sec (seconds a
     question) }. Items use the plan's kinds: rev, lsn, prac (questions on topics: progress = answers in those modules
     since the plan was made), mix (the same, over studied topics), mock (full: the grand test). */
  function planItems(h, o) {
    H = h || H; if (!H) return null;
    var t = tt(); if (!t) return null;
    var td = H.today(), x = info(td, o.lessons || []); if (!x) return null;
    var items = [], cap = hours(t) * 60, pair = function (id) { var sid = subjOfMod(id); return sid ? { s: sid, m: id } : null; };
    x.blocks.forEach(function (b) {
      if (b.k === "recall" && o.due > 0 && b.min) { var n = Math.min(o.due, Math.max(1, b.n || 0)); if (n) items.push({ k: "rev", n: n, min: Math.ceil(n * REV_Q_MIN), rw: 1 }); }
      if (b.k === "read" && x.read) { var l = { k: "lsn", m: x.read.m, s: x.read.s, title: x.read.title, min: x.read.minutes || 5, ttl: "Read: " + x.read.title, rw: 1 }; if (x.read.k && x.read.k !== x.read.m) l.l = x.read.k; items.push(l); }
      if ((b.k === "topic" || b.k === "repair") && x.t.length) items.push({ k: "prac", n: b.n, min: b.min, mods: x.t.map(pair).filter(Boolean), ttl: "Practise " + b.n + " questions: " + x.list, sub: b.k === "repair" ? "ReWise repair: your weakest topics" : "ReWise: today's topics", rw: 1 });
      if (b.k === "mixed") {
        var pool = x.k === "rev" ? x.t : x.past.length ? x.past : (t.topicsAll || []);
        var pick = pool.map(function (id) { return topicNow(id, t.weak); }).sort(function (a, c) { return (a.t ? a.ok / a.t : 0) - (c.t ? c.ok / c.t : 0); }).slice(0, 8).map(function (p) { return p.id; });
        if (pick.length) items.push({ k: "mix", n: b.n, min: b.min, mods: pick.map(pair).filter(Boolean), ttl: "Mixed: " + b.n + " questions", sub: x.k === "rev" ? "ReWise revision: " + x.head : "ReWise: across what you have studied", rw: 1 });
      }
      if (b.k === "gt") { var m = gtMock(); if (m) items.push({ k: "mock", id: m.id, label: m.label, min: b.min, full: 1, ttl: "Grand test: " + m.label.replace(/ pattern$/, ""), sub: m.n + " questions, timed, marked like the exam", rw: 1 }); }
    });
    return { items: items, total: items.reduce(function (a, it) { return a + it.min; }, 0), cap: cap, line: x.line };
  }

  /* For prep-plan.js (old path) and the tests: what today is. v2: { k: "study" (a learn day) | the ReWise kind, mods,
     name }. v1: the subject timetable as before. */
  function today(h) {
    H = h || H; if (!H) return null;
    var t = tt();
    if (t) {
      var x = info(H.today(), null); if (!x) return null;
      var k = x.k === "learn" ? "study" : x.k === "rev" || x.k === "mixed" || x.k === "taper" ? "rev" : x.k;
      return { k: k, rk: x.k, mods: x.t.map(function (id) { return { s: subjOfMod(id), m: id }; }).filter(function (p) { return p.s; }), name: x.head, sid: x.fs, n: 1, of: 1 };
    }
    var t1 = tt1(); if (!t1) return null;
    var w = where(t1, t1.blocks || [], H.today()); if (!w) return null;
    if (w.k === "study") {
      var ix = H.ix()[w.sid], ex = H.exam().id, s = store();
      var m = ix && ix.topics ? nextModule(ix.topics, s.mod || {}, function (q) { return H.pure.countFor(q, ex); }) : null;
      w.mods = m ? [{ s: w.sid, m: m }] : []; w.name = name(w.sid);
    }
    return w;
  }
  // For prep-native.js and prep-nudges.js: a day's line ("Read X. Practise N questions on Y."), today = 0, tomorrow = 1.
  function notice(h, k) {
    H = h || H; if (!H || !tt()) return null;
    var x = info(H.today() + (k || 0), null);
    if (!x || x.k === "before" || x.k === "exam") return null;
    return { k: x.k, title: x.k === "learn" ? x.list : x.k === "rest" ? "Rest day" : KIND[x.k] + (x.k === "rev" ? ": " + x.head : ""), body: x.line };
  }
  // One line under "Today's plan" on home.
  function lineHtml(h) {
    H = h || H;
    if (tt()) {
      var x = info(H.today(), null); if (!x) return "";
      var ex = examDay(), bad = ex != null && ex < H.today();
      var tx = bad ? "ReWise: your exam date has passed. Set the new date" : x.k === "before" ? "ReWise starts " + fmtDay(tt().start, true) : "ReWise · " + (KIND[x.k] || "") + (x.k === "learn" || x.k === "rev" ? ": " + x.head : "");
      var miss = missed(tt().days, H.today(), studied).length;
      return '<button type="button" class="pn-link tt-line" data-act="tt-open">' + H.ico("cal") + "<span>" + esc(tx) + (miss && !bad ? " · " + plural(miss, "day", "days") + " missed" : "") + "</span></button>";
    }
    var w = today(h); if (!w || !tt1()) return "";
    var tx1 = w.k === "study" ? "Timetable: " + esc(w.name) + ", day " + w.n + " of " + w.of : w.k === "rest" ? "Timetable: rest day. Due reviews only." : w.k === "rev" ? "Timetable: revision and mocks" : "Timetable starts " + esc(fmtDay(tt1().start, true));
    return '<button type="button" class="pn-link tt-line" data-act="tt-open">' + H.ico("cal") + "<span>" + tx1 + " · ReWise is ready, open to switch</span></button>";
  }
  function homeRow(h) {
    H = h; var t = tt(), x = t ? info(H.today(), null) : null;
    var sub = !t ? (tt1() ? "Switch your timetable to ReWise: by topic, with grand tests" : "Your revision plan, topic by topic, with grand tests") : !x ? "Plan finished. Make a new one" : x.k === "learn" ? "Today: " + esc(x.list) : esc(KIND[x.k] || "Set up");
    return H.row("tt-open", H.ico("cal"), "ReWise", sub);
  }

  /* ---------- screens ---------- */
  function open() { T.d = null; T.all = false; H.push(tt() ? renderView : renderEdit); }
  function draft() {
    if (T.d) return T.d;
    var t = tt() || tt1(), td = H.today(), ids = pool().map(function (x) { return x.id; }), ex = examDay();
    var end = t && t.end >= td ? t.end : suggestEnd(td, ex != null && ex > td ? ex : null);
    if (t) {
      var order = (t.order || []).filter(function (id) { return ids.indexOf(id) >= 0; });
      T.d = { start: Math.max(td, t.start), end: end, off: (t.off || []).slice(), gt: t.gt == null ? 5 : t.gt, hrs: hours(t), order: order.length ? order : ids, out: ids.filter(function (id) { return order.indexOf(id) < 0; }), weak: Object.assign({}, t.weak || {}), was1: t.v === 1 };
    } else T.d = { start: td, end: end, off: [0], gt: 5, hrs: hours(null), order: ids, out: [], weak: {} };
    if (T.d.off.indexOf(T.d.gt) >= 0) T.d.gt = -1;
    T.d.exam = ex;
    return T.d;
  }
  function chips(act, list, on, label) { return '<div class="pn-wrap tt-wd" role="group" aria-label="' + label + '">' + list.map(function (c) { var o = on(c[0]); return '<button type="button" class="pn-chip sm' + (o ? " on" : "") + '" aria-pressed="' + o + '" data-act="' + act + '" data-v="' + c[0] + '">' + c[1] + "</button>"; }).join("") + "</div>"; }
  function examWarn(ex, td) { return ex != null && ex < td ? '<p class="tt-warn" role="alert">Your exam date, ' + esc(fmtDay(ex, true)) + ", has passed. Set the new date below so the revision days and grand tests count to it.</p>" : ""; }
  function renderEdit() {
    var d = draft(), td = H.today(), ex = d.exam;
    var days = kinds({ start: d.start, end: d.end, exam: ex != null && ex > d.start ? ex : null, off: d.off, gt: d.gt }), c = summary(days);
    var WDL = WD.map(function (n, i) { return [i, n]; });
    var rows = d.order.map(function (id, i) {
      return '<li class="tt-sr"><span class="tt-sn"><b>' + (i + 1) + ". " + esc(name(id)) + "</b></span>" +
        '<button type="button" class="pn-ib" data-act="tt-up" data-v="' + esc(id) + '" aria-label="Move ' + esc(name(id)) + ' up"' + (i ? "" : " disabled") + ">" + arrow(-1) + "</button>" +
        '<button type="button" class="pn-ib" data-act="tt-dn" data-v="' + esc(id) + '" aria-label="Move ' + esc(name(id)) + ' down"' + (i < d.order.length - 1 ? "" : " disabled") + ">" + arrow(1) + "</button>" +
        '<button type="button" class="pn-ib" data-act="tt-rm" data-v="' + esc(id) + '" aria-label="Leave out ' + esc(name(id)) + '">' + H.ico("x") + "</button></li>";
    }).join("");
    var outs = d.out.length ? '<h3 class="pn-sec">Left out</h3><div class="pn-wrap">' + d.out.map(function (id) { return '<button type="button" class="pn-chip" data-act="tt-add" data-v="' + esc(id) + '">' + H.ico("plus") + " " + esc(name(id)) + "</button>"; }).join("") + "</div>" : "";
    var nWeak = Object.keys(d.weak).length;
    var weakHtml = d.order.map(function (sid) {
      var sb = H.subjectById(sid); if (!sb) return "";
      return (sb.sections || []).map(function (sec) {
        var mods = sec.modules || [], on = mods.filter(function (m) { return d.weak[m.id]; }).length;
        return '<details class="tt-wk"' + (on ? " open" : "") + "><summary><b>" + esc(H.tx(sec.name)) + "</b>" + (d.order.length > 1 ? "<small>" + esc(name(sid)) + "</small>" : "") + (on ? '<span class="tt-tag">' + on + " weak</span>" : "") + '</summary><div class="pn-wrap">' +
          mods.map(function (m) { var o = !!d.weak[m.id]; return '<button type="button" class="pn-chip sm' + (o ? " on" : "") + '" aria-pressed="' + o + '" data-act="tt-weak" data-v="' + esc(m.id) + '">' + esc(H.tx(m.name)) + "</button>"; }).join("") + "</div></details>";
      }).join("");
    }).join("");
    var revN = ex != null && ex > d.end ? ex - d.end - 1 : 0;
    var line = c.learn + " first-reading days, " + c.gt + " grand " + (c.gt === 1 ? "test" : "tests") + ", " + c.rest + " rest " + (c.rest === 1 ? "day" : "days") + (ex != null && ex > d.start ? ", " + revN + " days of revision before the exam on " + fmtDay(ex, true) : "") + ".";
    H.paint(H.bar("ReWise", tt() ? "Edit" : "New plan", "back") + '<div class="pn-body tt-edit">' +
      (d.was1 ? '<p class="tt-note" role="note"><b>Your timetable is now ReWise.</b> It plans by topic, weakest first, with grand tests, review days and a daily routine. Check the settings and save.</p>' : "") +
      examWarn(ex, td) +
      '<section class="pn-panel"><h2 class="pn-sec">Dates</h2><div class="tt-dates">' +
      '<label><span>Start</span><input type="date" class="pn-in" id="ttStart" value="' + isoOfDay(d.start) + '" min="' + isoOfDay(td) + '"></label>' +
      '<label><span>Finish first reading by</span><input type="date" class="pn-in" id="ttEnd" value="' + isoOfDay(d.end) + '" min="' + isoOfDay(td) + '"></label>' +
      '<label><span>Exam date</span><input type="date" class="pn-in" id="ttExam" value="' + (ex != null ? isoOfDay(ex) : "") + '" min="' + isoOfDay(td) + '"></label></div>' +
      '<button type="button" class="pn-btn" data-act="tt-dates">Apply dates</button>' +
      '<p class="pn-mut pn-small" role="status">' + esc(line) + "</p></section>" +
      '<section class="pn-panel"><h2 class="pn-sec">Hours a day</h2>' + chips("tt-hrs", HRS.map(function (n) { return [n, n + " h"]; }), function (v) { return v === d.hrs; }, "Hours a day") +
      '<p class="pn-mut pn-small">Sets each day\'s question targets. With fewer hours the question counts shrink; error review and rest stay.</p></section>' +
      '<section class="pn-panel"><h2 class="pn-sec">Rest days</h2>' + chips("tt-off", WDL, function (v) { return d.off.indexOf(v) >= 0; }, "Rest days") +
      (d.off.length ? '<p class="pn-mut pn-small">Nothing is planned on a rest day. Sleep and a real break are part of the plan.</p>' : '<p class="tt-warn" role="note">No rest day. Most plans protect one day a week; tired weeks cost more than one day.</p>') + "</section>" +
      '<section class="pn-panel"><h2 class="pn-sec">Grand test day</h2>' + chips("tt-gt", [[-1, "None"]].concat(WDL.filter(function (c2) { return d.off.indexOf(c2[0]) < 0; })), function (v) { return v === d.gt; }, "Grand test day") +
      '<p class="pn-mut pn-small">A timed full test each week. The next study day reviews it and repairs your weakest topics.</p></section>' +
      (d.order.length + d.out.length > 1 ? '<section class="pn-panel"><h2 class="pn-sec">Subjects, in order</h2><ol class="tt-list">' + rows + "</ol>" + outs + "</section>" : "") +
      '<section class="pn-panel"><h2 class="pn-sec">Topics you find weak</h2><p class="pn-mut pn-small">Tick any you want first. ReWise also puts first the topics where your own answers are weak.' + (nWeak ? " " + nWeak + " ticked." : "") + "</p>" + weakHtml + "</section>" +
      '<button type="button" class="pn-btn pri" data-act="tt-save"' + (d.order.length && !T.busy ? "" : " disabled") + ">" + (T.busy ? "Planning" : tt() ? "Save ReWise" : "Make my ReWise plan") + "</button>" +
      (tt() || tt1() ? '<button type="button" class="pn-link tt-off" data-act="tt-stop">Turn ReWise off</button>' : "") + "</div>");
  }
  function arrow(dir) { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (dir < 0 ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6") + '"/></svg>'; }
  function readDates() {
    var d = draft(), r = H.root(), td = H.today(), q = function (id) { var el = r && r.querySelector(id); return el ? el.value : null; };
    var s0 = dayOfIso(q("#ttStart")), e0 = dayOfIso(q("#ttEnd")), x0 = q("#ttExam");
    if (s0 != null) d.start = Math.max(td, s0);
    if (e0 != null) d.end = e0;
    if (x0 != null) d.exam = x0 ? dayOfIso(x0) : null;
    if (d.end < d.start) { d.end = d.start; H.toast("The finish date moved to the start date."); }
    if (d.exam != null && d.exam > td && d.end >= d.exam) { d.end = d.exam - 1; H.toast("The first reading now finishes the day before the exam."); }
  }
  function blockHtml(b, x, tick, live) {
    var done = !!(tick && tick[b.k]), act = "";
    if (live && b.go && b.go !== "mock" && b.go !== "rev" && !(b.go === "prac" && !x.t.length)) act = '<button type="button" class="pn-btn sm" data-act="p-go" data-k="' + b.go + '">Start</button>';
    if (live && b.go === "rev" && b.n) act = '<button type="button" class="pn-btn sm" data-act="p-go" data-k="rev">Start</button>';
    if (live && b.go === "mock") act = '<button type="button" class="pn-btn sm" data-act="p-go" data-k="mock">Start</button>';
    if (live && b.k === "read") act = x.read ? '<button type="button" class="pn-btn sm" data-act="l-open" data-s="' + esc(x.read.s) + '" data-m="' + esc(x.read.m) + '"' + (x.read.k && x.read.k !== x.read.m ? ' data-l="' + esc(x.read.k) + '"' : "") + ">Open</button>" : x.t[0] ? '<button type="button" class="pn-btn sm" data-act="module" data-s="' + esc(subjOfMod(x.t[0]) || "") + '" data-m="' + esc(x.t[0]) + '">Open</button>' : "";
    if (live && (b.k === "errors" || b.k === "first")) act = '<button type="button" class="pn-btn sm" data-act="tt-err">Open</button>';
    if (live && b.k === "quick") act = x.t[0] && x.k === "learn" ? '<button type="button" class="pn-btn sm" data-act="k-open" data-s="' + esc(subjOfMod(x.t[0]) || "") + '" data-m="' + esc(x.t[0]) + '" data-t="' + esc(mname(x.t[0])) + '">Open</button>' : '<button type="button" class="pn-btn sm" data-act="k-due">Open</button>';
    return '<li class="tt-bk' + (done ? " done" : "") + '">' + (live ? '<button type="button" class="tt-tick" role="checkbox" aria-checked="' + done + '" data-act="tt-tick" data-v="' + b.k + '" aria-label="' + esc(b.title) + ' done"><i aria-hidden="true"></i></button>' : "") +
      '<span class="tt-bn"><b>' + esc(b.title) + " <small>" + b.min + " min</small></b><small>" + esc(b.sub || "") + "</small></span>" + act + "</li>";
  }
  function dayRow(x, td) {
    var tag = x.d === td ? "Today" : fmtDay(x.d, true), what = x.k === "learn" ? x.list : x.k === "rev" ? "Revision: " + x.head : KIND[x.k] || "";
    return '<li class="tt-dr k-' + x.k + (x.d === td ? " now" : "") + '"><span>' + esc(tag) + "</span><b>" + esc(what) + "</b>" + (x.k === "gt" || x.k === "gtr" || x.k === "rest" || x.k === "taper" || x.k === "exam" ? '<em class="tt-kd">' + esc(KIND[x.k]) + "</em>" : "") + "</li>";
  }
  function renderView() {
    var t = tt(); if (!t) return renderEdit();
    var td = H.today(), ex = examDay(), lessons = T.lessons || null, x = info(td, lessons);
    if (!lessons && G.PREP_LESSONS && G.PREP_LESSONS.index && !T.lessLoading) {
      T.lessLoading = true;
      G.PREP_LESSONS.index().then(function (ix) {
        T.lessons = Object.keys((ix && ix.modules) || {}).map(function (k) { var y = ix.modules[k], m = y.module || k; return { m: m, k: k, s: H.subjectOfModule(m), title: y.title, minutes: y.minutes || 5 }; }).filter(function (l) { return l.s; });
        if (H.stackTop() === renderView) H.rerender();
      }, function () { T.lessons = []; });
    }
    // Today's plan follows ReWise; make it now so the Start buttons find their items.
    if (G.PREP_PLAN && G.PREP_PLAN.ensure) G.PREP_PLAN.ensure(H);
    var miss = missed(t.days, td, studied), tick = (t.tk || {})[td] || {};
    var head;
    if (!x) head = '<p class="tt-now"><b>Plan finished</b><small>Make a new plan for what is next</small></p>';
    else if (x.k === "before") head = '<p class="tt-now"><b>Starts ' + esc(fmtDay(t.start, true)) + "</b></p>";
    else head = '<p class="tt-now"><span class="tt-kind k-' + x.k + '">' + esc(KIND[x.k]) + "</span><b>" + esc(x.k === "learn" || x.k === "rev" ? x.head : x.line) + "</b>" + (ex != null && ex >= td ? "<small>" + (ex === td ? "Exam today" : plural(ex - td, "day", "days") + " to the exam") + "</small>" : "") + "</p>";
    var why = x && x.k === "learn" ? '<ul class="tt-why">' + x.t.map(function (id) { var tp = topicNow(id, t.weak); return "<li><b>" + esc(mname(id)) + "</b><small>" + esc(whyOf(tp)) + "</small></li>"; }).join("") + "</ul>" : "";
    var bl = x && x.blocks && x.blocks.length ? '<ul class="tt-bks">' + x.blocks.map(function (b) { return blockHtml(b, x, tick, true); }).join("") + "</ul>" : "";
    var rest = x && x.k === "rest" ? '<p class="pn-mut pn-small">Nothing is planned. Due reviews stay in Today\'s plan if you want them.</p>' : "";
    // Days: the next 14, or all.
    var list = [], end = T.all ? Infinity : td + 13;
    (t.days || []).forEach(function (y) { if (y.d >= td && y.d <= end) { var z = info(y.d, null); if (z) list.push(z); } });
    var more = (t.days || []).filter(function (y) { return y.d > td + 13; }).length;
    // First reading coverage: planned topics touched since their day.
    var planned = [], read = 0; (t.days || []).forEach(function (y) { if (y.k === "learn") (y.t || []).forEach(function (id) { if (planned.indexOf(id) < 0) planned.push(id); }); });
    var rs = readSet(t.days, td + 1, studied); planned.forEach(function (id) { if (rs[id]) read++; });
    var pc = planned.length ? read / planned.length : 0;
    H.paint(H.bar("ReWise", "", "back", '<button type="button" class="pn-ib" data-act="tt-edit" aria-label="Edit ReWise">' + H.ico("gear") + "</button>") + '<div class="pn-body tt-view">' +
      examWarn(ex, td).replace("below", "in Edit") + (ex != null && ex < td ? '<button type="button" class="pn-btn" data-act="tt-edit">Set the new exam date</button>' : "") +
      '<section class="pn-panel tt-today"><p class="pn-eb tt-eb">Today</p>' + head + why + bl + rest + "</section>" +
      (miss.length ? '<section class="pn-panel tt-lag" role="note"><p><b>' + plural(miss.length, "study day", "study days") + " missed:</b> " + esc(miss.slice(0, 3).map(function (y) { return fmtDay(y.d); }).join(", ")) + (miss.length > 3 ? " and more" : "") + ".</p>" +
        '<p class="pn-mut pn-small">Re-plan lays the topics not yet studied over the days left, from today. Nothing is doubled up to catch up.</p><button type="button" class="pn-btn" data-act="tt-replan">Re-plan from today</button></section>' : "") +
      '<h2 class="pn-sec">' + (T.all ? "Every day" : "Next 14 days") + '</h2><ol class="tt-days">' + list.map(function (z) { return dayRow(z, td); }).join("") + "</ol>" +
      (more && !T.all ? '<button type="button" class="pn-link" data-act="tt-all">Show all ' + (t.days.filter(function (y) { return y.d >= td; }).length) + " days</button>" : "") +
      '<h2 class="pn-sec">First reading</h2><section class="pn-panel tt-cov"><p><b>' + read + " of " + planned.length + "</b> topics studied on or after their day</p>" +
      '<span class="pn-meter" aria-hidden="true"><i style="transform:scaleX(' + pc.toFixed(3) + ')"></i></span>' +
      (t.strong && t.strong.length ? '<p class="pn-mut pn-small">' + plural(t.strong.length, "topic is", "topics are") + " already strong (80% or more over 30 answers): mixed practice only.</p>" : "") + "</section>" +
      '<p class="pn-mut pn-small tt-foot">' + esc(hours(t) + " h a day. First reading by " + fmtDay(t.end, true) + (ex != null ? ", exam " + fmtDay(ex, true) : "") + ". Rest: " + (t.off.length ? t.off.slice().sort().map(function (i) { return WD[i]; }).join(", ") : "none") + ". Grand test: " + (t.gt >= 0 ? WD[t.gt] : "none") + ".") + "</p>" +
      (miss.length ? "" : '<button type="button" class="pn-link" data-act="tt-replan">Re-plan from today</button>') + "</div>");
  }
  // Build and save from the draft (or the stored plan for a re-plan). skip: topics already read keep their past days.
  function make(d, keepPast) {
    var t0 = tt(), td = H.today(), ex = d.exam != null && d.exam > td ? d.exam : null;
    T.busy = true;
    return topicsFor(d.order, d.weak).then(function (topics) {
      var skip = keepPast && t0 ? readSet(t0.days, td, studied) : {};
      var p = plan({ start: d.start, end: d.end, exam: ex, off: d.off, gt: d.gt, topics: topics, skip: skip });
      var past = keepPast && t0 ? (t0.days || []).filter(function (y) { return y.d < d.start; }) : [];
      var t = { v: 2, ex: H.exam().id, start: past.length ? past[0].d : d.start, end: d.end, off: d.off.slice(), gt: d.gt, hrs: d.hrs, order: d.order.slice(), weak: d.weak,
        days: past.concat(p.days), strong: p.strong, topicsAll: topics.map(function (x) { return x.id; }), tk: t0 && t0.tk ? t0.tk : {} };
      T.busy = false;
      saveTt(t);
      return t;
    }, function (e) { T.busy = false; throw e; });
  }
  function replan(quiet) {
    var t = tt(); if (!t) return;
    var td = H.today();
    if (t.end < td && examDay() == null) { H.toast("The finish date has passed. Pick a new one."); T.d = null; return H.push(renderEdit); }
    var d = { start: td, end: Math.max(td, t.end), exam: examDay(), off: t.off, gt: t.gt, hrs: t.hrs, order: t.order, weak: t.weak || {} };
    return make(d, true).then(function () { if (!quiet) H.toast("Re-planned from today"); H.rerender(); });
  }

  function act(a, b, h) {
    H = h;
    var v = b.getAttribute("data-v"), d;
    if (a === "tt-open") return open();
    if (a === "tt-edit") { T.d = null; return H.push(renderEdit); }
    if (a === "tt-all") { T.all = !T.all; return H.rerender(); }
    if (a === "tt-err") return H.openMistakes ? H.openMistakes() : null;
    if (a === "tt-tick") {
      var t2 = tt(); if (!t2) return; var td2 = H.today(); t2.tk = t2.tk || {};
      var k = t2.tk[td2] || (t2.tk[td2] = {}); if (k[v]) delete k[v]; else k[v] = 1;
      // Keep 60 days of ticks.
      Object.keys(t2.tk).forEach(function (x) { if (+x < td2 - 60) delete t2.tk[x]; });
      H.save(); return H.rerender();
    }
    if (a === "tt-dates") { readDates(); return H.rerender(); }
    if (a === "tt-hrs") { readDates(); draft().hrs = Number(v); return H.rerender(); }
    if (a === "tt-gt") { readDates(); draft().gt = Number(v); return H.rerender(); }
    if (a === "tt-weak") { readDates(); d = draft(); if (d.weak[v]) delete d.weak[v]; else d.weak[v] = 1; return H.rerender(); }
    if (a === "tt-off") { readDates(); d = draft(); var i = Number(v), j = d.off.indexOf(i); if (j >= 0) d.off.splice(j, 1); else if (d.off.length < 6) { d.off.push(i); if (d.gt === i) d.gt = -1; } else H.toast("Keep at least one study day a week."); return H.rerender(); }
    if (a === "tt-up" || a === "tt-dn") { readDates(); d = draft(); d.order = move(d.order, v, a === "tt-up" ? -1 : 1); return H.rerender(); }
    if (a === "tt-rm") { readDates(); d = draft(); d.order = d.order.filter(function (x) { return x !== v; }); d.out.push(v); return H.rerender(); }
    if (a === "tt-add") { readDates(); d = draft(); d.out = d.out.filter(function (x) { return x !== v; }); d.order.push(v); return H.rerender(); }
    if (a === "tt-save") {
      readDates(); d = draft(); if (!d.order.length || T.busy) return;
      var s = store(), had = !!tt();
      // The exam date lives in the plan answers (pl.date), where Today's plan and the countdown read it.
      if (s.pl) { var iso = d.exam != null ? isoOfDay(d.exam) : null; if (s.pl.date !== iso) { s.pl.date = iso; H.save(); } }
      H.rerender();
      return make(d, had).then(function () {
        T.d = null; H.toast(had ? "ReWise saved" : "ReWise is ready. Today's plan and reminders now follow it.");
        H.stack().pop(); if (!had) H.stack().push(renderView);
        H.rerender();
      }, function () { H.toast("The topics did not load. Check the connection and try again."); H.rerender(); });
    }
    if (a === "tt-stop") { var s2 = store(); s2.tt = null; s2.pt = null; H.save(); T.d = null; H.toast("ReWise off"); H.stack().pop(); var top = H.stackTop(); if (top === renderView) H.stack().pop(); return H.rerender(); }
    if (a === "tt-replan") return replan();
  }
  function back() { return false; }

  G.PREP_TT = { act: act, back: back, today: today, planItems: planItems, notice: notice, lineHtml: lineHtml, homeRow: homeRow, info: function (h, d) { H = h || H; return info(d, null); }, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
