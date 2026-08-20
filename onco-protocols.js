/* StewardMD - onco-protocols.js. Phase 3: the Tata-style drug x cycle dose MATRIX (the primary doctor
 * Oncology screen) + a read-only contextual dose-lineage DRAWER, both built from a treatment-plan
 * object already in state. PURE builders: no DOM, no fetch, no window (mirrors onco-dose.js / the
 * opd-emr.js esc()). Read-only over the plan - creating/persisting a plan is Phase 4.
 * window.SMD_ONCOUI + module.exports. */
(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
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
    var freq = drug.frequency || (drug.dosesPerDay > 1 ? ({ 2: "BID", 3: "TID", 4: "QID" }[drug.dosesPerDay] || drug.dosesPerDay + "x/day") : "");
    if (freq) parts.push(freq);
    var head = parts.join(" "), dm = dayMarker(drug.days);
    return head + (dm ? (head ? ", " : "") + dm : "");
  }

  // The engine's `final` is always an absolute mg dose (Calvert/BSA/mg-kg/flat all resolve to mg) -
  // never-invent: no lineage or no final -> "verify", never a guessed number.
  function doseText(lin) {
    if (!lin || lin.final == null) return "verify";
    if (lin.dosesPerDay > 1 && lin.dailyDose != null) return lin.final + " mg x" + lin.dosesPerDay + "/day = " + lin.dailyDose + " mg/day";
    return lin.final + " mg";
  }

  // Rows = plan.lockedTemplate.drugs, columns = cycles 1..plan.plannedCycles. Cell buttons carry
  // data-oe-act="onco-cell:<cycleNo>:<drugId>" (mirrors the labRow/radRow data-oe-act shape).
  function _buildOncoMatrix(plan) {
    plan = plan || {};
    var tmpl = plan.lockedTemplate || {};
    var drugs = tmpl.drugs || [];
    var cycles = Math.min(60, Number(plan.plannedCycles) || 0);  // ceiling guards a bad plannedCycles
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
        // Optional per-cycle scheduling: when a drug carries a `cycles` list (a UI-only field the
        // patient-specific digital protocol may set - the Standard Protocol schema forbids it), a
        // cycle not in that list renders "X / Not scheduled". Absent `cycles` => present every cycle
        // (byte-identical to the legacy path, so every existing plan/test is unchanged).
        if (drug.cycles && drug.cycles.indexOf(cy) < 0) {
          cells += '<td class="oe-onco-cellwrap"><div class="oe-onco-cell oe-onco-cell-ns" aria-disabled="true">' +
            '<span class="oe-onco-day">X</span><span class="oe-onco-dose">Not scheduled</span></div></td>';
          continue;
        }
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

  // ---- Phase 4: apply-protocol suggestion list + review/override panel ---------------------------
  // Still PURE (no DOM, no fetch) - staging into st.oncoDraft and the actual create/confirm POSTs
  // live entirely in opd-emr.js. Visually mirrors the aiGroup/scribeRow suggestion primitive (same
  // oe-ai-* CSS classes) without importing opd-emr.js's private closures.

  // ONLY "active" protocols may ever be offered - R-CHOP ships lifecycleState "draft" on purpose
  // (activation is a separate owner/R1 governance step). Filters defensively even when the caller
  // (opd-emr.js) already filtered, so this builder is safe to call directly, from anywhere, forever.
  function _buildApplyPanel(protocols) {
    var active = (protocols || []).filter(function (p) { return p && p.lifecycleState === "active"; });
    if (!active.length) return "";
    var rows = active.map(function (p) {
      return '<div class="oe-ai-row"><div class="oe-ai-main"><div class="oe-ai-label">' + esc(p.name || p.id) +
        (p.version ? '<span class="oe-ai-score">v' + esc(p.version) + "</span>" : "") + "</div></div>" +
        '<button class="oe-ai-accept" data-oe-act="onco-apply:' + esc(p.id) + '">' + ms("add") + "Apply</button></div>";
    }).join("");
    return '<section class="oe-ai-panel"><div class="oe-ai-group"><div class="oe-ai-ghead"><h4>Oncology protocol</h4></div>' + rows + "</div></section>";
  }

  // One review line: the current EFFECTIVE dose (an active override wins over the calculated
  // lineage), a "verify" badge when the lineage is not computable (never-invent - no fabricated
  // number), and an inline edit affordance (a dose input + a REQUIRED reason input) wired by
  // opd-emr.js's onInput/onClick.
  function _reviewLine(drug, lin, override) {
    drug = drug || {}; lin = lin || {};
    var verify = lin.final == null || (lin.warnings && lin.warnings.length > 0);
    var effective = override ? override.now : lin.final;
    var valueHtml = effective != null ? esc(effective) + " mg" : "verify";
    var badge = (verify && !override) ? ' <span class="oe-tag oe-review">verify</span>' : "";
    var note = override ? '<div class="oe-onco-ov-note">Override: ' + esc(override.was == null ? "verify" : override.was) +
      " mg &rarr; " + esc(override.now) + " mg. Reason: " + esc(override.reason) + "</div>" : "";
    return '<div class="oe-onco-review-line"><div class="oe-onco-review-head"><b>' + esc(drug.name || drug.id || "") + "</b>" + badge +
      '<span class="oe-onco-review-val">' + valueHtml + "</span></div>" + note +
      '<div class="oe-onco-review-edit">' +
        '<input class="oe-inp" type="number" step="any" data-oe-inp="onco-ov-val:' + esc(drug.id) + '" placeholder="' + (effective != null ? esc(effective) : "mg") + '">' +
        '<input class="oe-inp" type="text" data-oe-inp="onco-ov-reason:' + esc(drug.id) + '" placeholder="Reason for override (required)">' +
        '<button class="oe-btn ghost" data-oe-act="onco-override:' + esc(drug.id) + '">' + ms("edit") + "Save override</button>" +
      "</div></div>";
  }

  // Every calculated line, reviewable; [Create & Activate] is disabled whenever an override already
  // staged in the draft is missing a reason. Staging itself (_stageOverride below) never lets that
  // happen, but this builder stays trustworthy standalone - same belt-and-suspenders discipline as
  // the server's _recordOverride throwing even though the UI also guards (functions/_onco_store.js).
  function _buildReviewPanel(draft) {
    draft = draft || {};
    var tmpl = draft.template || {}, drugs = tmpl.drugs || [];
    var doseByDrug = {}; (draft.calculatedDoses || []).forEach(function (d) { if (d && d.drugId) doseByDrug[d.drugId] = d; });
    var ovByDrug = {}; (draft.overrides || []).forEach(function (o) { if (o && o.drugId) ovByDrug[o.drugId] = o; });
    var lines = drugs.map(function (drug) { return _reviewLine(drug, doseByDrug[drug.id], ovByDrug[drug.id]); }).join("");
    var badOverride = (draft.overrides || []).some(function (o) { return !o || !String(o.reason || "").trim(); });
    // R1 (blocking): experimental/draft provenance MUST persist onto the dose-REVIEW screen - this is
    // where the oncologist reads the mg numbers, and a computed dose from a zero-VERIFY draft protocol
    // must never look like an approved order that can be transcribed. Mirrors the OncoTree banner text.
    var isDraft = !!(tmpl.experimental || (tmpl.lifecycleState && tmpl.lifecycleState !== "active"));
    var draftBanner = isDraft
      ? '<div class="oe-onco-draftnote">' + ms("info") + "Beta - AI-drafted regimen, decision support only. Verify against your institutional protocol before prescribing." + "</div>"
      : "";
    return '<section class="oe-ai-panel oe-onco-review"><h3 class="oe-h3">Review treatment plan &middot; ' + esc(tmpl.name || draft.protocolId || "") + "</h3>" +
      draftBanner +
      lines +
      '<button class="oe-btn primary" data-oe-act="onco-create"' + (badOverride ? " disabled" : "") + ">" + ms("check_circle") + "Create &amp; Activate</button></section>";
  }

  // Override-needs-reason, enforced HERE too (a client-side mirror of the server's _recordOverride)
  // so a reasonless edit can never even enter st.oncoDraft.overrides. Rejects (returns null) with no
  // reason; otherwise returns the new overrides[] with this drug's entry added/replaced.
  function _stageOverride(overrides, o) {
    o = o || {};
    var reason = String(o.reason == null ? "" : o.reason).trim();
    if (!reason) return null;
    var out = (overrides || []).filter(function (x) { return x && x.drugId !== o.drugId; });
    out.push({ drugId: o.drugId, was: o.was, now: o.now, reason: reason });
    return out;
  }

  // ---- Phase 5 gap-fix: per-cycle DOCTOR control panel (create cycle, pre-chemo clearance
  // attestation, confirm to ready). Still PURE (no DOM, no fetch, no confirm() dialog) - opd-emr.js
  // owns the confirm() gate + the actual POSTs, exactly like the apply/override wiring above. The
  // NURSE path never sees this (nurse view stays execution-only - onco-nurse.js has no equivalent).

  var CLEARANCE_STATUS_OPTIONS = ["cleared", "review", "not_cleared"];

  // The lean v1 state machine runs cycles strictly in sequence (never two live cycles for one plan
  // at once - spec R5): "next" is one past whatever cycle is currently on file, or 1 if there's none.
  function _nextCycleNo(cycle) { return cycle ? Number(cycle.cycleNo || 0) + 1 : 1; }

  // No cycle yet, or the current one already ran to completion -> offer [Create cycle N]. Otherwise
  // the cycle is live (planned/ready/administering/held) -> show the clearance attestation panel.
  function _buildCyclePanel(plan, cycle, draft) {
    plan = plan || {}; draft = draft || {};
    if (!cycle || cycle.state === "done") {
      var nextNo = _nextCycleNo(cycle && cycle.state === "done" ? cycle : null);
      if (plan.plannedCycles && nextNo > Number(plan.plannedCycles)) {
        return '<div class="oe-onco-cyclepanel"><div class="oe-empty sm">All planned cycles are complete.</div></div>';
      }
      return '<div class="oe-onco-cyclepanel"><button class="oe-btn primary" data-oe-act="onco-cycle-create:' + nextNo + '">' + ms("add_circle") + "Create cycle " + nextNo + "</button></div>";
    }

    var checks = draft.checks || {};
    var checkNames = (plan.lockedTemplate && plan.lockedTemplate.clearanceChecks) || [];
    var checkRows = checkNames.map(function (name) {
      var on = !!checks[name];
      return '<button class="oe-toggle' + (on ? " on" : "") + '" data-oe-act="onco-clr-toggle:' + esc(name) + '">' + ms(on ? "check_box" : "check_box_outline_blank") + esc(name) + "</button>";
    }).join("");

    var status = draft.status || "";
    var options = [["", "Select status"]].concat(CLEARANCE_STATUS_OPTIONS.map(function (s) { return [s, s]; })).map(function (o) {
      return '<option value="' + o[0] + '"' + (status === o[0] ? " selected" : "") + '>' + esc(o[1]) + "</option>";
    }).join("");

    // Belt-and-suspenders: [Confirm cycle to ready] is disabled here until the CYCLE'S OWN persisted
    // clearance.status is "cleared" (never the un-submitted draft select) - the server (confirmCycle)
    // holds the real gate and refuses regardless; this is only a friendlier UI mirror of it.
    var cleared = !!(cycle.clearance && cycle.clearance.status === "cleared");
    return '<div class="oe-onco-cyclepanel">' +
      '<h4 class="oe-onco-nurse-h4">Pre-chemo clearance &middot; Cycle ' + esc(cycle.cycleNo) + "</h4>" +
      (cycle.clearance && cycle.clearance.status ? '<div class="oe-onco-clr-current">Current status: <b>' + esc(cycle.clearance.status) + "</b></div>" : "") +
      '<div class="oe-onco-clr-list">' + checkRows + "</div>" +
      '<select class="oe-inp" data-oe-inp="onco-clr-status">' + options + "</select>" +
      '<div class="oe-onco-cyclepanel-actions">' +
        '<button class="oe-btn ghost" data-oe-act="onco-clr-resolve:' + esc(cycle.cycleId) + '">' + ms("fact_check") + "Resolve clearance</button>" +
        '<button class="oe-btn primary" data-oe-act="onco-cycle-confirm:' + esc(cycle.cycleId) + '"' + (cleared ? "" : " disabled") + ">" + ms("check_circle") + "Confirm cycle to ready</button>" +
      "</div></div>";
  }

  var API = {
    _buildOncoMatrix: _buildOncoMatrix, doseDrawerView: doseDrawerView, _dayMarker: dayMarker, _doseAdminText: doseAdminText,
    _buildApplyPanel: _buildApplyPanel, _buildReviewPanel: _buildReviewPanel, _stageOverride: _stageOverride,
    _buildCyclePanel: _buildCyclePanel, _nextCycleNo: _nextCycleNo,
    _version: "1.1"
  };
  if (root) root.SMD_ONCOUI = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
