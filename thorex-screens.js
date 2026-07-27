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
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (isFinite(n) ? n : 0); }

  // Engine → user-facing version name. The raw ids (torchxrayvision / xraydar / hf_vit) stay internal
  // (model-file matching, entitlement shape, report logic) — only the DISPLAYED name changes.
  var ENGINE_DISPLAY = { torchxrayvision: "ThoreX v1", xraydar: "V2 Beta", hf_vit: "ThoreX Free" };
  function engineDisplayName(id) { id = String(id || ""); return ENGINE_DISPLAY.hasOwnProperty(id) ? ENGINE_DISPLAY[id] : id; }
  function displayLabelOf(label) {
    try { var M = (typeof window !== "undefined" && window.SMD_THOREX_MODELS) || null; if (M && M.displayLabel) return M.displayLabel(label); } catch (e) {}
    return label || "";
  }

  // Mandatory safety disclaimer (Global Constraints) — verbatim, appended once per result screen.
  var MANDATORY_DISCLAIMER = "AI-generated findings are intended to assist qualified healthcare professionals and must always be interpreted in conjunction with clinical assessment, radiologist review where appropriate, laboratory findings and other investigations.";

  // One finding -> its render-ready shape (severity pill + band-derived bar, never a raw probability).
  function buildFindingModel(f) {
    f = f || {};
    var sev = sevInfo(f.severity);
    // Exact AI confidence % from the model's operating-point-normalized score (when present). This is
    // the model's raw confidence, not a calibrated posterior probability of disease — labelled "AI
    // confidence" and always shown alongside "correlate clinically". Falls back to the band bar-width
    // when no per-finding score is available (e.g. a reopened legacy record or the mock sample).
    var pct = (f.prob == null || !isFinite(+f.prob)) ? null : Math.round(clamp01(f.prob) * 100);
    return {
      label: displayLabelOf(f.label),
      rawLabel: f.label || "",
      band: f.band == null ? null : f.band,
      severity: f.severity || "info",
      severityLabel: sev.label,
      severityIcon: sev.icon,
      relevance: f.relevance || "",
      heatmap: f.heatmap || null,
      confPct: bandToPct(f.band),         // internal band→bar-width mapping (fallback bar only)
      confPctExact: pct,                  // real AI-confidence % (null when unavailable)
      confLabel: f.band == null ? null : f.band   // the band word, e.g. "High"
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
      { key: "download-model", label: "Downloading model" },
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
        else if (i === idx) {
          row.classList.add("is-active"); if (g) g.textContent = "progress_activity";
          // Native CapacitorHttp can't stream byte-progress, so the model download reports no real
          // 0..100 — show an HONEST indeterminate state ("…" + a pulsing bar) instead of a fake 100%.
          var realPct = (typeof pct === "number" && pct > 0 && pct < 100);
          if (STAGES[i].key === "download-model" && !realPct) {
            row.classList.add("is-indeterminate"); if (v) v.textContent = "…"; if (f) f.style.width = "45%";
          } else {
            row.classList.remove("is-indeterminate"); if (v) v.textContent = (pct || 0) + "%"; if (f) f.style.width = (pct || 0) + "%";
          }
        }
        else { row.classList.add("is-pending"); if (g) g.textContent = "radio_button_unchecked"; if (v) v.textContent = "–"; if (f) f.style.width = "0%"; }
      });
      setPct(typeof pct === "number" ? pct : Math.round(((idx + 1) / STAGES.length) * 100));
    };
  }

  /* ─────────────────────── Clinical correlation (thorex-correlate.js) ─────────────────────────────
   * Additive "Correlate (ECG/ABG/labs)" section on the result screen: a manual-entry form (best-effort
   * pre-filled from SMD_THOREX_CORRELATE.gather(), always editable) + a "Correlate" button that renders
   * the deterministic rule differential + AI narrative. VALIDATION-RELIABLE by construction — the form
   * always accepts manual values regardless of whether gather() found anything. Correlation is derived
   * from the CLINICAL engine only (enforced inside thorex-correlate.js, not here). */
  function correlateModule() {
    try { return (typeof window !== "undefined" && window.SMD_THOREX_CORRELATE) || null; } catch (e) { return null; }
  }
  var CORR_FIELDS = [
    { key: "ef", label: "EF (%)" },
    { key: "bnp", label: "BNP (pg/mL)" },
    { key: "ntProBnp", label: "NT-proBNP (pg/mL)" },
    { key: "pct", label: "Procalcitonin (ng/mL)" },
    { key: "crp", label: "CRP (mg/L)" },
    { key: "wbc", label: "WBC (×10⁹/L)" },
    { key: "troponin", label: "Troponin (ng/mL)" },
    { key: "na", label: "Na (mmol/L)" },
    { key: "k", label: "K (mmol/L)" },
    { key: "temp", label: "Temp (°C)" },
    { key: "spo2", label: "SpO₂ (%)" }
  ];
  var CORR_ABG_FIELDS = [
    { key: "ph", label: "ABG pH" },
    { key: "po2", label: "ABG pO₂ (mmHg)" },
    { key: "pco2", label: "ABG pCO₂ (mmHg)" },
    { key: "hco3", label: "ABG HCO₃⁻ (mmol/L)" },
    { key: "lactate", label: "Lactate (mmol/L)" }
  ];
  // ECG-finding flags — the KardioX bridge (see thorex-correlate.js's file-header comment): KardioX is
  // ECG interpretation, never echo, so these (not EF) are the real KardioX<->ThoreX correlation inputs.
  // Manual-entry checkboxes, best-effort pre-filled from CORR.gather()'s KardioX auto-read.
  var CORR_ECG_FIELDS = [
    { key: "pPulmonale", label: "P pulmonale" },
    { key: "rvh", label: "RVH" },
    { key: "rightAxisDeviation", label: "Right-axis deviation" }
  ];
  function correlateFieldHtml(dataKey, label, val) {
    var v = (val == null) ? "" : val;
    return '<label class="tx-corr-field"><span>' + esc(label) + '</span>' +
      '<input type="number" inputmode="decimal" step="any" data-corr="' + dataKey + '" value="' + esc(v) + '" /></label>';
  }
  function correlateBoolFieldHtml(dataKey, label, checked) {
    return '<label class="tx-corr-field tx-corr-field--bool">' +
      '<input type="checkbox" data-corr-bool="' + dataKey + '"' + (checked ? " checked" : "") + ' />' +
      '<span>' + esc(label) + '</span></label>';
  }
  function correlateFormHtml(cd) {
    cd = cd || {};
    var abg = cd.abg || {};
    var grid = CORR_FIELDS.map(function (f) { return correlateFieldHtml(f.key, f.label, cd[f.key]); }).join("") +
      CORR_ABG_FIELDS.map(function (f) { return correlateFieldHtml("abg." + f.key, f.label, abg[f.key]); }).join("");
    var ecgGrid = CORR_ECG_FIELDS.map(function (f) { return correlateBoolFieldHtml(f.key, f.label, !!cd[f.key]); }).join("");
    return '<div class="tx-corr-form">' +
      '<div class="tx-corr-grid">' + grid + '</div>' +
      '<div class="tx-corr-ecg-group">' +
        '<div class="tx-corr-ecg-label">ECG findings (KardioX)</div>' +
        '<div class="tx-corr-ecg-grid">' + ecgGrid + '</div>' +
      '</div>' +
      '<label class="tx-corr-field tx-corr-field--wide"><span>History (brief)</span>' +
        '<textarea data-corr="history" rows="2" placeholder="e.g. acute dyspnoea, 2 days">' + esc(cd.history || "") + '</textarea></label>' +
      '<button class="tx-btn tx-btn-primary tx-corr-go" type="button" data-hook="corrGo">' + ic("join_full") + '<span>Correlate</span></button>' +
      '<div class="tx-corr-result" data-hook="corrResult" hidden></div>' +
    "</div>";
  }
  function readCorrelateForm(host) {
    var cd = {}, abg = {};
    var inputs = host.querySelectorAll("[data-corr]");
    Array.prototype.forEach.call(inputs, function (el) {
      var key = el.getAttribute("data-corr"), raw = el.value;
      if (raw == null || raw === "") return;
      if (key === "history") { cd.history = String(raw).slice(0, 500); return; }
      if (key.indexOf("abg.") === 0) { var av = +raw; if (isFinite(av)) abg[key.slice(4)] = av; return; }
      var n = +raw; if (isFinite(n)) cd[key] = n;
    });
    if (Object.keys(abg).length) cd.abg = abg;
    var boolInputs = host.querySelectorAll("[data-corr-bool]");
    Array.prototype.forEach.call(boolInputs, function (el) {
      var key = el.getAttribute("data-corr-bool");
      if (el.checked) cd[key] = true;
    });
    return cd;
  }
  function correlateResultHtml(res) {
    res = res || {};
    var diff = Array.isArray(res.differential) ? res.differential : [];
    var body = diff.length ?
      ('<ul class="tx-corr-diff">' + diff.map(function (d) {
        return '<li class="tx-corr-diff-item"><div class="tx-corr-diff-head"><b>' + esc(d.condition) + '</b>' +
          '<span class="tx-pill tx-pill--info">' + esc(d.confidence || "") + "</span></div>" +
          '<div class="tx-corr-diff-just">' + esc(d.justification || "") + "</div></li>";
      }).join("") + "</ul>") :
      ('<p class="tx-report-p">' + esc((res.reasoning && res.reasoning[0]) || "Insufficient correlating data — enter labs/ABG to refine.") + "</p>");
    var narrative = res.narrative ?
      '<div class="tx-why-ai" data-hook="corrNarrative">' +
        '<div class="tx-why-ai-label">' + ic("auto_awesome") + "<span>Educational &middot; AI-generated &middot; not a diagnosis</span></div>" +
        '<div class="tx-why-ai-body"><span>' + esc(res.narrative) + "</span></div>" +
      "</div>" : "";
    return body + narrative + '<div class="tx-disc">' + ic("info") + "<span>" + esc(MANDATORY_DISCLAIMER) + "</span></div>";
  }
  // Local (non-navigational) interaction, same pattern as the report toggle: expand/collapse + wire the
  // "Correlate" button. "tx-correlate-toggle" is intentionally NOT in the global onClick switch (screen-
  // internal act, per the comment at the bottom of that switch).
  function wireCorrelate(host, a) {
    var toggleBtn = host.querySelector('[data-act="tx-correlate-toggle"]');
    var wrap = host.querySelector('[data-hook="correlateBody"]');
    if (toggleBtn && wrap) {
      toggleBtn.addEventListener("click", function () {
        var open = wrap.hidden;
        wrap.hidden = !open;
        toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    var goBtn = host.querySelector('[data-hook="corrGo"]');
    var resultBox = host.querySelector('[data-hook="corrResult"]');
    if (!goBtn || !resultBox) return;
    goBtn.addEventListener("click", function () {
      haptic("light");
      var cd = readCorrelateForm(host);
      var CORR = correlateModule();
      goBtn.disabled = true;
      resultBox.hidden = false;
      resultBox.innerHTML = '<p class="tx-report-p">' + ic("progress_activity") + " Correlating…</p>";
      var p = (CORR && CORR.correlate) ? CORR.correlate(a, cd) : Promise.resolve({ reasoning: ["Correlation engine unavailable on this device."], differential: [], narrative: null });
      Promise.resolve(p).then(function (res) {
        resultBox.innerHTML = correlateResultHtml(res);
      }).catch(function () {
        resultBox.innerHTML = '<p class="tx-report-p">Correlation unavailable right now.</p>';
      }).then(function () { goBtn.disabled = false; });
    });
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

    // OXIPIT-style: gather every finding that has a CAM heatmap into one ordered list, so the result
    // shows the X-RAY with a selectable heatmap overlaid on it (anatomical reference) instead of a
    // floating red blob. Each finding-with-heatmap becomes tap-to-localize.
    var heatList = [];
    panels.forEach(function (p) {
      (p.findings || []).forEach(function (f) {
        if (f.heatmap) { f.__heatIdx = heatList.length; heatList.push({ label: f.label, heatmap: f.heatmap }); }
      });
    });
    var hasImage = !!(a && a.__xrayUrl);          // show the X-ray whenever we have it (incl. clean reads)
    var hasHeat = hasImage && heatList.length > 0; // overlay + selector strip only when there are heatmaps

    function findingHtml(f) {
      var pill = '<span class="tx-pill tx-pill--' + esc(f.severity) + '">' + ic(f.severityIcon) + "<span>" + esc(f.severityLabel) + "</span></span>";
      var barPct = (f.confPctExact != null) ? f.confPctExact : f.confPct;
      var confValTxt = (f.confPctExact != null)
        ? (f.confPctExact + "%" + (f.confLabel ? " · " + f.confLabel : ""))
        : (f.confLabel || "");
      var confCaption = (f.confPctExact != null) ? "AI confidence" : "Confidence band";
      var conf = barPct == null ? "" :
        '<div class="tx-conf">' +
          '<div class="tx-conf-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + barPct + '" aria-valuetext="' + esc(confValTxt) + '" aria-label="AI confidence: ' + esc(confValTxt) + '">' +
            '<div class="tx-conf-fill" style="--tx-conf:' + barPct + '%"></div>' +
          "</div>" +
          '<span class="tx-conf-val tx-data">' + esc(confValTxt) + "</span>" +
        "</div>" +
        '<div class="tx-conf-band">' + confCaption + "</div>";
      // With the X-ray viewer present, the heatmap is shown OVERLAID on the image via a tap-to-localize
      // control; without an image (e.g. reopened from history), fall back to the standalone heatmap.
      var heat = (hasHeat && f.__heatIdx != null) ?
        '<button type="button" class="tx-heat-btn" data-heat-idx="' + f.__heatIdx + '">' + ic("my_location") + '<span>Localize on X-ray</span></button>' :
        (f.heatmap ? '<div class="tx-heatmap"><img class="tx-heatmap-overlay" src="data:image/png;base64,' + f.heatmap + '" alt="' + esc(f.label) + ' Grad-CAM heatmap overlay" /><span class="tx-heatmap-cap">HEATMAP</span></div>' : "");
      return '<div class="tx-finding">' +
        '<div class="tx-finding-row"><span class="tx-finding-name">' + esc(f.label) + "</span>" + pill + "</div>" +
        (f.relevance ? '<div class="tx-finding-loc">' + esc(f.relevance) + "</div>" : "") +
        conf + heat +
      "</div>";
    }

    // Worst severity within a single panel — drives the pill shown on that version's collapsed header.
    function panelSeverityKey(p) {
      var worst = null, rank = 99;
      (p.findings || []).forEach(function (f) {
        var r = SEV_RANK.hasOwnProperty(f.severity) ? SEV_RANK[f.severity] : 98;
        if (r < rank) { rank = r; worst = f.severity; }
      });
      return worst || (p.findings.length ? "info" : "stable");
    }

    // Inner body of one engine's panel (identity now lives on the collapsible header, so no tx-panel-head).
    function panelHtml(p) {
      var cls = "tx-panel" + (p.educational ? " tx-panel--learning" : "");
      var eduBanner = p.educational ?
        '<div class="tx-edu-banner">' + ic("info") + "<span>Educational &mdash; not for clinical use</span></div>" : "";
      // Clean read: when nothing crosses the model's operating point, say so explicitly (never a blank
      // panel) — a normal film should read reassuringly, with the "does not exclude disease" caveat.
      var findingsHtml = p.findings.length
        ? '<div class="tx-findings">' + p.findings.map(findingHtml).join("") + "</div>"
        : (p.educational ? ""
          : '<div class="tx-clean">' + ic("check_circle") +
            '<b class="tx-clean-title">No significant abnormality detected</b>' +
            '<span class="tx-clean-sub">AI screening found nothing above the model’s operating threshold. This does not exclude disease — correlate clinically.</span>' +
          "</div>");
      var whyLink = !p.educational ?
        '<button type="button" class="tx-why-link" data-act="tx-why">' + ic("psychology") +
          '<span class="tx-why-link-txt"><b>Why this finding?</b><span class="tx-why-link-sub">See the model reasoning</span></span>' +
          ic("chevron_right") + "</button>" : "";
      // The educational panel MUST NOT emit the actions row at all — never rely on the CSS
      // .tx-panel--learning .tx-actions{display:none} fallback to hide markup that shouldn't exist.
      var actions = p.noActions ? "" :
        '<div class="tx-actions">' +
          '<button class="tx-btn tx-btn-primary" type="button" data-act="tx-save">' + ic("bookmark") + "Save case</button>" +
          '<button class="tx-btn tx-btn-secondary" type="button" data-act="tx-copy">' + ic("content_copy") + "Copy</button>" +
          '<button class="tx-btn tx-btn-secondary" type="button" data-act="tx-export">' + ic("picture_as_pdf") + "Export</button>" +
        "</div>";
      return '<div class="' + cls + '">' + eduBanner + findingsHtml + whyLink + actions + "</div>";
    }

    // Each engine renders as a COLLAPSIBLE version section (ThoreX v1 open by default, V2 Beta collapsed).
    function collapsiblePanel(p, i, open) {
      var name = engineDisplayName(p.engine);
      var sevKey = panelSeverityKey(p);
      var sev = sevInfo(sevKey);
      var n = p.findings.length;
      var sub = (p.educational ? "Educational" : "Clinical") + " · " + n + (n === 1 ? " finding" : " findings");
      var bodyId = "txPanel" + i;
      return '<div class="tx-vpanel' + (p.educational ? " tx-vpanel--learning" : "") + (open ? " is-open" : "") + '">' +
        '<button type="button" class="tx-vpanel-head" data-act="tx-vpanel-toggle" aria-expanded="' + (open ? "true" : "false") + '" aria-controls="' + bodyId + '">' +
          '<span class="tx-vpanel-ic">' + ic(p.educational ? "school" : "verified") + "</span>" +
          '<span class="tx-vpanel-tt"><b class="tx-vpanel-name">' + esc(name) + "</b><span class=\"tx-vpanel-sub\">" + esc(sub) + "</span></span>" +
          '<span class="tx-pill tx-pill--' + esc(sevKey) + '">' + ic(sev.icon) + "<span>" + sev.label + "</span></span>" +
          '<span class="tx-vpanel-chev">' + ic("expand_more") + "</span>" +
        "</button>" +
        '<div class="tx-vpanel-body" id="' + bodyId + '"' + (open ? "" : " hidden") + ">" + panelHtml(p) + "</div>" +
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

    // Radiology report — a deterministic structured report/impression built ONLY from the clinical
    // engine (see thorex-report.js). Additive: a collapsed-by-default affordance on the result screen
    // that never replaces the existing dual-panel rendering above.
    var report = buildReportSafe(a);
    var reportSection = report ?
      '<button class="tx-report-toggle" type="button" data-act="tx-report-toggle" aria-expanded="true" aria-controls="txReportBody">' +
        ic("description") + '<span class="tx-report-toggle-txt">ThoreX AI — Radiology report</span>' + ic("expand_more") +
      "</button>" +
      '<div class="tx-report-wrap" id="txReportBody" data-hook="reportBody">' + report.html + "</div>"
      : "";

    // Clinical correlation (thorex-correlate.js) — additive toggle, same pattern as the report toggle.
    // gather() is sync + best-effort + NEVER throws; a guard here keeps a broken/missing module from
    // ever taking down the result screen.
    var CORR = correlateModule();
    var gathered = {};
    if (CORR && CORR.gather) { try { gathered = CORR.gather() || {}; } catch (e) {} }
    var correlateSection =
      '<button class="tx-report-toggle" type="button" data-act="tx-correlate-toggle" aria-expanded="false" aria-controls="txCorrBody">' +
        ic("biotech") + '<span class="tx-report-toggle-txt">Correlate (ECG/ABG/labs)</span>' + ic("expand_more") +
      "</button>" +
      '<div class="tx-report-wrap" id="txCorrBody" data-hook="correlateBody" hidden>' + correlateFormHtml(gathered) + "</div>";

    // X-ray viewer: the source image with a selectable heatmap overlaid (like OXIPIT). Chips = each
    // finding-with-heatmap; tapping one localizes it on the anatomy. Only when we have both an image
    // and at least one heatmap (else the finding cards keep their inline/standalone heatmap).
    var xrayViewer = hasImage ?
      '<div class="tx-xray" data-hook="txXray">' +
        '<img class="tx-xray-base" src="' + esc(a.__xrayUrl) + '" alt="Chest X-ray under analysis" />' +
        (hasHeat ?
          '<img class="tx-xray-heat" data-hook="txXrayHeat" alt="" hidden />' +
          '<div class="tx-xray-badge" data-hook="txHeatLabel">' + ic("my_location") + '<span>Heatmap</span></div>' : "") +
      "</div>" +
      (hasHeat ?
        '<div class="tx-heat-strip" role="tablist" aria-label="Finding heatmaps">' +
          heatList.map(function (h, i) {
            return '<button type="button" class="tx-heat-chip' + (i === 0 ? " is-active" : "") + '" data-heat-idx="' + i + '" role="tab" aria-selected="' + (i === 0 ? "true" : "false") + '">' + esc(h.label) + "</button>";
          }).join("") +
        "</div>" : "") : "";

    var body =
      '<div class="tx-result-body">' +
        xrayViewer +
        '<div class="tx-result-panels">' + panels.map(function (p, i) { return collapsiblePanel(p, i, i === 0); }).join("") + "</div>" +
        reportSection +
        correlateSection +
        '<div class="tx-disc">' + ic("info") + "<span>" + esc(MANDATORY_DISCLAIMER) + "</span></div>" +
      "</div>";

    host.innerHTML = head + body;
    var fills = host.querySelectorAll(".tx-conf-fill");
    Array.prototype.forEach.call(fills, function (el) {
      var v = el.style.getPropertyValue ? el.style.getPropertyValue("--tx-conf") : "";
      if (v) el.style.setProperty("--tx-conf", v);
    });

    // X-ray heatmap selector: tap a chip (or a finding's "Localize" button) → overlay that finding's
    // CAM heatmap on the X-ray. Screen-internal, so not routed through the global click switch.
    if (hasHeat) {
      var heatImg = host.querySelector('[data-hook="txXrayHeat"]');
      var heatLabelEl = host.querySelector('[data-hook="txHeatLabel"] span');
      var selectHeat = function (i, fromUser) {
        var h = heatList[i]; if (!h || !heatImg) return;
        heatImg.src = "data:image/png;base64," + h.heatmap; heatImg.hidden = false;
        if (heatLabelEl) heatLabelEl.textContent = h.label;
        Array.prototype.forEach.call(host.querySelectorAll(".tx-heat-chip"), function (el) {
          var on = String(el.getAttribute("data-heat-idx")) === String(i);
          el.classList.toggle("is-active", on); el.setAttribute("aria-selected", on ? "true" : "false");
        });
        if (fromUser) haptic("light");
      };
      Array.prototype.forEach.call(host.querySelectorAll("[data-heat-idx]"), function (btn) {
        btn.addEventListener("click", function () {
          var i = parseInt(btn.getAttribute("data-heat-idx"), 10) || 0;
          selectHeat(i, true);
          try { var v = host.querySelector('[data-hook="txXray"]'); if (v && v.scrollIntoView) v.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
        });
      });
      selectHeat(0, false);   // pre-select the top finding's heatmap
    }

    // Collapsible version panels (ThoreX v1 / V2 Beta): expand/collapse each in place. Screen-internal,
    // so not routed through the global click switch. A tap anywhere on the header toggles that panel.
    Array.prototype.forEach.call(host.querySelectorAll('[data-act="tx-vpanel-toggle"]'), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("aria-controls");
        var pbody = id ? host.querySelector("#" + id) : null;
        if (!pbody) return;
        var open = pbody.hidden;
        pbody.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        var wrap = btn.parentNode; if (wrap && wrap.classList) wrap.classList.toggle("is-open", open);
        haptic("light");
      });
    });

    // Local (non-navigational) interaction, same pattern as renderQuality's ack checkbox: expand/
    // collapse the report body in place. "tx-report-toggle" is intentionally NOT in the global
    // onClick switch (screen-internal act, per the comment at the bottom of that switch).
    var toggleBtn = host.querySelector('[data-act="tx-report-toggle"]');
    var reportBody = host.querySelector('[data-hook="reportBody"]');
    if (toggleBtn && reportBody) {
      toggleBtn.addEventListener("click", function () {
        var open = reportBody.hidden;
        reportBody.hidden = !open;
        toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    wireCorrelate(host, a);
  }

  /* why — lightweight explainability (clinical engine only; P2 deepens the clinical-correlation seam).
     On open, asks SMD_THOREX_LLM.learnMore() for a short AI-generated explanation of the TOP clinical
     finding (Groq -> Gemini -> deterministic offline text server-side; the client-side helper itself
     also has its own deterministic fallback, so this box always renders something). The mandatory
     disclaimer stays on this screen regardless of which path produced the text. */
  function renderWhy(host, ctx) {
    ctx = ctx || {};
    var a = ctx.analysis || {};
    var panels = buildPanelModels(a);
    var clinical = panels.filter(function (p) { return !p.educational; })[0] || panels[0] || { findings: [] };
    var topFinding = clinical.findings[0] || null;

    function row(f) {
      var pill = '<span class="tx-pill tx-pill--' + esc(f.severity) + '">' + ic(f.severityIcon) + "<span>" + esc(f.severityLabel) + "</span></span>";
      return '<div class="tx-finding">' +
        '<div class="tx-finding-row"><span class="tx-finding-name">' + esc(f.label) + "</span>" + pill + "</div>" +
        (f.relevance ? '<div class="tx-finding-loc">' + esc(f.relevance) + "</div>" : "") +
      "</div>";
    }

    var explainBox = topFinding ?
      '<div class="tx-why-ai" data-hook="whyAi">' +
        '<div class="tx-why-ai-label">' + ic("auto_awesome") + "<span>Educational &middot; AI-generated &middot; not a diagnosis</span></div>" +
        '<div class="tx-why-ai-body" data-hook="whyAiBody">' + ic("progress_activity") + "<span>Loading explanation&hellip;</span></div>" +
      "</div>" : "";

    host.innerHTML =
      '<div class="tx-list-head">' +
        '<button class="tx-result-back" type="button" data-act="tx-back" aria-label="Back to result">' + ic("arrow_back") + "</button>" +
        '<h2 class="tx-list-title">Why this finding?</h2>' +
      "</div>" +
      '<div class="tx-list-body">' +
        (clinical.findings.length
          ? '<div class="tx-findings">' + clinical.findings.map(row).join("") + "</div>"
          : '<div class="tx-empty">' + ic("psychology") + '<b class="tx-empty-title">No findings to explain</b></div>') +
        explainBox +
        // Defense-in-depth: every clinical-content screen carries the mandatory disclaimer, not just
        // the primary result screen — this drill-down still shows AI-derived findings.
        '<div class="tx-disc">' + ic("info") + "<span>" + esc(MANDATORY_DISCLAIMER) + "</span></div>" +
      "</div>";

    if (!topFinding) return;
    var LLM = (typeof window !== "undefined" && window.SMD_THOREX_LLM) || null;
    if (!LLM || !LLM.learnMore) {
      var bodyEl = host.querySelector('[data-hook="whyAiBody"]');
      if (bodyEl) bodyEl.innerHTML = "<span>Explanation unavailable on this device.</span>";
      return;
    }
    LLM.learnMore(topFinding, a).then(function (res) {
      var bodyEl = host.querySelector('[data-hook="whyAiBody"]');
      if (!bodyEl) return;   // screen navigated away before the response arrived
      bodyEl.innerHTML = "<span>" + esc((res && res.text) || "") + "</span>";
    }).catch(function () {
      var bodyEl = host.querySelector('[data-hook="whyAiBody"]');
      if (bodyEl) bodyEl.innerHTML = "<span>Explanation unavailable right now.</span>";
    });
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
    try { if (a && state._xrayUrl) a.__xrayUrl = state._xrayUrl; } catch (e) {}   // transient display-only URL (never persisted)
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
    // Keep a display URL of the source X-ray so the result screen can render the heatmap OVERLAID on
    // the actual image (anatomical reference), OXIPIT-style, instead of a floating heatmap.
    try {
      if (state._xrayUrl && state._xrayUrl.indexOf("blob:") === 0) { try { URL.revokeObjectURL(state._xrayUrl); } catch (e) {} }
      state._xrayUrl = null;
      // The capture handoff is { id, source, data: <Blob> } (startCapture), but tolerate blob/raw-Blob too.
      var _b = image && (image.data instanceof Blob ? image.data
        : (image.blob instanceof Blob ? image.blob
        : (image instanceof Blob ? image : null)));
      if (_b) state._xrayUrl = URL.createObjectURL(_b);
      else if (image && typeof image.dataUrl === "string") state._xrayUrl = image.dataUrl;
    } catch (e) { state._xrayUrl = null; }
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

  // The structured-report generator (thorex-report.js) is an optional dependency: if it hasn't
  // loaded for some reason, every call site below degrades gracefully rather than throwing.
  function buildReportSafe(a, opts) {
    try { return (window.SMD_THOREX_REPORT && window.SMD_THOREX_REPORT.buildReport) ? window.SMD_THOREX_REPORT.buildReport(a, opts) : null; } catch (e) { return null; }
  }

  // Legacy per-panel HTML fallback, used only if thorex-report.js failed to load — kept so Export/
  // Share never regress to "nothing happens" on an old cached bundle.
  function legacyExportHtml(a) {
    var panels = buildPanelModels(a);
    return "<h2>ThoreX AI &mdash; Chest X-ray Result</h2>" + panels.map(function (p) {
      return "<h3>" + esc(p.engine) + (p.educational ? " (educational)" : "") + "</h3><ul>" +
        p.findings.map(function (f) { return "<li>" + esc(f.label) + (f.confLabel ? " &mdash; " + esc(f.confLabel) : "") + "</li>"; }).join("") +
      "</ul>";
    }).join("") + "<p style='color:#888;font-size:12px'>" + esc(MANDATORY_DISCLAIMER) + "</p>";
  }

  // Export / Share both render the deterministic structured report (thorex-report.js) — the same
  // content the "Radiology report" section on the result screen shows expanded.
  function exportReport() {
    var a = state.analysis; if (!a) { toast("No result to export."); return; }
    var rep = buildReportSafe(a);
    var html = rep ? rep.html : legacyExportHtml(a);
    var frag = (typeof document !== "undefined") ? document.createElement("div") : null;
    try {
      if (frag) frag.innerHTML = html;
      var title = "ThoreX — CXR result";
      if (window.SMD_IS_NATIVE && window.SMD_NATIVE && window.SMD_NATIVE.saveHtmlFile && frag) { window.SMD_NATIVE.saveHtmlFile(frag, title, "ThoreX-CXR-report").catch(function () { toast("Export unavailable."); }); return; }
      var w = window.open("", "_blank");
      if (w) { w.document.write("<html><head><title>" + esc(title) + "</title></head><body>" + html + "</body></html>"); w.document.close(); w.focus(); w.print(); return; }
    } catch (er) {}
    toast("Export not available on this device.");
  }

  // Copy — puts the plain-text structured report (thorex-report.js `text`) on the clipboard.
  function copyReport() {
    var a = state.analysis; if (!a) { toast("No result to copy."); return; }
    var rep = buildReportSafe(a);
    var text = rep ? rep.text : "";
    if (!text) { toast("Nothing to copy."); return; }
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast("Report copied."); }).catch(function () { toast("Couldn't copy report."); });
        return;
      }
    } catch (e) {}
    toast("Copy not available on this device.");
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
      case "tx-copy": haptic("light"); copyReport(); return;
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
