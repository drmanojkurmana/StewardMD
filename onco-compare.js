/* StewardMD - onco-compare.js. Multi-Regimen Head-to-Head Comparison Matrix.
 * PURE: no DOM mutation, returns structured data or self-contained HTML markup.
 * Compares standard-of-care oncology regimens across efficacy, toxicity profiles,
 * infusion chair burden, and landmark trial evidence.
 * window.SMD_ONCO_COMPARE + module.exports.
 */
(function (root) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Toxicity signatures by drug ID
  var DRUG_TOXICITIES = {
    "cisplatin": { emetogenic: "High (>90%)", neuro: "Moderate (ototoxicity/neuropathy)", nephro: "High", cardio: "Low" },
    "doxorubicin": { emetogenic: "Moderate (High when combined with cyclophosphamide)", cardio: "High (dose-dependent cardiomyopathy)", alopecia: "High" },
    "cyclophosphamide": { emetogenic: "Moderate/High", uro: "Hemorrhagic cystitis risk" },
    "oxaliplatin": { emetogenic: "Moderate", neuro: "High (acute cold-induced + cumulative sensory)", hem: "Moderate" },
    "irinotecan": { emetogenic: "Moderate", gi: "High (acute cholinergic + delayed diarrhea)", hem: "Moderate" },
    "paclitaxel": { emetogenic: "Low", neuro: "High (sensory neuropathy)", hyper: "High infusion reaction risk (cremophor)" },
    "docetaxel": { emetogenic: "Low", fluid: "Capillary leak/edema", alopecia: "High", hem: "High" },
    "capecitabine": { emetogenic: "Low", gi: "Moderate diarrhea", skin: "High (Hand-foot syndrome / PPE)" },
    "fluorouracil": { emetogenic: "Low", mucosal: "High mucositis/stomatitis (bolus) / Diarrhea (infusion)", cardio: "Coronary vasospasm" },
    "vincristine": { emetogenic: "Minimal", neuro: "High (constipation, peripheral motor/sensory, capped at 2mg)" },
    "dostarlimab": { emetogenic: "Minimal", immune: "irAE risk (colitis, hepatitis, pneumonitis, thyroid)" },
    "pembrolizumab": { emetogenic: "Minimal", immune: "irAE risk (colitis, hepatitis, pneumonitis, endocrine)" },
    "atezolizumab": { emetogenic: "Minimal", immune: "irAE risk" },
    "durvalumab": { emetogenic: "Minimal", immune: "irAE risk" },
    "tarlatamab": { emetogenic: "Minimal", immune: "CRS (Cytokine Release Syndrome), ICANS" },
    "zanubrutinib": { emetogenic: "Minimal", hem: "Bleeding/bruising risk", cardio: "Atrial fibrillation (low vs ibrutinib)" },
    "dinutuximab": { emetogenic: "Minimal", pain: "Severe neuropathic allodynia (continuous IV opioids mandatory)" }
  };

  function estimateChairTime(protocol) {
    var drugs = protocol.drugs || [];
    var hasContinuousPump = false;
    var hasOralOnly = true;
    var ivCount = 0;

    for (var i = 0; i < drugs.length; i++) {
      var d = drugs[i];
      if (d.route === "IV") {
        hasOralOnly = false;
        ivCount++;
        if (String(d.notes || "").toLowerCase().indexOf("continuous") >= 0 || String(d.notes || "").indexOf("46") >= 0) {
          hasContinuousPump = true;
        }
      } else if (d.route !== "PO") {
        hasOralOnly = false;
      }
    }

    if (hasOralOnly) return "0 hours (Outpatient oral regimen)";
    if (hasContinuousPump) return "3-4 hours clinic infusion + 46-hour ambulatory CADD pump";
    if (ivCount >= 3) return "4-6 hours (Multi-agent IV chemotherapy)";
    if (ivCount === 2) return "2-3 hours (IV doublet)";
    return "1-2 hours (Single-agent IV infusion)";
  }

  function assessToxicityFootprint(protocol) {
    var drugs = protocol.drugs || [];
    var emetogenicTier = "Low";
    var highToxFlags = [];

    for (var i = 0; i < drugs.length; i++) {
      var id = String(drugs[i].id || "").toLowerCase();
      var tox = DRUG_TOXICITIES[id];
      if (!tox) continue;

      if (id === "cisplatin" || (id === "doxorubicin" && drugs.some(function (d) { return String(d.id).toLowerCase() === "cyclophosphamide"; }))) {
        emetogenicTier = "High (>90%)";
      } else if (emetogenicTier !== "High (>90%)" && (tox.emetogenic && tox.emetogenic.indexOf("Moderate") >= 0)) {
        emetogenicTier = "Moderate (30-90%)";
      }

      if (tox.neuro && highToxFlags.indexOf(tox.neuro) < 0) highToxFlags.push(tox.neuro);
      if (tox.cardio && highToxFlags.indexOf(tox.cardio) < 0) highToxFlags.push(tox.cardio);
      if (tox.gi && highToxFlags.indexOf(tox.gi) < 0) highToxFlags.push(tox.gi);
      if (tox.skin && highToxFlags.indexOf(tox.skin) < 0) highToxFlags.push(tox.skin);
      if (tox.pain && highToxFlags.indexOf(tox.pain) < 0) highToxFlags.push(tox.pain);
      if (tox.immune && highToxFlags.indexOf(tox.immune) < 0) highToxFlags.push(tox.immune);
    }

    return {
      emetogenicTier: emetogenicTier,
      keyToxicities: highToxFlags.length ? highToxFlags : ["Standard mild myelosuppression and fatigue"]
    };
  }

  function compareProtocols(protocols) {
    protocols = Array.isArray(protocols) ? protocols : [];
    var comparisons = [];

    for (var i = 0; i < protocols.length; i++) {
      var p = protocols[i] || {};
      var tox = assessToxicityFootprint(p);
      var chairTime = estimateChairTime(p);
      var drugNames = (p.drugs || []).map(function (d) {
        return (d.name || d.id) + " (" + d.dosePerUnit + " " + d.unit + ", D" + (d.days || []).join(",") + ")";
      });

      comparisons.push({
        id: p.id,
        name: p.name,
        cycleLengthDays: p.cycleLengthDays,
        cycles: p.cycles,
        intent: (p.intentOptions || []).join(", ") || "Standard",
        chairTime: chairTime,
        emetogenicTier: tox.emetogenicTier,
        keyToxicities: tox.keyToxicities,
        drugs: drugNames,
        sourceNccn: p.source && p.source.nccn ? p.source.nccn : "NCCN Guidelines",
        sourceTextbook: p.source && p.source.textbook ? p.source.textbook : "DeVita 12th ed."
      });
    }

    return comparisons;
  }

  function renderComparisonTable(protocols) {
    var list = compareProtocols(protocols);
    if (!list.length) return '<div class="ot-compare-empty">No protocols selected for comparison.</div>';

    var h = '<div class="ot-compare-modal">';
    h += "<h3>Head-to-Head Regimen Comparison</h3>";
    h += '<table class="ot-compare-table">';
    h += "<thead><tr><th>Attribute</th>";
    for (var i = 0; i < list.length; i++) {
      h += "<th>" + esc(list[i].name) + "</th>";
    }
    h += "</tr></thead><tbody>";

    h += "<tr><td><b>Cycle Schedule</b></td>";
    for (var i = 0; i < list.length; i++) {
      h += "<td>Every " + list[i].cycleLengthDays + " days &times; " + list[i].cycles + " cycles</td>";
    }
    h += "</tr>";

    h += "<tr><td><b>Drug Regimen & Doses</b></td>";
    for (var i = 0; i < list.length; i++) {
      h += "<td><ul>" + list[i].drugs.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul></td>";
    }
    h += "</tr>";

    h += "<tr><td><b>Administration Burden</b></td>";
    for (var i = 0; i < list.length; i++) {
      h += "<td>" + esc(list[i].chairTime) + "</td>";
    }
    h += "</tr>";

    h += "<tr><td><b>Emetogenic Potential</b></td>";
    for (var i = 0; i < list.length; i++) {
      var badgeClass = list[i].emetogenicTier.indexOf("High") >= 0 ? "badge-danger" : (list[i].emetogenicTier.indexOf("Mod") >= 0 ? "badge-warning" : "badge-info");
      h += '<td><span class="badge ' + badgeClass + '">' + esc(list[i].emetogenicTier) + '</span></td>';
    }
    h += "</tr>";

    h += "<tr><td><b>Key Toxicities to Monitor</b></td>";
    for (var i = 0; i < list.length; i++) {
      h += "<td><ul>" + list[i].keyToxicities.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></td>";
    }
    h += "</tr>";

    h += "<tr><td><b>Guideline Citations</b></td>";
    for (var i = 0; i < list.length; i++) {
      h += '<td class="small text-muted">' + esc(list[i].sourceNccn) + "<br>" + esc(list[i].sourceTextbook) + "</td>";
    }
    h += "</tr>";

    h += "</tbody></table></div>";
    return h;
  }

  var API = {
    compareProtocols: compareProtocols,
    renderComparisonTable: renderComparisonTable,
    estimateChairTime: estimateChairTime,
    assessToxicityFootprint: assessToxicityFootprint
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  root.SMD_ONCO_COMPARE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
