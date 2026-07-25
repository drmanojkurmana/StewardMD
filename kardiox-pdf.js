/* kardiox-pdf.js — KardioX AI · digital ECG-PDF import (SMD_KARDIOX_PDF).
 *
 * The highest-trust input: a digital ECG PDF (Apple Watch, KardiaMobile, or a hospital/EMR 12-lead
 * export). Instead of photographing paper, the clinician imports the PDF; the backend extracts the
 * EXACT signal (vector) -> ECGFounder, or reads the device's OWN embedded measurements (12-lead), and
 * returns a result — no image-domain digitisation. Adds an "Import ECG PDF" action, POSTs the file to
 * the kardiox-pdf Cloud Run service, and shows the result. Flag `smd_kardiox_pdf` (default OFF).
 * Additive, defensive, node+browser. window.SMD_KARDIOX_PDF.
 */
(function () {
  "use strict";

  var PDF_URL = "https://kardiox-pdf-911280405587.us-central1.run.app/v1/ecg/analyze-pdf";

  function flagOn() {
    try {
      var F = window.SMD_KARDIOX_FLAGS;
      return !!(F && (typeof F.get === "function" ? F.get("smd_kardiox_pdf") : F.smd_kardiox_pdf));
    } catch (e) { return false; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function toast(m) { try { (window.SMD_toast || window.toast || function () {})(m); } catch (e) {} }
  function sevColor(s) {
    return ({ critical: "#B42332", urgent: "#C2410C", warn: "#996007", stable: "#1C7A4A", info: "#1D6FA3" })[s] || "#1D6FA3";
  }

  function analyze(blob) {
    var fd = new FormData();
    fd.append("image", blob, "ecg.pdf");
    return fetch(PDF_URL, { method: "POST", body: fd }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, json: j }; });
    });
  }

  function resultSheet(res) {
    if (typeof document === "undefined") return;
    var m = res.measurements || {};
    var rows = [["Rate", m.ventRateBpm, "bpm"], ["PR", m.prMs, "ms"], ["QRS", m.qrsMs, "ms"],
               ["QT", m.qtMs, "ms"], ["QTc", m.qtcMs, "ms"]].filter(function (r) { return r[1] != null; });
    var w = document.createElement("div"); w.className = "kx-pdf-sheet";
    w.innerHTML =
      '<div class="kx-pdf-card">' +
        '<div class="kx-pdf-strip" style="background:' + sevColor(res.severity) + '"></div>' +
        '<div class="kx-pdf-verdict">' + esc(res.verdict || "ECG") + '</div>' +
        '<div class="kx-pdf-eng">Digital ingestion · ' + esc(res.engine || "") + (res.confidence ? ' · ' + Math.round(res.confidence * 100) + '%' : '') + '</div>' +
        (rows.length ? '<div class="kx-pdf-meas">' + rows.map(function (r) { return '<span><b>' + r[0] + '</b> ' + esc(r[1]) + ' ' + r[2] + '</span>'; }).join('') + '</div>' : '') +
        (res.findings && res.findings.length ? '<ul class="kx-pdf-find">' + res.findings.slice(0, 6).map(function (f) { return '<li>' + esc(f.title) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="kx-pdf-interp">' + esc(res.clinicalInterpretation || "") + '</div>' +
        '<button class="kx-pdf-close" data-pdf="close">Close</button>' +
      '</div>';
    w.addEventListener("click", function (e) {
      if (e.target === w || (e.target.getAttribute && e.target.getAttribute("data-pdf") === "close")) { try { w.remove(); } catch (x) {} }
    });
    document.body.appendChild(w);
  }

  function open() {
    if (typeof document === "undefined") return;
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/pdf,.pdf"; inp.style.display = "none";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      toast("Reading ECG PDF…");
      analyze(f).then(function (r) {
        if (r.ok) resultSheet(r.json);
        else toast((r.json && r.json.detail) || "Could not read this ECG PDF");
      }).catch(function () { toast("Import failed — check connection"); })
        .then(function () { try { inp.remove(); } catch (e) {} });
    });
    document.body.appendChild(inp); inp.click();
  }

  function mount(root) {
    if (typeof document === "undefined" || !flagOn()) return;
    try {
      var host = document.getElementById("kardioxRoot");
      if (!host || !host.classList.contains("kx-open") || document.getElementById("kxPdfFab")) return;
      var fab = document.createElement("button");
      fab.id = "kxPdfFab"; fab.className = "kx-pdf-fab"; fab.type = "button";
      fab.innerHTML = "📄 Import ECG PDF";
      fab.addEventListener("click", open);
      host.appendChild(fab);
    } catch (e) {}
  }

  var API = { open: open, analyze: analyze, flagOn: flagOn, mount: mount };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") {
    window.SMD_KARDIOX_PDF = API;
    try {
      if (typeof MutationObserver !== "undefined") {
        var obs = new MutationObserver(function () { mount(document); });
        var start = function () { mount(document); try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {} };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
      }
    } catch (e) {}
  }
})();
