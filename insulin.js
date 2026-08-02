/* insulin.js - Insulin module: routed shell (Dashboard / Calculator / Settings).
 * Wires the pure engine (INSULIN_ENGINE) + safety engine (INSULIN_SAFETY) to a
 * transparent, confirm-gated UI. Overlay module: window.INSULIN = {open, close, isOn}.
 * Settings + dose history persist in localStorage (per-uid). Units (mg/dL <-> mmol/L)
 * are converted at the engine boundary; the engine stays canonical mg/dL.
 * Motion via window.Motion (vendored). Hard-gated on the smd_insulin flag. */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var ROOT_ID = "insulinRoot";

  function flags() { return window.SMD_INSULIN_FLAGS; }
  function on() { var f = flags(); return !!(f && f.bool("smd_insulin")); }
  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  /* ---------- per-user storage ---------- */
  function uid() {
    try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.uid) return SMD_ACCOUNT.uid() || "guest"; } catch (e) {}
    try { if (window.SMD_OWNER_KEY) return SMD_OWNER_KEY() || "guest"; } catch (e) {}
    return "guest";
  }
  function keyFor(base) { return "smd_insulin_" + base + "_" + uid(); }

  var DEFAULTS = { units: "mgdl", increment: 1, target: 120, maxBolus: 15, maxDaily: 100, institution: "" };
  var SET = clone(DEFAULTS);
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadSettings() {
    try { var raw = localStorage.getItem(keyFor("settings")); var s = raw ? JSON.parse(raw) : {}; var out = clone(DEFAULTS);
      for (var k in DEFAULTS) if (s[k] != null) out[k] = s[k]; return out; } catch (e) { return clone(DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(keyFor("settings"), JSON.stringify(SET)); } catch (e) {} }

  function loadLog() { try { return JSON.parse(localStorage.getItem(keyFor("log")) || "[]"); } catch (e) { return []; } }
  function saveLog(list) { try { localStorage.setItem(keyFor("log"), JSON.stringify(list.slice(0, 50))); } catch (e) {} }
  function pushLog(entry) { var l = loadLog(); l.unshift(entry); saveLog(l); }
  function todayTotal() {
    var l = loadLog(), n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate(), sum = 0;
    for (var i = 0; i < l.length; i++) { var e = l[i]; if (!e.ts) continue; var t = new Date(e.ts);
      if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === d) sum += Number(e.confirmedDose) || 0; }
    return sum;
  }

  /* ---------- units (display <-> canonical mg/dL) ---------- */
  function mmolMode() { return SET.units === "mmol"; }
  function gUnit() { return mmolMode() ? "mmol/L" : "mg/dL"; }
  function isfUnit() { return mmolMode() ? "mmol/L/u" : "mg/dL/u"; }
  function toMgdl(v) { return mmolMode() ? v * 18 : v; }          // glucose/target/ISF share the /18 factor
  function gStep() { return mmolMode() ? 0.5 : 5; }
  function targetPresets() { return mmolMode() ? [5, 6, 7, 8] : [100, 120, 140, 180]; }

  /* ---------- state ---------- */
  var st = { screen: "dashboard", mode: "combined",
    glucose: 180, target: 120, carbs: 45, icr: 10, isf: 50, iob: 2, increment: 1,
    ctx: { age: 40, weightKg: 70, pregnancy: false, renal: false, hepatic: false },
    acked: false, confirmed: false,
    libQ: "", libClass: "all", libOpen: null, compare: [] };

  function initState() {
    var m = mmolMode();
    st.mode = st.mode || "combined";
    st.glucose = m ? 10 : 180;
    st.target = SET.target;          // stored in SET.units
    st.carbs = 45; st.icr = 10;
    st.isf = m ? 3 : 50;
    st.iob = 2; st.increment = SET.increment;
    st.ctx = { age: 40, weightKg: 70, pregnancy: false, renal: false, hepatic: false };
    st.acked = false; st.confirmed = false;
  }

  /* ---------- icons ---------- */
  var ICON_AI = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>';
  var ICON_GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var ICON_BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
  var SVG_TRI = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
  var SVG_EXC = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>';
  var SVG_INFO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
  var ICON_BOOK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  var ICON_CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_PILL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg>';
  var ICON_CHEVR = '<svg class="chevr" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  var ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
  function sevIcon(s) { return s === "critical" || s === "warning" ? SVG_TRI : s === "caution" ? SVG_EXC : SVG_INFO; }
  function sevLabel(s) { return s === "critical" ? "Critical" : s === "warning" ? "Warning" : s === "caution" ? "Caution" : "Note"; }
  function modeLabel(m) { return m === "meal" ? "Meal bolus" : m === "correction" ? "Correction" : "Combined meal + correction"; }

  function howItWorks(mode) {
    if (mode === "meal")
      return "This covers the carbohydrates in the meal. It divides the grams of carbohydrate by the " +
        "insulin-to-carbohydrate ratio (ICR), so one unit of insulin is given for every ICR grams. The result is then rounded.";
    if (mode === "correction")
      return "This brings a high glucose down toward target. It takes how far the current glucose is above " +
        "target and divides by the insulin sensitivity factor (ISF), where one unit lowers glucose by ISF. No correction is given at or below target.";
    return "This combines two doses. First it covers the meal: grams of carbohydrate divided by the ICR. Then it " +
      "adds a correction for a high glucose: the amount above target divided by the ISF. It then subtracts any insulin " +
      "still active from earlier doses (IOB) so a dose is not stacked, floors the total at zero, and rounds.";
  }

  /* ---------- Motion ---------- */
  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script"); s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() { if (window.Motion && window.Motion.animate) return cb(window.Motion); if (tries++ > 60) return; setTimeout(wait, 40); })();
  }
  function springIn(el) {
    if (!el || reduced()) return;
    withMotion(function (M) { try { M.animate(el, { opacity: [0, 1], scale: [0.985, 1], y: [8, 0] },
      { duration: 0.42, easing: [0.2, 0.7, 0.2, 1] }); } catch (e) {} });
  }
  function countUp(el, to) {
    var target = Number(to) || 0;
    if (reduced()) { el.textContent = fmt(target); return; }
    var start = 0, t0 = null, dur = 460;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), eased = 1 - Math.pow(1 - p, 3), cur = start + (target - start) * eased;
      el.textContent = fmt(st.increment === 0.5 ? Math.round(cur * 2) / 2 : Math.round(cur));
      if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
    }
    requestAnimationFrame(frame);
  }
  function fmt(n) { return (Math.round(Number(n) * 10) / 10).toString(); }

  /* ---------- shell + router ---------- */
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Insulin dose calculator");
    el.innerHTML = '<div class="ins-gridbg"></div><div class="ins-scroll"><div class="ins-wrap">' +
      '<div id="insHeader"></div><div id="insScreen"></div></div></div>';
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    return el;
  }
  function paint() {
    document.getElementById("insHeader").innerHTML = headerHTML();
    var s = document.getElementById("insScreen");
    if (st.screen === "dashboard") { s.innerHTML = dashboardHTML(); }
    else if (st.screen === "settings") { s.innerHTML = settingsHTML(); }
    else if (st.screen === "library") { s.innerHTML = libraryHTML(); renderLibList(); }
    else if (st.screen === "compare") { s.innerHTML = compareHTML(); }
    else { s.innerHTML = calcHTML(); renderInputs(); render(); }
  }
  function go(screen) { st.screen = screen; paint(); springIn(document.getElementById("insScreen")); }

  function headerHTML() {
    if (st.screen === "dashboard") {
      return '<div class="ins-head ins-bf"><div class="ins-badge">Iu</div>' +
        '<div><div class="ins-title">Insulin</div><div class="ins-sub">Clinical decision support</div></div>' +
        '<button class="ins-hbtn" data-ins="go-settings" aria-label="Settings">' + ICON_GEAR + '</button>' +
        '<button class="ins-hbtn" data-ins="close" aria-label="Close">&times;</button></div>';
    }
    var title, sub, back = "go-dash";
    if (st.screen === "settings") { title = "Settings"; sub = "Preferences and safety limits"; }
    else if (st.screen === "library") { title = "Insulin library"; sub = "Reference and comparison"; }
    else if (st.screen === "compare") { title = "Compare insulins"; sub = st.compare.length + " selected"; back = "go-library"; }
    else { title = "Insulin dose"; sub = modeLabel(st.mode); }
    return '<div class="ins-head ins-bf"><button class="ins-hbtn" data-ins="' + back + '" aria-label="Back">' + ICON_BACK + '</button>' +
      '<div><div class="ins-title">' + title + '</div><div class="ins-sub">' + sub + '</div></div>' +
      '<button class="ins-hbtn" data-ins="close" aria-label="Close">&times;</button></div>';
  }

  /* ---------- Dashboard ---------- */
  function dashboardHTML() {
    var res = compute(), warns = safety(res);
    var crit = 0, i;
    for (i = 0; i < warns.length; i++) if (warns[i].severity === "critical") crit++;
    var snap, snapCls;
    if (crit) { snapCls = "critical"; snap = crit + " critical safety item" + (crit > 1 ? "s" : "") + " on the current inputs."; }
    else if (warns.length) { snapCls = "caution"; snap = warns.length + " advisory check" + (warns.length > 1 ? "s" : "") + " to review."; }
    else { snapCls = "ok"; snap = "No safety flags on the current inputs."; }

    var log = loadLog(), recent = "";
    if (log.length) {
      recent = log.slice(0, 4).map(function (e) {
        return '<div class="ins-rec-row"><div class="ins-rec-dose">' + e.confirmedDose + '<span>u</span></div>' +
          '<div class="ins-rec-meta"><div class="ins-rec-mode">' + modeLabel(e.mode) + '</div>' +
          '<div class="ins-rec-time">' + timeStr(e.ts) + (e.warnings && e.warnings.length ? ' &middot; ' + e.warnings.length + ' flag' + (e.warnings.length > 1 ? 's' : '') : '') + '</div></div></div>';
      }).join("");
    } else {
      recent = '<div class="ins-empty">No doses recorded yet. Accept a recommendation to start the audit log.</div>';
    }

    return '<div class="ins-stats ins-bf">' +
        statTile("Current glucose", fmt(st.glucose), gUnit()) +
        statTile("Target", fmt(st.target), gUnit()) +
        statTile("Active insulin", fmt(st.iob), "units") +
      '</div>' +
      '<div class="ins-snap ' + snapCls + ' ins-bf"><span class="ins-snap-dot"></span><span>' + snap + '</span></div>' +
      '<div class="ins-card ins-bf"><div class="ins-card-t">Quick actions</div><div class="ins-qa">' +
        qa("combined", "Combined dose") + qa("meal", "Meal bolus") + qa("correction", "Correction") +
      '</div></div>' +
      libEntryHTML() +
      '<div class="ins-card ins-bf"><div class="ins-card-t">Recent doses</div>' + recent + '</div>';
  }
  function libEntryHTML() {
    var db = window.INSULIN_DB;
    if (!db) return "";
    return '<button class="ins-lib-entry ins-bf" data-ins="go-library">' +
      '<span class="ins-lib-ic">' + ICON_PILL + '</span>' +
      '<span class="ins-lib-tx"><span class="ins-lib-t">Insulin library</span>' +
      '<span class="ins-lib-s">' + db.list().length + ' insulins across ' + db.CLASSES.length + ' classes - search and compare</span></span>' +
      ICON_CHEVR + '</button>';
  }
  function statTile(label, val, unit) {
    return '<div class="ins-stat"><div class="ins-stat-l">' + label + '</div>' +
      '<div class="ins-stat-v">' + val + '<span>' + unit + '</span></div></div>';
  }
  function qa(mode, label) { return '<button class="ins-qa-btn" data-ins="qa" data-mode="' + mode + '">' + label + '</button>'; }
  function timeStr(ts) { try { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }

  /* ---------- Settings ---------- */
  function settingsHTML() {
    return '<div class="ins-card ins-bf"><div class="ins-card-t">Units and rounding</div>' +
        '<div class="ins-field"><div class="ins-lab">Glucose units</div>' +
          '<div class="ins-static">mg/dL - India standard (fixed)</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Dose rounding</div><div class="ins-round">' +
          '<button data-ins="round" data-v="1" aria-pressed="' + (SET.increment === 1 ? "true" : "false") + '">1 unit</button>' +
          '<button data-ins="round" data-v="0.5" aria-pressed="' + (SET.increment === 0.5 ? "true" : "false") + '">0.5 unit</button>' +
        '</div></div>' +
      '</div>' +
      '<div class="ins-card ins-bf"><div class="ins-card-t">Defaults and safety limits</div>' +
        '<div class="ins-grid2">' +
          setNum("target", "Default target " + gUnit(), SET.target) +
          setNum("maxBolus", "Max single bolus (u)", SET.maxBolus) +
          setNum("maxDaily", "Max daily dose (u)", SET.maxDaily) +
        '</div>' +
        '<div class="ins-field" style="margin-top:12px"><div class="ins-lab">Institution label</div>' +
          '<input class="ins-set-text" data-ins="set-text" data-k="institution" type="text" placeholder="e.g. ICU protocol v2" value="' + (SET.institution || "") + '"></div>' +
      '</div>' +
      '<div class="ins-tgt-note ins-bf">Settings are stored on this device and applied to new calculations. Max limits drive the critical safety interrupts.</div>';
  }
  function setNum(k, label, val) {
    return '<div class="ins-mini"><label>' + label + '</label>' +
      '<input data-ins="set-num" data-k="' + k + '" type="number" inputmode="decimal" value="' + val + '"></div>';
  }

  /* ---------- Insulin library ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function libraryHTML() {
    var db = window.INSULIN_DB;
    if (!db) return '<div class="ins-empty">Insulin database not loaded.</div>';
    var chips = '<button class="ins-chip" data-ins="lib-class" data-c="all" aria-pressed="' + (st.libClass === "all" ? "true" : "false") + '">All</button>';
    db.CLASSES.forEach(function (c) {
      chips += '<button class="ins-chip" data-ins="lib-class" data-c="' + c + '" aria-pressed="' + (st.libClass === c ? "true" : "false") + '">' + c + '</button>';
    });
    return '<div class="ins-search ins-bf">' + ICON_SEARCH +
        '<input id="insLibQ" data-ins="lib-q" type="search" placeholder="Search generic, brand, maker, U-100, India" value="' + esc(st.libQ) + '" aria-label="Search insulins"></div>' +
      '<div class="ins-chips ins-libchips ins-bf">' + chips + '</div>' +
      '<div id="insCmpBar"></div><div id="insLibList"></div>';
  }

  function renderLibList() {
    var db = window.INSULIN_DB, list = document.getElementById("insLibList");
    if (!db || !list) return;
    var res = db.search(st.libQ);
    if (st.libClass !== "all") res = res.filter(function (d) { return d.cls === st.libClass; });
    var bar = document.getElementById("insCmpBar");
    if (bar) bar.innerHTML = st.compare.length ?
      '<div class="ins-cmpbar"><span>' + st.compare.length + ' selected</span><span class="ins-cmpbar-b">' +
      '<button class="ins-cmpbar-clear" data-ins="cmp-clear">Clear</button>' +
      '<button class="ins-cmpbar-go" data-ins="go-compare"' + (st.compare.length < 2 ? " disabled" : "") + '>Compare</button></span></div>' : "";
    if (!res.length) { list.innerHTML = '<div class="ins-empty">No insulins match. Try a generic, brand, maker, concentration (U-100), country, or class.</div>'; return; }
    var html = "", i, j;
    for (i = 0; i < db.CLASSES.length; i++) {
      var cls = db.CLASSES[i], group = res.filter(function (d) { return d.cls === cls; });
      if (!group.length) continue;
      html += '<div class="ins-il-cls">' + cls + ' <span>' + group.length + '</span></div>';
      for (j = 0; j < group.length; j++) html += cardHTML(group[j]);
    }
    list.innerHTML = html;
  }

  function cardHTML(d) {
    var db = window.INSULIN_DB, open = st.libOpen === d.id, checked = st.compare.indexOf(d.id) > -1;
    var brands = d.brands.map(function (b) { return b.name; }).join(", ");
    var pk = '<span>Onset<b>' + d.onset + '</b></span><span>Peak<b>' + d.peak + '</b></span><span>Duration<b>' + d.duration + '</b></span>';
    var detail = "";
    if (open) {
      detail = '<div class="ins-il-detail">' + dlrow("Timing", d.timing) + dlrow("Route", d.route) + dlrow("Devices", d.devices) +
        dlrow("Pregnancy", d.pregnancy) + dlrow("Paediatric", d.pediatric) + dlrow("Renal", d.renal) + dlrow("Hepatic", d.hepatic) +
        dlrow("Storage", d.storage) + dlrow("Notes", d.notes) +
        dlrow("Brands", d.brands.map(function (b) { return b.name + " (" + b.mfr + ")"; }).join("; ")) +
        dlrow("Availability", db.brandCountries(d).map(function (c) { return db.COUNTRIES[c] || c; }).join(", ")) + '</div>';
    }
    return '<div class="ins-il-card' + (open ? " open" : "") + '">' +
      '<button class="ins-il-head" data-ins="lib-open" data-id="' + d.id + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        '<span class="ins-il-name">' + d.generic + '<span class="ins-il-sub">' + d.strengths.join(", ") + '  ·  ' + brands + '</span></span>' + ICON_CHEV + '</button>' +
      '<div class="ins-il-pk">' + pk + '</div>' +
      '<label class="ins-il-cmp"><input type="checkbox" data-ins="cmp" data-id="' + d.id + '"' + (checked ? " checked" : "") + '> Add to compare</label>' +
      detail + '</div>';
  }
  function dlrow(k, v) { return '<div class="ins-dl"><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }

  function compareHTML() {
    var db = window.INSULIN_DB;
    var items = st.compare.map(function (id) { return db.get(id); }).filter(Boolean);
    if (items.length < 2) return '<div class="ins-empty">Select at least two insulins in the library to compare.</div>';
    var rows = [["Class", "cls"], ["Strength", function (d) { return d.strengths.join(", "); }],
      ["Onset", "onset"], ["Peak", "peak"], ["Duration", "duration"], ["Typical timing", "timing"],
      ["Devices", "devices"], ["Availability", function (d) { return db.brandCountries(d).join(", "); }]];
    var cells = '<div class="ins-cmp-h ins-cmp-corner"></div>';
    items.forEach(function (d) { cells += '<div class="ins-cmp-h">' + d.generic + '</div>'; });
    rows.forEach(function (r) {
      cells += '<div class="ins-cmp-k">' + r[0] + '</div>';
      items.forEach(function (d) { var v = typeof r[1] === "function" ? r[1](d) : d[r[1]]; cells += '<div class="ins-cmp-v">' + v + '</div>'; });
    });
    var cols = "grid-template-columns:94px repeat(" + items.length + ",minmax(120px,1fr));";
    return '<div class="ins-cmp-note ins-bf">Side-by-side reference. Onset, peak and duration are approximate label ranges - verify against local product information.</div>' +
      '<div class="ins-cmp-scroll ins-bf"><div class="ins-cmp" style="' + cols + '">' + cells + '</div></div>';
  }
  function pressLibClass() { var b = document.querySelectorAll('[data-ins="lib-class"]'); for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", b[i].getAttribute("data-c") === st.libClass); }

  /* ---------- Calculator ---------- */
  function calcHTML() {
    return '<div class="ins-ai ins-bf">' + ICON_AI +
        '<div><b>AI-assisted recommendation.</b> The treating physician makes the final decision. ' +
        'Every value below is shown with its formula and assumptions - nothing is hidden.</div></div>' +
      '<div class="ins-seg ins-bf" role="tablist">' + seg("combined", "Combined") + seg("meal", "Meal bolus") + seg("correction", "Correction") + '</div>' +
      '<div class="ins-card ins-bf" id="insInputs"></div>' +
      '<div id="insOut"></div>';
  }
  function seg(mode, label) {
    return '<button role="tab" data-ins="mode" data-mode="' + mode + '" aria-pressed="' + (st.mode === mode ? "true" : "false") + '">' + label + '</button>';
  }
  function stepper(id, val, stepv) {
    return '<div class="ins-step">' +
      '<button data-ins="dec" data-f="' + id + '" data-s="' + stepv + '" aria-label="decrease">-</button>' +
      '<input data-ins="num" data-f="' + id + '" type="number" inputmode="decimal" value="' + val + '">' +
      '<button data-ins="inc" data-f="' + id + '" data-s="' + stepv + '" aria-label="increase">+</button></div>';
  }
  function mini(id, label, val) {
    return '<div class="ins-mini"><label>' + label + '</label>' +
      '<input data-ins="num" data-f="' + id + '" type="number" inputmode="decimal" value="' + val + '"></div>';
  }
  function ctxChip(key, label) { return '<button class="ins-chip" data-ins="ctx" data-k="' + key + '" aria-pressed="' + (st.ctx[key] ? "true" : "false") + '">' + label + '</button>'; }
  function tgtChip(v) { return '<button class="ins-chip" data-ins="target-chip" data-v="' + v + '" aria-pressed="' + (st.target === v ? "true" : "false") + '">' + v + '</button>'; }

  function renderInputs() {
    var m = st.mode, h = "", presets = targetPresets(), i;
    if (m !== "meal") {
      h += '<div class="ins-field"><div class="ins-lab">Current glucose <span class="u">' + gUnit() + '</span></div>' + stepper("glucose", st.glucose, gStep()) + '</div>';
      var chips = "";
      for (i = 0; i < presets.length; i++) chips += tgtChip(presets[i]);
      h += '<div class="ins-field"><div class="ins-lab">Target glucose <span class="u">' + gUnit() + '</span></div>' +
        '<div class="ins-tgt"><input class="ins-tgt-in" data-ins="num" data-f="target" type="number" inputmode="decimal" min="1" value="' + st.target + '" aria-label="Target glucose">' +
        '<div class="ins-chips">' + chips + '</div></div>' +
        '<div class="ins-tgt-note">Type any target - set a higher interim target for gradual correction of a very high glucose.</div></div>';
    }
    if (m !== "correction") {
      h += '<div class="ins-field"><div class="ins-lab">Carbohydrates <span class="u">g</span></div>' + stepper("carbs", st.carbs, 5) + '</div>';
    }
    h += '<div class="ins-field"><div class="ins-grid2">';
    if (m !== "meal") { h += mini("isf", "ISF " + isfUnit(), st.isf); }
    if (m !== "correction") { h += mini("icr", "ICR g/u", st.icr); }
    if (m === "combined") { h += mini("iob", "Active insulin (IOB) u", st.iob); }
    h += '</div></div>';
    h += '<div class="ins-field"><div class="ins-lab">Rounding</div><div class="ins-round">' +
      '<button data-ins="round" data-v="1" aria-pressed="' + (st.increment === 1 ? "true" : "false") + '">1 unit</button>' +
      '<button data-ins="round" data-v="0.5" aria-pressed="' + (st.increment === 0.5 ? "true" : "false") + '">0.5 unit</button></div></div>';
    h += '<div class="ins-field"><div class="ins-lab">Patient context</div><div class="ins-chips">' +
      ctxChip("pregnancy", "Pregnancy") + ctxChip("renal", "Renal") + ctxChip("hepatic", "Hepatic") +
      '<button class="ins-chip" data-ins="peds" aria-pressed="' + (st.ctx.age < 18 ? "true" : "false") + '">Pediatric</button></div></div>';
    document.getElementById("insInputs").innerHTML = h;
  }

  function compute() {
    var E = window.INSULIN_ENGINE, G = toMgdl(st.glucose), T = toMgdl(st.target), ISF = toMgdl(st.isf);
    if (st.mode === "meal") return E.mealBolus({ carbs: st.carbs, icr: st.icr, increment: st.increment });
    if (st.mode === "correction") return E.correctionDose({ glucose: G, target: T, isf: ISF, increment: st.increment });
    return E.combinedDose({ carbs: st.carbs, icr: st.icr, glucose: G, target: T, isf: ISF, iob: st.iob, increment: st.increment });
  }
  function safety(res) {
    var S = window.INSULIN_SAFETY;
    var input = { glucose: toMgdl(st.glucose), target: toMgdl(st.target), iob: st.mode === "combined" ? st.iob : 0 };
    var ctx = { age: st.ctx.age, weightKg: st.ctx.weightKg, pregnancy: st.ctx.pregnancy, renal: st.ctx.renal, hepatic: st.ctx.hepatic,
      maxBolus: SET.maxBolus, maxDaily: SET.maxDaily };
    if (res && res.rounded != null) res.dailyTotal = todayTotal() + res.rounded;
    return S.evaluate(ctx, input, res);
  }

  function render() {
    st.acked = false; st.confirmed = false;
    var res = compute(), warns = safety(res), hasCritical = false, i;
    for (i = 0; i < warns.length; i++) if (warns[i].interrupt) hasCritical = true;
    var out = document.getElementById("insOut");
    if (!out) return;

    if (res.error || res.rounded == null) {
      out.innerHTML = '<div class="ins-card ins-result"><div class="ins-card-t">Recommendation</div>' +
        '<p style="color:var(--ins-muted);font-size:13px;margin:0">' + res.error + '</p></div>';
      return;
    }

    var stepsHTML = res.steps.map(function (s) {
      return '<li><span class="k">' + s.label + '<br><span class="e">' + s.expr + '</span></span><span class="v">' + s.value + '</span></li>';
    }).join("");
    var assumeHTML = (res.assumptions || []).concat(res.clinicalNotes || []).map(function (a) { return '<li>' + a + '</li>'; }).join("");
    var refsHTML = (res.refs || []).map(function (r) { return '<li>' + r + '</li>'; }).join("");
    var warnHTML = warns.map(function (w) {
      return '<div class="ins-warn ' + w.severity + '"><span class="ins-warn-band">' + sevIcon(w.severity) + '</span>' +
        '<div class="ins-warn-body"><span class="ins-warn-sig">' + sevLabel(w.severity) + '</span>' +
        '<span class="wt">' + w.title + '</span><span class="bd">' + w.detail + '</span></div></div>';
    }).join("");

    var extraRaw = st.mode === "combined" ? 'meal ' + res.mealComponent + 'u + correction ' + res.correctionComponent + 'u - IOB ' + res.iobSubtracted + 'u' : "";
    var unitNote = mmolMode() ? ' &middot; working shown in mg/dL (canonical); entries converted from mmol/L' : '';

    out.innerHTML =
      '<div class="ins-card ins-result ins-bf"><div class="ins-card-t">Recommended dose</div>' +
        '<div class="ins-dose"><span class="n" id="insDoseN">0</span><span class="unit">' + res.unit + '</span></div>' +
        '<div class="ins-fromraw">Computed ' + res.result + ' ' + res.unit + ', rounded to ' + st.increment + ' unit' + (extraRaw ? ' &middot; ' + extraRaw : '') + unitNote + '</div>' +
        '<div class="ins-formula">' + res.formula + '</div>' +
        '<ul class="ins-steps">' + stepsHTML + '</ul>' +
        '<button class="ins-how" data-ins="how" aria-expanded="false">' + ICON_BOOK + '<span>How it works</span>' + ICON_CHEV + '</button>' +
        '<div class="ins-howp" hidden>' +
          '<div class="ins-howp-sec"><h4>Method</h4><p>' + howItWorks(st.mode) + '</p></div>' +
          '<div class="ins-howp-sec"><h4>Formula</h4><code>' + res.formula + '</code></div>' +
          (assumeHTML ? '<div class="ins-howp-sec"><h4>What the numbers mean</h4><ul>' + assumeHTML + '</ul></div>' : '') +
          (refsHTML ? '<div class="ins-howp-sec ins-howp-src"><h4>Trusted medical source</h4><ul>' + refsHTML + '</ul></div>' : '') +
        '</div>' +
      '</div>' +
      (warnHTML ? '<div class="ins-card ins-warns ins-bf"><div class="ins-card-t">Safety checks</div>' + warnHTML +
        (hasCritical ? '<label class="ins-ack"><input type="checkbox" data-ins="ack"> I have reviewed the critical warning above and take clinical responsibility.</label>' : '') + '</div>' : '') +
      '<button class="ins-cta" data-ins="confirm"' + (hasCritical ? ' disabled' : '') + '>Accept ' + res.rounded + ' ' + res.unit + ' recommendation</button>' +
      '<div class="ins-done" id="insDone" style="display:none">Recorded to dose history. The order remains the physician\'s to place.</div>';

    var dn = document.getElementById("insDoseN"); if (dn) countUp(dn, res.rounded);
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "close") return close();
    if (a === "go-settings") return go("settings");
    if (a === "go-dash") return go("dashboard");
    if (a === "go-library") return go("library");
    if (a === "go-compare") { if (st.compare.length >= 2) go("compare"); return; }
    if (a === "cmp-clear") { st.compare = []; renderLibList(); return; }
    if (a === "lib-class") { st.libClass = t.getAttribute("data-c"); pressLibClass(); renderLibList(); return; }
    if (a === "lib-open") { var lid = t.getAttribute("data-id"); st.libOpen = st.libOpen === lid ? null : lid; renderLibList(); return; }
    if (a === "qa") { st.mode = t.getAttribute("data-mode"); go("calc"); return; }
    if (a === "mode") { st.mode = t.getAttribute("data-mode"); syncSeg(); renderInputs(); render(); return; }
    if (a === "inc" || a === "dec") {
      var f = t.getAttribute("data-f"), s = parseFloat(t.getAttribute("data-s"));
      st[f] = Math.max(0, Math.round(((Number(st[f]) || 0) + (a === "inc" ? s : -s)) * 100) / 100);
      var inp = t.parentNode.querySelector('input[data-f="' + f + '"]'); if (inp) inp.value = st[f];
      render(); return;
    }
    if (a === "round") { st.increment = parseFloat(t.getAttribute("data-v")); SET.increment = st.increment; saveSettings(); pressGroup("round"); if (st.screen === "calc") render(); return; }
    if (a === "target-chip") { st.target = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "ctx") { var k = t.getAttribute("data-k"); st.ctx[k] = !st.ctx[k]; t.setAttribute("aria-pressed", st.ctx[k]); render(); return; }
    if (a === "peds") { st.ctx.age = st.ctx.age < 18 ? 40 : 8; t.setAttribute("aria-pressed", st.ctx.age < 18); render(); return; }
    if (a === "how") {
      var exp = t.getAttribute("aria-expanded") === "true", panel = t.nextElementSibling;
      t.setAttribute("aria-expanded", exp ? "false" : "true");
      if (exp) { if (panel) panel.hidden = true; }
      else if (panel) { panel.hidden = false; if (!reduced()) withMotion(function (M) { try { M.animate(panel, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.28, easing: [0.2, 0.7, 0.2, 1] }); } catch (e) {} }); }
      return;
    }
    if (a === "confirm") return confirmDose(t);
  }
  function onInput(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "num") { var f = t.getAttribute("data-f"); st[f] = parseFloat(t.value); if (f === "target") syncTargetChips(); render(); return; }
    if (a === "set-num") { var k = t.getAttribute("data-k"); var v = parseFloat(t.value); if (isFinite(v)) { SET[k] = v; saveSettings(); } return; }
    if (a === "set-text") { SET[t.getAttribute("data-k")] = t.value; saveSettings(); return; }
    if (a === "lib-q") { st.libQ = t.value; renderLibList(); return; }
    if (a === "cmp") {
      var cid = t.getAttribute("data-id"), idx = st.compare.indexOf(cid);
      if (t.checked) { if (idx === -1) { if (st.compare.length >= 3) { t.checked = false; return; } st.compare.push(cid); } }
      else if (idx > -1) st.compare.splice(idx, 1);
      renderLibList(); return;
    }
    if (a === "ack") { st.acked = t.checked; var cta = document.querySelector(".ins-cta"); if (cta) cta.disabled = !st.acked; }
  }
  function syncSeg() {
    var b = document.querySelectorAll('[data-ins="mode"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", b[i].getAttribute("data-mode") === st.mode);
  }
  function pressGroup(name) {
    var b = document.querySelectorAll('[data-ins="' + name + '"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", parseFloat(b[i].getAttribute("data-v")) === st.increment);
  }
  function syncTargetChips() {
    var b = document.querySelectorAll('[data-ins="target-chip"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", parseFloat(b[i].getAttribute("data-v")) === st.target);
  }
  function confirmDose(btn) {
    if (btn.disabled) return;
    var res = compute(), warns = safety(res);
    pushLog({ mode: st.mode, inputs: snapshot(), calculatedDose: res.rounded, confirmedDose: res.rounded,
      unit: res.unit, warnings: warns.map(function (w) { return w.id; }), engineVersion: 1, ts: Date.now() });
    btn.style.display = "none";
    var d = document.getElementById("insDone"); if (d) { d.style.display = "block"; springIn(d); }
  }
  function snapshot() {
    return { units: SET.units, glucose: st.glucose, target: st.target, carbs: st.carbs, icr: st.icr,
      isf: st.isf, iob: st.iob, increment: st.increment, ctx: clone(st.ctx) };
  }

  /* ---------- open / close ---------- */
  function open() {
    if (!on()) return;
    if (!window.INSULIN_ENGINE || !window.INSULIN_SAFETY) return;
    SET = loadSettings();
    SET.units = "mgdl"; saveSettings();   // mg/dL only (India standard); no other units
    initState();
    var el = root();
    el.classList.add("ins-open");
    document.documentElement.classList.add("ins-lock");
    document.body.classList.add("ins-lock");
    st.screen = "dashboard";
    paint();
    springIn(el.querySelector(".ins-wrap"));
  }
  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("ins-open");
    document.documentElement.classList.remove("ins-lock");
    document.body.classList.remove("ins-lock");
  }

  window.INSULIN = { open: open, close: close, isOn: on };
})();
