/* thorex-screens.js — ThoreX AI · screens + router (entitlement-aware dual-panel result).
 * Sibling of kardiox-screens.js: same shape (SCREENS map, state, host()/ctx(), show/go/back,
 * mountLanding, init, delegated click/keydown via data-act, wireSignout) — scoped to #thorexRoot /
 * #txScroll / .tx-*. Screens talk ONLY to window.SMD_THOREX_PROVIDERS.current(); entitlement via
 * window.SMD_THOREX_ENTITLEMENT.resolve(); models via window.SMD_THOREX_MODELS; flags via
 * window.SMD_THOREX_FLAGS.
 *
 * The confidence-band/severity-pill mapping and the panel-model builder (buildPanelModels) are pure
 * (no DOM) so they can be exercised headlessly by test/thorex-screens-helpers.test.js — the dual-export
 * at the bottom of this file makes them `require()`-able in node while the router itself stays a
 * browser-only IIFE (mirrors kardiox-screens.js).
 */
(function () {
  "use strict";
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function haptic(k) { try { if (window.SMD_THOREX_FLAGS && window.SMD_THOREX_FLAGS.bool("smd_thorex_haptics") && window.SMD_HAPTICS && window.SMD_HAPTICS[k]) window.SMD_HAPTICS[k](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); else if (window.SMD_toast) SMD_toast(m); } catch (e) {} }

  /* ══════════════════════════ PURE helpers (no DOM — node-testable) ══════════════════════════════
   * Severity presentation — COLOUR (via .tx-pill--*) + ICON + LABEL, never colour alone.
   * Confidence — BAND only (High/Medium/Low), never a raw probability (§6 Safety). bandToPct() maps
   * the band word to an internal bar-width percentage for the visual only; the LABEL shown to the
   * user is always the band word (see buildFindingModel().confLabel), never a synthesized number. */
  var SEV = {
    critical: { label: "Critical", icon: "crisis_alert" },
    urgent:   { label: "Urgent",   icon: "priority_high" },
    warn:     { label: "Caution",  icon: "warning" },
    stable:   { label: "Stable",   icon: "check_circle" },
    info:     { label: "Info",     icon: "info" }
  };
  function sevInfo(key) { return SEV[key] || SEV.info; }

  var BAND_PCT = { High: 86, Medium: 55, Low: 24 };
  function bandToPct(band) { return (band && BAND_PCT.hasOwnProperty(band)) ? BAND_PCT[band] : null; }

  // Mandatory safety disclaimer (Global Constraints) — verbatim, appended once per result screen.
  var MANDATORY_DISCLAIMER = "AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations.";

  // One finding -> its render-ready shape (severity pill + band-derived bar, never a raw probability).
  function buildFindingModel(f) {
    f = f || {};
    var sev = sevInfo(f.severity);
    return {
      label: f.label || "",
      band: f.band == null ? null : f.band,
      severity: f.severity || "info",
      severityLabel: sev.label,
      severityIcon: sev.icon,
      relevance: f.relevance || "",
      heatmap: f.heatmap || null,
      confPct: bandToPct(f.band),         // internal bar-width mapping only
      confLabel: f.band == null ? null : f.band   // the word shown to the user, e.g. "High"
    };
  }

  // The critical extraction: for EACH engine in analysis.engines, build a panel model. The
  // `educational:true` engine is flagged noActions:true — this IS the real no-clinical-action
  // enforcement (the CSS .tx-panel--learning .tx-actions{display:none} rule is only a defensive
  // fallback; markup for the actions row must never be emitted for a learning panel in the first
  // place — see renderResult()/panelHtml() below).
  function buildPanelModels(analysis) {
    analysis = analysis || {};
    var engines = Array.isArray(analysis.engines) ? analysis.engines : [];
    return engines.map(function (e) {
      e = e || {};
      var educational = !!e.educational;
      return {
        engine: e.engine || "",
        educational: educational,
        noActions: educational,
        findings: (Array.isArray(e.findings) ? e.findings : []).map(buildFindingModel),
        disclaimerText: MANDATORY_DISCLAIMER
      };
    });
  }

  // Worst (highest-priority) severity across every finding in every engine — used for landing/history
  // preview rows and the success/warning haptic after a fresh analysis.
  var SEV_RANK = { critical: 0, urgent: 1, warn: 2, info: 3, stable: 4 };
  function worstSeverity(analysis) {
    var worst = null, rank = 99;
    (buildPanelModels(analysis)).forEach(function (p) {
      p.findings.forEach(function (f) {
        var r = SEV_RANK.hasOwnProperty(f.severity) ? SEV_RANK[f.severity] : 98;
        if (r < rank) { rank = r; worst = f.severity; }
      });
    });
    return worst;
  }

  // A one-line summary of an analysis for list rows (landing "Recent" preview + full History).
  function summarizeAnalysis(a) {
    a = a || {};
    var panels = buildPanelModels(a);
    var clinical = panels.filter(function (p) { return !p.educational; })[0] || panels[0];
    var top = clinical && clinical.findings && clinical.findings[0];
    return {
      id: a.id,
      title: (top && top.label) || "Chest X-ray analysis",
      meta: a.createdAt || "",
      severity: (top && top.severity) || "info"
    };
  }

  // Never-fabricate guard (patient-safety): the ONLY question renderResult()/openStored() are allowed
  // to ask before showing a result. true only when `a` is a real analysis with at least one engine —
  // never true for null/undefined/a malformed payload, and NEVER used to justify substituting a
  // canned sample. Pure (no DOM) so it is node-testable and reused identically by both call sites.
  function hasRenderableAnalysis(a) {
    return !!(a && Array.isArray(a.engines) && a.engines.length > 0);
  }

  /* ══════════════════════════════════════ Screens ══════════════════════════════════════════════ */

  /* landing */
  function renderLanding(host, ctx) {
    if (!host) return;
    ctx = ctx || {};
    var P = ctx.providers || (typeof window !== "undefined" && window.SMD_THOREX_PROVIDERS && window.SMD_THOREX_PROVIDERS.current()) || null;

    function noop() {}
    function recRow(r) {
      var sev = sevInfo(r.severity);
      return "" +
        '<button class="tx-rec" type="button" data-act="tx-open" data-id="' + esc(r.id) + '" ' +
          'aria-label="' + esc(r.title) + ", " + sev.label + ' - open result">' +
          '<span class="tx-rec-thumb" aria-hidden="true">' + ic("image") + "</span>" +
          '<span class="tx-rec-body">' +
            '<b class="tx-rec-title">' + esc(r.title) + "</b>" +
            '<span class="tx-rec-meta">' + esc(r.meta) + "</span>" +
          "</span>" +
          '<span class="tx-pill tx-pill--' + esc(r.severity) + '">' + ic(sev.icon) +
            '<span class="tx-data">' + sev.label + "</span></span>" +
        "</button>";
    }
    function emptyState() {
      return "" +
        '<div class="tx-empty">' +
          '<span aria-hidden="true">' + ic("search_off") + "</span>" +
          '<b class="tx-empty-title">No analyses yet</b>' +
          '<span class="tx-empty-sub">Analyze a chest X-ray to see it here.</span>' +
        "</div>";
    }

    var header = "" +
      '<header class="tx-land-head">' +
        '<button class="tx-land-close" type="button" data-act="tx-close" aria-label="Close ThoreX">' + ic("close") + "</button>" +
        '<div class="tx-land-titles">' +
          '<div class="tx-land-title">ThoreX<span> AI</span></div>' +
          '<div class="tx-land-sub">Chest X-ray interpretation</div>' +
        "</div>" +
        '<button class="tx-land-gear" type="button" data-act="tx-settings" aria-label="ThoreX settings">' + ic("settings") + "</button>" +
      "</header>";

    var cta = "" +
      '<button class="tx-cta" type="button" data-act="tx-add">' +
        '<span class="tx-cta-ic" aria-hidden="true">' + ic("add_a_photo") + "</span>" +
        '<span class="tx-cta-txt">' +
          '<b class="tx-cta-title">Analyze a chest X-ray</b>' +
          '<span class="tx-cta-sub">Camera, photo, file or PDF</span>' +
        "</span>" +
        '<span class="tx-cta-go" aria-hidden="true">' + ic("arrow_forward") + "</span>" +
      "</button>";

    var secHead = "" +
      '<div class="tx-sec-head">' +
        '<span class="tx-sec-title">Recent analyses</span>' +
        '<button class="tx-seeall" type="button" data-act="tx-history">See all</button>' +
      "</div>";

    var recent = '<div class="tx-recent" data-hook="recent">' + emptyState() + "</div>";
    var foot = '<div class="tx-foot">' + ic("verified_user") + "CXRs stay on your device</div>";

    host.innerHTML = header + '<div class="tx-landing">' + cta + secHead + recent + foot + "</div>";

    if (P && P.cxrStore && P.cxrStore.timeline) {
      Promise.resolve(P.cxrStore.timeline()).then(function (list) {
        list = Array.isArray(list) ? list : [];
        var box = host.querySelector('[data-hook="recent"]');
        if (!box) return;
        if (list.length) box.innerHTML = list.slice(0, 3).map(function (a) { return recRow(summarizeAnalysis(a)); }).join("");
      }).catch(noop);
    }
  }

  /* source (upload + Free/HF consent gate) */
  function renderSource(host, ctx) {
    ctx = ctx || {};

    // ── Free-path consent gate (tri-state ask-once) ── the CSS scopes .tx-consent onto the source
    // screen itself (not a separate route: there is no "consent" key in SCREENS). When the router
    // has a pending consent decision (state.consentPending set by onClick before the real upload
    // starts) this screen renders ONLY the consent prompt in place of the source grid — accept
    // resumes the capture, decline stops with no upload.
    if (ctx.consentPending) {
      host.innerHTML =
        '<section class="tx-src" aria-labelledby="txSrcTitle">' +
          '<div class="tx-src-head">' +
            '<button type="button" class="tx-src-back" data-act="tx-consent-decline" aria-label="Back">' + ic("arrow_back") + "</button>" +
            '<h2 class="tx-src-title" id="txSrcTitle">Before you continue</h2>' +
          "</div>" +
          '<div class="tx-src-body">' +
            '<div class="tx-consent" role="group" aria-label="Cloud analysis consent">' +
              '<span class="tx-consent-ic" aria-hidden="true">' + ic("cloud") + "</span>" +
              '<div>' +
                '<div class="tx-consent-txt">Free analysis runs on a third-party hosted model. Your chest X-ray will be sent off-device for this analysis. Continue?</div>' +
                '<div class="tx-consent-acts">' +
                  '<button class="tx-btn tx-btn-secondary" type="button" data-act="tx-consent-decline">Not now</button>' +
                  '<button class="tx-btn tx-btn-primary" type="button" data-act="tx-consent-accept">Allow &amp; continue</button>' +
                "</div>" +
              "</div>" +
            "</div>" +
          "</div>" +
        "</section>";
      return;
    }

    function srcCard(source, icon, name, hint, mod) {
      return '<button type="button" class="tx-src-card' + (mod ? " " + mod : "") + '"' +
               ' data-act="tx-source" data-source="' + source + '"' +
               ' aria-label="' + name + " - " + hint + '">' +
               '<span class="tx-src-ic" aria-hidden="true">' + ic(icon) + "</span>" +
               '<span class="tx-src-name">' + name + "</span>" +
               '<span class="tx-src-hint">' + hint + "</span>" +
             "</button>";
    }

    host.innerHTML =
      '<section class="tx-src" aria-labelledby="txSrcTitle">' +
        '<div class="tx-src-head">' +
          '<button type="button" class="tx-src-back" data-act="tx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
          '<h2 class="tx-src-title" id="txSrcTitle">Add a chest X-ray</h2>' +
        "</div>" +
        '<div class="tx-src-body">' +
          '<div class="tx-drop" role="group" aria-label="Drop a chest X-ray here. Drag and drop on iPad, or choose a source below.">' +
            '<span class="tx-drop-ic" aria-hidden="true">' + ic("upload_file") + "</span>" +
            '<b class="tx-drop-title">Drop an image here</b>' +
            '<span class="tx-drop-sub">Drag &amp; drop on iPad, or choose a source below</span>' +
          "</div>" +
          '<div class="tx-src-grid">' +
            srcCard("camera", "photo_camera", "Camera", "Guided capture") +
            srcCard("library", "photo_library", "Photo Library", "PNG, JPEG, HEIC") +
            srcCard("files", "folder", "Files", "Browse iCloud") +
            srcCard("pdf", "picture_as_pdf", "Scan PDF", "Multi-page", "tx-src-card--pdf") +
          "</div>" +
          '<div class="tx-tip" role="note">' +
            '<span class="tx-tip-ic" aria-hidden="true">' + ic("tips_and_updates") + "</span>" +
            '<span class="tx-tip-txt">Frontal view, patient upright when possible, whole chest in frame, avoid glare — ThoreX auto-enhances the image before analysis.</span>' +
          "</div>" +
          '<div class="tx-src-foot">' + ic("lock") + "Encrypted upload &middot; deleted after analysis</div>" +
        "</div>" +
      "</section>";
  }

  /* permission */
  function renderPermission(host, ctx) {
    host.innerHTML =
      '<div class="tx-perm" role="dialog" aria-modal="true" aria-labelledby="txPermTitle" aria-describedby="txPermBody">' +
        '<button class="tx-perm-scrim" type="button" data-act="tx-cam-deny" aria-label="Dismiss"></button>' +
        '<div class="tx-perm-sheet" role="document">' +
          '<span class="tx-perm-icon">' + ic("photo_camera") + "</span>" +
          '<h2 class="tx-perm-title" id="txPermTitle">Allow camera access?</h2>' +
          '<p class="tx-perm-body" id="txPermBody">ThoreX uses the camera to capture chest X-ray images for analysis. Images are processed then deleted — nothing is saved to your camera roll.</p>' +
          '<div class="tx-perm-assure">' + ic("lock") + "<span>Encrypted &amp; deleted after use</span></div>" +
          '<button class="tx-perm-allow" type="button" data-act="tx-cam-allow">Allow camera</button>' +
          '<button class="tx-perm-deny" type="button" data-act="tx-cam-deny">Not now</button>' +
        "</div>" +
      "</div>";
  }

  /* quality gate — client-side/backend-reported image-quality pre-check. Adequate → runPipeline never
     shows this screen at all; marginal/inadequate → blocking warning requiring explicit acknowledgement
     before the (already-computed) result is shown. */
  function renderQuality(host, ctx) {
    ctx = ctx || {};
    var a = ctx.analysis || {};
    var q = a.quality || { adequate: false, issues: [] };
    var issues = (Array.isArray(q.issues) && q.issues.length) ? q.issues : [
      { label: "Image quality", state: "warn", detail: "Could not fully verify quality." }
    ];

    function checkRow(it) {
      it = it || {};
      var st = it.state === "pass" || it.state === "fail" ? it.state : "warn";
      var glyph = st === "pass" ? "check_circle" : st === "fail" ? "error" : "warning";
      return '<li class="tx-qual-check is-' + st + '">' +
        '<span class="tx-qual-check-ico material-symbols-rounded" aria-hidden="true">' + glyph + "</span>" +
        '<span class="tx-qual-check-label">' + esc(it.label || "Check") + "</span>" +
        (it.detail ? '<span class="tx-qual-check-val">' + esc(it.detail) + "</span>" : "") +
      "</li>";
    }

    var badgeMod = q.adequate === false ? " is-fail" : (issues.some(function (i) { return i.state === "warn"; }) ? " is-warn" : "");

    host.innerHTML =
      '<section class="tx-qual" aria-label="Image quality check">' +
        '<header class="tx-qual-head">' +
          '<button class="tx-qual-close" type="button" data-act="tx-close" aria-label="Cancel">' + ic("close") + "</button>" +
          '<h2 class="tx-qual-title">Image quality check</h2>' +
        "</header>" +
        '<div class="tx-qual-body">' +
          '<div class="tx-qual-preview"><span class="tx-qual-badge' + badgeMod + '">' + esc(q.view || "CXR") + "</span></div>" +
          '<ul class="tx-qual-checks">' + issues.map(checkRow).join("") + "</ul>" +
          '<div class="tx-qual-warn">' + ic("warning") +
            '<span class="tx-qual-warn-txt" id="txQualWarnTxt">This image may not meet quality standards for reliable analysis. Findings could be less accurate or incomplete.</span>' +
          "</div>" +
          '<label class="tx-qual-ack">' +
            '<input type="checkbox" data-hook="ack" aria-describedby="txQualWarnTxt" />' +
            "<span>I understand and want to continue</span>" +
          "</label>" +
          '<div class="tx-qual-actions">' +
            '<button class="tx-btn tx-btn-primary" type="button" data-act="tx-qual-continue" data-hook="continue" disabled>Continue anyway</button>' +
            '<button class="tx-btn tx-btn-secondary" type="button" data-act="tx-qual-retake">Retake photo</button>' +
          "</div>" +
          '<p class="tx-qual-live" data-hook="live" aria-live="polite"></p>' +
        "</div>" +
      "</section>";

    // Local (non-navigational) interaction only: enable the blocking "Continue anyway" action once
    // the user has explicitly acknowledged the risk. Navigation itself stays delegated via data-act.
    var ackBox = host.querySelector('[data-hook="ack"]');
    var contBtn = host.querySelector('[data-hook="continue"]');
    var liveEl = host.querySelector('[data-hook="live"]');
    if (ackBox && contBtn) {
      ackBox.addEventListener("change", function () {
        contBtn.disabled = !ackBox.checked;
        if (liveEl) liveEl.textContent = ackBox.checked ? "You can now continue." : "";
      });
    }
  }

  /* processing — live pipeline (dark, confidence ring + staged progress). runPipeline() drives the
     real analyze() call and pushes stage updates into this screen via host()._txApplyStage (set below)
     so the visual progress reflects the actual pipeline stages, not a decorative timer. */
  function renderProcessing(host, ctx) {
    ctx = ctx || {};
    var STAGES = [
      { key: "upload", label: "Uploading image" },
      { key: "quality", label: "Checking image quality" },
      { key: "digitization", label: "Preparing for analysis" },
      { key: "signalExtraction", label: "Extracting features" },
      { key: "analysis", label: "Running AI detection" },
      { key: "report", label: "Preparing report" }
    ];

    function stageRow(i) {
      return '<div class="tx-stage is-pending" data-stage-row="' + i + '">' +
        '<div class="tx-stage-head">' +
          '<span class="tx-stage-name">' + ic("radio_button_unchecked") + esc(STAGES[i].label) + "</span>" +
          '<span class="tx-stage-val tx-data" data-stage-val>&ndash;</span>' +
        "</div>" +
        '<div class="tx-stage-track"><div class="tx-stage-fill" data-stage-fill></div></div>' +
      "</div>";
    }

    host.innerHTML =
      '<section class="tx-proc" aria-label="Analyzing your chest X-ray">' +
        '<div class="tx-proc-inner" role="status" aria-live="polite">' +
          '<div class="tx-conf-ring" role="img" aria-label="Analysis progress">' +
            '<svg class="tx-conf-svg" viewBox="0 0 120 120" aria-hidden="true">' +
              '<circle class="tx-conf-track" cx="60" cy="60" r="52"></circle>' +
              '<circle class="tx-conf-arc" cx="60" cy="60" r="52" data-arc></circle>' +
            "</svg>" +
            '<div class="tx-conf-center">' +
              '<span class="tx-conf-pct tx-data" data-pct>0%</span>' +
              '<span class="tx-conf-cap">ANALYZING</span>' +
            "</div>" +
          "</div>" +
          '<h2 class="tx-proc-title">Analyzing your chest X-ray&hellip;</h2>' +
          '<p class="tx-proc-sub">ThoreX is checking quality and running detection</p>' +
          '<div class="tx-stages">' + STAGES.map(function (s, i) { return stageRow(i); }).join("") + "</div>" +
          '<div class="tx-proc-foot">' + ic("lock") + "<span>Encrypted &middot; deleted immediately after analysis</span></div>" +
        "</div>" +
      "</section>";

    var rows = Array.prototype.slice.call(host.querySelectorAll("[data-stage-row]"));
    var pctEl = host.querySelector("[data-pct]");
    var arcEl = host.querySelector("[data-arc]");
    var C = 2 * Math.PI * 52;
    if (arcEl) { arcEl.setAttribute("stroke-dasharray", C.toFixed(2)); arcEl.setAttribute("stroke-dashoffset", C.toFixed(2)); }

    function setPct(p) {
      p = Math.max(0, Math.min(100, Math.round(p)));
      if (pctEl) pctEl.textContent = p + "%";
      if (arcEl) arcEl.setAttribute("stroke-dashoffset", (C * (1 - p / 100)).toFixed(2));
    }

    // Exposed so runPipeline()'s onStage callback can drive this screen without a full re-render.
    host._txApplyStage = function (stageKey, pct) {
      var idx = -1;
      for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === stageKey) { idx = i; break; }
      if (idx < 0) idx = STAGES.length - 1;
      rows.forEach(function (row, i) {
        var g = row.querySelector(".tx-stage-name .material-symbols-rounded");
        var v = row.querySelector("[data-stage-val]");
        var f = row.querySelector("[data-stage-fill]");
        row.classList.remove("is-done", "is-active", "is-pending");
        if (i < idx) { row.classList.add("is-done"); if (g) g.textContent = "check_circle"; if (v) v.textContent = "done"; if (f) f.style.width = "100%"; }
        else if (i === idx) { row.classList.add("is-active"); if (g) g.textContent = "progress_activity"; if (v) v.textContent = (pct || 0) + "%"; if (f) f.style.width = (pct || 0) + "%"; }
        else { row.classList.add("is-pending"); if (g) g.textContent = "radio_button_unchecked"; if (v) v.textContent = "–"; if (f) f.style.width = "0%"; }
      });
      setPct(typeof pct === "number" ? pct : Math.round(((idx + 1) / STAGES.length) * 100));
    };
  }

  /* result — entitlement-aware, dual-panel for v2beta (Clinical + Learning), single for v1/free.
     buildPanelModels() (pure, above) does the entitlement-shape → panel-model work; this function is
     purely presentational (markup only). The Learning panel's markup NEVER includes the actions row —
     that omission (not a CSS override) is the real "no clinical action" enforcement. */
  function renderResult(host, ctx) {
    ctx = ctx || {};
    var a = ctx.analysis;
    // Never-fabricate rule: if there is no real analysis to show (missing/null/no engines), render
    // the "result unavailable" empty state — NEVER a canned sample. A sample result here would be
    // indistinguishable from a real read and is a patient-safety violation.
    if (!hasRenderableAnalysis(a)) {
      renderEmpty(host, { providers: ctx.providers, analysis: null, emptyReason: ctx.emptyReason || "not-found" });
      return;
    }
    var panels = buildPanelModels(a);
    var dual = panels.length > 1;

    function findingHtml(f) {
      var pill = '<span class="tx-pill tx-pill--' + esc(f.severity) + '">' + ic(f.severityIcon) + "<span>" + esc(f.severityLabel) + "</span></span>";
      var conf = f.confPct == null ? "" :
        '<div class="tx-conf">' +
          '<div class="tx-conf-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + f.confPct + '" aria-valuetext="' + esc(f.confLabel) + '" aria-label="AI confidence band: ' + esc(f.confLabel) + '">' +
            '<div class="tx-conf-fill" style="--tx-conf:' + f.confPct + '%"></div>' +
          "</div>" +
          '<span class="tx-conf-val tx-data">' + esc(f.confLabel) + "</span>" +
        "</div>" +
        '<div class="tx-conf-band">Confidence band</div>';
      var heat = f.heatmap ?
        '<div class="tx-heatmap"><img class="tx-heatmap-overlay" src="data:image/png;base64,' + f.heatmap + '" alt="' + esc(f.label) + ' Grad-CAM heatmap overlay" /><span class="tx-heatmap-cap">HEATMAP</span></div>' : "";
      return '<div class="tx-finding">' +
        '<div class="tx-finding-row"><span class="tx-finding-name">' + esc(f.label) + "</span>" + pill + "</div>" +
        (f.relevance ? '<div class="tx-finding-loc">' + esc(f.relevance) + "</div>" : "") +
        conf + heat +
      "</div>";
    }

    function panelHtml(p) {
      var cls = "tx-panel" + (p.educational ? " tx-panel--learning" : "");
      var badge = '<span class="tx-panel-badge">' + ic(p.educational ? "school" : "verified") + esc(p.engine) + "</span>";
      var eduBanner = p.educational ?
        '<div class="tx-edu-banner">' + ic("info") + "<span>Educational &mdash; not for clinical use</span></div>" : "";
      var findingsHtml = '<div class="tx-findings">' + p.findings.map(findingHtml).join("") + "</div>";
      var whyLink = !p.educational ?
        '<button type="button" class="tx-why-link" data-act="tx-why">' + ic("psychology") +
          '<span class="tx-why-link-txt"><b>Why this finding?</b><span class="tx-why-link-sub">See the model reasoning</span></span>' +
          ic("chevron_right") + "</button>" : "";
      // The educational panel MUST NOT emit the actions row at all — never rely on the CSS
      // .tx-panel--learning .tx-actions{display:none} fallback to hide markup that shouldn't exist.
      var actions = p.noActions ? "" :
        '<div class="tx-actions">' +
          '<button class="tx-btn tx-btn-primary" type="button" data-act="tx-save">' + ic("bookmark") + "Save case</button>" +
          '<button class="tx-btn tx-btn-secondary" type="button" data-act="tx-export">' + ic("picture_as_pdf") + "Export</button>" +
        "</div>";
      return '<div class="' + cls + '">' +
        '<div class="tx-panel-head"><div>' +
          '<div class="tx-panel-eyebrow">' + (p.educational ? "Learning" : "Clinical") + "</div>" +
          '<div class="tx-panel-title">' + (p.educational ? "Educational analysis" : "Clinical analysis") + "</div>" +
          '<div class="tx-panel-engine">' + esc(p.engine) + "</div>" +
        "</div>" + badge + "</div>" +
        eduBanner + findingsHtml + whyLink + actions +
      "</div>";
    }

    var head =
      '<div class="tx-result-head">' +
        '<button class="tx-result-back" type="button" data-act="tx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
        '<div class="tx-result-titles">' +
          '<div class="tx-result-title">CXR Result</div>' +
          (a.createdAt ? '<div class="tx-result-sub">' + esc(a.createdAt) + "</div>" : "") +
        "</div>" +
        '<button class="tx-result-share" type="button" data-act="tx-share" aria-label="Share result">' + ic("ios_share") + "</button>" +
      "</div>";

    var body =
      '<div class="tx-result-body">' +
        '<div class="tx-result-panels' + (dual ? " tx-dual" : "") + '">' + panels.map(panelHtml).join("") + "</div>" +
        '<div class="tx-disc">' + ic("info") + "<span>" + esc(MANDATORY_DISCLAIMER) + "</span></div>" +
      "</div>";

    host.innerHTML = head + body;
    var fills = host.querySelectorAll(".tx-conf-fill");
    Array.prototype.forEach.call(fills, function (el) {
      var v = el.style.getPropertyValue ? el.style.getPropertyValue("--tx-conf") : "";
      if (v) el.style.setProperty("--tx-conf", v);
    });
  }

  /* why — lightweight explainability (clinical engine only; P2 deepens the clinical-correlation seam). */
  function renderWhy(host, ctx) {
    ctx = ctx || {};
    var a = ctx.analysis || {};
    var panels = buildPanelModels(a);
    var clinical = panels.filter(function (p) { return !p.educational; })[0] || panels[0] || { findings: [] };

    function row(f) {
      var pill = '<span class="tx-pill tx-pill--' + esc(f.severity) + '">' + ic(f.severityIcon) + "<span>" + esc(f.severityLabel) + "</span></span>";
      return '<div class="tx-finding">' +
        '<div class="tx-finding-row"><span class="tx-finding-name">' + esc(f.label) + "</span>" + pill + "</div>" +
        (f.relevance ? '<div class="tx-finding-loc">' + esc(f.relevance) + "</div>" : "") +
      "</div>";
    }

    host.innerHTML =
      '<div class="tx-list-head">' +
        '<button class="tx-result-back" type="button" data-act="tx-back" aria-label="Back to result">' + ic("arrow_back") + "</button>" +
        '<h2 class="tx-list-title">Why this finding?</h2>' +
      "</div>" +
      '<div class="tx-list-body">' +
        (clinical.findings.length
          ? '<div class="tx-findings">' + clinical.findings.map(row).join("") + "</div>"
          : '<div class="tx-empty">' + ic("psychology") + '<b class="tx-empty-title">No findings to explain</b></div>') +
        // Defense-in-depth: every clinical-content screen carries the mandatory disclaimer, not just
        // the primary result screen — this drill-down still shows AI-derived findings.
        '<div class="tx-disc">' + ic("info") + "<span>" + esc(MANDATORY_DISCLAIMER) + "</span></div>" +
      "</div>";
  }

  /* history */
  function renderHistory(host, ctx) {
    ctx = ctx || {};
    var P = ctx.providers || (typeof window !== "undefined" && window.SMD_THOREX_PROVIDERS && window.SMD_THOREX_PROVIDERS.current()) || null;

    function rowFor(a) {
      var s = summarizeAnalysis(a);
      var sev = sevInfo(s.severity);
      return '<button class="tx-rec" type="button" data-act="tx-open" data-id="' + esc(s.id) + '" aria-label="' + esc(s.title) + ", " + sev.label + ' - open result">' +
        '<span class="tx-rec-thumb" aria-hidden="true">' + ic("image") + "</span>" +
        '<span class="tx-rec-body"><b class="tx-rec-title">' + esc(s.title) + "</b><span class=\"tx-rec-meta\">" + esc(s.meta) + "</span></span>" +
        '<span class="tx-pill tx-pill--' + esc(s.severity) + '">' + ic(sev.icon) + "<span class=\"tx-data\">" + sev.label + "</span></span>" +
      "</button>";
    }
    function emptyState() {
      return '<div class="tx-empty">' + ic("search_off") + '<b class="tx-empty-title">No analyses yet</b><span class="tx-empty-sub">Analyze a chest X-ray to see it here.</span></div>';
    }

    host.innerHTML =
      '<div class="tx-list-head">' +
        '<button class="tx-result-back" type="button" data-act="tx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
        '<h2 class="tx-list-title">History</h2>' +
      "</div>" +
      '<div class="tx-list-body" data-hook="list">' + emptyState() + "</div>";

    if (P && P.cxrStore && P.cxrStore.timeline) {
      Promise.resolve(P.cxrStore.timeline()).then(function (list) {
        var box = host.querySelector('[data-hook="list"]');
        if (!box) return;
        list = Array.isArray(list) ? list : [];
        if (list.length) box.innerHTML = '<div class="tx-recent">' + list.map(rowFor).join("") + "</div>";
      }).catch(function () {});
    }
  }

  /* settings */
  function renderSettings(host, ctx) {
    ctx = ctx || {};
    var F = (typeof window !== "undefined" && window.SMD_THOREX_FLAGS) || null;
    var conf = F ? F.bool("smd_thorex_confidence") : true;
    var haptics = F ? F.bool("smd_thorex_haptics") : true;
    var cloud = F ? F.get("smd_thorex_cloud") : null;
    var cloudLabel = cloud === true ? "Allowed" : cloud === false ? "Declined" : "Not set (asked before the next Free upload)";

    function toggleRow(label, sub, act, on) {
      return '<button type="button" class="tx-set-row" data-act="' + act + '" role="switch" aria-checked="' + (on ? "true" : "false") + '">' +
        '<div><div class="tx-set-label">' + esc(label) + "</div><div class=\"tx-set-sub\">" + esc(sub) + "</div></div>" +
        '<span class="material-symbols-rounded" aria-hidden="true">' + (on ? "toggle_on" : "toggle_off") + "</span>" +
      "</button>";
    }

    host.innerHTML =
      '<div class="tx-list-head">' +
        '<button class="tx-result-back" type="button" data-act="tx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
        '<h2 class="tx-list-title">ThoreX settings</h2>' +
      "</div>" +
      '<div class="tx-list-body">' +
        toggleRow("Show AI confidence", "Confidence band on every result", "tx-toggle-confidence", conf) +
        toggleRow("Haptics", "Vibrate on tap and result-ready", "tx-toggle-haptics", haptics) +
        '<div class="tx-set-row"><div><div class="tx-set-label">Free cloud analysis</div><div class="tx-set-sub">' + esc(cloudLabel) + "</div></div></div>" +
        '<button type="button" class="tx-set-row" data-act="tx-clear-cxrs">' +
          '<div><div class="tx-set-label">Clear local CXRs</div><div class="tx-set-sub">Permanently deletes every stored case</div></div>' +
          ic("delete") +
        "</button>" +
      "</div>";
  }

  /* empty — also doubles as the "result unavailable" state (never-fabricate guard): reached when
     openStored() couldn't load a real record (deleted id / store failure) or renderResult() is asked
     to show a missing/malformed analysis. ctx.emptyReason === "not-found" swaps the copy; the screen
     never shows a sample in either case. */
  function renderEmpty(host, ctx) {
    ctx = ctx || {};
    var notFound = ctx.emptyReason === "not-found";
    var icon = notFound ? "error" : "search_off";
    var title = notFound ? "Result unavailable" : "No analyses yet";
    var sub = notFound
      ? "This chest X-ray result couldn't be loaded. It may have been deleted, or the local store is unavailable."
      : "Analyze a chest X-ray to see it here.";
    host.innerHTML =
      '<div class="tx-list-head">' +
        '<button class="tx-result-back" type="button" data-act="tx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
        '<h2 class="tx-list-title">ThoreX</h2>' +
      "</div>" +
      '<div class="tx-list-body">' +
        '<div class="tx-empty">' + ic(icon) +
          '<b class="tx-empty-title">' + esc(title) + "</b>" +
          '<span class="tx-empty-sub">' + esc(sub) + "</span>" +
        "</div>" +
      "</div>";
  }

  /* ══════════════════════════════ Router (SMD_THOREX_ROUTER) ══════════════════════════════════ */
  var SCREENS = {
    landing: renderLanding,
    source: renderSource,
    permission: renderPermission,
    quality: renderQuality,
    processing: renderProcessing,
    result: renderResult,
    why: renderWhy,
    history: renderHistory,
    settings: renderSettings,
    empty: renderEmpty
  };

  var state = { analysis: null, running: false, consentPending: null, emptyReason: null, stack: [] };

  function providers() { try { return window.SMD_THOREX_PROVIDERS && window.SMD_THOREX_PROVIDERS.current(); } catch (e) { return null; } }
  function host() { return document.getElementById("txScroll"); }
  function resolveEntitlement() {
    try { return (window.SMD_THOREX_ENTITLEMENT && window.SMD_THOREX_ENTITLEMENT.resolve) ? window.SMD_THOREX_ENTITLEMENT.resolve() : "free"; } catch (e) { return "free"; }
  }
  function closeMod() { try { if (window.THOREX && THOREX.close) THOREX.close(); } catch (e) {} }
  function ctx() {
    return {
      providers: providers(),
      analysis: state.analysis,
      nav: go,
      close: closeMod,
      toast: toast,
      entitlement: resolveEntitlement(),
      consentPending: state.consentPending,
      emptyReason: state.emptyReason
    };
  }
  function show(key) {
    var h = host(), fn = SCREENS[key];
    if (!h || !fn) return;
    try { fn(h, ctx()); } catch (e) { try { console.warn("[ThoreX] screen " + key, e); } catch (_) {} }
    try { h.scrollTop = 0; } catch (_) {}
  }
  function go(key) {
    key = String(key || "");
    if (!SCREENS[key]) { deferred(key); return; }
    if (state.stack[state.stack.length - 1] !== key) state.stack.push(key);
    show(key);
  }
  function back() {
    if (state.stack.length <= 1) { haptic("light"); closeMod(); return; }
    state.stack.pop();
    var prev = state.stack[state.stack.length - 1] || "landing";
    show(prev);
  }
  function mountLanding(h) {
    init();
    state.stack = ["landing"];
    try { SCREENS.landing(h || host(), ctx()); } catch (e) { try { console.warn("[ThoreX] landing", e); } catch (_) {} }
  }
  function deferred(key) { toast("That arrives in a later ThoreX update."); }

  function needsConsent() {
    try {
      if (resolveEntitlement() !== "free") return false;
      return !!(window.SMD_THOREX_FLAGS && window.SMD_THOREX_FLAGS.get("smd_thorex_cloud") === null);
    } catch (e) { return false; }
  }

  function finishPipeline(a) {
    state.analysis = a; state.running = false; state.emptyReason = null;
    try { var P = providers(); if (P && P.cxrStore && P.cxrStore.save) P.cxrStore.save(a); } catch (e) {}
    state.stack = ["landing"]; go("result"); haptic("success");
    try {
      var worst = worstSeverity(a);
      if (worst === "urgent" || worst === "critical") haptic("warning");
    } catch (e) {}
  }

  // runPipeline(image): resolve entitlement -> run the real analyzer (mock in demo mode, remote
  // otherwise, honest "unavailable" if unreachable — see thorex-providers.js) -> if the analysis
  // reports inadequate image quality, block on the quality-gate screen until acknowledged; otherwise
  // save to cxrStore and go straight to the result.
  function runPipeline(image) {
    if (state.running) return;
    state.running = true;
    var entitlement = resolveEntitlement();
    var P = providers();
    show("processing");
    if (!P || !P.analyzer) { state.running = false; toast("ThoreX analyzer unavailable."); show("source"); return; }
    P.analyzer.analyze(image || { id: "tx-" + Date.now(), source: "photoLibrary" }, entitlement, function (stage, pct) {
      try { var h = host(); if (h && h._txApplyStage) h._txApplyStage(stage, pct); } catch (e) {}
    }).then(function (a) {
      if (a && a.quality && a.quality.adequate === false) {
        state.analysis = a; state.running = false; show("quality"); return;
      }
      finishPipeline(a);
    }).catch(function (e) {
      state.running = false;
      try { console.log("TXDBG runPipeline failed:", e && e.code, "|", e && e.stage, "|", e && e.message); } catch (_) {}
      var detail = e && (e.message || e.code) ? ((e.code ? "[" + e.code + "] " : "") + (e.message || "")) : "";
      toast(detail ? ("Analysis failed: " + detail).slice(0, 180) : "Couldn't analyze this chest X-ray. Try again with a clear, well-lit image.");
      show("source");
    });
  }

  // Never-fabricate rule applies here too: a deleted id / bad id / store failure must land on the
  // "result unavailable" empty state, NEVER on go("result") with a null/undefined analysis (which
  // would previously have triggered renderResult()'s now-removed sample fallback).
  function openStored(id) {
    var P = providers();
    var p = (P && P.cxrStore && P.cxrStore.get) ? Promise.resolve(P.cxrStore.get(id)) : Promise.resolve(null);
    p.then(function (a) {
      if (hasRenderableAnalysis(a)) { state.analysis = a; state.emptyReason = null; go("result"); }
      else { state.analysis = null; state.emptyReason = "not-found"; go("empty"); }
    }).catch(function () {
      state.analysis = null; state.emptyReason = "not-found"; go("empty");
    });
  }

  function toggleConfidence() {
    try {
      var F = window.SMD_THOREX_FLAGS; if (!F) return;
      F.set("smd_thorex_confidence", !F.bool("smd_thorex_confidence"));
      toast("Confidence display " + (F.bool("smd_thorex_confidence") ? "on" : "off") + ".");
      show("settings");
    } catch (e) {}
  }
  function toggleHaptics() {
    try {
      var F = window.SMD_THOREX_FLAGS; if (!F) return;
      F.set("smd_thorex_haptics", !F.bool("smd_thorex_haptics"));
      toast("Haptics " + (F.bool("smd_thorex_haptics") ? "on" : "off") + ".");
      show("settings");
    } catch (e) {}
  }
  function clearCxrs() {
    var P = providers(); if (!P || !P.cxrStore) return;
    var okc = true;
    try { okc = window.confirm ? window.confirm("Clear all local chest X-rays? This permanently deletes every stored case and cannot be undone.") : true; } catch (e) {}
    if (!okc) return;
    Promise.resolve(P.cxrStore.deleteAll()).then(function () { toast("Local CXRs cleared."); state.analysis = null; show("settings"); }).catch(function () { toast("Couldn't clear CXRs."); });
  }

  function exportReport() {
    var a = state.analysis; if (!a) { toast("No result to export."); return; }
    var panels = buildPanelModels(a);
    var frag = (typeof document !== "undefined") ? document.createElement("div") : null;
    var html = "<h2>ThoreX AI &mdash; Chest X-ray Result</h2>" + panels.map(function (p) {
      return "<h3>" + esc(p.engine) + (p.educational ? " (educational)" : "") + "</h3><ul>" +
        p.findings.map(function (f) { return "<li>" + esc(f.label) + (f.confLabel ? " &mdash; " + esc(f.confLabel) : "") + "</li>"; }).join("") +
      "</ul>";
    }).join("") + "<p style='color:#888;font-size:12px'>" + esc(MANDATORY_DISCLAIMER) + "</p>";
    try {
      if (frag) frag.innerHTML = html;
      var title = "ThoreX — CXR result";
      if (window.SMD_IS_NATIVE && window.SMD_NATIVE && window.SMD_NATIVE.saveHtmlFile && frag) { window.SMD_NATIVE.saveHtmlFile(frag, title, "ThoreX-CXR-report").catch(function () { toast("Export unavailable."); }); return; }
      var w = window.open("", "_blank");
      if (w) { w.document.write("<html><head><title>" + esc(title) + "</title></head><body>" + html + "</body></html>"); w.document.close(); w.focus(); w.print(); return; }
    } catch (er) {}
    toast("Export not available on this device.");
  }

  // Capture a real CXR image and return its bytes as a Blob. Native: Capacitor Camera (camera/photo)
  // or FilePicker (files/pdf); Web: a hidden <input type=file>. Rejects with {cancelled:true} on
  // user cancel. Accepts PNG/JPEG/HEIC/PDF.
  function captureImage(source) {
    return new Promise(function (resolve, reject) {
      var Cap = (typeof window !== "undefined" && window.Capacitor) || null;
      var Plugins = Cap && Cap.Plugins;
      var b64ToBlob = function (b64s, mime) {
        var bin = atob(b64s), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime || "image/jpeg" });
      };
      if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Plugins) {
        if ((source === "camera" || source === "library") && Plugins.Camera) {
          Plugins.Camera.getPhoto({ quality: 92, resultType: "dataUrl", allowEditing: false,
            source: source === "camera" ? "CAMERA" : "PHOTOS" })
            .then(function (p) {
              var du = p && (p.dataUrl || p.webPath);
              if (!du) return reject(new Error("no image"));
              return fetch(du).then(function (r) { return r.blob(); }).then(resolve);
            })
            .catch(function (err) { reject(/cancel/i.test((err && err.message) || "") ? { cancelled: true } : err); });
          return;
        }
        if (Plugins.FilePicker) {
          Plugins.FilePicker.pickFiles({ types: source === "pdf" ? ["application/pdf"] : ["image/png", "image/jpeg", "image/heic", "image/heif"], readData: true, limit: 1 })
            .then(function (res) {
              var f = res && res.files && res.files[0];
              if (!f) return reject({ cancelled: true });
              if (f.data) return resolve(b64ToBlob(f.data, f.mimeType));
              if (f.path && Cap.convertFileSrc) return fetch(Cap.convertFileSrc(f.path)).then(function (r) { return r.blob(); }).then(resolve);
              reject(new Error("no file data"));
            })
            .catch(function (err) { reject(/cancel/i.test((err && err.message) || "") ? { cancelled: true } : err); });
          return;
        }
      }
      try {
        var inp = document.createElement("input");
        inp.type = "file";
        inp.accept = source === "pdf" ? "application/pdf" : "image/png,image/jpeg,image/heic,image/heif";
        inp.onchange = function () { var f = inp.files && inp.files[0]; f ? resolve(f) : reject({ cancelled: true }); };
        inp.click();
      } catch (e) { reject(new Error("image capture unavailable")); }
    });
  }

  function startCapture(src) {
    captureImage(src).then(function (blob) {
      runPipeline({ id: "tx-" + Date.now(), source: src, data: blob });
    }).catch(function (err) {
      if (err && err.cancelled) return;
      toast("Couldn't open the " + (src === "camera" ? "camera" : "picker") + ". " + ((err && err.message) || ""));
    });
  }

  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act") || "";
    switch (act) {
      case "tx-close": haptic("light"); closeMod(); return;
      case "tx-back": haptic("light"); back(); return;
      case "tx-add": haptic("light"); state.consentPending = null; go("source"); return;
      case "tx-history": go("history"); return;
      case "tx-settings": go("settings"); return;
      case "tx-why": haptic("light"); go("why"); return;
      case "tx-open": openStored(t.getAttribute("data-id")); return;
      case "tx-source": {
        haptic("light");
        var src = t.getAttribute("data-source") || "library";
        if (needsConsent()) { state.consentPending = src; show("source"); return; }
        startCapture(src);
        return;
      }
      case "tx-consent-accept": {
        try { if (window.SMD_THOREX_FLAGS) window.SMD_THOREX_FLAGS.set("smd_thorex_cloud", true); } catch (e) {}
        var acceptedSrc = state.consentPending; state.consentPending = null;
        if (acceptedSrc) startCapture(acceptedSrc); else show("source");
        return;
      }
      case "tx-consent-decline": {
        try { if (window.SMD_THOREX_FLAGS) window.SMD_THOREX_FLAGS.set("smd_thorex_cloud", false); } catch (e) {}
        state.consentPending = null;
        toast("Upload cancelled.");
        show("source");
        return;
      }
      case "tx-cam-allow": haptic("light"); startCapture("camera"); return;
      case "tx-cam-deny": show("source"); return;
      case "tx-qual-continue": haptic("light"); finishPipeline(state.analysis); return;
      case "tx-qual-retake": state.analysis = null; show("source"); return;
      case "tx-retry": show("source"); return;
      case "tx-save": toast("Case saved."); return;
      case "tx-export": haptic("light"); exportReport(); return;
      case "tx-share": haptic("light"); exportReport(); return;
      case "tx-toggle-confidence": toggleConfidence(); return;
      case "tx-toggle-haptics": toggleHaptics(); return;
      case "tx-clear-cxrs": clearCxrs(); return;
    }
    /* other data-act values are screen-internal — screens handle them locally. */
  }
  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    if (t.tagName === "BUTTON") return;  // native <button> already handles Enter/Space
    e.preventDefault(); onClick({ target: t });
  }
  function init() {
    var r = document.getElementById("thorexRoot");
    if (r && !r._txWired) { r._txWired = true; r.addEventListener("click", onClick); r.addEventListener("keydown", onKeydown); }
    wireSignout();
  }

  // Sign-out wipe hook (privacy contract): wipe the encrypted store on StewardMD sign-out.
  function wipe() { try { var P = providers(); if (P && P.cxrStore && P.cxrStore.deleteAll) P.cxrStore.deleteAll(); } catch (e) {} }
  var _signoutWired = false;
  function wireSignout() {
    if (_signoutWired || typeof window === "undefined") return; _signoutWired = true;
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) { try { window.addEventListener(ev, wipe); } catch (e) {} });
    window.SMD_THOREX_WIPE = wipe;
  }

  if (typeof window !== "undefined") {
    window.SMD_THOREX_ROUTER = { mountLanding: mountLanding, nav: go, runPipeline: runPipeline, wipe: wipe };
  }

  // ── Dual export of the PURE helpers (node-testable without a DOM; see test/thorex-screens-helpers.test.js).
  // In the browser these are also attached as SMD_THOREX_SCREENS_HELPERS for debugging/dev-overlay use;
  // the router itself (above) stays browser-only, exactly like kardiox-screens.js.
  var HELPERS = {
    buildPanelModels: buildPanelModels,
    buildFindingModel: buildFindingModel,
    sevInfo: sevInfo,
    bandToPct: bandToPct,
    worstSeverity: worstSeverity,
    summarizeAnalysis: summarizeAnalysis,
    hasRenderableAnalysis: hasRenderableAnalysis,
    MANDATORY_DISCLAIMER: MANDATORY_DISCLAIMER,
    SCREENS: SCREENS
  };
  if (typeof window !== "undefined") window.SMD_THOREX_SCREENS_HELPERS = HELPERS;
  if (typeof module !== "undefined" && module.exports) module.exports = HELPERS;
})();
