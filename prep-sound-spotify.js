/* PrepNucleus Sound — Spotify mini-player (job rs-spotify). ES5. window.PREP_SOUND_SPOTIFY.
   A small round music button opens a compact sheet over the study screen. First open shows only
   "Connect Spotify"; music never starts without a tap. After sign-in: now-playing, play/pause,
   next/previous, volume where the device allows it, the learner's own playlists, and search for
   tracks and playlists. Choosing one starts it on the learner's own Spotify and the sheet closes.
   Free accounts get playlists + "Open in Spotify" with a plain explanation. Show only working
   controls: capabilities come from the live account (Premium?) and device (supports_volume?).

   Auth is Authorization Code + PKCE with NO client secret anywhere. Minimum scopes only (see
   SCOPES). Tokens live in memory only, except the refresh token on native Android, which is
   kept in Keystore AES-GCM storage via the PrepSound plugin and restored on cold start
   (rs-android-native); web/iOS stay memory-only. Nothing goes to PrepNucleus analytics or the AI Tutor,
   and no listening history is collected. The PKCE verifier + OAuth state sit in localStorage
   only for the redirect round-trip and are deleted at exchange. Playback path: the Spotify Web
   API player endpoints controlling the learner's active Spotify app on every platform — see
   vault/plans/PrepSound-spotify-spike.md for why (no Web Playback SDK, no App Remote in v1).

   Flags: needs smd_prep (default ON) + smd_prep_sound (OFF) + smd_prep_sound_spotify (OFF).
   Client id from window.SMD_SPOTIFY_CLIENT_ID or window.SMD_CONFIG.spotifyClientId; empty by
   default. With any flag off or no client id this file leaves PREP_SOUND_SPOTIFY undefined and
   PrepNucleus behaves exactly as before. It plugs into the Sound Dock through the Sound plan 4.2
   adapter shape (id "spotify_remote"); until rs-sound lands it mounts its own button in the
   PrepNucleus root. Pure helpers + the API client load under node for tests (mocked fetch). */
(function (G) {
  "use strict";

  /* ================= pure: constants ================= */
  var AUTH_URL = "https://accounts.spotify.com/authorize";
  var TOKEN_URL = "https://accounts.spotify.com/api/token";
  var API = "https://api.spotify.com/v1";
  // Minimum scopes: account product (Premium check), playback read/control, own playlists, library.
  var SCOPES = ["user-read-private", "user-read-playback-state", "user-read-currently-playing",
    "user-modify-playback-state", "playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-library-modify",
    "user-read-recently-played"];
  var VERIFIER_KEY = "smd_spotify_pkce", STATE_KEY = "smd_spotify_state";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function b64url(bytes) {
    var s = "", i;
    if (typeof Buffer !== "undefined") s = Buffer.from(bytes).toString("base64");
    else { var bin = ""; for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); s = G.btoa(bin); }
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // PKCE verifier: 43-128 chars from the RFC 7636 unreserved set. rng(n) must return n bytes.
  function makeVerifier(rng) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~", out = "", b = rng(64), i;
    for (i = 0; i < 64; i++) out += chars[b[i] % chars.length];
    return out;
  }
  function makeState(rng) { return b64url(rng(16)); }
  // S256 challenge. sha256(str) must return the 32 digest bytes (sync; node:crypto in tests,
  // an injected sync SHA-256 in the browser build path — the live flow uses subtleChallenge).
  function challengeS256(verifier, sha256) { return b64url(sha256(String(verifier))); }
  function authorizeUrl(o) {
    var p = [["response_type", "code"], ["client_id", o.clientId], ["redirect_uri", o.redirectUri],
      ["scope", SCOPES.join(" ")], ["state", o.state], ["code_challenge_method", "S256"], ["code_challenge", o.challenge]];
    return AUTH_URL + "?" + p.map(function (kv) { return encodeURIComponent(kv[0]) + "=" + encodeURIComponent(kv[1]); }).join("&");
  }
  function openUrl(uri) {
    // spotify:track:<id> / spotify:playlist:<id> -> the open.spotify.com page (the app claims it).
    var m = /^spotify:(track|playlist|album):([A-Za-z0-9]+)$/.exec(String(uri || ""));
    return m ? "https://open.spotify.com/" + m[1] + "/" + m[2] : "https://open.spotify.com/";
  }

  /* ---- response parsing: untrusted provider JSON in, small plain shapes out ---- */
  function trackOf(t) {
    if (!t || !t.uri) return null;
    var artists = (t.artists || []).map(function (a) { return a && a.name; }).filter(Boolean).join(", ");
    return { kind: "track", uri: t.uri, id: t.id ? String(t.id) : "", name: String(t.name || "Untitled"), artists: artists,
      album: t.album ? String(t.album.name || "") : "", images: (t.album && t.album.images) || [], durationMs: t.duration_ms || 0 };
  }
  /* GET /me/player/queue -> Up next rows. Tracks carry album art; podcast episodes carry their own
     images or the show's. Unknown shapes are dropped, never rendered. */
  function parseQueue(j) {
    var list = (j && (Array.isArray(j.queue) ? j.queue : Array.isArray(j.items) ? j.items : null)) || [];
    return list.map(function (it) {
      if (!it || !it.uri) return null;
      var t = trackOf(it), show = it.show || {};
      var subtitle = t.artists || String(show.name || "");
      var images = (it.album && it.album.images) || it.images || show.images || [];
      return { uri: it.uri, title: t.name, subtitle: subtitle, images: images, durationMs: t.durationMs };
    }).filter(Boolean);
  }
  /* Provider-neutral Now Playing model for prep-sound-player.js from a raw
     GET /me/player body (2026 shapes included: shuffle_state, repeat_state,
     device.volume_percent). liked is merged in by the client (contains call). */
  function parseNowPlaying(j, liked) {
    if (!j || !j.item || !j.item.uri) {
      return { provider: "spotify", providerLabel: "Spotify", title: "", artist: "", album: "",
        artworkUrl: null, durationMs: 0, positionMs: 0, isPlaying: false, shuffle: false,
        repeat: "off", liked: null, likeAvailable: true, volume: null, trackId: "", trackUri: "" };
    }
    var t = trackOf(j.item);
    var dev = j.device || {};
    return { provider: "spotify", providerLabel: "Spotify", title: t.name, artist: t.artists, album: t.album,
      artworkUrl: null, images: t.images, durationMs: t.durationMs, positionMs: j.progress_ms || 0,
      isPlaying: !!j.is_playing, shuffle: !!j.shuffle_state,
      repeat: j.repeat_state === "track" || j.repeat_state === "context" ? j.repeat_state : "off",
      liked: liked === true ? true : liked === false ? false : null, likeAvailable: true,
      volume: typeof dev.volume_percent === "number" ? dev.volume_percent : null,
      supportsVolume: dev.supports_volume !== false, trackId: t.id, trackUri: t.uri };
  }
  /* Liked-check bodies differ by endpoint generation: /me/tracks/contains
     returns [true]; /me/library/contains returns [{ uri, contains }]. Both
     (and a bare { contains } object) collapse to true|false|null. */
  function parseLiked(j) {
    if (Array.isArray(j)) {
      if (!j.length) return null;
      if (typeof j[0] === "boolean") return j[0];
      if (j[0] && typeof j[0] === "object") {
        if (typeof j[0].contains === "boolean") return j[0].contains;
        if (typeof j[0].saved === "boolean") return j[0].saved;
      }
      return null;
    }
    if (j && typeof j.contains === "boolean") return j.contains;
    return null;
  }
  function playlistOf(p) {
    if (!p || !p.uri) return null;
    return { kind: "playlist", uri: p.uri, name: String(p.name || "Untitled playlist"),
      owner: p.owner ? String(p.owner.display_name || "") : "", tracks: count(p.items) != null ? count(p.items) : count(p.tracks) };
  }
  // Spotify renamed playlist.tracks to playlist.items (2026 Web API); read either, null when neither has a total.
  function count(o) { return o && !Array.isArray(o) && typeof o.total === "number" ? o.total : null;
  }
  function parsePlaylists(j) { return ((j && j.items) || []).map(playlistOf).filter(Boolean); }
  function parseSearch(j) {
    return { tracks: ((j && j.tracks && j.tracks.items) || []).map(trackOf).filter(Boolean),
      playlists: ((j && j.playlists && j.playlists.items) || []).map(playlistOf).filter(Boolean) };
  }
  function parsePlayer(j) {
    if (!j || !j.item) return { playing: false, track: null, device: null, progressMs: 0 };
    return { playing: !!j.is_playing, track: trackOf(j.item), progressMs: j.progress_ms || 0,
      device: j.device ? { name: String(j.device.name || "Spotify"), type: String(j.device.type || ""),
        volume: typeof j.device.volume_percent === "number" ? j.device.volume_percent : null,
        supportsVolume: j.device.supports_volume !== false } : null };
  }
  // Typed errors: the sheet renders these, never a raw provider message or stack.
  function apiError(status, retryAfter) {
    if (status === 401) return { reason: "auth_expired", status: status, message: "Your Spotify sign-in has expired. Disconnect and connect again." };
    if (status === 403) return { reason: "premium_required", status: status, message: "Spotify Premium is needed to control playback from here. Your playlists below still open in Spotify." };
    if (status === 404) return { reason: "no_active_device", status: status, message: "No Spotify is playing yet. Open Spotify on this device, play anything, then try again." };
    if (status === 429) return { reason: "rate_limited", status: status, retryAfter: retryAfter || 1, message: "Spotify asked us to slow down. Try again in a moment." };
    return { reason: "provider_error", status: status, message: "Spotify did not answer. Check your connection and try again." };
  }
  function capabilities(isPremium, player) {
    var vol = !!(isPremium && player && player.device && player.device.supportsVolume && player.device.volume != null);
    return { embeddedPlayback: false, externalHandoff: true, remoteControls: !!isPremium,
      queueControls: !!isPremium, volumeControl: vol, trackMetadata: true, backgroundPlayback: false };
  }
  /* prep-sound-player caps: transport/shuffle/repeat/seek only for Premium
     (Spotify refuses control otherwise); volume also needs a device that
     reports it; save (like) works on Free too but needs the sign-in scope. */
  function capsForPlayer(isPremium, model, hasLikeScope) {
    var ctrl = !!isPremium;
    var hasTrack = !!(model && model.title);
    return { play: ctrl, pause: ctrl, next: ctrl, previous: ctrl,
      seek: ctrl && hasTrack, shuffle: ctrl && hasTrack, repeat: ctrl && hasTrack,
      like: hasTrack, volume: !!(ctrl && model && model.supportsVolume !== false && model.volume != null),
      artwork: hasTrack };
  }

  /* Secure-storage key for the refresh token on native Android only. Web and
     iOS never persist it (memory only below). The value is never logged. */
  var REFRESH_SECRET_KEY = "prep_sound_spotify_refresh_token";
  /* Wrap Capacitor.Plugins.PrepSound-shaped plugin into the secureStore shape
     makeClient consumes. Returns null when any method is missing. */
  function makePluginSecureStore(plugin) {
    if (!plugin || typeof plugin.setSecret !== "function" || typeof plugin.getSecret !== "function" || typeof plugin.removeSecret !== "function") return null;
    return {
      setSecret: function (key, value) { return Promise.resolve(plugin.setSecret({ key: key, value: value })); },
      getSecret: function (key) { return Promise.resolve(plugin.getSecret({ key: key })).then(function (r) { return r && typeof r.value === "string" ? r.value : null; }); },
      removeSecret: function (key) { return Promise.resolve(plugin.removeSecret({ key: key })); }
    };
  }

  // capacitor-secure-storage-plugin (iOS Keychain / Android Keystore): set/get/remove; get rejects when the key is absent.
  function makeKeychainStore(p) {
    if (!p || typeof p.set !== "function" || typeof p.get !== "function" || typeof p.remove !== "function") return null;
    return {
      setSecret: function (key, value) { return Promise.resolve(p.set({ key: key, value: value })); },
      getSecret: function (key) { return Promise.resolve(p.get({ key: key })).then(function (r) { return r && typeof r.value === "string" ? r.value : null; }, function () { return null; }); },
      removeSecret: function (key) { return Promise.resolve(p.remove({ key: key })).then(null, function () { return true; }); }
    };
  }

  /* ================= token store: memory, refresh token mirrored to the OS secure store ================= */
  function makeTokenStore(now) {
    var t = null; // { access, refresh, expiresAt, scope } — never persisted, never logged.
    return {
      set: function (j) {
        if (!j || !j.access_token) return false;
        t = { access: j.access_token, refresh: j.refresh_token || (t && t.refresh) || null,
          expiresAt: now() + (j.expires_in ? j.expires_in * 1000 : 3600000),
          scope: typeof j.scope === "string" ? j.scope : (t && t.scope) || "" };
        return true;
      },
      /* Granted scopes from the token response (space-separated). A session
         whose grant lacks user-library-modify shows the save heart disabled;
         it is never force-reconnected. Unknown (restored) grants return "". */
      scope: function () { return t && t.scope ? t.scope : ""; },
      hasScope: function (name) { return (" " + (t && t.scope ? t.scope : "") + " ").indexOf(" " + name + " ") >= 0; },
      /* Cold-start restore: seed only the refresh token; the next ensureToken
         refreshes it into a live access token. */
      setRefreshOnly: function (refresh) {
        if (typeof refresh !== "string" || !refresh) return false;
        t = { access: null, refresh: refresh, expiresAt: 0 };
        return true;
      },
      access: function () { return t && t.access ? t.access : null; },
      refreshToken: function () { return t && t.refresh ? t.refresh : null; },
      // Refresh 60 s early so a tap never rides an expiring token.
      needsRefresh: function () { return !!t && now() >= t.expiresAt - 60000; },
      has: function () { return !!t; },
      clear: function () { t = null; }
    };
  }

  /* ================= API client (fetch injected: mocked in tests) ================= */
  // deps: { fetch, now, clientId, redirectUri, store? } — no secret, no analytics hooks exist here.
  function makeClient(deps) {
    var store = deps.store || makeTokenStore(deps.now), refreshing = null;
    var secure = deps.secureStore || null; // native Android only; null on web/iOS
    function persistRefresh() {
      if (!secure) return Promise.resolve(true);
      var rt = store.refreshToken();
      if (!rt) return Promise.resolve(true);
      try {
        return Promise.resolve(secure.setSecret(REFRESH_SECRET_KEY, rt)).then(
          function () { return true; }, function () { return true; });
      } catch (e) { return Promise.resolve(true); }
    }
    function clearPersisted() {
      if (!secure) return Promise.resolve(true);
      try {
        return Promise.resolve(secure.removeSecret(REFRESH_SECRET_KEY)).then(
          function () { return true; }, function () { return true; });
      } catch (e) { return Promise.resolve(true); }
    }
    function tokenPost(body) {
      return deps.fetch(TOKEN_URL, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
        .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
        .then(function (x) {
          // A refused code/refresh grant (400/401) means sign-in again, never a raw provider error.
          if (x.r.status !== 200 || !store.set(x.j)) throw apiError(401);
          return persistRefresh().then(function () { return true; });
        }, function () { throw { reason: "offline", message: "No connection. Check your network and try again." }; });
    }
    /* Cold start on native Android: load the persisted refresh token (if any)
       and exchange it for a fresh access token. Resolves true when a session
       was restored. A dead refresh token clears the persisted copy. */
    function restoreSession() {
      if (!secure || store.access()) return Promise.resolve(false);
      var loaded;
      try { loaded = secure.getSecret(REFRESH_SECRET_KEY); }
      catch (e) { return Promise.resolve(false); }
      return Promise.resolve(loaded).then(function (rt) {
        if (typeof rt !== "string" || !rt) return false;
        if (!store.setRefreshOnly(rt)) return false;
        return refresh().then(function () { return true; }, function (e) {
          store.clear();
          return clearPersisted().then(function () { throw e; });
        });
      }, function () { return false; });
    }
    function exchange(code, verifier) {
      return tokenPost("grant_type=authorization_code&code=" + encodeURIComponent(code) +
        "&redirect_uri=" + encodeURIComponent(deps.redirectUri) + "&client_id=" + encodeURIComponent(deps.clientId) +
        "&code_verifier=" + encodeURIComponent(verifier));
    }
    function refresh() {
      if (refreshing) return refreshing; // one refresh in flight, however many taps queue behind it
      var rt = store.refreshToken();
      if (!rt) return Promise.reject(apiError(401));
      refreshing = tokenPost("grant_type=refresh_token&refresh_token=" + encodeURIComponent(rt) +
        "&client_id=" + encodeURIComponent(deps.clientId))
        .then(function (v) { refreshing = null; return v; }, function (e) { refreshing = null; throw e; });
      return refreshing;
    }
    function ensureToken() {
      if (!store.has()) return Promise.reject(apiError(401));
      return store.needsRefresh() ? refresh() : Promise.resolve(true);
    }
    function bodyOf(r) {
      if (r.status === 204) return null;
      return (r.text ? r.text() : r.json().then(JSON.stringify)).then(function (t) { if (!t) return null; try { return JSON.parse(t); } catch (e) { return null; } });
    }
    function call(method, path, body) {
      return ensureToken().then(function () {
        return deps.fetch(API + path, { method: method,
          headers: { Authorization: "Bearer " + store.access(), "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined });
      }).then(function (r) {
        if (r.status === 200 || r.status === 204) return bodyOf(r);
        if (r.status === 401) { // one forced refresh + one retry, then surface auth_expired
          return refresh().then(function () {
            return deps.fetch(API + path, { method: method,
              headers: { Authorization: "Bearer " + store.access(), "Content-Type": "application/json" },
              body: body ? JSON.stringify(body) : undefined });
          }).then(function (r2) {
            if (r2.status === 200 || r2.status === 204) return bodyOf(r2);
            return failOf(r2);
          });
        }
        return failOf(r);
      }, function (e) { if (e && e.reason) throw e; throw { reason: "offline", message: "No connection. Check your network and try again." }; });
    }
    // Development mode: Spotify answers accounts not on the app's User Management allowlist with 403 "User not registered in the Developer Dashboard".
    function failOf(r) {
      if (r.status !== 403 || !r.text) throw apiError(r.status, retryOf(r));
      return r.text().then(function (t) {
        if (/not (be )?registered|developer\.spotify\.com\/dashboard|developer dashboard/i.test(t || ""))   // Spotify: "Check settings on developer.spotify.com/dashboard, the user may not be registered."
          throw { reason: "not_allowlisted", status: 403, message: "Spotify is still approving PrepNucleus. Until then only invited test accounts can connect." };
        if (/PREMIUM_REQUIRED/.test(t || "")) throw apiError(403);
        if (/Player command failed|Restriction violated|NO_ACTIVE_DEVICE/i.test(t || "")) throw { reason: "no_active_device", status: 403, message: "Spotify is asleep on your devices." };
        throw { reason: "forbidden", status: 403, message: "Spotify did not allow that here. Try again, or reconnect Spotify." };
      }, function () { throw { reason: "forbidden", status: 403, message: "Spotify did not allow that here." }; });
    }
    function retryOf(r) { try { var v = r.headers && r.headers.get && r.headers.get("Retry-After"); return v ? Number(v) : null; } catch (e) { return null; } }
    /* Liked check with endpoint-generation fallback: the 2026 library
       endpoint first, the long-standing tracks endpoint on 404. A failed
       check resolves null (unknown), never fails the player read. */
    function likedCheck(trackId, trackUri) {
      return call("GET", "/me/library/contains?uris=" + encodeURIComponent(trackUri || ("spotify:track:" + trackId)))
        .then(parseLiked, function (e) {
          if (!e || e.status !== 404) return null;
          return call("GET", "/me/tracks/contains?ids=" + encodeURIComponent(trackId)).then(parseLiked, function () { return null; });
        });
    }
    function setLiked(trackId, trackUri, want) {
      var method = want ? "PUT" : "DELETE";
      return call(method, "/me/tracks?ids=" + encodeURIComponent(trackId)).then(function (v) { return v; }, function (e) {
        if (!e || e.status !== 404) throw e;
        return call(method, "/me/library?uris=" + encodeURIComponent(trackUri || ("spotify:track:" + trackId)));
      });
    }
    return {
      store: store, exchange: exchange, refresh: refresh, restoreSession: restoreSession,
      me: function () { return call("GET", "/me"); },
      player: function () { return call("GET", "/me/player").then(parsePlayer); },
      /* Full neutral model for prep-sound-player.js (+ granted-scope flag). */
      // Last played track as an idle Now Playing model (needs user-read-recently-played; older sessions return null).
      lastPlayed: function () {
        return call("GET", "/me/player/recently-played?limit=1").then(function (j) {
          var it = j && j.items && j.items[0], m = it && it.track ? parseNowPlaying({ item: it.track, is_playing: false, progress_ms: 0 }, null) : null;
          if (m) { m.lastPlayed = true; m.contextUri = it.context && it.context.uri || ""; }
          return m;
        }, function () { return null; });
      },
      queue: function () { return call("GET", "/me/player/queue").then(parseQueue); },
      nowPlaying: function () {
        return call("GET", "/me/player").then(function (j) {
          var base = parseNowPlaying(j, null);
          if (!base.trackId) { base.likeAvailable = store.hasScope("user-library-modify"); return base; }
          return likedCheck(base.trackId, base.trackUri).then(function (liked) {
            base.liked = liked; base.likeAvailable = store.hasScope("user-library-modify"); return base;
          });
        });
      },
      shuffle: function (state) { return call("PUT", "/me/player/shuffle?state=" + (state ? "true" : "false")); },
      repeatMode: function (state) { return call("PUT", "/me/player/repeat?state=" + encodeURIComponent(state)); },
      seekMs: function (positionMs) { return call("PUT", "/me/player/seek?position_ms=" + Math.max(0, Math.round(positionMs))); },
      saveTrack: function (trackId, trackUri) { return setLiked(trackId, trackUri, true); },
      removeTrack: function (trackId, trackUri) { return setLiked(trackId, trackUri, false); },
      play: function (body, deviceId) { return call("PUT", "/me/player/play" + (deviceId ? "?device_id=" + encodeURIComponent(deviceId) : ""), body || {}); },
      transfer: function (deviceId) { return call("PUT", "/me/player", { device_ids: [deviceId], play: true }); },
      devices: function () { return call("GET", "/me/player/devices").then(function (j) { return (j && j.devices) || []; }); },
      pause: function () { return call("PUT", "/me/player/pause"); },
      next: function () { return call("POST", "/me/player/next"); },
      previous: function () { return call("POST", "/me/player/previous"); },
      volume: function (pct) { return call("PUT", "/me/player/volume?volume_percent=" + Math.max(0, Math.min(100, Math.round(pct)))); },
      playlists: function () { return call("GET", "/me/playlists?limit=50").then(parsePlaylists); },
      search: function (q) {
        return call("GET", "/search?type=track,playlist&limit=10&market=from_token&q=" + encodeURIComponent(q)).then(parseSearch);
      },
      disconnect: function () { store.clear(); clearPersisted(); }
    };
  }

  var PURE = { esc: esc, b64url: b64url, makeVerifier: makeVerifier, makeState: makeState,
    challengeS256: challengeS256, authorizeUrl: authorizeUrl, openUrl: openUrl, trackOf: trackOf,
    playlistOf: playlistOf, parsePlaylists: parsePlaylists, parseSearch: parseSearch, parsePlayer: parsePlayer,
    parseNowPlaying: parseNowPlaying, parseLiked: parseLiked, parseQueue: parseQueue, premiumOf: function (me) { return !(me && me.product && me.product !== "premium"); }, capsForPlayer: capsForPlayer,
    apiError: apiError, capabilities: capabilities, makeTokenStore: makeTokenStore, makeClient: makeClient, makeKeychainStore: makeKeychainStore,
    makePluginSecureStore: makePluginSecureStore, REFRESH_SECRET_KEY: REFRESH_SECRET_KEY,
    SCOPES: SCOPES, AUTH_URL: AUTH_URL, TOKEN_URL: TOKEN_URL, API: API };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= flags + config (inert unless every gate is on) ================= */
  function flagOn(key, param, def) {
    try {
      var q = (G.location.search.match(new RegExp("[?&]" + param + "=([^&]+)")) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      var v = G.localStorage.getItem(key);
      return def ? v !== "0" : v === "1";
    } catch (e) { return false; }
  }
  function prepOn() {
    try {
      var q = (G.location.search.match(/[?&]prep=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem("smd_prep") !== "0";
    } catch (e) { return true; }
  }
  function clientId() {
    try {
      if (typeof G.SMD_SPOTIFY_CLIENT_ID === "string" && G.SMD_SPOTIFY_CLIENT_ID) return G.SMD_SPOTIFY_CLIENT_ID;
      if (G.SMD_CONFIG && G.SMD_CONFIG.spotifyClientId) return String(G.SMD_CONFIG.spotifyClientId);
    } catch (e) {}
    return "9545526c500040058279facbdcdba9ee";   // owner's Spotify app (public PKCE client id, no secret); dev-mode allowlist only until approval
  }
  function native() {
    try { return !!(G.Capacitor && G.Capacitor.isNativePlatform && G.Capacitor.isNativePlatform()); } catch (e) { return false; }
  }
  function redirectUri() {
    try { if (G.SMD_SPOTIFY_REDIRECT_URI) return String(G.SMD_SPOTIFY_REDIRECT_URI); } catch (e) {}
    // In the app the page is https://localhost / capacitor://localhost, which Spotify rejects; use the app's own scheme.
    if (native()) return "stewardmd://spotify-callback";
    return G.location.origin + G.location.pathname;
  }
  var CID = clientId();
  // Spotify is ON by default for everyone (owner 2026-10-31); smd_prep_sound_spotify="0" or ?spotify=0 turns it off.
  if (!prepOn() || !flagOn("smd_prep_sound_spotify", "spotify", true) || !CID) return;

  /* ================= live state + sheet ================= */
  var D = G.document;
  var S = { host: null, sheet: null, prev: null, client: null, premium: false, me: null,
    player: null, now: null, playerHandle: null, playlists: null, results: null, busy: false, err: null, query: "",
    queue: null, showAll: false, provOpen: false, state: readState(), dock: null, tick: 0 };
  // Mini or closed, per device (owner 2026-10-31). A UI preference only; never tokens or listening data.
  function readState() { try { return G.localStorage.getItem("smd_prep_player_state") === "closed" ? "closed" : "mini"; } catch (e) { return "mini"; } }
  function setState(v) { S.state = v; try { G.localStorage.setItem("smd_prep_player_state", v); } catch (e) {} }
  function rng(n) { var b = new Uint8Array(n); (G.crypto || G.msCrypto).getRandomValues(b); return b; }
  function subtleChallenge(verifier) {
    var data = new TextEncoder().encode(verifier);
    return G.crypto.subtle.digest("SHA-256", data).then(function (buf) { return b64url(new Uint8Array(buf)); });
  }
  /* Stay connected until Disconnect (owner 2026-10-31): only the refresh token is kept, in the OS secure store.
     Android: the PrepSound Keystore plugin when that store build is installed; otherwise (iOS Keychain, older
     Android builds) capacitor-secure-storage-plugin, already in both store builds. Web stays memory-only. */
  function secureStore() {
    try {
      var C = G.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      var P = C.Plugins || {};
      var android = typeof C.getPlatform === "function" && C.getPlatform() === "android";
      return (android && makePluginSecureStore(P.PrepSound)) || makeKeychainStore(P.SecureStoragePlugin);
    } catch (e) { return null; }
  }
  function client() {
    if (!S.client) S.client = makeClient({ fetch: function (u, o) { return G.fetch(u, o); },
      now: function () { return Date.now(); }, clientId: CID, redirectUri: redirectUri(), secureStore: secureStore() });
    return S.client;
  }
  function ico(name) { // inline SVG, currentColor; no emoji, no external assets
    // Solid beamed eighth notes (the old stroke path rendered as a filled blob with fill=currentColor).
    var p = { music: '<path d="M20 3v11.6a3.4 3.4 0 1 1-2-3.1V7.3l-8 1.6v7.7a3.4 3.4 0 1 1-2-3.1V5.4L20 3z"/>',
      play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
      next: '<path d="M6 6l8 6-8 6zM16 6h2v12h-2z"/>', prev: '<path d="M18 6l-8 6 8 6zM6 6h2v12H6z"/>',
      ext: '<path d="M14 4h6v6h-2V6.4L10.4 14 9 12.6 16.6 5H14zM5 5h6v2H7v10h10v-4h2v6H5z"/>',
      chev: '<path d="M7.4 9 12 13.6 16.6 9 18 10.4l-6 6-6-6z"/>', min: '<path d="M5 11h14v2H5z"/>',
      close: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/>' };
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">' + (p[name] || p.music) + "</svg>";
  }
  // Spotify icon (brand guidelines: unaltered, Spotify green). Path from the public Spotify icon mark.
  function spotifyMark() {
    return '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
  }
  function fmt(ms) { var t = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2); }
  function thumb(images, px) {
    var u = G.PREP_SOUND_PLAYER ? G.PREP_SOUND_PLAYER._pure.pickArtwork(images || [], 64) : null;
    return u ? '<img src="' + esc(u) + '" alt="" width="' + px + '" height="' + px + '" loading="lazy">' : '<span class="pn-sound-sp-thumb0" aria-hidden="true">' + ico("music") + "</span>";
  }
  // Other places the switcher can send the learner: only providers whose module is loaded on this device.
  function otherProviders() { return G.PREP_SOUND && G.PREP_SOUND.act ? [{ id: "sound", label: "PrepNucleus ambience and other apps" }] : []; }
  function headHtml(connected) {
    var others = otherProviders();
    var h = '<div class="pn-sound-sp-head"><span class="pn-sound-sp-logo">' + spotifyMark() + '</span><h2 id="pnSoundSpT">Music</h2>' +
      (others.length ? '<button type="button" class="pn-sound-sp-prov" data-act="sp-prov" aria-haspopup="true" aria-expanded="' + !!S.provOpen + '">on Spotify' + ico("chev") + "</button>"
        : '<span class="pn-sound-sp-brand">on Spotify</span>') +
      '<span class="pn-sound-sp-hsp"></span>' +
      (connected ? '<button type="button" class="pn-sound-sp-hbtn" data-act="sp-min" aria-label="Minimise player">' + ico("min") + "</button>" : "") +
      '<button type="button" class="pn-sound-sp-hbtn" data-act="sp-close" aria-label="Close player">' + ico("close") + "</button></div>";
    if (S.provOpen && others.length) {
      h += '<div class="pn-sound-sp-menu" role="group" aria-label="Play music from"><button type="button" class="pn-sound-sp-mi on" aria-pressed="true" data-act="sp-prov">Spotify</button>' +
        others.map(function (o) { return '<button type="button" class="pn-sound-sp-mi" aria-pressed="false" data-act="sp-switch" data-v="' + o.id + '">' + esc(o.label) + "</button>"; }).join("") + "</div>";
    }
    return h;
  }
  function nextHtml() {
    if (S.queue == null) return "";
    var rows = S.showAll ? S.queue : S.queue.slice(0, 3);
    var h = '<div class="pn-sound-sp-nexthead"><h3>Up next</h3><button type="button" class="pn-sound-sp-link" data-act="sp-all" aria-expanded="' + !!S.showAll + '">' +
      (S.showAll ? "Show less" : "See all") + "</button></div>";
    if (!rows.length) return h + '<p class="pn-sound-sp-note">' + (S.showAll ? "Nothing queued. Pick a playlist or search below." : "Nothing queued. Open See all to pick a playlist or search.") + "</p>";
    return h + '<ul class="pn-sound-sp-queue">' + rows.map(function (q) {
      var inner = thumb(q.images, 48) + '<span class="pn-sound-sp-it"><b>' + esc(q.title) + "</b><small>" + esc(q.subtitle) + '</small></span><span class="pn-sound-sp-dur">' + (q.durationMs ? fmt(q.durationMs) : "") + "</span>";
      return S.premium
        ? '<li><button type="button" class="pn-sound-sp-qi" data-act="sp-pick" data-v="' + esc(q.uri) + '" aria-label="Play ' + esc(q.title) + ' now">' + inner + "</button></li>"
        : '<li><a class="pn-sound-sp-qi" href="' + esc(openUrl(q.uri)) + '" target="_blank" rel="noopener">' + inner + "</a></li>";
    }).join("") + "</ul>";
  }
  // Now playing, or (nothing active anywhere) the last played track so the card is never blank.
  function nowOrLast() {
    return client().nowPlaying().then(function (m) {
      if (m && m.title) return m;
      if (S.now && S.now.title) {   // Spotify went to sleep (iPadOS suspends it after a pause): keep the song on screen, paused, until Spotify reports another
        var keep = {}; for (var k in S.now) keep[k] = S.now[k];
        keep.isPlaying = false; keep.lastPlayed = true; keep.contextUri = keep.contextUri || ""; return keep;
      }
      return client().lastPlayed().then(function (l) { return l || m; }, function () { return m; });
    });
  }
  function status() {
    if (!client().store.has()) return Promise.resolve({ state: "idle" });
    return client().player().then(function (pl) {
      return { state: pl.track ? (pl.playing ? "playing_embedded" : "paused") : "ready", player: pl };
    }, function (e) { return { state: "error", error: e }; });
  }
  function sheetHtml() {
    var c = client(), h = "";
    h += '<span class="pn-grab" aria-hidden="true"></span>';
    h += headHtml(c.store.has());
    if (!c.store.has()) {
      h += '<p class="pn-sound-sp-note" id="pnSoundSpD">Connect your own Spotify to change songs without leaving your test. Music never starts on its own.</p>' +
        '<div class="pn-sheet-act"><button type="button" class="pn-btn pri pn-sound-sp-connect" data-act="sp-connect">Connect Spotify</button></div>';
      return h;
    }
    if (S.err) h += '<p class="pn-sound-sp-err" role="alert">' + esc(S.err.message || "Something went wrong.") +
      (S.err.reason === "no_device" || S.err.reason === "no_active_device" ? ' <a href="' + esc(openUrl(pendingUri())) + '" target="_blank" rel="noopener">Open Spotify</a>' : "") + "</p>";
    /* The shared Now Playing card (prep-sound-player.js) replaces the old
       now-playing line + 3 buttons: it always shows what is playing, ticks
       locally and re-syncs while visible. Without it (older build) the
       plain line below still renders — never a dead control either way. */
    if (G.PREP_SOUND_PLAYER && G.PREP_SOUND_PLAYER._pure) {
      h += '<div data-sp-player></div>';
      if (!S.premium) h += '<p class="pn-sound-sp-note">Spotify says this account needs Premium for remote control. Pick a playlist to open it in Spotify, then press play there.</p>';
      else if (S.now && S.now.lastPlayed) h += '<p class="pn-sound-sp-note" data-sp-last>Last played. Press play to start it on your Spotify.</p>';
    } else if (!S.premium) {
      h += '<p class="pn-sound-sp-note">You are on Spotify Free, so PrepNucleus cannot play or pause for you. Pick a playlist to open it in Spotify, then press play there.</p>';
    } else if (S.player && S.player.track) {
      var t = S.player.track;
      h += '<div class="pn-sound-sp-now"><b>' + esc(t.name) + "</b><small>" + esc(t.artists) + (S.player.device ? " · " + esc(S.player.device.name) : "") + "</small></div>";
    } else {
      h += '<p class="pn-sound-sp-note">Nothing is playing. Pick a playlist or search below — it starts on your Spotify.</p>';
    }
    if (!G.PREP_SOUND_PLAYER && S.premium) {
      var playing = !!(S.player && S.player.playing);
      h += '<div class="pn-sound-sp-controls" role="group" aria-label="Playback controls">' +
        '<button type="button" class="pn-sound-sp-btn" data-act="sp-prev" aria-label="Previous track">' + ico("prev") + "</button>" +
        '<button type="button" class="pn-sound-sp-btn main" data-act="' + (playing ? "sp-pause" : "sp-play") + '" aria-label="' + (playing ? "Pause" : "Play") + '">' + ico(playing ? "pause" : "play") + "</button>" +
        '<button type="button" class="pn-sound-sp-btn" data-act="sp-next" aria-label="Next track">' + ico("next") + "</button></div>";
      if (capabilities(true, S.player).volumeControl)
        h += '<label class="pn-sound-sp-vol">Volume <input type="range" min="0" max="100" step="1" value="' + S.player.device.volume + '" data-sp-vol aria-label="Volume"></label>';
    }
    h += '<div data-sp-next>' + nextHtml() + "</div>";
    if (!S.showAll) return h;   // search, playlists and Disconnect live behind See all (kept, never removed)
    h += '<form class="pn-sound-sp-search" data-sp-search><label class="pn-sr" for="pnSoundSpQ">Search Spotify</label>' +
      '<input id="pnSoundSpQ" type="search" autocomplete="off" placeholder="Search tracks and playlists" value="' + esc(S.query) + '">' +
      '<button type="submit" class="pn-btn sm">Search</button></form>';
    h += '<div class="pn-sound-sp-lists">' + listsHtml() + "</div>";
    h += '<div class="pn-sheet-act"><button type="button" class="pn-btn" data-act="sp-disconnect">Disconnect Spotify</button></div>';
    return h;
  }
  function listsHtml() {
    var h = "";
    function item(it) {
      var sub = it.kind === "track" ? it.artists : it.tracks == null ? "Playlist" : (it.tracks + (it.tracks === 1 ? " track" : " tracks"));
      if (S.premium) return '<li><button type="button" class="pn-sound-sp-item" data-act="sp-pick" data-v="' + esc(it.uri) + '"><span class="pn-sound-sp-ib">' + ico("play") + '</span><span class="pn-sound-sp-it"><b>' + esc(it.name) + "</b><small>" + esc(sub) + "</small></span></button></li>";
      return '<li><a class="pn-sound-sp-item" href="' + esc(openUrl(it.uri)) + '" target="_blank" rel="noopener"><span class="pn-sound-sp-ib">' + ico("ext") + '</span><span class="pn-sound-sp-it"><b>' + esc(it.name) + "</b><small>" + esc(sub) + " · Open in Spotify</small></span></a></li>";
    }
    if (S.results) {
      h += S.results.tracks.length ? '<h3>Tracks</h3><ul class="pn-sound-sp-list">' + S.results.tracks.map(item).join("") + "</ul>" : "";
      h += S.results.playlists.length ? '<h3>Playlists</h3><ul class="pn-sound-sp-list">' + S.results.playlists.map(item).join("") + "</ul>" : "";
      if (!S.results.tracks.length && !S.results.playlists.length) h += '<p class="pn-sound-sp-note">No matches. Try another search.</p>';
      return h;
    }
    if (S.playlists == null) return '<p class="pn-sound-sp-note" role="status">Loading your playlists…</p>';
    if (!S.playlists.length) return '<p class="pn-sound-sp-note">No playlists in your Spotify library yet. Search above instead.</p>';
    return "<h3>Your playlists</h3>" + '<ul class="pn-sound-sp-list">' + S.playlists.map(item).join("") + "</ul>";
  }
  function paintSheet() { syncCaps(); if (S.sheet) S.sheet.querySelector(".pn-sheet").innerHTML = sheetHtml(); wireSheet(); mountPlayerCard(); }
  /* Mount the shared card into the sheet. The card ticks locally (1s) and
     the poller re-syncs from Spotify (~5s) only while the sheet is visible;
     paintSheet remounts after a full repaint, closeSheet unmounts so no
     timer outlives the sheet. */
  function cardState() {
    var PL = G.PREP_SOUND_PLAYER, m = S.now;
    if (!m) m = { provider: "spotify", providerLabel: "Spotify", title: "", likeAvailable: client().store.hasScope("user-library-modify") };
    var copy = {}; for (var k in m) copy[k] = m[k];
    copy.artworkUrl = PL._pure.pickArtwork(m.images || []);
    return { model: copy, caps: capsForPlayer(S.premium, m, client().store.hasScope("user-library-modify")) };
  }
  function mountPlayerCard() {
    var PL = G.PREP_SOUND_PLAYER;
    if (!PL || !S.sheet) return;
    var box = S.sheet.querySelector("[data-sp-player]");
    if (!box) return;
    function fresh() {
      return Promise.all([nowOrLast(), client().queue().then(null, function () { return S.queue; })]).then(function (a) {
        S.now = a[0]; S.queue = a[1] || [];
        var nb = S.sheet && S.sheet.querySelector("[data-sp-next]"); if (nb) nb.innerHTML = nextHtml();
        clearErr(); syncLastNote();
        return cardState();
      });
    }
    function after(p) {
      p.then(function () {
        clearErr();
        G.setTimeout(function () { if (S.playerHandle) fresh().then(function (s) { if (S.playerHandle) S.playerHandle.refresh(s); }, function () {}); }, 700);
        return nowOrLast().then(function (m) { S.now = m; if (S.playerHandle) S.playerHandle.refresh(cardState()); syncLastNote(); });
      }).then(null, fail);
    }
    S.playerHandle = PL.mount(box, {
      getState: cardState,
      renderOpts: { layout: "row", pickLabel: "Pick a playlist or search", emptyHint: "Press play to resume, or pick from Up next", artHref: S.now && S.now.trackUri ? openUrl(S.now.trackUri) : "" },
      fetchState: fresh,
      onAction: function (act, value) {
        var m = S.now || {};
        if (act === "toggle" && !m.isPlaying) { playFromIdle(m); return; }
        if (act === "toggle") {
          var was = !!m.isPlaying;
          if (S.now) { S.now.isPlaying = !was; if (S.playerHandle) S.playerHandle.refresh(cardState()); }   // flip at once; Spotify confirms
          after(withDevice(function () { return was ? client().pause() : client().play(); }));
        }
        else if (act === "next") after(withDevice(function () { return client().next(); }));
        else if (act === "previous") after(withDevice(function () { return client().previous(); }));
        else if (act === "shuffle") after(client().shuffle(!m.shuffle));
        else if (act === "repeat") after(client().repeatMode(PL._pure.nextRepeat(m.repeat)));
        else if (act === "seek") after(client().seekMs(value));
        else if (act === "volume") client().volume(value).then(function () {}, fail);
        else if (act === "like" && m.trackId) after(m.liked ? client().removeTrack(m.trackId, m.trackUri) : client().saveTrack(m.trackId, m.trackUri));
        else if (act === "pick") { var q = S.sheet && S.sheet.querySelector("#pnSoundSpQ"); if (q) q.focus(); }
      }
    });
  }
  function wireSheet() {
    if (!S.sheet) return;
    var f = S.sheet.querySelector("[data-sp-search]");
    if (f) f.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = S.sheet.querySelector("#pnSoundSpQ").value.replace(/^\s+|\s+$/g, "");
      S.query = q; if (!q) { S.results = null; return paintSheet(); }
      client().search(q).then(function (r) { S.results = r; S.err = null; paintSheet(); }, fail);
    });
    var v = S.sheet.querySelector("[data-sp-vol]");
    if (v) v.addEventListener("change", function () { client().volume(Number(v.value)).then(refresh, fail); });
  }
  // Spotify removed user.product for development-mode apps (Feb 2026), so a missing field means "assume Premium";
  // only an explicit non-premium product, or a real Premium-required refusal (fail), turns controls off.
  function premiumOf(me) { return !(me && me.product && me.product !== "premium"); }
  function fail(e) {
    S.err = e && e.message ? e : { message: "Spotify did not answer. Try again." };
    if (S.err.reason === "premium_required") S.premium = false;
    S.busy = false; paintSheet();
  }
  function clearErr() { if (!S.err) return; S.err = null; var el = S.sheet && S.sheet.querySelector(".pn-sound-sp-err"); if (el) el.parentNode.removeChild(el); }
  // A command with no active Spotify device: wake the account's first available device, then retry once.
  function withDevice(fn) {
    return fn().then(null, function (e) {
      if (!e || e.reason !== "no_active_device") throw e;
      return client().devices().then(function (ds) {
        var d = ds.filter(function (x) { return x && x.id && !x.is_restricted; })[0];
        if (!d) throw { reason: "no_device", message: "iPadOS or iOS put Spotify to sleep in the background, so it cannot be started from here. Tap Open Spotify once; your song continues here when you come back." };
        return client().transfer(d.id).then(function () { return fn(d.id); });   // retry aimed at the woken device
      });
    });
  }
  function refresh() {
    var c = client();
    G.setTimeout(function () { if (S.sheet) c.player().then(function (pl) { S.player = pl; paintSheet(); }, function () {}); }, 700);
    return c.player().then(function (pl) { S.player = pl; S.err = null; paintSheet(); }, fail);
  }
  function loadConnected() {
    var c = client();
    return c.me().then(function (me) {
      S.me = me; S.premium = premiumOf(me);
      return Promise.all([c.player().then(function (pl) { S.player = pl; }, function (e) { S.err = e; }),
        nowOrLast().then(function (m) { S.now = m; }, function () {}),
        c.queue().then(function (q) { S.queue = q; }, function () { S.queue = []; }),
        c.playlists().then(function (pl) { S.playlists = pl; }, function () { S.playlists = []; })]);
    }).then(paintSheet, fail);
  }
  function openSheet(host) {
    if (host) S.host = host;
    var root = S.host && S.host.root && S.host.root();
    if (!root || S.sheet) return S.sheet ? true : false;
    var el = D.createElement("div");
    // Wide screens: a floating panel beside the study page (no scrim, not modal). Phones: the bottom sheet.
    var wide = !!(G.matchMedia && G.matchMedia("(min-width: 700px)").matches);
    // The panel is not a bottom sheet: without .pn-sheet-wrap the shared swipe-to-dismiss (which closes by tapping a
    // scrim the panel does not have, leaving it invisible off-screen) and the sheet key capture leave it alone.
    el.className = (wide ? "pn-sound-sp-wrap is-panel" : "pn-sheet-wrap pn-sound-sp-wrap"); el.id = "pnSoundSpSheet";
    el.innerHTML = (wide ? "" : '<div class="pn-scrim" data-act="sp-min"></div>') +
      '<section class="pn-sheet pn-sound-sp-sheet" role="dialog" aria-modal="' + !wide + '" aria-labelledby="pnSoundSpT" tabindex="-1"></section>';
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); minimise(); } });
    S.prev = D.activeElement; root.appendChild(el); S.sheet = el;
    paintSheet(); paintDock();
    var f = el.querySelector(".pn-sheet"); try { f.focus({ preventScroll: true }); } catch (e) {}
    if (client().store.has() && S.playlists == null) loadConnected();
    return true;
  }
  function closeSheet() {
    if (!S.sheet) return false;
    try { if (G.PREP_SOUND_PLAYER) { var pb = S.sheet.querySelector("[data-sp-player]"); if (pb) G.PREP_SOUND_PLAYER.unmount(pb); } } catch (e) {}
    S.playerHandle = null;
    if (S.sheet.parentNode) S.sheet.parentNode.removeChild(S.sheet);
    S.sheet = null; S.provOpen = false;
    try { if (S.prev && S.prev.isConnected) S.prev.focus({ preventScroll: true }); } catch (e) {}
    paintDock();
    return true;
  }
  /* Play from idle: resume (or start the last played track) on an active or available Spotify device. With Spotify
     closed everywhere the Web API has nothing to control, so open the Spotify app on the song and finish when the
     learner returns: the reopened app is then an available device and takes the transfer + play. */
  function playBody(m) {
    if (!m || !m.lastPlayed) return undefined;
    var b = m.contextUri ? { context_uri: m.contextUri, offset: { uri: m.trackUri } } : { uris: [m.trackUri] };
    if (m.positionMs > 0) b.position_ms = Math.round(m.positionMs);   // continue where it paused, not from 0:00
    return b;
  }
  function playFromIdle(m) {
    var body = playBody(m);
    if (S.now) { S.now.isPlaying = true; if (S.playerHandle) S.playerHandle.refresh(cardState()); paintDock(); }
    return withDevice(function (id) { return client().play(body, id); }).then(function () { clearErr(); syncMiniSoon(); refreshCard(); }, function (e) {
      if (e && e.reason === "no_device") { S.pendingPlay = body || {}; if (S.now) S.now.isPlaying = false; return fail({ reason: "no_device", message: "iPadOS or iOS put Spotify to sleep in the background, so it cannot be started from here. Tap Open Spotify once; your song continues here when you come back." }); }
      if (S.now) S.now.isPlaying = false; fail(e);
    });
  }
  function pendingUri() { var b = S.pendingPlay || {}; return (b.uris && b.uris[0]) || b.context_uri || ""; }
  function resumePending() {
    if (!S.pendingPlay || D.visibilityState === "hidden") return;
    var body = S.pendingPlay; S.pendingPlay = null;
    client().devices().then(function (ds) {
      var d = ds.filter(function (x) { return x && x.id && !x.is_restricted; })[0];
      if (!d) return say("Spotify is not running. Press play in Spotify once, then use the player here.");
      return client().play(body && (body.uris || body.context_uri) ? body : undefined, d.id).then(function () { say("Playing on " + (d.name || "Spotify") + "."); syncMiniSoon(); refreshCard(); });
    }, function () {});
  }
  D.addEventListener("visibilitychange", resumePending);
  function refreshCard() { if (S.playerHandle) nowOrLast().then(function (n) { S.now = n; if (S.playerHandle) S.playerHandle.refresh(cardState()); syncLastNote(); }, function () {}); }
  // The "Last played" hint belongs to the idle card only; drop it once something is really playing.
  function syncLastNote() { var n = S.sheet && S.sheet.querySelector("[data-sp-last]"); if (n && !(S.now && S.now.lastPlayed)) n.parentNode.removeChild(n); }
  function minimise() { setState("mini"); return closeSheet(); }
  function connect() {
    var verifier = makeVerifier(rng), state = makeState(rng);
    try {
      G.localStorage.setItem(VERIFIER_KEY, verifier);
      G.localStorage.setItem(STATE_KEY, state);
    } catch (e) { if (S.host) S.host.toast("Sign-in needs browser storage for a moment. Allow it and try again."); return; }
    subtleChallenge(verifier).then(function (ch) {
      G.location.href = authorizeUrl({ clientId: CID, redirectUri: redirectUri(), state: state, challenge: ch });
    });
  }
  // OAuth return: ?code=&state= on the redirect URI. State must match; verifier is single-use.
  // url: the stewardmd://spotify-callback?code=&state= deep link in the app; omitted on web (page query).
  function handleReturn(url) {
    var src = url || G.location.search;
    var code = (src.match(/[?&]code=([^&#]+)/) || [])[1];
    if (!code) return;
    var state = (src.match(/[?&]state=([^&#]+)/) || [])[1], want = null, verifier = null;
    try { want = G.localStorage.getItem(STATE_KEY); verifier = G.localStorage.getItem(VERIFIER_KEY); } catch (e) {}
    try { G.localStorage.removeItem(STATE_KEY); G.localStorage.removeItem(VERIFIER_KEY); } catch (e) {}
    if (!url) try { G.history.replaceState(null, "", G.location.pathname + G.location.hash); } catch (e) {}
    if (!state || !want || state !== want || !verifier) return say("Spotify sign-in did not finish. Tap Connect Spotify again.");
    client().exchange(decodeURIComponent(code), verifier).then(function () {
      say("Spotify connected.");
      if (S.sheet) paintSheet(); else if (G.PREP && G.PREP._host) openSheet(G.PREP._host);
    }, function (e) { say((e && e.message) || "Spotify sign-in failed. Tap Connect Spotify again."); });
  }
  function say(msg) { try { var h = S.host || (G.PREP && G.PREP._host); if (h && h.toast) h.toast(msg); else if (G.toast) G.toast(msg); } catch (e) {} }
  function pick(uri) {
    var body = /^spotify:track:/.test(uri) ? { uris: [uri] } : { context_uri: uri };
    // Plays right here on the learner's Spotify; PrepNucleus never switches apps on its own (owner 2026-10-31).
    withDevice(function (id) { return client().play(body, id); }).then(function () { clearErr(); syncMiniSoon(); refreshCard(); }, function (e) {
      if (e && e.reason === "no_device") S.pendingPlay = body;
      fail(e);
    });
  }
  function act(a, b, host) {
    if (host) S.host = host;
    if (a === "sp-open") { setState("mini"); return openSheet(host); }
    if (a === "sp-min") return minimise();
    if (a === "sp-close") { setState("closed"); return closeSheet(); }
    if (a === "sp-prov") { S.provOpen = !S.provOpen; return paintSheet(); }
    if (a === "sp-switch") { closeSheet(); try { G.PREP_SOUND.act("s-open", b, S.host); } catch (e) {} return true; }
    if (a === "sp-all") { S.showAll = !S.showAll; return paintSheet(); }
    if (a === "sp-mini-toggle" && !(S.now && S.now.isPlaying)) return playFromIdle(S.now);
    if (a === "sp-mini-toggle") {
      var was = !!(S.now && S.now.isPlaying);
      if (S.now) { S.now.isPlaying = !was; paintDock(); }
      return withDevice(function () { return was ? client().pause() : client().play(); }).then(syncMiniSoon, function (e) { syncMiniSoon(); say(e && e.message || "Spotify did not answer. Try again."); });
    }
    if (a === "sp-mini-next") return withDevice(function () { return client().next(); }).then(syncMiniSoon, function (e) { syncMiniSoon(); say(e && e.message || "Spotify did not answer. Try again."); });
    if (a === "sp-connect") return connect();
    if (a === "sp-disconnect") { client().disconnect(); S.premium = false; S.me = null; S.player = null; S.now = null; S.playlists = null; S.results = null; S.err = null; return paintSheet(); }
    if (a === "sp-play") return client().play().then(refresh, fail);
    if (a === "sp-pause") return client().pause().then(refresh, fail);
    if (a === "sp-next") return client().next().then(refresh, fail);
    if (a === "sp-prev") return client().previous().then(refresh, fail);
    if (a === "sp-pick") return pick(b.getAttribute("data-v"));
  }
  function dockButtonHtml() {
    return '<button type="button" class="pn-sound-sp-fab" data-act="sp-open" aria-label="Music on Spotify">' + ico("music") + "</button>";
  }
  function miniOn() { return !S.sheet && S.state !== "closed" && client().store.has() && !!(S.now && S.now.title); }
  function miniHtml() {
    var m = S.now, pct = m.durationMs ? Math.min(100, Math.round((m.positionMs / m.durationMs) * 100)) : 0;
    return '<div class="pn-sound-sp-mini" role="region" aria-label="Now playing on Spotify">' +
      '<button type="button" class="pn-sound-sp-mbody" data-act="sp-open" aria-label="Open player, ' + esc(m.title) + (m.artist ? " by " + esc(m.artist) : "") + '">' +
      thumb(m.images, 44) + '<span class="pn-sound-sp-it"><b>' + esc(m.title) + "</b><small>" + esc(m.artist || "Spotify") + "</small></span></button>" +
      (S.premium ? '<button type="button" class="pn-sound-sp-mbtn play" data-act="sp-mini-toggle" aria-label="' + (m.isPlaying ? "Pause" : "Play") + '">' + ico(m.isPlaying ? "pause" : "play") + "</button>" +
        '<button type="button" class="pn-sound-sp-mbtn" data-act="sp-mini-next" aria-label="Next track">' + ico("next") + "</button>" : "") +
      '<span class="pn-sound-sp-mprog" aria-hidden="true"><span style="width:' + pct + '%"></span></span></div>';
  }
  // One dock in the PrepNucleus root: the mini player while something plays, else the round music button.
  function paintDock() {
    var root = G.PREP && G.PREP._host && G.PREP._host.root && G.PREP._host.root();
    if (!root) return;
    if (S.sheet && !S.sheet.isConnected) { S.sheet = null; S.playerHandle = null; S.provOpen = false; }   // removed by someone else: show the dock again
    if (!S.dock || !S.dock.isConnected) { S.dock = D.createElement("div"); S.dock.className = "pn-sound-sp-dock"; root.appendChild(S.dock); }
    var html = S.sheet ? "" : miniOn() ? miniHtml() : dockButtonHtml();
    S.dock.classList.toggle("is-stacked", !!root.querySelector(".pn-sound-dock"));   // sit above the ambience dock
    if (S.dock.getAttribute("data-html") !== html) { S.dock.innerHTML = html; S.dock.setAttribute("data-html", html); }
  }
  function syncMini() {
    if (!client().store.has() || S.state === "closed" || S.sheet) return;
    if (!S.me) client().me().then(function (me) { S.me = me; S.premium = premiumOf(me); paintDock(); }, function () {});
    nowOrLast().then(function (m) { S.now = m; paintDock(); }, function () {});
  }
  function syncMiniSoon() { G.setTimeout(syncMini, 600); }
  var timer = G.setInterval(function () {
    try { paintDock(); if (++S.tick % 5 === 0 && D.visibilityState !== "hidden") syncMini(); } catch (e) {}
  }, 1000);

  // Sound plan 4.2 adapter, in the exact registry shape prep-sound-providers.js checks:
  // capabilities is a live object (same reference, mutated as Premium/device state arrives).
  var caps = capabilities(false, null);
  function syncCaps() { var n = capabilities(S.premium, S.player); for (var k in n) caps[k] = n[k]; }
  function res(p) { return p.then(function () { return { ok: true }; }, function (e) { return { ok: false, error: "spotify:" + (e.reason || "provider_error") }; }); }
  var adapter = { id: "spotify_remote", capabilities: caps,
    getStatus: function () { return status().then(function (s) { return { ok: s.state !== "error", state: s.state, player: s.player || null }; }); },
    play: function () { return caps.remoteControls ? res(client().play()) : Promise.resolve({ ok: false, error: "unsupported:spotify_remote:play" }); },
    pause: function () { return caps.remoteControls ? res(client().pause()) : Promise.resolve({ ok: false, error: "unsupported:spotify_remote:pause" }); },
    stop: function () { return caps.remoteControls ? res(client().pause()) : Promise.resolve({ ok: false, error: "unsupported:spotify_remote:stop" }); },
    next: function () { return caps.queueControls ? res(client().next()) : Promise.resolve({ ok: false, error: "unsupported:spotify_remote:next" }); },
    previous: function () { return caps.queueControls ? res(client().previous()) : Promise.resolve({ ok: false, error: "unsupported:spotify_remote:previous" }); },
    setVolume: function (v) { return caps.volumeControl ? res(client().volume(Number(v) * 100)) : Promise.resolve({ ok: false, error: "unsupported:spotify_remote:setVolume" }); },
    openExternal: function (target) {
      var url = target && (target.url || openUrl(target.uri));
      if (typeof url !== "string" || !/^https:\/\//.test(url)) return Promise.resolve({ ok: false, error: "unavailable:bad-url" });
      G.open(url, "_blank", "noopener"); return Promise.resolve({ ok: true });
    },
    disconnect: function () { client().disconnect(); S.premium = false; syncCaps(); return Promise.resolve({ ok: true }); },
    dispose: function () { G.clearInterval(timer); closeSheet(); return Promise.resolve(); } };
  // Register with the Sound Dock when it is present (rs-sound); harmless when it is not.
  try { if (G.PREP_SOUND_PROVIDERS && G.PREP_SOUND_PROVIDERS.registerAdapter) G.PREP_SOUND_PROVIDERS.registerAdapter(adapter); } catch (e) {}

  G.PREP_SOUND_SPOTIFY = { act: act, openSheet: openSheet, closeSheet: closeSheet,
    dockButtonHtml: dockButtonHtml, adapter: adapter, back: function () { return closeSheet(); },
    leave: function () { return closeSheet(); }, _pure: PURE, _s: S };
  handleReturn();
  /* Cold start on native Android: restore the Spotify session from secure
     storage (refresh token only). Skipped during an OAuth return, which
     exchanges its own code. Failure leaves the Connect state untouched. */
  try {
    var hasCode = /[?&]code=/.test(G.location.search || "");
    if (!hasCode && secureStore()) {
      client().restoreSession().then(function (restored) {
        if (!restored) return;
        if (S.sheet) loadConnected(); else syncMini();   // back to the mini player without waiting for the 5 s tick
      }, function () {});
    }
  } catch (e) {}
  // Warm return (appUrlOpen) and cold start from the link (getLaunchUrl); the verifier is single-use, so a repeat is a no-op.
  try {
    var AppP = native() && G.Capacitor.Plugins && G.Capacitor.Plugins.App, isCb = function (u) { return /^stewardmd:\/\/spotify-callback/.test(u || ""); };
    if (AppP) {
      AppP.addListener("appUrlOpen", function (d) { if (d && isCb(d.url)) handleReturn(d.url); });
      AppP.getLaunchUrl().then(function (d) { if (d && isCb(d.url)) handleReturn(d.url); }).catch(function () {});
    }
  } catch (e) {}
})(typeof window !== "undefined" ? window : this);


