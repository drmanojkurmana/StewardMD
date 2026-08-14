/* StewardMD - ONCQIS Phase J-a: Knowledge Center admin render (PURE builders, no DOM/fetch/window).
 * Powers admin/oncology.html + the CDP harness. Read-only AGGREGATION + HTML string builders over the
 * protocol library index + the ingestion artifacts (evidence sources / extractions / impact reports)
 * fetched from /api/onco/kb/*. Renders nothing that mutates a protocol - the whole surface is ingestion
 * + review only. window.SMD_ONCOKBADMIN + module.exports. */
(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function up(s) { return String(s == null ? "" : s).toUpperCase(); }

  // Protocol lifecycle status, tolerating the two shapes in the codebase (schema `status` ACTIVE/DRAFT/
  // ... and the index's lowercase `lifecycleState`).
  function protoStatus(p) { return up((p && (p.status || p.lifecycleState)) || "").replace(/\s+/g, "_"); }

  // ---- J1: dashboard metric tiles ------------------------------------------------------------
  // Read-only aggregation over the protocol + evidence/report stores. Never fabricates a count.
  function dashboardMetrics(protocols, evidence, reports) {
    protocols = protocols || []; evidence = evidence || []; reports = reports || [];
    var m = { active: 0, draft: 0, r1_review: 0, institutional_approval: 0, retired: 0, superseded: 0,
              guidelineUploads: evidence.length, updatesAvailable: 0, clinicalReviewRequired: 0, protocolsDueForReview: 0 };
    protocols.forEach(function (p) {
      var s = protoStatus(p);
      if (s === "ACTIVE") m.active++;
      else if (s === "DRAFT") m.draft++;
      else if (s === "R1_REVIEW") m.r1_review++;
      else if (s === "INSTITUTIONAL_APPROVAL") m.institutional_approval++;
      else if (s === "RETIRED") m.retired++;
      else if (s === "SUPERSEDED") m.superseded++;
      if (p && p.review && p.review.reviewDue) m.protocolsDueForReview++;
    });
    // Update flags derived from the impact reports: how many ACTIVE protocols currently carry a
    // non-"NO CHANGE" impact, and how many need a human.
    var flags = protocolUpdateFlags(reports);
    Object.keys(flags).forEach(function (pid) {
      var st = flags[pid];
      if (st !== "NO CHANGE") m.updatesAvailable++;
      if (st === "CLINICAL REVIEW REQUIRED") m.clinicalReviewRequired++;
    });
    return m;
  }

  // The most-severe impact status seen for each protocolId across ALL reports (latest reports first
  // is not required - severity wins, which is fail-safe: a resolved issue never hides an open one until
  // a fresh report supersedes it). Returns { protocolId: status }.
  var SEV = ["CLINICAL REVIEW REQUIRED", "EVIDENCE DIVERGENCE", "NEW DRUG", "UPDATE AVAILABLE", "NO CHANGE"];
  function _moreSevere(a, b) { var ia = SEV.indexOf(a), ib = SEV.indexOf(b); if (ia < 0) return b; if (ib < 0) return a; return ia <= ib ? a : b; }
  function protocolUpdateFlags(reports) {
    reports = reports || [];
    var out = {};
    reports.forEach(function (r) {
      (r && r.protocols || []).forEach(function (pr) {
        if (!pr || !pr.protocolId) return;
        out[pr.protocolId] = out[pr.protocolId] ? _moreSevere(out[pr.protocolId], pr.status) : pr.status;
      });
    });
    return out;
  }

  var TILE_DEFS = [
    { key: "active", label: "ACTIVE" }, { key: "draft", label: "DRAFT" },
    { key: "r1_review", label: "R1 REVIEW" }, { key: "institutional_approval", label: "INSTITUTIONAL APPROVAL" },
    { key: "updatesAvailable", label: "Updates available" }, { key: "guidelineUploads", label: "Guideline uploads" },
    { key: "clinicalReviewRequired", label: "Clinical review required" }, { key: "protocolsDueForReview", label: "Due for review" }
  ];
  function renderTiles(metrics) {
    metrics = metrics || {};
    return '<div class="okb-tiles" data-okb="tiles">' + TILE_DEFS.map(function (t) {
      var v = metrics[t.key] || 0;
      var hot = (t.key === "clinicalReviewRequired" && v > 0) ? " okb-tile-hot" : "";
      return '<div class="okb-tile' + hot + '" data-okb-tile="' + esc(t.key) + '"><div class="okb-tile-n">' + esc(v) +
        '</div><div class="okb-tile-l">' + esc(t.label) + "</div></div>";
    }).join("") + "</div>";
  }

  // ---- J2: protocol library table ------------------------------------------------------------
  // disease | protocol | version | status | evidence | last-review | update-flag + row actions.
  function protocolRows(protocols, reports) {
    var flags = protocolUpdateFlags(reports);
    return (protocols || []).map(function (p) {
      var status = protoStatus(p) || "-";
      var evLayers = (p && p.evidence) ? ["core", "guideline", "institutional"].filter(function (k) { return (p.evidence[k] || []).length; }) : [];
      var lastReview = (p && p.review && p.review.lastReviewedAt) || "-";
      var flag = flags[p && p.id] || "NO CHANGE";
      return {
        id: (p && p.id) || "", disease: (p && p.disease) || (p && p.diseaseId) || "-",
        name: (p && p.name) || "-", version: (p && (p.protocolVersion || p.version)) || "-",
        status: status, evidence: evLayers.length ? evLayers.join("+") : "-",
        lastReview: lastReview, updateFlag: flag
      };
    });
  }
  var ROW_ACTIONS = ["VIEW", "COMPARE", "CREATE DRAFT UPDATE", "VIEW SOURCES", "VIEW HISTORY", "RETIRE"];
  function renderProtocolTable(protocols, reports) {
    var rows = protocolRows(protocols, reports);
    var head = "<tr><th>Disease</th><th>Protocol</th><th>Version</th><th>Status</th><th>Evidence</th><th>Last review</th><th>Update</th><th>Actions</th></tr>";
    var body = rows.map(function (r) {
      var acts = ROW_ACTIONS.map(function (a) {
        // CREATE DRAFT UPDATE + RETIRE call the Phase I lifecycle; they NEVER mutate an ACTIVE protocol
        // here - this admin surface only proposes. The button carries the intent for the host to route.
        return '<button class="okb-act" data-okb-act="' + esc(a.toLowerCase().replace(/\s+/g, "-")) + '" data-okb-id="' + esc(r.id) + '">' + esc(a) + "</button>";
      }).join("");
      var flagCls = r.updateFlag === "NO CHANGE" ? "" : (r.updateFlag === "CLINICAL REVIEW REQUIRED" ? " okb-flag-hot" : " okb-flag-warn");
      return '<tr data-okb-proto="' + esc(r.id) + '"><td>' + esc(r.disease) + "</td><td>" + esc(r.name) + "</td><td>" + esc(r.version) +
        '</td><td><span class="okb-badge">' + esc(r.status) + "</span></td><td>" + esc(r.evidence) + "</td><td>" + esc(r.lastReview) +
        '</td><td><span class="okb-flag' + flagCls + '">' + esc(r.updateFlag) + "</span></td><td>" + acts + "</td></tr>";
    }).join("");
    return '<table class="okb-table" data-okb="protocols"><thead>' + head + "</thead><tbody>" + (body || '<tr><td colspan="8">No protocols</td></tr>') + "</tbody></table>";
  }

  // ---- J3: evidence library list -------------------------------------------------------------
  function renderEvidenceTable(evidence) {
    var head = "<tr><th>Title</th><th>Org</th><th>Version</th><th>Published</th><th>Uploaded</th><th>Uploader</th><th>Type</th><th>Status</th><th>Checksum</th><th>Diseases</th></tr>";
    var body = (evidence || []).map(function (e) {
      e = e || {};
      return '<tr data-okb-ev="' + esc(e.id) + '"><td>' + esc(e.title) + "</td><td>" + esc(e.org) + "</td><td>" + esc(e.version) +
        "</td><td>" + esc(e.publicationDate || e.updateDate || "-") + "</td><td>" + esc(fmtTs(e.uploadDate)) + "</td><td>" + esc(e.uploader) +
        "</td><td>" + esc(e.sourceType || "-") + '</td><td><span class="okb-badge">' + esc(e.status || "-") + "</span></td><td class=\"okb-hash\">" +
        esc(String(e.checksum || "").slice(0, 10)) + "</td><td>" + esc((e.diseases || []).join(", ") || "-") + "</td></tr>";
    }).join("");
    return '<table class="okb-table" data-okb="evidence"><thead>' + head + "</thead><tbody>" + (body || '<tr><td colspan="10">No uploads</td></tr>') + "</tbody></table>";
  }
  function fmtTs(ts) { if (!ts) return "-"; try { return new Date(ts).toISOString().slice(0, 10); } catch (e) { return "-"; } }

  var API = {
    dashboardMetrics: dashboardMetrics, protocolUpdateFlags: protocolUpdateFlags,
    protocolRows: protocolRows, renderTiles: renderTiles, renderProtocolTable: renderProtocolTable,
    renderEvidenceTable: renderEvidenceTable, ROW_ACTIONS: ROW_ACTIONS, _version: "1.0"
  };
  if (root) root.SMD_ONCOKBADMIN = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
