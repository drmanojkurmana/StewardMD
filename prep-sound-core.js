/* PrepNucleus Sound core (rs-sound): provider-neutral state machine, capability model,
   preference object (plan section 10), verified handoff-link builders and the
   first-party track/preset catalogue. window.PREP_SOUND_CORE. ES5.
   Loaded by prep-loader.js after prep.js (optional: without it nothing changes).
   No DOM, no network, no audio: everything here runs under node for tests. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  var FLAG = "smd_prep_sound", MASTER_FLAG = "smd_prep", SPOTIFY_FLAG = "smd_prep_sound_spotify";

  /* Preference object, plan section 10. autoResume stays false; backgroundPlayback
     stays false unless the user explicitly enables it; nothing here records history. */
  var PREFS_V = 1;
  var DEFAULT_PREFS = { v: PREFS_V, enabled: false, preferredProvider: "first_party", preferredPreset: "deep_focus", autoResume: false, backgroundPlayback: false, pauseBeforeVideo: true };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function defaultPrefs() { return clone(DEFAULT_PREFS); }
  /* Migrate anything stored towards the current shape; unknown input resets to defaults. */
  function migratePrefs(raw) {
    var d = defaultPrefs();
    if (!raw || typeof raw !== "object") return d;
    var p = clone(d);
    if (typeof raw.enabled === "boolean") p.enabled = raw.enabled;
    if (typeof raw.preferredProvider === "string" && providerById(raw.preferredProvider)) p.preferredProvider = raw.preferredProvider;
    if (typeof raw.preferredPreset === "string" && presetById(raw.preferredPreset)) p.preferredPreset = raw.preferredPreset;
    if (typeof raw.autoResume === "boolean") p.autoResume = raw.autoResume;
    if (typeof raw.backgroundPlayback === "boolean") p.backgroundPlayback = raw.backgroundPlayback;
    if (typeof raw.pauseBeforeVideo === "boolean") p.pauseBeforeVideo = raw.pauseBeforeVideo;
    p.v = PREFS_V;
    return p;
  }
  function validatePrefs(p) {
    var errs = [];
    if (!p || typeof p !== "object") return ["prefs-missing"];
    if (typeof p.enabled !== "boolean") errs.push("enabled-bool");
    if (!providerById(p.preferredProvider)) errs.push("provider-unknown");
    if (!presetById(p.preferredPreset)) errs.push("preset-unknown");
    if (typeof p.autoResume !== "boolean") errs.push("autoResume-bool");
    if (typeof p.backgroundPlayback !== "boolean") errs.push("backgroundPlayback-bool");
    if (typeof p.pauseBeforeVideo !== "boolean") errs.push("pauseBeforeVideo-bool");
    if (Object.keys(p).some(function (k) { return ["trackTitle", "artist", "history", "recent", "mood"].indexOf(k) >= 0; })) errs.push("history-forbidden");
    return errs;
  }
  /* Flag gate: OFF unless the user explicitly opted in; master smd_prep must be on.
     store: { getItem(key) } (localStorage in browser, stub in tests). */
  function enabled(store) {
    try {
      var q = (G && G.location && G.location.search.match(/[?&]sound=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
    } catch (e) {}
    try {
      if (store.getItem(MASTER_FLAG) === "0") return false;
      return store.getItem(FLAG) === "1";
    } catch (e) { return false; }
  }

  /* Provider capability + policy matrix (plan section 3; architecture note section 2).
     kind: "embedded" plays inside PrepNucleus; "external" opens the provider app/web;
     "reserved" is a mount slot owned by another job (rs-spotify) — never faked here. */
  var PROVIDERS = [
    { id: "first_party", name: "PrepNucleus ambience", kind: "embedded",
      capabilities: { embeddedPlayback: true, externalHandoff: false, remoteControls: true, queueControls: false, volumeControl: true, trackMetadata: true, backgroundPlayback: true },
      approval: "own-original", homeUrl: null,
      note: "Original ambient and white-noise tracks generated on this device." },
    { id: "spotify", name: "Spotify", kind: "external",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "handoff-only", homeUrl: "https://open.spotify.com/",
      note: "Opens the Spotify app or web player. In-app controls need Spotify approval (job rs-spotify)." },
    { id: "spotify_remote", name: "Spotify mini-player", kind: "reserved",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "reserved-rs-spotify", homeUrl: "https://open.spotify.com/",
      note: "Reserved mount slot for prep-sound-spotify.js (job rs-spotify). Until it registers, this behaves as plain Spotify handoff." },
    { id: "youtube_music", name: "YouTube Music", kind: "external",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "handoff-only", homeUrl: "https://music.youtube.com/",
      note: "Opens the YouTube Music app or web player. PrepNucleus cannot control it." },
    { id: "amazon_music", name: "Amazon Music", kind: "external",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "handoff-only", homeUrl: "https://music.amazon.com/",
      note: "Opens the Amazon Music app or web player. PrepNucleus cannot control it." },
    { id: "jiosaavn", name: "JioSaavn", kind: "external",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "handoff-only", homeUrl: "https://www.jiosaavn.com/",
      note: "Opens the JioSaavn app or site. PrepNucleus cannot control it." },
    { id: "gaana", name: "Gaana", kind: "external",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "handoff-only", homeUrl: "https://gaana.com/",
      note: "Opens the Gaana app or site. PrepNucleus cannot control it." },
    { id: "apple_music", name: "Apple Music", kind: "external",
      capabilities: { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false },
      approval: "handoff-spike-open", homeUrl: "https://music.apple.com/",
      note: "Opens Apple Music. Embedded playback waits on the MusicKit spike (OPEN)." }
  ];
  function providerById(id) { for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i]; return null; }

  /* Verified handoff URLs only (architecture note section 3). Anything unverified
     returns { ok:false, error:"unavailable:<what>" } — never a guessed scheme. */
  function handoffHome(providerId) {
    var p = providerById(providerId);
    if (!p || (p.kind !== "external" && p.kind !== "reserved") || !p.homeUrl) return { ok: false, error: "unavailable:home" };
    return { ok: true, url: p.homeUrl };
  }
  var SHARE_SHAPES = { spotify: /^https:\/\/open\.spotify\.com\/(album|playlist|track|episode)\/[A-Za-z0-9]+(\?.*)?$/,
    youtube_music: /^https:\/\/music\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,}$/,
    apple_music: /^https:\/\/music\.apple\.com\/[a-z-]+\/(album|playlist|song)\/.+$/ };
  /* Open a user-supplied share URL after checking it matches the provider's official
     shape. IDs are never invented here — the user pastes what the provider gave them. */
  function handoffShare(providerId, url) {
    var re = SHARE_SHAPES[providerId];
    if (!re) return { ok: false, error: "unavailable:share" };
    if (typeof url !== "string" || !re.test(url.trim())) return { ok: false, error: "unavailable:share-shape" };
    return { ok: true, url: url.trim() };
  }
  /* Curated-search links: only YouTube's official results shape is verified. */
  function handoffSearch(providerId, query) {
    var q = String(query || "").trim();
    if (!q) return { ok: false, error: "unavailable:empty-query" };
    if (providerId === "youtube_music") return { ok: true, url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) };
    return { ok: false, error: "unavailable:search" };
  }

  /* First-party catalogue: ambient + white-noise ONLY, licence original, no expiry. */
  var TRACKS = [
    { id: "rain_soft", title: "Soft rain", kind: "ambient", licence: "original", expiry: null },
    { id: "night_quiet", title: "Quiet night", kind: "white-noise", licence: "original", expiry: null },
    { id: "deep_drone", title: "Deep focus", kind: "ambient", licence: "original", expiry: null },
    { id: "ocean_slow", title: "Slow shore", kind: "ambient", licence: "original", expiry: null }
  ];
  var PRESETS = [
    { id: "deep_focus", title: "Deep Focus", track: "deep_drone", blurb: "Low warm hum for long reads." },
    { id: "lofi_calm", title: "Calm study", track: "rain_soft", blurb: "Soft rain, steady and low." },
    { id: "night_shift", title: "Night ward", track: "night_quiet", blurb: "Even hush for late sessions." },
    { id: "slow_breath", title: "Slow shore", track: "ocean_slow", blurb: "Slow waves, nothing sudden." }
  ];
  function trackById(id) { for (var i = 0; i < TRACKS.length; i++) if (TRACKS[i].id === id) return TRACKS[i]; return null; }
  function presetById(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return null; }
  /* Rights gate for CI: only original ambient/white-noise with no expiry may ship. */
  function checkManifest(tracks) {
    var errs = [];
    (tracks || []).forEach(function (t) {
      if (!t || typeof t !== "object") { errs.push("entry-not-object"); return; }
      if (t.licence !== "original") errs.push("licence:" + (t.id || "?"));
      if (t.expiry !== null && t.expiry !== undefined && t.expiry !== "n/a") errs.push("expiry:" + (t.id || "?"));
      if (t.kind !== "ambient" && t.kind !== "white-noise") errs.push("kind:" + (t.id || "?"));
      if (!t.id || !t.title) errs.push("identity:" + (t.id || "?"));
    });
    return errs;
  }

  /* State machine (plan section 4.3). Pure: transition(state, event) -> { state, effects[] }.
     Effects name what the controller must do ("render", "start-embedded", "open-url",
     "stop-audio", "note"); the machine itself touches nothing. */
  var STATES = ["idle", "selecting_provider", "connecting", "ready", "playing_embedded", "playing_external", "paused", "interrupted", "error"];
  function transition(state, event) {
    var fx = function () { return Array.prototype.slice.call(arguments); };
    if (STATES.indexOf(state) < 0) return { state: "error", effects: fx("note:bad-state", "render") };
    switch (event.t) {
      case "ENABLE": return { state: "selecting_provider", effects: fx("render") };
      case "SELECT_PROVIDER": {
        if (state !== "selecting_provider" && state !== "ready" && state !== "idle" && state !== "error") return { state: state, effects: fx("unsupported") };
        var p = providerById(event.provider);
        if (!p) return { state: "error", effects: fx("note:unknown-provider", "render") };
        if (p.kind === "reserved") return { state: "selecting_provider", effects: fx("note:reserved-fallback", "render") };
        if (p.kind === "embedded") return { state: "ready", effects: fx("render") };
        return { state: "connecting", effects: fx("open-url", "render") };
      }
      case "HANDOFF_DONE": return { state: "playing_external", effects: fx("render") };
      case "CONNECT_FAIL": return { state: "error", effects: fx("note:handoff-failed", "render") };
      case "PLAY":
        if (state === "ready" || state === "paused" || state === "interrupted") return { state: "playing_embedded", effects: fx("start-embedded", "render") };
        return { state: state, effects: fx("unsupported") };
      case "PAUSE":
        if (state === "playing_embedded") return { state: "paused", effects: fx("stop-audio", "render") };
        return { state: state, effects: fx("unsupported") };
      case "HUSH": /* video/TTS/mock-timing path: never resume on our own */
        if (state === "playing_embedded") return { state: "interrupted", effects: fx("stop-audio", "note:paused-for-video", "render") };
        return { state: state, effects: fx() };
      case "STOP":
        if (state === "idle") return { state: "idle", effects: fx() };
        return { state: "idle", effects: fx("stop-audio", "render") };
      case "DISCONNECT": return { state: "idle", effects: fx("stop-audio", "render") };
      case "APP_HIDDEN":
        if (state === "playing_embedded" && !event.background) return { state: "interrupted", effects: fx("stop-audio", "note:paused-background", "render") };
        return { state: state, effects: fx() };
      case "ERROR": return { state: "error", effects: fx("stop-audio", "render") };
      case "RESET": return { state: "idle", effects: fx("stop-audio", "render") };
      default: return { state: state, effects: fx("unsupported") };
    }
  }

  /* Which controls the Dock may render for a provider+state. Unsupported controls are
     absent, never disabled-looking-but-dead — except none: we omit, not disable. */
  function visibleControls(providerId, state) {
    var p = providerById(providerId), c = { play: false, pause: false, stop: false, openExternal: false, disconnect: false, volume: false, meta: false, queue: false };
    if (!p) return c;
    var live = state === "playing_embedded" || state === "ready" || state === "paused" || state === "interrupted";
    if (p.capabilities.embeddedPlayback) {
      if (state === "ready" || state === "paused" || state === "interrupted") c.play = true;
      if (state === "playing_embedded") c.pause = true;
      if (live) c.stop = true;
      if (p.capabilities.volumeControl && live) c.volume = true;
      if (p.capabilities.trackMetadata) c.meta = true;
      if (p.capabilities.queueControls) c.queue = true;
      if (live) c.disconnect = true;
    }
    if (p.capabilities.externalHandoff && (state === "connecting" || state === "playing_external" || state === "ready")) {
      c.openExternal = true;
      c.disconnect = true;
    }
    return c;
  }
  function unsupported(providerId, op) { return { ok: false, error: "unsupported:" + providerId + ":" + op }; }

  var PURE = { FLAG: FLAG, MASTER_FLAG: MASTER_FLAG, SPOTIFY_FLAG: SPOTIFY_FLAG, PREFS_V: PREFS_V,
    defaultPrefs: defaultPrefs, migratePrefs: migratePrefs, validatePrefs: validatePrefs, enabled: enabled,
    PROVIDERS: PROVIDERS, providerById: providerById,
    handoffHome: handoffHome, handoffShare: handoffShare, handoffSearch: handoffSearch,
    TRACKS: TRACKS, PRESETS: PRESETS, trackById: trackById, presetById: presetById, checkManifest: checkManifest,
    STATES: STATES, transition: transition, visibleControls: visibleControls, unsupported: unsupported };
  if (NODE) { module.exports = PURE; return; }
  G.PREP_SOUND_CORE = PURE;
})(typeof window !== "undefined" ? window : this);
