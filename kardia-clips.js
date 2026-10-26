/* kardia-clips.js - Kardia real patient clips (WP10 item 5, WP12 layer).
 *
 * ES5 IIFE, window.KARDIA_CLIPS, module.exports under node for the pure
 * selection helpers. The clip catalogue is kardia/media/credits.json
 * (100 clips with attribution and licence). 62 clips are bundled in the
 * app under kardia/media/clips/ (the entry carries localFile) and play
 * offline with no hosting; the rest play from their hosted "url".
 * No lesson JSON is edited: the Learn lesson block is added at run time
 * by watching the lesson player for its figure and appending a small
 * "Real patient" block for the lesson view or pathology.
 *
 * Design contract (Operate mode, existing Kardia tokens only):
 * purpose: compare the simulated view with a real patient clip. First
 * screenful: clip, title, attribution and licence. States: loading
 * (plain status line), empty (no clip for this view or pathology, said
 * plainly), error (credits did not load, retry), offline (a short note
 * instead of a broken player, shown when the device reports offline or
 * the clip fails to load), long titles and attributions wrap, never
 * truncate. Motion: none beyond the clip itself; panels appear without
 * animation so reduced motion needs nothing extra. Every control is a
 * real button, 44px tall, focus ring from the engine. No new palette.
 *
 * Test seam: window.KARDIA_CLIPS_TEST_URL, when set to a string, is used
 * as the src for every clip so headless tests need no network.
 *
 * Real cine in Echo Lab (this file owns clip choice and caching; the
 * Echo Lab controller owns the at-target state machine and crossfade):
 * chooseClip picks one clip for a view plus the active pathology and
 * severity, falling back pathology and severity, then pathology, then
 * the view alone, preferring a moving clip over a still in each tier.
 * Preload states: not started, loading (credits or bytes), ready (a
 * playable src, from the Cache API when bytes were cached), empty (no
 * clip for this view or pathology), offline or error (no playable src;
 * the caller keeps the simulation and says so once). Long titles and
 * attributions wrap, never truncate. No new palette; the Echo Lab
 * label and switch reuse the Kardia tokens.
 */
(function (G) {
  "use strict";

  /* ---------- pure helpers (node tested) ---------- */
  function isVideo(clip) {
    var f = String((clip && (clip.file || clip.url)) || "").toLowerCase();
    return /\.mp4($|\?)/.test(f) || /\.webm($|\?)/.test(f);
  }
  function isBundled(clip) { return !!(clip && clip.localFile); }
  function localClipUrl(clip, baseStr) {
    if (!isBundled(clip)) return "";
    return (baseStr || "/kardia/") + "media/clips/" + clip.localFile;
  }
  /* Local first: a bundled clip plays from the app bundle offline,
   * with no hosting. The hosted url is the fallback for bundled clips
   * and the only source for clips that are not bundled yet. */
  function clipUrl(clip, override, baseStr) {
    if (typeof override === "string" && override) return override;
    return localClipUrl(clip, baseStr) || (clip && clip.url) || "";
  }
  function indexClips(clips) {
    var byView = {}, byPathology = {}, all = [];
    (clips || []).forEach(function (c) {
      if (!c) return;
      all.push(c);
      if (c.view) (byView[c.view] = byView[c.view] || []).push(c);
      if (c.pathology) (byPathology[c.pathology] = byPathology[c.pathology] || []).push(c);
    });
    return { byView: byView, byPathology: byPathology, all: all };
  }
  /* Clips for a view, a pathology, or both (view matches first, then
   * pathology matches that are not already listed). */
  function clipsFor(clips, query) {
    query = query || {};
    var idx = clips && clips.byView ? clips : indexClips(clips || []);
    var out = [], seen = {};
    function add(list) {
      (list || []).forEach(function (c) {
        var k = c.file || c.url || c.title;
        if (seen[k]) return;
        seen[k] = 1; out.push(c);
      });
    }
    if (query.view) add(idx.byView[query.view]);
    if (query.pathology) add(idx.byPathology[query.pathology]);
    return out;
  }
  function pathologyOfLesson(lesson) {
    var id = lesson && lesson.id;
    if (typeof id === "string" && id.indexOf("path_") === 0) return id.slice(5);
    return (lesson && lesson.pathology) || null;
  }
  function attributionLine(clip) {
    if (!clip) return "";
    return clip.attribution || ((clip.author || clip.title || "") + (clip.licence ? ", " + clip.licence : ""));
  }
  /* One clip for Echo Lab real cine. Tiers, best first: view plus
   * pathology plus severity; pathology plus severity; pathology;
   * view. A clip only enters a tier when every field that tier names
   * matches (a severity on the query must match the clip severity in
   * the severity tiers, so a severe clip is never shown for mild).
   * Within a tier a moving clip beats a still, then catalogue order. */
  function chooseClip(clips, query) {
    query = query || {};
    var view = query.view || null, path = query.pathology || null, sev = query.severity || null;
    var list = clips && clips.all ? clips.all : (clips || []);
    function pick(pred) {
      var still = null, hostedVideo = null, i, c;
      for (i = 0; i < list.length; i++) {
        c = list[i];
        if (!c || !pred(c)) continue;
        if (isVideo(c)) {
          /* A bundled clip wins over a hosted one in the same tier:
           * it plays offline with no hosting. */
          if (isBundled(c)) return c;
          if (!hostedVideo) hostedVideo = c;
        } else if (!still) still = c;
      }
      return hostedVideo || still;
    }
    var hit = null;
    if (view && path) hit = pick(function (c) { return c.view === view && c.pathology === path && (!sev || c.severity === sev); });
    if (!hit && path && sev) hit = pick(function (c) { return c.pathology === path && c.severity === sev; });
    if (!hit && path) hit = pick(function (c) { return c.pathology === path; });
    if (!hit && view) hit = pick(function (c) { return c.view === view; });
    return hit || null;
  }
  var CLIP_CACHE_NAME = "kardia-clips-v1";
  /* Cache API preload, the atlas3d pattern (cache name above): a hit
   * resolves with no fetch, so a clip seen once plays offline; a miss
   * fetches, stores a clone, and resolves. Every dependency is
   * injectable so this is unit tested in node. Resolves with the
   * bytes; rejects when nothing is cached and the fetch fails. */
  function cacheClipBytes(url, deps) {
    deps = deps || {};
    var cachesImpl = deps.caches !== undefined ? deps.caches
      : (typeof caches !== "undefined" ? caches : null);
    var fetchImpl = deps.fetch !== undefined ? deps.fetch : (typeof fetch !== "undefined" ? fetch : null);
    var name = deps.cacheName || CLIP_CACHE_NAME;
    function fromCache() {
      if (!cachesImpl || !cachesImpl.open) return Promise.resolve(null);
      return Promise.resolve(cachesImpl.open(name)).then(function (cache) {
        return Promise.resolve(cache.match(url));
      }).then(function (res) {
        return res ? Promise.resolve(res.arrayBuffer()) : null;
      }).then(function (b) { return b || null; }, function () { return null; });
    }
    return fromCache().then(function (cached) {
      if (cached) return cached;
      if (!fetchImpl) throw new Error("clip not cached and no fetch available");
      return Promise.resolve(fetchImpl(url)).then(function (res) {
        if (!res || !res.ok) throw new Error("clip " + (res ? res.status : "no response"));
        var put = null;
        if (cachesImpl && cachesImpl.open && res.clone) {
          put = Promise.resolve(cachesImpl.open(name)).then(function (cache) {
            return cache.put(url, res.clone());
          }).then(function () {}, function () {});
        }
        return Promise.resolve(res.arrayBuffer()).then(function (bytes) {
          return put ? put.then(function () { return bytes; }) : bytes;
        });
      });
    });
  }

  var PURE = {
    isVideo: isVideo, clipUrl: clipUrl, localClipUrl: localClipUrl, isBundled: isBundled, indexClips: indexClips,
    clipsFor: clipsFor, pathologyOfLesson: pathologyOfLesson,
    attributionLine: attributionLine, chooseClip: chooseClip,
    cacheClipBytes: cacheClipBytes, CLIP_CACHE_NAME: CLIP_CACHE_NAME
  };
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
  if (!G) return;

  /* ---------- browser layer ---------- */
  var state = { credits: null, loading: false, err: false, host: null, observer: null };

  function base() {
    var h = state.host;
    return (h && h.cfg && h.cfg.base) || G.SMD_KARDIA_BASE || "/kardia/";
  }
  function esc(s) {
    var I = state.host && state.host._internal;
    if (I && I.esc) return I.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function offline() {
    try { return G.navigator && G.navigator.onLine === false; } catch (e) { return false; }
  }
  function testUrl() {
    try { return typeof G.KARDIA_CLIPS_TEST_URL === "string" ? G.KARDIA_CLIPS_TEST_URL : null; } catch (e) { return null; }
  }

  function load() {
    if (state.credits) return Promise.resolve(state.credits);
    if (state.loading) return state.loading;
    var p;
    try {
      if (!G.fetch) throw new Error("no fetch");
      p = G.fetch(base() + "media/credits.json").then(function (r) {
        if (!r.ok) throw new Error("credits " + r.status);
        return r.json();
      }).then(function (d) {
        state.credits = indexClips((d && d.clips) || []);
        state.loading = false; state.err = false;
        return state.credits;
      }, function (e) {
        state.loading = false; state.err = true;
        throw e;
      });
    } catch (e) {
      state.err = true;
      return Promise.reject(e);
    }
    state.loading = p;
    return p;
  }

  function mediaHtml(clip, label) {
    var url = clipUrl(clip, testUrl(), base());
    if (offline() && !testUrl() && !isBundled(clip)) {
      return '<p class="krdc-offline" role="status">You are offline, so the real patient clip cannot load. ' +
        'The simulated view above still works. Reconnect and reopen this panel to see the clip.</p>';
    }
    if (isVideo(clip)) {
      return '<video class="krdc-video" src="' + esc(url) + '" muted loop playsinline autoplay preload="metadata" ' +
        'aria-label="' + esc(label || clip.title || "Real patient clip") + '"></video>';
    }
    return '<img class="krdc-video" src="' + esc(url) + '" alt="' + esc(label || clip.title || "Real patient still") + '" loading="lazy" decoding="async">';
  }
  function creditHtml(clip) {
    var lic = clip.licenceUrl
      ? '<a href="' + esc(clip.licenceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(clip.licence || "licence") + "</a>"
      : esc(clip.licence || "");
    return '<p class="krdc-credit"><span>' + esc(attributionLine(clip)) + "</span>" +
      (lic ? ' <span class="krdc-lic">' + lic + "</span>" : "") + "</p>";
  }
  /* One compare panel: the first matching clip beside the simulated
   * view (the caller places this under its sector), with attribution. */
  function compareHtml(query, viewName) {
    if (state.err) return '<div class="krdc-panel"><p class="krdc-note" role="alert">Real patient clips did not load. Check the connection and try again.</p></div>';
    if (!state.credits) return '<div class="krdc-panel"><p class="krdc-note" role="status">Loading real patient clips.</p></div>';
    var list = clipsFor(state.credits, query);
    if (!list.length) {
      return '<div class="krdc-panel"><p class="krdc-note">No real patient clip for ' + esc(viewName || "this view") +
        ' yet. The simulated view is the reference for now, and clips are added only when a licence allows use in the app.</p></div>';
    }
    var c = list[0];
    return '<div class="krdc-panel" data-krdc-panel>' +
      '<h3 class="sp-h3">Real patient: ' + esc(c.title || viewName || "clip") + "</h3>" +
      mediaHtml(c, c.title) + creditHtml(c) +
      (list.length > 1 ? '<p class="krdc-note">' + list.length + ' clips match this view. The first is shown here; all are listed under Credits.</p>' : "") +
      "</div>";
  }
  function creditsHtml() {
    if (state.err) return '<p class="krdc-note" role="alert">Credits did not load. Check the connection and try again.</p>';
    if (!state.credits) return '<p class="krdc-note" role="status">Loading credits.</p>';
    if (!state.credits.all.length) return '<p class="krdc-note">No clips yet.</p>';
    return '<ul class="krdc-credits">' + state.credits.all.map(function (c) {
      return '<li><b>' + esc(c.title || c.file) + "</b>" +
        '<span class="krdc-meta">' + esc(c.view || c.pathology || "") + (c.licence ? " · " + esc(c.licence) : "") + "</span>" +
        creditHtml(c) + "</li>";
    }).join("") + "</ul>";
  }
  /* Wire a rendered panel: a clip that fails to load (offline mid load,
   * hosting error) is replaced by the offline note, never left broken. */
  function wirePanel(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll("video.krdc-video, img.krdc-video"), function (el) {
      function fail() {
        var note = G.document.createElement("p");
        note.className = "krdc-offline"; note.setAttribute("role", "status");
        note.textContent = "This clip could not load. You may be offline, or the clip host is unreachable. The simulated view still works; reconnect and reopen this panel to try again.";
        if (el.parentNode) el.parentNode.replaceChild(note, el);
      }
      el.addEventListener("error", fail);
      if (el.tagName === "VIDEO") {
        var pr = el.play && el.play();
        if (pr && pr.catch) pr.catch(function () {});
      }
    });
  }

  /* Learn lesson hook: when the lesson player shows its figure for a
   * lesson whose view or pathology has clips, append one Real patient
   * block under the figure. Lesson JSON is never edited. */
  function lessonQuery() {
    var h = state.host;
    var les = h && h._learn && h._learn._w && h._learn._w.les;
    if (!les) return null;
    return { view: les.view || (les.see && les.see.view) || null, pathology: pathologyOfLesson(les), title: les.title };
  }
  function tryLessonBlock() {
    var doc = G.document;
    if (!doc || !state.credits) return;
    var root = doc.getElementById(state.host ? state.host.cfg.rootId : "smdKardia");
    if (!root) return;
    var fig = root.querySelector(".ln-fig");
    if (!fig || fig.getAttribute("data-krdc")) return;
    var q = lessonQuery();
    if (!q || (!q.view && !q.pathology)) return;
    var list = clipsFor(state.credits, q);
    if (!list.length) { fig.setAttribute("data-krdc", "none"); return; }
    fig.setAttribute("data-krdc", "1");
    var div = doc.createElement("div");
    div.className = "krdc-lesson";
    div.innerHTML = '<h3 class="sp-h3">Real patient</h3>' + mediaHtml(list[0], list[0].title) + creditHtml(list[0]);
    fig.parentNode.insertBefore(div, fig.nextSibling);
    wirePanel(div);
  }
  function attach(host) {
    if (!host || state.host === host) return state.host ? api : api;
    state.host = host;
    load().then(function () { tryLessonBlock(); }, function () {});
    try {
      var root = G.document.getElementById(host.cfg.rootId);
      if (root && G.MutationObserver && !state.observer) {
        state.observer = new G.MutationObserver(function () { tryLessonBlock(); });
        state.observer.observe(root, { childList: true, subtree: true });
      }
    } catch (e) {}
    host._kardiaClips = api;
    return api;
  }

  /* Echo Lab real cine: choose the clip for a query and preload its
   * bytes through the Cache API, resolving with a playable src (an
   * object URL for cached bytes, the hosted URL when no cache is
   * available, the test fixture when stubbed). Resolves null when no
   * clip matches; rejects when a clip exists but cannot load, so the
   * caller keeps the simulation and says so once. One preload per
   * clip URL is shared; a superseded object URL is revoked. */
  var preloads = {};
  function preloadFor(query) {
    return load().then(function (credits) {
      var clip = chooseClip(credits, query);
      if (!clip) return null;
      var stub = testUrl();
      if (stub) return { clip: clip, src: stub, cached: false };
      /* Local bundle first (works offline, no hosting), then the
       * hosted url as the fallback. A bundled clip that cannot be
       * read locally still tries the network before giving up. */
      var candidates = [];
      var local = localClipUrl(clip, base());
      if (local) candidates.push(local);
      if (clip.url && clip.url !== local) candidates.push(clip.url);
      if (!candidates.length) return null;
      var key = candidates.join("|");
      if (preloads[key]) return preloads[key];
      var shared = null;
      try { shared = G.SMD_THOREX_MODEL_CACHE; } catch (e) {}
      function tryCandidate(i) {
        var url = candidates[i];
        var bytesP = (shared && shared.loadModelBytes)
          ? shared.loadModelBytes(url, { cacheName: CLIP_CACHE_NAME })
          : cacheClipBytes(url, { caches: G.caches || null, fetch: G.fetch ? G.fetch.bind(G) : null });
        return Promise.resolve(bytesP).then(function (bytes) {
          var src = url;
          try {
            if (bytes && G.Blob && G.URL && G.URL.createObjectURL) {
              src = G.URL.createObjectURL(new G.Blob([bytes], { type: isVideo(clip) ? "video/mp4" : "image/webp" }));
            }
          } catch (e) {}
          return { clip: clip, src: src, cached: !!local && i === 0 ? true : src !== url };
        }, function (e) {
          if (i + 1 < candidates.length) return tryCandidate(i + 1);
          throw e;
        });
      }
      var p = tryCandidate(0).then(function (res) { return res; }, function (e) {
        delete preloads[key];
        throw e;
      });
      preloads[key] = p;
      return p;
    });
  }

  var api = {
    load: load, attach: attach, compareHtml: compareHtml, creditsHtml: creditsHtml,
    wirePanel: wirePanel, tryLessonBlock: tryLessonBlock, preloadFor: preloadFor,
    chooseClip: function (q) { return state.credits ? chooseClip(state.credits, q) : null; },
    clipUrl: function (clip) { return clipUrl(clip, testUrl(), base()); },
    isBundled: isBundled,
    clipsFor: function (q) { return state.credits ? clipsFor(state.credits, q) : []; },
    get credits() { return state.credits; },
    _pure: PURE
  };
  G.KARDIA_CLIPS = api;
  /* If the Kardia host already exists (load order after kardia.js),
   * attach at once; otherwise kardia-practice attaches on Practice. */
  try { if (G.KARDIA && G.KARDIA._internal) attach(G.KARDIA); } catch (e) {}
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
