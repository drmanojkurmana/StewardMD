/* PrepNucleus Sound native adapter (rs-android-native): first-party playback on
   Android through the local @stewardmd/capacitor-prep-sound plugin
   (Capacitor.Plugins.PrepSound, foreground mediaPlayback service).
   window.PREP_SOUND_NATIVE. ES5.

   Selection rule (mirrored purely in prep-sound-core.js selectPlaybackBackend):
   native Android + plugin present -> this adapter; every other platform
   (web, iOS, Android without the plugin) -> the WebAudio player in
   prep-sound-web.js, unchanged. iOS therefore reports unsupported here.

   The adapter keeps the same synchronous surface as PREP_SOUND_WEB
   (start/pause/stop/setVolume/isPlaying/current/supported) so prep-sound-web.js
   can delegate without prep-sound.js changing. Native calls are promises
   underneath; start() returns { ok:true } once the command is issued and any
   rejection is surfaced through the optional onError callback, never logged
   with track metadata beyond the track id. No autoplay: start is only ever
   called from the controller's explicit user tap. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  var TRACK_IDS = ["rain_soft", "night_quiet", "deep_drone", "ocean_slow"];
  var TRACK_FILES = { rain_soft: "prep-sound/rain_soft.wav", night_quiet: "prep-sound/night_quiet.wav",
    deep_drone: "prep-sound/deep_drone.wav", ocean_slow: "prep-sound/ocean_slow.wav" };
  var SECRET_KEY_SHAPE = /^[A-Za-z0-9._-]{1,64}$/;

  function isTrackId(id) { return TRACK_IDS.indexOf(id) >= 0; }
  function clampVolume(v) {
    var n = Number(v);
    if (n == null || isNaN(n)) return 0.8;
    return Math.max(0, Math.min(1, n));
  }
  function validateSecretKey(key) { return typeof key === "string" && SECRET_KEY_SHAPE.test(key); }

  /* env: { platform, isNative, hasPlugin, webSupported } — all booleans except
     platform ("android" | "ios" | "web" | ...). Pure mirror of the runtime check. */
  function selectBackend(env) {
    env = env || {};
    if (env.platform === "android" && env.isNative && env.hasPlugin) return { backend: "native", reason: "android-plugin" };
    if (env.webSupported) return { backend: "web", reason: env.platform === "ios" ? "ios-web-fallback" : "web" };
    return { backend: "none", reason: "unsupported" };
  }
  function isNativeAndroidEnv(env) {
    env = env || {};
    return env.platform === "android" && !!env.isNative && !!env.hasPlugin;
  }
  function buildPlayOptions(trackId, volume, opts) {
    opts = opts || {};
    return { trackId: trackId, title: typeof opts.title === "string" ? opts.title : undefined,
      volume: clampVolume(volume == null ? 0.8 : volume),
      backgroundPlayback: opts.backgroundPlayback === true };
  }

  /* Adapter factory. plugin: Capacitor.Plugins.PrepSound-shaped object (mocked
     in tests). opts: { titleFor(trackId), onError(err), onStateChange(state) }. */
  function makeAdapter(plugin, opts) {
    opts = opts || {};
    var state = { playing: false, track: null, volume: 0.8 };
    function titleFor(id) {
      try { if (typeof opts.titleFor === "function") return opts.titleFor(id) || undefined; } catch (e) {}
      return undefined;
    }
    function fail(err) {
      state.playing = false;
      try { if (typeof opts.onError === "function") opts.onError(err); } catch (e) {}
      emit();
    }
    function emit() {
      try { if (typeof opts.onStateChange === "function") opts.onStateChange({ playing: state.playing, track: state.track }); } catch (e) {}
    }
    function call(method, arg) {
      try {
        var p = plugin[method](arg);
        if (p && typeof p.catch === "function") p.catch(fail);
        return p;
      } catch (e) { fail(e); return null; }
    }
    var adapter = {
      isNativeAvailable: function () { return !!plugin; },
      supported: function () { return !!plugin; },
      start: function (trackId, volume, playOpts) {
        if (!plugin) return { ok: false, error: "unsupported:native" };
        if (!isTrackId(trackId)) return { ok: false, error: "unknown-track" };
        var merged = playOpts || {};
        if (merged.title == null) merged.title = titleFor(trackId);
        state.track = trackId; state.playing = true; state.volume = clampVolume(volume == null ? state.volume : volume);
        call("play", buildPlayOptions(trackId, state.volume, merged));
        emit();
        return { ok: true };
      },
      pause: function () {
        if (!plugin) return { ok: false, error: "unsupported:native" };
        state.playing = false; call("pause", {}); emit(); return { ok: true };
      },
      stop: function () {
        if (!plugin) return { ok: false, error: "unsupported:native" };
        state.playing = false; state.track = null; call("stop", {}); emit(); return { ok: true };
      },
      setVolume: function (v) {
        if (!plugin) return { ok: false, error: "unsupported:native" };
        if (!state.playing && !state.track) return { ok: false, error: "not-playing" };
        state.volume = clampVolume(v); call("setVolume", { volume: state.volume }); return { ok: true };
      },
      isPlaying: function () { return state.playing; },
      current: function () { return state.track; },
      /* Refresh the cached state from the service (e.g. after a focus/noisy pause). */
      refreshStatus: function () {
        if (!plugin || typeof plugin.getStatus !== "function") return Promise.resolve({ ok: false, error: "unsupported:native" });
        return Promise.resolve(plugin.getStatus()).then(function (s) {
          if (s) { state.playing = !!s.playing; state.track = s.trackId || null; emit(); }
          return { ok: true, playing: state.playing, track: state.track };
        }, function (e) { return { ok: false, error: String((e && e.message) || e || "status-failed") }; });
      },
      /* Media keys are owned by the native MediaSession; handlers are invoked
         from the plugin's playbackStateChange events in the browser wiring. */
      bindMediaKeys: function (handlers) { adapter._mediaHandlers = handlers || {}; return { ok: true }; },
      _mediaHandlers: {},
      /* Secure storage passthrough (native Android only). Never logs values. */
      setSecret: function (key, value) {
        if (!plugin || typeof plugin.setSecret !== "function") return Promise.resolve({ ok: false, error: "unsupported:secure-storage" });
        if (!validateSecretKey(key)) return Promise.resolve({ ok: false, error: "invalid-key" });
        if (typeof value !== "string" || value.length > 8192) return Promise.resolve({ ok: false, error: "invalid-value" });
        return Promise.resolve(plugin.setSecret({ key: key, value: value })).then(
          function () { return { ok: true }; },
          function () { return { ok: false, error: "secure-store-failed" }; });
      },
      getSecret: function (key) {
        if (!plugin || typeof plugin.getSecret !== "function") return Promise.resolve({ ok: false, error: "unsupported:secure-storage" });
        if (!validateSecretKey(key)) return Promise.resolve({ ok: false, error: "invalid-key" });
        return Promise.resolve(plugin.getSecret({ key: key })).then(
          function (r) { return { ok: true, value: r && typeof r.value === "string" ? r.value : null }; },
          function () { return { ok: false, error: "secure-store-failed" }; });
      },
      removeSecret: function (key) {
        if (!plugin || typeof plugin.removeSecret !== "function") return Promise.resolve({ ok: false, error: "unsupported:secure-storage" });
        if (!validateSecretKey(key)) return Promise.resolve({ ok: false, error: "invalid-key" });
        return Promise.resolve(plugin.removeSecret({ key: key })).then(
          function () { return { ok: true }; },
          function () { return { ok: false, error: "secure-store-failed" }; });
      },
      _state: state
    };
    return adapter;
  }

  var PURE = { TRACK_IDS: TRACK_IDS, TRACK_FILES: TRACK_FILES, isTrackId: isTrackId,
    clampVolume: clampVolume, validateSecretKey: validateSecretKey, selectBackend: selectBackend,
    isNativeAndroidEnv: isNativeAndroidEnv, buildPlayOptions: buildPlayOptions, makeAdapter: makeAdapter };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  function plugin() {
    try {
      var C = G.Capacitor;
      if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return null;
      var platform = typeof C.getPlatform === "function" ? C.getPlatform() : null;
      if (platform !== "android") return null; // iOS: unsupported here, web path is used
      return (C.Plugins && C.Plugins.PrepSound) || null;
    } catch (e) { return null; }
  }
  function env() {
    var p = plugin();
    var platform = null;
    try { platform = G.Capacitor && typeof G.Capacitor.getPlatform === "function" ? G.Capacitor.getPlatform() : "web"; } catch (e) {}
    return { platform: platform || "web", isNative: !!p || nativeFlag(), hasPlugin: !!p,
      webSupported: !!(G.AudioContext || G.webkitAudioContext) };
  }
  function nativeFlag() {
    try { return !!(G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform()); } catch (e) { return false; }
  }
  function coreTitle(id) {
    try { var C = G.PREP_SOUND_CORE; var t = C && C.trackById(id); return t ? t.title : undefined; } catch (e) { return undefined; }
  }

  var live = makeAdapter(plugin(), { titleFor: coreTitle });
  // Keep the cached state honest when the service pauses itself (focus/noisy).
  try {
    var p = plugin();
    if (p && typeof p.addListener === "function") {
      p.addListener("playbackStateChange", function (d) {
        if (!d) return;
        live._state.playing = !!d.playing;
        live._state.track = d.trackId || null;
        var h = live._mediaHandlers || {};
        try {
          if (!d.playing && d.reason && d.reason !== "playing" && typeof h.pause === "function") h.pause();
        } catch (e) {}
      });
    }
  } catch (e) {}

  G.PREP_SOUND_NATIVE = { start: live.start, pause: live.pause, stop: live.stop,
    setVolume: live.setVolume, isPlaying: live.isPlaying, current: live.current,
    supported: live.supported, isNativeAvailable: live.isNativeAvailable,
    refreshStatus: live.refreshStatus, bindMediaKeys: live.bindMediaKeys,
    setSecret: live.setSecret, getSecret: live.getSecret, removeSecret: live.removeSecret,
    env: env, selectBackend: selectBackend, _pure: PURE, _adapter: live };
})(typeof window !== "undefined" ? window : this);
