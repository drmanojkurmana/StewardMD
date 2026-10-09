/* Schema v2 disease content (flowcharts, value tables) for the Knowledge Library disease reader.
 *
 * ON for everyone (owner 2026-10-09: app is tester-only). Per-device kill switch: ?kbv2=0 (persists as
 * localStorage smd_kb_v2 = "0"); ?kbv2=1 turns it back on.
 * reasoning.js emits <div class="kbv2-slot" data-kbv2-id="ID"></div> only when SMD_KBV2_ON is true.
 * This file watches for those slots, fetches the one bucket that holds the id, and renders it with
 * kb-flowchart.js and kb-highyield.js.
 */
(function () {
  "use strict";
  var on = true;
  try {
    var q = new URLSearchParams(location.search).get("kbv2");
    if (q === "0") localStorage.setItem("smd_kb_v2", "0");
    if (q === "1") localStorage.removeItem("smd_kb_v2");
    on = localStorage.getItem("smd_kb_v2") !== "0";
  } catch (e) { on = true; }
  window.SMD_KBV2_ON = on;
  if (!on) return;

  var BUCKETS = 64;
  var cache = {};
  function bucketOf(id) {
    var h = 5381;
    for (var i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
    return h % BUCKETS;
  }
  function load(id) {
    var b = bucketOf(id);
    if (!cache[b]) {
      cache[b] = fetch("/kb/dist/v2/b" + (b < 10 ? "0" : "") + b + ".json?v=kbv22")
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return cache[b].then(function (all) { return all[id] || null; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function hy(t) { return window.KBHy ? window.KBHy.html(t || "") : esc(t || ""); }

  var KIND = { diagnostic: "Diagnostic criteria and key values", ddx: "Differential diagnosis", treatment: "Treatment" };
  function render(x) {
    var cites = {};
    (x.citations || []).forEach(function (c) { cites[c.id] = c.label || c.id; });
    var html = "";
    (x.flowcharts || []).forEach(function (fc) {
      if (!window.KBFlowchart) return;
      html += '<section class="kbv2-sec"><h3 class="kbv2-h">Flowchart: ' + esc(fc.title || "") + "</h3>" + window.KBFlowchart.render(fc) + "</section>";
    });
    (x.valueTables || []).forEach(function (vt) {
      var cols = (vt.columns || []).slice();
      if (cols.length && String(cols[0]).toLowerCase() === "parameter") cols = cols.slice(1);
      var head = "<th>" + esc(vt.rowHeader || "Item") + "</th>" + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "<th>Source</th>";
      var rows = (vt.rows || []).map(function (r) {
        return '<tr><th scope="row">' + esc(r.parameter || "") + (r.unit ? '<span class="kbv2-unit">' + esc(r.unit) + "</span>" : "") + "</th>" +
          (r.cells || []).map(function (c) {
            var pend = String(c.text || "").indexOf("needs-source") >= 0 ? ' class="kbv2-pending"' : "";
            return "<td" + pend + ">" + hy(c.text) + "</td>";
          }).join("") + '<td class="kbv2-cite">' + esc(cites[r.cite] || r.cite || "") + "</td></tr>";
      }).join("");
      html += '<section class="kbv2-sec"><h3 class="kbv2-h">' + esc(KIND[vt.kind] || "Table") + ": " + esc(vt.title || "") + "</h3>" +
        '<div class="kbv2-scroll"><table class="kbv2-tbl"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
        (vt.footnote ? '<p class="kbv2-foot">' + hy(vt.footnote) + "</p>" : "") + "</section>";
    });
    if (html) html += '<p class="kbv2-foot">AI-drafted from cited sources. Not clinician reviewed.</p>';
    return html;
  }
  function fill(slot) {
    if (slot.getAttribute("data-kbv2-done")) return;
    slot.setAttribute("data-kbv2-done", "1");
    load(slot.getAttribute("data-kbv2-id")).then(function (x) { if (x) slot.innerHTML = render(x); });
  }
  function scan(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    if (rootEl.matches && rootEl.matches(".kbv2-slot")) fill(rootEl);
    rootEl.querySelectorAll(".kbv2-slot").forEach(fill);
  }
  new MutationObserver(function (muts) {
    muts.forEach(function (m) { m.addedNodes.forEach(scan); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () { scan(document.body); });

  var css = document.createElement("style");
  css.textContent = ".kbv2-sec{margin:16px 0}.kbv2-h{font-size:15px;margin:0 0 8px}" +
    ".kbv2-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}" +
    ".kbv2-tbl{border-collapse:collapse;width:100%;min-width:480px;font-size:13px;font-variant-numeric:tabular-nums}" +
    ".kbv2-tbl th,.kbv2-tbl td{border:1px solid rgba(127,127,127,.35);padding:6px 8px;text-align:left;vertical-align:top}" +
    ".kbv2-unit{display:block;font-weight:400;opacity:.75;font-size:11px}.kbv2-cite{font-size:11px;opacity:.8}" +
    ".kbv2-pending{font-style:italic;background:rgba(200,120,0,.12)}.kbv2-foot{font-size:12px;opacity:.8;margin:6px 0 0}" +
    ".kb-hy{font-weight:700;text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.18em}" +
    ".kbfc-wrap{background:#fff;border-radius:8px;padding:8px}";
  document.head.appendChild(css);
})();
