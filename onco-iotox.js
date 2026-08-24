/* onco-iotox.js — immune-related adverse event (irAE) MANAGEMENT-PRINCIPLES reference + overlay
 * (window.SMD_ONCOIOTOX). Phase 8 P2. Buildless ES5 IIFE. Flag: smd_onco_iotox (queue-flags.js),
 * default OFF.
 *
 * This is NOT a dosing tool. It is a structured, read-only reference of the general, grade-based
 * management PRINCIPLE per organ system (continue vs withhold vs permanently discontinue the
 * checkpoint inhibitor; whether corticosteroids are indicated; when to escalate to second-line
 * immunosuppression), grounded in ASCO / NCCN / SITC irAE guidance and cited by NAME only. Specific
 * doses, tapers, time windows, agent choices and lab thresholds are DELIBERATELY omitted and shown as
 * a marked gap.
 * FAIL CLOSED: the fabrication auditor withholds any organ entry that is unflagged, un-cited, has an
 * empty grade principle, OR whose principle text contains a NUMERAL (a proxy for a fabricated
 * dose/threshold) — principles are words, not numbers. Pure resolver + auditor exported for node --test;
 * the browser half fetches the JSON and renders an overlay reusing onco-home.css. No writes, no network
 * beyond the local kb JSON, no LLM. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var GAP_MESSAGE = "Specific corticosteroid doses, tapers, time windows, second-line agents and lab thresholds are intentionally not reproduced here. Consult the current ASCO, NCCN or SITC irAE guideline and your institutional protocol.";
  var GRADES = ["1", "2", "3", "4"];
  var ALLOWED_GUIDELINES = { ASCO: 1, NCCN: 1, SITC: 1 };
  var NUMERAL_RE = /\d/;   // a digit in a principle string is treated as a fabricated dose/threshold

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  /* ===================== PURE ENGINE (testable in Node, no DOM/fetch) ===================== */

  function findOrgan(catalog, organId) {
    if (!catalog || !(catalog.organs instanceof Array)) return null;
    for (var i = 0; i < catalog.organs.length; i++) if (catalog.organs[i] && catalog.organs[i].id === organId) return catalog.organs[i];
    return null;
  }

  // auditOrgan(o): one organ system. Must be flagged requiresR1Verification===true, cite at least one
  // recognised guideline (ASCO/NCCN/SITC), and provide EVERY grade 1-4 as a NON-EMPTY, NUMERAL-FREE
  // principle. A digit in a principle is a fabricated-dose/threshold red flag and fails closed.
  function auditOrgan(o) {
    var problems = [];
    if (!o || !o.id) return { ok: false, problems: ["organ missing id"] };
    if (!o.organ) problems.push(o.id + ": missing organ label");
    // FAIL CLOSED on the R1 verification flag. Every shipped irAE record carries
    // requiresR1Verification:true; a record that arrives without it (or with it cleared) has not
    // been through clinical review, and irAE management principles are exactly the content where
    // "looks plausible" is not good enough. Absence is a refusal, not a default-allow.
    if (o.requiresR1Verification !== true) problems.push(o.id + ": requiresR1Verification is not set (unverified content)");
    var refs = o.guidelineRefs || [];
    if (!(refs instanceof Array) || !refs.length) problems.push(o.id + ": missing guidelineRefs");
    else if (!refs.some(function (g) { return ALLOWED_GUIDELINES[g]; })) problems.push(o.id + ": guidelineRefs must name ASCO/NCCN/SITC");
    var g = o.grades || null;
    if (!g || typeof g !== "object") { problems.push(o.id + ": missing grades"); return { ok: false, problems: problems }; }
    for (var i = 0; i < GRADES.length; i++) {
      var k = GRADES[i];
      if (!Object.prototype.hasOwnProperty.call(g, k)) { problems.push(o.id + ": grade " + k + " key missing"); continue; }
      var val = g[k];
      if (typeof val !== "string" || !val.trim()) { problems.push(o.id + ": grade " + k + " principle is empty (withheld)"); continue; }
      if (NUMERAL_RE.test(val)) problems.push(o.id + ": grade " + k + " principle contains a numeral (possible fabricated dose/threshold)");
    }
    return { ok: problems.length === 0, problems: problems };
  }

  function auditFabricationSafe(catalog) {
    var problems = [];
    if (!catalog || !(catalog.organs instanceof Array)) return { ok: false, problems: ["no organs array"] };
    catalog.organs.forEach(function (o) { var r = auditOrgan(o); if (!r.ok) problems = problems.concat(r.problems); });
    return { ok: problems.length === 0, problems: problems };
  }

  /* ===================== BROWSER: fetch + overlay ===================== */

  var ix = { catalog: null, gapMessage: GAP_MESSAGE, organ: null, loaded: false, loading: false };

  function ms(name) { return '<span class="material-symbols-outlined">' + name + "</span>"; }
  function skelHtml() { return '<div class="oh-skel"></div><div class="oh-skel"></div><div class="oh-skel"></div><div class="oh-skel"></div>'; }

  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_iotox")); } catch (e) { return false; } }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }
  function ev(entries) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build(entries) : ""; } catch (e) { return ""; } }

  function loadCatalog() {
    if (ix.loaded || !G.fetch) return Promise.resolve(ix.catalog);
    return G.fetch("/kb/onco/iotox/catalog.json?v=op2").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { if (j) { ix.catalog = j; ix.gapMessage = j.gapMessage || GAP_MESSAGE; ix.loaded = true; } return ix.catalog; })
      .catch(function () { return ix.catalog; });
  }

  function rootEl() { var el = document.getElementById("smdOncoIotox"); if (!el) { el = document.createElement("div"); el.id = "smdOncoIotox"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }
  function r1Flag() { return ""; }   // R1 verification gate removed per owner directive (2026-08-17)

  function principlesHtml(catalog) {
    var list = (catalog && catalog.generalPrinciples) || [];
    if (!list.length) return "";
    return '<div class="oh-sec"><div class="oh-sec-h">General principles</div>' +
      list.map(function (p) { return '<div class="ctc-grow"><span class="ctc-gtext">' + esc(p) + "</span></div>"; }).join("") + "</div>";
  }

  function organListHtml() {
    var catalog = ix.catalog;
    var guidelines = (catalog && catalog.guidelines) || [];
    var head = '<div class="stg-intro">Immune-related adverse event (irAE) management PRINCIPLES by organ and grade, grounded in ' + esc(guidelines.join(", ") || "ASCO, NCCN, SITC") + ' irAE guidance (cited by name only). This is not a dosing tool: specific doses, tapers, time windows and second-line agents are a marked gap, read them from the guideline and your institutional protocol.</div>';
    if (!catalog || !(catalog.organs instanceof Array) || !catalog.organs.length) return head + '<div class="oh-empty">' + ms("clinical_notes") + "<span>" + esc(ix.gapMessage) + "</span></div>";
    var rows = catalog.organs.map(function (o) {
      return '<button class="oh-row" data-iot-act="organ:' + esc(o.id) + '"><span class="oh-row-t">' + esc(o.organ) + '</span><span class="oh-row-s">' + esc((o.guidelineRefs || []).join(" / ")) + "</span></button>";
    }).join("");
    return head + principlesHtml(catalog) + '<div class="oh-sec"><div class="oh-sec-h">By organ system</div>' + rows + "</div>" +
      '<div class="stg-gapnote">' + esc(ix.gapMessage) + "</div>";
  }

  function organDetailHtml() {
    var catalog = ix.catalog;
    var back = '<button class="oh-back-inline" data-iot-act="list">&lsaquo; All organ systems</button>';
    var o = findOrgan(catalog, ix.organ);
    if (!o) return back + gapHtml(ix.gapMessage);
    var audit = auditOrgan(o);
    if (!audit.ok) return back + '<div class="stg-gap"><div class="stg-gap-h">Content withheld</div><div class="stg-gap-t">This organ entry failed the fabrication-safety audit and was withheld.</div><div class="stg-gap-s">' + esc(audit.problems.join("; ")) + "</div></div>";
    var rows = GRADES.map(function (n) {
      return '<div class="ctc-grow ctc-g' + esc(n) + '"><span class="ctc-gnum">Grade ' + esc(n) + '</span><span class="ctc-gtext">' + esc(o.grades[n]) + "</span></div>";
    }).join("");
    return back +
      '<div class="oh-sec-h">' + esc(o.organ) + " - irAE management principle</div>" +
      '<div class="stg-prov">' + r1Flag() + '<div class="stg-prov-t">Grounded in ' + esc((o.guidelineRefs || []).join(", ")) + ' irAE guidance (by name). General principles only, not doses. Verify against the current guideline and institutional protocol before use.</div></div>' +
      '<div class="stg-cat">' + rows + "</div>" +
      '<div class="stg-gapnote">' + esc(ix.gapMessage) + "</div>" +
      ev([{ kind: "guideline", why: "Immune-related adverse event management principle. Grounded in published ASCO / NCCN / SITC irAE guidance; verify specifics against the current guideline.", source: { name: (o.guidelineRefs || []).join(" / ") || "ASCO / NCCN / SITC", section: o.organ } }]);
  }

  function gapHtml(msg) {
    return '<div class="stg-gap"><div class="stg-gap-h">Content gap</div><div class="stg-gap-t">' + esc(msg || ix.gapMessage) + "</div>" +
      '<div class="stg-gap-s">This is a deliberate, visible gap. This organ system is not seeded yet; consult the current ASCO / NCCN / SITC irAE guidance.</div></div>';
  }

  function render() {
    var el = rootEl();
    var body = (ix.loading && !ix.loaded) ? skelHtml() : (ix.organ ? organDetailHtml() : organListHtml());
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-iot-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">IO toxicity (irAE)</div><span style="width:64px"></span></div>' +
      '<div class="oh-body"><div id="iotResults">' + body + "</div></div>";
  }

  function onClick(e) {
    var t = e.target, b = (t && t.closest) ? t.closest("[data-iot-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-iot-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    if (verb === "close") { close(); return; }
    if (verb === "list") { ix.organ = null; render(); return; }
    if (verb === "organ") { ix.organ = arg; render(); return; }
  }

  function openList() {
    if (!flagOn()) { toast("IO toxicity reference is off"); return; }
    ix.organ = null;
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    ix.loading = true; render();                                  // skeleton until the JSON resolves
    loadCatalog().then(function () { ix.loading = false; render(); });
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function open(organId) { openList(); if (organId) { ix.organ = organId; render(); } }
  function close() { var el = document.getElementById("smdOncoIotox"); if (el) el.classList.remove("on"); if (!document.getElementById("smdOncoHome") || !document.getElementById("smdOncoHome").classList.contains("on")) document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var el = document.getElementById("smdOncoIotox"); if (el && el.classList.contains("on")) close(); } }); } catch (e) {}

  G.SMD_ONCOIOTOX = {
    openList: openList, open: open, close: close,
    findOrgan: findOrgan, auditOrgan: auditOrgan, auditFabricationSafe: auditFabricationSafe,
    GAP_MESSAGE: GAP_MESSAGE, GRADES: GRADES, _ix: ix, _version: "1.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = { findOrgan: findOrgan, auditOrgan: auditOrgan, auditFabricationSafe: auditFabricationSafe, GAP_MESSAGE: GAP_MESSAGE, GRADES: GRADES };
})();
