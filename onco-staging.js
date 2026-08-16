/* onco-staging.js — AJCC/TNM staging engine + overlay (window.SMD_ONCOSTAGING). Phase 8 P1.
 * Buildless ES5 IIFE. Flag: smd_onco_staging (queue-flags.js), default OFF.
 *
 * THE DELIVERABLE IS THE ENGINE, not clinical content. It is a STRUCTURED, VERSIONED reader over
 * kb/onco/staging/*.json:
 *   - SCAFFOLD sites carry ONLY the generic UICC/AJCC TNM conceptual framework (T/N/M nomenclature +
 *     the three universally-true stage-group rows: Tis N0 M0 = 0, T1 N0 M0 = I, any/any M1 = IV).
 *     EVERY seeded value is flagged requiresR1Verification and carries a provenance/basis string.
 *   - NO proprietary AJCC staging tables are reproduced. Intermediate groups (II/III) are a marked,
 *     visible gap inside a scaffold site.
 *   - GAP sites (and un-seeded versions) render an honest content-gap placeholder, never a fabricated
 *     table: "Staging content pending licensed AJCC data + R1 sign-off".
 * A version toggle switches between AJCC editions; an un-seeded edition is an honest gap.
 *
 * Pure resolver + safety auditor are exported for node --test; the browser half fetches the JSON and
 * renders an overlay that reuses onco-home.css (.oh-* chrome). No writes, no network beyond the local
 * kb JSON, no LLM. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var GAP_MESSAGE = "Staging content pending licensed AJCC data + R1 sign-off";
  // The ONLY stage groups we permit in a scaffold — the universally-true TNM rows. Anything else in a
  // seeded file is treated as fabricated (auditFabricationSafe fails), so a bad edit can't ship silent.
  var ALLOWED_STAGES = { "0": 1, "I": 1, "IV": 1 };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  /* ===================== PURE ENGINE (testable in Node, no DOM/fetch) ===================== */

  // resolveVersion(siteFile, versionName): the version object, or null. versionName omitted -> first.
  function resolveVersion(siteFile, versionName) {
    if (!siteFile || !(siteFile.versions instanceof Array)) return null;
    if (versionName == null) return siteFile.versions[0] || null;
    for (var i = 0; i < siteFile.versions.length; i++) {
      if (siteFile.versions[i] && siteFile.versions[i].version === versionName) return siteFile.versions[i];
    }
    return null;
  }

  // resolve(siteFile, versionName) -> either { status:"seeded", version } or { status:"gap", message }.
  // A gap for: unknown site, unknown version, or a version explicitly not seeded.
  function resolve(siteFile, versionName) {
    var v = resolveVersion(siteFile, versionName);
    if (!v || !v.seeded) return { status: "gap", message: GAP_MESSAGE };
    return { status: "seeded", version: v };
  }

  // auditFabricationSafe(siteFile): guards against fabricated/unflagged clinical content. Returns
  // { ok, problems[] }. Every seeded T/N/M/stageGroup MUST carry requiresR1Verification===true and a
  // provenance/basis; stageGroups may ONLY use the universally-true stages (0/I/IV). No exceptions.
  function auditFabricationSafe(siteFile) {
    var problems = [];
    if (!siteFile || !(siteFile.versions instanceof Array)) return { ok: false, problems: ["no versions array"] };
    siteFile.versions.forEach(function (v) {
      if (!v || !v.seeded) return;
      if (v.requiresR1Verification !== true) problems.push(v.version + ": version not flagged requiresR1Verification");
      if (!v.provenance) problems.push(v.version + ": version missing provenance");
      ["t", "n", "m"].forEach(function (k) {
        (v[k] || []).forEach(function (row) {
          if (!row || !row.code) problems.push(v.version + "." + k + ": row missing code");
          else if (row.requiresR1Verification !== true) problems.push(v.version + "." + k + " " + row.code + ": not flagged requiresR1Verification");
          if (row && !row.label) problems.push(v.version + "." + k + " " + (row && row.code) + ": missing label");
        });
      });
      (v.stageGroups || []).forEach(function (g) {
        if (!g || !g.stage) { problems.push(v.version + ".stageGroups: row missing stage"); return; }
        if (!ALLOWED_STAGES[g.stage]) problems.push(v.version + ".stageGroups: stage " + g.stage + " is not a universally-true row (possible fabricated AJCC content)");
        if (g.requiresR1Verification !== true) problems.push(v.version + ".stageGroups " + g.stage + ": not flagged requiresR1Verification");
        if (!g.basis) problems.push(v.version + ".stageGroups " + g.stage + ": missing basis");
      });
    });
    return { ok: problems.length === 0, problems: problems };
  }

  /* ===================== BROWSER: fetch + overlay ===================== */

  var stg = { index: [], gapMessage: GAP_MESSAGE, files: {}, site: null, version: null, loaded: false };

  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_staging")); } catch (e) { return false; } }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }

  function loadIndex() {
    if (stg.loaded || !G.fetch) return Promise.resolve(stg.index);
    return G.fetch("/kb/onco/staging/index.json").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) {
        if (j) { stg.index = (j.sites || []); stg.gapMessage = j.gapMessage || GAP_MESSAGE; stg.loaded = true; }
        return stg.index;
      }).catch(function () { return stg.index; });
  }
  function loadSiteFile(entry) {
    if (!entry || entry.status !== "scaffold" || !entry.file || !G.fetch) return Promise.resolve(null);
    if (stg.files[entry.id]) return Promise.resolve(stg.files[entry.id]);
    return G.fetch("/kb/onco/staging/" + entry.file).then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { if (j) stg.files[entry.id] = j; return j; }).catch(function () { return null; });
  }
  function indexEntry(id) { for (var i = 0; i < stg.index.length; i++) if (stg.index[i].id === id) return stg.index[i]; return null; }

  function rootEl() { var el = document.getElementById("smdOncoStaging"); if (!el) { el = document.createElement("div"); el.id = "smdOncoStaging"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }

  function r1Flag() { return '<span class="stg-r1">Requires R1 verification</span>'; }
  function ev(entries) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build(entries) : ""; } catch (e) { return ""; } }

  function siteListHtml() {
    var scaffold = stg.index.filter(function (s) { return s.status === "scaffold"; });
    var gaps = stg.index.filter(function (s) { return s.status !== "scaffold"; });
    function row(s) {
      var badge = s.status === "scaffold" ? '<span class="stg-badge stg-badge-sc">Framework</span>' : '<span class="stg-badge stg-badge-gap">Gap</span>';
      return '<button class="oh-row" data-stg-act="site:' + esc(s.id) + '"><span class="oh-row-t">' + esc(s.name) + " " + badge + '</span><span class="oh-row-s">' + esc(s.system || "") + "</span></button>";
    }
    return '<div class="stg-intro">Structured, versioned TNM engine. Framework sites carry only the generic TNM scaffold (flagged for R1 verification); other sites show an honest content gap. No proprietary AJCC tables are reproduced.</div>' +
      '<div class="oh-sec-h">Framework sites (generic TNM scaffold, R1-pending)</div>' + scaffold.map(row).join("") +
      '<div class="oh-sec-h" style="margin-top:16px">Content gaps (pending licensed AJCC data + R1)</div>' + gaps.map(row).join("");
  }

  function versionToggleHtml(siteFile) {
    if (!siteFile) return "";
    return '<div class="stg-vtoggle">' + siteFile.versions.map(function (v) {
      var on = v.version === stg.version ? " on" : "";
      return '<button class="stg-vbtn' + on + '" data-stg-act="ver:' + esc(v.version) + '">' + esc(v.version) + (v.seeded ? "" : " (gap)") + "</button>";
    }).join("") + "</div>";
  }

  function catTableHtml(title, rows) {
    if (!rows || !rows.length) return "";
    var body = rows.map(function (row) {
      return '<div class="stg-trow"><span class="stg-code">' + esc(row.code) + "</span><span class=\"stg-lab\">" + esc(row.label) + "</span></div>";
    }).join("");
    return '<div class="stg-cat"><div class="stg-cat-h">' + esc(title) + "</div>" + body + "</div>";
  }
  function stageGroupsHtml(v) {
    var rows = (v.stageGroups || []).map(function (g) {
      return '<div class="stg-grow"><span class="stg-stage">Stage ' + esc(g.stage) + "</span><span class=\"stg-map\">" +
        esc(g.t) + " " + esc(g.n) + " " + esc(g.m) + '</span><span class="stg-basis">' + esc(g.basis) + "</span></div>";
    }).join("");
    return '<div class="stg-cat"><div class="stg-cat-h">Stage groups (universally-true rows only)</div>' + rows +
      (v.gapNote ? '<div class="stg-gapnote">' + esc(v.gapNote) + "</div>" : "") + "</div>";
  }

  function seededHtml(siteFile, v) {
    var audit = auditFabricationSafe(siteFile);
    var warn = audit.ok ? "" : '<div class="stg-gap">Content failed the safety audit and was withheld: ' + esc(audit.problems.join("; ")) + "</div>";
    if (!audit.ok) return warn;   // fail-closed: never render content that failed the fabrication audit
    return '<div class="stg-prov">' + r1Flag() + '<div class="stg-prov-t">' + esc(v.provenance) + "</div></div>" +
      catTableHtml("T - primary tumour", v.t) +
      catTableHtml("N - regional nodes", v.n) +
      catTableHtml("M - distant metastasis", v.m) +
      stageGroupsHtml(v) +
      ev([{ kind: "guideline", why: "Generic UICC/AJCC TNM conceptual framework (scaffold). Not a substitute for the licensed AJCC manual.", source: { name: "onco-staging engine", version: v.version, section: "R1 verification required" } }]);
  }
  function gapHtml() {
    return '<div class="stg-gap"><div class="stg-gap-h">Content gap</div><div class="stg-gap-t">' + esc(stg.gapMessage) + "</div>" +
      '<div class="stg-gap-s">This is a deliberate, visible gap. No staging table is shown because none can be grounded here without licensed AJCC data and R1 clinical sign-off.</div></div>';
  }

  function siteDetailHtml() {
    var entry = indexEntry(stg.site);
    if (!entry) return siteListHtml();
    var siteFile = stg.files[stg.site] || null;
    var header = '<button class="oh-back-inline" data-stg-act="list">&lsaquo; All sites</button>' +
      '<div class="oh-sec-h">' + esc(entry.name) + " - TNM staging</div>";
    // Gap-only site (no file): the whole site is an honest gap; still offer version chips for parity.
    if (entry.status !== "scaffold" || !siteFile) return header + gapHtml();
    var res = resolve(siteFile, stg.version);
    return header + versionToggleHtml(siteFile) + (res.status === "seeded" ? seededHtml(siteFile, res.version) : gapHtml());
  }

  function render() {
    var el = rootEl();
    var body = stg.site ? siteDetailHtml() : siteListHtml();
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-stg-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">TNM STAGING</div><span style="width:64px"></span></div>' +
      '<div class="oh-body"><div id="stgResults">' + body + "</div></div>";
  }

  function openSite(id) {
    stg.site = id;
    var entry = indexEntry(id);
    stg.version = null;
    loadSiteFile(entry).then(function (f) {
      if (f && f.versions && f.versions[0]) stg.version = f.versions[0].version;
      render();
    });
    render();
  }

  function onClick(e) {
    var t = e.target, b = (t && t.closest) ? t.closest("[data-stg-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-stg-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    if (verb === "close") { close(); return; }
    if (verb === "list") { stg.site = null; stg.version = null; render(); return; }
    if (verb === "site") { openSite(arg); return; }
    if (verb === "ver") { stg.version = arg; render(); return; }
  }

  function openList() {
    if (!flagOn()) { toast("Staging is off"); return; }
    stg.site = null; stg.version = null;
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    loadIndex().then(render);
    render();
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function open(id) { openList(); if (id) openSite(id); }
  function close() { var el = document.getElementById("smdOncoStaging"); if (el) el.classList.remove("on"); if (!document.getElementById("smdOncoHome") || !document.getElementById("smdOncoHome").classList.contains("on")) document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var el = document.getElementById("smdOncoStaging"); if (el && el.classList.contains("on")) close(); } }); } catch (e) {}

  G.SMD_ONCOSTAGING = {
    openList: openList, open: open, close: close,
    resolve: resolve, resolveVersion: resolveVersion, auditFabricationSafe: auditFabricationSafe,
    GAP_MESSAGE: GAP_MESSAGE, ALLOWED_STAGES: ALLOWED_STAGES, _st: stg, _version: "1.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = { resolve: resolve, resolveVersion: resolveVersion, auditFabricationSafe: auditFabricationSafe, GAP_MESSAGE: GAP_MESSAGE, ALLOWED_STAGES: ALLOWED_STAGES };
})();
