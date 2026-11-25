/* StewardMD - ResearchMD pubconsent screen.
 * ES5 IIFE. Registers SMD.screens.pubconsent.
 * Consent for publication for case reports.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "pubconsent";

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

  var LANGUAGES = [
    { code: "en", name: "English" },
    { code: "hi", name: "Hindi" },
    { code: "te", name: "Telugu" },
    { code: "ta", name: "Tamil" },
    { code: "kn", name: "Kannada" },
    { code: "ml", name: "Malayalam" },
    { code: "mr", name: "Marathi" },
    { code: "bn", name: "Bengali" },
    { code: "gu", name: "Gujarati" }
  ];

  function defaultConsentEnglish(title, includesImages) {
    var t = title || "Clinical Case Report";
    var text = "PATIENT CONSENT FOR PUBLICATION\n\n" +
      "Title of Case Report: " + t + "\n\n" +
      "1. What will be published: I consent to the publication of details about my medical case, clinical history, and " +
      (includesImages ? "clinical photographs/images" : "relevant diagnostic images") + " in a medical journal.\n\n" +
      "2. Worldwide access: I understand that the material will be published in a scientific journal and may be read worldwide, including on the internet and in print.\n\n" +
      "3. Anonymity: I understand that my name, address, and hospital numbers will not be published. However, I understand that complete anonymity cannot be guaranteed, and someone who knows me or treated me may recognise the case.\n\n" +
      "4. Right to withdraw: I understand that I can withdraw my consent at any time before publication without penalty.\n\n" +
      "5. Medical care: I confirm that my decision will not affect my medical care or relationship with my doctors in any way.\n\n" +
      "6. Images: List of images included: " + (includesImages ? "Clinical photographs and radiological scans" : "None") + "\n\n" +
      "Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal's instructions.\n\n" +
      "SIGNATURE SECTION:\n" +
      "Patient Name (printed): _______________________\n" +
      "Patient Signature or Thumb Impression: _______________________\n" +
      "Date: ____ / ____ / ________\n\n" +
      "IF PATIENT IS UNABLE TO SIGN (Next of kin or legally acceptable representative):\n" +
      "Representative Name: _______________________\n" +
      "Relationship to Patient: _______________________\n" +
      "Reason patient cannot sign: _______________________\n" +
      "Signature of Representative: _______________________\n" +
      "Date: ____ / ____ / ________\n\n" +
      "WITNESS:\n" +
      "Witness Name: _______________________\n" +
      "Witness Signature: _______________________\n" +
      "Date: ____ / ____ / ________";
    return text;
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
    var nextLabel = nextName ? labelFor(nextName) : "Images";

    // Initial synchronous render for fast paint and synchronous test harnesses
    renderContent(container, proj, pid, stepNo, stepCount, nextLabel, null);

    // Load saved consent record if available
    var storePromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "pubconsent", "consent") : Promise.resolve(null);
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

    // Journal form notice box
    h.push('<div class="rmd-notice-box" style="margin: 12px 0; padding: 12px; background: rgba(66,205,181,0.08); border: 1px solid #42CDB5; border-radius: 6px;">');
    h.push('<strong>Notice:</strong> Get the patient or next of kin to sign this before you submit. Some journals insist on their own form; check the journal\'s instructions.');
    h.push('</div>');

    if (saved && saved.english) {
      // Show saved consent view
      h.push('<div class="rmd-consent-saved-view">');
      h.push('<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">');
      h.push('<h3 style="margin:0; font-size:18px;">Consent Document (' + esc(saved.languageName || "English") + ')</h3>');
      h.push('<div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pubconsent-edit" style="margin-right:8px;">Edit</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pubconsent-copy" style="margin-right:8px;">Copy</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="pubconsent-docx">Download (DOCX)</button>');
      h.push('</div></div>');

      h.push('<div style="margin-bottom:16px;">');
      h.push('<h4>English Version</h4>');
      h.push('<pre class="rmd-consent-preview" style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; white-space:pre-wrap; font-family:inherit; font-size:13px; max-height:280px; overflow-y:auto;">' + esc(saved.english) + '</pre>');
      h.push('</div>');

      if (saved.local && saved.languageName && saved.languageName !== "English") {
        h.push('<div style="margin-bottom:16px;">');
        h.push('<h4>' + esc(saved.languageName) + ' Version</h4>');
        h.push('<pre class="rmd-consent-preview-local" style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; white-space:pre-wrap; font-family:inherit; font-size:13px; max-height:280px; overflow-y:auto;">' + esc(saved.local) + '</pre>');
        h.push('</div>');
      } else if (saved.languageName && saved.languageName !== "English") {
        h.push('<p class="rmd-consent-local-missing" role="status" style="margin:0 0 16px; padding:10px; background:rgba(255,107,107,0.1); border:1px solid #ff6b6b; border-radius:6px; font-size:13px; color:#ff8787;">Local language version not filled in. Add the ' + esc(saved.languageName) + ' text before the patient signs.</p>');
      }
      h.push('</div>');
    } else {
      // Choice tabs / buttons
      h.push('<div class="rmd-consent-options" style="margin-top:16px;">');
      h.push('<div style="display:flex; gap:12px; margin-bottom:16px;">');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="tab-maik">Ask MaiK to draft it</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="tab-manual">Do it myself</button>');
      h.push('</div>');

      // 1. Ask MaiK Section
      h.push('<div id="rmd-maik-consent-panel" class="rmd-card-sub" style="border:1px solid #1f363d; padding:16px; border-radius:6px; margin-bottom:16px;">');
      h.push('<h4 style="margin-top:0;">Ask MaiK to draft consent</h4>');
      h.push('<p style="font-size:13px; color:#8ea3a6;">Estimated cost: <strong>&#8377;5.00</strong> (2 MaiK credits)</p>');
      h.push('<div style="display:grid; gap:12px; margin-bottom:12px;">');
      h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Language:</label>');
      h.push('<select id="rmd-maik-lang" class="rmd-select" style="width:100%; max-width:300px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;">');
      for (var l = 0; l < LANGUAGES.length; l++) {
        h.push('<option value="' + esc(LANGUAGES[l].code) + '">' + esc(LANGUAGES[l].name) + '</option>');
      }
      h.push('</select></div>');

      h.push('<div><label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">');
      h.push('<input type="checkbox" id="rmd-maik-images" checked />');
      h.push('Includes clinical photographs or diagnostic images');
      h.push('</label></div>');

      h.push('<div><label style="display:block; font-size:13px; margin-bottom:4px;">Target journal name (optional):</label>');
      h.push('<input type="text" id="rmd-maik-journal" class="rmd-input" placeholder="e.g. BMJ Case Reports" style="width:100%; max-width:400px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;" />');
      h.push('</div>');
      h.push('</div>');

      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="generate-maik-consent">Generate publication consent</button>');
      h.push('<div id="rmd-maik-consent-status" style="margin-top:10px; font-size:13px;"></div>');
      h.push('</div>');

      // 2. Do-it-myself Section
      h.push('<div id="rmd-manual-consent-panel" class="rmd-card-sub" style="display:none; border:1px solid #1f363d; padding:16px; border-radius:6px; margin-bottom:16px;">');
      h.push('<h4 style="margin-top:0;">Write consent document</h4>');
      h.push('<div style="margin-bottom:12px;">');
      h.push('<label style="display:block; font-size:13px; margin-bottom:4px;">Language:</label>');
      h.push('<select id="rmd-manual-lang" class="rmd-select" style="width:100%; max-width:300px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;">');
      for (var lm = 0; lm < LANGUAGES.length; lm++) {
        h.push('<option value="' + esc(LANGUAGES[lm].name) + '">' + esc(LANGUAGES[lm].name) + '</option>');
      }
      h.push('</select></div>');

      h.push('<div style="margin-bottom:12px;">');
      h.push('<label style="display:block; font-size:13px; margin-bottom:4px;">English Consent Form:</label>');
      var initText = defaultConsentEnglish((proj && proj.title) || "", true);
      h.push('<textarea id="rmd-manual-english" rows="12" style="width:100%; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px; font-family:inherit; font-size:13px;">' + esc(initText) + '</textarea>');
      h.push('</div>');

      h.push('<div style="margin-bottom:12px;">');
      h.push('<label style="display:block; font-size:13px; margin-bottom:4px;">Local Language Translation (optional):</label>');
      h.push('<textarea id="rmd-manual-local" rows="8" placeholder="Translated text for local language..." style="width:100%; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px; font-family:inherit; font-size:13px;"></textarea>');
      h.push('</div>');

      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="save-manual-consent">Save consent</button>');
      h.push('</div>');

      h.push('</div>');
    }

    h.push('</div></div>');
    container.innerHTML = h.join("");
    wireEvents(container, proj, pid, saved);
  }

  function wireEvents(container, proj, pid, saved) {
    if (!container || !container.querySelector) return;
    var maikPanel = container.querySelector("#rmd-maik-consent-panel");
    var manualPanel = container.querySelector("#rmd-manual-consent-panel");
    var tabMaik = container.querySelector('[data-rmd="tab-maik"]');
    var tabManual = container.querySelector('[data-rmd="tab-manual"]');

    if (tabMaik && tabManual) {
      tabMaik.addEventListener("click", function () {
        if (maikPanel) maikPanel.style.display = "block";
        if (manualPanel) manualPanel.style.display = "none";
        tabMaik.className = "rmd-btn rmd-btn-primary";
        tabManual.className = "rmd-btn rmd-btn-subtle";
      });
      tabManual.addEventListener("click", function () {
        if (maikPanel) maikPanel.style.display = "none";
        if (manualPanel) manualPanel.style.display = "block";
        tabMaik.className = "rmd-btn rmd-btn-subtle";
        tabManual.className = "rmd-btn rmd-btn-primary";
      });
    }

    var genBtn = container.querySelector('[data-rmd="generate-maik-consent"]');
    if (genBtn) {
      genBtn.addEventListener("click", function () {
        var statusEl = container.querySelector("#rmd-maik-consent-status");
        var langSelect = container.querySelector("#rmd-maik-lang");
        var imgCheck = container.querySelector("#rmd-maik-images");
        var journalInput = container.querySelector("#rmd-maik-journal");

        var lang = langSelect ? langSelect.value : "en";
        var hasImages = imgCheck ? imgCheck.checked : true;
        var journal = journalInput ? journalInput.value.trim() : "";

        if (statusEl) statusEl.innerHTML = '<span style="color:#42CDB5;">Drafting consent with MaiK...</span>';
        genBtn.disabled = true;

        var token = (SMD.auth && SMD.auth.getToken) ? SMD.auth.getToken() : null;
        var headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = "Bearer " + token;

        fetch("/api/research/v1/projects/" + encodeURIComponent(pid) + "/ai-draft", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            task: "publication_consent",
            input: {
              language: lang,
              includesImages: hasImages,
              journalName: journal
            }
          })
        }).then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        }).then(function (resp) {
          genBtn.disabled = false;
          if (resp.status >= 200 && resp.status < 300 && resp.data && resp.data.draft) {
            var draft = resp.data.draft;
            var record = {
              english: draft.english,
              local: draft.local || "",
              languageName: draft.languageName || lang,
              includesImages: hasImages,
              journalName: journal
            };
            if (G.RMDStore && G.RMDStore.put) {
              G.RMDStore.put(pid, "pubconsent", "consent", record).then(function () {
                render(container);
              });
            } else {
              renderContent(container, proj, pid, 1, 1, "Images", record);
            }
          } else {
            var msg = (resp.data && resp.data.error && resp.data.error.message) || "Failed to generate consent.";
            if (statusEl) statusEl.innerHTML = '<span style="color:#ff6b6b;">' + esc(msg) + '</span>';
          }
        }).catch(function (err) {
          genBtn.disabled = false;
          if (statusEl) statusEl.innerHTML = '<span style="color:#ff6b6b;">Error: ' + esc(err.message || String(err)) + '</span>';
        });
      });
    }

    var saveManualBtn = container.querySelector('[data-rmd="save-manual-consent"]');
    if (saveManualBtn) {
      saveManualBtn.addEventListener("click", function () {
        var engText = (container.querySelector("#rmd-manual-english") || {}).value || "";
        var locText = (container.querySelector("#rmd-manual-local") || {}).value || "";
        var langName = (container.querySelector("#rmd-manual-lang") || {}).value || "English";

        var record = {
          english: engText,
          local: locText,
          languageName: langName,
          includesImages: true
        };

        if (G.RMDStore && G.RMDStore.put) {
          G.RMDStore.put(pid, "pubconsent", "consent", record).then(function () {
            render(container);
          });
        } else {
          renderContent(container, proj, pid, 1, 1, "Images", record);
        }
      });
    }

    var editBtn = container.querySelector('[data-rmd="pubconsent-edit"]');
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        renderContent(container, proj, pid, 1, 1, "Images", null);
      });
    }

    var copyBtn = container.querySelector('[data-rmd="pubconsent-copy"]');
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var textToCopy = saved ? (saved.english + (saved.local && saved.languageName !== "English" ? "\n\n--- " + saved.languageName + " ---\n\n" + saved.local : "")) : "";
        if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(textToCopy).then(function () {
            copyBtn.textContent = "Copied!";
            setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
          });
        }
      });
    }

    var docxBtn = container.querySelector('[data-rmd="pubconsent-docx"]');
    if (docxBtn && saved) {
      docxBtn.addEventListener("click", function () {
        var sections = [{ heading: "Consent for Publication (English)", text: saved.english }];
        if (saved.local && saved.languageName !== "English") {
          sections.push({ heading: "Consent for Publication (" + saved.languageName + ")", text: saved.local });
        }
        var title = "Consent for Publication - " + ((proj && proj.title) || "Case Report");
        var bytes = null;
        if (SMD.docxFromSections) {
          bytes = SMD.docxFromSections(title, sections);
        }
        if (bytes && SMD.p2 && SMD.p2.downloadBytes) {
          var name = (SMD.p2.fileSlug ? SMD.p2.fileSlug(title, "publication-consent") : "publication-consent") + ".docx";
          SMD.p2.downloadBytes(name, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title);
        }
      });
    }
  }

  SMD.screens[KEY] = { render: render };
  if (typeof module !== "undefined" && module.exports) module.exports = { render: render };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
