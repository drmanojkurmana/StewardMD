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
    // Owner/QA escape hatch, same convention as the NMC verify bypass: lets the on-device engine be
    // tested on a real device BEFORE the server-side FEATURES entry for maik_local is deployed
    // (SMD_XACCESS.devBypass only covers non-native, non-prod). Set it in the WebView console:
    //   localStorage.setItem("smd_maik_local_bypass","1")
    try { if (lget("smd_maik_local_bypass") === "1") return true; } catch (e) {}
    try { return !!(window.SMD_XACCESS && window.SMD_XACCESS.isActiveCached && window.SMD_XACCESS.isActiveCached(XA_FEATURE)); } catch (e) { return false; }
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

  function modelRowHTML() {
    var M = window.SMD_MAIK_MODELS;
    // Defensive: this renders inside the Settings panel, so a missing/older model module must
    // degrade to "no section" rather than throw and blank every setting below it.
    if (!M || !M.PACKS || !M.state || !M.sizeLabel) return "";
    var active = M.activePack ? M.activePack() : PACK_ID;
    var ids = Object.keys(M.PACKS);
    if (!ids.length) return "";

    var rows = ids.map(function (id, i) {
      var p = M.PACKS[id];
      var on = id === active;
      var have = M.installedCached(id);
      var st = M.state(id);
      var size = M.sizeLabel(id);

      var status;
      if (st.downloading) status = (st.frac * 100).toFixed(1) + "% of " + size +
        (st.mbps ? " · " + st.mbps.toFixed(1) + " MB/s" : "") + (st.etaS != null ? " · " + fmtETA(st.etaS) : "");
      else if (have) status = "Downloaded · " + size;
      else if (st.err) status = st.note + " · tap Download to resume";
      else if (st.frac > 0) status = "Paused at " + (st.frac * 100).toFixed(1) + "% · tap Download to resume";
      else status = "Not downloaded · " + size;

      var bar = (st.downloading || (st.frac > 0 && !have))
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
        '<div style="display:flex;gap:8px;margin-top:9px">' +
          (st.downloading
            ? '<button class="smd-nav-btn" data-me-model="pause" data-me-id="' + id + '" style="margin:0;flex:1">Pause</button>'
            : '<button class="smd-nav-btn" data-me-model="download" data-me-id="' + id + '" style="margin:0;flex:1">' + (have ? "Verify" : (st.frac > 0 ? "Resume" : "Download")) + '</button>') +
          (have || st.frac > 0 ? '<button class="smd-nav-btn" data-me-model="delete" data-me-id="' + id + '" style="margin:0;flex:1">Delete</button>' : "") +
        '</div>' +
      '</div>';
    }).join("");

    return '<div class="smd-nav-lbl" style="margin:14px 0 6px">On-device model</div>' +
      '<div role="radiogroup" aria-label="On-device model" style="border:1px solid var(--line,#e2e8f0);border-radius:14px;overflow:hidden;background:var(--card,#fff)">' + rows + '</div>' +
      '<div class="smd-nav-note" style="margin-top:6px">Downloads over Wi-Fi or mobile data and resumes if interrupted. You can leave this screen; the download keeps going.</div>';
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
        if (want === "local" && !gateActive()) { toast("Enter an access code under Experimental Features to try the on-device model."); return; }
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

  var API = {
    KEY_ENGINE: KEY_ENGINE, KEY_LLM_FIRST: KEY_LLM_FIRST, XA_FEATURE: XA_FEATURE, PACK_ID: PACK_ID,
    getPref: getPref, setPref: setPref, effective: effective,
    gateActive: gateActive, runtimeAvailable: runtimeAvailable, packInstalled: packInstalled, localReady: localReady,
    kbOnlyNotice: kbOnlyNotice, route: route, install: install, activePack: activePack,
    settingsHTML: settingsHTML, wireSettings: wireSettings, modelRowHTML: modelRowHTML
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") { window.SMD_MAIK_ENGINE = API; installWhenReady(); }
})();
