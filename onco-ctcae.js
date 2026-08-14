/* onco-ctcae.js — CTCAE adverse-event grading engine + overlay (window.SMD_ONCOCTCAE). Phase 8 P2.
 * Buildless ES5 IIFE. Flag: smd_onco_ctcae (queue-flags.js), default OFF.
 *
 * THE DELIVERABLE IS THE ENGINE + a fail-closed fabrication auditor, not blanket coverage. CTCAE is
 * NCI public-domain, so REAL grade definitions are seeded — but ACCURACY over coverage:
 *   - A curated set of the most common chemo/IO-relevant adverse events is seeded in
 *     kb/onco/ctcae/catalog.json, each grade quoted from NCI CTCAE v5.0, every AE flagged
 *     requiresR1Verification and cited to "NCI CTCAE v5.0".
 *   - A grade CTCAE does not define at a level is null in the data and rendered as an honest
 *     "not defined at this grade" — never an invented cut-off.
 *   - Any AE not in the catalog is an explicit gap: "consult the full NCI CTCAE v5.0".
 *   - A version toggle exposes CTCAE v4.03, which is intentionally NOT seeded (an honest gap) — the
 *     v4.03 grade deltas are not guessed.
 * FAIL CLOSED: resolve() returns a marked gap for an un-seeded version; auditAE()/auditFabricationSafe()
 * withhold any AE whose grade is present-but-empty or that is unflagged/uncited, and the renderer shows
 * the honest withheld message instead of the content. Pure resolver + auditor are exported for
 * node --test; the browser half fetches the JSON and renders an overlay reusing onco-home.css. No
 * writes, no network beyond the local kb JSON, no LLM. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var GAP_MESSAGE = "Consult the full NCI CTCAE v5.0. This adverse event (or grade) is not seeded in StewardMD.";
  var GRADES = ["1", "2", "3", "4", "5"];
  var SOURCE_RE = /CTCAE v5\.0/i;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ===================== PURE ENGINE (testable in Node, no DOM/fetch) ===================== */

  function resolveVersion(catalog, versionName) {
    if (!catalog || !(catalog.versions instanceof Array)) return null;
    if (versionName == null) return catalog.versions[0] || null;
    for (var i = 0; i < catalog.versions.length; i++) {
      if (catalog.versions[i] && catalog.versions[i].version === versionName) return catalog.versions[i];
    }
    return null;
  }

  // resolve(catalog, versionName) -> { status:"seeded", version } | { status:"gap", message }.
  // A gap for: unknown catalog, unknown version, or a version explicitly not seeded (e.g. v4.03).
  function resolve(catalog, versionName) {
    var v = resolveVersion(catalog, versionName);
    if (!v || !v.seeded) return { status: "gap", message: (catalog && catalog.gapMessage) || GAP_MESSAGE };
    return { status: "seeded", version: v };
  }

  function findAE(catalog, aeId) {
    if (!catalog || !(catalog.aes instanceof Array)) return null;
    for (var i = 0; i < catalog.aes.length; i++) if (catalog.aes[i] && catalog.aes[i].id === aeId) return catalog.aes[i];
    return null;
  }

  // auditAE(ae): one adverse event. Every seeded AE must be flagged requiresR1Verification===true, cite
  // a CTCAE v5.0 source, and provide EVERY grade 1-5 as either null (honestly not defined) or a
  // NON-EMPTY string. A missing grade key or an empty/whitespace string is treated as fabricated/missing
  // content and fails closed. Returns { ok, problems[] }.
  function auditAE(ae) {
    var problems = [];
    if (!ae || !ae.id) return { ok: false, problems: ["AE missing id"] };
    if (ae.requiresR1Verification !== true) problems.push(ae.id + ": not flagged requiresR1Verification");
    if (!ae.source || !SOURCE_RE.test(ae.source)) problems.push(ae.id + ": source must cite CTCAE v5.0");
    if (!ae.name) problems.push(ae.id + ": missing name");
    var g = ae.grades || null;
    if (!g || typeof g !== "object") { problems.push(ae.id + ": missing grades"); return { ok: false, problems: problems }; }
    for (var i = 0; i < GRADES.length; i++) {
      var k = GRADES[i];
      if (!Object.prototype.hasOwnProperty.call(g, k)) { problems.push(ae.id + ": grade " + k + " key missing"); continue; }
      var val = g[k];
      if (val === null) continue;                             // honest "not defined at this grade"
      if (typeof val !== "string" || !val.trim()) problems.push(ae.id + ": grade " + k + " is present but empty (withheld)");
    }
    return { ok: problems.length === 0, problems: problems };
  }

  // auditFabricationSafe(catalog): the whole seeded catalog. Every AE must pass auditAE; the seeded
  // version must itself be R1-flagged. Any problem => the catalog is not safe to render as-is.
  function auditFabricationSafe(catalog) {
    var problems = [];
    if (!catalog || !(catalog.aes instanceof Array)) return { ok: false, problems: ["no aes array"] };
    var seeded = null;
    (catalog.versions || []).forEach(function (v) {
      if (v && v.seeded) { seeded = v; if (v.requiresR1Verification !== true) problems.push(v.version + ": seeded version not flagged requiresR1Verification"); if (!v.provenance) problems.push(v.version + ": seeded version missing provenance"); }
    });
    if (!seeded) problems.push("no seeded version");
    catalog.aes.forEach(function (ae) {
      var r = auditAE(ae);
      if (!r.ok) problems = problems.concat(r.problems);
    });
    return { ok: problems.length === 0, problems: problems };
  }

  /* ===================== BROWSER: fetch + overlay ===================== */

  var cx = { catalog: null, gapMessage: GAP_MESSAGE, version: null, ae: null, loaded: false };

  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_ctcae")); } catch (e) { return false; } }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }
  function ev(entries) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build(entries) : ""; } catch (e) { return ""; } }

  function loadCatalog() {
    if (cx.loaded || !G.fetch) return Promise.resolve(cx.catalog);
    return G.fetch("/kb/onco/ctcae/catalog.json").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) {
        if (j) { cx.catalog = j; cx.gapMessage = j.gapMessage || GAP_MESSAGE; cx.loaded = true; if (!cx.version && j.versions && j.versions[0]) cx.version = j.versions[0].version; }
        return cx.catalog;
      }).catch(function () { return cx.catalog; });
  }

  function rootEl() { var el = document.getElementById("smdOncoCtcae"); if (!el) { el = document.createElement("div"); el.id = "smdOncoCtcae"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }
  function r1Flag() { return '<span class="stg-r1">Requires R1 verification</span>'; }

  function versionToggleHtml(catalog) {
    if (!catalog || !(catalog.versions instanceof Array)) return "";
    return '<div class="stg-vtoggle">' + catalog.versions.map(function (v) {
      var on = v.version === cx.version ? " on" : "";
      return '<button class="stg-vbtn' + on + '" data-ctc-act="ver:' + esc(v.version) + '">' + esc(v.version) + (v.seeded ? "" : " (gap)") + "</button>";
    }).join("") + "</div>";
  }

  function aeListHtml() {
    var catalog = cx.catalog;
    var res = resolve(catalog, cx.version);
    var head = '<div class="stg-intro">CTCAE adverse-event grading. Seeded grades are quoted from NCI CTCAE v5.0 and flagged for R1 verification. Only a curated set of common adverse events is included; anything not listed is an honest gap (consult the full NCI CTCAE). Grades CTCAE does not define are shown as "not defined at this grade", never invented.</div>' +
      versionToggleHtml(catalog);
    if (res.status !== "seeded") return head + gapHtml(res.message);
    // group by category
    var cats = {}, order = [];
    (catalog.aes || []).forEach(function (a) { var c = a.category || "Other"; if (!cats[c]) { cats[c] = []; order.push(c); } cats[c].push(a); });
    var body = order.map(function (c) {
      var rows = cats[c].map(function (a) {
        return '<button class="oh-row" data-ctc-act="ae:' + esc(a.id) + '"><span class="oh-row-t">' + esc(a.name) + '</span><span class="oh-row-s">' + esc(a.category || "") + "</span></button>";
      }).join("");
      return '<div class="oh-sec"><div class="oh-sec-h">' + esc(c) + "</div>" + rows + "</div>";
    }).join("");
    return head + '<div class="ctc-note">Curated CTCAE v5.0 subset (' + (catalog.aes || []).length + ' adverse events). Everything else: consult the full NCI CTCAE v5.0.</div>' + body;
  }

  function gradeRowHtml(n, text) {
    var body = (text === null || text === undefined) ? '<span class="ctc-nd">Not defined at this grade in CTCAE v5.0</span>' : esc(text);
    return '<div class="ctc-grow"><span class="ctc-gnum">Grade ' + esc(n) + '</span><span class="ctc-gtext">' + body + "</span></div>";
  }

  function aeDetailHtml() {
    var catalog = cx.catalog;
    var res = resolve(catalog, cx.version);
    var back = '<button class="oh-back-inline" data-ctc-act="list">&lsaquo; All adverse events</button>';
    if (res.status !== "seeded") return back + gapHtml(res.message);
    var ae = findAE(catalog, cx.ae);
    if (!ae) return back + gapHtml(cx.gapMessage);
    var audit = auditAE(ae);
    if (!audit.ok) return back + '<div class="stg-gap"><div class="stg-gap-h">Content withheld</div><div class="stg-gap-t">This adverse event failed the fabrication-safety audit and was withheld.</div><div class="stg-gap-s">' + esc(audit.problems.join("; ")) + "</div></div>";
    var rows = GRADES.map(function (n) { return gradeRowHtml(n, ae.grades[n]); }).join("");
    return back +
      '<div class="oh-sec-h">' + esc(ae.name) + " - CTCAE grading</div>" +
      '<div class="stg-prov">' + r1Flag() + '<div class="stg-prov-t">Category: ' + esc(ae.category || "") + ". Grade definitions quoted from " + esc(ae.source || "NCI CTCAE v5.0") + ". Not a substitute for the official NCI CTCAE. Verify before use.</div></div>" +
      '<div class="stg-cat">' + rows + "</div>" +
      ev([{ kind: "guideline", why: "NCI CTCAE v5.0 grade definitions (public domain). R1 verification required before clinical use.", source: { name: ae.source || "NCI CTCAE v5.0", section: ae.category } }]);
  }

  function gapHtml(msg) {
    return '<div class="stg-gap"><div class="stg-gap-h">Content gap</div><div class="stg-gap-t">' + esc(msg || cx.gapMessage) + "</div>" +
      '<div class="stg-gap-s">This is a deliberate, visible gap. No grading table is shown because it is not seeded and cannot be grounded here without the official NCI CTCAE source and R1 clinical sign-off.</div></div>';
  }

  function render() {
    var el = rootEl();
    var body = cx.ae ? aeDetailHtml() : aeListHtml();
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-ctc-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">CTCAE GRADING</div><span style="width:64px"></span></div>' +
      '<div class="oh-body"><div id="ctcResults">' + body + "</div></div>";
  }

  function onClick(e) {
    var t = e.target, b = (t && t.closest) ? t.closest("[data-ctc-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-ctc-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    if (verb === "close") { close(); return; }
    if (verb === "list") { cx.ae = null; render(); return; }
    if (verb === "ae") { cx.ae = arg; render(); return; }
    if (verb === "ver") { cx.version = arg; cx.ae = null; render(); return; }
  }

  function openList() {
    if (!flagOn()) { toast("CTCAE grading is off"); return; }
    cx.ae = null;
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    loadCatalog().then(render);
    render();
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function open(aeId) { openList(); if (aeId) { cx.ae = aeId; render(); } }
  function close() { var el = document.getElementById("smdOncoCtcae"); if (el) el.classList.remove("on"); if (!document.getElementById("smdOncoHome") || !document.getElementById("smdOncoHome").classList.contains("on")) document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var el = document.getElementById("smdOncoCtcae"); if (el && el.classList.contains("on")) close(); } }); } catch (e) {}

  G.SMD_ONCOCTCAE = {
    openList: openList, open: open, close: close,
    resolve: resolve, resolveVersion: resolveVersion, findAE: findAE,
    auditAE: auditAE, auditFabricationSafe: auditFabricationSafe,
    GAP_MESSAGE: GAP_MESSAGE, GRADES: GRADES, _cx: cx, _version: "1.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = { resolve: resolve, resolveVersion: resolveVersion, findAE: findAE, auditAE: auditAE, auditFabricationSafe: auditFabricationSafe, GAP_MESSAGE: GAP_MESSAGE, GRADES: GRADES };
})();
