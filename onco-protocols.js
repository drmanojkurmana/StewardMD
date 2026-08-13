/* StewardMD - onco-protocols.js. Phase 3: the Tata-style drug x cycle dose MATRIX (the primary doctor
 * Oncology screen) + a read-only contextual dose-lineage DRAWER, both built from a treatment-plan
 * object already in state. PURE builders: no DOM, no fetch, no window (mirrors onco-dose.js / the
 * opd-emr.js esc()). Read-only over the plan - creating/persisting a plan is Phase 4.
 * window.SMD_ONCOUI + module.exports. */
(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ms(name) { return '<span class="material-symbols-outlined">' + name + "</span>"; }

  // drug.days (e.g. [1] or [1,2,3,4,5]) -> "D1" / "D1-5" / "D1,3,5" for a non-contiguous set.
  function dayMarker(days) {
    if (!days || !days.length) return "";
    if (days.length === 1) return "D" + days[0];
    var sorted = days.slice().sort(function (a, b) { return a - b; });
    var contiguous = sorted.every(function (d, i) { return i === 0 || d === sorted[i - 1] + 1; });
    return contiguous ? "D" + sorted[0] + "-" + sorted[sorted.length - 1] : "D" + sorted.join(",");
  }

  // Static protocol description for the "dose & administration" column, e.g. "375 mg/m2 IV, D1".
  function doseAdminText(drug) {
    drug = drug || {};
    var parts = [];
    if (drug.dosePerUnit != null) parts.push(drug.dosePerUnit + (drug.unit ? " " + drug.unit : ""));
    if (drug.route) parts.push(drug.route);
    var head = parts.join(" "), dm = dayMarker(drug.days);
    return head + (dm ? (head ? ", " : "") + dm : "");
  }

  // The engine's `final` is always an absolute mg dose (Calvert/BSA/mg-kg/flat all resolve to mg) -
  // never-invent: no lineage or no final -> "verify", never a guessed number.
  function doseText(lin) {
    if (!lin || lin.final == null) return "verify";
    return lin.final + " mg";
  }

  // Rows = plan.lockedTemplate.drugs, columns = cycles 1..plan.plannedCycles. Cell buttons carry
  // data-oe-act="onco-cell:<cycleNo>:<drugId>" (mirrors the labRow/radRow data-oe-act shape).
  function _buildOncoMatrix(plan) {
    plan = plan || {};
    var tmpl = plan.lockedTemplate || {};
    var drugs = tmpl.drugs || [];
    var cycles = Number(plan.plannedCycles) || 0;
    var doses = (plan.confirmedDoses && plan.confirmedDoses.length) ? plan.confirmedDoses : (plan.calculatedDoses || []);
    var doseByDrug = {};
    doses.forEach(function (d) { if (d && d.drugId) doseByDrug[d.drugId] = d; });

    var head = '<tr><th class="oe-onco-th">Drug</th><th class="oe-onco-th">Dose &amp; administration</th>';
    for (var c = 1; c <= cycles; c++) head += '<th class="oe-onco-th">Cycle ' + c + "</th>";
    head += "</tr>";

    var rows = drugs.map(function (drug) {
      drug = drug || {};
      var lin = doseByDrug[drug.id], dm = dayMarker(drug.days);
      var cells = '<td class="oe-onco-drug">' + esc(drug.name || drug.id || "") + "</td>" +
        '<td class="oe-onco-admin">' + esc(doseAdminText(drug)) + "</td>";
      for (var cy = 1; cy <= cycles; cy++) {
        cells += '<td class="oe-onco-cellwrap"><button class="oe-onco-cell" data-oe-act="onco-cell:' + cy + ":" + esc(drug.id) + '">' +
          '<span class="oe-onco-day">' + esc(dm) + "</span>" +
          '<span class="oe-onco-dose">' + esc(doseText(lin)) + "</span></button></td>";
      }
      return "<tr>" + cells + "</tr>";
    }).join("");

    return '<div class="oe-onco-scroll"><table class="oe-onco-tbl"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
  }

  function drawerRow(label, valueHtml, strong) {
    return '<div class="oe-onco-row' + (strong ? " oe-onco-row-final" : "") + '"><span class="oe-onco-row-l">' + esc(label) + "</span>" +
      '<span class="oe-onco-row-v">' + valueHtml + "</span></div>";
  }
  var BASIS_TXT = { bsa: "protocol dose x BSA", auc: "Calvert: AUC x (GFR capped at 125 + 25)", mgkg: "protocol dose x weight", flat: "flat dose (no calculation)" };

  // Read-only dose-lineage panel: protocol dose -> inputs -> calculation -> rounding -> modification ->
  // final confirmed dose -> warnings -> static [View protocol source] / [View audit trail] affordances.
  // No inputs, nothing here ever POSTs (drawer = clone of the st.report read-only drawer pattern).
  function doseDrawerView(drawer) {
    drawer = drawer || {};
    var drug = drawer.drug || {}, lin = drawer.lineage || {};
    var title = esc(drug.name || drawer.drugId || "Dose detail") + (drawer.cycleNo ? " &middot; Cycle " + esc(drawer.cycleNo) : "");

    var rows = drawerRow("Protocol dose", lin.protocolDose != null ? esc(lin.protocolDose + (drug.unit ? " " + drug.unit : "")) : "verify");
    if (lin.inputs && lin.inputs.bsa != null) rows += drawerRow("BSA", esc(lin.inputs.bsa) + " m2");
    if (lin.inputs && lin.inputs.gfr != null) rows += drawerRow("GFR (Cockcroft-Gault)", esc(lin.inputs.gfr) + " mL/min");
    if (lin.inputs && lin.inputs.weight != null) rows += drawerRow("Weight", esc(lin.inputs.weight) + " kg");
    rows += drawerRow("Calculation", lin.calculated != null ? esc(BASIS_TXT[lin.basis] || "calculation") + " = " + esc(lin.calculated) + " mg" : "verify - not computable");
    if (lin.rounded != null) rows += drawerRow("Rounding", esc(lin.calculated) + " mg &rarr; " + esc(lin.rounded) + " mg (protocol increment)");
    if (lin.modifiedReason) rows += drawerRow("Modification", "Physician override: " + esc(lin.modifiedReason));
    rows += drawerRow("Final " + (lin.modifiedReason ? "confirmed" : "calculated") + " dose", "<b>" + esc(doseText(lin)) + "</b>", true);

    var warn = "";
    if (lin.capApplied) warn += '<div class="oe-onco-warn">' + ms("warning") + "<span>A dose cap was applied.</span></div>";
    (lin.warnings || []).forEach(function (w) { warn += '<div class="oe-onco-warn">' + ms("warning") + "<span>" + esc(w) + "</span></div>"; });

    var actions = '<div class="oe-onco-drawer-actions">' +
      '<button class="oe-btn ghost" disabled>' + ms("description") + "View protocol source</button>" +
      '<button class="oe-btn ghost" disabled>' + ms("history") + "View audit trail</button></div>";

    return '<div class="oe-report oe-onco-drawer"><header class="oe-top">' +
      '<button class="oe-back" data-oe-act="onco-drawer-close" title="Back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      '<div class="oe-rep-title">' + title + "</div>" +
      '<button class="oe-close" data-oe-act="onco-drawer-close" title="Close" aria-label="Close">' + ms("close") + "</button></header>" +
      '<div class="oe-canvas">' + rows + warn + actions + "</div></div>";
  }

  var API = { _buildOncoMatrix: _buildOncoMatrix, doseDrawerView: doseDrawerView, _dayMarker: dayMarker, _doseAdminText: doseAdminText, _version: "1.0" };
  if (root) root.SMD_ONCOUI = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
