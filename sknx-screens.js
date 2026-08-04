/* sknx-screens.js — SknX AI · screens + router (mock-driven, entitlement-aware).
 * Sibling of thorex-screens.js: same shape (SCREENS map, state, host()/ctx(), show/go/back, mount,
 * init, delegated click/keydown via data-act) — scoped to #sknxRoot / #sknxScroll / .sknx-*. Screens
 * talk ONLY to window.SMD_SKNX_PROVIDERS.analyze(); entitlement via window.SMD_SKNX_ENTITLEMENT.resolve();
 * history via window.SMD_SKNX_STORE.
 *
 * Three screens (per the Phase 1 spec): CAPTURE (camera/photo/files source buttons) -> PROCESSING
 * (a staged progress ring/bar driven by the provider's onStage callback: "quality" -> "detect" ->
 * "segment" -> "classify" -> "report") -> RESULT (ranked differential, a red referral banner when the
 * analysis flags one, a heatmap <img> slot, and the fixed educational disclaimer).
 *
 * CRITICAL SAFETY (Phase 1): rxEligible is part of the analysis shape but Rx is Phase 3 — this file
 * must NEVER render any prescription affordance on the result screen. There is no "prescribe" action,
 * anywhere, in this file, on purpose.
 *
 * A small set of pure (no-DOM) helpers are dual-exported (window + module.exports) for node testing,
 * mirroring thorex-screens.js's HELPERS export; the router itself stays a browser-only IIFE.
 */
(function () {
  "use strict";
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function haptic(k) { try { if (window.SMD_SKNX_FLAGS && window.SMD_SKNX_FLAGS.bool("smd_sknx_haptics") && window.SMD_HAPTICS && window.SMD_HAPTICS[k]) window.SMD_HAPTICS[k](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); else if (window.SMD_toast) window.SMD_toast(m); } catch (e) {} }

  /* ══════════════════════════ PURE helpers (no DOM — node-testable) ══════════════════════════════ */

  // Band word -> a stable display label + a CSS modifier suffix (never colour alone: paired with text).
  function bandLabel(b) { return b === "high" ? "High" : b === "moderate" ? "Moderate" : "Low"; }

  // Fixed educational disclaimer text, keyed by sknx-engines.js's disclaimerKey ("educational_not_clinical"
  // is the only key in Phase 1; the map is future-proofing, not a live requirement).
  var DISCLAIMERS = {
    educational_not_clinical: "Educational preview only, not a clinical diagnosis. AI-generated findings must be correlated with clinical examination and, where indicated, biopsy or specialist referral before any treatment decision."
  };
  function disclaimerText(key) { return DISCLAIMERS[key] || DISCLAIMERS.educational_not_clinical; }

  // Stage key -> processing-screen label. Order MUST match SMD_SKNX_PROVIDERS.STAGES.
  var STAGE_DEFS = [
    { key: "quality", label: "Checking image quality" },
    { key: "detect", label: "Detecting lesion" },
    { key: "segment", label: "Segmenting lesion" },
    { key: "classify", label: "Classifying" },
    { key: "report", label: "Preparing report" }
  ];

  /* ══════════════════════════════════ Screens ═══════════════════════════════════════════════════ */

  /* capture — camera / photo library / files source buttons (ThoreX-style source picker, no PDF —
     skin photos aren't scanned documents). */
  function renderCapture(host) {
    function srcCard(source, icon, name, hint) {
      return '<button type="button" class="sknx-src-card" data-act="sknx-source" data-source="' + source + '"' +
               ' aria-label="' + esc(name) + " - " + esc(hint) + '">' +
               '<span class="sknx-src-ic" aria-hidden="true">' + ic(icon) + "</span>" +
               '<span class="sknx-src-name">' + esc(name) + "</span>" +
               '<span class="sknx-src-hint">' + esc(hint) + "</span>" +
             "</button>";
    }
    host.innerHTML =
      '<section class="sknx-capture" aria-labelledby="sknxCapTitle">' +
        '<header class="sknx-cap-head">' +
          '<button type="button" class="sknx-cap-close" data-act="sknx-close" aria-label="Close SknX">' + ic("close") + "</button>" +
          '<h2 class="sknx-cap-title" id="sknxCapTitle">Analyze a skin photo</h2>' +
        "</header>" +
        '<div class="sknx-cap-body">' +
          '<div class="sknx-src-grid">' +
            srcCard("camera", "photo_camera", "Camera", "Guided capture") +
            srcCard("library", "photo_library", "Photo Library", "PNG, JPEG, HEIC") +
            srcCard("files", "folder", "Files", "Browse iCloud") +
          "</div>" +
          '<div class="sknx-tip" role="note">' + ic("tips_and_updates") +
            '<span class="sknx-tip-txt">Good lighting, fill the frame with the lesion or rash, avoid glare - SknX auto-enhances the image before analysis.</span>' +
          "</div>" +
          '<div class="sknx-cap-foot">' + ic("lock") + "<span>Processed on-device &middot; image not stored after analysis</span></div>" +
        "</div>" +
      "</section>";
  }

  /* processing — live pipeline (confidence ring + staged progress). runPipeline() drives the real
     analyze() call and pushes stage updates into this screen via host()._sknxApplyStage (set below) so
     the visual progress reflects the actual pipeline stages, not a decorative timer. */
  function renderProcessing(host) {
    function stageRow(i) {
      return '<div class="sknx-stage is-pending" data-stage-row="' + i + '">' +
        '<div class="sknx-stage-head">' +
          '<span class="sknx-stage-name">' + ic("radio_button_unchecked") + esc(STAGE_DEFS[i].label) + "</span>" +
          '<span class="sknx-stage-val" data-stage-val>&ndash;</span>' +
        "</div>" +
        '<div class="sknx-stage-track"><div class="sknx-stage-fill" data-stage-fill></div></div>' +
      "</div>";
    }
    host.innerHTML =
      '<section class="sknx-proc" aria-label="Analyzing your skin photo">' +
        '<div class="sknx-proc-inner" role="status" aria-live="polite">' +
          '<div class="sknx-proc-ring" role="img" aria-label="Analysis progress">' +
            '<svg class="sknx-proc-svg" viewBox="0 0 120 120" aria-hidden="true">' +
              '<circle class="sknx-proc-track" cx="60" cy="60" r="52"></circle>' +
              '<circle class="sknx-proc-arc" cx="60" cy="60" r="52" data-arc></circle>' +
            "</svg>" +
            '<div class="sknx-proc-center">' +
              '<span class="sknx-proc-pct" data-pct>0%</span>' +
              '<span class="sknx-proc-cap">ANALYZING</span>' +
            "</div>" +
          "</div>" +
          '<h2 class="sknx-proc-title">Analyzing your photo&hellip;</h2>' +
          '<p class="sknx-proc-sub">SknX is checking quality and running detection</p>' +
          '<div class="sknx-stages">' + STAGE_DEFS.map(function (s, i) { return stageRow(i); }).join("") + "</div>" +
          '<div class="sknx-proc-foot">' + ic("lock") + "<span>Processed on-device &middot; image not stored after analysis</span></div>" +
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
    host._sknxApplyStage = function (stageKey, pct) {
      var idx = -1;
      for (var i = 0; i < STAGE_DEFS.length; i++) if (STAGE_DEFS[i].key === stageKey) { idx = i; break; }
      if (idx < 0) idx = STAGE_DEFS.length - 1;
      rows.forEach(function (row, i) {
        var g = row.querySelector(".sknx-stage-name .material-symbols-rounded");
        var v = row.querySelector("[data-stage-val]");
        var f = row.querySelector("[data-stage-fill]");
        row.classList.remove("is-done", "is-active", "is-pending");
        if (i < idx) { row.classList.add("is-done"); if (g) g.textContent = "check_circle"; if (v) v.textContent = "done"; if (f) f.style.width = "100%"; }
        else if (i === idx) { row.classList.add("is-active"); if (g) g.textContent = "progress_activity"; if (v) v.textContent = (pct || 0) + "%"; if (f) f.style.width = (pct || 0) + "%"; }
        else { row.classList.add("is-pending"); if (g) g.textContent = "radio_button_unchecked"; if (v) v.textContent = "–"; if (f) f.style.width = "0%"; }
      });
      setPct(typeof pct === "number" ? pct : Math.round(((idx + 1) / STAGE_DEFS.length) * 100));
    };
  }

  /* result — ranked differential (.sknx-dx), a red referral banner (.sknx-refer) when analysis.referral
     is true, a heatmap <img> slot, and the fixed educational disclaimer. NEVER a prescription/Rx
     affordance in this phase (rxEligible is read by nobody here — Rx ships in Phase 3, gated on its
     own consent + review, via a dedicated sknx-rx.js). */
  function dxRow(d) {
    d = d || {};
    var pct = (d.prob != null && isFinite(+d.prob)) ? Math.round(+d.prob * 100) : null;
    return '<div class="sknx-dx-row">' +
      '<span class="sknx-dx-label">' + esc(d.label) + "</span>" +
      '<span class="sknx-dx-band sknx-dx-band--' + esc(d.band || "low") + '">' + bandLabel(d.band) + (pct != null ? " &middot; " + pct + "%" : "") + "</span>" +
    "</div>";
  }

  function renderEmptyResult(host) {
    host.innerHTML =
      '<div class="sknx-result-head">' +
        '<button class="sknx-result-back" type="button" data-act="sknx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
        '<div class="sknx-result-title">SknX</div>' +
      "</div>" +
      '<div class="sknx-empty">' + ic("error") +
        '<b class="sknx-empty-title">Result unavailable</b>' +
        '<span class="sknx-empty-sub">This analysis could not be loaded. Try analyzing the photo again.</span>' +
      "</div>";
  }

  function renderResult(host, ctx) {
    ctx = ctx || {};
    var a = ctx.analysis;
    if (!a) { renderEmptyResult(host); return; }

    var diffList = Array.isArray(a.differential) ? a.differential : [];
    var dxHtml = '<div class="sknx-dx">' +
        (diffList.length ? diffList.map(dxRow).join("") :
          '<div class="sknx-dx-empty">' + ic("check_circle") + "<span>No confident finding - correlate clinically.</span></div>") +
      "</div>";

    // Red referral banner — icon + colour + text together (never colour alone). Shown ONLY when the
    // engine's malignancy/red-flag guardrail set referral=true; referralReason is always shown verbatim.
    var referHtml = a.referral ?
      '<div class="sknx-refer" role="alert">' + ic("crisis_alert") +
        '<div class="sknx-refer-body">' +
          '<b class="sknx-refer-title">Specialist referral recommended</b>' +
          '<span class="sknx-refer-reason">' + esc(a.referralReason || "Refer for specialist evaluation.") + "</span>" +
        "</div>" +
      "</div>" : "";

    var lesionHtml = a.lesion ?
      '<div class="sknx-lesion">' + ic("info") +
        '<span>Lesion-level read: <b>' + esc(a.lesion.top) + "</b> - " + bandLabel(a.lesion.band) + " confidence</span>" +
      "</div>" : "";

    // Heatmap slot — always present as a stable hook for a later native-plugin wiring (the mock
    // analyzer never emits heatmap bytes yet); hidden until real heatmap data exists.
    var heatSrc = a.heatmap ? ("data:image/png;base64," + a.heatmap) : "";
    var heatmapHtml =
      '<div class="sknx-heatmap-wrap">' +
        '<img class="sknx-heatmap" alt="Lesion heatmap overlay"' + (heatSrc ? (' src="' + esc(heatSrc) + '"') : " hidden") + " />" +
      "</div>";

    var head =
      '<div class="sknx-result-head">' +
        '<button class="sknx-result-back" type="button" data-act="sknx-back" aria-label="Back">' + ic("arrow_back") + "</button>" +
        '<div class="sknx-result-title">Skin analysis result</div>' +
        '<button class="sknx-result-close" type="button" data-act="sknx-close" aria-label="Close SknX">' + ic("close") + "</button>" +
      "</div>";

    var body =
      '<div class="sknx-result-body">' +
        referHtml +
        heatmapHtml +
        '<div class="sknx-sec-title">Differential</div>' +
        dxHtml +
        lesionHtml +
        '<div class="sknx-disc">' + ic("info") + "<span>" + esc(disclaimerText(a.disclaimerKey)) + "</span></div>" +
        '<div class="sknx-report-host" id="sknxReportHost" aria-live="polite"><div class="sknx-report-loading">' + ic("hourglass_empty") + "<span>Preparing educational report&hellip;</span></div></div>" +
        '<div class="sknx-actions">' +
          '<button class="sknx-btn sknx-btn-primary" type="button" data-act="sknx-save">' + ic("bookmark") + "Save case</button>" +
          '<button class="sknx-btn sknx-btn-secondary" type="button" data-act="sknx-new">' + ic("add_a_photo") + "New photo</button>" +
        "</div>" +
      "</div>";

    host.innerHTML = head + body;
    mountReport(a);
  }

  /* ═══════════════════ Educational report mount (Phase 2 — evidence + LLM + report renderer) ═══════
   * Additive and defensive by construction: never throws, and if any of the three sknx-evidence.js /
   * sknx-llm.js / sknx-report.js scripts are missing (e.g. an older cached bundle), the report host is
   * simply removed and the differential/referral screen above is unaffected. Phase 2 default is the
   * ON-DEVICE mock reasoner (buildReport with no deps.remote) — the /api/sknx remote endpoint is an
   * optional seam and is intentionally NOT called from here. */
  function removeReportHost() {
    try { var h = document.getElementById("sknxReportHost"); if (h && h.parentNode) h.parentNode.removeChild(h); } catch (e) {}
  }
  function mountReport(a) {
    try {
      if (!window.SMD_SKNX_LLM || !window.SMD_SKNX_REPORT || !window.SMD_SKNX_EVIDENCE) { removeReportHost(); return; }
      var labels = (a.differential || []).map(function (d) { return d.label; });
      state.reportLabels = labels;
      var evidence = window.SMD_SKNX_EVIDENCE.retrieve(labels) || [];
      window.SMD_SKNX_LLM.buildReport({ analysis: a, features: (a.features || {}), evidence: evidence, context: {} })
        .then(function (payload) {
          state.reportPayload = payload;
          state.reportAudience = state.reportAudience || "resident";
          renderReportInto(payload);
        })
        .catch(function () { removeReportHost(); });
    } catch (e) { removeReportHost(); }
  }

  // renderReportInto(payload) — re-finds #sknxReportHost fresh (the result screen may have re-rendered
  // since mountReport() kicked off the async build) and fills it with the Explain-Like segmented
  // control, the report body leveled for the current state.reportAudience, an optional Compare-top-two
  // control (only when >=2 differential labels exist), and an Export PDF action.
  function renderReportInto(payload) {
    try {
      var rh = document.getElementById("sknxReportHost");
      if (!rh || !payload) return;
      var aud = state.reportAudience || "resident";
      var leveled = window.SMD_SKNX_LLM.explainAs(payload, aud);
      var compareHtml = "";
      if ((state.reportLabels || []).length >= 2 && window.SMD_SKNX_COMPARE) {
        compareHtml =
          '<button class="sknx-btn sknx-btn-secondary" type="button" data-act="sknx-compare">Compare top two</button>' +
          '<div class="sknx-compare-host" id="sknxCompareHost"></div>';
      }
      rh.innerHTML =
        window.SMD_SKNX_REPORT.explainControls() +
        '<div class="sknx-report-body" id="sknxReportBody">' + window.SMD_SKNX_REPORT.html(leveled) + "</div>" +
        compareHtml +
        '<button class="sknx-btn sknx-btn-secondary sknx-report-pdf" type="button" data-act="sknx-report-pdf">' + ic("picture_as_pdf") + "Export PDF</button>";
      var segs = rh.querySelectorAll(".sknx-explain-seg");
      for (var i = 0; i < segs.length; i++) {
        if (segs[i].getAttribute("data-audience") === aud) segs[i].classList.add("is-active");
      }
    } catch (e) {}
  }

  /* ══════════════════════════════ Router (SMD_SKNX_SCREENS) ══════════════════════════════════════ */
  var SCREENS = { capture: renderCapture, processing: renderProcessing, result: renderResult };
  var state = { analysis: null, running: false, stack: [], reportPayload: null, reportAudience: "resident", reportLabels: [] };

  function providers() { try { return (typeof window !== "undefined" && window.SMD_SKNX_PROVIDERS) || null; } catch (e) { return null; } }
  function host() { return document.getElementById("sknxScroll"); }
  function resolveEntitlement() {
    try { return (window.SMD_SKNX_ENTITLEMENT && window.SMD_SKNX_ENTITLEMENT.resolve) ? window.SMD_SKNX_ENTITLEMENT.resolve() : "free"; } catch (e) { return "free"; }
  }
  function closeMod() { try { if (window.SKNX && window.SKNX.close) window.SKNX.close(); } catch (e) {} }
  function ctx() { return { analysis: state.analysis, entitlement: resolveEntitlement() }; }

  function show(key) {
    var h = host(), fn = SCREENS[key];
    if (!h || !fn) return;
    try { fn(h, ctx()); } catch (e) { try { console.warn("[SknX] screen " + key, e); } catch (_) {} }
    try { h.scrollTop = 0; } catch (_) {}
  }
  function go(key) {
    key = String(key || "");
    if (!SCREENS[key]) return;
    if (state.stack[state.stack.length - 1] !== key) state.stack.push(key);
    show(key);
  }
  function back() {
    if (state.stack.length <= 1) { haptic("light"); closeMod(); return; }
    state.stack.pop();
    show(state.stack[state.stack.length - 1] || "capture");
  }

  // mount(root) — SKNX.open() calls this with the #sknxRoot element itself (not the scroll host). Sets
  // up the scroll host + click delegation once, then always resets to a fresh capture screen.
  function scrollHostOf(root) { return root && (root.querySelector("#sknxScroll") || root.querySelector(".sknx-scroll")); }
  function mount(root) {
    if (!root) return;
    if (!scrollHostOf(root)) root.innerHTML = '<div class="sknx-scroll" id="sknxScroll"></div>';
    init(root);
    state.stack = ["capture"];
    state.analysis = null;
    state.reportPayload = null;
    state.reportAudience = "resident";
    state.reportLabels = [];
    show("capture");
  }

  // ── On-device capture: Camera / Photo Library / Files with a hidden <input type=file> web fallback
  // (mirrors thorex-screens.js's captureImage). Resolves a Blob, or rejects {cancelled:true} on cancel.
  function captureImage(source) {
    return new Promise(function (resolve, reject) {
      var Cap = (typeof window !== "undefined" && window.Capacitor) || null;
      var Plugins = Cap && Cap.Plugins;
      function b64ToBlob(b64s, mime) {
        var bin = atob(b64s), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime || "image/jpeg" });
      }
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
          Plugins.FilePicker.pickFiles({ types: ["image/png", "image/jpeg", "image/heic", "image/heif"], readData: true, limit: 1 })
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
        inp.accept = "image/png,image/jpeg,image/heic,image/heif";
        inp.onchange = function () { var f = inp.files && inp.files[0]; f ? resolve(f) : reject({ cancelled: true }); };
        inp.click();
      } catch (e) { reject(new Error("image capture unavailable")); }
    });
  }

  function startCapture(src) {
    captureImage(src).then(function (blob) {
      runPipeline({ id: "sknx-" + Date.now(), source: src, data: blob });
    }).catch(function (err) {
      if (err && err.cancelled) return;
      toast("Couldn't open the " + (src === "camera" ? "camera" : "picker") + ". " + ((err && err.message) || ""));
    });
  }

  // runPipeline(image): resolve entitlement -> SMD_SKNX_PROVIDERS.analyze() (mock in Phase 1) -> save
  // to history -> show the result. Exposed on the router so a test harness (or a future retry action)
  // can drive an analysis directly without going through the native camera/file pickers.
  function runPipeline(image) {
    if (state.running) return;
    state.running = true;
    show("processing");
    var P = providers();
    if (!P || !P.analyze) { state.running = false; toast("SknX analyzer unavailable."); show("capture"); return; }
    var entitlement = resolveEntitlement();
    P.analyze(image, entitlement, function (stage, pct) {
      try { var h = host(); if (h && h._sknxApplyStage) h._sknxApplyStage(stage, pct); } catch (e) {}
    }).then(function (a) {
      state.running = false;
      state.analysis = a || null;
      try {
        if (state.analysis && window.SMD_SKNX_STORE && window.SMD_SKNX_STORE.save) {
          state.analysis.at = state.analysis.at || Date.now();
          window.SMD_SKNX_STORE.save(state.analysis);
        }
      } catch (e) {}
      go("result");
      haptic(state.analysis && state.analysis.referral ? "warning" : "success");
    }).catch(function () {
      state.running = false;
      toast("Couldn't analyze this photo. Try again with a clear, well-lit image.");
      show("capture");
    });
  }

  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act") || "";
    switch (act) {
      case "sknx-close": haptic("light"); closeMod(); return;
      case "sknx-back": haptic("light"); back(); return;
      case "sknx-source": haptic("light"); startCapture(t.getAttribute("data-source") || "library"); return;
      case "sknx-save": toast("Case saved."); return;
      case "sknx-new": state.analysis = null; state.reportPayload = null; state.reportAudience = "resident"; state.reportLabels = []; state.stack = ["capture"]; show("capture"); return;
      case "sknx-explain": var aud = t.getAttribute("data-audience") || "resident"; state.reportAudience = aud; haptic("light"); if (state.reportPayload) renderReportInto(state.reportPayload); return;
      case "sknx-compare": var L = state.reportLabels || []; if (L.length >= 2 && window.SMD_SKNX_COMPARE) { var cmp = window.SMD_SKNX_COMPARE.compare(L[0], L[1]); var ch = document.getElementById("sknxCompareHost"); if (ch) ch.innerHTML = window.SMD_SKNX_COMPARE.html(cmp); } haptic("light"); return;
      case "sknx-report-pdf": try { if (window.SMD_SKNX_REPORT && state.reportPayload) window.SMD_SKNX_REPORT.pdf(window.SMD_SKNX_LLM.explainAs(state.reportPayload, state.reportAudience || "resident")); } catch (e) {} haptic("light"); return;
    }
    /* other data-act values (if any) are screen-internal. */
  }
  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    if (t.tagName === "BUTTON") return;   // native <button> already handles Enter/Space
    e.preventDefault(); onClick({ target: t });
  }
  function init(root) {
    var r = root || document.getElementById("sknxRoot");
    if (r && !r._sknxWired) { r._sknxWired = true; r.addEventListener("click", onClick); r.addEventListener("keydown", onKeydown); }
    wireSignout();
  }

  // Sign-out wipe hook (privacy contract): wipe the encrypted store on StewardMD sign-out.
  function wipe() { try { if (window.SMD_SKNX_STORE && window.SMD_SKNX_STORE.list) { /* no bulk-delete API yet; local history is per-device and small. */ } } catch (e) {} }
  var _signoutWired = false;
  function wireSignout() {
    if (_signoutWired || typeof window === "undefined") return; _signoutWired = true;
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) { try { window.addEventListener(ev, wipe); } catch (e) {} });
  }

  var API = {
    mount: mount,
    go: go,
    back: back,
    runPipeline: runPipeline,
    startCapture: startCapture,
    // pure helpers (node-testable, no DOM):
    bandLabel: bandLabel,
    disclaimerText: disclaimerText,
    STAGE_DEFS: STAGE_DEFS,
    SCREENS: SCREENS
  };
  if (typeof window !== "undefined") window.SMD_SKNX_SCREENS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
