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
      { id: "cloud", label: "MaiK Cloud", sub: "Best answers, uses AI tokens", badge: "PRO" },
      { id: "rag", label: "KB only", sub: "StewardMD knowledge base, no tokens", badge: "FREE" }
    ];
    var M = window.SMD_MAIK_MODELS;
    if (M && M.PACKS && gateActive() && runtimeAvailable()) {
      Object.keys(M.PACKS).forEach(function (pid) {
        var st = M.state(pid), have = M.installedCached(pid);
        out.push({
          id: "local:" + pid, label: M.PACKS[pid].label.replace(/\s*\(Q4_K_M\)$/, ""),
          sub: st.downloading ? "Downloading " + (st.frac * 100).toFixed(0) + "%"
             : have ? "On this device, works offline"
             : st.frac > 0 ? "Paused - tap to resume" : "Tap to download " + M.sizeLabel(pid),
          badge: "OFFLINE", pack: pid, needsDownload: !have && !st.downloading
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
    if (o) return o.label;
    return getPref() === "rag" ? "KB only" : "MaiK Cloud";
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

  function syncChip() {
    try {
      var el = document.getElementById("maikModelChipLbl");
      if (el) el.textContent = chipLabel();
    } catch (e) {}
  }

  /** Apply an option row id ("cloud" | "rag" | "local:<packId>"). */
  function selectOption(optId) {
    if (optId.indexOf("local:") === 0) {
      var pid = optId.slice(6);
      var M = window.SMD_MAIK_MODELS;
      if (M && M.setActivePack) M.setActivePack(pid);
      setPref("local");
    } else {
      setPref(optId);
    }
    syncChip();
    return currentOptionId();
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
          M2.ensure(chosen.pack, null).then(function () { toast("On-device model ready."); syncChip(); })
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

  var API = {
    KEY_ENGINE: KEY_ENGINE, KEY_LLM_FIRST: KEY_LLM_FIRST, XA_FEATURE: XA_FEATURE, PACK_ID: PACK_ID,
    getPref: getPref, setPref: setPref, effective: effective,
    gateActive: gateActive, runtimeAvailable: runtimeAvailable, packInstalled: packInstalled, localReady: localReady,
    kbOnlyNotice: kbOnlyNotice, route: route, install: install, activePack: activePack,
    settingsHTML: settingsHTML, wireSettings: wireSettings, modelRowHTML: modelRowHTML,
    options: options, currentOptionId: currentOptionId, chipLabel: chipLabel, chipHTML: chipHTML,
    selectOption: selectOption, openPicker: openPicker, closePicker: closePicker, wireChip: wireChip, syncChip: syncChip
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") { window.SMD_MAIK_ENGINE = API; installWhenReady(); }
})();
