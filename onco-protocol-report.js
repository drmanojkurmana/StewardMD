/* StewardMD - onco-protocol-report.js. Phase 6: the printable 2-page Protocol PDF, built PURELY from
 * a treatment-plan object (+ optionally one cycle) already in state. Mirrors thorex-report.js's
 * buildProDocument: given `plan` + `opts` it returns one self-contained "<!doctype html>...</html>"
 * string, reusing the same PRO_CSS-style .page/@page/@media-print block so it prints as a formal
 * hospital document (letterhead, teal borders, signature block), not the app UI.
 *
 * SINGLE SOURCE OF TRUTH (non-negotiable): every dose shown is read verbatim off
 * plan.confirmedDoses / cycle.confirmedDoses (falling back to plan.calculatedDoses only when nothing
 * confirmed exists yet, the exact same fallback the doctor matrix in onco-protocols.js and the nurse
 * view in onco-nurse.js already use). This file never imports, requires, or calls the pure
 * dose-calculation engine (the sibling module one directory up whose window global starts with
 * "SMD_ONCO" + "DOSE") and never recomputes a dose - a unit test greps this file's own source to
 * enforce that, same discipline onco-nurse.js already proves for the dose engine.
 *
 * PAGE 1 - Protocol matrix: header (patient, MRN, diagnosis, intent, protocol name + version, planned
 * cycles, treatment-plan id, start date, status), patient parameters (height, weight, BSA), the
 * longitudinal drug x cycle matrix (day markers + confirmed dose per drug), a legend/schedule/safety
 * note.
 * PAGE 2 - Cycle detail: cycle header, pre-chemo clearance table, dose-calculation trace/lineage
 * (drug, basis, inputs, calculated, rounding/modification, final confirmed), nursing administration
 * record, physician confirmation block, and the mandatory safety disclaimer.
 *
 * A few small pure helpers (dayMarker, doseAdminText, doseText) are duplicated here rather than
 * required from onco-protocols.js - kept as independent literals so this module stays
 * dependency-free/pure, mirroring thorex-report.js's own duplication discipline (see its
 * MANDATORY_DISCLAIMER comment) and onco-nurse.js's "never import the sibling module" rule.
 *
 * window.SMD_ONCOREPORT + module.exports. */
(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  // Deterministic date formatting (no Intl/locale/timezone variance, matches onco-nurse.js fmtTime).
  function fmtDate(ts) { ts = Number(ts); return ts ? new Date(ts).toISOString().slice(0, 10) : ""; }
  function fmtDateTime(ts) { ts = Number(ts); return ts ? new Date(ts).toISOString().slice(0, 16).replace("T", ", ") : ""; }
  function fmtTime(t) { t = Number(t); return t ? new Date(t).toISOString().slice(11, 16) : "-"; }

  // ---- duplicated pure helpers (see file header for why) --------------------------------------
  function dayMarker(days) {
    if (!days || !days.length) return "";
    if (days.length === 1) return "D" + days[0];
    var sorted = days.slice().sort(function (a, b) { return a - b; });
    var contiguous = sorted.every(function (d, i) { return i === 0 || d === sorted[i - 1] + 1; });
    return contiguous ? "D" + sorted[0] + "-" + sorted[sorted.length - 1] : "D" + sorted.join(",");
  }
  function doseAdminText(drug) {
    drug = drug || {};
    var parts = [];
    if (drug.dosePerUnit != null) parts.push(drug.dosePerUnit + (drug.unit ? " " + drug.unit : ""));
    if (drug.route) parts.push(drug.route);
    var head = parts.join(" "), dm = dayMarker(drug.days);
    return head + (dm ? (head ? ", " : "") + dm : "");
  }
  // Never-invent: no lineage or no final -> "verify", never a guessed number.
  function doseText(lin) { return (!lin || lin.final == null) ? "verify" : (lin.final + " mg"); }

  var BASIS_LABEL = { bsa: "BSA", auc: "AUC (Calvert)", mgkg: "mg/kg", flat: "Flat dose" };

  // Effective dose lineage per drug for the PLAN (spans every cycle column on page 1): confirmed
  // wins, calculated is the never-invent fallback for a plan that has not been confirmed yet.
  function planDoseMap(plan) {
    var doses = (plan.confirmedDoses && plan.confirmedDoses.length) ? plan.confirmedDoses : (plan.calculatedDoses || []);
    var m = {};
    doses.forEach(function (d) { if (d && d.drugId) m[d.drugId] = d; });
    return m;
  }
  // Effective dose lineage for ONE cycle (page 2 lineage trace): cycle's own confirmedDoses first,
  // then the plan's, then calculated - the exact fallback chain onco-nurse.js's giveList() uses.
  function cycleDoseMap(plan, cycle) {
    cycle = cycle || {};
    var doses = (cycle.confirmedDoses && cycle.confirmedDoses.length) ? cycle.confirmedDoses
      : (plan.confirmedDoses && plan.confirmedDoses.length) ? plan.confirmedDoses
      : (plan.calculatedDoses || []);
    var m = {};
    doses.forEach(function (d) { if (d && d.drugId) m[d.drugId] = d; });
    return m;
  }
  function drugNameMap(tmpl) {
    var m = {};
    arr(tmpl && tmpl.drugs).forEach(function (d) { if (d && d.id) m[d.id] = d.name || d.id; });
    return m;
  }
  // BSA already computed and stored on a dose lineage entry (never a fresh computation - just a read
  // of a value the engine already produced and the plan already carries).
  function bsaFromDoses(doseMap) {
    for (var k in doseMap) {
      if (doseMap.hasOwnProperty(k) && doseMap[k] && doseMap[k].inputs && doseMap[k].inputs.bsa != null) return doseMap[k].inputs.bsa;
    }
    return null;
  }
  // Most recent override on file for a drug (plan.physicianModifications, appended in order).
  function overrideFor(plan, drugId) {
    var mods = arr(plan.physicianModifications), found = null;
    mods.forEach(function (m) { if (m && m.drugId === drugId) found = m; });
    return found;
  }

  var MANDATORY_DISCLAIMER =
    "StewardMD is clinical decision-support software. This document is generated directly from the " +
    "stored treatment plan and shows only what has been entered and confirmed there. It does not " +
    "replace clinical judgment. Every dose, cycle and administration record on this sheet must be " +
    "reviewed and confirmed by the responsible clinician before any action is taken.";

  /* ═══════════════════════════════════════ PAGE 1 ═══════════════════════════════════════════════ */

  function metaRow(label, value) {
    return '<div><span class="ml">' + esc(label) + '</span><span class="mv">' + esc(value) + "</span></div>";
  }
  function buildHeaderMeta(plan, opts) {
    var tmpl = plan.lockedTemplate || {};
    var protoName = tmpl.name || plan.protocolId || "Not provided";
    var version = tmpl.version || plan.lockedVersion || "";
    var startDate = (plan.plannedDates && plan.plannedDates.length) ? fmtDate(plan.plannedDates[0]) : (plan.createdAt ? fmtDate(plan.createdAt) : "");
    return '<div class="meta">' +
      metaRow("Patient", str(opts.patientName) || "Not provided") +
      metaRow("MRN", str(plan.ghisPatientId) || "Not provided") +
      metaRow("Diagnosis", str(opts.diagnosis) || "Not provided") +
      metaRow("Intent", str(plan.intent) || "Not provided") +
      metaRow("Protocol", protoName + (version ? " (version " + version + ")" : "")) +
      metaRow("Planned cycles", plan.plannedCycles != null ? String(plan.plannedCycles) : "Not provided") +
      metaRow("Treatment plan ID", plan.planId || "Not provided") +
      metaRow("Start date", startDate || "Not provided") +
      metaRow("Status", plan.status || "Not provided") +
      "</div>";
  }
  function buildPatientParams(plan) {
    var pp = plan.patientParams || {};
    var bsa = pp.bsa != null ? pp.bsa : bsaFromDoses(planDoseMap(plan));
    return '<h2>Patient parameters</h2>' +
      '<div class="meta">' +
      metaRow("Height", pp.height != null ? pp.height + " cm" : "Not provided") +
      metaRow("Weight", pp.weight != null ? pp.weight + " kg" : "Not provided") +
      metaRow("BSA", bsa != null ? bsa + " m2" : "Not provided") +
      "</div>";
  }
  // The Tata-style drug x cycle matrix, same shape/values as onco-protocols.js's _buildOncoMatrix
  // (one row per drug, one column per cycle, the SAME confirmed dose repeated across every cycle
  // column - v1 does not model a per-cycle dose change, matching the app exactly).
  function buildMatrixTable(plan) {
    var tmpl = plan.lockedTemplate || {};
    var drugs = arr(tmpl.drugs);
    var cycles = Number(plan.plannedCycles) || 0;
    var doseByDrug = planDoseMap(plan);
    var head = "<tr><th>Drug</th><th>Dose and administration</th>";
    for (var c = 1; c <= cycles; c++) head += "<th>Cycle " + c + "</th>";
    head += "</tr>";
    var rows = drugs.map(function (drug) {
      drug = drug || {};
      var lin = doseByDrug[drug.id];
      var row = "<tr><td>" + esc(drug.name || drug.id || "") + "</td><td>" + esc(doseAdminText(drug)) + "</td>";
      for (var cy = 1; cy <= cycles; cy++) row += "<td>" + esc(dayMarker(drug.days)) + " &middot; " + esc(doseText(lin)) + "</td>";
      return row + "</tr>";
    }).join("");
    return '<h2>Protocol matrix</h2><table class="otbl omatrix"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table>";
  }
  function buildLegend(plan) {
    var tmpl = plan.lockedTemplate || {};
    var cadence = tmpl.cycleLengthDays ? "Cycle length: " + tmpl.cycleLengthDays + " days per protocol." : "";
    return '<div class="legend"><b>Legend.</b> Day markers (e.g. D1, D1-5) show the protocol day within a cycle. ' +
      "Doses shown are the physician-confirmed final dose for each drug, applied across all planned " +
      "cycles unless a cycle-specific modification is on file (see Cycle detail, page 2). " +
      '"verify" means a dose could not be computed from the data on file and must be confirmed manually before use. ' +
      esc(cadence) + "</div>";
  }
  function buildPage1(plan, opts) {
    return '<div class="page page-break"><div class="hdr">' +
      '<div class="hdr-txt"><div class="brand">StewardMD</div><div class="tag">Oncology Treatment Plan</div></div>' +
      '<div class="hdr-right"><div class="hr-l">PROTOCOL SHEET</div><div class="hr-s">Page 1 of 2</div></div></div>' +
      '<div class="rule"></div>' +
      buildHeaderMeta(plan, opts) +
      buildPatientParams(plan) +
      buildMatrixTable(plan) +
      buildLegend(plan) +
      '<div class="foot"><span>StewardMD - Oncology Treatment Plan</span><span>' + esc(plan.protocolId || "") + "</span></div>" +
      "</div>";
  }

  /* ═══════════════════════════════════════ PAGE 2 ═══════════════════════════════════════════════ */

  function buildCycleHeader(plan, cycle) {
    if (!cycle) return '<div class="legend">No cycle has been created for this treatment plan yet.</div>';
    return '<div class="meta">' +
      metaRow("Cycle", cycle.cycleNo != null ? "Cycle " + cycle.cycleNo + " of " + (plan.plannedCycles || "?") : "Not provided") +
      metaRow("Day", cycle.day != null ? String(cycle.day) : "Not provided") +
      metaRow("Planned date", cycle.plannedDate ? fmtDate(cycle.plannedDate) : "Not provided") +
      metaRow("State", cycle.state || "Not provided") +
      "</div>";
  }
  function buildClearanceTable(cycle) {
    if (!cycle) return "";
    var c = cycle.clearance || {};
    var rows = "<tr><th>Status</th><th>Resolved by</th><th>Resolved</th></tr>" +
      "<tr><td>" + esc(c.status || "pending") + "</td><td>" + esc(c.resolvedBy || "-") + "</td><td>" + esc(c.resolvedAt ? fmtDateTime(c.resolvedAt) : "-") + "</td></tr>";
    var checks = arr(c.checks);
    var checksTbl = checks.length
      ? '<table class="otbl"><thead><tr><th>Check</th><th>Status</th></tr></thead><tbody>' +
        checks.map(function (ch) { return "<tr><td>" + esc((ch && ch.name) || "") + "</td><td>" + esc((ch && ch.status) || "") + "</td></tr>"; }).join("") +
        "</tbody></table>"
      : '<div class="legend">No clearance checks recorded.</div>';
    return "<h2>Pre-chemo clearance</h2>" +
      '<table class="otbl"><tbody>' + rows + "</tbody></table>" + checksTbl;
  }
  function modificationText(plan, d) {
    d = d || {};
    if (d.modifiedReason) {
      var ov = overrideFor(plan, d.drugId);
      var was = ov && ov.was != null ? esc(ov.was) + " mg to " : "";
      return "Physician override: " + esc(d.modifiedReason) + ". " + was + esc(d.final) + " mg.";
    }
    if (d.capApplied) return "Dose cap applied by protocol/drug rule.";
    if (d.rounded != null && d.calculated != null && d.rounded !== d.calculated) {
      return esc(d.calculated) + " mg &rarr; " + esc(d.rounded) + " mg (protocol rounding).";
    }
    return "No rounding or modification recorded.";
  }
  function buildLineageTable(plan, cycle) {
    var tmpl = plan.lockedTemplate || {};
    var names = drugNameMap(tmpl);
    var doses = cycleDoseMap(plan, cycle);
    var drugs = arr(tmpl.drugs);
    if (!drugs.length) return '<div class="legend">No drugs on file for this protocol.</div>';
    var rows = drugs.map(function (drug) {
      var d = doses[drug.id] || {};
      var inputsParts = [];
      if (d.inputs && d.inputs.bsa != null) inputsParts.push("BSA " + esc(d.inputs.bsa) + " m2");
      if (d.inputs && d.inputs.gfr != null) inputsParts.push("GFR " + esc(d.inputs.gfr) + " mL/min");
      if (d.inputs && d.inputs.weight != null) inputsParts.push("Weight " + esc(d.inputs.weight) + " kg");
      var inputsHtml = inputsParts.length ? inputsParts.join(", ") : "-";
      var calcHtml = d.calculated != null ? esc(d.calculated) + " mg" : "verify";
      return "<tr><td>" + esc(names[drug.id] || drug.id) + "</td>" +
        "<td>" + esc(BASIS_LABEL[d.basis || drug.basis] || d.basis || drug.basis || "") + "</td>" +
        "<td>" + inputsHtml + "</td>" +
        "<td>" + calcHtml + "</td>" +
        "<td>" + modificationText(plan, d) + "</td>" +
        "<td><b>" + esc(doseText(d)) + "</b></td></tr>";
    }).join("");
    return "<h2>Dose-calculation trace</h2>" +
      '<table class="otbl olineage"><thead><tr><th>Drug</th><th>Basis</th><th>Inputs</th><th>Calculated</th><th>Rounding / modification</th><th>Final confirmed</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table>";
  }
  function buildAdminTable(plan, cycle) {
    var tmpl = plan.lockedTemplate || {};
    var names = drugNameMap(tmpl);
    var recs = arr(cycle && cycle.administrationSequence);
    if (!recs.length) return "<h2>Nursing administration record</h2>" + '<div class="legend">No administration recorded yet.</div>';
    var rows = recs.map(function (r, i) {
      r = r || {};
      var finalMg = (r.planned && r.planned.final != null) ? esc(r.planned.final) + " mg" : "verify";
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(names[r.drugId] || r.drugId || "") + "</td>" +
        "<td>" + finalMg + "</td><td>" + (r.actual != null ? esc(r.actual) + " mg" : "-") + "</td>" +
        "<td>" + esc(fmtTime(r.startTime)) + "</td><td>" + esc(fmtTime(r.endTime)) + "</td>" +
        "<td>" + esc(r.administeredBy || "-") + "</td><td>" + esc(r.reaction || "none") + "</td></tr>";
    }).join("");
    return "<h2>Nursing administration record</h2>" +
      '<table class="otbl oadmin"><thead><tr><th>Seq</th><th>Drug</th><th>Final confirmed</th><th>Actual</th><th>Start</th><th>End</th><th>Nurse</th><th>Reaction</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table>";
  }
  function buildConfirmationBlock(plan) {
    var confirmations = arr(plan.confirmations);
    var last = confirmations.length ? confirmations[confirmations.length - 1] : null;
    var text = last ? ("Confirmed by " + esc(last.by || "physician") + " on " + esc(fmtDateTime(last.at)) + ".") : "Not yet confirmed.";
    return "<h2>Physician confirmation</h2>" +
      '<div class="legend">' + text + "</div>" +
      '<div class="sign"><div class="sig"><div class="sig-line"></div>Physician signature</div>' +
      '<div class="sig"><div class="sig-line"></div>Date</div></div>';
  }
  function buildPage2(plan, cycle) {
    return '<div class="page"><div class="hdr">' +
      '<div class="hdr-txt"><div class="brand">StewardMD</div><div class="tag">Oncology Treatment Plan</div></div>' +
      '<div class="hdr-right"><div class="hr-l">PROTOCOL SHEET</div><div class="hr-s">Page 2 of 2</div></div></div>' +
      '<div class="rule"></div>' +
      "<h2>Cycle detail</h2>" +
      buildCycleHeader(plan, cycle) +
      buildClearanceTable(cycle) +
      buildLineageTable(plan, cycle) +
      buildAdminTable(plan, cycle) +
      buildConfirmationBlock(plan) +
      '<div class="warn"><b>&#9888; Decision-support document.</b><span>' + esc(MANDATORY_DISCLAIMER) + "</span></div>" +
      '<div class="foot"><span>StewardMD - Clinical Decision Support</span><span>' + esc(plan.planId || "") + "</span></div>" +
      "</div>";
  }

  /* ═══════════════════════════════ shared print CSS (reused from thorex-report.js) ═══════════════
   * Same .page/@page/@media-print block as thorex-report.js's PRO_CSS (letterhead, teal borders,
   * signature block), with a small table/legend/page-break extension for the matrix and record
   * tables this document needs that the chest-x-ray report did not. */
  var PRO_CSS =
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#eef2f4;color:#0f172a;font:400 13px/1.55 -apple-system,'Segoe UI',Roboto,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".page{max-width:820px;margin:14px auto;background:#fff;border:2px solid #0f766e;border-radius:6px;overflow:hidden}" +
    ".hdr{display:flex;align-items:center;gap:14px;padding:16px 22px;background:linear-gradient(90deg,#0f766e,#0d9488)}" +
    ".hdr-txt{flex:1;color:#fff}.brand{font-weight:800;font-size:22px;letter-spacing:-.01em}.tag{font-size:12px;font-weight:600;opacity:.92}" +
    ".hdr-right{text-align:right;color:#fff}.hr-l{font-weight:800;font-size:12px;letter-spacing:.06em}.hr-s{font-size:11px;opacity:.9}" +
    ".rule{height:5px;background:repeating-linear-gradient(90deg,#0f766e 0 18px,#5eead4 18px 26px)}" +
    ".meta{padding:12px 22px;border-bottom:1px solid #e2e8f0}.meta>div{margin-bottom:5px}" +
    ".meta .ml{display:inline-block;min-width:130px;font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#0f766e;vertical-align:top}" +
    ".meta .mv{font-size:12.5px;color:#334155}" +
    "h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0f766e;border-bottom:1.5px solid #0f766e;padding-bottom:3px;margin:16px 22px 8px}" +
    "table.otbl{width:calc(100% - 44px);margin:0 22px 14px;border-collapse:collapse;font-size:11px}" +
    "table.otbl th,table.otbl td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}" +
    "table.otbl th{background:#f0fbf9;color:#0f766e;font-weight:800;text-transform:uppercase;font-size:9.5px;letter-spacing:.04em}" +
    ".legend{margin:0 22px 14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#475569;line-height:1.5}" +
    ".warn{margin:14px 22px;padding:12px 14px;border:1.5px solid #b45309;background:#fffbeb;border-radius:8px;font-size:11.5px;line-height:1.5;color:#7c2d12;display:flex;flex-direction:column;gap:4px}.warn b{color:#b45309}" +
    ".sign{display:flex;gap:30px;margin:20px 22px 6px}.sig{flex:1;font-size:11px;color:#64748b}.sig-line{border-top:1.5px solid #94a3b8;margin-bottom:5px;height:24px}" +
    ".foot{display:flex;justify-content:space-between;gap:8px;padding:12px 22px;margin-top:10px;border-top:3px solid #0f766e;font-size:10.5px;color:#64748b;background:#f8fafc}" +
    "@page{margin:10mm}@media print{body{background:#fff}.page{margin:0;border:2px solid #0f766e}.page-break{page-break-after:always;break-after:page}}" +
    ".page-break{page-break-after:always;break-after:page}";

  // buildProtocolSheet(plan, opts) -> one full "<!doctype html>...</html>" string. Pure: no wall-clock
  // read inside (mirrors thorex-report.js's buildProDocument taking opts.createdAt from the caller
  // instead of calling Date.now() itself). opts: { cycle, patientName, diagnosis }.
  function buildProtocolSheet(plan, opts) {
    plan = plan || {};
    opts = opts || {};
    var cycle = opts.cycle || null;
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>StewardMD - Treatment Plan Protocol Sheet</title><style>' + PRO_CSS + '</style></head><body>' +
      buildPage1(plan, opts) +
      buildPage2(plan, cycle) +
      "</body></html>";
  }

  var API = { buildProtocolSheet: buildProtocolSheet, MANDATORY_DISCLAIMER: MANDATORY_DISCLAIMER, _version: "1.0" };
  if (root) root.SMD_ONCOREPORT = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
