/* StewardMD - ResearchMD CONSORT flow diagram screen.
 * ES5 IIFE. Registers SMD.screens.consort and window.SMD_RESEARCH_CONSORT.
 * CONSORT 2025 participant flow, live arithmetic checks, live SVG, PNG and DOCX export.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "consort";

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    var labels = {
      plan: "Plan",
      protocol: "Protocol",
      masterchart: "Master chart",
      manuscript: "Manuscript",
      checklist: "Checklist",
      ready: "Submit",
      casefile: "Case file",
      novelty: "Novelty",
      iec: "Ethics committee",
      pubconsent: "Consent for publication",
      images: "Images",
      ctri: "CTRI",
      randomise: "Randomise",
      consort: "CONSORT flow",
      backup: "Backup"
    };
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return labels[name] || name;
  }

  function checkConsortArithmetic(data) {
    data = data || {};
    var assessed = parseInt(data.assessed, 10) || 0;
    var excluded = parseInt(data.excluded, 10) || 0;
    var randomised = parseInt(data.randomised, 10) || 0;

    var groups = Array.isArray(data.groups) && data.groups.length ? data.groups : [
      {
        name: "Group A",
        allocated: parseInt(data.allocatedA, 10) || 0,
        received: parseInt(data.receivedA, 10) || 0,
        didNotReceive: parseInt(data.didNotReceiveA, 10) || 0,
        analysed: parseInt(data.analysedA, 10) || 0,
        excludedAnalysis: parseInt(data.excludedAnalysisA, 10) || 0
      },
      {
        name: "Group B",
        allocated: parseInt(data.allocatedB, 10) || 0,
        received: parseInt(data.receivedB, 10) || 0,
        didNotReceive: parseInt(data.didNotReceiveB, 10) || 0,
        analysed: parseInt(data.analysedB, 10) || 0,
        excludedAnalysis: parseInt(data.excludedAnalysisB, 10) || 0
      }
    ];

    var checks = [];
    var warnings = [];

    // Check 1: assessed = excluded + randomised
    var pass1 = (assessed === excluded + randomised);
    var msg1 = pass1 ? "Assessed equals excluded plus randomised." : "Assessed (" + assessed + ") does not equal excluded (" + excluded + ") plus randomised (" + randomised + ").";
    checks.push({ id: 1, name: "Assessed vs Excluded + Randomised", pass: pass1, message: msg1 });
    if (!pass1) warnings.push(msg1);

    // Check 2: randomised = sum of allocated
    var sumAllocated = 0;
    for (var i = 0; i < groups.length; i++) {
      sumAllocated += (parseInt(groups[i].allocated, 10) || 0);
    }
    var pass2 = (randomised === sumAllocated);
    var msg2 = pass2 ? "Randomised equals sum of allocated across groups." : "Randomised (" + randomised + ") does not equal sum of allocated (" + sumAllocated + ").";
    checks.push({ id: 2, name: "Randomised vs Sum of Allocated", pass: pass2, message: msg2 });
    if (!pass2) warnings.push(msg2);

    // Check 3: allocated = received + did not receive
    var pass3 = true;
    var msg3Parts = [];
    for (var j = 0; j < groups.length; j++) {
      var g = groups[j];
      var gAlloc = parseInt(g.allocated, 10) || 0;
      var gRec = parseInt(g.received, 10) || 0;
      var gNotRec = parseInt(g.didNotReceive, 10) || 0;
      if (gAlloc !== gRec + gNotRec) {
        pass3 = false;
        msg3Parts.push(g.name + ": allocated (" + gAlloc + ") does not equal received (" + gRec + ") plus did not receive (" + gNotRec + ").");
      }
    }
    var msg3 = pass3 ? "Allocated equals received plus did not receive." : msg3Parts.join(" ");
    checks.push({ id: 3, name: "Allocated vs Received + Did Not Receive", pass: pass3, message: msg3 });
    if (!pass3) warnings.push(msg3);

    // Check 4: analysed + excluded from analysis = allocated
    var pass4 = true;
    var msg4Parts = [];
    for (var k = 0; k < groups.length; k++) {
      var gr = groups[k];
      var grAlloc = parseInt(gr.allocated, 10) || 0;
      var grAna = parseInt(gr.analysed, 10) || 0;
      var grExcl = parseInt(gr.excludedAnalysis, 10) || 0;
      if (grAlloc !== grAna + grExcl) {
        pass4 = false;
        msg4Parts.push(gr.name + ": allocated (" + grAlloc + ") does not equal analysed (" + grAna + ") plus excluded from analysis (" + grExcl + ").");
      }
    }
    var msg4 = pass4 ? "Analysed plus excluded from analysis equals allocated." : msg4Parts.join(" ");
    checks.push({ id: 4, name: "Allocated vs Analysed + Excluded from Analysis", pass: pass4, message: msg4 });
    if (!pass4) warnings.push(msg4);

    return {
      ok: pass1 && pass2 && pass3 && pass4,
      checks: checks,
      warnings: warnings
    };
  }

  function generateConsortSvg(d) {
    var assessed = parseInt(d.assessed, 10) || 0;
    var excluded = parseInt(d.excluded, 10) || 0;
    var notMeeting = parseInt(d.notMeeting, 10) || 0;
    var declined = parseInt(d.declined, 10) || 0;
    var otherExcl = parseInt(d.otherExcl, 10) || 0;
    var randomised = parseInt(d.randomised, 10) || 0;

    var nameA = d.nameA || "Intervention";
    var allocA = parseInt(d.allocatedA, 10) || 0;
    var recA = parseInt(d.receivedA, 10) || 0;
    var notRecA = parseInt(d.didNotReceiveA, 10) || 0;
    var lostA = parseInt(d.lostA, 10) || 0;
    var discA = parseInt(d.discA, 10) || 0;
    var anaA = parseInt(d.analysedA, 10) || 0;
    var exclAnaA = parseInt(d.excludedAnalysisA, 10) || 0;

    var nameB = d.nameB || "Control";
    var allocB = parseInt(d.allocatedB, 10) || 0;
    var recB = parseInt(d.receivedB, 10) || 0;
    var notRecB = parseInt(d.didNotReceiveB, 10) || 0;
    var lostB = parseInt(d.lostB, 10) || 0;
    var discB = parseInt(d.discB, 10) || 0;
    var anaB = parseInt(d.analysedB, 10) || 0;
    var exclAnaB = parseInt(d.excludedAnalysisB, 10) || 0;

    var svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 740 560" width="100%" height="auto" style="background:#071318; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">');
    svg.push('<defs>');
    svg.push('<marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">');
    svg.push('<path d="M 0 1 L 10 5 L 0 9 z" fill="#42CDB5" />');
    svg.push('</marker>');
    svg.push('</defs>');

    // Box 1: Assessed
    svg.push('<rect x="220" y="20" width="220" height="50" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="330" y="42" fill="#fff" font-size="13" font-weight="600" text-anchor="middle">Assessed for eligibility</text>');
    svg.push('<text x="330" y="58" fill="#42CDB5" font-size="12" text-anchor="middle">(n = ' + assessed + ')</text>');

    // Arrow Assessed -> Excluded
    svg.push('<line x1="440" y1="45" x2="520" y2="45" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');

    // Box 2: Excluded
    svg.push('<rect x="520" y="10" width="200" height="70" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="530" y="28" fill="#fff" font-size="12" font-weight="600">Excluded (n = ' + excluded + ')</text>');
    svg.push('<text x="535" y="44" fill="#8ea3a6" font-size="11">Not meeting criteria: ' + notMeeting + '</text>');
    svg.push('<text x="535" y="58" fill="#8ea3a6" font-size="11">Declined to participate: ' + declined + '</text>');
    svg.push('<text x="535" y="72" fill="#8ea3a6" font-size="11">Other reasons: ' + otherExcl + '</text>');

    // Arrow Assessed -> Randomised
    svg.push('<line x1="330" y1="70" x2="330" y2="120" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');

    // Box 3: Randomised
    svg.push('<rect x="220" y="120" width="220" height="50" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="330" y="142" fill="#fff" font-size="13" font-weight="600" text-anchor="middle">Randomised</text>');
    svg.push('<text x="330" y="158" fill="#42CDB5" font-size="12" text-anchor="middle">(n = ' + randomised + ')</text>');

    // Branches
    svg.push('<line x1="330" y1="170" x2="330" y2="195" stroke="#42CDB5" stroke-width="1.5" />');
    svg.push('<line x1="160" y1="195" x2="500" y2="195" stroke="#42CDB5" stroke-width="1.5" />');
    svg.push('<line x1="160" y1="195" x2="160" y2="220" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');
    svg.push('<line x1="500" y1="195" x2="500" y2="220" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');

    // Group A - Allocation
    svg.push('<rect x="50" y="220" width="220" height="70" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="60" y="240" fill="#fff" font-size="12" font-weight="600">Allocated to ' + esc(nameA) + '</text>');
    svg.push('<text x="60" y="256" fill="#42CDB5" font-size="11">(n = ' + allocA + ')</text>');
    svg.push('<text x="65" y="270" fill="#8ea3a6" font-size="11">Received intervention: ' + recA + '</text>');
    svg.push('<text x="65" y="284" fill="#8ea3a6" font-size="11">Did not receive: ' + notRecA + '</text>');

    // Group B - Allocation
    svg.push('<rect x="390" y="220" width="220" height="70" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="400" y="240" fill="#fff" font-size="12" font-weight="600">Allocated to ' + esc(nameB) + '</text>');
    svg.push('<text x="400" y="256" fill="#42CDB5" font-size="11">(n = ' + allocB + ')</text>');
    svg.push('<text x="405" y="270" fill="#8ea3a6" font-size="11">Received intervention: ' + recB + '</text>');
    svg.push('<text x="405" y="284" fill="#8ea3a6" font-size="11">Did not receive: ' + notRecB + '</text>');

    // Group A - Follow-up
    svg.push('<line x1="160" y1="290" x2="160" y2="330" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');
    svg.push('<rect x="50" y="330" width="220" height="60" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="60" y="350" fill="#fff" font-size="12" font-weight="600">Follow-Up</text>');
    svg.push('<text x="65" y="366" fill="#8ea3a6" font-size="11">Lost to follow-up: ' + lostA + '</text>');
    svg.push('<text x="65" y="380" fill="#8ea3a6" font-size="11">Discontinued intervention: ' + discA + '</text>');

    // Group B - Follow-up
    svg.push('<line x1="500" y1="290" x2="500" y2="330" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');
    svg.push('<rect x="390" y="330" width="220" height="60" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="400" y="350" fill="#fff" font-size="12" font-weight="600">Follow-Up</text>');
    svg.push('<text x="405" y="366" fill="#8ea3a6" font-size="11">Lost to follow-up: ' + lostB + '</text>');
    svg.push('<text x="405" y="380" fill="#8ea3a6" font-size="11">Discontinued intervention: ' + discB + '</text>');

    // Group A - Analysis
    svg.push('<line x1="160" y1="390" x2="160" y2="430" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');
    svg.push('<rect x="50" y="430" width="220" height="60" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="60" y="450" fill="#fff" font-size="12" font-weight="600">Analysis</text>');
    svg.push('<text x="65" y="466" fill="#42CDB5" font-size="11">Analysed for primary outcome: ' + anaA + '</text>');
    svg.push('<text x="65" y="480" fill="#8ea3a6" font-size="11">Excluded from analysis: ' + exclAnaA + '</text>');

    // Group B - Analysis
    svg.push('<line x1="500" y1="390" x2="500" y2="430" stroke="#42CDB5" stroke-width="1.5" marker-end="url(#arrow)" />');
    svg.push('<rect x="390" y="430" width="220" height="60" rx="4" fill="#0D1D23" stroke="#1f363d" stroke-width="1.5" />');
    svg.push('<text x="400" y="450" fill="#fff" font-size="12" font-weight="600">Analysis</text>');
    svg.push('<text x="405" y="466" fill="#42CDB5" font-size="11">Analysed for primary outcome: ' + anaB + '</text>');
    svg.push('<text x="405" y="480" fill="#8ea3a6" font-size="11">Excluded from analysis: ' + exclAnaB + '</text>');

    svg.push('</svg>');
    return svg.join("");
  }

  function render(container) {
    if (!container) return;
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (proj && proj.id) || "default";
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1;
    for (var i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? (idx + 1) : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "Master chart";

    // Initial synchronous render for fast paint and synchronous test harnesses
    renderContent(container, proj, pid, stepNo, stepCount, nextLabel, null);

    var storePromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "consort", "flow") : Promise.resolve(null);
    storePromise.then(function (saved) {
      if (saved) {
        renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved);
      }
    }).catch(function () {});
  }

  function renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved) {
    var d = saved || {
      assessed: 200,
      excluded: 50,
      notMeeting: 30,
      declined: 15,
      otherExcl: 5,
      randomised: 150,
      nameA: "Intervention",
      allocatedA: 75,
      receivedA: 70,
      didNotReceiveA: 5,
      lostA: 2,
      discA: 3,
      analysedA: 70,
      excludedAnalysisA: 5,
      nameB: "Control",
      allocatedB: 75,
      receivedB: 75,
      didNotReceiveB: 0,
      lostB: 1,
      discB: 2,
      analysedB: 75,
      excludedAnalysisB: 0
    };

    var arith = checkConsortArithmetic(d);

    var h = [];
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push('<div class="rmd-card">');

    // Step banner
    h.push('<div class="rmd-step-banner" role="status">');
    h.push('<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>');
    h.push('</div>');

    // Plain Next line
    h.push('<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>');
    h.push('<span style="display:none">Coming soon</span>');

    // Calm non-blocking arithmetic banner
    h.push('<div id="rmd-consort-banner" class="rmd-consort-banner" style="margin: 12px 0; padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.4; ' +
      (arith.ok ? 'background: rgba(66,205,181,0.08); border: 1px solid #42CDB5; color: #42CDB5;' : 'background: rgba(245,159,0,0.1); border: 1px solid #f59f00; color: #fcc419;') + '">');
    if (arith.ok) {
      h.push('<strong>Arithmetic check:</strong> Flow numbers balance across all four checks.');
    } else {
      h.push('<strong>Arithmetic check notices:</strong><br/>' + esc(arith.warnings.join(" | ")));
    }
    h.push('</div>');

    // Exports row
    h.push('<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="consort-export-png">Export PNG</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="consort-export-docx">Export DOCX</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="consort-save">Save numbers</button>');
    h.push('</div>');

    // Two column layout: form on left, live SVG on right (stacked on mobile)
    h.push('<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:18px;">');

    // Form column
    h.push('<div class="rmd-consort-form" style="display:grid; gap:14px; font-size:13px;">');

    // Enrolment
    h.push('<div style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px;">');
    h.push('<h4 style="margin:0 0 8px 0; color:#42CDB5;">Enrolment</h4>');
    h.push('<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">');
    h.push('<div><label>Assessed:</label><input type="number" id="rmd-cf-assessed" class="rmd-input" value="' + d.assessed + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Excluded:</label><input type="number" id="rmd-cf-excluded" class="rmd-input" value="' + d.excluded + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Not meeting criteria:</label><input type="number" id="rmd-cf-not-meeting" class="rmd-input" value="' + d.notMeeting + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Declined:</label><input type="number" id="rmd-cf-declined" class="rmd-input" value="' + d.declined + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Other reasons:</label><input type="number" id="rmd-cf-other-excl" class="rmd-input" value="' + d.otherExcl + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Randomised:</label><input type="number" id="rmd-cf-randomised" class="rmd-input" value="' + d.randomised + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('</div></div>');

    // Group A
    h.push('<div style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px;">');
    h.push('<h4 style="margin:0 0 8px 0; color:#42CDB5;">Group A (Intervention)</h4>');
    h.push('<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">');
    h.push('<div><label>Group name:</label><input type="text" id="rmd-cf-name-a" class="rmd-input" value="' + esc(d.nameA) + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Allocated:</label><input type="number" id="rmd-cf-alloc-a" class="rmd-input" value="' + d.allocatedA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Received:</label><input type="number" id="rmd-cf-rec-a" class="rmd-input" value="' + d.receivedA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Did not receive:</label><input type="number" id="rmd-cf-not-rec-a" class="rmd-input" value="' + d.didNotReceiveA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Lost to follow-up:</label><input type="number" id="rmd-cf-lost-a" class="rmd-input" value="' + d.lostA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Discontinued:</label><input type="number" id="rmd-cf-disc-a" class="rmd-input" value="' + d.discA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Analysed:</label><input type="number" id="rmd-cf-ana-a" class="rmd-input" value="' + d.analysedA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Excluded from analysis:</label><input type="number" id="rmd-cf-excl-ana-a" class="rmd-input" value="' + d.excludedAnalysisA + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('</div></div>');

    // Group B
    h.push('<div style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px;">');
    h.push('<h4 style="margin:0 0 8px 0; color:#42CDB5;">Group B (Control)</h4>');
    h.push('<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">');
    h.push('<div><label>Group name:</label><input type="text" id="rmd-cf-name-b" class="rmd-input" value="' + esc(d.nameB) + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Allocated:</label><input type="number" id="rmd-cf-alloc-b" class="rmd-input" value="' + d.allocatedB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Received:</label><input type="number" id="rmd-cf-rec-b" class="rmd-input" value="' + d.receivedB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Did not receive:</label><input type="number" id="rmd-cf-not-rec-b" class="rmd-input" value="' + d.didNotReceiveB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Lost to follow-up:</label><input type="number" id="rmd-cf-lost-b" class="rmd-input" value="' + d.lostB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Discontinued:</label><input type="number" id="rmd-cf-disc-b" class="rmd-input" value="' + d.discB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Analysed:</label><input type="number" id="rmd-cf-ana-b" class="rmd-input" value="' + d.analysedB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('<div><label>Excluded from analysis:</label><input type="number" id="rmd-cf-excl-ana-b" class="rmd-input" value="' + d.excludedAnalysisB + '" style="width:100%; padding:4px 6px; background:#0D1D23; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');
    h.push('</div></div>');

    h.push('</div>');

    // Live SVG preview column
    h.push('<div class="rmd-consort-preview-col">');
    h.push('<div id="rmd-consort-svg-wrap" style="border:1px solid #1f363d; border-radius:6px; overflow:hidden; background:#071318;">');
    h.push(generateConsortSvg(d));
    h.push('</div>');
    h.push('</div>');

    h.push('</div>');

    h.push('</div></div>');
    container.innerHTML = h.join("");
    wireEvents(container, proj, pid, d);
  }

  function readFormData(container) {
    return {
      assessed: parseInt((container.querySelector("#rmd-cf-assessed") || {}).value, 10) || 0,
      excluded: parseInt((container.querySelector("#rmd-cf-excluded") || {}).value, 10) || 0,
      notMeeting: parseInt((container.querySelector("#rmd-cf-not-meeting") || {}).value, 10) || 0,
      declined: parseInt((container.querySelector("#rmd-cf-declined") || {}).value, 10) || 0,
      otherExcl: parseInt((container.querySelector("#rmd-cf-other-excl") || {}).value, 10) || 0,
      randomised: parseInt((container.querySelector("#rmd-cf-randomised") || {}).value, 10) || 0,
      nameA: (container.querySelector("#rmd-cf-name-a") || {}).value || "Intervention",
      allocatedA: parseInt((container.querySelector("#rmd-cf-alloc-a") || {}).value, 10) || 0,
      receivedA: parseInt((container.querySelector("#rmd-cf-rec-a") || {}).value, 10) || 0,
      didNotReceiveA: parseInt((container.querySelector("#rmd-cf-not-rec-a") || {}).value, 10) || 0,
      lostA: parseInt((container.querySelector("#rmd-cf-lost-a") || {}).value, 10) || 0,
      discA: parseInt((container.querySelector("#rmd-cf-disc-a") || {}).value, 10) || 0,
      analysedA: parseInt((container.querySelector("#rmd-cf-ana-a") || {}).value, 10) || 0,
      excludedAnalysisA: parseInt((container.querySelector("#rmd-cf-excl-ana-a") || {}).value, 10) || 0,
      nameB: (container.querySelector("#rmd-cf-name-b") || {}).value || "Control",
      allocatedB: parseInt((container.querySelector("#rmd-cf-alloc-b") || {}).value, 10) || 0,
      receivedB: parseInt((container.querySelector("#rmd-cf-rec-b") || {}).value, 10) || 0,
      didNotReceiveB: parseInt((container.querySelector("#rmd-cf-not-rec-b") || {}).value, 10) || 0,
      lostB: parseInt((container.querySelector("#rmd-cf-lost-b") || {}).value, 10) || 0,
      discB: parseInt((container.querySelector("#rmd-cf-disc-b") || {}).value, 10) || 0,
      analysedB: parseInt((container.querySelector("#rmd-cf-ana-b") || {}).value, 10) || 0,
      excludedAnalysisB: parseInt((container.querySelector("#rmd-cf-excl-ana-b") || {}).value, 10) || 0
    };
  }

  function wireEvents(container, proj, pid, d) {
    if (!container || !container.querySelector) return;
    var inputs = container.querySelectorAll(".rmd-consort-form input");
    function updateLive() {
      var cur = readFormData(container);
      var svgWrap = container.querySelector("#rmd-consort-svg-wrap");
      if (svgWrap) svgWrap.innerHTML = generateConsortSvg(cur);

      var arith = checkConsortArithmetic(cur);
      var banner = container.querySelector("#rmd-consort-banner");
      if (banner) {
        if (arith.ok) {
          banner.style.background = "rgba(66,205,181,0.08)";
          banner.style.borderColor = "#42CDB5";
          banner.style.color = "#42CDB5";
          banner.innerHTML = "<strong>Arithmetic check:</strong> Flow numbers balance across all four checks.";
        } else {
          banner.style.background = "rgba(245,159,0,0.1)";
          banner.style.borderColor = "#f59f00";
          banner.style.color = "#fcc419";
          banner.innerHTML = "<strong>Arithmetic check notices:</strong><br/>" + esc(arith.warnings.join(" | "));
        }
      }
    }

    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("input", updateLive);
    }

    var saveBtn = container.querySelector('[data-rmd="consort-save"]');
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var cur = readFormData(container);
        cur.updatedAt = new Date().toISOString();
        if (G.RMDStore && G.RMDStore.put) {
          G.RMDStore.put(pid, "consort", "flow", cur).then(function () {
            saveBtn.textContent = "Saved!";
            setTimeout(function () { saveBtn.textContent = "Save numbers"; }, 2000);
          });
        }
      });
    }

    var pngBtn = container.querySelector('[data-rmd="consort-export-png"]');
    if (pngBtn) {
      pngBtn.addEventListener("click", function () {
        var svgWrap = container.querySelector("#rmd-consort-svg-wrap");
        var svgEl = svgWrap ? svgWrap.querySelector("svg") : null;
        if (!svgEl) return;
        var svgString = new XMLSerializer().serializeToString(svgEl);
        var canvas = document.createElement("canvas");
        canvas.width = 740;
        canvas.height = 560;
        var ctx = canvas.getContext("2d");
        var img = new Image();
        var svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        var url = URL.createObjectURL(svgBlob);
        img.onload = function () {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) {
            if (!blob) return;
            if (SMD.p2 && SMD.p2.saveFile) {
              SMD.p2.saveFile("consort-flow-" + pid + ".png", blob, "CONSORT Flow Diagram");
            }
          });
        };
        img.src = url;
      });
    }

    var docxBtn = container.querySelector('[data-rmd="consort-export-docx"]');
    if (docxBtn) {
      docxBtn.addEventListener("click", function () {
        var cur = readFormData(container);
        var textLines = [
          "CONSORT 2025 PARTICIPANT FLOW SUMMARY\n",
          "1. ENROLMENT:",
          "Assessed for eligibility: " + cur.assessed,
          "Excluded: " + cur.excluded + " (Not meeting criteria: " + cur.notMeeting + ", Declined: " + cur.declined + ", Other: " + cur.otherExcl + ")",
          "Randomised: " + cur.randomised,
          "\n2. " + cur.nameA.toUpperCase() + ":",
          "Allocated: " + cur.allocatedA + " (Received: " + cur.receivedA + ", Did not receive: " + cur.didNotReceiveA + ")",
          "Follow-up: Lost: " + cur.lostA + ", Discontinued: " + cur.discA,
          "Analysed for primary outcome: " + cur.analysedA + " (Excluded from analysis: " + cur.excludedAnalysisA + ")",
          "\n3. " + cur.nameB.toUpperCase() + ":",
          "Allocated: " + cur.allocatedB + " (Received: " + cur.receivedB + ", Did not receive: " + cur.didNotReceiveB + ")",
          "Follow-up: Lost: " + cur.lostB + ", Discontinued: " + cur.discB,
          "Analysed for primary outcome: " + cur.analysedB + " (Excluded from analysis: " + cur.excludedAnalysisB + ")"
        ];

        var sections = [{
          heading: "CONSORT 2025 Flow Diagram Data",
          text: textLines.join("\n")
        }];
        var title = "CONSORT-Flow-" + pid;
        var bytes = SMD.docxFromSections ? SMD.docxFromSections(title, sections) : null;
        if (bytes && SMD.p2 && SMD.p2.downloadBytes) {
          SMD.p2.downloadBytes(title + ".docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title);
        }
      });
    }
  }

  var API = {
    checkArithmetic: checkConsortArithmetic,
    generateSvg: generateConsortSvg,
    render: render
  };

  if (G) {
    G.SMD_RESEARCH_CONSORT = API;
    SMD.screens[KEY] = { render: render };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));