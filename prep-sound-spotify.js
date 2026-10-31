/* PrepNucleus Sound — Spotify mini-player (job rs-spotify). ES5. window.PREP_SOUND_SPOTIFY.
   A small round music button opens a compact sheet over the study screen. First open shows only
   "Connect Spotify"; music never starts without a tap. After sign-in: now-playing, play/pause,
   next/previous, volume where the device allows it, the learner's own playlists, and search for
   tracks and playlists. Choosing one starts it on the learner's own Spotify and the sheet closes.
   Free accounts get playlists + "Open in Spotify" with a plain explanation. Show only working
   controls: capabilities come from the live account (Premium?) and device (supports_volume?).

   Auth is Authorization Code + PKCE with NO client secret anywhere. Minimum scopes only (see
   SCOPES). Tokens live in memory only; nothing goes to PrepNucleus analytics or the AI Tutor,
   and no listening history is collected. The PKCE verifier + OAuth state sit in sessionStorage
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
    "user-modify-playback-state", "playlist-read-private", "playlist-read-collaborative", "user-library-read"];
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
    return { kind: "track", uri: t.uri, name: String(t.name || "Untitled"), artists: artists,
      album: t.album ? String(t.album.name || "") : "", durationMs: t.duration_ms || 0 };
  }
  function playlistOf(p) {
    if (!p || !p.uri) return null;
    return { kind: "playlist", uri: p.uri, name: String(p.name || "Untitled playlist"),
      owner: p.owner ? String(p.owner.display_name || "") : "", tracks: p.tracks ? (p.tracks.total || 0) : 0 };
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

  /* ================= token store: memory only ================= */
  function makeTokenStore(now) {
    var t = null; // { access, refresh, expiresAt } — never persisted, never logged.
    return {
      set: function (j) {
        if (!j || !j.access_token) return false;
        t = { access: j.access_token, refresh: j.refresh_token || (t && t.refresh) || null,
          expiresAt: now() + (j.expires_in ? j.expires_in * 1000 : 3600000) };
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
    function tokenPost(body) {
      return deps.fetch(TOKEN_URL, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
        .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
        .then(function (x) {
          // A refused code/refresh grant (400/401) means sign-in again, never a raw provider error.
          if (x.r.status !== 200 || !store.set(x.j)) throw apiError(401);
          return true;
        }, function () { throw { reason: "offline", message: "No connection. Check your network and try again." }; });
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
    function call(method, path, body) {
      return ensureToken().then(function () {
        return deps.fetch(API + path, { method: method,
          headers: { Authorization: "Bearer " + store.access(), "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined });
      }).then(function (r) {
        if (r.status === 200 || r.status === 204) return r.status === 204 ? null : r.json();
        if (r.status === 401) { // one forced refresh + one retry, then surface auth_expired
          return refresh().then(function () {
            return deps.fetch(API + path, { method: method,
              headers: { Authorization: "Bearer " + store.access(), "Content-Type": "application/json" },
              body: body ? JSON.stringify(body) : undefined });
          }).then(function (r2) {
            if (r2.status === 200 || r2.status === 204) return r2.status === 204 ? null : r2.json();
            throw apiError(r2.status, retryOf(r2));
          });
        }
        throw apiError(r.status, retryOf(r));
      }, function (e) { if (e && e.reason) throw e; throw { reason: "offline", message: "No connection. Check your network and try again." }; });
    }
    function retryOf(r) { try { var v = r.headers && r.headers.get && r.headers.get("Retry-After"); return v ? Number(v) : null; } catch (e) { return null; } }
    return {
      store: store, exchange: exchange, refresh: refresh,
      me: function () { return call("GET", "/me"); },
      player: function () { return call("GET", "/me/player").then(parsePlayer); },
      play: function (body) { return call("PUT", "/me/player/play", body || {}); },
      pause: function () { return call("PUT", "/me/player/pause"); },
      next: function () { return call("POST", "/me/player/next"); },
      previous: function () { return call("POST", "/me/player/previous"); },
      volume: function (pct) { return call("PUT", "/me/player/volume?volume_percent=" + Math.max(0, Math.min(100, Math.round(pct)))); },
      playlists: function () { return call("GET", "/me/playlists?limit=50").then(parsePlaylists); },
      search: function (q) {
        return call("GET", "/search?type=track,playlist&limit=10&market=from_token&q=" + encodeURIComponent(q)).then(parseSearch);
      },
      disconnect: function () { store.clear(); }
    };
  }

  var PURE = { esc: esc, b64url: b64url, makeVerifier: makeVerifier, makeState: makeState,
    challengeS256: challengeS256, authorizeUrl: authorizeUrl, openUrl: openUrl, trackOf: trackOf,
    playlistOf: playlistOf, parsePlaylists: parsePlaylists, parseSearch: parseSearch, parsePlayer: parsePlayer,
    apiError: apiError, capabilities: capabilities, makeTokenStore: makeTokenStore, makeClient: makeClient,
    SCOPES: SCOPES, AUTH_URL: AUTH_URL, TOKEN_URL: TOKEN_URL, API: API };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= flags + config (inert unless every gate is on) ================= */
  function flagOn(key, param) {
    try {
      var q = (G.location.search.match(new RegExp("[?&]" + param + "=([^&]+)")) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return G.localStorage.getItem(key) === "1";
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
    return "";
  }
  function redirectUri() {
    try { if (G.SMD_SPOTIFY_REDIRECT_URI) return String(G.SMD_SPOTIFY_REDIRECT_URI); } catch (e) {}
    return G.location.origin + G.location.pathname;
  }
  var CID = clientId();
  if (!prepOn() || !flagOn("smd_prep_sound", "sound") || !flagOn("smd_prep_sound_spotify", "spotify") || !CID) return;

  /* ================= live state + sheet ================= */
  var D = G.document;
  var S = { host: null, sheet: null, prev: null, client: null, premium: false, me: null,
    player: null, playlists: null, results: null, busy: false, err: null, query: "" };
  function rng(n) { var b = new Uint8Array(n); (G.crypto || G.msCrypto).getRandomValues(b); return b; }
  function subtleChallenge(verifier) {
    var data = new TextEncoder().encode(verifier);
    return G.crypto.subtle.digest("SHA-256", data).then(function (buf) { return b64url(new Uint8Array(buf)); });
  }
  function client() {
    if (!S.client) S.client = makeClient({ fetch: function (u, o) { return G.fetch(u, o); },
      now: function () { return Date.now(); }, clientId: CID, redirectUri: redirectUri() });
    return S.client;
  }
  function ico(name) { // inline SVG, currentColor; no emoji, no external assets
    var p = { music: '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>',
      play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
      next: '<path d="M6 6l8 6-8 6zM16 6h2v12h-2z"/>', prev: '<path d="M18 6l-8 6 8 6zM6 6h2v12H6z"/>',
      ext: '<path d="M14 4h6v6h-2V6.4L10.4 14 9 12.6 16.6 5H14zM5 5h6v2H7v10h10v-4h2v6H5z"/>' };
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">' + (p[name] || p.music) + "</svg>";
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
    h += '<div class="pn-sound-sp-head"><h2 id="pnSoundSpT">Music</h2><span class="pn-sound-sp-brand">on Spotify</span></div>';
    if (!c.store.has()) {
      h += '<p class="pn-sound-sp-note" id="pnSoundSpD">Connect your own Spotify to change songs without leaving your test. Music never starts on its own.</p>' +
        '<div class="pn-sheet-act"><button type="button" class="pn-btn pri pn-sound-sp-connect" data-act="sp-connect">Connect Spotify</button></div>';
      return h;
    }
    if (S.err) h += '<p class="pn-sound-sp-err" role="alert">' + esc(S.err.message || "Something went wrong.") + "</p>";
    if (!S.premium) {
      h += '<p class="pn-sound-sp-note">You are on Spotify Free, so PrepNucleus cannot play or pause for you. Pick a playlist to open it in Spotify, then press play there.</p>';
    } else if (S.player && S.player.track) {
      var t = S.player.track;
      h += '<div class="pn-sound-sp-now"><b>' + esc(t.name) + "</b><small>" + esc(t.artists) + (S.player.device ? " · " + esc(S.player.device.name) : "") + "</small></div>";
    } else {
      h += '<p class="pn-sound-sp-note">Nothing is playing. Pick a playlist or search below — it starts on your Spotify.</p>';
    }
    if (S.premium) {
      var playing = !!(S.player && S.player.playing);
      h += '<div class="pn-sound-sp-controls" role="group" aria-label="Playback controls">' +
        '<button type="button" class="pn-sound-sp-btn" data-act="sp-prev" aria-label="Previous track">' + ico("prev") + "</button>" +
        '<button type="button" class="pn-sound-sp-btn main" data-act="' + (playing ? "sp-pause" : "sp-play") + '" aria-label="' + (playing ? "Pause" : "Play") + '">' + ico(playing ? "pause" : "play") + "</button>" +
        '<button type="button" class="pn-sound-sp-btn" data-act="sp-next" aria-label="Next track">' + ico("next") + "</button></div>";
      if (capabilities(true, S.player).volumeControl)
        h += '<label class="pn-sound-sp-vol">Volume <input type="range" min="0" max="100" step="1" value="' + S.player.device.volume + '" data-sp-vol aria-label="Volume"></label>';
    }
    h += '<form class="pn-sound-sp-search" data-sp-search><label class="pn-sr" for="pnSoundSpQ">Search Spotify</label>' +
      '<input id="pnSoundSpQ" type="search" autocomplete="off" placeholder="Search tracks and playlists" value="' + esc(S.query) + '">' +
      '<button type="submit" class="pn-btn sm">Search</button></form>';
    h += '<div class="pn-sound-sp-lists">' + listsHtml() + "</div>";
    h += '<div class="pn-sheet-act"><button type="button" class="pn-btn" data-act="sp-disconnect">Disconnect</button>' +
      '<button type="button" class="pn-btn" data-act="sp-close">Back to study</button></div>';
    return h;
  }
  function listsHtml() {
    var h = "";
    function item(it) {
      var sub = it.kind === "track" ? it.artists : (it.tracks + (it.tracks === 1 ? " track" : " tracks"));
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
  function paintSheet() { syncCaps(); if (S.sheet) S.sheet.querySelector(".pn-sheet").innerHTML = sheetHtml(); wireSheet(); }
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
  function fail(e) { S.err = e && e.message ? e : { message: "Spotify did not answer. Try again." }; S.busy = false; paintSheet(); }
  function refresh() {
    var c = client();
    return c.player().then(function (pl) { S.player = pl; S.err = null; paintSheet(); }, fail);
  }
  function loadConnected() {
    var c = client();
    return c.me().then(function (me) {
      S.me = me; S.premium = !!(me && me.product === "premium");
      return Promise.all([c.player().then(function (pl) { S.player = pl; }, function (e) { S.err = e; }),
        c.playlists().then(function (pl) { S.playlists = pl; }, function () { S.playlists = []; })]);
    }).then(paintSheet, fail);
  }
  function openSheet(host) {
    if (host) S.host = host;
    var root = S.host && S.host.root && S.host.root();
    if (!root || S.sheet) return S.sheet ? true : false;
    var el = D.createElement("div");
    el.className = "pn-sheet-wrap pn-sound-sp-wrap"; el.id = "pnSoundSpSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="sp-close"></div><section class="pn-sheet pn-sound-sp-sheet" role="dialog" aria-modal="true" aria-labelledby="pnSoundSpT" tabindex="-1"></section>';
    S.prev = D.activeElement; root.appendChild(el); S.sheet = el;
    paintSheet();
    var f = el.querySelector(".pn-sheet"); try { f.focus({ preventScroll: true }); } catch (e) {}
    if (client().store.has() && S.playlists == null) loadConnected();
    return true;
  }
  function closeSheet() {
    if (!S.sheet) return false;
    if (S.sheet.parentNode) S.sheet.parentNode.removeChild(S.sheet);
    S.sheet = null;
    try { if (S.prev && S.prev.isConnected) S.prev.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }
  function connect() {
    var verifier = makeVerifier(rng), state = makeState(rng);
    try {
      G.sessionStorage.setItem(VERIFIER_KEY, verifier);
      G.sessionStorage.setItem(STATE_KEY, state);
    } catch (e) { if (S.host) S.host.toast("Sign-in needs browser storage for a moment. Allow it and try again."); return; }
    subtleChallenge(verifier).then(function (ch) {
      G.location.href = authorizeUrl({ clientId: CID, redirectUri: redirectUri(), state: state, challenge: ch });
    });
  }
  // OAuth return: ?code=&state= on the redirect URI. State must match; verifier is single-use.
  function handleReturn() {
    var code = (G.location.search.match(/[?&]code=([^&]+)/) || [])[1];
    if (!code) return;
    var state = (G.location.search.match(/[?&]state=([^&]+)/) || [])[1], want = null, verifier = null;
    try { want = G.sessionStorage.getItem(STATE_KEY); verifier = G.sessionStorage.getItem(VERIFIER_KEY); } catch (e) {}
    try { G.sessionStorage.removeItem(STATE_KEY); G.sessionStorage.removeItem(VERIFIER_KEY); } catch (e) {}
    try { G.history.replaceState(null, "", G.location.pathname + G.location.hash); } catch (e) {}
    if (!state || !want || state !== want || !verifier) return;
    client().exchange(decodeURIComponent(code), verifier).then(function () {
      if (G.PREP && G.PREP._host) openSheet(G.PREP._host);
    }, function () {});
  }
  function pick(uri) {
    var body = /^spotify:track:/.test(uri) ? { uris: [uri] } : { context_uri: uri };
    client().play(body).then(function () { closeSheet(); }, fail);
  }
  function act(a, b, host) {
    if (host) S.host = host;
    if (a === "sp-open") return openSheet(host);
    if (a === "sp-close") return closeSheet();
    if (a === "sp-connect") return connect();
    if (a === "sp-disconnect") { client().disconnect(); S.premium = false; S.me = null; S.player = null; S.playlists = null; S.results = null; S.err = null; return paintSheet(); }
    if (a === "sp-play") return client().play().then(refresh, fail);
    if (a === "sp-pause") return client().pause().then(refresh, fail);
    if (a === "sp-next") return client().next().then(refresh, fail);
    if (a === "sp-prev") return client().previous().then(refresh, fail);
    if (a === "sp-pick") return pick(b.getAttribute("data-v"));
  }
  function dockButtonHtml() {
    return '<button type="button" class="pn-sound-sp-fab" data-act="sp-open" aria-label="Music on Spotify">' + ico("music") + "</button>";
  }
  // Until the Sound Dock (rs-sound) lands, mount the round button in the PrepNucleus root.
  function mountButton() {
    var root = G.PREP && G.PREP._host && G.PREP._host.root && G.PREP._host.root();
    if (!root || root.querySelector(".pn-sound-sp-fab")) return;
    var d = D.createElement("div"); d.innerHTML = dockButtonHtml();
    root.appendChild(d.firstChild);
  }
  var timer = G.setInterval(function () { try { mountButton(); } catch (e) {} }, 1000);

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
})(typeof window !== "undefined" ? window : this);


