/* StewardMD - ResearchMD backup screen (SMD.screens.backup).
 * ES5 IIFE. Export and restore stay on this phone.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "backup";
  var WARN = "If you forget this passphrase, nobody can open the backup, including us.";
  var SHORT = "Use at least 8 characters.";
  var MISMATCH = "Type the same passphrase in both boxes.";
  var WRONG = "That passphrase did not open this backup.";
  var NOT_FILE = "This file is not a ResearchMD backup.";
  var NEWER = "This backup was made by a newer version. Update the app, then try again.";
  var CHOOSE = "Choose the backup file first.";

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

  function backupApi() {
    if (G.RMDBackup) return G.RMDBackup;
    return null;
  }

  function weeklyBanner(now) {
    var api = backupApi();
    if (api && api.weeklyBanner) return api.weeklyBanner(now);
    return Promise.resolve("");
  }

  function setMsg(container, text) {
    var el = container.querySelector("#rmdBackupMsg");
    if (!el) return;
    el.textContent = text || "";
  }

  function reasonText(reason) {
    if (reason === "wrong-passphrase") return WRONG;
    if (reason === "newer-version") return NEWER;
    return NOT_FILE;
  }

  function deliver(file) {
    var p2 = SMD.p2;
    if (!file || !p2 || !p2.saveFile) return;
    p2.saveFile(file.name || "ResearchMD-backup.rmdbackup", file, file.name).then(function () {}, function () {});
  }

  function previewHtml(counts) {
    var lines, ids, i;
    lines = [];
    lines.push(counts.records + " records, " + counts.images + " images");
    ids = [];
    if (counts.projects) {
      for (i in counts.projects) {
        if (Object.prototype.hasOwnProperty.call(counts.projects, i)) ids.push(i);
      }
    }
    ids.sort();
    for (i = 0; i < ids.length; i++) {
      lines.push("Project " + ids[i] + ": " + counts.projects[ids[i]] + " records");
    }
    return lines.join("\n");
  }

  function render(container) {
    var proj, journey, i, idx, nextName, stepNo, stepCount, h, nextLabel, banner;
    if (!container) return;
    proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    idx = -1;
    for (i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    stepNo = idx >= 0 ? (idx + 1) : 1;
    stepCount = journey.length || 1;
    nextLabel = nextName ? labelFor(nextName) : "keep the file somewhere safe, and remember the passphrase";
    h = [];
    h.push('<div class="rmd-p2-screen rmd-backup-screen">');
    h.push('<style id="rmdBackupStyle">');
    h.push('.rmd-backup-screen{overflow-x:hidden;}');
    h.push('.rmd-backup-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;}');
    h.push('@media (min-width:768px){.rmd-backup-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}}');
    h.push('#researchMD .rmd-backup-screen input[type="password"],#researchMD .rmd-backup-screen input[type="text"],#researchMD .rmd-backup-screen input[type="file"]{width:100%;max-width:100%;box-sizing:border-box;font-size:max(16px,1rem);min-height:44px;}');
    h.push('#researchMD .rmd-backup-screen button.rmd-btn{min-height:44px;height:44px;box-sizing:border-box;font-size:max(16px,1rem);padding-top:0;padding-bottom:0;}');
    h.push('#researchMD .rmd-backup-screen .rmd-check-label{min-height:44px;display:flex;align-items:center;gap:8px;}');
    h.push('#researchMD .rmd-backup-screen input[type="checkbox"]{accent-color:var(--rmd-acc,#1b41bf);width:1.25rem;height:1.25rem;}');
    h.push('.rmd-backup-screen .rmd-field{display:block;margin-block-end:12px;}');
    h.push('.rmd-backup-preview{white-space:pre-wrap;}');
    h.push('</style>');
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-step-banner" role="status">');
    if (idx >= 0) {
      banner = '<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>';
    } else {
      banner = '<div class="rmd-step-line"><span class="rmd-step-text"><strong>Backup</strong> Encrypted copy (a locked file of your research)</span></div>';
    }
    h.push(banner);
    h.push('</div>');
    h.push('<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>');
    h.push('<div id="rmdBackupDue"></div>');
    h.push('<div id="rmdBackupMsg" class="rmd-banner rmd-banner-error" role="status" hidden></div>');
    h.push('<div class="rmd-backup-grid">');

    h.push('<form id="rmdBackupExportForm" class="rmd-form" novalidate aria-labelledby="rmdBackupExportHeading">');
    h.push('<h2 id="rmdBackupExportHeading">Save a backup</h2>');
    h.push('<p class="rmd-field-hint">Encrypted backup (a locked copy that stays on this phone until you share the file).</p>');
    h.push('<p id="rmdBackupWarn" class="rmd-banner rmd-banner-warn">' + esc(WARN) + '</p>');
    h.push('<label class="rmd-field" for="rmdBackupPass1">Passphrase (the secret that locks the file)</label>');
    h.push('<input id="rmdBackupPass1" name="passphrase" type="password" autocomplete="new-password" minlength="8" required spellcheck="false" autocapitalize="none" autocorrect="off" enterkeyhint="next" aria-describedby="rmdBackupWarn">');
    h.push('<label class="rmd-field" for="rmdBackupPass2">Type the passphrase again</label>');
    h.push('<input id="rmdBackupPass2" name="passphraseAgain" type="password" autocomplete="new-password" minlength="8" required spellcheck="false" autocapitalize="none" autocorrect="off" enterkeyhint="done" aria-describedby="rmdBackupWarn">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" id="rmdBackupShow" aria-pressed="false">Show passphrase</button>');
    h.push('<label class="rmd-check-label" for="rmdBackupImages"><input id="rmdBackupImages" type="checkbox" name="includeImages"> Include images (photos kept on this phone)</label>');
    h.push('<button type="submit" class="rmd-btn rmd-btn-primary rmd-btn-block" id="rmdBackupExport">Save the backup file</button>');
    h.push('</form>');

    h.push('<form id="rmdBackupRestoreForm" class="rmd-form" novalidate aria-labelledby="rmdBackupRestoreHeading">');
    h.push('<h2 id="rmdBackupRestoreHeading">Bring a backup back</h2>');
    h.push('<p class="rmd-field-hint">Restore (put the saved records back on this phone).</p>');
    h.push('<label class="rmd-field" for="rmdBackupFile">Backup file</label>');
    h.push('<input id="rmdBackupFile" name="backupFile" type="file" accept=".rmdbackup,application/octet-stream,application/json">');
    h.push('<label class="rmd-field" for="rmdBackupRestorePass">Passphrase (the secret that locks the file)</label>');
    h.push('<input id="rmdBackupRestorePass" name="restorePassphrase" type="password" autocomplete="current-password" minlength="8" required spellcheck="false" autocapitalize="none" autocorrect="off" enterkeyhint="done">');
    h.push('<button type="submit" class="rmd-btn rmd-btn-primary rmd-btn-block" id="rmdBackupPreview">Read the backup</button>');
    h.push('<p id="rmdBackupPreviewBox" class="rmd-field-hint rmd-backup-preview"></p>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-block" id="rmdBackupMerge" disabled>Merge (keep the newer record)</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-block" id="rmdBackupReplace" disabled>Replace (use only this file)</button>');
    h.push('</form>');

    h.push('</div></div></div>');
    container.innerHTML = h.join("");
    if (!container.querySelector) return;

    screenApi.lastData = null;

    function showError(text) {
      var el = container.querySelector("#rmdBackupMsg");
      if (!el) return;
      if (!text) {
        el.textContent = "";
        el.setAttribute("hidden", "hidden");
        return;
      }
      el.removeAttribute("hidden");
      el.textContent = text;
    }

    var pass1 = container.querySelector("#rmdBackupPass1");
    var pass2 = container.querySelector("#rmdBackupPass2");
    var showBtn = container.querySelector("#rmdBackupShow");
    var exportForm = container.querySelector("#rmdBackupExportForm");
    var restoreForm = container.querySelector("#rmdBackupRestoreForm");
    var fileInput = container.querySelector("#rmdBackupFile");
    var mergeBtn = container.querySelector("#rmdBackupMerge");
    var replaceBtn = container.querySelector("#rmdBackupReplace");

    if (showBtn && pass1 && pass2) {
      showBtn.addEventListener("click", function () {
        var hide = pass1.type === "password";
        pass1.type = hide ? "text" : "password";
        pass2.type = hide ? "text" : "password";
        showBtn.setAttribute("aria-pressed", hide ? "true" : "false");
        showBtn.textContent = hide ? "Hide passphrase" : "Show passphrase";
      });
    }

    if (exportForm) {
      exportForm.addEventListener("submit", function (ev) {
        var a, b, api, include, btn;
        ev.preventDefault();
        a = pass1 ? pass1.value : "";
        b = pass2 ? pass2.value : "";
        if (a.length < 8 || b.length < 8) {
          showError(SHORT);
          if (a.length < 8 && pass1 && pass1.focus) pass1.focus();
          else if (pass2 && pass2.focus) pass2.focus();
          return;
        }
        if (a !== b) {
          showError(MISMATCH);
          if (pass2 && pass2.focus) pass2.focus();
          return;
        }
        api = backupApi();
        if (!api || !api.exportFile) {
          showError(NOT_FILE);
          return;
        }
        include = !!(container.querySelector("#rmdBackupImages") && container.querySelector("#rmdBackupImages").checked);
        btn = container.querySelector("#rmdBackupExport");
        if (btn) btn.disabled = true;
        showError("");
        api.exportFile(a, { includeImages: include }).then(function (res) {
          var file;
          if (btn) btn.disabled = false;
          if (!res || !res.ok) {
            showError(reasonText(res && res.reason));
            return;
          }
          try {
            file = new File([res.blob], res.filename, { type: "application/octet-stream" });
          } catch (eFile) {
            file = res.blob;
          }
          screenApi.lastFile = file;
          deliver(file);
          showError("");
          setMsg(container, "");
          var note = container.querySelector("#rmdBackupPreviewBox");
          if (note && !screenApi.lastData) {
            /* export success is not a preview */
          }
          var msg = container.querySelector("#rmdBackupMsg");
          if (msg) {
            msg.className = "rmd-banner rmd-banner-info";
            msg.removeAttribute("hidden");
            msg.textContent = "Backup file ready. Keep it somewhere you can find it.";
          }
        }, function () {
          if (btn) btn.disabled = false;
          showError(NOT_FILE);
        });
      });
    }

    function armRestore(data) {
      screenApi.lastData = data;
      if (mergeBtn) mergeBtn.disabled = false;
      if (replaceBtn) replaceBtn.disabled = false;
    }

    if (restoreForm) {
      restoreForm.addEventListener("submit", function (ev) {
        var api, phrase, file, btn;
        ev.preventDefault();
        file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : screenApi.lastRestoreFile;
        phrase = container.querySelector("#rmdBackupRestorePass");
        phrase = phrase ? phrase.value : "";
        if (!file) {
          showError(CHOOSE);
          if (fileInput && fileInput.focus) fileInput.focus();
          return;
        }
        if (phrase.length < 8) {
          showError(SHORT);
          return;
        }
        api = backupApi();
        if (!api || !api.readFile) {
          showError(NOT_FILE);
          return;
        }
        btn = container.querySelector("#rmdBackupPreview");
        if (btn) btn.disabled = true;
        showError("");
        api.readFile(file, phrase).then(function (res) {
          var box;
          if (btn) btn.disabled = false;
          if (!res || !res.ok) {
            showError(reasonText(res && res.reason));
            return;
          }
          screenApi.lastCounts = res.counts;
          armRestore(res.data);
          box = container.querySelector("#rmdBackupPreviewBox");
          if (box) box.textContent = previewHtml(res.counts || { records: 0, images: 0, projects: {} });
          showError("");
        }, function () {
          if (btn) btn.disabled = false;
          showError(NOT_FILE);
        });
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        screenApi.lastRestoreFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      });
    }

    function runRestore(mode) {
      var api = backupApi();
      if (!api || !api.restore || !screenApi.lastData) {
        showError(CHOOSE);
        return;
      }
      api.restore(screenApi.lastData, mode).then(function (res) {
        var msg = container.querySelector("#rmdBackupMsg");
        if (!res || res.ok === false) {
          showError((res && res.warnings && res.warnings[0]) || NOT_FILE);
          return;
        }
        if (msg) {
          msg.className = "rmd-banner rmd-banner-info";
          msg.removeAttribute("hidden");
          msg.textContent = "Restored. Added " + res.added + ", updated " + res.updated + ", skipped " + res.skipped + ".";
        }
      }, function () {
        showError(NOT_FILE);
      });
    }

    if (mergeBtn) mergeBtn.addEventListener("click", function () { runRestore("merge"); });
    if (replaceBtn) replaceBtn.addEventListener("click", function () { runRestore("replace"); });

    var apiDue = backupApi();
    if (apiDue && apiDue.isDue) {
      apiDue.isDue().then(function (due) {
        var slot = container.querySelector("#rmdBackupDue");
        if (!slot || !due || !apiDue.weeklyBanner) return;
        apiDue.weeklyBanner().then(function (html) {
          if (slot && html) slot.innerHTML = html;
        });
      });
    }
  }

  var screenApi = {
    render: render,
    weeklyBanner: weeklyBanner,
    lastFile: null,
    lastData: null,
    lastCounts: null,
    lastRestoreFile: null
  };

  SMD.screens[KEY] = screenApi;
  if (typeof module !== "undefined" && module.exports) module.exports = screenApi;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
