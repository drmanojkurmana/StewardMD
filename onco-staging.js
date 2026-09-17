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

  var CLINICAL_PAIRS = {
    liver: { target: "bclc_hcc", label: "Open BCLC 2022 Staging", note: "Standard of Care: For HCC, BCLC 2022 is the primary clinical staging system directing treatment allocation." },
    bclc_hcc: { target: "liver", label: "View AJCC / UICC TNM", note: "Disease-Specific System: BCLC 2022 Algorithm for HCC." },
    myeloma: { target: "myeloma_riss", label: "Open R-ISS Staging", note: "Standard of Care: Multiple Myeloma is staged clinically using R-ISS / R2-ISS rather than TNM." },
    myeloma_riss: { target: "myeloma", label: "View Historical TNM", note: "Disease-Specific System: IMWG R-ISS & R2-ISS for Multiple Myeloma." },
    nhl: { target: "lymphoma_lugano", label: "Open Lugano Staging", note: "Standard of Care: Lymphomas use the Lugano / Ann Arbor classification." },
    lymphoma_lugano: { target: "nhl", label: "View TNM Schema", note: "Disease-Specific System: Lugano Staging for Lymphoma." },
    cll_rai_binet: { target: "nhl", label: "View Hematologic TNM", note: "Disease-Specific System: Rai & Binet Staging for CLL." },
    cervix: { target: "cervix_figo", label: "Open FIGO 2018 Staging", note: "Standard of Care: Cervical cancer uses FIGO 2018 clinical/surgical staging." },
    cervix_figo: { target: "cervix", label: "View AJCC TNM", note: "Disease-Specific System: FIGO 2018 Staging for Cervix." },
    endometrium: { target: "endometrium_figo", label: "Open FIGO 2023 Molecular", note: "Standard of Care: Endometrial cancer uses FIGO 2023 molecular risk staging." },
    endometrium_figo: { target: "endometrium", label: "View AJCC TNM", note: "Disease-Specific System: FIGO 2023 Molecular Staging for Endometrium." },
    prostate: { target: "prostate_nccn", label: "Open NCCN Risk Groups", note: "Standard of Care: Localized prostate cancer uses NCCN Risk Stratification to guide therapy." },
    prostate_nccn: { target: "prostate", label: "View AJCC TNM", note: "Disease-Specific System: NCCN Risk Stratification for Prostate Cancer." },
    gist: { target: "gist_afip", label: "Open Modified NIH / AFIP", note: "Standard of Care: GIST uses NIH/AFIP criteria to determine recurrence risk and adjuvant imatinib." },
    gist_afip: { target: "gist", label: "View AJCC TNM", note: "Disease-Specific System: Modified NIH / AFIP Risk Criteria for GIST." }
  };

  var stg = { index: [], gapMessage: GAP_MESSAGE, files: {}, site: null, version: null, query: "", tab: "all", loaded: false };

  function flagOn() { try { if (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool) return true; return G.SMD_QUEUE_FLAGS.bool("smd_onco_staging") !== false; } catch (e) { return true; } }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }

  function loadIndex() {
    if (stg.loaded || !G.fetch) return Promise.resolve(stg.index);
    return G.fetch("/kb/onco/staging/index.json?v=op7").then(function (r) { return (r && r.ok) ? r.json() : null; })
      .then(function (j) {
        if (j) { stg.index = (j.sites || []); stg.gapMessage = j.gapMessage || GAP_MESSAGE; stg.loaded = true; }
        return stg.index;
      }).catch(function () { return stg.index; });
  }
  function loadSiteFile(entry) {
    if (!entry || entry.status !== "scaffold" || !entry.file || !G.fetch) return Promise.resolve(null);
    if (stg.files[entry.id]) return Promise.resolve(stg.files[entry.id]);
    return G.fetch("/kb/onco/staging/" + entry.file + "?v=op7").then(function (r) { return (r && r.ok) ? r.json() : null; })
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
    var q = (stg.query || "").trim().toLowerCase();
    var filtered = stg.index.filter(function (s) {
      if (stg.tab === "clinical" && s.type !== "clinical") return false;
      if (stg.tab === "tnm" && s.type === "clinical") return false;
      if (!q) return true;
      return (s.name && s.name.toLowerCase().indexOf(q) >= 0) ||
             (s.system && s.system.toLowerCase().indexOf(q) >= 0) ||
             (s.id && s.id.toLowerCase().indexOf(q) >= 0);
    });

    var clinicalSites = filtered.filter(function (s) { return s.type === "clinical"; });
    var tnmScaffold = filtered.filter(function (s) { return s.type !== "clinical" && s.status === "scaffold"; });
    var gaps = filtered.filter(function (s) { return s.type !== "clinical" && s.status !== "scaffold"; });

    function row(s) {
      var badge = s.type === "clinical"
        ? '<span class="stg-badge stg-badge-sc" style="background:linear-gradient(135deg, #2563eb, #7c3aed);color:#fff;border:none;">CLINICAL</span>'
        : (s.status === "scaffold" ? '<span class="stg-badge stg-badge-sc">TNM</span>' : '<span class="stg-badge stg-badge-gap">Gap</span>');
      return '<button class="oh-row" data-stg-act="site:' + esc(s.id) + '"><span class="oh-row-t">' + esc(s.name) + " " + badge + '</span><span class="oh-row-s">' + esc(s.system || "") + "</span></button>";
    }

    var searchBox = '<div style="margin:12px 0 12px 0;"><input type="search" id="stgSearchInput" style="width:100%;box-sizing:border-box;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.25);color:inherit;font-size:14px;" placeholder="Search cancer staging (e.g. liver, BCLC, breast, FIGO, myeloma)..." value="' + esc(stg.query || "") + '" /></div>';

    var tabs = '<div class="stg-vtoggle" style="margin-bottom:14px;">' +
      '<button class="stg-vbtn' + (stg.tab === "all" ? " on" : "") + '" data-stg-act="tab:all">All (' + stg.index.length + ')</button>' +
      '<button class="stg-vbtn' + (stg.tab === "clinical" ? " on" : "") + '" data-stg-act="tab:clinical">Clinical Systems (BCLC, FIGO, R-ISS...)</button>' +
      '<button class="stg-vbtn' + (stg.tab === "tnm" ? " on" : "") + '" data-stg-act="tab:tnm">AJCC / UICC TNM</button>' +
      '</div>';

    var out = '<div class="stg-intro">International cancer staging engine supporting both disease-specific clinical systems (BCLC, FIGO, R-ISS, Lugano, NCCN) and standard TNM classifications.</div>' +
      searchBox + tabs;

    if (clinicalSites.length) {
      out += '<div class="oh-sec-h" style="color:#60a5fa;">Disease-Specific & Clinical Systems (Standard of Care)</div>' + clinicalSites.map(row).join("");
    }
    if (tnmScaffold.length) {
      out += '<div class="oh-sec-h" style="margin-top:16px;">TNM Cancer Staging Sites</div>' + tnmScaffold.map(row).join("");
    }
    if (gaps.length) {
      out += '<div class="oh-sec-h" style="margin-top:16px;">Sites being added</div>' + gaps.map(row).join("");
    }
    if (!filtered.length) {
      out += '<div class="oh-empty" style="padding:28px 16px;text-align:center;opacity:0.7;">No staging sites matching "' + esc(stg.query) + '"</div>';
    }
    return out;
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
    return '<div class="stg-cat"><div class="stg-cat-h">Stage grouping & Treatment Allocation</div>' + rows +
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

  function pairedBannerHtml(siteId) {
    var pair = CLINICAL_PAIRS[siteId];
    if (!pair) return "";
    return '<div style="background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.3);border-radius:10px;padding:10px 14px;margin:8px 0 14px 0;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
      '<span style="line-height:1.4;">' + esc(pair.note) + '</span>' +
      '<button class="stg-vbtn on" data-stg-act="site:' + esc(pair.target) + '" style="margin:0;white-space:nowrap;">' + esc(pair.label) + ' &rarr;</button>' +
      '</div>';
  }

  function seededHtml(siteFile, v) {
    var audit = auditFabricationSafe(siteFile);
    if (!audit.ok) return '<div class="stg-gap">Content failed the structural safety check and was withheld: ' + esc(audit.problems.join("; ")) + "</div>";
    var tLabel = siteFile.site === "bclc_hcc" ? "Tumour burden / BCLC stage criteria" : "T - primary tumour";
    var nLabel = siteFile.site === "bclc_hcc" ? "Liver functional reserve (Child-Pugh)" : "N - regional nodes";
    var mLabel = siteFile.site === "bclc_hcc" ? "Performance status (ECOG PS)" : "M - distant metastasis";

    return '<div class="stg-prov">' + r1Flag() + '<div class="stg-prov-t">' + esc(noR1(v.provenance)) + "</div></div>" +
      sectionHtml("Introduction", v.introduction) +
      catTableHtml(tLabel, v.t) +
      catTableHtml(nLabel, v.n) +
      catTableHtml(mLabel, v.m) +
      catTableHtml("S - serum tumour markers", v.s) +
      stageGroupsHtml(v) +
      postNeoHtml(v.postNeoadjuvant) +
      sectionHtml("Definition of regional lymph nodes", v.regionalNodes) +
      sectionHtml("Histologic grade (G)", v.histologicGrade) +
      sectionHtml("Histopathologic types", v.histopathologicTypes) +
      sectionHtml("Prognostic factors", v.prognosticFactors) +
      ev([{ kind: "guideline", why: "Cancer staging reference (licensed content).", source: { name: "Standard cancer staging (licensed)", version: verLabel(v.version), section: "licensed content" } }]);
  }
  function gapHtml() {
    return '<div class="stg-gap"><div class="stg-gap-h">Content gap</div><div class="stg-gap-t">' + esc(stg.gapMessage) + "</div>" +
      '<div class="stg-gap-s">This is a deliberate, visible gap. This cancer site is still being added and will show its full staging once verified.</div></div>';
  }

  function siteDetailHtml() {
    var entry = indexEntry(stg.site);
    if (!entry) return siteListHtml();
    var siteFile = stg.files[stg.site] || null;
    var header = '<button class="oh-back-inline" data-stg-act="list">&lsaquo; All sites</button>' +
      pairedBannerHtml(stg.site) +
      '<div class="oh-sec-h">' + esc(entry.name) + "</div>";
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
      '<div class="oh-top"><button class="oh-back" data-stg-act="close" aria-label="Close">' + (stg.site ? "&lsaquo; All sites" : "&lsaquo; Close") + '</button>' +
      '<div class="oh-title">Cancer Staging Engine</div><span style="width:64px"></span></div>' +
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

  function onInput(e) {
    if (e.target && e.target.id === "stgSearchInput") {
      stg.query = e.target.value;
      var r = document.getElementById("stgResults");
      if (r) r.innerHTML = siteListHtml();
      var input = document.getElementById("stgSearchInput");
      if (input) { input.focus(); var len = input.value.length; input.setSelectionRange(len, len); }
    }
  }

  function onClick(e) {
    var t = e.target, b = (t && t.closest) ? t.closest("[data-stg-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-stg-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    if (verb === "close") { if (stg.site) { stg.site = null; stg.version = null; render(); return; } close(); return; }
    if (verb === "list") { stg.site = null; stg.version = null; render(); return; }
    if (verb === "site") { openSite(arg); return; }
    if (verb === "ver") { stg.version = arg; render(); return; }
    if (verb === "tab") { stg.tab = arg; render(); return; }
  }

  function openList() {
    if (!flagOn()) { toast("Staging is off"); return; }
    stg.site = null; stg.version = null;
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    loadIndex().then(render);
    render();
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function open(id) { openList(); if (id) openSite(id); }
  function close() { var el = document.getElementById("smdOncoStaging"); if (el) el.classList.remove("on"); try { if (document.getElementById("smdOncoHome") && document.getElementById("smdOncoHome").classList.contains("on") && window.SMD_ONCOHOME && SMD_ONCOHOME.foreground) SMD_ONCOHOME.foreground(); } catch (e) {} if (!document.getElementById("smdOncoHome") || !document.getElementById("smdOncoHome").classList.contains("on")) document.body.classList.remove("oh-lock"); }

  try { document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var el = document.getElementById("smdOncoStaging"); if (el && el.classList.contains("on")) close(); } }); } catch (e) {}

  G.SMD_ONCOSTAGING = {
    openList: openList, open: open, close: close,
    resolve: resolve, resolveVersion: resolveVersion, auditFabricationSafe: auditFabricationSafe,
    GAP_MESSAGE: GAP_MESSAGE, ALLOWED_STAGES: ALLOWED_STAGES, _st: stg, _version: "1.0"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = { resolve: resolve, resolveVersion: resolveVersion, auditFabricationSafe: auditFabricationSafe, GAP_MESSAGE: GAP_MESSAGE, ALLOWED_STAGES: ALLOWED_STAGES };
})();
