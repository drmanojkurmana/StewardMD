/* StewardMD - ResearchMD randomise screen.
 * ES5 IIFE. Registers SMD.screens.randomise.
 * Allocation concealment, random sequence generation, and blinding card.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "randomise";

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

  function sha256Fingerprint(text) {
    if (G.crypto && G.crypto.subtle && G.crypto.subtle.digest) {
      try {
        var enc = new TextEncoder();
        return G.crypto.subtle.digest("SHA-256", enc.encode(text)).then(function (buf) {
          var b = new Uint8Array(buf);
          var hex = "";
          for (var i = 0; i < b.length; i++) {
            var h = b[i].toString(16);
            if (h.length === 1) h = "0" + h;
            hex += h;
          }
          return hex;
        }).catch(function () { return null; });
      } catch (e) {
        return Promise.resolve(null);
      }
    }
    return Promise.resolve(null);
  }

  function plannedSampleSize(proj, pid) {
    var plan = (proj && proj.plan) || null;
    if (!plan && G.localStorage) {
      try {
        var raw = G.localStorage.getItem("smd_research_plan_" + pid);
        if (raw) plan = JSON.parse(raw);
      } catch (e) { plan = null; }
    }
    if (!plan) return 50;
    var ss = G.SMD_RESEARCH_SAMPLESIZE;
    var inp = plan.ssInputs || {};
    var aim = plan.aim;
    var res = null;
    if (ss && aim) {
      try {
        if (aim === "two_proportions") {
          res = ss.twoProportions({ p1: Number(inp.p1), p2: Number(inp.p2), alpha: Number(inp.alpha) || 0.05, power: Number(inp.power) || 0.80, ratio: Number(inp.ratio) || 1, dropout: Number(inp.dropout) || 0 });
        } else if (aim === "two_means") {
          res = ss.twoMeans({ diff: Number(inp.diff), sd: Number(inp.sd), alpha: Number(inp.alpha) || 0.05, power: Number(inp.power) || 0.80, ratio: Number(inp.ratio) || 1, dropout: Number(inp.dropout) || 0 });
        } else if (aim === "single_proportion") {
          var opts = { p: Number(inp.p), precision: Number(inp.precision), alpha: Number(inp.alpha) || 0.05, dropout: Number(inp.dropout) || 0 };
          if (inp.population && Number(inp.population) > 0) opts.population = Number(inp.population);
          res = ss.singleProportion(opts);
        } else if (aim === "single_mean") {
          res = ss.singleMean({ sd: Number(inp.sd), precision: Number(inp.precision), alpha: Number(inp.alpha) || 0.05, dropout: Number(inp.dropout) || 0 });
        } else if (aim === "correlation") {
          res = ss.correlation({ r: Number(inp.r), alpha: Number(inp.alpha) || 0.05, power: Number(inp.power) || 0.80, dropout: Number(inp.dropout) || 0 });
        } else if (aim === "case_control") {
          res = ss.caseControl({ p0: Number(inp.p0), or: Number(inp.or), ratio: Number(inp.ratio) || 1, alpha: Number(inp.alpha) || 0.05, power: Number(inp.power) || 0.80, dropout: Number(inp.dropout) || 0 });
        } else if (aim === "time_to_event") {
          res = ss.logRankEvents({ hr: Number(inp.hr), alpha: Number(inp.alpha) || 0.05, power: Number(inp.power) || 0.80, allocation: Number(inp.allocation) || 0.5, probEvent: Number(inp.probEvent), dropout: Number(inp.dropout) || 0 });
        }
      } catch (e) { res = null; }
    }
    var total = 0;
    if (res && res.ok !== false) total = Number(res.totalWithDropout || res.total) || 0;
    if (!(total > 0)) total = parseInt(plan.ctriData && plan.ctriData.targetSampleSize, 10);
    return total > 0 ? total : 50;
  }

  function generateBlindingParagraph(data) {
    if (!data) return "";
    if (data.unblinded) {
      var reason = (data.reason || "the nature of the intervention did not permit masking").trim();
      return "Nobody was blinded, because " + reason + ".";
    }
    var groups = data.groups || [];
    if (!groups.length) {
      return "Nobody was blinded.";
    }
    var groupNames = [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i] === "participants") groupNames.push("participants");
      else if (groups[i] === "care_providers") groupNames.push("care providers");
      else if (groups[i] === "outcome_assessors") groupNames.push("outcome assessors");
      else if (groups[i] === "data_analysts") groupNames.push("data analysts");
      else groupNames.push(groups[i]);
    }
    var groupListStr = "";
    if (groupNames.length === 1) groupListStr = groupNames[0];
    else if (groupNames.length === 2) groupListStr = groupNames[0] + " and " + groupNames[1];
    else groupListStr = groupNames.slice(0, -1).join(", ") + ", and " + groupNames[groupNames.length - 1];

    var methodStr = data.how || "identical treatment packs";
    return groupListStr.charAt(0).toUpperCase() + groupListStr.slice(1) + " were blinded to intervention allocation using " + methodStr + ".";
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
    renderContent(container, proj, pid, stepNo, stepCount, nextLabel, false, null, null);

    // Check CTRI registration status
    var ctriPromise = (G.RMDCtri && G.RMDCtri.registered) ? G.RMDCtri.registered(pid) : Promise.resolve(false);
    var storePromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "randomfingerprint", "main") : Promise.resolve(null);
    var blindingPromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "blinding", "blinding") : Promise.resolve(null);

    Promise.all([ctriPromise, storePromise, blindingPromise]).then(function (res) {
      var isCtriReg = res[0];
      var savedFp = res[1];
      var savedBlinding = res[2];
      renderContent(container, proj, pid, stepNo, stepCount, nextLabel, isCtriReg, savedFp, savedBlinding);
    }).catch(function () {});
  }

  function renderContent(container, proj, pid, stepNo, stepCount, nextLabel, isCtriReg, savedFp, savedBlinding) {
    var h = [];
    var plannedN = plannedSampleSize(proj, pid);
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push('<div class="rmd-card">');

    // Step banner
    h.push('<div class="rmd-step-banner" role="status">');
    h.push('<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>');
    h.push('</div>');

    // Plain Next line
    h.push('<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>');
    h.push('<span style="display:none">Coming soon</span>');

    // CTRI banner until registered
    if (!isCtriReg) {
      h.push('<div class="rmd-ctri-unregistered-banner" style="margin: 12px 0; padding: 12px; background: rgba(255, 107, 107, 0.1); border: 1px solid #ff6b6b; border-radius: 6px; color: #ff8787;">');
      h.push('<strong>CTRI Notice:</strong> Register on CTRI before you enrol the first patient.');
      h.push('</div>');
    }

    // Allocation concealment guidance box
    h.push('<div class="rmd-concealment-guidance" style="margin: 12px 0; padding: 14px; background: rgba(66,205,181,0.06); border: 1px solid #1f363d; border-radius: 6px; font-size:13px; line-height:1.5;">');
    h.push('<strong style="color:#42CDB5;">Allocation Concealment Guidance:</strong>');
    h.push('<ul style="margin:6px 0 0 18px; padding:0;">');
    h.push('<li><strong>Keep assignments hidden:</strong> Ensure the next treatment allocation remains completely concealed from investigators and patients until after formal enrolment and consent.</li>');
    h.push('<li><strong>Sequentially numbered opaque sealed envelopes:</strong> Prepare identical opaque envelopes containing allocation slips, sealed and opened strictly in numeric order only when a participant enters the trial.</li>');
    h.push('<li><strong>Why not alternate days or birthdates:</strong> Predictable schemes (odd/even dates, alternating days) allow investigators to anticipate assignments, leading to severe selection bias.</li>');
    h.push('</ul>');
    h.push('</div>');

    // 1. List keeper question first
    h.push('<div class="rmd-keeper-card" style="border:1px solid #1f363d; padding:16px; border-radius:6px; margin-bottom:16px; background:#071318;">');
    h.push('<h4 style="margin:0 0 10px 0;">Who is making this list?</h4>');
    h.push('<div style="display:grid; gap:8px;">');
    h.push('<label style="display:flex; align-items:flex-start; gap:8px; font-size:13px; cursor:pointer;">');
    h.push('<input type="radio" name="rmd-list-keeper" id="rmd-keeper-yes" value="keeper" checked />');
    h.push('<span><strong>I am the list keeper</strong> (I do not recruit or assess patients)</span>');
    h.push('</label>');
    h.push('<label style="display:flex; align-items:flex-start; gap:8px; font-size:13px; cursor:pointer;">');
    h.push('<input type="radio" name="rmd-list-keeper" id="rmd-keeper-no" value="recruiter" />');
    h.push('<span>I recruit, treat, or assess trial patients</span>');
    h.push('</label>');
    h.push('</div>');
    h.push('<div id="rmd-keeper-warning" role="alert" style="display:none; margin-top:12px; padding:10px; background:rgba(255,107,107,0.1); border:1px solid #ff6b6b; border-radius:4px; font-size:13px; color:#ff8787;">');
    h.push('Recruiters cannot view or make the allocation list. Ask your guide or statistician (the list keeper) to make it.');
    h.push('</div>');
    h.push('</div>');

    // 2. Generation Panel
    h.push('<div id="rmd-randomise-panel" style="border:1px solid #1f363d; padding:16px; border-radius:6px; margin-bottom:16px;">');
    h.push('<h4 style="margin-top:0;">Randomisation parameters</h4>');

    h.push('<div style="display:grid; gap:12px; margin-bottom:14px;">');
    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Trial arms (comma-separated):</label>');
    h.push('<input type="text" id="rmd-rand-arms" class="rmd-input" value="Intervention, Control" style="width:100%; max-width:320px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');

    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Allocation ratio (e.g. 1:1 or 2:1):</label>');
    h.push('<input type="text" id="rmd-rand-ratio" class="rmd-input" value="1:1" style="width:100%; max-width:180px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');

    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Sample size per stratum:</label>');
    h.push('<input type="number" id="rmd-rand-n" class="rmd-input" value="' + plannedN + '" min="4" style="width:100%; max-width:180px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');

    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Block sizes (comma-separated, multiples of ratio sum):</label>');
    h.push('<input type="text" id="rmd-rand-blocks" class="rmd-input" value="4, 6" style="width:100%; max-width:240px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');

    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Strata (optional, comma-separated e.g. Centre 1, Centre 2):</label>');
    h.push('<input type="text" id="rmd-rand-strata" class="rmd-input" placeholder="e.g. Centre A, Centre B" style="width:100%; max-width:320px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');

    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Seed (optional text for reproducibility):</label>');
    h.push('<input type="text" id="rmd-rand-seed" class="rmd-input" placeholder="e.g. trial-seed-2026" style="width:100%; max-width:240px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" /></div>');

    // Default ticked checkbox: Remove the list from this phone
    h.push('<div><label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">');
    h.push('<input type="checkbox" id="rmd-rand-remove-phone" checked />');
    h.push('<strong>Remove the list from this phone</strong> (only the cryptographic fingerprint stays)');
    h.push('</label></div>');

    h.push('</div>');

    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="generate-random-list">Generate randomisation list</button>');
    h.push('<div id="rmd-rand-status" style="margin-top:10px; font-size:13px;"></div>');

    // Output and exports section
    h.push('<div id="rmd-rand-results" style="display:none; margin-top:16px; padding-top:14px; border-top:1px solid #1f363d;">');
    h.push('<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-rand-csv">Export CSV</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-envelope-docx">Envelope Labels (DOCX)</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-keeper-docx">Keeper Sheet (DOCX)</button>');
    h.push('</div>');
    h.push('<div id="rmd-fingerprint-box" style="background:#071318; border:1px solid #42CDB5; border-radius:4px; padding:10px; font-size:12px; font-family:monospace; word-break:break-all;"></div>');
    h.push('</div>');

    if (savedFp && savedFp.fingerprint) {
      h.push('<div class="rmd-saved-fp-card" style="margin-top:14px; padding:10px; background:rgba(66,205,181,0.06); border:1px solid #42CDB5; border-radius:4px; font-size:12px;">');
      h.push('<strong>Stored List Fingerprint (SHA-256):</strong><br/><span style="font-family:monospace; word-break:break-all;">' + esc(savedFp.fingerprint) + '</span>');
      h.push('</div>');
    }

    h.push('</div>');

    // 3. Blinding Card on the same screen
    h.push('<div class="rmd-blinding-card" style="border:1px solid #1f363d; padding:16px; border-radius:6px; margin-bottom:16px;">');
    h.push('<h4 style="margin:0 0 10px 0;">Blinding (Masking) Specification</h4>');
    h.push('<p style="font-size:12px; color:#8ea3a6; margin-bottom:12px;">CONSORT requires naming exactly which groups were blinded and how. Do not use ambiguous terms like single, double or triple blind.</p>');

    var isUnblinded = savedBlinding ? !!savedBlinding.unblinded : false;
    var unblindReason = (savedBlinding && savedBlinding.reason) || "";
    var blindedGroups = (savedBlinding && savedBlinding.groups) || ["participants", "care_providers", "outcome_assessors"];
    var howBlinded = (savedBlinding && savedBlinding.how) || "identical tablets";

    h.push('<div style="margin-bottom:12px;">');
    h.push('<label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; margin-bottom:8px;">');
    h.push('<input type="checkbox" id="rmd-blinding-none"' + (isUnblinded ? ' checked' : '') + ' />');
    h.push('Nobody was blinded, because...');
    h.push('</label>');
    h.push('<input type="text" id="rmd-blinding-none-reason" class="rmd-input" placeholder="e.g. surgical vs medical treatment could not be masked" value="' + esc(unblindReason) + '" style="width:100%; max-width:480px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;' + (isUnblinded ? '' : ' display:none;') + '" />');
    h.push('</div>');

    h.push('<div id="rmd-blinding-groups-block"' + (isUnblinded ? ' style="display:none;"' : '') + '>');
    h.push('<p style="font-size:13px; font-weight:600; margin:8px 0 6px 0;">Groups blinded:</p>');
    h.push('<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin-bottom:12px;">');
    h.push('<label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;"><input type="checkbox" class="rmd-blind-group" value="participants"' + (blindedGroups.indexOf("participants") >= 0 ? ' checked' : '') + ' /> Participants</label>');
    h.push('<label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;"><input type="checkbox" class="rmd-blind-group" value="care_providers"' + (blindedGroups.indexOf("care_providers") >= 0 ? ' checked' : '') + ' /> Care providers</label>');
    h.push('<label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;"><input type="checkbox" class="rmd-blind-group" value="outcome_assessors"' + (blindedGroups.indexOf("outcome_assessors") >= 0 ? ' checked' : '') + ' /> Outcome assessors</label>');
    h.push('<label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;"><input type="checkbox" class="rmd-blind-group" value="data_analysts"' + (blindedGroups.indexOf("data_analysts") >= 0 ? ' checked' : '') + ' /> Data analysts</label>');
    h.push('</div>');

    h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px; font-weight:600;">How blinding was achieved:</label>');
    h.push('<select id="rmd-blind-how" class="rmd-select" style="width:100%; max-width:340px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;">');
    h.push('<option value="identical tablets"' + (howBlinded === "identical tablets" ? ' selected' : '') + '>Identical tablets / matched placebo</option>');
    h.push('<option value="sham procedure"' + (howBlinded === "sham procedure" ? ' selected' : '') + '>Sham procedure / matched intervention</option>');
    h.push('<option value="coded samples"' + (howBlinded === "coded samples" ? ' selected' : '') + '>Coded samples / vials</option>');
    h.push('<option value="coded opaque treatment packs"' + (howBlinded === "coded opaque treatment packs" ? ' selected' : '') + '>Coded opaque treatment packs</option>');
    h.push('</select></div>');
    h.push('</div>');

    h.push('<div style="margin-top:14px;">');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="save-blinding">Save blinding paragraph</button>');
    h.push('</div>');

    var currentParagraph = savedBlinding && savedBlinding.paragraph ? savedBlinding.paragraph : generateBlindingParagraph({
      unblinded: isUnblinded,
      reason: unblindReason,
      groups: blindedGroups,
      how: howBlinded
    });

    h.push('<div id="rmd-blinding-result-box" style="margin-top:14px; background:#071318; border:1px solid #1f363d; padding:12px; border-radius:4px;">');
    h.push('<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">');
    h.push('<strong style="font-size:13px; color:#42CDB5;">Methods Section Paragraph:</strong>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="copy-blinding-para">Copy</button>');
    h.push('</div>');
    h.push('<p id="rmd-blinding-text" style="font-size:13px; margin:0; line-height:1.4;">' + esc(currentParagraph) + '</p>');
    h.push('</div>');

    h.push('</div>');

    h.push('</div></div>');
    container.innerHTML = h.join("");
    wireEvents(container, proj, pid, savedFp, savedBlinding);
  }

  function wireEvents(container, proj, pid, savedFp, savedBlinding) {
    if (!container || !container.querySelector) return;
    var keeperYes = container.querySelector("#rmd-keeper-yes");
    var keeperNo = container.querySelector("#rmd-keeper-no");
    var keeperWarn = container.querySelector("#rmd-keeper-warning");
    var randPanel = container.querySelector("#rmd-randomise-panel");

    function isRecruiter() {
      return !!(keeperNo && keeperNo.checked);
    }

    function updateKeeper() {
      if (isRecruiter()) {
        if (keeperWarn) keeperWarn.style.display = "block";
        if (randPanel) randPanel.style.display = "none";
      } else {
        if (keeperWarn) keeperWarn.style.display = "none";
        if (randPanel) randPanel.style.display = "block";
      }
    }
    if (keeperYes) keeperYes.addEventListener("change", updateKeeper);
    if (keeperNo) keeperNo.addEventListener("change", updateKeeper);
    updateKeeper();

    // Blinding checkbox toggle
    var noneCheck = container.querySelector("#rmd-blinding-none");
    var noneReason = container.querySelector("#rmd-blinding-none-reason");
    var groupsBlock = container.querySelector("#rmd-blinding-groups-block");
    if (noneCheck) {
      noneCheck.addEventListener("change", function () {
        if (noneCheck.checked) {
          if (noneReason) noneReason.style.display = "block";
          if (groupsBlock) groupsBlock.style.display = "none";
        } else {
          if (noneReason) noneReason.style.display = "none";
          if (groupsBlock) groupsBlock.style.display = "block";
        }
      });
    }

    var saveBlindingBtn = container.querySelector('[data-rmd="save-blinding"]');
    if (saveBlindingBtn) {
      saveBlindingBtn.addEventListener("click", function () {
        var unblinded = noneCheck ? noneCheck.checked : false;
        var reason = noneReason ? noneReason.value : "";
        var groupCheckboxes = container.querySelectorAll(".rmd-blind-group:checked");
        var groups = [];
        for (var g = 0; g < groupCheckboxes.length; g++) groups.push(groupCheckboxes[g].value);
        var howSelect = container.querySelector("#rmd-blind-how");
        var how = howSelect ? howSelect.value : "identical tablets";

        var para = generateBlindingParagraph({
          unblinded: unblinded,
          reason: reason,
          groups: groups,
          how: how
        });

        var textEl = container.querySelector("#rmd-blinding-text");
        if (textEl) textEl.textContent = para;

        var rec = {
          unblinded: unblinded,
          reason: reason,
          groups: groups,
          how: how,
          paragraph: para,
          updatedAt: new Date().toISOString()
        };

        if (G.RMDStore && G.RMDStore.put) {
          G.RMDStore.put(pid, "blinding", "blinding", rec);
        }
      });
    }

    var copyBlindingBtn = container.querySelector('[data-rmd="copy-blinding-para"]');
    if (copyBlindingBtn) {
      copyBlindingBtn.addEventListener("click", function () {
        var textEl = container.querySelector("#rmd-blinding-text");
        if (textEl && G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(textEl.textContent).then(function () {
            copyBlindingBtn.textContent = "Copied!";
            setTimeout(function () { copyBlindingBtn.textContent = "Copy"; }, 2000);
          });
        }
      });
    }

    // Generate randomisation list
    var lastGenerated = null;
    var genBtn = container.querySelector('[data-rmd="generate-random-list"]');
    if (genBtn) {
      genBtn.addEventListener("click", function () {
        var statusEl = container.querySelector("#rmd-rand-status");
        var resultsEl = container.querySelector("#rmd-rand-results");
        var fpBox = container.querySelector("#rmd-fingerprint-box");
        var removeCheck = container.querySelector("#rmd-rand-remove-phone");

        if (isRecruiter()) {
          lastGenerated = null;
          if (resultsEl) resultsEl.style.display = "none";
          if (statusEl) statusEl.innerHTML = '<span style="color:#ff8787;">Recruiters cannot view or make the allocation list. Ask your guide or statistician (the list keeper) to make it.</span>';
          return;
        }

        var armsInput = (container.querySelector("#rmd-rand-arms") || {}).value || "Intervention, Control";
        var ratioInput = (container.querySelector("#rmd-rand-ratio") || {}).value || "1:1";
        var nInput = parseInt((container.querySelector("#rmd-rand-n") || {}).value, 10) || 50;
        var blocksInput = (container.querySelector("#rmd-rand-blocks") || {}).value || "4, 6";
        var strataInput = (container.querySelector("#rmd-rand-strata") || {}).value || "";
        var seedInput = (container.querySelector("#rmd-rand-seed") || {}).value || ("seed-" + Date.now());

        var arms = armsInput.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        var ratioParts = ratioInput.split(":").map(function (s) { return parseInt(s.trim(), 10) || 1; });
        var blockSizes = blocksInput.split(",").map(function (s) { return parseInt(s.trim(), 10) || 4; });
        var strata = strataInput ? strataInput.split(",").map(function (s) { return [s.trim()]; }) : null;

        var randEngine = G.SMD_RESEARCH_RANDOMISE;
        var res = null;
        if (randEngine && randEngine.blockList) {
          res = randEngine.blockList({
            n: nInput,
            arms: arms,
            ratio: ratioParts,
            blockSizes: blockSizes,
            strata: strata,
            seed: seedInput
          });
        }

        if (!res || !res.ok) {
          var warnMsg = (res && res.warnings && res.warnings.length) ? res.warnings.join(" ") : "The randomisation engine is not ready on this phone. No list was made.";
          lastGenerated = null;
          if (resultsEl) resultsEl.style.display = "none";
          if (statusEl) statusEl.innerHTML = '<span style="color:#ff8787;">' + esc(warnMsg) + '</span>';
          return;
        }
        if (statusEl) statusEl.innerHTML = '<span style="color:#42CDB5;">Randomisation list generated successfully.</span>';

        lastGenerated = res;
        sha256Fingerprint(res.csv).then(function (fp) {
          if (!fp) {
            lastGenerated = null;
            if (resultsEl) resultsEl.style.display = "none";
            if (statusEl) statusEl.innerHTML = '<span style="color:#ff8787;">Fingerprint unavailable on this phone. Nothing was stored. Ask your list keeper to make the list on a phone that can compute SHA-256.</span>';
            return;
          }
          lastGenerated.fingerprint = fp;
          if (resultsEl) resultsEl.style.display = "block";
          if (fpBox) {
            fpBox.innerHTML = '<strong>SHA-256 Fingerprint:</strong><br/>' + esc(fp) +
              '<br/><span style="color:#8ea3a6; font-size:11px;">Envelopes: ' + res.rows.length + '</span>';
          }

          var fpRec = {
            fingerprint: fp,
            seed: res.seed,
            n: res.rows.length,
            arms: arms,
            ratio: ratioInput,
            blockSizes: blocksInput,
            strata: strataInput,
            createdAt: new Date().toISOString()
          };

          if (G.RMDStore && G.RMDStore.put) {
            G.RMDStore.put(pid, "randomfingerprint", "main", fpRec);
            var shouldRemove = removeCheck ? removeCheck.checked : true;
            if (shouldRemove) {
              if (G.RMDStore.remove) G.RMDStore.remove(pid, "randomlist", "main");
            } else {
              G.RMDStore.put(pid, "randomlist", "main", { rows: res.rows, seed: res.seed, csv: res.csv });
            }
          }
        });
      });
    }

    var exportCsvBtn = container.querySelector('[data-rmd="export-rand-csv"]');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", function () {
        if (!lastGenerated || !lastGenerated.csv) return;
        var title = "randomisation-list-" + pid + ".csv";
        if (SMD.p2 && SMD.p2.downloadText) {
          SMD.p2.downloadText(title, lastGenerated.csv, "text/csv");
        }
      });
    }

    var exportEnvBtn = container.querySelector('[data-rmd="export-envelope-docx"]');
    if (exportEnvBtn) {
      exportEnvBtn.addEventListener("click", function () {
        if (!lastGenerated || !lastGenerated.rows) return;
        var envNumbers = lastGenerated.rows.map(function (r) {
          return "ENVELOPE " + r.envelope;
        }).join("\n\n");
        var sections = [{
          heading: "Sequentially Numbered Envelope Labels (Numbers Only)",
          text: envNumbers
        }];
        var title = "Envelope-Labels-" + pid;
        var bytes = SMD.docxFromSections ? SMD.docxFromSections(title, sections) : null;
        if (bytes && SMD.p2 && SMD.p2.downloadBytes) {
          SMD.p2.downloadBytes(title + ".docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title);
        }
      });
    }

    var exportKeeperBtn = container.querySelector('[data-rmd="export-keeper-docx"]');
    if (exportKeeperBtn) {
      exportKeeperBtn.addEventListener("click", function () {
        if (!lastGenerated || !lastGenerated.rows) return;
        var lines = ["Master Seed: " + lastGenerated.seed + "\nFingerprint: " + (lastGenerated.fingerprint || "") + "\n\nASSIGNMENTS:"];
        for (var i = 0; i < lastGenerated.rows.length; i++) {
          var row = lastGenerated.rows[i];
          lines.push("Envelope " + row.envelope + " -> Arm: " + row.arm + " (Block " + row.block + ")");
        }
        var sections = [{
          heading: "List Keeper Master Key (Confidential)",
          text: lines.join("\n")
        }];
        var title = "Keeper-Sheet-Confidential-" + pid;
        var bytes = SMD.docxFromSections ? SMD.docxFromSections(title, sections) : null;
        if (bytes && SMD.p2 && SMD.p2.downloadBytes) {
          SMD.p2.downloadBytes(title + ".docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title);
        }
      });
    }
  }

  SMD.screens[KEY] = { render: render };
  if (typeof module !== "undefined" && module.exports) module.exports = { render: render };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
