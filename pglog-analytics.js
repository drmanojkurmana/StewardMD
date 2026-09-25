/* pglog-analytics.js — NMC eLOGBook · what the record actually says about this resident.
 * ==========================================================================================
 * WHY THIS EXISTS
 * Residents estimate their numbers. At the end of three years they write "approximately 120
 * appendicectomies" on a form because nobody ever counted. The logbook HAS the count; it simply
 * never did the arithmetic. This module does it, and only it — every figure here is derived from
 * entries that exist, and nothing is extrapolated, annualised or projected.
 *
 * THE THREE RULES THIS FILE OBEYS
 *
 * 1. A COUNT SAYS WHICH RECORDS IT COUNTED. Every result carries { verified, submitted, draft }
 *    alongside the total, because "80 procedures" means something different when 12 are still
 *    unverified drafts. `countedStatuses` names the filter that produced the headline number, and
 *    the default headline counts VERIFIED ONLY — the same rule pglog-model's progress engine uses,
 *    since an unverified entry is a claim, not a record.
 *
 * 2. A RATE WITH NO DENOMINATOR IS NOT SHOWN. complicationRate() returns null (not 0, not "—")
 *    when there are no procedures to divide by, and carries `n` so the UI can print "2 of 37"
 *    instead of a percentage that rests on three cases. Below MIN_RATE_N the rate is returned with
 *    `lowN: true` and the UI is expected to show the fraction, not the percentage.
 *
 * 3. COMPLICATIONS ARE AS-RECORDED, NOT AS-AUDITED. This is a training log, not a morbidity audit:
 *    the denominator is procedures the resident logged, the numerator is those they marked as
 *    having a complication. It is a prompt for reflection and for a conversation with a guide. It
 *    is NOT a surgeon-level outcome statistic and every surface that shows it must say so —
 *    DISCLAIMER below is the wording, and it is not optional.
 *
 * Independence trend is the point of the whole module: PGMER-2023 5.2(x) describes graded
 * responsibility, so the question a guide actually asks is "is this resident doing more and
 * watching less than last year?". independenceTrend() answers exactly that and nothing more.
 *
 * Pure: no DOM, no fetch, no clock (the caller passes `today`). window.SMD_PGLOG_ANALYTICS.
 * ========================================================================================== */
(function () {
  "use strict";

  var COUNTED = ["verified"];                 // the headline filter — see rule 1
  var MIN_RATE_N = 20;                        // below this a percentage misleads; show the fraction
  var DISCLAIMER = "Counted from the entries in this logbook, as recorded by the resident. " +
    "Complication figures are self-reported training records for reflection and discussion with the " +
    "guide. They are not an audited outcome statistic and must not be read or presented as one.";

  var ROLE_ORDER = ["observed", "assisted", "performed_supervised", "performed_independent"];
  // Rungs of the ladder that count as "the resident did it", for the independence share.
  var DID_IT = { performed_supervised: 1, performed_independent: 1 };
  var INDEPENDENT = { performed_independent: 1 };

  function arr(a) { return Object.prototype.toString.call(a) === "[object Array]" ? a : []; }
  function str(s) { return String(s == null ? "" : s).trim(); }
  function norm(s) { return str(s).toLowerCase(); }
  function isoOf(e) { return str(e && (e.occurredAt || e.date || "")).slice(0, 10); }
  function monthOf(e) { return isoOf(e).slice(0, 7); }
  function titleOf(e) {
    e = e || {};
    // The model's own field names, in the order a reader would expect to see them.
    return str(e.procedureText || e.procedureName || e.diagnosis || e.title || e.topic || e.name || "");
  }
  function statusOf(e) { return norm(e && e.status) || "draft"; }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* Split any set of entries into the three buckets every figure reports. "submitted" holds
   * anything awaiting someone else (submitted, queued, under review); everything that is neither
   * verified nor awaiting is the resident's own outstanding work. */
  function tally(entries) {
    var t = { total: 0, verified: 0, submitted: 0, draft: 0 };
    arr(entries).forEach(function (e) {
      t.total++;
      var s = statusOf(e);
      if (s === "verified" || s === "attested" || s === "certified") t.verified++;
      else if (s === "submitted" || s === "queued" || s === "under_review") t.submitted++;
      else t.draft++;
    });
    return t;
  }
  function keep(entries, statuses) {
    var want = {}; arr(statuses).forEach(function (s) { want[norm(s)] = 1; });
    if (!arr(statuses).length) return arr(entries).slice();
    return arr(entries).filter(function (e) {
      var s = statusOf(e);
      if (want.verified && (s === "attested" || s === "certified")) return true;
      return !!want[s];
    });
  }
  function inWindow(e, from, to) {
    var d = isoOf(e);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
  function filterEntries(entries, opts) {
    opts = opts || {};
    var out = arr(entries).filter(function (e) { return inWindow(e, opts.from, opts.to); });
    if (opts.kind) out = out.filter(function (e) { return norm(e.kind) === norm(opts.kind); });
    if (opts.rotationId) out = out.filter(function (e) { return str(e.rotationId) === str(opts.rotationId); });
    if (arr(opts.statuses).length) out = keep(out, opts.statuses);
    else if (opts.countAll !== true) out = keep(out, COUNTED);
    return out;
  }

  /* ── caseload ─────────────────────────────────────────────────────────────────────────────
   * What this resident did, by kind and by month. `months` is dense (a month with no entries is
   * present with 0), so a chart shows the gap instead of hiding it — a quiet month IS the finding. */
  function caseload(entries, opts) {
    opts = opts || {};
    var all = arr(entries).filter(function (e) { return inWindow(e, opts.from, opts.to); });
    var counted = filterEntries(entries, opts);
    var byKind = {}, byMonth = {}, bySetting = {};
    counted.forEach(function (e) {
      var k = norm(e.kind) || "clinical";
      byKind[k] = (byKind[k] || 0) + 1;
      var m = monthOf(e); if (m) byMonth[m] = (byMonth[m] || 0) + 1;
      var s = norm(e.setting); if (s) bySetting[s] = (bySetting[s] || 0) + 1;
    });
    var keys = Object.keys(byMonth).sort();
    var months = [];
    if (keys.length) {
      var cur = keys[0], last = keys[keys.length - 1], guard = 0;
      while (cur <= last && guard++ < 240) {
        months.push({ month: cur, n: byMonth[cur] || 0 });
        var y = +cur.slice(0, 4), mo = +cur.slice(5, 7) + 1;
        if (mo > 12) { mo = 1; y++; }
        cur = y + "-" + (mo < 10 ? "0" : "") + mo;
      }
    }
    var busiest = months.slice().sort(function (a, b) { return b.n - a.n; })[0] || null;
    return {
      countedStatuses: arr(opts.statuses).length ? opts.statuses.slice() : (opts.countAll ? ["all"] : COUNTED.slice()),
      counts: tally(all),
      total: counted.length,
      byKind: byKind, bySetting: bySetting, months: months,
      busiestMonth: busiest,
      perMonth: months.length ? round1(counted.length / months.length) : null,
      disclaimer: DISCLAIMER
    };
  }

  /* ── what they see most ───────────────────────────────────────────────────────────────────
   * Grouped case-insensitively on the title, reported with the title as first written. Each row
   * carries its own role split, because "40 appendicectomies" of which 39 were observed is a
   * different training record from 40 performed. */
  function topItems(entries, opts) {
    opts = opts || {};
    var counted = filterEntries(entries, opts);
    var by = {};
    counted.forEach(function (e) {
      var t = titleOf(e); if (!t) return;
      var k = norm(t);
      if (!by[k]) { by[k] = { title: t, n: 0, roles: {}, complications: 0 }; }
      by[k].n++;
      var r = norm(e.role); if (r) by[k].roles[r] = (by[k].roles[r] || 0) + 1;
      if (arr(e.complications).length) by[k].complications++;
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; });
    rows.sort(function (a, b) { return b.n - a.n || a.title.localeCompare(b.title); });
    return (opts.limit && opts.limit > 0) ? rows.slice(0, opts.limit) : rows;
  }

  /* ── complication rate ────────────────────────────────────────────────────────────────────
   * Rule 2 lives here. Returns null when there is nothing to divide by. */
  function complicationRate(entries, opts) {
    opts = opts || {};
    var o = {}; for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.kind = o.kind || "procedure";
    var counted = filterEntries(entries, o);
    var n = counted.length;
    if (!n) return null;
    var withC = counted.filter(function (e) { return arr(e.complications).length > 0; });
    var byType = {};
    withC.forEach(function (e) {
      arr(e.complications).forEach(function (c) {
        var key = norm(c); if (!key) return;
        if (!byType[key]) byType[key] = { complication: str(c), n: 0 };
        byType[key].n++;
      });
    });
    var types = Object.keys(byType).map(function (k) { return byType[k]; })
      .sort(function (a, b) { return b.n - a.n || a.complication.localeCompare(b.complication); });
    // Per procedure, only where that procedure itself has enough cases to mean anything.
    var per = topItems(entries, o).filter(function (r) { return r.complications > 0; })
      .map(function (r) {
        return { title: r.title, n: r.n, withComplication: r.complications,
          pct: r.n >= MIN_RATE_N ? round1(r.complications / r.n * 100) : null, lowN: r.n < MIN_RATE_N };
      });
    return {
      countedStatuses: arr(o.statuses).length ? o.statuses.slice() : (o.countAll ? ["all"] : COUNTED.slice()),
      n: n,
      withComplication: withC.length,
      pct: n >= MIN_RATE_N ? round1(withC.length / n * 100) : null,
      lowN: n < MIN_RATE_N,
      minN: MIN_RATE_N,
      types: types,
      byProcedure: per,
      disclaimer: DISCLAIMER
    };
  }

  /* ── independence, year on year ───────────────────────────────────────────────────────────
   * PGMER-2023 5.2(x) graded responsibility, made countable. For each training year: how the role
   * ladder was distributed, and the two shares a guide asks about — how often the resident did the
   * work at all (supervised or not), and how often they did it independently.
   *
   * The training year comes from `yearOf(entry)` when the caller supplies one (the store knows the
   * programme start date); otherwise entries are grouped by calendar year and `basis` says so, so
   * a chart is never silently mislabelled. */
  function independenceTrend(entries, opts) {
    opts = opts || {};
    var o = {}; for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    if (!o.kind && o.includeClinical !== true) o.kind = "procedure";
    var counted = filterEntries(entries, o).filter(function (e) { return !!norm(e.role); });
    var yearOf = typeof o.yearOf === "function" ? o.yearOf : null;
    var basis = yearOf ? "training_year" : "calendar_year";
    var by = {};
    counted.forEach(function (e) {
      var y = yearOf ? yearOf(e) : isoOf(e).slice(0, 4);
      if (y == null || y === "") return;
      y = String(y);
      if (!by[y]) { by[y] = { year: y, n: 0, roles: {} }; ROLE_ORDER.forEach(function (r) { by[y].roles[r] = 0; }); }
      by[y].n++;
      var r = norm(e.role);
      if (by[y].roles[r] == null) by[y].roles[r] = 0;
      by[y].roles[r]++;
    });
    var years = Object.keys(by).sort().map(function (y) {
      var row = by[y];
      var did = (row.roles.performed_supervised || 0) + (row.roles.performed_independent || 0);
      var ind = row.roles.performed_independent || 0;
      row.performedShare = row.n ? round1(did / row.n * 100) : null;
      row.independentShare = row.n ? round1(ind / row.n * 100) : null;
      row.lowN = row.n < MIN_RATE_N;
      return row;
    });
    var direction = "insufficient_data";
    if (years.length >= 2) {
      var a = years[years.length - 2].independentShare, b = years[years.length - 1].independentShare;
      if (a != null && b != null) direction = (b > a + 2) ? "rising" : (b < a - 2) ? "falling" : "flat";
    }
    return {
      basis: basis,
      countedStatuses: arr(o.statuses).length ? o.statuses.slice() : (o.countAll ? ["all"] : COUNTED.slice()),
      roleOrder: ROLE_ORDER.slice(),
      years: years,
      direction: direction,
      minN: MIN_RATE_N,
      disclaimer: DISCLAIMER
    };
  }

  /* Everything one dashboard needs, in one pass, so a screen does not call five functions with
   * five different filters and print five inconsistent totals. */
  function dashboard(entries, opts) {
    opts = opts || {};
    var cl = caseload(entries, opts);
    return {
      caseload: cl,
      procedures: caseload(entries, mix(opts, { kind: "procedure" })),
      topProcedures: topItems(entries, mix(opts, { kind: "procedure", limit: opts.limit || 8 })),
      topDiagnoses: topItems(entries, mix(opts, { kind: "clinical", limit: opts.limit || 8 })),
      complications: complicationRate(entries, opts),
      independence: independenceTrend(entries, opts),
      unverified: cl.counts.total - cl.counts.verified,
      disclaimer: DISCLAIMER
    };
  }
  function mix(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* ── CSV ──────────────────────────────────────────────────────────────────────────────────
   * The spreadsheet a department actually re-analyses. Excel opens this directly; the BOM is what
   * makes Excel read UTF-8 (without it "Cholecystectomy · Rt" arrives mangled), and it is added by
   * the download helper, not here, so the string stays clean for tests. */
  var CSV_COLUMNS = [
    ["date", function (e) { return isoOf(e); }],
    ["kind", function (e) { return str(e.kind); }],
    ["title", titleOf],
    ["setting", function (e) { return str(e.setting); }],
    ["role", function (e) { return str(e.role); }],
    ["supervisor", function (e) { return str(e.supervisor); }],
    ["rotation", function (e) { return str(e.rotationName || e.rotationId); }],
    ["complications", function (e) { return arr(e.complications).join("; "); }],
    ["status", function (e) { return statusOf(e); }],
    ["verifiedBy", function (e) { return str(e.verifiedByName || e.verifiedBy); }],
    ["verifiedAt", function (e) { return str(e.verifiedAt).slice(0, 10); }],
    ["notes", function (e) { return str(e.notes); }]
  ];
  function csvCell(v) {
    var s = String(v == null ? "" : v);
    // A cell starting with = + - @ is executed as a formula by Excel on open. Prefix it.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(entries, opts) {
    opts = opts || {};
    var rows = arr(entries).filter(function (e) { return inWindow(e, opts.from, opts.to); });
    if (opts.kind) rows = rows.filter(function (e) { return norm(e.kind) === norm(opts.kind); });
    if (arr(opts.statuses).length) rows = keep(rows, opts.statuses);
    rows.sort(function (a, b) { return isoOf(a).localeCompare(isoOf(b)); });
    var cols = CSV_COLUMNS.filter(function (c) { return !(opts.omit && opts.omit.indexOf(c[0]) >= 0); });
    var out = [cols.map(function (c) { return csvCell(c[0]); }).join(",")];
    rows.forEach(function (e) { out.push(cols.map(function (c) { return csvCell(c[1](e)); }).join(",")); });
    return out.join("\r\n");
  }

  var API = {
    caseload: caseload, topItems: topItems, complicationRate: complicationRate,
    independenceTrend: independenceTrend, dashboard: dashboard, toCsv: toCsv,
    tally: tally, filterEntries: filterEntries,
    COUNTED: COUNTED, MIN_RATE_N: MIN_RATE_N, DISCLAIMER: DISCLAIMER,
    ROLE_ORDER: ROLE_ORDER, CSV_COLUMNS: CSV_COLUMNS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_ANALYTICS = API;
})();
