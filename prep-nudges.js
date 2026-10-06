/* PrepNucleus nudges: personal study notifications computed on the phone. window.PREP_NUDGES. ES5.
   Plan: vault/plans/PrepNucleus-Nudges.md. Loaded by prep-loader.js before prep-native.js, which calls feed() on every
   flush (open, answer, plan change) while the student picked "Smart nudges".

   Rule zero: every nudge is true when it fires. Each one is computed from the store as it is now, and anything that
   would change it (an answer, a plan change, a sync) happens inside the app, which reschedules everything. So a count
   scheduled for later is still the count then. Numbers that drift by themselves (readiness decays with time) are only
   shown on the day they were computed. Social nudges ("a friend challenged you") come only from the server, from real
   rows (functions/_prep-nudge-push.js); this file never claims anything about other people.

   Rules: at most 2 a day, at least 4 h apart, never in quiet hours (default 22:30 to 07:30, editable); after 3 ignored
   in a row, 1 a day; while the app stays closed: nothing on day 3, then one on days 4 and 6, then every 3 days, nothing
   after day 21 until the app opens again. Variants rotate without repeating the last one of a kind.

   State (localStorage smd_prep_ndg, per device): { q: "HH:MM-HH:MM", ses: [session start ms], act: last activity ms,
   plan: [{ id, k, v, at, key? }] scheduled now, hist: [{ k, v, at, key?, acted }] delivered, sn: { dayNum: [T, OK,
   score, exam, { subject: [t, ok] }] } end-of-day totals for the weekly recap and wins }.
   Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  /* ================= pure ================= */
  // Stable ids: above icu.js (1 to 2147483000), below prep-native.js's daily reminder (2147483100).
  var ID0 = 2147483001, ID_N = 60;
  var H4 = 4 * 3600e3, H3 = 3 * 3600e3, DAY = 864e5;
  var QUIET = "22:30-07:30", REGULAR = 3, TAIL = [4, 6, 9, 12, 15, 18, 21];
  var MILES = [100, 60, 30, 14, 7], Q_MILES = [100, 500, 1000, 2500, 5000, 10000], S_MILES = [7, 30, 100];
  var ARENA = { "neet-pg": 1, "neet-ss": 1, "usmle": 1 };

  /* The catalogue. [title, body]; {x} is filled from the trigger's variables, and a variant whose variables are not all
     known is skipped (so {name} lines appear only with a name). No em-dash, no shame, no fear, no fake urgency.
     No emoji: the app has none (owner 2026-09-24) and emoji-icons.js strips them from LocalNotifications.schedule. */
  var T = {
    plan_start: [
      ["Today's plan is ready", "{items}, about {min} min. Chai ready? Let's begin."],
      ["{name}, aaj ka plan ready hai", "{items}, about {min} min. Shuru karein?"],
      ["Study time", "Your plan has {items}, about {min} min. Start small, start now."]
    ],
    plan_half: [
      ["{done} of {total} done", "About {min} min left in today's plan. Finish strong?"],
      ["{lq} questions to go", "{done} of {total} plan items done. The rest take about {min} min."],
      ["Bas thoda aur", "{done} of {total} done today. About {min} min finishes the plan."]
    ],
    plan_ready: [
      ["Today's plan is ready", "Reviews first, then new questions, sized to your daily time."],
      ["Your {exam} plan for today", "Made fresh each morning from what's due and where you're weakest."],
      ["Ek chhota session?", "Today's plan fits your daily time. Open it when you're ready."]
    ],
    due: [
      ["{due} reviews due", "Spaced reviews work best close to the due day. About {min} min clears them."],
      ["Revision time: {due} questions", "Thoda thoda karke. Even 10 now helps. All of them take about {min} min."],
      ["{name}, {due} reviews are waiting", "About {min} min. Each one you get right is scheduled further out."]
    ],
    weak: [
      ["{subject} needs some love", "It's your weakest subject for {exam} right now. 10 questions there today?"],
      ["Quick {subject} round?", "Lowest in your readiness right now ({score}/100). Small rounds add up."],
      ["{subject} today?", "Your weakest subject. A 10 question round takes about 10 min."]
    ],
    streak: [
      ["{streak} day streak", "One question today keeps it going. Bas ek."],
      ["Keep the {streak} days going", "Even 5 questions count for today."],
      ["{name}, day {next}?", "{streak} days in a row so far. One question today makes it {next}."]
    ],
    win_q: [
      ["{q} questions done", "That's real work. Today's plan is ready when you are."],
      ["You crossed {q} questions", "Every one of them is in your spaced reviews now."]
    ],
    win_streak: [
      ["{streak} days straight", "Showing up every day is the hard part, and you're doing it."],
      ["{streak} day streak, {name}", "Consistency is most of the game. Nice work."]
    ],
    win_acc: [
      ["{subject} is up", "{acc}% right this week, up from {prev}% last week. Nice."],
      ["Your {subject} is improving", "{prev}% to {acc}% right, week on week. Keep that going."]
    ],
    countdown: [
      ["{days} days to {exam}", "Today's plan is ready. Steady beats cramming."],
      ["{exam} in {days} days", "Your plan shifts as the date gets closer. Today's is ready."]
    ],
    comeback: [
      ["Missed you, {name}", "No pressure. 5 questions to warm up?"],
      ["Wapas aa jao?", "Your {exam} plan picks up right where you left it."],
      ["Fresh start today?", "{due} reviews are waiting, about {min} min. Start with 5."],
      ["Small step today?", "{days} days to {exam}. 10 minutes is enough to restart."]
    ],
    recap: [
      ["Your week", "{q} questions, {acc}% right. Readiness {from} → {to}."],
      ["Week done", "{q} questions this week at {acc}% right. Shabash!"]
    ],
    sprint: [
      ["Daily sprint at {time}", "20 questions, 20 min, the same set for everyone."],
      ["Sprint in 15 min", "20 questions with everyone in the Arena tonight. In?"]
    ],
    grand: [
      ["Weekly grand test at {time}", "{n} questions, {min} min, marked like the exam."]
    ]
  };
  // Where a tap goes: PREP.open(opts) through native-push.js and home.js SMD_openRoute("prep", opts).
  var ROUTE = { due: { mode: "plan" } };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function mins(s) { var m = /^(\d{2}):(\d{2})$/.exec(String(s || "")); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; }
  function hhmm(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  // "22:30-07:30" -> { a, b } in minutes; anything else -> the default.
  function parseQuiet(q) {
    var p = String(q || "").split("-"), a = mins(p[0]), b = mins(p[1]);
    return a == null || b == null ? parseQuiet(QUIET) : { a: a, b: b };
  }
  function inQuiet(m, q) { return q.a === q.b ? false : q.a < q.b ? m >= q.a && m < q.b : m >= q.a || m < q.b; }
  function minuteOf(ms) { var d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }
  // Local midnight k days after now's day, and a local time on that day (DST safe: local Date constructor).
  function dayStart(now, k) { var d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k).getTime(); }
  function atMin(day0, m) { var d = new Date(day0); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60).getTime(); }
  function sameDay(a, b) { return dayStart(a, 0) === dayStart(b, 0); }
  function fmt(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function plural(n, one, many) { return fmt(n) + " " + (n === 1 ? one : many); }
  // "8 pm", "10:30 am": local clock time for a notification body.
  function clock(ms) { var d = new Date(ms), h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + (m ? ":" + pad(m) : "") + (h < 12 ? " am" : " pm"); }
  // First name only, without a title: "Dr. Asha Rao" -> "Asha". Null for an email or nothing usable.
  function firstName(s) {
    var w = String(s || "").replace(/@.*/, "").trim().split(/\s+/).filter(function (x) { return !/^(dr|dr\.|prof|prof\.|mr|mr\.|ms|ms\.|mrs|mrs\.)$/i.test(x); });
    var f = w[0] || ""; return /^[A-Za-zÀ-ɏऀ-ॿ][A-Za-zÀ-ɏऀ-ॿ'.]{1,19}$/.test(f) && String(s).indexOf("@") < 0 ? f.replace(/\.$/, "") : null;
  }

  /* The student's usual study time: the most common local start hour of their sessions in the last 30 days (5 or more
     sessions), as minutes past midnight, a quarter past that hour (a nudge then means they have not started). Null
     when there is not enough to learn from. */
  function bestTime(ses, now) {
    var by = {}, n = 0, best = null;
    (ses || []).forEach(function (t) { if (t > now - 30 * DAY && t <= now) { var h = new Date(t).getHours(); by[h] = (by[h] || 0) + 1; n++; } });
    if (n < 5) return null;
    for (var h = 0; h < 24; h++) if (by[h] && (best == null || by[h] > by[best])) best = h;
    return best * 60 + 15;
  }
  // The time the day's main nudge goes: learned, else the reminder time, else 7 pm; moved out of quiet hours.
  function anchorFor(learned, rem, q) {
    var a = learned != null ? learned : mins(rem) != null ? mins(rem) : 19 * 60;
    if (inQuiet(a, q)) a = (q.a - 30 + 1440) % 1440;
    return inQuiet(a, q) ? null : a;
  }
  // Delivered nudges ignored in a row, newest first: acted = the app was used within 3 h of it.
  function ignoredRun(hist) { var n = 0; for (var i = (hist || []).length - 1; i >= 0 && !hist[i].acted; i--) n++; return n; }
  // Moves what fired since the last plan into the history; now is the moment the app is in use.
  function settle(plan, hist, now) {
    var out = (hist || []).slice();
    (plan || []).filter(function (p) { return p.at <= now; }).sort(function (a, b) { return a.at - b.at; })
      .forEach(function (p) { var h = { k: p.k, v: p.v, at: p.at, acted: now - p.at <= H3 }; if (p.key) h.key = p.key; out.push(h); });
    return out.slice(-40);
  }
  function fill(s, vars) { return s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k]; }); }
  function known(s, vars) { var ok = true; s.replace(/\{(\w+)\}/g, function (m, k) { if (vars[k] == null || vars[k] === "") ok = false; return m; }); return ok; }
  // A variant for this kind and day, never the one used last for the kind. -> index or -1.
  function pick(kind, dayNum, last, vars) {
    var list = T[kind] || [], av = [];
    list.forEach(function (t, i) { if (known(t[0], vars) && known(t[1], vars)) av.push(i); });
    if (!av.length) return -1;
    var j = ((dayNum % av.length) + av.length) % av.length;
    if (av[j] === last && av.length > 1) j = (j + 1) % av.length;
    return av[j];
  }

  /* Arena events (functions/_prep-arena.js): daily sprint 20:00 IST, weekly grand test Sunday 11:00 IST. The nudge goes
     15 min before a sprint and 30 min before a grand test. -> [{ k, at, vars }] between from and to. */
  function arenaTimes(exam, from, to) {
    var out = [], IST = 5.5 * 3600e3, d = new Date(from);
    for (var j = -1; j < 25; j++) {
      var sprint = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + j, 14, 30), grand = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + j, 5, 30);
      if (sprint - 15 * 60e3 >= from && sprint - 15 * 60e3 < to) out.push({ k: "sprint", at: sprint - 15 * 60e3, vars: { time: clock(sprint) } });
      if (new Date(grand + IST).getUTCDay() === 0 && grand - 30 * 60e3 >= from && grand - 30 * 60e3 < to) {
        var ss = exam === "neet-ss";
        out.push({ k: "grand", at: grand - 30 * 60e3, vars: { time: clock(grand), n: ss ? 50 : 100, min: ss ? 60 : 120 } });
      }
    }
    return out;
  }

  /* The next notifications. o: {
       now, quiet "HH:MM-HH:MM", anchor (minutes, from anchorFor), name (first name or null), exam (label), examDays
       (days to the exam today, or null), plan: { items: [{ k, done, x, of, min }] } | null (today's plan), due: [count
       due on day 0, 1, ... 21] (questions only; reviewing needs the app, which reschedules), streak (days, counted
       through today if studied today, else through yesterday), studiedToday, weak: { id, name, score } | null,
       wins: [{ key, k: "win_q"|"win_streak"|"win_acc", vars, route? }], recap: { k (day offset of the Sunday), q,
       acc, from?, to? } | null, arena: exam id when the student joined the Arena, hist (settled history) }
     -> [{ id, k, v, key?, at, title, body, extra: { route: "prep", prep: opts } }] sorted by time. */
  function build(o) {
    var now = o.now, q = parseQuiet(o.quiet), A = o.anchor, hist = o.hist || [], per = ignoredRun(hist) >= 3 ? 1 : 2;
    var won = {}, last = {}, out = [];
    hist.forEach(function (h) { if (h.key) won[h.key] = 1; last[h.k] = h.v; });
    var base = { name: o.name || null, exam: o.exam || null };
    var arena = o.arena && ARENA[o.arena] ? arenaTimes(o.arena, now, dayStart(now, REGULAR)) : [];
    var days = []; for (var i = 0; i < REGULAR; i++) days.push(i); days = days.concat(TAIL);
    days.forEach(function (k) {
      var day0 = dayStart(now, k), taken = [], cap;
      hist.forEach(function (h) { if (sameDay(h.at, day0)) taken.push(h.at); });
      cap = (k < REGULAR ? per : 1) - taken.length;
      if (cap <= 0) return;
      cands(o, k, A, won, base, arena, day0).some(function (c) {
        var tries = c.at ? [c.at] : c.ms.filter(function (m) { return m >= 0 && m < 1440; }).map(function (m) { return atMin(day0, m); }), at = null;
        for (var t = 0; t < tries.length && at == null; t++) {
          var x = tries[t];
          if (x <= now + 60e3 || !sameDay(x, day0) || inQuiet(minuteOf(x), q)) continue;
          if (taken.some(function (y) { return Math.abs(y - x) < H4; })) continue;
          at = x;
        }
        if (at == null) return false;
        var v = pick(c.k, Math.floor(at / DAY), last[c.k], c.vars);
        if (v < 0) return false;
        var t0 = T[c.k][v], n = { k: c.k, v: v, at: at, title: fill(t0[0], c.vars), body: fill(t0[1], c.vars), extra: { route: "prep", prep: c.route || ROUTE[c.k] || {} } };
        if (c.key) { n.key = c.key; won[c.key] = 1; }
        last[c.k] = v; taken.push(at); out.push(n);
        return --cap <= 0;
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out.slice(0, ID_N).map(function (n, i) { n.id = ID0 + i; return n; });
  }
  function vars(base, more) { var v = {}, k; for (k in base) v[k] = base[k]; for (k in more) v[k] = more[k]; return v; }
  // Candidates for day k, best first. Each { k, ms: [minutes to try] | at, vars, route?, key? }.
  function cands(o, k, A, won, base, arena, day0) {
    var out = [], prim = A == null ? [] : [A], sec = A == null ? [19 * 60] : [A + 240, A - 240, A + 300];
    var dl = o.examDays == null ? null : o.examDays - k, due = (o.due || [])[k] || 0, dueMin = Math.ceil(due / 2);
    var b = vars(base, { days: dl != null && dl >= 1 ? dl : null });
    var plan = o.plan && o.plan.items && o.plan.items.length ? o.plan : null;
    var milestone = dl != null && MILES.indexOf(dl) >= 0;
    var weak = o.weak && o.weak.name ? vars(b, { subject: o.weak.name, score: k === 0 ? o.weak.score : null }) : null;
    var weakRoute = o.weak ? { subject: o.weak.id } : null;
    if (k === 0) {
      var it = plan ? plan.items : [], dn = it.filter(function (x) { return x.done; }).length;
      if (milestone && dn === 0) out.push({ k: "countdown", ms: prim, vars: b });
      if (plan && dn === 0) {
        var m0 = it.reduce(function (s, x) { return s + (x.min || 0); }, 0);
        out.push({ k: "plan_start", ms: prim, vars: vars(b, { items: plural(it.length, "item", "items"), min: m0 }), route: {} });
      } else if (plan && dn < it.length) {
        var left = 0, lq = 0;
        it.forEach(function (x) { if (x.done) return; left += (x.min || 0) * (x.of ? 1 - (x.x || 0) / x.of : 1); if (x.k === "rev" || x.k === "new") lq += Math.max(0, (x.of || 0) - (x.x || 0)); });
        out.push({ k: "plan_half", ms: prim.concat(sec), vars: vars(b, { done: dn, total: it.length, min: Math.max(1, Math.ceil(left)), lq: lq || null }), route: {} });
      } else if (!plan) out.push({ k: "plan_ready", ms: prim, vars: b, route: {} });
    } else if (k === 1) {
      if (milestone) out.push({ k: "countdown", ms: prim, vars: b });
      if (due >= 20) out.push({ k: "due", ms: prim, vars: vars(b, { due: fmt(due), min: dueMin }) });
      if (weak) out.push({ k: "weak", ms: prim, vars: weak, route: weakRoute });
      out.push({ k: "plan_ready", ms: prim, vars: b, route: {} });
    } else {
      if (k === 2 && milestone) out.push({ k: "countdown", ms: prim, vars: b });
      out.push({ k: "comeback", ms: prim.length ? prim : sec, vars: vars(b, { due: due > 0 ? fmt(due) : null, min: due > 0 ? dueMin : null }), route: {} });
    }
    if (k >= REGULAR) return out;
    // Second slot: the recap, a streak at risk, a win, then the Arena (only for those who joined it).
    if (o.recap && o.recap.k === k && o.recap.q > 0) out.push({ k: "recap", ms: [19 * 60, 18 * 60, 20 * 60].concat(sec), vars: vars(b, { q: fmt(o.recap.q), acc: o.recap.acc, from: k === 0 ? o.recap.from : null, to: k === 0 ? o.recap.to : null }), route: {} });
    var risk = k === 0 ? (!o.studiedToday && o.streak >= 3) : k === 1 ? (o.studiedToday && o.streak >= 3) : false;
    if (risk) out.push({ k: "streak", ms: sec, vars: vars(b, { streak: o.streak, next: o.streak + 1 }), route: {} });
    if (k <= 1) (o.wins || []).forEach(function (w) { if (!won[w.key]) out.push({ k: w.k, ms: sec, vars: vars(b, w.vars), key: w.key, route: w.route || {} }); });
    arena.forEach(function (e) { if (sameDay(e.at, day0)) out.push({ k: e.k, at: e.at, vars: vars(b, e.vars), route: {} }); });
    return out;
  }

  /* Due questions per day offset 0..21 from the FSRS cards (prep-plan.js isQ keys). cards[k] = [d, s, last, due, ...]. */
  function dueByDay(cards, today, isQ) {
    var out = []; for (var i = 0; i <= 21; i++) out.push(0);
    Object.keys(cards || {}).forEach(function (k) { if (!isQ(k)) return; var d = cards[k][3] - today; for (var i = Math.max(0, d); i <= 21; i++) out[i]++; });
    return out;
  }
  /* Celebrations still owed. o: { total answers, streak, studiedToday, accWin: { subject, name, acc, prev, key } | null }.
     Only the highest milestone reached counts, so a student who arrives with 2,600 answers hears about 2,500 once. */
  function wins(o) {
    var out = [], qm = null, sm = null;
    Q_MILES.forEach(function (m) { if (o.total >= m) qm = m; });
    S_MILES.forEach(function (m) { if (o.streak >= m) sm = m; });
    if (qm) out.push({ key: "q" + qm, k: "win_q", vars: { q: fmt(qm) } });
    if (sm && o.studiedToday && o.streak === sm) out.push({ key: "s" + sm + ":" + o.today, k: "win_streak", vars: { streak: sm } });
    if (o.accWin) out.push({ key: o.accWin.key, k: "win_acc", vars: { subject: o.accWin.name, acc: o.accWin.acc, prev: o.accWin.prev }, route: { subject: o.accWin.subject } });
    return out;
  }
  /* End-of-day totals, newest kept: sn[day] = [T, OK, score, exam, { subject: [t, ok] }]. Keeps 35 days. */
  function snap(sn, day, row) {
    var out = {}; Object.keys(sn || {}).map(Number).filter(function (d) { return d > day - 35 && d !== day; }).forEach(function (d) { out[d] = sn[d]; });
    out[day] = row; return out;
  }
  // The latest snapshot strictly before day, or null.
  function before(sn, day) { var best = null; Object.keys(sn || {}).map(Number).forEach(function (d) { if (d < day && (best == null || d > best)) best = d; }); return best == null ? null : sn[best]; }
  /* The weekly recap for the Sunday within the next 3 days, from snapshots: this week = Monday to that Sunday, counted
     from the last snapshot before Monday (no app use between then and Monday, so nothing is missed). null without one,
     with no answers this week, or when the week's base is from another exam (readiness compares like with like).
     today = day number, dow = today's weekday (0 Sunday), now = [T, OK, score, exam]. */
  function recap(sn, today, dow, cur) {
    var k = (7 - dow) % 7; if (k > 2) return null;
    var monday = today + k - 6, b = before(sn, monday);
    if (!b) return null;
    var q = cur[0] - b[0], ok = cur[1] - b[1];
    if (q <= 0) return null;
    var r = { k: k, q: q, acc: Math.round(100 * ok / q) };
    if (b[3] === cur[3]) { r.from = b[2]; r.to = cur[2]; }
    return r;
  }
  /* Accuracy up in a subject: this week against last week, each with 20+ answers, up 5 points or more. names: id -> name. */
  function accWin(sn, today, dow, cur, names) {
    var monday = today - ((dow + 6) % 7), b1 = before(sn, monday), b0 = before(sn, monday - 7);
    if (!b1 || !b0) return null;
    var best = null;
    Object.keys(cur[4] || {}).forEach(function (s) {
      var c = cur[4][s], x = (b1[4] || {})[s] || [0, 0], y = (b0[4] || {})[s] || [0, 0];
      var n1 = c[0] - x[0], n0 = x[0] - y[0]; if (n1 < 20 || n0 < 20 || !names[s]) return;
      var a1 = Math.round(100 * (c[1] - x[1]) / n1), a0 = Math.round(100 * (x[1] - y[1]) / n0);
      if (a1 - a0 >= 5 && (!best || a1 - a0 > best.acc - best.prev)) best = { subject: s, name: names[s], acc: a1, prev: a0, key: "a:" + s + ":" + monday };
    });
    return best;
  }
  // Every template, for the copy checks.
  function all() { var o = []; Object.keys(T).forEach(function (k) { T[k].forEach(function (t) { o.push(t[0], t[1]); }); }); return o; }

  var PURE = { ID0: ID0, ID_N: ID_N, QUIET: QUIET, TAIL: TAIL, T: T, mins: mins, hhmm: hhmm, parseQuiet: parseQuiet, inQuiet: inQuiet, bestTime: bestTime, anchorFor: anchorFor,
    ignoredRun: ignoredRun, settle: settle, pick: pick, build: build, arenaTimes: arenaTimes, dueByDay: dueByDay, wins: wins, snap: snap, recap: recap, accWin: accWin,
    firstName: firstName, clock: clock, dayStart: dayStart, all: all };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var KEY = "smd_prep_ndg", R = { key: "", reg: "" };
  function lsGet(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) G.localStorage.removeItem(k); else G.localStorage.setItem(k, v); } catch (e) {} }
  function state() { var s = null; try { s = JSON.parse(lsGet(KEY) || "null"); } catch (e) {} s = s && typeof s === "object" ? s : {}; s.ses = s.ses || []; s.plan = s.plan || []; s.hist = s.hist || []; s.sn = s.sn || {}; return s; }
  function save(s) { lsSet(KEY, JSON.stringify(s)); }
  function noop() {}
  function call(p, m, arg) { try { return Promise.resolve(p[m](arg)); } catch (e) { return Promise.reject(e); } }
  function quiet() { return state().q || QUIET; }
  function setQuiet(a, b) { if (mins(a) == null || mins(b) == null) return; var s = state(); s.q = a + "-" + b; save(s); R.key = ""; }
  // A study session starts with the first answer after 30 min without one (prep.js record()).
  function studied() { var s = state(), now = Date.now(); if (!s.act || now - s.act > 30 * 60e3) { s.ses.push(now); s.ses = s.ses.filter(function (t) { return t > now - 30 * DAY; }).slice(-80); } s.act = now; save(s); }
  function learned() { return bestTime(state().ses, Date.now()); }
  function user() { try { var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }

  /* Everything build() needs, from the host (prep.js) and the plan snapshot (prep-plan.js). */
  function inputs(h, x, now) {
    var CORE = h.core(), s = h.store(), today = h.today(), P = G.PREP_PLAN && G.PREP_PLAN._pure, st = state(), d = new Date(now);
    var T0 = 0, OK = 0, bySub = {}, names = {};
    Object.keys(s.mod || {}).forEach(function (m) {
      var r = s.mod[m]; if (!r || !r.t) return; T0 += r.t; OK += r.ok || 0;
      var sid = h.subjectOfModule && h.subjectOfModule(m); if (!sid) return;
      var b = bySub[sid] || (bySub[sid] = [0, 0]); b[0] += r.t; b[1] += r.ok || 0;
      if (!names[sid]) { var sb = h.subjectById && h.subjectById(sid); names[sid] = sb ? String(sb.name && typeof sb.name === "object" ? sb.name.en || "" : sb.name || "") : ""; }
    });
    var cur = [T0, OK, x.score, x.examId || x.exam, bySub];
    st.sn = snap(st.sn, today, cur);
    var studiedToday = !!(s.days && s.days[today]), streak = CORE.streak ? CORE.streak(s, today) : 0, dow = d.getDay();
    var aw = accWin(st.sn, today, dow, cur, names);
    return {
      st: st,
      o: { now: now, quiet: st.q || QUIET, anchor: anchorFor(bestTime(st.ses, now), s.pl && s.pl.rem, parseQuiet(st.q || QUIET)), name: firstName(user() && user().displayName),
        exam: x.exam, examDays: x.daysLeft, plan: x.items && x.items.length ? { items: x.items } : null,
        due: P && P.isQ ? dueByDay(s.cards, today, P.isQ) : [], streak: streak, studiedToday: studiedToday, weak: x.weak || null,
        wins: wins({ total: T0, streak: streak, studiedToday: studiedToday, today: today, accWin: aw }), recap: recap(st.sn, today, dow, cur),
        arena: lsGet("smd_prep_arena_in") === "1" ? h.exam().id : null }
    };
  }

  /* Called by prep-native.js on each flush when the mode is Smart. LN = the LocalNotifications plugin. Settles what
     fired, rebuilds the next notifications and replaces the scheduled set only when it changed. */
  function feed(h, x, LN) {
    if (!h || !x || !LN) return Promise.resolve();
    var now = Date.now(), r;
    try { r = inputs(h, x, now); } catch (e) { return Promise.resolve(); }
    var st = r.st;
    st.hist = settle(st.plan, st.hist, now);
    r.o.hist = st.hist;
    var list = build(r.o);
    st.plan = list.map(function (n) { var p = { id: n.id, k: n.k, v: n.v, at: n.at }; if (n.key) p.key = n.key; return p; });
    save(st);
    register(st);
    var key = JSON.stringify(list.map(function (n) { return [n.id, n.at, n.title, n.body]; }));
    if (key === R.key) return Promise.resolve();
    return call(LN, "checkPermissions").then(function (p) {
      if (!p || p.display !== "granted") return;
      return cancelAll(LN).then(function () {
        if (!list.length) return;
        return call(LN, "schedule", { notifications: list.map(function (n) { return { id: n.id, title: n.title, body: n.body, schedule: { at: new Date(n.at), allowWhileIdle: true }, extra: n.extra }; }) });
      }).then(function () { R.key = key; });
    }).catch(noop);
  }
  function cancelAll(LN) {
    var ids = []; for (var i = 0; i < ID_N; i++) ids.push({ id: ID0 + i });
    return call(LN, "cancel", { notifications: ids }).catch(noop);
  }
  // Mode off or daily: nothing of ours stays scheduled, and the server stops social pushes.
  function stop(LN) { R.key = ""; var s = state(); s.plan = []; save(s); unregister(); return LN ? cancelAll(LN) : Promise.resolve(); }

  /* Social pushes (challenges, a friend passing you, friends who studied today) come from the server, to this phone's
     push token, only for Arena players in Smart mode who already allowed StewardMD push notifications. Once a day,
     or when the quiet hours change. */
  function register(st) {
    var tok = G.SMD_nativePushToken && G.SMD_nativePushToken(), api = G.PrepSocial && G.PrepSocial.api;
    if (!tok || !api || lsGet("smd_prep_arena_in") !== "1") return;
    var k = new Date().toDateString() + "|" + (st.q || QUIET) + "|" + tok.slice(-12);
    if (R.reg === k) return;
    R.reg = k;
    api("POST", "nudges", { on: true, token: tok, quiet: st.q || QUIET, tz: new Date().getTimezoneOffset() }).then(null, function () { R.reg = ""; });
  }
  function unregister() { var api = G.PrepSocial && G.PrepSocial.api; R.reg = ""; if (api && lsGet("smd_prep_arena_in") === "1") api("POST", "nudges", { on: false }).then(null, noop); }

  G.PREP_NUDGES = { feed: feed, stop: stop, studied: studied, quiet: quiet, setQuiet: setQuiet, learned: learned, _pure: PURE, _r: R };
})(typeof window !== "undefined" ? window : this);
