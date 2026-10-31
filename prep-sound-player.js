/* PrepNucleus Sound — provider-agnostic "Now Playing" card (job rs-player-ui).
   window.PREP_SOUND_PLAYER. ES5. One centred-artwork card (owner reference:
   square artwork, title + artist, seek bar with elapsed/total, shuffle |
   previous | big play/pause | next | repeat, heart top-right, volume where
   supported, provider label) rendered from ONE provider-neutral model, so
   Spotify, PrepNucleus ambience and every future provider look and work the
   same. Fixed owner palette #071318 / #0D1D23 / accent #42CDB5; no glows,
   no gradients, no backdrops. Pure helpers run under node for tests.

   Model: { provider, providerLabel, title, artist, album, artworkUrl,
     artworkKey, durationMs, positionMs, isPlaying, shuffle,
     repeat ("off"|"context"|"track"), liked (true|false|null),
     likeAvailable, volume (0-100|null) }
   Caps:  { play, pause, next, previous, seek, shuffle, repeat, like,
     volume, artwork } — every control whose cap is false is ABSENT from the
   HTML, never a dead button. The one deliberate exception is the heart when
   the sign-in lacks the save scope: it renders disabled with the plain note
   "Reconnect Spotify to save songs" (the job's explicit requirement; the
   user is never force-reconnected).

   Progress: while playing, the bar ticks locally every second from
   positionMs (interpolatePosition) and re-syncs from the provider about
   every 5 s while the card is visible (createPoller). Polling and ticking
   stop when the card is hidden, closed, or the app is backgrounded. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clamp(n, lo, hi) { n = Number(n); if (!isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }

  var REPEAT_STATES = ["off", "context", "track"];
  function nextRepeat(r) { var i = REPEAT_STATES.indexOf(r); return REPEAT_STATES[(i < 0 ? 0 : i + 1) % REPEAT_STATES.length]; }

  function defaultCaps() {
    return { play: false, pause: false, next: false, previous: false, seek: false,
      shuffle: false, repeat: false, like: false, volume: false, artwork: false };
  }
  function normalizeCaps(c) {
    var d = defaultCaps(), k;
    if (!c || typeof c !== "object") return d;
    for (k in d) if (typeof c[k] === "boolean") d[k] = c[k];
    return d;
  }
  function normalizeModel(m) {
    m = (m && typeof m === "object") ? m : {};
    return {
      provider: typeof m.provider === "string" && m.provider ? m.provider : "unknown",
      providerLabel: typeof m.providerLabel === "string" && m.providerLabel ? m.providerLabel : "Music",
      title: typeof m.title === "string" ? m.title : "",
      artist: typeof m.artist === "string" ? m.artist : "",
      album: typeof m.album === "string" ? m.album : "",
      artworkUrl: typeof m.artworkUrl === "string" && /^https:\/\//.test(m.artworkUrl) ? m.artworkUrl : null,
      artworkKey: typeof m.artworkKey === "string" && m.artworkKey ? m.artworkKey : "default",
      durationMs: m.durationMs > 0 ? Math.round(m.durationMs) : 0,
      positionMs: m.positionMs > 0 ? Math.round(m.positionMs) : 0,
      isPlaying: !!m.isPlaying,
      shuffle: !!m.shuffle,
      repeat: REPEAT_STATES.indexOf(m.repeat) >= 0 ? m.repeat : "off",
      liked: m.liked === true ? true : m.liked === false ? false : null,
      likeAvailable: m.likeAvailable !== false,
      volume: m.volume == null ? null : Math.round(clamp(m.volume, 0, 100))
    };
  }
  function isEmpty(model) { return !normalizeModel(model).title; }

  /* "3:03" / "0:10" — hours only past an hour ("1:02:03"). */
  function formatMs(ms) {
    var s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    var mm = h && m < 10 ? "0" + m : "" + m, sss = ss < 10 ? "0" + ss : "" + ss;
    return (h ? h + ":" : "") + mm + ":" + sss;
  }
  /* Album artwork: the image closest to 300px wide (the card renders ~300px). */
  function pickArtwork(images, target) {
    if (!Array.isArray(images)) return null;
    target = target || 300;
    var best = null, bestD = Infinity, i, im;
    for (i = 0; i < images.length; i++) {
      im = images[i];
      if (!im || typeof im.url !== "string" || !/^https:\/\//.test(im.url)) continue;
      var d = Math.abs((im.width || target) - target);
      if (d < bestD) { bestD = d; best = im.url; }
    }
    return best;
  }
  /* Local 1s tick: advance positionMs from the last provider sync while
     playing; clamp at the track end; frozen while paused. baseAtMs is the
     clock reading (Date.now()-style) when positionMs was synced. */
  function interpolatePosition(model, baseAtMs, nowMs) {
    var m = normalizeModel(model);
    if (!m.isPlaying) return m.positionMs;
    var pos = m.positionMs + Math.max(0, (Number(nowMs) || 0) - (Number(baseAtMs) || 0));
    return m.durationMs > 0 ? Math.min(pos, m.durationMs) : pos;
  }
  /* Poll gate: re-sync only while the card is on screen and the app is in
     the foreground. Hidden/closed/backgrounded all stop the poller. */
  function shouldPoll(s) {
    return !!(s && s.visible && !s.documentHidden && s.hasCard);
  }

  /* Poller with injected timers (node-testable). fetch() must return a
     Promise of fresh { model, caps }; onData receives it. isActive() is
     checked before every fetch — once it turns false the interval is
     cleared and no further fetch happens. */
  function createPoller(o) {
    o = o || {};
    var pollMs = o.pollMs > 0 ? o.pollMs : 5000;
    var timer = null, stopped = false;
    var setI = o.setInterval || (typeof setInterval !== "undefined" ? setInterval : null);
    var clearI = o.clearInterval || (typeof clearInterval !== "undefined" ? clearInterval : null);
    function stop() {
      stopped = true;
      if (timer != null && clearI) { try { clearI(timer); } catch (e) {} }
      timer = null;
    }
    function cycle() {
      if (stopped) return;
      if (typeof o.isActive === "function" && !o.isActive()) { stop(); return; }
      if (typeof o.fetch !== "function") return;
      var p;
      try { p = o.fetch(); } catch (e) { return; }
      if (p && typeof p.then === "function") p.then(function (d) {
        if (!stopped && d && typeof o.onData === "function") o.onData(d);
      }, function () {});
    }
    function start() {
      if (timer != null || stopped || !setI) return false;
      timer = setI(cycle, pollMs);
      return true;
    }
    return { start: start, stop: stop, cycle: cycle, isStopped: function () { return stopped; } };
  }

  /* Calm generated tiles for first-party ambience (and artwork-less tracks):
     one flat SVG per preset key — original drawing, no stock images, no
     gradients. Same key always draws the same tile. */
  var TILE_PATHS = {
    deep_focus: '<circle cx="60" cy="60" r="34" fill="none" stroke="#42CDB5" stroke-width="2" opacity=".55"/><circle cx="60" cy="60" r="20" fill="none" stroke="#42CDB5" stroke-width="2" opacity=".8"/><circle cx="60" cy="60" r="5" fill="#42CDB5"/>',
    lofi_calm: '<path d="M14 44q8-10 16 0t16 0 16 0 16 0 16 0 12 0" fill="none" stroke="#42CDB5" stroke-width="2.5" opacity=".7"/><path d="M14 66q8-10 16 0t16 0 16 0 16 0 16 0 12 0" fill="none" stroke="#42CDB5" stroke-width="2.5" opacity=".45"/><path d="M14 86q8-10 16 0t16 0 16 0 16 0 16 0 12 0" fill="none" stroke="#42CDB5" stroke-width="2.5" opacity=".25"/>',
    night_shift: '<circle cx="82" cy="38" r="13" fill="#42CDB5" opacity=".85"/><circle cx="34" cy="30" r="2.4" fill="#E2F1EE"/><circle cx="52" cy="52" r="1.8" fill="#E2F1EE" opacity=".8"/><circle cx="28" cy="76" r="2.4" fill="#E2F1EE" opacity=".6"/><circle cx="88" cy="84" r="1.8" fill="#E2F1EE" opacity=".7"/><circle cx="64" cy="98" r="2.2" fill="#E2F1EE" opacity=".5"/>',
    slow_breath: '<path d="M8 78q26-30 52-18t52-6" fill="none" stroke="#42CDB5" stroke-width="3" opacity=".75"/><path d="M8 94q26-26 52-14t52-4" fill="none" stroke="#42CDB5" stroke-width="2.5" opacity=".4"/>',
    default: '<path d="M48 84V40l28-6v34" fill="none" stroke="#42CDB5" stroke-width="3"/><circle cx="38" cy="84" r="9" fill="none" stroke="#42CDB5" stroke-width="3"/><circle cx="66" cy="68" r="9" fill="none" stroke="#42CDB5" stroke-width="3"/>'
  };
  function tileHtml(model) {
    var p = TILE_PATHS[model.artworkKey] || TILE_PATHS.default;
    return '<div class="pn-player-tile pn-player-tile--' + esc(model.artworkKey.replace(/[^a-z0-9_]/gi, "")) +
      '" role="img" aria-label="' + esc(model.providerLabel + " artwork") + '">' +
      '<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" focusable="false">' + p + "</svg></div>";
  }

  function ico(name) {
    var p = {
      play: '<path d="M8 5v14l11-7z"/>',
      pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
      next: '<path d="M6 6l8 6-8 6zM16 6h2v12h-2z"/>',
      prev: '<path d="M18 6l-8 6 8 6zM6 6h2v12H6z"/>',
      shuffle: '<path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
      repeat: '<path d="M17 2.5 21 6.5l-4 4V8H6.5A2.5 2.5 0 0 0 4 10.5V13H2v-2.5A4.5 4.5 0 0 1 6.5 6H17V2.5zM7 21.5 3 17.5l4-4V16h10.5A2.5 2.5 0 0 0 20 13.5V11h2v2.5a4.5 4.5 0 0 1-4.5 4.5H7v3.5z"/>',
      heart: '<path d="M12 21s-7.5-4.9-10-9.3C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.4h4c.9-1.3 2.3-2.4 4.3-2.4 3.4 0 5.3 3.6 3.7 6.7C19.5 16.1 12 21 12 21z" transform="scale(.92)"/>',
      heartFill: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'
    };
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">' + (p[name] || p.play) + "</svg>";
  }

  /* opts: { acts: { toggle, next, previous, shuffle, repeat, like, pick }
     (extra data-act values for hosts that route clicks through data-act),
     likeDisabledReason, pickLabel, volumeDataAttr (e.g. 'data-svol="1"') } */
  function cardHtml(rawModel, rawCaps, opts) {
    opts = opts || {};
    var acts = opts.acts || {};
    var m = normalizeModel(rawModel), c = normalizeCaps(rawCaps);
    function act(name, extra) {
      return ' data-player-act="' + name + '"' + (acts[name] ? ' data-act="' + esc(acts[name]) + '"' : "") + (extra || "");
    }
    var head = '<div class="pn-player-top"><span class="pn-player-prov">on ' + esc(m.providerLabel) + "</span>";
    if (c.like) {
      if (!m.likeAvailable) {
        head += '<button type="button" class="pn-player-iconbtn" disabled aria-disabled="true" aria-label="Save song unavailable">' + ico("heart") + "</button>";
      } else {
        head += '<button type="button" class="pn-player-iconbtn' + (m.liked ? " on" : "") + '"' + act("like") +
          ' aria-pressed="' + !!m.liked + '" aria-label="' + (m.liked ? "Remove from your saved songs" : "Save this song") + '">' + ico(m.liked ? "heartFill" : "heart") + "</button>";
      }
    }
    head += "</div>";

    if (!m.title) {
      return '<section class="pn-player pn-player-empty" data-provider="' + esc(m.provider) + '" aria-label="Now playing">' + head +
        tileHtml(m) +
        '<p class="pn-player-nothing">Nothing playing</p>' +
        '<button type="button" class="pn-player-pick"' + act("pick") + ">" + esc(opts.pickLabel || "Pick something to play") + "</button>" +
        (!m.likeAvailable && c.like ? '<p class="pn-player-note">' + esc(opts.likeDisabledReason || "Reconnect Spotify to save songs") + "</p>" : "") +
        "</section>";
    }

    var art = "";
    if (c.artwork) {
      // Spotify's display rules: artwork shown unmodified and linking back to the item on Spotify (opts.artHref).
      var img = '<img src="' + esc(m.artworkUrl || "") + '" alt="" width="300" height="300" loading="lazy">';
      art = !m.artworkUrl ? tileHtml(m) : opts.artHref
        ? '<a class="pn-player-art" href="' + esc(opts.artHref) + '" target="_blank" rel="noopener" aria-label="Open ' + esc(m.title) + ' in ' + esc(m.providerLabel) + '">' + img + "</a>"
        : '<div class="pn-player-art">' + img + "</div>";
    }
    var seek = "";
    if (m.durationMs > 0) {
      if (c.seek) {
        seek = '<div class="pn-player-seekrow"><span class="pn-player-time" data-player-elapsed>' + formatMs(m.positionMs) + "</span>" +
          '<input type="range" class="pn-player-seek" data-player-seek min="0" max="' + m.durationMs + '" step="1000" value="' +
          Math.min(m.positionMs, m.durationMs) + '" aria-label="Seek in ' + esc(m.title) + '">' +
          '<span class="pn-player-time">' + formatMs(m.durationMs) + "</span></div>";
      } else {
        var pct = Math.min(100, Math.round((m.positionMs / m.durationMs) * 100));
        seek = '<div class="pn-player-seekrow"><span class="pn-player-time" data-player-elapsed>' + formatMs(m.positionMs) + "</span>" +
          '<div class="pn-player-bar" role="img" aria-label="' + pct + '% played"><span style="width:' + pct + '%"></span></div>' +
          '<span class="pn-player-time">' + formatMs(m.durationMs) + "</span></div>";
      }
    } else if (m.isPlaying) {
      seek = '<p class="pn-player-elapsed"><span data-player-elapsed>' + formatMs(m.positionMs) + "</span> elapsed</p>";
    }

    var transport = '<div class="pn-player-transport" role="group" aria-label="Playback controls">';
    if (c.shuffle) transport += '<button type="button" class="pn-player-iconbtn' + (m.shuffle ? " on" : "") + '"' + act("shuffle") + ' aria-pressed="' + !!m.shuffle + '" aria-label="Shuffle ' + (m.shuffle ? "on" : "off") + '">' + ico("shuffle") + "</button>";
    if (c.previous) transport += '<button type="button" class="pn-player-iconbtn"' + act("previous") + ' aria-label="Previous track">' + ico("prev") + "</button>";
    if (c.play || c.pause) {
      transport += '<button type="button" class="pn-player-play"' + act("toggle") + ' aria-label="' + (m.isPlaying ? "Pause" : "Play") + '">' + ico(m.isPlaying ? "pause" : "play") + "</button>";
    }
    if (c.next) transport += '<button type="button" class="pn-player-iconbtn"' + act("next") + ' aria-label="Next track">' + ico("next") + "</button>";
    if (c.repeat) transport += '<button type="button" class="pn-player-iconbtn' + (m.repeat !== "off" ? " on" : "") + '"' + act("repeat") + ' aria-label="Repeat: ' + m.repeat + '. Activate to change.">' + ico("repeat") + (m.repeat === "track" ? '<span class="pn-player-rep1" aria-hidden="true">1</span>' : "") + "</button>";
    transport += "</div>";

    var vol = "";
    if (c.volume && m.volume != null) {
      vol = '<label class="pn-player-vol"><span>Volume</span><input type="range" class="pn-player-volrange" data-player-volume' +
        (opts.volumeDataAttr ? " " + opts.volumeDataAttr : "") + ' min="0" max="100" step="1" value="' + m.volume + '" aria-label="Volume"></label>';
    }
    var likeNote = !m.likeAvailable && c.like
      ? '<p class="pn-player-note">' + esc(opts.likeDisabledReason || "Reconnect Spotify to save songs") + "</p>" : "";

    return '<section class="pn-player' + (opts.layout === "row" ? " pn-player--row" : "") + '" data-provider="' + esc(m.provider) + '" aria-label="Now playing on ' + esc(m.providerLabel) + '">' +
      head + art +
      '<h3 class="pn-player-title">' + esc(m.title) + "</h3>" +
      (m.artist ? '<p class="pn-player-artist">' + esc(m.artist) + "</p>" : "") +
      (m.album && m.album !== m.title ? '<p class="pn-player-album">' + esc(m.album) + "</p>" : "") +
      seek + transport + vol + likeNote + "</section>";
  }

  /* Honest card for providers PrepNucleus can only open (Gaana, JioSaavn,
     Amazon Music, YouTube Music — and Apple Music until MusicKit lands):
     no fake transport, one Open button. Wording names the iPhone limit on
     iOS; elsewhere it says the provider app owns playback. */
  function externalHtml(providerId, providerLabel, opts) {
    opts = opts || {};
    var label = providerLabel || "the music app";
    var where = opts.platform === "ios" ? "on iPhone" : "here";
    return '<section class="pn-player pn-player-external" data-provider="' + esc(providerId || "") + '" aria-label="Music in ' + esc(label) + '">' +
      tileHtml(normalizeModel({ provider: providerId, providerLabel: label, artworkKey: "default" })) +
      '<h3 class="pn-player-title">Playing in ' + esc(label) + "</h3>" +
      "<p class=\"pn-player-note\">PrepNucleus can't see or control it " + where + ". Play, pause and pick songs in " + esc(label) + ".</p>" +
      '<button type="button" class="pn-player-pick" data-player-act="open-app"' +
      (opts.openAct ? ' data-act="' + esc(opts.openAct) + '"' : "") +
      (opts.openV ? ' data-v="' + esc(opts.openV) + '"' : "") + ">Open " + esc(label) + "</button></section>";
  }

  /* First-party ambience: play/pause + volume only, no seek (the loops have
     no track length), generated tile per preset, elapsed timer while playing. */
  function ambienceCaps() {
    return { play: true, pause: true, next: false, previous: false, seek: false,
      shuffle: false, repeat: false, like: false, volume: true, artwork: true };
  }
  function ambienceModel(o) {
    o = o || {};
    return normalizeModel({
      provider: "first_party", providerLabel: "PrepNucleus",
      title: o.title || "Ambience", artist: "PrepNucleus ambience",
      artworkKey: o.presetId || "deep_focus",
      durationMs: 0, positionMs: o.positionMs || 0,
      isPlaying: !!o.isPlaying, volume: o.volume01 == null ? null : Math.round(clamp(o.volume01, 0, 1) * 100)
    });
  }

  var PURE = { esc: esc, REPEAT_STATES: REPEAT_STATES, nextRepeat: nextRepeat,
    defaultCaps: defaultCaps, normalizeCaps: normalizeCaps, normalizeModel: normalizeModel,
    isEmpty: isEmpty, formatMs: formatMs, pickArtwork: pickArtwork,
    interpolatePosition: interpolatePosition, shouldPoll: shouldPoll, createPoller: createPoller,
    cardHtml: cardHtml, externalHtml: externalHtml, ambienceCaps: ambienceCaps, ambienceModel: ambienceModel };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser: render + live mount =================
     render(model, caps, opts) -> HTML string (cardHtml).
     mount(el, { getState, onAction, fetchState, pollMs }) wires clicks and
     range inputs, ticks the elapsed/seek display every second locally and
     re-syncs via fetchState about every 5 s while visible. unmount(el)
     stops every timer. onAction(act, value, event) receives "toggle",
     "next", "previous", "shuffle", "repeat", "like", "pick", "open-app",
     "seek" (value = ms), "volume" (value = 0-100). */
  var mounts = {};
  function render(model, caps, opts) { return cardHtml(model, caps, opts); }
  function mount(el, o) {
    if (!el) return null;
    unmount(el);
    o = o || {};
    var state = { model: null, caps: null, baseAt: Date.now(), dragging: false };
    var key = "m" + Math.random().toString(36).slice(2, 9);
    el.setAttribute("data-player-mount", key);
    function currentOpts() { return o.renderOpts || {}; }
    function paint(fresh) {
      var s = fresh || (typeof o.getState === "function" ? o.getState() : null);
      if (!s) return;
      state.model = normalizeModel(s.model); state.caps = normalizeCaps(s.caps);
      state.baseAt = Date.now();
      el.innerHTML = cardHtml(state.model, state.caps, currentOpts());
      wire();
    }
    function wire() {
      var seek = el.querySelector("[data-player-seek]");
      if (seek) {
        seek.addEventListener("pointerdown", function () { state.dragging = true; });
        seek.addEventListener("change", function () {
          state.dragging = false;
          if (typeof o.onAction === "function") o.onAction("seek", Number(seek.value), seek);
        });
        seek.addEventListener("input", function () {
          var t = el.querySelector("[data-player-elapsed]");
          if (t) t.textContent = formatMs(Number(seek.value));
        });
      }
      var vol = el.querySelector("[data-player-volume]");
      if (vol) vol.addEventListener("change", function () {
        if (typeof o.onAction === "function") o.onAction("volume", Number(vol.value), vol);
      });
    }
    function onClick(e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-player-act]") : null;
      if (!b || b.disabled) return;
      var act = b.getAttribute("data-player-act");
      if (typeof o.onAction === "function") o.onAction(act, null, b);
    }
    el.addEventListener("click", onClick);
    var tickTimer = setInterval(function () {
      if (!state.model || !state.model.isPlaying) return;
      var pos = interpolatePosition(state.model, state.baseAt, Date.now());
      var t = el.querySelector("[data-player-elapsed]");
      if (t) t.textContent = formatMs(pos);
      var seek = el.querySelector("[data-player-seek]");
      if (seek && !state.dragging) seek.value = String(Math.min(pos, Number(seek.max) || pos));
      var bar = el.querySelector(".pn-player-bar span");
      if (bar && state.model.durationMs > 0) bar.style.width = Math.min(100, (pos / state.model.durationMs) * 100) + "%";
    }, 1000);
    var poller = null;
    poller = armPoller();
    if (typeof o.fetchState === "function") poller.start();
    function armPoller() {
      return createPoller({
        pollMs: o.pollMs || 5000,
        isActive: function () {
          return shouldPoll({ visible: el.isConnected && (el.offsetParent !== null || el.getClientRects().length > 0),
            documentHidden: document.visibilityState === "hidden", hasCard: !!state.model });
        },
        fetch: function () { return typeof o.fetchState === "function" ? o.fetchState() : null; },
        onData: function (d) { paint(d); }
      });
    }
    function onVis() {
      if (document.visibilityState === "hidden") { poller.stop(); return; }
      if (typeof o.fetchState === "function" && poller.isStopped()) { poller = armPoller(); poller.start(); }
    }
    document.addEventListener("visibilitychange", onVis);
    mounts[key] = { el: el, stop: function () {
      clearInterval(tickTimer); poller.stop();
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("click", onClick);
    }, paint: paint };
    paint();
    return { refresh: function (d) { paint(d); }, stop: function () { unmount(el); } };
  }
  function unmount(el) {
    if (!el) return;
    var key = el.getAttribute && el.getAttribute("data-player-mount");
    if (key && mounts[key]) { mounts[key].stop(); delete mounts[key]; }
  }

  G.PREP_SOUND_PLAYER = { render: render, mount: mount, unmount: unmount, _pure: PURE,
    formatMs: formatMs, normalizeModel: normalizeModel, normalizeCaps: normalizeCaps,
    externalHtml: externalHtml, ambienceModel: ambienceModel, ambienceCaps: ambienceCaps };
})(typeof window !== "undefined" ? window : this);
