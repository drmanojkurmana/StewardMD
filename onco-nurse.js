/* StewardMD - onco-nurse.js. Phase 5: the nurse execution view ("Today's Chemotherapy") built PURELY
 * from a treatment plan + one cycle already in state - patient/protocol/cycle/day header, a big
 * clearance banner (colour from cycle.clearance.status), an ordered give-list (premedications then
 * each drug with its CONFIRMED dose + route), and an administration-record table.
 *
 * SAFETY (non-negotiable, spec R8): this file NEVER calculates a dose. It reads cycle.confirmedDoses
 * (falling back to plan.confirmedDoses / plan.calculatedDoses, same never-invent fallback the doctor
 * matrix in onco-protocols.js uses) and renders whatever `.final` is already there, or "verify" if
 * there is none. It does NOT import, require, or call the pure dose-calculation engine (the sibling
 * module one directory up whose window global starts with "SMD_ONCO" + "DOSE") anywhere in this
 * file - a unit test greps this file's own source to enforce that. No DOM, no fetch: staging inputs,
 * POSTing /onco/admin, and POSTing /onco/cycle/complete all live in opd-emr.js, exactly like
 * onco-protocols.js keeps the doctor-side apply/override staging out of this pure layer.
 * window.SMD_ONCONURSE + module.exports. */
(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function ms(name) { return '<span class="material-symbols-outlined">' + name + "</span>"; }
  // HH:MM in UTC, deterministic (no Intl/locale/timezone variance) - good enough for a v1 admin log.
  function fmtTime(t) { t = Number(t); return t ? new Date(t).toISOString().slice(11, 16) : "-"; }

  function header(plan, cycle) {
    plan = plan || {}; cycle = cycle || {};
    var tmpl = plan.lockedTemplate || {};
    var title = esc(tmpl.name || (plan.protocolId || "").toUpperCase() || "Treatment plan");
    var bits = [];
    if (plan.ghisPatientId) bits.push("MRN " + esc(plan.ghisPatientId));
    bits.push("Cycle " + esc(cycle.cycleNo != null ? cycle.cycleNo : "?"));
    bits.push("Day " + esc(cycle.day != null ? cycle.day : "?"));
    return '<div class="oe-onco-nurse-head"><div class="oe-onco-nurse-title">' + title + "</div>" +
      '<div class="oe-onco-nurse-sub">' + bits.join(" &middot; ") + "</div></div>";
  }

  // cleared -> green, review -> amber, everything else (not_cleared, "pending" default, missing) ->
  // red - fail-closed: only an explicit "cleared" status is ever shown as safe to give.
  function clearanceColor(status) {
    if (status === "cleared") return "green";
    if (status === "review") return "amber";
    return "red";
  }
  var CLEARANCE_TEXT = {
    cleared: "Cleared for chemotherapy",
    review: "Needs physician review before administration",
    not_cleared: "NOT cleared - do not administer",
  };
  function clearanceBanner(clearance) {
    clearance = clearance || {};
    var status = String(clearance.status || "not_cleared");
    var color = clearanceColor(status);
    var text = CLEARANCE_TEXT[status] || CLEARANCE_TEXT.not_cleared;
    var icon = color === "green" ? "check_circle" : color === "amber" ? "warning" : "block";
    var checksHtml = (clearance.checks || []).length
      ? '<div class="oe-onco-clr-checks">' + (clearance.checks || []).map(function (c) {
          return esc((c && c.name) || "") + ": " + esc((c && c.status) || "");
        }).join(" &middot; ") + "</div>"
      : "";
    return '<div class="oe-onco-clr oe-clr-' + color + '" data-onco-clearance="' + esc(status) + '">' + ms(icon) +
      '<div><div class="oe-onco-clr-txt">' + esc(text) + "</div>" + checksHtml + "</div></div>";
  }

  // The ordered give-list: premedications first (informational only - the template carries no dose
  // for these), then each protocol drug with its CONFIRMED dose + route and a [Start] button. Once a
  // drug already has an administration row for this cycle, the button is replaced by a "Given" tag
  // (never a second concurrent Start for the same drug from this view).
  function giveList(plan, cycle) {
    plan = plan || {}; cycle = cycle || {};
    var tmpl = plan.lockedTemplate || {};
    var premeds = tmpl.premedications || [];
    var drugs = tmpl.drugs || [];
    var doses = (cycle.confirmedDoses && cycle.confirmedDoses.length) ? cycle.confirmedDoses
      : (plan.confirmedDoses && plan.confirmedDoses.length) ? plan.confirmedDoses
      : (plan.calculatedDoses || []);
    var byDrug = {}; doses.forEach(function (d) { if (d && d.drugId) byDrug[d.drugId] = d; });
    var given = {}; (cycle.administrationSequence || []).forEach(function (a) { if (a && a.drugId) given[a.drugId] = true; });
    var cid = esc(cycle.cycleId || "");

    var rows = premeds.map(function (p) {
      p = p || {};
      return '<div class="oe-onco-giverow premed"><div class="oe-onco-give-main">' +
        '<span class="oe-onco-give-name">' + esc(p.name || "") + "</span>" +
        '<span class="oe-onco-give-dose">' + esc(p.notes || "") + "</span></div></div>";
    }).join("");

    rows += drugs.map(function (drug) {
      drug = drug || {};
      var lin = byDrug[drug.id];
      var doseTxt = (lin && lin.final != null) ? (esc(lin.final) + " mg" + (drug.route ? " " + esc(drug.route) : "")) : "verify";
      var did = esc(drug.id || "");
      // Administration instructions from the (nurse-safe) template's own notes - informational only,
      // never a dose (the nurse view holds no dose formulas and never calculates).
      var instr = drug.notes ? '<span class="oe-onco-give-instr">' + esc(drug.notes) + "</span>" : "";
      var right = given[drug.id]
        ? '<span class="oe-tag">Given</span>'
        : '<div class="oe-onco-give-inputs">' +
            '<input class="oe-inp" type="number" step="any" data-oe-inp="onco-admin-dose:' + cid + ":" + did + '" placeholder="actual mg">' +
            '<input class="oe-inp" type="text" data-oe-inp="onco-admin-reaction:' + cid + ":" + did + '" placeholder="reaction">' +
            '<button class="oe-btn primary sm" data-oe-act="onco-start:' + cid + ":" + did + '">' + ms("play_arrow") + "Start</button>" +
          "</div>";
      return '<div class="oe-onco-giverow' + (given[drug.id] ? " done" : "") + '"><div class="oe-onco-give-main">' +
        '<span class="oe-onco-give-name">' + esc(drug.name || drug.id || "") + "</span>" +
        '<span class="oe-onco-give-dose">' + doseTxt + "</span>" + instr + "</div>" + right + "</div>";
    }).join("");

    return '<div class="oe-onco-give">' + rows + "</div>";
  }

  // Administration record: one row per q_onco_admin write already reflected onto
  // cycle.administrationSequence (opd-emr.js appends the server's response after each successful
  // POST) - actual dose | start | end | reaction | nurse. Read-only, append-only, never recomputed.
  function adminTable(cycle) {
    cycle = cycle || {};
    var recs = cycle.administrationSequence || [];
    if (!recs.length) return '<div class="oe-empty sm">No administration recorded yet.</div>';
    var rows = recs.map(function (r) {
      r = r || {};
      return "<tr><td>" + esc(r.drugId || "") + "</td><td>" + (r.actual != null ? esc(r.actual) + " mg" : "-") + "</td>" +
        "<td>" + esc(fmtTime(r.startTime)) + "</td><td>" + esc(fmtTime(r.endTime)) + "</td>" +
        "<td>" + esc(r.reaction || "none") + "</td><td>" + esc(r.administeredBy || "") + "</td></tr>";
    }).join("");
    return '<table class="oe-onco-admtbl"><thead><tr><th>Drug</th><th>Actual dose</th><th>Start</th><th>End</th><th>Reaction</th><th>Nurse</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table>";
  }

  function completeAction(cycle) {
    cycle = cycle || {};
    if (cycle.state === "done") return '<div class="oe-onco-clr oe-clr-green oe-onco-done"><span class="material-symbols-outlined">check_circle</span><div>Cycle complete</div></div>';
    if (cycle.state === "held") return "";
    return '<button class="oe-btn primary" data-oe-act="onco-complete:' + esc(cycle.cycleId || "") + '">' + ms("check_circle") + "Complete cycle</button>";
  }

  // "Today's Chemotherapy": header, clearance banner, give-list, administration record, complete
  // action. Pure - no DOM, no fetch, no dose calculation.
  function buildNurseView(plan, cycle) {
    plan = plan || {}; cycle = cycle || {};
    return '<div class="oe-onco-nurse">' +
      header(plan, cycle) +
      clearanceBanner(cycle.clearance) +
      '<h4 class="oe-onco-nurse-h4">Give list</h4>' +
      giveList(plan, cycle) +
      '<h4 class="oe-onco-nurse-h4">Administration record</h4>' +
      adminTable(cycle) +
      completeAction(cycle) +
      "</div>";
  }

  var API = {
    buildNurseView: buildNurseView, _clearanceColor: clearanceColor, _clearanceBanner: clearanceBanner,
    _giveList: giveList, _adminTable: adminTable, _version: "1.0",
  };
  if (root) root.SMD_ONCONURSE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
