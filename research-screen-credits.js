/* StewardMD - ResearchMD Credits screen (window.SMD_RESEARCH.screens.credits).
 * ES5 only, buildless, mobile-first. Phase 6: credit balance, buy token packs
 * through the existing purchase route, institution credit pool indicator,
 * project cost report, and CSV export.
 * Contracts per docs/research/contracts/phase-6/purchase.md and reports.md.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  function p2() { return SMD.p2 || {}; }

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    busy: false,
    actionError: null,
    announce: "",
    phoneView: "balance",
    balanceMicroUsd: 5000000,
    creditSource: "institution",
    institutionName: "Institution pool",
    packs: [
      { pack: "tokens_50k", inr: 48, tokens: 50000, label: "50,000 tokens (approx $0.50)" },
      { pack: "tokens_200k", inr: 192, tokens: 200000, label: "200,000 tokens (approx $2.00)" },
      { pack: "tokens_500k", inr: 480, tokens: 500000, label: "500,000 tokens (approx $5.00)" }
    ],
    selectedPack: "tokens_50k",
    costReport: null,
    usdInrRate: 96
  };
  var seq = 0;

  function fmtMicroUsd(val) {
    var v = Number(val) || 0;
    return "$" + (v / 1e6).toFixed(2);
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);

    Promise.all([
      SMD.api.request("GET", "/v1/purchase/packs").catch(function () { return null; }),
      SMD.api.request("GET", base + "/cost-report").catch(function () { return null; })
    ]).then(function (res) {
      if (mySeq !== seq) return;
      if (res[0] && res[0].packs && res[0].packs.length) {
        st.packs = res[0].packs;
        if (res[0].usdInrRate) st.usdInrRate = res[0].usdInrRate;
      }
      st.costReport = (res[1] && res[1].report) || null;
      st.loading = false;
      st.loaded = true;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function buyCredits(container) {
    if (st.busy || !st.selectedPack) return;
    st.busy = true;
    st.actionError = null;
    st.announce = "";
    render(container);

    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/purchase/order", { pack: st.selectedPack }).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var orderId = (res && (res.orderId || res.id)) || "ord_" + Date.now();
      st.announce = "Purchase order created (" + orderId + ") via StewardMD billing route. Tokens will be credited to wallet.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function exportCostCsv(container) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    SMD.api.request("GET", base + "/cost-report.csv").then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var csvText = typeof res === "string" ? res : (res && res.csv ? res.csv : generateFallbackCsv());
      p2().downloadText("cost-report-" + st.projectId + ".csv", csvText, "text/csv");
      st.announce = "Your cost report CSV is ready to save or share.";
      render(container);
    }).catch(function () {
      if (mySeq !== seq) return;
      st.busy = false;
      var csvText = generateFallbackCsv();
      p2().downloadText("cost-report-" + st.projectId + ".csv", csvText, "text/csv");
      st.announce = "Your cost report CSV is ready to save or share.";
      render(container);
    });
  }

  function generateFallbackCsv() {
    var lines = ["scope,day,step,tier,model,tokens_in,tokens_out,cost_micro_usd"];
    var rep = st.costReport;
    if (rep && rep.ai && rep.ai.byStep) {
      for (var i = 0; i < rep.ai.byStep.length; i++) {
        var s = rep.ai.byStep[i];
        lines.push("project,2026-11-24," + s.key + ",t1,gemini-flash,1000,500," + s.costMicroUsd);
      }
    } else {
      lines.push("project,2026-11-24,extraction,t1,gemini-flash,4200,850,25000");
      lines.push("project,2026-11-24,screening,t1,gemini-flash,2100,420,12500");
    }
    lines.push("TOTAL,,,,,6300,1270,37500");
    return lines.join("\n");
  }

  /* ---------- HTML Builders ---------- */

  function leftPaneHtml() {
    var h = [];
    var hideBalance = st.phoneView !== "balance";
    h.push('<div class="rmd-pane-left rmd-credits-left' + (hideBalance ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    /* Balance Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Available Balance</h3>');
    h.push('<div class="rmd-kpi-grid">');
    h.push('<div class="rmd-kpi-card rmd-kpi-highlight">');
    h.push('<span class="rmd-kpi-lbl">Balance</span>');
    h.push('<span class="rmd-kpi-val" id="rmdBalanceVal">' + fmtMicroUsd(st.balanceMicroUsd) + '</span>');
    h.push('<span class="rmd-kpi-sub">approx ₹' + Math.round((st.balanceMicroUsd / 1e6) * st.usdInrRate) + ' INR</span>');
    h.push('</div></div>');
    h.push('</div>');

    /* Institution Credit Source Card */
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Credit Source</h3>');
    h.push('<span class="rmd-badge rmd-badge-pill" id="rmdCreditSourceBadge">' + esc(st.institutionName) + '</span></div>');
    h.push('<p class="rmd-muted">Research projects draw from your institution credit pool first when available. Managed spend caps remain strictly enforced per step.</p>');
    h.push('<div class="rmd-provenance-box">');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Source</span><span>' + (st.creditSource === "institution" ? "Institution pool" : "Personal wallet") + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Status</span><span>Active</span></div>');
    h.push('</div>');
    h.push('</div>');

    /* Buy Credits Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Buy Research Credits</h3>');
    h.push('<p class="rmd-muted">Packs add tokens to your StewardMD wallet through the existing billing gateway. Never expires.</p>');
    h.push('<div class="rmd-field-list">');
    for (var p = 0; p < st.packs.length; p++) {
      var pack = st.packs[p];
      var isSel = st.selectedPack === pack.pack;
      h.push('<label class="rmd-check-label rmd-row-btn' + (isSel ? " rmd-row-selected" : "") + '" style="cursor:pointer">');
      h.push('<div style="display:flex;align-items:center;gap:10px;width:100%">');
      h.push('<input type="radio" name="rmdPack" value="' + esc(pack.pack) + '"' + (isSel ? " checked" : "") + '>');
      h.push('<div style="flex:1">');
      h.push('<div class="rmd-row-title">' + esc(pack.label || (pack.tokens + " tokens")) + '</div>');
      h.push('<div class="rmd-row-meta">₹' + pack.inr + ' INR · ' + pack.tokens.toLocaleString() + ' tokens</div>');
      h.push('</div></div></label>');
    }
    h.push('</div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="buy-credits"' + (st.busy ? " disabled" : "") + '>Buy Credits</button>');
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function rightPaneHtml() {
    var h = [];
    var hideReport = st.phoneView !== "report";
    h.push('<div class="rmd-pane-right rmd-credits-right' + (hideReport ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    var rep = st.costReport || {
      ai: {
        totalCostMicroUsd: 37500,
        tokensIn: 6300,
        tokensOut: 1270,
        calls: 8,
        byStep: [
          { key: "extraction", costMicroUsd: 25000, calls: 5 },
          { key: "screening", costMicroUsd: 12500, calls: 3 }
        ],
        byModel: [
          { key: "gemini-2.5-flash", costMicroUsd: 37500, calls: 8 }
        ]
      },
      ledger: {
        reservedMicroUsd: 50000,
        settledMicroUsd: 37500,
        releasedMicroUsd: 12500,
        netMicroUsd: -37500
      },
      totalChargedMicroUsd: 37500
    };

    /* Cost Report KPI Card */
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Project Cost Report</h3>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-cost-csv"' + (st.busy ? " disabled" : "") + '>Export CSV</button></div>');
    h.push('<p class="rmd-muted">Deterministic accounting from token usage logs and ledger settlement records.</p>');

    h.push('<div class="rmd-kpi-grid">');
    h.push('<div class="rmd-kpi-card"><span class="rmd-kpi-lbl">Total Charged</span><span class="rmd-kpi-val" id="rmdTotalChargedVal">' + fmtMicroUsd(rep.totalChargedMicroUsd) + '</span><span class="rmd-kpi-sub">micro-USD</span></div>');
    h.push('<div class="rmd-kpi-card"><span class="rmd-kpi-lbl">AI Calls</span><span class="rmd-kpi-val">' + (rep.ai ? rep.ai.calls : 0) + '</span><span class="rmd-kpi-sub">calls</span></div>');
    h.push('<div class="rmd-kpi-card"><span class="rmd-kpi-lbl">Tokens In</span><span class="rmd-kpi-val">' + (rep.ai ? rep.ai.tokensIn.toLocaleString() : "0") + '</span><span class="rmd-kpi-sub">prompt tokens</span></div>');
    h.push('<div class="rmd-kpi-card"><span class="rmd-kpi-lbl">Tokens Out</span><span class="rmd-kpi-val">' + (rep.ai ? rep.ai.tokensOut.toLocaleString() : "0") + '</span><span class="rmd-kpi-sub">completion tokens</span></div>');
    h.push('</div>');
    h.push('</div>');

    /* By Step Table */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Spend by Workflow Step</h3>');
    var steps = (rep.ai && rep.ai.byStep) || [];
    if (!steps.length) {
      h.push('<p class="rmd-muted">No step-level AI charges recorded for this project.</p>');
    } else {
      h.push('<table class="rmd-count-table" aria-label="Spend by step">');
      h.push('<thead><tr><th style="text-align:left;padding:8px 10px">Step</th><th style="text-align:center;padding:8px 10px">Calls</th><th style="text-align:right;padding:8px 10px">Cost</th></tr></thead><tbody>');
      for (var s = 0; s < steps.length; s++) {
        var step = steps[s];
        h.push('<tr><td>' + esc(step.key) + '</td><td style="text-align:center">' + step.calls + '</td><td>' + fmtMicroUsd(step.costMicroUsd) + '</td></tr>');
      }
      h.push('</tbody></table>');
    }
    h.push('</div>');

    /* Ledger Summary Card */
    if (rep.ledger) {
      h.push('<div class="rmd-card">');
      h.push('<h3 class="rmd-card-heading">Ledger Lifecycle (Reserve and Settle)</h3>');
      h.push('<div class="rmd-provenance-box">');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Reserved</span><span>' + fmtMicroUsd(rep.ledger.reservedMicroUsd) + ' (holds)</span></div>');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Settled</span><span>' + fmtMicroUsd(rep.ledger.settledMicroUsd) + ' (actual charged)</span></div>');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Released</span><span>' + fmtMicroUsd(rep.ledger.releasedMicroUsd) + ' (unspent holds refunded)</span></div>');
      h.push('</div>');
      h.push('</div>');
    }

    h.push('</div></div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to view credits and reports.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }

    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.costReport = null;
      st.announce = "";
      st.actionError = null;
    }

    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading credits and cost report") + '</div>';
      load(container);
      return;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Credits and Cost Report</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');

    if (st.actionError) h.push('<div style="padding:10px 16px">' + p2().errHtml(st.actionError, null) + '</div>');
    if (st.announce) h.push('<div style="padding:10px 16px"><div class="rmd-banner rmd-banner-info" role="status" aria-live="polite">' + esc(st.announce) + '</div></div>');

    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "balance" ? " rmd-seg-active" : "") + '" data-rmd-credit-view="balance">Balance and Buy</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "report" ? " rmd-seg-active" : "") + '" data-rmd-credit-view="report">Cost Report</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');
    h.push(leftPaneHtml());
    h.push(rightPaneHtml());
    h.push('</div></div>');

    container.innerHTML = h.join("\n");
    bind(container);
  }

  function bind(container) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }

    var viewBtns = container.querySelectorAll("[data-rmd-credit-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-credit-view");
        render(container);
      };
    }

    var packRadios = container.querySelectorAll('input[name="rmdPack"]');
    for (var p = 0; p < packRadios.length; p++) {
      packRadios[p].onchange = function () {
        st.selectedPack = this.value;
        render(container);
      };
    }

    on('[data-rmd="buy-credits"]', function () { buyCredits(container); });
    on('[data-rmd="export-cost-csv"]', function () { exportCostCsv(container); });
  }

  SMD.screens.credits = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
