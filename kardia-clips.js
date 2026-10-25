/* kardia-clips.js - Kardia real patient clips (WP10 item 5, WP12 layer).
 *
 * ES5 IIFE, window.KARDIA_CLIPS, module.exports under node for the pure
 * selection helpers. The clip catalogue is kardia/media/credits.json
 * (38 clips, each hosted at its "url" with attribution and licence).
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
 */
(function (G) {
  "use strict";

  /* ---------- pure helpers (node tested) ---------- */
  function isVideo(clip) {
    var f = String((clip && (clip.file || clip.url)) || "").toLowerCase();
    return /\.mp4($|\?)/.test(f) || /\.webm($|\?)/.test(f);
  }
  function clipUrl(clip, override) {
    if (typeof override === "string" && override) return override;
    return (clip && clip.url) || "";
  }
  function indexClips(clips) {
    var byView = {}, byPathology = {}, all = [];
    (clips || []).forEach(function (c) {
      if (!c || (!c.view && !c.pathology)) return;
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

  var PURE = {
    isVideo: isVideo, clipUrl: clipUrl, indexClips: indexClips,
    clipsFor: clipsFor, pathologyOfLesson: pathologyOfLesson,
    attributionLine: attributionLine
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
    var url = clipUrl(clip, testUrl());
    if (offline() && !testUrl()) {
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

  var api = {
    load: load, attach: attach, compareHtml: compareHtml, creditsHtml: creditsHtml,
    wirePanel: wirePanel, tryLessonBlock: tryLessonBlock,
    clipsFor: function (q) { return state.credits ? clipsFor(state.credits, q) : []; },
    get credits() { return state.credits; },
    _pure: PURE
  };
  G.KARDIA_CLIPS = api;
  /* If the Kardia host already exists (load order after kardia.js),
   * attach at once; otherwise kardia-practice attaches on Practice. */
  try { if (G.KARDIA && G.KARDIA._internal) attach(G.KARDIA); } catch (e) {}
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
