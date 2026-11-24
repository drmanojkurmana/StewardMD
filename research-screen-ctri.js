/* StewardMD - ResearchMD CTRI screen.
 * ES5 IIFE. Registers SMD.screens.ctri and window.RMDCtri.
 * Clinical Trials Registry - India registration step.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "ctri";

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

  function validateCtri(val) {
    var s = String(val == null ? "" : val).trim().toUpperCase();
    if (/^REF\/\d{4}\/\d{2}\/\d{6}$/.test(s)) {
      return { ok: false, number: s, message: "That is a CTRI submission reference, not your final registration number." };
    }
    if (!/^CTRI\/\d{4}\/\d{2}\/\d{6}$/.test(s)) {
      return { ok: false, number: s, message: "A CTRI number looks like CTRI/2026/05/012345." };
    }
    return { ok: true, number: s };
  }

  function ctriRegistered(projectId) {
    if (!projectId) return Promise.resolve(false);
    if (!G.RMDStore || !G.RMDStore.get) return Promise.resolve(false);
    return G.RMDStore.get(projectId, "ctri", "registration").then(function (rec) {
      if (!rec) return false;
      var num = rec.ctriNumber || rec.number || "";
      var res = validateCtri(num);
      return res.ok && rec.status === "registered";
    }).catch(function () {
      return false;
    });
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
    var nextLabel = nextName ? labelFor(nextName) : "Randomise";

    // Initial synchronous render for fast paint and synchronous test harnesses
    renderContent(container, proj, pid, stepNo, stepCount, nextLabel, null);

    var storePromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "ctri", "registration") : Promise.resolve(null);
    storePromise.then(function (saved) {
      if (saved) {
        renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved);
      }
    }).catch(function () {});
  }

  function renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved) {
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

    // Prospective registration guidance
    h.push('<div class="rmd-notice-box" style="margin: 12px 0; padding: 12px; background: rgba(66,205,181,0.08); border: 1px solid #42CDB5; border-radius: 6px;">');
    h.push('CTRI accepts only prospective registration (before the first participant) since 1 April 2018, and ICMJE journals require it.');
    h.push('</div>');

    var currentNum = (saved && (saved.ctriNumber || saved.number)) || "";
    var currentStatus = (saved && saved.status) || "not_started";
    var currentDate = (saved && saved.date) || "";
    var isRegistered = currentStatus === "registered" && validateCtri(currentNum).ok;

    h.push('<div class="rmd-ctri-form" style="display:grid; gap:14px; margin-top:16px;">');

    // Registration Status
    h.push('<div>');
    h.push('<label style="display:block; font-size:13px; margin-bottom:4px; font-weight:600;">Trial Registration Status:</label>');
    h.push('<select id="rmd-ctri-status" class="rmd-select" style="width:100%; max-width:320px; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;">');
    h.push('<option value="not_started"' + (currentStatus === "not_started" ? ' selected' : '') + '>Not started</option>');
    h.push('<option value="submitted"' + (currentStatus === "submitted" ? ' selected' : '') + '>Submitted (pending registration number)</option>');
    h.push('<option value="registered"' + (currentStatus === "registered" ? ' selected' : '') + '>Registered</option>');
    h.push('</select>');
    h.push('</div>');

    // CTRI Number input
    h.push('<div>');
    h.push('<label style="display:block; font-size:13px; margin-bottom:4px; font-weight:600;">CTRI Registration Number:</label>');
    h.push('<input type="text" id="rmd-ctri-number" class="rmd-input" value="' + esc(currentNum) + '" placeholder="CTRI/2026/05/012345" style="width:100%; max-width:380px; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px; font-family:monospace; text-transform:uppercase;" />');
    h.push('<span style="display:block; font-size:12px; color:#8ea3a6; margin-top:4px;">Format: CTRI/YYYY/MM/XXXXXX (e.g. CTRI/2026/05/012345)</span>');
    h.push('</div>');

    // Registration Date
    h.push('<div>');
    h.push('<label style="display:block; font-size:13px; margin-bottom:4px; font-weight:600;">Registration Date:</label>');
    h.push('<input type="date" id="rmd-ctri-date" class="rmd-input" value="' + esc(currentDate) + '" style="width:100%; max-width:240px; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" />');
    h.push('</div>');

    // Save button and message area
    h.push('<div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="ctri-save">Save CTRI registration</button>');
    h.push('</div>');

    h.push('<div id="rmd-ctri-message" style="margin-top:8px; font-size:13px;"></div>');
    h.push('</div>');

    // Manuscript sentences section
    if (isRegistered) {
      var sentence = "This trial is registered with the Clinical Trials Registry - India (CTRI), number " + currentNum + ".";
      var dataSharing = "De-identified individual participant data that underlie the results reported in this article will be available to researchers who provide a methodologically sound proposal, beginning 6 months and ending 36 months following publication.";

      h.push('<div class="rmd-ctri-manuscript-block" style="margin-top:24px; padding-top:16px; border-top:1px solid #1f363d;">');
      h.push('<h4 style="margin:0 0 8px 0; color:#42CDB5;">Manuscript Registration Sentence</h4>');
      h.push('<div style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">');
      h.push('<span id="rmd-ctri-reg-text" style="font-size:13px;">' + esc(sentence) + '</span>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="copy-reg-sentence" style="margin-left:12px; flex-shrink:0;">Copy</button>');
      h.push('</div>');

      h.push('<h4 style="margin:0 0 8px 0; color:#42CDB5;">Data Sharing Statement Placeholder</h4>');
      h.push('<div style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">');
      h.push('<span id="rmd-ctri-ds-text" style="font-size:13px;">' + esc(dataSharing) + '</span>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="copy-ds-sentence" style="margin-left:12px; flex-shrink:0;">Copy</button>');
      h.push('</div>');
      h.push('</div>');
    }

    h.push('</div></div>');
    container.innerHTML = h.join("");
    wireEvents(container, proj, pid);
  }

  function wireEvents(container, proj, pid) {
    if (!container || !container.querySelector) return;
    var saveBtn = container.querySelector('[data-rmd="ctri-save"]');
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var statusSelect = container.querySelector("#rmd-ctri-status");
        var numInput = container.querySelector("#rmd-ctri-number");
        var dateInput = container.querySelector("#rmd-ctri-date");
        var msgEl = container.querySelector("#rmd-ctri-message");

        var status = statusSelect ? statusSelect.value : "not_started";
        var rawNum = numInput ? numInput.value : "";
        var date = dateInput ? dateInput.value : "";

        var val = validateCtri(rawNum);
        if (!val.ok) {
          if (msgEl) {
            msgEl.innerHTML = '<span style="color:#ff6b6b; font-weight:600;">' + esc(val.message) + '</span>';
          }
          return;
        }

        var record = {
          status: status,
          ctriNumber: val.number,
          date: date,
          updatedAt: new Date().toISOString()
        };

        if (G.RMDStore && G.RMDStore.put) {
          G.RMDStore.put(pid, "ctri", "registration", record).then(function () {
            render(container);
          });
        } else {
          renderContent(container, proj, pid, 1, 1, "Randomise", record);
        }
      });
    }

    var copyRegBtn = container.querySelector('[data-rmd="copy-reg-sentence"]');
    if (copyRegBtn) {
      copyRegBtn.addEventListener("click", function () {
        var textEl = container.querySelector("#rmd-ctri-reg-text");
        if (textEl && G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(textEl.textContent).then(function () {
            copyRegBtn.textContent = "Copied!";
            setTimeout(function () { copyRegBtn.textContent = "Copy"; }, 2000);
          });
        }
      });
    }

    var copyDsBtn = container.querySelector('[data-rmd="copy-ds-sentence"]');
    if (copyDsBtn) {
      copyDsBtn.addEventListener("click", function () {
        var textEl = container.querySelector("#rmd-ctri-ds-text");
        if (textEl && G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(textEl.textContent).then(function () {
            copyDsBtn.textContent = "Copied!";
            setTimeout(function () { copyDsBtn.textContent = "Copy"; }, 2000);
          });
        }
      });
    }
  }

  var API = {
    registered: ctriRegistered,
    validate: validateCtri,
    render: render
  };

  if (G) {
    G.RMDCtri = API;
    SMD.screens[KEY] = { render: render };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
