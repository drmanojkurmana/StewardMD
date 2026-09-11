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
  function mark() { return '<img class="sknx-brand-logo" src="/sknx-logo-full.png?v=sx1" alt="SknX AI Dermatology Intelligence" style="height:34px;width:auto;max-width:240px;object-fit:contain;display:block;">'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function haptic(k) { try { if (window.SMD_SKNX_FLAGS && window.SMD_SKNX_FLAGS.bool("smd_sknx_haptics") && window.SMD_HAPTICS && window.SMD_HAPTICS[k]) window.SMD_HAPTICS[k](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); else if (window.SMD_toast) window.SMD_toast(m); } catch (e) {} }

  /* ══════════════════════════ PURE helpers (no DOM — node-testable) ══════════════════════════════ */

  // Band word -> a stable display label + a CSS modifier suffix (never colour alone: paired with text).
  function bandLabel(b) { return b === "high" ? "High" : b === "moderate" ? "Moderate" : "Low"; }

  // Fixed educational disclaimer text, keyed by sknx-engines.js's disclaimerKey ("educational_not_clinical"
  // is the only key in Phase 1; the map is future-proofing, not a live requirement).
  var DISCLAIMERS = {
    educational_not_clinical: "Educational preview only, not a clinical diagnosis. This tool does not detect melanoma: evaluate any pigmented, new, or changing lesion clinically. AI-generated findings must be correlated with clinical examination and, where indicated, biopsy or specialist referral before any treatment decision."
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
          '<div style="flex:1;display:flex;align-items:center;min-width:0;">' + mark() + '<h2 class="sr-only" id="sknxCapTitle">SknX AI Dermatology Intelligence</h2></div>' +
        "</header>" +
        '<div class="sknx-cap-body">' +
          '<div class="sknx-intro"><span class="sknx-eyebrow">DERMATOLOGY</span><h3>A clearer view<br>of skin.</h3><p>Bring the photo and clinical story together for a more informed review.</p></div>' +
          '<ol class="sknx-journey" aria-label="Analysis steps"><li aria-current="step"><b>1</b> Add photo</li><li><b>2</b> Review</li><li><b>3</b> Explore findings</li></ol>' +
          '<div class="sknx-section-heading"><h3>Start a skin review</h3><span>Photo · Context · Findings</span></div>' +
          '<div class="sknx-src-grid">' +
            srcCard("camera", "photo_camera", "Take a photo", "Open the camera") +
            srcCard("library", "photo_library", "Photo Library", "Choose an existing image") +
            srcCard("files", "folder", "Browse Files", "PNG, JPEG or HEIC") +
          "</div>" +
          '<div class="sknx-photo-guide"><h3>Before you begin</h3><div><span>' + ic("light_mode") + '<b>Even lighting</b>Use diffuse light and avoid flash glare.</span><span>' + ic("center_focus_strong") + '<b>Clear detail</b>Keep the area in focus and fill the frame.</span><span>' + ic("crop_free") + '<b>Clinical context</b>Include a little surrounding skin.</span></div></div>' +
          '<p class="sknx-cap-foot">' + ic("visibility") + '<span>You can review your photo before analysis.</span></p>' +
        "</div>" +
      "</section>";
  }

  function renderReview(host) {
    host.innerHTML = '<header class="sknx-cap-head"><button type="button" class="sknx-cap-close" data-act="sknx-new" aria-label="Back to photo sources">' + ic("arrow_back") + '</button><h2 class="sknx-cap-title">Review your photo</h2><button type="button" class="sknx-cap-close" data-act="sknx-close" aria-label="Close SknX">' + ic("close") + '</button></header>' +
      '<div class="sknx-cap-body sknx-review"><ol class="sknx-journey" aria-label="Analysis steps"><li><b>✓</b> Add photo</li><li aria-current="step"><b>2</b> Add context</li><li><b>3</b> Review findings</li></ol>' +
      '<figure class="sknx-preview"><img src="' + esc(state.previewUrl || "") + '" alt="Selected skin photo for review"><figcaption>Check focus, lighting, and the area of interest.</figcaption></figure>' +
      '<button type="button" class="sknx-btn sknx-btn-secondary" data-act="sknx-source" data-source="library">' + ic("photo_library") + 'Replace photo</button>' + hxFormHtml("capture") +
      (state.error ? '<div class="sknx-error" role="alert">' + ic("error") + '<span>' + esc(state.error) + '</span></div>' : '') +
      '<div class="sknx-review-footer"><button type="button" class="sknx-btn sknx-btn-primary" data-act="sknx-analyze">' + ic("auto_awesome") + 'Analyze photo' + ic("arrow_forward") + '</button><p>Educational decision support for clinician review.</p></div></div>';
    var preview = host.querySelector(".sknx-preview img");
    if (preview) preview.onerror = function () { preview.hidden = true; host.querySelector(".sknx-preview figcaption").textContent = "Preview unavailable for this format. Choose a JPEG or PNG if you need to inspect the photo here."; };
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
              '<span class="sknx-proc-cap">SKNX</span>' +
            "</div>" +
          "</div>" +
          '<h2 class="sknx-proc-title">Analyzing your photo&hellip;</h2>' +
          '<p class="sknx-proc-sub">SknX is checking quality and running detection</p>' +
          '<div class="sknx-stages">' + STAGE_DEFS.map(function (s, i) { return stageRow(i); }).join("") + "</div>" +
          '<div class="sknx-proc-note">' + ic("schedule") + "<span>The first scan after opening can take up to a minute while the analyzer starts up. Later scans are quick.</span></div>" +
          '<div class="sknx-proc-foot">' + ic("lock") + "<span>Image not stored after analysis</span></div>" +
          '<button type="button" class="sknx-btn sknx-btn-secondary" data-act="sknx-cancel">Back to review</button>' +
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
  function dxRow(d, index) {
    d = d || {};
    var pct = (d.prob != null && isFinite(+d.prob)) ? Math.round(+d.prob * 100) : null;
    return '<div class="sknx-dx-row">' +
      '<span class="sknx-dx-rank">' + (index + 1) + '</span>' +
      '<span class="sknx-dx-label">' + esc(d.label) + "</span>" +
      '<span class="sknx-dx-band sknx-dx-band--' + esc(d.band || "low") + '">' + bandLabel(d.band) + ' confidence' + (pct != null ? " &middot; " + pct + "%" : "") + "</span>" +
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

    // A specific FINDING (referral > OOD > severe-reaction) is a RESULT - kept visible but ONE concise
    // line, not a full-width alert. A malignancy/red-flag referral outranks the others. The generic
    // experimental/educational caveat is NOT here - it is the concise footer below (owner: results first,
    // warnings small at the foot; no model names in the copy).
    var findingHtml = "";
    if (a.referral) {
      findingHtml = '<div class="sknx-finding sknx-finding-refer" role="alert">' + ic("crisis_alert") +
        "<span>" + esc(a.referralReason || "Refer for specialist evaluation.") + "</span></div>";
    } else if (a.ood) {
      findingHtml = '<div class="sknx-finding sknx-finding-ood" role="alert">' + ic("help") +
        "<span>" + esc(a.oodReason || "No confident reading. Re-take the photo or assess clinically.") + "</span></div>";
    } else if (a.caution) {
      findingHtml = '<div class="sknx-finding sknx-finding-caution" role="alert">' + ic("warning") +
        "<span>" + esc(a.caution) + "</span></div>";
    }

    // Concise footer caveat - ONE muted line. NO model names/sizes/architecture in the copy.
    var footerHtml = '<div class="sknx-footer">' + ic("info") +
      "<span>Experimental, educational only - not a diagnosis. Does not exclude skin cancer; correlate clinically.</span></div>";

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
        mark() + '<div class="sknx-result-title">Skin review<span class="sknx-brand-sub">Skn X findings &amp; evidence</span></div>' +
        '<button class="sknx-result-close" type="button" data-act="sknx-close" aria-label="Close SknX">' + ic("close") + "</button>" +
      "</div>";

    // RESULTS FIRST (owner directive): the differential leads; the concise finding line follows; generic
    // caveats live in the small footer at the very bottom.
    var body =
      '<div class="sknx-result-body">' +
        '<div class="sknx-section-heading"><h2>Possible conditions</h2><span>Image findings</span></div>' +
        dxHtml +
        '<div class="sknx-rerank-host" id="sknxRerankHost" aria-live="polite"></div>' +
        findingHtml +
        lesionHtml +
        heatmapHtml +
        '<nav class="sknx-result-nav" aria-label="Result sections"><button type="button" class="sknx-btn sknx-btn-secondary" data-act="sknx-jump" data-target="sknxReportHost">' + ic("article") + 'Clinical report</button><button type="button" class="sknx-btn sknx-btn-secondary" data-act="sknx-jump" data-target="sknxRefine">' + ic("clinical_notes") + 'Edit context</button></nav>' +
        '<div class="sknx-report-host" id="sknxReportHost" aria-live="polite"><div class="sknx-report-loading">' + ic("hourglass_empty") + "<span>Preparing educational report&hellip;</span></div></div>" +
        '<div class="sknx-actions">' +
          '<button class="sknx-btn sknx-btn-primary" type="button" data-act="sknx-save">' + ic(state.saved ? "bookmark_added" : "bookmark") + (state.saved ? "Case saved" : "Save case") + '</button><span class="sknx-save-status" role="status"></span>' +
          '<button class="sknx-btn sknx-btn-secondary" type="button" data-act="sknx-new">' + ic("add_a_photo") + "New photo</button>" +
        "</div>" +
        rxAffordance(a) +
        hxFormHtml("refine") +
        footerHtml +
      "</div>";

    host.innerHTML = head + body;
    mountReport(a);
    mountRerank(a);
  }

  // mountRerank(a): if the case carries clinical history, ask the LLM to reorder the differential and
  // write a rationale (Phase 2), then render a "History-adjusted" section under the image differential.
  // Display-only + best-effort: it NEVER changes referral/rxEligible, and a no-LLM/offline result hides
  // the section (no false "adjusted" claim).
  function mountRerank(a) {
    try {
      var el = document.getElementById("sknxRerankHost");
      if (!el) return;
      var LLM = window.SMD_SKNX_LLM, hist = a && a.history;
      var hasHist = hist && typeof hist === "object" && Object.keys(hist).length > 0;
      if (!hasHist || !LLM || !LLM.rerank || !(a.differential && a.differential.length)) { el.innerHTML = ""; return; }
      el.innerHTML = '<div class="sknx-rerank-loading">' + ic("neurology") + "<span>Re-checking with the history&hellip;</span></div>";
      Promise.resolve(LLM.rerank(a.differential, hist)).then(function (res) {
        if (!res || res.provider === "offline" || !(res.differential && res.differential.length)) { el.innerHTML = ""; return; }
        var rows = res.differential.slice(0, 6).map(function (d, i) {
          return '<div class="sknx-dx-row"><span class="sknx-dx-rank">' + (i + 1) + '</span><span class="sknx-dx-label">' + esc(d.label) + "</span></div>";
        }).join("");
        el.innerHTML =
          '<div class="sknx-sec-title">History-adjusted</div>' +
          '<div class="sknx-dx sknx-dx-adjusted">' + rows + "</div>" +
          (res.rationale ? '<div class="sknx-rationale">' + ic("neurology") + "<span>" + esc(res.rationale) + "</span></div>" : "") +
          (res.advisory ? '<div class="sknx-rationale sknx-rationale-adv">' + ic("info") + "<span>" + esc(res.advisory) + "</span></div>" : "");
      }).catch(function () { el.innerHTML = ""; });
    } catch (e) {}
  }

  /* Phase 3 clinician-confirmed Rx affordance. GUARDED by SMD_SKNX_RX.eligible(a): it renders the ONLY
   * `.sknx-rx` element in SknX, and ONLY when the analysis is rxEligible + not-referral, the smd_sknx_rx
   * flag is on, AND the user is a verified prescriber. A malignant/referral case (rxEligible false) can
   * never reach it. Clicking opens the existing SMD_RX pad pre-filled with a class-level draft that the
   * clinician confirms, doses, and signs - SknX never prescribes autonomously. */
  function rxAffordance(a) {
    try {
      if (!window.SMD_SKNX_RX || !window.SMD_SKNX_RX.eligible(a)) return "";
      return '<div class="sknx-rx-wrap">' +
        '<button class="sknx-rx sknx-btn sknx-btn-secondary" type="button" data-act="sknx-rx-draft">' + ic("edit_note") + "Draft prescription</button>" +
        '<p class="sknx-rx-note">Draft only. You confirm, edit, and sign every prescription. Not patient facing.</p>' +
      "</div>";
    } catch (e) { return ""; }
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
    var revision = state.revision;
    try {
      if (!window.SMD_SKNX_LLM || !window.SMD_SKNX_REPORT || !window.SMD_SKNX_EVIDENCE) { removeReportHost(); return; }
      var labels = (a.differential || []).map(function (d) { return d.label; });
      state.reportLabels = labels;
      // Malignancy-driven referrals surface via the lesion engine (a.lesion), while the differential may
      // lead with a benign general-classifier label. Add the lesion read to the evidence query so the
      // report carries the relevant guideline citation (e.g. AAD melanoma). reportLabels (used by the
      // Compare-top-two control) stays the differential labels only.
      var evLabels = labels.slice();
      if (a.lesion && a.lesion.top) evLabels.push(a.lesion.top);
      var evidence = window.SMD_SKNX_EVIDENCE.retrieve(evLabels) || [];
      window.SMD_SKNX_LLM.buildReport({ analysis: a, features: (a.features || {}), evidence: evidence, context: {} })
        .then(function (payload) {
          if (revision !== state.revision || state.analysis !== a) return;
          state.reportPayload = payload;
          state.reportAudience = state.reportAudience || "resident";
          renderReportInto(payload);
        })
        .catch(function () { if (revision === state.revision) { var h = document.getElementById("sknxReportHost"); if (h) h.innerHTML = '<div class="sknx-error" role="status">Report unavailable. Your image findings are still available above.</div>'; } });
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
      var compareHtml = "";
      if ((state.reportLabels || []).length >= 2 && window.SMD_SKNX_COMPARE) {
        compareHtml =
          '<button class="sknx-btn sknx-btn-secondary" type="button" data-act="sknx-compare">Compare top two</button>' +
          '<div class="sknx-compare-host" id="sknxCompareHost"></div>';
      }
      rh.innerHTML =
        '<div class="sknx-report-body" id="sknxReportBody">' + window.SMD_SKNX_REPORT.html(payload) + "</div>" +
        compareHtml +
        '<button class="sknx-btn sknx-btn-secondary sknx-report-pdf" type="button" data-act="sknx-report-pdf">' + ic("picture_as_pdf") + "Export PDF</button>";
    } catch (e) {}
  }

  /* ══════════════════════════════ Router (SMD_SKNX_SCREENS) ══════════════════════════════════════ */
  var SCREENS = { capture: renderCapture, review: renderReview, processing: renderProcessing, result: renderResult };
  var state = { analysis: null, running: false, stack: [], reportPayload: null, reportAudience: "resident", reportLabels: [], revision: 0, saved: false };
  function resetCase() {
    state.revision++; state.running = false;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null; state.lastImage = null; state.lastHistory = null; state.error = null;
    state.analysis = null; state.reportPayload = null; state.reportLabels = []; state.saved = false;
  }

  function providers() { try { return (typeof window !== "undefined" && window.SMD_SKNX_PROVIDERS) || null; } catch (e) { return null; } }
  function host() { return document.getElementById("sknxScroll"); }
  function resolveEntitlement() {
    try { return (window.SMD_SKNX_ENTITLEMENT && window.SMD_SKNX_ENTITLEMENT.resolve) ? window.SMD_SKNX_ENTITLEMENT.resolve() : "free"; } catch (e) { return "free"; }
  }
  function closeMod() { try { if (window.SKNX && window.SKNX.close) window.SKNX.close(); } catch (e) {} }
  function ctx() { return { analysis: state.analysis, entitlement: resolveEntitlement() }; }

  // Optional clinical-history intake (sknx-history.js). All helpers are no-ops if the module is absent.
  function hx() { try { return (typeof window !== "undefined" && window.SMD_SKNX_HISTORY) || null; } catch (e) { return null; } }
  function hxFormHtml(kind) {
    var H = hx(); if (!H) return "";
    var label = kind === "refine" ? "Refine with clinical history" : "Add clinical history (optional)";
    var apply = kind === "refine" ? '<button class="sknx-btn sknx-btn-secondary sknx-hx-apply" type="button" data-act="sknx-refine-apply">' + ic("check") + "Apply history</button>" : "";
    return '<details class="sknx-hx-wrap"' + (kind === "refine" ? ' id="sknxRefine"' : ' open') + '><summary>' + ic("clinical_notes") + esc(label) + '</summary><p class="sknx-hx-help">Add symptoms and changes to put the image in context. Leave unknown fields unselected.</p>' + H.formHtml() + apply + "</details>";
  }
  function readHx() { try { var H = hx(); var r = host() && host().querySelector(".sknx-hx"); return (H && r) ? H.readForm(r) : null; } catch (e) { return null; } }
  function bindHx(h) { try { var H = hx(); var r = h && h.querySelector && h.querySelector(".sknx-hx"); if (H && r) H.bindForm(r); } catch (e) {} }

  function show(key) {
    var h = host(), fn = SCREENS[key];
    if (!h || !fn) return;
    try { fn(h, ctx()); } catch (e) { try { console.warn("[SknX] screen " + key, e); } catch (_) {} }
    try { bindHx(h); } catch (e) {}
    try { var H = hx(); if (H && H.fillForm) H.fillForm(h.querySelector(".sknx-hx"), state.lastHistory); } catch (e) {}
    h._sknxScreen = key;
    try { var heading = h.querySelector("h2, .sknx-result-title"); if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); } } catch (e) {}
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
    resetCase();
    if (!scrollHostOf(root)) root.innerHTML = '<div class="sknx-scroll" id="sknxScroll"></div>';
    init(root);
    state.stack = ["capture"];
    state.analysis = null;
    state.reportPayload = null;
    state.reportAudience = "resident";
    state.reportLabels = [];
    show("capture");
    // Preload the on-device classifier NOW (download model + build the inference session) while the
    // clinician frames the photo, so the analyze after capture is ~50ms inference, not a ~10s cold load.
    try { var P = providers(); if (P && P.warmup) P.warmup(); } catch (e) {}
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
        if (source === "camera") inp.setAttribute("capture", "environment");
        inp.oncancel = function () { reject({ cancelled: true }); };
        inp.onchange = function () { var f = inp.files && inp.files[0]; f ? resolve(f) : reject({ cancelled: true }); };
        inp.click();
      } catch (e) { reject(new Error("image capture unavailable")); }
    });
  }

  function startCapture(src) {
    var revision = state.revision;
    var history = readHx();   // read the capture-screen history form (if any) before the picker opens
    captureImage(src).then(function (blob) {
      if (revision !== state.revision) return;
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(blob);
      state.lastImage = { id: "sknx-" + Date.now(), source: src, data: blob };
      state.lastHistory = history; state.error = null;
      go("review");
    }).catch(function (err) {
      if (err && err.cancelled) return;
      toast("Couldn't open the " + (src === "camera" ? "camera" : "picker") + ". " + ((err && err.message) || ""));
    });
  }

  // runPipeline(image): resolve entitlement -> SMD_SKNX_PROVIDERS.analyze() (mock in Phase 1) -> save
  // to history -> show the result. Exposed on the router so a test harness (or a future retry action)
  // can drive an analysis directly without going through the native camera/file pickers.
  function runPipeline(image, history) {
    if (state.running) return;
    state.running = true;
    var revision = ++state.revision;
    state.error = null; state.saved = false; state.reportPayload = null;
    state.lastImage = image;                          // persist so "Refine with history" can re-run
    state.lastHistory = typeof history !== "undefined" ? history : null;
    show("processing");
    var P = providers();
    if (!P || !P.analyze) { state.running = false; state.error = "The analyzer is unavailable. Please reopen SknX and try again."; if (state.previewUrl) show("review"); else { toast(state.error); show("capture"); } return; }
    var entitlement = resolveEntitlement();
    Promise.resolve().then(function () { return P.analyze(image, entitlement, function (stage, pct) {
      if (revision !== state.revision) return;
      try { var h = host(); if (h && h._sknxApplyStage) h._sknxApplyStage(stage, pct); } catch (e) {}
    }, undefined, state.lastHistory); }).then(function (a) {
      if (revision !== state.revision) return;
      state.running = false;
      state.analysis = a || null;
      try { if (state.analysis) state.analysis.history = state.lastHistory || null; } catch (e) {}
      try {
        if (state.analysis && window.SMD_SKNX_STORE && window.SMD_SKNX_STORE.save) {
          state.analysis.at = state.analysis.at || Date.now();
          state.saved = !!window.SMD_SKNX_STORE.save(state.analysis);
        }
      } catch (e) {}
      go("result");
      haptic(state.analysis && state.analysis.referral ? "warning" : "success");
    }).catch(function () {
      if (revision !== state.revision) return;
      state.running = false;
      state.error = "Couldn't analyze this photo. Try again, or replace it with a clear, well-lit image.";
      if (state.previewUrl) show("review"); else { toast(state.error); show("capture"); }
    });
  }

  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act") || "";
    switch (act) {
      case "sknx-close": haptic("light"); closeMod(); return;
      case "sknx-back": haptic("light"); back(); return;
      case "sknx-source": haptic("light"); startCapture(t.getAttribute("data-source") || "library"); return;
      case "sknx-analyze": if (state.lastImage) runPipeline(state.lastImage, readHx() || {}); return;
      case "sknx-cancel": state.revision++; state.running = false; show(state.previewUrl ? "review" : "capture"); return;
      case "sknx-save":
        try { if (!state.saved && state.analysis && window.SMD_SKNX_STORE) state.saved = !!window.SMD_SKNX_STORE.save(state.analysis); } catch (_) {}
        t.innerHTML = ic(state.saved ? "bookmark_added" : "bookmark") + (state.saved ? "Case saved" : "Retry save");
        var status = host().querySelector(".sknx-save-status"); if (status) status.textContent = state.saved ? "Saved on this device." : "Could not save on this device. Try again.";
        return;
      case "sknx-new": resetCase(); state.stack = ["capture"]; show("capture"); return;
      case "sknx-jump": var target = document.getElementById(t.getAttribute("data-target")); if (target) { if (target.tagName === "DETAILS") target.open = true; target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" }); } return;
      case "sknx-compare": var L = state.reportLabels || []; if (L.length >= 2 && window.SMD_SKNX_COMPARE) { var cmp = window.SMD_SKNX_COMPARE.compare(L[0], L[1]); var ch = document.getElementById("sknxCompareHost"); if (ch) ch.innerHTML = window.SMD_SKNX_COMPARE.html(cmp); } haptic("light"); return;
      case "sknx-report-pdf": try { if (window.SMD_SKNX_REPORT && state.reportPayload) window.SMD_SKNX_REPORT.pdf(state.reportPayload); } catch (e) {} haptic("light"); return;
      case "sknx-rx-draft": haptic("light"); try { if (window.SMD_SKNX_RX) window.SMD_SKNX_RX.openDraft(state.analysis); } catch (e) {} return;
      case "sknx-refine-apply": haptic("light"); if (state.lastImage) runPipeline(state.lastImage, readHx() || {}); return;
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
  function wipe() { resetCase(); closeMod(); try { if (window.SMD_SKNX_STORE && window.SMD_SKNX_STORE.deleteAll) window.SMD_SKNX_STORE.deleteAll(); } catch (e) {} }
  var _signoutWired = false;
  function wireSignout() {
    if (_signoutWired || typeof window === "undefined") return; _signoutWired = true;
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) { try { window.addEventListener(ev, wipe); } catch (e) {} });
  }

  /* At LOAD, not on mount: a module the student never opened this session would otherwise
   * keep the previous account's data through a sign-out. wireSignout() is idempotent. */
  wireSignout();

  var API = {
    mount: mount,
    go: go,
    back: back,
    runPipeline: runPipeline,
    startCapture: startCapture,
    resetCase: resetCase,
    // pure helpers (node-testable, no DOM):
    bandLabel: bandLabel,
    disclaimerText: disclaimerText,
    STAGE_DEFS: STAGE_DEFS,
    SCREENS: SCREENS
  };
  if (typeof window !== "undefined") window.SMD_SKNX_SCREENS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
