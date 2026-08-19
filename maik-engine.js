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
 *                             tokens, no network. Needs the ~2.5 GB model pack.
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
  var XA_FEATURE = "maik_local";                 // experimental.js gate, same as fundx/kardiox
  var PACK_ID = "maik-local-v1";

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lrem(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ── preference ──
  function getPref() { var v = lget(KEY_ENGINE); return ENGINES[v] ? v : "cloud"; }
  function setPref(v) {
    v = ENGINES[v] ? v : "cloud";
    lset(KEY_ENGINE, v);
    // Keep Tier 0 reachable for the two engines that depend on it (see header).
    if (v === "cloud") lrem(KEY_LLM_FIRST); else lset(KEY_LLM_FIRST, "0");
    return v;
  }

  // ── is the on-device engine usable right now? ──
  // Gate (access code) and pack (downloaded) are separate: gated-but-not-downloaded must show a
  // download row, not disappear.
  function gateActive() {
    try { return !!(window.SMD_XACCESS && window.SMD_XACCESS.isActiveCached && window.SMD_XACCESS.isActiveCached(XA_FEATURE)); } catch (e) { return false; }
  }
  function runtimeAvailable() {
    try { return !!(window.SMD_MAIK_LOCAL && window.SMD_MAIK_LOCAL.answer); } catch (e) { return false; }
  }
  function packInstalled() {
    try { return !!(window.SMD_MAIK_MODELS && window.SMD_MAIK_MODELS.installedCached && window.SMD_MAIK_MODELS.installedCached(PACK_ID)); } catch (e) { return false; }
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
    return Promise.resolve(window.SMD_MAIK_LOCAL.answer(pkg, opts, onDelta))
      .catch(function (err) { return { error: String((err && err.message) || err || "local-failed") }; });
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
    if (!gated) { localDesc = "Private beta. Unlock with an access code below, then download the model."; localDisabled = true; }
    else if (!rt) { localDesc = "Needs the latest native app build. Update the app to use this."; localDisabled = true; }
    else if (!have) { localDesc = "Ready to set up. Download the model to answer without any AI tokens."; }
    else { localDesc = "Answers on this device with no network and no AI tokens. Beta quality."; }

    return '<div class="me-seg">' +
      '<div class="smd-nav-lbl" style="margin-bottom:6px">Answer engine</div>' +
      '<div role="radiogroup" aria-label="MaiK answer engine" style="border:1px solid var(--line,#e2e8f0);border-radius:14px;overflow:hidden;background:var(--card,#fff);margin-bottom:8px">' +
      opt("rag", "KB only", pill("Free", "#dcfce7", "#166534"),
          "StewardMD knowledge base only. No AI tokens are ever used, and it works offline.", true, false) +
      opt("cloud", "MaiK Cloud", pill("Pro", "#fef3c7", "#92400e"),
          "Full grounded clinical answers from StewardMD's secure AI. Uses AI tokens.", false, false) +
      opt("local", "On-device model", pill("Beta", "#e0e7ff", "#3730a3"),
          localDesc, false, localDisabled) +
      '</div>' +
      (gated && rt ? modelRowHTML() : "") +
      '</div>';
  }

  // Download / delete row for the model pack. Progress is driven by SMD_MAIK_MODELS.
  function modelRowHTML() {
    var have = packInstalled();
    var size = "";
    try { if (window.SMD_MAIK_MODELS && window.SMD_MAIK_MODELS.sizeLabel) size = window.SMD_MAIK_MODELS.sizeLabel(PACK_ID); } catch (e) {}
    if (have) {
      return '<div id="meModelRow" style="font:500 12px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);padding:0 2px 6px">' +
        'Model installed' + (size ? " (" + size + ")" : "") + '.</div>' +
        '<button class="smd-nav-btn" data-me-model="delete" style="text-align:left">Delete model' + (size ? " (frees " + size + ")" : "") + '</button>';
    }
    return '<div id="meModelRow" style="font:500 12px/1.45 var(--sans,system-ui);color:var(--slate-soft,#5a7184);padding:0 2px 6px">' +
      'Not downloaded' + (size ? " · " + size : "") + '. Downloads over Wi-Fi or mobile data, and resumes if interrupted.</div>' +
      '<button class="smd-nav-btn" data-me-model="download" style="text-align:left">Download model' + (size ? " (" + size + ")" : "") + '</button>';
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
        if (want === "local" && !gateActive()) { toast("Enter an access code under Experimental Features to try the on-device model."); return; }
        if (want === "local" && !runtimeAvailable()) { toast("The on-device model needs the latest app build."); return; }
        if (want === "local" && !packInstalled()) { setPref(want); rerender(b, root); return startDownload(b, root); }
        setPref(want);
        rerender(b, root);
      });
    });
    root.querySelectorAll("[data-me-model]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-me-model") === "delete") return removeModel(b, root);
        return startDownload(b, root);
      });
    });
  }

  function toast(m) { try { (window.toast || function () {})(m); } catch (e) {} }

  function startDownload(anchor, root) {
    if (!window.SMD_MAIK_MODELS || !window.SMD_MAIK_MODELS.ensure) return toast("Model download is unavailable in this build.");
    var row = document.getElementById("meModelRow");
    function show(msg) { if (row) row.textContent = msg; }
    show("Starting download…");
    return window.SMD_MAIK_MODELS.ensure(PACK_ID, function (frac, note) {
      show(note || ("Downloading … " + Math.round((frac || 0) * 100) + "%"));
    }).then(function () {
      toast("On-device model ready.");
      rerender(anchor, root);
    }).catch(function (e) {
      show("Download stopped: " + ((e && e.message) || e) + ". Tap to resume.");
    });
  }

  function removeModel(anchor, root) {
    if (!window.SMD_MAIK_MODELS || !window.SMD_MAIK_MODELS.remove) return;
    return window.SMD_MAIK_MODELS.remove(PACK_ID).then(function () {
      if (getPref() === "local") setPref("rag");
      toast("Model deleted.");
      rerender(anchor, root);
    });
  }

  var API = {
    KEY_ENGINE: KEY_ENGINE, KEY_LLM_FIRST: KEY_LLM_FIRST, XA_FEATURE: XA_FEATURE, PACK_ID: PACK_ID,
    getPref: getPref, setPref: setPref, effective: effective,
    gateActive: gateActive, runtimeAvailable: runtimeAvailable, packInstalled: packInstalled, localReady: localReady,
    kbOnlyNotice: kbOnlyNotice, route: route, install: install,
    settingsHTML: settingsHTML, wireSettings: wireSettings
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") { window.SMD_MAIK_ENGINE = API; installWhenReady(); }
})();
