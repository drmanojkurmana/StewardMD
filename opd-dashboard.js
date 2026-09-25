/* opd-dashboard.js - the OPD console's operations dashboard (window.SMD_OPD_DASH).
 *
 * A layer over what the console already has; it invents no action and no figure.
 *   - Today's figures   /opd-pulse, the /day-close money, and /opd-insights deltas (same time yesterday, server-side).
 *   - In the OPD now    the board the console loaded. Each row action is the console's OWN button, clicked, so the
 *                       handler, payload and permission are the console's.
 *   - Arrivals by hour, patients per day, visit types: /opd-insights.
 *   - Needs action      existing sources, each with its existing action.
 * localStorage.smd_opd_dash = "0" returns the Flow Board; smd_opd_flow_ui = "0" still returns the original board.
 * Buildless ES5, UMD so Node tests load the pure builders. Values are escaped here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SMD_OPD_DASH = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";
  var LS = "smd_opd_dash", LS_VIEW = "smd_opd_dash_view";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function enabled() { return lsGet(LS) !== "0"; }
  function ms(name, cls) { return '<span class="ms' + (cls ? " " + cls : "") + '" aria-hidden="true">' + name + "</span>"; }
  function rupees(p) { return "₹" + Math.round((p || 0) / 100).toLocaleString("en-IN"); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function minLabel(m) { if (m == null) return "-"; if (m < 60) return m + "m"; return Math.floor(m / 60) + "h " + (m % 60) + "m"; }
  function hourLabel(h) { var a = h % 12 === 0 ? 12 : h % 12; return a + (h < 12 ? " am" : " pm"); }
  function hourShort(h) { var a = h % 12 === 0 ? 12 : h % 12; return a + (h < 12 ? "a" : "p"); }

  var PRIO = { emergency: "Emergency", senior: "Senior citizen", pregnant: "Pregnant", disability: "Disability", child: "Child", results: "Back with results", other: "Other reason" };
  var VISIT = { "new": "New", followup: "Follow-up", appointment: "Appointment", teleconsult: "Teleconsult" };

  /** Change against the same time yesterday, in words. kind: "count" | "minutes" | "points". */
  function deltaChip(d, kind) {
    if (d == null) return { text: "No figure yesterday", dir: "none", tone: "neutral" };
    if (d === 0) return { text: "No change", dir: "same", tone: "neutral" };
    var up = d > 0, n = Math.abs(d), text, good;
    if (kind === "minutes") { text = n + "m " + (up ? "slower" : "quicker"); good = !up; }
    else if (kind === "points") { text = plural(n, "point") + " " + (up ? "higher" : "lower"); good = !up; }
    else { text = n + " " + (up ? "more" : "fewer"); good = up; }
    return { text: text, dir: up ? "up" : "down", tone: good ? "good" : "bad" };
  }

  /** money: null hides the tile (billing off) | {unread:true} | the day-close money. */
  function modelKpis(pulseResp, ins, money) {
    if (pulseResp && (pulseResp.failed || pulseResp.ok === false)) return { failed: true, message: "Could not read today's figures. Do not read this as a quiet clinic." };
    var p = (pulseResp && pulseResp.pulse) || null, d = (ins && ins.delta) || {};
    var have = !!p, d2d = (p && p.doorToDoctor) || {};
    var tiles = [];
    var notSeen = have ? Math.max(0, (p.registered || 0) - (p.seen || 0)) : 0;
    tiles.push({ key: "seen", icon: "how_to_reg", label: "Patients seen", value: have ? p.seen || 0 : null, suffix: have ? "/" + (p.registered || 0) : "", sub: have ? (notSeen ? notSeen + " registered, not seen yet" : "Everyone registered has been seen") : "", delta: ins ? deltaChip(d.seen, "count") : null });
    if (money) {
      if (money.unread) tiles.push({ key: "money", icon: "payments", label: "Collected today", value: null, sub: "Could not be read. Open Billing, Shift report.", warn: true });
      else tiles.push({ key: "money", icon: "payments", label: "Collected today", value: rupees(money.net), sub: (money.refunds && money.refunds.count ? "Net of " + rupees(money.refunds.total) + " refunded · " : "") + plural(money.count || 0, "bill") });
    }
    tiles.push({ key: "d2d", icon: "timer", label: "Door to doctor", value: d2d.medianMin == null ? null : d2d.medianMin, unit: "m", sub: d2d.p90Min == null ? "Nobody seen yet" : "Median. 9 in 10 within " + d2d.p90Min + "m", delta: ins ? deltaChip(d.doorToDoctorMin, "minutes") : null });
    tiles.push({ key: "dnw", icon: "person_off", label: "Did not wait", value: have && p.abandonedPct != null ? p.abandonedPct : null, unit: "%", sub: have ? plural(p.noShow || 0, "no-show") : "", warn: have && (p.abandonedPct || 0) >= 10, delta: ins ? deltaChip(d.abandonedPct, "points") : null });
    return { tiles: tiles, unread: (pulseResp && pulseResp.unread) || [] };
  }

  /** One status per active ticket: a word first; colour only marks "with the doctor" and "needs a look". */
  function statusOf(row) {
    var t = row.t || {};
    if (row.pool) return { key: "route", label: "To route", tone: "plain" };
    if (t.status === "in_consultation") return { key: "treat", label: "With the doctor", tone: "good" };
    if (t.status === "called") return { key: "called", label: "Called", tone: "good" };
    if (t.status === "at_diagnostics" || t.status === "investigation") return { key: "tests", label: "At diagnostics", tone: "plain" };
    if (t.status === "followup") return { key: "tests", label: "Booked back", tone: "plain" };
    if (t.status === "completed") return { key: "done", label: "Completed", tone: "plain" };
    if (t.resultReadyAt) return { key: "results", label: "Back with results", tone: "info" };
    return { key: "wait", label: "Waiting", tone: "plain" };
  }
  var FILTERS = [["all", "All"], ["wait", "Waiting"], ["treat", "With the doctor"], ["route", "To route"], ["results", "Back with results"], ["tests", "At diagnostics"]];
  var STATUS_ORDER = { treat: 0, called: 1, results: 2, wait: 3, route: 4, tests: 5, done: 6 };

  /** rows: [{t, pool, room, doctor}] -> rows sorted emergencies first, with status, wait and counts per filter. */
  function modelOccupancy(rows, nowMs) {
    var now = nowMs || Date.now(), counts = { all: 0 };
    var out = (rows || []).filter(function (r) { return r && r.t; }).map(function (r) {
      var s = statusOf(r), t = r.t, w = t.registeredAt ? Math.max(0, Math.round((now - t.registeredAt) / 60000)) : null;
      var waiting = s.key === "wait" || s.key === "route" || s.key === "called" || s.key === "results";
      counts.all++; counts[s.key] = (counts[s.key] || 0) + 1;
      return { r: r, t: t, status: s, waitMin: w, long: waiting && w != null && w >= 60, visit: VISIT[t.visitType] || "New", prio: t.priority > 0 ? (t.priority >= 2 ? "Emergency" : (PRIO[t.priorityReason] || "Priority")) : "", prioLevel: t.priority || 0 };
    });
    out.sort(function (a, b) { return (b.prioLevel - a.prioLevel) || (STATUS_ORDER[a.status.key] - STATUS_ORDER[b.status.key]) || ((b.waitMin || 0) - (a.waitMin || 0)); });
    return { rows: out, counts: counts };
  }

  /** At least 8 am to 8 pm, widened to any hour with arrivals. */
  function modelHours(ins) {
    if (!ins || !ins.hourly) return null;
    var h = ins.hourly, first = 8, last = 20, i, max = 0, busiest = -1, total = 0;
    for (i = 0; i < 24; i++) { if (h[i]) { if (i < first) first = i; if (i > last) last = i; } total += h[i] || 0; if ((h[i] || 0) > max) { max = h[i]; busiest = i; } }
    if (ins.currentHour != null) { if (ins.currentHour < first) first = ins.currentHour; if (ins.currentHour > last) last = ins.currentHour; }
    var bars = [];
    for (i = first; i <= last; i++) bars.push({ hour: i, value: h[i] || 0, now: i === ins.currentHour, busiest: i === busiest && max > 0 });
    return { bars: bars, max: max, busiest: busiest, total: total, current: ins.currentHour, nowValue: ins.currentHour != null ? h[ins.currentHour] || 0 : null };
  }

  /** Calendar cells, Monday first. level is the day's share of the busiest day (0-3), for the heat steps. */
  function modelMonth(ins) {
    if (!ins || !ins.month || !ins.date) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ins.date); if (!m) return null;
    var y = +m[1], mo = +m[2], today = +m[3];
    var days = new Date(Date.UTC(y, mo, 0)).getUTCDate(), lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
    var by = {}, max = 0, total = 0, seen = 0, unread = {};
    ins.month.forEach(function (d) { by[+d.date.slice(8, 10)] = d; if (d.registered > max) max = d.registered; total += d.registered || 0; seen += d.seen || 0; });
    (ins.unreadDays || []).forEach(function (d) { if (d.slice(0, 7) === ins.date.slice(0, 7)) unread[+d.slice(8, 10)] = 1; });
    var cells = [], i;
    for (i = 0; i < lead; i++) cells.push(null);
    for (i = 1; i <= days; i++) {
      var d = by[i];
      cells.push({ day: i, registered: d ? d.registered : null, seen: d ? d.seen : null, today: i === today, future: i > today, unread: !!unread[i], level: d && d.registered && max ? Math.min(3, Math.ceil((d.registered / max) * 4) - 1) : -1 });
    }
    var label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    var open = ins.month.filter(function (d) { return d.registered > 0; }).length;
    return { label: label, cells: cells, total: total, seen: seen, max: max, openDays: open, avg: open ? Math.round(total / open) : 0 };
  }

  /** Visit types in a fixed order (the colour follows the type), and who went ahead of the queue by reason. */
  function modelMix(ins) {
    if (!ins || !ins.mix) return null;
    var mx = ins.mix, keys = ["new", "followup", "appointment", "teleconsult"], total = 0;
    var segs = keys.filter(function (k) { return mx[k] != null && (k === "new" || k === "followup" || mx[k] > 0); }).map(function (k) { total += mx[k] || 0; return { key: k, label: VISIT[k], value: mx[k] || 0, slot: keys.indexOf(k) + 1 }; });
    segs.forEach(function (s) { s.pct = total ? Math.round((s.value / total) * 100) : 0; });
    var pr = Object.keys(mx.priority || {}).map(function (k) { return { key: k, label: PRIO[k] || "Priority", value: mx.priority[k] }; }).sort(function (a, b) { return b.value - a.value; });
    var prTotal = pr.reduce(function (a, b) { return a + b.value; }, 0);
    return { segs: segs, total: total, priority: pr, priorityTotal: prTotal };
  }

  /** The inbox, one sentence per item. src: { pulse, followups, offline:{pending,review}, unpaid, recallable, refunds, refundTotal } */
  function modelTasks(src) {
    var p = (src.pulse && src.pulse.pulse) || {}, out = [];
    function add(o) { if (o.count > 0) out.push(o); }
    var n;
    n = p.syncFailed || 0;
    add({ key: "sync", icon: "sync_problem", urgent: true, count: n, title: plural(n, "visit") + " not in the clinical record", sub: "Seen or queued here, but the record did not take it", action: "reconcile", label: "Send again" });
    var off = src.offline || {}, pend = off.pending || 0, rev = off.review || 0;
    add({ key: "offline", icon: "cloud_off", count: pend + rev, title: (pend ? plural(pend, "offline check-in") + " to send" : "") + (pend && rev ? ", " : "") + (rev ? rev + " to check" : ""), sub: "Taken on this desk while it was offline", action: "offline", label: "Send now" });
    n = p.resultsBack || 0;
    add({ key: "results", icon: "lab_research", count: n, title: plural(n, "patient") + " back with results", sub: "Waiting to see the doctor again", action: "results", label: "Show them" });
    n = src.recallable || 0;
    add({ key: "recall", icon: "person_search", count: n, title: plural(n, "no-show") + " you can still recall", sub: "Same token, within 4 hours of the no-show", action: "noshows", label: "Open no-shows" });
    var fu = src.followups || {};
    n = fu.unbooked || 0;
    add({ key: "followups", icon: "event_repeat", urgent: !!fu.overdue, count: n, title: plural(n, "follow-up") + " to book" + (fu.overdue ? ", " + fu.overdue + " overdue" : ""), sub: "Promised at a visit, not booked yet", action: "schedule", label: "Open scheduling" });
    n = src.unpaid || 0;
    add({ key: "unpaid", icon: "receipt_long", count: n, title: plural(n, "unpaid order"), sub: "Waiting at billing", action: "billing", label: "Open billing" });
    n = src.refunds || 0;
    add({ key: "refunds", icon: "currency_exchange", count: n, title: plural(n, "refund") + " today" + (src.refundTotal ? ", " + rupees(src.refundTotal) : ""), sub: "Netted in the day close", action: "dayclose", label: "Open day close" });
    return out;
  }

  function kpiHtml(k) {
    if (k.failed) return '<div class="dz-alert" role="alert">' + ms("error") + esc(k.message) + "</div>";
    var h = '<section class="dz-card dz-kpis" style="--n:' + k.tiles.length + '" aria-labelledby="dzKpiH"><h2 id="dzKpiH" class="dz-sr">Today so far</h2>' + k.tiles.map(function (t) {
      var v = t.value == null ? '<span class="dz-none">not yet</span>' : esc(t.value) + (t.unit ? '<span class="dz-unit">' + esc(t.unit) + "</span>" : "") + (t.suffix ? '<span class="dz-suffix">' + esc(t.suffix) + "</span>" : "");
      var d = t.delta ? '<span class="dz-delta ' + t.delta.tone + '">' + (t.delta.dir === "up" ? ms("arrow_upward", "sm") : t.delta.dir === "down" ? ms("arrow_downward", "sm") : "") + esc(t.delta.text) + "</span>" : "";
      return '<div class="dz-kpi' + (t.warn ? " warn" : "") + '" data-kpi="' + esc(t.key) + '"><div class="dz-kpi-top"><span class="dz-tile">' + ms(t.icon) + '</span><h3>' + esc(t.label) + "</h3></div>" +
        '<div class="dz-kpi-v">' + v + "</div>" + (t.sub ? '<div class="dz-kpi-s">' + esc(t.sub) + "</div>" : "") + d + "</div>";
    }).join("") + (k.tiles.some(function (t) { return t.delta; }) ? '<p class="dz-kpi-note">Changes compare with the same time yesterday.</p>' : "") + "</section>";
    if (k.unread && k.unread.length) h += '<div class="dz-alert">' + ms("warning") + "Some rooms could not be read (" + esc(k.unread.join(", ")) + "), so these figures are short.</div>";
    return h;
  }

  function occRowHtml(o, i) {
    var t = o.t, r = o.r, init = String(t.name || "P").trim().charAt(0).toUpperCase() || "P";
    var age = (t.ageYears != null && t.ageYears !== "") ? t.ageYears : (t.age != null && t.age !== "" ? t.age : "");
    var as = ((age === "" ? "" : age + "y") + (t.sex ? " " + String(t.sex).charAt(0).toUpperCase() : "")).trim();
    var place = r.pool ? "Walk-in pool" : (r.room || "");
    return '<tr data-dz-row="' + i + '" data-status="' + esc(o.status.key) + '">' +
      '<td class="dz-tok" data-label="Token">' + (t.token ? esc(t.token) : "-") + "</td>" +
      '<td class="dz-pt" data-label="Patient"><span class="dz-av" aria-hidden="true">' + esc(init) + '</span><span class="dz-ptx"><b>' + esc(t.name || "Patient") + "</b>" +
        '<small>' + esc([as, t.mrnLast4 ? "#" + t.mrnLast4 : ""].filter(Boolean).join(" · ")) + '<span class="dz-vm"> · ' + esc(o.visit) + "</span></small>" +
        (o.prio ? '<span class="dz-chip ' + (o.prioLevel >= 2 ? "bad" : "warn") + '">' + esc(o.prio) + "</span>" : "") + "</span></td>" +
      '<td class="dz-visit" data-label="Visit">' + esc(o.visit) + "</td>" +
      '<td data-label="Status"><span class="dz-tag ' + o.status.tone + '">' + esc(o.status.label) + "</span></td>" +
      '<td class="dz-room" data-label="Room"><b>' + esc(place || "-") + '</b><small>' + esc(r.doctor || (r.pool ? "No doctor yet" : "")) + "</small></td>" +
      '<td class="dz-wait' + (o.long ? " long" : "") + '" data-label="Waiting">' + (o.long ? ms("schedule", "sm") : "") + esc(o.waitMin == null ? "-" : minLabel(o.waitMin)) + (o.long ? '<span class="dz-sr"> (over 1 hour)</span>' : "") + "</td>" +
      '<td class="dz-act" data-label="Action"></td></tr>';
  }

  function hoursSvg(m) {
    var narrow = typeof window !== "undefined" && window.innerWidth < 640, W = narrow ? 340 : 560, H = narrow ? 190 : 210, padL = 28, padB = 26, padT = 22, n = m.bars.length, gap = narrow ? 3 : 6, every = narrow ? 3 : 2;
    var bw = Math.max(8, (W - padL - (n - 1) * gap) / n), top = Math.max(4, Math.ceil(m.max / 4) * 4), plotH = H - padB - padT;
    var y = function (v) { return padT + plotH - (top ? (v / top) * plotH : 0); };
    var grid = "", i;
    for (i = 0; i <= 2; i++) { var gv = Math.round((top / 2) * i), gy = y(gv); grid += '<line x1="' + padL + '" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" class="dz-gl"/><text x="' + (padL - 6) + '" y="' + (gy + 4) + '" class="dz-axis" text-anchor="end">' + gv + "</text>"; }
    var bars = m.bars.map(function (b, j) {
      var x = padL + j * (bw + gap), h = Math.max(b.value ? 4 : 2, (top ? (b.value / top) * plotH : 0)), yy = padT + plotH - h;
      var nearNow = !b.now && ((m.bars[j - 1] && m.bars[j - 1].now) || (m.bars[j + 1] && m.bars[j + 1].now));
      var lbl = ((j % every === 0 && !nearNow) || b.now) ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" class="dz-axis' + (b.now ? " now" : "") + '" text-anchor="middle">' + (b.now ? "Now" : hourShort(b.hour)) + "</text>" : "";
      var val = (b.busiest || b.now) && b.value ? '<text x="' + (x + bw / 2) + '" y="' + (yy - 6) + '" class="dz-val" text-anchor="middle">' + b.value + "</text>" : "";
      return '<g><title>' + hourLabel(b.hour) + ": " + plural(b.value, "registration") + (b.now ? " (this hour)" : "") + '</title><rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(4, bw / 2).toFixed(1) + '" class="dz-bar' + (b.now ? " now" : "") + '"/>' + val + lbl + "</g>";
    }).join("");
    return '<svg class="dz-hours-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(hoursSummary(m)) + '" preserveAspectRatio="xMidYMid meet">' + grid + bars + "</svg>";
  }
  function hoursSummary(m) { return m.total ? "Busiest at " + hourLabel(m.busiest) + ", " + m.max + " registered. " + (m.nowValue != null ? plural(m.nowValue, "arrival") + " so far this hour." : "") : "No arrivals yet today."; }
  function hoursHtml(m, pulseResp) {
    var p = (pulseResp && pulseResp.pulse) || {}, wn = p.waitingNow || {}, cs = p.consult || {};
    var stats = '<dl class="dz-stats"><div><dt>Median wait now</dt><dd>' + esc(wn.medianMin == null ? "-" : minLabel(wn.medianMin)) + "</dd></div>" +
      "<div><dt>Median consult</dt><dd>" + esc(cs.medianMin == null ? "-" : minLabel(cs.medianMin)) + "</dd></div></dl>";
    if (!m) return stats + '<div class="dz-empty">Reading today\'s arrivals...</div>';
    var table = '<table class="dz-sr"><caption>Registrations per hour</caption><tr><th>Hour</th><th>Registered</th></tr>' + m.bars.map(function (b) { return "<tr><td>" + hourLabel(b.hour) + "</td><td>" + b.value + "</td></tr>"; }).join("") + "</table>";
    return '<p class="dz-lede">' + esc(hoursSummary(m)) + "</p>" + stats + '<div class="dz-hours">' + hoursSvg(m) + "</div>" + table;
  }

  function monthHtml(m) {
    if (!m) return '<div class="dz-empty">Reading the month...</div>';
    var wd = ["M", "T", "W", "T", "F", "S", "S"].map(function (d) { return '<span class="dz-wd" aria-hidden="true">' + d + "</span>"; }).join("");
    var cells = m.cells.map(function (c) {
      if (!c) return '<span class="dz-day blank" aria-hidden="true"></span>';
      var aria = c.day + ": " + (c.future ? "later this month" : c.unread ? "could not be read" : !c.registered ? "no patients" : plural(c.registered, "patient") + " registered, " + c.seen + " seen") + (c.today ? " (today)" : "");
      var num = c.future ? "" : c.unread ? "?" : c.registered ? c.registered : "0";
      return '<span class="dz-day' + (c.today ? " today" : "") + (c.future ? " future" : "") + (!c.future && !c.registered && !c.unread ? " zero" : "") + (c.level >= 0 ? " v" + c.level : "") + '" role="listitem" aria-label="' + esc(aria) + '"><b class="dz-num">' + num + '</b><span class="dz-dn">' + c.day + "</span></span>";
    }).join("");
    return '<div class="dz-cal-head"><div><b>' + esc(m.label) + '</b><span>' + plural(m.total, "patient") + " · " + m.seen + " seen</span></div><div class=\"dz-cal-avg\"><b>" + m.avg + "</b><span>a day, over " + plural(m.openDays, "day") + " with patients</span></div></div>" +
      '<div class="dz-cal">' + wd + '<div class="dz-cal-grid" role="list" aria-label="Patients registered each day this month">' + cells + "</div></div>" +
      '<div class="dz-legend"><span class="dz-ramp" aria-hidden="true"><i class="v0"></i><i class="v1"></i><i class="v2"></i><i class="v3"></i></span><span>Fewer to more patients</span></div>';
  }

  function donutSvg(m) {
    var R = 54, r = 36, cx = 64, cy = 64, a0 = -Math.PI / 2, out = "";
    var live = m.segs.filter(function (s) { return s.value; });
    if (!m.total) out = '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" class="dz-donut-empty" stroke-width="' + (R - r) + '" fill="none"/>';
    else if (live.length === 1) out = '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" class="dz-seg s' + live[0].slot + '" stroke-width="' + (R - r) + '" fill="none"/>';
    else m.segs.forEach(function (s) {
      if (!s.value) return;
      var a1 = a0 + (s.value / m.total) * Math.PI * 2, gapA = 0.03, sA = a0 + gapA / 2, eA = a1 - gapA / 2, large = eA - sA > Math.PI ? 1 : 0;
      var p = function (rad, ang) { return (cx + rad * Math.cos(ang)).toFixed(2) + " " + (cy + rad * Math.sin(ang)).toFixed(2); };
      out += '<path class="dz-seg-f s' + s.slot + '" d="M' + p(R, sA) + " A" + R + " " + R + " 0 " + large + " 1 " + p(R, eA) + " L" + p(r, eA) + " A" + r + " " + r + " 0 " + large + " 0 " + p(r, sA) + ' Z"><title>' + esc(s.label) + ": " + s.value + " (" + s.pct + "%)</title></path>";
      a0 = a1;
    });
    return '<svg class="dz-donut" viewBox="0 0 128 128" role="img" aria-label="Visit types: ' + esc(m.segs.map(function (s) { return s.label + " " + s.value; }).join(", ")) + '">' + out +
      '<text x="64" y="62" text-anchor="middle" class="dz-donut-n">' + m.total + '</text><text x="64" y="80" text-anchor="middle" class="dz-donut-l">visits</text></svg>';
  }
  function mixHtml(m) {
    if (!m) return '<div class="dz-empty">Reading today\'s visits...</div>';
    var legend = '<ul class="dz-keys">' + m.segs.map(function (s) { return '<li><span class="dz-key s' + s.slot + '" aria-hidden="true"></span><span>' + esc(s.label) + '</span><b>' + s.value + '</b><small>' + s.pct + "%</small></li>"; }).join("") + "</ul>";
    var maxP = m.priority.reduce(function (a, b) { return Math.max(a, b.value); }, 0);
    var ahead = m.priority.length ? '<ul class="dz-rank">' + m.priority.map(function (p) {
      return '<li><span>' + esc(p.label) + '</span><i aria-hidden="true" style="--w:' + Math.round((p.value / maxP) * 100) + '%"' + (p.key === "emergency" ? ' class="bad"' : "") + '></i><b>' + p.value + "</b></li>";
    }).join("") + "</ul>" : '<p class="dz-muted">Nobody was put ahead of the queue today.</p>';
    return '<div class="dz-mix">' + donutSvg(m) + legend + '</div><h3 class="dz-sub">Put ahead of the queue <span>' + m.priorityTotal + "</span></h3>" + ahead;
  }

  function tasksHtml(list) {
    if (!list.length) return '<p class="dz-allclear">' + ms("task_alt") + "<span><b>Nothing needs you right now.</b> Retries, recalls, follow-ups and unpaid bills show up here.</span></p>";
    return '<ul class="dz-tasks">' + list.map(function (t) {
      return '<li class="dz-task' + (t.urgent ? " urgent" : "") + '">' + ms(t.icon) + '<span class="dz-tx"><b>' + esc(t.title) + '</b><small>' + esc(t.sub) + '</small></span><button type="button" class="dz-btn" data-dz-task="' + esc(t.action) + '" aria-label="' + esc(t.label + ": " + t.title) + '">' + esc(t.label) + "</button></li>";
    }).join("") + "</ul>";
  }
  function failedHtml(what) { return '<div class="dz-alert" role="alert">' + ms("error") + "<span>" + esc(what) + ' could not be read. This is not a quiet day. <button type="button" class="dz-link" data-dz-retry>Try again</button></span></div>'; }

  var S = { view: lsGet(LS_VIEW) === "flow" ? "flow" : "overview", filter: "all", host: null, keyBound: false, painted: {} };

  function setHtml(el, html, key) { if (!el) return; if (S.painted[key] === html && el.childNodes.length) return; el.innerHTML = html; S.painted[key] = html; }

  function navItem(id, icon, label, badgeKey, current) {
    return '<button type="button" class="dz-nav' + (current ? " on" : "") + '" data-dz-nav="' + id + '"' + (current ? ' aria-current="page"' : "") + ">" + ms(icon) + "<span>" + esc(label) + "</span>" + (badgeKey ? '<span class="dz-badge" data-dz-badge="' + badgeKey + '" hidden></span>' : "") + "</button>";
  }

  /** Builds the sidebar (moving the console's own buttons into it), the top bar and the cards. Runs once per console render. */
  function shell(host) {
    S.host = host;
    var app = host.app, main = app.querySelector(".opd-main"), nav = app.querySelector(".opd-sidebar");
    if (!main || !nav) return false;
    app.classList.add("opd-dash-on");
    S.painted = {};
    nav.classList.add("dz-side"); nav.id = "dzSide"; nav.setAttribute("aria-label", "OPD console");
    var brand = esc(host.clinicName() || "OPD");
    // Detach the console's buttons (they carry the handlers) before the nav is rebuilt.
    var keep = {};
    ["noshows", "opdScanBtn", "disp", "billing", "pharmacy", "dayclose", "tariffBtn", "rooms", "staff", "brand", "clinics"].forEach(function (id) { var b = document.getElementById(id); if (b) { keep[id] = b; if (b.parentNode) b.parentNode.removeChild(b); } });
    nav.innerHTML = '<div class="dz-brand"><span class="mk" aria-hidden="true"></span><span><b>' + brand + '</b><small>WardSynQ OPD</small></span><button type="button" class="dz-iconbtn dz-close" data-dz-drawer="close" aria-label="Close menu">' + ms("close") + "</button></div>" +
      '<div class="dz-group"><span class="dz-glabel">Operations</span>' + navItem("overview", "space_dashboard", "Overview", "", S.view === "overview") + navItem("flow", "view_kanban", "Patient flow", "active", S.view === "flow") + navItem("rooms-view", "meeting_room", "Room queues", "") + "<span data-dz-slot=\"ops\"></span></div>" +
      '<div class="dz-group"><span class="dz-glabel">Clinical</span><span data-dz-slot="clin"></span></div>' +
      '<div class="dz-group"><span class="dz-glabel">Revenue</span><span data-dz-slot="rev"></span></div>' +
      '<div class="dz-group"><span class="dz-glabel">Manage</span><span data-dz-slot="mgmt"></span></div>' +
      '<div class="dz-side-foot"><button type="button" class="dz-nav" data-dz-nav="classic">' + ms("view_quilt") + "<span>Classic layout</span></button></div>";
    var place = [
      ["noshows", "ops", "person_search", "No-shows", "recall"],
      ["opdScanBtn", "clin", "qr_code_scanner", "Scan patient", ""],
      ["disp", "clin", "tv", "Waiting-room display", ""],
      ["billing", "rev", "receipt_long", "Billing", "unpaid"],
      ["pharmacy", "rev", "medication", "Pharmacy", ""],
      ["dayclose", "rev", "event_available", "Close the day", ""],
      ["tariffBtn", "rev", "sell", "Tariff and stock", ""],
      ["rooms", "mgmt", "door_open", "Rooms", ""],
      ["staff", "mgmt", "group", "Staff", ""],
      ["brand", "mgmt", "palette", "Branding", ""],
      ["clinics", "mgmt", "domain", "Clinics", ""],
    ];
    place.forEach(function (p) {
      var b = keep[p[0]]; if (!b) return;
      b.className = "dz-nav"; b.removeAttribute("style");
      b.innerHTML = ms(p[2]) + "<span>" + esc(p[3]) + "</span>" + (p[4] ? '<span class="dz-badge" data-dz-badge="' + p[4] + '" hidden></span>' : "");
      nav.querySelector('[data-dz-slot="' + p[1] + '"]').appendChild(b);
    });
    Array.prototype.forEach.call(nav.querySelectorAll(".dz-group"), function (g) { if (!g.querySelector("button")) g.hidden = true; });
    nav.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-dz-nav],[data-dz-drawer]"); if (!b) { if (e.target.closest && e.target.closest("button")) drawer(false); return; }
      if (b.getAttribute("data-dz-drawer")) { drawer(false); return; }
      var v = b.getAttribute("data-dz-nav");
      if (v === "classic") { lsSet(LS, "0"); host.rerender(); host.toast("Classic layout. New dashboard, in the sidebar, brings this back."); return; }
      drawer(false);
      if (v === "overview") setView("overview");
      else if (v === "flow") setView("flow", "flow");
      else if (v === "rooms-view") setView("flow", "rooms");
    };
    var top = document.createElement("div"); top.className = "dz-top";
    var mac = /Mac|iPhone|iPad/.test((typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "");
    var dateLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    top.innerHTML = '<button type="button" class="dz-iconbtn dz-menu" data-dz-drawer="open" aria-label="Open menu" aria-controls="dzSide" aria-expanded="false">' + ms("menu") + "</button>" +
      '<div class="dz-title"><h1 id="dzTitle">' + (S.view === "flow" ? "Patient flow" : "Overview") + '</h1><span>' + esc(dateLabel) + ' <span class="dz-live" id="dzLive"><i aria-hidden="true"></i><span>Live</span></span></span></div>' +
      '<button type="button" class="dz-search" id="dzSearch" aria-haspopup="dialog" aria-label="Search patients and actions (' + (mac ? "Command" : "Control") + ' K)">' + ms("search") + '<span>Search patients and actions</span><kbd>' + (mac ? "⌘" : "Ctrl") + " K</kbd></button>" +
      '<button type="button" class="dz-iconbtn" id="dzRefresh" aria-label="Refresh">' + ms("refresh") + "</button>" +
      (document.getElementById("walk") ? '<button type="button" class="dz-new" id="dzNew">' + ms("person_add") + "<span>New walk-in</span></button>" : "");
    main.insertBefore(top, main.firstChild);
    top.querySelector("#dzSearch").onclick = function () { palette(true); };
    top.querySelector("#dzRefresh").onclick = function () { host.click("ref"); };
    var nw = top.querySelector("#dzNew"); if (nw) nw.onclick = function () { host.click("walk"); };
    top.querySelector(".dz-menu").onclick = function () { drawer(true); };
    var bn = document.createElement("nav"); bn.className = "dz-bottom"; bn.setAttribute("aria-label", "Quick navigation");
    bn.innerHTML = '<button type="button" data-dz-b="overview">' + ms("space_dashboard") + "<span>Overview</span></button>" + '<button type="button" data-dz-b="flow">' + ms("view_kanban") + "<span>Flow</span></button>" +
      (document.getElementById("walk") ? '<button type="button" data-dz-b="new">' + ms("person_add") + "<span>Walk-in</span></button>" : "") +
      '<button type="button" data-dz-b="search">' + ms("search") + "<span>Search</span></button>" + '<button type="button" data-dz-b="menu" aria-controls="dzSide">' + ms("menu") + "<span>Menu</span></button>";
    bn.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-dz-b]"); if (!b) return; var a = b.getAttribute("data-dz-b");
      if (a === "overview") setView("overview"); else if (a === "flow") setView("flow", "flow"); else if (a === "new") host.click("walk"); else if (a === "search") palette(true); else drawer(true); };
    app.appendChild(bn);
    var scrim = document.createElement("div"); scrim.className = "dz-scrim"; scrim.onclick = function () { drawer(false); }; app.appendChild(scrim);
    var dash = document.createElement("div"); dash.className = "dz-dash"; dash.id = "dzDash";
    dash.innerHTML = '<div id="dzKpis"></div>' +
      '<div class="dz-grid">' +
        '<section class="dz-card dz-occ" aria-labelledby="dzOccH"><header class="dz-ch"><div><h2 id="dzOccH">In the OPD now</h2><p id="dzOccSub"></p></div><div class="dz-filters" role="group" aria-label="Show patients" id="dzOccF"></div></header><div class="dz-occ-body" id="dzOcc"></div></section>' +
        '<section class="dz-card dz-tasks-card" aria-labelledby="dzTaskH"><header class="dz-ch"><h2 id="dzTaskH">Needs action</h2></header><div id="dzTasks"></div></section>' +
        '<section class="dz-card dz-peak" aria-labelledby="dzPeakH"><header class="dz-ch"><h2 id="dzPeakH">Arrivals by hour</h2></header><div id="dzPeak"></div></section>' +
        '<section class="dz-card dz-month" aria-labelledby="dzMonthH"><header class="dz-ch"><h2 id="dzMonthH">Patients per day</h2></header><div id="dzMonth"></div></section>' +
        '<section class="dz-card dz-mixcard" aria-labelledby="dzMixH"><header class="dz-ch"><h2 id="dzMixH">Visit types today</h2></header><div id="dzMix"></div></section>' +
      "</div>";
    top.parentNode.insertBefore(dash, top.nextSibling);
    dash.addEventListener("click", function (e) {
      var tb = e.target.closest && e.target.closest("[data-dz-task]");
      if (tb) {
        var a = tb.getAttribute("data-dz-task");
        if (a === "results") { S.filter = "results"; paintOcc(); var oc = document.getElementById("dzOccH"); if (oc && oc.scrollIntoView) oc.scrollIntoView({ block: "start", behavior: "auto" }); return; }
        host.task(a); return;
      }
      if (e.target.closest && e.target.closest("[data-dz-retry]")) { host.retry(); return; }
      var fb = e.target.closest && e.target.closest("[data-dz-filter]"); if (fb) { S.filter = fb.getAttribute("data-dz-filter"); paintOcc(); return; }
    });
    bindKeys();
    applyView();
    paint();
    return true;
  }

  function drawer(open) {
    var app = S.host && S.host.app; if (!app) return;
    app.classList.toggle("dz-drawer-open", !!open);
    var mb = app.querySelector(".dz-menu"); if (mb) mb.setAttribute("aria-expanded", String(!!open));
    if (open) { var f = app.querySelector("#dzSide button"); if (f) f.focus(); }
  }

  function setView(v, board) {
    S.view = v; lsSet(LS_VIEW, v === "flow" ? "flow" : null);
    applyView();
    if (v === "flow" && board && S.host) S.host.boardView(board);
    var t = document.getElementById("dzTitle"); if (t) t.textContent = v === "flow" ? (board === "rooms" ? "Room queues" : "Patient flow") : "Overview";
    if (t) { t.setAttribute("tabindex", "-1"); try { t.focus({ preventScroll: true }); } catch (e) {} }
  }
  function applyView() {
    var app = S.host && S.host.app; if (!app) return;
    app.classList.toggle("dz-v-overview", S.view === "overview");
    app.classList.toggle("dz-v-flow", S.view === "flow");
    Array.prototype.forEach.call(app.querySelectorAll("[data-dz-nav],[data-dz-b]"), function (b) {
      var k = b.getAttribute("data-dz-nav") || b.getAttribute("data-dz-b"), on = k === S.view;
      b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  function paintOcc() {
    var host = S.host; if (!host) return;
    var occ = modelOccupancy(host.tickets(), Date.now()), p = host.pulse(), pp = (p && p.pulse) || null, wn = (pp && pp.waitingNow) || {};
    var f = document.getElementById("dzOccF");
    if (f) setHtml(f, FILTERS.filter(function (x) { return x[0] === "all" || occ.counts[x[0]]; }).map(function (x) { return '<button type="button" data-dz-filter="' + x[0] + '" aria-pressed="' + (S.filter === x[0]) + '">' + esc(x[1]) + ' <span>' + (occ.counts[x[0]] || 0) + "</span></button>"; }).join(""), "occf");
    var sub = document.getElementById("dzOccSub");
    if (sub) sub.textContent = pp ? plural(pp.waiting || 0, "waiting", "waiting") + " in the hall, longest " + minLabel(wn.longestMin || 0) + ((wn.over60 || 0) ? ", " + wn.over60 + " over an hour" : "") : plural(occ.counts.all, "patient") + " on today's board";
    var rows = occ.rows.filter(function (o) { return S.filter === "all" || o.status.key === S.filter; });
    var body = document.getElementById("dzOcc"); if (!body) return;
    var empty = occ.counts.all ? "No patients match this filter." : (document.getElementById("walk") ? "Nobody on the board yet. New walk-in registers the first arrival." : "Nobody on the board yet.");
    var html = rows.length ? '<table class="dz-table"><caption class="dz-sr">Today\'s active patients across rooms and the walk-in pool</caption><thead><tr><th scope="col">Token</th><th scope="col">Patient</th><th scope="col">Visit</th><th scope="col">Status</th><th scope="col">Room and doctor</th><th scope="col">Waiting</th><th scope="col"><span class="dz-sr">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (o, i) { return occRowHtml(o, i); }).join("") + "</tbody></table>" : '<div class="dz-empty">' + esc(empty) + "</div>";
    // Rebuilt every paint: the proxies point at the console's current buttons, which a refresh replaces.
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll("tr[data-dz-row]"), function (tr) {
      var o = rows[+tr.getAttribute("data-dz-row")], cell = tr.querySelector(".dz-act"), btns = host.actionsFor(o.r);
      if (!btns.length) { cell.innerHTML = '<span class="dz-muted">View only</span>'; return; }
      var prim = btns.filter(function (b) { return b.hasAttribute("data-assign"); })[0] || btns.filter(function (b) { return b.classList.contains("pri"); })[0] || btns[0];
      var pb = document.createElement("button"); pb.type = "button"; pb.className = "dz-btn"; pb.textContent = labelOf(prim);
      pb.setAttribute("aria-label", labelOf(prim) + ": " + (o.t.name || "patient"));
      pb.onclick = function () { prim.click(); };
      cell.appendChild(pb);
      if (btns.length > 1) {
        var mb = document.createElement("button"); mb.type = "button"; mb.className = "dz-iconbtn sm"; mb.innerHTML = ms("more_horiz");
        mb.setAttribute("aria-label", "More actions for " + (o.t.name || "patient")); mb.setAttribute("aria-haspopup", "menu"); mb.setAttribute("aria-expanded", "false");
        mb.onclick = function () { menu(mb, btns.filter(function (b) { return b !== prim; })); };
        cell.appendChild(mb);
      }
    });
  }
  function labelOf(b) { var c = b.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll(".ms"), function (x) { x.remove(); }); return (c.textContent || "").replace(/\s+/g, " ").trim() || "Open"; }

  var MENU = null;
  function closeMenu(restore) { if (!MENU) return; var m = MENU; MENU = null; m.el.remove(); m.btn.setAttribute("aria-expanded", "false"); document.removeEventListener("mousedown", m.out, true); if (restore && m.btn.isConnected) m.btn.focus(); }
  function menu(anchor, btns) {
    if (MENU && MENU.btn === anchor) { closeMenu(true); return; }
    closeMenu(false);
    var el = document.createElement("div"); el.className = "dz-menu-pop"; el.setAttribute("role", "menu");
    btns.forEach(function (b) { var it = document.createElement("button"); it.type = "button"; it.setAttribute("role", "menuitem"); it.textContent = labelOf(b); it.onclick = function () { closeMenu(false); b.click(); }; el.appendChild(it); });
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect(), w = Math.min(240, window.innerWidth - 24);
    el.style.width = w + "px";
    el.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + "px";
    var below = r.bottom + 6, hgt = el.offsetHeight;
    el.style.top = (below + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8 ? r.top - hgt - 6 : below) + window.scrollY + "px";
    anchor.setAttribute("aria-expanded", "true");
    var items = el.querySelectorAll("[role=menuitem]");
    el.onkeydown = function (e) {
      var i = Array.prototype.indexOf.call(items, document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Tab") closeMenu(false);
    };
    var out = function (e) { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(false); };
    document.addEventListener("mousedown", out, true);
    MENU = { el: el, btn: anchor, out: out };
    if (items[0]) items[0].focus();
  }

  /** Repaints every card from the host's data; a card whose HTML did not change is left alone (no flicker). */
  function paint() {
    var host = S.host; if (!host || !host.app.isConnected || !document.getElementById("dzDash")) return;
    var ins = host.insights(), p = host.pulse(), insFailed = !!(ins && ins.failed);
    if (insFailed) ins = null;
    setHtml(document.getElementById("dzKpis"), p ? kpiHtml(modelKpis(p, ins, host.money())) : '<div class="dz-card dz-kpis-wait" aria-busy="true">Reading today\'s figures...</div>', "kpi");
    paintOcc();
    setHtml(document.getElementById("dzTasks"), tasksHtml(modelTasks(host.taskSources())), "tasks");
    setHtml(document.getElementById("dzPeak"), insFailed ? failedHtml("Today's arrivals") : hoursHtml(modelHours(ins), p), "peak");
    setHtml(document.getElementById("dzMonth"), insFailed ? failedHtml("The month") : monthHtml(modelMonth(ins)), "month");
    setHtml(document.getElementById("dzMix"), insFailed ? failedHtml("Today's visit types") : mixHtml(modelMix(ins)), "mix");
    var ts = host.taskSources(), occ = modelOccupancy(host.tickets(), Date.now());
    badge("active", occ.counts.all); badge("recall", ts.recallable); badge("unpaid", ts.unpaid);
    var live = document.getElementById("dzLive"); if (live) { var on = host.isLive(); live.classList.toggle("on", on); live.lastChild.textContent = on ? "Live" : "Refreshes every minute"; }
  }
  function badge(k, n) { Array.prototype.forEach.call(document.querySelectorAll('[data-dz-badge="' + k + '"]'), function (b) { b.hidden = !n; b.textContent = n || ""; }); }

  var PAL = null;
  function commands() {
    var host = S.host, list = [];
    var add = function (id, icon, label, hint, fn) { list.push({ id: id, icon: icon, label: label, hint: hint || "", run: fn }); };
    add("v-overview", "space_dashboard", "Go to Overview", "View", function () { setView("overview"); });
    add("v-flow", "view_kanban", "Go to Patient flow", "View", function () { setView("flow", "flow"); });
    add("v-rooms", "meeting_room", "Go to Room queues", "View", function () { setView("flow", "rooms"); });
    [["walk", "person_add", "New walk-in"], ["opdScanBtn", "qr_code_scanner", "Scan patient QR, barcode or Ni-Key"], ["noshows", "person_search", "No-shows you can recall"], ["dayclose", "event_available", "Close the day"],
     ["billing", "receipt_long", "Open billing"], ["pharmacy", "medication", "Open pharmacy"], ["disp", "tv", "Waiting-room display link"], ["rooms", "door_open", "Rooms"], ["tariffBtn", "sell", "Tariff and stock"],
     ["staff", "group", "Staff"], ["brand", "palette", "Branding"], ["clinics", "domain", "Switch clinic"], ["ref", "refresh", "Refresh the board"]].forEach(function (c) {
      if (document.getElementById(c[0])) add("b-" + c[0], c[1], c[2], "Action", function () { host.click(c[0]); });
    });
    add("classic", "view_quilt", "Switch to the classic layout", "Layout", function () { lsSet(LS, "0"); host.rerender(); });
    return list;
  }
  function palette(open) {
    if (!open) { if (PAL) { PAL.wrap.hidden = true; var back = PAL.back; PAL.back = null; if (back && back.isConnected) back.focus(); } return; }
    if (!PAL) {
      var wrap = document.createElement("div"); wrap.className = "dz-pal-wrap"; wrap.hidden = true;
      wrap.innerHTML = '<div class="dz-pal" role="dialog" aria-modal="true" aria-label="Search patients and actions"><div class="dz-pal-in">' + ms("search") +
        '<input id="dzPalQ" type="text" role="combobox" aria-expanded="true" aria-controls="dzPalL" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Patient name, token, or an action"><kbd>Esc</kbd></div><ul id="dzPalL" role="listbox" aria-label="Results"></ul></div>';
      document.body.appendChild(wrap);
      PAL = { wrap: wrap, q: wrap.querySelector("#dzPalQ"), list: wrap.querySelector("#dzPalL"), items: [], sel: 0, back: null };
      wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) palette(false); });
      PAL.q.addEventListener("input", function () { PAL.sel = 0; renderPal(); });
      PAL.q.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); palette(false); }
        else if (e.key === "ArrowDown") { e.preventDefault(); PAL.sel = Math.min(PAL.items.length - 1, PAL.sel + 1); renderPal(true); }
        else if (e.key === "ArrowUp") { e.preventDefault(); PAL.sel = Math.max(0, PAL.sel - 1); renderPal(true); }
        else if (e.key === "Enter") { e.preventDefault(); runPal(PAL.sel); }
        else if (e.key === "Tab") e.preventDefault();   // focus stays in the field; the arrows move the choice
      });
      PAL.list.addEventListener("click", function (e) { var li = e.target.closest && e.target.closest("[data-i]"); if (li) runPal(+li.getAttribute("data-i")); });
    }
    PAL.back = document.activeElement; PAL.q.value = ""; PAL.sel = 0; PAL.wrap.hidden = false; renderPal(); PAL.q.focus();
  }
  function renderPal(keepList) {
    var q = PAL.q.value.trim().toLowerCase(), cmds = commands(), items = [];
    if (q) {
      modelOccupancy(S.host.tickets(), Date.now()).rows.forEach(function (o) {
        var s = [o.t.name, o.t.token, o.t.mrnLast4, o.t.mrn].join(" ").toLowerCase();
        if (s.indexOf(q) > -1 && items.length < 6) items.push({ id: "p-" + o.t.id, icon: "person", label: (o.t.token ? o.t.token + "  " : "") + (o.t.name || "Patient"), hint: o.status.label, run: (function (key) { return function () { setView("flow", "flow"); S.host.search(key); }; })(o.t.token || o.t.name || "") });
      });
    }
    cmds.forEach(function (c) { if (!q || c.label.toLowerCase().indexOf(q) > -1) items.push(c); });
    PAL.items = items;
    PAL.list.innerHTML = items.length ? items.map(function (c, i) { return '<li role="option" id="dzPo' + i + '" data-i="' + i + '" aria-selected="' + (i === PAL.sel) + '">' + ms(c.icon) + "<span>" + esc(c.label) + "</span><small>" + esc(c.hint) + "</small></li>"; }).join("") : '<li class="dz-pal-none" role="option" aria-disabled="true">Nothing matches. Try a token like A-12, or an action like billing.</li>';
    PAL.q.setAttribute("aria-activedescendant", items.length ? "dzPo" + PAL.sel : "");
    if (keepList) { var cur = PAL.list.querySelector('[aria-selected="true"]'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" }); }
  }
  function runPal(i) { var c = PAL.items[i]; if (!c) return; PAL.back = null; palette(false); try { c.run(); } catch (e) {} }

  function bindKeys() {
    if (S.keyBound) return; S.keyBound = true;
    // The hour chart is drawn for the width it has, so crossing the phone breakpoint redraws it.
    var wasNarrow = window.innerWidth < 640, rt = null;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { var n = window.innerWidth < 640; if (n !== wasNarrow) { wasNarrow = n; paint(); } }, 150); });
    document.addEventListener("keydown", function (e) {
      if (!enabled() || !S.host || !S.host.app.classList.contains("opd-dash-on")) return;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); palette(!(PAL && !PAL.wrap.hidden)); }
      else if (e.key === "Escape" && S.host.app.classList.contains("dz-drawer-open")) drawer(false);
    });
  }

  return {
    enabled: enabled, shell: shell, paint: paint, setView: setView, palette: palette,
    enable: function () { lsSet(LS, null); },
    view: function () { return S.view; },
    // pure, for the Node tests
    deltaChip: deltaChip, modelKpis: modelKpis, modelOccupancy: modelOccupancy, modelHours: modelHours, modelMonth: modelMonth, modelMix: modelMix, modelTasks: modelTasks, statusOf: statusOf,
    kpiHtml: kpiHtml, tasksHtml: tasksHtml, monthHtml: monthHtml, mixHtml: mixHtml, hoursHtml: hoursHtml,
  };
});
