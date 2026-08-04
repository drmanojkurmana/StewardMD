/* sknx-report.js — SknX AI · educational report renderer + Explain-Like control + branded PDF/print.
 *
 * Pure rendering layer on top of `sknx-llm.js`'s reportPayload shape:
 *   { quality, visualFindings, differential:[{label,why,whyNot}], redFlags:[], discussion,
 *     guidelineSummary:[{point,source,url}], investigations:[], management:[], followup:[],
 *     references:[{source,title,url}], disclaimer }
 * `html(payload)` never invents content - every string comes straight from the payload (which itself
 * traces every citation back to the retrieved evidence, per sknx-llm.js's NO-HALLUCINATION contract).
 * All payload-derived text is HTML-escaped before being placed in markup (XSS-safe by construction).
 *
 * NO-RX (hard, mirrors sknx-llm.js): this module never renders a `sknx-rx` class and never emits the
 * words "prescription" / "prescribe" anywhere - the Management section is explicitly educational
 * principles only, labelled "Educational information only, not a treatment order."
 *
 * PDF/print path mirrors thorex-screens.js's exportHtmlDoc()/nativeShareHtml(): native (Capacitor) ->
 * VisionOcr.htmlToPdf via window.SMD_NATIVE.sharePdfFromHtml, falling back to sharing the raw HTML
 * file via Filesystem+Share; web -> a hidden iframe holding the branded document, then window.print().
 * Defensive throughout: in a DOM-less environment (e.g. this file's own node tests) pdf() detects the
 * absence of both the native bridge and `document` and simply no-ops - it never throws.
 *
 * Dual export: `window.SMD_SKNX_REPORT` in the browser, `module.exports` in node (tests).
 */
(function () {
  "use strict";

  function str(v) { return typeof v === "string" ? v : ""; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // Explain-Like audiences - duplicated here on purpose (not required from sknx-llm.js) so this
  // renderer stays dependency-free/pure, mirroring thorex-report.js's own duplication convention.
  // Test fixtures pin this list against SMD_SKNX_LLM.AUDIENCES so the two can never drift unnoticed.
  var AUDIENCES = ["mbbs", "intern", "resident", "consultant", "patient"];
  var AUDIENCE_LABELS = { mbbs: "MBBS", intern: "Intern", resident: "Resident", consultant: "Consultant", patient: "Patient" };

  /* ══════════════════════════════════ Section building blocks ═══════════════════════════════════ */
  function section(cls, title, bodyHtml) {
    return '<section class="sknx-report-section ' + cls + '"><h4 class="sknx-report-h">' + esc(title) + '</h4>' + bodyHtml + '</section>';
  }
  function listOf(items, cls) {
    var list = arr(items);
    if (!list.length) return '<p class="sknx-report-p sknx-report-empty">None reported.</p>';
    return '<ul class="sknx-report-list ' + (cls || "") + '">' + list.map(function (it) {
      return '<li>' + esc(str(it)) + '</li>';
    }).join("") + '</ul>';
  }

  function qualitySection(p) {
    return section("sknx-report-quality", "Quality", '<p class="sknx-report-p">' + esc(str(p.quality)) + '</p>');
  }
  function visualFindingsSection(p) {
    return section("sknx-report-visual", "Visual findings", '<p class="sknx-report-p">' + esc(str(p.visualFindings)) + '</p>');
  }
  function differentialSection(p) {
    var items = arr(p.differential);
    var body;
    if (!items.length) {
      body = '<p class="sknx-report-p sknx-report-empty">No differential could be ranked from the analyzed image.</p>';
    } else {
      body = '<ul class="sknx-report-differential">' + items.map(function (d) {
        return '<li class="sknx-report-ddx-item">' +
          '<div class="sknx-report-ddx-label">' + esc(str(d.label)) + '</div>' +
          '<div class="sknx-report-ddx-why"><b>Why it fits:</b> ' + esc(str(d.why)) + '</div>' +
          '<div class="sknx-report-ddx-whynot"><b>Why not / caveat:</b> ' + esc(str(d.whyNot)) + '</div>' +
        '</li>';
      }).join("") + '</ul>';
    }
    return section("sknx-report-differential-sec", "Differential", body);
  }
  function redFlagsSection(p) {
    return section("sknx-report-redflags", "Red flags", listOf(p.redFlags, "sknx-report-redflags-list"));
  }
  function discussionSection(p) {
    return section("sknx-report-discussion", "Educational discussion", '<p class="sknx-report-p">' + esc(str(p.discussion)) + '</p>');
  }
  function guidelineSection(p) {
    var items = arr(p.guidelineSummary);
    var body;
    if (!items.length) {
      body = '<p class="sknx-report-p sknx-report-empty">No guideline citations were retrieved for this analysis.</p>';
    } else {
      body = '<ul class="sknx-report-guideline">' + items.map(function (g) {
        var url = str(g.url);
        var link = url
          ? '<a class="sknx-cite" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(str(g.source)) + '</a>'
          : '<span class="sknx-cite sknx-cite-nolink">' + esc(str(g.source)) + '</span>';
        return '<li class="sknx-report-guideline-item"><span class="sknx-report-guideline-point">' + esc(str(g.point)) + '</span> ' + link + '</li>';
      }).join("") + '</ul>';
    }
    return section("sknx-report-guideline-sec", "Guideline summary", body);
  }
  function investigationsSection(p) {
    return section("sknx-report-investigations", "Investigations (educational)", listOf(p.investigations));
  }
  function managementSection(p) {
    var note = '<p class="sknx-report-mgmt-note">Educational information only, not a treatment order.</p>';
    return section("sknx-report-management", "Management (educational principles only)", note + listOf(p.management));
  }
  function followupSection(p) {
    return section("sknx-report-followup", "Follow-up", listOf(p.followup));
  }
  function referencesSection(p) {
    var items = arr(p.references);
    var body;
    if (!items.length) {
      body = '<p class="sknx-report-p sknx-report-empty">No references were retrieved for this analysis.</p>';
    } else {
      body = '<ul class="sknx-report-refs">' + items.map(function (r) {
        var url = str(r.url);
        var label = esc(str(r.title)) + ' (' + esc(str(r.source)) + ')';
        var link = url
          ? '<a class="sknx-cite sknx-report-ref-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
          : '<span class="sknx-cite sknx-cite-nolink">' + label + '</span>';
        return '<li>' + link + '</li>';
      }).join("") + '</ul>';
    }
    return section("sknx-report-references", "References", body);
  }
  function disclaimerSection(p) {
    return '<div class="sknx-report-disclaimer" role="note">' +
      '<strong class="sknx-report-disclaimer-label">Educational disclaimer</strong>' +
      '<p class="sknx-report-p">' + esc(str(p.disclaimer)) + '</p>' +
    '</div>';
  }

  /* ══════════════════════════════════════════ html() ═════════════════════════════════════════════ */
  function html(reportPayload) {
    var p = reportPayload || {};
    var out = '<div class="sknx-report">';
    out += '<h3 class="sknx-report-title">SknX AI - Educational skin report</h3>';
    out += qualitySection(p);
    out += visualFindingsSection(p);
    out += differentialSection(p);
    if (arr(p.redFlags).length) out += redFlagsSection(p);
    out += discussionSection(p);
    out += guidelineSection(p);
    out += investigationsSection(p);
    out += managementSection(p);
    out += followupSection(p);
    out += referencesSection(p);
    out += disclaimerSection(p);
    out += '</div>';
    return out;
  }

  /* ═══════════════════════════════════════ explainControls() ═════════════════════════════════════ */
  function explainControls() {
    var out = '<div class="sknx-explain-controls" role="tablist" aria-label="Explain like">';
    AUDIENCES.forEach(function (aud) {
      out += '<button class="sknx-explain-seg" type="button" role="tab" data-act="sknx-explain" data-audience="' + aud + '">' +
        esc(AUDIENCE_LABELS[aud] || aud) + '</button>';
    });
    out += '</div>';
    return out;
  }

  /* ═══════════════════════════ Branded document + PDF/print export ═══════════════════════════════
   * Mirrors thorex-screens.js's exportHtmlDoc()/nativeShareHtml() convention exactly (same native
   * bridge name, same fallback order) so the two modules feel identical to a developer reading both. */
  var BRAND_CSS =
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#eef2f4;color:#0f172a;font:400 13px/1.55 -apple-system,'Segoe UI',Roboto,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".sknx-pdf-page{max-width:820px;margin:14px auto;background:#fff;border:2px solid #b45309;border-radius:6px;overflow:hidden}" +
    ".sknx-pdf-hdr{display:flex;align-items:center;gap:14px;padding:16px 22px;background:linear-gradient(90deg,#b45309,#0f766e)}" +
    ".sknx-pdf-brand{font-weight:800;font-size:22px;letter-spacing:-.01em;color:#fff}" +
    ".sknx-pdf-tag{font-size:12px;font-weight:600;color:#fff;opacity:.92}" +
    ".sknx-pdf-rule{height:5px;background:repeating-linear-gradient(90deg,#b45309 0 18px,#fcd34d 18px 26px)}" +
    ".sknx-report{padding:4px 22px 18px}" +
    ".sknx-report-title{font-size:17px;text-align:center;margin:14px 0 6px;letter-spacing:.02em}" +
    ".sknx-report-h{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0f766e;border-bottom:1.5px solid #0f766e;padding-bottom:3px;margin:14px 0 8px}" +
    ".sknx-report-p{margin:0 0 8px;font-size:12.5px;color:#334155}" +
    ".sknx-report-list{margin:0 0 8px;padding-left:20px}.sknx-report-list li{margin-bottom:4px}" +
    ".sknx-report-differential{list-style:none;margin:0 0 4px;padding:0}" +
    ".sknx-report-ddx-item{margin-bottom:10px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px}" +
    ".sknx-report-ddx-label{font-weight:800;margin-bottom:2px}" +
    ".sknx-report-mgmt-note{font-size:11px;color:#64748b;font-style:italic;margin:0 0 6px}" +
    ".sknx-cite{color:#0f766e;text-decoration:underline}" +
    ".sknx-report-disclaimer{margin:14px 0 6px;padding:12px 14px;border:1.5px solid #b45309;background:#fffbeb;border-radius:8px;font-size:11.5px;line-height:1.5;color:#7c2d12}" +
    ".sknx-report-disclaimer-label{display:block;color:#b45309;margin-bottom:4px}" +
    "@page{margin:10mm}@media print{body{background:#fff}.sknx-pdf-page{margin:0;border:2px solid #b45309}}";

  function buildBrandedDocument(reportPayload) {
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>StewardMD - SknX educational skin report</title><style>' + BRAND_CSS + '</style></head><body>' +
      '<div class="sknx-pdf-page">' +
        '<div class="sknx-pdf-hdr"><div class="sknx-pdf-brand">StewardMD</div><div class="sknx-pdf-tag">SknX AI - Educational Skin Report</div></div>' +
        '<div class="sknx-pdf-rule"></div>' +
        html(reportPayload) +
      '</div></body></html>';
  }

  // Fallback: share the HTML document as a file (native builds without the PDF renderer plugin).
  function nativeShareHtml(docHtml, filename) {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.Filesystem && P.Filesystem.writeFile && P.Filesystem.getUri && P.Share && P.Share.share) {
        var name = filename + ".html";
        P.Filesystem.writeFile({ path: name, data: docHtml, directory: "CACHE", encoding: "utf8" })
          .then(function () { return P.Filesystem.getUri({ path: name, directory: "CACHE" }); })
          .then(function (r) { return P.Share.share({ title: "StewardMD - SknX educational skin report", files: [r.uri], dialogTitle: "Save as PDF / Print / Share" }); })
          .catch(function () {});
        return;
      }
    } catch (e) {}
  }

  // pdf(reportPayload) - native: render a real PDF via window.SMD_NATIVE.sharePdfFromHtml (same bridge
  // as thorex-screens.js), falling back to sharing the raw HTML file. Web: hidden-iframe print (the
  // browser print dialog offers "Save as PDF"). Defensive: no DOM / no native bridge (node tests) ->
  // no-op, never throws.
  function pdf(reportPayload) {
    try {
      var doc = buildBrandedDocument(reportPayload);
      var filename = "StewardMD-SknX-report".replace(/[^\w.-]+/g, "-");
      if (typeof window !== "undefined" && window.SMD_IS_NATIVE) {
        var N = window.SMD_NATIVE;
        if (N && typeof N.sharePdfFromHtml === "function") {
          var result = N.sharePdfFromHtml(doc, filename, "StewardMD - SknX educational skin report");
          if (result && typeof result.catch === "function") result.catch(function () { nativeShareHtml(doc, filename); });
          return result;
        }
        nativeShareHtml(doc, filename);
        return;
      }
      if (typeof document !== "undefined" && document.createElement) {
        var ifr = document.createElement("iframe");
        ifr.setAttribute("aria-hidden", "true");
        ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
        document.body.appendChild(ifr);
        var d = ifr.contentWindow.document; d.open(); d.write(doc); d.close();
        setTimeout(function () {
          try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {}
          setTimeout(function () { try { ifr.parentNode && ifr.parentNode.removeChild(ifr); } catch (e2) {} }, 1500);
        }, 350);
        return;
      }
    } catch (e) {}
    // No DOM and no native bridge (e.g. this module's own node tests) - intentionally a silent no-op.
  }

  var API = {
    html: html,
    explainControls: explainControls,
    pdf: pdf,
    buildBrandedDocument: buildBrandedDocument,
    AUDIENCES: AUDIENCES
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_REPORT = API;
})();
