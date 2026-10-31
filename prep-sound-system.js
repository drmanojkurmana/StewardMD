/* PrepNucleus Sound — system media adapter (job rs-android-media, Android only).
   window.PREP_SOUND_SYSTEM. ES5.

   Shows and controls whatever music app is already playing on this phone
   (Gaana, JioSaavn, Amazon Music, YouTube Music, Spotify, ...) by reading
   that app's MediaSession through the PrepSound plugin
   (MediaSessionManager.getActiveSessions). Android only: iOS forbids
   reading other apps' playback, and a web page cannot do it either, so on
   web/iOS this adapter is inert and reports unsupported.

   Permission: the user enables PrepNucleus under Settings > Notification
   access. The native listener service reads NO notification content; it
   exists only so getActiveSessions is allowed. The card copy is
   PERMISSION_EXPLANATION below.

   Output contract (rendered by the Sound player UI, another job):
     model { provider:"system", providerLabel:<app label>, title, artist,
             album, artworkUrl, durationMs, positionMs, isPlaying,
             shuffle:null, repeat:null, liked:null, volume:null }
     caps  { play, pause, next, previous, seek, shuffle:false,
             repeat:false, like:false, volume:false, artwork }
   model is null when no other-app session is active.

   Privacy: now-playing values are never written to storage, analytics or
   the AI Tutor. This file holds no store and sends nothing anywhere; the
   model lives only in the caller's hands. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  var PERMISSION_EXPLANATION = "Lets PrepNucleus show and control the song playing in your music app. PrepNucleus does not read your notifications.";
  var ACTIONS = ["play", "pause", "next", "previous", "seek"];

  function emptyCaps() {
    return { play: false, pause: false, next: false, previous: false, seek: false,
      shuffle: false, repeat: false, like: false, volume: false, artwork: false };
  }
  function ms(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n);
  }
  function text(v) { return typeof v === "string" && v ? v : ""; }

  /* Native nowPlaying payload -> player model. Returns null with no session. */
  function toModel(raw) {
    if (!raw || raw.hasSession !== true) return null;
    var artworkUrl = typeof raw.artwork === "string" && raw.artwork ? raw.artwork : null;
    return {
      provider: "system",
      providerLabel: text(raw.app) || text(raw.package) || "Music app",
      title: text(raw.title),
      artist: text(raw.artist),
      album: text(raw.album),
      artworkUrl: artworkUrl,
      durationMs: ms(raw.durationMs),
      positionMs: ms(raw.positionMs),
      isPlaying: raw.isPlaying === true,
      shuffle: null, repeat: null, liked: null, volume: null
    };
  }
  /* PlaybackState action bits (already decoded natively) -> caps. Only
     play/pause/next/previous/seek/artwork can ever be true; the rest stay
     honestly false so the UI hides shuffle/repeat/like/volume. */
  function toCaps(raw) {
    var caps = emptyCaps();
    if (!raw || raw.hasSession !== true) return caps;
    var a = raw.actions || {};
    caps.play = a.play === true;
    caps.pause = a.pause === true;
    caps.next = a.next === true;
    caps.previous = a.previous === true;
    caps.seek = a.seek === true;
    caps.artwork = typeof raw.artwork === "string" && !!raw.artwork;
    return caps;
  }
  function toSnapshot(raw) { return { model: toModel(raw), caps: toCaps(raw) }; }

  /* env: { platform, isNative, hasPlugin }. Only native Android with the
     PrepSound plugin can read other apps' sessions. */
  function isSupportedEnv(env) {
    env = env || {};
    return env.platform === "android" && !!env.isNative && !!env.hasPlugin;
  }
  function errCode(e) {
    if (!e) return "unknown";
    if (typeof e === "string") return e;
    return String(e.code || e.message || "unknown");
  }

  /* Adapter factory. plugin: Capacitor.Plugins.PrepSound-shaped object
     (mocked in tests); env as above. Every async method resolves a typed
     result and never throws, so the UI can render a state for each. */
  function makeAdapter(plugin, env) {
    var supported = !!plugin && isSupportedEnv(env || { platform: "android", isNative: true, hasPlugin: true });

    function unsupported(op) {
      return Promise.resolve({ ok: false, supported: false, error: "unsupported:system:" + op });
    }
    var adapter = {
      PERMISSION_EXPLANATION: PERMISSION_EXPLANATION,
      supported: function () { return supported; },

      /* Permission-card state:
         { supported:false, granted:false, state:"unsupported", explanation }
         { supported:true, granted:false, state:"needs-access", explanation }
         { supported:true, granted:true, hasSession, state:"no-session"|"ready", explanation } */
      status: function () {
        if (!supported || typeof plugin.mediaAccessStatus !== "function") {
          return Promise.resolve({ supported: false, granted: false, hasSession: false,
            state: "unsupported", explanation: PERMISSION_EXPLANATION });
        }
        return Promise.resolve(plugin.mediaAccessStatus()).then(function (s) {
          var granted = !!(s && s.granted === true);
          if (!granted) return { supported: true, granted: false, hasSession: false,
            state: "needs-access", explanation: PERMISSION_EXPLANATION };
          if (typeof plugin.nowPlaying !== "function") return { supported: true, granted: true,
            hasSession: false, state: "no-session", explanation: PERMISSION_EXPLANATION };
          return Promise.resolve(plugin.nowPlaying()).then(function (raw) {
            var has = !!(raw && raw.hasSession === true);
            return { supported: true, granted: true, hasSession: has,
              state: has ? "ready" : "no-session", explanation: PERMISSION_EXPLANATION };
          }, function () {
            return { supported: true, granted: true, hasSession: false,
              state: "no-session", explanation: PERMISSION_EXPLANATION };
          });
        }, function (e) {
          return { supported: true, granted: false, hasSession: false,
            state: "needs-access", explanation: PERMISSION_EXPLANATION, error: errCode(e) };
        });
      },

      /* Opens Settings > Notification access (native). The user grants
         there; call status() again when the app returns to foreground. */
      requestAccess: function () {
        if (!supported || typeof plugin.openMediaAccessSettings !== "function") return unsupported("requestAccess");
        return Promise.resolve(plugin.openMediaAccessSettings()).then(
          function () { return { ok: true, supported: true }; },
          function (e) { return { ok: false, supported: true, error: errCode(e) }; });
      },

      /* Current snapshot: { ok, supported, granted, model, caps }. */
      nowPlaying: function () {
        if (!supported || typeof plugin.nowPlaying !== "function") {
          return Promise.resolve({ ok: false, supported: false, granted: false,
            model: null, caps: emptyCaps(), error: "unsupported:system:nowPlaying" });
        }
        return Promise.resolve(plugin.nowPlaying()).then(function (raw) {
          var snap = toSnapshot(raw);
          return { ok: true, supported: true, granted: !(raw && raw.granted === false),
            model: snap.model, caps: snap.caps };
        }, function (e) {
          return { ok: false, supported: true, granted: false, model: null,
            caps: emptyCaps(), error: errCode(e) };
        });
      },

      /* control("play"|"pause"|"next"|"previous"|"seek", seekMs?). */
      control: function (action, value) {
        if (ACTIONS.indexOf(action) < 0) {
          return Promise.resolve({ ok: false, supported: supported, error: "unsupported:system:" + String(action || "") });
        }
        if (!supported || typeof plugin.control !== "function") return unsupported(action);
        var arg = { action: action };
        if (action === "seek") arg.value = ms(value);
        return Promise.resolve(plugin.control(arg)).then(
          function () { return { ok: true, supported: true, action: action }; },
          function (e) { return { ok: false, supported: true, action: action, error: errCode(e) }; });
      },
      play: function () { return adapter.control("play"); },
      pause: function () { return adapter.control("pause"); },
      next: function () { return adapter.control("next"); },
      previous: function () { return adapter.control("previous"); },
      seek: function (positionMs) { return adapter.control("seek", positionMs); },

      /* Subscribe to nowPlayingChanged. cb receives { model, caps }.
         Returns an unsubscribe function. The native side unregisters its
         MediaController callback when the last listener is removed (and
         when the app backgrounds), so nothing is observed while nobody
         in JS is listening. */
      subscribe: function (cb) {
        if (!supported || typeof cb !== "function" || typeof plugin.addListener !== "function") {
          return function () {};
        }
        var removed = false, handle = null;
        function deliver(raw) { if (!removed) { try { cb(toSnapshot(raw)); } catch (e) {} } }
        try {
          var pending = plugin.addListener("nowPlayingChanged", deliver);
          if (pending && typeof pending.then === "function") {
            pending.then(function (h) { handle = h; if (removed && h && h.remove) h.remove(); },
              function () {});
          } else { handle = pending; }
        } catch (e) {}
        return function () {
          removed = true;
          // If the handle promise has not resolved yet, the .then above
          // removes it on arrival; handle.remove() only ever detaches this
          // one listener, never the plugin's other events.
          try { if (handle && typeof handle.remove === "function") handle.remove(); } catch (e) {}
        };
      }
    };
    adapter.getNowPlaying = adapter.nowPlaying;
    adapter.onNowPlayingChanged = adapter.subscribe;
    return adapter;
  }

  var PURE = { PERMISSION_EXPLANATION: PERMISSION_EXPLANATION, ACTIONS: ACTIONS,
    emptyCaps: emptyCaps, toModel: toModel, toCaps: toCaps, toSnapshot: toSnapshot,
    isSupportedEnv: isSupportedEnv, makeAdapter: makeAdapter };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  function detectPlugin() {
    try {
      var C = G.Capacitor;
      if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return null;
      if (typeof C.getPlatform === "function" && C.getPlatform() !== "android") return null;
      var p = (C.Plugins && C.Plugins.PrepSound) || null;
      // A plugin predating rs-android-media has no system-media methods.
      return p && typeof p.mediaAccessStatus === "function" ? p : null;
    } catch (e) { return null; }
  }
  function detectEnv(p) {
    var platform = "web";
    try { platform = (G.Capacitor && G.Capacitor.getPlatform && G.Capacitor.getPlatform()) || "web"; } catch (e) {}
    var isNative = false;
    try { isNative = !!(G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform()); } catch (e) {}
    return { platform: platform, isNative: isNative, hasPlugin: !!p };
  }

  var plugin = detectPlugin();
  var live = makeAdapter(plugin, detectEnv(plugin));
  G.PREP_SOUND_SYSTEM = { supported: live.supported, status: live.status,
    requestAccess: live.requestAccess, nowPlaying: live.nowPlaying,
    getNowPlaying: live.getNowPlaying, control: live.control,
    play: live.play, pause: live.pause, next: live.next, previous: live.previous,
    seek: live.seek, subscribe: live.subscribe,
    onNowPlayingChanged: live.onNowPlayingChanged,
    PERMISSION_EXPLANATION: PERMISSION_EXPLANATION, _pure: PURE, _adapter: live };
})(typeof window !== "undefined" ? window : this);
