/* StewardMD - onco-cycle-timeline.js. Patient Cycle Calendar & Nadir Timeline.
 * PURE: no DOM mutation, returns structured timeline data and printable calendar HTML.
 * Generates day-by-day clinical milestones across an oncology cycle:
 * Infusion Day, Delayed Nausea Window, Expected ANC Nadir, Febrile Neutropenia vigilance,
 * and Pre-Cycle Lab Clearance.
 * window.SMD_ONCO_TIMELINE + module.exports.
 */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function addDays(baseDate, numDays) {
    var d = new Date(baseDate.getTime());
    d.setDate(d.getDate() + numDays);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Generates a detailed day-by-day clinical timeline for one chemotherapy cycle.
   *
   * @param {Object} protocol - The protocol JSON object.
   * @param {Date|string|number} [startDate] - Cycle Day 1 calendar date (defaults to today).
   * @returns {Object} Structured timeline object with milestones, nadir windows, and daily events.
   */
  function generateCycleTimeline(protocol, startDate) {
    protocol = protocol || {};
    var cycleLength = Number(protocol.cycleLengthDays) || 21;
    var drugs = protocol.drugs || [];
    var base = startDate ? new Date(startDate) : new Date();
    if (isNaN(base.getTime())) base = new Date();

    var daysMap = {};
    for (var d = 1; d <= cycleLength; d++) {
      daysMap[d] = {
        cycleDay: d,
        date: addDays(base, d - 1),
        phase: "Inter-cycle Recovery",
        events: [],
        alerts: []
      };
    }

    // 1. Administration days
    for (var i = 0; i < drugs.length; i++) {
      var drug = drugs[i];
      var adminDays = Array.isArray(drug.days) ? drug.days : [1];
      for (var j = 0; j < adminDays.length; j++) {
        var dayNum = adminDays[j];
        if (daysMap[dayNum]) {
          daysMap[dayNum].phase = "Treatment Administration";
          daysMap[dayNum].events.push({
            type: "drug_admin",
            drug: drug.name || drug.id,
            dose: drug.dosePerUnit + " " + drug.unit,
            route: drug.route,
            notes: drug.notes || ""
          });
        }
      }
    }

    // 2. Acute & Delayed Emetogenic windows (Days 1 to 4)
    if (daysMap[1]) {
      daysMap[1].alerts.push({
        type: "acute_emesis",
        severity: "info",
        text: "Acute emesis protection: Premedicate with 5-HT3 antagonist + Dexamethasone ± NK1 inhibitor per NCCN tier."
      });
    }
    for (var de = 2; de <= Math.min(4, cycleLength); de++) {
      if (daysMap[de]) {
        daysMap[de].phase = "Delayed Nausea Window";
        daysMap[de].alerts.push({
          type: "delayed_emesis",
          severity: "warning",
          text: "Delayed emesis vulnerability: Continue oral antiemetic schedule / dexamethasone taper as directed."
        });
      }
    }

    // 3. Expected Myelosuppressive ANC Nadir Window (Days 7 to 12)
    var nadirStart = Math.min(7, cycleLength);
    var nadirEnd = Math.min(12, cycleLength);
    for (var n = nadirStart; n <= nadirEnd; n++) {
      if (daysMap[n]) {
        daysMap[n].phase = "Expected ANC Nadir Window";
        daysMap[n].alerts.push({
          type: "neutropenia_risk",
          severity: "high",
          text: "Peak myelosuppressive nadir: High febrile neutropenia risk. Check temperature if chills or feeling unwell. Immediate ER/oncology contact if temp >= 38.0C (100.4F)."
        });
      }
    }

    // 4. Pre-Cycle Lab Clearance Window (Last 1-2 days before next cycle)
    var clearanceDay = Math.max(1, cycleLength - 1);
    if (daysMap[clearanceDay]) {
      daysMap[clearanceDay].phase = "Lab Clearance Check";
      daysMap[clearanceDay].events.push({
        type: "lab_clearance",
        text: "Pre-chemo safety clearance labs: CBC with diff, CMP (Creatinine, ALT/AST, Bilirubin). Must verify ANC >= 1,500 and Platelets >= 100k prior to next cycle."
      });
    }

    var timelineList = [];
    for (var k = 1; k <= cycleLength; k++) {
      timelineList.push(daysMap[k]);
    }

    return {
      protocolId: protocol.id,
      protocolName: protocol.name,
      cycleLengthDays: cycleLength,
      startDate: base.toISOString().slice(0, 10),
      endDate: addDays(base, cycleLength - 1),
      timeline: timelineList,
      nadirRange: { startDay: nadirStart, endDay: nadirEnd }
    };
  }

  function renderTimelineHtml(timelineData) {
    timelineData = timelineData || {};
    var list = timelineData.timeline || [];
    if (!list.length) return '<div class="ot-timeline-empty">No cycle data available.</div>';

    var h = '<div class="ot-cycle-timeline-card">';
    h += "<h4>Cycle Schedule & Nadir Chronology: " + esc(timelineData.protocolName) + "</h4>";
    h += '<p class="text-muted small">Duration: ' + timelineData.cycleLengthDays + " Days (Start: " + esc(timelineData.startDate) + " &rarr; Next Cycle: " + esc(timelineData.endDate) + ")</p>";
    h += '<div class="ot-timeline-grid">';

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var isTreatment = item.phase === "Treatment Administration";
      var isNadir = item.phase === "Expected ANC Nadir Window";
      var isLabs = item.phase === "Lab Clearance Check";

      var colClass = isTreatment ? "ot-day-admin" : (isNadir ? "ot-day-nadir" : (isLabs ? "ot-day-labs" : "ot-day-recovery"));

      h += '<div class="ot-timeline-day ' + colClass + '">';
      h += '<div class="ot-day-header"><b>Day ' + item.cycleDay + '</b> <span class="ot-day-date">' + esc(item.date) + "</span></div>";
      h += '<div class="ot-day-phase">' + esc(item.phase) + "</div>";

      if (item.events.length) {
        h += '<ul class="ot-day-events">';
        for (var e = 0; e < item.events.length; e++) {
          var ev = item.events[e];
          if (ev.type === "drug_admin") {
            h += "<li><strong>" + esc(ev.drug) + "</strong> (" + esc(ev.dose) + " " + esc(ev.route) + ")</li>";
          } else {
            h += "<li>" + esc(ev.text) + "</li>";
          }
        }
        h += "</ul>";
      }

      if (item.alerts.length) {
        for (var a = 0; a < item.alerts.length; a++) {
          h += '<div class="ot-day-alert alert-' + esc(item.alerts[a].severity) + '">' + esc(item.alerts[a].text) + "</div>";
        }
      }

      h += "</div>";
    }

    h += "</div></div>";
    return h;
  }

  var API = {
    generateCycleTimeline: generateCycleTimeline,
    renderTimelineHtml: renderTimelineHtml
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  root.SMD_ONCO_TIMELINE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
