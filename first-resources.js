/* StewardMD - first-run resource download (bug SMD-DVVJVN, owner 2026-09-27).
 *
 * "Like a game: the first time it asks to download resources, then downloads them by itself."
 * On the native app's first launch, once Home is actually on screen, this asks ONCE:
 *   - the voice model (on-device Whisper, the one dictation would use: SMD_VOICE.pickModel)
 *   - the MaiK on-device model best suited to THIS phone (SMD_MAIK_MODELS.recommend, "ok" only)
 * and on "Download now" queues both as background downloads (iOS background URLSession / Android
 * DownloadManager), so they finish with the app closed.
 *
 * Rules kept:
 *   - Nothing downloads without a tap (decision 2026-09-11): this IS the tap, asked once.
 *   - Never offer a pack the phone cannot run well: only recommend() level "ok"; if none, voice only.
 *   - Downloading does not change which engine answers. An installed pack is what the offline
 *     stand-in uses when there is no network; switching to it stays the clinician's choice.
 *   - "Not now" is remembered; everything stays available in Settings, MaiK, Who answers.
 * Flag: smd_first_resources ("0" turns it off; default on). Native only.
 */
(function () {
  "use strict";
  var G = window, D = document;
  var KEY_DONE = "smd_first_resources_asked";      // "yes" | "no": answered, never ask again
  var FLAG = "smd_first_resources";

  function lget(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { G.localStorage.setItem(k, v); } catch (e) {} }
  function on() { return lget(FLAG) !== "0"; }
  function native() { return !!(G.SMD_IS_NATIVE || (G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform())); }
  function mb(b) { return b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* What to offer. Resolves { voice: {key, bytes} | null, pack: {id, label, bytes} | null }. */
  function plan() {
    var out = { voice: null, pack: null };
    var V = G.SMD_VOICE, N = G.SMD_NATIVE;
    try {
      var key = V && V.pickModel ? V.pickModel("en") : null;
      var m = key && N && N.WHISPER_MODELS ? N.WHISPER_MODELS[key] : null;
      if (key && N && N.downloadWhisperModel) out.voice = { key: key, bytes: (m && m.bytes) || 0 };
    } catch (e) {}
    var M = G.SMD_MAIK_MODELS;
    var dev = (M && M.refreshDevice) ? Promise.resolve().then(function () { return M.refreshDevice(); }).catch(function () { return null; }) : Promise.resolve(null);
    return dev.then(function (d) {
      try {
        if (M && M.recommend) {
          var r = M.recommend({ medical: true }, d || (M.device && M.device())).recommended || [];
          var best = r.filter(function (x) { return x.level === "ok"; })[0];
          if (best) out.pack = { id: best.id, label: best.label, bytes: best.bytes, installed: !!best.installed };
        }
      } catch (e) {}
      // Anything already on the phone is not offered again.
      var checks = [];
      if (out.voice && N && N.whisperModelInstalled) checks.push(N.whisperModelInstalled(out.voice.key).then(function (r) { if (r && r.installed) out.voice = null; }, function () {}));
      if (out.pack && out.pack.installed) out.pack = null;
      return Promise.all(checks).then(function () { return out; });
    });
  }

  function css() {
    if (D.getElementById("frsCss")) return;
    var s = D.createElement("style"); s.id = "frsCss";
    s.textContent =
      "#frsSheet{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-end;justify-content:center;background:rgba(6,14,20,.45);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);--frs-f:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;font-family:var(--frs-f)}" +
      "#frsSheet .frs-in{width:100%;max-width:520px;background:var(--panel,#fff);color:var(--ink,#0f172a);border-radius:22px 22px 0 0;padding:22px 20px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -12px 40px rgba(0,0,0,.25);animation:frsUp .28s cubic-bezier(.2,.8,.2,1)}" +
      "@keyframes frsUp{from{transform:translateY(100%)}to{transform:none}}" +
      "#frsSheet h2{margin:0 0 6px;font:700 20px/1.25 var(--frs-f);letter-spacing:-.01em}" +
      "#frsSheet p{margin:0 0 14px;font:500 14px/1.45 var(--frs-f);color:var(--mut,#64748b)}" +
      "#frsSheet .frs-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line,#e2e8f0);border-radius:14px;margin-bottom:10px}" +
      "#frsSheet .frs-row input{width:22px;height:22px;accent-color:#0f766e;flex:0 0 auto}" +
      "#frsSheet .frs-row b{display:block;font:600 15px var(--frs-f)}#frsSheet .frs-row span{font:500 12.5px var(--frs-f);color:var(--mut,#64748b)}" +
      "#frsSheet .frs-tot{font:600 13px var(--frs-f);color:var(--mut,#64748b);margin:4px 2px 14px}" +
      "#frsSheet .frs-go{width:100%;min-height:50px;border:0;border-radius:14px;background:#0f766e;color:#fff;font:700 16px var(--frs-f);cursor:pointer}" +
      "#frsSheet .frs-go:disabled{opacity:.45}" +
      "#frsSheet .frs-later{width:100%;min-height:44px;border:0;background:none;color:var(--mut,#64748b);font:600 14.5px var(--frs-f);margin-top:6px;cursor:pointer}" +
      "html body.dark #frsSheet .frs-in,html body.v3-dark #frsSheet .frs-in{background:#141a22;color:#e8eef5}";
    D.head.appendChild(s);
  }

  function close() { var s = D.getElementById("frsSheet"); if (s && s.parentNode) s.parentNode.removeChild(s); }
  function toast(m) { try { (G.toast || G.SMD_toast || function () {})(m); } catch (e) {} }

  function show(p) {
    css(); close();
    var rows = "";
    if (p.voice) rows += '<label class="frs-row"><input type="checkbox" data-frs="voice" checked><div><b>Voice dictation</b><span>Speak notes, understood on your phone. ' + mb(p.voice.bytes) + "</span></div></label>";
    if (p.pack) rows += '<label class="frs-row"><input type="checkbox" data-frs="pack" checked><div><b>MaiK offline AI (' + esc(p.pack.label) + ")</b><span>Answers with no internet, chosen for this phone. " + mb(p.pack.bytes) + "</span></div></label>";
    var el = D.createElement("div"); el.id = "frsSheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "frsT");
    el.innerHTML = '<div class="frs-in"><h2 id="frsT">Get StewardMD ready for offline use?</h2>' +
      "<p>We fetch these once, in the background, so dictation and MaiK work even without internet. Wi-Fi is best. You can keep using the app meanwhile.</p>" +
      rows + '<div class="frs-tot" id="frsTot"></div>' +
      '<button type="button" class="frs-go" data-frs-act="go">Download now</button>' +
      '<button type="button" class="frs-later" data-frs-act="later">Not now</button></div>';
    D.body.appendChild(el);
    function total() {
      var t = 0;
      if (p.voice && el.querySelector('[data-frs="voice"]').checked) t += p.voice.bytes;
      if (p.pack && el.querySelector('[data-frs="pack"]').checked) t += p.pack.bytes;
      el.querySelector("#frsTot").textContent = t ? "Total " + mb(t) : "Nothing selected";
      el.querySelector(".frs-go").disabled = !t;
    }
    total();
    el.addEventListener("change", total);
    el.addEventListener("click", function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute("data-frs-act");
      if (e.target === el) a = "later";
      if (a === "later") { lset(KEY_DONE, "no"); close(); toast("You can download these any time in Settings, MaiK."); return; }
      if (a === "go") {
        var wantV = p.voice && el.querySelector('[data-frs="voice"]').checked, wantP = p.pack && el.querySelector('[data-frs="pack"]').checked;
        lset(KEY_DONE, "yes"); close(); start(wantV ? p.voice : null, wantP ? p.pack : null);
      }
    });
  }

  /* Queue the downloads. Both run natively in the background; progress lives in Settings, MaiK. */
  function start(voice, pack) {
    var N = G.SMD_NATIVE, M = G.SMD_MAIK_MODELS;
    if (voice && N && N.downloadWhisperModel) N.downloadWhisperModel(voice.key).then(function () { toast("Voice dictation is ready offline."); }, function () {});
    if (pack && M && M.ensure) M.ensure(pack.id).then(function () { toast("MaiK offline AI is ready."); }, function () {});
    toast("Downloading in the background. Keep using StewardMD.");
  }

  /* Ask only once Home is really what is on screen: never over the intro, the sign-in gate, the
   * disclaimer or another sheet. Polls cheaply for up to 3 minutes after launch, then gives up for
   * this session (it asks on a later launch). */
  var GATES = ["introPoster", "splash", "accountGate", "disclaimerModal", "introOverlay", "smdBootSplash", "phvRoot"];
  function homeReady() {
    var h = D.getElementById("homeV2"); if (!h || !h.classList.contains("on")) return false;
    for (var i = 0; i < GATES.length; i++) { var g = D.getElementById(GATES[i]); if (g && !g.classList.contains("hidden") && g.offsetParent !== null) return false; }
    if (D.body.classList.contains("maik-open")) return false;
    // Another sheet or dialog actually on screen (closed overlays keep their role, so check size).
    var dl = D.querySelectorAll(".hv-sheet.on, .smd-sheet.on, [role=dialog][aria-modal=true]:not(#frsSheet)");
    for (var j = 0; j < dl.length; j++) {
      var cs = G.getComputedStyle(dl[j]), r = dl[j].getBoundingClientRect();
      if (cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.05 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < G.innerHeight) return false;
    }
    return true;
  }
  function maybeAsk() {
    if (!on() || !native() || lget(KEY_DONE)) return;
    var t0 = Date.now(), timer = setInterval(function () {
      if (Date.now() - t0 > 180000 || lget(KEY_DONE)) { clearInterval(timer); return; }
      if (D.hidden || !homeReady()) return;
      clearInterval(timer);
      plan().then(function (p) {
        if (!p.voice && !p.pack) { lset(KEY_DONE, "yes"); return; }   // nothing to fetch on this phone
        if (homeReady()) show(p);
      });
    }, 2000);
  }

  G.SMD_FIRST_RESOURCES = { plan: plan, show: show, start: start, maybeAsk: maybeAsk, reset: function () { try { G.localStorage.removeItem(KEY_DONE); } catch (e) {} } };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", function () { setTimeout(maybeAsk, 3000); });
  else setTimeout(maybeAsk, 3000);
})();
