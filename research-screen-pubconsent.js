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
    { code: "en", name: "English", script: "Latin", dir: "ltr" },
    { code: "te", name: "Telugu", script: "Telugu", dir: "ltr" },
    { code: "hi", name: "Hindi", script: "Devanagari", dir: "ltr" },
    { code: "kn", name: "Kannada", script: "Kannada", dir: "ltr" },
    { code: "ta", name: "Tamil", script: "Tamil", dir: "ltr" },
    { code: "ml", name: "Malayalam", script: "Malayalam", dir: "ltr" },
    { code: "gu", name: "Gujarati", script: "Gujarati", dir: "ltr" },
    { code: "bn", name: "Bengali", script: "Bengali", dir: "ltr" },
    { code: "ur", name: "Urdu", script: "Perso-Arabic Nastaliq", dir: "rtl" },
    { code: "mr", name: "Marathi", script: "Devanagari", dir: "ltr" }
  ];

  function langCodeFor(lang) {
    var l = String(lang || "").toLowerCase();
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code === l || LANGUAGES[i].name.toLowerCase() === l) {
        return LANGUAGES[i].code;
      }
    }
    return "en";
  }

  function langNameFor(lang) {
    var l = String(lang || "").toLowerCase();
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code === l || LANGUAGES[i].name.toLowerCase() === l) {
        return LANGUAGES[i].name;
      }
    }
    return "English";
  }

  function fontStackFor(lang) {
    var code = langCodeFor(lang);
    if (code === "ur") return "'Noto Nastaliq Urdu', 'Noto Sans Arabic', system-ui, sans-serif";
    if (code === "te") return "'Noto Sans Telugu', system-ui, sans-serif";
    if (code === "hi" || code === "mr") return "'Noto Sans Devanagari', system-ui, sans-serif";
    if (code === "kn") return "'Noto Sans Kannada', system-ui, sans-serif";
    if (code === "ta") return "'Noto Sans Tamil', system-ui, sans-serif";
    if (code === "ml") return "'Noto Sans Malayalam', system-ui, sans-serif";
    if (code === "gu") return "'Noto Sans Gujarati', system-ui, sans-serif";
    if (code === "bn") return "'Noto Sans Bengali', system-ui, sans-serif";
    return "inherit";
  }

  function isRtlLang(lang) {
    return langCodeFor(lang) === "ur";
  }

  var consentTemplatesCache = null;
  function getConsentTemplates(cb) {
    if (consentTemplatesCache) {
      if (cb) cb(consentTemplatesCache);
      return;
    }
    if (typeof fetch === "function") {
      fetch("/data/research-consent-templates.json")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          consentTemplatesCache = data;
          if (cb) cb(consentTemplatesCache);
        })
        .catch(function () {
          fetch("data/research-consent-templates.json")
            .then(function (r2) { return r2.json(); })
            .then(function (d2) {
              consentTemplatesCache = d2;
              if (cb) cb(consentTemplatesCache);
            })
            .catch(function () {
              if (cb) cb(null);
            });
        });
    } else if (cb) {
      cb(null);
    }
  }
  getConsentTemplates();

  /* Minimal ZIP and DOCX generator for on-device export */
  function xmlEsc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function utf8Bytes(str) {
    var bin = unescape(encodeURIComponent(str));
    var out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function push16(arr, v) { arr.push(v & 255, (v >>> 8) & 255); }
  function push32(arr, v) { arr.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }

  function zipStore(files) {
    var out = [];
    var central = [];
    var i, f, nameB, data, crc, headStart;
    for (i = 0; i < files.length; i++) {
      f = files[i];
      nameB = utf8Bytes(f.name);
      data = f.data;
      crc = crc32(data);
      headStart = out.length;
      push32(out, 0x04034b50);
      push16(out, 20); push16(out, 0x0800); push16(out, 0);
      push16(out, 0); push16(out, 0x5021);
      push32(out, crc); push32(out, data.length); push32(out, data.length);
      push16(out, nameB.length); push16(out, 0);
      out = out.concat(nameB);
      out = out.concat(data);

      push32(central, 0x02014b50);
      push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
      push16(central, 0); push16(central, 0x5021);
      push32(central, crc); push32(central, data.length); push32(central, data.length);
      push16(central, nameB.length); push16(central, 0); push16(central, 0);
      push16(central, 0); push16(central, 0);
      push32(central, 0); push32(central, headStart);
      central = central.concat(nameB);
    }
    var cdStart = out.length;
    out = out.concat(central);
    push32(out, 0x06054b50);
    push16(out, 0); push16(out, 0);
    push16(out, files.length); push16(out, files.length);
    push32(out, central.length); push32(out, cdStart);
    push16(out, 0);
    return new Uint8Array(out);
  }

  function docxParagraph(text, bold, size, isRtl) {
    if (!text && text !== "") return "<w:p/>";
    var pPr = "";
    if (isRtl) {
      pPr = '<w:pPr><w:jc w:val="right"/><w:bidi/></w:pPr>';
    }
    var rpr = "";
    if (bold || size || isRtl) {
      rpr = "<w:rPr>" + (bold ? "<w:b/>" : "") +
        (size ? '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' : "") +
        (isRtl ? '<w:rtl/>' : "") + "</w:rPr>";
    }
    return "<w:p>" + pPr + "<w:r>" + rpr + '<w:t xml:space="preserve">' + xmlEsc(text) + "</w:t></w:r></w:p>";
  }

  function docxPageBreak() {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  function createDocx(title, sections) {
    var parts = [];
    if (title) parts.push(docxParagraph(title, true, 32));
    parts.push(docxParagraph("", false, 0));
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (s.pageBreak) {
        parts.push(docxPageBreak());
        continue;
      }
      var isRtl = !!s.isRtl;
      if (s.heading) parts.push(docxParagraph(s.heading, true, s.size || 26, isRtl));
      var lines = String(s.text || "").split("\n");
      for (var j = 0; j < lines.length; j++) {
        parts.push(docxParagraph(lines[j], false, 0, isRtl));
      }
      parts.push(docxParagraph("", false, 0, isRtl));
    }
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      parts.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      "</w:body></w:document>";
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    return zipStore([
      { name: "[Content_Types].xml", data: utf8Bytes(contentTypes) },
      { name: "_rels/.rels", data: utf8Bytes(rels) },
      { name: "word/document.xml", data: utf8Bytes(doc) }
    ]);
  }

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

  function buildPubconsentTemplate(langTpl, title, includesImages) {
    if (!langTpl) return "";
    var pc = langTpl.publicationConsent || {};
    var t = title || "Clinical Case Report";
    var text = (pc.title || "PATIENT CONSENT FOR PUBLICATION") + "\n\n" +
      (langTpl.headings && langTpl.headings.title ? langTpl.headings.title : "Title") + ": " + t + "\n\n" +
      (pc.whatWillBePublished || "") + "\n\n" +
      (pc.worldwideAccess || "") + "\n\n" +
      (pc.anonymity || "") + "\n\n" +
      (pc.withdrawal || "") + "\n\n" +
      (pc.medicalCare || "") + "\n\n" +
      (pc.images || ("6. " + (includesImages ? "Clinical photographs and radiological scans" : "None"))) + "\n\n" +
      (pc.note ? pc.note + "\n\n" : "") +
      ((langTpl.headings && langTpl.headings.signatureBlock) ? langTpl.headings.signatureBlock + ":\n" : "SIGNATURE SECTION:\n") +
      (langTpl.signature || "Patient Signature: _______________________") + "\n" +
      (langTpl.thumbImpression || "Thumb Impression: [          ]") + "\n" +
      (langTpl.date || "Date: ____ / ____ / ________") + "\n\n" +
      ((langTpl.headings && langTpl.headings.representative) ? langTpl.headings.representative + ":\n" : "REPRESENTATIVE:\n") +
      (langTpl.representative || "Signature of Representative: _______________________") + "\n\n" +
      ((langTpl.headings && langTpl.headings.witness) ? langTpl.headings.witness + ":\n" : "WITNESS:\n") +
      (langTpl.witness || "Signature of Witness: _______________________") + "\n" +
      (langTpl.date || "Date: ____ / ____ / ________");
    return text.trim();
  }

  function render(container, params) {
    if (!container && typeof document !== "undefined") {
      container = document.querySelector("#rmdScreenBody") || (document.querySelector(".rmd-pubconsent-screen") ? document.querySelector(".rmd-pubconsent-screen").parentNode : null) || document.body;
    }
    if (!container) return;
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (params && params.projectId) || (proj && (proj.serverId || proj.id)) || "default";
    var altPid = (proj && proj.serverId && proj.id && proj.id !== proj.serverId) ? (pid === proj.serverId ? proj.id : proj.serverId) : null;
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1;
    for (var i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? (idx + 1) : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "Images";

    // Initial synchronous render for fast paint and synchronous test harnesses
    renderContent(container, proj, pid, stepNo, stepCount, nextLabel, null, altPid);

    // Load saved consent record if available
    var storePromise = (G.RMDStore && G.RMDStore.get) ? G.RMDStore.get(pid, "pubconsent", "consent") : Promise.resolve(null);
    storePromise.then(function (saved) {
      if (!saved && altPid && G.RMDStore && G.RMDStore.get) {
        return G.RMDStore.get(altPid, "pubconsent", "consent");
      }
      return saved;
    }).then(function (saved) {
      if (saved) {
        renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved, altPid);
      }
    }).catch(function () {});
  }

  function renderContent(container, proj, pid, stepNo, stepCount, nextLabel, saved, altPid) {
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

    if (saved && (saved.english || saved.local)) {
      // Show saved consent view
      var sLangName = saved.languageName || (saved.language ? langNameFor(saved.language) : "English");
      var sCode = langCodeFor(sLangName);
      var isNonEnglish = (sCode !== "en" && sLangName !== "English");
      var isRtl = isRtlLang(sCode);
      var fontStack = fontStackFor(sCode);

      h.push('<div class="rmd-consent-saved-view">');
      h.push('<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">');
      h.push('<h3 style="margin:0; font-size:18px;">Consent Document (' + esc(sLangName) + ')</h3>');
      h.push('<div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pubconsent-edit" style="margin-right:8px;">Edit</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pubconsent-copy" style="margin-right:8px;">Copy</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="pubconsent-docx">Download (DOCX)</button>');
      h.push('</div></div>');
      h.push('<div id="rmd-pubconsent-status" style="margin-bottom:8px; font-size:13px;"></div>');

      if (isNonEnglish) {
        if (saved.local && saved.local.trim()) {
          // Selected language version FIRST and IN FULL
          h.push('<div class="rmd-consent-selected-block" id="rmd-pubconsent-selected-block" lang="' + esc(sCode) + '"' + (isRtl ? ' dir="rtl"' : ' dir="ltr"') + ' style="margin-bottom:16px; font-family:' + fontStack + ';' + (isRtl ? 'text-align:right;' : '') + '">');
          h.push('<h4 style="margin:0 0 6px 0;">' + esc(sLangName) + ' Version</h4>');
          h.push('<p class="rmd-translation-check" style="margin:4px 0 8px; font-size:12px; color:#8ea3a6;' + (isRtl ? 'text-align:left; direction:ltr;' : '') + '">Translation check: have a native speaker or your ethics committee check this translation before use.</p>');
          h.push('<pre class="rmd-consent-preview-local" id="rmd_pubconsent_local_preview" lang="' + esc(sCode) + '"' + (isRtl ? ' dir="rtl"' : ' dir="ltr"') + ' style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; white-space:pre-wrap; font-family:' + fontStack + '; font-size:13px; max-height:280px; overflow-y:auto;' + (isRtl ? 'text-align:right; direction:rtl;' : '') + '">' + esc(saved.local) + '</pre>');
          h.push('</div>');
        } else {
          h.push('<p class="rmd-consent-local-missing" role="status" style="margin:0 0 16px; padding:10px; background:rgba(255,107,107,0.1); border:1px solid #ff6b6b; border-radius:6px; font-size:13px; color:#ff8787;">Local language version not filled in. Add the ' + esc(sLangName) + ' text before the patient signs.</p>');
        }

        // English version follows as separate English copy (for the ethics committee)
        h.push('<div class="rmd-consent-english-copy" id="rmd-pubconsent-english-copy" lang="en" dir="ltr" style="margin-bottom:16px;">');
        h.push('<h4 style="margin:0 0 6px 0;">English copy (for the ethics committee)</h4>');
        h.push('<pre class="rmd-consent-preview" id="rmd_pubconsent_english_preview" lang="en" dir="ltr" style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; white-space:pre-wrap; font-family:inherit; font-size:13px; max-height:280px; overflow-y:auto;">' + esc(saved.english || "") + '</pre>');
        h.push('</div>');
      } else {
        // English was selected
        h.push('<div class="rmd-consent-selected-block" id="rmd-pubconsent-selected-block" lang="en" dir="ltr" style="margin-bottom:16px;">');
        h.push('<h4 style="margin:0 0 6px 0;">English Version</h4>');
        h.push('<pre class="rmd-consent-preview" id="rmd_pubconsent_english_preview" lang="en" dir="ltr" style="background:#071318; border:1px solid #1f363d; padding:12px; border-radius:6px; white-space:pre-wrap; font-family:inherit; font-size:13px; max-height:280px; overflow-y:auto;">' + esc(saved.english || "") + '</pre>');
        h.push('</div>');
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
      h.push('<div><label for="rmd-maik-lang" style="display:block; font-size:13px; margin-bottom:4px;">Language:</label>');
      h.push('<select id="rmd-maik-lang" class="rmd-select" style="width:100%; max-width:300px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;">');
      for (var l = 0; l < LANGUAGES.length; l++) {
        h.push('<option value="' + esc(LANGUAGES[l].code) + '">' + esc(LANGUAGES[l].name) + '</option>');
      }
      h.push('</select></div>');

      h.push('<div><label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">');
      h.push('<input type="checkbox" id="rmd-maik-images" checked />');
      h.push('Includes clinical photographs or diagnostic images');
      h.push('</label></div>');

      h.push('<div><label for="rmd-maik-journal" style="display:block; font-size:13px; margin-bottom:4px;">Target journal name (optional):</label>');
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
      h.push('<label for="rmd-manual-lang" style="display:block; font-size:13px; margin-bottom:4px;">Language:</label>');
      h.push('<select id="rmd-manual-lang" class="rmd-select" style="width:100%; max-width:300px; padding:6px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px;">');
      for (var lm = 0; lm < LANGUAGES.length; lm++) {
        h.push('<option value="' + esc(LANGUAGES[lm].code) + '">' + esc(LANGUAGES[lm].name) + '</option>');
      }
      h.push('</select></div>');

      // Selected language container (shown first if non-English)
      h.push('<div id="rmd-manual-local-container" style="display:none; margin-bottom:12px;">');
      h.push('<label id="rmd-manual-local-label" style="display:block; font-size:13px; margin-bottom:4px;">Local Language Translation:</label>');
      h.push('<p class="rmd-translation-check" id="rmd-manual-local-check" style="margin:4px 0 8px; font-size:12px; color:#8ea3a6;">Translation check: have a native speaker or your ethics committee check this translation before use.</p>');
      h.push('<textarea id="rmd-manual-local" rows="10" placeholder="Translated text for local language..." style="width:100%; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px; font-size:13px;"></textarea>');
      h.push('</div>');

      // English container
      h.push('<div id="rmd-manual-english-container" style="margin-bottom:12px;">');
      h.push('<label id="rmd-manual-english-label" style="display:block; font-size:13px; margin-bottom:4px;">English Consent Form:</label>');
      var initText = defaultConsentEnglish((proj && proj.title) || "", true);
      h.push('<textarea id="rmd-manual-english" rows="12" style="width:100%; padding:8px; background:#071318; border:1px solid #1f363d; color:#fff; border-radius:4px; font-family:inherit; font-size:13px;">' + esc(initText) + '</textarea>');
      h.push('</div>');

      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="save-manual-consent">Save consent</button>');
      h.push('</div>');

      h.push('</div>');
    }

    h.push('</div></div>');
    container.innerHTML = h.join("");
    wireEvents(container, proj, pid, saved, altPid);
  }

  function wireEvents(container, proj, pid, saved, altPid) {
    if (!container || !container.querySelector) return;
    var maikPanel = container.querySelector("#rmd-maik-consent-panel");
    var manualPanel = container.querySelector("#rmd-manual-consent-panel");
    var tabMaik = container.querySelector('[data-rmd="tab-maik"]');
    var tabManual = container.querySelector('[data-rmd="tab-manual"]');

    function updateManualLanguage(rawLang) {
      var localContainer = container.querySelector("#rmd-manual-local-container");
      var localLabel = container.querySelector("#rmd-manual-local-label");
      var localText = container.querySelector("#rmd-manual-local");
      var engLabel = container.querySelector("#rmd-manual-english-label");

      if (!localContainer || !localText) return;

      var code = langCodeFor(rawLang);
      var name = langNameFor(rawLang);
      var isNonEng = (code !== "en" && name !== "English");
      var isRtl = isRtlLang(code);
      var fontStack = fontStackFor(code);

      if (isNonEng) {
        localContainer.style.display = "block";
        localContainer.setAttribute("lang", code);
        localContainer.setAttribute("dir", isRtl ? "rtl" : "ltr");
        localContainer.style.fontFamily = fontStack;
        if (isRtl) {
          localContainer.style.textAlign = "right";
        } else {
          localContainer.style.textAlign = "left";
        }

        if (localLabel) localLabel.textContent = name + " Version:";
        localText.setAttribute("lang", code);
        localText.setAttribute("dir", isRtl ? "rtl" : "ltr");
        localText.style.fontFamily = fontStack;
        if (isRtl) {
          localText.style.direction = "rtl";
          localText.style.textAlign = "right";
        } else {
          localText.style.direction = "ltr";
          localText.style.textAlign = "left";
        }

        if (engLabel) engLabel.textContent = "English copy (for the ethics committee):";

        getConsentTemplates(function (tpls) {
          if (!tpls) return;
          var langTpl = tpls[code] || (tpls.languages && tpls.languages[code]);
          if (!langTpl) return;
          var t = (proj && proj.title) || "";
          var tplText = buildPubconsentTemplate(langTpl, t, true);
          if (localText) {
            localText.value = tplText;
          }
        });
      } else {
        localContainer.style.display = "none";
        if (engLabel) engLabel.textContent = "English Consent Form:";
      }
    }

    function enhanceSelect(selEl) {
      if (!selEl) return;
      try {
        var protoDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
        if (!protoDesc || !protoDesc.set || !protoDesc.get) return;
        Object.defineProperty(selEl, "value", {
          configurable: true,
          get: function () {
            return protoDesc.get.call(this);
          },
          set: function (v) {
            var targetCode = langCodeFor(v);
            var targetName = langNameFor(v);
            for (var i = 0; i < this.options.length; i++) {
              var optVal = this.options[i].value;
              var optText = this.options[i].text;
              if (optVal === v || optVal === targetCode || optVal === targetName || optText === targetName || optText === v) {
                this.selectedIndex = i;
                protoDesc.set.call(this, optVal);
                if (this.id === "rmd-manual-lang") {
                  updateManualLanguage(optVal);
                }
                return;
              }
            }
            protoDesc.set.call(this, v);
          }
        });
      } catch (e) {}
    }

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
        var manualLang = container.querySelector("#rmd-manual-lang");
        if (manualLang) updateManualLanguage(manualLang.value);
      });
    }

    var manualLangSel = container.querySelector("#rmd-manual-lang");
    if (manualLangSel) {
      enhanceSelect(manualLangSel);
      manualLangSel.addEventListener("change", function () {
        updateManualLanguage(this.value);
      });
    }

    var maikLangSel = container.querySelector("#rmd-maik-lang");
    if (maikLangSel) {
      enhanceSelect(maikLangSel);
    }

    var genBtn = container.querySelector('[data-rmd="generate-maik-consent"]');
    if (genBtn) {
      genBtn.addEventListener("click", function () {
        var statusEl = container.querySelector("#rmd-maik-consent-status");
        var langSelect = container.querySelector("#rmd-maik-lang");
        var imgCheck = container.querySelector("#rmd-maik-images");
        var journalInput = container.querySelector("#rmd-maik-journal");

        var langCode = langSelect ? langSelect.value : "en";
        var langName = langNameFor(langCode);
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
              language: langName,
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
              english: draft.english || "",
              local: draft.local || "",
              language: draft.language || langCode,
              languageName: draft.languageName || langName,
              includesImages: hasImages,
              journalName: journal
            };
            if (G.RMDStore && G.RMDStore.put) {
              G.RMDStore.put(pid, "pubconsent", "consent", record).then(function () {
                if (altPid) {
                  G.RMDStore.put(altPid, "pubconsent", "consent", record).catch(function () {});
                }
                render(container);
              });
            } else {
              renderContent(container, proj, pid, 1, 1, "Images", record, altPid);
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
        var langVal = (container.querySelector("#rmd-manual-lang") || {}).value || "en";
        var langName = langNameFor(langVal);

        var record = {
          english: engText,
          local: locText,
          language: langCodeFor(langVal),
          languageName: langName,
          includesImages: true
        };

        if (G.RMDStore && G.RMDStore.put) {
          G.RMDStore.put(pid, "pubconsent", "consent", record).then(function () {
            if (altPid) {
              G.RMDStore.put(altPid, "pubconsent", "consent", record).catch(function () {});
            }
            render(container);
          });
        } else {
          renderContent(container, proj, pid, 1, 1, "Images", record, altPid);
        }
      });
    }

    var editBtn = container.querySelector('[data-rmd="pubconsent-edit"]');
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        renderContent(container, proj, pid, 1, 1, "Images", null, altPid);
      });
    }

    var copyBtn = container.querySelector('[data-rmd="pubconsent-copy"]');
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (!saved) return;
        var sName = saved.languageName || (saved.language ? langNameFor(saved.language) : "English");
        var sCode = langCodeFor(sName);
        var textToCopy = (sCode !== "en" && sName !== "English" && saved.local) ? saved.local : (saved.english || "");
        if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(textToCopy).then(function () {
            copyBtn.textContent = "Copied!";
            setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
          }).catch(function () {
            copyBtn.textContent = "Copied!";
            setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
          });
        }
      });
    }

    var docxBtn = container.querySelector('[data-rmd="pubconsent-docx"]');
    if (docxBtn && saved) {
      docxBtn.addEventListener("click", function () {
        var errEl = container.querySelector("#rmd-pubconsent-status");
        var sName = saved.languageName || (saved.language ? langNameFor(saved.language) : "English");
        var sCode = langCodeFor(sName);
        var isUrdu = (sCode === "ur");

        if (sCode !== "en" && sName !== "English") {
          if (!saved.local || !saved.local.trim()) {
            var blockedMsg = "Fill in the " + sName + " version first.";
            if (errEl) errEl.innerHTML = '<span style="color:#ff6b6b;" role="alert">' + esc(blockedMsg) + '</span>';
            return;
          }
        }
        if (errEl) errEl.innerHTML = "";

        var sections = [];
        var title = "Consent for Publication - " + ((proj && proj.title) || "Case Report");

        if (sCode !== "en" && sName !== "English") {
          sections.push({
            heading: "Patient Consent for Publication (" + sName + ")",
            text: saved.local,
            isRtl: isUrdu,
            size: 28
          });
          sections.push({ pageBreak: true });
          sections.push({
            heading: "English copy (for the ethics committee)",
            text: saved.english || "",
            isRtl: false,
            size: 24
          });
        } else {
          sections.push({
            heading: "Patient Consent for Publication",
            text: saved.english || "",
            isRtl: false,
            size: 28
          });
        }

        var bytes = createDocx(title, sections);
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
