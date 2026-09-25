/* opd-dashboard.js - the OPD console's operations dashboard (window.SMD_OPD_DASH).
 *
 * A presentation layer over what the console already has. It invents no action and no figure:
 *   - KPI strip        /opd-pulse (seen, door to doctor, did not wait), /day-close money (collected, net), and
 *                      /opd-insights deltas against the same time yesterday (computed on the server).
 *   - Live occupancy   the board the console already loaded (st.opd rooms + pool, or the legacy doctor board).
 *                      Every row action is the console's OWN button, clicked: same handler, same payload,
 *                      same permission (a button the console did not render is not offered here).
 *   - Peak hours       /opd-insights hourly registrations; chips from the pulse.
 *   - Month volume     /opd-insights month[] (patients registered and seen per day).
 *   - Visit mix        /opd-insights mix (new / follow-up / appointment, and who went ahead by reason).
 *   - Tasks            what already exists and has an action: visits not in the record (retry), follow-ups to
 *                      book, results back, offline check-ins, unpaid orders, recallable no-shows, refunds today.
 *   - Sidebar + Ctrl/Cmd-K palette over the console's existing buttons.
 *
 * Reversible: localStorage.smd_opd_dash = "0" (or the "Classic layout" button) returns the Flow Board layout;
 * smd_opd_flow_ui = "0" still returns the original board under both.
 *
 * Buildless ES5, UMD: Node tests load the pure builders (model*) directly. Values are escaped here.
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

  var PRIO = { emergency: "Emergency", senior: "Senior citizen", pregnant: "Pregnant", disability: "Disability", child: "Child", results: "Results back", other: "Other reason" };
  var VISIT = { "new": "New", followup: "Follow-up", appointment: "Appointment", teleconsult: "Teleconsult" };

  /* ---------------- PURE MODELS (tested in Node) ---------------- */

  /** A delta chip. goodWhen: "up" | "down". -> { text, dir: up|down|same|none, tone: good|bad|neutral } */
  function deltaChip(d, goodWhen, unit) {
    if (d == null) return { text: "No figure yesterday", dir: "none", tone: "neutral" };
    if (d === 0) return { text: "Same as yesterday", dir: "same", tone: "neutral" };
    var up = d > 0, good = goodWhen === "up" ? up : !up;
    return { text: (up ? "+" : "−") + Math.abs(d) + (unit || "") + " vs yesterday", dir: up ? "up" : "down", tone: good ? "good" : "bad" };
  }

  /** KPI tiles from pulse + insights + money. money: null (billing off: tile hidden) | {unread:true} | day-close money. */
  function modelKpis(pulseResp, ins, money) {
    if (pulseResp && (pulseResp.failed || pulseResp.ok === false)) return { failed: true, message: "Could not read the OPD figures. Do not read this as a quiet clinic." };
    var p = (pulseResp && pulseResp.pulse) || null, d = (ins && ins.delta) || {};
    var have = !!p, d2d = (p && p.doorToDoctor) || {};
    var tiles = [];
    tiles.push({ key: "seen", icon: "how_to_reg", label: "Patients seen", value: have ? p.seen || 0 : null, suffix: have ? "/" + (p.registered || 0) : "", sub: have ? plural(p.registered || 0, "registered today", "registered today") : "reading", delta: ins ? deltaChip(d.seen, "up") : null });
    if (money) {
      if (money.unread) tiles.push({ key: "money", icon: "payments", label: "Collected today", value: null, sub: "could not be read, see Billing", warn: true });
      else tiles.push({ key: "money", icon: "payments", label: "Collected today", value: rupees(money.net), sub: plural(money.count || 0, "bill") + (money.refunds && money.refunds.count ? " · " + rupees(money.refunds.total) + " refunded" : ""), delta: null, note: "net of refunds" });
    }
    tiles.push({ key: "d2d", icon: "timer", label: "Door to doctor", value: d2d.medianMin == null ? null : d2d.medianMin, unit: "m", sub: d2d.p90Min == null ? "median, nobody seen yet" : "median · 9 in 10 within " + d2d.p90Min + "m", delta: ins ? deltaChip(d.doorToDoctorMin, "down", "m") : null });
    tiles.push({ key: "dnw", icon: "person_off", label: "Did not wait", value: have && p.abandonedPct != null ? p.abandonedPct : null, unit: "%", sub: have ? plural(p.noShow || 0, "no-show") : "reading", warn: have && (p.abandonedPct || 0) >= 10, delta: ins ? deltaChip(d.abandonedPct, "down", "%") : null });
    return { tiles: tiles, unread: (pulseResp && pulseResp.unread) || [] };
  }

  /** One status per active ticket: the label a person reads, plus a tone and icon (never colour alone). */
  function statusOf(row) {
    var t = row.t || {};
    if (row.pool) return { key: "route", label: "To route", icon: "alt_route", tone: "info" };
    if (t.status === "in_consultation") return { key: "treat", label: "In treatment", icon: "stethoscope", tone: "good" };
    if (t.status === "called") return { key: "called", label: "Called", icon: "campaign", tone: "accent" };
    if (t.status === "at_diagnostics" || t.status === "investigation") return { key: "tests", label: "At diagnostics", icon: "biotech", tone: "slate" };
    if (t.status === "followup") return { key: "tests", label: "Booked back", icon: "event_repeat", tone: "slate" };
    if (t.status === "completed") return { key: "done", label: "Completed", icon: "check_circle", tone: "slate" };
    if (t.resultReadyAt) return { key: "results", label: "Results back", icon: "lab_research", tone: "violet" };
    return { key: "wait", label: "Waiting", icon: "hourglass_top", tone: "warn" };
  }
  var FILTERS = [["all", "All"], ["wait", "Waiting"], ["treat", "In treatment"], ["route", "To route"], ["results", "Results back"], ["tests", "Diagnostics"]];
  var STATUS_ORDER = { treat: 0, called: 1, results: 2, wait: 3, route: 4, tests: 5, done: 6 };

  /** rows: [{t, pool, room, doctor}] -> sorted occupancy rows with status, wait and counts per filter. */
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

  /** Hour bars: the window shown (at least 8 am to 8 pm, widened to any hour with arrivals). */
  function modelHours(ins) {
    if (!ins || !ins.hourly) return null;
    var h = ins.hourly, first = 8, last = 20, i, max = 0, busiest = -1, total = 0;
    for (i = 0; i < 24; i++) { if (h[i]) { if (i < first) first = i; if (i > last) last = i; } total += h[i] || 0; if ((h[i] || 0) > max) { max = h[i]; busiest = i; } }
    if (ins.currentHour != null) { if (ins.currentHour < first) first = ins.currentHour; if (ins.currentHour > last) last = ins.currentHour; }
    var bars = [];
    for (i = first; i <= last; i++) bars.push({ hour: i, value: h[i] || 0, level: max ? Math.min(3, Math.ceil(((h[i] || 0) / max) * 4) - 1) : 0, now: i === ins.currentHour, busiest: i === busiest && max > 0 });
    return { bars: bars, max: max, busiest: busiest, total: total, current: ins.currentHour };
  }

  /** Month calendar cells, Monday first. */
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
      var d = by[i], past = i < today, isToday = i === today;
      cells.push({ day: i, registered: d ? d.registered : null, seen: d ? d.seen : null, past: past, today: isToday, future: i > today, unread: !!unread[i], closed: past && d && d.registered > 0, level: d && max ? Math.min(3, Math.ceil((d.registered / max) * 4) - 1) : -1 });
    }
    var label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    var open = ins.month.filter(function (d) { return d.registered > 0; }).length;
    return { label: label, cells: cells, total: total, seen: seen, max: max, openDays: open, avg: open ? Math.round(total / open) : 0 };
  }

  /** Visit mix: donut segments (fixed order, colour follows the type) and priority bubbles. */
  function modelMix(ins) {
    if (!ins || !ins.mix) return null;
    var mx = ins.mix, keys = ["new", "followup", "appointment", "teleconsult"], total = 0;
    var segs = keys.filter(function (k) { return mx[k] != null && (k === "new" || k === "followup" || mx[k] > 0); }).map(function (k, i) { total += mx[k] || 0; return { key: k, label: VISIT[k], value: mx[k] || 0, slot: keys.indexOf(k) + 1 }; });
    segs.forEach(function (s) { s.pct = total ? Math.round((s.value / total) * 100) : 0; });
    var pr = Object.keys(mx.priority || {}).map(function (k) { return { key: k, label: PRIO[k] || "Priority", value: mx.priority[k] }; }).sort(function (a, b) { return b.value - a.value; });
    var prTotal = pr.reduce(function (a, b) { return a + b.value; }, 0);
    return { segs: segs, total: total, priority: pr, priorityTotal: prTotal };
  }

  /** The inbox. src: { pulse, followups, offline:{pending,review}, unpaid, recallable, refunds, can:{...} } */
  function modelTasks(src) {
    var p = (src.pulse && src.pulse.pulse) || {}, out = [];
    function add(o) { if (o.count > 0) out.push(o); }
    add({ key: "sync", icon: "sync_problem", tone: "bad", title: "Visits not in the record", sub: "Seen or queued, but the visit did not reach the clinical record", count: p.syncFailed || 0, action: "reconcile", label: "Send again" });
    add({ key: "offline", icon: "cloud_off", tone: "warn", title: "Offline check-ins", sub: (src.offline && src.offline.review ? plural(src.offline.review, "to check") + " · " : "") + "waiting to be sent to the queue", count: (src.offline && (src.offline.pending + (src.offline.review || 0))) || 0, action: "offline", label: "Send now" });
    add({ key: "results", icon: "lab_research", tone: "violet", title: "Results back", sub: "Back in the queue with their result", count: p.resultsBack || 0, action: "results", label: "Show" });
    add({ key: "recall", icon: "person_search", tone: "warn", title: "No-shows you can recall", sub: "Same token, inside the 4 hour window", count: src.recallable || 0, action: "noshows", label: "Recall" });
    var fu = src.followups || {};
    add({ key: "followups", icon: "event_repeat", tone: fu.overdue ? "bad" : "info", title: "Follow-ups to book", sub: fu.overdue ? plural(fu.overdue, "overdue") : "Promised, not booked yet", count: fu.unbooked || 0, action: "schedule", label: "Book" });
    add({ key: "unpaid", icon: "receipt_long", tone: "warn", title: "Unpaid orders", sub: "Waiting at billing", count: src.unpaid || 0, action: "billing", label: "Open billing" });
    add({ key: "refunds", icon: "currency_exchange", tone: "slate", title: "Refunds today", sub: src.refundTotal ? rupees(src.refundTotal) + " returned, netted in the day close" : "Netted in the day close", count: src.refunds || 0, action: "dayclose", label: "Review" });
    return out;
  }

  /* ---------------- RENDERERS (strings) ---------------- */

  function kpiHtml(k) {
    if (k.failed) return '<div class="dz-alert" role="alert">' + ms("error") + esc(k.message) + "</div>";
    var h = '<div class="dz-kpis" style="--n:' + k.tiles.length + '">' + k.tiles.map(function (t) {
      var v = t.value == null ? '<span class="dz-none">not yet</span>' : esc(t.value) + (t.unit ? '<span class="dz-unit">' + esc(t.unit) + "</span>" : "") + (t.suffix ? '<span class="dz-suffix">' + esc(t.suffix) + "</span>" : "");
      var d = t.delta ? '<span class="dz-delta ' + t.delta.tone + '">' + (t.delta.dir === "up" ? ms("arrow_upward", "sm") : t.delta.dir === "down" ? ms("arrow_downward", "sm") : "") + esc(t.delta.text) + "</span>" : (t.note ? '<span class="dz-delta neutral">' + esc(t.note) + "</span>" : "");
      return '<section class="dz-card dz-kpi' + (t.warn ? " warn" : "") + '" data-kpi="' + esc(t.key) + '" aria-label="' + esc(t.label) + '"><div class="dz-kpi-top"><span class="dz-tile">' + ms(t.icon) + '</span><h3>' + esc(t.label) + "</h3></div>" +
        '<div class="dz-kpi-v">' + v + "</div><div class=\"dz-kpi-s\">" + esc(t.sub || "") + "</div>" + d + "</section>";
    }).join("") + "</div>";
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
        (o.prio ? '<span class="dz-chip ' + (o.prioLevel >= 2 ? "bad" : "warn") + '">' + ms(o.prioLevel >= 2 ? "emergency" : "priority_high", "sm") + esc(o.prio) + "</span>" : "") + "</span></td>" +
      '<td class="dz-visit" data-label="Visit">' + esc(o.visit) + "</td>" +
      '<td data-label="Status"><span class="dz-pill ' + o.status.tone + '">' + ms(o.status.icon, "sm") + esc(o.status.label) + "</span></td>" +
      '<td class="dz-room" data-label="Room"><b>' + esc(place || "-") + '</b><small>' + esc(r.doctor || (r.pool ? "Doctor not assigned" : "")) + "</small></td>" +
      '<td class="dz-wait' + (o.long ? " long" : "") + '" data-label="Waiting">' + (o.long ? ms("schedule", "sm") : "") + esc(o.waitMin == null ? "-" : minLabel(o.waitMin)) + (o.long ? '<span class="dz-sr"> (over 1 hour)</span>' : "") + "</td>" +
      '<td class="dz-act" data-label="Action"></td></tr>';
  }

  function hoursSvg(m) {
    var narrow = typeof window !== "undefined" && window.innerWidth < 640, W = narrow ? 340 : 560, H = narrow ? 200 : 230, padL = 28, padB = 26, padT = 22, n = m.bars.length, gap = narrow ? 3 : 6, every = narrow ? 3 : 2;
    var bw = Math.max(8, (W - padL - (n - 1) * gap) / n), top = Math.max(4, Math.ceil(m.max / 4) * 4), plotH = H - padB - padT;
    var y = function (v) { return padT + plotH - (top ? (v / top) * plotH : 0); };
    var grid = "", i;
    for (i = 0; i <= 2; i++) { var gv = Math.round((top / 2) * i), gy = y(gv); grid += '<line x1="' + padL + '" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" class="dz-gl"/><text x="' + (padL - 6) + '" y="' + (gy + 4) + '" class="dz-axis" text-anchor="end">' + gv + "</text>"; }
    var bars = m.bars.map(function (b, j) {
      var x = padL + j * (bw + gap), h = Math.max(b.value ? 4 : 2, (top ? (b.value / top) * plotH : 0)), yy = padT + plotH - h;
      var cls = b.now ? "dz-bar now" : "dz-bar l" + Math.max(0, b.level);
      var nearNow = !b.now && ((m.bars[j - 1] && m.bars[j - 1].now) || (m.bars[j + 1] && m.bars[j + 1].now));
      var lbl = ((j % every === 0 && !nearNow) || b.now) ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" class="dz-axis' + (b.now ? " now" : "") + '" text-anchor="middle">' + (b.now ? "Now" : hourShort(b.hour)) + "</text>" : "";
      var val = (b.busiest || b.now) && b.value ? '<text x="' + (x + bw / 2) + '" y="' + (yy - 6) + '" class="dz-val" text-anchor="middle">' + b.value + "</text>" : "";
      return '<g><title>' + hourLabel(b.hour) + ": " + plural(b.value, "registration") + (b.now ? " (this hour)" : "") + (b.busiest ? " (busiest)" : "") + '</title><rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(6, bw / 2).toFixed(1) + '" class="' + cls + '"/>' + val + lbl + "</g>";
    }).join("");
    var summary = m.total ? plural(m.total, "registration") + " today. Busiest hour " + hourLabel(m.busiest) + " with " + m.max + "." : "No registrations yet today.";
    return '<svg class="dz-hours-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Registrations per hour today. ' + esc(summary) + '" preserveAspectRatio="xMidYMid meet">' + grid + bars + "</svg>";
  }
  function hoursHtml(m, pulseResp) {
    var p = (pulseResp && pulseResp.pulse) || {}, wn = p.waitingNow || {}, cs = p.consult || {};
    var chips = '<div class="dz-stats">' +
      '<div class="dz-stat"><span>Median wait now</span><b>' + esc(wn.medianMin == null ? "-" : minLabel(wn.medianMin)) + "</b></div>" +
      '<div class="dz-stat"><span>Seen / registered</span><b>' + esc((p.seen || 0) + " / " + (p.registered || 0)) + "</b></div>" +
      '<div class="dz-stat"><span>Median consult</span><b>' + esc(cs.medianMin == null ? "-" : minLabel(cs.medianMin)) + "</b></div></div>";
    if (!m) return chips + '<div class="dz-empty">Reading today\'s hours...</div>';
    var legend = '<div class="dz-legend"><span class="dz-ramp" aria-hidden="true"><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i></span><span>Less busy to busy</span><span class="dz-sw now" aria-hidden="true"></span><span>This hour</span></div>';
    var table = '<table class="dz-sr"><caption>Registrations per hour</caption><tr><th>Hour</th><th>Registered</th></tr>' + m.bars.map(function (b) { return "<tr><td>" + hourLabel(b.hour) + "</td><td>" + b.value + "</td></tr>"; }).join("") + "</table>";
    return chips + '<div class="dz-hours">' + hoursSvg(m) + "</div>" + legend + table;
  }

  function monthHtml(m) {
    if (!m) return '<div class="dz-empty">Reading the month...</div>';
    var wd = ["M", "T", "W", "T", "F", "S", "S"].map(function (d, i) { return '<span class="dz-wd" aria-hidden="true">' + d + "</span>"; }).join("");
    var cells = m.cells.map(function (c) {
      if (!c) return '<span class="dz-day blank" aria-hidden="true"></span>';
      var aria = c.day + ": " + (c.future ? "later this month" : c.unread ? "could not be read" : c.registered == null ? "no patients" : plural(c.registered, "patient") + " registered, " + c.seen + " seen") + (c.today ? " (today)" : "");
      var inner = c.future || c.registered == null || c.unread ? '<b class="dz-num">' + (c.unread ? "?" : "") + "</b>" : '<b class="dz-num">' + c.registered + "</b>";
      return '<span class="dz-day' + (c.today ? " today" : "") + (c.future ? " future" : "") + (c.level >= 0 ? " v" + c.level : "") + '" role="listitem" aria-label="' + esc(aria) + '">' + inner + '<span class="dz-dn">' + c.day + "</span>" + (c.closed ? '<span class="dz-tick">' + ms("check", "sm") + "</span>" : "") + "</span>";
    }).join("");
    return '<div class="dz-cal-head"><div><b>' + esc(m.label) + '</b><span>' + plural(m.total, "patient") + " · " + m.seen + " seen</span></div><div class=\"dz-cal-avg\"><b>" + m.avg + "</b><span>a day, on " + plural(m.openDays, "open day") + "</span></div></div>" +
      '<div class="dz-cal">' + wd + '<div class="dz-cal-grid" role="list" aria-label="Patients registered each day this month">' + cells + "</div></div>" +
      '<div class="dz-legend dark"><span class="dz-ramp" aria-hidden="true"><i class="v0"></i><i class="v1"></i><i class="v2"></i><i class="v3"></i></span><span>Fewer to more patients</span>' + ms("check", "sm") + "<span>Day closed</span></div>";
  }

  function donutSvg(m) {
    var R = 54, r = 36, cx = 64, cy = 64, a0 = -Math.PI / 2, out = "";
    if (!m.total) out = '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" class="dz-donut-empty" stroke-width="' + (R - r) + '" fill="none"/>';
    else if (m.segs.filter(function (s) { return s.value; }).length === 1) { var only = m.segs.filter(function (s) { return s.value; })[0]; out = '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" class="dz-seg s' + only.slot + '" stroke-width="' + (R - r) + '" fill="none"/>'; }
    else m.segs.forEach(function (s) {
      if (!s.value) return;
      var a1 = a0 + (s.value / m.total) * Math.PI * 2, gapA = 0.03, sA = a0 + gapA / 2, eA = a1 - gapA / 2, large = eA - sA > Math.PI ? 1 : 0;
      var p = function (rad, ang) { return (cx + rad * Math.cos(ang)).toFixed(2) + " " + (cy + rad * Math.sin(ang)).toFixed(2); };
      out += '<path class="dz-seg-f s' + s.slot + '" d="M' + p(R, sA) + " A" + R + " " + R + " 0 " + large + " 1 " + p(R, eA) + " L" + p(r, eA) + " A" + r + " " + r + " 0 " + large + " 0 " + p(r, sA) + ' Z"><title>' + esc(s.label) + ": " + s.value + " (" + s.pct + "%)</title></path>";
      a0 = a1;
    });
    return '<svg class="dz-donut" viewBox="0 0 128 128" role="img" aria-label="Visit mix: ' + esc(m.segs.map(function (s) { return s.label + " " + s.value; }).join(", ")) + '">' + out +
      '<text x="64" y="62" text-anchor="middle" class="dz-donut-n">' + m.total + '</text><text x="64" y="80" text-anchor="middle" class="dz-donut-l">visits</text></svg>';
  }
  function mixHtml(m) {
    if (!m) return '<div class="dz-empty">Reading the visit mix...</div>';
    var legend = '<ul class="dz-keys">' + m.segs.map(function (s) { return '<li><span class="dz-key s' + s.slot + '" aria-hidden="true"></span><span>' + esc(s.label) + '</span><b>' + s.value + '</b><small>' + s.pct + "%</small></li>"; }).join("") + "</ul>";
    var maxP = m.priority.reduce(function (a, b) { return Math.max(a, b.value); }, 0);
    var bubbles = m.priority.length ? '<div class="dz-bubbles" role="list" aria-label="Put ahead of the queue, by reason">' + m.priority.map(function (p) {
      var sz = Math.round(34 + (maxP ? (p.value / maxP) : 0) * 26);
      return '<span class="dz-bubble' + (p.key === "emergency" ? " bad" : "") + '" role="listitem"><i style="width:' + sz + "px;height:" + sz + 'px" aria-hidden="true">' + p.value + '</i><span>' + esc(p.label) + '<span class="dz-sr">: ' + p.value + "</span></span></span>";
    }).join("") + "</div>" : '<p class="dz-muted">Nobody was put ahead of the queue today.</p>';
    return '<div class="dz-mix">' + donutSvg(m) + legend + "</div><h4 class=\"dz-sub\">Ahead of the queue <span>" + m.priorityTotal + "</span></h4>" + bubbles;
  }

  function tasksHtml(list) {
    if (!list.length) return '<div class="dz-allclear">' + ms("task_alt", "lg") + "<b>Nothing needs you right now</b><span>Retries, recalls, follow-ups and bills show up here.</span></div>";
    return '<ul class="dz-tasks">' + list.map(function (t) {
      return '<li class="dz-task"><span class="dz-ti ' + t.tone + '">' + ms(t.icon) + '</span><span class="dz-tx"><b>' + esc(t.title) + ' <span class="dz-count">' + t.count + '</span></b><small>' + esc(t.sub) + '</small></span><button type="button" class="dz-btn" data-dz-task="' + esc(t.action) + '" aria-label="' + esc(t.label + ": " + t.title) + '">' + esc(t.label) + "</button></li>";
    }).join("") + "</ul>";
  }

  /* ---------------- DOM LAYER ---------------- */
  var S = { view: lsGet(LS_VIEW) === "flow" ? "flow" : "overview", filter: "all", host: null, first: true, keyBound: false, painted: {} };

  function setHtml(el, html, key) { if (!el) return; if (S.painted[key] === html && el.childNodes.length) return; el.innerHTML = html; S.painted[key] = html; }

  function navItem(id, icon, label, badgeKey, current) {
    return '<button type="button" class="dz-nav' + (current ? " on" : "") + '" data-dz-nav="' + id + '"' + (current ? ' aria-current="page"' : "") + ">" + ms(icon) + "<span>" + esc(label) + "</span>" + (badgeKey ? '<span class="dz-badge" data-dz-badge="' + badgeKey + '" hidden></span>' : "") + "</button>";
  }

  /** Build the sidebar (moving the console's own buttons into it) and the top bar. Called once per console render. */
  function shell(host) {
    S.host = host;
    var app = host.app, main = app.querySelector(".opd-main"), nav = app.querySelector(".opd-sidebar");
    if (!main || !nav) return false;
    app.classList.add("opd-dash-on");
    S.painted = {};
    nav.classList.add("dz-side"); nav.id = "dzSide"; nav.setAttribute("aria-label", "OPD console");
    var brand = esc(host.clinicName() || "OPD");
    // The console's own buttons were already moved into this nav: keep them (and their handlers) before it is rebuilt.
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
      if (v === "classic") { lsSet(LS, "0"); host.rerender(); host.toast("Classic layout. The new dashboard is one click away in the sidebar."); return; }
      drawer(false);
      if (v === "overview") setView("overview");
      else if (v === "flow") setView("flow", "flow");
      else if (v === "rooms-view") setView("flow", "rooms");
    };
    // Top bar: date, search (opens the palette), New walk-in, refresh, live state.
    var top = document.createElement("div"); top.className = "dz-top";
    var mac = /Mac|iPhone|iPad/.test((typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "");
    var d = new Date(), dateLabel = d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    top.innerHTML = '<button type="button" class="dz-iconbtn dz-menu" data-dz-drawer="open" aria-label="Open menu" aria-controls="dzSide" aria-expanded="false">' + ms("menu") + "</button>" +
      '<div class="dz-title"><h1 id="dzTitle">' + (S.view === "flow" ? "Patient flow" : "Overview") + '</h1><span>' + esc(dateLabel) + ' <span class="dz-live" id="dzLive"><i></i><span>Live</span></span></span></div>' +
      '<button type="button" class="dz-search" id="dzSearch" aria-haspopup="dialog" aria-label="Search patients and actions (' + (mac ? "Command" : "Control") + ' K)">' + ms("search") + '<span>Search patients and actions</span><kbd>' + (mac ? "⌘" : "Ctrl") + " K</kbd></button>" +
      '<button type="button" class="dz-iconbtn" id="dzRefresh" aria-label="Refresh">' + ms("refresh") + "</button>" +
      (document.getElementById("walk") ? '<button type="button" class="dz-new" id="dzNew">' + ms("add") + "<span>New walk-in</span></button>" : "");
    main.insertBefore(top, main.firstChild);
    top.querySelector("#dzSearch").onclick = function () { palette(true); };
    top.querySelector("#dzRefresh").onclick = function () { host.click("ref"); };
    var nw = top.querySelector("#dzNew"); if (nw) nw.onclick = function () { host.click("walk"); };
    top.querySelector(".dz-menu").onclick = function () { drawer(true); };
    // Phone: bottom navigation.
    var bn = document.createElement("nav"); bn.className = "dz-bottom"; bn.setAttribute("aria-label", "Quick navigation");
    bn.innerHTML = '<button type="button" data-dz-b="overview">' + ms("space_dashboard") + "<span>Overview</span></button>" + '<button type="button" data-dz-b="flow">' + ms("view_kanban") + "<span>Flow</span></button>" +
      (document.getElementById("walk") ? '<button type="button" data-dz-b="new">' + ms("add_circle") + "<span>Walk-in</span></button>" : "") +
      '<button type="button" data-dz-b="search">' + ms("search") + "<span>Search</span></button>" + '<button type="button" data-dz-b="menu" aria-controls="dzSide">' + ms("menu") + "<span>Menu</span></button>";
    bn.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-dz-b]"); if (!b) return; var a = b.getAttribute("data-dz-b");
      if (a === "overview") setView("overview"); else if (a === "flow") setView("flow", "flow"); else if (a === "new") host.click("walk"); else if (a === "search") palette(true); else drawer(true); };
    app.appendChild(bn);
    var scrim = document.createElement("div"); scrim.className = "dz-scrim"; scrim.onclick = function () { drawer(false); }; app.appendChild(scrim);
    // The dashboard's own region.
    var dash = document.createElement("div"); dash.className = "dz-dash"; dash.id = "dzDash";
    dash.innerHTML = '<div id="dzKpis" class="dz-row-kpi"></div>' +
      '<div class="dz-grid">' +
        '<section class="dz-card dz-occ" aria-labelledby="dzOccH"><header class="dz-ch"><div><h2 id="dzOccH">Live occupancy</h2><p id="dzOccSub"></p></div><div class="dz-filters" role="group" aria-label="Show patients" id="dzOccF"></div></header><div class="dz-occ-body" id="dzOcc"></div></section>' +
        '<section class="dz-card dz-tasks-card" aria-labelledby="dzTaskH"><header class="dz-ch"><div><h2 id="dzTaskH">Tasks and approvals</h2><p>What is waiting on the desk</p></div></header><div id="dzTasks"></div></section>' +
        '<section class="dz-card dz-peak" aria-labelledby="dzPeakH"><header class="dz-ch"><div><h2 id="dzPeakH">Peak hours today</h2><p>Registrations each hour</p></div></header><div id="dzPeak"></div></section>' +
        '<section class="dz-card dz-month" aria-labelledby="dzMonthH"><header class="dz-ch"><div><h2 id="dzMonthH">This month</h2><p>Patients registered each day</p></div></header><div id="dzMonth"></div></section>' +
        '<section class="dz-card dz-mixcard" aria-labelledby="dzMixH"><header class="dz-ch"><div><h2 id="dzMixH">Visit mix today</h2><p>New, follow-up and priority</p></div></header><div id="dzMix"></div></section>' +
      "</div>";
    top.parentNode.insertBefore(dash, top.nextSibling);
    dash.addEventListener("click", function (e) {
      var tb = e.target.closest && e.target.closest("[data-dz-task]");
      if (tb) {
        var a = tb.getAttribute("data-dz-task");
        if (a === "results") { S.filter = "results"; paintOcc(); var oc = document.getElementById("dzOccH"); if (oc && oc.scrollIntoView) oc.scrollIntoView({ block: "start", behavior: "auto" }); return; }
        host.task(a); return;
      }
      var fb = e.target.closest && e.target.closest("[data-dz-filter]"); if (fb) { S.filter = fb.getAttribute("data-dz-filter"); paintOcc(); return; }
    });
    bindKeys();
    applyView();
    paint();
    S.first = false;
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
    if (sub) sub.textContent = pp ? plural(pp.waiting || 0, "in the hall", "in the hall") + " · longest " + minLabel(wn.longestMin || 0) + ((wn.over60 || 0) ? " · " + wn.over60 + " over 1 hour" : "") : plural(occ.counts.all, "active patient");
    var rows = occ.rows.filter(function (o) { return S.filter === "all" || o.status.key === S.filter; });
    var body = document.getElementById("dzOcc"); if (!body) return;
    var html = rows.length ? '<table class="dz-table"><caption class="dz-sr">Today\'s active patients across rooms and the walk-in pool</caption><thead><tr><th scope="col">Token</th><th scope="col">Patient</th><th scope="col">Visit</th><th scope="col">Status</th><th scope="col">Room and doctor</th><th scope="col">Waiting</th><th scope="col"><span class="dz-sr">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (o, i) { return occRowHtml(o, i); }).join("") + "</tbody></table>" : '<div class="dz-empty">' + (occ.counts.all ? "No patients match this filter." : "No active patients. Register an arrival with New walk-in.") + "</div>";
    // Action cells are rebuilt every paint: they point at the console's CURRENT buttons, which a refresh replaces.
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
    (S.host.app.closest("body") || document.body).appendChild(el);
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

  /** Repaint every card from the host's current data. Cheap and idempotent: a card whose HTML is unchanged is left alone. */
  function paint() {
    var host = S.host; if (!host || !host.app.isConnected || !document.getElementById("dzDash")) return;
    var ins = host.insights(), p = host.pulse();
    setHtml(document.getElementById("dzKpis"), p ? kpiHtml(modelKpis(p, ins, host.money())) : '<div class="dz-kpis skeleton" aria-busy="true"><div class="dz-card dz-kpi"></div><div class="dz-card dz-kpi"></div><div class="dz-card dz-kpi"></div><div class="dz-card dz-kpi"></div></div>', "kpi");
    paintOcc();
    setHtml(document.getElementById("dzTasks"), tasksHtml(modelTasks(host.taskSources())), "tasks");
    setHtml(document.getElementById("dzPeak"), hoursHtml(modelHours(ins), p), "peak");
    setHtml(document.getElementById("dzMonth"), monthHtml(modelMonth(ins)), "month");
    setHtml(document.getElementById("dzMix"), mixHtml(modelMix(ins)), "mix");
    var ts = host.taskSources(), occ = modelOccupancy(host.tickets(), Date.now());
    badge("active", occ.counts.all); badge("recall", ts.recallable); badge("unpaid", ts.unpaid);
    var live = document.getElementById("dzLive"); if (live) { var on = host.isLive(); live.classList.toggle("on", on); live.lastChild.textContent = on ? "Live" : "Refreshes every minute"; }
  }
  function badge(k, n) { Array.prototype.forEach.call(document.querySelectorAll('[data-dz-badge="' + k + '"]'), function (b) { b.hidden = !n; b.textContent = n || ""; b.setAttribute("aria-label", n ? n + " " : ""); }); }

  /* ---------------- COMMAND PALETTE ---------------- */
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
        '<input id="dzPalQ" type="text" role="combobox" aria-expanded="true" aria-controls="dzPalL" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type a patient name, token or an action"><kbd>Esc</kbd></div><ul id="dzPalL" role="listbox" aria-label="Results"></ul></div>';
      document.body.appendChild(wrap);
      PAL = { wrap: wrap, q: wrap.querySelector("#dzPalQ"), list: wrap.querySelector("#dzPalL"), items: [], sel: 0, back: null };
      wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) palette(false); });
      PAL.q.addEventListener("input", function () { PAL.sel = 0; renderPal(); });
      PAL.q.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); palette(false); }
        else if (e.key === "ArrowDown") { e.preventDefault(); PAL.sel = Math.min(PAL.items.length - 1, PAL.sel + 1); renderPal(true); }
        else if (e.key === "ArrowUp") { e.preventDefault(); PAL.sel = Math.max(0, PAL.sel - 1); renderPal(true); }
        else if (e.key === "Enter") { e.preventDefault(); runPal(PAL.sel); }
        else if (e.key === "Tab") e.preventDefault();   // the dialog keeps focus in its field; arrows move the choice
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
        if (s.indexOf(q) > -1 && items.length < 6) items.push({ id: "p-" + o.t.id, icon: "person", label: (o.t.token ? o.t.token + "  " : "") + (o.t.name || "Patient"), hint: o.status.label, run: (function (name) { return function () { setView("flow", "flow"); S.host.search(name); }; })(o.t.token || o.t.name || "") });
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
    // pure, for tests
    deltaChip: deltaChip, modelKpis: modelKpis, modelOccupancy: modelOccupancy, modelHours: modelHours, modelMonth: modelMonth, modelMix: modelMix, modelTasks: modelTasks, statusOf: statusOf,
    kpiHtml: kpiHtml, tasksHtml: tasksHtml, monthHtml: monthHtml, mixHtml: mixHtml, hoursHtml: hoursHtml,
  };
});
