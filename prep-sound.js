/* PrepNucleus Sound Dock (rs-sound, Phase 1): provider chooser, focus preset cards
   and first-party playback controls with external handoff. window.PREP_SOUND. ES5.
   Loaded by prep-loader.js after prep-sound-web.js (optional: without it nothing
   changes); draws through PREP._host. prep.js forwards every data-act starting
   "s-" here (except "sp-", owned by prep-sound-spotify.js), asks back() first,
   calls homeHtml() for the Sound section and leave() on close.
   Flag smd_prep_sound (requires smd_prep), default OFF: localStorage "1" or
   ?sound=1 turns it on; "0" or ?sound=0 keeps PREP_SOUND undefined.

   Honest by rule: external providers show an "opens the app" label and only an
   Open control — never play/next/volume for a session the OS owns. Music starts
   only from an explicit tap; hush() for video/TTS never resumes on its own. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  function CORE() { return (G && G.PREP_SOUND_CORE) || null; }
  function WEB() { return (G && G.PREP_SOUND_WEB) || null; }
  function PROV() { return (G && G.PREP_SOUND_PROVIDERS) || null; }

  /* ================= pure (node-testable HTML builders) ================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pathLabel(kind) { return kind === "embedded" ? "Plays inside PrepNucleus" : kind === "reserved" ? "Opens the app for now" : "Opens the app · PrepNucleus cannot control it"; }
  function statusText(st) {
    var C = CORE();
    if (!st.prefsEnabled) return "Sound is off.";
    if (st.sm === "playing_embedded") return "Playing " + (st.trackTitle || "ambience") + " · in PrepNucleus";
    if (st.sm === "paused" || st.sm === "interrupted") return "Paused" + (st.note ? " · " + st.note : "");
    if (st.sm === "playing_external") return "Playing in " + (st.providerName || "the music app") + " · PrepNucleus opened it";
    if (st.sm === "connecting") return "Opening " + (st.providerName || "provider") + "…";
    if (st.sm === "error") return "Something failed · " + (st.note || "try again");
    return "Ready · " + (st.providerName || "");
  }
  /* presetChips renders the app's own themed chips (pn-chip, .on when current) inside
     the PrepNucleus home so text stays AA in light AND dark; pass "pn-sound-chip" for
     the body-level dark sheet, which lives outside .pn-root where pn-chip has no rules.
     (Root cause rs-sound-ui#1: .pn-root button { color: inherit } beats the unscoped
     .pn-sound-btn/.pn-sound-chip, so the home controls inherited dark-navy ink on the
     dark fill in the light theme.) */
  function presetChips(presets, current, cls) {
    var chip = cls || "pn-sound-chip";
    return '<div class="pn-sound-chips" role="group" aria-label="Focus presets">' + presets.map(function (p) {
      var on = current === p.id;
      return '<button type="button" class="' + chip + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="s-preset" data-v="' + esc(p.id) + '">' + esc(p.title) + "</button>";
    }).join("") + "</div>";
  }
  function homeSectionHtml(o) {
    var inner;
    if (!o.prefsEnabled) {
      inner = '<p class="pn-sound-status">' + esc(statusText({ prefsEnabled: false })) + ' Optional focus ambience. Nothing plays until you tap.</p>' +
        '<button type="button" class="pn-btn pri" data-act="s-enable">Enable Sound</button>';
    } else {
      inner = '<p class="pn-sound-status" role="status">' + esc(statusText(o)) + "</p>" + presetChips(o.presets, o.preset, "pn-chip") +
        '<div class="pn-sound-homerow"><button type="button" class="pn-btn" data-act="s-open">Providers and settings</button>' +
        '<button type="button" class="pn-sound-link" data-act="s-disable">Turn off</button></div>';
    }
    return '<h2 class="pn-h">Sound</h2><div class="pn-group pn-sound-home">' + inner + "</div>";
  }
  function dockHtml(o) {
    var c = o.controls;
    var btn = "";
    if (c.play) btn += '<button type="button" class="pn-sound-dbtn" data-act="s-play" aria-label="Play"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></button>';
    if (c.pause) btn += '<button type="button" class="pn-sound-dbtn" data-act="s-pause" aria-label="Pause"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg></button>';
    var label = o.providerKind === "embedded"
      ? (o.trackTitle || "Ambience") + " · PrepNucleus"
      : "In " + (o.providerName || "music app") + " · external";
    return '<div class="pn-sound-dock" role="region" aria-label="Sound">' +
      btn +
      '<button type="button" class="pn-sound-dlabel" data-act="s-open" aria-label="Open Sound settings"><b>' + esc(label) + "</b><small>" + esc(o.hint || "Tap for providers") + "</small></button>" +
      (c.stop ? '<button type="button" class="pn-sound-dbtn" data-act="s-stop" aria-label="Stop"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>' : "") +
      "</div>";
  }
  function providerRows(providers) {
    return providers.map(function (p) {
      var use = p.kind === "embedded"
        ? '<button type="button" class="pn-sound-btn sm" data-act="s-provider" data-v="' + esc(p.id) + '">Use</button>'
        : '<button type="button" class="pn-sound-btn sm" data-act="s-home" data-v="' + esc(p.id) + '">Open</button>';
      return '<li class="pn-sound-prov"><span class="pn-sound-pname">' + esc(p.name) + '<small>' + esc(pathLabel(p.kind)) + "</small></span>" + use + "</li>";
    }).join("");
  }
  function sheetHtml(o) {
    var C = CORE();
    var ext = o.provider && o.provider.kind !== "embedded";
    var ctl = '<div class="pn-sound-ctl">';
    if (o.controls.play) ctl += '<button type="button" class="pn-sound-dbtn lg" data-act="s-play" aria-label="Play"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></button>';
    if (o.controls.pause) ctl += '<button type="button" class="pn-sound-dbtn lg" data-act="s-pause" aria-label="Pause"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg></button>';
    ctl += '<span class="pn-sound-now"><b>' + esc(o.trackTitle || o.providerName || "Sound") + "</b><small>" + esc(ext ? "External playback — use the music app for controls" : statusText(o)) + "</small></span>";
    if (o.controls.stop) ctl += '<button type="button" class="pn-sound-dbtn" data-act="s-stop" aria-label="Stop"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>';
    ctl += "</div>";
    var vol = o.controls.volume
      ? '<label class="pn-sound-vol">Volume <input type="range" min="0" max="100" value="' + Math.round(o.volume * 100) + '" data-svol="1" aria-label="Volume"></label>' : "";
    var share = ext
      ? '<div class="pn-sound-share"><label>Open a ' + esc(o.providerName) + ' link <input type="url" name="sound-share-url" autocomplete="off" inputmode="url" placeholder="Paste link, e.g. https://…" data-sshare="1" aria-label="Provider link"></label>' +
        '<button type="button" class="pn-sound-btn sm" data-act="s-share" data-v="' + esc(o.provider.id) + '">Open link</button>' +
        (o.shareMsg ? '<p class="pn-sound-msg" role="status">' + esc(o.shareMsg) + "</p>" : "") + "</div>" : "";
    var prefs = '<div class="pn-sound-prefs">' +
      '<button type="button" class="pn-sound-toggle" aria-pressed="' + !!o.prefs.pauseBeforeVideo + '" data-act="s-pref" data-v="pauseBeforeVideo"><i aria-hidden="true"></i>Pause before videos</button>' +
      '<button type="button" class="pn-sound-toggle" aria-pressed="' + !!o.prefs.backgroundPlayback + '" data-act="s-pref" data-v="backgroundPlayback"><i aria-hidden="true"></i>Keep playing in background</button></div>';
    return '<button type="button" class="pn-sound-scrim" data-act="s-close" aria-label="Close Sound"></button>' +
      '<div class="pn-sound-sheet" role="dialog" aria-modal="true" aria-label="Sound">' +
      '<div class="pn-sound-sheeth"><h2>Sound</h2><button type="button" class="pn-sound-dbtn" data-act="s-close" aria-label="Close">✕</button></div>' +
      ctl + vol +
      '<h3>Providers</h3><ul class="pn-sound-provs">' + providerRows(o.providers) + "</ul>" +
      '<h3>Focus presets <small>original ambience, made on this device</small></h3>' + presetChips(o.presets, o.preset) +
      share + prefs +
      '<div class="pn-sound-homerow"><button type="button" class="pn-sound-link" data-act="s-disable">Turn off</button>' +
      '<button type="button" class="pn-sound-link" data-act="s-disconnect">Stop and disconnect</button></div>' +
      "</div>";
  }

  var PURE = { esc: esc, pathLabel: pathLabel, statusText: statusText, presetChips: presetChips, homeSectionHtml: homeSectionHtml, dockHtml: dockHtml, providerRows: providerRows, sheetHtml: sheetHtml };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var C = CORE();
  try { var qf = (G.location.search.match(/[?&]sound=([^&]+)/) || [])[1]; if (qf === "0" || (qf == null && G.localStorage.getItem("smd_prep_sound") !== "1")) return; } catch (e) { return; }
  try { if (G.PREP_LOADER && !G.PREP_LOADER.enabled()) return; } catch (e) {}
  if (!C || !WEB() || !PROV()) return;

  var D = G.document, H = null;
  var LS_KEY = "smd_prep_sound_prefs";
  function loadPrefs() {
    try { var raw = JSON.parse(G.localStorage.getItem(LS_KEY) || "null"); return C.migratePrefs(raw); }
    catch (e) { return C.defaultPrefs(); }
  }
  function savePrefs() { try { G.localStorage.setItem(LS_KEY, JSON.stringify(S.prefs)); } catch (e) {} }
  var S = { prefs: loadPrefs(), sm: "idle", provider: "first_party", preset: "deep_focus", track: null, note: "", sheet: false, shareMsg: "", volume: 0.8 };
  if (S.prefs.preferredProvider && S.prefs.preferredProvider !== "first_party") S.provider = "first_party"; // external sessions never survive a restart
  S.preset = S.prefs.preferredPreset || "deep_focus";
  /* Root cause rs-sound-ui#4b: "idle" exposes no Play control and the machine rejects
     PLAY there, so the sheet after s-open could never start audio. Enabling Sound
     selects the first-party provider, which lands on "ready" — still silent until an
     explicit tap (PLAY is the only path to sound). */
  if (S.prefs.enabled) S.sm = "ready";
  var dockEl = null, sheetEl = null;

  function provider() { return C.providerById(S.provider) || C.providerById("first_party"); }
  function trackTitle() { var t = S.track && C.trackById(S.track); return t ? t.title : ""; }
  function controls() { return C.visibleControls(S.provider, S.sm); }
  function applyMachine(ev) {
    var r = C.transition(S.sm, ev), i;
    S.sm = r.state;
    for (i = 0; i < r.effects.length; i++) {
      var fx = r.effects[i];
      if (fx === "stop-audio") { try { WEB().stop(); } catch (e) {} }
      else if (fx === "start-embedded") {
        var pr = S.preset && C.presetById(S.preset);
        S.track = pr ? pr.track : "night_quiet";
        var res = WEB().start(S.track, S.volume);
        if (!res.ok) { S.sm = "error"; S.note = "Audio is not available on this device."; }
      }
      else if (fx === "open-url") { openProviderHome(S.provider); S.sm = "playing_external"; }
      else if (fx.indexOf("note:") === 0) S.note = fx.slice(5);
    }
    savePrefs();
    render();
  }
  function openProviderHome(id) {
    var r = C.handoffHome(id);
    if (!r.ok) { S.sm = "error"; S.note = "No verified link for this provider."; render(); return; }
    try { G.open(r.url, "_blank", "noopener"); } catch (e) { S.sm = "error"; S.note = "Could not open the link."; }
  }
  function state() {
    return { prefsEnabled: S.prefs.enabled, sm: S.sm, note: S.note, preset: S.preset, presets: C.PRESETS,
      provider: provider(), providerName: provider().name, providerKind: provider().kind, trackTitle: trackTitle(),
      controls: controls(), volume: S.volume, prefs: S.prefs, providers: C.PROVIDERS.filter(function (p) { return p.kind !== "reserved" || PROV().getAdapter("spotify_remote"); }), shareMsg: S.shareMsg };
  }

  /* ---------- dock + sheet (body-level: prep.js paint() repaints root) ---------- */
  function ensureDock() {
    if (dockEl || !S.prefs.enabled) return;
    dockEl = D.createElement("div");
    dockEl.className = "pn-sound-layer";
    D.body.appendChild(dockEl);
    dockEl.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!b) return;
      onAct(b.getAttribute("data-act"), b);
    });
    dockEl.addEventListener("input", function (e) {
      if (e.target && e.target.getAttribute("data-svol") === "1") {
        S.volume = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
        try { WEB().setVolume(S.volume); } catch (x) {}
      }
    });
    /* The dock lives outside prep.js root, so root's Escape/back handling never
       fires here: Escape closes the sheet, and Tab cycles inside the modal sheet
       while it is open (WCAG SC 2.1.2 — no uncontained modal focus). */
    dockEl.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && S.sheet) { if (e.preventDefault) e.preventDefault(); onAct("s-close", null); return; }
      if (e.key !== "Tab" || !S.sheet || !sheetEl) return;
      var f = sheetEl.querySelectorAll ? sheetEl.querySelectorAll("button, input, [tabindex]") : [];
      var list = [], i;
      for (i = 0; i < f.length; i++) if (!f[i].disabled) list.push(f[i]);
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1], active = D.activeElement;
      if (e.shiftKey && active === first) { if (e.preventDefault) e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { if (e.preventDefault) e.preventDefault(); first.focus(); }
    });
  }
  function render() {
    ensureDock();
    if (dockEl) {
      var show = S.prefs.enabled && (S.sm === "ready" || S.sm === "playing_embedded" || S.sm === "paused" || S.sm === "interrupted" || S.sm === "playing_external" || S.sm === "connecting");
      var st = state();
      st.hint = S.sm === "interrupted" ? "Paused — tap play to resume" : S.sm === "playing_external" ? "External · tap for providers" : "Tap for providers";
      dockEl.innerHTML = (show ? dockHtml(st) : "") + (S.sheet ? sheetHtml(st) : "");
      sheetEl = S.sheet ? dockEl.querySelector(".pn-sound-sheet") : null;
      if (S.sheet && sheetEl) { var c = sheetEl.querySelector("[data-act=s-close]"); if (c) c.focus(); }
      else if (S.wantFocus) { S.wantFocus = false; var dl = dockEl.querySelector(".pn-sound-dlabel"); if (dl) dl.focus(); }
    }
    if (H) { try { if (H.stackTop && H.stackTop() === H.home) H.rerender(); } catch (e) {} }
  }

  function startPreset(id) {
    var p = C.presetById(id);
    if (!p) return;
    S.prefs.enabled = true;
    S.provider = "first_party"; S.preset = id; S.prefs.preferredPreset = id; S.note = ""; S.shareMsg = "";
    if (S.sm === "idle" || S.sm === "error") S.sm = "ready";
    applyMachine({ t: "PLAY" });
  }
  function togglePlay() {
    if (S.sm === "playing_embedded") applyMachine({ t: "PAUSE" });
    else if (S.sm === "paused" || S.sm === "interrupted" || S.sm === "ready") applyMachine({ t: "PLAY" });
  }
  /* Coordination for PrepReels video / lesson TTS / anything with its own audio:
     pause first-party sound and remember nothing that auto-resumes. -> true if paused. */
  function hush(reason) {
    if (S.sm === "playing_embedded") {
      applyMachine({ t: "HUSH" });
      S.note = reason === "video" ? "Paused for video — tap play to resume" : "Paused — tap play to resume";
      render();
      return true;
    }
    return false;
  }

  function onAct(a, b) {
    var v = b && b.getAttribute ? b.getAttribute("data-v") : null;
    switch (a) {
      case "s-enable": S.prefs.enabled = true; S.provider = "first_party"; S.note = ""; S.shareMsg = "";
        applyMachine({ t: "ENABLE" }); applyMachine({ t: "SELECT_PROVIDER", provider: "first_party" }); return;
      case "s-disable": S.prefs.enabled = false; applyMachine({ t: "STOP" }); S.sheet = false; render(); return;
      case "s-open": S.sheet = true; S.shareMsg = ""; render(); return;
      case "s-close": S.sheet = false; S.shareMsg = ""; S.wantFocus = true; render(); return;
      case "s-play": togglePlay(); return;
      case "s-pause": togglePlay(); return;
      case "s-stop": S.sheet = false; applyMachine({ t: "STOP" }); return;
      case "s-disconnect": S.sheet = false; S.provider = "first_party"; applyMachine({ t: "DISCONNECT" }); return;
      case "s-preset": startPreset(v); return;
      case "s-provider": {
        S.prefs.enabled = true;
        if (v === "first_party") { S.provider = "first_party"; S.sm = "ready"; S.note = ""; savePrefs(); render(); return; }
        var meta = C.providerById(v);
        if (!meta || (meta.kind !== "external" && !(meta.kind === "reserved" && PROV().getAdapter("spotify_remote")))) return;
        S.provider = v; S.note = ""; S.shareMsg = "";
        applyMachine({ t: "SELECT_PROVIDER", provider: v });
        // Machine lands on connecting + open-url effect; do the open here for the gesture.
        if (meta.kind === "external") { openProviderHome(v); S.sm = "playing_external"; savePrefs(); render(); }
        return;
      }
      case "s-home": openProviderHome(v); S.sm = "playing_external"; savePrefs(); render(); return;
      case "s-share": {
        var inp = dockEl && dockEl.querySelector("[data-sshare]");
        var r = C.handoffShare(v, inp && inp.value);
        if (r.ok) { try { G.open(r.url, "_blank", "noopener"); } catch (e) {} S.shareMsg = "Opened. Playback stays in the provider app."; S.sm = "playing_external"; }
        else S.shareMsg = "That link does not match this provider's official format.";
        savePrefs(); render(); return;
      }
      case "s-search": {
        var q = dockEl && dockEl.querySelector("[data-ssearch]");
        var rs = C.handoffSearch(v, q && q.value);
        if (rs.ok) { try { G.open(rs.url, "_blank", "noopener"); } catch (e) {} S.shareMsg = "Opened search. Playback stays in the provider app."; }
        else S.shareMsg = "Search links are not verified for this provider — open the app instead.";
        render(); return;
      }
      case "s-pref":
        if (v === "pauseBeforeVideo" || v === "backgroundPlayback") { S.prefs[v] = !S.prefs[v]; savePrefs(); render(); }
        return;
    }
  }

  function boot(h) {
    H = h;
    try {
      WEB().bindMediaKeys({ play: function () { togglePlay(); }, pause: function () { togglePlay(); }, stop: function () { applyMachine({ t: "STOP" }); } });
    } catch (e) {}
    try {
      D.addEventListener("visibilitychange", function () {
        if (D.visibilityState === "hidden" && S.sm === "playing_embedded" && !S.prefs.backgroundPlayback) applyMachine({ t: "APP_HIDDEN", background: false });
      });
    } catch (e) {}
    render();
  }
  function homeHtml(h) { H = H || h; var st = state(); return homeSectionHtml(st); }
  function act(a, b, h) { if (h) H = h; onAct(a, b); }
  function back() { if (S.sheet) { S.sheet = false; S.shareMsg = ""; S.wantFocus = true; render(); return true; } return false; }
  function leave() {
    try { WEB().stop(); } catch (e) {}
    S.sm = "idle"; S.sheet = false;
    try { if (dockEl && dockEl.parentNode) dockEl.parentNode.removeChild(dockEl); } catch (e) {}
    dockEl = null;
  }

  G.PREP_SOUND = { act: act, back: back, leave: leave, open: function (h) { boot(h); S.sheet = true; render(); }, bind: boot, homeHtml: homeHtml,
    pauseForVideo: function () { return hush("video"); }, hushForTts: function () { return hush("tts"); }, hush: hush,
    isPlaying: function () { return S.sm === "playing_embedded"; }, enabled: function () { return S.prefs.enabled; },
    _pure: PURE, _s: S };
})(typeof window !== "undefined" ? window : this);
