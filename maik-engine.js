/* StewardMD — MaiK Answer Engine chooser (window.SMD_MAIK_ENGINE).
 * ===========================================================================
 * Three clinician-controlled engines, ONE router. Mirrors image-engine.js (same pref
 * pattern, same iOS-grouped-list settings markup, same wireSettings contract).
 *
 *   • KB only · Free        — the deterministic StewardMD KB answer (Tier 0, home.js) and
 *                             NOTHING else. Zero AI tokens, works offline. On a KB miss the
 *                             clinician is told plainly instead of a paid call being made.
 *   • MaiK Cloud · Pro      — today's pipeline, unchanged: KB grounding → Vertex/Gemini.
 *   • On-device · Beta      — the KB answer, then a local GGUF model on a KB miss. Zero
 *                             tokens, no network. Needs the ~2.5 GB model pack. Pro only.
 *
 * Pref: localStorage "stewardmd.maikEngine" ∈ {rag, cloud, local} (default cloud, so an
 * untouched install behaves EXACTLY as before).
 *
 * HOW THE ROUTING WORKS — no home.js router edit. window.SMD_AI (reasoning.js) is the single
 * facade every paid text call goes through (explain / explainGrounded / explainGroundedStream /
 * refine). We DECORATE those four once at load. That is why picking "KB only" also stops the
 * Rx/medlist/ICU surfaces from spending tokens: the clinician asked not to spend, and this is
 * the one place that promise can be kept for all of them. Vision/transcribe are NOT touched
 * (different feature, and image-engine.js owns the image choice).
 *
 * KB-FIRST COUPLING: home.js maikLLMFirst() (localStorage smd_maik_llm_first, default ON) makes
 * standalone questions skip the templated Tier 0 KB path and answer via Gemini with the KB as
 * grounding. That is right for Cloud and fatal for the other two — there would be no local
 * answer to fall back to. So setPref() writes the companion key: rag/local force KB-first ON,
 * cloud restores the default. One localStorage write instead of another home.js branch.
 * ======================================================================== */
(function () {
  "use strict";

  var KEY_ENGINE = "stewardmd.maikEngine";
  var KEY_LLM_FIRST = "smd_maik_llm_first";      // home.js maikLLMFirst() reads this
  var ENGINES = { rag: 1, cloud: 1, local: 1 };
  var PACK_ID = "maik-mxcore";
  // The pack the clinician ASKED for that is not installed yet. Kept separate from the ANSWERING
  // pack (SMD_MAIK_MODELS.activePack) on purpose: picking a model to download must never pull the
  // rug from under the model currently answering. That exact confusion presented as "no answer".
  var KEY_PENDING = "stewardmd.maikPackPending";

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lrem(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ── preference ──
  function getPref() { var v = lget(KEY_ENGINE); return ENGINES[v] ? v : "cloud"; }
  function setPref(v) {
    v = ENGINES[v] ? v : "cloud";
    lset(KEY_ENGINE, v);
    // KB-first is forced ON for "rag" ONLY. That engine has no model to write an answer, so it needs
    // the templated Tier 0 reply.
    //
    // For "local" it must stay OFF (the default), for two reasons found on a real device:
    //   1. The picker promises "Answer with -> MedGemma". With KB-first on, Tier 0 answered in 20 ms
    //      and the model was never called at all - and it answered the WRONG topic (amoebic liver
    //      abscess for a pyogenic question). Picking a model has to mean that model answers, with
    //      the KB as grounding rather than as a template.
    //   2. home.js only auto-runs the WEB-research tier on a KB miss when maikLLMFirst() is false.
    //      Web research needs the network, so forcing KB-first offline sent a KB miss to a tier that
    //      cannot possibly work and dead-ended there instead of reaching the on-device model.
    if (v === "rag") lset(KEY_LLM_FIRST, "0"); else lrem(KEY_LLM_FIRST);
    return v;
  }

  // ── is the on-device engine usable right now? ──
  // Entitlement and pack (downloaded) are separate: entitled-but-not-downloaded must show a
  // download row, not disappear.
  //
  // PRO IS THE GATE (owner decision, 2026-08-27). The shared experimental access-code gate
  // (SMD_XACCESS "maik_local") is gone: on-device answering is a paid feature, not a private beta,
  // so a code must not unlock it for a non-subscriber, and a subscriber must never be asked for
  // one. SMD_PRO (account.js) is the single source of truth and fails OPEN, which is the right
  // direction here - a network blip must never lock a paying clinician out of a 2.5 GB model that
  // is already sitting on their phone.
  function gateActive() {
    // Owner/QA escape hatch, same convention as the NMC verify bypass: lets the on-device engine be
    // driven on a device that has no Pro state to read. The device harnesses set it
    // (test/eval-device-maik-local.mjs, test/drive-device-llama.mjs); by hand, in the WebView console:
    //   localStorage.setItem("smd_maik_local_bypass","1")
    try { if (lget("smd_maik_local_bypass") === "1") return true; } catch (e) {}
    // A DEVELOPMENT build opens it too, so the feature is reachable on a debug install with no Pro
    // state and no JS console to set the bypass by hand. Release builds report debugBuild:false
    // from the native plugin, so production still requires a live subscription.
    try { if (window.SMD_MAIK_LOCAL && window.SMD_MAIK_LOCAL.isDebugBuild && window.SMD_MAIK_LOCAL.isDebugBuild()) return true; } catch (e) {}
    try { return !!(window.SMD_PRO && window.SMD_PRO.isProSync && window.SMD_PRO.isProSync()); } catch (e) { return false; }
  }
  function runtimeAvailable() {
    try {
      var L = window.SMD_MAIK_LOCAL;
      if (!L || !L.answer) return false;
      // The module ships in the web bundle too, so its presence proves nothing. Ask it whether the
      // native capacitor-llama plugin is actually there.
      return (typeof L.available === "function") ? !!L.available() : true;
    } catch (e) { return false; }
  }
  function activePack() {
    try { var M = window.SMD_MAIK_MODELS; return (M && M.activePack) ? M.activePack() : PACK_ID; } catch (e) { return PACK_ID; }
  }
  function packInstalled() {
    try { return !!(window.SMD_MAIK_MODELS && window.SMD_MAIK_MODELS.installedCached && window.SMD_MAIK_MODELS.installedCached(activePack())); } catch (e) { return false; }
  }
  function localReady() { return gateActive() && runtimeAvailable() && packInstalled(); }

  // Effective engine — never route to a local engine that cannot answer. A stale "local" pref
  // (model deleted, code expired, web build with no plugin) silently behaves as KB-only rather
  // than dead-ending, because KB-only is the honest subset of what the user asked for.
  function effective() {
    var p = getPref();
    if (p === "local" && !localReady()) return "rag";
    return p;
  }

  // ── the KB-only notice (rendered as a normal answer, so no home.js error branch needed) ──
  // Deliberately avoids the phrases maikRenderAnswer's "limited material" regex looks for.
  function kbOnlyNotice() {
    // If the clinician PICKED an on-device model that cannot answer yet, saying "KB-only mode is on"
    // is a lie - they never chose KB only. Name the real reason and how to fix it, because the
    // silent-degrade version of this looked exactly like "the app gives me no answer".
    if (getPref() === "local" && !localReady()) {
      var M = window.SMD_MAIK_MODELS, pid = activePack();
      var label = (M && M.PACKS && M.PACKS[pid]) ? M.PACKS[pid].label : "the on-device model";
      var st = (M && M.state) ? M.state(pid) : { frac: 0, downloading: false };
      var why, how;
      if (!runtimeAvailable()) { why = "this build cannot run on-device models"; how = "Update the app, or switch to **MaiK Cloud**."; }
      // The model IS fully installed and the runtime IS here, but the experimental gate is shut. Before
      // this branch that case fell through to "only partly downloaded (100%) - select it again to
      // resume", which is nonsense advice for a model that is already on the device, and is exactly
      // what a clinician sees after downloading 2.5 GB. Say the true thing instead.
      else if (packInstalled() && !gateActive()) {
        var L0 = window.SMD_MAIK_LOCAL;
        var checking = !!(L0 && L0.debugProbed && !L0.debugProbed());
        why = "**" + label + "** is downloaded, but on-device answering is not unlocked on this account";
        how = checking
          ? "Still checking with the device - reopen this screen in a moment. If it stays locked, use **MaiK Cloud**."
          : "Use **MaiK Cloud** for now. On-device answering is included with Pro.";
      }
      else if (st.downloading) { why = "**" + label + "** is still downloading (" + (st.frac * 100).toFixed(0) + "%)"; how = "It will answer here as soon as the download finishes. Until then pick **MaiK Cloud** or **KB only**."; }
      else if (st.frac > 0) { why = "**" + label + "** is only partly downloaded (" + (st.frac * 100).toFixed(0) + "%)"; how = "Tap the model name at the top of this screen and select it again to resume the download."; }
      else { why = "**" + label + "** is not downloaded to this device yet"; how = "Tap the model name at the top of this screen and select it to start the download."; }
      return {
        text: "I could not answer on this device: " + why + ".\n\n" + how,
        sources: [], engine: "local-unavailable", pack: pid
      };
    }
    return {
      text: "**KB-only mode is on.** The StewardMD knowledge base has no entry that answers this, " +
            "and KB-only mode never makes a paid AI call.\n\n" +
            "To get an answer for this question, open **Settings → AI Assistant → Answer engine** " +
            "and pick **MaiK Cloud**. Clinical reasoning, calculators and every reference tool keep " +
            "working as they are.",
      sources: [],
      engine: "rag"
    };
  }

  // ── ROUTER ──
  // opts/onDelta are passed straight through so the local path can reuse home.js's replay()
  // typewriter exactly as the cloud path does.
  function route(kind, orig, self, args) {
    var e = effective();
    if (e === "cloud") return orig.apply(self, args);
    if (e === "rag") {
      // refine() is a paid Gemini round-trip whose callers all treat null as "no refinement".
      if (kind === "refine") return Promise.resolve(null);
      return Promise.resolve(kbOnlyNotice());
    }
    // local
    if (kind === "refine") return Promise.resolve(null);          // no local router; KB terms are enough
    var pkg = args[0], opts = args[1], onDelta = args[2];
    if (kind === "explain") { pkg = { summary: args[0], question: args[1] || "" }; opts = null; onDelta = null; }
    /* Attach the staged image, and KEEP it for follow-ups.
     *
     * It used to be consumed on send, so the picture was gone by the time the doctor asked the obvious
     * next question - "is this normal?" reached the model with no image and could not be answered
     * about it. An image stays attached to the conversation until it is replaced or cleared, exactly
     * as it does in any chat assistant.
     *
     * The SECOND and later questions about the same image are flagged imageFollowUp so the prompt can
     * answer the question instead of re-reading the whole report.
     */
    try {
      var IM = window.__MAIK_IMAGES;
      if (IM && IM.attached) {
        var imgs = IM.attached();
        if (imgs && imgs.length) {
          opts = Object.assign({}, opts || {}, { images: imgs, imageFollowUp: !!IM.asked() });
          if (IM.markAsked) IM.markAsked();
        }
      }
    } catch (e) {}
    return Promise.resolve(window.SMD_MAIK_LOCAL.answer(pkg, opts, onDelta))
      .catch(function (err) { return { error: String((err && err.message) || err || "local-failed") }; });
  }

  // If on-device is already the chosen engine at startup, warm it before the first question.
  function warmIfLocal() {
    try {
      if (getPref() !== "local" || !localReady()) return;
      if (window.SMD_MAIK_LOCAL && window.SMD_MAIK_LOCAL.warm) window.SMD_MAIK_LOCAL.warm(activePack());
    } catch (e) {}
  }

  var _installed = false;
  function install() {
    if (_installed) return false;
    var A = window.SMD_AI;
    if (!A || typeof A.explainGrounded !== "function") return false;
    ["explain", "explainGrounded", "explainGroundedStream", "refine"].forEach(function (name) {
      var orig = A[name];
      if (typeof orig !== "function") return;
      A[name] = function () { return route(name, orig, A, arguments); };
    });
    // route() is an alias for refine() in reasoning.js; re-point it at the wrapped refine.
    if (typeof A.route === "function") A.route = function (q) { return A.refine(q); };
    _installed = true;
    // Deferred so it never competes with first paint.
    try { if (typeof setTimeout === "function") setTimeout(warmIfLocal, 2500); } catch (e) {}
    return true;
  }

  // reasoning.js may load after us; retry cheaply until it lands. Browser only — under the unit
  // tests there is no document and a live interval would keep the node process alive.
  function installWhenReady() {
    if (install()) return;
    if (typeof document === "undefined" || typeof setInterval !== "function") return;
    var tries = 0;
    var t = setInterval(function () { if (install() || ++tries > 60) clearInterval(t); }, 250);
    try { document.addEventListener("DOMContentLoaded", install, { once: true }); } catch (e) {}
  }

  // ── settings UI (markup mirrors image-engine.js settingsHTML) ──
  function pill(text, bg, fg) {
    return '<span style="font:700 9px/1 var(--sans,system-ui);background:' + bg + ';color:' + fg +
      ';border-radius:5px;padding:2px 5px;vertical-align:middle">' + text + '</span>';
  }
  function settingsHTML() {
    var pref = getPref();
    function opt(engine, label, badge, desc, first, disabled) {
      var on = pref === engine;
      return '<button type="button" data-me-opt="' + engine + '" role="radio" aria-checked="' + on + '"' +
        (disabled ? ' aria-disabled="true"' : '') +
        ' style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;background:' +
        (on ? "var(--teal-soft,#e6f4f1)" : "transparent") + ';border:0;' +
        (first ? "" : "border-top:1px solid var(--line,#e2e8f0);") +
        'padding:13px 14px;color:var(--ink,#14202b);opacity:' + (disabled ? ".55" : "1") +
        ';-webkit-tap-highlight-color:transparent">' +
        '<span style="flex:1;min-width:0"><span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:600 14px/1.3 var(--sans,system-ui)">' +
        label + " " + badge + '</span><span style="display:block;font:500 12px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:3px">' +
        desc + '</span></span>' +
        '<span aria-hidden="true" style="flex:0 0 auto;width:20px;text-align:center;color:var(--teal,#0e6e63);font-size:16px;font-weight:800;opacity:' +
        (on ? "1" : "0") + '">✓</span></button>';
    }

    var gated = gateActive(), rt = runtimeAvailable(), have = packInstalled();
    var localDesc, localDisabled = false;
    var proKnown = true;
    try { proKnown = !window.SMD_PRO || !window.SMD_PRO.proKnown || window.SMD_PRO.proKnown(); } catch (e) { proKnown = true; }
    // "Not Pro" and "have not asked the server yet" are different answers. On the first launch of a
    // build the per-uid Pro cache is empty, so the honest state for a second is CHECKING, not
    // "subscribe". The row re-renders itself when the verdict lands (see watchPro).
    if (!gated && !proKnown) { localDesc = "Checking your subscription…"; localDisabled = true; }
    else if (!gated) { localDesc = "Included with Pro. Subscribe to unlock, then download the model."; localDisabled = true; }
    else if (!rt) { localDesc = "Needs the latest native app build. Update the app to use this."; localDisabled = true; }
    else if (!have) { localDesc = "Ready to set up. Download the model to answer without any AI tokens."; }
    else { localDesc = "The model's own knowledge, on this device. Fast, no network, no tokens, and no StewardMD grounding, so it can be wrong."; }

    return '<div class="me-seg">' +
      '<div class="smd-nav-lbl" style="margin-bottom:6px">Answer engine</div>' +
      '<div role="radiogroup" aria-label="MaiK answer engine" style="border:1px solid var(--line,#e2e8f0);border-radius:14px;overflow:hidden;background:var(--panel,#fff);margin-bottom:8px">' +
      opt("rag", "KB only", pill("Free", "#dcfce7", "#166534"),
          "StewardMD knowledge base only, with citations. No AI tokens, works offline.", true, false) +
      opt("cloud", "MaiK Cloud", pill("Pro", "#fef3c7", "#92400e"),
          "Gemini, grounded in the StewardMD knowledge base. Uses AI tokens.", false, false) +
      opt("local", "On-device model", pill("Pro", "#fef3c7", "#92400e") + " " + pill("Beta", "#e0e7ff", "#3730a3"),
          localDesc, false, localDisabled) +
      '</div>' +
      (gated && rt ? modelRowHTML() : "") +
      '</div>';
  }

  /* ── On-device model section ────────────────────────────────────────────────
   * Pack chooser + live progress. The download state lives in SMD_MAIK_MODELS, not here, so
   * closing Settings never stops a download and reopening re-attaches to the live numbers.
   */
  function fmtETA(s) {
    if (s == null) return "";
    if (s < 90) return Math.max(1, Math.round(s)) + "s left";
    var m = Math.round(s / 60);
    return m < 60 ? m + " min left" : (m / 60).toFixed(1) + " h left";
  }

  /* The primary action button. Extracted so live progress can re-render JUST this button.
   * It has to: on device a row showed "0.3% of 2.83 GB ... 0.4 MB/s" while its button still read
   * "Download", because live updates patched only the status text. Tapping that stale button is how
   * a second download gets started. */
  function actionBtnHTML(id, st, have) {
    // A QUEUED pack is not downloading and not idle. It used to render "Download", which invited a
    // second tap that did nothing, and its Pause did nothing either because there was no transfer.
    if (st.queued) {
      return '<button class="smd-nav-btn" data-me-model="pause" data-me-id="' + id +
        '" style="margin:0;flex:1">Cancel</button>';
    }
    var label = st.downloading ? "Pause" : (have ? "Verify" : (st.frac > 0 ? "Resume" : "Download"));
    var act = st.downloading ? "pause" : "download";
    return '<button class="smd-nav-btn" data-me-model="' + act + '" data-me-id="' + id +
      '" style="margin:0;flex:1">' + label + '</button>';
  }

  function modelRowHTML() {
    var M = window.SMD_MAIK_MODELS;
    // Defensive: this renders inside the Settings panel, so a missing/older model module must
    // degrade to "no section" rather than throw and blank every setting below it.
    if (!M || !M.PACKS || !M.state || !M.sizeLabel) return "";
    var active = M.activePack ? M.activePack() : PACK_ID;
    var ids = (M.packIds ? M.packIds() : Object.keys(M.PACKS));
    if (!ids.length) return "";

    var rows = ids.map(function (id, i) {
      var p = M.PACKS[id];
      var on = id === active;
      var have = M.installedCached(id);
      var st = M.state(id);
      var size = M.sizeLabel(id);

      var status;
      if (st.queued) status = (st.note || "Waiting") + " · " + size;
      else if (st.downloading) status = (st.frac * 100).toFixed(1) + "% of " + size +
        // A stalled transfer reports 0.0 MB/s honestly rather than dropping the field, because a
        // percentage with no rate beside it is what made a frozen download look like a working one.
        " · " + (st.mbps || 0).toFixed(1) + " MB/s" + (st.etaS != null ? " · " + fmtETA(st.etaS) : "");
      else if (have) status = "Downloaded · " + size;
      else if (st.err) status = st.note + " · tap Download to resume";
      else if (st.frac > 0) status = "Paused at " + (st.frac * 100).toFixed(1) + "% · tap Download to resume";
      else status = "Not downloaded · " + size;

      var bar = (!st.queued && (st.downloading || (st.frac > 0 && !have)))
        ? '<div style="height:4px;border-radius:2px;background:var(--line,#e2e8f0);overflow:hidden;margin-top:7px">' +
            '<div style="height:100%;width:' + (st.frac * 100).toFixed(1) + '%;background:var(--teal,#0e6e63);transition:width .3s"></div>' +
          '</div>'
        : "";

      return '<div data-me-pack-row="' + id + '" style="' + (i ? "border-top:1px solid var(--line,#e2e8f0);" : "") + 'padding:12px 14px">' +
        '<button type="button" data-me-pack="' + id + '" role="radio" aria-checked="' + on + '"' +
        ' style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;cursor:pointer;background:transparent;border:0;padding:0;color:var(--ink,#14202b);-webkit-tap-highlight-color:transparent">' +
          '<span style="flex:1;min-width:0">' +
            '<span style="display:block;font:600 14px/1.3 var(--sans,system-ui)">' + p.label + '</span>' +
            '<span data-me-status="' + id + '" style="display:block;font:500 12px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:2px">' + status + '</span>' +
          '</span>' +
          '<span aria-hidden="true" style="flex:0 0 auto;width:20px;text-align:center;color:var(--teal,#0e6e63);font-size:16px;font-weight:800;opacity:' + (on ? "1" : "0") + '">✓</span>' +
        '</button>' +
        '<div data-me-bar="' + id + '">' + bar + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:9px" data-me-actions="' + id + '">' +
          actionBtnHTML(id, st, have) +
          // No Delete while a transfer is running: a mis-tap there throws away a partial download
          // AND cancels it. Pause first, then Delete appears.
          (!st.downloading && !st.queued && (have || st.frac > 0)
            ? '<button class="smd-nav-btn" data-me-model="delete" data-me-id="' + id + '" style="margin:0;flex:1">Delete</button>' : "") +
        '</div>' +
        // Image reading is a SEPARATE add-on, offered only once the model itself is on the device:
        // spending 851 MB on a projector for a model you do not have is not a choice worth offering.
        visionRowHTML(id, have) +
      '</div>';
    }).join("");

    return '<div class="smd-nav-lbl" style="margin:14px 0 6px">On-device model</div>' +
      // ABOVE the list, not below it: the hardware warning has to be read before a 3 GB tap, not
      // discovered afterwards. Same text is repeated at the moment of selection.
      deviceWarnHTML() +
      '<div role="radiogroup" aria-label="On-device model" style="border:1px solid var(--line,#e2e8f0);border-radius:14px;overflow:hidden;background:var(--panel,#fff)">' + rows + '</div>' +
      '<div class="smd-nav-note" style="margin-top:6px">Downloads over Wi-Fi or mobile data and resumes if interrupted. You can leave this screen; the download keeps going.</div>' +
      '<button type="button" class="smd-nav-btn" data-me-guide aria-expanded="false" style="margin:8px 0 0;width:100%">Which one should I download?</button>' +
      guideHTML();
  }

  /**
   * The optional image-reading add-on for one pack.
   *
   * Shown only when (a) the model can see at all - Apex is text-only and never gets this row - and
   * (b) the model itself is already downloaded. It reuses the ordinary pack row machinery through the
   * "<id>#vision" sub-pack, so its progress, pause, resume and delete all behave identically without
   * a second code path.
   */
  function visionRowHTML(id, haveModel) {
    var M = window.SMD_MAIK_MODELS;
    if (!M || !M.hasVision || !M.hasVision(id) || !haveModel) return "";
    var vid = M.visionIdOf(id);
    var vst = M.state(vid), vhave = M.installedCached(vid);
    var size = M.sizeLabel(vid);
    var status = vst.queued ? (vst.note || "Waiting") + " · " + size
      : vst.downloading ? (vst.frac * 100).toFixed(1) + "% of " + size + " · " + (vst.mbps || 0).toFixed(1) + " MB/s"
      : vhave ? "Ready · reads photos, labels and reports offline"
      : vst.frac > 0 ? "Paused at " + (vst.frac * 100).toFixed(1) + "% · " + size
      : "Add image reading · " + size;
    return '<div data-me-pack-row="' + vid + '" style="border-top:1px dashed var(--line,#e2e8f0);padding:10px 14px 12px;margin-top:2px">' +
      '<div style="font:600 12.5px/1.3 var(--sans,system-ui);color:var(--ink,#14202b)">Image reading</div>' +
      '<div data-me-status="' + vid + '" style="font:500 11.5px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:2px">' + esc(status) + '</div>' +
      '<div data-me-bar="' + vid + '">' + (vst.downloading || (vst.frac > 0 && !vhave)
        ? '<div style="height:4px;border-radius:2px;background:var(--line,#e2e8f0);overflow:hidden;margin-top:6px">' +
            '<div style="height:100%;width:' + (vst.frac * 100).toFixed(1) + '%;background:var(--teal,#0e6e63)"></div></div>'
        : "") + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px" data-me-actions="' + vid + '">' +
        actionBtnHTML(vid, vst, vhave) +
        (!vst.downloading && !vst.queued && (vhave || vst.frac > 0)
          ? '<button class="smd-nav-btn" data-me-model="delete" data-me-id="' + vid + '" style="margin:0;flex:1">Remove</button>' : "") +
      '</div>' +
    '</div>';
  }

  /** The hardware warning, styled as a caution rather than a note so it is not skimmed past. */
  function deviceWarnHTML() {
    var M = window.SMD_MAIK_MODELS;
    var t = (M && M.DEVICE_WARNING) || "";
    if (!t) return "";
    return '<div role="note" style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--yellow-line,#f0d49b);' +
      'background:var(--yellow-bg,#fdf2de);color:var(--yellow,#92620a);border-radius:12px;padding:10px 12px;margin:0 0 8px">' +
      '<span aria-hidden="true" style="flex:0 0 auto;font:800 13px/1.4 var(--sans,system-ui)">!</span>' +
      '<span style="font:600 12.5px/1.5 var(--sans,system-ui)">' + esc(t) + '</span>' +
    '</div>';
  }


  /* ── "Which one should I download?" ────────────────────────────────────────────────────────────
   * A clinician is being asked to spend 2.5-3.1 GB and pick between three names that mean nothing
   * to them. The picker rows only have room for a size and a one-liner, so the reasoning lives here.
   *
   * NO upstream model names, by owner decision - the UI shows MAiK tiers only. The pip scale is
   * RELATIVE to the other two tiers and says so, because "medical depth: 3" is meaningless as an
   * absolute claim and would be a quiet overstatement of what a 4B can do.
   * NO emoji, per the house icon rule - the pips are CSS blocks.
   */
  function pips(n, label) {
    var out = '<span style="display:inline-flex;gap:3px;vertical-align:middle" role="img" aria-label="' + label + ': ' + n + ' of 3">';
    for (var i = 1; i <= 3; i++) {
      out += '<span style="width:14px;height:5px;border-radius:3px;background:' +
             (i <= n ? "var(--teal,#0e6e63)" : "var(--line,#e2e8f0)") + '"></span>';
    }
    return out + "</span>";
  }

  function guideHTML() {
    var M = window.SMD_MAIK_MODELS;
    if (!M) return "";
    var intro = (M.GUIDE_INTRO || []).map(function (t) {
      return '<li style="margin:0 0 6px">' + esc(t) + "</li>";
    }).join("");

    var rows = M.packIds().map(function (id) {
      var p = M.PACKS[id] || {}, g = p.guide || {};
      var line = function (lbl, n) {
        return '<div style="display:flex;align-items:center;gap:8px;margin-top:5px">' +
                 '<span style="flex:0 0 96px;font:500 12px/1.4 var(--sans,system-ui);color:var(--slate-soft,#5a7184)">' + lbl + "</span>" +
                 pips(n || 1, lbl) +
               "</div>";
      };
      return '<div style="padding:12px 0;border-top:1px solid var(--line,#e2e8f0)">' +
        '<div style="display:flex;align-items:baseline;gap:8px">' +
          '<span style="font:700 14px/1.3 var(--sans,system-ui)">' + esc(p.label || id) + "</span>" +
          '<span style="font:500 12px/1.3 var(--sans,system-ui);color:var(--slate-soft,#5a7184)">' + esc(M.sizeLabel(id)) + "</span>" +
        "</div>" +
        line("Speed", g.speed) + line("Medical depth", g.medical) + line("General knowledge", g.general) +
        '<div style="font:500 12.5px/1.5 var(--sans,system-ui);color:var(--slate,#2d4356);margin-top:8px">' +
          "<b>Best for</b> " + esc(g.bestFor || "") + "<br>" + esc(g.why || "") +
        "</div>" +
        (g.pick ? '<div style="font:600 12.5px/1.5 var(--sans,system-ui);color:var(--teal,#0e6e63);margin-top:5px">' + esc(g.pick) + "</div>" : "") +
      "</div>";
    }).join("");

    return '<div data-me-guide-panel hidden style="border:1px solid var(--line,#e2e8f0);border-radius:14px;background:var(--panel,#fff);padding:14px;margin-top:8px">' +
      '<div style="font:700 13px/1.3 var(--sans,system-ui);margin-bottom:8px">Will it run on my phone?</div>' +
      deviceWarnHTML() +
      '<div style="font:700 13px/1.3 var(--sans,system-ui);margin-bottom:8px">How on-device mode works</div>' +
      '<ul style="margin:0 0 4px;padding-left:18px;font:500 12.5px/1.5 var(--sans,system-ui);color:var(--slate,#2d4356)">' + intro + "</ul>" +
      '<div style="font:700 13px/1.3 var(--sans,system-ui);margin:14px 0 0">Choosing a model</div>' +
      '<div style="font:500 11.5px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:3px">Ratings compare these options with each other, nothing else.</div>' +
      rows +
      '<div style="font:500 12px/1.5 var(--sans,system-ui);color:var(--slate-soft,#5a7184);border-top:1px solid var(--line,#e2e8f0);padding-top:10px;margin-top:2px">' +
        "Start with MAiK Lite: StewardMD's own model, the smallest download and the fastest answers. " +
        "MxCore and Neural for deeper medical detail, Horizon for broader general knowledge, Apex on a " +
        "flagship phone when you want the best answer and can wait a little longer." +
      "</div>" +
    "</div>";
  }

  // Live updates without re-rendering the whole section (which would kill the tap targets
  // mid-download). Patches only the status line and the bar for the pack that changed.
  var _unsub = null;
  function attachLive(root) {
    var M = window.SMD_MAIK_MODELS;
    if (!M || !M.subscribe) return;
    if (_unsub) { try { _unsub(); } catch (e) {} _unsub = null; }
    _unsub = M.subscribe(function (id, st) {
      var host = (root && root.querySelector) ? root : document;
      var stEl = host.querySelector('[data-me-status="' + id + '"]');
      var barEl = host.querySelector('[data-me-bar="' + id + '"]');
      if (!stEl && !barEl) { if (_unsub) { try { _unsub(); } catch (e) {} _unsub = null; } return; }   // section gone
      var size = M.sizeLabel(id);
      if (stEl) {
        stEl.textContent = st.downloading
          ? (st.frac * 100).toFixed(1) + "% of " + size + (st.mbps ? " · " + st.mbps.toFixed(1) + " MB/s" : "") + (st.etaS != null ? " · " + fmtETA(st.etaS) : "")
          : st.done ? "Downloaded · " + size
          : st.err ? st.note + " · tap Download to resume"
          : st.frac > 0 ? "Paused at " + (st.frac * 100).toFixed(1) + "% · tap Download to resume"
          : "Not downloaded · " + size;
      }
      if (barEl) {
        barEl.innerHTML = (st.downloading || (st.frac > 0 && !st.done))
          ? '<div style="height:4px;border-radius:2px;background:var(--line,#e2e8f0);overflow:hidden;margin-top:7px">' +
              '<div style="height:100%;width:' + (st.frac * 100).toFixed(1) + '%;background:var(--teal,#0e6e63);transition:width .3s"></div></div>'
          : "";
      }
      // Keep the BUTTON honest too. A "Download" button on a downloading row is what produced a
      // second, concurrent transfer when it was tapped.
      var actEl = host.querySelector('[data-me-actions="' + id + '"]');
      if (actEl) {
        var have = M.installedCached(id);
        var cur = actEl.querySelector("[data-me-model]");
        var wantAct = st.downloading ? "pause" : "download";
        if (!cur || cur.getAttribute("data-me-model") !== wantAct) {
          var del = st.downloading ? "" :
            ((have || st.frac > 0) ? '<button class="smd-nav-btn" data-me-model="delete" data-me-id="' + id + '" style="margin:0;flex:1">Delete</button>' : "");
          actEl.innerHTML = actionBtnHTML(id, st, have) + del;
          wireSettings(actEl.parentNode || host);
        }
      }
      // A finished or failed download changes which buttons belong here.
      if (!st.downloading) { var seg = (root && root.querySelector) ? root.querySelector(".me-seg") : null; if (seg) rerender(seg.querySelector("[data-me-opt]") || seg, root); }
    });
  }

  function rerender(anchor, root) {
    var host = anchor && anchor.closest ? anchor.closest(".me-seg") : null;
    if (!host) return;
    host.outerHTML = settingsHTML();
    var fresh = (root && root.querySelector(".me-seg")) || document.querySelector(".me-seg");
    if (fresh && fresh.parentNode) wireSettings(fresh.parentNode);
  }

  function wireSettings(container) {
    var root = container || document;
    root.querySelectorAll("[data-me-opt]").forEach(function (b) {
      b.addEventListener("click", function () {
        var want = b.getAttribute("data-me-opt");
        if (want === "local" && !gateActive()) { toast("The on-device model is included with Pro."); return; }
        if (want === "local" && !runtimeAvailable()) { toast("The on-device model needs the latest app build."); return; }
        if (want === "local" && !packInstalled()) { setPref(want); rerender(b, root); return startDownload(b, root); }
        setPref(want);
        rerender(b, root);
      });
    });
    root.querySelectorAll("[data-me-pack]").forEach(function (b) {
      b.addEventListener("click", function () {
        var M = window.SMD_MAIK_MODELS;
        if (M && M.setActivePack) M.setActivePack(b.getAttribute("data-me-pack"));
        rerender(b, root);
      });
    });
    // The guide is a plain expander rather than a modal: rerender() replaces this whole section on
    // every pack change, and a modal would have to be torn down and re-opened around that.
    root.querySelectorAll("[data-me-guide]").forEach(function (b) {
      b.addEventListener("click", function () {
        var panel = root.querySelector("[data-me-guide-panel]");
        if (!panel) return;
        var open = !panel.hasAttribute("hidden");
        if (open) panel.setAttribute("hidden", ""); else panel.removeAttribute("hidden");
        b.setAttribute("aria-expanded", open ? "false" : "true");
        b.textContent = open ? "Which one should I download?" : "Hide the guide";
      });
    });
    root.querySelectorAll("[data-me-model]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-me-model");
        var id = b.getAttribute("data-me-id") || PACK_ID;
        if (act === "delete") return removeModel(b, root, id);
        if (act === "pause") {
          var M = window.SMD_MAIK_MODELS;
          if (M && M.cancel) M.cancel(id);
          return;
        }
        return startDownload(b, root, id);
      });
    });
    attachLive(root);
  }

  function toast(m) { try { (window.toast || function () {})(m); } catch (e) {} }

  function startDownload(anchor, root, id) {
    id = id || PACK_ID;
    var M = window.SMD_MAIK_MODELS;
    if (!M || !M.ensure) return toast("Model download is unavailable in this build.");
    rerender(anchor, root);            // flip the button to Pause immediately
    return M.ensure(id, null).then(function () {
      adoptPackWhenReady(id);
      toast("On-device model ready.");
    }).catch(function (e) {
      var msg = String((e && e.message) || e);
      if (msg !== "cancelled") toast("Download stopped. Tap Download to resume.");
    });
  }

  function removeModel(anchor, root, id) {
    id = id || PACK_ID;
    var M = window.SMD_MAIK_MODELS;
    if (!M || !M.remove) return;
    return M.remove(id).then(function () {
      if (getPref() === "local" && !localReady()) setPref("rag");
      toast("Model deleted.");
      rerender(anchor, root);
    });
  }


  /* ── ChatGPT-style inline model picker (MaiK sheet header) ──────────────────
   * A chip next to the MaiK logo showing what will answer, tapping it opens a bottom sheet to
   * switch. Same state as the Settings section (getPref/setPref + SMD_MAIK_MODELS.activePack), so
   * the two surfaces can never disagree - this is a second VIEW, not a second source of truth.
   *
   * Options are flattened the way ChatGPT flattens them: the clinician picks a NAMED thing that
   * answers, not an abstract "engine" and then a "model". Cloud and KB-only are one row each; every
   * on-device pack is its own row.
   */
  function options() {
    var out = [
      { id: "cloud", label: "MaiK Cloud", sub: "Gemini, grounded in the StewardMD KB. Uses AI tokens.", badge: "PRO" },
      { id: "rag", label: "KB only", sub: "StewardMD knowledge base, cited. No tokens, works offline.", badge: "FREE" }
    ];
    var M = window.SMD_MAIK_MODELS;
    if (M && M.PACKS && gateActive() && runtimeAvailable()) {
      (M.packIds ? M.packIds() : Object.keys(M.PACKS)).forEach(function (pid) {
        var st = M.state(pid), have = M.installedCached(pid);
        out.push({
          id: "local:" + pid, label: M.PACKS[pid].label,
          sub: st.downloading ? "Downloading " + (st.frac * 100).toFixed(0) + "% - will answer when ready"
             // Never surface the upstream model name (MedGemma / Gemma) in the UI - owner decision.
             // `actual` stays in the registry for logs and code, not for the clinician.
             : have ? "On this device, works offline"
             : st.frac > 0 ? "Paused at " + (st.frac * 100).toFixed(0) + "% - tap to resume"
             : "Tap to download " + M.sizeLabel(pid),
          // STEWARDMD badge for our own model, FLAGSHIP instead of OFFLINE for the heaviest tier
          // (so the hardware requirement is visible in the picker row itself, not only in the guide).
          badge: M.PACKS[pid].own ? "STEWARDMD" : M.PACKS[pid].flagship ? "FLAGSHIP" : "OFFLINE",
          flagship: !!M.PACKS[pid].flagship,
          warn: M.DEVICE_WARNING || "",
          pack: pid, needsDownload: !have && !st.downloading,
          requested: pendingPack() === pid
        });
      });
    }
    return out;
  }

  /** Which option row is currently active. */
  function currentOptionId() {
    var p = getPref();
    return p === "local" ? "local:" + activePack() : p;
  }

  /** Short label for the header chip. */
  function chipLabel() {
    var cur = currentOptionId();
    var o = options().filter(function (x) { return x.id === cur; })[0];
    var base = o ? o.label : (getPref() === "rag" ? "KB only" : "MaiK Cloud");
    // Never let the chip imply an on-device model is answering when it is not ready. Silent
    // degrade-to-KB with a model name still showing is how "I get no answer" happens.
    if (getPref() === "local" && !localReady()) {
      var M = window.SMD_MAIK_MODELS, st = (M && M.state) ? M.state(activePack()) : null;
      if (st && st.downloading) return base + " (" + (st.frac * 100).toFixed(0) + "%)";
      return base + " (not ready)";
    }
    return base;
  }

  function chipHTML() {
    return '<button type="button" id="maikModelChip" aria-haspopup="listbox" ' +
      'style="display:flex;align-items:center;gap:5px;max-width:44%;padding:5px 9px;border-radius:999px;' +
      'border:1px solid var(--mk-bd,#dbe3ee);background:var(--mk-soft,#f1f5f9);color:var(--mk-ink,#14202b);' +
      'font:600 12px/1.1 var(--sans,system-ui);cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent">' +
      '<span id="maikModelChipLbl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(chipLabel()) + '</span>' +
      '<span aria-hidden="true" style="opacity:.6;font-size:9px">\u25be</span></button>';
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  /** Header disclaimer text for the engine that will actually answer. */
  function discLabel() {
    var e = effective();
    if (e === "local") return "On-device \u00b7 AI-generated, no sources, verify independently";
    if (e === "rag") return "StewardMD knowledge base \u00b7 verify independently";
    return "Grounded \u00b7 AI-generated, verify independently";
  }

  function syncDisc() {
    try {
      var el = document.querySelector("#maikSheet .maik-disc span");
      if (el) el.textContent = discLabel();
    } catch (e) {}
  }

  function syncChip() {
    syncDisc();
    try {
      var el = document.getElementById("maikModelChipLbl");
      if (el) el.textContent = chipLabel();
    } catch (e) {}
  }

  /** Apply an option row id ("cloud" | "rag" | "local:<packId>"). */
  function pendingPack() { var v = lget(KEY_PENDING); var M = window.SMD_MAIK_MODELS; return (v && M && M.PACKS && M.PACKS[v]) ? v : null; }

  function selectOption(optId) {
    if (optId.indexOf("local:") === 0) {
      var pid = optId.slice(6);
      var M = window.SMD_MAIK_MODELS;
      var ready = !!(M && M.installedCached && M.installedCached(pid));
      if (ready) {
        // It can answer: promote it and answer with it.
        if (M && M.setActivePack) M.setActivePack(pid);
        lrem(KEY_PENDING);
        setPref("local");
        // Start loading + faulting the weights in NOW, while they are still typing. Prefill after a
        // cold load is page-fault bound (measured 130 s on a Pixel 9); this moves that off the
        // critical path instead of making the first question pay for it.
        try { if (window.SMD_MAIK_LOCAL && window.SMD_MAIK_LOCAL.warm) window.SMD_MAIK_LOCAL.warm(pid); } catch (e) {}
      } else {
        // It cannot answer yet: remember the request and download it, but leave whatever is
        // currently answering alone. Moving activePack here is what broke answering before.
        lset(KEY_PENDING, pid);
      }
    } else {
      lrem(KEY_PENDING);
      setPref(optId);
    }
    syncChip();
    return currentOptionId();
  }

  /**
   * Called when a pack finishes downloading: if the clinician had selected that pack, switch to it
   * now that it can answer.
   */
  function adoptPackWhenReady(pid) {
    try {
      var M = window.SMD_MAIK_MODELS;
      if (!M || !M.installedCached || !M.installedCached(pid)) return false;
      // Promote when it is either the pack already answering, or the one the clinician asked for.
      if (activePack() !== pid && pendingPack() !== pid) return false;
      if (M.setActivePack) M.setActivePack(pid);
      lrem(KEY_PENDING);
      if (getPref() !== "local") setPref("local");
      syncChip();
      return true;
    } catch (e) { return false; }
  }

  var _pickerUnsub = null;
  function closePicker() {
    if (_pickerUnsub) { try { _pickerUnsub(); } catch (e) {} _pickerUnsub = null; }
    var ov = document.getElementById("maikModelPicker");
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function openPicker() {
    closePicker();
    var cur = currentOptionId();
    var ov = document.createElement("div");
    ov.id = "maikModelPicker";
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;background:rgba(11,17,22,.45)";

    function rowsHTML() {
      return options().map(function (o) {
        var on = o.id === cur;
        return '<button type="button" data-mk-pick="' + o.id + '" role="option" aria-selected="' + on + '" ' +
          'style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;border:0;' +
          'background:' + (on ? "var(--mk-tsoft,#e6f4f1)" : "transparent") + ';padding:14px 16px;' +
          'color:var(--mk-ink,#14202b);-webkit-tap-highlight-color:transparent">' +
          '<span style="flex:1;min-width:0">' +
            '<span style="display:flex;align-items:center;gap:7px;font:600 15px/1.25 var(--sans,system-ui)">' + esc(o.label) +
              '<span style="font:700 9px/1 var(--sans,system-ui);background:var(--mk-bd,#e2e8f0);color:var(--mk-mut,#5a7184);border-radius:5px;padding:2px 5px">' + o.badge + '</span>' +
            '</span>' +
            '<span data-mk-sub="' + o.id + '" style="display:block;font:500 12px/1.4 var(--sans,system-ui);color:var(--mk-mut,#5a7184);margin-top:3px">' + esc(o.sub) + '</span>' +
          '</span>' +
          '<span aria-hidden="true" style="flex:0 0 auto;width:18px;text-align:center;color:var(--mk-teal,#0e6e63);font-size:15px;font-weight:800;opacity:' + (on ? "1" : "0") + '">\u2713</span>' +
          '</button>';
      }).join('<div style="height:1px;background:var(--mk-bd,#e2e8f0);margin-left:16px"></div>');
    }

    ov.innerHTML = '<div id="maikModelSheetInner" style="width:100%;background:var(--mk-bg,#fff);border-radius:18px 18px 0 0;padding:8px 0 max(14px,env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.28)">' +
      '<div style="width:38px;height:4px;border-radius:2px;background:var(--mk-bd,#dbe3ee);margin:6px auto 10px"></div>' +
      '<div style="font:700 13px/1.2 var(--sans,system-ui);color:var(--mk-mut,#5a7184);padding:0 16px 8px">Answer with</div>' +
      '<div id="maikModelRows" role="listbox">' + rowsHTML() + '</div>' +
      '</div>';
    document.body.appendChild(ov);

    // Live progress inside the picker, so a download started here shows movement without reopening.
    try {
      var M = window.SMD_MAIK_MODELS;
      if (M && M.subscribe) {
        _pickerUnsub = M.subscribe(function (pid) {
          var opts = options();
          for (var i = 0; i < opts.length; i++) {
            var el = ov.querySelector('[data-mk-sub="' + opts[i].id + '"]');
            if (el) el.textContent = opts[i].sub;
          }
          syncChip();
        });
      }
    } catch (e) {}

    ov.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-mk-pick]") : null;
      if (!btn) { if (e.target === ov) closePicker(); return; }
      var optId = btn.getAttribute("data-mk-pick");
      var chosen = options().filter(function (x) { return x.id === optId; })[0];
      selectOption(optId);
      // Picking an on-device model that is not downloaded starts the download right here.
      if (chosen && chosen.needsDownload && chosen.pack) {
        var M2 = window.SMD_MAIK_MODELS;
        if (M2 && M2.ensure) {
          M2.ensure(chosen.pack, null).then(function () { adoptPackWhenReady(chosen.pack); toast("On-device model ready."); syncChip(); })
            .catch(function (err) { if (String((err && err.message) || err) !== "cancelled") toast("Download stopped. Tap the model again to resume."); });
        }
        cur = currentOptionId();
        var rows = ov.querySelector("#maikModelRows");
        if (rows) rows.innerHTML = rowsHTML();
        return;   // keep the sheet open so the clinician sees the download start
      }
      closePicker();
    });
  }

  /** Mount the header chip. Called by home.js after the MaiK sheet is built. */
  function wireChip(root) {
    var host = (root || document).querySelector ? (root || document) : document;
    var chip = host.querySelector("#maikModelChip");
    if (!chip || chip.getAttribute("data-mk-wired")) return;
    chip.setAttribute("data-mk-wired", "1");
    chip.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); openPicker(); });
    syncChip();
  }

  /* Pro decides gateActive(), and it is read synchronously while painting the settings row and the
   * picker - but /billing/status resolves AFTER that paint. Before this, the row rendered locked on
   * first launch of a build (the per-uid Pro cache had never been written) and never corrected
   * itself, which is exactly "the on-device model is not working". Re-render on the flip. */
  (function watchPro() {
    if (typeof window === "undefined" || window.__smdMaikProWatch) return;
    window.__smdMaikProWatch = 1;
    var onFlip = function () {
      try {
        var seg = document.querySelector(".me-seg");
        if (seg) rerender(seg.querySelector("[data-me-opt]") || seg, seg.parentNode || document);
      } catch (e) {}
      try { syncChip(); } catch (e) {}
      // Now that the gate may be open, warm the model if it is the chosen engine.
      try { warmIfLocal(); } catch (e) {}
    };
    try {
      if (window.SMD_PRO && window.SMD_PRO.onProChange) window.SMD_PRO.onProChange(onFlip);
      else window.addEventListener("smd:pro", onFlip);   // account.js may load after this module
    } catch (e) {}
  })();

  var API = {
    KEY_ENGINE: KEY_ENGINE, KEY_LLM_FIRST: KEY_LLM_FIRST, PACK_ID: PACK_ID,
    getPref: getPref, setPref: setPref, effective: effective,
    gateActive: gateActive, runtimeAvailable: runtimeAvailable, packInstalled: packInstalled, localReady: localReady,
    kbOnlyNotice: kbOnlyNotice, route: route, install: install, activePack: activePack,
    settingsHTML: settingsHTML, wireSettings: wireSettings, modelRowHTML: modelRowHTML,
    options: options, currentOptionId: currentOptionId, chipLabel: chipLabel, chipHTML: chipHTML,
    selectOption: selectOption, adoptPackWhenReady: adoptPackWhenReady, pendingPack: pendingPack,
    discLabel: discLabel, syncDisc: syncDisc,
    warmIfLocal: warmIfLocal,
    KEY_PENDING: KEY_PENDING, openPicker: openPicker, closePicker: closePicker, wireChip: wireChip, syncChip: syncChip
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") { window.SMD_MAIK_ENGINE = API; installWhenReady(); }
})();
