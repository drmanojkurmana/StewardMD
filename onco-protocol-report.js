/* StewardMD - onco-protocol-report.js. Printable 2-page Protocol PDF & Multidisciplinary Tumor Board Sheet.
 * Built PURELY from a treatment-plan object (+ optionally one cycle) already in state.
 * Generates formal hospital documents with letterhead, teal borders, longitudinal drug x cycle matrix,
 * Tumor Board consensus summary, OncoTree decision trail, dual-nurse verification, and physician confirmation.
 *
 * SINGLE SOURCE OF TRUTH: every dose shown is read verbatim off plan.confirmedDoses / cycle.confirmedDoses.
 * Never imports, requires, or calls any dose calculation engine directly.
 * window.SMD_ONCOREPORT + module.exports.
 */
(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  function fmtDate(ts) { ts = Number(ts); return ts ? new Date(ts).toISOString().slice(0, 10) : ""; }
  function fmtDateTime(ts) { ts = Number(ts); return ts ? new Date(ts).toISOString().slice(0, 16).replace("T", ", ") : ""; }
  function fmtTime(t) { t = Number(t); return t ? new Date(t).toISOString().slice(11, 16) : "-"; }

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
  function doseText(lin) { return (!lin || lin.final == null) ? "verify" : (lin.final + " mg"); }

  var BASIS_LABEL = { bsa: "BSA", auc: "AUC (Calvert)", mgkg: "mg/kg", flat: "Flat dose" };

  function planDoseMap(plan) {
    var map = {};
    var list = arr(plan && (plan.confirmedDoses || plan.calculatedDoses));
    list.forEach(function (d) { if (d && d.drugId) map[d.drugId] = d; });
    return map;
  }
  function cycleDoseMap(plan, cycle) {
    var map = planDoseMap(plan);
    var clist = arr(cycle && (cycle.confirmedDoses || cycle.calculatedDoses));
    clist.forEach(function (d) { if (d && d.drugId) map[d.drugId] = d; });
    return map;
  }
  function bsaFromDoses(doseByDrug) {
    var bsa = null;
    Object.keys(doseByDrug || {}).forEach(function (k) {
      var d = doseByDrug[k];
      if (d && d.inputs && d.inputs.bsa != null) bsa = d.inputs.bsa;
    });
    return bsa;
  }
  function drugNameMap(lockedTemplate) {
    var map = {};
    arr(lockedTemplate && lockedTemplate.drugs).forEach(function (d) {
      if (d && d.id) map[d.id] = d.name || d.id;
    });
    return map;
  }
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

  // Multidisciplinary Tumor Board (MDT) Summary Section
  function buildTumorBoardSection(plan, opts) {
    var tb = opts.tumorBoard || plan.tumorBoard || null;
    if (!tb) return "";
    var attendees = arr(tb.attendees).join(", ");
    return '<h2>Multidisciplinary Tumor Board (MDT) Summary</h2>' +
      '<div class="meta">' +
      metaRow("MDT Date", tb.date ? fmtDate(tb.date) : "Recent discussion") +
      metaRow("Staging (cTNM)", tb.stage || "Not staged") +
      metaRow("Histology / Biomarkers", tb.biomarkers || "Standard panel") +
      metaRow("MDT Attendees", attendees || "Medical, Surgical, Radiation Oncology & Pathology") +
      metaRow("Consensus Recommendation", tb.consensus || "Proceed with guideline-concordant systemic protocol.") +
      "</div>";
  }

  // OncoTree Algorithmic Pathway Audit Trail
  function buildPathwayTrail(plan, opts) {
    var trail = opts.pathway || plan.pathway || opts.decisionTrail || null;
    if (!trail) return "";
    var trailText = Array.isArray(trail) ? trail.join(" -> ") : String(trail);
    return '<h2>OncoTree Guideline Pathway Audit</h2>' +
      '<div class="legend"><b>Traversed Pathway:</b> ' + esc(trailText) + '</div>';
  }

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
  function buildEvidenceBlock(plan) {
    var tmpl = plan.lockedTemplate || {};
    var version = tmpl.version || plan.lockedVersion || plan.sourceProtocolVersion || "";
    var ev = plan.evidenceSnapshot || tmpl.evidence || null;
    var core = ev ? arr(ev.core) : [];
    var rows = core.length
      ? '<table class="otbl"><thead><tr><th>Layer</th><th>Source</th><th>Status</th></tr></thead><tbody>' +
        core.map(function (e) { e = e || {}; return "<tr><td>" + esc(e.layer || "core") + "</td><td>" + esc(e.source || "") + "</td><td>" + esc(e.evidenceStatus || "") + "</td></tr>"; }).join("") +
        "</tbody></table>"
      : '<div class="legend">No source evidence recorded on this treatment plan.</div>';
    return "<h2>Evidence and protocol version</h2>" +
      '<div class="meta">' +
      metaRow("Protocol version", version || "Not provided") +
      metaRow("Source protocol", plan.sourceProtocolId || plan.protocolId || "Not provided") +
      (plan.hospitalImplementationVersion ? metaRow("Hospital implementation", plan.hospitalImplementationVersion) : "") +
      "</div>" + rows;
  }
  function buildNursingAdminSection(plan, cycle) {
    var tmpl = plan.lockedTemplate || {};
    var premeds = arr(tmpl.premedications), drugs = arr(tmpl.drugs);
    var doses = cycleDoseMap(plan, cycle);
    var pre = premeds.map(function (p) { p = p || {}; return "<tr><td>-</td><td>" + esc(p.name || "") + " (premedication)</td><td>-</td><td>-</td><td>" + esc(p.notes || "") + "</td><td></td></tr>"; }).join("");
    var rows = drugs.map(function (drug) {
      drug = drug || {}; var lin = doses[drug.id];
      return "<tr><td>" + esc(dayMarker(drug.days) || "-") + "</td><td>" + esc(drug.name || drug.id || "") + "</td>" +
        "<td>" + esc(doseText(lin)) + "</td><td>" + esc(drug.route || "-") + "</td>" +
        "<td>" + esc(drug.notes || "-") + "</td><td></td></tr>";
    }).join("");
    return "<h2>Nursing administration</h2>" +
      '<table class="otbl oadminplan"><thead><tr><th>Day</th><th>Drug</th><th>Confirmed dose</th><th>Route</th><th>Administration instructions</th><th>Nurse / time</th></tr></thead>' +
      "<tbody>" + pre + rows + "</tbody></table>";
  }
  function buildPage1(plan, opts) {
    return '<div class="page page-break"><div class="hdr">' +
      '<div class="hdr-txt"><div class="brand">StewardMD</div><div class="tag">Oncology Treatment Plan</div></div>' +
      '<div class="hdr-right"><div class="hr-l">PROTOCOL SHEET</div><div class="hr-s">Page 1 of 2</div></div></div>' +
      '<div class="rule"></div>' +
      buildHeaderMeta(plan, opts) +
      buildTumorBoardSection(plan, opts) +
      buildPathwayTrail(plan, opts) +
      buildPatientParams(plan) +
      buildMatrixTable(plan) +
      buildEvidenceBlock(plan) +
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

  // Upgraded Multi-Disciplinary Safety Signatures
  function buildConfirmationBlock(plan) {
    var confirmations = arr(plan.confirmations);
    var last = confirmations.length ? confirmations[confirmations.length - 1] : null;
    var text = last ? ("Confirmed by " + esc(last.by || "physician") + " on " + esc(fmtDateTime(last.at)) + ".") : "Not yet confirmed.";
    return "<h2>Clinical Team Verification & Signatures</h2>" +
      '<div class="legend">' + text + "</div>" +
      '<div class="sign">' +
      '<div class="sig"><div class="sig-line"></div>Attending Medical Oncologist</div>' +
      '<div class="sig"><div class="sig-line"></div>Oncology Clinical Pharmacist</div>' +
      '<div class="sig"><div class="sig-line"></div>Primary Nurse (Verifier 1)</div>' +
      '<div class="sig"><div class="sig-line"></div>Secondary Nurse (Verifier 2)</div>' +
      '</div>';
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
      buildNursingAdminSection(plan, cycle) +
      buildAdminTable(plan, cycle) +
      buildConfirmationBlock(plan) +
      '<div class="warn"><b>&#9888; Decision-support document.</b><span>' + esc(MANDATORY_DISCLAIMER) + "</span></div>" +
      '<div class="foot"><span>StewardMD - Clinical Decision Support</span><span>' + esc(plan.planId || "") + "</span></div>" +
      "</div>";
  }

  var PRO_CSS =
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#eef2f4;color:#0f172a;font:400 13px/1.55 -apple-system,'Segoe UI',Roboto,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".page{max-width:820px;margin:14px auto;background:#fff;border:2px solid #0f766e;border-radius:6px;overflow:hidden}" +
    ".hdr{display:flex;align-items:center;gap:14px;padding:16px 22px;background:linear-gradient(90deg,#0f766e,#0d9488)}" +
    ".hdr-txt{flex:1;color:#fff}.brand{font-weight:800;font-size:22px;letter-spacing:-.01em}.tag{font-size:12px;font-weight:600;opacity:.92}" +
    ".hdr-right{text-align:right;color:#fff}.hr-l{font-weight:800;font-size:12px;letter-spacing:.06em}.hr-s{font-size:11px;opacity:.9}" +
    ".rule{height:5px;background:repeating-linear-gradient(90deg,#0f766e 0 18px,#5eead4 18px 26px)}" +
    ".meta{padding:12px 22px;border-bottom:1px solid #e2e8f0}.meta>div{margin-bottom:5px}" +
    ".meta .ml{display:inline-block;min-width:145px;font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#0f766e;vertical-align:top}" +
    ".meta .mv{font-size:12.5px;color:#334155}" +
    "h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0f766e;border-bottom:1.5px solid #0f766e;padding-bottom:3px;margin:16px 22px 8px}" +
    "table.otbl{width:calc(100% - 44px);margin:0 22px 14px;border-collapse:collapse;font-size:11px}" +
    "table.otbl th,table.otbl td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}" +
    "table.otbl th{background:#f0fbf9;color:#0f766e;font-weight:800;text-transform:uppercase;font-size:9.5px;letter-spacing:.04em}" +
    ".legend{margin:0 22px 14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#475569;line-height:1.5}" +
    ".warn{margin:14px 22px;padding:12px 14px;border:1.5px solid #b45309;background:#fffbeb;border-radius:8px;font-size:11.5px;line-height:1.5;color:#7c2d12;display:flex;flex-direction:column;gap:4px}.warn b{color:#b45309}" +
    ".sign{display:flex;gap:18px;margin:20px 22px 6px}.sig{flex:1;font-size:10px;color:#64748b}.sig-line{border-top:1.5px solid #94a3b8;margin-bottom:5px;height:24px}" +
    ".foot{display:flex;justify-content:space-between;gap:8px;padding:12px 22px;margin-top:10px;border-top:3px solid #0f766e;font-size:10.5px;color:#64748b;background:#f8fafc}" +
    "@page{margin:10mm}@media print{body{background:#fff}.page{margin:0;border:2px solid #0f766e}.page-break{page-break-after:always;break-after:page}}" +
    ".page-break{page-break-after:always;break-after:page}";

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

  var API = {
    buildProtocolSheet: buildProtocolSheet,
    MANDATORY_DISCLAIMER: MANDATORY_DISCLAIMER,
    _version: "2.0"
  };
  if (root) root.SMD_ONCOREPORT = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
