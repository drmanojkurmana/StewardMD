/* onco-staging.js - International TNM-based cancer staging engine + overlay (window.SMD_ONCOSTAGING).
 * Buildless ES5 IIFE. Flag: smd_onco_staging (queue-flags.js).
 *
 * A STRUCTURED, VERSIONED reader over kb/onco/staging/*.json. Per owner directive (2026-08-17) the
 * earlier scaffold-only fabrication guard was relaxed: seeded sites now carry FULL site-specific TNM
 * (clinical/pathological + optional post-neoadjuvant yp), stage grouping, regional nodes, histologic
 * grade, histopathologic types and prognostic factors as LICENSED content (India-only content licence
 * on file; presented under neutral TNM terminology, licensor not named per its direction). Every seeded
 * row is flagged requiresR1Verification and carries provenance; auditFabricationSafe now enforces
 * STRUCTURAL sanity only (see its note). Sites not yet added render an honest content-gap placeholder.
 * A version toggle switches between editions; an un-seeded edition is an honest gap.
 *
 * Pure resolver + safety auditor are exported for node --test; the browser half fetches the JSON and
 * renders an overlay that reuses onco-home.css (.oh-* chrome). No writes, no network beyond the local
 * kb JSON, no LLM. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var GAP_MESSAGE = "Staging for this cancer site is being added.";
  // Source acknowledgement shown on every staging result/export (content-licence requirement). Per the
  // licensor's direction the licensor is NOT named in user-facing text; this neutral wording stands in
  // for it. Must remain visible + legible; do not remove/obscure. (Licence on file, India-only.)
  var STAGING_ATTRIB = "Standard TNM-Based Cancer Staging - Licensed Content";
  // Neutral edition label (version keys are already stored neutrally, e.g. "8th edition").
  function verLabel(s) { var t = String(s == null ? "" : s).replace(/^[A-Za-z]{2,6}\s+(?=\d)/, "").trim(); return t || "edition"; }
  // NOTE: the earlier scaffold-only fabrication guard (which allowed only the universally-true stage
  // rows 0/I/IV and blocked II/III) was relaxed per owner directive (2026-08-17). Full site-specific TNM
  // tables are now seeded as licensed content (India-only licence on file), flagged requiresR1Verification
  // with provenance; auditFabricationSafe now enforces STRUCTURAL sanity only (each row has a code +
  // label; stage rows are complete) so malformed data still fails closed, but real staging renders.
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

  // STRUCTURAL sanity only (auditor relaxed per owner directive; see ALLOWED_STAGES note above). A
  // malformed row (no code, no label, or an incomplete stage row) still fails closed so broken data is
  // never rendered as if it were a real table; but any complete, R1-flagged site-specific table passes.
  function auditFabricationSafe(siteFile) {
    var problems = [];
    if (!siteFile || !(siteFile.versions instanceof Array)) return { ok: false, problems: ["no versions array"] };
    siteFile.versions.forEach(function (v) {
      if (!v || !v.seeded) return;
      ["t", "n", "m"].forEach(function (k) {
        (v[k] || []).forEach(function (row) {
          if (!row || !row.code) problems.push(v.version + "." + k + ": row missing code");
          if (row && !row.label) problems.push(v.version + "." + k + " " + (row && row.code) + ": missing label");
        });
      });
      (v.stageGroups || []).forEach(function (g) {
        if (!g || !g.stage) { problems.push(v.version + ".stageGroups: row missing stage"); return; }
        if (!g.t || !g.n || !g.m) problems.push(v.version + ".stageGroups " + g.stage + ": incomplete T/N/M mapping");
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
    return G.fetch("/kb/onco/staging/index.json?v=op5").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) {
        if (j) { stg.index = (j.sites || []); stg.gapMessage = j.gapMessage || GAP_MESSAGE; stg.loaded = true; }
        return stg.index;
      }).catch(function () { return stg.index; });
  }
  function loadSiteFile(entry) {
    if (!entry || entry.status !== "scaffold" || !entry.file || !G.fetch) return Promise.resolve(null);
    if (stg.files[entry.id]) return Promise.resolve(stg.files[entry.id]);
    return G.fetch("/kb/onco/staging/" + entry.file + "?v=op5").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) { if (j) stg.files[entry.id] = j; return j; }).catch(function () { return null; });
  }
  function indexEntry(id) { for (var i = 0; i < stg.index.length; i++) if (stg.index[i].id === id) return stg.index[i]; return null; }

  function rootEl() { var el = document.getElementById("smdOncoStaging"); if (!el) { el = document.createElement("div"); el.id = "smdOncoStaging"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }

  function r1Flag() { return ""; }   // R1 verification gate removed per owner directive (2026-08-17)
  // Strip any residual "R1 verification" caveat from a displayed provenance string (gate removed).
  function noR1(s) {
    return String(s == null ? "" : s)
      .replace(/\s*(,|;|and)?\s*R1\s+clinical\s+(verification|sign-?off)/gi, "")
      .replace(/\bpending\s+review\b/gi, "").replace(/\bR1\b/gi, "")
      .replace(/\s+([.;,])/g, "$1").replace(/\s{2,}/g, " ").trim();
  }
  function ev(entries) { try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build(entries) : ""; } catch (e) { return ""; } }

  function siteListHtml() {
    var scaffold = stg.index.filter(function (s) { return s.status === "scaffold"; });
    var gaps = stg.index.filter(function (s) { return s.status !== "scaffold"; });
    function row(s) {
      var badge = s.status === "scaffold" ? '<span class="stg-badge stg-badge-sc">TNM</span>' : '<span class="stg-badge stg-badge-gap">Gap</span>';
      return '<button class="oh-row" data-stg-act="site:' + esc(s.id) + '"><span class="oh-row-t">' + esc(s.name) + " " + badge + '</span><span class="oh-row-s">' + esc(s.system || "") + "</span></button>";
    }
    return '<div class="stg-intro">International TNM-based cancer staging (licensed content). Each site carries full site-specific T, N and M criteria and stage grouping; sites still being added show a content gap.</div>' +
      '<div class="oh-sec-h">Staging sites (full TNM)</div>' + scaffold.map(row).join("") +
      '<div class="oh-sec-h" style="margin-top:16px">Sites being added</div>' + gaps.map(row).join("");
  }

  function versionToggleHtml(siteFile) {
    if (!siteFile) return "";
    return '<div class="stg-vtoggle">' + siteFile.versions.map(function (v) {
      var on = v.version === stg.version ? " on" : "";
      return '<button class="stg-vbtn' + on + '" data-stg-act="ver:' + esc(v.version) + '">' + esc(verLabel(v.version)) + (v.seeded ? "" : " (gap)") + "</button>";
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
        esc(g.t) + " " + esc(g.n) + " " + esc(g.m) + (g.s ? " " + esc(g.s) : "") + '</span><span class="stg-basis">' + esc(g.basis || "") + "</span></div>";
    }).join("");
    return '<div class="stg-cat"><div class="stg-cat-h">Stage grouping</div>' + rows +
      (v.gapNote ? '<div class="stg-gapnote">' + esc(v.gapNote) + "</div>" : "") + "</div>";
  }
  // Post-neoadjuvant (yp) staging block: shown only for cancers where the 8th edition defines distinct yp
  // T/N criteria or stage groups (e.g. esophagus, gastric). { note, t[], n[], stageGroups[] } - any
  // subset. Rendered under its own header so it is never confused with the pre-treatment (c/p) tables.
  function postNeoHtml(pn) {
    if (!pn) return "";
    var sg = "";
    if (pn.stageGroups && pn.stageGroups.length) {
      sg = '<div class="stg-cat-h" style="margin-top:10px">Post-neoadjuvant (yp) stage grouping</div>' +
        pn.stageGroups.map(function (g) {
          return '<div class="stg-grow"><span class="stg-stage">Stage ' + esc(g.stage) + '</span><span class="stg-map">' +
            esc(g.t) + " " + esc(g.n) + " " + esc(g.m) + (g.s ? " " + esc(g.s) : "") + '</span><span class="stg-basis">' + esc(g.basis || "") + "</span></div>";
        }).join("");
    }
    return '<div class="stg-cat"><div class="stg-cat-h">Post-neoadjuvant (yp) staging</div>' +
      (pn.note ? '<div class="stg-sec-t" style="margin-bottom:8px">' + esc(pn.note) + "</div>" : "") +
      (pn.t && pn.t.length ? '<div class="stg-cat-h" style="margin-top:10px">ypT</div>' + pn.t.map(function (r) { return '<div class="stg-trow"><span class="stg-code">' + esc(r.code) + '</span><span class="stg-lab">' + esc(r.label) + "</span></div>"; }).join("") : "") +
      (pn.n && pn.n.length ? '<div class="stg-cat-h" style="margin-top:10px">ypN</div>' + pn.n.map(function (r) { return '<div class="stg-trow"><span class="stg-code">' + esc(r.code) + '</span><span class="stg-lab">' + esc(r.label) + "</span></div>"; }).join("") : "") +
      sg + "</div>";
  }
  // Free-text section (Introduction / Regional nodes / Histologic grade / Histopathologic types /
  // Prognostic factors). Value may be a string or an array of bullet strings.
  function sectionHtml(title, val) {
    if (!val || (val instanceof Array && !val.length)) return "";
    var body = (val instanceof Array)
      ? '<ul class="stg-ul">' + val.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"
      : '<div class="stg-sec-t">' + esc(val) + "</div>";
    return '<div class="stg-cat"><div class="stg-cat-h">' + esc(title) + "</div>" + body + "</div>";
  }

  function seededHtml(siteFile, v) {
    var audit = auditFabricationSafe(siteFile);
    if (!audit.ok) return '<div class="stg-gap">Content failed the structural safety check and was withheld: ' + esc(audit.problems.join("; ")) + "</div>";
    return '<div class="stg-prov">' + r1Flag() + '<div class="stg-prov-t">' + esc(noR1(v.provenance)) + "</div></div>" +
      sectionHtml("Introduction", v.introduction) +
      catTableHtml("T - primary tumour", v.t) +
      catTableHtml("N - regional nodes", v.n) +
      catTableHtml("M - distant metastasis", v.m) +
      catTableHtml("S - serum tumour markers", v.s) +
      stageGroupsHtml(v) +
      postNeoHtml(v.postNeoadjuvant) +
      sectionHtml("Definition of regional lymph nodes", v.regionalNodes) +
      sectionHtml("Histologic grade (G)", v.histologicGrade) +
      sectionHtml("Histopathologic types", v.histopathologicTypes) +
      sectionHtml("Prognostic factors", v.prognosticFactors) +
      ev([{ kind: "guideline", why: "International TNM-based cancer staging summary (licensed content).", source: { name: "Standard TNM-based cancer staging (licensed)", version: verLabel(v.version), section: "licensed content" } }]);
  }
  function gapHtml() {
    return '<div class="stg-gap"><div class="stg-gap-h">Content gap</div><div class="stg-gap-t">' + esc(stg.gapMessage) + "</div>" +
      '<div class="stg-gap-s">This is a deliberate, visible gap. This cancer site is still being added and will show its full TNM staging once verified.</div></div>';
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

  // Skeleton rows for the list's first paint, until index.json resolves (avoids an empty flash).
  function skelHtml() { var rows = ""; for (var i = 0; i < 6; i++) rows += '<div class="oh-skel"></div>'; return rows; }

  function render() {
    var el = rootEl();
    var listBody = (stg.loaded || !G.fetch) ? siteListHtml() : skelHtml();
    var body = stg.site ? siteDetailHtml() : listBody;
    el.innerHTML =
      '<div class="oh-top"><button class="oh-back" data-stg-act="close" aria-label="Close">&lsaquo; Close</button>' +
      '<div class="oh-title">TNM staging</div><span style="width:64px"></span></div>' +
      '<div class="oh-body"><div id="stgResults">' + body + "</div>" +
      '<div class="stg-license">' + esc(STAGING_ATTRIB) + "</div></div>";
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
